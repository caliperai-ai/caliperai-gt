"""
Workflow API Endpoints with RBAC protection.

Provides endpoints for task stage/status transitions.
"""
import uuid
from typing import Annotated, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, delete
from pydantic import BaseModel

from app.core.database import get_db
from app.models.models import Task, TaskStageHistory, TaskAssignmentHistory, User, Permission, UserRole, TaskStatus, TaskStage, Taxonomy, QAReview
from app.services.workflow_service import WorkflowService, WorkflowError
from app.services.rbac_service import (
    get_current_user,
    RequirePermissions,
    require_permission,
)


router = APIRouter(prefix="/workflow", tags=["workflow"])



class StatusTransitionRequest(BaseModel):
    """Request to transition task status."""
    status: str
    reason: Optional[str] = None


class AssignmentRequest(BaseModel):
    """Request to assign a task."""
    user_id: str


class ReviewCompleteRequest(BaseModel):
    """Request to complete a review."""
    accepted: bool
    reason: Optional[str] = None


class TaskWorkflowInfo(BaseModel):
    """Current workflow state of a task."""
    task_id: str
    stage: str
    status: str
    assignee_id: Optional[str] = None
    reviewer_id: Optional[str] = None
    customer_reviewer_id: Optional[str] = None
    skip_customer_qa: bool
    revision_count: int
    available_transitions: List[str]


class StageHistoryItem(BaseModel):
    """Single history entry."""
    id: str
    from_stage: str
    from_status: str
    to_stage: str
    to_status: str
    changed_by_id: Optional[str] = None
    reason: Optional[str] = None
    created_at: str


class AssignmentHistoryItem(BaseModel):
    """Single assignment history entry."""
    id: str
    action: str
    user_id: Optional[str] = None
    user_name: Optional[str] = None
    role: str
    stage: str
    changed_by_id: Optional[str] = None
    changed_by_name: Optional[str] = None
    reason: Optional[str] = None
    created_at: str



@router.get("/tasks/{task_id}/info", response_model=TaskWorkflowInfo)
async def get_workflow_info(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Get current workflow state and available transitions for a task."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    workflow = WorkflowService(db)
    available = workflow.get_available_transitions(task)

    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )


@router.get("/tasks/{task_id}/history", response_model=List[StageHistoryItem])
async def get_task_history(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Get stage/status transition history for a task."""
    workflow = WorkflowService(db)
    history = await workflow.get_task_history(task_id)
    
    return [
        StageHistoryItem(
            id=str(h.id),
            from_stage=h.from_stage,
            from_status=h.from_status,
            to_stage=h.to_stage,
            to_status=h.to_status,
            changed_by_id=str(h.changed_by_id) if h.changed_by_id else None,
            reason=h.reason,
            created_at=h.created_at.isoformat(),
        )
        for h in history
    ]


@router.get("/tasks/{task_id}/assignment-history", response_model=List[AssignmentHistoryItem])
async def get_assignment_history(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Get assignment change history for a task."""
    workflow = WorkflowService(db)
    history = await workflow.get_assignment_history(task_id)

    user_ids = set()
    for h in history:
        if h.user_id:
            user_ids.add(h.user_id)
        if h.changed_by_id:
            user_ids.add(h.changed_by_id)

    user_map: dict[uuid.UUID, str] = {}
    if user_ids:
        result = await db.execute(
            select(User).where(User.id.in_(list(user_ids)))
        )
        for u in result.scalars().all():
            user_map[u.id] = u.full_name or u.username

    return [
        AssignmentHistoryItem(
            id=str(h.id),
            action=h.action,
            user_id=str(h.user_id) if h.user_id else None,
            user_name=user_map.get(h.user_id) if h.user_id else None,
            role=h.role,
            stage=h.stage,
            changed_by_id=str(h.changed_by_id) if h.changed_by_id else None,
            changed_by_name=user_map.get(h.changed_by_id) if h.changed_by_id else None,
            reason=h.reason,
            created_at=h.created_at.isoformat(),
        )
        for h in history
    ]


@router.post("/tasks/{task_id}/transition", response_model=TaskWorkflowInfo)
async def transition_task_status(
    task_id: uuid.UUID,
    request: StatusTransitionRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Transition a task to a new status."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    workflow = WorkflowService(db)
    
    try:
        task = await workflow.transition_status(
            task=task,
            new_status=request.status,
            reason=request.reason,
        )
        await db.commit()
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    available = workflow.get_available_transitions(task)
    
    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )


@router.post("/tasks/{task_id}/assign", response_model=TaskWorkflowInfo)
async def assign_task(
    task_id: uuid.UUID,
    request: AssignmentRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_ASSIGN))],
    db: AsyncSession = Depends(get_db),
):
    """Assign a task to a user (annotator). Requires TASKS_ASSIGN permission."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    workflow = WorkflowService(db)

    try:
        task = await workflow.assign_task(
            task=task,
            assignee_id=uuid.UUID(request.user_id),
        )
        await db.commit()
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))

    available = workflow.get_available_transitions(task)

    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )


@router.post("/tasks/{task_id}/assign-reviewer", response_model=TaskWorkflowInfo)
async def assign_qa_reviewer(
    task_id: uuid.UUID,
    request: AssignmentRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_ASSIGN))],
    db: AsyncSession = Depends(get_db),
):
    """Assign a QA reviewer to a task. Requires TASKS_ASSIGN permission."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    workflow = WorkflowService(db)
    
    try:
        task = await workflow.assign_reviewer(
            task=task,
            reviewer_id=uuid.UUID(request.user_id),
        )
        await db.commit()
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    available = workflow.get_available_transitions(task)
    
    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )


@router.post("/tasks/{task_id}/assign-customer-reviewer", response_model=TaskWorkflowInfo)
async def assign_customer_reviewer(
    task_id: uuid.UUID,
    request: AssignmentRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_ASSIGN))],
    db: AsyncSession = Depends(get_db),
):
    """Assign a Customer QA reviewer to a task. Requires TASKS_ASSIGN permission."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    workflow = WorkflowService(db)
    
    try:
        task = await workflow.assign_customer_reviewer(
            task=task,
            customer_reviewer_id=uuid.UUID(request.user_id),
        )
        await db.commit()
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    available = workflow.get_available_transitions(task)
    
    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )


@router.post("/tasks/{task_id}/start", response_model=TaskWorkflowInfo)
async def start_task(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_START))],
    db: AsyncSession = Depends(get_db),
):
    """Start working on a task. Requires TASKS_START permission."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    workflow = WorkflowService(db)

    try:
        task = await workflow.start_work(task=task)
        await db.commit()
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    available = workflow.get_available_transitions(task)
    
    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )


@router.post("/tasks/{task_id}/submit", response_model=TaskWorkflowInfo)
async def submit_task(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_SUBMIT))],
    db: AsyncSession = Depends(get_db),
):
    """Submit annotation work for QA review. Requires TASKS_SUBMIT permission."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    workflow = WorkflowService(db)
    is_admin = current_user.role in [UserRole.ADMIN.value, UserRole.PROJECT_MANAGER.value]

    try:
        task = await workflow.submit_annotation(task=task, changed_by_id=current_user.id, is_admin=is_admin)
        await db.commit()
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    available = workflow.get_available_transitions(task)
    
    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )


@router.post("/tasks/{task_id}/submit-fixes", response_model=TaskWorkflowInfo)
async def submit_fixes(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_SUBMIT))],
    db: AsyncSession = Depends(get_db),
):
    """Submit fixed annotations for QA re-review. Requires TASKS_SUBMIT permission."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    workflow = WorkflowService(db)
    is_admin = current_user.role in [UserRole.ADMIN.value, UserRole.PROJECT_MANAGER.value]

    try:
        task = await workflow.submit_fixes(task=task, changed_by_id=current_user.id, is_admin=is_admin)
        await db.commit()
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    available = workflow.get_available_transitions(task)
    
    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )


@router.post("/tasks/{task_id}/complete-qa", response_model=TaskWorkflowInfo)
async def complete_qa_review(
    task_id: uuid.UUID,
    request: ReviewCompleteRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_REVIEW))],
    db: AsyncSession = Depends(get_db),
):
    """Complete QA review - accept or reject the task. Requires QA_REVIEW permission."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    workflow = WorkflowService(db)

    try:
        task = await workflow.complete_qa_review(
            task=task,
            accepted=request.accepted,
            reason=request.reason,
        )
        await db.commit()
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    available = workflow.get_available_transitions(task)
    
    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )


@router.post("/tasks/{task_id}/complete-customer-qa", response_model=TaskWorkflowInfo)
async def complete_customer_qa_review(
    task_id: uuid.UUID,
    request: ReviewCompleteRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.CUSTOMER_QA_REVIEW))],
    db: AsyncSession = Depends(get_db),
):
    """Complete Customer QA review. Requires CUSTOMER_QA_REVIEW permission."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    workflow = WorkflowService(db)

    try:
        task = await workflow.complete_customer_review(
            task=task,
            accepted=request.accepted,
            reason=request.reason,
        )
        await db.commit()
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    available = workflow.get_available_transitions(task)
    
    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )


@router.patch("/tasks/{task_id}/skip-customer-qa", response_model=TaskWorkflowInfo)
async def set_skip_customer_qa(
    task_id: uuid.UUID,
    skip: bool = True,
    db: AsyncSession = Depends(get_db),
):
    """Set whether this task should skip Customer QA stage."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    task.skip_customer_qa = skip
    await db.commit()
    await db.refresh(task)
    
    workflow = WorkflowService(db)
    available = workflow.get_available_transitions(task)
    
    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )



@router.post("/tasks/{task_id}/unassign", response_model=TaskWorkflowInfo)
async def unassign_task(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_ASSIGN))],
    db: AsyncSession = Depends(get_db),
):
    """Unassign the current assignee/reviewer from a task based on its stage."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    workflow = WorkflowService(db)

    try:
        if task.stage == "annotation":
            task = await workflow.unassign_task(task=task, changed_by_id=current_user.id)
        elif task.stage == "qa":
            task = await workflow.unassign_reviewer(task=task, changed_by_id=current_user.id)
        elif task.stage == "customer_qa":
            task = await workflow.unassign_customer_reviewer(task=task, changed_by_id=current_user.id)
        else:
            raise WorkflowError(f"Cannot unassign task in stage '{task.stage}'")
        await db.commit()
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    available = workflow.get_available_transitions(task)
    
    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )


@router.post("/tasks/{task_id}/unassign-reviewer", response_model=TaskWorkflowInfo)
async def unassign_reviewer(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_ASSIGN))],
    db: AsyncSession = Depends(get_db),
):
    """Unassign QA reviewer from a task. Requires TASKS_ASSIGN permission."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    workflow = WorkflowService(db)
    
    try:
        task = await workflow.unassign_reviewer(
            task=task,
            changed_by_id=current_user.id,
        )
        await db.commit()
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    available = workflow.get_available_transitions(task)
    
    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )



@router.post("/tasks/{task_id}/editor-open", response_model=TaskWorkflowInfo)
async def on_editor_open(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """
    Handle auto-transitions when user opens task in editor.
    Auto-transitions assigned -> in_progress for assignee/reviewer.
    Admins can trigger transitions regardless of assignment.
    """
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"EDITOR OPEN: task_id={task_id}, user_id={current_user.id}, user={current_user.email}, role={current_user.role}")
    
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    logger.info(f"EDITOR OPEN: task.status={task.status}, task.stage={task.stage}, task.assignee_id={task.assignee_id}")
    
    workflow = WorkflowService(db)
    
    is_admin = current_user.role in [UserRole.ADMIN.value, UserRole.PROJECT_MANAGER.value]
    logger.info(f"EDITOR OPEN: is_admin={is_admin}")
    
    try:
        task = await workflow.on_editor_open(
            task=task,
            user_id=current_user.id,
            is_admin=is_admin,
        )
        await db.commit()
        logger.info(f"EDITOR OPEN: after transition task.status={task.status}")
    except WorkflowError as e:
        logger.error(f"EDITOR OPEN: workflow error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    
    available = workflow.get_available_transitions(task)
    
    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )



class BulkAssignRequest(BaseModel):
    """Request for bulk task assignment."""
    task_ids: List[str]
    user_id: str


class BulkSubmitRequest(BaseModel):
    """Request for bulk task submission."""
    task_ids: List[str]


class BulkOperationResult(BaseModel):
    """Result of a bulk operation."""
    success_count: int
    failed_count: int
    tasks: List[TaskWorkflowInfo]


@router.post("/tasks/bulk-assign", response_model=BulkOperationResult)
async def bulk_assign_tasks(
    request: BulkAssignRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_ASSIGN))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk assign multiple tasks to a user. Requires TASKS_ASSIGN permission."""
    task_ids = [uuid.UUID(tid) for tid in request.task_ids]
    result = await db.execute(select(Task).where(Task.id.in_(task_ids)))
    tasks = list(result.scalars().all())
    
    workflow = WorkflowService(db)
    
    updated_tasks = await workflow.bulk_assign_tasks(
        tasks=tasks,
        assignee_id=uuid.UUID(request.user_id),
        changed_by_id=current_user.id,
    )
    await db.commit()
    
    success_count = sum(1 for t in updated_tasks if t.status == "assigned")
    
    task_infos = [
        TaskWorkflowInfo(
            task_id=str(t.id),
            stage=t.stage,
            status=t.status,
            assignee_id=str(t.assignee_id) if t.assignee_id else None,
            reviewer_id=str(t.reviewer_id) if t.reviewer_id else None,
            customer_reviewer_id=str(t.customer_reviewer_id) if t.customer_reviewer_id else None,
            skip_customer_qa=t.skip_customer_qa,
            revision_count=t.revision_count,
            available_transitions=workflow.get_available_transitions(t),
        )
        for t in updated_tasks
    ]
    
    return BulkOperationResult(
        success_count=success_count,
        failed_count=len(tasks) - success_count,
        tasks=task_infos,
    )


@router.post("/tasks/bulk-submit", response_model=BulkOperationResult)
async def bulk_submit_tasks(
    request: BulkSubmitRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_SUBMIT))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk submit multiple tasks for QA. Requires TASKS_SUBMIT permission."""
    task_ids = [uuid.UUID(tid) for tid in request.task_ids]
    result = await db.execute(select(Task).where(Task.id.in_(task_ids)))
    tasks = list(result.scalars().all())
    
    workflow = WorkflowService(db)
    
    updated_tasks = await workflow.bulk_submit_tasks(
        tasks=tasks,
        changed_by_id=current_user.id,
    )
    await db.commit()
    
    success_count = sum(1 for t in updated_tasks if t.stage == "qa")
    
    task_infos = [
        TaskWorkflowInfo(
            task_id=str(t.id),
            stage=t.stage,
            status=t.status,
            assignee_id=str(t.assignee_id) if t.assignee_id else None,
            reviewer_id=str(t.reviewer_id) if t.reviewer_id else None,
            customer_reviewer_id=str(t.customer_reviewer_id) if t.customer_reviewer_id else None,
            skip_customer_qa=t.skip_customer_qa,
            revision_count=t.revision_count,
            available_transitions=workflow.get_available_transitions(t),
        )
        for t in updated_tasks
    ]
    
    return BulkOperationResult(
        success_count=success_count,
        failed_count=len(tasks) - success_count,
        tasks=task_infos,
    )


@router.post("/tasks/bulk-assign-reviewer", response_model=BulkOperationResult)
async def bulk_assign_reviewers(
    request: BulkAssignRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_ASSIGN))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk assign QA reviewer to multiple tasks. Requires TASKS_ASSIGN permission."""
    task_ids = [uuid.UUID(tid) for tid in request.task_ids]
    result = await db.execute(select(Task).where(Task.id.in_(task_ids)))
    tasks = list(result.scalars().all())
    
    workflow = WorkflowService(db)
    
    updated_tasks = await workflow.bulk_assign_reviewers(
        tasks=tasks,
        reviewer_id=uuid.UUID(request.user_id),
        changed_by_id=current_user.id,
    )
    await db.commit()
    
    success_count = sum(1 for t in updated_tasks if t.reviewer_id is not None)
    
    task_infos = [
        TaskWorkflowInfo(
            task_id=str(t.id),
            stage=t.stage,
            status=t.status,
            assignee_id=str(t.assignee_id) if t.assignee_id else None,
            reviewer_id=str(t.reviewer_id) if t.reviewer_id else None,
            customer_reviewer_id=str(t.customer_reviewer_id) if t.customer_reviewer_id else None,
            skip_customer_qa=t.skip_customer_qa,
            revision_count=t.revision_count,
            available_transitions=workflow.get_available_transitions(t),
        )
        for t in updated_tasks
    ]
    
    return BulkOperationResult(
        success_count=success_count,
        failed_count=len(tasks) - success_count,
        tasks=task_infos,
    )



@router.post("/tasks/{task_id}/skip-qa", response_model=TaskWorkflowInfo)
async def skip_qa_stage(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.QA_REVIEW))],
    db: AsyncSession = Depends(get_db),
):
    """Skip QA stage and move directly to Customer QA or Accepted. Requires QA_REVIEW permission."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    workflow = WorkflowService(db)
    
    try:
        task = await workflow.skip_qa_stage(
            task=task,
            changed_by_id=current_user.id,
        )
        await db.commit()
    except WorkflowError as e:
        raise HTTPException(status_code=400, detail=str(e))
    
    available = workflow.get_available_transitions(task)
    
    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )



class SetStageRequest(BaseModel):
    """Request to forcefully set stage (admin override)."""
    stage: str
    reset_revision_count: bool = False


@router.post("/tasks/{task_id}/set-stage", response_model=TaskWorkflowInfo)
async def set_stage(
    task_id: uuid.UUID,
    request: SetStageRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_ASSIGN))],
    db: AsyncSession = Depends(get_db),
):
    """Admin endpoint to forcefully set stage for a task. Requires TASKS_ASSIGN permission."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    valid_stages = ['annotation', 'qa', 'customer_qa', 'accepted']
    if request.stage not in valid_stages:
        raise HTTPException(status_code=400, detail=f"Invalid stage. Must be one of: {', '.join(valid_stages)}")

    workflow = WorkflowService(db)
    old_stage = task.stage
    old_status = task.status

    task.stage = request.stage
    task.status = TaskStatus.PENDING.value

    if request.reset_revision_count:
        task.revision_count = 0
        task.review_notes = None
        task.customer_review_notes = None
        await db.execute(delete(QAReview).where(QAReview.task_id == task_id))

    await workflow._record_history(
        task=task,
        from_stage=old_stage,
        from_status=old_status,
        to_stage=request.stage,
        to_status=TaskStatus.PENDING.value,
        changed_by_id=current_user.id,
        reason=f"Admin override: set stage to {request.stage}" + (" (revision reset)" if request.reset_revision_count else ""),
    )

    await db.commit()
    available = workflow.get_available_transitions(task)

    return TaskWorkflowInfo(
        task_id=str(task.id),
        stage=task.stage,
        status=task.status,
        assignee_id=str(task.assignee_id) if task.assignee_id else None,
        reviewer_id=str(task.reviewer_id) if task.reviewer_id else None,
        customer_reviewer_id=str(task.customer_reviewer_id) if task.customer_reviewer_id else None,
        skip_customer_qa=task.skip_customer_qa,
        revision_count=task.revision_count,
        available_transitions=available,
    )

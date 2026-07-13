"""
Task endpoints - Core workflow management with RBAC protection.
"""
from datetime import datetime
from typing import Annotated, Optional, List
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, and_, delete, or_, func, distinct
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import INT4RANGE
from asyncpg import Range as PgRange

from app.core.database import get_db
from app.models.models import Task, Scene, Frame, Annotation, TaskStatus, TaskStage, TaskStageHistory, TaskAssignmentHistory, User, Permission, QAReview, Annotation3D, Annotation2D, Annotation4D, AnnotationFusion, Taxonomy, Dataset, Campaign
from pydantic import BaseModel as PydanticBaseModel
from app.schemas.schemas import (
    TaskCreate,
    TaskUpdate,
    TaskResponse,
    TaskAssignment,
    TaskStatusUpdate,
    AnnotationSource,
)
from app.services.rbac_service import (
    get_current_user,
    RequirePermissions,
    require_permission,
)
from app.services.organization_service import get_user_accessible_organization_ids

router = APIRouter()


def frame_range_to_postgres(start: int, end: int) -> PgRange:
    """Convert frame range to PostgreSQL INT4RANGE format."""
    return PgRange(start, end + 1)


@router.post("", response_model=TaskResponse, status_code=status.HTTP_201_CREATED)
async def create_task(
    task_in: TaskCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_CREATE))],
    db: AsyncSession = Depends(get_db),
) -> Task:
    """Create a new annotation task. Requires TASKS_CREATE permission."""
    from app.services.workflow_service import WorkflowService
    
    scene_query = select(Scene).where(
        Scene.id == task_in.scene_id,
        Scene.is_deleted == False,
    )
    result = await db.execute(scene_query)
    scene = result.scalar_one_or_none()
    
    if not scene:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scene {task_in.scene_id} not found",
        )
    
    if task_in.frame_range.end >= scene.frame_count:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Frame range exceeds scene frame count ({scene.frame_count})",
        )
    
    initial_status = TaskStatus.ASSIGNED.value if task_in.assignee_id else TaskStatus.PENDING.value
    
    task = Task(
        scene_id=task_in.scene_id,
        taxonomy_id=task_in.taxonomy_id,
        name=task_in.name,
        description=task_in.description,
        status=initial_status,
        assignee_id=task_in.assignee_id,
        assigned_at=datetime.utcnow() if task_in.assignee_id else None,
        frame_range=frame_range_to_postgres(
            task_in.frame_range.start,
            task_in.frame_range.end,
        ),
        context_buffer_before=task_in.context_buffer_before,
        context_buffer_after=task_in.context_buffer_after,
        priority=task_in.priority,
        deadline=task_in.deadline,
        config=task_in.config.model_dump(),
    )
    db.add(task)
    await db.flush()
    await db.refresh(task)
    
    if task_in.assignee_id:
        workflow = WorkflowService(db)
        await workflow._record_history(
            task=task,
            from_stage="annotation",
            from_status="pending",
            to_stage="annotation",
            to_status="assigned",
            changed_by_id=current_user.id,
            reason=f"Task created with assignee {task_in.assignee_id}",
        )
    
    from pathlib import Path
    from app.api.v1.endpoints.import_data import import_scene_annotations
    
    root_path = scene.storage_paths.get("root")
    if root_path:
        scene_dir = Path(root_path)
        if scene_dir.exists():
            try:
                annotations_3d, annotations_2d = await import_scene_annotations(
                    db=db,
                    scene=scene,
                    scene_dir=scene_dir,
                    task=task,
                )
                if annotations_3d > 0 or annotations_2d > 0:
                    print(f"[TASK-CREATE] Auto-imported {annotations_3d} 3D and {annotations_2d} 2D annotations for task {task.id}")
            except Exception as e:
                print(f"[TASK-CREATE] Failed to auto-import annotations: {str(e)}")
    
    return task


@router.get("", response_model=list[TaskResponse])
async def list_tasks(
    current_user: Annotated[User, Depends(get_current_user)],
    scene_id: Optional[UUID] = None,
    taxonomy_id: Optional[UUID] = Query(None, description="Filter by taxonomy"),
    status: Optional[str] = None,
    assignee_id: Optional[UUID] = None,
    reviewer_id: Optional[UUID] = None,
    my_tasks: bool = Query(False, description="Return all tasks where I am assignee, reviewer, or customer reviewer"),
    organization_id: Optional[UUID] = Query(None, description="Filter by organization"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> list[Task]:
    """
    List tasks with filters.
    - Admin/PM: Can see all tasks within their organizations
    - Annotators/Reviewers: Can only see their assigned tasks within their organizations
    """
    active_scene_subq = (
        select(Scene.id)
        .join(Dataset, Scene.dataset_id == Dataset.id)
        .join(Campaign, Dataset.campaign_id == Campaign.id)
        .where(
            Scene.is_deleted == False,
            Dataset.is_deleted == False,
            Campaign.is_deleted == False,
        )
    )
    query = select(Task).where(Task.is_deleted == False, Task.scene_id.in_(active_scene_subq))

    if not current_user.is_superuser:
        accessible_org_ids = await get_user_accessible_organization_ids(db, current_user.id)
        if organization_id:
            if organization_id not in accessible_org_ids:
                from app.services.rbac_service import PermissionDeniedError
                raise PermissionDeniedError("You do not have access to this organization")
            org_filter = [organization_id]
        else:
            org_filter = accessible_org_ids

        query = query.where(
            Task.scene_id.in_(
                select(Scene.id)
                .join(Dataset, Scene.dataset_id == Dataset.id)
                .join(Campaign, Dataset.campaign_id == Campaign.id)
                .where(
                    Campaign.organization_id.in_(org_filter),
                    Campaign.is_deleted == False,
                    Dataset.is_deleted == False,
                    Scene.is_deleted == False,
                )
            )
        )
    elif organization_id:
        query = query.where(
            Task.scene_id.in_(
                select(Scene.id)
                .join(Dataset, Scene.dataset_id == Dataset.id)
                .join(Campaign, Dataset.campaign_id == Campaign.id)
                .where(
                    Campaign.organization_id == organization_id,
                    Campaign.is_deleted == False,
                    Dataset.is_deleted == False,
                    Scene.is_deleted == False,
                )
            )
        )

    if not current_user.has_permission(Permission.TASKS_READ_ALL):
        query = query.where(
            or_(
                Task.assignee_id == current_user.id,
                Task.reviewer_id == current_user.id,
                Task.customer_reviewer_id == current_user.id,
            )
        )

    if my_tasks:
        query = query.where(
            or_(
                Task.assignee_id == current_user.id,
                Task.reviewer_id == current_user.id,
                Task.customer_reviewer_id == current_user.id,
            )
        )

    if scene_id:
        query = query.where(Task.scene_id == scene_id)
    if taxonomy_id:
        query = query.where(Task.taxonomy_id == taxonomy_id)
    if status:
        query = query.where(Task.status == status)
    if assignee_id:
        query = query.where(Task.assignee_id == assignee_id)
    if reviewer_id:
        query = query.where(Task.reviewer_id == reviewer_id)

    query = query.order_by(Task.priority.desc(), Task.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    from sqlalchemy.orm import selectinload as _sil
    query = query.options(_sil(Task.taxonomy))

    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/stats", response_model=list[dict])
async def get_tasks_stats(
    current_user: Annotated[User, Depends(get_current_user)],
    task_ids: str = Query(..., description="Comma-separated task IDs"),
    taxonomy_id: Optional[UUID] = Query(None, description="Filter label counts by taxonomy"),
    db: AsyncSession = Depends(get_db),
):
    """Return per-task label count, frames visited, and total frames for a list of task IDs.
    When taxonomy_id is provided, label_count and frames_visited are filtered to that taxonomy."""
    ids = [UUID(t.strip()) for t in task_ids.split(",") if t.strip()]
    if not ids:
        return []

    results: dict[str, dict] = {}
    for tid in [str(i) for i in ids]:
        results[tid] = {"task_id": tid, "label_count": 0, "frames_visited": 0, "total_frames": 0}

    for model in [Annotation, Annotation3D, Annotation2D]:
        query = (
            select(
                model.task_id,
                func.count(model.id).label("label_count"),
                func.count(distinct(model.frame_id)).label("frames_visited"),
            )
            .where(model.task_id.in_(ids))
        )
        if taxonomy_id is not None:
            query = query.where(model.taxonomy_id == taxonomy_id)
        query = query.group_by(model.task_id)
        rows = await db.execute(query)
        for row in rows.all():
            tid = str(row.task_id)
            if tid in results:
                results[tid]["label_count"] += row.label_count
                results[tid]["frames_visited"] = max(results[tid]["frames_visited"], row.frames_visited)

    if taxonomy_id is None:
        rows_fusion = await db.execute(
            select(
                AnnotationFusion.task_id,
                func.count(AnnotationFusion.id).label("label_count"),
                func.count(distinct(AnnotationFusion.frame_id)).label("frames_visited"),
            )
            .where(AnnotationFusion.task_id.in_(ids))
            .group_by(AnnotationFusion.task_id)
        )
        for row in rows_fusion.all():
            tid = str(row.task_id)
            if tid in results:
                results[tid]["label_count"] += row.label_count
                results[tid]["frames_visited"] = max(results[tid]["frames_visited"], row.frames_visited)

        rows_4d = await db.execute(
            select(Annotation4D.task_id, func.count(Annotation4D.id).label("label_count"))
            .where(Annotation4D.task_id.in_(ids))
            .group_by(Annotation4D.task_id)
        )
        for row in rows_4d.all():
            tid = str(row.task_id)
            if tid in results:
                results[tid]["label_count"] += row.label_count

    frame_rows = await db.execute(
        select(Task.id, func.count(Frame.id).label("total_frames"))
        .join(Scene, Task.scene_id == Scene.id)
        .join(Frame, Frame.scene_id == Scene.id)
        .where(Task.id.in_(ids))
        .group_by(Task.id)
    )
    for row in frame_rows.all():
        tid = str(row.id)
        if tid in results:
            results[tid]["total_frames"] = row.total_frames

    return list(results.values())


@router.get("/{task_id}", response_model=TaskResponse)
async def get_task(
    task_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> Task:
    """Get a task by ID. Users can view their assigned tasks, PM/Admin can view all."""
    query = select(Task).where(
        Task.id == task_id,
        Task.is_deleted == False,
    )
    result = await db.execute(query)
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found",
        )
    
    if not current_user.has_permission(Permission.TASKS_READ_ALL):
        if task.assignee_id != current_user.id and task.reviewer_id != current_user.id and task.customer_reviewer_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only view tasks assigned to you",
            )

    return task


@router.patch("/{task_id}", response_model=TaskResponse)
async def update_task(
    task_id: UUID,
    task_in: TaskUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_UPDATE))],
    db: AsyncSession = Depends(get_db),
) -> Task:
    """Update a task. Requires TASKS_UPDATE permission."""
    query = select(Task).where(
        Task.id == task_id,
        Task.is_deleted == False,
    )
    result = await db.execute(query)
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found",
        )
    
    update_data = task_in.model_dump(exclude_unset=True)
    
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"[Task Update] task_id={task_id}, update_data={update_data}, current_stage={task.stage}, current_revision_count={task.revision_count}")
    
    old_stage = task.stage
    new_stage = update_data.get("stage")
    stage_changing = new_stage is not None and new_stage != old_stage
    
    logger.info(f"[Task Update] old_stage={old_stage}, new_stage={new_stage}, stage_changing={stage_changing}")
    
    for field, value in update_data.items():
        if value is not None:
            if hasattr(value, "model_dump"):
                value = value.model_dump()
            setattr(task, field, value)
    
    if stage_changing:
        cleared_roles = []
        if task.assignee_id:
            cleared_roles.append(("annotator", task.assignee_id))
        if task.reviewer_id:
            cleared_roles.append(("reviewer", task.reviewer_id))
        if task.customer_reviewer_id:
            cleared_roles.append(("customer_reviewer", task.customer_reviewer_id))
        
        for role, uid in cleared_roles:
            db.add(TaskAssignmentHistory(
                task_id=task.id,
                action="stage_change_cleared",
                user_id=uid,
                role=role,
                stage=new_stage,
                changed_by_id=current_user.id,
                reason=f"Stage changed from {old_stage} to {new_stage}",
            ))
        
        db.add(TaskStageHistory(
            task_id=task.id,
            from_stage=old_stage,
            from_status=task.status,
            to_stage=new_stage,
            to_status=TaskStatus.PENDING.value,
            changed_by_id=current_user.id,
            reason=f"Manual stage change from {old_stage} to {new_stage}",
        ))
        
        task.assignee_id = None
        task.assigned_at = None
        task.reviewer_id = None
        task.reviewed_at = None
        task.customer_reviewer_id = None
        task.customer_reviewed_at = None
        task.status = TaskStatus.PENDING.value

        if new_stage == TaskStage.ANNOTATION.value:
            logger.info(f"[Task Update] Stage changing TO annotation, resetting revision_count")
            task.revision_count = 0
            task.review_notes = None
            task.customer_review_notes = None
            await db.execute(
                delete(QAReview).where(QAReview.task_id == task.id)
            )

    elif new_stage == TaskStage.ANNOTATION.value and not stage_changing:
        logger.info(f"[Task Update] Same-stage annotation patch, resetting revision_count")
        task.revision_count = 0
        task.review_notes = None
        task.customer_review_notes = None
        await db.execute(
            delete(QAReview).where(QAReview.task_id == task.id)
        )

    elif update_data.get('revision_count') == 0 and not stage_changing:
        logger.info(f"[Task Update] Explicit revision_count=0, resetting")
        task.revision_count = 0
        task.review_notes = None
        task.customer_review_notes = None
        await db.execute(
            delete(QAReview).where(QAReview.task_id == task.id)
        )
    else:
        logger.info(f"[Task Update] No revision reset path matched")
    
    await db.flush()
    await db.refresh(task)
    logger.info(f"[Task Update] After save: task.revision_count={task.revision_count}")
    return task


@router.post("/{task_id}/assign", response_model=TaskResponse)
async def assign_task(
    task_id: UUID,
    assignment: TaskAssignment,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_ASSIGN))],
    db: AsyncSession = Depends(get_db),
) -> Task:
    """Assign a task to a user. Requires TASKS_ASSIGN permission."""
    query = select(Task).where(
        Task.id == task_id,
        Task.is_deleted == False,
    )
    result = await db.execute(query)
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found",
        )
    
    if task.status not in [TaskStatus.PENDING.value, TaskStatus.ASSIGNED.value]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot assign task in status '{task.status}'",
        )
    
    task.assignee_id = assignment.assignee_id
    task.assigned_at = datetime.utcnow()
    task.status = TaskStatus.ASSIGNED.value
    
    await db.flush()
    await db.refresh(task)
    return task


@router.post("/{task_id}/status", response_model=TaskResponse)
async def update_task_status(
    task_id: UUID,
    status_update: TaskStatusUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> Task:
    """
    Update task status (state machine transitions).
    Permissions depend on the transition:
    - Start/Submit: TASKS_START, TASKS_SUBMIT (Annotators on their tasks)
    - Accept/Reject: QA_ACCEPT, QA_REJECT (QA Reviewers)
    """
    query = select(Task).where(
        Task.id == task_id,
        Task.is_deleted == False,
    )
    result = await db.execute(query)
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found",
        )
    
    new_status = status_update.status.value if hasattr(status_update.status, 'value') else status_update.status
    
    if new_status == TaskStatus.IN_PROGRESS.value:
        if task.assignee_id != current_user.id:
            require_permission(current_user, Permission.TASKS_UPDATE)
    elif new_status == TaskStatus.SUBMITTED.value:
        if task.assignee_id != current_user.id:
            require_permission(current_user, Permission.TASKS_UPDATE)
    elif new_status in [TaskStatus.ACCEPTED.value, TaskStatus.REJECTED.value]:
        require_permission(current_user, Permission.QA_REVIEW)
    
    valid_transitions = {
        TaskStatus.PENDING.value: [TaskStatus.ASSIGNED.value, TaskStatus.IN_PROGRESS.value],
        TaskStatus.ASSIGNED.value: [TaskStatus.IN_PROGRESS.value, TaskStatus.PENDING.value],
        TaskStatus.IN_PROGRESS.value: [TaskStatus.SUBMITTED.value],
        TaskStatus.SUBMITTED.value: [TaskStatus.ACCEPTED.value, TaskStatus.REJECTED.value],
        TaskStatus.REJECTED.value: [TaskStatus.IN_PROGRESS.value],
        TaskStatus.ACCEPTED.value: [],
    }
    
    if new_status not in valid_transitions.get(task.status, []):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid transition from '{task.status}' to '{new_status}'",
        )
    
    task.status = new_status
    
    if new_status == TaskStatus.IN_PROGRESS.value and not task.started_at:
        task.started_at = datetime.utcnow()
    elif new_status == TaskStatus.SUBMITTED.value:
        task.submitted_at = datetime.utcnow()
    elif new_status in [TaskStatus.ACCEPTED.value, TaskStatus.REJECTED.value]:
        task.reviewed_at = datetime.utcnow()
        task.reviewer_id = current_user.id
        if status_update.review_notes:
            task.review_notes = status_update.review_notes
    
    await db.flush()
    await db.refresh(task)
    return task


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    task_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_DELETE))],
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft delete a task. Requires TASKS_DELETE permission."""
    query = select(Task).where(
        Task.id == task_id,
        Task.is_deleted == False,
    )
    result = await db.execute(query)
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found",
        )
    
    task.is_deleted = True
    await db.flush()


@router.get("/{task_id}/frames")
async def get_task_frames(
    task_id: UUID,
    include_context: bool = True,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get all frames for a task including context buffers."""
    task_query = select(Task).where(
        Task.id == task_id,
        Task.is_deleted == False,
    )
    result = await db.execute(task_query)
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found",
        )
    
    frame_range = task.frame_range
    
    if include_context:
        start_frame = max(0, frame_range.lower - task.context_buffer_before)
        end_frame = (frame_range.upper - 1) + task.context_buffer_after
    else:
        start_frame = frame_range.lower
        end_frame = frame_range.upper - 1
    
    frame_query = (
        select(Frame)
        .where(
            Frame.scene_id == task.scene_id,
            Frame.frame_index >= start_frame,
            Frame.frame_index <= end_frame,
        )
        .order_by(Frame.frame_index)
    )
    frame_result = await db.execute(frame_query)
    frames = frame_result.scalars().all()
    
    frames_data = []
    for frame in frames:
        is_context = (
            frame.frame_index < frame_range.lower or
            frame.frame_index >= frame_range.upper
        )
        frames_data.append({
            "id": frame.id,
            "frame_index": frame.frame_index,
            "timestamp": frame.timestamp,
            "ego_pose": frame.ego_pose,
            "file_paths": frame.file_paths,
            "is_context": is_context,
            "is_readonly": is_context,
        })
    
    return {
        "task_id": task_id,
        "frame_range": {
            "start": frame_range.lower,
            "end": frame_range.upper - 1,
        },
        "context_buffer": {
            "before": task.context_buffer_before,
            "after": task.context_buffer_after,
        },
        "frames": frames_data,
    }



class SubTaskRequest(PydanticBaseModel):
    name: str
    frame_start: int
    frame_end: int


class SplitTaskRequest(PydanticBaseModel):
    sub_tasks: list[SubTaskRequest]


@router.post("/{task_id}/split", response_model=list[TaskResponse])
async def split_task(
    task_id: UUID,
    body: SplitTaskRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_CREATE))],
    db: AsyncSession = Depends(get_db),
) -> list[Task]:
    """Split a task into sub-tasks by frame range.

    Annotations are redistributed to the sub-task whose frame range covers
    them. The original task is deleted after redistribution.
    """
    result = await db.execute(
        select(Task).where(Task.id == task_id, Task.is_deleted == False)
    )
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found")

    if len(body.sub_tasks) < 2:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide at least 2 sub-tasks to split into")

    frames_result = await db.execute(
        select(Frame.id, Frame.frame_index).where(Frame.scene_id == task.scene_id)
    )
    frame_index_map: dict = {row.id: row.frame_index for row in frames_result.all()}

    new_tasks: list[Task] = []
    for sub in body.sub_tasks:
        new_task = Task(
            scene_id=task.scene_id,
            taxonomy_id=task.taxonomy_id,
            name=sub.name,
            status=TaskStatus.PENDING.value,
            stage=TaskStage.ANNOTATION.value,
            frame_range=frame_range_to_postgres(sub.frame_start, sub.frame_end),
            context_buffer_before=task.context_buffer_before,
            context_buffer_after=task.context_buffer_after,
            priority=task.priority,
            deadline=task.deadline,
            config=task.config,
        )
        db.add(new_task)
        new_tasks.append(new_task)

    await db.flush()

    ANNOTATION_MODELS = [Annotation, Annotation3D, Annotation2D, AnnotationFusion, Annotation4D]
    for model in ANNOTATION_MODELS:
        ann_result = await db.execute(
            select(model).where(model.task_id == task_id)
        )
        for ann in ann_result.scalars().all():
            frame_idx = frame_index_map.get(ann.frame_id)
            if frame_idx is None:
                continue
            for new_task, sub in zip(new_tasks, body.sub_tasks):
                if sub.frame_start <= frame_idx <= sub.frame_end:
                    ann.task_id = new_task.id
                    break

    await db.flush()

    task.is_deleted = True
    await db.flush()

    from sqlalchemy.orm import selectinload as _sil
    for new_task in new_tasks:
        await db.refresh(new_task)

    return new_tasks

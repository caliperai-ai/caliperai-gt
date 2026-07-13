"""
Task Workflow Service - Stage and Status State Machine.

Handles all task stage/status transitions with validation.

IMPORTANT: On every stage change, ALL assignees are cleared.
The project manager must find and assign a new person for each stage.

Workflow:
    ANNOTATION STAGE:
        pending → assigned → in_progress → submitted
        (submitted triggers auto-transition to QA)
    
    QA STAGE:
        pending → assigned → in_progress → accepted/rejected
        - accepted: moves to CUSTOMER_QA/pending (or ACCEPTED if skip_customer_qa=True)
        - rejected: moves back to ANNOTATION/pending (assignee cleared)
    
    CUSTOMER_QA STAGE:
        pending → assigned → in_progress → accepted/rejected
        - accepted: moves to ACCEPTED stage
        - rejected: moves back to ANNOTATION/pending (assignee cleared)
    
    ACCEPTED STAGE:
        accepted (final state)
"""
import uuid
from datetime import datetime
from typing import Optional, Tuple, List, Dict, Any
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.models.models import (
    Task,
    TaskStage,
    TaskStatus,
    TaskStageHistory,
    TaskAssignmentHistory,
    QAReview,
    QAReviewStatus,
    AnnotationReview,
    ReviewVerdict,
)

try:
    from app.services.dataops_service import DataOpsService
    DATAOPS_AVAILABLE = True
except ImportError:
    DATAOPS_AVAILABLE = False


class WorkflowError(Exception):
    """Raised when a workflow transition is invalid."""
    pass


STAGE_VALID_STATUSES: Dict[str, List[str]] = {
    TaskStage.ANNOTATION.value: [
        TaskStatus.PENDING.value,
        TaskStatus.ASSIGNED.value,
        TaskStatus.IN_PROGRESS.value,
        TaskStatus.SUBMITTED.value,
    ],
    TaskStage.QA.value: [
        TaskStatus.PENDING.value,
        TaskStatus.ASSIGNED.value,
        TaskStatus.IN_PROGRESS.value,
        TaskStatus.ACCEPTED.value,
        TaskStatus.REJECTED.value,
    ],
    TaskStage.CUSTOMER_QA.value: [
        TaskStatus.PENDING.value,
        TaskStatus.ASSIGNED.value,
        TaskStatus.IN_PROGRESS.value,
        TaskStatus.ACCEPTED.value,
        TaskStatus.REJECTED.value,
    ],
    TaskStage.ACCEPTED.value: [
        TaskStatus.ACCEPTED.value,
    ],
}

STATUS_TRANSITIONS: Dict[str, List[str]] = {
    TaskStatus.PENDING.value: [
        TaskStatus.ASSIGNED.value,
        TaskStatus.IN_PROGRESS.value,
        TaskStatus.ACCEPTED.value,
        TaskStatus.REJECTED.value,
    ],
    TaskStatus.ASSIGNED.value: [
        TaskStatus.IN_PROGRESS.value,
        TaskStatus.PENDING.value,
        TaskStatus.ACCEPTED.value,
        TaskStatus.REJECTED.value,
    ],
    TaskStatus.IN_PROGRESS.value: [
        TaskStatus.SUBMITTED.value,
        TaskStatus.ACCEPTED.value,
        TaskStatus.REJECTED.value,
        TaskStatus.PENDING.value,
    ],
    TaskStatus.SUBMITTED.value: [],
    TaskStatus.ACCEPTED.value: [],
    TaskStatus.REJECTED.value: [],
}

AUTO_TRANSITIONS: Dict[Tuple[str, str], Tuple[str, str]] = {
    (TaskStage.ANNOTATION.value, TaskStatus.SUBMITTED.value): 
        (TaskStage.QA.value, TaskStatus.PENDING.value),
    
    (TaskStage.QA.value, TaskStatus.ACCEPTED.value): 
        (TaskStage.CUSTOMER_QA.value, TaskStatus.PENDING.value),
    
    (TaskStage.QA.value, TaskStatus.REJECTED.value): 
        (TaskStage.ANNOTATION.value, TaskStatus.PENDING.value),
    
    (TaskStage.CUSTOMER_QA.value, TaskStatus.REJECTED.value): 
        (TaskStage.ANNOTATION.value, TaskStatus.PENDING.value),
    
    (TaskStage.CUSTOMER_QA.value, TaskStatus.ACCEPTED.value): 
        (TaskStage.ACCEPTED.value, TaskStatus.ACCEPTED.value),
}


class WorkflowService:
    """Manages task workflow transitions."""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def transition_status(
        self,
        task: Task,
        new_status: str,
        changed_by_id: Optional[uuid.UUID] = None,
        reason: Optional[str] = None,
    ) -> Task:
        """
        Transition a task to a new status within its current stage.
        May trigger auto-transitions to new stages.
        
        Args:
            task: The task to transition
            new_status: The target status
            changed_by_id: User making the change
            reason: Reason for the transition (especially for rejections)
            
        Returns:
            The updated task
            
        Raises:
            WorkflowError: If the transition is invalid
        """
        current_stage = task.stage
        current_status = task.status
        
        self._validate_status_transition(current_stage, current_status, new_status)
        
        await self._record_history(
            task=task,
            from_stage=current_stage,
            from_status=current_status,
            to_stage=current_stage,
            to_status=new_status,
            changed_by_id=changed_by_id,
            reason=reason,
        )
        
        task.status = new_status
        self._update_timestamps(task, new_status)
        
        auto_key = (current_stage, new_status)
        if auto_key in AUTO_TRANSITIONS:
            new_stage, new_stage_status = AUTO_TRANSITIONS[auto_key]
            
            if current_stage == TaskStage.QA.value and new_status == TaskStatus.ACCEPTED.value:
                if task.skip_customer_qa:
                    new_stage = TaskStage.ACCEPTED.value
                    new_stage_status = TaskStatus.ACCEPTED.value
                else:
                    new_stage = TaskStage.CUSTOMER_QA.value
                    new_stage_status = TaskStatus.PENDING.value
                
                await self._create_stage_snapshot(
                    task=task,
                    from_stage=current_stage,
                    to_stage=new_stage,
                    from_status=new_status,
                    to_status=new_stage_status,
                    triggered_by_id=changed_by_id,
                    notes="Auto-transition: QA accepted",
                )
                    
                await self._record_history(
                    task=task,
                    from_stage=current_stage,
                    from_status=new_status,
                    to_stage=new_stage,
                    to_status=new_stage_status,
                    changed_by_id=changed_by_id,
                    reason="Auto-transition: QA accepted",
                )
                task.stage = new_stage
                task.status = new_stage_status
                
                await self._clear_assignees_on_stage_change(
                    task=task,
                    old_stage=current_stage,
                    new_stage=new_stage,
                    changed_by_id=changed_by_id,
                )
            else:
                if new_status == TaskStatus.REJECTED.value:
                    task.revision_count += 1
                
                await self._create_stage_snapshot(
                    task=task,
                    from_stage=current_stage,
                    to_stage=new_stage,
                    from_status=new_status,
                    to_status=new_stage_status,
                    triggered_by_id=changed_by_id,
                    notes=reason or f"Auto-transition from {current_stage}/{new_status}",
                )
                
                await self._record_history(
                    task=task,
                    from_stage=current_stage,
                    from_status=new_status,
                    to_stage=new_stage,
                    to_status=new_stage_status,
                    changed_by_id=changed_by_id,
                    reason=reason or f"Auto-transition from {current_stage}/{new_status}",
                )
                task.stage = new_stage
                task.status = new_stage_status
                
                await self._clear_assignees_on_stage_change(
                    task=task,
                    old_stage=current_stage,
                    new_stage=new_stage,
                    changed_by_id=changed_by_id,
                )
        
        await self.db.flush()
        await self.db.refresh(task)
        
        return task
    
    async def assign_task(
        self,
        task: Task,
        assignee_id: uuid.UUID,
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> Task:
        """Assign a task to a user and transition to assigned status."""
        if task.status not in [TaskStatus.PENDING.value, TaskStatus.ASSIGNED.value]:
            raise WorkflowError(
                f"Cannot assign task in status '{task.status}'. "
                f"Task must be in 'pending' or 'assigned' status."
            )
        
        task.assignee_id = assignee_id
        task.assigned_at = datetime.utcnow()
        
        await self._record_assignment_change(
            task=task, action="assigned", user_id=assignee_id,
            role="annotator", changed_by_id=changed_by_id,
            reason=f"Assigned to user {assignee_id}",
        )
        
        return await self.transition_status(
            task=task,
            new_status=TaskStatus.ASSIGNED.value,
            changed_by_id=changed_by_id,
            reason=f"Assigned to user {assignee_id}",
        )
    
    async def assign_reviewer(
        self,
        task: Task,
        reviewer_id: uuid.UUID,
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> Task:
        """Assign a QA reviewer to a task."""
        if task.stage != TaskStage.QA.value:
            raise WorkflowError(
                f"Cannot assign QA reviewer in stage '{task.stage}'. "
                f"Task must be in 'qa' stage."
            )
        
        task.reviewer_id = reviewer_id
        
        await self._record_assignment_change(
            task=task, action="assigned", user_id=reviewer_id,
            role="reviewer", changed_by_id=changed_by_id,
            reason=f"QA Reviewer assigned: {reviewer_id}",
        )
        
        if task.status == TaskStatus.PENDING.value:
            return await self.transition_status(
                task=task,
                new_status=TaskStatus.ASSIGNED.value,
                changed_by_id=changed_by_id,
                reason=f"QA Reviewer assigned: {reviewer_id}",
            )
        
        await self.db.flush()
        await self.db.refresh(task)
        return task
    
    async def assign_customer_reviewer(
        self,
        task: Task,
        customer_reviewer_id: uuid.UUID,
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> Task:
        """Assign a Customer QA reviewer to a task."""
        if task.stage != TaskStage.CUSTOMER_QA.value:
            raise WorkflowError(
                f"Cannot assign customer reviewer in stage '{task.stage}'. "
                f"Task must be in 'customer_qa' stage."
            )
        
        task.customer_reviewer_id = customer_reviewer_id
        
        await self._record_assignment_change(
            task=task, action="assigned", user_id=customer_reviewer_id,
            role="customer_reviewer", changed_by_id=changed_by_id,
            reason=f"Customer Reviewer assigned: {customer_reviewer_id}",
        )
        
        await self.db.flush()
        await self.db.refresh(task)
        return task
    
    async def start_work(
        self,
        task: Task,
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> Task:
        """Start working on a task - transition to in_progress."""
        if task.status not in [TaskStatus.PENDING.value, TaskStatus.ASSIGNED.value]:
            raise WorkflowError(
                f"Cannot start work on task in status '{task.status}'. "
                f"Task must be in 'pending' or 'assigned' status."
            )
        
        task.started_at = datetime.utcnow()
        
        return await self.transition_status(
            task=task,
            new_status=TaskStatus.IN_PROGRESS.value,
            changed_by_id=changed_by_id,
            reason="Started working",
        )
    
    async def submit_annotation(
        self,
        task: Task,
        changed_by_id: Optional[uuid.UUID] = None,
        is_admin: bool = False,
    ) -> Task:
        """Submit annotation work for QA review.
        
        Admins can submit from 'assigned' status (will auto-transition through in_progress).
        """
        if task.stage != TaskStage.ANNOTATION.value:
            raise WorkflowError(
                f"Cannot submit from stage '{task.stage}'. "
                f"Task must be in 'annotation' stage."
            )
        
        if task.status == TaskStatus.ASSIGNED.value and is_admin:
            task = await self.start_work(task=task, changed_by_id=changed_by_id)
        
        if task.status != TaskStatus.IN_PROGRESS.value:
            raise WorkflowError(
                f"Cannot submit task in status '{task.status}'. "
                f"Task must be in 'in_progress' status."
            )
        
        task.submitted_at = datetime.utcnow()
        
        return await self.transition_status(
            task=task,
            new_status=TaskStatus.SUBMITTED.value,
            changed_by_id=changed_by_id,
            reason="Submitted for QA review",
        )
    
    async def submit_fixes(
        self,
        task: Task,
        changed_by_id: Optional[uuid.UUID] = None,
        is_admin: bool = False,
    ) -> Task:
        """Submit fixed annotations for QA re-review.
        
        This is used when an annotator has fixed issues identified during QA review.
        Only allowed for tasks that are in revision mode (revision_count > 0).
        Records the submission timestamp so QA can identify modified annotations.
        """
        if task.stage != TaskStage.ANNOTATION.value:
            raise WorkflowError(
                f"Cannot submit fixes from stage '{task.stage}'. "
                f"Task must be in 'annotation' stage."
            )
        
        if task.revision_count < 1:
            raise WorkflowError(
                "Cannot submit fixes for a task that hasn't been through QA review yet. "
                "Use regular submit instead."
            )
        
        if task.status in [TaskStatus.PENDING.value, TaskStatus.ASSIGNED.value]:
            task = await self.start_work(task=task, changed_by_id=changed_by_id)
        
        if task.status != TaskStatus.IN_PROGRESS.value:
            raise WorkflowError(
                f"Cannot submit fixes in status '{task.status}'. "
                f"Task must be in 'in_progress' status."
            )
        
        task.submitted_at = datetime.utcnow()
        
        return await self.transition_status(
            task=task,
            new_status=TaskStatus.SUBMITTED.value,
            changed_by_id=changed_by_id,
            reason=f"Fixes submitted for QA re-review (revision #{task.revision_count})",
        )
    
    async def complete_qa_review(
        self,
        task: Task,
        accepted: bool = True,
        changed_by_id: Optional[uuid.UUID] = None,
        reason: Optional[str] = None,
    ) -> Task:
        """Complete QA review - accept moves to customer_qa, reject sends back to annotator.
        Also completes any active QA review sessions for this task."""
        if task.stage != TaskStage.QA.value:
            raise WorkflowError(
                f"Cannot complete QA review in stage '{task.stage}'. "
                f"Task must be in 'qa' stage."
            )
        
        if task.status not in [TaskStatus.IN_PROGRESS.value, TaskStatus.ASSIGNED.value, TaskStatus.PENDING.value]:
            raise WorkflowError(
                f"Cannot complete QA review in status '{task.status}'. "
                f"Task must be in 'pending', 'assigned', or 'in_progress' status."
            )
        
        await self._complete_qa_review_sessions(task.id, reason)
        
        task.reviewed_at = datetime.utcnow()
        task.review_notes = reason
        
        if accepted:
            return await self.transition_status(
                task=task,
                new_status=TaskStatus.ACCEPTED.value,
                changed_by_id=changed_by_id,
                reason=reason or "QA Review completed",
            )
        else:
            
            return await self.transition_status(
                task=task,
                new_status=TaskStatus.REJECTED.value,
                changed_by_id=changed_by_id,
                reason=reason or "QA rejected - sent back to annotator",
            )
    
    async def complete_customer_review(
        self,
        task: Task,
        accepted: bool = True,
        changed_by_id: Optional[uuid.UUID] = None,
        reason: Optional[str] = None,
    ) -> Task:
        """Complete Customer QA review - accept moves to accepted, reject sends back to annotation with empty assignee."""
        if task.stage != TaskStage.CUSTOMER_QA.value:
            raise WorkflowError(
                f"Cannot complete customer review in stage '{task.stage}'. "
                f"Task must be in 'customer_qa' stage."
            )
        
        if task.status not in [TaskStatus.IN_PROGRESS.value, TaskStatus.ASSIGNED.value, TaskStatus.PENDING.value]:
            raise WorkflowError(
                f"Cannot complete customer review in status '{task.status}'. "
                f"Task must be in 'pending', 'assigned', or 'in_progress' status."
            )
        
        task.customer_reviewed_at = datetime.utcnow()
        task.customer_review_notes = reason
        
        await self._complete_qa_review_sessions(task.id, reason)
        
        if accepted:
            return await self.transition_status(
                task=task,
                new_status=TaskStatus.ACCEPTED.value,
                changed_by_id=changed_by_id,
                reason=reason or "Customer QA Review completed",
            )
        else:
            return await self.transition_status(
                task=task,
                new_status=TaskStatus.REJECTED.value,
                changed_by_id=changed_by_id,
                reason=reason or "Customer QA rejected - sent back for rework",
            )
    
    async def get_task_history(self, task_id: uuid.UUID) -> List[TaskStageHistory]:
        """Get the stage/status history for a task."""
        result = await self.db.execute(
            select(TaskStageHistory)
            .where(TaskStageHistory.task_id == task_id)
            .order_by(TaskStageHistory.created_at.desc())
        )
        return list(result.scalars().all())
    
    async def _complete_qa_review_sessions(self, task_id: uuid.UUID, reason: Optional[str] = None) -> None:
        """Auto-complete any active (in_progress/paused) QA review sessions for a task.
        
        This ensures that when a task is accepted or rejected through the workflow,
        the QA review session data is also marked as completed so annotators can
        see the review results on revision.
        """
        result = await self.db.execute(
            select(QAReview).where(
                QAReview.task_id == task_id,
                QAReview.status.in_([
                    QAReviewStatus.IN_PROGRESS.value,
                    QAReviewStatus.PAUSED.value,
                ]),
            )
        )
        active_reviews = result.scalars().all()
        
        for review in active_reviews:
            ann_result = await self.db.execute(
                select(AnnotationReview).where(AnnotationReview.qa_review_id == review.id)
            )
            annotation_reviews = ann_result.scalars().all()
            
            approved_count = sum(1 for ar in annotation_reviews if ar.verdict == ReviewVerdict.APPROVED.value)
            rejected_count = sum(1 for ar in annotation_reviews if ar.verdict == ReviewVerdict.REJECTED.value)
            flagged_count = sum(1 for ar in annotation_reviews if ar.verdict == ReviewVerdict.FLAGGED.value)
            pending_count = sum(1 for ar in annotation_reviews if ar.verdict is None or ar.verdict == ReviewVerdict.PENDING.value)
            
            review.status = QAReviewStatus.COMPLETED.value
            review.completed_at = datetime.utcnow()
            review.summary = {
                "approved": approved_count,
                "rejected": rejected_count,
                "flagged": flagged_count,
                "pending": pending_count,
                "total_annotations": len(annotation_reviews),
                "completion_reason": reason or "Auto-completed via workflow transition",
            }

    async def get_assignment_history(self, task_id: uuid.UUID) -> List[TaskAssignmentHistory]:
        """Get the assignment history for a task."""
        result = await self.db.execute(
            select(TaskAssignmentHistory)
            .where(TaskAssignmentHistory.task_id == task_id)
            .order_by(TaskAssignmentHistory.created_at.desc())
        )
        return list(result.scalars().all())
    
    def get_available_transitions(self, task: Task) -> List[str]:
        """Get available status transitions for the current task state."""
        current_stage = task.stage
        current_status = task.status
        
        possible = STATUS_TRANSITIONS.get(current_status, [])
        
        valid_for_stage = STAGE_VALID_STATUSES.get(current_stage, [])
        
        available = [s for s in possible if s in valid_for_stage]
        
        if current_stage == TaskStage.ANNOTATION.value:
            if current_status != TaskStatus.IN_PROGRESS.value:
                available = [s for s in available if s != TaskStatus.SUBMITTED.value]
        
        if current_stage in [TaskStage.QA.value, TaskStage.CUSTOMER_QA.value]:
            if current_status != TaskStatus.IN_PROGRESS.value:
                available = [s for s in available 
                            if s not in [TaskStatus.ACCEPTED.value, TaskStatus.REJECTED.value]]
        
        return available
    
    def _validate_status_transition(
        self,
        current_stage: str,
        current_status: str,
        new_status: str,
    ) -> None:
        """Validate that a status transition is allowed."""
        valid_statuses = STAGE_VALID_STATUSES.get(current_stage, [])
        if new_status not in valid_statuses:
            raise WorkflowError(
                f"Status '{new_status}' is not valid for stage '{current_stage}'. "
                f"Valid statuses: {valid_statuses}"
            )
        
        allowed_transitions = STATUS_TRANSITIONS.get(current_status, [])
        if new_status not in allowed_transitions and new_status != current_status:
            raise WorkflowError(
                f"Cannot transition from '{current_status}' to '{new_status}'. "
                f"Allowed transitions: {allowed_transitions}"
            )
    
    async def _record_history(
        self,
        task: Task,
        from_stage: str,
        from_status: str,
        to_stage: str,
        to_status: str,
        changed_by_id: Optional[uuid.UUID],
        reason: Optional[str],
    ) -> TaskStageHistory:
        """Record a stage/status change in history."""
        history = TaskStageHistory(
            task_id=task.id,
            from_stage=from_stage,
            from_status=from_status,
            to_stage=to_stage,
            to_status=to_status,
            changed_by_id=changed_by_id,
            reason=reason,
        )
        self.db.add(history)
        return history

    async def _record_assignment_change(
        self,
        task: Task,
        action: str,
        user_id: Optional[uuid.UUID],
        role: str,
        changed_by_id: Optional[uuid.UUID],
        reason: Optional[str] = None,
    ) -> TaskAssignmentHistory:
        """Record an assignment change in history."""
        record = TaskAssignmentHistory(
            task_id=task.id,
            action=action,
            user_id=user_id,
            role=role,
            stage=task.stage,
            changed_by_id=changed_by_id,
            reason=reason,
        )
        self.db.add(record)
        return record
    
    async def _create_stage_snapshot(
        self,
        task: Task,
        from_stage: str,
        to_stage: str,
        from_status: str,
        to_status: str,
        triggered_by_id: Optional[uuid.UUID],
        notes: Optional[str],
    ) -> None:
        """Create a snapshot of annotations when transitioning stages."""
        if not DATAOPS_AVAILABLE:
            return
        
        try:
            dataops = DataOpsService(self.db)
            await dataops.create_stage_snapshot(
                task=task,
                from_stage=from_stage,
                to_stage=to_stage,
                from_status=from_status,
                to_status=to_status,
                triggered_by_id=triggered_by_id,
                notes=notes,
            )
        except Exception as e:
            import logging
            logging.error(f"Failed to create stage snapshot: {e}")
    
    async def _clear_assignees_on_stage_change(
        self,
        task: Task,
        old_stage: str,
        new_stage: str,
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> None:
        """
        Clear assignees when transitioning to a new stage.

        IMPORTANT: The original annotator (assignee_id) is preserved through
        annotation <-> QA transitions so that:
        - Annotators can see their submitted tasks in their "My Tasks" page
          while the task is awaiting QA review (annotation -> QA).
        - When QA rejects, the task automatically returns to the original
          annotator without requiring PM to explicitly re-assign (QA -> annotation).

        For all other stage changes (e.g. QA -> customer_qa, customer_qa ->
        annotation on customer rejection), all assignees are cleared and the
        PM must reassign.
        """
        preserve_annotator = (
            (old_stage == TaskStage.ANNOTATION.value and new_stage == TaskStage.QA.value) or
            (old_stage == TaskStage.QA.value and new_stage == TaskStage.ANNOTATION.value)
        )

        cleared = []

        if not preserve_annotator and task.assignee_id:
            cleared.append(("annotator", task.assignee_id))
            task.assignee_id = None
            task.assigned_at = None

        if task.reviewer_id:
            cleared.append(("reviewer", task.reviewer_id))
            task.reviewer_id = None

        if task.customer_reviewer_id:
            cleared.append(("customer_reviewer", task.customer_reviewer_id))
            task.customer_reviewer_id = None

        for role, uid in cleared:
            await self._record_assignment_change(
                task=task,
                action="stage_change_cleared",
                user_id=uid,
                role=role,
                changed_by_id=changed_by_id,
                reason=f"Assignee cleared: stage changed from {old_stage} to {new_stage}",
            )

    def _update_timestamps(self, task: Task, new_status: str) -> None:
        """Update relevant timestamps based on status change."""
        now = datetime.utcnow()
        
        if new_status == TaskStatus.IN_PROGRESS.value and not task.started_at:
            task.started_at = now
        elif new_status == TaskStatus.SUBMITTED.value:
            task.submitted_at = now
        elif new_status == TaskStatus.ACCEPTED.value:
            if task.stage == TaskStage.QA.value:
                task.reviewed_at = now
            elif task.stage == TaskStage.CUSTOMER_QA.value:
                task.customer_reviewed_at = now
        elif new_status == TaskStatus.REJECTED.value:
            if task.stage == TaskStage.QA.value:
                task.reviewed_at = now
            elif task.stage == TaskStage.CUSTOMER_QA.value:
                task.customer_reviewed_at = now


    async def unassign_task(
        self,
        task: Task,
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> Task:
        """
        Unassign a task (remove annotator) and transition back to pending.
        Works for tasks in 'assigned' or 'in_progress' status.
        If already pending, just clears assignee and returns (idempotent).
        """
        if task.stage != TaskStage.ANNOTATION.value:
            raise WorkflowError(
                f"Cannot unassign task in stage '{task.stage}'. "
                f"Task must be in 'annotation' stage."
            )
        
        if task.status == TaskStatus.PENDING.value:
            task.assignee_id = None
            task.assigned_at = None
            await self.db.flush()
            await self.db.refresh(task)
            return task
        
        if task.status not in [TaskStatus.ASSIGNED.value, TaskStatus.IN_PROGRESS.value]:
            raise WorkflowError(
                f"Cannot unassign task in status '{task.status}'. "
                f"Task must be in 'assigned', 'in_progress', or 'pending' status."
            )
        
        old_assignee_id = task.assignee_id
        task.assignee_id = None
        task.assigned_at = None
        
        await self._record_assignment_change(
            task=task, action="unassigned", user_id=old_assignee_id,
            role="annotator", changed_by_id=changed_by_id,
            reason=f"Unassigned from user {old_assignee_id}",
        )
        
        return await self.transition_status(
            task=task,
            new_status=TaskStatus.PENDING.value,
            changed_by_id=changed_by_id,
            reason=f"Unassigned from user {old_assignee_id}",
        )

    async def unassign_reviewer(
        self,
        task: Task,
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> Task:
        """
        Unassign QA reviewer and transition back to pending.
        Works if task is in QA stage and 'assigned' or 'in_progress' status.
        If already pending, just clears reviewer and returns (idempotent).
        """
        if task.stage != TaskStage.QA.value:
            raise WorkflowError(
                f"Cannot unassign reviewer in stage '{task.stage}'. "
                f"Task must be in 'qa' stage."
            )
        
        if task.status == TaskStatus.PENDING.value:
            task.reviewer_id = None
            await self.db.flush()
            await self.db.refresh(task)
            return task
        
        if task.status not in [TaskStatus.ASSIGNED.value, TaskStatus.IN_PROGRESS.value]:
            raise WorkflowError(
                f"Cannot unassign reviewer in status '{task.status}'. "
                f"Task must be in 'assigned', 'in_progress', or 'pending' status."
            )
        
        old_reviewer_id = task.reviewer_id
        task.reviewer_id = None
        
        await self._record_assignment_change(
            task=task, action="unassigned", user_id=old_reviewer_id,
            role="reviewer", changed_by_id=changed_by_id,
            reason=f"QA Reviewer unassigned: {old_reviewer_id}",
        )
        
        return await self.transition_status(
            task=task,
            new_status=TaskStatus.PENDING.value,
            changed_by_id=changed_by_id,
            reason=f"QA Reviewer unassigned: {old_reviewer_id}",
        )

    async def unassign_customer_reviewer(
        self,
        task: Task,
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> Task:
        """
        Unassign Customer QA reviewer and transition back to pending.
        Works if task is in customer_qa stage and 'assigned' or 'in_progress' status.
        If already pending, just clears customer reviewer and returns (idempotent).
        """
        if task.stage != TaskStage.CUSTOMER_QA.value:
            raise WorkflowError(
                f"Cannot unassign customer reviewer in stage '{task.stage}'. "
                f"Task must be in 'customer_qa' stage."
            )
        
        if task.status == TaskStatus.PENDING.value:
            task.customer_reviewer_id = None
            await self.db.flush()
            await self.db.refresh(task)
            return task
        
        if task.status not in [TaskStatus.ASSIGNED.value, TaskStatus.IN_PROGRESS.value]:
            raise WorkflowError(
                f"Cannot unassign customer reviewer in status '{task.status}'. "
                f"Task must be in 'assigned', 'in_progress', or 'pending' status."
            )
        
        old_customer_reviewer_id = task.customer_reviewer_id
        task.customer_reviewer_id = None
        
        await self._record_assignment_change(
            task=task, action="unassigned", user_id=old_customer_reviewer_id,
            role="customer_reviewer", changed_by_id=changed_by_id,
            reason=f"Customer Reviewer unassigned: {old_customer_reviewer_id}",
        )
        
        return await self.transition_status(
            task=task,
            new_status=TaskStatus.PENDING.value,
            changed_by_id=changed_by_id,
            reason=f"Customer Reviewer unassigned: {old_customer_reviewer_id}",
        )


    async def on_editor_open(
        self,
        task: Task,
        user_id: uuid.UUID,
        is_admin: bool = False,
    ) -> Task:
        """
        Handle auto-transitions when a user opens a task in the editor.
        
        - If task is in 'assigned' status and user is the assignee (or admin): transition to 'in_progress'
        - If task is in QA/CustomerQA stage and 'assigned'/'pending': transition to 'in_progress'
        
        Admins can trigger transitions regardless of assignment.
        """
        if task.stage == TaskStage.ANNOTATION.value:
            if task.status == TaskStatus.ASSIGNED.value:
                if is_admin or task.assignee_id == user_id:
                    return await self.start_work(task=task, changed_by_id=user_id)
        
        elif task.stage == TaskStage.QA.value:
            if task.status in [TaskStatus.PENDING.value, TaskStatus.ASSIGNED.value]:
                if is_admin or task.reviewer_id == user_id or task.reviewer_id is None:
                    if task.reviewer_id is None:
                        task.reviewer_id = user_id
                    return await self.transition_status(
                        task=task,
                        new_status=TaskStatus.IN_PROGRESS.value,
                        changed_by_id=user_id,
                        reason="QA Review started (editor opened)",
                    )
        
        elif task.stage == TaskStage.CUSTOMER_QA.value:
            if task.status in [TaskStatus.PENDING.value, TaskStatus.ASSIGNED.value, TaskStatus.IN_PROGRESS.value]:
                if task.status != TaskStatus.IN_PROGRESS.value and (is_admin or task.customer_reviewer_id == user_id or task.customer_reviewer_id is None):
                    if task.customer_reviewer_id is None:
                        task.customer_reviewer_id = user_id
                    return await self.transition_status(
                        task=task,
                        new_status=TaskStatus.IN_PROGRESS.value,
                        changed_by_id=user_id,
                        reason="Customer QA Review started (editor opened)",
                    )
                if task.customer_reviewer_id is None:
                    task.customer_reviewer_id = user_id
                    await self.db.flush()
                    await self.db.refresh(task)
        
        return task


    async def on_annotation_created(
        self,
        task: Task,
        user_id: uuid.UUID,
        taxonomy_id: Optional[uuid.UUID] = None,
    ) -> Task:
        """Auto-transition from pending/assigned to in_progress when first annotation is created."""
        if task.stage == TaskStage.ANNOTATION.value:
            if task.status in [TaskStatus.PENDING.value, TaskStatus.ASSIGNED.value]:
                if task.assignee_id is None:
                    task.assignee_id = user_id
                    task.assigned_at = datetime.utcnow()
                
                return await self.start_work(task=task, changed_by_id=user_id)
        
        return task

    async def on_all_annotations_deleted(
        self,
        task: Task,
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> Task:
        """
        Handle case when all annotations are deleted from a task.
        Transitions from in_progress back to assigned (if assignee exists) or pending.
        """
        if task.stage == TaskStage.ANNOTATION.value:
            if task.status == TaskStatus.IN_PROGRESS.value:
                new_status = TaskStatus.ASSIGNED.value if task.assignee_id else TaskStatus.PENDING.value
                return await self.transition_status(
                    task=task,
                    new_status=new_status,
                    changed_by_id=changed_by_id,
                    reason="All annotations deleted - reverting to previous status",
                )
        
        return task


    async def bulk_assign_tasks(
        self,
        tasks: List[Task],
        assignee_id: uuid.UUID,
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> List[Task]:
        """
        Bulk assign multiple tasks to a user.
        Each task transitions from pending to assigned.
        """
        results = []
        for task in tasks:
            try:
                task = await self.assign_task(
                    task=task,
                    assignee_id=assignee_id,
                    changed_by_id=changed_by_id,
                )
                results.append(task)
            except WorkflowError:
                results.append(task)
        return results

    async def bulk_submit_tasks(
        self,
        tasks: List[Task],
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> List[Task]:
        """
        Bulk submit multiple tasks for QA review.
        Each task transitions from in_progress to submitted.
        """
        results = []
        for task in tasks:
            try:
                task = await self.submit_annotation(
                    task=task,
                    changed_by_id=changed_by_id,
                )
                results.append(task)
            except WorkflowError:
                results.append(task)
        return results

    async def bulk_assign_reviewers(
        self,
        tasks: List[Task],
        reviewer_id: uuid.UUID,
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> List[Task]:
        """
        Bulk assign QA reviewer to multiple tasks.
        """
        results = []
        for task in tasks:
            try:
                task = await self.assign_reviewer(
                    task=task,
                    reviewer_id=reviewer_id,
                    changed_by_id=changed_by_id,
                )
                results.append(task)
            except WorkflowError:
                results.append(task)
        return results


    async def initialize_task_with_assignee(
        self,
        task: Task,
        assignee_id: uuid.UUID,
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> Task:
        """
        Initialize a newly created task with an assignee.
        Sets task to 'assigned' status instead of 'pending'.
        """
        task.assignee_id = assignee_id
        task.assigned_at = datetime.utcnow()
        task.status = TaskStatus.ASSIGNED.value
        
        await self._record_history(
            task=task,
            from_stage=TaskStage.ANNOTATION.value,
            from_status=TaskStatus.PENDING.value,
            to_stage=TaskStage.ANNOTATION.value,
            to_status=TaskStatus.ASSIGNED.value,
            changed_by_id=changed_by_id,
            reason=f"Task created with assignee {assignee_id}",
        )
        
        await self.db.flush()
        await self.db.refresh(task)
        return task


    async def reassign_on_rejection(
        self,
        task: Task,
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> Task:
        """
        After rejection (QA or Customer QA), auto-reassign to original annotator.
        This is called after the standard rejection transition.
        """
        if task.stage != TaskStage.ANNOTATION.value:
            return task
        
        if task.status != TaskStatus.PENDING.value:
            return task
        
        if task.assignee_id:
            return await self.transition_status(
                task=task,
                new_status=TaskStatus.ASSIGNED.value,
                changed_by_id=changed_by_id,
                reason="Auto-reassigned to original annotator after rejection",
            )
        
        return task


    async def skip_qa_stage(
        self,
        task: Task,
        changed_by_id: Optional[uuid.UUID] = None,
    ) -> Task:
        """
        Skip QA stage and move directly to Customer QA (or Accepted if skip_customer_qa).
        Used when annotation is submitted and QA should be bypassed.
        """
        if task.stage != TaskStage.ANNOTATION.value:
            raise WorkflowError(
                f"Cannot skip QA from stage '{task.stage}'. "
                f"Task must be in 'annotation' stage."
            )
        
        if task.status != TaskStatus.SUBMITTED.value:
            raise WorkflowError(
                f"Cannot skip QA in status '{task.status}'. "
                f"Task must be in 'submitted' status."
            )
        
        if task.skip_customer_qa:
            new_stage = TaskStage.ACCEPTED.value
            new_status = TaskStatus.ACCEPTED.value
        else:
            new_stage = TaskStage.CUSTOMER_QA.value
            new_status = TaskStatus.IN_PROGRESS.value
        
        await self._create_stage_snapshot(
            task=task,
            from_stage=TaskStage.ANNOTATION.value,
            to_stage=new_stage,
            from_status=TaskStatus.SUBMITTED.value,
            to_status=new_status,
            triggered_by_id=changed_by_id,
            notes="QA stage skipped",
        )
        
        await self._record_history(
            task=task,
            from_stage=TaskStage.ANNOTATION.value,
            from_status=TaskStatus.SUBMITTED.value,
            to_stage=new_stage,
            to_status=new_status,
            changed_by_id=changed_by_id,
            reason="QA stage skipped",
        )
        
        task.stage = new_stage
        task.status = new_status
        
        await self.db.flush()
        await self.db.refresh(task)
        return task


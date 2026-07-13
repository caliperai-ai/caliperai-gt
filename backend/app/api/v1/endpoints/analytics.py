"""
Analytics endpoints for PM Dashboard.

Provides aggregated statistics for project management:
- Task completion metrics
- Annotator performance
- Efficiency metrics
- Time tracking
"""
from datetime import datetime, timedelta
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select, func, case, and_, or_, desc, cast, String
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import (
    Campaign, Dataset, Scene, Task, User, Permission, TaskStatus, TaskStage,
    Annotation, Annotation3D, Annotation4D, Annotation2D, AnnotationFusion,
    OrganizationMember,
)
from app.services.rbac_service import (
    get_current_user,
    RequirePermissions,
    PermissionDeniedError,
)
from app.services.organization_service import get_user_accessible_organization_ids

router = APIRouter()



class AnnotatorStats(BaseModel):
    """Statistics for a single annotator."""
    id: str
    alias: str
    tasks_completed: int
    tasks_in_progress: int
    tasks_assigned: int
    total_time_seconds: int
    avg_time_per_task_seconds: float
    revision_rate: float
    frames_annotated: int


class TaskBreakdown(BaseModel):
    """Task count breakdown by status."""
    pending: int
    assigned: int
    in_progress: int
    submitted: int
    accepted: int
    rejected: int
    total: int


class AnnotationDailyStats(BaseModel):
    """Daily annotation statistics."""
    date: str
    created_count: int
    submitted_count: int
    accepted_count: int


class UserDailyStats(BaseModel):
    """Daily statistics for a specific user."""
    date: str
    labels_created: int
    labels_submitted: int
    labels_accepted: int
    labels_rejected: int
    man_hours: float


class MyDashboardStats(BaseModel):
    """Personal dashboard statistics for an annotator."""
    daily_stats: List[UserDailyStats]
    total_labels_created: int
    total_labels_submitted: int
    acceptance_rate: float
    total_man_hours: float


class StageBreakdown(BaseModel):
    """Task count breakdown by stage."""
    annotation: int
    qa: int
    customer_qa: int
    accepted: int


class MostTimeConsumingTask(BaseModel):
    """Details of the most time-consuming task."""
    task_id: str
    task_name: str
    scene_name: str
    dataset_name: str
    total_time_seconds: int
    total_time_formatted: str
    frame_count: int
    annotator_alias: Optional[str] = None


class RecentActivity(BaseModel):
    """Recent task activity."""
    task_id: str
    task_name: str
    action: str
    annotator_alias: Optional[str] = None
    timestamp: datetime


class EfficiencyMetrics(BaseModel):
    """Efficiency metrics for the project."""
    avg_time_per_task_seconds: float
    avg_time_per_frame_seconds: float
    avg_revisions_per_task: float
    first_time_accept_rate: float
    tasks_completed_last_7_days: int
    tasks_completed_last_30_days: int
    velocity_trend: str


class PMDashboardStats(BaseModel):
    """Complete PM Dashboard statistics."""
    task_breakdown: TaskBreakdown
    stage_breakdown: StageBreakdown
    completion_rate: float
    
    efficiency: EfficiencyMetrics
    
    top_annotators: List[AnnotatorStats]
    
    most_time_consuming_task: Optional[MostTimeConsumingTask] = None
    recent_activity: List[RecentActivity]
    
    overdue_tasks: int
    tasks_due_this_week: int
    
    generated_at: datetime



def format_duration(seconds: int) -> str:
    """Format seconds into human-readable duration."""
    if seconds < 60:
        return f"{seconds}s"
    elif seconds < 3600:
        minutes = seconds // 60
        secs = seconds % 60
        return f"{minutes}m {secs}s"
    else:
        hours = seconds // 3600
        minutes = (seconds % 3600) // 60
        return f"{hours}h {minutes}m"


def generate_alias(index: int) -> str:
    """Generate anonymous alias like 'Annotator A', 'Annotator B', etc."""
    if index < 26:
        return f"Annotator {chr(65 + index)}"
    else:
        first = chr(65 + (index // 26) - 1)
        second = chr(65 + (index % 26))
        return f"Annotator {first}{second}"



@router.get("/dashboard", response_model=PMDashboardStats)
async def get_pm_dashboard(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DASHBOARD_VIEW_GLOBAL))],
    db: AsyncSession = Depends(get_db),
    campaign_id: Optional[UUID] = Query(None, description="Filter by campaign"),
    dataset_id: Optional[UUID] = Query(None, description="Filter by dataset"),
    organization_id: Optional[UUID] = Query(None, description="Filter by organization"),
    days: int = Query(30, ge=1, le=365, description="Days of history for trends"),
) -> PMDashboardStats:
    """
    Get comprehensive PM Dashboard statistics.
    
    Requires DASHBOARD_VIEW_GLOBAL permission (PM, Admin).
    Filters by user's accessible organizations unless superuser.
    
    Returns:
    - Task completion metrics
    - Annotator performance (with anonymous aliases)
    - Efficiency metrics
    - Time-consuming tasks
    - Recent activity
    """
    now = datetime.utcnow()
    
    if not current_user.is_superuser:
        accessible_org_ids = await get_user_accessible_organization_ids(db, current_user.id)
        if organization_id:
            if organization_id not in accessible_org_ids:
                raise PermissionDeniedError("You do not have access to this organization")
            org_filter = [organization_id]
        else:
            org_filter = accessible_org_ids
    else:
        org_filter = [organization_id] if organization_id else None
    
    def get_org_task_filter():
        """Get subquery to filter tasks by organization."""
        if org_filter is None:
            return None
        return Task.scene_id.in_(
            select(Scene.id)
            .join(Dataset, Scene.dataset_id == Dataset.id)
            .join(Campaign, Dataset.campaign_id == Campaign.id)
            .where(Campaign.organization_id.in_(org_filter))
        )
    
    base_filter = [Task.is_deleted == False]
    
    org_task_filter = get_org_task_filter()
    if org_task_filter is not None:
        base_filter.append(org_task_filter)
    
    if campaign_id:
        base_filter.append(
            Task.scene_id.in_(
                select(Scene.id)
                .join(Dataset, Scene.dataset_id == Dataset.id)
                .where(Dataset.campaign_id == campaign_id)
            )
        )
    if dataset_id:
        base_filter.append(
            Task.scene_id.in_(
                select(Scene.id).where(Scene.dataset_id == dataset_id)
            )
        )
    
    status_counts = await db.execute(
        select(
            Task.status,
            func.count(Task.id)
        )
        .where(*base_filter)
        .group_by(Task.status)
    )
    status_dict = {row[0]: row[1] for row in status_counts.fetchall()}
    
    task_breakdown = TaskBreakdown(
        pending=status_dict.get("pending", 0),
        assigned=status_dict.get("assigned", 0),
        in_progress=status_dict.get("in_progress", 0),
        submitted=status_dict.get("submitted", 0),
        accepted=status_dict.get("accepted", 0),
        rejected=status_dict.get("rejected", 0),
        total=sum(status_dict.values()),
    )
    
    stage_counts = await db.execute(
        select(
            Task.stage,
            func.count(Task.id)
        )
        .where(*base_filter)
        .group_by(Task.stage)
    )
    stage_dict = {row[0]: row[1] for row in stage_counts.fetchall()}
    
    stage_breakdown = StageBreakdown(
        annotation=stage_dict.get("annotation", 0),
        qa=stage_dict.get("qa", 0),
        customer_qa=stage_dict.get("customer_qa", 0),
        accepted=stage_dict.get("accepted", 0),
    )
    
    completion_rate = (
        (task_breakdown.accepted / task_breakdown.total * 100)
        if task_breakdown.total > 0 else 0.0
    )
    
    active_statuses = ["in_progress", "submitted", "accepted", "rejected"]
    active_filter = or_(Task.status.in_(active_statuses), Task.stage.in_(["qa", "customer_qa", "accepted"]))

    avg_time_result = await db.execute(
        select(func.avg(Task.total_time_seconds))
        .where(
            *base_filter,
            active_filter,
            Task.total_time_seconds > 0,
        )
    )
    avg_time_per_task = avg_time_result.scalar() or 0.0

    avg_revisions_result = await db.execute(
        select(func.avg(Task.revision_count))
        .where(*base_filter, active_filter)
    )
    avg_revisions = avg_revisions_result.scalar() or 0.0

    first_time_accepts = await db.scalar(
        select(func.count())
        .where(
            *base_filter,
            Task.status == "accepted",
            Task.revision_count == 0,
        )
    )
    first_time_accept_rate = (
        (first_time_accepts / task_breakdown.accepted * 100)
        if task_breakdown.accepted > 0 else 0.0
    )

    seven_days_ago = now - timedelta(days=7)
    thirty_days_ago = now - timedelta(days=30)

    tasks_last_7_days = await db.scalar(
        select(func.count())
        .where(
            *base_filter,
            active_filter,
            Task.updated_at >= seven_days_ago,
        )
    )

    tasks_last_30_days = await db.scalar(
        select(func.count())
        .where(
            *base_filter,
            active_filter,
            Task.updated_at >= thirty_days_ago,
        )
    )

    fourteen_days_ago = now - timedelta(days=14)
    tasks_prev_7_days = await db.scalar(
        select(func.count())
        .where(
            *base_filter,
            active_filter,
            Task.updated_at >= fourteen_days_ago,
            Task.updated_at < seven_days_ago,
        )
    )

    if tasks_last_7_days > tasks_prev_7_days * 1.1:
        velocity_trend = "increasing"
    elif tasks_last_7_days < tasks_prev_7_days * 0.9:
        velocity_trend = "decreasing"
    else:
        velocity_trend = "stable"

    frame_time_result = await db.execute(
        select(
            func.sum(Task.total_time_seconds),
            func.sum(
                func.upper(Task.frame_range) - func.lower(Task.frame_range)
            )
        )
        .where(
            *base_filter,
            active_filter,
            Task.total_time_seconds > 0,
        )
    )
    row = frame_time_result.fetchone()
    total_time = row[0] or 0
    total_frames = row[1] or 0
    avg_time_per_frame = total_time / total_frames if total_frames > 0 else 0.0
    
    efficiency = EfficiencyMetrics(
        avg_time_per_task_seconds=float(avg_time_per_task),
        avg_time_per_frame_seconds=float(avg_time_per_frame),
        avg_revisions_per_task=float(avg_revisions),
        first_time_accept_rate=float(first_time_accept_rate),
        tasks_completed_last_7_days=tasks_last_7_days or 0,
        tasks_completed_last_30_days=tasks_last_30_days or 0,
        velocity_trend=velocity_trend,
    )
    
    annotator_filter = [
        Task.assignee_id.in_(select(User.id).where(User.is_active == True)),
    ]
    if org_filter is not None:
        annotator_filter.append(
            Task.assignee_id.in_(
                select(OrganizationMember.user_id).where(
                    OrganizationMember.organization_id.in_(org_filter)
                )
            )
        )
    annotator_stats_result = await db.execute(
        select(
            Task.assignee_id,
            func.count(Task.id).label("total_tasks"),
            func.sum(case((or_(Task.status.in_(["submitted", "accepted"]), Task.stage.in_(["qa", "customer_qa", "accepted"])), 1), else_=0)).label("completed"),
            func.sum(case((Task.status == "in_progress", 1), else_=0)).label("in_progress"),
            func.sum(case((Task.status == "assigned", 1), else_=0)).label("assigned"),
            func.sum(Task.total_time_seconds).label("total_time"),
            func.avg(Task.revision_count).label("avg_revisions"),
            func.sum(
                func.upper(Task.frame_range) - func.lower(Task.frame_range)
            ).label("total_frames"),
        )
        .where(
            *base_filter,
            Task.assignee_id.isnot(None),
            *annotator_filter,
        )
        .group_by(Task.assignee_id)
        .order_by(desc("completed"))
    )
    
    top_annotators = []
    for idx, row in enumerate(annotator_stats_result.fetchall()):
        completed = row.completed or 0
        total_time = row.total_time or 0
        total_tasks = row.total_tasks or 0
        tasks_with_time = completed if completed > 0 else total_tasks
        avg_time = total_time / tasks_with_time if tasks_with_time > 0 and total_time > 0 else 0
        avg_revisions = row.avg_revisions or 0

        user_obj = await db.get(User, row.assignee_id)
        real_name = (user_obj.full_name or user_obj.username) if user_obj else generate_alias(idx)

        revision_rate = (avg_revisions / total_tasks * 100) if total_tasks > 0 else 0

        top_annotators.append(AnnotatorStats(
            id=str(row.assignee_id),
            alias=real_name,
            tasks_completed=completed,
            tasks_in_progress=row.in_progress or 0,
            tasks_assigned=row.assigned or 0,
            total_time_seconds=total_time,
            avg_time_per_task_seconds=float(avg_time),
            revision_rate=float(revision_rate),
            frames_annotated=row.total_frames or 0,
        ))
    
    most_time_task_result = await db.execute(
        select(Task)
        .where(*base_filter, Task.total_time_seconds > 0)
        .order_by(desc(Task.total_time_seconds))
        .limit(1)
    )
    most_time_task = most_time_task_result.scalar_one_or_none()
    
    most_time_consuming = None
    if most_time_task:
        scene_result = await db.execute(
            select(Scene, Dataset)
            .join(Dataset, Scene.dataset_id == Dataset.id)
            .where(Scene.id == most_time_task.scene_id)
        )
        scene_row = scene_result.fetchone()
        scene = scene_row[0] if scene_row else None
        dataset = scene_row[1] if scene_row else None
        
        annotator_alias = None
        if most_time_task.assignee_id:
            for idx, ann in enumerate(top_annotators):
                if ann.id == str(most_time_task.assignee_id):
                    annotator_alias = ann.alias
                    break
            if not annotator_alias:
                annotator_alias = "Unknown"
        
        frame_count = (
            most_time_task.frame_range.upper - most_time_task.frame_range.lower
            if most_time_task.frame_range else 0
        )
        
        most_time_consuming = MostTimeConsumingTask(
            task_id=str(most_time_task.id),
            task_name=most_time_task.name or f"Task {str(most_time_task.id)[:8]}",
            scene_name=scene.name if scene else "Unknown",
            dataset_name=dataset.name if dataset else "Unknown",
            total_time_seconds=most_time_task.total_time_seconds,
            total_time_formatted=format_duration(most_time_task.total_time_seconds),
            frame_count=frame_count,
            annotator_alias=annotator_alias,
        )
    
    recent_tasks_result = await db.execute(
        select(Task)
        .where(*base_filter)
        .order_by(desc(Task.updated_at))
        .limit(10)
    )
    
    alias_map = {ann.id: ann.alias for ann in top_annotators}
    
    recent_activity = []
    for task in recent_tasks_result.scalars().all():
        if task.status == "accepted":
            action = "completed"
        elif task.status == "submitted":
            action = "submitted"
        elif task.status == "in_progress":
            action = "started"
        elif task.status == "assigned":
            action = "assigned"
        else:
            action = "updated"
        
        if task.assignee_id:
            annotator_alias = alias_map.get(str(task.assignee_id))
            if not annotator_alias:
                u = await db.get(User, task.assignee_id)
                annotator_alias = (u.full_name or u.username) if u else None
        else:
            annotator_alias = None
        
        recent_activity.append(RecentActivity(
            task_id=str(task.id),
            task_name=task.name or f"Task {str(task.id)[:8]}",
            action=action,
            annotator_alias=annotator_alias,
            timestamp=task.updated_at,
        ))
    
    overdue_tasks = await db.scalar(
        select(func.count())
        .where(
            *base_filter,
            Task.deadline.isnot(None),
            Task.deadline < now,
            Task.status.notin_(["accepted"]),
        )
    ) or 0
    
    one_week_later = now + timedelta(days=7)
    tasks_due_this_week = await db.scalar(
        select(func.count())
        .where(
            *base_filter,
            Task.deadline.isnot(None),
            Task.deadline >= now,
            Task.deadline <= one_week_later,
            Task.status.notin_(["accepted"]),
        )
    ) or 0
    
    return PMDashboardStats(
        task_breakdown=task_breakdown,
        stage_breakdown=stage_breakdown,
        completion_rate=round(completion_rate, 1),
        efficiency=efficiency,
        top_annotators=top_annotators[:10],
        most_time_consuming_task=most_time_consuming,
        recent_activity=recent_activity,
        overdue_tasks=overdue_tasks,
        tasks_due_this_week=tasks_due_this_week,
        generated_at=now,
    )


@router.get("/annotator-leaderboard", response_model=List[AnnotatorStats])
async def get_annotator_leaderboard(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DASHBOARD_VIEW_GLOBAL))],
    db: AsyncSession = Depends(get_db),
    campaign_id: Optional[UUID] = Query(None, description="Filter by campaign"),
    sort_by: str = Query("completed", enum=["completed", "speed", "quality"]),
    limit: int = Query(20, ge=1, le=100),
) -> List[AnnotatorStats]:
    """
    Get annotator leaderboard with rankings.
    
    Sort options:
    - completed: Most tasks completed
    - speed: Fastest average time per task
    - quality: Lowest revision rate
    """
    base_filter = [
        Task.is_deleted == False,
        Task.assignee_id.isnot(None),
        Task.assignee_id.in_(select(User.id).where(User.is_active == True)),
    ]
    if campaign_id:
        base_filter.append(
            Task.scene_id.in_(
                select(Scene.id)
                .join(Dataset, Scene.dataset_id == Dataset.id)
                .where(Dataset.campaign_id == campaign_id)
            )
        )
    
    if sort_by == "speed":
        order_col = func.avg(Task.total_time_seconds).asc()
    elif sort_by == "quality":
        order_col = func.avg(Task.revision_count).asc()
    else:
        order_col = func.sum(case((Task.status == "accepted", 1), else_=0)).desc()
    
    result = await db.execute(
        select(
            Task.assignee_id,
            func.count(Task.id).label("total_tasks"),
            func.sum(case((or_(Task.status.in_(["submitted", "accepted"]), Task.stage.in_(["qa", "customer_qa", "accepted"])), 1), else_=0)).label("completed"),
            func.sum(case((Task.status == "in_progress", 1), else_=0)).label("in_progress"),
            func.sum(case((Task.status == "assigned", 1), else_=0)).label("assigned"),
            func.sum(Task.total_time_seconds).label("total_time"),
            func.avg(Task.revision_count).label("avg_revisions"),
            func.sum(
                func.upper(Task.frame_range) - func.lower(Task.frame_range)
            ).label("total_frames"),
        )
        .where(*base_filter)
        .group_by(Task.assignee_id)
        .order_by(order_col)
        .limit(limit)
    )

    annotators = []
    for idx, row in enumerate(result.fetchall()):
        completed = row.completed or 0
        total_time = row.total_time or 0
        total_tasks = row.total_tasks or 0
        tasks_with_time = completed if completed > 0 else total_tasks
        avg_time = total_time / tasks_with_time if tasks_with_time > 0 and total_time > 0 else 0
        avg_revisions = row.avg_revisions or 0
        revision_rate = (avg_revisions / total_tasks * 100) if total_tasks > 0 else 0
        user_obj = await db.get(User, row.assignee_id)
        real_name = (user_obj.full_name or user_obj.username) if user_obj else generate_alias(idx)

        annotators.append(AnnotatorStats(
            id=str(row.assignee_id),
            alias=real_name,
            tasks_completed=completed,
            tasks_in_progress=row.in_progress or 0,
            tasks_assigned=row.assigned or 0,
            total_time_seconds=total_time,
            avg_time_per_task_seconds=float(avg_time),
            revision_rate=float(revision_rate),
            frames_annotated=row.total_frames or 0,
        ))
    
    return annotators


@router.get("/annotations/daily", response_model=List[AnnotationDailyStats])
async def get_annotation_daily_stats(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DASHBOARD_VIEW_GLOBAL))],
    days: int = Query(30, ge=1, le=365),
    organization_id: Optional[UUID] = Query(None, description="Filter by organization"),
    db: AsyncSession = Depends(get_db),
):
    """Get daily annotation creation and submission stats.
    
    Aggregates from ALL annotation tables: Annotation, Annotation3D, and Annotation4D.
    Filters by user's accessible organizations unless superuser.
    """
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    
    if not current_user.is_superuser:
        accessible_org_ids = await get_user_accessible_organization_ids(db, current_user.id)
        if organization_id:
            if organization_id not in accessible_org_ids:
                raise PermissionDeniedError("You do not have access to this organization")
            org_filter = [organization_id]
        else:
            org_filter = accessible_org_ids
    else:
        org_filter = [organization_id] if organization_id else None
    
    if org_filter is not None:
        org_task_subquery = (
            select(Task.id)
            .join(Scene, Task.scene_id == Scene.id)
            .join(Dataset, Scene.dataset_id == Dataset.id)
            .join(Campaign, Dataset.campaign_id == Campaign.id)
            .where(Campaign.organization_id.in_(org_filter))
        )
    else:
        org_task_subquery = None
    
    
    base_query = (
        select(
            func.date(Annotation.created_at).label("date"),
            func.count(Annotation.id).label("count")
        )
        .where(Annotation.created_at >= cutoff_date)
    )
    if org_task_subquery is not None:
        base_query = base_query.where(Annotation.task_id.in_(org_task_subquery))
    created_base = await db.execute(base_query.group_by(func.date(Annotation.created_at)))
    
    query_3d = (
        select(
            func.date(Annotation3D.created_at).label("date"),
            func.count(Annotation3D.id).label("count")
        )
        .where(Annotation3D.created_at >= cutoff_date)
    )
    if org_task_subquery is not None:
        query_3d = query_3d.where(Annotation3D.task_id.in_(org_task_subquery))
    created_3d = await db.execute(query_3d.group_by(func.date(Annotation3D.created_at)))
    
    query_4d = (
        select(
            func.date(Annotation4D.created_at).label("date"),
            func.count(Annotation4D.id).label("count")
        )
        .where(Annotation4D.created_at >= cutoff_date)
    )
    if org_task_subquery is not None:
        query_4d = query_4d.where(Annotation4D.task_id.in_(org_task_subquery))
    created_4d = await db.execute(query_4d.group_by(func.date(Annotation4D.created_at)))
    
    
    submitted_base_query = (
        select(
            func.date(Task.updated_at).label("date"),
            func.count(Annotation.id).label("count")
        )
        .join(Task, Annotation.task_id == Task.id)
        .where(
            and_(
                Task.updated_at >= cutoff_date,
                Task.status.in_([TaskStatus.SUBMITTED, TaskStatus.ACCEPTED])
            )
        )
    )
    if org_task_subquery is not None:
        submitted_base_query = submitted_base_query.where(Task.id.in_(org_task_subquery))
    submitted_base = await db.execute(submitted_base_query.group_by(func.date(Task.updated_at)))
    
    submitted_3d_query = (
        select(
            func.date(Task.updated_at).label("date"),
            func.count(Annotation3D.id).label("count")
        )
        .join(Task, Annotation3D.task_id == Task.id)
        .where(
            and_(
                Task.updated_at >= cutoff_date,
                Task.status.in_([TaskStatus.SUBMITTED, TaskStatus.ACCEPTED])
            )
        )
    )
    if org_task_subquery is not None:
        submitted_3d_query = submitted_3d_query.where(Task.id.in_(org_task_subquery))
    submitted_3d = await db.execute(submitted_3d_query.group_by(func.date(Task.updated_at)))
    
    submitted_4d_query = (
        select(
            func.date(Task.updated_at).label("date"),
            func.count(Annotation4D.id).label("count")
        )
        .join(Task, Annotation4D.task_id == Task.id)
        .where(
            and_(
                Task.updated_at >= cutoff_date,
                Task.status.in_([TaskStatus.SUBMITTED, TaskStatus.ACCEPTED])
            )
        )
    )
    if org_task_subquery is not None:
        submitted_4d_query = submitted_4d_query.where(Task.id.in_(org_task_subquery))
    submitted_4d = await db.execute(submitted_4d_query.group_by(func.date(Task.updated_at)))
    
    
    accepted_base_query = (
        select(
            func.date(Task.updated_at).label("date"),
            func.count(Annotation.id).label("count")
        )
        .join(Task, Annotation.task_id == Task.id)
        .where(
            and_(
                Task.updated_at >= cutoff_date,
                Task.status == TaskStatus.ACCEPTED
            )
        )
    )
    if org_task_subquery is not None:
        accepted_base_query = accepted_base_query.where(Task.id.in_(org_task_subquery))
    accepted_base = await db.execute(accepted_base_query.group_by(func.date(Task.updated_at)))
    
    accepted_3d_query = (
        select(
            func.date(Task.updated_at).label("date"),
            func.count(Annotation3D.id).label("count")
        )
        .join(Task, Annotation3D.task_id == Task.id)
        .where(
            and_(
                Task.updated_at >= cutoff_date,
                Task.status == TaskStatus.ACCEPTED
            )
        )
    )
    if org_task_subquery is not None:
        accepted_3d_query = accepted_3d_query.where(Task.id.in_(org_task_subquery))
    accepted_3d = await db.execute(accepted_3d_query.group_by(func.date(Task.updated_at)))
    
    accepted_4d_query = (
        select(
            func.date(Task.updated_at).label("date"),
            func.count(Annotation4D.id).label("count")
        )
        .join(Task, Annotation4D.task_id == Task.id)
        .where(
            and_(
                Task.updated_at >= cutoff_date,
                Task.status == TaskStatus.ACCEPTED
            )
        )
    )
    if org_task_subquery is not None:
        accepted_4d_query = accepted_4d_query.where(Task.id.in_(org_task_subquery))
    accepted_4d = await db.execute(accepted_4d_query.group_by(func.date(Task.updated_at)))
    
    
    data_map = {}
    
    def aggregate_results(result, key):
        for row in result:
            d = str(row.date)
            if d not in data_map:
                data_map[d] = {"created": 0, "submitted": 0, "accepted": 0}
            data_map[d][key] += row.count
    
    aggregate_results(created_base, "created")
    aggregate_results(created_3d, "created")
    aggregate_results(created_4d, "created")
    
    aggregate_results(submitted_base, "submitted")
    aggregate_results(submitted_3d, "submitted")
    aggregate_results(submitted_4d, "submitted")
    
    aggregate_results(accepted_base, "accepted")
    aggregate_results(accepted_3d, "accepted")
    aggregate_results(accepted_4d, "accepted")
        
    stats = []
    for d in sorted(data_map.keys()):
        stats.append(AnnotationDailyStats(
            date=d,
            created_count=data_map[d]["created"],
            submitted_count=data_map[d]["submitted"],
            accepted_count=data_map[d]["accepted"]
        ))
        
    return stats


@router.get("/my-dashboard", response_model=MyDashboardStats)
async def get_my_dashboard_stats(
    current_user: Annotated[User, Depends(get_current_user)],
    days: int = Query(30, ge=1, le=365),
    organization_id: Optional[UUID] = Query(None, description="Filter by organization"),
    db: AsyncSession = Depends(get_db),
):
    """Get personal dashboard stats for the current user within their organizations."""
    cutoff_date = datetime.utcnow() - timedelta(days=days)
    
    accessible_org_ids = await get_user_accessible_organization_ids(db, current_user.id)
    if organization_id:
        if organization_id not in accessible_org_ids:
            raise PermissionDeniedError("You do not have access to this organization")
        org_filter = [organization_id]
    else:
        org_filter = accessible_org_ids
    
    org_task_subquery = (
        select(Task.id)
        .join(Scene, Task.scene_id == Scene.id)
        .join(Dataset, Scene.dataset_id == Dataset.id)
        .join(Campaign, Dataset.campaign_id == Campaign.id)
        .where(Campaign.organization_id.in_(org_filter))
    )
    
    MANUAL = 'manual'

    created_base = await db.execute(
        select(func.date(Annotation.created_at).label("date"), func.count(Annotation.id).label("count"))
        .join(Task, Annotation.task_id == Task.id)
        .where(and_(Annotation.created_at >= cutoff_date, cast(Annotation.source, String) == MANUAL,
                    Task.assignee_id == current_user.id, Task.id.in_(org_task_subquery)))
        .group_by(func.date(Annotation.created_at))
    )

    created_3d = await db.execute(
        select(func.date(Annotation3D.created_at).label("date"), func.count(Annotation3D.id).label("count"))
        .join(Task, Annotation3D.task_id == Task.id)
        .where(and_(Annotation3D.created_at >= cutoff_date, Annotation3D.source == MANUAL,
                    Task.assignee_id == current_user.id, Task.id.in_(org_task_subquery)))
        .group_by(func.date(Annotation3D.created_at))
    )

    created_4d = await db.execute(
        select(func.date(Annotation4D.created_at).label("date"), func.count(Annotation4D.id).label("count"))
        .join(Task, Annotation4D.task_id == Task.id)
        .where(and_(Annotation4D.created_at >= cutoff_date, Annotation4D.source == MANUAL,
                    Task.assignee_id == current_user.id, Task.id.in_(org_task_subquery)))
        .group_by(func.date(Annotation4D.created_at))
    )

    created_2d = await db.execute(
        select(func.date(Annotation2D.created_at).label("date"), func.count(Annotation2D.id).label("count"))
        .join(Task, Annotation2D.task_id == Task.id)
        .where(and_(Annotation2D.created_at >= cutoff_date, Annotation2D.source == MANUAL,
                    Task.assignee_id == current_user.id, Task.id.in_(org_task_subquery)))
        .group_by(func.date(Annotation2D.created_at))
    )

    created_fusion = await db.execute(
        select(func.date(AnnotationFusion.created_at).label("date"), func.count(AnnotationFusion.id).label("count"))
        .join(Task, AnnotationFusion.task_id == Task.id)
        .where(and_(AnnotationFusion.created_at >= cutoff_date, AnnotationFusion.source == MANUAL,
                    Task.assignee_id == current_user.id, Task.id.in_(org_task_subquery)))
        .group_by(func.date(AnnotationFusion.created_at))
    )

    submitted_base = await db.execute(
        select(func.date(Annotation.created_at).label("date"), func.count(Annotation.id).label("count"))
        .join(Task, Annotation.task_id == Task.id)
        .where(and_(Annotation.created_at >= cutoff_date, cast(Annotation.source, String) == MANUAL,
                    Task.assignee_id == current_user.id,
                    Task.stage.in_([TaskStage.QA, TaskStage.CUSTOMER_QA, TaskStage.ACCEPTED]),
                    Task.id.in_(org_task_subquery)))
        .group_by(func.date(Annotation.created_at))
    )

    submitted_3d = await db.execute(
        select(func.date(Annotation3D.created_at).label("date"), func.count(Annotation3D.id).label("count"))
        .join(Task, Annotation3D.task_id == Task.id)
        .where(and_(Annotation3D.created_at >= cutoff_date, Annotation3D.source == MANUAL,
                    Task.assignee_id == current_user.id,
                    Task.stage.in_([TaskStage.QA, TaskStage.CUSTOMER_QA, TaskStage.ACCEPTED]),
                    Task.id.in_(org_task_subquery)))
        .group_by(func.date(Annotation3D.created_at))
    )

    submitted_4d = await db.execute(
        select(func.date(Annotation4D.created_at).label("date"), func.count(Annotation4D.id).label("count"))
        .join(Task, Annotation4D.task_id == Task.id)
        .where(and_(Annotation4D.created_at >= cutoff_date, Annotation4D.source == MANUAL,
                    Task.assignee_id == current_user.id,
                    Task.stage.in_([TaskStage.QA, TaskStage.CUSTOMER_QA, TaskStage.ACCEPTED]),
                    Task.id.in_(org_task_subquery)))
        .group_by(func.date(Annotation4D.created_at))
    )

    submitted_2d = await db.execute(
        select(func.date(Annotation2D.created_at).label("date"), func.count(Annotation2D.id).label("count"))
        .join(Task, Annotation2D.task_id == Task.id)
        .where(and_(Annotation2D.created_at >= cutoff_date, Annotation2D.source == MANUAL,
                    Task.assignee_id == current_user.id,
                    Task.stage.in_([TaskStage.QA, TaskStage.CUSTOMER_QA, TaskStage.ACCEPTED]),
                    Task.id.in_(org_task_subquery)))
        .group_by(func.date(Annotation2D.created_at))
    )

    submitted_fusion = await db.execute(
        select(func.date(AnnotationFusion.created_at).label("date"), func.count(AnnotationFusion.id).label("count"))
        .join(Task, AnnotationFusion.task_id == Task.id)
        .where(and_(AnnotationFusion.created_at >= cutoff_date, AnnotationFusion.source == MANUAL,
                    Task.assignee_id == current_user.id,
                    Task.stage.in_([TaskStage.QA, TaskStage.CUSTOMER_QA, TaskStage.ACCEPTED]),
                    Task.id.in_(org_task_subquery)))
        .group_by(func.date(AnnotationFusion.created_at))
    )

    data_map = {}
    total_created = 0
    total_submitted = 0
    
    for row in created_base.all():
        d = str(row.date)
        c = row.count
        data_map[d] = data_map.get(d, {"created": 0, "submitted": 0})
        data_map[d]["created"] += c
        total_created += c
        
    for row in created_3d.all():
        d = str(row.date)
        c = row.count
        data_map[d] = data_map.get(d, {"created": 0, "submitted": 0})
        data_map[d]["created"] += c
        total_created += c
        
    for row in created_4d.all():
        d = str(row.date)
        c = row.count
        data_map[d] = data_map.get(d, {"created": 0, "submitted": 0})
        data_map[d]["created"] += c
        total_created += c
        
    for row in created_2d.all():
        d = str(row.date)
        c = row.count
        data_map[d] = data_map.get(d, {"created": 0, "submitted": 0})
        data_map[d]["created"] += c
        total_created += c

    for row in created_fusion.all():
        d = str(row.date)
        c = row.count
        data_map[d] = data_map.get(d, {"created": 0, "submitted": 0})
        data_map[d]["created"] += c
        total_created += c

    for row in submitted_base.all():
        d = str(row.date)
        c = row.count
        data_map[d] = data_map.get(d, {"created": 0, "submitted": 0})
        data_map[d]["submitted"] += c
        total_submitted += c
        
    for row in submitted_3d.all():
        d = str(row.date)
        c = row.count
        data_map[d] = data_map.get(d, {"created": 0, "submitted": 0})
        data_map[d]["submitted"] += c
        total_submitted += c
        
    for row in submitted_4d.all():
        d = str(row.date)
        c = row.count
        data_map[d] = data_map.get(d, {"created": 0, "submitted": 0})
        data_map[d]["submitted"] += c
        total_submitted += c
        
    for row in submitted_2d.all():
        d = str(row.date)
        c = row.count
        data_map[d] = data_map.get(d, {"created": 0, "submitted": 0})
        data_map[d]["submitted"] += c
        total_submitted += c

    for row in submitted_fusion.all():
        d = str(row.date)
        c = row.count
        data_map[d] = data_map.get(d, {"created": 0, "submitted": 0})
        data_map[d]["submitted"] += c
        total_submitted += c

    from datetime import date as date_type
    today = datetime.utcnow().date()
    all_days: dict = {}
    for i in range(days):
        day = today - timedelta(days=days - 1 - i)
        all_days[str(day)] = {"created": 0, "submitted": 0}
    for d, stats in data_map.items():
        if d in all_days:
            all_days[d] = stats

    results = []
    for d in sorted(all_days.keys()):
        stats = all_days[d]
        results.append(UserDailyStats(
            date=d,
            labels_created=stats.get("created", 0),
            labels_submitted=stats.get("submitted", 0),
            labels_accepted=0,
            labels_rejected=0,
            man_hours=0.0
        ))

    return MyDashboardStats(
        daily_stats=results,
        total_labels_created=total_created,
        total_labels_submitted=total_submitted,
        acceptance_rate=0.0,
        total_man_hours=0.0
    )

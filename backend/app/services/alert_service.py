"""
Performance Alert Service

Periodically checks team metrics and generates PerformanceAlert records when
thresholds are breached. Runs as a background asyncio task inside the FastAPI
lifespan so no external scheduler (Celery / Airflow) is required.

Alert types covered
-------------------
- velocity_drop       : annotator's labels/hr today < 50 % of their 7-day avg
- high_rejection_rate : rejection rate for the current week > 30 %
- task_overdue        : assigned/in-progress task whose deadline has passed
- long_idle           : active TimeSession with no heartbeat for > 30 min
- task_stuck          : task in_progress for > 8 h with zero new annotations today
- goal_at_risk        : UserGoal current_value < 50 % of target with < 25 % time left
"""

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import select, func, and_, cast, String, exists
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import async_session_factory
from app.models.models import (
    PerformanceAlert,
    AlertType,
    AlertSeverity,
    User,
    Task,
    TaskStatus,
    TimeSession,
    Annotation3D,
    Annotation2D,
    AnnotationFusion,
    UserGoal,
    OrganizationMember,
)

logger = logging.getLogger(__name__)

VELOCITY_DROP_THRESHOLD = 0.50
VELOCITY_CRITICAL_THRESHOLD = 0.25
REJECTION_RATE_WARNING = 0.30
REJECTION_RATE_CRITICAL = 0.50
IDLE_WARNING_MINUTES = 30
IDLE_CRITICAL_MINUTES = 60
STUCK_HOURS = 8
GOAL_AT_RISK_TIME_LEFT_PCT = 0.25
GOAL_AT_RISK_PROGRESS_PCT = 0.50
AUTO_SOURCES = ("auto", "airflow_model_v1", "airflow_model_v2",
                "auto_interpolated", "imported")

CHECK_INTERVAL_SECONDS = 15 * 60

_ALERT_MONITOR_LOCK_KEY = 7842910372



def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def _alert_exists(db: AsyncSession, user_id: UUID,
                        alert_type: str, since: datetime) -> bool:
    """Return True if an unacknowledged alert of this type already exists
    for this user created after *since*."""
    result = await db.execute(
        select(PerformanceAlert.id).where(
            and_(
                PerformanceAlert.user_id == user_id,
                PerformanceAlert.alert_type == alert_type,
                PerformanceAlert.is_acknowledged == False,
                PerformanceAlert.created_at >= since,
            )
        ).limit(1)
    )
    return result.scalar_one_or_none() is not None


async def _create_alert(
    db: AsyncSession,
    user_id: UUID,
    alert_type: AlertType,
    severity: AlertSeverity,
    title: str,
    message: str,
    metrics: dict,
    task_id: Optional[UUID] = None,
) -> None:
    alert = PerformanceAlert(
        user_id=user_id,
        task_id=task_id,
        alert_type=alert_type.value,
        severity=severity.value,
        title=title,
        message=message,
        metrics=metrics,
    )
    db.add(alert)
    logger.info("Created %s alert for user %s: %s", alert_type.value, user_id, title)



async def _check_velocity_drop(db: AsyncSession, user_id: UUID) -> None:
    """Compare labels created today vs. 7-day daily average."""
    now = _utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_ago = now - timedelta(days=7)

    def _annotation_count_query(since: datetime, until: datetime):
        return (
            select(func.count())
            .select_from(Task)
            .join(Annotation3D, Annotation3D.task_id == Task.id, isouter=True)
            .where(
                Task.assignee_id == user_id,
                Annotation3D.created_at >= since,
                Annotation3D.created_at < until,
                cast(Annotation3D.source, String).notin_(AUTO_SOURCES),
            )
        )

    today_count_res = await db.execute(
        select(func.count()).select_from(Annotation3D).join(
            Task, Annotation3D.task_id == Task.id
        ).where(
            Task.assignee_id == user_id,
            Annotation3D.created_at >= today_start,
            cast(Annotation3D.source, String).notin_(AUTO_SOURCES),
        )
    )
    today_count = today_count_res.scalar() or 0

    weekly_count_res = await db.execute(
        select(func.count()).select_from(Annotation3D).join(
            Task, Annotation3D.task_id == Task.id
        ).where(
            Task.assignee_id == user_id,
            Annotation3D.created_at >= week_ago,
            Annotation3D.created_at < today_start,
            cast(Annotation3D.source, String).notin_(AUTO_SOURCES),
        )
    )
    weekly_total = weekly_count_res.scalar() or 0
    daily_avg = weekly_total / 7 if weekly_total else 0

    if daily_avg < 5:
        return

    ratio = today_count / daily_avg
    if ratio >= VELOCITY_DROP_THRESHOLD:
        return

    if await _alert_exists(db, user_id, AlertType.VELOCITY_DROP.value, today_start):
        return

    severity = (AlertSeverity.CRITICAL if ratio < VELOCITY_CRITICAL_THRESHOLD
                else AlertSeverity.WARNING)
    drop_pct = round((1 - ratio) * 100, 1)

    await _create_alert(
        db, user_id,
        AlertType.VELOCITY_DROP, severity,
        title=f"Velocity dropped {drop_pct}% below average",
        message=(
            f"Today's annotation count ({today_count}) is {drop_pct}% below "
            f"the 7-day daily average ({daily_avg:.1f}). This may indicate "
            "a blocker, tool issue, or need for support."
        ),
        metrics={
            "today_count": today_count,
            "daily_avg": round(daily_avg, 1),
            "drop_percentage": drop_pct,
        },
    )


async def _check_high_rejection_rate(db: AsyncSession, user_id: UUID) -> None:
    """Check if this week's rejection rate is above threshold."""
    now = _utcnow()
    week_start = now - timedelta(days=7)

    result = await db.execute(
        select(
            func.count().filter(Task.status == TaskStatus.ACCEPTED.value).label("accepted"),
            func.count().filter(Task.status == TaskStatus.REJECTED.value).label("rejected"),
        ).where(
            Task.assignee_id == user_id,
            Task.is_deleted == False,
            Task.updated_at >= week_start,
        )
    )
    row = result.one()
    accepted, rejected = row.accepted or 0, row.rejected or 0
    total_reviewed = accepted + rejected

    if total_reviewed < 3:
        return

    rejection_rate = rejected / total_reviewed
    if rejection_rate < REJECTION_RATE_WARNING:
        return

    if await _alert_exists(db, user_id, AlertType.HIGH_REJECTION_RATE.value, week_start):
        return

    severity = (AlertSeverity.CRITICAL if rejection_rate >= REJECTION_RATE_CRITICAL
                else AlertSeverity.WARNING)
    rate_pct = round(rejection_rate * 100, 1)

    await _create_alert(
        db, user_id,
        AlertType.HIGH_REJECTION_RATE, severity,
        title=f"High rejection rate: {rate_pct}% this week",
        message=(
            f"{rejected} of {total_reviewed} reviewed tasks were rejected this week "
            f"({rate_pct}% rejection rate). Consider reviewing annotation guidelines "
            "or scheduling a quality review session."
        ),
        metrics={
            "rejected": rejected,
            "accepted": accepted,
            "total_reviewed": total_reviewed,
            "rejection_rate_pct": rate_pct,
        },
    )


async def _check_task_overdue(db: AsyncSession, user_id: UUID) -> None:
    """Check for tasks past their deadline that are still open."""
    now = _utcnow()

    result = await db.execute(
        select(Task).where(
            Task.assignee_id == user_id,
            Task.is_deleted == False,
            Task.deadline < now,
            Task.status.in_([
                TaskStatus.ASSIGNED.value,
                TaskStatus.IN_PROGRESS.value,
                TaskStatus.PENDING.value,
            ]),
        )
    )
    overdue_tasks = result.scalars().all()

    for task in overdue_tasks:
        if await _alert_exists(db, user_id, AlertType.TASK_OVERDUE.value,
                               now - timedelta(hours=24)):
            continue

        hours_overdue = round((now - task.deadline.replace(tzinfo=None)).total_seconds() / 3600, 1)
        severity = AlertSeverity.CRITICAL if hours_overdue > 24 else AlertSeverity.WARNING

        await _create_alert(
            db, user_id,
            AlertType.TASK_OVERDUE, severity,
            title=f"Task overdue by {hours_overdue}h: {task.name}",
            message=(
                f"Task '{task.name}' was due {hours_overdue} hours ago and is still "
                f"in '{task.status}' status. Immediate attention required."
            ),
            metrics={
                "task_name": task.name,
                "hours_overdue": hours_overdue,
                "deadline": task.deadline.isoformat(),
                "status": task.status,
            },
            task_id=task.id,
        )


async def _check_long_idle(db: AsyncSession, user_id: UUID) -> None:
    """Check for active task sessions with no recent heartbeat."""
    now = _utcnow()
    warning_threshold = now - timedelta(minutes=IDLE_WARNING_MINUTES)
    critical_threshold = now - timedelta(minutes=IDLE_CRITICAL_MINUTES)

    result = await db.execute(
        select(TimeSession, Task)
        .join(Task, TimeSession.task_id == Task.id)
        .where(
            TimeSession.user_id == user_id,
            TimeSession.is_active == True,
            TimeSession.last_heartbeat_at < warning_threshold,
        )
    )
    sessions = result.all()

    for session, task in sessions:
        idle_minutes = round(
            (now - session.last_heartbeat_at.replace(tzinfo=None)).total_seconds() / 60
        )
        if await _alert_exists(db, user_id, AlertType.LONG_IDLE.value,
                               now - timedelta(hours=2)):
            continue

        severity = (AlertSeverity.CRITICAL
                    if session.last_heartbeat_at.replace(tzinfo=None) < critical_threshold
                    else AlertSeverity.WARNING)

        await _create_alert(
            db, user_id,
            AlertType.LONG_IDLE, severity,
            title=f"Annotator idle for {idle_minutes} minutes",
            message=(
                f"An active session on task '{task.name}' has had no heartbeat for "
                f"{idle_minutes} minutes. The annotator may be stuck or away."
            ),
            metrics={
                "idle_minutes": idle_minutes,
                "task_name": task.name,
                "session_id": str(session.id),
            },
            task_id=task.id,
        )


async def _check_task_stuck(db: AsyncSession, user_id: UUID) -> None:
    """Check for tasks in_progress > STUCK_HOURS with no annotations created today."""
    now = _utcnow()
    stuck_threshold = now - timedelta(hours=STUCK_HOURS)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    result = await db.execute(
        select(Task).where(
            Task.assignee_id == user_id,
            Task.is_deleted == False,
            Task.status == TaskStatus.IN_PROGRESS.value,
            Task.updated_at < stuck_threshold,
        )
    )
    in_progress_tasks = result.scalars().all()

    for task in in_progress_tasks:
        ann_today = await db.execute(
            select(func.count()).where(
                and_(
                    Annotation3D.task_id == task.id,
                    Annotation3D.created_at >= today_start,
                    cast(Annotation3D.source, String).notin_(AUTO_SOURCES),
                )
            )
        )
        count_today = ann_today.scalar() or 0
        if count_today > 0:
            continue

        if await _alert_exists(db, user_id, AlertType.TASK_STUCK.value,
                               now - timedelta(hours=STUCK_HOURS)):
            continue

        hours_stuck = round(
            (now - task.updated_at.replace(tzinfo=None)).total_seconds() / 3600, 1
        )

        await _create_alert(
            db, user_id,
            AlertType.TASK_STUCK, AlertSeverity.WARNING,
            title=f"Task stuck for {hours_stuck}h with no progress: {task.name}",
            message=(
                f"Task '{task.name}' has been in-progress for {hours_stuck} hours "
                "with no new annotations created today. It may need reassignment "
                "or the annotator may need assistance."
            ),
            metrics={
                "task_name": task.name,
                "hours_stuck": hours_stuck,
                "annotations_today": count_today,
            },
            task_id=task.id,
        )


async def _check_goal_at_risk(db: AsyncSession, user_id: UUID) -> None:
    """Check if active goals are unlikely to be met with time remaining."""
    now = _utcnow()

    result = await db.execute(
        select(UserGoal).where(
            UserGoal.user_id == user_id,
            UserGoal.is_achieved == False,
            UserGoal.period_end > now,
            UserGoal.period_start <= now,
        )
    )
    goals = result.scalars().all()

    for goal in goals:
        period_start = goal.period_start.replace(tzinfo=None)
        period_end = goal.period_end.replace(tzinfo=None)
        total_period = (period_end - period_start).total_seconds()
        time_elapsed = (now - period_start).total_seconds()
        time_left_pct = 1 - (time_elapsed / total_period) if total_period > 0 else 0

        if time_left_pct > GOAL_AT_RISK_TIME_LEFT_PCT:
            continue

        progress_pct = goal.current_value / goal.target_value if goal.target_value > 0 else 0
        if progress_pct >= GOAL_AT_RISK_PROGRESS_PCT:
            continue

        if await _alert_exists(db, user_id, AlertType.GOAL_AT_RISK.value,
                               now - timedelta(hours=12)):
            continue

        hours_left = round(time_left_pct * total_period / 3600, 1)

        await _create_alert(
            db, user_id,
            AlertType.GOAL_AT_RISK, AlertSeverity.WARNING,
            title=f"Goal at risk: {goal.goal_type.replace('_', ' ').title()}",
            message=(
                f"Only {round(progress_pct * 100, 1)}% of the target ({goal.current_value:.0f} "
                f"/ {goal.target_value:.0f}) reached with {hours_left}h remaining "
                f"({round(time_left_pct * 100, 1)}% of period left)."
            ),
            metrics={
                "goal_type": goal.goal_type,
                "current_value": goal.current_value,
                "target_value": goal.target_value,
                "progress_pct": round(progress_pct * 100, 1),
                "hours_left": hours_left,
            },
        )



async def _run_checks_for_all_users(db: AsyncSession) -> None:
    """Fetch all active org members and run all checks."""
    result = await db.execute(
        select(User)
        .join(OrganizationMember, OrganizationMember.user_id == User.id)
        .where(User.is_active == True)
        .distinct()
    )
    users = result.scalars().all()

    logger.info("Running performance alert checks for %d users", len(users))

    for user in users:
        try:
            await _check_velocity_drop(db, user.id)
            await _check_high_rejection_rate(db, user.id)
            await _check_task_overdue(db, user.id)
            await _check_long_idle(db, user.id)
            await _check_task_stuck(db, user.id)
            await _check_goal_at_risk(db, user.id)
        except Exception as exc:
            logger.exception("Alert check failed for user %s: %s", user.id, exc)

    await db.commit()
    logger.info("Performance alert checks complete")


async def run_alert_checks() -> None:
    """Entry point called by the background loop.

    Uses a Postgres session-level advisory lock so that, across all gunicorn
    workers, at most one worker runs the cycle at a time. Workers that can't
    grab the lock skip this tick — they'll try again on the next interval.
    """
    async with async_session_factory() as db:
        got_lock = (
            await db.execute(select(func.pg_try_advisory_lock(_ALERT_MONITOR_LOCK_KEY)))
        ).scalar()
        if not got_lock:
            logger.debug("Alert monitor: lock held by another worker, skipping cycle")
            return
        try:
            await _run_checks_for_all_users(db)
        except Exception as exc:
            await db.rollback()
            logger.exception("Alert check cycle failed: %s", exc)
        finally:
            try:
                await db.execute(select(func.pg_advisory_unlock(_ALERT_MONITOR_LOCK_KEY)))
                await db.commit()
            except Exception:
                logger.exception("Failed to release alert-monitor advisory lock")


async def alert_monitor_loop() -> None:
    """
    Infinite loop that runs alert checks every CHECK_INTERVAL_SECONDS.
    Designed to be launched as an asyncio background task from the
    FastAPI lifespan context.
    """
    logger.info(
        "Performance alert monitor started (interval: %ds)", CHECK_INTERVAL_SECONDS
    )
    await asyncio.sleep(30)

    while True:
        try:
            await run_alert_checks()
        except asyncio.CancelledError:
            logger.info("Performance alert monitor shutting down")
            break
        except Exception as exc:
            logger.exception("Unexpected error in alert monitor loop: %s", exc)

        await asyncio.sleep(CHECK_INTERVAL_SECONDS)
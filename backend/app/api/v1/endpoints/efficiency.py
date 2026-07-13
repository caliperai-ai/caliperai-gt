"""
Efficiency Monitoring API endpoints.

Provides session tracking, activity logging, and efficiency analytics:
- Session heartbeats for real-time presence
- Activity event logging
- User goals management  
- Achievements system
- Performance alerts
- Leaderboards and gamification
"""
from datetime import datetime, timedelta, timezone
from typing import Annotated, List, Optional
from uuid import UUID
import uuid as uuid_lib

from fastapi import APIRouter, Depends, HTTPException, Query, status, Body
from pydantic import BaseModel, Field
from sqlalchemy import select, func, and_, or_, desc, update, case, cast, Float, String
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.models import (
    User, Task, Permission, Organization, OrganizationMember,
    TimeSession, ActivityEvent, ActivityEventType, UserLoginSession,
    UserGoal, GoalType, Achievement, AchievementType,
    PerformanceAlert, AlertType, AlertSeverity,
    DailyUserStats, TeamChallenge, ChallengeParticipant,
    Annotation, Annotation3D, AnnotationFusion, Annotation2D, Annotation4D, TaskStatus, TaskStage,
    Campaign, Dataset, Scene, Taxonomy,
)
from app.services.rbac_service import get_current_user, RequirePermissions

router = APIRouter()



class ClientInfo(BaseModel):
    """Client browser/device information."""
    browser: Optional[str] = None
    os: Optional[str] = None
    screen_resolution: Optional[str] = None
    timezone: Optional[str] = None


class SessionStartRequest(BaseModel):
    """Request to start a new session."""
    task_id: UUID
    client_info: Optional[ClientInfo] = None


class SessionStartResponse(BaseModel):
    """Response after starting a session."""
    session_id: UUID
    started_at: datetime
    message: str


class HeartbeatRequest(BaseModel):
    """Heartbeat to keep session alive."""
    session_id: UUID
    is_active: bool = True
    current_frame: Optional[int] = None
    

class HeartbeatResponse(BaseModel):
    """Response to heartbeat."""
    session_id: UUID
    active_duration_seconds: int
    idle_duration_seconds: int
    is_idle: bool


class SessionEndRequest(BaseModel):
    """Request to end a session."""
    session_id: UUID
    

class SessionEndResponse(BaseModel):
    """Response after ending a session."""
    session_id: UUID
    total_active_seconds: int
    total_idle_seconds: int
    action_count: int



class LoginSessionStartRequest(BaseModel):
    """Request to start a global login session."""
    organization_id: Optional[UUID] = None
    client_info: Optional[ClientInfo] = None


class LoginSessionStartResponse(BaseModel):
    """Response after starting a login session."""
    session_id: UUID
    started_at: datetime
    message: str


class LoginSessionHeartbeatRequest(BaseModel):
    """Heartbeat for global login session."""
    session_id: UUID
    is_window_focused: bool = True
    is_mouse_in_window: bool = True
    is_active: bool = True


class LoginSessionHeartbeatResponse(BaseModel):
    """Response to login session heartbeat."""
    session_id: UUID
    active_duration_seconds: int
    idle_duration_seconds: int
    total_session_seconds: int
    today_active_seconds: int = 0


class LoginSessionEndRequest(BaseModel):
    """Request to end a login session."""
    session_id: UUID


class LoginSessionEndResponse(BaseModel):
    """Response after ending a login session."""
    session_id: UUID
    total_active_seconds: int
    total_idle_seconds: int
    total_session_seconds: int


class ActivityEventRequest(BaseModel):
    """Request to log an activity event."""
    session_id: Optional[UUID] = None
    task_id: Optional[UUID] = None
    event_type: str
    metadata: Optional[dict] = Field(default_factory=dict)


class ActivityEventResponse(BaseModel):
    """Response after logging activity."""
    event_id: UUID
    timestamp: datetime


class BatchActivityRequest(BaseModel):
    """Batch multiple activity events."""
    session_id: Optional[UUID] = None
    task_id: Optional[UUID] = None
    events: List[ActivityEventRequest]


class UserGoalCreate(BaseModel):
    """Create a new goal."""
    goal_type: str
    target_value: float
    period_start: datetime
    period_end: datetime


class UserGoalResponse(BaseModel):
    """User goal with progress."""
    id: UUID
    goal_type: str
    target_value: float
    current_value: float
    period_start: datetime
    period_end: datetime
    is_achieved: bool
    achieved_at: Optional[datetime]
    progress_percentage: float
    is_self_assigned: bool


class AchievementResponse(BaseModel):
    """Achievement earned by user."""
    id: UUID
    achievement_type: str
    earned_at: datetime
    metadata: dict
    is_seen: bool
    title: str
    description: str
    icon: str


class LiveUserStatus(BaseModel):
    """Real-time status of a user."""
    user_id: UUID
    display_name: str
    current_task_id: Optional[UUID] = None
    current_task_name: Optional[str] = None
    is_active: bool
    last_activity: Optional[datetime] = None
    session_duration_seconds: int = 0
    labels_today: int = 0


class AnnotationBreakdown(BaseModel):
    """Breakdown of annotations by type."""
    cuboids_3d: int = 0
    boxes_2d: int = 0
    fusion: int = 0
    total: int = 0


class WorkflowMetrics(BaseModel):
    """Task workflow metrics."""
    tasks_assigned: int = 0
    tasks_in_progress: int = 0
    tasks_submitted: int = 0
    tasks_accepted: int = 0
    tasks_rejected: int = 0
    revision_count: int = 0


class QualityMetrics(BaseModel):
    """Quality metrics for a user."""
    first_time_acceptance_rate: float = 0.0
    rejection_rate: float = 0.0
    revision_turnaround_hours: float = 0.0
    quality_score: float = 0.0


class TeamMemberStats(BaseModel):
    """Team member statistics for efficiency dashboard."""
    user_id: UUID
    display_name: str
    email: Optional[str] = None
    role: Optional[str] = None
    
    is_online: bool = False
    is_active: bool = False
    current_task_id: Optional[UUID] = None
    current_task_name: Optional[str] = None
    last_activity: Optional[datetime] = None
    session_duration_seconds: int = 0
    
    annotations: AnnotationBreakdown = AnnotationBreakdown()
    
    workflow: WorkflowMetrics = WorkflowMetrics()
    
    quality: QualityMetrics = QualityMetrics()
    
    active_time_seconds: int = 0
    labels_per_hour: float = 0.0
    avg_time_per_label_seconds: float = 0.0
    
    period_start: Optional[datetime] = None
    period_end: Optional[datetime] = None


class LeaderboardEntry(BaseModel):
    """Entry in leaderboard."""
    rank: int
    user_id: UUID
    display_name: str
    labels_count: int
    acceptance_rate: float
    avg_time_per_label_seconds: float
    streak_days: int


class TeamChallengeResponse(BaseModel):
    """Team challenge details."""
    id: UUID
    title: str
    description: Optional[str]
    goal_type: str
    target_value: float
    current_value: float
    progress_percentage: float
    start_date: datetime
    end_date: datetime
    is_active: bool
    is_completed: bool
    participant_count: int
    top_contributors: List[LeaderboardEntry]


class CreateChallengeRequest(BaseModel):
    """Request to create a team challenge."""
    title: str
    description: Optional[str] = None
    goal_type: str
    target_value: float
    start_date: datetime
    end_date: datetime
    organization_id: Optional[UUID] = None


class PerformanceAlertResponse(BaseModel):
    """Performance alert for managers."""
    id: UUID
    user_id: UUID
    display_name: str
    alert_type: str
    severity: str
    title: str
    message: str
    metrics: dict
    is_acknowledged: bool
    created_at: datetime


class EfficiencyStats(BaseModel):
    """Personal efficiency statistics."""
    today_labels: int
    today_active_time_seconds: int
    today_sessions: int
    week_labels: int
    week_active_time_seconds: int
    labels_per_hour: float
    acceptance_rate: Optional[float] = None
    current_streak_days: int
    rank_in_team: Optional[int] = None
    vs_team_avg_percentage: float


ACHIEVEMENT_INFO = {
    AchievementType.SPEED_DEMON.value: {
        "title": "Speed Demon",
        "description": "Complete 10 labels in under 30 minutes",
        "icon": "⚡"
    },
    AchievementType.LIGHTNING_FAST.value: {
        "title": "Lightning Fast",
        "description": "Top 10% speed for a week",
        "icon": "🏎️"
    },
    AchievementType.QUALITY_CHAMPION.value: {
        "title": "Quality Champion",
        "description": "Achieve 95%+ acceptance rate",
        "icon": "🏆"
    },
    AchievementType.PERFECTIONIST.value: {
        "title": "Perfectionist",
        "description": "10 tasks in a row without revision",
        "icon": "💎"
    },
    AchievementType.ZERO_DEFECT.value: {
        "title": "Zero Defect",
        "description": "50 first-time accepts",
        "icon": "✨"
    },
    AchievementType.CONSISTENCY_STAR.value: {
        "title": "Consistency Star",
        "description": "5-day streak of meeting goals",
        "icon": "⭐"
    },
    AchievementType.MARATHON_RUNNER.value: {
        "title": "Marathon Runner",
        "description": "10-day streak of activity",
        "icon": "🏃"
    },
    AchievementType.DEDICATED.value: {
        "title": "Dedicated",
        "description": "30-day active streak",
        "icon": "🎖️"
    },
    AchievementType.CENTURY_CLUB.value: {
        "title": "Century Club",
        "description": "100 labels in a day",
        "icon": "💯"
    },
    AchievementType.THOUSAND_LABELS.value: {
        "title": "Thousand Labels",
        "description": "1000 labels in a day",
        "icon": "🎯"
    },
    AchievementType.MILESTONE_5K.value: {
        "title": "5K Milestone",
        "description": "5000 labels in a day",
        "icon": "🌟"
    },
    AchievementType.ON_THE_RISE.value: {
        "title": "On the Rise",
        "description": "20% efficiency improvement",
        "icon": "📈"
    },
    AchievementType.COMEBACK_KID.value: {
        "title": "Comeback Kid",
        "description": "Recovered from low performance",
        "icon": "💪"
    },
}



def generate_alias(user_id: UUID, seed: int = 0) -> str:
    """Generate consistent anonymous alias for a user."""
    user_bytes = user_id.bytes[:4]
    index = int.from_bytes(user_bytes, 'big') % 100
    return f"Annotator {index + 1}"


async def get_display_name(
    db: AsyncSession, 
    user: User, 
    requesting_user: User,
    organization_id: Optional[UUID] = None
) -> str:
    """Get display name based on organization settings."""
    if user.id == requesting_user.id:
        return user.full_name or user.username
    
    if organization_id:
        result = await db.execute(
            select(Organization).where(Organization.id == organization_id)
        )
        org = result.scalar_one_or_none()
        if org and org.settings:
            display_real_names = org.settings.get("display_real_names", True)
            if not display_real_names:
                return generate_alias(user.id)
    
    return user.full_name or user.username


async def update_daily_stats(
    db: AsyncSession,
    user_id: UUID,
    labels_created: int = 0,
    labels_updated: int = 0,
    labels_deleted: int = 0,
    active_time_seconds: int = 0,
    idle_time_seconds: int = 0,
) -> None:
    """Update or create daily stats for a user."""
    today = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    
    result = await db.execute(
        select(DailyUserStats).where(
            and_(
                DailyUserStats.user_id == user_id,
                DailyUserStats.stats_date == today,
            )
        )
    )
    stats = result.scalar_one_or_none()
    
    if stats:
        stats.labels_created += labels_created
        stats.labels_updated += labels_updated
        stats.labels_deleted += labels_deleted
        stats.total_active_time += active_time_seconds
        stats.total_idle_time += idle_time_seconds
        stats.updated_at = datetime.utcnow()
    else:
        stats = DailyUserStats(
            id=uuid_lib.uuid4(),
            user_id=user_id,
            stats_date=today,
            labels_created=labels_created,
            labels_updated=labels_updated,
            labels_deleted=labels_deleted,
            total_active_time=active_time_seconds,
            total_idle_time=idle_time_seconds,
            total_session_count=1 if active_time_seconds > 0 else 0,
        )
        db.add(stats)



@router.post("/sessions/start", response_model=SessionStartResponse)
async def start_session(
    request: SessionStartRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> SessionStartResponse:
    """
    Start a new time tracking session for a task.
    Called when user opens the annotation editor.
    """
    task = await db.get(Task, request.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    await db.execute(
        update(TimeSession)
        .where(
            and_(
                TimeSession.user_id == current_user.id,
                TimeSession.task_id == request.task_id,
                TimeSession.is_active == True,
            )
        )
        .values(
            is_active=False,
            session_end=datetime.utcnow(),
        )
    )
    
    session = TimeSession(
        id=uuid_lib.uuid4(),
        user_id=current_user.id,
        task_id=request.task_id,
        client_info=request.client_info.model_dump() if request.client_info else {},
    )
    db.add(session)
    
    event = ActivityEvent(
        id=uuid_lib.uuid4(),
        user_id=current_user.id,
        task_id=request.task_id,
        session_id=session.id,
        event_type=ActivityEventType.SESSION_START.value,
        metadata={"client_info": session.client_info},
    )
    db.add(event)
    
    await db.commit()
    
    return SessionStartResponse(
        session_id=session.id,
        started_at=session.session_start,
        message="Session started successfully",
    )


@router.post("/sessions/heartbeat", response_model=HeartbeatResponse)
async def session_heartbeat(
    request: HeartbeatRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> HeartbeatResponse:
    """
    Send heartbeat to keep session alive.
    Should be called every 30 seconds while user is on task.
    """
    session = await db.get(TimeSession, request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")
    if not session.is_active:
        raise HTTPException(status_code=400, detail="Session already ended")
    
    now = datetime.utcnow()
    
    time_since_last = (now - session.last_heartbeat_at).total_seconds()
    
    idle_threshold = 180
    
    if time_since_last > idle_threshold:
        session.idle_duration_seconds += int(time_since_last)
        if not session.is_idle:
            event = ActivityEvent(
                id=uuid_lib.uuid4(),
                user_id=current_user.id,
                task_id=session.task_id,
                session_id=session.id,
                event_type=ActivityEventType.SESSION_PAUSE.value,
            )
            db.add(event)
        session.is_idle = True
    else:
        if request.is_active:
            session.active_duration_seconds += int(min(time_since_last, 30))
            if session.is_idle:
                event = ActivityEvent(
                    id=uuid_lib.uuid4(),
                    user_id=current_user.id,
                    task_id=session.task_id,
                    session_id=session.id,
                    event_type=ActivityEventType.SESSION_RESUME.value,
                )
                db.add(event)
            session.is_idle = False
        else:
            session.idle_duration_seconds += int(min(time_since_last, 30))
            session.is_idle = True
    
    session.heartbeat_count += 1
    session.last_heartbeat_at = now
    
    if request.current_frame is not None:
        session.frames_visited += 1
    
    await db.commit()
    
    return HeartbeatResponse(
        session_id=session.id,
        active_duration_seconds=session.active_duration_seconds,
        idle_duration_seconds=session.idle_duration_seconds,
        is_idle=session.is_idle,
    )


@router.post("/sessions/end", response_model=SessionEndResponse)
async def end_session(
    request: SessionEndRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> SessionEndResponse:
    """
    End a time tracking session.
    Called when user leaves the annotation editor.
    """
    session = await db.get(TimeSession, request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")
    
    now = datetime.utcnow()
    
    if session.is_active:
        time_since_last = (now - session.last_heartbeat_at).total_seconds()
        if time_since_last < 180:
            session.active_duration_seconds += int(min(time_since_last, 30))
    
    session.is_active = False
    session.session_end = now
    
    event = ActivityEvent(
        id=uuid_lib.uuid4(),
        user_id=current_user.id,
        task_id=session.task_id,
        session_id=session.id,
        event_type=ActivityEventType.SESSION_END.value,
        metadata={
            "active_seconds": session.active_duration_seconds,
            "idle_seconds": session.idle_duration_seconds,
            "action_count": session.action_count,
        },
    )
    db.add(event)
    
    await update_daily_stats(
        db,
        current_user.id,
        active_time_seconds=session.active_duration_seconds,
        idle_time_seconds=session.idle_duration_seconds,
    )
    
    task = await db.get(Task, session.task_id)
    if task:
        task.total_time_seconds += session.active_duration_seconds
    
    await db.commit()
    
    return SessionEndResponse(
        session_id=session.id,
        total_active_seconds=session.active_duration_seconds,
        total_idle_seconds=session.idle_duration_seconds,
        action_count=session.action_count,
    )



@router.post("/login-sessions/start", response_model=LoginSessionStartResponse)
async def start_login_session(
    request: LoginSessionStartRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> LoginSessionStartResponse:
    """
    Start a global login session for activity tracking.
    Called when user logs in or opens the app.
    
    This tracks overall time spent in the application,
    independent of task-specific time tracking.
    """
    now = datetime.now(timezone.utc)
    
    existing_result = await db.execute(
        select(UserLoginSession)
        .where(
            and_(
                UserLoginSession.user_id == current_user.id,
                UserLoginSession.is_active == True,
            )
        )
    )
    existing_session = existing_result.scalar_one_or_none()
    
    if existing_session:
        return LoginSessionStartResponse(
            session_id=existing_session.id,
            started_at=existing_session.session_start,
            message="Reconnected to existing session",
        )
    
    client_info_dict = {}
    if request.client_info:
        client_info_dict = {
            "browser": request.client_info.browser,
            "os": request.client_info.os,
            "screen_resolution": request.client_info.screen_resolution,
            "timezone": request.client_info.timezone,
        }
    
    session = UserLoginSession(
        id=uuid_lib.uuid4(),
        user_id=current_user.id,
        organization_id=request.organization_id,
        session_start=now,
        last_heartbeat_at=now,
        last_active_at=now,
        is_active=True,
        is_window_focused=True,
        is_mouse_in_window=True,
        active_duration_seconds=0,
        idle_duration_seconds=0,
        heartbeat_count=0,
        client_info=client_info_dict,
    )
    db.add(session)
    await db.commit()
    
    return LoginSessionStartResponse(
        session_id=session.id,
        started_at=session.session_start,
        message="Login session started",
    )


@router.post("/login-sessions/heartbeat", response_model=LoginSessionHeartbeatResponse)
async def login_session_heartbeat(
    request: LoginSessionHeartbeatRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> LoginSessionHeartbeatResponse:
    """
    Send heartbeat for a login session.
    Should be called every 30 seconds while user is in the app.
    
    Tracks:
    - is_window_focused: Browser window has focus
    - is_mouse_in_window: Mouse cursor is inside the window
    - is_active: User has interacted recently (not idle)
    """
    session = await db.get(UserLoginSession, request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Login session not found")
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")
    if not session.is_active:
        raise HTTPException(status_code=400, detail="Session already ended")
    
    now = datetime.now(timezone.utc)
    time_since_last_heartbeat = (now - session.last_heartbeat_at).total_seconds()
    
    time_to_add = min(time_since_last_heartbeat, 60)
    
    is_truly_active = (
        request.is_window_focused and 
        request.is_mouse_in_window and 
        request.is_active
    )
    
    if is_truly_active:
        session.active_duration_seconds += int(time_to_add)
        session.last_active_at = now
    else:
        session.idle_duration_seconds += int(time_to_add)
    
    session.last_heartbeat_at = now
    session.heartbeat_count += 1
    session.is_window_focused = request.is_window_focused
    session.is_mouse_in_window = request.is_mouse_in_window
    
    await db.commit()
    
    total_session_seconds = int((now - session.session_start).total_seconds())
    
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    today_sessions_result = await db.execute(
        select(func.sum(UserLoginSession.active_duration_seconds))
        .where(
            and_(
                UserLoginSession.user_id == current_user.id,
                UserLoginSession.session_start >= today_start,
            )
        )
    )
    today_active_seconds = today_sessions_result.scalar() or 0
    
    return LoginSessionHeartbeatResponse(
        session_id=session.id,
        active_duration_seconds=session.active_duration_seconds,
        idle_duration_seconds=session.idle_duration_seconds,
        total_session_seconds=total_session_seconds,
        today_active_seconds=int(today_active_seconds),
    )


@router.post("/login-sessions/end", response_model=LoginSessionEndResponse)
async def end_login_session(
    request: LoginSessionEndRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> LoginSessionEndResponse:
    """
    End a login session.
    Called when user logs out or closes the browser.
    """
    session = await db.get(UserLoginSession, request.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Login session not found")
    if session.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your session")
    
    now = datetime.now(timezone.utc)
    
    if session.is_active:
        time_since_last = (now - session.last_heartbeat_at).total_seconds()
        if time_since_last < 60:
            if session.is_window_focused and session.is_mouse_in_window:
                session.active_duration_seconds += int(time_since_last)
            else:
                session.idle_duration_seconds += int(time_since_last)
    
    session.is_active = False
    session.session_end = now
    
    await db.commit()
    
    total_session_seconds = int((now - session.session_start).total_seconds())
    
    return LoginSessionEndResponse(
        session_id=session.id,
        total_active_seconds=session.active_duration_seconds,
        total_idle_seconds=session.idle_duration_seconds,
        total_session_seconds=total_session_seconds,
    )


@router.get("/login-sessions/current")
async def get_current_login_session(
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """Get the current active login session for the user."""
    result = await db.execute(
        select(UserLoginSession)
        .where(
            and_(
                UserLoginSession.user_id == current_user.id,
                UserLoginSession.is_active == True,
            )
        )
        .order_by(desc(UserLoginSession.session_start))
    )
    session = result.scalar_one_or_none()
    
    if not session:
        return {"session": None, "message": "No active login session"}
    
    now = datetime.now(timezone.utc)
    total_session_seconds = int((now - session.session_start).total_seconds())
    
    return {
        "session_id": session.id,
        "started_at": session.session_start,
        "active_duration_seconds": session.active_duration_seconds,
        "idle_duration_seconds": session.idle_duration_seconds,
        "total_session_seconds": total_session_seconds,
        "is_window_focused": session.is_window_focused,
        "is_mouse_in_window": session.is_mouse_in_window,
    }



@router.post("/activity/log", response_model=ActivityEventResponse)
async def log_activity(
    request: ActivityEventRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> ActivityEventResponse:
    """Log a single activity event."""
    event = ActivityEvent(
        id=uuid_lib.uuid4(),
        user_id=current_user.id,
        task_id=request.task_id,
        session_id=request.session_id,
        event_type=request.event_type,
        event_metadata=request.metadata or {},
    )
    db.add(event)
    
    if request.session_id:
        session = await db.get(TimeSession, request.session_id)
        if session and session.is_active:
            session.action_count += 1
            session.last_action_at = datetime.utcnow()
            
            if request.event_type == ActivityEventType.ANNOTATION_CREATE.value:
                session.annotations_created += 1
            elif request.event_type == ActivityEventType.ANNOTATION_UPDATE.value:
                session.annotations_updated += 1
            elif request.event_type == ActivityEventType.ANNOTATION_DELETE.value:
                session.annotations_deleted += 1
    
    await db.commit()
    
    return ActivityEventResponse(
        event_id=event.id,
        timestamp=event.timestamp,
    )


@router.post("/activity/batch")
async def log_activity_batch(
    request: BatchActivityRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Log multiple activity events at once (for buffered logging)."""
    events_logged = 0
    
    for event_req in request.events:
        event = ActivityEvent(
            id=uuid_lib.uuid4(),
            user_id=current_user.id,
            task_id=event_req.task_id or request.task_id,
            session_id=event_req.session_id or request.session_id,
            event_type=event_req.event_type,
            event_metadata=event_req.metadata or {},
        )
        db.add(event)
        events_logged += 1
    
    await db.commit()
    
    return {"events_logged": events_logged}



_LABEL_GOAL_TYPES = {"daily_labels", "weekly_labels", "monthly_labels"}
_AUTO_SOURCES_GOAL = ("auto", "airflow_model_v1", "airflow_model_v2", "auto_interpolated", "imported")


async def _count_labels_in_period(
    db: AsyncSession,
    user_id: uuid_lib.UUID,
    period_start: datetime,
    period_end: datetime,
) -> int:
    """Count human-created annotations for a user within a time window."""
    if period_start.tzinfo is None:
        period_start = period_start.replace(tzinfo=timezone.utc)
    if period_end.tzinfo is None:
        period_end = period_end.replace(tzinfo=timezone.utc)

    total = 0
    for Model in [Annotation, Annotation3D, Annotation2D, Annotation4D, AnnotationFusion]:
        result = await db.execute(
            select(func.count(Model.id))
            .join(Task, Model.task_id == Task.id)
            .where(
                and_(
                    Task.assignee_id == user_id,
                    Model.created_at >= period_start,
                    Model.created_at < period_end,
                    cast(Model.source, String).notin_(_AUTO_SOURCES_GOAL),
                )
            )
        )
        total += result.scalar() or 0
    return total


@router.get("/goals/my", response_model=List[UserGoalResponse])
async def get_my_goals(
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
    include_completed: bool = Query(False),
) -> List[UserGoalResponse]:
    """Get current user's goals with live progress computed from actual annotation counts."""
    now = datetime.utcnow()

    query = select(UserGoal).where(UserGoal.user_id == current_user.id)
    if not include_completed:
        query = query.where(UserGoal.period_end >= now)
    query = query.order_by(desc(UserGoal.period_start))

    result = await db.execute(query)
    goals = result.scalars().all()

    responses = []
    for g in goals:
        if g.goal_type in _LABEL_GOAL_TYPES:
            current_value = float(await _count_labels_in_period(
                db, current_user.id, g.period_start, g.period_end
            ))
            if current_value != g.current_value:
                g.current_value = current_value
                if current_value >= g.target_value and not g.is_achieved:
                    g.is_achieved = True
                    g.achieved_at = now
        else:
            current_value = g.current_value

        responses.append(UserGoalResponse(
            id=g.id,
            goal_type=g.goal_type,
            target_value=g.target_value,
            current_value=current_value,
            period_start=g.period_start,
            period_end=g.period_end,
            is_achieved=g.is_achieved,
            achieved_at=g.achieved_at,
            progress_percentage=min((current_value / g.target_value) * 100, 100) if g.target_value > 0 else 0,
            is_self_assigned=g.is_self_assigned,
        ))

    await db.commit()
    return responses


@router.post("/goals", response_model=UserGoalResponse)
async def create_goal(
    goal: UserGoalCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> UserGoalResponse:
    """Create a new personal goal."""
    new_goal = UserGoal(
        id=uuid_lib.uuid4(),
        user_id=current_user.id,
        goal_type=goal.goal_type,
        target_value=goal.target_value,
        period_start=goal.period_start,
        period_end=goal.period_end,
        is_self_assigned=True,
    )
    db.add(new_goal)
    await db.commit()
    
    return UserGoalResponse(
        id=new_goal.id,
        goal_type=new_goal.goal_type,
        target_value=new_goal.target_value,
        current_value=new_goal.current_value,
        period_start=new_goal.period_start,
        period_end=new_goal.period_end,
        is_achieved=new_goal.is_achieved,
        achieved_at=new_goal.achieved_at,
        progress_percentage=0,
        is_self_assigned=True,
    )


@router.put("/goals/{goal_id}", response_model=UserGoalResponse)
async def update_goal(
    goal_id: UUID,
    goal: UserGoalCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> UserGoalResponse:
    """Update a personal goal."""
    result = await db.execute(
        select(UserGoal).where(
            and_(
                UserGoal.id == goal_id,
                UserGoal.user_id == current_user.id,
            )
        )
    )
    existing_goal = result.scalar_one_or_none()
    
    if not existing_goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    
    existing_goal.goal_type = goal.goal_type
    existing_goal.target_value = goal.target_value
    existing_goal.period_start = goal.period_start
    existing_goal.period_end = goal.period_end
    
    await db.commit()
    await db.refresh(existing_goal)
    
    progress = min((existing_goal.current_value / existing_goal.target_value) * 100, 100) if existing_goal.target_value > 0 else 0
    
    return UserGoalResponse(
        id=existing_goal.id,
        goal_type=existing_goal.goal_type,
        target_value=existing_goal.target_value,
        current_value=existing_goal.current_value,
        period_start=existing_goal.period_start,
        period_end=existing_goal.period_end,
        is_achieved=existing_goal.is_achieved,
        achieved_at=existing_goal.achieved_at,
        progress_percentage=progress,
        is_self_assigned=existing_goal.is_self_assigned,
    )


@router.delete("/goals/{goal_id}")
async def delete_goal(
    goal_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Delete a personal goal."""
    result = await db.execute(
        select(UserGoal).where(
            and_(
                UserGoal.id == goal_id,
                UserGoal.user_id == current_user.id,
            )
        )
    )
    goal = result.scalar_one_or_none()
    
    if not goal:
        raise HTTPException(status_code=404, detail="Goal not found")
    
    await db.delete(goal)
    await db.commit()
    
    return {"status": "deleted"}



@router.get("/achievements/my", response_model=List[AchievementResponse])
async def get_my_achievements(
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> List[AchievementResponse]:
    """Get current user's achievements."""
    result = await db.execute(
        select(Achievement)
        .where(Achievement.user_id == current_user.id)
        .order_by(desc(Achievement.earned_at))
    )
    achievements = result.scalars().all()
    
    return [
        AchievementResponse(
            id=a.id,
            achievement_type=a.achievement_type,
            earned_at=a.earned_at,
            metadata=a.achievement_metadata or {},
            is_seen=a.is_seen,
            title=ACHIEVEMENT_INFO.get(a.achievement_type, {}).get("title", a.achievement_type),
            description=ACHIEVEMENT_INFO.get(a.achievement_type, {}).get("description", ""),
            icon=ACHIEVEMENT_INFO.get(a.achievement_type, {}).get("icon", "🏅"),
        )
        for a in achievements
    ]


@router.get("/achievements/unseen", response_model=List[AchievementResponse])
async def get_unseen_achievements(
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> List[AchievementResponse]:
    """Get current user's unseen achievements for notification purposes."""
    result = await db.execute(
        select(Achievement)
        .where(
            and_(
                Achievement.user_id == current_user.id,
                Achievement.is_seen == False,
            )
        )
        .order_by(desc(Achievement.earned_at))
    )
    achievements = result.scalars().all()
    
    return [
        AchievementResponse(
            id=a.id,
            achievement_type=a.achievement_type,
            earned_at=a.earned_at,
            metadata=a.achievement_metadata or {},
            is_seen=a.is_seen,
            title=ACHIEVEMENT_INFO.get(a.achievement_type, {}).get("title", a.achievement_type),
            description=ACHIEVEMENT_INFO.get(a.achievement_type, {}).get("description", ""),
            icon=ACHIEVEMENT_INFO.get(a.achievement_type, {}).get("icon", "🏅"),
        )
        for a in achievements
    ]


@router.post("/achievements/{achievement_id}/mark-seen")
async def mark_achievement_seen(
    achievement_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Mark an achievement as seen."""
    achievement = await db.get(Achievement, achievement_id)
    if not achievement:
        raise HTTPException(status_code=404, detail="Achievement not found")
    if achievement.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not your achievement")
    
    achievement.is_seen = True
    achievement.seen_at = datetime.utcnow()
    await db.commit()
    
    return {"status": "marked_seen"}



@router.get("/stats/my", response_model=EfficiencyStats)
async def get_my_efficiency_stats(
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
    organization_id: Optional[UUID] = Query(None),
    days: int = Query(1, description="Number of days for the period (1=today, 7=week, etc.)"),
) -> EfficiencyStats:
    """Get personal efficiency statistics for a given period."""
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    period_start = today_start - timedelta(days=days - 1)
    week_start = today_start - timedelta(days=today_start.weekday())
    
    _AUTO_SOURCES = ("auto", "airflow_model_v1", "airflow_model_v2", "auto_interpolated", "imported")

    async def count_user_annotations(since: datetime) -> int:
        """Count manually-created annotations for the current user since a given date."""
        total = 0

        for Model in [Annotation, Annotation3D, Annotation2D, Annotation4D, AnnotationFusion]:
            result = await db.execute(
                select(func.count(Model.id))
                .join(Task, Model.task_id == Task.id)
                .where(
                    and_(
                        Task.assignee_id == current_user.id,
                        Model.created_at >= since,
                        cast(Model.source, String).notin_(_AUTO_SOURCES),
                    )
                )
            )
            total += result.scalar() or 0

        return total
    
    period_labels = await count_user_annotations(period_start)
    week_labels = await count_user_annotations(week_start)
    
    period_active_time = 0
    
    sessions_period_result = await db.execute(
        select(func.sum(UserLoginSession.active_duration_seconds))
        .where(
            and_(
                UserLoginSession.user_id == current_user.id,
                UserLoginSession.session_start >= period_start,
            )
        )
    )
    sessions_period_time = int(sessions_period_result.scalar() or 0)

    period_active_time = sessions_period_time

    week_sessions_result = await db.execute(
        select(func.sum(UserLoginSession.active_duration_seconds))
        .where(
            and_(
                UserLoginSession.user_id == current_user.id,
                UserLoginSession.session_start >= week_start,
            )
        )
    )
    week_active_time = int(week_sessions_result.scalar() or 0)

    total_hours = period_active_time / 3600 if period_active_time > 0 else 0
    labels_per_hour = (period_labels / total_hours) if total_hours > 0 else 0

    streak = 0
    streak_cutoff = today_start - timedelta(days=365)
    active_days: set[str] = set()
    for AnnotationModel in [Annotation, Annotation3D, Annotation2D, Annotation4D, AnnotationFusion]:
        rows = await db.execute(
            select(func.date_trunc('day', AnnotationModel.created_at).label('day'))
            .join(Task, AnnotationModel.task_id == Task.id)
            .where(
                and_(
                    Task.assignee_id == current_user.id,
                    AnnotationModel.created_at >= streak_cutoff,
                    cast(AnnotationModel.source, String).notin_(_AUTO_SOURCES),
                )
            )
            .distinct()
        )
        for row in rows.all():
            if row[0]:
                active_days.add(row[0].strftime('%Y-%m-%d'))

    check_date = today_start
    for _ in range(365):
        if check_date.strftime('%Y-%m-%d') in active_days:
            streak += 1
            check_date -= timedelta(days=1)
        else:
            break
    
    sessions_result = await db.execute(
        select(func.count(UserLoginSession.id))
        .where(
            and_(
                UserLoginSession.user_id == current_user.id,
                or_(
                    UserLoginSession.session_start >= period_start,
                    and_(
                        UserLoginSession.is_active == True,
                        UserLoginSession.last_heartbeat_at >= period_start,
                    )
                ),
            )
        )
    )
    period_sessions = sessions_result.scalar() or 0
    
    acceptance_result = await db.execute(
        select(
            func.count(Task.id).filter(Task.status == TaskStatus.ACCEPTED),
            func.count(Task.id).filter(
                or_(
                    Task.status.in_([TaskStatus.ACCEPTED, TaskStatus.REJECTED, TaskStatus.SUBMITTED]),
                    Task.stage.in_(["qa", "customer_qa", "accepted"]),
                )
            ),
        )
        .where(Task.assignee_id == current_user.id)
    )
    acceptance_data = acceptance_result.first()
    accepted_count = acceptance_data[0] or 0
    total_reviewed = acceptance_data[1] or 0
    acceptance_rate = round(accepted_count / total_reviewed * 100, 1) if total_reviewed > 0 else None

    return EfficiencyStats(
        today_labels=period_labels,
        today_active_time_seconds=period_active_time,
        today_sessions=period_sessions,
        week_labels=week_labels,
        week_active_time_seconds=week_active_time,
        labels_per_hour=round(labels_per_hour, 2),
        acceptance_rate=acceptance_rate,
        current_streak_days=streak,
        rank_in_team=None,
        vs_team_avg_percentage=0,
    )



@router.get("/live/team", response_model=List[LiveUserStatus])
async def get_team_live_status(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DASHBOARD_VIEW_TEAM))],
    db: AsyncSession = Depends(get_db),
    organization_id: Optional[UUID] = Query(None),
) -> List[LiveUserStatus]:
    """Get real-time status of team members."""
    now = datetime.utcnow()
    active_threshold = now - timedelta(minutes=5)
    
    query = (
        select(TimeSession, User, Task)
        .join(User, TimeSession.user_id == User.id)
        .join(Task, TimeSession.task_id == Task.id)
        .where(TimeSession.is_active == True)
        .where(TimeSession.last_heartbeat_at >= active_threshold)
    )
    
    result = await db.execute(query)
    active_sessions = result.all()
    
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    
    statuses = []
    for session, user, task in active_sessions:
        labels_result = await db.execute(
            select(DailyUserStats.labels_created)
            .where(
                and_(
                    DailyUserStats.user_id == user.id,
                    DailyUserStats.stats_date == today_start,
                )
            )
        )
        labels_today = labels_result.scalar() or 0
        
        display_name = await get_display_name(db, user, current_user, organization_id)
        
        statuses.append(LiveUserStatus(
            user_id=user.id,
            display_name=display_name,
            current_task_id=task.id,
            current_task_name=task.name,
            is_active=not session.is_idle,
            last_activity=session.last_action_at or session.last_heartbeat_at,
            session_duration_seconds=session.active_duration_seconds,
            labels_today=labels_today,
        ))
    
    return sorted(statuses, key=lambda x: x.labels_today, reverse=True)


@router.get("/team-stats", response_model=List[TeamMemberStats])
async def get_team_stats(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DASHBOARD_VIEW_TEAM))],
    db: AsyncSession = Depends(get_db),
    organization_id: Optional[UUID] = Query(None),
    dataset_id: Optional[UUID] = Query(None),
    campaign_id: Optional[UUID] = Query(None),
    period: str = Query("today", enum=["today", "week", "month"]),
) -> List[TeamMemberStats]:
    """
    Get comprehensive statistics for all team members in the organization.
    Includes annotation breakdowns, workflow metrics, and quality scores.
    Can be filtered by dataset or campaign.
    """
    now = datetime.utcnow()
    active_threshold = now - timedelta(minutes=5)
    
    if period == "today":
        start_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        start_date = now - timedelta(days=7)
    else:
        start_date = now - timedelta(days=30)
    
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"Team stats filters: organization_id={organization_id}, campaign_id={campaign_id}, dataset_id={dataset_id}, period={period}")
    
    derived_org_id = organization_id
    
    if not derived_org_id and (campaign_id or dataset_id):
        if campaign_id:
            campaign_result = await db.execute(
                select(Campaign).where(Campaign.id == campaign_id)
            )
            campaign = campaign_result.scalar_one_or_none()
            if campaign:
                derived_org_id = campaign.organization_id
                logger.info(f"Derived organization_id {derived_org_id} from campaign {campaign_id}")
        elif dataset_id:
            dataset_result = await db.execute(
                select(Dataset).where(Dataset.id == dataset_id)
            )
            dataset = dataset_result.scalar_one_or_none()
            if dataset:
                campaign_result = await db.execute(
                    select(Campaign).where(Campaign.id == dataset.campaign_id)
                )
                campaign = campaign_result.scalar_one_or_none()
                if campaign:
                    derived_org_id = campaign.organization_id
    
    if derived_org_id:
        members_result = await db.execute(
            select(OrganizationMember, User)
            .join(User, OrganizationMember.user_id == User.id)
            .where(OrganizationMember.organization_id == derived_org_id)
            .where(User.is_active == True)
        )
        members = [(om, u) for om, u in members_result.all()]
    else:
        members_result = await db.execute(
            select(User).where(User.is_active == True)
        )
        members = [(None, u) for u in members_result.scalars().all()]
    
    active_sessions_result = await db.execute(
        select(TimeSession, Task)
        .join(Task, TimeSession.task_id == Task.id)
        .where(TimeSession.is_active == True)
        .where(TimeSession.last_heartbeat_at >= active_threshold)
    )
    active_sessions = {s.user_id: (s, t) for s, t in active_sessions_result.all()}

    login_online_threshold = now - timedelta(minutes=2)
    login_online_result = await db.execute(
        select(UserLoginSession.user_id)
        .where(
            UserLoginSession.is_active == True,
            UserLoginSession.last_heartbeat_at >= login_online_threshold,
        )
    )
    login_online_users = {row[0] for row in login_online_result.all()}
    
    
    AUTO_SOURCES = ("auto", "airflow_model_v1", "airflow_model_v2", "auto_interpolated", "imported")

    annotation3d_query = (
        select(
            Task.assignee_id.label("user_id"),
            func.count(Annotation3D.id).label("count"),
        )
        .select_from(Task)
        .join(Scene, Task.scene_id == Scene.id)
        .join(Dataset, Scene.dataset_id == Dataset.id)
        .join(Annotation3D, Annotation3D.task_id == Task.id)
        .where(Task.assignee_id.isnot(None))
        .where(Annotation3D.created_at >= start_date)
        .where(cast(Annotation3D.source, String).notin_(AUTO_SOURCES))
    )
    if dataset_id:
        annotation3d_query = annotation3d_query.where(Scene.dataset_id == dataset_id)
    if campaign_id:
        annotation3d_query = annotation3d_query.where(Dataset.campaign_id == campaign_id)
    annotation3d_query = annotation3d_query.group_by(Task.assignee_id)

    annotation3d_result = await db.execute(annotation3d_query)
    annotation3d_counts = {row.user_id: row.count for row in annotation3d_result.all()}

    annotation2d_query = (
        select(
            Task.assignee_id.label("user_id"),
            func.count(Annotation2D.id).label("count"),
        )
        .select_from(Task)
        .join(Scene, Task.scene_id == Scene.id)
        .join(Dataset, Scene.dataset_id == Dataset.id)
        .join(Annotation2D, Annotation2D.task_id == Task.id)
        .where(Task.assignee_id.isnot(None))
        .where(Annotation2D.created_at >= start_date)
        .where(cast(Annotation2D.source, String).notin_(AUTO_SOURCES))
    )
    if dataset_id:
        annotation2d_query = annotation2d_query.where(Scene.dataset_id == dataset_id)
    if campaign_id:
        annotation2d_query = annotation2d_query.where(Dataset.campaign_id == campaign_id)
    annotation2d_query = annotation2d_query.group_by(Task.assignee_id)

    annotation2d_result = await db.execute(annotation2d_query)
    annotation2d_counts = {row.user_id: row.count for row in annotation2d_result.all()}

    fusion_query = (
        select(
            Task.assignee_id.label("user_id"),
            func.count(AnnotationFusion.id).label("count"),
        )
        .select_from(Task)
        .join(Scene, Task.scene_id == Scene.id)
        .join(Dataset, Scene.dataset_id == Dataset.id)
        .join(AnnotationFusion, AnnotationFusion.task_id == Task.id)
        .where(Task.assignee_id.isnot(None))
        .where(AnnotationFusion.created_at >= start_date)
        .where(cast(AnnotationFusion.source, String).notin_(AUTO_SOURCES))
    )
    if dataset_id:
        fusion_query = fusion_query.where(Scene.dataset_id == dataset_id)
    if campaign_id:
        fusion_query = fusion_query.where(Dataset.campaign_id == campaign_id)
    fusion_query = fusion_query.group_by(Task.assignee_id)
    
    fusion_result = await db.execute(fusion_query)
    fusion_counts = {row.user_id: row.count for row in fusion_result.all()}
    
    logger.info(f"Annotation counts with filters (campaign={campaign_id}, dataset={dataset_id}): 3D={len(annotation3d_counts)}, 2D={len(annotation2d_counts)}, Fusion={len(fusion_counts)}")
    logger.info(f"3D counts by user: {annotation3d_counts}")
    logger.info(f"2D counts by user: {annotation2d_counts}")
    
    _accepted_condition = or_(
        Task.status == TaskStatus.ACCEPTED.value,
        Task.stage.in_(["qa", "customer_qa", "accepted"]),
    )
    _rejected_condition = Task.revision_count > 0

    task_workflow_query = (
        select(
            Task.assignee_id.label("user_id"),
            func.count(Task.id).label("total_tasks"),
            func.count(Task.id).filter(Task.status == TaskStatus.ASSIGNED.value).label("assigned"),
            func.count(Task.id).filter(Task.status == TaskStatus.IN_PROGRESS.value).label("in_progress"),
            func.count(Task.id).filter(Task.status == TaskStatus.SUBMITTED.value).label("submitted"),
            func.count(Task.id).filter(_accepted_condition).label("accepted"),
            func.count(Task.id).filter(_rejected_condition).label("rejected"),
            func.sum(Task.revision_count).label("total_revisions"),
        )
        .select_from(Task)
        .join(Scene, Task.scene_id == Scene.id)
        .join(Dataset, Scene.dataset_id == Dataset.id)
        .where(Task.assignee_id.isnot(None))
        .where(Task.updated_at >= start_date)
    )
    if dataset_id:
        task_workflow_query = task_workflow_query.where(Scene.dataset_id == dataset_id)
    if campaign_id:
        task_workflow_query = task_workflow_query.where(Dataset.campaign_id == campaign_id)
    task_workflow_query = task_workflow_query.group_by(Task.assignee_id)
    
    task_workflow_result = await db.execute(task_workflow_query)
    task_workflow = {row.user_id: row for row in task_workflow_result.all()}

    session_time_query = (
        select(
            TimeSession.user_id,
            func.sum(TimeSession.active_duration_seconds).label("total_active_time"),
        )
        .where(TimeSession.session_start >= start_date)
        .group_by(TimeSession.user_id)
    )
    session_time_result = await db.execute(session_time_query)
    session_times = {row.user_id: row.total_active_time or 0 for row in session_time_result.all()}
    
    login_session_time_query = (
        select(
            UserLoginSession.user_id,
            func.sum(UserLoginSession.active_duration_seconds).label("total_active_time"),
        )
        .where(UserLoginSession.session_start >= start_date)
        .group_by(UserLoginSession.user_id)
    )
    login_session_time_result = await db.execute(login_session_time_query)
    login_session_times = {row.user_id: row.total_active_time or 0 for row in login_session_time_result.all()}

    task_time_query = (
        select(
            Task.assignee_id,
            func.sum(Task.total_time_seconds).label("total_task_time"),
        )
        .where(
            Task.assignee_id.isnot(None),
            Task.is_deleted == False,
            Task.total_time_seconds > 0,
        )
        .group_by(Task.assignee_id)
    )
    task_time_result = await db.execute(task_time_query)
    task_total_times = {row.assignee_id: row.total_task_time or 0 for row in task_time_result.all()}
    
    team_stats = []
    for org_member, user in members:
        session_data = active_sessions.get(user.id)
        is_online = session_data is not None or user.id in login_online_users
        current_task_id = None
        current_task_name = None
        session_duration = 0
        is_active = False
        last_activity = None
        
        if session_data:
            session, task = session_data
            current_task_id = task.id
            current_task_name = task.name
            session_duration = session.active_duration_seconds or 0
            is_active = not session.is_idle
            last_activity = session.last_action_at or session.last_heartbeat_at
        elif user.id in login_online_users:
            login_sess_result = await db.execute(
                select(UserLoginSession)
                .where(UserLoginSession.user_id == user.id, UserLoginSession.is_active == True)
                .order_by(UserLoginSession.last_heartbeat_at.desc())
                .limit(1)
            )
            login_sess = login_sess_result.scalar_one_or_none()
            if login_sess:
                last_activity = login_sess.last_heartbeat_at
        
        cuboids_3d = annotation3d_counts.get(user.id, 0)
        boxes_2d = annotation2d_counts.get(user.id, 0)
        fusion = fusion_counts.get(user.id, 0)
        total_annotations = cuboids_3d + boxes_2d + fusion
        
        annotations = AnnotationBreakdown(
            cuboids_3d=cuboids_3d,
            boxes_2d=boxes_2d,
            fusion=fusion,
            total=total_annotations,
        )
        
        wf = task_workflow.get(user.id)
        tasks_assigned = wf.assigned if wf else 0
        tasks_in_progress = wf.in_progress if wf else 0
        tasks_submitted = wf.submitted if wf else 0
        tasks_accepted = wf.accepted if wf else 0
        tasks_rejected = wf.rejected if wf else 0
        revision_count = int(wf.total_revisions or 0) if wf else 0
        
        workflow = WorkflowMetrics(
            tasks_assigned=tasks_assigned,
            tasks_in_progress=tasks_in_progress,
            tasks_submitted=tasks_submitted,
            tasks_accepted=tasks_accepted,
            tasks_rejected=tasks_rejected,
            revision_count=revision_count,
        )
        
        total_reviewed = tasks_accepted + tasks_rejected
        first_time_acceptance_rate = 0.0
        rejection_rate = 0.0
        quality_score = 0.0

        if total_reviewed > 0:
            first_time_acceptance_rate = round(
                ((tasks_accepted - min(revision_count, tasks_accepted)) / max(tasks_accepted, 1)) * 100, 1
            )
            rejection_rate = round((tasks_rejected / total_reviewed) * 100, 1)
            workflow_score = max(0.0, min(100.0,
                100 - (rejection_rate * 0.5) - (revision_count * 2)
            ))
            quality_score = round(workflow_score, 1)

        quality = QualityMetrics(
            first_time_acceptance_rate=first_time_acceptance_rate,
            rejection_rate=rejection_rate,
            revision_turnaround_hours=0.0,
            quality_score=round(quality_score, 1),
        )
        
        task_session_time = session_times.get(user.id, 0)
        login_session_time = login_session_times.get(user.id, 0)
        task_total_time = task_total_times.get(user.id, 0)

        if task_total_time > 0:
            active_time = task_total_time
        elif task_session_time > 0:
            active_time = task_session_time
        else:
            active_time = login_session_time

        labels_per_hour = 0.0
        avg_time_per_label = 0.0

        MIN_TRACKING_TIME = 60
        if active_time >= MIN_TRACKING_TIME and total_annotations > 0:
            hours = active_time / 3600
            labels_per_hour = round(total_annotations / hours, 1)
            avg_time_per_label = round(active_time / total_annotations, 1)
        
        display_name = await get_display_name(db, user, current_user, derived_org_id)
        role = org_member.role if org_member else (user.role if hasattr(user, 'role') else None)
        
        team_stats.append(TeamMemberStats(
            user_id=user.id,
            display_name=display_name,
            email=user.email if hasattr(user, 'email') else None,
            role=role,
            is_online=is_online,
            is_active=is_active,
            current_task_id=current_task_id,
            current_task_name=current_task_name,
            last_activity=last_activity,
            session_duration_seconds=session_duration,
            annotations=annotations,
            workflow=workflow,
            quality=quality,
            active_time_seconds=active_time,
            labels_per_hour=labels_per_hour,
            avg_time_per_label_seconds=avg_time_per_label,
            period_start=start_date,
            period_end=now,
        ))
    
    return sorted(team_stats, key=lambda x: (not x.is_online, -x.annotations.total))



@router.get("/leaderboard", response_model=List[LeaderboardEntry])
async def get_leaderboard(
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
    organization_id: Optional[UUID] = Query(None),
    period: str = Query("week", enum=["today", "week", "month", "all_time"]),
    limit: int = Query(10, ge=1, le=100),
) -> List[LeaderboardEntry]:
    """Get leaderboard for the organization."""
    now = datetime.utcnow()
    
    if period == "today":
        start_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        start_date = now - timedelta(days=7)
    elif period == "month":
        start_date = now - timedelta(days=30)
    else:
        start_date = datetime(2020, 1, 1)
    
    org_member_ids: set[UUID] = set()
    if organization_id:
        members_result = await db.execute(
            select(OrganizationMember.user_id)
            .where(OrganizationMember.organization_id == organization_id)
        )
        org_member_ids = {row[0] for row in members_result.all()}
        if not org_member_ids:
            return []
    
    _LEADERBOARD_AUTO_SOURCES = ("auto", "airflow_model_v1", "airflow_model_v2", "auto_interpolated", "imported")

    async def get_user_annotation_counts(annotation_model) -> dict:
        """Get annotation counts grouped by user (via task assignment)."""
        query = (
            select(
                Task.assignee_id,
                func.count(annotation_model.id).label("count"),
            )
            .join(Task, annotation_model.task_id == Task.id)
            .where(
                and_(
                    annotation_model.created_at >= start_date,
                    Task.assignee_id.isnot(None),
                    Task.is_deleted == False,
                    cast(annotation_model.source, String).notin_(_LEADERBOARD_AUTO_SOURCES),
                )
            )
            .group_by(Task.assignee_id)
        )
        result = await db.execute(query)
        return {row[0]: row[1] for row in result.all()}
    
    user_labels: dict[UUID, int] = {}
    
    for annotation_model in [Annotation, Annotation3D, Annotation2D, Annotation4D, AnnotationFusion]:
        counts = await get_user_annotation_counts(annotation_model)
        for user_id, count in counts.items():
            if organization_id and user_id not in org_member_ids:
                continue
            user_labels[user_id] = user_labels.get(user_id, 0) + count
    
    sorted_users = sorted(user_labels.items(), key=lambda x: x[1], reverse=True)[:limit]
    
    if not sorted_users:
        return []
    
    user_times: dict[UUID, int] = {}
    user_ids = [u[0] for u in sorted_users]

    time_result = await db.execute(
        select(
            Task.assignee_id,
            func.sum(Task.total_time_seconds).label("total_time"),
        )
        .where(
            and_(
                Task.assignee_id.in_(user_ids),
                Task.is_deleted == False,
                Task.total_time_seconds > 0,
            )
        )
        .group_by(Task.assignee_id)
    )
    for row in time_result.all():
        user_times[row[0]] = row[1] or 0
    
    async def get_streak_days(user_id: UUID) -> int:
        streak = 0
        check_date = now.replace(hour=0, minute=0, second=0, microsecond=0)
        for _ in range(365):
            day_start = check_date
            day_end = check_date + timedelta(days=1)
            has_labels = False
            
            for AnnotationModel in [Annotation, Annotation3D, Annotation2D, Annotation4D, AnnotationFusion]:
                result = await db.execute(
                    select(func.count(AnnotationModel.id))
                    .join(Task, AnnotationModel.task_id == Task.id)
                    .where(
                        and_(
                            Task.assignee_id == user_id,
                            AnnotationModel.created_at >= day_start,
                            AnnotationModel.created_at < day_end,
                        )
                    )
                )
                if (result.scalar() or 0) > 0:
                    has_labels = True
                    break
            
            if has_labels:
                streak += 1
                check_date -= timedelta(days=1)
            else:
                break
        return streak
    
    entries = []
    for rank, (user_id, total_labels) in enumerate(sorted_users, 1):
        user = await db.get(User, user_id)
        if not user:
            continue
            
        display_name = await get_display_name(db, user, current_user, organization_id)
        
        total_time = user_times.get(user_id, 0)
        avg_time = (total_time / total_labels) if total_labels > 0 else 0
        
        streak = 0
        if rank <= 5:
            streak = await get_streak_days(user_id)
        
        entries.append(LeaderboardEntry(
            rank=rank,
            user_id=user_id,
            display_name=display_name,
            labels_count=total_labels or 0,
            acceptance_rate=0,
            avg_time_per_label_seconds=avg_time,
            streak_days=streak,
        ))
    
    return entries



@router.get("/alerts", response_model=List[PerformanceAlertResponse])
async def get_performance_alerts(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DASHBOARD_VIEW_TEAM))],
    db: AsyncSession = Depends(get_db),
    organization_id: Optional[UUID] = Query(None),
    include_acknowledged: bool = Query(False),
    limit: int = Query(50, ge=1, le=200),
) -> List[PerformanceAlertResponse]:
    """Get performance alerts for team."""
    query = (
        select(PerformanceAlert, User)
        .join(User, PerformanceAlert.user_id == User.id)
        .order_by(desc(PerformanceAlert.created_at))
        .limit(limit)
    )
    
    if not include_acknowledged:
        query = query.where(PerformanceAlert.is_acknowledged == False)
    
    result = await db.execute(query)
    alerts = result.all()
    
    responses = []
    for alert, user in alerts:
        display_name = await get_display_name(db, user, current_user, organization_id)
        responses.append(PerformanceAlertResponse(
            id=alert.id,
            user_id=user.id,
            display_name=display_name,
            alert_type=alert.alert_type,
            severity=alert.severity,
            title=alert.title,
            message=alert.message,
            metrics=alert.metrics or {},
            is_acknowledged=alert.is_acknowledged,
            created_at=alert.created_at,
        ))
    
    return responses


@router.post("/alerts/{alert_id}/acknowledge")
async def acknowledge_alert(
    alert_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DASHBOARD_VIEW_TEAM))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Acknowledge a performance alert."""
    alert = await db.get(PerformanceAlert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")
    
    alert.is_acknowledged = True
    alert.acknowledged_by_id = current_user.id
    alert.acknowledged_at = datetime.utcnow()
    
    await db.commit()
    
    return {"status": "acknowledged"}



_CHALLENGE_LABEL_TYPES = {"total_labels", "daily_labels", "weekly_labels", "labels"}
_CHALLENGE_AUTO_SOURCES = ("auto", "airflow_model_v1", "airflow_model_v2", "auto_interpolated", "imported")


async def _compute_challenge_progress(
    db: AsyncSession,
    challenge: "TeamChallenge",
    org_member_ids: list,
) -> dict[uuid_lib.UUID, float]:
    """
    Count each org member's label contributions within the challenge period.
    Returns {user_id: label_count}.
    """
    if challenge.goal_type not in _CHALLENGE_LABEL_TYPES:
        return {}

    start = challenge.start_date
    end = challenge.end_date
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    if end.tzinfo is None:
        end = end.replace(tzinfo=timezone.utc)

    user_counts: dict[uuid_lib.UUID, float] = {}
    for Model in [Annotation, Annotation3D, Annotation2D, Annotation4D, AnnotationFusion]:
        result = await db.execute(
            select(Task.assignee_id, func.count(Model.id).label("cnt"))
            .join(Task, Model.task_id == Task.id)
            .where(
                and_(
                    Task.assignee_id.in_(org_member_ids),
                    Model.created_at >= start,
                    Model.created_at < end,
                    cast(Model.source, String).notin_(_CHALLENGE_AUTO_SOURCES),
                )
            )
            .group_by(Task.assignee_id)
        )
        for row in result.all():
            uid, cnt = row[0], row[1]
            user_counts[uid] = user_counts.get(uid, 0.0) + float(cnt)

    return user_counts


@router.get("/challenges", response_model=List[TeamChallengeResponse])
async def get_challenges(
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
    organization_id: Optional[UUID] = Query(None),
    include_completed: bool = Query(False),
) -> List[TeamChallengeResponse]:
    """Get team challenges with live progress computed from actual annotation counts."""
    now = datetime.now(timezone.utc)

    query = (
        select(TeamChallenge)
        .options(selectinload(TeamChallenge.participants))
    )
    if organization_id:
        query = query.where(TeamChallenge.organization_id == organization_id)
    if not include_completed:
        query = query.where(TeamChallenge.is_active == True)
    query = query.order_by(desc(TeamChallenge.start_date))

    result = await db.execute(query)
    challenges = result.scalars().all()

    responses = []
    for challenge in challenges:
        members_result = await db.execute(
            select(OrganizationMember.user_id)
            .where(OrganizationMember.organization_id == challenge.organization_id)
        )
        org_member_ids = [row[0] for row in members_result.all()]

        user_counts = await _compute_challenge_progress(db, challenge, org_member_ids)

        total = sum(user_counts.values())

        if total != challenge.current_value:
            challenge.current_value = total
            if total >= challenge.target_value and not challenge.is_completed:
                challenge.is_completed = True
                challenge.completed_at = now

        sorted_users = sorted(user_counts.items(), key=lambda x: x[1], reverse=True)[:5]
        top_contributors = []
        for rank, (uid, cnt) in enumerate(sorted_users, 1):
            if cnt <= 0:
                continue
            user = await db.get(User, uid)
            if user:
                display_name = await get_display_name(db, user, current_user, organization_id)
                top_contributors.append(LeaderboardEntry(
                    rank=rank,
                    user_id=uid,
                    display_name=display_name,
                    labels_count=int(cnt),
                    acceptance_rate=0,
                    avg_time_per_label_seconds=0,
                    streak_days=0,
                ))

        participant_count = sum(1 for c in user_counts.values() if c > 0)

        progress = min((total / challenge.target_value * 100), 100) if challenge.target_value > 0 else 0

        responses.append(TeamChallengeResponse(
            id=challenge.id,
            title=challenge.title,
            description=challenge.description,
            goal_type=challenge.goal_type,
            target_value=challenge.target_value,
            current_value=total,
            progress_percentage=progress,
            start_date=challenge.start_date,
            end_date=challenge.end_date,
            is_active=challenge.is_active,
            is_completed=challenge.is_completed,
            participant_count=participant_count,
            top_contributors=top_contributors,
        ))

    await db.commit()
    return responses


@router.post("/challenges", response_model=TeamChallengeResponse)
async def create_challenge(
    request: CreateChallengeRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> TeamChallengeResponse:
    """Create a new team challenge."""
    org_id = request.organization_id
    if not org_id:
        from app.models import OrganizationMember
        result = await db.execute(
            select(OrganizationMember.organization_id)
            .where(OrganizationMember.user_id == current_user.id)
            .limit(1)
        )
        org_id = result.scalar_one_or_none()
        if not org_id:
            raise HTTPException(
                status_code=400,
                detail="No organization found for user",
            )
    
    challenge = TeamChallenge(
        organization_id=org_id,
        title=request.title,
        description=request.description,
        goal_type=request.goal_type,
        target_value=request.target_value,
        current_value=0,
        start_date=request.start_date,
        end_date=request.end_date,
        is_active=True,
        is_completed=False,
        created_by_id=current_user.id,
    )
    
    db.add(challenge)
    await db.commit()
    await db.refresh(challenge)
    
    return TeamChallengeResponse(
        id=challenge.id,
        title=challenge.title,
        description=challenge.description,
        goal_type=challenge.goal_type,
        target_value=challenge.target_value,
        current_value=0,
        progress_percentage=0,
        start_date=challenge.start_date,
        end_date=challenge.end_date,
        is_active=True,
        is_completed=False,
        participant_count=0,
        top_contributors=[],
    )


@router.put("/challenges/{challenge_id}", response_model=TeamChallengeResponse)
async def update_challenge(
    challenge_id: UUID,
    request: CreateChallengeRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> TeamChallengeResponse:
    """Update a team challenge."""
    result = await db.execute(
        select(TeamChallenge)
        .options(selectinload(TeamChallenge.participants))
        .where(TeamChallenge.id == challenge_id)
    )
    challenge = result.scalar_one_or_none()
    
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    
    if challenge.created_by_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized to edit this challenge")
    
    challenge.title = request.title
    challenge.description = request.description
    challenge.goal_type = request.goal_type
    challenge.target_value = request.target_value
    challenge.start_date = request.start_date
    challenge.end_date = request.end_date
    
    await db.commit()
    await db.refresh(challenge)
    
    progress = (challenge.current_value / challenge.target_value * 100) if challenge.target_value > 0 else 0
    
    return TeamChallengeResponse(
        id=challenge.id,
        title=challenge.title,
        description=challenge.description,
        goal_type=challenge.goal_type,
        target_value=challenge.target_value,
        current_value=challenge.current_value,
        progress_percentage=min(progress, 100),
        start_date=challenge.start_date,
        end_date=challenge.end_date,
        is_active=challenge.is_active,
        is_completed=challenge.is_completed,
        participant_count=len(challenge.participants),
        top_contributors=[],
    )


@router.delete("/challenges/{challenge_id}")
async def delete_challenge(
    challenge_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Delete a team challenge."""
    result = await db.execute(
        select(TeamChallenge).where(TeamChallenge.id == challenge_id)
    )
    challenge = result.scalar_one_or_none()
    
    if not challenge:
        raise HTTPException(status_code=404, detail="Challenge not found")
    
    if challenge.created_by_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not authorized to delete this challenge")
    
    await db.delete(challenge)
    await db.commit()
    
    return {"status": "deleted"}


@router.get("/team-member-report/{user_id}")
async def get_team_member_report(
    user_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DASHBOARD_VIEW_GLOBAL))],
    db: AsyncSession = Depends(get_db),
    organization_id: Optional[UUID] = Query(None),
    days: int = Query(30, ge=1, le=365),
):
    """Return full stats for one team member as a JSON dict for CSV export."""
    now = datetime.now(timezone.utc)
    start_date = now - timedelta(days=days)

    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    display_name = user.full_name or user.username

    base_user_filter = [Task.assignee_id == user_id, Task.is_deleted == False]
    if organization_id:
        base_user_filter.append(
            Task.scene_id.in_(
                select(Scene.id)
                .join(Dataset, Scene.dataset_id == Dataset.id)
                .join(Campaign, Dataset.campaign_id == Campaign.id)
                .where(Campaign.organization_id == organization_id, Campaign.is_deleted == False)
            )
        )

    task_rows = await db.execute(
        select(
            func.count(Task.id).label("total_tasks"),
            func.sum(Task.total_time_seconds).label("total_time"),
            func.sum(func.upper(Task.frame_range) - func.lower(Task.frame_range)).label("total_frames"),
            func.sum(Task.revision_count).label("total_revisions"),
            func.sum(case((Task.status == "accepted", 1), else_=0)).label("accepted"),
            func.sum(case((Task.status == "rejected", 1), else_=0)).label("rejected"),
            func.sum(case((Task.status.in_(["submitted", "accepted"]), 1), else_=0)).label("submitted"),
        )
        .where(and_(*base_user_filter))
    )
    t = task_rows.fetchone()
    total_tasks = t.total_tasks or 0
    total_time = t.total_time or 0
    total_frames = t.total_frames or 0
    total_revisions = t.total_revisions or 0
    accepted = t.accepted or 0
    rejected = t.rejected or 0
    submitted = t.submitted or 0
    total_reviewed = accepted + rejected

    total_labels = 0
    for model in [Annotation, Annotation3D, Annotation2D, AnnotationFusion]:
        r = await db.scalar(
            select(func.count(model.id))
            .join(Task, model.task_id == Task.id)
            .where(and_(*base_user_filter))
        )
        total_labels += r or 0
    r4d = await db.scalar(
        select(func.count(Annotation4D.id))
        .join(Task, Annotation4D.task_id == Task.id)
        .where(and_(*base_user_filter))
    )
    total_labels += r4d or 0

    hours = total_time / 3600 if total_time > 0 else 0
    labels_per_hour = round(total_labels / hours, 1) if hours > 0 else 0.0
    frames_per_hour = round(total_frames / hours, 1) if hours > 0 else 0.0
    avg_time_per_task = round(total_time / total_tasks, 1) if total_tasks > 0 else 0.0
    avg_time_per_frame = round(total_time / total_frames, 1) if total_frames > 0 else 0.0
    avg_time_per_label = round(total_time / total_labels, 1) if total_labels > 0 else 0.0

    acceptance_rate = round(accepted / total_reviewed * 100, 1) if total_reviewed > 0 else None
    rejection_rate = round(rejected / total_reviewed * 100, 1) if total_reviewed > 0 else None

    def fmt(secs: int) -> str:
        if not secs: return "0s"
        h, r = divmod(secs, 3600)
        m, s = divmod(r, 60)
        if h: return f"{h}h {m}m {s}s"
        if m: return f"{m}m {s}s"
        return f"{s}s"

    slowest_task_row = await db.execute(
        select(Task.name, Task.total_time_seconds)
        .where(and_(*base_user_filter, Task.total_time_seconds > 0))
        .order_by(desc(Task.total_time_seconds)).limit(1)
    )
    slowest = slowest_task_row.fetchone()

    fastest_task_row = await db.execute(
        select(Task.name, Task.total_time_seconds)
        .where(and_(*base_user_filter, Task.total_time_seconds > 0))
        .order_by(Task.total_time_seconds).limit(1)
    )
    fastest = fastest_task_row.fetchone()

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
    if organization_id:
        active_scene_subq = active_scene_subq.where(Campaign.organization_id == organization_id)

    task_filter = [
        Task.assignee_id == user_id,
        Task.is_deleted == False,
        Task.scene_id.in_(active_scene_subq),
        or_(
            Task.total_time_seconds > 0,
            Task.started_at != None,
        ),
    ]

    all_tasks_result = await db.execute(
        select(
            Task.id, Task.name, Task.status, Task.stage,
            Task.total_time_seconds, Task.revision_count,
            Task.frame_range, Task.assigned_at, Task.submitted_at, Task.started_at,
            Task.taxonomy_id,
            Scene.name.label("scene_name"),
            Dataset.name.label("dataset_name"),
            Taxonomy.name.label("taxonomy_name"),
        )
        .join(Scene, Task.scene_id == Scene.id)
        .join(Dataset, Scene.dataset_id == Dataset.id)
        .outerjoin(Taxonomy, Task.taxonomy_id == Taxonomy.id)
        .where(and_(*task_filter))
        .order_by(Task.created_at)
    )
    all_tasks_rows = all_tasks_result.mappings().all()

    from sqlalchemy import distinct as _distinct

    task_details = []
    for row in all_tasks_rows:
        task_id = row["id"]
        frame_range = row["frame_range"]
        frame_count = (frame_range.upper - frame_range.lower) if frame_range else 0
        task_time = row["total_time_seconds"] or 0
        tax_id = row["taxonomy_id"]
        tax_name = row["taxonomy_name"] or ""

        task_labels = 0
        for model in [Annotation3D, Annotation2D, Annotation]:
            q = select(func.count(model.id)).where(model.task_id == task_id)
            if tax_id is not None and hasattr(model, 'taxonomy_id'):
                q = q.where(model.taxonomy_id == tax_id)
            task_labels += await db.scalar(q) or 0

        frames_visited = 0
        for model in [Annotation3D, Annotation2D]:
            q = select(func.count(_distinct(model.frame_id))).where(model.task_id == task_id)
            if tax_id is not None:
                q = q.where(model.taxonomy_id == tax_id)
            frames_visited = max(frames_visited, await db.scalar(q) or 0)

        avg_time_per_frame = round(task_time / frames_visited, 1) if frames_visited > 0 else 0
        started_at = row["started_at"]
        submitted_at = row["submitted_at"] if row["stage"] != "annotation" else None

        task_details.append({
            "task_name": row["name"] or "",
            "taxonomy": tax_name,
            "scene": row["scene_name"] or "",
            "dataset": row["dataset_name"] or "",
            "status": row["status"] or "",
            "stage": row["stage"] or "",
            "total_frames": frame_count,
            "frames_visited": frames_visited,
            "labels_created": task_labels,
            "active_time": fmt(task_time),
            "avg_time_per_frame": fmt(int(avg_time_per_frame)) if avg_time_per_frame else "—",
            "revision_count": row["revision_count"] or 0,
            "start_time": started_at.strftime("%Y-%m-%d %H:%M") if started_at else "",
            "end_time": submitted_at.strftime("%Y-%m-%d %H:%M") if submitted_at else "—",
        })

    return {
        "annotator": display_name,
        "report_period_days": days,
        "total_tasks_worked": total_tasks,
        "total_frames_completed": total_frames,
        "total_labels_created": total_labels,
        "active_time_seconds": total_time,
        "active_time_formatted": fmt(total_time),
        "avg_time_per_task_seconds": avg_time_per_task,
        "avg_time_per_task_formatted": fmt(int(avg_time_per_task)),
        "avg_time_per_frame_seconds": avg_time_per_frame,
        "avg_time_per_frame_formatted": fmt(int(avg_time_per_frame)),
        "avg_time_per_label_seconds": avg_time_per_label,
        "avg_time_per_label_formatted": fmt(int(avg_time_per_label)),
        "labels_per_hour": labels_per_hour,
        "frames_per_hour": frames_per_hour,
        "acceptance_rate_pct": acceptance_rate,
        "rejection_rate_pct": rejection_rate,
        "rework_count": total_revisions,
        "tasks_submitted": submitted,
        "tasks_accepted": accepted,
        "tasks_rejected": rejected,
        "most_time_consuming_task": slowest.name if slowest else "N/A",
        "most_time_consuming_task_time": fmt(slowest.total_time_seconds) if slowest else "N/A",
        "fastest_task": fastest.name if fastest else "N/A",
        "fastest_task_time": fmt(fastest.total_time_seconds) if fastest else "N/A",
        "task_details": task_details,
    }
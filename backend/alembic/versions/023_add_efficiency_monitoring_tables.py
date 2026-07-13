"""Add efficiency monitoring tables

Revision ID: 023
Revises: 022
Create Date: 2026-02-13

This migration adds tables for the efficiency monitoring system:
- time_sessions: Track actual working sessions on tasks
- activity_events: Granular activity events for engagement tracking
- user_goals: Personal and assigned goals for annotators
- achievements: Badges/achievements earned by users
- performance_alerts: Alerts for performance issues
- daily_user_stats: Pre-aggregated daily statistics
- team_challenges: Team-wide challenges for gamification
- challenge_participants: Individual participation in challenges
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '023'
down_revision = '022'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ===========================================================================
    # TIME SESSIONS TABLE
    # ===========================================================================
    op.create_table(
        'time_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        
        # Session timing
        sa.Column('session_start', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('session_end', sa.DateTime(timezone=True), nullable=True),
        
        # Duration tracking
        sa.Column('active_duration_seconds', sa.Integer, default=0),
        sa.Column('idle_duration_seconds', sa.Integer, default=0),
        
        # Engagement metrics
        sa.Column('heartbeat_count', sa.Integer, default=0),
        sa.Column('action_count', sa.Integer, default=0),
        sa.Column('annotations_created', sa.Integer, default=0),
        sa.Column('annotations_updated', sa.Integer, default=0),
        sa.Column('annotations_deleted', sa.Integer, default=0),
        sa.Column('frames_visited', sa.Integer, default=0),
        
        # Activity tracking
        sa.Column('last_heartbeat_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('last_action_at', sa.DateTime(timezone=True), nullable=True),
        
        # Session state
        sa.Column('is_active', sa.Boolean, default=True),
        sa.Column('is_idle', sa.Boolean, default=False),
        
        # Browser/client info
        sa.Column('client_info', postgresql.JSONB, default=dict),
    )
    
    op.create_index('ix_time_sessions_user_id', 'time_sessions', ['user_id'])
    op.create_index('ix_time_sessions_task_id', 'time_sessions', ['task_id'])
    op.create_index('ix_time_sessions_session_start', 'time_sessions', ['session_start'])
    op.create_index('ix_time_sessions_is_active', 'time_sessions', ['is_active'])
    op.create_index('ix_time_sessions_user_task_active', 'time_sessions', ['user_id', 'task_id', 'is_active'])
    
    # ===========================================================================
    # ACTIVITY EVENTS TABLE
    # ===========================================================================
    op.create_table(
        'activity_events',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=True),
        sa.Column('session_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('time_sessions.id', ondelete='SET NULL'), nullable=True),
        sa.Column('event_type', sa.String(50), nullable=False),
        sa.Column('timestamp', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('event_metadata', postgresql.JSONB, default=dict),
    )
    
    op.create_index('ix_activity_events_user_id', 'activity_events', ['user_id'])
    op.create_index('ix_activity_events_task_id', 'activity_events', ['task_id'])
    op.create_index('ix_activity_events_session_id', 'activity_events', ['session_id'])
    op.create_index('ix_activity_events_timestamp', 'activity_events', ['timestamp'])
    op.create_index('ix_activity_events_event_type', 'activity_events', ['event_type'])
    op.create_index('ix_activity_events_user_timestamp', 'activity_events', ['user_id', 'timestamp'])
    
    # ===========================================================================
    # USER GOALS TABLE
    # ===========================================================================
    op.create_table(
        'user_goals',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        
        # Goal definition
        sa.Column('goal_type', sa.String(50), nullable=False),
        sa.Column('target_value', sa.Float, nullable=False),
        sa.Column('current_value', sa.Float, default=0),
        
        # Period
        sa.Column('period_start', sa.DateTime(timezone=True), nullable=False),
        sa.Column('period_end', sa.DateTime(timezone=True), nullable=False),
        
        # Status
        sa.Column('is_achieved', sa.Boolean, default=False),
        sa.Column('achieved_at', sa.DateTime(timezone=True), nullable=True),
        
        # Assignment
        sa.Column('is_self_assigned', sa.Boolean, default=True),
        sa.Column('assigned_by_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        
        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    
    op.create_index('ix_user_goals_user_id', 'user_goals', ['user_id'])
    op.create_index('ix_user_goals_period', 'user_goals', ['period_start', 'period_end'])
    op.create_index('ix_user_goals_user_period', 'user_goals', ['user_id', 'period_start', 'period_end'])
    
    # ===========================================================================
    # ACHIEVEMENTS TABLE
    # ===========================================================================
    op.create_table(
        'achievements',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('achievement_type', sa.String(50), nullable=False),
        sa.Column('earned_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('achievement_metadata', postgresql.JSONB, default=dict),
        sa.Column('is_seen', sa.Boolean, default=False),
        sa.Column('seen_at', sa.DateTime(timezone=True), nullable=True),
    )
    
    op.create_index('ix_achievements_user_id', 'achievements', ['user_id'])
    op.create_index('ix_achievements_type', 'achievements', ['achievement_type'])
    op.create_index('ix_achievements_earned_at', 'achievements', ['earned_at'])
    op.create_unique_constraint('uq_user_achievement', 'achievements', ['user_id', 'achievement_type'])
    
    # ===========================================================================
    # PERFORMANCE ALERTS TABLE
    # ===========================================================================
    op.create_table(
        'performance_alerts',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=True),
        
        # Alert details
        sa.Column('alert_type', sa.String(50), nullable=False),
        sa.Column('severity', sa.String(20), default='warning', nullable=False),
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('message', sa.Text, nullable=False),
        sa.Column('metrics', postgresql.JSONB, default=dict),
        
        # Status
        sa.Column('is_acknowledged', sa.Boolean, default=False),
        sa.Column('acknowledged_by_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('acknowledged_at', sa.DateTime(timezone=True), nullable=True),
        
        # Resolution
        sa.Column('is_resolved', sa.Boolean, default=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('resolution_notes', sa.Text, nullable=True),
        
        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    
    op.create_index('ix_performance_alerts_user_id', 'performance_alerts', ['user_id'])
    op.create_index('ix_performance_alerts_task_id', 'performance_alerts', ['task_id'])
    op.create_index('ix_performance_alerts_severity', 'performance_alerts', ['severity'])
    op.create_index('ix_performance_alerts_created_at', 'performance_alerts', ['created_at'])
    op.create_index('ix_performance_alerts_is_acknowledged', 'performance_alerts', ['is_acknowledged'])
    
    # ===========================================================================
    # DAILY USER STATS TABLE
    # ===========================================================================
    op.create_table(
        'daily_user_stats',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('stats_date', sa.DateTime(timezone=True), nullable=False),
        
        # Productivity metrics
        sa.Column('labels_created', sa.Integer, default=0),
        sa.Column('labels_updated', sa.Integer, default=0),
        sa.Column('labels_deleted', sa.Integer, default=0),
        
        # Task metrics
        sa.Column('tasks_started', sa.Integer, default=0),
        sa.Column('tasks_submitted', sa.Integer, default=0),
        sa.Column('tasks_completed', sa.Integer, default=0),
        sa.Column('tasks_rejected', sa.Integer, default=0),
        
        # Time metrics
        sa.Column('total_active_time', sa.Integer, default=0),
        sa.Column('total_idle_time', sa.Integer, default=0),
        sa.Column('total_session_count', sa.Integer, default=0),
        
        # Efficiency metrics
        sa.Column('labels_per_hour', sa.Float, default=0),
        sa.Column('first_time_accept_rate', sa.Float, default=0),
        
        # Frames processed
        sa.Column('frames_annotated', sa.Integer, default=0),
        
        # Streak tracking
        sa.Column('current_streak_days', sa.Integer, default=0),
        
        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    
    op.create_index('ix_daily_user_stats_user_id', 'daily_user_stats', ['user_id'])
    op.create_index('ix_daily_user_stats_date', 'daily_user_stats', ['stats_date'])
    op.create_unique_constraint('uq_user_daily_stats', 'daily_user_stats', ['user_id', 'stats_date'])
    
    # ===========================================================================
    # TEAM CHALLENGES TABLE
    # ===========================================================================
    op.create_table(
        'team_challenges',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        
        # Challenge details
        sa.Column('title', sa.String(200), nullable=False),
        sa.Column('description', sa.Text, nullable=True),
        
        # Goal
        sa.Column('goal_type', sa.String(50), nullable=False),
        sa.Column('target_value', sa.Float, nullable=False),
        sa.Column('current_value', sa.Float, default=0),
        
        # Period
        sa.Column('start_date', sa.DateTime(timezone=True), nullable=False),
        sa.Column('end_date', sa.DateTime(timezone=True), nullable=False),
        
        # Status
        sa.Column('is_active', sa.Boolean, default=True),
        sa.Column('is_completed', sa.Boolean, default=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
        
        # Created by
        sa.Column('created_by_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        
        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    
    op.create_index('ix_team_challenges_org_id', 'team_challenges', ['organization_id'])
    op.create_index('ix_team_challenges_active', 'team_challenges', ['is_active'])
    op.create_index('ix_team_challenges_dates', 'team_challenges', ['start_date', 'end_date'])
    
    # ===========================================================================
    # CHALLENGE PARTICIPANTS TABLE
    # ===========================================================================
    op.create_table(
        'challenge_participants',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('challenge_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('team_challenges.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        
        # Contribution
        sa.Column('contribution_value', sa.Float, default=0),
        sa.Column('rank', sa.Integer, nullable=True),
        
        # Timestamps
        sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('last_contribution_at', sa.DateTime(timezone=True), nullable=True),
    )
    
    op.create_index('ix_challenge_participants_challenge_id', 'challenge_participants', ['challenge_id'])
    op.create_index('ix_challenge_participants_user_id', 'challenge_participants', ['user_id'])
    op.create_unique_constraint('uq_challenge_participant', 'challenge_participants', 
                                 ['challenge_id', 'user_id'])
    
    # ===========================================================================
    # ADD EFFICIENCY SETTINGS TO ORGANIZATIONS
    # ===========================================================================
    # The settings JSONB column already exists, we'll just document the new keys:
    # - display_real_names: boolean (default true) - show real names vs anonymized
    # - gamification_enabled: boolean (default true) - enable gamification features
    # - leaderboard_visibility: string ("all", "managers_only", "disabled")


def downgrade() -> None:
    op.drop_table('challenge_participants')
    op.drop_table('team_challenges')
    op.drop_table('daily_user_stats')
    op.drop_table('performance_alerts')
    op.drop_table('achievements')
    op.drop_table('user_goals')
    op.drop_table('activity_events')
    op.drop_table('time_sessions')

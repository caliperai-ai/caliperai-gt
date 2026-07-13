"""Add user login sessions table

Revision ID: 026
Revises: 025
Create Date: 2026-02-21

This migration adds the user_login_sessions table for global activity tracking.
This tracks time spent in the application independent of specific tasks:
- Active time when window is focused and mouse is inside
- Idle time when window is unfocused or mouse is outside
- Session start/end times
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '026'
down_revision = '025'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ===========================================================================
    # USER LOGIN SESSIONS TABLE
    # ===========================================================================
    op.create_table(
        'user_login_sessions',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), 
                  sa.ForeignKey('organizations.id', ondelete='SET NULL'), nullable=True),
        
        # Session timing
        sa.Column('session_start', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('session_end', sa.DateTime(timezone=True), nullable=True),
        
        # Duration tracking (in seconds)
        sa.Column('active_duration_seconds', sa.Integer, default=0),
        sa.Column('idle_duration_seconds', sa.Integer, default=0),
        
        # Activity tracking
        sa.Column('last_heartbeat_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('last_active_at', sa.DateTime(timezone=True), nullable=True),
        
        # Heartbeat count
        sa.Column('heartbeat_count', sa.Integer, default=0),
        
        # Window/focus state
        sa.Column('is_active', sa.Boolean, default=True),
        sa.Column('is_window_focused', sa.Boolean, default=True),
        sa.Column('is_mouse_in_window', sa.Boolean, default=True),
        
        # Client info
        sa.Column('client_info', postgresql.JSONB, default=dict),
    )
    
    # Create indexes
    op.create_index('ix_user_login_sessions_user_id', 'user_login_sessions', ['user_id'])
    op.create_index('ix_user_login_sessions_is_active', 'user_login_sessions', ['is_active'])
    op.create_index('ix_user_login_sessions_session_start', 'user_login_sessions', ['session_start'])
    op.create_index('ix_user_login_sessions_user_active', 'user_login_sessions', ['user_id', 'is_active'])


def downgrade() -> None:
    # Drop indexes
    op.drop_index('ix_user_login_sessions_user_active', table_name='user_login_sessions')
    op.drop_index('ix_user_login_sessions_session_start', table_name='user_login_sessions')
    op.drop_index('ix_user_login_sessions_is_active', table_name='user_login_sessions')
    op.drop_index('ix_user_login_sessions_user_id', table_name='user_login_sessions')
    
    # Drop table
    op.drop_table('user_login_sessions')

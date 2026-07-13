"""Add task_assignment_history table

Revision ID: 015
Revises: 014
Create Date: 2026-02-07

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = '015'
down_revision = '014'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'task_assignment_history',
        sa.Column('id', UUID(as_uuid=True), primary_key=True, server_default=sa.text('gen_random_uuid()')),
        sa.Column('task_id', UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('action', sa.String(50), nullable=False),
        sa.Column('user_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('role', sa.String(50), nullable=False),
        sa.Column('stage', sa.String(50), nullable=False),
        sa.Column('changed_by_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('reason', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index('ix_task_assignment_history_task_id', 'task_assignment_history', ['task_id'])
    op.create_index('ix_task_assignment_history_created_at', 'task_assignment_history', ['created_at'])


def downgrade() -> None:
    op.drop_index('ix_task_assignment_history_created_at', table_name='task_assignment_history')
    op.drop_index('ix_task_assignment_history_task_id', table_name='task_assignment_history')
    op.drop_table('task_assignment_history')

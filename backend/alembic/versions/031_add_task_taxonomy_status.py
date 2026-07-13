"""Add task_taxonomy_status table for per-taxonomy workflow tracking

Revision ID: 031
Revises: 030
Create Date: 2025-03-04

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID


# revision identifiers, used by Alembic.
revision: str = '031'
down_revision: Union[str, None] = '030'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create task_taxonomy_status table
    op.create_table(
        'task_taxonomy_status',
        sa.Column('task_id', UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('taxonomy_id', UUID(as_uuid=True), sa.ForeignKey('taxonomies.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('status', sa.String(50), nullable=False, server_default='pending'),
        sa.Column('stage', sa.String(50), nullable=False, server_default='annotation'),
        sa.Column('assignee_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('assigned_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reviewer_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('review_notes', sa.Text(), nullable=True),
        sa.Column('customer_reviewer_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('customer_reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('customer_review_notes', sa.Text(), nullable=True),
        sa.Column('skip_customer_qa', sa.Boolean(), nullable=False, server_default='false'),
        sa.Column('revision_count', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
        sa.CheckConstraint(
            "status IN ('pending', 'assigned', 'in_progress', 'submitted', 'accepted', 'rejected')",
            name='ck_task_taxonomy_status_status'
        ),
    )
    
    # Create indexes
    op.create_index('ix_task_taxonomy_status_task_id', 'task_taxonomy_status', ['task_id'])
    op.create_index('ix_task_taxonomy_status_taxonomy_id', 'task_taxonomy_status', ['taxonomy_id'])
    op.create_index('ix_task_taxonomy_status_status', 'task_taxonomy_status', ['status'])
    op.create_index('ix_task_taxonomy_status_stage', 'task_taxonomy_status', ['stage'])


def downgrade() -> None:
    op.drop_index('ix_task_taxonomy_status_stage', table_name='task_taxonomy_status')
    op.drop_index('ix_task_taxonomy_status_status', table_name='task_taxonomy_status')
    op.drop_index('ix_task_taxonomy_status_taxonomy_id', table_name='task_taxonomy_status')
    op.drop_index('ix_task_taxonomy_status_task_id', table_name='task_taxonomy_status')
    op.drop_table('task_taxonomy_status')

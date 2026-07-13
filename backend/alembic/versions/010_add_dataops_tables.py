"""Add DataOps tables (annotation_history and stage_snapshots)

Revision ID: 010
Revises: 009
Create Date: 2025-01-15

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB

# revision identifiers, used by Alembic.
revision = '010'
down_revision = '009'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create annotation_history table
    op.create_table(
        'annotation_history',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('annotation_id', UUID(as_uuid=True), nullable=False),
        sa.Column('task_id', UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('frame_id', UUID(as_uuid=True), nullable=False),
        sa.Column('change_type', sa.String(20), nullable=False),
        sa.Column('annotation_data', JSONB, nullable=False),
        sa.Column('previous_data', JSONB, nullable=True),
        sa.Column('task_stage', sa.String(50), nullable=False),
        sa.Column('task_status', sa.String(50), nullable=False),
        sa.Column('changed_by_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('version', sa.Integer, nullable=False, default=1),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    
    # Create indexes for annotation_history
    op.create_index('ix_annotation_history_annotation_id', 'annotation_history', ['annotation_id'])
    op.create_index('ix_annotation_history_task_id', 'annotation_history', ['task_id'])
    op.create_index('ix_annotation_history_created_at', 'annotation_history', ['created_at'])
    op.create_index('ix_annotation_history_change_type', 'annotation_history', ['change_type'])
    
    # Create stage_snapshots table
    op.create_table(
        'stage_snapshots',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('task_id', UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('from_stage', sa.String(50), nullable=False),
        sa.Column('to_stage', sa.String(50), nullable=False),
        sa.Column('from_status', sa.String(50), nullable=False),
        sa.Column('to_status', sa.String(50), nullable=False),
        sa.Column('snapshot_name', sa.String(200), nullable=False),
        sa.Column('total_annotations', sa.Integer, default=0),
        sa.Column('annotations_by_class', JSONB, default=dict),
        sa.Column('annotations_by_type', JSONB, default=dict),
        sa.Column('annotations_by_frame', JSONB, default=dict),
        sa.Column('annotations_snapshot', JSONB, nullable=False),
        sa.Column('triggered_by_id', UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('notes', sa.Text, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    
    # Create indexes for stage_snapshots
    op.create_index('ix_stage_snapshots_task_id', 'stage_snapshots', ['task_id'])
    op.create_index('ix_stage_snapshots_created_at', 'stage_snapshots', ['created_at'])
    op.create_index('ix_stage_snapshots_to_stage', 'stage_snapshots', ['to_stage'])


def downgrade() -> None:
    # Drop stage_snapshots table
    op.drop_index('ix_stage_snapshots_to_stage', 'stage_snapshots')
    op.drop_index('ix_stage_snapshots_created_at', 'stage_snapshots')
    op.drop_index('ix_stage_snapshots_task_id', 'stage_snapshots')
    op.drop_table('stage_snapshots')
    
    # Drop annotation_history table
    op.drop_index('ix_annotation_history_change_type', 'annotation_history')
    op.drop_index('ix_annotation_history_created_at', 'annotation_history')
    op.drop_index('ix_annotation_history_task_id', 'annotation_history')
    op.drop_index('ix_annotation_history_annotation_id', 'annotation_history')
    op.drop_table('annotation_history')

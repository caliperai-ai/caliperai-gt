"""Add annotations_4d table for 4D temporal annotations

Revision ID: 003_add_annotations_4d
Revises: 002_add_stage_to_tasks
Create Date: 2025-12-26

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB


# revision identifiers, used by Alembic.
revision = '003_add_annotations_4d'
down_revision = '002_add_stage_to_tasks'
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create annotations_4d table."""
    op.create_table(
        'annotations_4d',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('task_id', UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('track_id', UUID(as_uuid=True), nullable=False),
        sa.Column('type', sa.String(30), default='cuboid', nullable=False),
        sa.Column('class_id', sa.String(100), nullable=False),
        sa.Column('world_data', JSONB, nullable=False),
        sa.Column('frame_data', JSONB, default={}, nullable=False),
        sa.Column('frame_ids', JSONB, default=[], nullable=False),
        sa.Column('is_static', sa.Boolean, default=True, nullable=False),
        sa.Column('attributes', JSONB, default={}, nullable=False),
        sa.Column('is_migrated', sa.Boolean, default=False, nullable=False),
        sa.Column('migrated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('source', sa.String(50), default='manual_4d', nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    
    # Create indexes
    op.create_index('ix_annotations_4d_task_id', 'annotations_4d', ['task_id'])
    op.create_index('ix_annotations_4d_track_id', 'annotations_4d', ['track_id'])
    op.create_index('ix_annotations_4d_class_id', 'annotations_4d', ['class_id'])
    op.create_index('ix_annotations_4d_is_migrated', 'annotations_4d', ['is_migrated'])
    
    # GIN indexes for JSONB columns
    op.create_index('ix_annotations_4d_world_data', 'annotations_4d', ['world_data'], postgresql_using='gin')
    op.create_index('ix_annotations_4d_frame_data', 'annotations_4d', ['frame_data'], postgresql_using='gin')


def downgrade() -> None:
    """Drop annotations_4d table."""
    op.drop_index('ix_annotations_4d_frame_data', 'annotations_4d')
    op.drop_index('ix_annotations_4d_world_data', 'annotations_4d')
    op.drop_index('ix_annotations_4d_is_migrated', 'annotations_4d')
    op.drop_index('ix_annotations_4d_class_id', 'annotations_4d')
    op.drop_index('ix_annotations_4d_track_id', 'annotations_4d')
    op.drop_index('ix_annotations_4d_task_id', 'annotations_4d')
    op.drop_table('annotations_4d')

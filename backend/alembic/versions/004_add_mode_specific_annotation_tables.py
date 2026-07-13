"""Add mode-specific annotation tables (3D, Fusion, 2D)

Revision ID: 004
Revises: 003
Create Date: 2024-12-27

Adds separate annotation tables for each annotation mode:
- annotations_3d: LiDAR-only 3D cuboid annotations
- annotations_fusion: Combined 3D + 2D annotations
- annotations_2d: Camera-only 2D annotations

This allows independent storage and workflows for each mode,
with migration capabilities between modes (4D→3D, 3D→Fusion).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '004'
down_revision = '003_add_annotations_4d'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create annotations_3d table
    op.create_table(
        'annotations_3d',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('frame_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('frames.id', ondelete='CASCADE'), nullable=False),
        sa.Column('track_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('type', sa.String(30), default='cuboid', nullable=False),
        sa.Column('class_id', sa.String(100), nullable=False),
        sa.Column('data', postgresql.JSONB, nullable=False),
        sa.Column('attributes', postgresql.JSONB, default={}, nullable=False),
        sa.Column('source', sa.String(50), default='manual_3d', nullable=False),
        sa.Column('is_migrated_to_fusion', sa.Boolean, default=False, nullable=False),
        sa.Column('migrated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('fusion_annotation_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('is_verified', sa.Boolean, default=False, nullable=False),
        sa.Column('verified_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    
    # Create indexes for annotations_3d
    op.create_index('ix_annotations_3d_task_id', 'annotations_3d', ['task_id'])
    op.create_index('ix_annotations_3d_frame_id', 'annotations_3d', ['frame_id'])
    op.create_index('ix_annotations_3d_track_id', 'annotations_3d', ['track_id'])
    op.create_index('ix_annotations_3d_class_id', 'annotations_3d', ['class_id'])
    op.create_index('ix_annotations_3d_is_migrated', 'annotations_3d', ['is_migrated_to_fusion'])
    op.create_index('ix_annotations_3d_data', 'annotations_3d', ['data'], postgresql_using='gin')
    
    # Create annotations_fusion table
    op.create_table(
        'annotations_fusion',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('frame_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('frames.id', ondelete='CASCADE'), nullable=False),
        sa.Column('track_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('type', sa.String(30), default='cuboid_fusion', nullable=False),
        sa.Column('class_id', sa.String(100), nullable=False),
        sa.Column('data_3d', postgresql.JSONB, nullable=False),
        sa.Column('data_2d', postgresql.JSONB, default={}, nullable=False),
        sa.Column('attributes', postgresql.JSONB, default={}, nullable=False),
        sa.Column('source', sa.String(50), default='manual_fusion', nullable=False),
        sa.Column('source_3d_annotation_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('is_verified', sa.Boolean, default=False, nullable=False),
        sa.Column('verified_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    
    # Create indexes for annotations_fusion
    op.create_index('ix_annotations_fusion_task_id', 'annotations_fusion', ['task_id'])
    op.create_index('ix_annotations_fusion_frame_id', 'annotations_fusion', ['frame_id'])
    op.create_index('ix_annotations_fusion_track_id', 'annotations_fusion', ['track_id'])
    op.create_index('ix_annotations_fusion_class_id', 'annotations_fusion', ['class_id'])
    op.create_index('ix_annotations_fusion_source_3d', 'annotations_fusion', ['source_3d_annotation_id'])
    op.create_index('ix_annotations_fusion_data_3d', 'annotations_fusion', ['data_3d'], postgresql_using='gin')
    op.create_index('ix_annotations_fusion_data_2d', 'annotations_fusion', ['data_2d'], postgresql_using='gin')
    
    # Create annotations_2d table
    op.create_table(
        'annotations_2d',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('frame_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('frames.id', ondelete='CASCADE'), nullable=False),
        sa.Column('camera_id', sa.String(100), nullable=False),
        sa.Column('track_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('type', sa.String(30), nullable=False),
        sa.Column('class_id', sa.String(100), nullable=False),
        sa.Column('data', postgresql.JSONB, nullable=False),
        sa.Column('attributes', postgresql.JSONB, default={}, nullable=False),
        sa.Column('source', sa.String(50), default='manual_2d', nullable=False),
        sa.Column('is_verified', sa.Boolean, default=False, nullable=False),
        sa.Column('verified_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    
    # Create indexes for annotations_2d
    op.create_index('ix_annotations_2d_task_id', 'annotations_2d', ['task_id'])
    op.create_index('ix_annotations_2d_frame_id', 'annotations_2d', ['frame_id'])
    op.create_index('ix_annotations_2d_camera_id', 'annotations_2d', ['camera_id'])
    op.create_index('ix_annotations_2d_track_id', 'annotations_2d', ['track_id'])
    op.create_index('ix_annotations_2d_type', 'annotations_2d', ['type'])
    op.create_index('ix_annotations_2d_class_id', 'annotations_2d', ['class_id'])
    op.create_index('ix_annotations_2d_data', 'annotations_2d', ['data'], postgresql_using='gin')
    
    # Add check constraint for 2D annotation types
    op.create_check_constraint(
        'ck_annotation_2d_type',
        'annotations_2d',
        "type IN ('box2d', 'polygon', 'polyline', 'keypoints', 'segmentation_2d')"
    )


def downgrade() -> None:
    # Drop annotations_2d table and indexes
    op.drop_constraint('ck_annotation_2d_type', 'annotations_2d', type_='check')
    op.drop_index('ix_annotations_2d_data', 'annotations_2d')
    op.drop_index('ix_annotations_2d_class_id', 'annotations_2d')
    op.drop_index('ix_annotations_2d_type', 'annotations_2d')
    op.drop_index('ix_annotations_2d_track_id', 'annotations_2d')
    op.drop_index('ix_annotations_2d_camera_id', 'annotations_2d')
    op.drop_index('ix_annotations_2d_frame_id', 'annotations_2d')
    op.drop_index('ix_annotations_2d_task_id', 'annotations_2d')
    op.drop_table('annotations_2d')
    
    # Drop annotations_fusion table and indexes
    op.drop_index('ix_annotations_fusion_data_2d', 'annotations_fusion')
    op.drop_index('ix_annotations_fusion_data_3d', 'annotations_fusion')
    op.drop_index('ix_annotations_fusion_source_3d', 'annotations_fusion')
    op.drop_index('ix_annotations_fusion_class_id', 'annotations_fusion')
    op.drop_index('ix_annotations_fusion_track_id', 'annotations_fusion')
    op.drop_index('ix_annotations_fusion_frame_id', 'annotations_fusion')
    op.drop_index('ix_annotations_fusion_task_id', 'annotations_fusion')
    op.drop_table('annotations_fusion')
    
    # Drop annotations_3d table and indexes
    op.drop_index('ix_annotations_3d_data', 'annotations_3d')
    op.drop_index('ix_annotations_3d_is_migrated', 'annotations_3d')
    op.drop_index('ix_annotations_3d_class_id', 'annotations_3d')
    op.drop_index('ix_annotations_3d_track_id', 'annotations_3d')
    op.drop_index('ix_annotations_3d_frame_id', 'annotations_3d')
    op.drop_index('ix_annotations_3d_task_id', 'annotations_3d')
    op.drop_table('annotations_3d')

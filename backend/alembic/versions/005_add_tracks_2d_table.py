"""Add tracks_2d table and update annotations_2d type constraint

Revision ID: 005
Revises: 004
Create Date: 2024-12-27

Adds tracks_2d table for tracking 2D annotations across frames,
and updates the type constraint for annotations_2d to support more annotation types.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = '005'
down_revision = '004'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Create tracks_2d table
    op.create_table(
        'tracks_2d',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('camera_id', sa.String(100), nullable=False),
        sa.Column('class_id', sa.String(100), nullable=False),
        sa.Column('name', sa.String(255), nullable=True),
        sa.Column('color', sa.String(20), nullable=True),
        sa.Column('start_frame_index', sa.Integer, nullable=True),
        sa.Column('end_frame_index', sa.Integer, nullable=True),
        sa.Column('is_interpolated', sa.Boolean, default=False, nullable=False),
        sa.Column('is_complete', sa.Boolean, default=False, nullable=False),
        sa.Column('attributes', postgresql.JSONB, default={}, nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now(), nullable=False),
    )
    
    # Create indexes for tracks_2d
    op.create_index('ix_tracks_2d_task_id', 'tracks_2d', ['task_id'])
    op.create_index('ix_tracks_2d_camera_id', 'tracks_2d', ['camera_id'])
    op.create_index('ix_tracks_2d_class_id', 'tracks_2d', ['class_id'])
    op.create_index('ix_tracks_2d_task_camera', 'tracks_2d', ['task_id', 'camera_id'])
    
    # Add foreign key from annotations_2d.track_id to tracks_2d.id
    op.create_foreign_key(
        'fk_annotations_2d_track_id',
        'annotations_2d',
        'tracks_2d',
        ['track_id'],
        ['id'],
        ondelete='SET NULL'
    )
    
    # Drop old type constraint and add new one with more annotation types
    op.drop_constraint('ck_annotation_2d_type', 'annotations_2d', type_='check')
    op.create_check_constraint(
        'ck_annotation_2d_type',
        'annotations_2d',
        "type IN ('box', 'box2d', 'rotated_box', 'ellipse', 'polygon', 'polyline', 'points', 'keypoints', 'mask', 'segmentation_2d')"
    )


def downgrade() -> None:
    # Drop new type constraint and restore old one
    op.drop_constraint('ck_annotation_2d_type', 'annotations_2d', type_='check')
    op.create_check_constraint(
        'ck_annotation_2d_type',
        'annotations_2d',
        "type IN ('box2d', 'polygon', 'polyline', 'keypoints', 'segmentation_2d')"
    )
    
    # Drop foreign key from annotations_2d to tracks_2d
    op.drop_constraint('fk_annotations_2d_track_id', 'annotations_2d', type_='foreignkey')
    
    # Drop tracks_2d indexes and table
    op.drop_index('ix_tracks_2d_task_camera', 'tracks_2d')
    op.drop_index('ix_tracks_2d_class_id', 'tracks_2d')
    op.drop_index('ix_tracks_2d_camera_id', 'tracks_2d')
    op.drop_index('ix_tracks_2d_task_id', 'tracks_2d')
    op.drop_table('tracks_2d')

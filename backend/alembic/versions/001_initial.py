"""Initial migration - Create all tables

Revision ID: 001_initial
Revises: 
Create Date: 2024-01-01 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create extensions
    op.execute('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"')
    op.execute('CREATE EXTENSION IF NOT EXISTS "postgis"')
    op.execute('CREATE EXTENSION IF NOT EXISTS "btree_gist"')
    
    # Create ENUM types
    # op.execute("""
    #     CREATE TYPE taskstatus AS ENUM (
    #         'draft', 'assigned', 'in_progress', 'submitted', 'accepted', 'rejected'
    #     )
    # """)
    
    # op.execute("""
    #     CREATE TYPE annotationtype AS ENUM (
    #         'cuboid', 'box2d', 'polyline', 'polygon', 'keypoints', 'segmentation_3d'
    #     )
    # """)
    
    # op.execute("""
    #     CREATE TYPE annotationsource AS ENUM (
    #         'manual', 'model_prediction', 'interpolated', 'imported'
    #     )
    # """)
    
    # Create users table
    op.create_table(
        'users',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), primary_key=True),
        sa.Column('email', sa.String(255), nullable=False, unique=True),
        sa.Column('username', sa.String(100), nullable=False, unique=True),
        sa.Column('hashed_password', sa.String(255), nullable=False),
        sa.Column('full_name', sa.String(255), nullable=True),
        sa.Column('role', sa.String(50), nullable=False, server_default='annotator'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('is_superuser', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('ix_users_email', 'users', ['email'])
    op.create_index('ix_users_username', 'users', ['username'])
    
    # Create campaigns table
    op.create_table(
        'campaigns',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('config', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('custom_metadata', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('stats', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('deadline', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.create_index('ix_campaigns_name', 'campaigns', ['name'])
    
    # Create taxonomies table
    op.create_table(
        'taxonomies',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('version', sa.String(50), nullable=False, server_default='1.0.0'),
        sa.Column('classes', postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('skeletons', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('annotation_rules', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.create_index('ix_taxonomies_name', 'taxonomies', ['name'])
    op.create_index('ix_taxonomies_created_at', 'taxonomies', ['created_at'])
    
    # Create datasets table
    op.create_table(
        'datasets',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), primary_key=True),
        sa.Column('campaign_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('campaigns.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('taxonomy', postgresql.JSONB(), nullable=False),
        sa.Column('sensor_config', postgresql.JSONB(), nullable=True),
        sa.Column('custom_metadata', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('deadline', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.create_index('ix_datasets_campaign_id', 'datasets', ['campaign_id'])
    op.create_index('ix_datasets_taxonomy', 'datasets', ['taxonomy'], postgresql_using='gin')
    
    # Create dataset_taxonomy association table
    op.create_table(
        'dataset_taxonomy',
        sa.Column('dataset_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('datasets.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('taxonomy_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('taxonomies.id', ondelete='CASCADE'), primary_key=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP')),
    )
    
    # Create scenes table
    op.create_table(
        'scenes',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), primary_key=True),
        sa.Column('dataset_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('datasets.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('calibration', postgresql.JSONB(), nullable=True),
        sa.Column('metadata_', postgresql.JSONB(), nullable=True),
        sa.Column('scene_metadata', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('storage_paths', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('frame_count', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('fps', sa.Float(), nullable=True),
        sa.Column('total_frames', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('duration_seconds', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.create_index('ix_scenes_dataset_id', 'scenes', ['dataset_id'])
    
    # Create frames table
    op.create_table(
        'frames',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), primary_key=True),
        sa.Column('scene_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('scenes.id', ondelete='CASCADE'), nullable=False),
        sa.Column('frame_index', sa.Integer(), nullable=False),
        sa.Column('timestamp', sa.Float(), nullable=True),
        sa.Column('timestamp_ns', sa.BigInteger(), nullable=True),
        sa.Column('lidar_path', sa.String(1024), nullable=True),
        sa.Column('camera_paths', postgresql.JSONB(), nullable=True),
        sa.Column('file_paths', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('ego_pose', postgresql.JSONB(), nullable=True),
        sa.Column('metadata_', postgresql.JSONB(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('ix_frames_scene_id_frame_index', 'frames', ['scene_id', 'frame_index'], unique=True)
    op.create_index('ix_frames_timestamp', 'frames', ['timestamp_ns'])
    
    # Create tasks table
    op.create_table(
        'tasks',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), primary_key=True),
        sa.Column('scene_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('scenes.id', ondelete='CASCADE'), nullable=False),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('frame_range', postgresql.INT4RANGE(), nullable=False),
        sa.Column('context_buffer_before', sa.Integer(), nullable=False, server_default=sa.text('5')),
        sa.Column('context_buffer_after', sa.Integer(), nullable=False, server_default=sa.text('5')),
        sa.Column('status', sa.String(50), nullable=False, server_default='draft'),
        sa.Column('priority', sa.Integer(), nullable=False, server_default=sa.text('5')),
        sa.Column('assignee_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('reviewer_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('assigned_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('reviewed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('due_date', sa.DateTime(timezone=True), nullable=True),
        sa.Column('deadline', sa.DateTime(timezone=True), nullable=True),
        sa.Column('config', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('submitted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('time_spent_seconds', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('total_time_seconds', sa.Integer(), nullable=False, server_default=sa.text('0')),
        sa.Column('review_notes', sa.Text(), nullable=True),
        sa.Column('airflow_run_id', sa.String(255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.create_index('ix_tasks_scene_id', 'tasks', ['scene_id'])
    op.create_index('ix_tasks_assignee_id', 'tasks', ['assignee_id'])
    op.create_index('ix_tasks_status', 'tasks', ['status'])
    op.create_index('ix_tasks_frame_range', 'tasks', ['frame_range'], postgresql_using='gist')
    
    # Create annotations table
    op.create_table(
        'annotations',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), primary_key=True),
        sa.Column('task_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('tasks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('frame_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('frames.id', ondelete='CASCADE'), nullable=False),
        sa.Column('track_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('type', sa.Enum('cuboid', 'box2d', 'polyline', 'polygon', 'keypoints', 'segmentation_3d', name='annotationtype'), nullable=False),
        sa.Column('class_id', sa.String(100), nullable=False),
        sa.Column('data', postgresql.JSONB(), nullable=False),
        sa.Column('attributes', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('source', sa.Enum('manual', 'model_prediction', 'interpolated', 'imported', name='annotationsource'), nullable=False, server_default='manual'),
        sa.Column('confidence', sa.Float(), nullable=True),
        sa.Column('is_verified', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('verified_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('verified_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('ix_annotations_task_id', 'annotations', ['task_id'])
    op.create_index('ix_annotations_frame_id', 'annotations', ['frame_id'])
    op.create_index('ix_annotations_track_id', 'annotations', ['track_id'])
    op.create_index('ix_annotations_class_id', 'annotations', ['class_id'])
    op.create_index('ix_annotations_source', 'annotations', ['source'])
    op.create_index('ix_annotations_data', 'annotations', ['data'], postgresql_using='gin')
    
    # Create segmentation_blobs table
    op.create_table(
        'segmentation_blobs',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), primary_key=True),
        sa.Column('annotation_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('annotations.id', ondelete='CASCADE'), nullable=False, unique=True),
        sa.Column('point_indices', postgresql.BYTEA(), nullable=False),
        sa.Column('encoding', sa.String(50), nullable=False, server_default='numpy_compressed'),
        sa.Column('num_points', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    )
    
    # Create audit_logs table
    op.create_table(
        'audit_logs',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), primary_key=True),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('action', sa.String(100), nullable=False),
        sa.Column('entity_type', sa.String(100), nullable=False),
        sa.Column('entity_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('old_data', postgresql.JSONB(), nullable=True),
        sa.Column('new_data', postgresql.JSONB(), nullable=True),
        sa.Column('ip_address', sa.String(45), nullable=True),
        sa.Column('user_agent', sa.String(512), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
    )
    op.create_index('ix_audit_logs_entity_type_entity_id', 'audit_logs', ['entity_type', 'entity_id'])
    op.create_index('ix_audit_logs_user_id', 'audit_logs', ['user_id'])
    op.create_index('ix_audit_logs_created_at', 'audit_logs', ['created_at'])


def downgrade() -> None:
    # Drop tables
    op.drop_table('audit_logs')
    op.drop_table('segmentation_blobs')
    op.drop_table('annotations')
    op.drop_table('tasks')
    op.drop_table('frames')
    op.drop_table('scenes')
    op.drop_table('datasets')
    op.drop_table('campaigns')
    op.drop_table('users')
    
    # Drop ENUM types
    op.execute('DROP TYPE IF EXISTS annotationsource')
    op.execute('DROP TYPE IF EXISTS annotationtype')
    op.execute('DROP TYPE IF EXISTS taskstatus')

"""add_taxonomy_per_scene_annotations

Revision ID: 029
Revises: 028
Create Date: 2026-03-04

Adds scene-level taxonomy selection and per-taxonomy annotations.
- scenes.selected_taxonomy_id: Stores which taxonomy is currently active for a scene
- annotations.taxonomy_id: Stores which taxonomy each annotation belongs to
- annotations_3d.taxonomy_id: Stores which taxonomy each 3D annotation belongs to
- annotations_3d.is_static: Stores if the object is static (doesn't move between frames)
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '029'
down_revision = '028'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add selected_taxonomy_id to scenes table
    op.add_column(
        'scenes',
        sa.Column(
            'selected_taxonomy_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('taxonomies.id', ondelete='SET NULL'),
            nullable=True
        )
    )
    op.create_index(
        'ix_scenes_selected_taxonomy_id',
        'scenes',
        ['selected_taxonomy_id']
    )
    
    # Add taxonomy_id to annotations table (legacy 2D annotations)
    op.add_column(
        'annotations',
        sa.Column(
            'taxonomy_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('taxonomies.id', ondelete='SET NULL'),
            nullable=True
        )
    )
    op.create_index(
        'ix_annotations_taxonomy_id',
        'annotations',
        ['taxonomy_id']
    )
    
    # Add taxonomy_id and is_static to annotations_3d table
    op.add_column(
        'annotations_3d',
        sa.Column(
            'taxonomy_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('taxonomies.id', ondelete='SET NULL'),
            nullable=True
        )
    )
    op.create_index(
        'ix_annotations_3d_taxonomy_id',
        'annotations_3d',
        ['taxonomy_id']
    )
    
    op.add_column(
        'annotations_3d',
        sa.Column(
            'is_static',
            sa.Boolean(),
            server_default='false',
            nullable=False
        )
    )


def downgrade() -> None:
    # Remove is_static from annotations_3d
    op.drop_column('annotations_3d', 'is_static')
    
    # Remove taxonomy_id from annotations_3d
    op.drop_index('ix_annotations_3d_taxonomy_id', table_name='annotations_3d')
    op.drop_column('annotations_3d', 'taxonomy_id')
    
    # Remove taxonomy_id from annotations
    op.drop_index('ix_annotations_taxonomy_id', table_name='annotations')
    op.drop_column('annotations', 'taxonomy_id')
    
    # Remove selected_taxonomy_id from scenes
    op.drop_index('ix_scenes_selected_taxonomy_id', table_name='scenes')
    op.drop_column('scenes', 'selected_taxonomy_id')
    
    # Remove selected_taxonomy_id from scenes
    op.drop_index('ix_scenes_selected_taxonomy_id', table_name='scenes')
    op.drop_column('scenes', 'selected_taxonomy_id')

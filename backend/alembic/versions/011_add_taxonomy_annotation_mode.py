"""Add annotation_mode to taxonomies and mode/is_primary to dataset_taxonomy association.

Revision ID: 011_add_taxonomy_annotation_mode
Revises: 010_add_dataops_tables
Create Date: 2026-01-26

This migration adds:
1. annotation_mode column to taxonomies table (fusion_3d or 2d_only)
2. mode and is_primary columns to dataset_taxonomy association table
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '011'
down_revision = '010'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add annotation_mode column to taxonomies table
    op.add_column(
        'taxonomies',
        sa.Column(
            'annotation_mode',
            sa.String(20),
            nullable=False,
            server_default='fusion_3d'
        )
    )
    
    # Add index for annotation_mode
    op.create_index(
        'ix_taxonomies_annotation_mode',
        'taxonomies',
        ['annotation_mode']
    )
    
    # Add mode and is_primary columns to dataset_taxonomy association table
    op.add_column(
        'dataset_taxonomy',
        sa.Column(
            'mode',
            sa.String(20),
            nullable=True
        )
    )
    
    op.add_column(
        'dataset_taxonomy',
        sa.Column(
            'is_primary',
            sa.Boolean(),
            nullable=False,
            server_default='false'
        )
    )


def downgrade() -> None:
    # Remove columns from dataset_taxonomy
    op.drop_column('dataset_taxonomy', 'is_primary')
    op.drop_column('dataset_taxonomy', 'mode')
    
    # Remove index and column from taxonomies
    op.drop_index('ix_taxonomies_annotation_mode', table_name='taxonomies')
    op.drop_column('taxonomies', 'annotation_mode')

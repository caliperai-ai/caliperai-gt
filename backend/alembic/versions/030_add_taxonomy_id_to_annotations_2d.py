"""add_taxonomy_id_to_annotations_2d

Revision ID: 030
Revises: 029
Create Date: 2026-03-04

Adds taxonomy_id to annotations_2d table for per-taxonomy filtering.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision = '030'
down_revision = '029'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add taxonomy_id to annotations_2d table
    op.add_column(
        'annotations_2d',
        sa.Column(
            'taxonomy_id',
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey('taxonomies.id', ondelete='SET NULL'),
            nullable=True
        )
    )
    op.create_index(
        'ix_annotations_2d_taxonomy_id',
        'annotations_2d',
        ['taxonomy_id']
    )


def downgrade() -> None:
    op.drop_index('ix_annotations_2d_taxonomy_id', table_name='annotations_2d')
    op.drop_column('annotations_2d', 'taxonomy_id')

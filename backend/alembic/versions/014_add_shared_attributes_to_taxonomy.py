"""Add shared_attributes column to taxonomies table

Revision ID: 014
Revises: 013_add_is_keyframe_to_annotations_3d
Create Date: 2026-02-06

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

# revision identifiers, used by Alembic.
revision = '014'
down_revision = '013'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add shared_attributes column to taxonomies table
    op.add_column(
        'taxonomies',
        sa.Column('shared_attributes', JSONB, nullable=False, server_default='[]')
    )


def downgrade() -> None:
    # Remove shared_attributes column
    op.drop_column('taxonomies', 'shared_attributes')

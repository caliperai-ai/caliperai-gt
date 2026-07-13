"""Add spatial location fields to annotation_reviews for point-based issues.

Revision ID: 032
Revises: 031
Create Date: 2026-03-10

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '032'
down_revision = '031'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add location fields for point-based/spatial issues
    op.add_column('annotation_reviews', sa.Column('location_x', sa.Float(), nullable=True))
    op.add_column('annotation_reviews', sa.Column('location_y', sa.Float(), nullable=True))
    op.add_column('annotation_reviews', sa.Column('location_z', sa.Float(), nullable=True))


def downgrade() -> None:
    op.drop_column('annotation_reviews', 'location_z')
    op.drop_column('annotation_reviews', 'location_y')
    op.drop_column('annotation_reviews', 'location_x')

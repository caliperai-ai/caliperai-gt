"""Add frame_id and class_id to annotation_reviews table.

Revision ID: 016
Revises: 015
Create Date: 2026-02-09

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '016'
down_revision = '015'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add frame_id and class_id columns to annotation_reviews
    op.add_column('annotation_reviews', sa.Column('frame_id', sa.String(100), nullable=True))
    op.add_column('annotation_reviews', sa.Column('class_id', sa.String(100), nullable=True))


def downgrade() -> None:
    op.drop_column('annotation_reviews', 'class_id')
    op.drop_column('annotation_reviews', 'frame_id')

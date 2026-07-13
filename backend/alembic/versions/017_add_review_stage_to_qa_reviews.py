"""Add review_stage to qa_reviews table.

This column tracks which task stage (qa or customer_qa) the review was created for.
This is important to separate QA reviews from Customer QA reviews so that
Customer QA starts fresh without inheriting artifacts from regular QA.

Revision ID: 017
Revises: 016
Create Date: 2026-02-09

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '017'
down_revision = '016'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add review_stage column to qa_reviews
    # Nullable for backwards compatibility with existing reviews
    op.add_column('qa_reviews', sa.Column('review_stage', sa.String(20), nullable=True))
    
    # Create index for efficient queries filtered by review_stage
    op.create_index('ix_qa_reviews_review_stage', 'qa_reviews', ['review_stage'])


def downgrade() -> None:
    op.drop_index('ix_qa_reviews_review_stage', 'qa_reviews')
    op.drop_column('qa_reviews', 'review_stage')

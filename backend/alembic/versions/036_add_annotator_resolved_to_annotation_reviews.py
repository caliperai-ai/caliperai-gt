"""Add annotator_resolved flag to annotation_reviews for the
'Mark as Fixed' flow in segmentation revision rounds.

Annotators can mark a spatial issue as fixed; submit is blocked
until every issue has been resolved. The flag is one-way (no
unfix), so we don't bother tracking who/when at this point.

Revision ID: 036
Revises: 035
Create Date: 2026-05-29

"""
from alembic import op
import sqlalchemy as sa


revision = '036'
down_revision = '035'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'annotation_reviews',
        sa.Column(
            'annotator_resolved',
            sa.Boolean(),
            nullable=False,
            server_default=sa.text('false'),
        ),
    )


def downgrade() -> None:
    op.drop_column('annotation_reviews', 'annotator_resolved')

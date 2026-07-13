"""add_deadline_columns

Revision ID: 012
Revises: 011
Create Date: 2026-02-03

Adds deadline columns to campaigns, datasets, and scenes tables.
Tasks already have a deadline column.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '012'
down_revision = '011'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add deadline column to campaigns
    op.add_column('campaigns', sa.Column('deadline', sa.DateTime(timezone=True), nullable=True))
    
    # Add deadline column to datasets
    op.add_column('datasets', sa.Column('deadline', sa.DateTime(timezone=True), nullable=True))
    
    # Add deadline column to scenes
    op.add_column('scenes', sa.Column('deadline', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    # Remove deadline columns
    op.drop_column('scenes', 'deadline')
    op.drop_column('datasets', 'deadline')
    op.drop_column('campaigns', 'deadline')

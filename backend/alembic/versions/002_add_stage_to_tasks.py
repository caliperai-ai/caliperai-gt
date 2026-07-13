"""Add stage column to tasks table

Revision ID: 002_add_stage_to_tasks
Revises: 001_initial
Create Date: 2025-12-25 08:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '002_add_stage_to_tasks'
down_revision: Union[str, None] = '001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add stage column to tasks table with default value
    op.add_column('tasks', sa.Column('stage', sa.String(50), server_default='annotation', nullable=False))


def downgrade() -> None:
    # Remove stage column from tasks table
    op.drop_column('tasks', 'stage')

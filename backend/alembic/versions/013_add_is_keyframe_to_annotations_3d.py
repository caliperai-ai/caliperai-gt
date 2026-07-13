"""Add is_keyframe to annotations_3d table

Revision ID: 013
Revises: 012
Create Date: 2025-01-13

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '013'
down_revision: Union[str, None] = '012'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add is_keyframe column to annotations_3d table
    op.add_column(
        'annotations_3d',
        sa.Column('is_keyframe', sa.Boolean(), nullable=False, server_default='false')
    )
    
    # Add index for faster keyframe queries
    op.create_index(
        'ix_annotations_3d_is_keyframe',
        'annotations_3d',
        ['is_keyframe']
    )


def downgrade() -> None:
    # Remove index
    op.drop_index('ix_annotations_3d_is_keyframe', table_name='annotations_3d')
    
    # Remove column
    op.drop_column('annotations_3d', 'is_keyframe')

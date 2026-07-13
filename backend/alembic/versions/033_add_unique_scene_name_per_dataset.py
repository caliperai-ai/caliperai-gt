"""Add unique constraint for scene name per dataset

Revision ID: 033
Revises: 032_add_spatial_location_to_annotation_reviews
Create Date: 2026-03-23

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "033"
down_revision: Union[str, None] = "032"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create a partial unique index on (dataset_id, name) for non-deleted scenes
    # This prevents duplicate scene names within the same dataset
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ix_scenes_dataset_name_unique 
        ON scenes (dataset_id, name) 
        WHERE is_deleted = FALSE
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_scenes_dataset_name_unique")

"""Add unique constraint for dataset name per campaign

Revision ID: 019
Revises: 018_add_organization_multitenancy
Create Date: 2026-02-12

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "019"
down_revision: Union[str, None] = "018"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create a partial unique index on (campaign_id, name) for non-deleted datasets
    # This prevents duplicate dataset names within the same campaign
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ix_datasets_campaign_name_unique 
        ON datasets (campaign_id, name) 
        WHERE is_deleted = FALSE
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_datasets_campaign_name_unique")

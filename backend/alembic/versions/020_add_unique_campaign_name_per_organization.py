"""Add unique constraint for campaign name per organization

Revision ID: 020
Revises: 019_add_unique_dataset_name_per_campaign
Create Date: 2026-02-12

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "020"
down_revision: Union[str, None] = "019"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create a partial unique index on (organization_id, name) for non-deleted campaigns
    # This prevents duplicate campaign names within the same organization
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ix_campaigns_organization_name_unique 
        ON campaigns (organization_id, name) 
        WHERE is_deleted = FALSE
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_campaigns_organization_name_unique")

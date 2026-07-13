"""Make taxonomy organization_id required and add unique constraint

Revision ID: 021
Revises: 020_add_unique_campaign_name_per_organization
Create Date: 2026-02-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "021"
down_revision: Union[str, None] = "020"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # First, assign any taxonomies with NULL organization_id to the default organization
    # Get the first non-deleted organization as the default
    op.execute(
        """
        UPDATE taxonomies 
        SET organization_id = (
            SELECT id FROM organizations WHERE is_deleted = FALSE ORDER BY created_at LIMIT 1
        )
        WHERE organization_id IS NULL
        """
    )
    
    # Make organization_id NOT NULL
    op.alter_column(
        'taxonomies',
        'organization_id',
        existing_type=sa.UUID(),
        nullable=False,
    )
    
    # Create a partial unique index on (organization_id, name) for non-deleted taxonomies
    # This prevents duplicate taxonomy names within the same organization
    op.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS ix_taxonomies_organization_name_unique 
        ON taxonomies (organization_id, name) 
        WHERE is_deleted = FALSE
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_taxonomies_organization_name_unique")
    
    # Make organization_id nullable again
    op.alter_column(
        'taxonomies',
        'organization_id',
        existing_type=sa.UUID(),
        nullable=True,
    )

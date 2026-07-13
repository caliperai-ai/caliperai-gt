"""Add user security fields (must_change_password, is_superuser)

Revision ID: 022
Revises: 021
Create Date: 2026-02-12

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "022"
down_revision: Union[str, None] = "021"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Add must_change_password and is_superuser fields to users table."""
    # Add is_superuser column if it doesn't exist
    op.execute("""
        DO $$ 
        BEGIN 
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='users' AND column_name='is_superuser'
            ) THEN
                ALTER TABLE users ADD COLUMN is_superuser BOOLEAN NOT NULL DEFAULT FALSE;
            END IF;
        END $$;
    """)
    
    # Add must_change_password column if it doesn't exist
    op.execute("""
        DO $$ 
        BEGIN 
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='users' AND column_name='must_change_password'
            ) THEN
                ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT TRUE;
            END IF;
        END $$;
    """)


def downgrade() -> None:
    """Remove user security fields."""
    # Drop columns if they exist
    op.execute("""
        DO $$ 
        BEGIN 
            IF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='users' AND column_name='must_change_password'
            ) THEN
                ALTER TABLE users DROP COLUMN must_change_password;
            END IF;
        END $$;
    """)
    
    op.execute("""
        DO $$ 
        BEGIN 
            IF EXISTS (
                SELECT 1 FROM information_schema.columns 
                WHERE table_name='users' AND column_name='is_superuser'
            ) THEN
                ALTER TABLE users DROP COLUMN is_superuser;
            END IF;
        END $$;
    """)

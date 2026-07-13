"""Add RBAC system with role enum constraint and index.

Revision ID: 009
Revises: 008
Create Date: 2026-01-01

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


# Valid roles
VALID_ROLES = ['admin', 'project_manager', 'annotator', 'qa_reviewer', 'customer_qa']


def upgrade() -> None:
    # Add check constraint for valid roles
    op.create_check_constraint(
        'ck_users_role_valid',
        'users',
        sa.column('role').in_(VALID_ROLES)
    )
    
    # Add index on role column for faster role-based queries
    op.create_index(
        'ix_users_role',
        'users',
        ['role'],
        unique=False
    )
    
    # Update any existing users with old/invalid roles to 'annotator'
    op.execute(
        f"""
        UPDATE users 
        SET role = 'annotator' 
        WHERE role NOT IN ({', '.join(f"'{r}'" for r in VALID_ROLES)})
        """
    )


def downgrade() -> None:
    # Remove index
    op.drop_index('ix_users_role', table_name='users')
    
    # Remove check constraint
    op.drop_constraint('ck_users_role_valid', 'users', type_='check')

"""Add organization-based multi-tenancy

Revision ID: 018_add_organization_multitenancy
Revises: 017_add_review_stage_to_qa_reviews
Create Date: 2026-02-11

This migration adds:
1. organizations table - root tenant entity
2. organization_members table - user-organization membership with roles
3. organization_id foreign key to campaigns and taxonomies
4. Indexes for efficient tenant-scoped queries
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '018'
down_revision: Union[str, None] = '017'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create organizations table
    op.create_table(
        'organizations',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), primary_key=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('slug', sa.String(100), nullable=False, unique=True),
        sa.Column('description', sa.Text(), nullable=True),
        sa.Column('logo_url', sa.String(500), nullable=True),
        sa.Column('settings', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('deleted_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_deleted', sa.Boolean(), nullable=False, server_default=sa.text('false')),
    )
    op.create_index('ix_organizations_name', 'organizations', ['name'])
    op.create_index('ix_organizations_slug', 'organizations', ['slug'], unique=True)
    op.create_index('ix_organizations_is_active', 'organizations', ['is_active'])
    
    # Create organization_members table (user-organization membership)
    op.create_table(
        'organization_members',
        sa.Column('id', postgresql.UUID(as_uuid=True), server_default=sa.text('uuid_generate_v4()'), primary_key=True),
        sa.Column('organization_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('organizations.id', ondelete='CASCADE'), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False),
        sa.Column('role', sa.String(50), nullable=False, server_default='member'),  # owner, admin, member
        sa.Column('is_default', sa.Boolean(), nullable=False, server_default=sa.text('false')),  # User's default org
        sa.Column('invited_by', postgresql.UUID(as_uuid=True), sa.ForeignKey('users.id', ondelete='SET NULL'), nullable=True),
        sa.Column('invited_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('joined_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        # Unique constraint: user can only be member of an org once
        sa.UniqueConstraint('organization_id', 'user_id', name='uq_org_member'),
    )
    op.create_index('ix_organization_members_org_id', 'organization_members', ['organization_id'])
    op.create_index('ix_organization_members_user_id', 'organization_members', ['user_id'])
    op.create_index('ix_organization_members_role', 'organization_members', ['role'])
    op.create_index('ix_organization_members_is_default', 'organization_members', ['user_id', 'is_default'])
    
    # Add organization_id to campaigns
    op.add_column('campaigns', sa.Column('organization_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_campaigns_organization',
        'campaigns', 'organizations',
        ['organization_id'], ['id'],
        ondelete='CASCADE'
    )
    op.create_index('ix_campaigns_organization_id', 'campaigns', ['organization_id'])
    
    # Add organization_id to taxonomies
    op.add_column('taxonomies', sa.Column('organization_id', postgresql.UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_taxonomies_organization',
        'taxonomies', 'organizations',
        ['organization_id'], ['id'],
        ondelete='CASCADE'
    )
    op.create_index('ix_taxonomies_organization_id', 'taxonomies', ['organization_id'])
    
    # Create a default organization for existing data
    op.execute("""
        INSERT INTO organizations (id, name, slug, description, settings)
        VALUES (
            uuid_generate_v4(),
            'Default Organization',
            'default',
            'Default organization for existing data',
            '{"is_system_default": true}'::jsonb
        )
    """)
    
    # Assign existing campaigns to default organization
    op.execute("""
        UPDATE campaigns 
        SET organization_id = (SELECT id FROM organizations WHERE slug = 'default')
        WHERE organization_id IS NULL
    """)
    
    # Assign existing taxonomies to default organization
    op.execute("""
        UPDATE taxonomies 
        SET organization_id = (SELECT id FROM organizations WHERE slug = 'default')
        WHERE organization_id IS NULL
    """)
    
    # Add all existing users as members of the default organization
    op.execute("""
        INSERT INTO organization_members (organization_id, user_id, role, is_default)
        SELECT 
            (SELECT id FROM organizations WHERE slug = 'default'),
            id,
            CASE 
                WHEN is_superuser = true OR role = 'admin' THEN 'owner'
                WHEN role = 'project_manager' THEN 'admin'
                ELSE 'member'
            END,
            true
        FROM users
    """)
    
    # Now make organization_id NOT NULL on campaigns
    op.alter_column('campaigns', 'organization_id', nullable=False)
    
    # Keep taxonomies nullable for shared/global taxonomies (optional)
    # op.alter_column('taxonomies', 'organization_id', nullable=False)


def downgrade() -> None:
    # Remove foreign keys and columns
    op.drop_constraint('fk_campaigns_organization', 'campaigns', type_='foreignkey')
    op.drop_index('ix_campaigns_organization_id', table_name='campaigns')
    op.drop_column('campaigns', 'organization_id')
    
    op.drop_constraint('fk_taxonomies_organization', 'taxonomies', type_='foreignkey')
    op.drop_index('ix_taxonomies_organization_id', table_name='taxonomies')
    op.drop_column('taxonomies', 'organization_id')
    
    # Drop organization_members table
    op.drop_index('ix_organization_members_is_default', table_name='organization_members')
    op.drop_index('ix_organization_members_role', table_name='organization_members')
    op.drop_index('ix_organization_members_user_id', table_name='organization_members')
    op.drop_index('ix_organization_members_org_id', table_name='organization_members')
    op.drop_table('organization_members')
    
    # Drop organizations table
    op.drop_index('ix_organizations_is_active', table_name='organizations')
    op.drop_index('ix_organizations_slug', table_name='organizations')
    op.drop_index('ix_organizations_name', table_name='organizations')
    op.drop_table('organizations')

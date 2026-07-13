"""Add user SSO identities table

Revision ID: 027
Revises: 026
Create Date: 2026-02-25

Adds the ``user_sso_identities`` table which links local User accounts with
external OIDC identity-provider subjects (Google, Azure AD, Okta, Keycloak).
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = "027"
down_revision = "026"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "user_sso_identities",
        sa.Column(
            "id",
            postgresql.UUID(as_uuid=True),
            primary_key=True,
            nullable=False,
        ),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Provider slug: google | azure | okta | keycloak
        sa.Column("provider", sa.String(50), nullable=False),
        # OIDC subject claim – unique within a provider
        sa.Column("provider_subject", sa.String(512), nullable=False),
        # Email as returned by the provider (informational only)
        sa.Column("provider_email", sa.String(255), nullable=True),
        # Raw claims blob
        sa.Column(
            "provider_claims",
            postgresql.JSONB,
            server_default="{}",
            nullable=False,
        ),
        # Timestamps
        sa.Column(
            "last_login_at",
            sa.DateTime(timezone=True),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            onupdate=sa.func.now(),
            nullable=False,
        ),
    )

    # Unique constraint: one identity per (provider, subject) pair
    op.create_unique_constraint(
        "uq_sso_provider_subject",
        "user_sso_identities",
        ["provider", "provider_subject"],
    )

    # Performance indexes
    op.create_index(
        "ix_user_sso_identities_user_id",
        "user_sso_identities",
        ["user_id"],
    )
    op.create_index(
        "ix_user_sso_identities_provider",
        "user_sso_identities",
        ["provider"],
    )


def downgrade() -> None:
    op.drop_index("ix_user_sso_identities_provider", table_name="user_sso_identities")
    op.drop_index("ix_user_sso_identities_user_id", table_name="user_sso_identities")
    op.drop_constraint(
        "uq_sso_provider_subject", "user_sso_identities", type_="unique"
    )
    op.drop_table("user_sso_identities")

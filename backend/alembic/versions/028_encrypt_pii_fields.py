"""Placeholder (PII field-encryption removed for the open-source build).

Revision ID: 028
Revises: 027

The original 028 migration encrypted PII columns (email/full_name/provider_email/
provider_claims) and added a ``users.email_blind_index`` column for encrypted
lookups. Field-level PII encryption has been removed from the open-source build —
user PII is stored as plaintext — so this revision now performs no schema changes.

It is retained only to keep the migration chain linear (029..head depend on it).
The pre-028 schema (from 022..027) already matches the plaintext models:
``users.email`` stays ``String`` (unique, ``ix_users_email``), ``full_name`` stays
``String``, ``user_sso_identities.provider_email`` stays ``String``, and
``provider_claims`` stays ``JSONB``. No ``email_blind_index`` column is created, so
a fresh install needs no data migration.
"""
from __future__ import annotations

from alembic import op  # noqa: F401
import sqlalchemy as sa  # noqa: F401

# revision identifiers, used by Alembic.
revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

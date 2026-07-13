"""Encrypt PII columns and add blind index for email lookups.

Revision ID: 028
Revises: 027
Create Date: 2026-02-25

Schema changes
--------------
users
  * email          String(255) → Text  (stores Fernet ciphertext)
  * email_blind_index  NEW Text(64) UNIQUE  (HMAC-SHA256 of lower-cased email)
  * full_name      String(255) → Text  (stores Fernet ciphertext)
  * Drops old ix_users_email index; adds ix_users_email_blind_index + unique constraint

user_sso_identities
  * provider_email  String(255) → Text  (stores Fernet ciphertext)
  * provider_claims JSONB → Text        (stores Fernet-encrypted JSON)

Infrastructure
--------------
  * Enables the pgcrypto extension for future column-level SQL operations.

Data migration
--------------
Existing rows are encrypted in-process using the ``EncryptionService``.  If
``FERNET_ENCRYPTION_KEY`` / ``FERNET_HMAC_KEY`` are not configured the
migration **still completes** but leaves rows with a sentinel NULL
``email_blind_index``; administrators MUST run the backfill script
``scripts/backfill_encrypt_pii.py`` before the application upgrade goes live.
"""
from __future__ import annotations

import logging
import os

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

logger = logging.getLogger(__name__)

# revision identifiers, used by Alembic.
revision = "028"
down_revision = "027"
branch_labels = None
depends_on = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_encryption_service():
    """Return an EncryptionService or None if keys are not configured."""
    try:
        from app.core.encryption import get_encryption_service
        return get_encryption_service()
    except SystemExit:
        logger.warning(
            "FERNET_ENCRYPTION_KEY not set – data migration skipped. "
            "Run scripts/backfill_encrypt_pii.py after setting the keys."
        )
        return None


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------

def upgrade() -> None:
    connection = op.get_bind()

    # 1. Enable pgcrypto for future server-side crypto operations (AC 1 / TDE helper)
    connection.execute(sa.text("CREATE EXTENSION IF NOT EXISTS pgcrypto"))

    # -----------------------------------------------------------------------
    # users table
    # -----------------------------------------------------------------------

    # 1a. Add email_blind_index column (nullable first so existing rows don't fail)
    op.add_column(
        "users",
        sa.Column("email_blind_index", sa.String(64), nullable=True),
    )

    # 1b. Change email → Text (to hold Fernet ciphertext)
    op.alter_column("users", "email", type_=sa.Text(), existing_nullable=False)

    # 1c. Change full_name → Text
    op.alter_column("users", "full_name", type_=sa.Text(), existing_nullable=True)

    # 1d. Drop old plain-text email index and unique constraint using IF EXISTS so
    #     no statement ever fails mid-transaction (PostgreSQL aborts on any error).
    connection.execute(sa.text("DROP INDEX IF EXISTS ix_users_email"))
    connection.execute(
        sa.text("ALTER TABLE users DROP CONSTRAINT IF EXISTS uq_users_email")
    )
    # Also handle the auto-generated name PostgreSQL assigns to unique columns
    connection.execute(
        sa.text("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_key")
    )

    # -----------------------------------------------------------------------
    # user_sso_identities table
    # -----------------------------------------------------------------------

    # 2a. Change provider_email → Text
    op.alter_column(
        "user_sso_identities",
        "provider_email",
        type_=sa.Text(),
        existing_nullable=True,
    )

    # 2b. Change provider_claims JSONB → Text (stores Fernet-encrypted JSON).
    #     Drop the server_default first, then cast; avoid op.alter_column for
    #     JSONB→Text because Alembic/asyncpg doesn't handle the USING clause reliably.
    connection.execute(
        sa.text(
            "ALTER TABLE user_sso_identities "
            "ALTER COLUMN provider_claims DROP DEFAULT"
        )
    )
    connection.execute(
        sa.text(
            "ALTER TABLE user_sso_identities "
            "ALTER COLUMN provider_claims TYPE TEXT "
            "USING provider_claims::text"
        )
    )

    # -----------------------------------------------------------------------
    # Data migration – encrypt existing rows
    # -----------------------------------------------------------------------
    enc = _get_encryption_service()

    if enc is not None:
        # --- users ----------------------------------------------------------
        rows = connection.execute(
            sa.text("SELECT id, email, full_name FROM users")
        ).fetchall()

        for row in rows:
            row_id = row[0]
            email = row[1] or ""
            full_name = row[2]

            # Compute blind index (deterministic HMAC of lower-cased email)
            email_blind = enc.blind_index(email) if email else ""
            # Encrypt email ciphertext (skip if already looks like a Fernet token)
            encrypted_email = _maybe_encrypt(enc, email)
            # Encrypt full_name
            encrypted_full_name = _maybe_encrypt(enc, full_name) if full_name else None

            connection.execute(
                sa.text(
                    "UPDATE users SET email = :e, email_blind_index = :bi, "
                    "full_name = :fn WHERE id = :id"
                ),
                {
                    "e": encrypted_email,
                    "bi": email_blind,
                    "fn": encrypted_full_name,
                    "id": str(row_id),
                },
            )

        # --- user_sso_identities --------------------------------------------
        sso_rows = connection.execute(
            sa.text(
                "SELECT id, provider_email, provider_claims FROM user_sso_identities"
            )
        ).fetchall()

        for row in sso_rows:
            row_id = row[0]
            provider_email = row[1]
            provider_claims_raw = row[2]

            enc_provider_email = (
                _maybe_encrypt(enc, provider_email) if provider_email else None
            )
            # provider_claims is now Text – it may be a JSON string from the JSONB cast
            if provider_claims_raw is not None:
                import json
                # If it's already a dict (unlikely at this point), serialise it first
                if isinstance(provider_claims_raw, dict):
                    provider_claims_raw = json.dumps(provider_claims_raw)
                enc_provider_claims = enc.encrypt(str(provider_claims_raw))
            else:
                enc_provider_claims = enc.encrypt_json({})

            connection.execute(
                sa.text(
                    "UPDATE user_sso_identities "
                    "SET provider_email = :pe, provider_claims = :pc "
                    "WHERE id = :id"
                ),
                {
                    "pe": enc_provider_email,
                    "pc": enc_provider_claims,
                    "id": str(row_id),
                },
            )

        logger.info(
            "PII encryption data migration complete: %d user(s), %d SSO identity(s) encrypted.",
            len(rows),
            len(sso_rows),
        )
    else:
        logger.warning(
            "Encryption keys unavailable – skipping PII data migration. "
            "Set FERNET_ENCRYPTION_KEY and FERNET_HMAC_KEY then run "
            "scripts/backfill_encrypt_pii.py to encrypt existing rows."
        )

    # -----------------------------------------------------------------------
    # Apply NOT NULL + unique constraint on email_blind_index
    # -----------------------------------------------------------------------
    # Set a fallback for any rows that were missed (no key configured)
    connection.execute(
        sa.text(
            "UPDATE users SET email_blind_index = '' WHERE email_blind_index IS NULL"
        )
    )
    op.alter_column("users", "email_blind_index", nullable=False)

    # Unique constraint + index replace the old email unique index
    op.create_unique_constraint(
        "uq_users_email_blind_index", "users", ["email_blind_index"]
    )
    op.create_index(
        "ix_users_email_blind_index", "users", ["email_blind_index"], unique=True
    )


# ---------------------------------------------------------------------------
# Downgrade
# ---------------------------------------------------------------------------

def downgrade() -> None:
    connection = op.get_bind()

    # Remove blind-index artefacts
    op.drop_index("ix_users_email_blind_index", table_name="users")
    op.drop_constraint("uq_users_email_blind_index", table_name="users", type_="unique")
    op.drop_column("users", "email_blind_index")

    # Revert column types (data in the columns will be ciphertext, not plaintext!)
    op.alter_column("users", "email", type_=sa.String(255), existing_nullable=False)
    op.alter_column("users", "full_name", type_=sa.String(255), existing_nullable=True)

    op.alter_column(
        "user_sso_identities",
        "provider_email",
        type_=sa.String(255),
        existing_nullable=True,
    )
    op.alter_column(
        "user_sso_identities",
        "provider_claims",
        type_=postgresql.JSONB(),
        existing_nullable=False,
        postgresql_using="provider_claims::jsonb",
    )

    # Restore original plain-text email index
    op.create_index("ix_users_email", "users", ["email"])


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _is_fernet_token(value: str) -> bool:
    """Return True if *value* already looks like a Fernet URL-safe-base64 token."""
    if not value:
        return False
    # Fernet tokens start with 'gAAA' and are significantly longer than any email
    return value.startswith("gAAA") and len(value) > 80


def _maybe_encrypt(enc, value: str) -> str:
    """Encrypt *value* only if it does not already appear to be a Fernet token."""
    if not value:
        return value
    if _is_fernet_token(value):
        return value  # Already encrypted (re-run protection)
    return enc.encrypt(value)

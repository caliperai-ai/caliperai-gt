#!/usr/bin/env python3
"""
Backfill script: encrypt existing plaintext PII rows in PostgreSQL.

Run this script AFTER setting FERNET_ENCRYPTION_KEY and FERNET_HMAC_KEY in
the environment if they were not available when Alembic migration 028 ran,
or after rotating to a new primary Fernet key.

Usage
-----
    export FERNET_ENCRYPTION_KEY="<your-key>"
    export FERNET_HMAC_KEY="<your-hmac-key>"
    export DATABASE_URL="postgresql+asyncpg://..."
    export SECRET_KEY="<your-secret>"
    python scripts/backfill_encrypt_pii.py [--dry-run]

Options
-------
    --dry-run   Print what would be changed without writing to the database.
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


async def backfill(dry_run: bool = False) -> None:
    from app.core.encryption import get_encryption_service, reset_encryption_service
    from app.core.encrypted_type import EncryptedString, EncryptedJSON

    reset_encryption_service()
    enc = get_encryption_service()

    db_url: str = os.environ["DATABASE_URL"]
    engine = create_async_engine(db_url, echo=False)
    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as session:
        async with session.begin():
            result = await session.execute(
                sa.text("SELECT id, email, full_name FROM users")
            )
            users = result.fetchall()
            updated_users = 0

            for row in users:
                uid, email, full_name = row

                if email and _is_fernet_token(email):
                    continue

                new_email = enc.encrypt(email) if email else email
                new_blind = enc.blind_index(email) if email else ""
                new_full_name = enc.encrypt(full_name) if full_name else None

                if not dry_run:
                    await session.execute(
                        sa.text(
                            "UPDATE users SET email = :e, email_blind_index = :bi, "
                            "full_name = :fn WHERE id = :id"
                        ),
                        {
                            "e": new_email,
                            "bi": new_blind,
                            "fn": new_full_name,
                            "id": str(uid),
                        },
                    )
                updated_users += 1

            logger.info("%s%d users processed.", "[DRY-RUN] " if dry_run else "", updated_users)

            sso_result = await session.execute(
                sa.text(
                    "SELECT id, provider_email, provider_claims FROM user_sso_identities"
                )
            )
            sso_rows = sso_result.fetchall()
            updated_sso = 0

            for row in sso_rows:
                sid, provider_email, provider_claims_raw = row

                enc_provider_email: str | None = None
                if provider_email and not _is_fernet_token(provider_email):
                    enc_provider_email = enc.encrypt(provider_email)

                enc_provider_claims: str | None = None
                if provider_claims_raw is not None and not _is_fernet_token(
                    str(provider_claims_raw)
                ):
                    import json

                    raw = (
                        json.dumps(provider_claims_raw)
                        if isinstance(provider_claims_raw, dict)
                        else str(provider_claims_raw)
                    )
                    enc_provider_claims = enc.encrypt(raw)

                if enc_provider_email is None and enc_provider_claims is None:
                    continue

                if not dry_run:
                    await session.execute(
                        sa.text(
                            "UPDATE user_sso_identities "
                            "SET provider_email = COALESCE(:pe, provider_email), "
                            "    provider_claims = COALESCE(:pc, provider_claims) "
                            "WHERE id = :id"
                        ),
                        {
                            "pe": enc_provider_email,
                            "pc": enc_provider_claims,
                            "id": str(sid),
                        },
                    )
                updated_sso += 1

            logger.info(
                "%s%d SSO identities processed.",
                "[DRY-RUN] " if dry_run else "",
                updated_sso,
            )

            if dry_run:
                await session.rollback()
            else:
                logger.info("Encryption backfill committed successfully.")

    await engine.dispose()


def _is_fernet_token(value: str) -> bool:
    """Heuristic: Fernet tokens begin with 'gAAA' and are > 80 chars."""
    return bool(value) and value.startswith("gAAA") and len(value) > 80


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Encrypt existing PII rows in the database.")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be updated without writing to the database.",
    )
    args = parser.parse_args()

    asyncio.run(backfill(dry_run=args.dry_run))

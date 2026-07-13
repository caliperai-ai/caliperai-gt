"""
Fernet-based application-level encryption for sensitive database fields.

Design
------
* One primary key + zero-or-more previous keys (key rotation via MultiFernet).
* A separate HMAC key drives *blind indexes* — deterministic, constant-length
  SHA-256 digests used for equality-based SQL look-ups on encrypted columns.
* Keys are loaded exclusively from environment variables; they are NEVER stored
  alongside the database data (AC 4).

Environment variables
---------------------
FERNET_ENCRYPTION_KEY   URL-safe base64-encoded 32-byte Fernet key (required in
                        production; auto-generated insecure key used in dev/test).
FERNET_ENCRYPTION_KEY_PREV  Comma-separated list of retired Fernet keys that
                        can still *decrypt* (write-path always uses the primary
                        key).  Optional.
FERNET_HMAC_KEY         Secret used for blind indexes.  Must differ from the
                        Fernet key.  Required in production; falls back to a
                        dev placeholder in dev/test.

Key generation
--------------
    python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
"""
from __future__ import annotations

import base64
import hashlib
import hmac as _hmac
import json
import logging
import os
import sys
from functools import lru_cache
from typing import Any

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

logger = logging.getLogger(__name__)

_DEV_FERNET_KEY: str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="
_DEV_HMAC_KEY: bytes = b"dev-hmac-key-not-for-production-use-only!"
_BLIND_INDEX_LENGTH: int = 64


class EncryptionService:
    """Provides encrypt / decrypt / blind_index operations.

    Thread-safe; initialised once via ``get_encryption_service()``.
    """

    def __init__(
        self,
        primary_key: str,
        previous_keys: list[str] | None = None,
        hmac_key: bytes | str = _DEV_HMAC_KEY,
    ) -> None:
        fernets: list[Fernet] = [Fernet(primary_key.encode())]
        for k in previous_keys or []:
            k = k.strip()
            if k:
                fernets.append(Fernet(k.encode()))
        self._fernet = MultiFernet(fernets)
        self._hmac_key: bytes = (
            hmac_key.encode() if isinstance(hmac_key, str) else hmac_key
        )

    def encrypt(self, plaintext: str) -> str:
        """Encrypt *plaintext* and return a URL-safe base64 token string."""
        if not plaintext:
            return plaintext
        token: bytes = self._fernet.encrypt(plaintext.encode())
        return token.decode()

    def decrypt(self, ciphertext: str) -> str | None:
        """Decrypt *ciphertext*.

        Returns ``None`` for empty/null input, raises ``InvalidToken`` if the
        ciphertext was tampered with or encrypted by an unknown key.
        """
        if not ciphertext:
            return None
        try:
            plaintext: bytes = self._fernet.decrypt(ciphertext.encode())
            return plaintext.decode()
        except InvalidToken:
            logger.error("Decryption failed: invalid or tampered ciphertext")
            raise

    def encrypt_json(self, value: Any) -> str:
        """Serialise *value* to JSON then encrypt."""
        return self.encrypt(json.dumps(value, default=str))

    def decrypt_json(self, ciphertext: str) -> Any:
        """Decrypt ciphertext then deserialise JSON.  Returns ``None`` for empty input."""
        plaintext = self.decrypt(ciphertext)
        if plaintext is None:
            return None
        return json.loads(plaintext)

    def blind_index(self, value: str) -> str:
        """Return a deterministic HMAC-SHA256 hex digest (64 chars).

        Suitable for use as an indexed column when the *plaintext* must remain
        queryable without storing it in the clear.  The result is always the
        same for the same input + key pair.

        Args:
            value: The plaintext to hash (e.g. an email address).

        Returns:
            64-character lowercase hex string.
        """
        if not value:
            return ""
        mac = _hmac.new(self._hmac_key, value.lower().encode(), hashlib.sha256)
        return mac.hexdigest()


@lru_cache(maxsize=1)
def get_encryption_service() -> EncryptionService:
    """Return the application-wide ``EncryptionService`` instance.

    Key loading strategy
    --------------------
    1. Read ``FERNET_ENCRYPTION_KEY`` from the environment.
    2. If not set and we are in a *dev/test* environment
       (``ENVIRONMENT != "production"``), generate a warning and use the
       insecure dev key so that the app can start without extra config.
    3. If not set and ``ENVIRONMENT == "production"``, abort immediately.
    """
    env: str = os.environ.get("ENVIRONMENT", "development").lower()
    primary_key: str | None = os.environ.get("FERNET_ENCRYPTION_KEY")
    hmac_key: str | None = os.environ.get("FERNET_HMAC_KEY")

    if not primary_key:
        if env == "production":
            sys.exit(
                "\nFATAL: FERNET_ENCRYPTION_KEY is not set.\n"
                "Generate one with:\n"
                "  python -c \"from cryptography.fernet import Fernet; "
                "print(Fernet.generate_key().decode())\"\n"
            )
        logger.warning(
            "FERNET_ENCRYPTION_KEY not set — using insecure dev key. "
            "Set this variable before deploying to production!"
        )
        primary_key = _DEV_FERNET_KEY

    if not hmac_key:
        if env == "production":
            sys.exit(
                "\nFATAL: FERNET_HMAC_KEY is not set.\n"
                "Generate one with:\n"
                "  python -c \"import secrets; print(secrets.token_hex(32))\"\n"
            )
        logger.warning(
            "FERNET_HMAC_KEY not set — using insecure dev key. "
            "Set this variable before deploying to production!"
        )

    prev_raw: str = os.environ.get("FERNET_ENCRYPTION_KEY_PREV", "")
    previous_keys: list[str] = [k.strip() for k in prev_raw.split(",") if k.strip()]

    return EncryptionService(
        primary_key=primary_key,
        previous_keys=previous_keys,
        hmac_key=hmac_key.encode() if hmac_key else _DEV_HMAC_KEY,
    )


def reset_encryption_service() -> None:
    """Clear the LRU cache (used in tests to inject a fresh service)."""
    get_encryption_service.cache_clear()

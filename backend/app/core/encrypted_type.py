"""
Custom SQLAlchemy TypeDecorators for transparent Fernet field encryption.

Usage in models
---------------

    from app.core.encrypted_type import EncryptedString, EncryptedJSON

    class User(Base):
        full_name: Mapped[Optional[str]] = mapped_column(
            EncryptedString(255), nullable=True
        )

Storage format
--------------
All encrypted types store a Fernet token (URL-safe base64 string) in a plain
``Text`` column.  The ciphertext length varies but is always longer than the
plaintext — size accordingly (PostgreSQL ``Text`` is unbounded, so column-size
hints are advisory only).

The optional ``length`` constructor argument on ``EncryptedString`` is kept for
API compatibility with ``String(n)`` columns but has no effect on the DB type
(both map to ``Text``).
"""
from __future__ import annotations

import json
from typing import Any

from sqlalchemy import Text
from sqlalchemy.engine import Dialect
from sqlalchemy.types import TypeDecorator

from app.core.encryption import get_encryption_service


__all__ = ["EncryptedString", "EncryptedJSON"]


class EncryptedString(TypeDecorator):
    """Store an encrypted UTF-8 string in a ``Text`` database column.

    On write: plaintext → Fernet ciphertext (stored in DB).
    On read:  Fernet ciphertext → plaintext (returned to Python).

    ``None`` is passed through unchanged so that nullable columns work as
    expected.
    """

    impl = Text
    cache_ok = True

    def __init__(self, length: int | None = None, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._length_hint = length

    def process_bind_param(self, value: str | None, dialect: Dialect) -> str | None:
        """Encrypt plaintext before writing to database."""
        if value is None:
            return None
        return get_encryption_service().encrypt(str(value))

    def process_result_value(self, value: str | None, dialect: Dialect) -> str | None:
        """Decrypt ciphertext returned from database."""
        if value is None:
            return None
        return get_encryption_service().decrypt(value)

    def copy(self, **kwargs: Any) -> "EncryptedString":
        return EncryptedString(self._length_hint)


class EncryptedJSON(TypeDecorator):
    """Store an encrypted JSON blob in a ``Text`` database column.

    The Python-side value is any JSON-serialisable object (dict, list, etc.).
    It is serialised to a JSON string, encrypted with Fernet, and stored as
    a ciphertext in the ``Text`` column.

    On read the decrypt→deserialise path reconstructs the original Python
    object.

    ``None`` is passed through unchanged.
    """

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: Any | None, dialect: Dialect) -> str | None:
        """Serialise to JSON then encrypt before writing to database."""
        if value is None:
            return None
        return get_encryption_service().encrypt_json(value)

    def process_result_value(self, value: str | None, dialect: Dialect) -> Any | None:
        """Decrypt then deserialise JSON from database."""
        if value is None:
            return None
        return get_encryption_service().decrypt_json(value)

    def copy(self, **kwargs: Any) -> "EncryptedJSON":
        return EncryptedJSON()

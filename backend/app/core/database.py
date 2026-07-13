"""Database connection and session management."""
import ssl
from typing import AsyncGenerator, Optional
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    create_async_engine,
    async_sessionmaker,
)
from sqlalchemy import text
from sqlalchemy.orm import DeclarativeBase
from sqlalchemy.pool import NullPool, StaticPool

from app.core.config import get_settings

settings = get_settings()


class Base(DeclarativeBase):
    """Base class for all SQLAlchemy models."""
    pass


def _build_pg_ssl_context() -> Optional[ssl.SSLContext]:
    """Build an SSLContext for asyncpg from settings.DB_SSL_MODE and cert paths.

    Returns None when SSL is disabled or we are using SQLite.

    sslmode mapping (mirrors libpq semantics):
      disable     → None (no TLS at all)
      allow       → None (driver falls back to plain when server refuses TLS)
      prefer      → SSLContext with CERT_NONE  (opportunistic TLS, no cert check)
      require     → SSLContext with CERT_NONE  (TLS required, server cert unverified)
      verify-ca   → SSLContext with CERT_REQUIRED + CA  (verify chain, not hostname)
      verify-full → SSLContext with CERT_REQUIRED + CA + check_hostname=True
    """
    mode = settings.DB_SSL_MODE
    if mode in ("disable", "allow"):
        return None

    ctx = ssl.create_default_context()

    if mode == "prefer" or mode == "require":
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    elif mode in ("verify-ca", "verify-full"):
        if not settings.DB_SSL_CA:
            raise RuntimeError(
                f"DB_SSL_MODE={mode!r} requires DB_SSL_CA to be set to the "
                "path of the CA certificate."
            )
        ctx.load_verify_locations(cafile=settings.DB_SSL_CA)
        ctx.verify_mode = ssl.CERT_REQUIRED
        ctx.check_hostname = mode == "verify-full"

    else:
        raise ValueError(f"Unknown DB_SSL_MODE value: {mode!r}")

    if settings.DB_SSL_CERT and settings.DB_SSL_KEY:
        ctx.load_cert_chain(
            certfile=settings.DB_SSL_CERT,
            keyfile=settings.DB_SSL_KEY,
        )

    return ctx


is_sqlite = settings.DATABASE_URL.startswith("sqlite")

_pg_ssl_ctx: Optional[ssl.SSLContext] = None if is_sqlite else _build_pg_ssl_context()
_pg_connect_args: dict = {}
if not is_sqlite:
    if _pg_ssl_ctx is not None:
        _pg_connect_args["ssl"] = _pg_ssl_ctx
    elif settings.DB_SSL_MODE in ("disable", "allow"):
        _pg_connect_args["ssl"] = False

if is_sqlite:
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=settings.DEBUG,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
elif settings.DEBUG:
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=False,
        pool_size=5,
        max_overflow=10,
        pool_pre_ping=True,
        connect_args=_pg_connect_args,
    )
else:
    engine = create_async_engine(
        settings.DATABASE_URL,
        echo=settings.DEBUG,
        pool_size=settings.DATABASE_POOL_SIZE,
        max_overflow=settings.DATABASE_MAX_OVERFLOW,
        pool_pre_ping=True,
        connect_args=_pg_connect_args,
    )

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """Dependency for getting async database sessions."""
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


async def init_db() -> None:
    """Initialize database tables.

    Every gunicorn worker runs this on boot, so DDL executes concurrently
    across processes. ``create_all(checkfirst=True)`` only guards within a
    single connection's snapshot, so without coordination the workers race
    on ``CREATE INDEX``/``CREATE TABLE`` and all transactions roll back,
    leaving the schema uncreated. A transaction-scoped Postgres advisory
    lock serialises the DDL: the first worker builds the schema and commits
    (releasing the lock), and every subsequent worker then finds everything
    already present and no-ops via ``checkfirst``.
    """
    _INIT_DB_LOCK_KEY = 0x616E6E6F
    async with engine.begin() as conn:
        await conn.execute(
            text("SELECT pg_advisory_xact_lock(:key)"),
            {"key": _INIT_DB_LOCK_KEY},
        )
        await conn.run_sync(Base.metadata.create_all, checkfirst=True)


async def close_db() -> None:
    """Close database connections."""
    await engine.dispose()

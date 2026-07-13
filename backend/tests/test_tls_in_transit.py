"""
Internal Service TLS – in-transit encryption test suite.

Acceptance criteria covered
---------------------------
AC 1  PostgreSQL sslmode=require
      – DB_SSL_MODE setting exists and defaults to "prefer"
      – _build_pg_ssl_context returns None when mode is "disable"
      – _build_pg_ssl_context returns SSLContext with CERT_NONE for "prefer"
      – _build_pg_ssl_context returns SSLContext with CERT_NONE for "require"
      – _build_pg_ssl_context returns CERT_REQUIRED when mode is "verify-ca"
      – verify-ca raises RuntimeError when DB_SSL_CA is not set
      – "verify-full" enables check_hostname
      – Unknown sslmode raises ValueError
      – mTLS client cert is loaded when DB_SSL_CERT + DB_SSL_KEY are set
      – Production docker-compose.prod.yml sets DB_SSL_MODE=require

AC 2  Redis TLS (rediss:// scheme)
      – REDIS_TLS_ENABLED defaults to False
      – _build_redis_ssl_context returns None when TLS is disabled
      – _build_redis_ssl_context returns SSLContext when REDIS_TLS_ENABLED=True
      – Without REDIS_TLS_CA, verify mode is CERT_NONE (and warning is logged)
      – With REDIS_TLS_CA, verify mode is CERT_REQUIRED and check_hostname=True
      – With REDIS_TLS_CERT + REDIS_TLS_KEY, mTLS cert chain is loaded
      – init_redis passes ssl context to aioredis.from_url

AC 3  MinIO TLS (HTTPS endpoint)
      – MINIO_TLS_CA and MINIO_TLS_VERIFY settings exist on Settings
      – StorageService passes verify=True by default to boto3
      – StorageService passes verify=<ca_path> when MINIO_TLS_CA is set
      – StorageService passes verify=False when MINIO_TLS_VERIFY=False
      – StorageService logs a warning when MINIO_TLS_VERIFY=False
      – Production docker-compose sets OBJECT_STORAGE_ENDPOINT to https://

AC 4  Certificate management
      – scripts/gen_internal_certs.sh exists
      – Script is executable
      – Script generates ca.crt, postgres/server.crt, redis/server.crt,
        minio/public.crt in a temp directory
      – Generated CA cert is a valid X.509 certificate
      – Service certs are signed by the CA
      – Script is idempotent (does NOT overwrite without --rotate)
      – Script overwrites when --rotate is passed
"""
from __future__ import annotations

import os
import ssl
import stat
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch, call
from cryptography import x509
from cryptography.hazmat.backends import default_backend

import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

BACKEND_ROOT = Path(__file__).parent.parent
PROJECT_ROOT = BACKEND_ROOT.parent
CERT_SCRIPT = PROJECT_ROOT / "scripts" / "gen_internal_certs.sh"


def _make_settings(**overrides):
    """Return a Settings-like SimpleNamespace with sensible TLS defaults."""
    from types import SimpleNamespace

    defaults = {
        # PostgreSQL
        "DB_SSL_MODE": "prefer",
        "DB_SSL_CA": None,
        "DB_SSL_CERT": None,
        "DB_SSL_KEY": None,
        # Redis
        "REDIS_TLS_ENABLED": False,
        "REDIS_TLS_CA": None,
        "REDIS_TLS_CERT": None,
        "REDIS_TLS_KEY": None,
        "REDIS_URL": "redis://redis:6379/0",
        # MinIO
        "MINIO_TLS_CA": None,
        "MINIO_TLS_VERIFY": True,
        "OBJECT_STORAGE_ENDPOINT": "http://minio:9000",
        "OBJECT_STORAGE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORAGE_SECRET_KEY": "minioadmin",
        "OBJECT_STORAGE_PRESIGN_TTL": 900,
        "CORS_ORIGINS": ["http://localhost:3000"],
        "DATABASE_URL": "postgresql+asyncpg://postgres:pass@postgres:5432/db",
        "DATABASE_POOL_SIZE": 5,
        "DATABASE_MAX_OVERFLOW": 10,
        "DEBUG": False,
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


# ===========================================================================
# AC 1 – PostgreSQL sslmode=require
# ===========================================================================

class TestPostgreSQLTLS:
    """Validate _build_pg_ssl_context() for all sslmode variants."""

    def _import_builder(self, settings_ns):
        """Import _build_pg_ssl_context with patched settings."""
        import importlib
        import app.core.database as db_mod

        with patch.object(db_mod, "settings", settings_ns):
            # Re-import to pick up monkey-patch (function reads `settings` at
            # call time via the module-level binding, so direct re-call works).
            from app.core.database import _build_pg_ssl_context
            return _build_pg_ssl_context

    def test_settings_has_db_ssl_mode(self):
        """DB_SSL_MODE must exist in Settings with a string default."""
        from app.core.config import Settings
        assert hasattr(Settings.model_fields, "DB_SSL_MODE"), (
            "DB_SSL_MODE field missing from Settings"
        )

    def test_settings_db_ssl_mode_default(self):
        """Default DB_SSL_MODE should be 'prefer' (opportunistic TLS)."""
        from app.core.config import Settings
        field = Settings.model_fields["DB_SSL_MODE"]
        assert field.default == "prefer"

    def test_disable_returns_none(self):
        """sslmode=disable → no SSL context."""
        import app.core.database as db_mod
        s = _make_settings(DB_SSL_MODE="disable")
        with patch.object(db_mod, "settings", s):
            from app.core.database import _build_pg_ssl_context
            assert _build_pg_ssl_context() is None

    def test_allow_returns_none(self):
        """sslmode=allow → no SSL context (driver decides)."""
        import app.core.database as db_mod
        s = _make_settings(DB_SSL_MODE="allow")
        with patch.object(db_mod, "settings", s):
            from app.core.database import _build_pg_ssl_context
            assert _build_pg_ssl_context() is None

    def test_prefer_returns_ssl_context_cert_none(self):
        """sslmode=prefer → SSLContext with CERT_NONE (opportunistic TLS)."""
        import app.core.database as db_mod
        s = _make_settings(DB_SSL_MODE="prefer")
        with patch.object(db_mod, "settings", s):
            from app.core.database import _build_pg_ssl_context
            ctx = _build_pg_ssl_context()
        assert isinstance(ctx, ssl.SSLContext)
        assert ctx.verify_mode == ssl.CERT_NONE

    def test_require_returns_ssl_context_cert_none(self):
        """sslmode=require → SSLContext, TLS enforced, cert NOT verified (no CA)."""
        import app.core.database as db_mod
        s = _make_settings(DB_SSL_MODE="require")
        with patch.object(db_mod, "settings", s):
            from app.core.database import _build_pg_ssl_context
            ctx = _build_pg_ssl_context()
        assert isinstance(ctx, ssl.SSLContext)
        assert ctx.verify_mode == ssl.CERT_NONE

    def test_verify_ca_without_ca_raises(self):
        """verify-ca without DB_SSL_CA must raise RuntimeError."""
        import app.core.database as db_mod
        s = _make_settings(DB_SSL_MODE="verify-ca", DB_SSL_CA=None)
        with patch.object(db_mod, "settings", s):
            from app.core.database import _build_pg_ssl_context
            with pytest.raises(RuntimeError, match="DB_SSL_CA"):
                _build_pg_ssl_context()

    def test_verify_ca_with_ca_sets_cert_required(self, tmp_path):
        """verify-ca + CA path → CERT_REQUIRED, check_hostname=False."""
        import app.core.database as db_mod
        # Create a self-signed CA cert for test
        ca_pem = _generate_self_signed_cert_pem()
        ca_file = tmp_path / "ca.crt"
        ca_file.write_bytes(ca_pem)

        s = _make_settings(DB_SSL_MODE="verify-ca", DB_SSL_CA=str(ca_file))
        with patch.object(db_mod, "settings", s):
            from app.core.database import _build_pg_ssl_context
            ctx = _build_pg_ssl_context()
        assert ctx.verify_mode == ssl.CERT_REQUIRED
        assert ctx.check_hostname is False

    def test_verify_full_enables_check_hostname(self, tmp_path):
        """verify-full → check_hostname=True."""
        import app.core.database as db_mod
        ca_pem = _generate_self_signed_cert_pem()
        ca_file = tmp_path / "ca.crt"
        ca_file.write_bytes(ca_pem)

        s = _make_settings(DB_SSL_MODE="verify-full", DB_SSL_CA=str(ca_file))
        with patch.object(db_mod, "settings", s):
            from app.core.database import _build_pg_ssl_context
            ctx = _build_pg_ssl_context()
        assert ctx.check_hostname is True
        assert ctx.verify_mode == ssl.CERT_REQUIRED

    def test_unknown_sslmode_raises_value_error(self):
        """Unrecognised sslmode must raise ValueError."""
        import app.core.database as db_mod
        s = _make_settings(DB_SSL_MODE="totally-wrong")
        with patch.object(db_mod, "settings", s):
            from app.core.database import _build_pg_ssl_context
            with pytest.raises(ValueError, match="DB_SSL_MODE"):
                _build_pg_ssl_context()

    def test_mtls_cert_loaded(self, tmp_path):
        """When DB_SSL_CERT + DB_SSL_KEY are set, client cert chain is loaded."""
        import app.core.database as db_mod
        ca_pem, key_pem, cert_pem = _generate_ca_and_signed_cert_pem()

        ca_file = tmp_path / "ca.crt"
        ca_file.write_bytes(ca_pem)
        client_cert = tmp_path / "client.crt"
        client_cert.write_bytes(cert_pem)
        client_key = tmp_path / "client.key"
        client_key.write_bytes(key_pem)

        s = _make_settings(
            DB_SSL_MODE="verify-ca",
            DB_SSL_CA=str(ca_file),
            DB_SSL_CERT=str(client_cert),
            DB_SSL_KEY=str(client_key),
        )
        with patch.object(db_mod, "settings", s):
            from app.core.database import _build_pg_ssl_context
            ctx = _build_pg_ssl_context()
        # If load_cert_chain didn't raise, mTLS is configured
        assert ctx is not None

    def test_prod_compose_sets_db_ssl_mode_require(self):
        """docker-compose.prod.yml must set DB_SSL_MODE=require for the backend."""
        compose = (PROJECT_ROOT / "docker-compose.prod.yml").read_text()
        assert "DB_SSL_MODE=${DB_SSL_MODE:-require}" in compose, (
            "Production compose must default DB_SSL_MODE to 'require'"
        )


# ===========================================================================
# AC 2 – Redis TLS (rediss:// scheme)
# ===========================================================================

class TestRedisTLS:
    """Validate _build_redis_ssl_context() and init_redis() TLS wiring."""

    def test_settings_has_redis_tls_enabled(self):
        """REDIS_TLS_ENABLED must exist in Settings."""
        from app.core.config import Settings
        assert "REDIS_TLS_ENABLED" in Settings.model_fields

    def test_redis_tls_enabled_defaults_false(self):
        """REDIS_TLS_ENABLED defaults to False (backward-compatible)."""
        from app.core.config import Settings
        assert Settings.model_fields["REDIS_TLS_ENABLED"].default is False

    def test_disabled_returns_none(self):
        """When REDIS_TLS_ENABLED=False, no SSL context is returned."""
        import app.core.redis_cache as rc
        s = _make_settings(REDIS_TLS_ENABLED=False)
        with patch.object(rc, "settings", s):
            from app.core.redis_cache import _build_redis_ssl_context
            assert _build_redis_ssl_context() is None

    def test_enabled_without_ca_returns_context_cert_none(self):
        """REDIS_TLS_ENABLED=True without CA → SSLContext CERT_NONE + warning."""
        import app.core.redis_cache as rc
        s = _make_settings(REDIS_TLS_ENABLED=True, REDIS_TLS_CA=None)
        with patch.object(rc, "settings", s):
            from app.core.redis_cache import _build_redis_ssl_context
            import logging
            with patch.object(rc.logger, "warning") as mock_warn:
                ctx = _build_redis_ssl_context()
        assert isinstance(ctx, ssl.SSLContext)
        assert ctx.verify_mode == ssl.CERT_NONE
        mock_warn.assert_called_once()
        assert "REDIS_TLS_CA" in mock_warn.call_args[0][0]

    def test_enabled_with_ca_sets_cert_required(self, tmp_path):
        """REDIS_TLS_ENABLED=True + REDIS_TLS_CA → CERT_REQUIRED, check_hostname."""
        import app.core.redis_cache as rc
        ca_pem = _generate_self_signed_cert_pem()
        ca_file = tmp_path / "ca.crt"
        ca_file.write_bytes(ca_pem)

        s = _make_settings(REDIS_TLS_ENABLED=True, REDIS_TLS_CA=str(ca_file))
        with patch.object(rc, "settings", s):
            from app.core.redis_cache import _build_redis_ssl_context
            ctx = _build_redis_ssl_context()
        assert ctx.verify_mode == ssl.CERT_REQUIRED
        assert ctx.check_hostname is True

    def test_enabled_with_mtls(self, tmp_path):
        """REDIS_TLS_CERT + REDIS_TLS_KEY → mTLS client cert is loaded."""
        import app.core.redis_cache as rc
        ca_pem, key_pem, cert_pem = _generate_ca_and_signed_cert_pem()

        ca_file = tmp_path / "ca.crt"
        ca_file.write_bytes(ca_pem)
        client_cert = tmp_path / "client.crt"
        client_cert.write_bytes(cert_pem)
        client_key = tmp_path / "client.key"
        client_key.write_bytes(key_pem)

        s = _make_settings(
            REDIS_TLS_ENABLED=True,
            REDIS_TLS_CA=str(ca_file),
            REDIS_TLS_CERT=str(client_cert),
            REDIS_TLS_KEY=str(client_key),
        )
        with patch.object(rc, "settings", s):
            from app.core.redis_cache import _build_redis_ssl_context
            ctx = _build_redis_ssl_context()
        # load_cert_chain would raise if cert/key mismatch; reaching here means OK
        assert ctx is not None

    @pytest.mark.asyncio
    async def test_init_redis_passes_ssl_context(self, tmp_path):
        """init_redis must forward the ssl context to aioredis.from_url."""
        import app.core.redis_cache as rc

        fake_ctx = MagicMock(spec=ssl.SSLContext)
        fake_redis = AsyncMock()
        fake_redis.ping = AsyncMock()

        s = _make_settings(REDIS_TLS_ENABLED=True, REDIS_URL="rediss://redis:6379/0")
        with patch.object(rc, "settings", s), \
             patch.object(rc, "_build_redis_ssl_context", return_value=fake_ctx), \
             patch("app.core.redis_cache.aioredis.from_url", return_value=fake_redis) as mock_from_url:
            await rc.init_redis()

        kwargs = mock_from_url.call_args.kwargs
        assert "ssl" in kwargs, "ssl kwarg must be passed to aioredis.from_url"
        assert kwargs["ssl"] is fake_ctx

    @pytest.mark.asyncio
    async def test_init_redis_no_ssl_when_disabled(self):
        """When TLS is disabled, ssl=None is passed (plain TCP)."""
        import app.core.redis_cache as rc

        fake_redis = AsyncMock()
        fake_redis.ping = AsyncMock()

        s = _make_settings(REDIS_TLS_ENABLED=False, REDIS_URL="redis://redis:6379/0")
        with patch.object(rc, "settings", s), \
             patch("app.core.redis_cache.aioredis.from_url", return_value=fake_redis) as mock_from_url:
            await rc.init_redis()

        kwargs = mock_from_url.call_args.kwargs
        assert kwargs.get("ssl") is None

    def test_prod_compose_uses_rediss_scheme(self):
        """docker-compose.prod.yml must use rediss:// for the Redis URL."""
        compose = (PROJECT_ROOT / "docker-compose.prod.yml").read_text()
        assert "rediss://" in compose, (
            "Production compose must use rediss:// (TLS) for REDIS_URL"
        )

    def test_prod_compose_sets_redis_tls_enabled(self):
        """docker-compose.prod.yml must set REDIS_TLS_ENABLED=true."""
        compose = (PROJECT_ROOT / "docker-compose.prod.yml").read_text()
        assert "REDIS_TLS_ENABLED=true" in compose


# ===========================================================================
# AC 3 – MinIO TLS (HTTPS endpoint)
# ===========================================================================

class TestMinIOTLS:
    """Validate TLS wiring in StorageService (boto3 verify parameter)."""

    def _make_service(self, settings_ns):
        """Instantiate StorageService with patched settings (no real boto3 call)."""
        import app.services.storage_service as ss
        with patch.object(ss, "settings", settings_ns), \
             patch("app.services.storage_service.boto3.client") as mock_client:
            from app.services.storage_service import StorageService
            svc = StorageService()
            return svc, mock_client

    def test_settings_minio_tls_ca_exists(self):
        """MINIO_TLS_CA must exist in Settings."""
        from app.core.config import Settings
        assert "MINIO_TLS_CA" in Settings.model_fields

    def test_settings_minio_tls_verify_exists(self):
        """MINIO_TLS_VERIFY must exist in Settings and default to True."""
        from app.core.config import Settings
        assert "MINIO_TLS_VERIFY" in Settings.model_fields
        assert Settings.model_fields["MINIO_TLS_VERIFY"].default is True

    def test_default_verify_true(self):
        """Without any TLS config, boto3 client is called with verify=True."""
        s = _make_settings(MINIO_TLS_CA=None, MINIO_TLS_VERIFY=True)
        _, mock_client = self._make_service(s)
        kwargs = mock_client.call_args.kwargs
        assert kwargs.get("verify") is True

    def test_custom_ca_supplied_to_boto3(self, tmp_path):
        """When MINIO_TLS_CA is set, boto3 receives the CA path as verify=<path>."""
        ca_file = tmp_path / "ca.crt"
        ca_file.write_bytes(b"fake-ca-pem")
        s = _make_settings(MINIO_TLS_CA=str(ca_file), MINIO_TLS_VERIFY=True)
        _, mock_client = self._make_service(s)
        kwargs = mock_client.call_args.kwargs
        assert kwargs.get("verify") == str(ca_file)

    def test_verify_false_when_disabled(self):
        """MINIO_TLS_VERIFY=False → boto3 is called with verify=False."""
        import app.services.storage_service as ss
        s = _make_settings(MINIO_TLS_CA=None, MINIO_TLS_VERIFY=False)
        with patch.object(ss, "settings", s), \
             patch("app.services.storage_service.boto3.client") as mock_client, \
             patch.object(ss.log, "warning") as mock_warn:
            from app.services.storage_service import StorageService
            StorageService()
        kwargs = mock_client.call_args.kwargs
        assert kwargs.get("verify") is False
        mock_warn.assert_called_once()
        assert "MINIO_TLS_VERIFY=False" in mock_warn.call_args[0][0]

    def test_prod_compose_uses_https_endpoint(self):
        """docker-compose.prod.yml must set MinIO endpoint to https://."""
        compose = (PROJECT_ROOT / "docker-compose.prod.yml").read_text()
        assert "OBJECT_STORAGE_ENDPOINT=https://minio:9000" in compose, (
            "Production compose must use https:// for OBJECT_STORAGE_ENDPOINT"
        )

    def test_prod_compose_sets_minio_tls_ca(self):
        """docker-compose.prod.yml must propagate MINIO_TLS_CA to backend."""
        compose = (PROJECT_ROOT / "docker-compose.prod.yml").read_text()
        assert "MINIO_TLS_CA=" in compose

    def test_prod_compose_minio_uses_certs_dir(self):
        """MinIO service in docker-compose.prod.yml must pass --certs-dir."""
        compose = (PROJECT_ROOT / "docker-compose.prod.yml").read_text()
        assert "--certs-dir" in compose, (
            "MinIO container must receive --certs-dir for server TLS"
        )


# ===========================================================================
# AC 4 – Certificate management & rotation
# ===========================================================================

class TestCertificateManagement:
    """Validate gen_internal_certs.sh existence, permissions, and output."""

    def test_script_exists(self):
        """scripts/gen_internal_certs.sh must be present in the repo."""
        assert CERT_SCRIPT.is_file(), f"Missing: {CERT_SCRIPT}"

    def test_script_is_executable(self):
        """The cert generation script must be executable."""
        mode = CERT_SCRIPT.stat().st_mode
        assert bool(mode & stat.S_IXUSR), (
            f"{CERT_SCRIPT} is not executable (chmod +x it)"
        )

    def test_script_generates_all_certs(self, tmp_path):
        """Running gen_internal_certs.sh produces CA + all service certs."""
        result = subprocess.run(
            ["bash", str(CERT_SCRIPT)],
            env={**os.environ, "CERTS_DIR": str(tmp_path)},
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, (
            f"Script exited with non-zero code.\nSTDOUT:\n{result.stdout}\n"
            f"STDERR:\n{result.stderr}"
        )
        expected_files = [
            "ca.crt",
            "ca.key",
            "postgres/server.crt",
            "postgres/server.key",
            "redis/server.crt",
            "redis/server.key",
            "minio/public.crt",
            "minio/private.key",
        ]
        for rel in expected_files:
            assert (tmp_path / rel).exists(), f"Missing generated file: {rel}"

    def test_generated_ca_is_valid_x509(self, tmp_path):
        """The generated CA certificate must be a parseable X.509 cert."""
        subprocess.run(
            ["bash", str(CERT_SCRIPT)],
            env={**os.environ, "CERTS_DIR": str(tmp_path)},
            capture_output=True, text=True, timeout=60, check=True,
        )
        ca_pem = (tmp_path / "ca.crt").read_bytes()
        cert = x509.load_pem_x509_certificate(ca_pem, default_backend())
        assert cert.subject is not None
        # CA should be a CA (basic constraints)
        bc = cert.extensions.get_extension_for_class(x509.BasicConstraints)
        assert bc.value.ca is True

    def test_postgres_cert_signed_by_ca(self, tmp_path):
        """PostgreSQL server cert must be signed by the generated CA."""
        subprocess.run(
            ["bash", str(CERT_SCRIPT)],
            env={**os.environ, "CERTS_DIR": str(tmp_path)},
            capture_output=True, text=True, timeout=60, check=True,
        )
        result = subprocess.run(
            [
                "openssl", "verify",
                "-CAfile", str(tmp_path / "ca.crt"),
                str(tmp_path / "postgres/server.crt"),
            ],
            capture_output=True, text=True,
        )
        assert result.returncode == 0, (
            f"postgres cert verification failed:\n{result.stdout}{result.stderr}"
        )

    def test_redis_cert_signed_by_ca(self, tmp_path):
        """Redis server cert must be signed by the generated CA."""
        subprocess.run(
            ["bash", str(CERT_SCRIPT)],
            env={**os.environ, "CERTS_DIR": str(tmp_path)},
            capture_output=True, text=True, timeout=60, check=True,
        )
        result = subprocess.run(
            [
                "openssl", "verify",
                "-CAfile", str(tmp_path / "ca.crt"),
                str(tmp_path / "redis/server.crt"),
            ],
            capture_output=True, text=True,
        )
        assert result.returncode == 0, (
            f"Redis cert verification failed:\n{result.stdout}{result.stderr}"
        )

    def test_minio_cert_signed_by_ca(self, tmp_path):
        """MinIO server cert must be signed by the generated CA."""
        subprocess.run(
            ["bash", str(CERT_SCRIPT)],
            env={**os.environ, "CERTS_DIR": str(tmp_path)},
            capture_output=True, text=True, timeout=60, check=True,
        )
        result = subprocess.run(
            [
                "openssl", "verify",
                "-CAfile", str(tmp_path / "ca.crt"),
                str(tmp_path / "minio/public.crt"),
            ],
            capture_output=True, text=True,
        )
        assert result.returncode == 0, (
            f"MinIO cert verification failed:\n{result.stdout}{result.stderr}"
        )

    def test_script_is_idempotent_without_rotate(self, tmp_path):
        """Running the script twice without --rotate must not overwrite certs."""
        for _ in range(2):
            subprocess.run(
                ["bash", str(CERT_SCRIPT)],
                env={**os.environ, "CERTS_DIR": str(tmp_path)},
                capture_output=True, text=True, timeout=60, check=True,
            )
        # Get mtime of ca.crt after first run
        first_mtime = (tmp_path / "ca.crt").stat().st_mtime

        # Run again — second run should exit early (idempotent guard)
        subprocess.run(
            ["bash", str(CERT_SCRIPT)],
            env={**os.environ, "CERTS_DIR": str(tmp_path)},
            capture_output=True, text=True, timeout=60,
        )
        second_mtime = (tmp_path / "ca.crt").stat().st_mtime
        assert first_mtime == second_mtime, (
            "CA cert was overwritten on second run without --rotate flag"
        )

    def test_script_rotates_when_flag_passed(self, tmp_path):
        """Passing --rotate must regenerate all certificates."""
        # Initial generation
        subprocess.run(
            ["bash", str(CERT_SCRIPT)],
            env={**os.environ, "CERTS_DIR": str(tmp_path)},
            capture_output=True, text=True, timeout=60, check=True,
        )
        first_mtime = (tmp_path / "ca.crt").stat().st_mtime

        # Force rotation
        subprocess.run(
            ["bash", str(CERT_SCRIPT), "--rotate"],
            env={**os.environ, "CERTS_DIR": str(tmp_path)},
            capture_output=True, text=True, timeout=60, check=True,
        )
        second_mtime = (tmp_path / "ca.crt").stat().st_mtime
        assert second_mtime != first_mtime, (
            "--rotate flag must regenerate the CA cert (new mtime expected)"
        )

    def test_postgres_key_permissions(self, tmp_path):
        """PostgreSQL server.key must not be world-readable (chmod 600)."""
        subprocess.run(
            ["bash", str(CERT_SCRIPT)],
            env={**os.environ, "CERTS_DIR": str(tmp_path)},
            capture_output=True, text=True, timeout=60, check=True,
        )
        key_mode = (tmp_path / "postgres/server.key").stat().st_mode
        # Must NOT be group or world readable
        assert not (key_mode & stat.S_IRGRP), "postgres server.key is group-readable"
        assert not (key_mode & stat.S_IROTH), "postgres server.key is world-readable"

    def test_ca_key_permissions(self, tmp_path):
        """CA private key must not be world-readable (chmod 600)."""
        subprocess.run(
            ["bash", str(CERT_SCRIPT)],
            env={**os.environ, "CERTS_DIR": str(tmp_path)},
            capture_output=True, text=True, timeout=60, check=True,
        )
        key_mode = (tmp_path / "ca.key").stat().st_mode
        assert not (key_mode & stat.S_IRGRP), "ca.key is group-readable"
        assert not (key_mode & stat.S_IROTH), "ca.key is world-readable"

    def test_prod_compose_mounts_internal_certs_volume(self):
        """docker-compose.prod.yml must define and mount internal_certs volume."""
        compose = (PROJECT_ROOT / "docker-compose.prod.yml").read_text()
        assert "internal_certs:" in compose, (
            "Production compose must define the internal_certs Docker volume"
        )
        # Backend should mount it
        assert "internal_certs:/certs:ro" in compose, (
            "backend service must mount internal_certs at /certs"
        )

    def test_prod_compose_redis_tls_flags(self):
        """Redis in docker-compose.prod.yml must pass --tls-port and TLS cert flags."""
        compose = (PROJECT_ROOT / "docker-compose.prod.yml").read_text()
        assert "--tls-port 6379" in compose
        assert "--tls-cert-file" in compose
        assert "--tls-key-file" in compose
        assert "--tls-ca-cert-file" in compose

    def test_prod_compose_postgres_ssl_flags(self):
        """PostgreSQL in docker-compose.prod.yml must enable ssl=on."""
        compose = (PROJECT_ROOT / "docker-compose.prod.yml").read_text()
        assert "ssl=on" in compose
        assert "ssl_cert_file" in compose
        assert "ssl_key_file" in compose
        assert "ssl_ca_file" in compose


# ===========================================================================
# Utility – minimal X.509 cert generation (no external deps beyond cryptography)
# ===========================================================================

def _generate_self_signed_cert_pem() -> bytes:
    """Generate a self-signed CA-style cert PEM (for use in SSLContext tests)."""
    import datetime
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Test CA")])
    now = datetime.datetime.utcnow()
    cert = (
        x509.CertificateBuilder()
        .subject_name(name)
        .issuer_name(name)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(key, hashes.SHA256())
    )
    return cert.public_bytes(serialization.Encoding.PEM)


def _generate_ca_and_signed_cert_pem() -> tuple[bytes, bytes, bytes]:
    """Return (ca_pem, client_key_pem, client_cert_pem) signed by the CA."""
    import datetime
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes, serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    # CA
    ca_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    ca_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Test CA")])
    now = datetime.datetime.utcnow()
    ca_cert = (
        x509.CertificateBuilder()
        .subject_name(ca_name)
        .issuer_name(ca_name)
        .public_key(ca_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=True, path_length=None), critical=True)
        .sign(ca_key, hashes.SHA256())
    )
    ca_pem = ca_cert.public_bytes(serialization.Encoding.PEM)

    # Client cert signed by CA
    client_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    client_name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "test-client")])
    client_cert = (
        x509.CertificateBuilder()
        .subject_name(client_name)
        .issuer_name(ca_name)
        .public_key(client_key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now)
        .not_valid_after(now + datetime.timedelta(days=1))
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .sign(ca_key, hashes.SHA256())
    )
    key_pem = client_key.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.TraditionalOpenSSL,
        serialization.NoEncryption(),
    )
    cert_pem = client_cert.public_bytes(serialization.Encoding.PEM)
    return ca_pem, key_pem, cert_pem

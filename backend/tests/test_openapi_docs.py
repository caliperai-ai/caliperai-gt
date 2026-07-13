"""
Tests for OpenAPI documentation endpoint security.

Acceptance criteria:
  AC1 – /api/docs, /api/redoc, /api/openapi.json return 200 when
         ENVIRONMENT == "development".
  AC2 – /api/docs, /api/redoc, /api/openapi.json return 404 when
         ENVIRONMENT != "development" (staging, production, etc.).
  AC3 – Default ENVIRONMENT is "development" (safe default for local dev).
  AC4 – Root endpoint includes "docs" link only in development.
"""
from __future__ import annotations

import importlib
import os
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_OPENAPI_ENDPOINTS = ["/api/docs", "/api/redoc", "/api/openapi.json"]


def _build_app(environment: str):
    """
    Return a fresh FastAPI ``app`` instance with the given ENVIRONMENT value.

    We clear the ``get_settings`` LRU-cache so the module-level ``settings``
    singleton is rebuilt from the patched env var, then reload ``app.main``
    so that ``_docs_enabled`` and the FastAPI constructor args are evaluated
    against the new settings.

    The ``TestClient`` is intentionally *not* used as a context manager so
    that startup/shutdown lifespan events (DB, Redis) are never executed —
    the doc-URL behaviour is determined purely at ``FastAPI()`` construction
    time and is therefore safe to inspect without a running infrastructure.
    """
    from app.core.config import get_settings

    get_settings.cache_clear()
    with patch.dict(os.environ, {"ENVIRONMENT": environment}, clear=False):
        import app.main as main_module

        importlib.reload(main_module)
        return main_module.app


# ---------------------------------------------------------------------------
# AC1 – docs are reachable in development
# ---------------------------------------------------------------------------


class TestOpenAPIDocsInDevelopment:
    """All three doc endpoints must return HTTP 200 in development mode."""

    @pytest.fixture(autouse=True)
    def _app(self):
        self.client = TestClient(_build_app("development"), raise_server_exceptions=False)

    @pytest.mark.parametrize("path", _OPENAPI_ENDPOINTS)
    def test_endpoint_returns_200(self, path: str):
        response = self.client.get(path)
        assert response.status_code == 200, (
            f"Expected 200 for {path!r} in development, got {response.status_code}"
        )


# ---------------------------------------------------------------------------
# AC2 – docs are hidden in non-development environments
# ---------------------------------------------------------------------------


class TestOpenAPIDocsInProduction:
    """All three doc endpoints must return HTTP 404 in production mode."""

    @pytest.fixture(autouse=True)
    def _app(self):
        self.client = TestClient(_build_app("production"), raise_server_exceptions=False)

    @pytest.mark.parametrize("path", _OPENAPI_ENDPOINTS)
    def test_endpoint_returns_404(self, path: str):
        response = self.client.get(path)
        assert response.status_code == 404, (
            f"Expected 404 for {path!r} in production, got {response.status_code}"
        )


class TestOpenAPIDocsInStaging:
    """Staging is also non-development – docs must be hidden."""

    @pytest.fixture(autouse=True)
    def _app(self):
        self.client = TestClient(_build_app("staging"), raise_server_exceptions=False)

    @pytest.mark.parametrize("path", _OPENAPI_ENDPOINTS)
    def test_endpoint_returns_404(self, path: str):
        response = self.client.get(path)
        assert response.status_code == 404, (
            f"Expected 404 for {path!r} in staging, got {response.status_code}"
        )


# ---------------------------------------------------------------------------
# AC3 – Default ENVIRONMENT is "development"
# ---------------------------------------------------------------------------


class TestDefaultEnvironment:
    """The default value for ENVIRONMENT must be 'development'."""

    def test_default_environment_is_development(self, monkeypatch):
        """Without ENVIRONMENT set the settings default is 'development'."""
        monkeypatch.delenv("ENVIRONMENT", raising=False)

        from app.core.config import Settings

        s = Settings()
        assert s.ENVIRONMENT == "development", (
            f"Default ENVIRONMENT should be 'development', got {s.ENVIRONMENT!r}"
        )


# ---------------------------------------------------------------------------
# AC4 – Root endpoint hides the docs link in non-development
# ---------------------------------------------------------------------------


class TestRootEndpointDocLink:
    def test_root_includes_docs_link_in_development(self):
        client = TestClient(_build_app("development"), raise_server_exceptions=False)
        body = client.get("/").json()
        assert "docs" in body, "Root endpoint should advertise /api/docs in development"
        assert body["docs"] == "/api/docs"

    def test_root_excludes_docs_link_in_production(self):
        client = TestClient(_build_app("production"), raise_server_exceptions=False)
        body = client.get("/").json()
        assert "docs" not in body, (
            "Root endpoint must NOT advertise /api/docs in production"
        )

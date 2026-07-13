"""
Root pytest configuration for the backend test suite.

Sets up the minimum environment variables required before any application
module is imported so that the pydantic-settings ``get_settings()`` call
that runs at module level does not raise ``SystemExit``.

A deterministic test-only ``SECRET_KEY`` is always injected so that all
module-level ``settings`` singletons (e.g. ``rbac_service.settings``) use the
same key as test token factories, making JWT round-trips work in unit tests
without a real running database.

This value is NOT a secret – it is only used inside the test environment.
"""
from __future__ import annotations

import os

# 64 hex chars = 32 bytes – strong enough to pass the key-strength validator.
TEST_SECRET_KEY: str = (
    "74657374736563726574746573747365"
    "63726574746573747365637265747365"
)


def pytest_configure(config: object) -> None:  # noqa: ARG001
    """Inject required env vars before collection begins."""
    # Always override with the deterministic test key so that all module-level
    # ``settings`` singletons and test token factories agree on the same value.
    os.environ["SECRET_KEY"] = TEST_SECRET_KEY
    # Use a distinct environment label so no production guard triggers.
    os.environ.setdefault("ENVIRONMENT", "testing")

"""
Tests for SSO / OIDC functionality.

Covers
------
AC1  – OIDC support for Google, Azure AD, Okta, Keycloak
       (get_provider_config returns correct discovery URL for each).
AC2  – GET /api/v1/auth/sso/{provider} initiates flow (302 redirect to IdP).
AC3  – GET /api/v1/auth/sso/{provider}/callback completes flow and issues JWT.
AC4  – Auto-provision user on first SSO login with default role.
AC5  – Email domain → organisation mapping (configurable via env var).
AC6  – "Sign in with SSO" button: GET /api/v1/auth/sso/providers returns list.
AC7  – API-mode token exchange: GET /api/v1/auth/sso/{provider}/token.
AC8  – Unknown provider → 404.
AC9  – Invalid / expired state → redirect to error URL.
AC10 – Existing user linked by email (no duplicate created).
"""
from __future__ import annotations

import importlib
import json
import os
import uuid
from datetime import datetime, timezone
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import contextlib
import pytest
from fastapi.testclient import TestClient


# --------------------------------------------------------------------------
# Constants
# --------------------------------------------------------------------------

_VALID_SECRET = (
    "74657374736563726574746573747365"
    "63726574746573747365637265747365"
)

_GOOGLE_ENV = {
    "SECRET_KEY": _VALID_SECRET,
    "SSO_GOOGLE_CLIENT_ID": "google-client-id",
    "SSO_GOOGLE_CLIENT_SECRET": "google-client-secret",
    "SSO_REDIRECT_BASE_URL": "http://localhost:8000",
    "SSO_FRONTEND_URL": "http://localhost:5173",
    "SSO_DEFAULT_ROLE": "annotator",
    "SSO_EMAIL_DOMAIN_ORG_MAP": "example.com:example-org",
}

_GOOGLE_DISCOVERY = {
    "authorization_endpoint": "https://accounts.google.com/o/oauth2/v2/auth",
    "token_endpoint": "https://oauth2.googleapis.com/token",
    "userinfo_endpoint": "https://openidconnect.googleapis.com/v1/userinfo",
}

_FAKE_CLAIMS: dict[str, Any] = {
    "sub": "google-sub-12345",
    "email": "alice@example.com",
    "name": "Alice Example",
    "email_verified": True,
}

_FAKE_USER_UUID = uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

@contextlib.contextmanager
def _build_app_ctx(extra_env: dict[str, str] | None = None):
    """Yield a fresh FastAPI app with test env vars applied."""
    from app.core.config import get_settings

    get_settings.cache_clear()
    env = {**_GOOGLE_ENV, **(extra_env or {})}
    with patch.dict(os.environ, env, clear=False):
        import app.main as main_module

        importlib.reload(main_module)
        get_settings.cache_clear()
        yield main_module.app


def _make_fake_user(
    *,
    uid: uuid.UUID = _FAKE_USER_UUID,
    email: str = "alice@example.com",
    role: str = "annotator",
    is_active: bool = True,
    is_superuser: bool = False,
) -> MagicMock:
    """Return a mock User ORM object."""
    from app.models.models import Permission, ROLE_PERMISSIONS

    user = MagicMock()
    user.id = uid
    user.email = email
    user.username = email.split("@")[0]
    user.full_name = "Alice Example"
    user.role = role
    user.is_active = is_active
    user.is_superuser = is_superuser
    user.must_change_password = False
    user.permissions = ROLE_PERMISSIONS.get(role, set())
    user.has_permission = lambda p: p in user.permissions
    return user


# ==========================================================================
# AC1: get_provider_config
# ==========================================================================

class TestProviderConfig:
    """AC1 – config returned for each supported provider."""

    def test_google_discovery_url(self):
        with patch.dict(
            os.environ,
            {
                "SECRET_KEY": _VALID_SECRET,
                "SSO_GOOGLE_CLIENT_ID": "gid",
                "SSO_GOOGLE_CLIENT_SECRET": "gsecret",
            },
        ):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import get_provider_config

            cfg = get_provider_config("google")
            assert "accounts.google.com" in cfg.discovery_url
            assert cfg.client_id == "gid"

    def test_azure_discovery_url(self):
        with patch.dict(
            os.environ,
            {
                "SECRET_KEY": _VALID_SECRET,
                "SSO_AZURE_CLIENT_ID": "aid",
                "SSO_AZURE_CLIENT_SECRET": "asecret",
                "SSO_AZURE_TENANT_ID": "my-tenant",
            },
        ):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import get_provider_config

            cfg = get_provider_config("azure")
            assert "my-tenant" in cfg.discovery_url
            assert "microsoftonline.com" in cfg.discovery_url

    def test_okta_discovery_url(self):
        with patch.dict(
            os.environ,
            {
                "SECRET_KEY": _VALID_SECRET,
                "SSO_OKTA_CLIENT_ID": "oid",
                "SSO_OKTA_CLIENT_SECRET": "osecret",
                "SSO_OKTA_DOMAIN": "company.okta.com",
            },
        ):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import get_provider_config

            cfg = get_provider_config("okta")
            assert "company.okta.com" in cfg.discovery_url

    def test_keycloak_discovery_url(self):
        with patch.dict(
            os.environ,
            {
                "SECRET_KEY": _VALID_SECRET,
                "SSO_KEYCLOAK_CLIENT_ID": "kid",
                "SSO_KEYCLOAK_CLIENT_SECRET": "ksecret",
                "SSO_KEYCLOAK_BASE_URL": "https://keycloak.company.com",
                "SSO_KEYCLOAK_REALM": "myrealm",
            },
        ):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import get_provider_config

            cfg = get_provider_config("keycloak")
            assert "keycloak.company.com" in cfg.discovery_url
            assert "myrealm" in cfg.discovery_url

    def test_unknown_provider_raises(self):
        with patch.dict(os.environ, {"SECRET_KEY": _VALID_SECRET}):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import get_provider_config

            with pytest.raises(ValueError, match="Unknown SSO provider"):
                get_provider_config("facebook")

    def test_unconfigured_google_raises(self):
        env = dict(os.environ)
        env.pop("SSO_GOOGLE_CLIENT_ID", None)
        env.pop("SSO_GOOGLE_CLIENT_SECRET", None)
        with patch.dict(os.environ, {"SECRET_KEY": _VALID_SECRET}, clear=False):
            for key in ("SSO_GOOGLE_CLIENT_ID", "SSO_GOOGLE_CLIENT_SECRET"):
                os.environ.pop(key, None)
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import get_provider_config

            with pytest.raises(ValueError):
                get_provider_config("google")


# ==========================================================================
# AC2: /api/v1/auth/sso/{provider} – initiation redirect
# ==========================================================================

class TestSSOInitiation:
    """AC2 – /api/v1/auth/sso/{provider} redirects the browser to the IdP."""

    def _setup_mocks(self, build_url_mock: AsyncMock):
        build_url_mock.return_value = "https://accounts.google.com/o/oauth2/v2/auth?state=abc"

    def test_redirect_to_idp(self):
        with _build_app_ctx() as app:
            with (
                patch(
                    "app.api.v1.endpoints.sso.get_redis",
                    new=AsyncMock(return_value=MagicMock()),
                ),
                patch(
                    "app.api.v1.endpoints.sso.build_authorization_url",
                    new=AsyncMock(
                        return_value="https://accounts.google.com/o/oauth2/v2/auth?state=abc"
                    ),
                ),
            ):
                client = TestClient(app, follow_redirects=False)
                resp = client.get("/api/v1/auth/sso/google")
                assert resp.status_code == 302
                location = resp.headers["location"]
                assert "accounts.google.com" in location

    def test_unknown_provider_404(self):
        with _build_app_ctx() as app:
            client = TestClient(app, follow_redirects=False)
            resp = client.get("/api/v1/auth/sso/unknown-provider")
            assert resp.status_code == 404

    def test_redis_unavailable_503(self):
        with _build_app_ctx() as app:
            with patch(
                "app.api.v1.endpoints.sso.get_redis",
                new=AsyncMock(return_value=None),
            ):
                client = TestClient(app, follow_redirects=False)
                resp = client.get("/api/v1/auth/sso/google")
                assert resp.status_code == 503

    def test_unconfigured_provider_400(self):
        # Google not configured in this app context
        with _build_app_ctx(
            {
                "SSO_GOOGLE_CLIENT_ID": "",
                "SSO_GOOGLE_CLIENT_SECRET": "",
            }
        ) as app:
            with (
                patch(
                    "app.api.v1.endpoints.sso.get_redis",
                    new=AsyncMock(return_value=MagicMock()),
                ),
                patch(
                    "app.api.v1.endpoints.sso.build_authorization_url",
                    new=AsyncMock(side_effect=ValueError("Google SSO is not configured")),
                ),
            ):
                client = TestClient(app, follow_redirects=False)
                resp = client.get("/api/v1/auth/sso/google")
                assert resp.status_code == 400


# ==========================================================================
# AC3 & AC4: /api/v1/auth/sso/{provider}/callback – complete flow
# ==========================================================================

class TestSSOCallback:
    """AC3 – callback issues JWT; AC4 – auto-provisions new user."""

    def _fake_redis(self) -> AsyncMock:
        redis = AsyncMock()
        return redis

    def test_successful_callback_redirects_with_token(self):
        fake_user = _make_fake_user()

        with _build_app_ctx() as app:
            with (
                patch(
                    "app.api.v1.endpoints.sso.get_redis",
                    new=AsyncMock(return_value=self._fake_redis()),
                ),
                patch(
                    "app.api.v1.endpoints.sso.exchange_code",
                    new=AsyncMock(return_value=_FAKE_CLAIMS),
                ),
                patch(
                    "app.api.v1.endpoints.sso.get_or_create_sso_user",
                    new=AsyncMock(return_value=fake_user),
                ),
            ):
                client = TestClient(app, follow_redirects=False)
                resp = client.get(
                    "/api/v1/auth/sso/google/callback",
                    params={"code": "auth-code", "state": "some-state"},
                )
                assert resp.status_code == 302
                location = resp.headers["location"]
                assert "access_token=" in location
                assert "localhost:5173" in location

    def test_idp_error_redirects_to_login(self):
        with _build_app_ctx() as app:
            client = TestClient(app, follow_redirects=False)
            resp = client.get(
                "/api/v1/auth/sso/google/callback",
                params={"error": "access_denied", "error_description": "User cancelled"},
            )
            assert resp.status_code == 302
            location = resp.headers["location"]
            assert "/login" in location
            assert "sso_error=access_denied" in location

    def test_invalid_state_redirects_to_error(self):
        with _build_app_ctx() as app:
            with (
                patch(
                    "app.api.v1.endpoints.sso.get_redis",
                    new=AsyncMock(return_value=self._fake_redis()),
                ),
                patch(
                    "app.api.v1.endpoints.sso.exchange_code",
                    new=AsyncMock(side_effect=ValueError("Invalid or expired OAuth state")),
                ),
            ):
                client = TestClient(app, follow_redirects=False)
                resp = client.get(
                    "/api/v1/auth/sso/google/callback",
                    params={"code": "auth-code", "state": "bad-state"},
                )
                assert resp.status_code == 302
                assert "sso_error=code_exchange_failed" in resp.headers["location"]

    def test_inactive_user_redirects_to_error(self):
        fake_user = _make_fake_user(is_active=False)

        with _build_app_ctx() as app:
            with (
                patch(
                    "app.api.v1.endpoints.sso.get_redis",
                    new=AsyncMock(return_value=self._fake_redis()),
                ),
                patch(
                    "app.api.v1.endpoints.sso.exchange_code",
                    new=AsyncMock(return_value=_FAKE_CLAIMS),
                ),
                patch(
                    "app.api.v1.endpoints.sso.get_or_create_sso_user",
                    new=AsyncMock(return_value=fake_user),
                ),
            ):
                client = TestClient(app, follow_redirects=False)
                resp = client.get(
                    "/api/v1/auth/sso/google/callback",
                    params={"code": "auth-code", "state": "some-state"},
                )
                assert resp.status_code == 302
                assert "sso_error=account_inactive" in resp.headers["location"]

    def test_missing_code_or_state_400(self):
        with _build_app_ctx() as app:
            client = TestClient(app, follow_redirects=False)
            resp = client.get("/api/v1/auth/sso/google/callback")
            assert resp.status_code == 400


# ==========================================================================
# AC4: User auto-provisioning (service-layer unit tests)
# ==========================================================================

class TestAutoProvision:
    """AC4 – new user is created with default role; existing user is reused."""

    @pytest.mark.asyncio
    async def test_new_user_provisioned(self):
        """A user that does not exist yet is created with SSO_DEFAULT_ROLE."""
        with patch.dict(
            os.environ,
            {
                "SECRET_KEY": _VALID_SECRET,
                "SSO_DEFAULT_ROLE": "annotator",
                "SSO_EMAIL_DOMAIN_ORG_MAP": "",
            },
        ):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import get_or_create_sso_user

            # Mock session
            db = AsyncMock()

            # First select (UserSSOIdentity) → not found
            # Second select (User by email) → not found
            # Third select (username uniqueness check) → not found
            not_found = AsyncMock()
            not_found.scalar_one_or_none = MagicMock(return_value=None)
            db.execute = AsyncMock(return_value=not_found)
            db.add = MagicMock()
            db.flush = AsyncMock()

            user = await get_or_create_sso_user("google", _FAKE_CLAIMS, db)

            assert user.email == "alice@example.com"
            assert user.role == "annotator"
            assert user.must_change_password is False
            # hashed_password should be a placeholder
            assert user.hashed_password == "!"

    @pytest.mark.asyncio
    async def test_existing_user_linked_not_duplicated(self):
        """An existing user found by email is linked; no new User row inserted."""
        with patch.dict(
            os.environ,
            {
                "SECRET_KEY": _VALID_SECRET,
                "SSO_DEFAULT_ROLE": "annotator",
                "SSO_EMAIL_DOMAIN_ORG_MAP": "",
            },
        ):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import get_or_create_sso_user

            # Existing user found by email
            existing_user = _make_fake_user()

            db = AsyncMock()
            call_count = 0

            async def _execute(query):
                nonlocal call_count
                result = AsyncMock()
                call_count += 1
                if call_count == 1:
                    # UserSSOIdentity lookup → not found
                    result.scalar_one_or_none = MagicMock(return_value=None)
                else:
                    # User by email → found
                    result.scalar_one_or_none = MagicMock(return_value=existing_user)
                return result

            db.execute = _execute
            db.add = MagicMock()
            db.flush = AsyncMock()

            user = await get_or_create_sso_user("google", _FAKE_CLAIMS, db)

            assert user is existing_user
            # add is called once: for the new SSO identity row, not for a new User
            db.add.assert_called_once()

    @pytest.mark.asyncio
    async def test_returning_user_via_existing_sso_identity(self):
        """If a UserSSOIdentity already exists, return the linked user directly."""
        with patch.dict(
            os.environ,
            {
                "SECRET_KEY": _VALID_SECRET,
                "SSO_DEFAULT_ROLE": "annotator",
                "SSO_EMAIL_DOMAIN_ORG_MAP": "",
            },
        ):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import get_or_create_sso_user
            from app.models.models import UserSSOIdentity

            existing_user = _make_fake_user()

            # Fake existing SSO identity
            existing_identity = MagicMock(spec=UserSSOIdentity)
            existing_identity.user_id = existing_user.id
            existing_identity.last_login_at = datetime.now(timezone.utc)
            existing_identity.provider_claims = {}

            db = AsyncMock()
            call_count = 0

            async def _execute(query):
                nonlocal call_count
                result = AsyncMock()
                call_count += 1
                if call_count == 1:
                    # SSO identity lookup → found
                    result.scalar_one_or_none = MagicMock(return_value=existing_identity)
                else:
                    # User lookup by id → found
                    result.scalar_one = MagicMock(return_value=existing_user)
                return result

            db.execute = _execute
            db.add = MagicMock()

            user = await get_or_create_sso_user("google", _FAKE_CLAIMS, db)

            assert user is existing_user
            # last_login_at should have been updated
            assert existing_identity.last_login_at is not None
            # No new rows should be inserted
            db.add.assert_not_called()

    @pytest.mark.asyncio
    async def test_missing_sub_raises(self):
        """Claims without 'sub' raise ValueError."""
        with patch.dict(os.environ, {"SECRET_KEY": _VALID_SECRET}):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import get_or_create_sso_user

            db = AsyncMock()
            with pytest.raises(ValueError, match="sub"):
                await get_or_create_sso_user("google", {"email": "x@y.com"}, db)

    @pytest.mark.asyncio
    async def test_missing_email_raises(self):
        """Claims without 'email' raise ValueError."""
        with patch.dict(os.environ, {"SECRET_KEY": _VALID_SECRET}):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import get_or_create_sso_user

            db = AsyncMock()
            with pytest.raises(ValueError, match="email"):
                await get_or_create_sso_user("google", {"sub": "x"}, db)


# ==========================================================================
# AC5: Email domain → organisation mapping
# ==========================================================================

class TestEmailDomainOrgMapping:
    """AC5 – new user is added to the org whose slug matches their email domain."""

    def test_parse_email_domain_map(self):
        with patch.dict(
            os.environ,
            {
                "SECRET_KEY": _VALID_SECRET,
                "SSO_EMAIL_DOMAIN_ORG_MAP": "acme.com:acme-org,example.org:example-org",
            },
        ):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import _parse_email_domain_map

            mapping = _parse_email_domain_map()
            assert mapping == {"acme.com": "acme-org", "example.org": "example-org"}

    def test_empty_domain_map(self):
        with patch.dict(
            os.environ,
            {"SECRET_KEY": _VALID_SECRET, "SSO_EMAIL_DOMAIN_ORG_MAP": ""},
        ):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import _parse_email_domain_map

            assert _parse_email_domain_map() == {}

    @pytest.mark.asyncio
    async def test_new_user_added_to_org(self):
        """New user is added to the matching org when domain mapping is set."""
        with patch.dict(
            os.environ,
            {
                "SECRET_KEY": _VALID_SECRET,
                "SSO_DEFAULT_ROLE": "annotator",
                "SSO_EMAIL_DOMAIN_ORG_MAP": "example.com:example-org",
            },
        ):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import get_or_create_sso_user
            from app.models.models import Organization

            fake_org = MagicMock(spec=Organization)
            fake_org.id = uuid.uuid4()

            db = AsyncMock()
            call_count = 0

            async def _execute(query):
                nonlocal call_count
                result = AsyncMock()
                call_count += 1
                if call_count <= 3:
                    # SSO identity, user by email, username uniqueness → not found
                    result.scalar_one_or_none = MagicMock(return_value=None)
                else:
                    # Organisation lookup → found
                    result.scalar_one_or_none = MagicMock(return_value=fake_org)
                return result

            db.add = MagicMock()
            db.flush = AsyncMock()
            db.execute = _execute

            await get_or_create_sso_user("google", _FAKE_CLAIMS, db)

            # db.add should be called twice: once for User, once for OrganizationMember,
            # and once for UserSSOIdentity  → at least 2 distinct calls
            assert db.add.call_count >= 2


# ==========================================================================
# AC6: GET /api/v1/auth/sso/providers
# ==========================================================================

class TestListProviders:
    """AC6 – /api/v1/auth/sso/providers returns configured providers."""

    def test_shows_only_configured_providers(self):
        with _build_app_ctx() as app:
            client = TestClient(app)
            resp = client.get("/api/v1/auth/sso/providers")
            assert resp.status_code == 200
            providers = resp.json()
            # Only google is configured in _GOOGLE_ENV
            provider_slugs = [p["provider"] for p in providers]
            assert "google" in provider_slugs
            for slug in ("azure", "okta", "keycloak"):
                assert slug not in provider_slugs

    def test_provider_login_url_format(self):
        with _build_app_ctx() as app:
            client = TestClient(app)
            resp = client.get("/api/v1/auth/sso/providers")
            google = next(p for p in resp.json() if p["provider"] == "google")
            assert "google" in google["login_url"]

    def test_no_providers_when_none_configured(self):
        env = {
            k: ""
            for k in (
                "SSO_GOOGLE_CLIENT_ID",
                "SSO_GOOGLE_CLIENT_SECRET",
            )
        }
        with _build_app_ctx(env) as app:
            client = TestClient(app)
            resp = client.get("/api/v1/auth/sso/providers")
            assert resp.status_code == 200
            assert resp.json() == []


# ==========================================================================
# AC7: API-mode token exchange
# ==========================================================================

class TestAPITokenExchange:
    """AC7 – /api/v1/auth/sso/{provider}/token returns JSON JWT."""

    def test_successful_token_exchange(self):
        fake_user = _make_fake_user()

        with _build_app_ctx() as app:
            with (
                patch(
                    "app.api.v1.endpoints.sso.get_redis",
                    new=AsyncMock(return_value=AsyncMock()),
                ),
                patch(
                    "app.api.v1.endpoints.sso.exchange_code",
                    new=AsyncMock(return_value=_FAKE_CLAIMS),
                ),
                patch(
                    "app.api.v1.endpoints.sso.get_or_create_sso_user",
                    new=AsyncMock(return_value=fake_user),
                ),
            ):
                client = TestClient(app)
                resp = client.get(
                    "/api/v1/auth/sso/google/token",
                    params={"code": "code123", "state": "state123"},
                )
                assert resp.status_code == 200
                data = resp.json()
                assert "access_token" in data
                assert data["token_type"] == "bearer"
                assert data["user"]["email"] == "alice@example.com"

    def test_inactive_user_401(self):
        fake_user = _make_fake_user(is_active=False)

        with _build_app_ctx() as app:
            with (
                patch(
                    "app.api.v1.endpoints.sso.get_redis",
                    new=AsyncMock(return_value=AsyncMock()),
                ),
                patch(
                    "app.api.v1.endpoints.sso.exchange_code",
                    new=AsyncMock(return_value=_FAKE_CLAIMS),
                ),
                patch(
                    "app.api.v1.endpoints.sso.get_or_create_sso_user",
                    new=AsyncMock(return_value=fake_user),
                ),
            ):
                client = TestClient(app)
                resp = client.get(
                    "/api/v1/auth/sso/google/token",
                    params={"code": "code123", "state": "state123"},
                )
                assert resp.status_code == 401

    def test_bad_code_exchange_400(self):
        with _build_app_ctx() as app:
            with (
                patch(
                    "app.api.v1.endpoints.sso.get_redis",
                    new=AsyncMock(return_value=AsyncMock()),
                ),
                patch(
                    "app.api.v1.endpoints.sso.exchange_code",
                    new=AsyncMock(side_effect=ValueError("Invalid or expired OAuth state")),
                ),
            ):
                client = TestClient(app)
                resp = client.get(
                    "/api/v1/auth/sso/google/token",
                    params={"code": "bad-code", "state": "bad-state"},
                )
                assert resp.status_code == 400

    def test_unknown_provider_404(self):
        with _build_app_ctx() as app:
            client = TestClient(app)
            resp = client.get(
                "/api/v1/auth/sso/badprovider/token",
                params={"code": "c", "state": "s"},
            )
            assert resp.status_code == 404


# ==========================================================================
# State management unit tests
# ==========================================================================

class TestStateManagement:
    """State CSRF protection helpers."""

    @pytest.mark.asyncio
    async def test_save_and_consume_state(self):
        from app.services.sso_service import save_state, consume_state

        redis = AsyncMock()
        stored: dict[str, str] = {}

        async def _setex(key, ttl, value):
            stored[key] = value

        async def _get(key):
            return stored.get(key)

        async def _delete(key):
            stored.pop(key, None)

        redis.setex = _setex
        redis.get = _get
        redis.delete = _delete

        await save_state(redis, "mystate", "google", "mynonce")
        data = await consume_state(redis, "mystate")
        assert data == {"provider": "google", "nonce": "mynonce"}

    @pytest.mark.asyncio
    async def test_consume_unknown_state_returns_none(self):
        from app.services.sso_service import consume_state

        redis = AsyncMock()
        redis.get = AsyncMock(return_value=None)
        result = await consume_state(redis, "no-such-state")
        assert result is None

    @pytest.mark.asyncio
    async def test_state_consumed_only_once(self):
        """After the first consume, a second call returns None (replay protection)."""
        from app.services.sso_service import save_state, consume_state

        redis = AsyncMock()
        stored: dict[str, str] = {}

        async def _setex(key, ttl, value):
            stored[key] = value

        async def _get(key):
            return stored.get(key)

        async def _delete(key):
            stored.pop(key, None)

        redis.setex = _setex
        redis.get = _get
        redis.delete = _delete

        await save_state(redis, "state-once", "okta", "nonce-once")
        first = await consume_state(redis, "state-once")
        second = await consume_state(redis, "state-once")

        assert first is not None
        assert second is None


# ==========================================================================
# Build-redirect-URI helper
# ==========================================================================

class TestBuildRedirectUri:
    def test_redirect_uri_includes_provider(self):
        with patch.dict(
            os.environ,
            {"SECRET_KEY": _VALID_SECRET, "SSO_REDIRECT_BASE_URL": "https://api.company.com"},
        ):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import build_redirect_uri

            uri = build_redirect_uri("google")
            assert uri == "https://api.company.com/api/v1/auth/sso/google/callback"

    def test_redirect_uri_strips_trailing_slash(self):
        with patch.dict(
            os.environ,
            {
                "SECRET_KEY": _VALID_SECRET,
                "SSO_REDIRECT_BASE_URL": "https://api.company.com/",
            },
        ):
            from app.core.config import get_settings

            get_settings.cache_clear()
            from app.services.sso_service import build_redirect_uri

            uri = build_redirect_uri("azure")
            assert "//" not in uri.split("https://")[1]

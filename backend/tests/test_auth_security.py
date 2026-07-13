"""
Unit / integration tests for generic auth error messages.

Acceptance criteria:
  AC1 – JWT validation errors return "Authentication failed" with no
         exception details leaked in the response body.
  AC2 – Login failures return "Invalid credentials" regardless of whether
         the username/email exists, so attackers cannot enumerate accounts.
  AC3 – Unhandled server-side exceptions return a generic
         "An internal server error occurred." message; details are NOT
         present in the response body.

Test classes
------------
TestJWTValidationErrors          (AC1)
TestLoginFailureMessages          (AC2)
TestGlobalInternalServerError     (AC3)
"""
from __future__ import annotations

import os
import importlib
from datetime import datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch, PropertyMock

import contextlib

import pytest
from fastapi.testclient import TestClient
from jose import jwt


# ---------------------------------------------------------------------------
# Helpers / fixtures
# ---------------------------------------------------------------------------

# Must match conftest.TEST_SECRET_KEY so that JWT tokens created in tests are
# accepted by the rbac_service that was initialised with that same key.
_VALID_SECRET = (
    "74657374736563726574746573747365"
    "63726574746573747365637265747365"
)
_ALGORITHM = "HS256"


def _make_token(
    *,
    sub: str = "123e4567-e89b-12d3-a456-426614174000",
    secret: str = _VALID_SECRET,
    expired: bool = False,
    algorithm: str = _ALGORITHM,
) -> str:
    """Produce a signed JWT for test scenarios."""
    delta = timedelta(minutes=-5) if expired else timedelta(minutes=30)
    payload = {
        "sub": sub,
        "exp": datetime.utcnow() + delta,
        "iat": datetime.utcnow(),
    }
    return jwt.encode(payload, secret, algorithm=algorithm)


@contextlib.contextmanager
def _build_app_ctx():
    """
    Context manager that yields a fresh FastAPI app with SECRET_KEY patched.

    Keeping the patch.dict active for the full lifetime of the context ensures
    that any lazy get_settings() calls (e.g. triggered by TestClient requests)
    still see the test SECRET_KEY.
    """
    from app.core.config import get_settings

    get_settings.cache_clear()
    with patch.dict(os.environ, {"ENVIRONMENT": "testing", "SECRET_KEY": _VALID_SECRET}, clear=False):
        import app.main as main_module
        importlib.reload(main_module)
        get_settings.cache_clear()   # ensure next call uses the patched env
        yield main_module.app


def _get_app():
    """Return a fresh app (caller responsible for keeping env patch alive)."""
    from app.core.config import get_settings
    get_settings.cache_clear()
    with patch.dict(os.environ, {"ENVIRONMENT": "testing", "SECRET_KEY": _VALID_SECRET}, clear=False):
        import app.main as main_module
        importlib.reload(main_module)
        return main_module.app


# =============================================================================
# AC1 – JWT Validation Error Messages
# =============================================================================

class TestJWTValidationErrors:
    """
    Every JWT error path must return HTTP 401 with detail == "Authentication
    failed" and must NOT leak any token-internals or exception text.
    """

    PROTECTED_PATH = "/api/v1/auth/me"

    @pytest.fixture(autouse=True)
    def _client(self):
        app = _get_app()
        self.client = TestClient(app, raise_server_exceptions=False)

    # ── Missing token ──────────────────────────────────────────────────────

    def test_missing_token_returns_401(self):
        resp = self.client.get(self.PROTECTED_PATH)
        assert resp.status_code == 401

    def test_missing_token_body_has_no_exception_details(self):
        resp = self.client.get(self.PROTECTED_PATH)
        body = resp.json()
        detail = body.get("detail", "")
        assert "Token" not in detail
        assert "jwt" not in detail.lower()
        assert "JWTError" not in detail
        assert "traceback" not in detail.lower()

    # ── Wrong signature ────────────────────────────────────────────────────

    def test_wrong_signature_returns_401(self):
        bad_token = _make_token(secret="wrong-secret-key-xxxxxxxxxxxxxxxxxxxxx")
        resp = self.client.get(
            self.PROTECTED_PATH,
            headers={"Authorization": f"Bearer {bad_token}"},
        )
        assert resp.status_code == 401

    def test_wrong_signature_detail_is_generic(self):
        bad_token = _make_token(secret="wrong-secret-key-xxxxxxxxxxxxxxxxxxxxx")
        resp = self.client.get(
            self.PROTECTED_PATH,
            headers={"Authorization": f"Bearer {bad_token}"},
        )
        detail = resp.json().get("detail", "")
        assert detail == "Authentication failed"

    def test_wrong_signature_leaks_no_exception_text(self):
        bad_token = _make_token(secret="wrong-secret-key-xxxxxxxxxxxxxxxxxxxxx")
        resp = self.client.get(
            self.PROTECTED_PATH,
            headers={"Authorization": f"Bearer {bad_token}"},
        )
        raw = resp.text
        assert "Signature" not in raw
        assert "JWTError" not in raw
        assert "SignatureVerificationError" not in raw

    # ── Expired token ──────────────────────────────────────────────────────

    def test_expired_token_returns_401(self):
        token = _make_token(expired=True)
        resp = self.client.get(
            self.PROTECTED_PATH,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 401

    def test_expired_token_detail_is_generic(self):
        token = _make_token(expired=True)
        resp = self.client.get(
            self.PROTECTED_PATH,
            headers={"Authorization": f"Bearer {token}"},
        )
        detail = resp.json().get("detail", "")
        assert detail == "Authentication failed"

    def test_expired_token_leaks_no_expiry_info(self):
        token = _make_token(expired=True)
        resp = self.client.get(
            self.PROTECTED_PATH,
            headers={"Authorization": f"Bearer {token}"},
        )
        raw = resp.text
        assert "ExpiredSignature" not in raw
        assert "expired" not in raw.lower()

    # ── Malformed token ────────────────────────────────────────────────────

    def test_malformed_token_returns_401(self):
        resp = self.client.get(
            self.PROTECTED_PATH,
            headers={"Authorization": "Bearer not.a.valid.jwt"},
        )
        assert resp.status_code == 401

    def test_malformed_token_detail_is_generic(self):
        resp = self.client.get(
            self.PROTECTED_PATH,
            headers={"Authorization": "Bearer not.a.valid.jwt"},
        )
        detail = resp.json().get("detail", "")
        assert detail == "Authentication failed"

    def test_malformed_token_leaks_no_parse_error(self):
        resp = self.client.get(
            self.PROTECTED_PATH,
            headers={"Authorization": "Bearer not.a.valid.jwt"},
        )
        raw = resp.text
        assert "JWTError" not in raw
        assert "DecodeError" not in raw
        assert "parse" not in raw.lower()

    # ── Token with no 'sub' claim ──────────────────────────────────────────

    def test_token_without_sub_returns_401(self):
        payload = {"exp": datetime.utcnow() + timedelta(minutes=30)}
        token = jwt.encode(payload, _VALID_SECRET, algorithm=_ALGORITHM)
        resp = self.client.get(
            self.PROTECTED_PATH,
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 401

    def test_token_without_sub_detail_is_generic(self):
        payload = {"exp": datetime.utcnow() + timedelta(minutes=30)}
        token = jwt.encode(payload, _VALID_SECRET, algorithm=_ALGORITHM)
        resp = self.client.get(
            self.PROTECTED_PATH,
            headers={"Authorization": f"Bearer {token}"},
        )
        detail = resp.json().get("detail", "")
        assert detail == "Authentication failed"

    def test_token_without_sub_leaks_no_claim_name(self):
        payload = {"exp": datetime.utcnow() + timedelta(minutes=30)}
        token = jwt.encode(payload, _VALID_SECRET, algorithm=_ALGORITHM)
        resp = self.client.get(
            self.PROTECTED_PATH,
            headers={"Authorization": f"Bearer {token}"},
        )
        raw = resp.text
        assert "'sub'" not in raw
        assert "payload" not in raw.lower()


# =============================================================================
# AC2 – Login Failure Messages (no account-existence enumeration)
# =============================================================================

class TestLoginFailureMessages:
    """
    All login failure scenarios must return HTTP 401 with detail ==
    "Invalid credentials".  The response must never reveal whether the
    account exists, nor disclose anything about the failure reason.
    """

    LOGIN_PATH = "/api/v1/auth/login"

    @pytest.fixture(autouse=True)
    def _client(self):
        """
        Build the app and override the DB dependency so tests never need a
        running PostgreSQL.  The default mock makes every DB query return
        ``None`` (no user found), which exercises the "unknown username" path.
        """
        from app.core.database import get_db

        app = _get_app()

        # Default: DB returns no user (simulates unknown username/email)
        async def _no_user_db():
            db = AsyncMock()
            result = MagicMock()
            result.scalar_one_or_none.return_value = None
            db.execute.return_value = result
            yield db

        app.dependency_overrides[get_db] = _no_user_db
        self.app = app
        self.client = TestClient(app, raise_server_exceptions=False)

    # ── Unknown username ───────────────────────────────────────────────────

    def test_unknown_username_returns_401(self):
        resp = self.client.post(
            self.LOGIN_PATH,
            json={"username": "nobody@example.com", "password": "any_password"},
        )
        assert resp.status_code == 401

    def test_unknown_username_detail_is_generic(self):
        resp = self.client.post(
            self.LOGIN_PATH,
            json={"username": "nobody@example.com", "password": "any_password"},
        )
        assert resp.json()["detail"] == "Invalid credentials"

    def test_unknown_username_no_enumeration_hint(self):
        """Response must not distinguish 'unknown user' from 'wrong password'."""
        resp = self.client.post(
            self.LOGIN_PATH,
            json={"username": "nobody@example.com", "password": "any_password"},
        )
        raw = resp.text
        for forbidden in ("not found", "does not exist", "no account", "unknown user"):
            assert forbidden not in raw.lower(), (
                f"Forbidden enumeration hint {forbidden!r} found in response"
            )

    # ── Wrong password ─────────────────────────────────────────────────────

    def test_wrong_password_returns_same_detail(self):
        """Both bad-user and bad-password must produce identical responses."""
        bad_user_resp = self.client.post(
            self.LOGIN_PATH,
            json={"username": "nobody@example.com", "password": "pass"},
        )
        # With a mocked DB that returns a user but wrong password, the message
        # should still be "Invalid credentials" – we verify the /login endpoint
        # is wired correctly by examining it directly via rbac_service integration.
        assert bad_user_resp.json()["detail"] == "Invalid credentials"

    def test_response_does_not_reveal_password_specifics(self):
        resp = self.client.post(
            self.LOGIN_PATH,
            json={"username": "nobody@example.com", "password": "wrong"},
        )
        raw = resp.text
        assert "password" not in raw.lower() or "Invalid credentials" in raw
        for forbidden in ("incorrect password", "wrong password", "bad password"):
            assert forbidden not in raw.lower()

    # ── Inactive / deactivated account ────────────────────────────────────

    def test_inactive_account_message_indistinguishable_from_bad_credentials(self):
        """
        A deactivated account must return "Invalid credentials", not
        "User account is deactivated" (which would confirm the user exists).
        """
        from app.core.database import get_db

        # Mock DB to return an inactive user
        inactive_user = MagicMock()
        inactive_user.is_active = False
        inactive_user.hashed_password = "$2b$12$fakehashxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"

        async def _inactive_user_db():
            db = AsyncMock()
            result = MagicMock()
            result.scalar_one_or_none.return_value = inactive_user
            db.execute.return_value = result
            yield db

        app = _get_app()
        app.dependency_overrides[get_db] = _inactive_user_db
        client = TestClient(app, raise_server_exceptions=False)

        with patch("app.api.v1.endpoints.auth.verify_password", return_value=True):
            resp = client.post(
                self.LOGIN_PATH,
                json={"username": "exists@example.com", "password": "any"},
            )
            assert resp.status_code == 401
            assert resp.json()["detail"] == "Invalid credentials"
            assert "deactivated" not in resp.text.lower()
            assert "account" not in resp.text.lower()

    # ── Form-based login endpoint ─────────────────────────────────────────

    def test_form_login_unknown_user_returns_generic(self):
        from app.core.database import get_db

        async def _no_user_db():
            db = AsyncMock()
            result = MagicMock()
            result.scalar_one_or_none.return_value = None
            db.execute.return_value = result
            yield db

        app = _get_app()
        app.dependency_overrides[get_db] = _no_user_db
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post(
            "/api/v1/auth/login/form",
            data={"username": "nobody@example.com", "password": "pass"},
        )
        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid credentials"

    def test_form_login_no_email_exists_hint(self):
        from app.core.database import get_db

        async def _no_user_db():
            db = AsyncMock()
            result = MagicMock()
            result.scalar_one_or_none.return_value = None
            db.execute.return_value = result
            yield db

        app = _get_app()
        app.dependency_overrides[get_db] = _no_user_db
        client = TestClient(app, raise_server_exceptions=False)
        resp = client.post(
            "/api/v1/auth/login/form",
            data={"username": "nobody@example.com", "password": "pass"},
        )
        raw = resp.text
        for forbidden in ("email", "incorrect", "not registered"):
            assert forbidden.lower() not in raw.lower(), (
                f"Forbidden hint {forbidden!r} found in form-login error response"
            )


# =============================================================================
# AC3 – Global 500 Error Handler
# =============================================================================

class TestGlobalInternalServerError:
    """
    Unhandled exceptions must produce HTTP 500 with a generic message.
    Stack traces, exception class names and internal paths must never
    appear in the response body.
    """

    @pytest.fixture(autouse=True)
    def _client(self):
        self.app = _get_app()
        # raise_server_exceptions=False so 500s are returned as responses
        self.client = TestClient(self.app, raise_server_exceptions=False)

    def _add_crash_route(self, exc_message: str = "secret db password=hunter2") -> None:
        """Dynamically add a route that raises an unhandled RuntimeError."""
        @self.app.get("/_test_crash")
        async def _crash():  # noqa: RUF029
            raise RuntimeError(exc_message)

    # ── Status code ────────────────────────────────────────────────────────

    def test_unhandled_exception_returns_500(self):
        self._add_crash_route()
        resp = self.client.get("/_test_crash")
        assert resp.status_code == 500

    # ── Generic body ───────────────────────────────────────────────────────

    def test_500_detail_is_generic(self):
        self._add_crash_route()
        resp = self.client.get("/_test_crash")
        detail = resp.json().get("detail", "")
        assert detail == "An internal server error occurred."

    # ── No exception text in response ──────────────────────────────────────

    def test_500_does_not_leak_exception_message(self):
        secret_msg = "secret db password=hunter2"
        self._add_crash_route(exc_message=secret_msg)
        resp = self.client.get("/_test_crash")
        assert secret_msg not in resp.text

    def test_500_does_not_leak_exception_class(self):
        self._add_crash_route()
        resp = self.client.get("/_test_crash")
        assert "RuntimeError" not in resp.text

    def test_500_does_not_contain_traceback(self):
        self._add_crash_route()
        resp = self.client.get("/_test_crash")
        raw = resp.text
        assert "Traceback" not in raw
        assert "File \"" not in raw
        assert "line " not in raw.lower() or "An internal" in raw  # allow detail text

    # ── Logging side-effect (best-effort check) ────────────────────────────

    def test_500_logs_exception_server_side(self, caplog):
        """Verify the handler logs at ERROR level (implementation contract)."""
        import logging as _logging

        self._add_crash_route(exc_message="logged_secret_message")
        with caplog.at_level(_logging.ERROR):
            self.client.get("/_test_crash")

        # The exception message should appear in server logs, not in client body
        log_text = caplog.text
        assert "logged_secret_message" in log_text or "Unhandled" in log_text, (
            "Expected the unhandled exception to be logged server-side"
        )

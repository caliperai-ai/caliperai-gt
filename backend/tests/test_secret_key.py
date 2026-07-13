"""
Unit tests for SECRET_KEY security enforcement.

Acceptance criteria covered:
  AC1 – SECRET_KEY has no default value in code.
  AC2 – App raises SystemExit on startup if SECRET_KEY is a known weak/default
         string OR is shorter than 32 characters.
  AC3 – (Documented separately) Docs updated with key-generation command.

Test classes
------------
TestSecretKeyHasNoDefault
    Validates that the field has no hardcoded default in the model.

TestSecretKeyValidatorWeakKeys
    Checks every known-weak placeholder raises SystemExit via the validator.

TestSecretKeyValidatorLength
    Boundary tests for the 32-character minimum length rule.

TestSecretKeyValidatorAcceptsStrong
    Happy-path: strong keys at/above the threshold are accepted.

TestGetSettingsMissingKey
    get_settings() converts a missing SECRET_KEY into SystemExit.

TestGetSettingsWeakKeyViaEnv
    get_settings() propagates SystemExit for weak keys read from the environment.
"""
from __future__ import annotations

import os
import pytest

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VALID_KEY = "a" * 32  # exactly 32 chars, non-weak


def _make_settings(secret_key: str):
    """Instantiate Settings directly, bypassing env / .env file."""
    # Import lazily so the module-level `settings = get_settings()` line does
    # not execute at collection time without a valid SECRET_KEY in the env.
    from app.core.config import Settings
    # Passing keyword arguments takes priority over env vars and .env file in
    # pydantic-settings v2, so these tests are hermetic.
    return Settings(SECRET_KEY=secret_key, _env_file=None)  # type: ignore[call-arg]


# ---------------------------------------------------------------------------
# AC1 – No default value
# ---------------------------------------------------------------------------

class TestSecretKeyHasNoDefault:
    """SECRET_KEY must be a required field with no default in the model."""

    def test_field_is_required(self):
        from app.core.config import Settings
        field = Settings.model_fields["SECRET_KEY"]
        assert field.is_required(), (
            "SECRET_KEY must not have a default value in code"
        )

    def test_field_has_no_default_value(self):
        from pydantic_core import PydanticUndefinedType
        from app.core.config import Settings
        field = Settings.model_fields["SECRET_KEY"]
        assert isinstance(field.default, PydanticUndefinedType), (
            "SECRET_KEY.default must be PydanticUndefined (i.e. no default)"
        )

    def test_field_has_no_default_factory(self):
        from app.core.config import Settings
        field = Settings.model_fields["SECRET_KEY"]
        assert field.default_factory is None, (
            "SECRET_KEY must not have a default_factory"
        )


# ---------------------------------------------------------------------------
# AC2a – Known-weak / placeholder keys raise SystemExit
# ---------------------------------------------------------------------------

class TestSecretKeyValidatorWeakKeys:
    """Every entry in _KNOWN_WEAK_KEYS must cause the app to refuse to start."""

    @pytest.mark.parametrize("weak_key", [
        "your-secret-key-change-in-production",  # former hardcoded default
        "changeme",
        "change-me",
        "CHANGE_ME_USE_LONG_RANDOM_STRING",
        "secret",
        "insecure",
        "development",
        "test",
        "",  # empty string
    ])
    def test_weak_key_raises_system_exit(self, weak_key: str):
        with pytest.raises(SystemExit):
            _make_settings(weak_key)

    def test_former_hardcoded_default_raises_system_exit(self):
        """The key that was previously hardcoded in config.py is explicitly blocked."""
        with pytest.raises(SystemExit):
            _make_settings("your-secret-key-change-in-production")

    def test_system_exit_message_mentions_key_generation(self):
        """The error message must guide the operator towards a fix."""
        with pytest.raises(SystemExit) as exc_info:
            _make_settings("your-secret-key-change-in-production")
        # SystemExit.code holds the message string when sys.exit(str) is called
        message = str(exc_info.value.code)
        assert "secrets" in message or "openssl" in message, (
            "SystemExit message should include a key-generation hint"
        )


# ---------------------------------------------------------------------------
# AC2b – Keys shorter than 32 characters raise SystemExit
# ---------------------------------------------------------------------------

class TestSecretKeyValidatorLength:
    """Keys below 32 characters must be rejected regardless of content."""

    @pytest.mark.parametrize("length", [0, 1, 8, 16, 31])
    def test_short_key_raises_system_exit(self, length: int):
        short_key = "x" * length
        # Empty string is also caught by the weak-key check, but the length
        # check acts as a second line of defence for one-char to 31-char keys.
        with pytest.raises(SystemExit):
            _make_settings(short_key)

    def test_31_chars_raises_system_exit(self):
        with pytest.raises(SystemExit):
            _make_settings("a" * 31)

    def test_system_exit_for_short_key_mentions_minimum_length(self):
        """Short-key error message must state the minimum requirement."""
        with pytest.raises(SystemExit) as exc_info:
            _make_settings("tooshort")
        message = str(exc_info.value.code)
        assert "32" in message, (
            "SystemExit message for a short key should mention the 32-char minimum"
        )


# ---------------------------------------------------------------------------
# AC2c – Strong keys are accepted
# ---------------------------------------------------------------------------

class TestSecretKeyValidatorAcceptsStrong:
    """Keys that meet the minimum strength requirement must be accepted."""

    def test_exactly_32_chars_is_accepted(self):
        settings = _make_settings("a" * 32)
        assert settings.SECRET_KEY == "a" * 32

    def test_64_char_hex_key_is_accepted(self):
        import secrets
        key = secrets.token_hex(32)  # 64 hex chars
        settings = _make_settings(key)
        assert settings.SECRET_KEY == key

    def test_128_char_key_is_accepted(self):
        key = "z" * 128
        settings = _make_settings(key)
        assert settings.SECRET_KEY == key

    def test_key_with_spaces_and_special_chars_accepted_if_long_enough(self):
        # Unusual but technically valid if >= 32 chars and not in weak list
        key = "!@#$%^&*()_+=-[]{}|;':\",./<>? x" * 2  # 31*2=62 chars
        assert len(key) >= 32
        settings = _make_settings(key)
        assert settings.SECRET_KEY == key


# ---------------------------------------------------------------------------
# AC2d – get_settings() converts missing SECRET_KEY into SystemExit
# ---------------------------------------------------------------------------

class TestGetSettingsMissingKey:
    """When SECRET_KEY is absent from both env and .env, get_settings() must exit.

    When SECRET_KEY is completely missing, pydantic raises ValidationError before
    any validator runs (required field not supplied). get_settings() is the
    enforcement boundary that converts that into SystemExit so the app refuses
    to start. We test the full chain by patching Settings to always raise
    ValidationError, then asserting get_settings() converts it to SystemExit.
    """

    def test_missing_secret_key_raises_system_exit(self, monkeypatch):
        from unittest.mock import patch
        from pydantic import ValidationError
        from app.core import config as config_module

        config_module.get_settings.cache_clear()

        # Simulate Settings() raising ValidationError (happens when SECRET_KEY
        # is absent – pydantic enforces required fields before any validator runs)
        def raise_validation_error(*args, **kwargs):
            raise ValidationError.from_exception_data(
                "Settings",
                [{"type": "missing", "loc": ("SECRET_KEY",), "msg": "Field required",
                  "input": {}, "url": "https://errors.pydantic.dev/missing"}],
            )

        try:
            with patch.object(config_module, "Settings", side_effect=raise_validation_error):
                with pytest.raises(SystemExit):
                    config_module.get_settings()
        finally:
            config_module.get_settings.cache_clear()


# ---------------------------------------------------------------------------
# AC2e – get_settings() propagates SystemExit for weak keys from environment
# ---------------------------------------------------------------------------

class TestGetSettingsWeakKeyViaEnv:
    """A weak SECRET_KEY set in the OS environment must also be rejected."""

    def test_weak_key_in_env_raises_system_exit(self, monkeypatch):
        monkeypatch.setenv("SECRET_KEY", "your-secret-key-change-in-production")

        from app.core import config as config_module
        config_module.get_settings.cache_clear()

        try:
            with pytest.raises(SystemExit):
                config_module.get_settings()
        finally:
            config_module.get_settings.cache_clear()

    def test_short_key_in_env_raises_system_exit(self, monkeypatch):
        monkeypatch.setenv("SECRET_KEY", "tooshort")

        from app.core import config as config_module
        config_module.get_settings.cache_clear()

        try:
            with pytest.raises(SystemExit):
                config_module.get_settings()
        finally:
            config_module.get_settings.cache_clear()

    def test_valid_key_in_env_is_accepted(self, monkeypatch):
        import secrets
        strong_key = secrets.token_hex(32)
        monkeypatch.setenv("SECRET_KEY", strong_key)

        from app.core import config as config_module
        config_module.get_settings.cache_clear()

        try:
            settings = config_module.get_settings()
            assert settings.SECRET_KEY == strong_key
        finally:
            config_module.get_settings.cache_clear()

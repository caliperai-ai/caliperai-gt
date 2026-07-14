"""
SSO / OIDC service.

Handles provider discovery, authorization URL generation, token exchange,
user-info fetching, and auto-provisioning for Google, Azure AD, Okta and
Keycloak.
"""
from __future__ import annotations

import json
import logging
import secrets
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import urlencode

import httpx
from redis import asyncio as aioredis
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.models.models import Organization, OrganizationMember, User, UserRole, UserSSOIdentity

logger = logging.getLogger(__name__)


SUPPORTED_PROVIDERS = {"google", "azure", "okta", "keycloak"}

_STATE_TTL_SECONDS = 600
_REDIS_STATE_PREFIX = "sso:state:"


@dataclass
class ProviderConfig:
    """Runtime configuration for a single OIDC provider."""

    name: str
    client_id: str
    client_secret: str
    discovery_url: str
    scopes: list[str] = field(default_factory=lambda: ["openid", "email", "profile"])


def get_provider_config(provider: str) -> ProviderConfig:
    """
    Build the ProviderConfig for *provider* from application settings.

    Raises ``ValueError`` when the provider is unknown or not configured.
    """
    settings = get_settings()
    provider = provider.lower()

    if provider == "google":
        if not settings.SSO_GOOGLE_CLIENT_ID or not settings.SSO_GOOGLE_CLIENT_SECRET:
            raise ValueError("Google SSO is not configured (missing CLIENT_ID / CLIENT_SECRET)")
        return ProviderConfig(
            name="google",
            client_id=settings.SSO_GOOGLE_CLIENT_ID,
            client_secret=settings.SSO_GOOGLE_CLIENT_SECRET,
            discovery_url="https://accounts.google.com/.well-known/openid-configuration",
        )

    if provider == "azure":
        if not settings.SSO_AZURE_CLIENT_ID or not settings.SSO_AZURE_CLIENT_SECRET:
            raise ValueError("Azure AD SSO is not configured (missing CLIENT_ID / CLIENT_SECRET)")
        tenant = settings.SSO_AZURE_TENANT_ID or "common"
        return ProviderConfig(
            name="azure",
            client_id=settings.SSO_AZURE_CLIENT_ID,
            client_secret=settings.SSO_AZURE_CLIENT_SECRET,
            discovery_url=(
                f"https://login.microsoftonline.com/{tenant}/v2.0"
                "/.well-known/openid-configuration"
            ),
        )

    if provider == "okta":
        if not settings.SSO_OKTA_CLIENT_ID or not settings.SSO_OKTA_CLIENT_SECRET:
            raise ValueError("Okta SSO is not configured (missing CLIENT_ID / CLIENT_SECRET)")
        if not settings.SSO_OKTA_DOMAIN:
            raise ValueError("Okta SSO is not configured (missing SSO_OKTA_DOMAIN)")
        domain = settings.SSO_OKTA_DOMAIN.rstrip("/")
        return ProviderConfig(
            name="okta",
            client_id=settings.SSO_OKTA_CLIENT_ID,
            client_secret=settings.SSO_OKTA_CLIENT_SECRET,
            discovery_url=f"https://{domain}/.well-known/openid-configuration",
        )

    if provider == "keycloak":
        if not settings.SSO_KEYCLOAK_CLIENT_ID or not settings.SSO_KEYCLOAK_CLIENT_SECRET:
            raise ValueError(
                "Keycloak SSO is not configured (missing CLIENT_ID / CLIENT_SECRET)"
            )
        if not settings.SSO_KEYCLOAK_BASE_URL or not settings.SSO_KEYCLOAK_REALM:
            raise ValueError(
                "Keycloak SSO is not configured (missing SSO_KEYCLOAK_BASE_URL / SSO_KEYCLOAK_REALM)"
            )
        base = settings.SSO_KEYCLOAK_BASE_URL.rstrip("/")
        realm = settings.SSO_KEYCLOAK_REALM
        return ProviderConfig(
            name="keycloak",
            client_id=settings.SSO_KEYCLOAK_CLIENT_ID,
            client_secret=settings.SSO_KEYCLOAK_CLIENT_SECRET,
            discovery_url=f"{base}/realms/{realm}/.well-known/openid-configuration",
        )

    raise ValueError(f"Unknown SSO provider: {provider!r}. Supported: {SUPPORTED_PROVIDERS}")



_discovery_cache: dict[str, dict[str, Any]] = {}


async def fetch_discovery_document(discovery_url: str) -> dict[str, Any]:
    """Fetch and cache the OIDC discovery document."""
    if discovery_url in _discovery_cache:
        return _discovery_cache[discovery_url]

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(discovery_url)
        resp.raise_for_status()
        doc = resp.json()

    _discovery_cache[discovery_url] = doc
    return doc



async def _get_redis() -> Optional[aioredis.Redis]:
    """Import lazily to avoid import-time initialisation issues."""
    from app.core.redis_cache import get_redis
    return await get_redis()


async def save_state(
    redis: aioredis.Redis,
    state: str,
    provider: str,
    nonce: str,
) -> None:
    """Persist state → {provider, nonce} mapping in Redis with TTL."""
    payload = json.dumps({"provider": provider, "nonce": nonce})
    await redis.setex(f"{_REDIS_STATE_PREFIX}{state}", _STATE_TTL_SECONDS, payload)


async def consume_state(
    redis: aioredis.Redis,
    state: str,
) -> Optional[dict[str, str]]:
    """
    Retrieve and *delete* the state entry from Redis.

    Returns ``None`` when the state is unknown or expired.
    """
    key = f"{_REDIS_STATE_PREFIX}{state}"
    raw = await redis.get(key)
    if raw is None:
        return None
    await redis.delete(key)
    return json.loads(raw)



def build_redirect_uri(provider: str) -> str:
    base = get_settings().SSO_REDIRECT_BASE_URL.rstrip("/")
    return f"{base}/api/v1/auth/sso/{provider}/callback"


async def build_authorization_url(
    provider: str,
    redis: aioredis.Redis,
) -> str:
    """
    Generate the IdP authorization URL and persist the CSRF state in Redis.
    """
    cfg = get_provider_config(provider)
    doc = await fetch_discovery_document(cfg.discovery_url)
    authorization_endpoint: str = doc["authorization_endpoint"]

    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    await save_state(redis, state, provider, nonce)

    params = {
        "client_id": cfg.client_id,
        "redirect_uri": build_redirect_uri(provider),
        "response_type": "code",
        "scope": " ".join(cfg.scopes),
        "state": state,
        "nonce": nonce,
    }
    return f"{authorization_endpoint}?{urlencode(params)}"



async def exchange_code(
    provider: str,
    code: str,
    state: str,
    redis: aioredis.Redis,
) -> dict[str, Any]:
    """
    Validate *state*, exchange *code* for tokens, and return raw user claims.

    Raises ``ValueError`` for any security or protocol failure.
    """
    state_data = await consume_state(redis, state)
    if state_data is None:
        raise ValueError("Invalid or expired OAuth state")
    if state_data["provider"] != provider:
        raise ValueError("State/provider mismatch")

    cfg = get_provider_config(provider)
    doc = await fetch_discovery_document(cfg.discovery_url)
    token_endpoint: str = doc["token_endpoint"]
    userinfo_endpoint: str = doc["userinfo_endpoint"]

    async with httpx.AsyncClient(timeout=15) as client:
        token_resp = await client.post(
            token_endpoint,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": build_redirect_uri(provider),
                "client_id": cfg.client_id,
                "client_secret": cfg.client_secret,
            },
        )
        if token_resp.status_code != 200:
            logger.error("Token exchange failed: %s", token_resp.text)
            raise ValueError(f"Token exchange failed: {token_resp.status_code}")
        token_data = token_resp.json()

        access_token = token_data.get("access_token")
        if not access_token:
            raise ValueError("Token response did not include access_token")

        userinfo_resp = await client.get(
            userinfo_endpoint,
            headers={"Authorization": f"Bearer {access_token}"},
        )
        if userinfo_resp.status_code != 200:
            logger.error("Userinfo fetch failed: %s", userinfo_resp.text)
            raise ValueError(f"Userinfo endpoint returned {userinfo_resp.status_code}")
        claims = userinfo_resp.json()

    return claims



def _parse_email_domain_map() -> dict[str, str]:
    """
    Parse SSO_EMAIL_DOMAIN_ORG_MAP setting into {domain: org_slug} dict.
    Format: "acme.com:acme-org,example.org:example-org"
    """
    raw = (get_settings().SSO_EMAIL_DOMAIN_ORG_MAP or "").strip()
    result: dict[str, str] = {}
    for pair in raw.split(","):
        pair = pair.strip()
        if ":" in pair:
            domain, slug = pair.split(":", 1)
            result[domain.strip().lower()] = slug.strip()
    return result


async def get_or_create_sso_user(
    provider: str,
    claims: dict[str, Any],
    db: AsyncSession,
) -> User:
    """
    Find an existing user for these SSO claims, or auto-provision one.

    Steps:
    1. Look up ``UserSSOIdentity`` by provider + sub.
    2. If found, return the linked user (updating last_login_at).
    3. Otherwise look up an existing ``User`` by email.
    4. If found, link the SSO identity to that user.
    5. If not, create a new ``User`` + ``UserSSOIdentity``.
    6. Optionally add the user to an organisation based on email domain.
    """
    sub: Optional[str] = claims.get("sub")
    email: Optional[str] = claims.get("email")
    name: Optional[str] = claims.get("name")

    if not sub:
        raise ValueError("OIDC claims do not contain 'sub'")
    if not email:
        raise ValueError("OIDC claims do not contain 'email'")

    now = datetime.now(timezone.utc)

    identity_result = await db.execute(
        select(UserSSOIdentity).where(
            UserSSOIdentity.provider == provider,
            UserSSOIdentity.provider_subject == sub,
        )
    )
    identity = identity_result.scalar_one_or_none()

    if identity is not None:
        identity.last_login_at = now
        identity.provider_claims = claims
        user_result = await db.execute(select(User).where(User.id == identity.user_id))
        user = user_result.scalar_one()
        return user

    user_result = await db.execute(
        select(User).where(func.lower(User.email) == email.lower())
    )
    user = user_result.scalar_one_or_none()

    if user is None:
        username_base = email.split("@")[0].replace(".", "_").lower()
        candidate = username_base
        counter = 1
        while True:
            existing = await db.execute(select(User).where(User.username == candidate))
            if existing.scalar_one_or_none() is None:
                break
            candidate = f"{username_base}{counter}"
            counter += 1

        user = User(
            id=uuid.uuid4(),
            email=email,
            username=candidate,
            full_name=name,
            hashed_password="!",
            is_active=True,
            is_superuser=False,
            must_change_password=False,
            role=get_settings().SSO_DEFAULT_ROLE,
        )
        db.add(user)
        await db.flush()

        domain = email.split("@")[-1].lower()
        domain_map = _parse_email_domain_map()
        org_slug = domain_map.get(domain)
        if org_slug:
            org_result = await db.execute(
                select(Organization).where(Organization.slug == org_slug)
            )
            org = org_result.scalar_one_or_none()
            if org:
                member = OrganizationMember(
                    organization_id=org.id,
                    user_id=user.id,
                    is_default=True,
                )
                db.add(member)

    new_identity = UserSSOIdentity(
        user_id=user.id,
        provider=provider,
        provider_subject=sub,
        provider_email=email,
        provider_claims=claims,
        last_login_at=now,
    )
    db.add(new_identity)
    return user

"""
SSO / OIDC endpoints.

Routes
------
GET  /api/v1/auth/sso/{provider}           – initiate OIDC flow
GET  /api/v1/auth/sso/{provider}/callback  – complete flow, issue JWT
GET  /api/v1/auth/sso/providers            – list enabled providers
"""
from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.endpoints.auth import TokenUser, create_access_token
from app.core.config import get_settings
from app.core.database import get_db
from app.core.redis_cache import get_redis
from app.services.sso_service import (
    SUPPORTED_PROVIDERS,
    build_authorization_url,
    exchange_code,
    get_or_create_sso_user,
    get_provider_config,
)

logger = logging.getLogger(__name__)
router = APIRouter()



class ProviderInfo(BaseModel):
    """Public information about a configured SSO provider."""

    provider: str
    name: str
    login_url: str


class SSOTokenResponse(BaseModel):
    """JWT response after a successful SSO callback (mirrors Token schema)."""

    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: TokenUser



def _provider_display_name(provider: str) -> str:
    return {
        "google": "Google",
        "azure": "Azure AD",
        "okta": "Okta",
        "keycloak": "Keycloak",
    }.get(provider, provider.title())


def _is_provider_configured(provider: str) -> bool:
    """Return True if the provider has the required settings."""
    try:
        get_provider_config(provider)
        return True
    except ValueError:
        return False



@router.get("/providers", response_model=list[ProviderInfo])
async def list_sso_providers() -> list[ProviderInfo]:
    """
    Return the list of SSO providers that are currently configured.

    The frontend uses this to decide which "Sign in with …" buttons to show.
    """
    results: list[ProviderInfo] = []
    base = get_settings().SSO_FRONTEND_URL.rstrip("/")

    for provider in sorted(SUPPORTED_PROVIDERS):
        if _is_provider_configured(provider):
            results.append(
                ProviderInfo(
                    provider=provider,
                    name=_provider_display_name(provider),
                    login_url=f"{base}/auth/sso/{provider}",
                )
            )
    return results


@router.get("/{provider}", summary="Initiate SSO login flow")
async def initiate_sso(
    provider: str,
) -> RedirectResponse:
    """
    Redirect the browser to the IdP authorization endpoint.

    The *state* parameter written to Redis prevents CSRF attacks during the
    round-trip.
    """
    provider = provider.lower()
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown provider '{provider}'. Supported: {sorted(SUPPORTED_PROVIDERS)}",
        )

    redis = await get_redis()
    if redis is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SSO state storage (Redis) is unavailable",
        )

    try:
        auth_url = await build_authorization_url(provider, redis)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    logger.info("SSO initiation: redirecting to %s", provider)
    return RedirectResponse(url=auth_url, status_code=302)


@router.get("/{provider}/callback", summary="Handle SSO callback and issue JWT")
async def sso_callback(
    provider: str,
    code: Annotated[str | None, Query()] = None,
    state: Annotated[str | None, Query()] = None,
    error: Annotated[str | None, Query()] = None,
    error_description: Annotated[str | None, Query()] = None,
    db: AsyncSession = Depends(get_db),
) -> RedirectResponse:
    """
    Handle the IdP redirect, exchange the authorization code for tokens,
    auto-provision the user if needed, and redirect the browser back to the
    frontend with a JWT attached as a query parameter.

    The frontend should immediately capture the token from the URL and store
    it in its auth store, then remove the token from the URL bar.
    """
    provider = provider.lower()

    if error:
        logger.warning("SSO callback error from %s: %s – %s", provider, error, error_description)
        frontend_error_url = (
            f"{get_settings().SSO_FRONTEND_URL.rstrip('/')}/login"
            f"?sso_error={error}"
        )
        return RedirectResponse(url=frontend_error_url, status_code=302)

    if not code or not state:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing 'code' or 'state' query parameters",
        )

    redis = await get_redis()
    if redis is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SSO state storage (Redis) is unavailable",
        )

    try:
        claims = await exchange_code(provider, code, state, redis)
    except ValueError as exc:
        logger.warning("SSO code exchange failed for %s: %s", provider, exc)
        frontend_error_url = (
            f"{get_settings().SSO_FRONTEND_URL.rstrip('/')}/login"
            f"?sso_error=code_exchange_failed"
        )
        return RedirectResponse(url=frontend_error_url, status_code=302)

    try:
        async with db.begin_nested():
            user = await get_or_create_sso_user(provider, claims, db)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.exception("SSO user provisioning failed for %s: %s", provider, exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to provision user account",
        ) from exc

    if not user.is_active:
        logger.warning("SSO login rejected: user %s is inactive", user.email)
        frontend_error_url = (
            f"{get_settings().SSO_FRONTEND_URL.rstrip('/')}/login"
            f"?sso_error=account_inactive"
        )
        return RedirectResponse(url=frontend_error_url, status_code=302)

    access_token, expires_in = create_access_token(str(user.id))

    logger.info("SSO login successful: user=%s provider=%s", user.email, provider)

    frontend_url = get_settings().SSO_FRONTEND_URL.rstrip("/")
    redirect_url = (
        f"{frontend_url}/auth/sso/callback"
        f"?access_token={access_token}"
        f"&expires_in={expires_in}"
        f"&provider={provider}"
    )
    return RedirectResponse(url=redirect_url, status_code=302)


@router.get("/{provider}/token", response_model=SSOTokenResponse, summary="Exchange SSO code for JWT (API mode)")
async def sso_token_exchange(
    provider: str,
    code: Annotated[str, Query(...)],
    state: Annotated[str, Query(...)],
    db: AsyncSession = Depends(get_db),
) -> SSOTokenResponse:
    """
    API-mode SSO: exchange an authorization code + state directly for a JWT.

    Use this when the frontend drives the OAuth flow itself (e.g. via a
    pop-up) and needs a JSON response rather than a browser redirect.
    """
    provider = provider.lower()
    if provider not in SUPPORTED_PROVIDERS:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Unknown provider '{provider}'",
        )

    redis = await get_redis()
    if redis is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="SSO state storage (Redis) is unavailable",
        )

    try:
        claims = await exchange_code(provider, code, state, redis)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    try:
        async with db.begin_nested():
            user = await get_or_create_sso_user(provider, claims, db)
        await db.commit()
    except Exception as exc:
        await db.rollback()
        logger.exception("SSO user provisioning failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to provision user account",
        ) from exc

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Account is inactive",
        )

    access_token, expires_in = create_access_token(str(user.id))
    permissions = list(user.permissions)

    return SSOTokenResponse(
        access_token=access_token,
        expires_in=expires_in,
        user=TokenUser(
            id=str(user.id),
            email=user.email,
            username=user.username,
            full_name=user.full_name,
            role=user.role,
            is_superuser=user.is_superuser,
            permissions=permissions,
            must_change_password=False,
        ),
    )

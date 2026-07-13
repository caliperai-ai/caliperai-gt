"""
Authentication endpoints - Login, token refresh, password management.
"""
import logging
from datetime import datetime, timedelta
from typing import Annotated

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, status

logger = logging.getLogger(__name__)
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from jose import jwt
from pydantic import BaseModel, EmailStr, Field

from app.core.config import settings
from app.core.database import get_db
from app.core.encryption import get_encryption_service
from app.models.models import User, UserRole, Permission, ROLE_PERMISSIONS
from app.services.rbac_service import (
    get_current_user,
    get_all_roles,
    get_role_permissions,
)


router = APIRouter()



class Token(BaseModel):
    """JWT token response."""
    access_token: str
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int
    user: "TokenUser"


class TokenUser(BaseModel):
    """User info included in token response."""
    id: str
    email: str
    username: str
    full_name: str | None
    role: str
    is_superuser: bool
    permissions: list[str]
    must_change_password: bool = False


class LoginRequest(BaseModel):
    """Login request body."""
    username: str
    password: str


class PasswordChangeRequest(BaseModel):
    """Password change request."""
    current_password: str
    new_password: str = Field(..., min_length=8)


class RoleInfo(BaseModel):
    """Role information."""
    name: str
    value: str
    description: str
    permissions: list[str]


class CurrentUserResponse(BaseModel):
    """Current user response with permissions."""
    id: str
    email: str
    username: str
    full_name: str | None
    role: str
    is_active: bool
    is_superuser: bool
    permissions: list[str]
    must_change_password: bool = False



def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a password against a hash using bcrypt directly."""
    return bcrypt.checkpw(
        plain_password.encode('utf-8'),
        hashed_password.encode('utf-8')
    )


def hash_password(password: str) -> str:
    """Hash a password using bcrypt."""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')


def create_access_token(user_id: str, expires_delta: timedelta | None = None) -> tuple[str, int]:
    """
    Create a JWT access token.
    
    Returns:
        Tuple of (token, expires_in_seconds)
    """
    if expires_delta is None:
        expires_delta = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    
    expire = datetime.utcnow() + expires_delta
    to_encode = {
        "sub": user_id,
        "exp": expire,
        "iat": datetime.utcnow(),
    }
    
    token = jwt.encode(to_encode, settings.SECRET_KEY, algorithm="HS256")
    return token, int(expires_delta.total_seconds())



@router.post("/login", response_model=Token)
async def login(
    login_data: LoginRequest,
    db: AsyncSession = Depends(get_db),
) -> Token:
    """
    Authenticate user and return JWT token.
    Accepts username or email in the username field.
    """
    _enc = get_encryption_service()
    query = select(User).where(
        (User.email_blind_index == _enc.blind_index(login_data.username))
        | (User.username == login_data.username)
    )
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    
    if not user:
        logger.warning("Login failed: unknown username/email %r", login_data.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not verify_password(login_data.password, user.hashed_password):
        logger.warning("Login failed: wrong password for user %r", user.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        logger.warning("Login failed: inactive user %r", user.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token, expires_in = create_access_token(str(user.id))
    
    return Token(
        access_token=access_token,
        expires_in=expires_in,
        user=TokenUser(
            id=str(user.id),
            email=user.email,
            username=user.username,
            full_name=user.full_name,
            role=user.role,
            is_superuser=user.is_superuser,
            permissions=list(user.permissions),
            must_change_password=getattr(user, 'must_change_password', False),
        ),
    )


@router.post("/login/form", response_model=Token)
async def login_form(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: AsyncSession = Depends(get_db),
) -> Token:
    """
    OAuth2 compatible login endpoint (accepts form data).
    Username field is treated as email.
    """
    query = select(User).where(User.email_blind_index == get_encryption_service().blind_index(form_data.username))
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    
    if not user:
        logger.warning("Login (form) failed: unknown email %r", form_data.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not verify_password(form_data.password, user.hashed_password):
        logger.warning("Login (form) failed: wrong password for user %r", user.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    if not user.is_active:
        logger.warning("Login (form) failed: inactive user %r", user.username)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token, expires_in = create_access_token(str(user.id))
    
    return Token(
        access_token=access_token,
        expires_in=expires_in,
        user=TokenUser(
            id=str(user.id),
            email=user.email,
            username=user.username,
            full_name=user.full_name,
            role=user.role,
            is_superuser=user.is_superuser,
            permissions=list(user.permissions),
            must_change_password=getattr(user, 'must_change_password', False),
        ),
    )


@router.get("/me", response_model=CurrentUserResponse)
async def get_current_user_info(
    current_user: Annotated[User, Depends(get_current_user)],
) -> CurrentUserResponse:
    """
    Get the current authenticated user's information and permissions.
    """
    return CurrentUserResponse(
        id=str(current_user.id),
        email=current_user.email,
        username=current_user.username,
        full_name=current_user.full_name,
        role=current_user.role,
        is_active=current_user.is_active,
        is_superuser=current_user.is_superuser,
        permissions=list(current_user.permissions),
        must_change_password=getattr(current_user, 'must_change_password', False),
    )


@router.post("/change-password")
async def change_password(
    password_data: PasswordChangeRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Change the current user's password.
    """
    if not verify_password(password_data.current_password, current_user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect current password",
        )
    
    current_user.hashed_password = hash_password(password_data.new_password)
    current_user.must_change_password = False
    await db.flush()
    
    return {"message": "Password updated successfully"}


@router.post("/refresh", response_model=Token)
async def refresh_token(
    current_user: Annotated[User, Depends(get_current_user)],
) -> Token:
    """
    Refresh the access token for the current user.
    """
    access_token, expires_in = create_access_token(str(current_user.id))
    
    return Token(
        access_token=access_token,
        expires_in=expires_in,
        user=TokenUser(
            id=str(current_user.id),
            email=current_user.email,
            username=current_user.username,
            full_name=current_user.full_name,
            role=current_user.role,
            is_superuser=current_user.is_superuser,
            permissions=list(current_user.permissions),
            must_change_password=getattr(current_user, 'must_change_password', False),
        ),
    )


@router.get("/roles", response_model=list[RoleInfo])
async def list_roles() -> list[RoleInfo]:
    """
    Get all available roles and their permissions.
    """
    roles = get_all_roles()
    return [
        RoleInfo(
            name=role["name"],
            value=role["value"],
            description=role["description"],
            permissions=list(get_role_permissions(role["value"])),
        )
        for role in roles
    ]


@router.get("/permissions")
async def list_permissions() -> dict:
    """
    Get all available permissions grouped by category.
    """
    permissions_by_category: dict[str, list[dict]] = {}
    
    for perm in Permission:
        category = perm.value.split(":")[0]
        if category not in permissions_by_category:
            permissions_by_category[category] = []
        
        permissions_by_category[category].append({
            "value": perm.value,
            "name": perm.name,
        })
    
    return {
        "categories": permissions_by_category,
        "total": len(Permission),
    }


@router.get("/check-permission/{permission}")
async def check_user_permission(
    permission: str,
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    """
    Check if the current user has a specific permission.
    """
    has_perm = current_user.has_permission(permission)
    return {
        "permission": permission,
        "has_permission": has_perm,
        "user_role": current_user.role,
    }

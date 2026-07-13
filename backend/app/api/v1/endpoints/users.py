"""
User endpoints with RBAC protection.
"""
from typing import Annotated, Optional, List
from uuid import UUID

import bcrypt
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.encryption import get_encryption_service
from app.models.models import User, Permission, UserRole, OrganizationMember, Organization
from app.schemas.schemas import (
    UserCreate,
    UserUpdate,
    UserResponse,
)
from app.services.rbac_service import (
    get_current_user,
    RequirePermissions,
    RequireRole,
    require_permission,
    PermissionDeniedError,
)
from app.services.organization_service import get_user_accessible_organization_ids

router = APIRouter()


def hash_password(password: str) -> str:
    """Hash a password using bcrypt directly."""
    salt = bcrypt.gensalt()
    return bcrypt.hashpw(password.encode('utf-8'), salt).decode('utf-8')


@router.post("", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def create_user(
    user_in: UserCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.USERS_CREATE))],
    organization_id: Optional[UUID] = Query(None, description="Organization to add the user to after creation"),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Create a new user. Requires USERS_CREATE permission (Admin only).
    
    If organization_id is provided:
    - New users will be automatically added to that organization
    - If user already exists (same email or username), they will be added to the organization
    """
    _enc = get_encryption_service()

    existing_user = (await db.execute(
        select(User).where(User.email_blind_index == _enc.blind_index(user_in.email))
    )).scalar_one_or_none()

    if existing_user is None:
        username_taken = (await db.execute(
            select(User.id).where(User.username == user_in.username)
        )).scalar_one_or_none()
        if username_taken is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Username '{user_in.username}' is already taken",
            )

    if existing_user:
        if organization_id:
            member_check = await db.execute(
                select(OrganizationMember).where(
                    OrganizationMember.user_id == existing_user.id,
                    OrganizationMember.organization_id == organization_id
                )
            )
            if not member_check.scalar_one_or_none():
                membership = OrganizationMember(
                    user_id=existing_user.id,
                    organization_id=organization_id,
                    role="member",
                    is_default=False,
                )
                db.add(membership)
                await db.flush()
            
            if not existing_user.is_active:
                existing_user.is_active = True
                await db.flush()

            await db.refresh(existing_user)
            return existing_user
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered",
            )
    
    user = User(
        email=user_in.email,
        email_blind_index=_enc.blind_index(user_in.email),
        username=user_in.username,
        hashed_password=hash_password(user_in.password),
        full_name=user_in.full_name,
        role=user_in.role,
    )
    db.add(user)
    await db.flush()
    await db.refresh(user)
    
    if organization_id:
        membership = OrganizationMember(
            user_id=user.id,
            organization_id=organization_id,
            role="member",
            is_default=True,
        )
        db.add(membership)
        await db.flush()

    await db.refresh(user)
    return user


@router.get("", response_model=list[UserResponse])
async def list_users(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.USERS_READ_ALL))],
    role: Optional[str] = None,
    is_active: Optional[bool] = None,
    organization_id: Optional[UUID] = Query(None, description="Filter by organization membership"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> list[User]:
    """
    List users with filters. Requires USERS_READ_ALL permission.
    
    - If organization_id is provided, only shows users who are members of that organization
    - If no organization_id, superusers see all; others see users in their organizations
    - The 'default' organization (system default) shows all users
    """
    query = select(User)
    
    if organization_id:
        if not current_user.is_superuser:
            accessible_org_ids = await get_user_accessible_organization_ids(db, current_user.id)
            if organization_id not in accessible_org_ids:
                raise PermissionDeniedError("You do not have access to this organization")
        
        org_result = await db.execute(
            select(Organization).where(Organization.id == organization_id)
        )
        org = org_result.scalar_one_or_none()
        
        is_default_org = org and org.settings.get("is_system_default", False)
        
        if not is_default_org:
            query = query.where(
                User.id.in_(
                    select(OrganizationMember.user_id)
                    .where(OrganizationMember.organization_id == organization_id)
                ),
                User.is_superuser == False
            )
    elif not current_user.is_superuser:
        accessible_org_ids = await get_user_accessible_organization_ids(db, current_user.id)
        query = query.where(
            User.id.in_(
                select(OrganizationMember.user_id)
                .where(OrganizationMember.organization_id.in_(accessible_org_ids))
            )
        )
    
    if role:
        query = query.where(User.role == role)
    if is_active is not None:
        query = query.where(User.is_active == is_active)
    
    query = query.order_by(User.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(
    user_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> User:
    """Get a user by ID. Users can view their own profile, admins can view any."""
    if user_id != current_user.id:
        require_permission(current_user, Permission.USERS_READ)
    
    query = select(User).where(User.id == user_id)
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found",
        )
    
    return user


@router.patch("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: UUID,
    user_in: UserUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
) -> User:
    """Update a user. Users can update own profile, admins can update any."""
    query = select(User).where(User.id == user_id)
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found",
        )
    
    if user_id != current_user.id:
        require_permission(current_user, Permission.USERS_UPDATE)

    update_data = user_in.model_dump(exclude_unset=True)

    if "role" in update_data and update_data["role"] != user.role:
        require_permission(current_user, Permission.USERS_ASSIGN_ROLE)
    
    was_inactive = not user.is_active
    will_be_active = update_data.get("is_active", user.is_active)
    if was_inactive and will_be_active:
        update_data["must_change_password"] = True
    
    for field, value in update_data.items():
        setattr(user, field, value)
    
    await db.flush()
    await db.refresh(user)
    return user


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def deactivate_user(
    user_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.USERS_DELETE))],
    db: AsyncSession = Depends(get_db),
) -> None:
    """Deactivate a user (soft delete). Requires USERS_DELETE permission (Admin only)."""
    query = select(User).where(User.id == user_id)
    result = await db.execute(query)
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"User {user_id} not found",
        )
    
    user.is_active = False
    await db.flush()

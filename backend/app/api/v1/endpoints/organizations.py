"""
Organization API endpoints.

Provides endpoints for managing organizations and organization memberships.
"""
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User, Permission, OrganizationRole
from app.schemas.schemas import (
    OrganizationCreate,
    OrganizationUpdate,
    OrganizationResponse,
    OrganizationListResponse,
    OrganizationMemberCreate,
    OrganizationMemberUpdate,
    OrganizationMemberResponse,
    OrganizationMemberListResponse,
    UserOrganizationsResponse,
    OrganizationWithMembershipResponse,
    UserResponse,
)
from app.services.rbac_service import (
    get_current_user,
    RequirePermissions,
    PermissionDeniedError,
)
from app.services.organization_service import (
    OrganizationService,
    OrganizationMemberService,
)

router = APIRouter(prefix="/organizations", tags=["organizations"])



@router.post("", response_model=OrganizationResponse, status_code=status.HTTP_201_CREATED)
async def create_organization(
    data: OrganizationCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """
    Create a new organization.
    The creating user becomes the owner.
    """
    service = OrganizationService(db)
    try:
        org = await service.create_organization(data, current_user.id)
        await db.commit()
        return org
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("", response_model=OrganizationListResponse)
async def list_organizations(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.SYSTEM_CONFIG))],
    db: AsyncSession = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    search: Optional[str] = None,
):
    """
    List all organizations (admin only).
    """
    service = OrganizationService(db)
    orgs, total = await service.list_organizations(skip=skip, limit=limit, search=search)
    return OrganizationListResponse(organizations=orgs, total=total)


@router.get("/my", response_model=UserOrganizationsResponse)
async def get_my_organizations(
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """
    Get all organizations the current user belongs to.
    """
    member_service = OrganizationMemberService(db)
    memberships = await member_service.get_user_organizations(current_user.id)
    
    orgs_with_membership = []
    default_org = None
    
    for membership in memberships:
        org_response = OrganizationWithMembershipResponse(
            id=membership.organization.id,
            name=membership.organization.name,
            slug=membership.organization.slug,
            description=membership.organization.description,
            logo_url=membership.organization.logo_url,
            settings=membership.organization.settings,
            is_active=membership.organization.is_active,
            created_at=membership.organization.created_at,
            updated_at=membership.organization.updated_at,
            membership=OrganizationMemberResponse(
                id=membership.id,
                organization_id=membership.organization_id,
                user_id=membership.user_id,
                role=membership.role,
                is_default=membership.is_default,
                joined_at=membership.joined_at,
                created_at=membership.created_at,
                updated_at=membership.updated_at,
            ),
        )
        orgs_with_membership.append(org_response)
        
        if membership.is_default:
            default_org = OrganizationResponse(
                id=membership.organization.id,
                name=membership.organization.name,
                slug=membership.organization.slug,
                description=membership.organization.description,
                logo_url=membership.organization.logo_url,
                settings=membership.organization.settings,
                is_active=membership.organization.is_active,
                created_at=membership.organization.created_at,
                updated_at=membership.organization.updated_at,
            )
    
    return UserOrganizationsResponse(
        organizations=orgs_with_membership,
        default_organization=default_org,
    )


@router.get("/{org_id}", response_model=OrganizationResponse)
async def get_organization(
    org_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """
    Get an organization by ID.
    User must be a member or superuser.
    """
    service = OrganizationService(db)
    member_service = OrganizationMemberService(db)
    
    org = await service.get_organization(org_id)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    
    if not current_user.is_superuser:
        is_member = await member_service.is_member(org_id, current_user.id)
        if not is_member:
            raise PermissionDeniedError("You are not a member of this organization")
    
    return org


@router.patch("/{org_id}", response_model=OrganizationResponse)
async def update_organization(
    org_id: UUID,
    data: OrganizationUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """
    Update an organization.
    Only organization admins/owners can update.
    """
    service = OrganizationService(db)
    member_service = OrganizationMemberService(db)
    
    if not current_user.is_superuser:
        is_admin = await member_service.is_admin(org_id, current_user.id)
        if not is_admin:
            raise PermissionDeniedError("Only organization admins can update organization settings")
    
    org = await service.update_organization(org_id, data)
    if not org:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    
    await db.commit()
    return org


@router.delete("/{org_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_organization(
    org_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """
    Delete an organization (soft delete).
    Only organization owners can delete.
    """
    member_service = OrganizationMemberService(db)
    
    if not current_user.is_superuser:
        is_owner = await member_service.is_owner(org_id, current_user.id)
        if not is_owner:
            raise PermissionDeniedError("Only organization owners can delete the organization")
    
    service = OrganizationService(db)
    success = await service.delete_organization(org_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    
    await db.commit()



@router.get("/{org_id}/members", response_model=OrganizationMemberListResponse)
async def list_organization_members(
    org_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    role: Optional[str] = None,
):
    """
    List members of an organization.
    """
    member_service = OrganizationMemberService(db)
    
    if not current_user.is_superuser:
        is_member = await member_service.is_member(org_id, current_user.id)
        if not is_member:
            raise PermissionDeniedError("You are not a member of this organization")
    
    members, total = await member_service.get_organization_members(
        org_id, skip=skip, limit=limit, role=role
    )
    
    member_responses = []
    for member in members:
        user_response = None
        if member.user:
            user_response = UserResponse(
                id=member.user.id,
                email=member.user.email,
                username=member.user.username,
                full_name=member.user.full_name,
                role=member.user.role,
                is_active=member.user.is_active,
                is_superuser=member.user.is_superuser,
                created_at=member.user.created_at,
                updated_at=member.user.updated_at,
            )
        
        member_responses.append(OrganizationMemberResponse(
            id=member.id,
            organization_id=member.organization_id,
            user_id=member.user_id,
            role=member.role,
            is_default=member.is_default,
            joined_at=member.joined_at,
            created_at=member.created_at,
            updated_at=member.updated_at,
            user=user_response,
        ))
    
    return OrganizationMemberListResponse(members=member_responses, total=total)


@router.post("/{org_id}/members", response_model=OrganizationMemberResponse, status_code=status.HTTP_201_CREATED)
async def add_organization_member(
    org_id: UUID,
    data: OrganizationMemberCreate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """
    Add a member to an organization.
    Only organization admins can add members.
    """
    member_service = OrganizationMemberService(db)
    
    if not current_user.is_superuser:
        is_admin = await member_service.is_admin(org_id, current_user.id)
        if not is_admin:
            raise PermissionDeniedError("Only organization admins can add members")
    
    try:
        membership = await member_service.add_member(org_id, data, invited_by=current_user.id)
        await db.commit()
        
        return OrganizationMemberResponse(
            id=membership.id,
            organization_id=membership.organization_id,
            user_id=membership.user_id,
            role=membership.role,
            is_default=membership.is_default,
            joined_at=membership.joined_at,
            created_at=membership.created_at,
            updated_at=membership.updated_at,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.patch("/{org_id}/members/{user_id}", response_model=OrganizationMemberResponse)
async def update_organization_member(
    org_id: UUID,
    user_id: UUID,
    data: OrganizationMemberUpdate,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """
    Update a member's role or default status.
    Only organization admins can update member roles.
    Users can update their own default organization.
    """
    member_service = OrganizationMemberService(db)
    
    is_self = user_id == current_user.id
    is_admin = await member_service.is_admin(org_id, current_user.id)
    
    if not current_user.is_superuser:
        if is_self and data.role is not None:
            raise PermissionDeniedError("You cannot change your own role")
        
        if not is_self and not is_admin:
            raise PermissionDeniedError("Only organization admins can update member roles")
    
    membership = await member_service.update_membership(org_id, user_id, data)
    if not membership:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")
    
    await db.commit()
    
    return OrganizationMemberResponse(
        id=membership.id,
        organization_id=membership.organization_id,
        user_id=membership.user_id,
        role=membership.role,
        is_default=membership.is_default,
        joined_at=membership.joined_at,
        created_at=membership.created_at,
        updated_at=membership.updated_at,
    )


@router.delete("/{org_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_organization_member(
    org_id: UUID,
    user_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """
    Remove a member from an organization.
    Admins can remove members. Users can remove themselves.
    """
    member_service = OrganizationMemberService(db)
    
    is_self = user_id == current_user.id
    
    if not current_user.is_superuser and not is_self:
        is_admin = await member_service.is_admin(org_id, current_user.id)
        if not is_admin:
            raise PermissionDeniedError("Only organization admins can remove members")
    
    try:
        success = await member_service.remove_member(org_id, user_id)
        if not success:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership not found")
        await db.commit()
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/{org_id}/members/set-default", status_code=status.HTTP_200_OK)
async def set_default_organization(
    org_id: UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """
    Set an organization as the current user's default.
    """
    member_service = OrganizationMemberService(db)
    
    is_member = await member_service.is_member(org_id, current_user.id)
    if not is_member:
        raise PermissionDeniedError("You are not a member of this organization")
    
    from app.schemas.schemas import OrganizationMemberUpdate as MemberUpdate, OrganizationRole as SchemaOrgRole
    
    data = MemberUpdate(is_default=True)
    membership = await member_service.update_membership(org_id, current_user.id, data)
    await db.commit()
    
    return {"message": "Default organization updated", "organization_id": str(org_id)}

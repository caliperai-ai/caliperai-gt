"""
Organization Service - Multi-tenancy support.

Provides functionality for managing organizations and organization memberships.
"""
import asyncio
import logging
from typing import Optional, List
from uuid import UUID

from sqlalchemy import select, func, and_, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.services.storage_service import get_storage_service

log = logging.getLogger(__name__)

from app.models.models import (
    Organization,
    OrganizationMember,
    OrganizationRole,
    User,
    Campaign,
    Taxonomy,
)
from app.schemas.schemas import (
    OrganizationCreate,
    OrganizationUpdate,
    OrganizationMemberCreate,
    OrganizationMemberUpdate,
)


class OrganizationService:
    """Service for managing organizations."""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def create_organization(
        self,
        data: OrganizationCreate,
        owner_id: UUID,
    ) -> Organization:
        """
        Create a new organization and add the creator as owner.
        """
        existing = await self.db.execute(
            select(Organization).where(Organization.slug == data.slug)
        )
        if existing.scalar_one_or_none():
            raise ValueError(f"Organization with slug '{data.slug}' already exists")
        
        org = Organization(
            name=data.name,
            slug=data.slug,
            description=data.description,
            logo_url=data.logo_url,
            settings=data.settings or {},
        )
        self.db.add(org)
        await self.db.flush()

        try:
            await asyncio.get_event_loop().run_in_executor(
                None, get_storage_service().ensure_bucket, org.id
            )
        except Exception as exc:  # noqa: BLE001
            log.warning("Could not provision MinIO bucket for org %s: %s", org.id, exc)

        membership = OrganizationMember(
            organization_id=org.id,
            user_id=owner_id,
            role=OrganizationRole.OWNER.value,
            is_default=True,
        )
        self.db.add(membership)
        await self.db.flush()
        
        return org
    
    async def get_organization(self, org_id: UUID) -> Optional[Organization]:
        """Get organization by ID."""
        result = await self.db.execute(
            select(Organization)
            .where(Organization.id == org_id)
            .where(Organization.is_deleted == False)
        )
        return result.scalar_one_or_none()
    
    async def get_organization_by_slug(self, slug: str) -> Optional[Organization]:
        """Get organization by slug."""
        result = await self.db.execute(
            select(Organization)
            .where(Organization.slug == slug)
            .where(Organization.is_deleted == False)
        )
        return result.scalar_one_or_none()
    
    async def update_organization(
        self,
        org_id: UUID,
        data: OrganizationUpdate,
    ) -> Optional[Organization]:
        """Update organization."""
        org = await self.get_organization(org_id)
        if not org:
            return None
        
        if data.name is not None:
            org.name = data.name
        if data.description is not None:
            org.description = data.description
        if data.logo_url is not None:
            org.logo_url = data.logo_url
        if data.settings is not None:
            org.settings = {**org.settings, **data.settings}
        if data.is_active is not None:
            org.is_active = data.is_active
        
        await self.db.flush()
        return org
    
    async def delete_organization(self, org_id: UUID) -> bool:
        """Soft delete organization."""
        org = await self.get_organization(org_id)
        if not org:
            return False
        
        org.is_deleted = True
        await self.db.flush()
        return True
    
    async def list_organizations(
        self,
        skip: int = 0,
        limit: int = 100,
        search: Optional[str] = None,
    ) -> tuple[List[Organization], int]:
        """List all organizations (admin only)."""
        query = select(Organization).where(Organization.is_deleted == False)
        
        if search:
            query = query.where(
                or_(
                    Organization.name.ilike(f"%{search}%"),
                    Organization.slug.ilike(f"%{search}%"),
                )
            )
        
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_query)).scalar() or 0
        
        query = query.order_by(Organization.name).offset(skip).limit(limit)
        result = await self.db.execute(query)
        orgs = list(result.scalars().all())
        
        return orgs, total


class OrganizationMemberService:
    """Service for managing organization memberships."""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def add_member(
        self,
        org_id: UUID,
        data: OrganizationMemberCreate,
        invited_by: Optional[UUID] = None,
    ) -> OrganizationMember:
        """Add a member to an organization."""
        user_id = data.user_id
        
        if data.email and not user_id:
            from app.core.encryption import get_encryption_service
            result = await self.db.execute(
                select(User).where(
                    User.email_blind_index == get_encryption_service().blind_index(data.email)
                )
            )
            user = result.scalar_one_or_none()
            if not user:
                raise ValueError(f"User with email '{data.email}' not found")
            user_id = user.id
        
        if not user_id:
            raise ValueError("user_id or email is required")
        
        existing = await self.get_membership(org_id, user_id)
        if existing:
            raise ValueError("User is already a member of this organization")
        
        user_orgs = await self.get_user_organizations(user_id)
        is_first_org = len(user_orgs) == 0
        
        role_value = data.role.value if hasattr(data.role, 'value') else data.role
        
        membership = OrganizationMember(
            organization_id=org_id,
            user_id=user_id,
            role=role_value,
            is_default=is_first_org,
            invited_by=invited_by,
        )
        self.db.add(membership)
        await self.db.flush()
        
        return membership
    
    async def get_membership(
        self,
        org_id: UUID,
        user_id: UUID,
    ) -> Optional[OrganizationMember]:
        """Get a user's membership in an organization."""
        result = await self.db.execute(
            select(OrganizationMember)
            .where(
                OrganizationMember.organization_id == org_id,
                OrganizationMember.user_id == user_id,
            )
            .options(selectinload(OrganizationMember.user))
        )
        return result.scalar_one_or_none()
    
    async def update_membership(
        self,
        org_id: UUID,
        user_id: UUID,
        data: OrganizationMemberUpdate,
    ) -> Optional[OrganizationMember]:
        """Update organization membership."""
        membership = await self.get_membership(org_id, user_id)
        if not membership:
            return None
        
        if data.role is not None:
            membership.role = data.role.value if hasattr(data.role, 'value') else data.role
        
        if data.is_default is True:
            await self.db.execute(
                OrganizationMember.__table__.update()
                .where(
                    OrganizationMember.user_id == user_id,
                    OrganizationMember.organization_id != org_id,
                )
                .values(is_default=False)
            )
            membership.is_default = True
        
        await self.db.flush()
        return membership
    
    async def remove_member(
        self,
        org_id: UUID,
        user_id: UUID,
    ) -> bool:
        """Remove a member from an organization."""
        membership = await self.get_membership(org_id, user_id)
        if not membership:
            return False
        
        if membership.role == OrganizationRole.OWNER.value:
            owner_count = await self.db.execute(
                select(func.count())
                .select_from(OrganizationMember)
                .where(
                    OrganizationMember.organization_id == org_id,
                    OrganizationMember.role == OrganizationRole.OWNER.value,
                )
            )
            if owner_count.scalar() <= 1:
                raise ValueError("Cannot remove the last owner of an organization")
        
        await self.db.delete(membership)
        await self.db.flush()
        return True
    
    async def get_organization_members(
        self,
        org_id: UUID,
        skip: int = 0,
        limit: int = 100,
        role: Optional[str] = None,
    ) -> tuple[List[OrganizationMember], int]:
        """Get all members of an organization."""
        query = (
            select(OrganizationMember)
            .where(OrganizationMember.organization_id == org_id)
            .options(selectinload(OrganizationMember.user))
        )
        
        if role:
            query = query.where(OrganizationMember.role == role)
        
        count_query = select(func.count()).select_from(query.subquery())
        total = (await self.db.execute(count_query)).scalar() or 0
        
        query = query.order_by(OrganizationMember.joined_at).offset(skip).limit(limit)
        result = await self.db.execute(query)
        members = list(result.scalars().all())
        
        return members, total
    
    async def get_user_organizations(
        self,
        user_id: UUID,
    ) -> List[OrganizationMember]:
        """Get all organizations a user belongs to (excludes soft-deleted orgs)."""
        result = await self.db.execute(
            select(OrganizationMember)
            .join(Organization, OrganizationMember.organization_id == Organization.id)
            .where(
                OrganizationMember.user_id == user_id,
                Organization.is_deleted == False,
            )
            .options(
                selectinload(OrganizationMember.organization)
            )
            .order_by(OrganizationMember.is_default.desc(), OrganizationMember.joined_at)
        )
        return list(result.scalars().all())
    
    async def get_user_default_organization(
        self,
        user_id: UUID,
    ) -> Optional[Organization]:
        """Get user's default organization."""
        result = await self.db.execute(
            select(OrganizationMember)
            .where(
                OrganizationMember.user_id == user_id,
                OrganizationMember.is_default == True,
            )
            .options(selectinload(OrganizationMember.organization))
        )
        membership = result.scalar_one_or_none()
        return membership.organization if membership else None
    
    async def is_member(self, org_id: UUID, user_id: UUID) -> bool:
        """Check if user is a member of the organization."""
        membership = await self.get_membership(org_id, user_id)
        return membership is not None
    
    async def is_admin(self, org_id: UUID, user_id: UUID) -> bool:
        """Check if user is an admin (admin or owner) of the organization."""
        membership = await self.get_membership(org_id, user_id)
        if not membership:
            return False
        return membership.role in (OrganizationRole.OWNER.value, OrganizationRole.ADMIN.value)
    
    async def is_owner(self, org_id: UUID, user_id: UUID) -> bool:
        """Check if user is an owner of the organization."""
        membership = await self.get_membership(org_id, user_id)
        if not membership:
            return False
        return membership.role == OrganizationRole.OWNER.value


async def get_user_accessible_organization_ids(
    db: AsyncSession,
    user_id: UUID,
) -> List[UUID]:
    """
    Get list of organization IDs the user has access to (excludes soft-deleted orgs).
    Used for filtering queries by organization.
    """
    result = await db.execute(
        select(OrganizationMember.organization_id)
        .join(Organization, OrganizationMember.organization_id == Organization.id)
        .where(
            OrganizationMember.user_id == user_id,
            Organization.is_deleted == False,
        )
    )
    return [row[0] for row in result.all()]


async def filter_by_user_organizations(
    db: AsyncSession,
    user: User,
    base_query,
    org_id_column,
):
    """
    Add organization filter to a query based on user's memberships.
    Superusers can see all organizations.
    
    Usage:
        query = select(Campaign)
        query = await filter_by_user_organizations(db, user, query, Campaign.organization_id)
    """
    if user.is_superuser:
        return base_query
    
    org_ids = await get_user_accessible_organization_ids(db, user.id)
    return base_query.where(org_id_column.in_(org_ids))

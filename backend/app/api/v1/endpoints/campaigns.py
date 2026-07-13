"""
Campaign endpoints with RBAC protection.
"""
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status, Header
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import Campaign, Dataset, Scene, Task, User, Permission
from app.schemas.schemas import (
    CampaignCreate,
    CampaignUpdate,
    CampaignResponse,
    CampaignListResponse,
    CampaignStats,
)
from app.services.rbac_service import (
    get_current_user,
    RequirePermissions,
    PermissionDeniedError,
)
from app.services.organization_service import (
    OrganizationMemberService,
    get_user_accessible_organization_ids,
)

router = APIRouter()


async def compute_campaign_stats(db: AsyncSession, campaign_id: UUID) -> dict:
    """Compute real-time stats for a campaign."""
    dataset_count = await db.scalar(
        select(func.count()).where(
            Dataset.campaign_id == campaign_id,
            Dataset.is_deleted == False,
        )
    )
    
    scene_count = await db.scalar(
        select(func.count())
        .select_from(Scene)
        .join(Dataset, Scene.dataset_id == Dataset.id)
        .where(
            Dataset.campaign_id == campaign_id,
            Scene.is_deleted == False,
        )
    )
    
    task_count = await db.scalar(
        select(func.count())
        .select_from(Task)
        .join(Scene, Task.scene_id == Scene.id)
        .join(Dataset, Scene.dataset_id == Dataset.id)
        .where(
            Dataset.campaign_id == campaign_id,
            Task.is_deleted == False,
        )
    )
    
    completed_count = await db.scalar(
        select(func.count())
        .select_from(Task)
        .join(Scene, Task.scene_id == Scene.id)
        .join(Dataset, Scene.dataset_id == Dataset.id)
        .where(
            Dataset.campaign_id == campaign_id,
            Task.is_deleted == False,
            Task.status == "accepted",
        )
    )
    
    return {
        "total_datasets": dataset_count or 0,
        "total_scenes": scene_count or 0,
        "total_tasks": task_count or 0,
        "completed_tasks": completed_count or 0,
        "total_annotations": 0,
        "annotator_hours": 0.0,
    }


@router.post("", response_model=CampaignResponse, status_code=status.HTTP_201_CREATED)
async def create_campaign(
    campaign_in: CampaignCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.CAMPAIGNS_CREATE))],
    db: AsyncSession = Depends(get_db),
) -> Campaign:
    """Create a new campaign. Requires CAMPAIGNS_CREATE permission."""
    member_service = OrganizationMemberService(db)
    if not current_user.is_superuser:
        is_member = await member_service.is_member(campaign_in.organization_id, current_user.id)
        if not is_member:
            raise PermissionDeniedError("You are not a member of this organization")
    
    existing_campaign_query = select(Campaign).where(
        Campaign.organization_id == campaign_in.organization_id,
        Campaign.name == campaign_in.name,
        Campaign.is_deleted == False,
    )
    existing_result = await db.execute(existing_campaign_query)
    if existing_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A campaign with the name '{campaign_in.name}' already exists in this organization",
        )
    
    campaign = Campaign(
        organization_id=campaign_in.organization_id,
        name=campaign_in.name,
        description=campaign_in.description,
        config=campaign_in.config.model_dump(),
        custom_metadata=campaign_in.custom_metadata,
        stats={},
    )
    db.add(campaign)
    await db.flush()
    await db.refresh(campaign)
    return campaign


@router.get("", response_model=CampaignListResponse)
async def list_campaigns(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.CAMPAIGNS_READ, Permission.CAMPAIGNS_READ_ALL, require_all=False))],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    organization_id: Optional[UUID] = Query(None, description="Filter by organization"),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List campaigns with pagination. Filters by user's organizations unless superuser."""
    query = select(Campaign).where(Campaign.is_deleted == False)
    
    if current_user.is_superuser:
        if organization_id:
            query = query.where(Campaign.organization_id == organization_id)
    else:
        accessible_org_ids = await get_user_accessible_organization_ids(db, current_user.id)
        if organization_id:
            if organization_id not in accessible_org_ids:
                raise PermissionDeniedError("You do not have access to this organization")
            query = query.where(Campaign.organization_id == organization_id)
        else:
            query = query.where(Campaign.organization_id.in_(accessible_org_ids))
    
    if search:
        query = query.where(Campaign.name.ilike(f"%{search}%"))
    
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query)
    
    query = query.order_by(Campaign.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    campaigns = result.scalars().all()
    
    campaign_items = []
    for campaign in campaigns:
        stats = await compute_campaign_stats(db, campaign.id)
        campaign_items.append({
            "id": campaign.id,
            "organization_id": campaign.organization_id,
            "name": campaign.name,
            "description": campaign.description,
            "config": campaign.config,
            "custom_metadata": campaign.custom_metadata,
            "stats": stats,
            "created_at": campaign.created_at,
            "updated_at": campaign.updated_at,
        })
    
    return {
        "items": campaign_items,
        "total": total or 0,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{campaign_id}", response_model=CampaignResponse)
async def get_campaign(
    campaign_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.CAMPAIGNS_READ))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get a campaign by ID. Requires CAMPAIGNS_READ permission and organization membership."""
    query = select(Campaign).where(
        Campaign.id == campaign_id,
        Campaign.is_deleted == False,
    )
    result = await db.execute(query)
    campaign = result.scalar_one_or_none()
    
    if not campaign:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Campaign {campaign_id} not found",
        )
    
    if not current_user.is_superuser:
        member_service = OrganizationMemberService(db)
        is_member = await member_service.is_member(campaign.organization_id, current_user.id)
        if not is_member:
            raise PermissionDeniedError("You do not have access to this campaign's organization")
    
    stats = await compute_campaign_stats(db, campaign.id)
    return {
        "id": campaign.id,
        "organization_id": campaign.organization_id,
        "name": campaign.name,
        "description": campaign.description,
        "config": campaign.config,
        "custom_metadata": campaign.custom_metadata,
        "stats": stats,
        "created_at": campaign.created_at,
        "updated_at": campaign.updated_at,
    }


@router.patch("/{campaign_id}", response_model=CampaignResponse)
async def update_campaign(
    campaign_id: UUID,
    campaign_in: CampaignUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.CAMPAIGNS_UPDATE))],
    db: AsyncSession = Depends(get_db),
) -> Campaign:
    """Update a campaign. Requires CAMPAIGNS_UPDATE permission and organization membership."""
    query = select(Campaign).where(
        Campaign.id == campaign_id,
        Campaign.is_deleted == False,
    )
    result = await db.execute(query)
    campaign = result.scalar_one_or_none()
    
    if not campaign:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Campaign {campaign_id} not found",
        )
    
    if not current_user.is_superuser:
        member_service = OrganizationMemberService(db)
        is_member = await member_service.is_member(campaign.organization_id, current_user.id)
        if not is_member:
            raise PermissionDeniedError("You do not have access to this campaign's organization")
    
    update_data = campaign_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "config" and value is not None:
            value = value.model_dump() if hasattr(value, "model_dump") else value
        setattr(campaign, field, value)
    
    await db.flush()
    await db.refresh(campaign)
    return campaign


@router.delete("/{campaign_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_campaign(
    campaign_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.CAMPAIGNS_DELETE))],
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft delete a campaign. Requires CAMPAIGNS_DELETE permission and organization membership."""
    query = select(Campaign).where(
        Campaign.id == campaign_id,
        Campaign.is_deleted == False,
    )
    result = await db.execute(query)
    campaign = result.scalar_one_or_none()
    
    if not campaign:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Campaign {campaign_id} not found",
        )
    
    if not current_user.is_superuser:
        member_service = OrganizationMemberService(db)
        is_admin = await member_service.is_admin(campaign.organization_id, current_user.id)
        if not is_admin:
            raise PermissionDeniedError("Only organization admins can delete campaigns")
    
    campaign.is_deleted = True
    await db.flush()


@router.get("/{campaign_id}/stats", response_model=CampaignStats)
async def get_campaign_stats(
    campaign_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.CAMPAIGNS_READ))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get aggregated statistics for a campaign. Requires organization membership."""
    campaign_query = select(Campaign).where(
        Campaign.id == campaign_id,
        Campaign.is_deleted == False,
    )
    result = await db.execute(campaign_query)
    campaign = result.scalar_one_or_none()
    
    if not campaign:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Campaign {campaign_id} not found",
        )
    
    if not current_user.is_superuser:
        member_service = OrganizationMemberService(db)
        is_member = await member_service.is_member(campaign.organization_id, current_user.id)
        if not is_member:
            raise PermissionDeniedError("You do not have access to this campaign's organization")
    
    return await compute_campaign_stats(db, campaign_id)

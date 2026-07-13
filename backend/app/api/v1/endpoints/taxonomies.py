"""
Taxonomy endpoints with RBAC protection - CRUD operations for labeling requirement taxonomies.
"""
from typing import Annotated, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.models import Taxonomy, Dataset, dataset_taxonomy_association, User, Permission, TaxonomyAnnotationMode
from app.schemas.schemas import (
    TaxonomyCreate,
    TaxonomyUpdate,
    TaxonomyResponse,
    TaxonomyListResponse,
    TaxonomySummary,
    TaxonomyAnnotationMode as TaxonomyAnnotationModeSchema,
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


@router.post("", response_model=TaxonomyResponse, status_code=status.HTTP_201_CREATED)
async def create_taxonomy(
    taxonomy_in: TaxonomyCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TAXONOMIES_CREATE))],
    db: AsyncSession = Depends(get_db),
) -> Taxonomy:
    """Create a new taxonomy/labeling requirement. Requires TAXONOMIES_CREATE permission."""
    member_service = OrganizationMemberService(db)
    if not current_user.is_superuser:
        is_member = await member_service.is_member(taxonomy_in.organization_id, current_user.id)
        if not is_member:
            raise PermissionDeniedError("You are not a member of this organization")
    
    existing_taxonomy_query = select(Taxonomy).where(
        Taxonomy.organization_id == taxonomy_in.organization_id,
        Taxonomy.name == taxonomy_in.name,
        Taxonomy.is_deleted == False,
    )
    existing_result = await db.execute(existing_taxonomy_query)
    if existing_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A taxonomy with the name '{taxonomy_in.name}' already exists in this organization",
        )
    
    annotation_mode_value = taxonomy_in.annotation_mode.value if hasattr(taxonomy_in.annotation_mode, 'value') else taxonomy_in.annotation_mode
    taxonomy = Taxonomy(
        organization_id=taxonomy_in.organization_id,
        name=taxonomy_in.name,
        description=taxonomy_in.description,
        version=taxonomy_in.version,
        annotation_mode=annotation_mode_value,
        classes=[c.model_dump() for c in taxonomy_in.classes],
        skeletons={k: v.model_dump() for k, v in taxonomy_in.skeletons.items()},
        annotation_rules=taxonomy_in.annotation_rules.model_dump(),
        shared_attributes=[a.model_dump() for a in taxonomy_in.shared_attributes] if taxonomy_in.shared_attributes else [],
    )
    db.add(taxonomy)
    await db.flush()
    await db.refresh(taxonomy)
    return taxonomy


@router.get("", response_model=TaxonomyListResponse)
async def list_taxonomies(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TAXONOMIES_READ))],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    search: Optional[str] = None,
    organization_id: Optional[UUID] = Query(None, description="Filter by organization"),
    annotation_mode: Optional[TaxonomyAnnotationModeSchema] = Query(
        None, 
        description="Filter by annotation mode: fusion_3d or 2d_only"
    ),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """List taxonomies with pagination. Shows only organization-specific taxonomies."""
    query = select(Taxonomy).where(Taxonomy.is_deleted == False)
    
    if current_user.is_superuser:
        if organization_id:
            query = query.where(Taxonomy.organization_id == organization_id)
    else:
        accessible_org_ids = await get_user_accessible_organization_ids(db, current_user.id)
        if organization_id:
            if organization_id not in accessible_org_ids:
                raise PermissionDeniedError("You do not have access to this organization")
            query = query.where(Taxonomy.organization_id == organization_id)
        else:
            query = query.where(Taxonomy.organization_id.in_(accessible_org_ids))
    
    if search:
        query = query.where(Taxonomy.name.ilike(f"%{search}%"))
    
    if annotation_mode:
        mode_value = annotation_mode.value if hasattr(annotation_mode, 'value') else annotation_mode
        query = query.where(Taxonomy.annotation_mode == mode_value)
    
    count_query = select(func.count()).select_from(query.subquery())
    total = await db.scalar(count_query)
    
    query = query.order_by(Taxonomy.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    taxonomies = result.scalars().all()
    
    return {
        "items": taxonomies,
        "total": total or 0,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{taxonomy_id}", response_model=TaxonomyResponse)
async def get_taxonomy(
    taxonomy_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TAXONOMIES_READ))],
    db: AsyncSession = Depends(get_db),
) -> Taxonomy:
    """Get a taxonomy by ID. Requires TAXONOMIES_READ permission."""
    query = select(Taxonomy).where(
        Taxonomy.id == taxonomy_id,
        Taxonomy.is_deleted == False,
    )
    result = await db.execute(query)
    taxonomy = result.scalar_one_or_none()
    
    if not taxonomy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Taxonomy {taxonomy_id} not found",
        )
    
    return taxonomy


@router.patch("/{taxonomy_id}", response_model=TaxonomyResponse)
async def update_taxonomy(
    taxonomy_id: UUID,
    taxonomy_in: TaxonomyUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TAXONOMIES_UPDATE))],
    db: AsyncSession = Depends(get_db),
) -> Taxonomy:
    """Update a taxonomy. Requires TAXONOMIES_UPDATE permission."""
    query = select(Taxonomy).where(
        Taxonomy.id == taxonomy_id,
        Taxonomy.is_deleted == False,
    )
    result = await db.execute(query)
    taxonomy = result.scalar_one_or_none()
    
    if not taxonomy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Taxonomy {taxonomy_id} not found",
        )
    
    update_data = taxonomy_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if field == "classes" and value is not None:
            value = [c.model_dump() if hasattr(c, 'model_dump') else c for c in value]
        elif field == "skeletons" and value is not None:
            value = {k: v.model_dump() if hasattr(v, 'model_dump') else v for k, v in value.items()}
        elif field == "annotation_rules" and value is not None:
            value = value.model_dump() if hasattr(value, 'model_dump') else value
        elif field == "annotation_mode" and value is not None:
            value = value.value if hasattr(value, 'value') else value
        elif field == "shared_attributes" and value is not None:
            value = [a.model_dump() if hasattr(a, 'model_dump') else a for a in value]
        setattr(taxonomy, field, value)
    
    await db.flush()
    await db.refresh(taxonomy)
    return taxonomy


@router.delete("/{taxonomy_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_taxonomy(
    taxonomy_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TAXONOMIES_DELETE))],
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft delete a taxonomy. Requires TAXONOMIES_DELETE permission (Admin only)."""
    query = select(Taxonomy).where(
        Taxonomy.id == taxonomy_id,
        Taxonomy.is_deleted == False,
    )
    result = await db.execute(query)
    taxonomy = result.scalar_one_or_none()
    
    if not taxonomy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Taxonomy {taxonomy_id} not found",
        )
    
    taxonomy.is_deleted = True
    await db.flush()



@router.post("/{taxonomy_id}/datasets/{dataset_id}", status_code=status.HTTP_201_CREATED)
async def associate_taxonomy_with_dataset(
    taxonomy_id: UUID,
    dataset_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TAXONOMIES_UPDATE))],
    mode: Optional[TaxonomyAnnotationModeSchema] = Query(
        None,
        description="Override annotation mode for this association (defaults to taxonomy's mode)"
    ),
    is_primary: bool = Query(
        False,
        description="Set as primary taxonomy for this mode in the dataset"
    ),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Associate a taxonomy with a dataset. Requires TAXONOMIES_UPDATE permission."""
    tax_query = select(Taxonomy).where(Taxonomy.id == taxonomy_id, Taxonomy.is_deleted == False)
    tax_result = await db.execute(tax_query)
    taxonomy = tax_result.scalar_one_or_none()
    if not taxonomy:
        raise HTTPException(status_code=404, detail=f"Taxonomy {taxonomy_id} not found")
    
    ds_query = select(Dataset).where(Dataset.id == dataset_id, Dataset.is_deleted == False)
    ds_result = await db.execute(ds_query)
    dataset = ds_result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail=f"Dataset {dataset_id} not found")
    
    check_query = select(dataset_taxonomy_association).where(
        dataset_taxonomy_association.c.dataset_id == dataset_id,
        dataset_taxonomy_association.c.taxonomy_id == taxonomy_id,
    )
    existing = await db.execute(check_query)
    if existing.first():
        raise HTTPException(status_code=400, detail="Association already exists")
    
    effective_mode = mode.value if mode else taxonomy.annotation_mode
    
    if is_primary:
        await db.execute(
            dataset_taxonomy_association.update()
            .where(
                dataset_taxonomy_association.c.dataset_id == dataset_id,
                dataset_taxonomy_association.c.mode == effective_mode,
                dataset_taxonomy_association.c.is_primary == True,
            )
            .values(is_primary=False)
        )
    
    await db.execute(
        dataset_taxonomy_association.insert().values(
            dataset_id=dataset_id,
            taxonomy_id=taxonomy_id,
            mode=effective_mode,
            is_primary=is_primary,
        )
    )
    await db.flush()
    
    return {
        "message": "Taxonomy associated with dataset successfully",
        "mode": effective_mode,
        "is_primary": is_primary,
    }


@router.delete("/{taxonomy_id}/datasets/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_taxonomy_from_dataset(
    taxonomy_id: UUID,
    dataset_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TAXONOMIES_UPDATE))],
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a taxonomy association from a dataset. Requires TAXONOMIES_UPDATE permission."""
    await db.execute(
        dataset_taxonomy_association.delete().where(
            dataset_taxonomy_association.c.dataset_id == dataset_id,
            dataset_taxonomy_association.c.taxonomy_id == taxonomy_id,
        )
    )
    await db.flush()


@router.get("/{taxonomy_id}/datasets", response_model=List[dict])
async def get_datasets_using_taxonomy(
    taxonomy_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TAXONOMIES_READ))],
    db: AsyncSession = Depends(get_db),
) -> List[dict]:
    """Get all datasets using this taxonomy. Requires TAXONOMIES_READ permission."""
    query = (
        select(Dataset, dataset_taxonomy_association.c.mode, dataset_taxonomy_association.c.is_primary)
        .join(dataset_taxonomy_association)
        .where(
            dataset_taxonomy_association.c.taxonomy_id == taxonomy_id,
            Dataset.is_deleted == False,
        )
    )
    result = await db.execute(query)
    rows = result.all()
    
    return [
        {
            "id": str(ds.id),
            "name": ds.name,
            "description": ds.description,
            "campaign_id": str(ds.campaign_id),
            "mode": mode,
            "is_primary": is_primary,
        }
        for ds, mode, is_primary in rows
    ]



@router.get("/by-dataset/{dataset_id}", response_model=List[TaxonomyResponse])
async def get_taxonomies_for_dataset(
    dataset_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TAXONOMIES_READ))],
    annotation_mode: Optional[TaxonomyAnnotationModeSchema] = Query(
        None,
        description="Filter by annotation mode: fusion_3d or 2d_only"
    ),
    primary_only: bool = Query(
        False,
        description="Return only primary taxonomies"
    ),
    db: AsyncSession = Depends(get_db),
) -> List[Taxonomy]:
    """
    Get all taxonomies associated with a dataset.
    Optionally filter by annotation_mode to get only 3D/fusion or 2D-only taxonomies.
    """
    query = (
        select(Taxonomy)
        .join(dataset_taxonomy_association)
        .where(
            dataset_taxonomy_association.c.dataset_id == dataset_id,
            Taxonomy.is_deleted == False,
        )
    )
    
    if annotation_mode:
        mode_value = annotation_mode.value if hasattr(annotation_mode, 'value') else annotation_mode
        query = query.where(Taxonomy.annotation_mode == mode_value)
    
    if primary_only:
        query = query.where(dataset_taxonomy_association.c.is_primary == True)
    
    result = await db.execute(query)
    taxonomies = result.scalars().all()
    
    return taxonomies


@router.get("/by-dataset/{dataset_id}/primary", response_model=dict)
async def get_primary_taxonomies_for_dataset(
    dataset_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TAXONOMIES_READ))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Get the primary taxonomy for each mode (fusion_3d and 2d_only) for a dataset.
    Returns a dict with keys 'fusion_3d' and '2d_only', each containing the primary taxonomy or null.
    If no primary is set, returns the first taxonomy of that mode.
    """
    result = {
        "fusion_3d": None,
        "2d_only": None,
    }
    
    for mode in ["fusion_3d", "2d_only"]:
        query = (
            select(Taxonomy)
            .join(dataset_taxonomy_association)
            .where(
                dataset_taxonomy_association.c.dataset_id == dataset_id,
                Taxonomy.annotation_mode == mode,
                dataset_taxonomy_association.c.is_primary == True,
                Taxonomy.is_deleted == False,
            )
        )
        
        res = await db.execute(query)
        taxonomy = res.scalar_one_or_none()
        
        if not taxonomy:
            query = (
                select(Taxonomy)
                .join(dataset_taxonomy_association)
                .where(
                    dataset_taxonomy_association.c.dataset_id == dataset_id,
                    Taxonomy.annotation_mode == mode,
                    Taxonomy.is_deleted == False,
                )
                .limit(1)
            )
            res = await db.execute(query)
            taxonomy = res.scalar_one_or_none()
        
        if taxonomy:
            result[mode] = {
                "id": str(taxonomy.id),
                "name": taxonomy.name,
                "version": taxonomy.version,
                "annotation_mode": taxonomy.annotation_mode,
                "classes": taxonomy.classes,
                "skeletons": taxonomy.skeletons,
                "annotation_rules": taxonomy.annotation_rules,
                "shared_attributes": taxonomy.shared_attributes or [],
            }
    
    return result

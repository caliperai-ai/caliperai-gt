"""
Dataset endpoints with RBAC protection.
"""
from typing import Annotated, Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from asyncpg import Range as PgRange

from app.core.database import get_db
from app.models.models import Dataset, Campaign, Taxonomy, Scene, Task, TaskStatus, TaskStage, dataset_taxonomy_association, User, Permission
from app.schemas.schemas import (
    DatasetCreate,
    DatasetUpdate,
    DatasetResponse,
    DatasetDetailResponse,
    TaxonomyResponse,
    SceneResponse,
)
from app.services.rbac_service import (
    get_current_user,
    RequirePermissions,
)

router = APIRouter()


async def auto_create_tasks_for_scene(db: AsyncSession, scene: Scene) -> None:
    """Create one pending task per linked taxonomy for a newly created scene."""
    linked = await db.execute(
        select(dataset_taxonomy_association.c.taxonomy_id, Taxonomy.name).
        join(Taxonomy, Taxonomy.id == dataset_taxonomy_association.c.taxonomy_id).
        where(
            dataset_taxonomy_association.c.dataset_id == scene.dataset_id,
            Taxonomy.is_deleted == False,
        )
    )
    for row in linked.all():
        db.add(Task(
            scene_id=scene.id,
            taxonomy_id=row.taxonomy_id,
            name=f"{scene.name} - {row.name}",
            status=TaskStatus.PENDING.value,
            stage=TaskStage.ANNOTATION.value,
            frame_range=PgRange(0, scene.frame_count),
        ))


@router.post("", response_model=DatasetResponse, status_code=status.HTTP_201_CREATED)
async def create_dataset(
    dataset_in: DatasetCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_CREATE))],
    db: AsyncSession = Depends(get_db),
) -> Dataset:
    """Create a new dataset with taxonomy configuration. Requires DATASETS_CREATE permission."""
    campaign_query = select(Campaign).where(
        Campaign.id == dataset_in.campaign_id,
        Campaign.is_deleted == False,
    )
    result = await db.execute(campaign_query)
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Campaign {dataset_in.campaign_id} not found",
        )
    
    existing_dataset_query = select(Dataset).where(
        Dataset.campaign_id == dataset_in.campaign_id,
        Dataset.name == dataset_in.name,
        Dataset.is_deleted == False,
    )
    existing_result = await db.execute(existing_dataset_query)
    if existing_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A dataset with the name '{dataset_in.name}' already exists in this campaign",
        )
    
    dataset = Dataset(
        campaign_id=dataset_in.campaign_id,
        name=dataset_in.name,
        description=dataset_in.description,
        taxonomy=dataset_in.taxonomy.model_dump(),
        sensor_config=dataset_in.sensor_config.model_dump(),
    )
    db.add(dataset)
    await db.flush()
    await db.refresh(dataset)
    return dataset


@router.get("", response_model=list[DatasetResponse])
async def list_datasets(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_READ, Permission.DATASETS_READ_ALL, require_all=False))],
    campaign_id: Optional[UUID] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> list[Dataset]:
    """List datasets with optional campaign filter. Requires DATASETS_READ permission."""
    query = select(Dataset).where(Dataset.is_deleted == False)
    
    query = query.options(selectinload(Dataset.taxonomies))
    
    if campaign_id:
        query = query.where(Dataset.campaign_id == campaign_id)
    
    query = query.order_by(Dataset.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/{dataset_id}", response_model=DatasetResponse)
async def get_dataset(
    dataset_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_READ))],
    db: AsyncSession = Depends(get_db),
) -> Dataset:
    """Get a dataset by ID. Requires DATASETS_READ permission."""
    query = select(Dataset).where(
        Dataset.id == dataset_id,
        Dataset.is_deleted == False,
    ).options(selectinload(Dataset.taxonomies))
    result = await db.execute(query)
    dataset = result.scalar_one_or_none()
    
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found",
        )
    
    return dataset


@router.get("/{dataset_id}/detail", response_model=DatasetDetailResponse)
async def get_dataset_detail(
    dataset_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_READ))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Get dataset with all related data (scenes, taxonomies, stats) in a single call.
    This is optimized to reduce frontend API calls and improve loading performance.
    Requires DATASETS_READ permission.
    """
    query = select(Dataset).where(
        Dataset.id == dataset_id,
        Dataset.is_deleted == False,
    ).options(
        selectinload(Dataset.taxonomies),
        selectinload(Dataset.scenes).selectinload(Scene.tasks).selectinload(Task.taxonomy)
    )
    result = await db.execute(query)
    dataset = result.scalar_one_or_none()
    
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found",
        )
    
    active_scenes = [s for s in dataset.scenes if not s.is_deleted]
    for scene in active_scenes:
        scene.tasks = [t for t in scene.tasks if not t.is_deleted]
    
    total_frames = sum(s.frame_count for s in active_scenes)
    total_tasks = sum(len(s.tasks) for s in active_scenes)
    pending_tasks = sum(1 for s in active_scenes for t in s.tasks if t.status == 'pending')
    in_progress_tasks = sum(1 for s in active_scenes for t in s.tasks if t.status == 'in_progress')
    completed_tasks = sum(1 for s in active_scenes for t in s.tasks if t.status == 'completed')
    
    return {
        "id": dataset.id,
        "campaign_id": dataset.campaign_id,
        "name": dataset.name,
        "description": dataset.description,
        "taxonomy": dataset.taxonomy,
        "sensor_config": dataset.sensor_config,
        "custom_metadata": dataset.custom_metadata,
        "created_at": dataset.created_at,
        "updated_at": dataset.updated_at,
        "taxonomies": [t for t in dataset.taxonomies if not t.is_deleted],
        "scenes": active_scenes,
        "stats": {
            "scene_count": len(active_scenes),
            "total_frames": total_frames,
            "total_tasks": total_tasks,
            "pending_tasks": pending_tasks,
            "in_progress_tasks": in_progress_tasks,
            "completed_tasks": completed_tasks,
        }
    }


@router.patch("/{dataset_id}", response_model=DatasetResponse)
async def update_dataset(
    dataset_id: UUID,
    dataset_in: DatasetUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_UPDATE))],
    db: AsyncSession = Depends(get_db),
) -> Dataset:
    """Update a dataset. Requires DATASETS_UPDATE permission."""
    query = select(Dataset).where(
        Dataset.id == dataset_id,
        Dataset.is_deleted == False,
    )
    result = await db.execute(query)
    dataset = result.scalar_one_or_none()
    
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found",
        )
    
    update_data = dataset_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if value is not None:
            if hasattr(value, "model_dump"):
                value = value.model_dump()
            setattr(dataset, field, value)
    
    await db.flush()
    await db.refresh(dataset)
    return dataset


@router.delete("/{dataset_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_dataset(
    dataset_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_DELETE))],
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft delete a dataset. Requires DATASETS_DELETE permission (Admin only)."""
    query = select(Dataset).where(
        Dataset.id == dataset_id,
        Dataset.is_deleted == False,
    )
    result = await db.execute(query)
    dataset = result.scalar_one_or_none()
    
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found",
        )
    
    dataset.is_deleted = True
    await db.flush()


@router.get("/{dataset_id}/taxonomy")
async def get_taxonomy(
    dataset_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_READ))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get the taxonomy configuration for a dataset. Requires DATASETS_READ permission."""
    query = select(Dataset.taxonomy).where(
        Dataset.id == dataset_id,
        Dataset.is_deleted == False,
    )
    result = await db.execute(query)
    taxonomy = result.scalar_one_or_none()
    
    if taxonomy is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found",
        )
    
    return taxonomy



@router.get("/{dataset_id}/taxonomies", response_model=List[TaxonomyResponse])
async def get_dataset_taxonomies(
    dataset_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_READ))],
    db: AsyncSession = Depends(get_db),
) -> List[Taxonomy]:
    """Get all taxonomies associated with a dataset. Requires DATASETS_READ permission."""
    query = select(Dataset).options(
        selectinload(Dataset.taxonomies)
    ).where(
        Dataset.id == dataset_id,
        Dataset.is_deleted == False,
    )
    result = await db.execute(query)
    dataset = result.scalar_one_or_none()
    
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found",
        )
    
    return [t for t in dataset.taxonomies if not t.is_deleted]


@router.post("/{dataset_id}/taxonomies/{taxonomy_id}", status_code=status.HTTP_201_CREATED)
async def link_taxonomy_to_dataset(
    dataset_id: UUID,
    taxonomy_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_UPDATE))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Associate a taxonomy with a dataset. Requires DATASETS_UPDATE permission."""
    dataset_query = select(Dataset).where(
        Dataset.id == dataset_id,
        Dataset.is_deleted == False,
    )
    result = await db.execute(dataset_query)
    dataset = result.scalar_one_or_none()
    
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found",
        )
    
    taxonomy_query = select(Taxonomy).where(
        Taxonomy.id == taxonomy_id,
        Taxonomy.is_deleted == False,
    )
    result = await db.execute(taxonomy_query)
    taxonomy = result.scalar_one_or_none()
    
    if not taxonomy:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Taxonomy {taxonomy_id} not found",
        )
    
    check_query = select(dataset_taxonomy_association).where(
        dataset_taxonomy_association.c.dataset_id == dataset_id,
        dataset_taxonomy_association.c.taxonomy_id == taxonomy_id,
    )
    result = await db.execute(check_query)
    if result.first():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Taxonomy is already associated with this dataset",
        )
    
    effective_mode = taxonomy.annotation_mode
    
    primary_check = select(dataset_taxonomy_association).where(
        dataset_taxonomy_association.c.dataset_id == dataset_id,
        dataset_taxonomy_association.c.mode == effective_mode,
        dataset_taxonomy_association.c.is_primary == True,
    )
    primary_result = await db.execute(primary_check)
    has_existing_primary = primary_result.first() is not None
    
    is_primary = not has_existing_primary
    
    await db.execute(
        dataset_taxonomy_association.insert().values(
            dataset_id=dataset_id,
            taxonomy_id=taxonomy_id,
            mode=effective_mode,
            is_primary=is_primary,
        )
    )
    
    current_taxonomy = dataset.taxonomy or {}
    current_classes = current_taxonomy.get("classes", [])
    
    if not current_classes and taxonomy.classes:
        dataset.taxonomy = {
            "classes": taxonomy.classes if isinstance(taxonomy.classes, list) else [],
            "skeletons": current_taxonomy.get("skeletons", {}),
            "annotation_rules": current_taxonomy.get("annotation_rules", {}),
        }
    
    await db.flush()

    scenes_result = await db.execute(
        select(Scene).where(
            Scene.dataset_id == dataset_id,
            Scene.is_deleted == False,
        )
    )
    scenes = scenes_result.scalars().all()
    for scene in scenes:
        frame_range = PgRange(0, scene.frame_count)
        task = Task(
            scene_id=scene.id,
            taxonomy_id=taxonomy_id,
            name=f"{scene.name} - {taxonomy.name}",
            status=TaskStatus.PENDING.value,
            stage=TaskStage.ANNOTATION.value,
            frame_range=frame_range,
        )
        db.add(task)

    await db.flush()

    return {"message": "Taxonomy linked successfully", "dataset_id": str(dataset_id), "taxonomy_id": str(taxonomy_id)}


@router.post("/{dataset_id}/taxonomies/{taxonomy_id}/create-tasks", status_code=status.HTTP_200_OK)
async def create_tasks_for_taxonomy(
    dataset_id: UUID,
    taxonomy_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.TASKS_CREATE))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create tasks for all scenes that don't already have one for this taxonomy."""
    dataset_result = await db.execute(select(Dataset).where(Dataset.id == dataset_id, Dataset.is_deleted == False))
    dataset = dataset_result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Dataset {dataset_id} not found")

    taxonomy_result = await db.execute(select(Taxonomy).where(Taxonomy.id == taxonomy_id, Taxonomy.is_deleted == False))
    taxonomy = taxonomy_result.scalar_one_or_none()
    if not taxonomy:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Taxonomy {taxonomy_id} not found")

    scenes_result = await db.execute(
        select(Scene).where(Scene.dataset_id == dataset_id, Scene.is_deleted == False)
    )
    scenes = scenes_result.scalars().all()

    existing_result = await db.execute(
        select(Task.scene_id).where(
            Task.taxonomy_id == taxonomy_id,
            Task.scene_id.in_([s.id for s in scenes]),
            Task.is_deleted == False,
        )
    )
    existing_scene_ids = {row[0] for row in existing_result.all()}

    created = 0
    for scene in scenes:
        if scene.id in existing_scene_ids:
            continue
        db.add(Task(
            scene_id=scene.id,
            taxonomy_id=taxonomy_id,
            name=f"{scene.name} - {taxonomy.name}",
            status=TaskStatus.PENDING.value,
            stage=TaskStage.ANNOTATION.value,
            frame_range=PgRange(0, scene.frame_count),
        ))
        created += 1

    await db.flush()
    return {"created": created, "skipped": len(scenes) - created}


@router.delete("/{dataset_id}/taxonomies/{taxonomy_id}", status_code=status.HTTP_204_NO_CONTENT)
async def unlink_taxonomy_from_dataset(
    dataset_id: UUID,
    taxonomy_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_UPDATE))],
    db: AsyncSession = Depends(get_db),
) -> None:
    """Remove a taxonomy association from a dataset. Requires DATASETS_UPDATE permission."""
    dataset_query = select(Dataset).where(
        Dataset.id == dataset_id,
        Dataset.is_deleted == False,
    )
    result = await db.execute(dataset_query)
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found",
        )

    scene_id_subq = select(Scene.id).where(
        Scene.dataset_id == dataset_id,
        Scene.is_deleted == False,
    ).scalar_subquery()
    await db.execute(
        delete(Task).where(
            Task.scene_id.in_(scene_id_subq),
            Task.taxonomy_id == taxonomy_id,
        )
    )

    await db.execute(
        delete(dataset_taxonomy_association).where(
            dataset_taxonomy_association.c.dataset_id == dataset_id,
            dataset_taxonomy_association.c.taxonomy_id == taxonomy_id,
        )
    )
    await db.flush()


@router.delete("/{dataset_id}/default-taxonomy", status_code=status.HTTP_200_OK)
async def clear_default_taxonomy(
    dataset_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_UPDATE))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Clear the default embedded taxonomy from a dataset. Requires DATASETS_UPDATE permission."""
    query = select(Dataset).where(
        Dataset.id == dataset_id,
        Dataset.is_deleted == False,
    )
    result = await db.execute(query)
    dataset = result.scalar_one_or_none()
    
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found",
        )
    
    dataset.taxonomy = {"classes": [], "skeletons": {}, "annotation_rules": {}}
    await db.flush()
    
    return {"message": "Default taxonomy cleared", "dataset_id": str(dataset_id)}


@router.post("/{dataset_id}/create-variants", status_code=status.HTTP_201_CREATED)
async def create_dataset_variants_from_taxonomies(
    dataset_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_CREATE))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """
    Create separate dataset variants from linked taxonomies.
    For each linked taxonomy, creates a new dataset with the same name but that taxonomy's classes.
    Returns list of created dataset IDs.
    Requires DATASETS_CREATE permission.
    """
    query = select(Dataset).options(
        selectinload(Dataset.taxonomies)
    ).where(
        Dataset.id == dataset_id,
        Dataset.is_deleted == False,
    )
    result = await db.execute(query)
    dataset = result.scalar_one_or_none()
    
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found",
        )
    
    linked_taxonomies = [t for t in dataset.taxonomies if not t.is_deleted]
    
    if not linked_taxonomies:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No taxonomies linked to this dataset",
        )
    
    created_datasets = []
    skipped_datasets = []
    
    for taxonomy in linked_taxonomies:
        variant_name = f"{dataset.name} ({taxonomy.name})"
        
        existing_check = select(Dataset).where(
            Dataset.campaign_id == dataset.campaign_id,
            Dataset.name == variant_name,
            Dataset.is_deleted == False,
        )
        existing_result = await db.execute(existing_check)
        if existing_result.scalar_one_or_none():
            skipped_datasets.append({
                "name": variant_name,
                "taxonomy_name": taxonomy.name,
                "reason": "A dataset with this name already exists",
            })
            continue
        
        new_dataset = Dataset(
            campaign_id=dataset.campaign_id,
            name=variant_name,
            description=f"{dataset.description or ''}\n\nVariant created with taxonomy: {taxonomy.name} v{taxonomy.version}".strip(),
            taxonomy={
                "classes": taxonomy.classes if isinstance(taxonomy.classes, list) else [],
                "skeletons": {},
                "annotation_rules": {},
            },
            sensor_config=dataset.sensor_config,
        )
        db.add(new_dataset)
        await db.flush()
        await db.refresh(new_dataset)
        
        await db.execute(
            dataset_taxonomy_association.insert().values(
                dataset_id=new_dataset.id,
                taxonomy_id=taxonomy.id,
            )
        )
        
        created_datasets.append({
            "id": str(new_dataset.id),
            "name": new_dataset.name,
            "taxonomy_id": str(taxonomy.id),
            "taxonomy_name": taxonomy.name,
        })
    
    await db.flush()
    
    message = f"Created {len(created_datasets)} dataset variants"
    if skipped_datasets:
        message += f", skipped {len(skipped_datasets)} (duplicate names)"
    
    return {
        "message": message,
        "original_dataset_id": str(dataset_id),
        "created_datasets": created_datasets,
        "skipped_datasets": skipped_datasets,
    }

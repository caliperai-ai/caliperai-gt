"""
Scene endpoints with RBAC protection.
"""
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.models.models import Scene, Dataset, User, Permission
from app.api.v1.endpoints.datasets import auto_create_tasks_for_scene
from app.schemas.schemas import (
    SceneCreate,
    SceneUpdate,
    SceneResponse,
)
from app.services.rbac_service import (
    get_current_user,
    RequirePermissions,
)

router = APIRouter()


@router.post("", response_model=SceneResponse, status_code=status.HTTP_201_CREATED)
async def create_scene(
    scene_in: SceneCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.SCENES_CREATE))],
    db: AsyncSession = Depends(get_db),
) -> Scene:
    """Create a new scene with calibration matrices. Requires SCENES_CREATE permission."""
    dataset_query = select(Dataset).where(
        Dataset.id == scene_in.dataset_id,
        Dataset.is_deleted == False,
    )
    result = await db.execute(dataset_query)
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {scene_in.dataset_id} not found",
        )
    
    existing_scene_query = select(Scene).where(
        Scene.dataset_id == scene_in.dataset_id,
        Scene.name == scene_in.name,
        Scene.is_deleted == False,
    )
    existing_result = await db.execute(existing_scene_query)
    if existing_result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"A scene with the name '{scene_in.name}' already exists in this dataset",
        )
    
    scene = Scene(
        dataset_id=scene_in.dataset_id,
        name=scene_in.name,
        description=scene_in.description,
        scene_metadata=scene_in.scene_metadata.model_dump(),
        frame_count=scene_in.frame_count,
        fps=scene_in.fps,
        calibration=scene_in.calibration.model_dump(),
        storage_paths=scene_in.storage_paths.model_dump(),
    )
    db.add(scene)
    await db.flush()
    await auto_create_tasks_for_scene(db, scene)
    await db.flush()
    await db.refresh(scene)
    return scene


@router.get("", response_model=list[SceneResponse])
async def list_scenes(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.SCENES_READ, Permission.SCENES_READ_ALL, require_all=False))],
    dataset_id: Optional[UUID] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
) -> list[Scene]:
    """List scenes with optional dataset filter. Requires SCENES_READ permission."""
    query = select(Scene).where(Scene.is_deleted == False)
    query = query.options(selectinload(Scene.tasks))
    
    if dataset_id:
        query = query.where(Scene.dataset_id == dataset_id)
    
    query = query.order_by(Scene.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/{scene_id}", response_model=SceneResponse)
async def get_scene(
    scene_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.SCENES_READ))],
    db: AsyncSession = Depends(get_db),
) -> Scene:
    """Get a scene by ID. Requires SCENES_READ permission."""
    query = select(Scene).where(
        Scene.id == scene_id,
        Scene.is_deleted == False,
    )
    query = query.options(selectinload(Scene.tasks))
    result = await db.execute(query)
    scene = result.scalar_one_or_none()
    
    if not scene:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scene {scene_id} not found",
        )
    
    return scene


@router.get("/{scene_id}/calibration")
async def get_calibration(
    scene_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.SCENES_READ))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Get calibration matrices for a scene. Requires SCENES_READ permission."""
    query = select(Scene.calibration).where(
        Scene.id == scene_id,
        Scene.is_deleted == False,
    )
    result = await db.execute(query)
    calibration = result.scalar_one_or_none()
    
    if calibration is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scene {scene_id} not found",
        )
    
    return calibration


@router.patch("/{scene_id}", response_model=SceneResponse)
async def update_scene(
    scene_id: UUID,
    scene_in: SceneUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.SCENES_UPDATE))],
    db: AsyncSession = Depends(get_db),
) -> Scene:
    """Update a scene. Requires SCENES_UPDATE permission."""
    query = select(Scene).where(
        Scene.id == scene_id,
        Scene.is_deleted == False,
    ).options(selectinload(Scene.tasks))
    result = await db.execute(query)
    scene = result.scalar_one_or_none()
    
    if not scene:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scene {scene_id} not found",
        )
    
    update_data = scene_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        if value is not None or field == 'selected_taxonomy_id':
            if hasattr(value, "model_dump"):
                value = value.model_dump()
            setattr(scene, field, value)
    
    await db.flush()
    
    query = select(Scene).where(Scene.id == scene_id).options(selectinload(Scene.tasks))
    result = await db.execute(query)
    scene = result.scalar_one()
    
    return scene


@router.delete("/{scene_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scene(
    scene_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.SCENES_DELETE))],
    db: AsyncSession = Depends(get_db),
) -> None:
    """Soft delete a scene. Requires SCENES_DELETE permission (Admin only)."""
    query = select(Scene).where(
        Scene.id == scene_id,
        Scene.is_deleted == False,
    )
    result = await db.execute(query)
    scene = result.scalar_one_or_none()
    
    if not scene:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scene {scene_id} not found",
        )
    
    scene.is_deleted = True
    await db.flush()

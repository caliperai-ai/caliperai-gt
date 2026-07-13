"""
Frame endpoints with RBAC protection.
"""
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import Frame, Scene, User, Permission
from app.schemas.schemas import (
    FrameCreate,
    FrameResponse,
)
from app.services.rbac_service import (
    get_current_user,
    RequirePermissions,
)

router = APIRouter()


@router.post("", response_model=FrameResponse, status_code=status.HTTP_201_CREATED)
async def create_frame(
    frame_in: FrameCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.SCENES_CREATE))],
    db: AsyncSession = Depends(get_db),
) -> Frame:
    """Create a new frame. Requires SCENES_CREATE permission."""
    scene_query = select(Scene).where(
        Scene.id == frame_in.scene_id,
        Scene.is_deleted == False,
    )
    result = await db.execute(scene_query)
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scene {frame_in.scene_id} not found",
        )
    
    frame = Frame(
        scene_id=frame_in.scene_id,
        frame_index=frame_in.frame_index,
        timestamp=frame_in.timestamp,
        ego_pose=frame_in.ego_pose.model_dump() if frame_in.ego_pose else None,
        file_paths=frame_in.file_paths.model_dump(),
    )
    db.add(frame)
    await db.flush()
    await db.refresh(frame)
    return frame


@router.get("", response_model=list[FrameResponse])
async def create_frames_bulk(
    scene_id: UUID,
    frames: list[FrameCreate],
    current_user: Annotated[User, Depends(RequirePermissions(Permission.SCENES_CREATE))],
    db: AsyncSession = Depends(get_db),
) -> list[Frame]:
    """Create multiple frames for a scene. Requires SCENES_CREATE permission."""
    scene_query = select(Scene).where(
        Scene.id == scene_id,
        Scene.is_deleted == False,
    )
    result = await db.execute(scene_query)
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scene {scene_id} not found",
        )
    
    created_frames = []
    for frame_in in frames:
        frame = Frame(
            scene_id=scene_id,
            frame_index=frame_in.frame_index,
            timestamp=frame_in.timestamp,
            ego_pose=frame_in.ego_pose.model_dump() if frame_in.ego_pose else None,
            file_paths=frame_in.file_paths.model_dump(),
        )
        db.add(frame)
        created_frames.append(frame)
    
    await db.flush()
    for frame in created_frames:
        await db.refresh(frame)
    
    return created_frames


@router.get("", response_model=list[FrameResponse])
async def list_frames(
    scene_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.SCENES_READ))],
    start_index: Optional[int] = None,
    end_index: Optional[int] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
) -> list[Frame]:
    """List frames for a scene with optional range filter. Requires SCENES_READ permission."""
    query = select(Frame).where(Frame.scene_id == scene_id)
    
    if start_index is not None:
        query = query.where(Frame.frame_index >= start_index)
    if end_index is not None:
        query = query.where(Frame.frame_index <= end_index)
    
    query = query.order_by(Frame.frame_index)
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/{frame_id}", response_model=FrameResponse)
async def get_frame(
    frame_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.SCENES_READ))],
    db: AsyncSession = Depends(get_db),
) -> Frame:
    """Get a frame by ID. Requires SCENES_READ permission."""
    query = select(Frame).where(Frame.id == frame_id)
    result = await db.execute(query)
    frame = result.scalar_one_or_none()
    
    if not frame:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Frame {frame_id} not found",
        )
    
    return frame

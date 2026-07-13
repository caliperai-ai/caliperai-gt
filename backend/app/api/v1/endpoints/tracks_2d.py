"""
Track 2D endpoints - For tracking objects across video frames.

Tracks represent persistent object identities across multiple frames.
Each annotation can be linked to a track via track_id.
"""
from datetime import datetime
from typing import Annotated, List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, and_, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import Track2D, Annotation2D, Task, User, Permission
from app.schemas.schemas import (
    Track2DCreate,
    Track2DUpdate,
    Track2DResponse,
    BulkTrack2DCreate,
)
from app.services.rbac_service import RequirePermissions

router = APIRouter(prefix="/tracks-2d", tags=["tracks-2d"])


@router.post("", response_model=Track2DResponse, status_code=status.HTTP_201_CREATED)
async def create_track_2d(
    track: Track2DCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Create a new 2D track. Requires ANNOTATIONS_CREATE permission."""
    task = await db.get(Task, track.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    track_id = track.id if track.id else uuid4()

    track_name = track.name or f"{track.class_id}_{track_id}"

    db_track = Track2D(
        id=track_id,
        task_id=track.task_id,
        camera_id=track.camera_id,
        class_id=track.class_id,
        name=track_name,
        color=track.color,
        start_frame_index=track.start_frame_index,
        end_frame_index=track.end_frame_index,
        is_interpolated=track.is_interpolated,
        is_complete=track.is_complete,
        attributes=track.attributes,
    )
    
    db.add(db_track)
    await db.commit()
    await db.refresh(db_track)
    
    return db_track


@router.get("", response_model=List[Track2DResponse])
async def list_tracks_2d(
    task_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    camera_id: Optional[str] = Query(None, description="Camera ID to filter by"),
    class_id: Optional[str] = Query(None, description="Class ID to filter by"),
    db: AsyncSession = Depends(get_db),
):
    """List 2D tracks for a task. Requires ANNOTATIONS_READ permission."""
    query = select(Track2D).where(Track2D.task_id == task_id)
    
    if camera_id:
        query = query.where(
            or_(Track2D.camera_id == camera_id, Track2D.camera_id == "default")
        )
    if class_id:
        query = query.where(Track2D.class_id == class_id)
    
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{track_id}", response_model=Track2DResponse)
async def get_track_2d(
    track_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    db: AsyncSession = Depends(get_db),
):
    """Get a single 2D track. Requires ANNOTATIONS_READ permission."""
    track = await db.get(Track2D, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    return track


@router.get("/{track_id}/annotations", response_model=List[dict])
async def get_track_annotations(
    track_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    db: AsyncSession = Depends(get_db),
):
    """Get all annotations for a track, ordered by frame. Requires ANNOTATIONS_READ permission."""
    track = await db.get(Track2D, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    
    query = select(Annotation2D).where(Annotation2D.track_id == track_id)
    result = await db.execute(query)
    annotations = result.scalars().all()
    
    return [
        {
            "id": str(ann.id),
            "frame_id": str(ann.frame_id),
            "camera_id": ann.camera_id,
            "type": ann.type,
            "class_id": ann.class_id,
            "data": ann.data,
            "attributes": ann.attributes,
        }
        for ann in annotations
    ]


@router.put("/{track_id}", response_model=Track2DResponse)
async def update_track_2d(
    track_id: UUID,
    update: Track2DUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
):
    """Update a 2D track. Requires ANNOTATIONS_UPDATE permission."""
    track = await db.get(Track2D, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    
    update_data = update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(track, key, value)
    
    await db.commit()
    await db.refresh(track)
    
    return track


@router.delete("/{track_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_track_2d(
    track_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_DELETE))],
    db: AsyncSession = Depends(get_db),
):
    """Delete a 2D track (also removes track_id from linked annotations). Requires ANNOTATIONS_DELETE permission."""
    track = await db.get(Track2D, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    
    query = select(Annotation2D).where(Annotation2D.track_id == track_id)
    result = await db.execute(query)
    for ann in result.scalars():
        ann.track_id = None
    
    await db.delete(track)
    await db.commit()


@router.post("/bulk", response_model=List[Track2DResponse], status_code=status.HTTP_201_CREATED)
async def create_tracks_2d_bulk(
    bulk_in: BulkTrack2DCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk create 2D tracks. Requires ANNOTATIONS_CREATE permission."""
    created = []
    
    for track in bulk_in.tracks:
        track_id = track.id if track.id else uuid4()
        
        db_track = Track2D(
            id=track_id,
            task_id=track.task_id,
            camera_id=track.camera_id,
            class_id=track.class_id,
            name=track.name,
            color=track.color,
            start_frame_index=track.start_frame_index,
            end_frame_index=track.end_frame_index,
            is_interpolated=track.is_interpolated,
            is_complete=track.is_complete,
            attributes=track.attributes,
        )
        
        db.add(db_track)
        created.append(db_track)
    
    await db.commit()
    for t in created:
        await db.refresh(t)
    
    return created


@router.post("/{track_id}/merge", response_model=Track2DResponse, status_code=status.HTTP_200_OK)
async def merge_tracks(
    track_id: UUID,
    source_track_ids: List[UUID],
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
):
    """Merge multiple source tracks into a target track.
    
    All annotations from source tracks are reassigned to the target track.
    Source tracks are deleted after merge. Frame range on target is updated.
    Requires ANNOTATIONS_UPDATE permission.
    """
    target = await db.get(Track2D, track_id)
    if not target:
        raise HTTPException(status_code=404, detail="Target track not found")

    occupied_q = select(Annotation2D.frame_id).where(Annotation2D.track_id == track_id)
    occupied_frames = set((await db.execute(occupied_q)).scalars().all())

    merged_count = 0
    dropped_count = 0
    for src_id in source_track_ids:
        if src_id == track_id:
            continue
        src_track = await db.get(Track2D, src_id)
        if not src_track:
            continue

        query = select(Annotation2D).where(Annotation2D.track_id == src_id)
        result = await db.execute(query)
        for ann in result.scalars():
            if ann.frame_id in occupied_frames:
                await db.delete(ann)
                dropped_count += 1
            else:
                ann.track_id = track_id
                occupied_frames.add(ann.frame_id)
                merged_count += 1

        await db.delete(src_track)

    all_ann_query = select(Annotation2D).where(Annotation2D.track_id == track_id)
    all_result = await db.execute(all_ann_query)
    all_anns = all_result.scalars().all()
    if all_anns:
        frame_indices = [a.data.get("frame_index", 0) if isinstance(a.data, dict) else 0 for a in all_anns]
        target.start_frame_index = min(frame_indices) if any(frame_indices) else target.start_frame_index
        target.end_frame_index = max(frame_indices) if any(frame_indices) else target.end_frame_index

    await db.commit()
    await db.refresh(target)

    return target


@router.post("/{track_id}/assign-annotations", status_code=status.HTTP_200_OK)
async def assign_annotations_to_track(
    track_id: UUID,
    annotation_ids: List[UUID],
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
):
    """Assign multiple annotations to a track. Requires ANNOTATIONS_UPDATE permission."""
    track = await db.get(Track2D, track_id)
    if not track:
        raise HTTPException(status_code=404, detail="Track not found")
    
    updated_count = 0
    for ann_id in annotation_ids:
        ann = await db.get(Annotation2D, ann_id)
        if ann:
            ann.track_id = track_id
            updated_count += 1
    
    await db.commit()
    
    return {"track_id": str(track_id), "updated_count": updated_count}

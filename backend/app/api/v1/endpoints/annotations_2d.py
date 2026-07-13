"""
2D Annotation endpoints - Camera-only annotations.

These store annotations that are camera-specific (2D bounding boxes, polygons, etc.)
without any 3D LiDAR component.
"""
from datetime import datetime
from typing import Annotated, List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import Annotation2D, Task, Frame, User, Permission, TaskStatus
from app.schemas.schemas import (
    Annotation2DCreate,
    Annotation2DUpdate,
    Annotation2DResponse,
    BulkAnnotation2DCreate,
    BulkAnnotation2DUpdate,
    BulkAnnotation2DDelete,
    BulkOperationResponse,
    TrackWideUpdate2D,
)
from app.services.rbac_service import RequirePermissions
from app.services.workflow_service import WorkflowService, WorkflowError
from app.services.achievement_service import check_achievements_for_user
from datetime import datetime

router = APIRouter(prefix="/annotations-2d", tags=["annotations-2d"])


async def auto_transition_to_in_progress(db: AsyncSession, task: Task, user_id: UUID, taxonomy_id: Optional[UUID] = None) -> None:
    """Auto-transition task to in_progress when first annotation is created."""
    workflow = WorkflowService(db)

    if task.status in [TaskStatus.PENDING.value, TaskStatus.ASSIGNED.value]:
        try:
            await workflow.start_work(task, changed_by_id=user_id)
        except WorkflowError:
            pass


@router.post("/", response_model=Annotation2DResponse, status_code=status.HTTP_201_CREATED)
async def create_annotation_2d(
    annotation: Annotation2DCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Create a new 2D annotation. Requires ANNOTATIONS_CREATE permission."""
    task = await db.get(Task, annotation.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    frame = await db.get(Frame, annotation.frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame not found")
    
    await auto_transition_to_in_progress(db, task, current_user.id, annotation.taxonomy_id)
    
    annotation_id = annotation.id if annotation.id else uuid4()
    
    db_annotation = Annotation2D(
        id=annotation_id,
        task_id=annotation.task_id,
        frame_id=annotation.frame_id,
        camera_id=annotation.camera_id,
        track_id=annotation.track_id,
        type=annotation.type,
        class_id=annotation.class_id,
        taxonomy_id=annotation.taxonomy_id,
        data=annotation.data,
        attributes=annotation.attributes,
        source=annotation.source,
        is_verified=annotation.source == "manual_2d",
    )
    
    db.add(db_annotation)
    await db.commit()
    await db.refresh(db_annotation)
    
    await check_achievements_for_user(db, current_user.id)
    
    return db_annotation


@router.get("", response_model=List[Annotation2DResponse])
async def list_annotations_2d(
    task_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    frame_id: Optional[UUID] = Query(None, description="Frame ID to filter by"),
    camera_id: Optional[str] = Query(None, description="Camera ID to filter by"),
    track_id: Optional[UUID] = Query(None, description="Track ID to filter by"),
    taxonomy_id: Optional[UUID] = Query(None, description="Taxonomy ID to filter by"),
    type: Optional[str] = Query(None, description="Annotation type to filter by"),
    db: AsyncSession = Depends(get_db),
):
    """List 2D annotations for a task. Requires ANNOTATIONS_READ permission."""
    query = select(Annotation2D).where(Annotation2D.task_id == task_id)
    
    if frame_id:
        query = query.where(Annotation2D.frame_id == frame_id)
    if camera_id:
        query = query.where(Annotation2D.camera_id == camera_id)
    if track_id:
        query = query.where(Annotation2D.track_id == track_id)
    if taxonomy_id:
        query = query.where(Annotation2D.taxonomy_id == taxonomy_id)
    if type:
        query = query.where(Annotation2D.type == type)
    
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{annotation_id}", response_model=Annotation2DResponse)
async def get_annotation_2d(
    annotation_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    db: AsyncSession = Depends(get_db),
):
    """Get a single 2D annotation. Requires ANNOTATIONS_READ permission."""
    annotation = await db.get(Annotation2D, annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail="2D Annotation not found")
    return annotation


@router.put("/{annotation_id}", response_model=Annotation2DResponse)
async def update_annotation_2d(
    annotation_id: UUID,
    update: Annotation2DUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
):
    """Update a 2D annotation. Requires ANNOTATIONS_UPDATE permission."""
    annotation = await db.get(Annotation2D, annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail="2D Annotation not found")
    
    update_data = update.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(annotation, key, value)
    
    await db.commit()
    await db.refresh(annotation)
    
    return annotation


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation_2d(
    annotation_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_DELETE))],
    db: AsyncSession = Depends(get_db),
):
    """Delete a 2D annotation. Requires ANNOTATIONS_DELETE permission."""
    annotation = await db.get(Annotation2D, annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail="2D Annotation not found")
    
    await db.delete(annotation)
    await db.commit()


@router.post("/bulk", response_model=List[Annotation2DResponse], status_code=status.HTTP_201_CREATED)
async def create_annotations_2d_bulk(
    bulk_in: BulkAnnotation2DCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk create or update 2D annotations (upsert). Requires ANNOTATIONS_CREATE permission."""
    results = []
    
    transitioned_combinations: set = set()
    
    for annotation in bulk_in.annotations:
        annotation_id = annotation.id if annotation.id else uuid4()
        
        transition_key = (annotation.task_id, annotation.taxonomy_id)
        if transition_key not in transitioned_combinations:
            task = await db.get(Task, annotation.task_id)
            if task:
                await auto_transition_to_in_progress(db, task, current_user.id, annotation.taxonomy_id)
                transitioned_combinations.add(transition_key)
        
        existing = await db.get(Annotation2D, annotation_id)
        
        if existing:
            existing.frame_id = annotation.frame_id
            existing.camera_id = annotation.camera_id
            existing.track_id = annotation.track_id
            existing.type = annotation.type
            existing.class_id = annotation.class_id
            existing.taxonomy_id = annotation.taxonomy_id
            existing.data = annotation.data
            existing.attributes = annotation.attributes
            existing.source = annotation.source
            results.append(existing)
        else:
            db_annotation = Annotation2D(
                id=annotation_id,
                task_id=annotation.task_id,
                frame_id=annotation.frame_id,
                camera_id=annotation.camera_id,
                track_id=annotation.track_id,
                type=annotation.type,
                class_id=annotation.class_id,
                taxonomy_id=annotation.taxonomy_id,
                data=annotation.data,
                attributes=annotation.attributes,
                source=annotation.source,
                is_verified=annotation.source == "manual_2d",
            )
            db.add(db_annotation)
            results.append(db_annotation)
    
    await db.commit()
    
    for ann in results:
        await db.refresh(ann)
    
    await check_achievements_for_user(db, current_user.id)
    
    return results


@router.get("/by-track/{track_id}", response_model=List[Annotation2DResponse])
async def get_annotations_2d_by_track(
    track_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    db: AsyncSession = Depends(get_db),
):
    """Get all 2D annotations for a track. Requires ANNOTATIONS_READ permission."""
    query = select(Annotation2D).where(Annotation2D.track_id == track_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.put("/by-track/{track_id}", response_model=BulkOperationResponse)
async def update_annotations_2d_by_track(
    track_id: UUID,
    update_data: TrackWideUpdate2D,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
):
    """
    Update all 2D annotations with a given track_id.
    Only updates the fields that are provided (non-None).
    Requires ANNOTATIONS_UPDATE permission.
    """
    
    query = select(Annotation2D).where(Annotation2D.track_id == track_id)
    result = await db.execute(query)
    annotations = result.scalars().all()
    
    if not annotations:
        return BulkOperationResponse(
            success_count=0,
            error_count=0,
            errors=[{"error": f"No annotations found for track {track_id}"}]
        )
    
    updated_count = 0
    for annotation in annotations:
        changed = False
        
        if update_data.class_id is not None:
            annotation.class_id = update_data.class_id
            changed = True
        
        if update_data.attributes is not None:
            annotation.attributes = update_data.attributes
            changed = True
        
        if changed:
            annotation.updated_at = datetime.utcnow()
            updated_count += 1
    
    await db.commit()
    
    return BulkOperationResponse(
        success_count=updated_count,
        error_count=0,
        errors=[]
    )


@router.post("/bulk-update", response_model=List[Annotation2DResponse])
async def update_annotations_2d_bulk(
    bulk_in: BulkAnnotation2DUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk update 2D annotations. Requires ANNOTATIONS_UPDATE permission."""
    updated = []
    
    for item in bulk_in.annotations:
        annotation = await db.get(Annotation2D, item.id)
        if not annotation:
            continue
        
        update_data = item.model_dump(exclude={'id'}, exclude_unset=True)
        for key, value in update_data.items():
            setattr(annotation, key, value)
        
        updated.append(annotation)
    
    await db.commit()
    
    for ann in updated:
        await db.refresh(ann)
    
    return updated


@router.post("/bulk-delete", response_model=BulkOperationResponse)
async def delete_annotations_2d_bulk(
    bulk_in: BulkAnnotation2DDelete,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_DELETE))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk delete 2D annotations. Requires ANNOTATIONS_DELETE permission."""
    deleted_count = 0
    not_found = []
    
    for annotation_id in bulk_in.annotation_ids:
        annotation = await db.get(Annotation2D, annotation_id)
        if annotation:
            await db.delete(annotation)
            deleted_count += 1
        else:
            not_found.append(str(annotation_id))
    
    await db.commit()
    
    return BulkOperationResponse(
        success_count=deleted_count,
        error_count=len(not_found),
        errors=[{"id": id, "error": "Annotation not found"} for id in not_found] if not_found else []
    )


@router.get("/by-camera/{camera_id}", response_model=List[Annotation2DResponse])
async def get_annotations_2d_by_camera(
    camera_id: str,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    task_id: UUID = Query(..., description="Task ID to filter by"),
    frame_id: Optional[UUID] = Query(None, description="Frame ID to filter by"),
    db: AsyncSession = Depends(get_db),
):
    """Get all 2D annotations for a specific camera. Requires ANNOTATIONS_READ permission."""
    query = select(Annotation2D).where(
        and_(
            Annotation2D.camera_id == camera_id,
            Annotation2D.task_id == task_id,
        )
    )
    
    if frame_id:
        query = query.where(Annotation2D.frame_id == frame_id)
    
    result = await db.execute(query)
    return result.scalars().all()


@router.delete("/by-task/{task_id}", status_code=status.HTTP_200_OK)
async def delete_annotations_2d_by_task(
    task_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_DELETE))],
    db: AsyncSession = Depends(get_db),
):
    """Delete all 2D annotations for a task. Requires ANNOTATIONS_DELETE permission."""
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    count_query = select(Annotation2D).where(Annotation2D.task_id == task_id)
    count_result = await db.execute(count_query)
    count = len(count_result.scalars().all())
    
    query = select(Annotation2D).where(Annotation2D.task_id == task_id)
    result = await db.execute(query)
    for ann in result.scalars():
        await db.delete(ann)
    
    await db.commit()
    
    return {"deleted_count": count, "task_id": str(task_id)}


@router.delete("/by-frame/{frame_id}", status_code=status.HTTP_200_OK)
async def delete_annotations_2d_by_frame(
    frame_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_DELETE))],
    db: AsyncSession = Depends(get_db),
    task_id: UUID = Query(..., description="Task ID to filter by"),
    camera_id: Optional[str] = Query(None, description="Camera ID to filter by (optional)"),
):
    """Delete all 2D annotations for a specific frame. Requires ANNOTATIONS_DELETE permission."""
    frame = await db.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame not found")
    
    conditions = [Annotation2D.frame_id == frame_id, Annotation2D.task_id == task_id]
    if camera_id:
        conditions.append(Annotation2D.camera_id == camera_id)
    
    query = select(Annotation2D).where(and_(*conditions))
    result = await db.execute(query)
    annotations = result.scalars().all()
    count = len(annotations)
    
    for ann in annotations:
        await db.delete(ann)
    
    await db.commit()
    
    return {"deleted_count": count, "frame_id": str(frame_id), "camera_id": camera_id}

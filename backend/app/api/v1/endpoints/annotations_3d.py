"""
3D Annotation endpoints - LiDAR-only cuboid annotations.

These are separate from the legacy 'annotations' table and store
3D LiDAR cuboid annotations that can be migrated to Fusion mode.
"""
from datetime import datetime
import logging
from typing import Annotated, List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, and_, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import Annotation3D, Task, Frame, User, Permission, TaskStatus
from app.schemas.schemas import (
    Annotation3DCreate,
    Annotation3DUpdate,
    Annotation3DResponse,
    BulkAnnotation3DCreate,
    BulkAnnotation3DUpdate,
    BulkAnnotation3DDelete,
    BulkOperationResponse,
    TrackWideUpdate3D,
)
from app.services.rbac_service import RequirePermissions
from app.services.workflow_service import WorkflowService, WorkflowError
from app.services.achievement_service import check_achievements_for_user

router = APIRouter(prefix="/annotations-3d", tags=["annotations-3d"])
logger = logging.getLogger(__name__)


async def auto_transition_to_in_progress(db: AsyncSession, task: Task, user_id: UUID, taxonomy_id: Optional[UUID] = None) -> None:
    """Auto-transition task to in_progress when first annotation is created."""
    workflow = WorkflowService(db)

    if task.status in [TaskStatus.PENDING.value, TaskStatus.ASSIGNED.value]:
        try:
            await workflow.start_work(task, changed_by_id=user_id)
        except WorkflowError:
            pass


@router.post("/", response_model=Annotation3DResponse, status_code=status.HTTP_201_CREATED)
async def create_annotation_3d(
    annotation: Annotation3DCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Create a new 3D annotation. Requires ANNOTATIONS_CREATE permission."""
    task = await db.get(Task, annotation.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    frame = await db.get(Frame, annotation.frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame not found")
    
    await auto_transition_to_in_progress(db, task, current_user.id, annotation.taxonomy_id)
    
    annotation_id = annotation.id if annotation.id else uuid4()
    
    db_annotation = Annotation3D(
        id=annotation_id,
        task_id=annotation.task_id,
        frame_id=annotation.frame_id,
        track_id=annotation.track_id,
        type=annotation.type,
        class_id=annotation.class_id,
        taxonomy_id=annotation.taxonomy_id,
        data=annotation.data,
        attributes=annotation.attributes,
        source=annotation.source,
        is_verified=annotation.source == "manual_3d",
    )
    
    db.add(db_annotation)
    await db.commit()
    await db.refresh(db_annotation)
    
    try:
        await check_achievements_for_user(db, current_user.id)
    except Exception as e:
        logger.warning("Achievement check failed after 3D create: %s", e)
    
    return db_annotation


@router.get("", response_model=List[Annotation3DResponse])
async def list_annotations_3d(
    task_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    frame_id: Optional[UUID] = Query(None, description="Frame ID to filter by"),
    track_id: Optional[UUID] = Query(None, description="Track ID to filter by"),
    taxonomy_id: Optional[UUID] = Query(None, description="Taxonomy ID to filter by"),
    is_migrated: Optional[bool] = Query(None, description="Filter by migration status"),
    db: AsyncSession = Depends(get_db),
):
    """List 3D annotations for a task. Requires ANNOTATIONS_READ permission."""
    query = select(Annotation3D).where(Annotation3D.task_id == task_id)
    
    if frame_id:
        query = query.where(Annotation3D.frame_id == frame_id)
    if track_id:
        query = query.where(Annotation3D.track_id == track_id)
    if taxonomy_id:
        from sqlalchemy import or_
        query = query.where(or_(Annotation3D.taxonomy_id == taxonomy_id, Annotation3D.taxonomy_id.is_(None)))
    if is_migrated is not None:
        query = query.where(Annotation3D.is_migrated_to_fusion == is_migrated)
    
    result = await db.execute(query)
    annotations = result.scalars().all()
    
    import logging
    logger = logging.getLogger(__name__)
    with_track_id = [a for a in annotations if a.track_id is not None]
    without_track_id = [a for a in annotations if a.track_id is None]
    logger.info(
        "[list_annotations_3d] task_id=%s total=%d with_track_id=%d without_track_id=%d",
        task_id, len(annotations), len(with_track_id), len(without_track_id)
    )
    if annotations:
        logger.info("[list_annotations_3d] sample annotation track_id: %s", annotations[0].track_id)
    
    return annotations


@router.get("/summary", response_model=list[dict])
async def get_annotations_3d_summary(
    task_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    taxonomy_id: Optional[UUID] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Lightweight summary — only id, track_id, frame_id, taxonomy_id.
    Used by the editor for track navigation without fetching full cuboid data."""
    sql = text("""
        SELECT id, track_id, frame_id, taxonomy_id
        FROM annotations_3d
        WHERE task_id = :task_id
        AND (CAST(:taxonomy_id AS uuid) IS NULL OR taxonomy_id = CAST(:taxonomy_id AS uuid) OR taxonomy_id IS NULL)
    """)
    result = await db.execute(sql, {"task_id": str(task_id), "taxonomy_id": str(taxonomy_id) if taxonomy_id else None})
    rows = result.mappings().all()
    return [dict(r) for r in rows]


@router.get("/{annotation_id}", response_model=Annotation3DResponse)
async def get_annotation_3d(
    annotation_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    db: AsyncSession = Depends(get_db),
):
    """Get a single 3D annotation. Requires ANNOTATIONS_READ permission."""
    annotation = await db.get(Annotation3D, annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail="3D Annotation not found")
    return annotation


@router.put("/{annotation_id}", response_model=Annotation3DResponse)
async def update_annotation_3d(
    annotation_id: UUID,
    update: Annotation3DUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
):
    """Update a 3D annotation. Requires ANNOTATIONS_UPDATE permission."""
    annotation = await db.get(Annotation3D, annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail="3D Annotation not found")
    
    update_data = update.model_dump(exclude_unset=True)

    if "data" in update_data and annotation.source != "manual_3d":
        annotation.source = "manual_3d"
        annotation.is_verified = True

    for key, value in update_data.items():
        setattr(annotation, key, value)

    await db.commit()
    await db.refresh(annotation)

    return annotation


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation_3d(
    annotation_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_DELETE))],
    db: AsyncSession = Depends(get_db),
):
    """Delete a 3D annotation. Requires ANNOTATIONS_DELETE permission."""
    annotation = await db.get(Annotation3D, annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail="3D Annotation not found")
    
    await db.delete(annotation)
    await db.commit()


@router.post("/bulk", response_model=List[Annotation3DResponse], status_code=status.HTTP_201_CREATED)
async def create_annotations_3d_bulk(
    bulk_in: BulkAnnotation3DCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk create 3D annotations. Requires ANNOTATIONS_CREATE permission."""
    import time
    start_time = time.time()
    print(f"[Bulk Create] Starting bulk create for {len(bulk_in.annotations)} annotations")
    
    created = []
    
    transitioned_combinations: set = set()
    
    loop_start = time.time()
    loop_start = time.time()
    for annotation in bulk_in.annotations:
        annotation_id = annotation.id if annotation.id else uuid4()

        existing_annotation = await db.get(Annotation3D, annotation_id)
        if existing_annotation:
            existing_annotation.task_id = annotation.task_id
            existing_annotation.frame_id = annotation.frame_id
            existing_annotation.track_id = annotation.track_id
            existing_annotation.type = annotation.type
            existing_annotation.class_id = annotation.class_id
            existing_annotation.taxonomy_id = annotation.taxonomy_id
            existing_annotation.data = annotation.data
            existing_annotation.attributes = annotation.attributes
            existing_annotation.source = annotation.source
            existing_annotation.is_verified = annotation.source == "manual_3d"
            created.append(existing_annotation)
            continue
        
        transition_start = time.time()
        transition_key = (annotation.task_id, annotation.taxonomy_id)
        if transition_key not in transitioned_combinations:
            task = await db.get(Task, annotation.task_id)
            if task:
                await auto_transition_to_in_progress(db, task, current_user.id, annotation.taxonomy_id)
                transitioned_combinations.add(transition_key)
        transition_time = time.time() - transition_start
        if transition_time > 0.1:
            print(f"[Bulk Create] Task transition took {transition_time:.3f}s")
        
        db_annotation = Annotation3D(
            id=annotation_id,
            task_id=annotation.task_id,
            frame_id=annotation.frame_id,
            track_id=annotation.track_id,
            type=annotation.type,
            class_id=annotation.class_id,
            taxonomy_id=annotation.taxonomy_id,
            data=annotation.data,
            attributes=annotation.attributes,
            source=annotation.source,
            is_verified=annotation.source == "manual_3d",
        )
        db.add(db_annotation)
        created.append(db_annotation)
    
    loop_time = time.time() - loop_start
    print(f"[Bulk Create] Loop took {loop_time:.3f}s")
    
    commit_start = time.time()
    await db.commit()
    commit_time = time.time() - commit_start
    print(f"[Bulk Create] Commit took {commit_time:.3f}s")
    
    refresh_start = time.time()
    for ann in created:
        await db.refresh(ann)
    refresh_time = time.time() - refresh_start
    print(f"[Bulk Create] Refresh took {refresh_time:.3f}s")
    
    try:
        await check_achievements_for_user(db, current_user.id)
    except Exception as e:
        logger.warning("Achievement check failed after 3D bulk create: %s", e)
    
    total_time = time.time() - start_time
    print(f"[Bulk Create] Total time: {total_time:.3f}s")
    
    return created


@router.get("/by-track/{track_id}", response_model=List[Annotation3DResponse])
async def get_annotations_3d_by_track(
    track_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    db: AsyncSession = Depends(get_db),
):
    """Get all 3D annotations for a track. Requires ANNOTATIONS_READ permission."""
    query = select(Annotation3D).where(Annotation3D.track_id == track_id)
    result = await db.execute(query)
    return result.scalars().all()


@router.put("/by-track/{track_id}", response_model=BulkOperationResponse)
async def update_annotations_3d_by_track(
    track_id: UUID,
    update_data: TrackWideUpdate3D,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
):
    """
    Update all 3D annotations with a given track_id.
    Only updates the fields that are provided (non-None).
    Requires ANNOTATIONS_UPDATE permission.
    """
    query = select(Annotation3D).where(Annotation3D.track_id == track_id)
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
        
        if update_data.dimensions is not None:
            current_data = dict(annotation.data) if annotation.data else {}
            current_data['dimensions'] = update_data.dimensions
            annotation.data = current_data
            changed = True
        
        if update_data.is_static is not None:
            current_attrs = annotation.attributes or {}
            current_attrs['is_static'] = update_data.is_static
            annotation.attributes = current_attrs
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


@router.post("/bulk-update", response_model=List[Annotation3DResponse])
async def update_annotations_3d_bulk(
    bulk_in: BulkAnnotation3DUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk update 3D annotations. Requires ANNOTATIONS_UPDATE permission."""
    updated = []
    
    for item in bulk_in.annotations:
        annotation = await db.get(Annotation3D, item.id)
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
async def delete_annotations_3d_bulk(
    bulk_in: BulkAnnotation3DDelete,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_DELETE))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk delete 3D annotations. Requires ANNOTATIONS_DELETE permission."""
    deleted_count = 0
    not_found = []
    
    for annotation_id in bulk_in.annotation_ids:
        annotation = await db.get(Annotation3D, annotation_id)
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


@router.delete("/by-frame/{frame_id}", response_model=BulkOperationResponse)
async def delete_annotations_3d_by_frame(
    frame_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_DELETE))],
    db: AsyncSession = Depends(get_db),
    task_id: UUID = Query(..., description="Task ID to filter by"),
):
    """Delete all 3D annotations for a specific frame. Requires ANNOTATIONS_DELETE permission."""
    frame = await db.get(Frame, frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame not found")

    query = select(Annotation3D).where(
        and_(Annotation3D.frame_id == frame_id, Annotation3D.task_id == task_id)
    )
    result = await db.execute(query)
    annotations = result.scalars().all()

    deleted_count = 0
    for annotation in annotations:
        await db.delete(annotation)
        deleted_count += 1

    await db.commit()

    return BulkOperationResponse(
        success_count=deleted_count,
        error_count=0,
        errors=[]
    )


@router.delete("/by-track/{track_id}", response_model=BulkOperationResponse)
async def delete_annotations_3d_by_track(
    track_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_DELETE))],
    db: AsyncSession = Depends(get_db),
):
    """Delete all 3D annotations with a given track_id. Requires ANNOTATIONS_DELETE permission."""
    query = select(Annotation3D).where(Annotation3D.track_id == track_id)
    result = await db.execute(query)
    annotations = result.scalars().all()
    
    deleted_count = 0
    for annotation in annotations:
        await db.delete(annotation)
        deleted_count += 1
    
    await db.commit()
    
    return BulkOperationResponse(
        success_count=deleted_count,
        error_count=0,
        errors=[]
    )

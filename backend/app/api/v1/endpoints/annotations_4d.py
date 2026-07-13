"""
4D Annotation endpoints.

Handles 4D (temporal/multi-frame) annotations that work with stacked point clouds.
"""
from datetime import datetime
from typing import Annotated, List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import Annotation4D, Annotation, Annotation3D, Frame, Task, User, Permission, TaskStatus
from app.schemas.schemas import (
    Annotation4DCreate,
    Annotation4DUpdate,
    Annotation4DResponse,
    Annotation4DMigrateRequest,
    Annotation4DMigrateResponse,
    Migrate4DTo3DRequest,
    Migrate4DTo3DResponse,
    BulkAnnotation4DUpdate,
    BulkAnnotation4DDelete,
    BulkOperationResponse,
)
from app.services.rbac_service import RequirePermissions
from app.services.workflow_service import WorkflowService, WorkflowError
from app.services.achievement_service import check_achievements_for_user

router = APIRouter(prefix="/annotations-4d", tags=["annotations-4d"])


async def auto_transition_to_in_progress(db: AsyncSession, task: Task, user_id: UUID) -> None:
    """
    Auto-transition task to in_progress when first annotation is created.
    Only transitions if task is in pending or assigned status.
    """
    if task.status in [TaskStatus.PENDING.value, TaskStatus.ASSIGNED.value]:
        try:
            workflow = WorkflowService(db)
            await workflow.start_work(task, changed_by_id=user_id)
        except WorkflowError:
            pass


@router.post("", response_model=Annotation4DResponse, status_code=status.HTTP_201_CREATED)
async def create_annotation_4d(
    annotation: Annotation4DCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Create a new 4D annotation. Requires ANNOTATIONS_CREATE permission."""
    task = await db.get(Task, annotation.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    await auto_transition_to_in_progress(db, task, current_user.id)
    
    frame_ids_str = [str(fid) for fid in annotation.frame_ids] if annotation.frame_ids else []
    frame_data_str = {str(k): v for k, v in annotation.frame_data.items()} if annotation.frame_data else {}
    
    db_annotation = Annotation4D(
        id=annotation.id or uuid4(),
        task_id=annotation.task_id,
        track_id=annotation.track_id,
        type=annotation.type,
        class_id=annotation.class_id,
        world_data=annotation.world_data,
        frame_data=frame_data_str,
        frame_ids=frame_ids_str,
        is_static=annotation.is_static,
        attributes=annotation.attributes,
        source=annotation.source,
    )
    
    db.add(db_annotation)
    await db.commit()
    await db.refresh(db_annotation)
    
    await check_achievements_for_user(db, current_user.id)
    
    return db_annotation


@router.get("", response_model=List[Annotation4DResponse])
async def list_annotations_4d(
    task_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    is_migrated: Optional[bool] = Query(None, description="Filter by migration status"),
    db: AsyncSession = Depends(get_db),
):
    """List 4D annotations for a task. Requires ANNOTATIONS_READ permission."""
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info(f"[4D LIST] Fetching annotations for task_id: {task_id}, is_migrated: {is_migrated}")
    query = select(Annotation4D).where(Annotation4D.task_id == task_id)
    
    if is_migrated is not None:
        query = query.where(Annotation4D.is_migrated == is_migrated)
    
    result = await db.execute(query)
    annotations = result.scalars().all()
    logger.info(f"[4D LIST] Returned {len(annotations)} annotations")
    for ann in annotations[:5]:
        logger.info(f"[4D LIST]   - {ann.id}, class_id: {ann.class_id}")
    
    return annotations


@router.get("/{annotation_id}", response_model=Annotation4DResponse)
async def get_annotation_4d(
    annotation_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    db: AsyncSession = Depends(get_db),
):
    """Get a single 4D annotation. Requires ANNOTATIONS_READ permission."""
    annotation = await db.get(Annotation4D, annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail="4D Annotation not found")
    return annotation


@router.put("/{annotation_id}", response_model=Annotation4DResponse)
async def update_annotation_4d(
    annotation_id: UUID,
    update: Annotation4DUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
):
    """Update a 4D annotation. Requires ANNOTATIONS_UPDATE permission."""
    annotation = await db.get(Annotation4D, annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail="4D Annotation not found")
    
    update_data = update.model_dump(exclude_unset=True)
    
    if 'frame_ids' in update_data and update_data['frame_ids'] is not None:
        update_data['frame_ids'] = [str(fid) for fid in update_data['frame_ids']]
    
    if 'frame_data' in update_data and update_data['frame_data'] is not None:
        update_data['frame_data'] = {str(k): v for k, v in update_data['frame_data'].items()}
    
    for key, value in update_data.items():
        setattr(annotation, key, value)
    
    await db.commit()
    await db.refresh(annotation)
    
    return annotation


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation_4d(
    annotation_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_DELETE))],
    db: AsyncSession = Depends(get_db),
):
    """Delete a 4D annotation. Requires ANNOTATIONS_DELETE permission."""
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info(f"[4D DELETE] Single delete requested for: {annotation_id}")
    annotation = await db.get(Annotation4D, annotation_id)
    if not annotation:
        logger.warning(f"[4D DELETE] Annotation not found: {annotation_id}")
        raise HTTPException(status_code=404, detail="4D Annotation not found")
    
    logger.info(f"[4D DELETE] Found annotation: {annotation.id}, class_id: {annotation.class_id}")
    await db.delete(annotation)
    logger.info(f"[4D DELETE] Deleted from session: {annotation_id}")
    
    try:
        await db.commit()
        logger.info(f"[4D DELETE] Single delete commit successful for: {annotation_id}")
    except Exception as e:
        logger.error(f"[4D DELETE] Commit FAILED: {e}", exc_info=True)
        await db.rollback()
        raise


@router.post("/bulk", response_model=List[Annotation4DResponse], status_code=status.HTTP_201_CREATED)
async def create_annotations_4d_bulk(
    annotations: List[Annotation4DCreate],
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk create 4D annotations. Requires ANNOTATIONS_CREATE permission."""
    created = []
    
    transitioned_tasks = set()
    
    for annotation in annotations:
        if annotation.task_id not in transitioned_tasks:
            task = await db.get(Task, annotation.task_id)
            if task:
                await auto_transition_to_in_progress(db, task, current_user.id)
                transitioned_tasks.add(annotation.task_id)
        
        frame_ids_str = [str(fid) for fid in annotation.frame_ids] if annotation.frame_ids else []
        frame_data_str = {str(k): v for k, v in annotation.frame_data.items()} if annotation.frame_data else {}
        
        db_annotation = Annotation4D(
            id=annotation.id or uuid4(),
            task_id=annotation.task_id,
            track_id=annotation.track_id,
            type=annotation.type,
            class_id=annotation.class_id,
            world_data=annotation.world_data,
            frame_data=frame_data_str,
            frame_ids=frame_ids_str,
            is_static=annotation.is_static,
            attributes=annotation.attributes,
            source=annotation.source,
        )
        db.add(db_annotation)
        created.append(db_annotation)
    
    await db.commit()
    
    for ann in created:
        await db.refresh(ann)
    
    await check_achievements_for_user(db, current_user.id)
    
    return created


@router.post("/bulk-update", response_model=List[Annotation4DResponse])
async def update_annotations_4d_bulk(
    request: BulkAnnotation4DUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk update 4D annotations. Requires ANNOTATIONS_UPDATE permission."""
    updated = []
    
    for item in request.annotations:
        annotation = await db.get(Annotation4D, item.id)
        if not annotation:
            continue
        
        update_data = {}
        if item.world_data is not None:
            update_data['world_data'] = item.world_data
        if item.frame_data is not None:
            update_data['frame_data'] = {str(k): v for k, v in item.frame_data.items()}
        if item.frame_ids is not None:
            update_data['frame_ids'] = [str(fid) for fid in item.frame_ids]
        if item.attributes is not None:
            update_data['attributes'] = item.attributes
        if item.class_id is not None:
            update_data['class_id'] = item.class_id
        
        for key, value in update_data.items():
            setattr(annotation, key, value)
        
        updated.append(annotation)
    
    await db.commit()
    
    for ann in updated:
        await db.refresh(ann)
    
    return updated


@router.post("/bulk-delete", response_model=BulkOperationResponse)
async def delete_annotations_4d_bulk(
    request: BulkAnnotation4DDelete,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_DELETE))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk delete 4D annotations. Requires ANNOTATIONS_DELETE permission."""
    import logging
    logger = logging.getLogger(__name__)
    
    logger.info(f"[4D DELETE] Starting bulk delete for {len(request.annotation_ids)} annotations")
    
    deleted_count = 0
    not_found = []
    
    for annotation_id in request.annotation_ids:
        logger.info(f"[4D DELETE] Processing annotation_id: {annotation_id}")
        annotation = await db.get(Annotation4D, annotation_id)
        
        if annotation:
            logger.info(f"[4D DELETE] Found annotation: {annotation.id}, class_id: {annotation.class_id}, task_id: {annotation.task_id}")
            await db.delete(annotation)
            logger.info(f"[4D DELETE] Deleted from session: {annotation_id}")
            deleted_count += 1
        else:
            logger.warning(f"[4D DELETE] Annotation NOT FOUND: {annotation_id}")
            not_found.append(str(annotation_id))
    
    try:
        await db.commit()
        logger.info(f"[4D DELETE] Commit successful! Deleted {deleted_count} annotations")
    except Exception as e:
        logger.error(f"[4D DELETE] Commit FAILED: {e}", exc_info=True)
        await db.rollback()
        raise
    
    for annotation_id in request.annotation_ids:
        check = await db.get(Annotation4D, annotation_id)
        if check is None:
            logger.info(f"[4D DELETE] ✓ Verification: {annotation_id} is gone from DB")
        else:
            logger.error(f"[4D DELETE] ✗ Verification FAILED: {annotation_id} still exists in DB after delete!")
    
    return BulkOperationResponse(
        success_count=deleted_count,
        error_count=len(not_found),
        errors=[{"id": id, "error": "Annotation not found"} for id in not_found] if not_found else []
    )


@router.post("/migrate", response_model=Annotation4DMigrateResponse)
async def migrate_4d_to_legacy(
    request: Annotation4DMigrateRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    task_id: UUID = Query(..., description="Task ID"),
    db: AsyncSession = Depends(get_db),
):
    """
    [LEGACY] Migrate 4D annotations to legacy annotations table. Requires ANNOTATIONS_UPDATE permission.
    
    NOTE: Prefer using /migrate-to-3d endpoint which uses the new annotations_3d table.
    
    For each 4D annotation:
    - Creates one Annotation per frame using the frame_data (LiDAR coordinates)
    - Preserves the track_id across all created annotations
    - Marks the 4D annotation as migrated
    """
    query = select(Annotation4D).where(
        and_(
            Annotation4D.task_id == task_id,
            Annotation4D.is_migrated == False,
        )
    )
    
    if request.annotation_4d_ids:
        query = query.where(Annotation4D.id.in_(request.annotation_4d_ids))
    
    result = await db.execute(query)
    annotations_4d = result.scalars().all()

    migrate_task = await db.get(Task, task_id)
    task_taxonomy_id = migrate_task.taxonomy_id if migrate_task else None

    created_annotation_ids = []
    errors = []
    migrated_count = 0

    for ann_4d in annotations_4d:
        try:
            frame_data = ann_4d.frame_data or {}
            world_data = ann_4d.world_data or {}

            for frame_id_str, lidar_data in frame_data.items():
                frame_id = UUID(frame_id_str) if isinstance(frame_id_str, str) else frame_id_str
                
                frame = await db.get(Frame, frame_id)
                if not frame:
                    errors.append({
                        "annotation_4d_id": str(ann_4d.id),
                        "frame_id": str(frame_id),
                        "error": "Frame not found"
                    })
                    continue
                
                annotation_data = {
                    "center": lidar_data.get("center", world_data.get("center", {})),
                    "dimensions": world_data.get("dimensions", {}),
                    "rotation": lidar_data.get("rotation", world_data.get("rotation", {})),
                    "confidence": 1.0,
                }
                
                is_keyframe = lidar_data.get("is_keyframe", False)
                source = "manual" if is_keyframe else "auto_interpolated"
                
                db_annotation = Annotation(
                    id=uuid4(),
                    task_id=ann_4d.task_id,
                    frame_id=frame_id,
                    track_id=ann_4d.track_id,
                    type=ann_4d.type,
                    class_id=ann_4d.class_id,
                    taxonomy_id=task_taxonomy_id,
                    data=annotation_data,
                    attributes={
                        **ann_4d.attributes,
                        "is_static": ann_4d.is_static,
                        "migrated_from_4d": str(ann_4d.id),
                    },
                    source=source,
                    is_verified=is_keyframe,
                )
                
                db.add(db_annotation)
                created_annotation_ids.append(db_annotation.id)
            
            ann_4d.is_migrated = True
            ann_4d.migrated_at = datetime.utcnow()
            migrated_count += 1
            
        except Exception as e:
            errors.append({
                "annotation_4d_id": str(ann_4d.id),
                "error": str(e)
            })
    
    await db.commit()
    
    return Annotation4DMigrateResponse(
        migrated_count=migrated_count,
        created_annotations=created_annotation_ids,
        errors=errors,
    )


@router.post("/migrate-to-3d", response_model=Migrate4DTo3DResponse)
async def migrate_4d_to_3d_new(
    request: Migrate4DTo3DRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    task_id: UUID = Query(..., description="Task ID"),
    db: AsyncSession = Depends(get_db),
):
    """
    Migrate 4D annotations to the new 3D annotations table (annotations_3d). Requires ANNOTATIONS_UPDATE permission.
    
    For each 4D annotation:
    - Creates one Annotation3D per frame using the frame_data (LiDAR coordinates)
    - Preserves the track_id across all created annotations
    - Preserves UUIDs when possible (uses track_id, not annotation id)
    - Marks the 4D annotation as migrated
    
    The 3D annotations can then be further migrated to Fusion mode.
    """
    query = select(Annotation4D).where(
        and_(
            Annotation4D.task_id == task_id,
            Annotation4D.is_migrated == False,
        )
    )
    
    if request.annotation_4d_ids:
        query = query.where(Annotation4D.id.in_(request.annotation_4d_ids))
    
    result = await db.execute(query)
    annotations_4d = result.scalars().all()
    
    created_annotation_ids = []
    track_id_mapping = {}
    errors = []
    migrated_count = 0
    
    for ann_4d in annotations_4d:
        try:
            frame_data = ann_4d.frame_data or {}
            world_data = ann_4d.world_data or {}
            
            track_id_mapping[str(ann_4d.track_id)] = str(ann_4d.track_id)
            
            for frame_id_str, lidar_data in frame_data.items():
                frame_id = UUID(frame_id_str) if isinstance(frame_id_str, str) else frame_id_str
                
                frame = await db.get(Frame, frame_id)
                if not frame:
                    errors.append({
                        "annotation_4d_id": str(ann_4d.id),
                        "frame_id": str(frame_id),
                        "error": "Frame not found"
                    })
                    continue
                
                annotation_data = {
                    "center": lidar_data.get("center", world_data.get("center", {})),
                    "dimensions": world_data.get("dimensions", {}),
                    "rotation": lidar_data.get("rotation", world_data.get("rotation", {})),
                    "confidence": 1.0,
                }
                
                is_keyframe = lidar_data.get("is_keyframe", False)
                source = "manual_3d" if is_keyframe else "migrated_from_4d"
                
                db_annotation = Annotation3D(
                    id=uuid4(),
                    task_id=ann_4d.task_id,
                    frame_id=frame_id,
                    track_id=ann_4d.track_id,
                    type=ann_4d.type,
                    class_id=ann_4d.class_id,
                    data=annotation_data,
                    attributes={
                        **ann_4d.attributes,
                        "is_static": ann_4d.is_static,
                        "migrated_from_4d": str(ann_4d.id),
                        "is_keyframe": is_keyframe,
                    },
                    source=source,
                    is_verified=is_keyframe,
                )
                
                db.add(db_annotation)
                created_annotation_ids.append(db_annotation.id)
            
            ann_4d.is_migrated = True
            ann_4d.migrated_at = datetime.utcnow()
            migrated_count += 1
            
        except Exception as e:
            errors.append({
                "annotation_4d_id": str(ann_4d.id),
                "error": str(e)
            })
    
    await db.commit()
    
    return Migrate4DTo3DResponse(
        migrated_count=migrated_count,
        created_annotation_ids=created_annotation_ids,
        track_id_mapping=track_id_mapping,
        errors=errors,
    )


@router.get("/by-track/{track_id}", response_model=List[Annotation4DResponse])
async def get_annotations_4d_by_track(
    track_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    db: AsyncSession = Depends(get_db),
):
    """Get all 4D annotations for a track. Requires ANNOTATIONS_READ permission."""
    query = select(Annotation4D).where(Annotation4D.track_id == track_id)
    result = await db.execute(query)
    return result.scalars().all()

"""
Fusion Annotation endpoints - Combined 3D + 2D annotations.

These store annotations that combine 3D LiDAR cuboids with 2D camera projections.
Can be created directly or migrated from 3D annotations.
"""
from datetime import datetime
from typing import Annotated, List, Optional
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import AnnotationFusion, Annotation3D, Task, Frame, User, Permission, TaskStatus
from app.schemas.schemas import (
    AnnotationFusionCreate,
    AnnotationFusionUpdate,
    AnnotationFusionResponse,
    BulkAnnotationFusionCreate,
    BulkOperationResponse,
    Migrate3DToFusionRequest,
    Migrate3DToFusionResponse,
)
from app.services.rbac_service import RequirePermissions
from app.services.workflow_service import WorkflowService, WorkflowError

router = APIRouter(prefix="/annotations-fusion", tags=["annotations-fusion"])


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


@router.post("/", response_model=AnnotationFusionResponse, status_code=status.HTTP_201_CREATED)
async def create_annotation_fusion(
    annotation: AnnotationFusionCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Create a new Fusion annotation. Requires ANNOTATIONS_CREATE permission."""
    task = await db.get(Task, annotation.task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    frame = await db.get(Frame, annotation.frame_id)
    if not frame:
        raise HTTPException(status_code=404, detail="Frame not found")
    
    await auto_transition_to_in_progress(db, task, current_user.id)
    
    annotation_id = annotation.id if annotation.id else uuid4()
    
    data_2d = {}
    if annotation.data_2d:
        for camera_id, projection in annotation.data_2d.items():
            if hasattr(projection, 'model_dump'):
                data_2d[camera_id] = projection.model_dump()
            else:
                data_2d[camera_id] = projection
    
    db_annotation = AnnotationFusion(
        id=annotation_id,
        task_id=annotation.task_id,
        frame_id=annotation.frame_id,
        track_id=annotation.track_id,
        type=annotation.type,
        class_id=annotation.class_id,
        data_3d=annotation.data_3d,
        data_2d=data_2d,
        attributes=annotation.attributes,
        source=annotation.source,
        source_3d_annotation_id=annotation.source_3d_annotation_id,
        is_verified=annotation.source == "manual_fusion",
    )
    
    db.add(db_annotation)
    await db.commit()
    await db.refresh(db_annotation)
    
    return db_annotation


@router.get("", response_model=List[AnnotationFusionResponse])
async def list_annotations_fusion(
    task_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    frame_id: Optional[UUID] = Query(None, description="Frame ID to filter by"),
    track_id: Optional[UUID] = Query(None, description="Track ID to filter by"),
    db: AsyncSession = Depends(get_db),
):
    """List Fusion annotations for a task. Requires ANNOTATIONS_READ permission."""
    query = select(AnnotationFusion).where(AnnotationFusion.task_id == task_id)
    
    if frame_id:
        query = query.where(AnnotationFusion.frame_id == frame_id)
    if track_id:
        query = query.where(AnnotationFusion.track_id == track_id)
    
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{annotation_id}", response_model=AnnotationFusionResponse)
async def get_annotation_fusion(
    annotation_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    db: AsyncSession = Depends(get_db),
):
    """Get a single Fusion annotation. Requires ANNOTATIONS_READ permission."""
    annotation = await db.get(AnnotationFusion, annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail="Fusion Annotation not found")
    return annotation


@router.put("/{annotation_id}", response_model=AnnotationFusionResponse)
async def update_annotation_fusion(
    annotation_id: UUID,
    update: AnnotationFusionUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
):
    """Update a Fusion annotation. Requires ANNOTATIONS_UPDATE permission."""
    annotation = await db.get(AnnotationFusion, annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail="Fusion Annotation not found")
    
    update_data = update.model_dump(exclude_unset=True)

    if "data_3d" in update_data and annotation.source not in ("manual_fusion", "manual"):
        annotation.source = "manual_fusion"
        annotation.is_verified = True

    for key, value in update_data.items():
        setattr(annotation, key, value)

    await db.commit()
    await db.refresh(annotation)

    return annotation


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation_fusion(
    annotation_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_DELETE))],
    db: AsyncSession = Depends(get_db),
):
    """Delete a Fusion annotation. Requires ANNOTATIONS_DELETE permission."""
    annotation = await db.get(AnnotationFusion, annotation_id)
    if not annotation:
        raise HTTPException(status_code=404, detail="Fusion Annotation not found")
    
    await db.delete(annotation)
    await db.commit()


@router.post("/bulk", response_model=List[AnnotationFusionResponse], status_code=status.HTTP_201_CREATED)
async def create_annotations_fusion_bulk(
    bulk_in: BulkAnnotationFusionCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
):
    """Bulk create Fusion annotations. Requires ANNOTATIONS_CREATE permission."""
    created = []
    
    transitioned_tasks = set()
    
    for annotation in bulk_in.annotations:
        annotation_id = annotation.id if annotation.id else uuid4()
        
        if annotation.task_id not in transitioned_tasks:
            task = await db.get(Task, annotation.task_id)
            if task:
                await auto_transition_to_in_progress(db, task, current_user.id)
                transitioned_tasks.add(annotation.task_id)
        
        data_2d = {}
        if annotation.data_2d:
            for camera_id, projection in annotation.data_2d.items():
                if hasattr(projection, 'model_dump'):
                    data_2d[camera_id] = projection.model_dump()
                else:
                    data_2d[camera_id] = projection
        
        db_annotation = AnnotationFusion(
            id=annotation_id,
            task_id=annotation.task_id,
            frame_id=annotation.frame_id,
            track_id=annotation.track_id,
            type=annotation.type,
            class_id=annotation.class_id,
            data_3d=annotation.data_3d,
            data_2d=data_2d,
            attributes=annotation.attributes,
            source=annotation.source,
            source_3d_annotation_id=annotation.source_3d_annotation_id,
            is_verified=annotation.source == "manual_fusion",
        )
        db.add(db_annotation)
        created.append(db_annotation)
    
    await db.commit()
    
    for ann in created:
        await db.refresh(ann)
    
    return created


@router.post("/migrate-from-3d", response_model=Migrate3DToFusionResponse)
async def migrate_3d_to_fusion(
    request: Migrate3DToFusionRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    task_id: UUID = Query(..., description="Task ID"),
    db: AsyncSession = Depends(get_db),
):
    """
    Migrate 3D annotations to Fusion annotations. Requires ANNOTATIONS_UPDATE permission.
    
    For each 3D annotation:
    - Creates a Fusion annotation with the same UUID (preserving identity)
    - Copies 3D data to data_3d field
    - Initializes empty data_2d (to be populated in Fusion editor)
    - Marks the 3D annotation as migrated
    """
    query = select(Annotation3D).where(
        and_(
            Annotation3D.task_id == task_id,
            Annotation3D.is_migrated_to_fusion == False,
        )
    )
    
    if request.annotation_3d_ids:
        query = query.where(Annotation3D.id.in_(request.annotation_3d_ids))
    
    result = await db.execute(query)
    annotations_3d = result.scalars().all()
    
    created_annotation_ids = []
    errors = []
    migrated_count = 0
    
    for ann_3d in annotations_3d:
        try:
            fusion_id = ann_3d.id if request.preserve_uuids else uuid4()
            
            db_fusion = AnnotationFusion(
                id=fusion_id,
                task_id=ann_3d.task_id,
                frame_id=ann_3d.frame_id,
                track_id=ann_3d.track_id,
                type="cuboid_fusion",
                class_id=ann_3d.class_id,
                data_3d=ann_3d.data,
                data_2d={},
                attributes={
                    **ann_3d.attributes,
                    "migrated_from_3d": str(ann_3d.id),
                },
                source="migrated_from_3d",
                source_3d_annotation_id=ann_3d.id,
                is_verified=False,
            )
            
            db.add(db_fusion)
            created_annotation_ids.append(fusion_id)
            
            ann_3d.is_migrated_to_fusion = True
            ann_3d.migrated_at = datetime.utcnow()
            ann_3d.fusion_annotation_id = fusion_id
            migrated_count += 1
            
        except Exception as e:
            errors.append({
                "annotation_3d_id": str(ann_3d.id),
                "error": str(e)
            })
    
    await db.commit()
    
    return Migrate3DToFusionResponse(
        migrated_count=migrated_count,
        created_annotation_ids=created_annotation_ids,
        errors=errors,
    )


@router.get("/by-track/{track_id}", response_model=List[AnnotationFusionResponse])
async def get_annotations_fusion_by_track(
    track_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    db: AsyncSession = Depends(get_db),
):
    """Get all Fusion annotations for a track. Requires ANNOTATIONS_READ permission."""
    query = select(AnnotationFusion).where(AnnotationFusion.track_id == track_id)
    result = await db.execute(query)
    return result.scalars().all()

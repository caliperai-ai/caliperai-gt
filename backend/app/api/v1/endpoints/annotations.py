"""
Annotation endpoints with RBAC protection - CRUD and verification.
"""
from datetime import datetime
from typing import Annotated, Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import Annotation, Task, Frame, User, Permission, TaskStatus
from app.schemas.schemas import (
    AnnotationCreate,
    AnnotationUpdate,
    AnnotationResponse,
    AnnotationVerify,
    BulkAnnotationCreate,
    BulkOperationResponse,
    AnnotationType,
    AnnotationSource,
)
from app.services.rbac_service import (
    get_current_user,
    RequirePermissions,
)
from app.services.workflow_service import WorkflowService, WorkflowError
from app.services.achievement_service import check_achievements_for_user

router = APIRouter()


def get_enum_value(enum_or_str):
    """Safely get the string value from an enum or return the string directly."""
    return enum_or_str.value if hasattr(enum_or_str, 'value') else enum_or_str


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


@router.post("", response_model=AnnotationResponse, status_code=status.HTTP_201_CREATED)
async def create_annotation(
    annotation_in: AnnotationCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
) -> Annotation:
    """Create a new annotation. Requires ANNOTATIONS_CREATE permission."""
    task_query = select(Task).where(
        Task.id == annotation_in.task_id,
        Task.is_deleted == False,
    )
    result = await db.execute(task_query)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {annotation_in.task_id} not found",
        )
    
    frame_query = select(Frame).where(Frame.id == annotation_in.frame_id)
    result = await db.execute(frame_query)
    if not result.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Frame {annotation_in.frame_id} not found",
        )
    
    await auto_transition_to_in_progress(db, task, current_user.id)
    
    source_value = get_enum_value(annotation_in.source)
    annotation = Annotation(
        task_id=annotation_in.task_id,
        frame_id=annotation_in.frame_id,
        track_id=annotation_in.track_id,
        type=get_enum_value(annotation_in.type),
        class_id=annotation_in.class_id,
        data=annotation_in.data,
        attributes=annotation_in.attributes,
        source=source_value,
        taxonomy_id=annotation_in.taxonomy_id,
        is_verified=source_value == AnnotationSource.MANUAL.value or source_value == 'manual',
    )
    db.add(annotation)
    await db.flush()
    await db.refresh(annotation)
    
    await check_achievements_for_user(db, current_user.id)
    
    return annotation


@router.post("/bulk", response_model=BulkOperationResponse)
async def create_annotations_bulk(
    bulk_in: BulkAnnotationCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Create multiple annotations in bulk. Requires ANNOTATIONS_CREATE permission."""
    success_count = 0
    errors = []
    
    transitioned_tasks = set()
    
    for i, annotation_in in enumerate(bulk_in.annotations):
        try:
            if annotation_in.task_id not in transitioned_tasks:
                task = await db.get(Task, annotation_in.task_id)
                if task:
                    await auto_transition_to_in_progress(db, task, current_user.id)
                    transitioned_tasks.add(annotation_in.task_id)
            
            source_value = get_enum_value(annotation_in.source)
            annotation = Annotation(
                task_id=annotation_in.task_id,
                frame_id=annotation_in.frame_id,
                track_id=annotation_in.track_id,
                type=get_enum_value(annotation_in.type),
                class_id=annotation_in.class_id,
                data=annotation_in.data,
                attributes=annotation_in.attributes,
                source=source_value,
                taxonomy_id=annotation_in.taxonomy_id,
                is_verified=source_value == AnnotationSource.MANUAL.value or source_value == 'manual',
            )
            db.add(annotation)
            success_count += 1
        except Exception as e:
            errors.append({"index": i, "error": str(e)})
    
    await db.flush()
    
    await check_achievements_for_user(db, current_user.id)
    
    return {
        "success_count": success_count,
        "error_count": len(errors),
        "errors": errors,
    }


@router.get("", response_model=list[AnnotationResponse])
async def list_annotations(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    task_id: Optional[UUID] = None,
    frame_id: Optional[UUID] = None,
    type: Optional[str] = None,
    class_id: Optional[str] = None,
    source: Optional[str] = None,
    is_verified: Optional[bool] = None,
    track_id: Optional[UUID] = None,
    taxonomy_id: Optional[UUID] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=1000),
    db: AsyncSession = Depends(get_db),
) -> list[Annotation]:
    """List annotations with filters. Requires ANNOTATIONS_READ permission."""
    query = select(Annotation)
    
    if task_id:
        query = query.where(Annotation.task_id == task_id)
    if frame_id:
        query = query.where(Annotation.frame_id == frame_id)
    if type:
        query = query.where(Annotation.type == type)
    if class_id:
        query = query.where(Annotation.class_id == class_id)
    if source:
        query = query.where(Annotation.source == source)
    if is_verified is not None:
        query = query.where(Annotation.is_verified == is_verified)
    if track_id:
        query = query.where(Annotation.track_id == track_id)
    if taxonomy_id:
        query = query.where(Annotation.taxonomy_id == taxonomy_id)
    
    query = query.order_by(Annotation.created_at.desc())
    query = query.offset((page - 1) * page_size).limit(page_size)
    
    result = await db.execute(query)
    return list(result.scalars().all())


@router.get("/{annotation_id}", response_model=AnnotationResponse)
async def get_annotation(
    annotation_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    db: AsyncSession = Depends(get_db),
) -> Annotation:
    """Get an annotation by ID. Requires ANNOTATIONS_READ permission."""
    query = select(Annotation).where(Annotation.id == annotation_id)
    result = await db.execute(query)
    annotation = result.scalar_one_or_none()
    
    if not annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Annotation {annotation_id} not found",
        )
    
    return annotation


@router.patch("/{annotation_id}", response_model=AnnotationResponse)
async def update_annotation(
    annotation_id: UUID,
    annotation_in: AnnotationUpdate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
) -> Annotation:
    """
    Update an annotation. Requires ANNOTATIONS_UPDATE permission.
    
    When modifying an auto-annotation, it automatically becomes 'manual'.
    """
    query = select(Annotation).where(Annotation.id == annotation_id)
    result = await db.execute(query)
    annotation = result.scalar_one_or_none()
    
    if not annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Annotation {annotation_id} not found",
        )
    
    update_data = annotation_in.model_dump(exclude_unset=True)
    
    if "data" in update_data and annotation.source != AnnotationSource.MANUAL.value:
        annotation.source = AnnotationSource.MANUAL.value
        annotation.is_verified = True
    
    for field, value in update_data.items():
        setattr(annotation, field, value)
    
    await db.flush()
    await db.refresh(annotation)
    return annotation


@router.post("/{annotation_id}/verify", response_model=AnnotationResponse)
async def verify_annotation(
    annotation_id: UUID,
    verification: AnnotationVerify,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_UPDATE))],
    db: AsyncSession = Depends(get_db),
) -> Annotation:
    """
    Verify an auto-annotation. Requires ANNOTATIONS_UPDATE permission.
    
    This marks the annotation as human-verified, optionally applying modifications.
    """
    query = select(Annotation).where(Annotation.id == annotation_id)
    result = await db.execute(query)
    annotation = result.scalar_one_or_none()
    
    if not annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Annotation {annotation_id} not found",
        )
    
    if annotation.source == AnnotationSource.MANUAL.value:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Manual annotations don't need verification",
        )
    
    if verification.modifications:
        for field, value in verification.modifications.items():
            if field in ["data", "attributes", "class_id"]:
                setattr(annotation, field, value)
    
    annotation.is_verified = verification.is_verified
    annotation.verified_at = datetime.utcnow()
    
    if verification.modifications:
        annotation.source = AnnotationSource.MANUAL.value
    
    await db.flush()
    await db.refresh(annotation)
    return annotation


@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_annotation(
    annotation_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_DELETE))],
    db: AsyncSession = Depends(get_db),
) -> None:
    """Delete an annotation. Requires ANNOTATIONS_DELETE permission."""
    query = select(Annotation).where(Annotation.id == annotation_id)
    result = await db.execute(query)
    annotation = result.scalar_one_or_none()
    
    if not annotation:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Annotation {annotation_id} not found",
        )
    
    await db.delete(annotation)
    await db.flush()


@router.get("/track/{track_id}", response_model=list[AnnotationResponse])
async def get_track_annotations(
    track_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    db: AsyncSession = Depends(get_db),
) -> list[Annotation]:
    """Get all annotations for a specific track. Requires ANNOTATIONS_READ permission."""
    query = (
        select(Annotation)
        .where(Annotation.track_id == track_id)
        .order_by(Annotation.created_at)
    )
    result = await db.execute(query)
    return list(result.scalars().all())

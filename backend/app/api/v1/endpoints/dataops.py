"""
DataOps API Endpoints

Provides endpoints for:
- Annotation version history
- Stage snapshots
- DataOps statistics
- Snapshot comparison
"""
import uuid
from datetime import datetime
from typing import Annotated, List, Optional, Dict, Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.core.database import get_db
from app.models.models import Task, Scene, Dataset, User
from app.services.dataops_service import DataOpsService, get_dataops_service
from app.services.rbac_service import get_current_user, RequirePermissions


router = APIRouter(prefix="/dataops", tags=["dataops"])



class AnnotationHistoryResponse(BaseModel):
    """Response for a single annotation history entry."""
    id: str
    annotation_id: str
    task_id: str
    frame_id: str
    change_type: str
    annotation_data: Dict[str, Any]
    previous_data: Optional[Dict[str, Any]] = None
    task_stage: str
    task_status: str
    changed_by_id: Optional[str] = None
    version: int
    created_at: str


class AnnotationHistoryListResponse(BaseModel):
    """Paginated list of annotation history."""
    items: List[AnnotationHistoryResponse]
    total: int
    limit: int
    offset: int


class SnapshotSummaryResponse(BaseModel):
    """Summary of a stage snapshot (without full annotation data)."""
    id: str
    task_id: str
    from_stage: str
    to_stage: str
    from_status: str
    to_status: str
    snapshot_name: str
    total_annotations: int
    annotations_by_class: Dict[str, int]
    annotations_by_type: Dict[str, int]
    triggered_by_id: Optional[str] = None
    notes: Optional[str] = None
    created_at: str


class SnapshotDetailResponse(SnapshotSummaryResponse):
    """Full snapshot including annotation data."""
    annotations_by_frame: Dict[str, int]
    annotations_snapshot: Dict[str, Any]


class SnapshotListResponse(BaseModel):
    """Paginated list of snapshots."""
    items: List[SnapshotSummaryResponse]
    total: int
    limit: int
    offset: int


class TaskDataOpsStats(BaseModel):
    """DataOps statistics for a task."""
    total_changes: int
    changes_by_type: Dict[str, int]
    created_count: int
    updated_count: int
    deleted_count: int
    snapshot_count: int
    latest_snapshot: Optional[Dict[str, Any]] = None


class DatasetDataOpsStats(BaseModel):
    """DataOps statistics for a dataset."""
    total_changes: int
    changes_by_type: Dict[str, int]
    total_snapshots: int
    tasks_with_history: int
    total_tasks: int


class SnapshotCompareResponse(BaseModel):
    """Comparison between two snapshots."""
    snapshot_1: Dict[str, Any]
    snapshot_2: Dict[str, Any]
    added: List[Dict[str, Any]]
    removed: List[Dict[str, Any]]
    modified: List[Dict[str, Any]]
    summary: Dict[str, int]



@router.get("/tasks/{task_id}/history", response_model=AnnotationHistoryListResponse)
async def get_task_history(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    change_type: Optional[str] = Query(None, description="Filter by change type: created, updated, deleted"),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
):
    """Get annotation history for a specific task."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    dataops = get_dataops_service(db)
    
    history = await dataops.get_task_annotation_history(
        task_id=task_id,
        change_type=change_type,
        limit=limit,
        offset=offset,
    )
    
    total = await dataops.get_task_history_count(task_id, change_type)
    
    items = [
        AnnotationHistoryResponse(
            id=str(h.id),
            annotation_id=str(h.annotation_id),
            task_id=str(h.task_id),
            frame_id=str(h.frame_id),
            change_type=h.change_type,
            annotation_data=h.annotation_data,
            previous_data=h.previous_data,
            task_stage=h.task_stage,
            task_status=h.task_status,
            changed_by_id=str(h.changed_by_id) if h.changed_by_id else None,
            version=h.version,
            created_at=h.created_at.isoformat(),
        )
        for h in history
    ]
    
    return AnnotationHistoryListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/tasks/{task_id}/snapshots", response_model=SnapshotListResponse)
async def get_task_snapshots(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(50, le=100),
    offset: int = Query(0, ge=0),
):
    """Get stage snapshots for a specific task."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    dataops = get_dataops_service(db)
    
    snapshots = await dataops.get_task_snapshots(task_id, limit, offset)
    total = await dataops.get_snapshot_count(task_id)
    
    items = [
        SnapshotSummaryResponse(
            id=str(s.id),
            task_id=str(s.task_id),
            from_stage=s.from_stage,
            to_stage=s.to_stage,
            from_status=s.from_status,
            to_status=s.to_status,
            snapshot_name=s.snapshot_name,
            total_annotations=s.total_annotations,
            annotations_by_class=s.annotations_by_class,
            annotations_by_type=s.annotations_by_type,
            triggered_by_id=str(s.triggered_by_id) if s.triggered_by_id else None,
            notes=s.notes,
            created_at=s.created_at.isoformat(),
        )
        for s in snapshots
    ]
    
    return SnapshotListResponse(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/tasks/{task_id}/stats", response_model=TaskDataOpsStats)
async def get_task_stats(
    task_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Get DataOps statistics for a specific task."""
    result = await db.execute(select(Task).where(Task.id == task_id))
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    dataops = get_dataops_service(db)
    stats = await dataops.get_task_dataops_stats(task_id)
    
    return TaskDataOpsStats(**stats)



@router.get("/datasets/{dataset_id}/history", response_model=AnnotationHistoryListResponse)
async def get_dataset_history(
    dataset_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    change_type: Optional[str] = Query(None, description="Filter by change type"),
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
):
    """Get annotation history for all tasks in a dataset."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    dataops = get_dataops_service(db)
    
    history = await dataops.get_dataset_history(
        dataset_id=dataset_id,
        change_type=change_type,
        limit=limit,
        offset=offset,
    )
    
    stats = await dataops.get_dataset_dataops_stats(dataset_id)
    
    items = [
        AnnotationHistoryResponse(
            id=str(h.id),
            annotation_id=str(h.annotation_id),
            task_id=str(h.task_id),
            frame_id=str(h.frame_id),
            change_type=h.change_type,
            annotation_data=h.annotation_data,
            previous_data=h.previous_data,
            task_stage=h.task_stage,
            task_status=h.task_status,
            changed_by_id=str(h.changed_by_id) if h.changed_by_id else None,
            version=h.version,
            created_at=h.created_at.isoformat(),
        )
        for h in history
    ]
    
    return AnnotationHistoryListResponse(
        items=items,
        total=stats["total_changes"],
        limit=limit,
        offset=offset,
    )


@router.get("/datasets/{dataset_id}/snapshots", response_model=SnapshotListResponse)
async def get_dataset_snapshots(
    dataset_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(100, le=500),
    offset: int = Query(0, ge=0),
):
    """Get all stage snapshots for tasks in a dataset."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    dataops = get_dataops_service(db)
    
    snapshots = await dataops.get_dataset_snapshots(dataset_id, limit, offset)
    stats = await dataops.get_dataset_dataops_stats(dataset_id)
    
    items = [
        SnapshotSummaryResponse(
            id=str(s.id),
            task_id=str(s.task_id),
            from_stage=s.from_stage,
            to_stage=s.to_stage,
            from_status=s.from_status,
            to_status=s.to_status,
            snapshot_name=s.snapshot_name,
            total_annotations=s.total_annotations,
            annotations_by_class=s.annotations_by_class,
            annotations_by_type=s.annotations_by_type,
            triggered_by_id=str(s.triggered_by_id) if s.triggered_by_id else None,
            notes=s.notes,
            created_at=s.created_at.isoformat(),
        )
        for s in snapshots
    ]
    
    return SnapshotListResponse(
        items=items,
        total=stats["total_snapshots"],
        limit=limit,
        offset=offset,
    )


@router.get("/datasets/{dataset_id}/stats", response_model=DatasetDataOpsStats)
async def get_dataset_stats(
    dataset_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Get aggregated DataOps statistics for a dataset."""
    result = await db.execute(select(Dataset).where(Dataset.id == dataset_id))
    dataset = result.scalar_one_or_none()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    dataops = get_dataops_service(db)
    stats = await dataops.get_dataset_dataops_stats(dataset_id)
    
    return DatasetDataOpsStats(**stats)



@router.get("/snapshots/{snapshot_id}", response_model=SnapshotDetailResponse)
async def get_snapshot_detail(
    snapshot_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    """Get full details of a specific snapshot including annotation data."""
    dataops = get_dataops_service(db)
    snapshot = await dataops.get_snapshot(snapshot_id)
    
    if not snapshot:
        raise HTTPException(status_code=404, detail="Snapshot not found")
    
    return SnapshotDetailResponse(
        id=str(snapshot.id),
        task_id=str(snapshot.task_id),
        from_stage=snapshot.from_stage,
        to_stage=snapshot.to_stage,
        from_status=snapshot.from_status,
        to_status=snapshot.to_status,
        snapshot_name=snapshot.snapshot_name,
        total_annotations=snapshot.total_annotations,
        annotations_by_class=snapshot.annotations_by_class,
        annotations_by_type=snapshot.annotations_by_type,
        annotations_by_frame=snapshot.annotations_by_frame,
        annotations_snapshot=snapshot.annotations_snapshot,
        triggered_by_id=str(snapshot.triggered_by_id) if snapshot.triggered_by_id else None,
        notes=snapshot.notes,
        created_at=snapshot.created_at.isoformat(),
    )


@router.get("/snapshots/compare", response_model=SnapshotCompareResponse)
async def compare_snapshots(
    snapshot_id_1: uuid.UUID = Query(..., description="First snapshot ID"),
    snapshot_id_2: uuid.UUID = Query(..., description="Second snapshot ID"),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    db: Annotated[AsyncSession, Depends(get_db)] = None,
):
    """Compare two snapshots and return the differences."""
    dataops = get_dataops_service(db)
    result = await dataops.compare_snapshots(snapshot_id_1, snapshot_id_2)
    
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    
    return SnapshotCompareResponse(**result)



@router.get("/annotations/{annotation_id}/history", response_model=List[AnnotationHistoryResponse])
async def get_annotation_version_history(
    annotation_id: uuid.UUID,
    current_user: Annotated[User, Depends(get_current_user)],
    db: Annotated[AsyncSession, Depends(get_db)],
    limit: int = Query(50, le=100),
    offset: int = Query(0, ge=0),
):
    """Get version history for a specific annotation."""
    dataops = get_dataops_service(db)
    history = await dataops.get_annotation_history(annotation_id, limit, offset)
    
    return [
        AnnotationHistoryResponse(
            id=str(h.id),
            annotation_id=str(h.annotation_id),
            task_id=str(h.task_id),
            frame_id=str(h.frame_id),
            change_type=h.change_type,
            annotation_data=h.annotation_data,
            previous_data=h.previous_data,
            task_stage=h.task_stage,
            task_status=h.task_status,
            changed_by_id=str(h.changed_by_id) if h.changed_by_id else None,
            version=h.version,
            created_at=h.created_at.isoformat(),
        )
        for h in history
    ]

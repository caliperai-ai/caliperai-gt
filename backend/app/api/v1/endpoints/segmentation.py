"""
Semantic Segmentation endpoints for per-point LiDAR labeling.

Provides:
- Save/load per-point segmentation labels
- Export to .npy/.bin formats
- Propagation between frames
"""
import asyncio
import fcntl
import os
import struct
import io
from typing import Annotated, Optional, List, Dict, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response, StreamingResponse
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession
import numpy as np

from app.core.database import get_db
from app.models.models import User, Permission, Task, Frame, Scene
from app.services.rbac_service import RequirePermissions
from pydantic import BaseModel, Field, model_validator

router = APIRouter()

SEGMENTATION_ROOT = os.environ.get("SEGMENTATION_ROOT", "/uploads/segmentation")



class SegmentationLabelsCreate(BaseModel):
    """Request to save segmentation labels for a frame.

    Accepts EITHER a full snapshot (``labels``, ``instance_ids``) — last-write-
    wins, kept for back-compat — OR a delta payload (``delta_indices`` +
    ``delta_labels`` + optional ``delta_instance_ids``). The delta path is
    required for safe concurrent editing: two annotators on the same task
    each send only the points THEY changed since their last save, and the
    server merges into the on-disk file under a per-frame lock so neither
    annotator clobbers the other's region. ``point_count`` is required in
    both modes so the server can initialize a fresh -1 array on first save.
    """
    frame_id: UUID
    point_count: int = Field(..., description="Total number of points")
    labels: Optional[List[int]] = Field(
        None, description="Full snapshot (legacy). Provide either this or delta_*."
    )
    instance_ids: Optional[List[int]] = Field(
        None, description="Full snapshot instance ids paired with `labels`."
    )
    delta_indices: Optional[List[int]] = Field(
        None, description="Indices of points the client changed since baseline."
    )
    delta_labels: Optional[List[int]] = Field(
        None, description="New label per index in `delta_indices` (-1 to clear)."
    )
    delta_instance_ids: Optional[List[int]] = Field(
        None, description="Optional new instance id per index in `delta_indices`."
    )

    @model_validator(mode="after")
    def _check_payload_shape(self):
        is_delta = self.delta_indices is not None or self.delta_labels is not None
        if is_delta:
            if self.delta_indices is None or self.delta_labels is None:
                raise ValueError("delta_indices and delta_labels must be provided together")
            if len(self.delta_indices) != len(self.delta_labels):
                raise ValueError(
                    f"delta_indices ({len(self.delta_indices)}) and "
                    f"delta_labels ({len(self.delta_labels)}) length mismatch"
                )
            if self.delta_instance_ids is not None and len(self.delta_instance_ids) != len(self.delta_indices):
                raise ValueError(
                    f"delta_instance_ids ({len(self.delta_instance_ids)}) and "
                    f"delta_indices ({len(self.delta_indices)}) length mismatch"
                )
        else:
            if self.labels is None:
                raise ValueError("Either `labels` (full snapshot) or `delta_*` must be provided")
        return self


class SegmentationLabelsResponse(BaseModel):
    """Response containing segmentation labels."""
    frame_id: UUID
    labels: List[int]
    point_count: int
    labeled_count: int
    class_distribution: dict
    instance_ids: Optional[List[int]] = None
    instance_count: int = 0


class SegmentationExportRequest(BaseModel):
    """Request to export segmentation labels."""
    frame_ids: List[UUID]
    format: str = Field(default="npy", description="Export format: 'npy' or 'bin'")
    include_unlabeled: bool = Field(default=True, description="Include unlabeled points in export")


class SegmentationStats(BaseModel):
    """Statistics for segmentation progress."""
    total_frames: int
    labeled_frames: int
    total_points: int
    labeled_points: int
    total_instances: int
    class_distribution: dict



def get_segmentation_path(scene_id: UUID, frame_id: UUID) -> str:
    """Get the file path for storing segmentation labels."""
    return os.path.join(SEGMENTATION_ROOT, str(scene_id), f"{frame_id}.npy")


def get_instance_path(scene_id: UUID, frame_id: UUID) -> str:
    """Get the file path for storing instance IDs."""
    return os.path.join(SEGMENTATION_ROOT, str(scene_id), f"{frame_id}_instances.npy")


def get_semantic_path(scene_id: UUID, frame_id: UUID) -> str:
    """Get the file path for the semantic layer (class labels only).

    The semantic and instance layers are stored independently so editing one
    never affects the other.
    """
    return os.path.join(SEGMENTATION_ROOT, str(scene_id), f"{frame_id}_semantic.npy")


def ensure_segmentation_dir(scene_id: UUID) -> str:
    """Ensure the segmentation directory exists for a scene."""
    dir_path = os.path.join(SEGMENTATION_ROOT, str(scene_id))
    os.makedirs(dir_path, exist_ok=True)
    return dir_path



_frame_locks: Dict[Tuple[str, str], asyncio.Lock] = {}
_frame_locks_guard = asyncio.Lock()


async def _get_frame_lock(scene_id: UUID, frame_id: UUID) -> asyncio.Lock:
    key = (str(scene_id), str(frame_id))
    async with _frame_locks_guard:
        lock = _frame_locks.get(key)
        if lock is None:
            lock = asyncio.Lock()
            _frame_locks[key] = lock
        return lock


def _atomic_write_npy(path: str, arr: np.ndarray) -> None:
    """Write ``arr`` to ``path`` atomically.

    np.save auto-appends .npy if the filename doesn't already end in it,
    which makes temp-then-rename awkward. We use the low-level
    write_array instead so the final filename is honored verbatim.
    """
    tmp = f"{path}.tmp"
    with open(tmp, "wb") as f:
        np.lib.format.write_array(f, arr, allow_pickle=False)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, path)


def _load_or_init(path: str, point_count: int) -> np.ndarray:
    """Load existing labels/instances or initialize a fresh -1 array."""
    if os.path.exists(path):
        arr = np.load(path)
        if arr.shape == (point_count,):
            return arr.astype(np.int32, copy=False)
    return np.full(point_count, -1, dtype=np.int32)



@router.post("/tasks/{task_id}/segmentation/{frame_id}", response_model=SegmentationLabelsResponse)
async def save_segmentation_labels(
    task_id: UUID,
    frame_id: UUID,
    data: SegmentationLabelsCreate,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    layer: str = "instance",
    db: AsyncSession = Depends(get_db),
):
    """
    Save per-point segmentation labels for a frame.

    Two payload shapes:
      • Delta (preferred): ``delta_indices`` + ``delta_labels`` (+ optional
        ``delta_instance_ids``). Server reads the existing file, applies the
        delta in-place under a per-frame lock, atomically rewrites the file,
        and returns the merged snapshot. Safe under concurrent edits — each
        annotator only ever overwrites the points they actually touched.
      • Full snapshot (legacy): ``labels`` + ``instance_ids``. Last-write-wins.
        Older clients still work but will clobber concurrent edits.

    The response always contains the post-merge full snapshot so the client
    can pick up any changes another annotator made between its load and its
    save (three-way merge happens client-side from there).
    """
    task_query = select(Task).where(
        Task.id == task_id,
        Task.is_deleted == False,
    )
    result = await db.execute(task_query)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    frame_query = select(Frame).where(Frame.id == frame_id)
    result = await db.execute(frame_query)
    frame = result.scalar_one_or_none()
    if not frame:
        raise HTTPException(status_code=404, detail=f"Frame {frame_id} not found")

    scene_query = select(Scene).where(Scene.id == task.scene_id)
    result = await db.execute(scene_query)
    scene = result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    is_delta = data.delta_indices is not None

    if not is_delta and len(data.labels or []) != data.point_count:
        raise HTTPException(
            status_code=400,
            detail=f"Label count ({len(data.labels or [])}) doesn't match point count ({data.point_count})",
        )
    if (not is_delta) and data.instance_ids is not None and len(data.instance_ids) != data.point_count:
        raise HTTPException(
            status_code=400,
            detail=f"Instance ID count ({len(data.instance_ids)}) doesn't match point count ({data.point_count})",
        )

    ensure_segmentation_dir(scene.id)
    is_semantic = layer == "semantic"
    labels_path = (
        get_semantic_path(scene.id, frame_id)
        if is_semantic
        else get_segmentation_path(scene.id, frame_id)
    )
    instance_path = get_instance_path(scene.id, frame_id)

    lock_path = labels_path + ".lock"

    frame_lock = await _get_frame_lock(scene.id, frame_id)
    async with frame_lock:
        with open(lock_path, "w") as lock_f:
            fcntl.flock(lock_f.fileno(), fcntl.LOCK_EX)
            try:
                if is_delta:
                    indices = np.asarray(data.delta_indices, dtype=np.int64)
                    if indices.size:
                        if int(indices.min()) < 0 or int(indices.max()) >= data.point_count:
                            raise HTTPException(
                                status_code=400,
                                detail=f"delta_indices out of range [0, {data.point_count})",
                            )

                    labels_array = _load_or_init(labels_path, data.point_count)
                    new_labels = np.asarray(data.delta_labels, dtype=np.int32)
                    labels_array[indices] = new_labels

                    has_instance_delta = data.delta_instance_ids is not None and not is_semantic
                    if not is_semantic and (has_instance_delta or os.path.exists(instance_path)):
                        instance_array = _load_or_init(instance_path, data.point_count)
                        if has_instance_delta:
                            instance_array[indices] = np.asarray(
                                data.delta_instance_ids, dtype=np.int32
                            )
                        _atomic_write_npy(instance_path, instance_array)
                    else:
                        instance_array = None

                    _atomic_write_npy(labels_path, labels_array)
                else:
                    labels_array = np.array(data.labels, dtype=np.int32)
                    _atomic_write_npy(labels_path, labels_array)
                    if is_semantic:
                        instance_array = None
                    elif data.instance_ids is not None:
                        instance_array = np.array(data.instance_ids, dtype=np.int32)
                        _atomic_write_npy(instance_path, instance_array)
                    elif os.path.exists(instance_path):
                        instance_array = np.load(instance_path)
                    else:
                        instance_array = None
            finally:
                fcntl.flock(lock_f.fileno(), fcntl.LOCK_UN)

    labeled_count = int(np.sum(labels_array >= 0))
    unique, counts = np.unique(labels_array[labels_array >= 0], return_counts=True)
    class_distribution = {int(k): int(v) for k, v in zip(unique, counts)}

    instance_ids_out: Optional[List[int]] = None
    instance_count = 0
    if instance_array is not None:
        instance_ids_out = instance_array.tolist()
        instance_count = len(np.unique(instance_array[instance_array >= 0]))

    return SegmentationLabelsResponse(
        frame_id=frame_id,
        labels=labels_array.tolist(),
        point_count=int(labels_array.shape[0]),
        labeled_count=labeled_count,
        class_distribution=class_distribution,
        instance_ids=instance_ids_out,
        instance_count=instance_count,
    )


@router.get("/tasks/{task_id}/segmentation/stats", response_model=SegmentationStats)
async def get_segmentation_stats(
    task_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    db: AsyncSession = Depends(get_db),
):
    """
    Get segmentation statistics for a task.
    
    Returns progress metrics across all frames.
    """
    task_query = select(Task).where(
        Task.id == task_id,
        Task.is_deleted == False,
    )
    result = await db.execute(task_query)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    
    frames_query = select(Frame).where(Frame.scene_id == task.scene_id).order_by(Frame.frame_index)
    result = await db.execute(frames_query)
    frames = result.scalars().all()
    
    scene_query = select(Scene).where(Scene.id == task.scene_id)
    result = await db.execute(scene_query)
    scene = result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    total_frames = len(frames)
    labeled_frames = 0
    total_points = 0
    labeled_points = 0
    total_instances = 0
    class_distribution: dict = {}

    for frame in frames:
        labels_path = get_segmentation_path(scene.id, frame.id)
        if os.path.exists(labels_path):
            labels_array = np.load(labels_path)
            frame_labeled = int(np.sum(labels_array >= 0))

            if frame_labeled > 0:
                labeled_frames += 1

            total_points += len(labels_array)
            labeled_points += frame_labeled

            instance_path = get_instance_path(scene.id, frame.id)
            if os.path.exists(instance_path):
                instance_array = np.load(instance_path)
                unique_instances = np.unique(instance_array[instance_array >= 0])
                total_instances += len(unique_instances)

            unique, counts = np.unique(labels_array[labels_array >= 0], return_counts=True)
            for k, v in zip(unique, counts):
                class_distribution[int(k)] = class_distribution.get(int(k), 0) + int(v)

    return SegmentationStats(
        total_frames=total_frames,
        labeled_frames=labeled_frames,
        total_points=total_points,
        labeled_points=labeled_points,
        total_instances=total_instances,
        class_distribution=class_distribution,
    )


@router.get("/tasks/{task_id}/segmentation/{frame_id}", response_model=SegmentationLabelsResponse)
async def get_segmentation_labels(
    task_id: UUID,
    frame_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    layer: str = "instance",
    db: AsyncSession = Depends(get_db),
):
    """
    Get per-point segmentation labels for a frame.

    Returns empty labels if no segmentation exists yet.
    """
    task_query = select(Task).where(
        Task.id == task_id,
        Task.is_deleted == False,
    )
    result = await db.execute(task_query)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    scene_query = select(Scene).where(Scene.id == task.scene_id)
    result = await db.execute(scene_query)
    scene = result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    is_semantic = layer == "semantic"
    labels_path = (
        get_semantic_path(scene.id, frame_id)
        if is_semantic
        else get_segmentation_path(scene.id, frame_id)
    )
    instance_path = get_instance_path(scene.id, frame_id)

    instance_ids = None
    instance_count = 0

    if os.path.exists(labels_path):
        labels_array = np.load(labels_path)
        labels = labels_array.tolist()
        point_count = len(labels)
        labeled_count = int(np.sum(labels_array >= 0))
        unique, counts = np.unique(labels_array[labels_array >= 0], return_counts=True)
        class_distribution = {int(k): int(v) for k, v in zip(unique, counts)}

        if not is_semantic and os.path.exists(instance_path):
            instance_array = np.load(instance_path)
            instance_ids = instance_array.tolist()
            instance_count = len(np.unique(instance_array[instance_array >= 0]))
    else:
        labels = []
        point_count = 0
        labeled_count = 0
        class_distribution = {}

    return SegmentationLabelsResponse(
        frame_id=frame_id,
        labels=labels,
        point_count=point_count,
        labeled_count=labeled_count,
        class_distribution=class_distribution,
        instance_ids=instance_ids,
        instance_count=instance_count,
    )


@router.post("/tasks/{task_id}/segmentation/export")
async def export_segmentation(
    task_id: UUID,
    request: SegmentationExportRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
    db: AsyncSession = Depends(get_db),
):
    """
    Export segmentation labels for specified frames.

    Supports:
    - npy: NumPy array format (recommended)
    - bin: Raw binary format (SemanticKITTI compatible)

    Returns a zip file containing one file per frame.
    """
    import zipfile

    task_query = select(Task).where(
        Task.id == task_id,
        Task.is_deleted == False,
    )
    result = await db.execute(task_query)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")

    scene_query = select(Scene).where(Scene.id == task.scene_id)
    result = await db.execute(scene_query)
    scene = result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
        for frame_id in request.frame_ids:
            labels_path = get_segmentation_path(scene.id, frame_id)

            if not os.path.exists(labels_path):
                continue

            labels_array = np.load(labels_path)

            if not request.include_unlabeled:
                labels_array = np.where(labels_array >= 0, labels_array, 0)

            if request.format == "npy":
                npy_buffer = io.BytesIO()
                np.save(npy_buffer, labels_array)
                zf.writestr(f"{frame_id}.npy", npy_buffer.getvalue())
            else:
                labels_uint32 = labels_array.astype(np.uint32)
                zf.writestr(f"{frame_id}.bin", labels_uint32.tobytes())

    zip_buffer.seek(0)

    return StreamingResponse(
        zip_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename=segmentation_{task_id}.zip"
        }
    )


@router.post("/tasks/{task_id}/segmentation/propagate")
async def propagate_segmentation(
    task_id: UUID,
    source_frame_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
    target_frame_ids: List[UUID] = Query(...),
):
    """
    Propagate segmentation labels from source frame to target frames.
    
    Uses nearest-neighbor matching to transfer labels based on point positions.
    This is a basic implementation - for production, consider using
    optical flow or registration-based methods.
    """
    task_query = select(Task).where(
        Task.id == task_id,
        Task.is_deleted == False,
    )
    result = await db.execute(task_query)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    
    scene_query = select(Scene).where(Scene.id == task.scene_id)
    result = await db.execute(scene_query)
    scene = result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    source_labels_path = get_segmentation_path(scene.id, source_frame_id)
    if not os.path.exists(source_labels_path):
        raise HTTPException(status_code=404, detail="Source frame has no segmentation labels")
    
    source_labels = np.load(source_labels_path)
    
    propagated = []
    for target_frame_id in target_frame_ids:
        target_labels_path = get_segmentation_path(scene.id, target_frame_id)
        ensure_segmentation_dir(scene.id)
        
        np.save(target_labels_path, source_labels)
        propagated.append(str(target_frame_id))
    
    return {
        "success": True,
        "propagated_frames": propagated,
        "message": f"Propagated labels to {len(propagated)} frames"
    }


@router.delete("/tasks/{task_id}/segmentation/clear")
async def clear_all_segmentation_labels(
    task_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_DELETE))],
    db: AsyncSession = Depends(get_db),
):
    """
    Clear all segmentation labels for a task.
    
    Deletes all segmentation and instance label files for all frames in the task's scene.
    """
    import shutil
    import glob
    
    task_query = select(Task).where(
        Task.id == task_id,
        Task.is_deleted == False,
    )
    result = await db.execute(task_query)
    task = result.scalar_one_or_none()
    if not task:
        raise HTTPException(status_code=404, detail=f"Task {task_id} not found")
    
    scene_query = select(Scene).where(Scene.id == task.scene_id)
    result = await db.execute(scene_query)
    scene = result.scalar_one_or_none()
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")
    
    seg_dir = os.path.join(SEGMENTATION_ROOT, str(scene.id))
    
    deleted_count = 0
    if os.path.exists(seg_dir):
        for npy_file in glob.glob(os.path.join(seg_dir, "*.npy")):
            try:
                os.remove(npy_file)
                deleted_count += 1
            except OSError:
                pass
    
    return {
        "success": True,
        "deleted_files": deleted_count,
        "message": f"Cleared {deleted_count} segmentation files"
    }
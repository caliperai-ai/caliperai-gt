"""
Dataset Import endpoints with RBAC protection.
Handles importing multi-sensor datasets from folder structures.
"""
import asyncio
import json
import logging
import os
import re
import shutil
import tempfile
import uuid
import zipfile
from datetime import datetime
from pathlib import Path
from typing import Annotated, Optional, List, Dict, Any, Tuple
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks, UploadFile, File, Form
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import attributes, selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.file_security import (
    validate_upload_path,
    validate_magic_bytes,
    rename_data_files_to_uuid,
    safe_zip_extract,
    DATA_EXTENSIONS,
)
from app.models.models import Dataset, Scene, Frame, Campaign, User, Permission, Task, Annotation3D, Annotation2D, Track2D, AnnotationSource, Taxonomy, dataset_taxonomy_association
from app.api.v1.endpoints.datasets import auto_create_tasks_for_scene
from app.services.rbac_service import (
    get_current_user,
    RequirePermissions,
)
from app.services.storage_service import get_storage_service

import numpy as np

log = logging.getLogger(__name__)

SEGMENTATION_ROOT = os.environ.get("SEGMENTATION_ROOT", "/uploads/segmentation")

router = APIRouter()

GENERIC_FOLDER_NAMES = {'data', 'dataset', 'scenes', 'scene', 'default', 'default_scene', 'test', 'sample', 'extracted'}


def _mirror_scene_to_minio(
    org_id,
    dataset_id,
    scene_id: uuid.UUID,
    scene_dir: Path,
) -> None:
    """Upload every file in *scene_dir* to the org MinIO bucket (encrypted).

    Object key pattern: ``datasets/{dataset_id}/{scene_id}/{relative_path}``.
    Errors are logged but never raised — local storage remains the source of
    truth; MinIO is the encrypted mirror used for pre-signed URL serving.
    """
    try:
        svc = get_storage_service()
        svc.ensure_bucket(org_id)
        for file_path in scene_dir.rglob("*"):
            if not file_path.is_file():
                continue
            rel = file_path.relative_to(scene_dir)
            object_key = f"datasets/{dataset_id}/{scene_id}/{rel.as_posix()}"
            try:
                svc.upload_file(org_id, object_key, file_path)
            except Exception as exc:  # noqa: BLE001
                log.warning("MinIO upload failed for %s: %s", object_key, exc)
    except Exception as exc:  # noqa: BLE001
        log.warning("Could not mirror scene %s to MinIO: %s", scene_id, exc)




class SensorInfo(BaseModel):
    """Sensor information from metadata."""
    sensor_id: str
    type: Optional[str] = None
    format: str
    resolution: Optional[List[int]] = None
    fps: Optional[float] = None
    coordinate_system: Optional[str] = None


class DatasetMetadata(BaseModel):
    """Dataset-level metadata from metadata.json."""
    name: str
    version: Optional[str] = "1.0.0"
    sensors: Dict[str, Any] = Field(default_factory=dict)


class SceneMetadata(BaseModel):
    """Scene-level metadata from scene_metadata.json."""
    scene_id: str
    name: Optional[str] = None
    location: Optional[str] = None
    weather: Optional[str] = None
    time_of_day: Optional[str] = None
    recording_date: Optional[str] = None
    duration_seconds: Optional[float] = None
    frame_count: int
    fps: float = 10.0
    ego_vehicle: Optional[str] = None


class ImportRequest(BaseModel):
    """Request to import a dataset from a local path."""
    dataset_id: UUID
    root_path: str = Field(..., description="Absolute path to dataset root folder")
    

class ImportProgress(BaseModel):
    """Progress information for import job."""
    status: str
    total_scenes: int = 0
    processed_scenes: int = 0
    total_frames: int = 0
    processed_frames: int = 0
    errors: List[str] = Field(default_factory=list)
    message: str = ""


class RenamedScene(BaseModel):
    original_name: str
    new_name: str
    scene_id: str


class ImportResponse(BaseModel):
    """Response from import endpoint."""
    success: bool
    message: str
    scenes_imported: int = 0
    frames_imported: int = 0
    errors: List[str] = Field(default_factory=list)
    renamed_scenes: List[RenamedScene] = Field(default_factory=list)


class SceneConflict(BaseModel):
    original_name: str
    suggested_name: str


class SceneNameCheckRequest(BaseModel):
    dataset_id: UUID
    folder_names: List[str]
    preserve_folder_names: bool = True


class SceneNameCheckResponse(BaseModel):
    conflicts: List[SceneConflict]



def detect_ego_to_lidar_rotation(ego_poses: Dict[int, Dict]) -> List[List[float]]:
    """
    Return the fixed ego_to_lidar rotation for this dataset convention.

    Conventions confirmed for this importer:
    - ego pose +x is the drive direction
    - GT LiDAR +y is the same drive direction

    Therefore ego_x must map to lidar_y, ego_y to lidar_-x, and ego_z to lidar_z.
    """
    _ = ego_poses
    rotation = [[0, 1, 0], [-1, 0, 0], [0, 0, 1]]
    log.info("Applying fixed ego_to_lidar convention: ego +x -> lidar +y")
    return rotation


def parse_calibration_file(calibration_path: Path, ego_poses: Optional[Dict[int, Dict]] = None) -> Dict[str, Any]:
    """Parse calibration data from files.
    
    Supports two formats:
    1. A folder with extrinsics.json and intrinsics/ subfolder
    2. A single calibration.json file containing all calibration data
    
    If ego_to_lidar is missing or identity, auto-detects axis convention from ego poses
    and applies correct calibration to enforce y-forward LiDAR convention.
    """
    calibration = {
        "lidar_to_cameras": {},
        "ego_to_lidar": None
    }
    
    if calibration_path.suffix == '.json' and calibration_path.exists():
        with open(calibration_path, 'r') as f:
            data = json.load(f)
            calibration["lidar_to_cameras"] = data.get("lidar_to_cameras", {})
            calibration["ego_to_lidar"] = data.get("ego_to_lidar")
        if calibration["ego_to_lidar"] and calibration["ego_to_lidar"].get("rotation") != [[1,0,0],[0,1,0],[0,0,1]]:
            return calibration
    else:
        if not calibration_path.is_dir():
            pass
        else:
            extrinsics_file = calibration_path / "extrinsics.json"
            if extrinsics_file.exists():
                with open(extrinsics_file, 'r') as f:
                    data = json.load(f)
                    calibration["lidar_to_cameras"] = data.get("lidar_to_cameras", {})
                    calibration["ego_to_lidar"] = data.get("ego_to_lidar")
            
            intrinsics_path = calibration_path / "intrinsics"
            if intrinsics_path.exists():
                for intrinsic_file in intrinsics_path.glob("*.json"):
                    camera_id = intrinsic_file.stem
                    with open(intrinsic_file, 'r') as f:
                        intrinsic_data = json.load(f)
                        if camera_id in calibration["lidar_to_cameras"]:
                            calibration["lidar_to_cameras"][camera_id]["intrinsic"] = intrinsic_data
                        else:
                            calibration["lidar_to_cameras"][camera_id] = {
                                "extrinsic": {"rotation": [[1,0,0],[0,1,0],[0,0,1]], "translation": [0,0,0]},
                                "intrinsic": intrinsic_data
                            }
            
            if calibration["ego_to_lidar"] and calibration["ego_to_lidar"].get("rotation") != [[1,0,0],[0,1,0],[0,0,1]]:
                return calibration
    
    if ego_poses:
        rotation = detect_ego_to_lidar_rotation(ego_poses)
        calibration["ego_to_lidar"] = {"rotation": rotation, "translation": [0, 0, 0]}
    else:
        log.warning("No ego poses provided; defaulting to identity ego_to_lidar (GT tool expects y-forward LiDAR)")
        calibration["ego_to_lidar"] = {"rotation": [[1, 0, 0], [0, 1, 0], [0, 0, 1]], "translation": [0, 0, 0]}
    
    return calibration


def generate_smart_scene_name(folder_name: str, index: int = 1) -> str:
    """
    Generate a smart scene name from folder name.
    Handles common generic names and cleans up the name.
    
    Args:
        folder_name: Original folder name
        index: Scene index if multiple scenes
        
    Returns:
        Smart scene name
        
    Examples:
        'extracted' -> 'Scene_01'
        'data' -> 'Scene_01'
        'scene123' -> 'Scene_123'
        'urban_downtown_night' -> 'Urban_Downtown_Night'
        'scene-0916_2026-01-16T19-06-11' -> 'Scene_0916'
    """
    generic_names = GENERIC_FOLDER_NAMES
    
    name = folder_name.strip()
    
    if name.lower() in generic_names or not name:
        return f"Scene_{str(index).zfill(2)}"
    
    if 'T' in name and ('-' in name or '_' in name):
        parts = name.split('_')[0].split('-')
        for part in parts:
            if part.isdigit() and len(part) >= 3:
                return f"Scene_{part}"
    
    cleaned = name.replace('-', '_').replace('.', '_')
    
    words = [w.capitalize() for w in cleaned.split('_') if w]
    
    if words and words[0].lower() == 'scene':
        if len(words) > 1 and words[1].isdigit():
            return f"Scene_{words[1]}"
        elif len(words) > 1:
            return '_'.join(words[:3])
    
    smart_name = '_'.join(words[:3])
    
    if len(smart_name) < 5:
        smart_name = f"Scene_{str(index).zfill(2)}"
    
    return smart_name


def generate_smart_task_name(scene_name: str, frame_count: int, task_type: str = "Annot") -> str:
    """
    Generate a smart task name based on scene name and frame range.
    
    Args:
        scene_name: Name of the scene
        frame_count: Number of frames in the scene
        task_type: Type of task (Annot, Label, QA, Review, etc.)
        
    Returns:
        Smart task name
        
    Examples:
        'Urban_Downtown' + 100 frames -> 'Annot_Urban_Downtown_F1-100'
        'Scene_01' + 50 frames -> 'Annot_Scene_01_F1-50'
    """
    clean_scene = scene_name
    
    if len(clean_scene) > 20:
        parts = clean_scene.split('_')
        clean_scene = '_'.join(parts[:2])
    
    if frame_count > 0:
        return f"{task_type}_{clean_scene}_F1-{frame_count}"
    else:
        return f"{task_type}_{clean_scene}"


async def get_or_create_scene_import_task(
    db: AsyncSession,
    scene: Scene,
    assignee_id: UUID,
    frame_count: int,
    description: str,
) -> Task:
    """Pick the task that uploaded annotations should land in.

    Prefer the scene's selected taxonomy task when available so imported
    annotations show up in the same task the UI opens by default. Only create a
    generic fallback task when the scene has no existing tasks.
    """
    result = await db.execute(
        select(Task)
        .where(Task.scene_id == scene.id, Task.is_deleted == False)
        .order_by(Task.created_at.asc())
    )
    existing_tasks = list(result.scalars().all())

    if scene.selected_taxonomy_id:
        for existing_task in existing_tasks:
            if existing_task.taxonomy_id == scene.selected_taxonomy_id:
                return existing_task

    for existing_task in existing_tasks:
        if existing_task.taxonomy_id is not None:
            return existing_task

    if existing_tasks:
        return existing_tasks[0]

    from asyncpg import Range as PgRange

    smart_task_name = generate_smart_task_name(scene.name, frame_count, "Annot")
    task = Task(
        scene_id=scene.id,
        name=smart_task_name,
        description=description,
        assignee_id=assignee_id,
        frame_range=PgRange(0, frame_count) if frame_count > 0 else PgRange(0, 1),
    )
    db.add(task)
    await db.flush()
    return task


def match_folder_to_task(
    folder_name: str,
    tasks_with_taxonomy: List[Tuple[Task, Optional[str]]],
) -> Optional[Task]:
    """Match an export folder name to a task by comparing taxonomy names.

    Export folder format (from build_task_export_folder_name):
        {safe_task_name}__{task_id[:8]}
    where task.name == "{scene_name} - {taxonomy_name}" and safe_task_name is
    the result of re.sub(r"[^a-zA-Z0-9_-]+", "_", task.name).strip("_").

    ' - ' encodes to '_-_', so we split on the LAST occurrence of '_-_' to
    extract the taxonomy part even when the scene name itself contains '-'.
    """
    without_hash = re.sub(r'__[0-9a-f]{8}$', '', folder_name, flags=re.IGNORECASE)

    parts = without_hash.split('_-_', maxsplit=1)
    taxonomy_safe_from_folder = parts[-1] if len(parts) == 2 else without_hash

    for task, taxonomy_name in tasks_with_taxonomy:
        if not taxonomy_name:
            continue
        taxonomy_safe = re.sub(r"[^a-zA-Z0-9_-]+", "_", taxonomy_name).strip("_")
        if taxonomy_safe.lower() == taxonomy_safe_from_folder.lower():
            return task

    return None


def load_ego_poses(scene_path: Path) -> Dict[int, Dict]:
    """Load ego poses from scene directory.
    
    Checks both 'ego_poses/poses.json' and 'ego_poses/ego_poses.json' locations.
    Returns dictionary mapping frame_index to pose data (position, rotation, velocity).
    Supports both {'frames': [...]} and flat list [...] file formats.
    """
    ego_poses_file = scene_path / "ego_poses" / "poses.json"
    if not ego_poses_file.exists():
        ego_poses_file = scene_path / "ego_poses" / "ego_poses.json"
    
    ego_poses = {}
    if ego_poses_file.exists():
        try:
            with open(ego_poses_file, 'r') as f:
                poses_data = json.load(f)
                if isinstance(poses_data, dict):
                    pose_entries = poses_data.get("frames", [])
                elif isinstance(poses_data, list):
                    pose_entries = poses_data
                else:
                    pose_entries = []

                for frame_index, pose in enumerate(pose_entries):
                    pose_index = pose.get("frame_index", frame_index)
                    ego_poses[pose_index] = {
                        "position": pose.get("position", [0, 0, 0]),
                        "rotation": pose.get("rotation", [1, 0, 0, 0]),
                        "velocity": pose.get("velocity")
                    }
        except Exception as e:
            log.warning(f"Failed to load ego poses from {ego_poses_file}: {e}")
    
    return ego_poses


def discover_frames(scene_path: Path, sensor_config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Discover frames in a scene folder."""
    frames = []
    
    lidar_path = scene_path / "lidar"
    if lidar_path.exists():
        lidar_files = sorted(lidar_path.glob("*.pcd")) + sorted(lidar_path.glob("*.bin"))
        
        timestamps_file = scene_path / "timestamps.json"
        timestamps = {}
        if timestamps_file.exists():
            with open(timestamps_file, 'r') as f:
                ts_data = json.load(f)
                for frame_ts in ts_data.get("frames", []):
                    timestamps[frame_ts["frame_index"]] = frame_ts["timestamp"]
        
        ego_poses = load_ego_poses(scene_path)
        
        for idx, lidar_file in enumerate(lidar_files):
            file_paths = {
                "lidar": lidar_file.name,
                "cameras": {}
            }
            
            cameras_path = scene_path / "cameras"
            if cameras_path.exists():
                for camera_dir in cameras_path.iterdir():
                    if camera_dir.is_dir():
                        camera_id = camera_dir.name
                        for ext in [".jpg", ".png", ".webp"]:
                            camera_file = camera_dir / f"{lidar_file.stem}{ext}"
                            if camera_file.exists():
                                file_paths["cameras"][camera_id] = camera_file.name
                                break
            
            frame = {
                "frame_index": idx,
                "timestamp": timestamps.get(idx, idx * 0.1),
                "ego_pose": ego_poses.get(idx),
                "file_paths": file_paths
            }
            frames.append(frame)
    
    return frames


def get_storage_paths(scene_path: Path, root_path: Path) -> Dict[str, Any]:
    """Build storage paths for a scene."""
    relative_scene = scene_path.relative_to(root_path)
    
    storage_paths = {
        "lidar_base": str(relative_scene / "lidar"),
        "cameras": {},
        "ego_poses": None
    }
    
    cameras_path = scene_path / "cameras"
    if cameras_path.exists():
        for camera_dir in cameras_path.iterdir():
            if camera_dir.is_dir():
                storage_paths["cameras"][camera_dir.name] = str(relative_scene / "cameras" / camera_dir.name)
    
    ego_poses_file = scene_path / "ego_poses" / "poses.json"
    if not ego_poses_file.exists():
        ego_poses_file = scene_path / "ego_poses" / "ego_poses.json"
    
    if ego_poses_file.exists():
        storage_paths["ego_poses"] = str(relative_scene / "ego_poses" / ego_poses_file.name)
    
    return storage_paths



class FolderItem(BaseModel):
    """A file or folder in a directory listing."""
    name: str
    path: str
    is_directory: bool
    size: Optional[int] = None


class BrowseFolderResponse(BaseModel):
    """Response from folder browsing endpoint."""
    current_path: str
    parent_path: Optional[str] = None
    items: List[FolderItem] = Field(default_factory=list)



@router.get("/browse", response_model=BrowseFolderResponse)
async def browse_folders(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_IMPORT))],
    path: str = "/",
) -> BrowseFolderResponse:
    """
    Browse server filesystem directories.
    Requires DATASETS_IMPORT permission.

    Only paths under ALLOWED_BROWSE_ROOTS (/uploads, /data by default) are
    accessible. Any path outside those roots, and any symlink that would
    escape them, is rejected with 403.
    """
    allowed_roots: list[Path] = [
        Path(r).resolve() for r in settings.ALLOWED_BROWSE_ROOTS
    ]

    def _is_within_allowed(p: Path) -> bool:
        """Return True iff *p* is equal to or a descendant of an allowed root."""
        return any(p == root or root in p.parents for root in allowed_roots)

    try:
        folder_path = Path(path).resolve()

        if not _is_within_allowed(folder_path):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Access denied: path is outside allowed directories",
            )

        if not folder_path.exists():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Path does not exist: {path}",
            )

        if not folder_path.is_dir():
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Path is not a directory: {path}",
            )

        items: List[FolderItem] = []

        try:
            for entry in sorted(folder_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
                if entry.name.startswith('.'):
                    continue

                if entry.is_symlink():
                    try:
                        resolved_entry = entry.resolve()
                    except OSError:
                        continue
                    if not _is_within_allowed(resolved_entry):
                        continue

                try:
                    is_dir = entry.is_dir()
                    size = None if is_dir else entry.stat().st_size
                    items.append(FolderItem(
                        name=entry.name,
                        path=str(entry),
                        is_directory=is_dir,
                        size=size,
                    ))
                except PermissionError:
                    continue

        except PermissionError:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Permission denied accessing: {path}",
            )

        raw_parent = folder_path.parent
        if folder_path == folder_path.parent or not _is_within_allowed(raw_parent):
            parent_path = None
        else:
            parent_path = str(raw_parent)

        return BrowseFolderResponse(
            current_path=str(folder_path),
            parent_path=parent_path,
            items=items,
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error browsing folder: {str(e)}",
        )


UPLOAD_DIR = Path("/uploads")

AUTO_CLASS_COLORS = [
    "#FF6B6B",
    "#4ECDC4",
    "#45B7D1",
    "#96CEB4",
    "#FFEAA7",
    "#DDA0DD",
    "#98D8C8",
    "#F7DC6F",
    "#BB8FCE",
    "#85C1E9",
    "#F8B500",
    "#00CED1",
    "#FF69B4",
    "#90EE90",
    "#DEB887",
    "#87CEEB",
]


def scan_annotations_for_classes(scene_dirs: List[Path]) -> set:
    """
    Scan annotation files across all scene directories to extract unique class labels.
    
    Supports:
    - KITTI format 3D annotations (annotations/lidar/*.txt or label_2/*.txt)
    - COCO format 2D annotations (annotations/*.json)
    
    Args:
        scene_dirs: List of scene directory paths to scan
        
    Returns:
        Set of unique class labels found in annotations
    """
    classes = set()
    
    for scene_dir in scene_dirs:
        annotations_dir = scene_dir / "annotations"
        
        if not annotations_dir.exists():
            parent_annotations_dir = scene_dir.parent / "annotations"
            if parent_annotations_dir.exists():
                annotations_dir = parent_annotations_dir
        
        label_2_dir = scene_dir / "label_2"
        if label_2_dir.exists():
            for txt_file in label_2_dir.glob("*.txt"):
                try:
                    with open(txt_file, "r") as f:
                        for line in f:
                            parts = line.strip().split()
                            if len(parts) >= 1:
                                class_label = parts[0]
                                if class_label.lower() != "dontcare":
                                    classes.add(class_label)
                except Exception:
                    continue
        
        if not annotations_dir.exists():
            continue
        
        lidar_annotations_dir = annotations_dir / "lidar"
        if not lidar_annotations_dir.exists():
            lidar_annotations_dir = annotations_dir / "label_2"
        if lidar_annotations_dir.exists():
            for txt_file in lidar_annotations_dir.glob("*.txt"):
                try:
                    with open(txt_file, "r") as f:
                        for line in f:
                            parts = line.strip().split()
                            if len(parts) >= 1:
                                class_label = parts[0]
                                if class_label.lower() != "dontcare":
                                    classes.add(class_label)
                except Exception:
                    continue
        
        for json_file in annotations_dir.glob("*.json"):
            if json_file.name == "metadata.json":
                continue
            try:
                with open(json_file, "r") as f:
                    coco_data = json.load(f)
                
                for cat in coco_data.get("categories", []):
                    class_name = cat.get("name")
                    if class_name:
                        classes.add(class_name)
            except Exception:
                continue
    
    print(f"[DERIVE TAXONOMY] Found {len(classes)} unique classes: {classes}")
    return classes


async def derive_and_merge_taxonomy(
    db: AsyncSession,
    dataset: Dataset,
    discovered_classes: set,
    user_id: UUID,
) -> Optional[Taxonomy]:
    """
    Create or merge taxonomy based on discovered classes from annotations.
    
    If dataset has no taxonomy:
        - Create a new taxonomy with all discovered classes
        - Link it to the dataset
    
    If dataset has existing taxonomy:
        - Add any missing classes to the existing taxonomy (merge)
    
    Args:
        db: Database session
        dataset: The dataset to link taxonomy to
        discovered_classes: Set of class labels found in annotations
        user_id: ID of user performing the import
        
    Returns:
        The created or updated Taxonomy, or None if no classes discovered
    """
    if not discovered_classes:
        print("[DERIVE TAXONOMY] No classes discovered, skipping taxonomy creation")
        return None
    
    taxonomy_result = await db.execute(
        select(Taxonomy)
        .join(dataset_taxonomy_association)
        .where(dataset_taxonomy_association.c.dataset_id == dataset.id)
        .where(Taxonomy.is_deleted == False)
    )
    existing_taxonomies = list(taxonomy_result.scalars().all())
    
    if existing_taxonomies:
        taxonomy = existing_taxonomies[0]
        existing_class_ids = {cls.get("id", "").lower() for cls in (taxonomy.classes or [])}
        existing_class_names = {cls.get("name", "").lower() for cls in (taxonomy.classes or [])}
        
        new_classes = []
        color_idx = len(taxonomy.classes or [])
        
        for class_label in sorted(discovered_classes):
            if class_label.lower() not in existing_class_ids and class_label.lower() not in existing_class_names:
                new_classes.append({
                    "id": class_label,
                    "name": class_label,
                    "color": AUTO_CLASS_COLORS[color_idx % len(AUTO_CLASS_COLORS)],
                    "type": ["cuboid", "box2d"],
                    "attributes": {},
                })
                color_idx += 1
        
        if new_classes:
            updated_classes = list(taxonomy.classes or []) + new_classes
            taxonomy.classes = updated_classes
            await db.flush()
            print(f"[DERIVE TAXONOMY] Merged {len(new_classes)} new classes into existing taxonomy '{taxonomy.name}'")
            print(f"[DERIVE TAXONOMY] New classes: {[c['name'] for c in new_classes]}")
        else:
            print(f"[DERIVE TAXONOMY] All discovered classes already exist in taxonomy '{taxonomy.name}'")
        
        return taxonomy
    
    else:
        taxonomy_classes = []
        for idx, class_label in enumerate(sorted(discovered_classes)):
            taxonomy_classes.append({
                "id": class_label,
                "name": class_label,
                "color": AUTO_CLASS_COLORS[idx % len(AUTO_CLASS_COLORS)],
                "type": ["cuboid", "box2d"],
                "attributes": {},
            })
        
        taxonomy = Taxonomy(
            organization_id=dataset.campaign.organization_id,
            name=f"Auto-derived from {dataset.name}",
            description=f"Taxonomy automatically derived from imported annotations for dataset '{dataset.name}'",
            classes=taxonomy_classes,
            is_deleted=False,
        )
        db.add(taxonomy)
        await db.flush()
        
        await db.execute(
            dataset_taxonomy_association.insert().values(
                dataset_id=dataset.id,
                taxonomy_id=taxonomy.id,
            )
        )
        await db.flush()
        
        print(f"[DERIVE TAXONOMY] Created new taxonomy '{taxonomy.name}' with {len(taxonomy_classes)} classes")
        print(f"[DERIVE TAXONOMY] Classes: {[c['name'] for c in taxonomy_classes]}")
        
        return taxonomy


def _read_segmentation_class_order(annotations_dir: Path) -> List[str]:
    """Return segmentation class names ordered so index i == stored label i.

    Reads the exported ``labels_info.json`` (sibling of the ``*.label`` files).
    Its ``class_distribution`` is keyed by 1-based KITTI-semantic id (1=first
    class); imported labels are stored 0-based (id-1). So class id ``k`` maps to
    taxonomy index ``k-1``. Missing ids are filled with placeholders so the
    positional mapping stays intact.
    """
    info_files = list(annotations_dir.rglob("labels_info.json"))
    if not info_files:
        return []
    try:
        info = json.loads(info_files[0].read_text())
    except Exception:
        return []

    id_to_name: Dict[int, str] = {}
    for frame in info.get("frames", []):
        for sid, meta in (frame.get("class_distribution") or {}).items():
            try:
                cid = int(sid)
            except (TypeError, ValueError):
                continue
            name = (meta or {}).get("name") if isinstance(meta, dict) else None
            if cid >= 1 and name and cid not in id_to_name:
                id_to_name[cid] = name
    if not id_to_name:
        return []

    max_id = max(id_to_name)
    return [id_to_name.get(i, f"class_{i}") for i in range(1, max_id + 1)]


async def ensure_segmentation_taxonomy(
    db: AsyncSession,
    scene: Scene,
    ordered_class_names: List[str],
) -> Optional[Taxonomy]:
    """Ensure the scene's dataset has a ``segmentation_3d`` taxonomy whose class
    ORDER matches the stored 0-based per-point labels (index 0 = first class).

    The 3D segmentation editor colors points by the 0-based position of each
    class in a ``segmentation_3d`` taxonomy (``classColors.set(index, color)``).
    Without a matching taxonomy the imported labels load but render colorless, so
    we derive one from the export's class order. No-ops if the dataset already
    has a ``segmentation_3d`` taxonomy.
    """
    if not ordered_class_names:
        return None

    existing = await db.execute(
        select(Taxonomy)
        .join(dataset_taxonomy_association)
        .where(dataset_taxonomy_association.c.dataset_id == scene.dataset_id)
        .where(Taxonomy.annotation_mode == "segmentation_3d")
        .where(Taxonomy.is_deleted == False)
    )
    existing_tax = existing.scalars().first()
    if existing_tax:
        return existing_tax

    dataset = (await db.execute(
        select(Dataset).where(Dataset.id == scene.dataset_id)
    )).scalar_one_or_none()
    if not dataset:
        return None
    campaign = (await db.execute(
        select(Campaign).where(Campaign.id == dataset.campaign_id)
    )).scalar_one_or_none()
    if not campaign:
        return None

    classes = [
        {
            "id": name,
            "name": name.replace("_", " ").title(),
            "color": AUTO_CLASS_COLORS[idx % len(AUTO_CLASS_COLORS)],
            "type": ["segmentation_3d"],
            "attributes": {},
        }
        for idx, name in enumerate(ordered_class_names)
    ]

    # Avoid duplicate taxonomies: if the organization already has a
    # segmentation_3d taxonomy with the identical, identically-ordered class set,
    # reuse it (link it to this dataset) instead of minting a new one. The class
    # ORDER must match exactly because per-point labels are stored as 0-based
    # indices into the class list.
    signature = [c["id"] for c in classes]
    org_taxes = await db.execute(
        select(Taxonomy).where(
            Taxonomy.organization_id == campaign.organization_id,
            Taxonomy.annotation_mode == "segmentation_3d",
            Taxonomy.is_deleted == False,
        )
    )
    for cand in org_taxes.scalars().all():
        if [c.get("id") for c in (cand.classes or [])] == signature:
            await db.execute(
                dataset_taxonomy_association.insert().values(
                    dataset_id=scene.dataset_id,
                    taxonomy_id=cand.id,
                    mode="segmentation_3d",
                    is_primary=True,
                )
            )
            await db.flush()
            print(f"[IMPORT] Reused existing segmentation_3d taxonomy '{cand.name}' ({cand.id})")
            return cand

    taxonomy = Taxonomy(
        organization_id=campaign.organization_id,
        name=f"{dataset.name} — 3D Segmentation",
        description="Derived from imported 3D segmentation labels (labels_info.json).",
        annotation_mode="segmentation_3d",
        classes=classes,
        is_deleted=False,
    )
    db.add(taxonomy)
    await db.flush()
    await db.execute(
        dataset_taxonomy_association.insert().values(
            dataset_id=scene.dataset_id,
            taxonomy_id=taxonomy.id,
            mode="segmentation_3d",
            is_primary=True,
        )
    )
    await db.flush()
    print(f"[IMPORT] Created segmentation_3d taxonomy with {len(classes)} classes: {[c['name'] for c in classes]}")
    return taxonomy


def build_class_mapping(taxonomy_classes: list) -> dict:
    """
    Build a mapping from various class name formats to taxonomy class IDs.
    Handles case-insensitive matching and common naming variations.
    
    Args:
        taxonomy_classes: List of taxonomy class dicts with 'id' and 'name' keys
        
    Returns:
        Dict mapping lowercase class names/variations to taxonomy class IDs
    """
    mapping = {}
    
    for cls in taxonomy_classes:
        class_id = cls.get("id", "")
        class_name = cls.get("name", "")
        
        if not class_id:
            continue
        
        mapping[class_id.lower()] = class_id
        
        if class_name:
            mapping[class_name.lower()] = class_id
        
        name_lower = class_name.lower()
        id_lower = class_id.lower()
        
        mapping[name_lower.replace("_", " ")] = class_id
        mapping[name_lower.replace(" ", "_")] = class_id
        mapping[id_lower.replace("_", " ")] = class_id
        mapping[id_lower.replace(" ", "_")] = class_id
        
        mapping[name_lower.replace("-", "_")] = class_id
        mapping[name_lower.replace("-", " ")] = class_id
        
        if "_" in id_lower:
            last_part = id_lower.split("_")[-1]
            if last_part not in mapping:
                mapping[last_part] = class_id
        
        if "_" in name_lower:
            last_part = name_lower.split("_")[-1]
            if last_part not in mapping:
                mapping[last_part] = class_id
    
    return mapping


def map_class_to_taxonomy(class_label: str, class_mapping: dict) -> str:
    """
    Map an imported class label to a taxonomy class ID.
    
    Args:
        class_label: The class label from imported annotations
        class_mapping: Dict from build_class_mapping()
        
    Returns:
        Mapped taxonomy class ID, or original label if no match found
    """
    label_lower = class_label.lower().strip()
    
    if label_lower in class_mapping:
        return class_mapping[label_lower]
    
    if label_lower.replace("_", " ") in class_mapping:
        return class_mapping[label_lower.replace("_", " ")]
    if label_lower.replace(" ", "_") in class_mapping:
        return class_mapping[label_lower.replace(" ", "_")]
    
    if label_lower.replace("-", "_") in class_mapping:
        return class_mapping[label_lower.replace("-", "_")]
    
    print(f"[IMPORT] Warning: Class '{class_label}' not found in taxonomy, using as-is")
    return class_label


async def import_scene_annotations(
    db: AsyncSession,
    scene: Scene,
    scene_dir: Path,
    task: Task,
    overwrite: bool = False,
) -> tuple[int, int]:
    """Import annotations from a scene directory if they exist.
    
    Looks for:
    - annotations/lidar/*.txt (KITTI format 3D annotations)
    - label_2/*.txt (standard KITTI folder naming)
    - annotations/*.json (COCO format 2D annotations)
    - annotations/tasks/*/*.json (v3 per-task scene export layout)
    
    Also checks parent directory for annotations folder (for structures like scene/data/ and scene/annotations/)
    
    Performs taxonomy sync: maps imported class labels to existing taxonomy classes
    using case-insensitive matching and common naming variations.
    
    Args:
        db: Database session
        scene: Scene to import annotations for
        scene_dir: Path to scene directory
        task: Task to associate annotations with
        overwrite: If True, delete existing annotations for this task before importing
    
    Returns:
        Tuple of (annotations_3d_count, annotations_2d_count)
    """
    from sqlalchemy import delete
    
    print(f"[DEBUG] import_scene_annotations called for scene {scene.name} at {scene_dir}")
    
    if overwrite:
        deleted_3d = await db.execute(delete(Annotation3D).where(Annotation3D.task_id == task.id))
        deleted_2d = await db.execute(delete(Annotation2D).where(Annotation2D.task_id == task.id))
        await db.execute(delete(Track2D).where(Track2D.task_id == task.id))
        print(f"[IMPORT] Overwrite mode: Deleted {deleted_3d.rowcount} 3D and {deleted_2d.rowcount} 2D existing annotations")
    
    annotations_dir = scene_dir / "annotations"
    print(f"[DEBUG] Checking annotations_dir: {annotations_dir}, exists: {annotations_dir.exists()}")
    
    if not annotations_dir.exists():
        parent_annotations_dir = scene_dir.parent / "annotations"
        print(f"[DEBUG] Checking parent annotations_dir: {parent_annotations_dir}, exists: {parent_annotations_dir.exists()}")
        if parent_annotations_dir.exists():
            annotations_dir = parent_annotations_dir
    
    if not annotations_dir.exists():
        print(f"[DEBUG] No annotations directory found, returning 0,0")

        return 0, 0
    
    class_mapping = {}
    class_info_by_id: Dict[str, Dict[str, Any]] = {}
    if scene.dataset_id:
        taxonomy_result = await db.execute(
            select(Taxonomy)
            .join(dataset_taxonomy_association)
            .where(dataset_taxonomy_association.c.dataset_id == scene.dataset_id)
            .where(Taxonomy.is_deleted == False)
        )
        taxonomies = taxonomy_result.scalars().all()

        for taxonomy in taxonomies:
            if taxonomy.classes:
                mapping = build_class_mapping(taxonomy.classes)
                class_mapping.update(mapping)
                for cls in taxonomy.classes:
                    cid = cls.get("id")
                    if cid:
                        class_info_by_id[cid] = {"name": cls.get("name") or cid, "color": cls.get("color")}
                print(f"[DEBUG] Loaded {len(taxonomy.classes)} classes from taxonomy '{taxonomy.name}'")
    
    if class_mapping:
        print(f"[DEBUG] Built class mapping with {len(class_mapping)} entries")
    else:
        print(f"[DEBUG] No taxonomy found for dataset, using raw class labels")
    
    annotations_3d_count = 0
    annotations_2d_count = 0

    imported_tracks_2d: Dict[uuid.UUID, Dict[str, Any]] = {}
    track_meta_overrides: Dict[uuid.UUID, Dict[str, Any]] = {}

    default_camera_id = "default"
    frames_result = await db.execute(
        select(Frame).where(Frame.scene_id == scene.id).order_by(Frame.frame_index)
    )
    frames = list(frames_result.scalars().all())
    frame_by_index = {f.frame_index: f for f in frames}
    if frames:
        first_paths = frames[0].file_paths or {}
        cameras = first_paths.get("cameras") or {}
        if cameras:
            default_camera_id = next(iter(cameras.keys()))

    task_taxonomy_result = await db.execute(
        select(Task, Taxonomy)
        .outerjoin(Taxonomy, Task.taxonomy_id == Taxonomy.id)
        .where(Task.scene_id == scene.id, Task.is_deleted == False)
        .order_by(Task.created_at.asc())
    )
    tasks_with_taxonomy: List[Tuple[Task, Optional[str]]] = [
        (t, tx.name if tx else None) for t, tx in task_taxonomy_result.all()
    ]
    print(f"[DEBUG] Loaded {len(tasks_with_taxonomy)} tasks for multi-taxonomy routing")

    lidar_annotations_dir = annotations_dir / "lidar"
    if not lidar_annotations_dir.exists():
        lidar_annotations_dir = annotations_dir / "label_2"
    if not lidar_annotations_dir.exists():
        lidar_annotations_dir = scene_dir / "label_2"
    if lidar_annotations_dir.exists():
        txt_files = sorted([f for f in lidar_annotations_dir.iterdir() if f.suffix == ".txt"])
        for txt_file in txt_files:
            try:
                frame_index = int(txt_file.stem)
            except ValueError:
                continue
            
            frame = frame_by_index.get(frame_index)
            if not frame:
                continue
            
            with open(txt_file, "r") as f:
                for line in f:
                    parts = line.strip().split()
                    if len(parts) < 15:
                        continue
                    
                    class_label = parts[0]
                    if class_label.lower() == "dontcare":
                        continue
                    
                    try:
                        height = float(parts[8])
                        width = float(parts[9])
                        length = float(parts[10])
                        x = float(parts[11])
                        y = float(parts[12])
                        z = float(parts[13])
                        rotation_y = float(parts[14])
                        
                        mapped_class_id = map_class_to_taxonomy(class_label, class_mapping) if class_mapping else class_label
                        
                        annotation_3d = Annotation3D(
                            task_id=task.id,
                            frame_id=frame.id,
                            type="cuboid",
                            class_id=mapped_class_id,
                            taxonomy_id=task.taxonomy_id,
                            data={
                                "center": {"x": x, "y": y, "z": z},
                                "dimensions": {"length": length, "width": width, "height": height},
                                "rotation": {"yaw": rotation_y, "pitch": 0.0, "roll": 0.0}
                            },
                            source="auto",
                        )
                        db.add(annotation_3d)
                        annotations_3d_count += 1
                    except (ValueError, IndexError):
                        continue
    
    json_files = sorted(
        [
            f for f in annotations_dir.rglob("*.json")
            if f.is_file() and f.name != "metadata.json"
        ],
        key=lambda p: str(p),
    )
    for json_file in json_files:
        annotation_task = task
        if json_file.parent.parent.name == "tasks":
            matched_task = match_folder_to_task(json_file.parent.name, tasks_with_taxonomy)
            if matched_task:
                annotation_task = matched_task
                print(f"[DEBUG] Routing '{json_file.name}' in '{json_file.parent.name}' -> task '{matched_task.name}'")
            else:
                print(f"[DEBUG] No task match for folder '{json_file.parent.name}', using default task")

        camera_name = json_file.stem
        
        try:
            with open(json_file, "r") as f:
                coco_data = json.load(f)

            info = coco_data.get("info") or {}
            info_description = str(info.get("description") or "").strip()
            if info_description.lower().startswith("annotations for camera:"):
                extracted_camera = info_description.split(":", 1)[1].strip()
                if extracted_camera:
                    camera_name = extracted_camera
            elif camera_name.lower() in {"default", "images", "camera"}:
                camera_name = default_camera_id
            
            if "annotations" not in coco_data or "images" not in coco_data:
                continue

            for tr in coco_data.get("tracks", []):
                raw_tid = tr.get("id")
                if not raw_tid:
                    continue
                try:
                    tid = uuid.UUID(str(raw_tid))
                except (ValueError, AttributeError, TypeError):
                    continue
                track_meta_overrides[tid] = tr
            
            image_id_to_frame = {}
            for img in coco_data.get("images", []):
                frame_index = img.get("frame_index")
                if isinstance(frame_index, int):
                    image_id_to_frame[img["id"]] = frame_index
                    continue

                file_name = img.get("file_name", "")
                try:
                    parsed_index = int(Path(file_name).stem)
                    image_id_to_frame[img["id"]] = parsed_index
                except (ValueError, KeyError, TypeError):
                    continue
            
            for ann in coco_data.get("annotations", []):
                image_id = ann.get("image_id")
                frame_index = image_id_to_frame.get(image_id)
                if frame_index is None:
                    continue
                
                frame = frame_by_index.get(frame_index)
                if not frame:
                    continue
                
                category_id = ann.get("category_id")
                class_label = None
                for cat in coco_data.get("categories", []):
                    if cat["id"] == category_id:
                        class_label = cat.get("name", str(category_id))
                        break
                if not class_label:
                    class_label = ann.get("class")
                if not class_label:
                    class_label = str(category_id)
                
                mapped_class_id = map_class_to_taxonomy(class_label, class_mapping) if class_mapping else class_label

                ann_type = ann.get("type", "box2d").lower()
                ann_db_type: str
                ann_db_data: dict

                if ann_type in ("polyline", "line", "bezier"):
                    raw_polyline = ann.get("polyline")
                    if raw_polyline and isinstance(raw_polyline, list):
                        points = [{"x": p[0], "y": p[1]} for p in raw_polyline if len(p) >= 2]
                    else:
                        seg = ann.get("segmentation")
                        flat = seg[0] if seg and isinstance(seg, list) and seg else []
                        points = [{"x": flat[i], "y": flat[i + 1]} for i in range(0, len(flat) - 1, 2)]
                    if not points:
                        continue
                    ann_db_type = "polyline"
                    ann_db_data = {"points": points, "isBezier": False}

                elif ann_type in ("polygon", "semantic_segment"):
                    raw_polygon = ann.get("polygon")
                    if raw_polygon and isinstance(raw_polygon, list):
                        points = [{"x": p[0], "y": p[1]} for p in raw_polygon if len(p) >= 2]
                    else:
                        seg = ann.get("segmentation")
                        flat = seg[0] if seg and isinstance(seg, list) and seg else []
                        points = [{"x": flat[i], "y": flat[i + 1]} for i in range(0, len(flat) - 1, 2)]
                    if not points:
                        continue
                    if ann_type == "semantic_segment":
                        ann_db_type = "semantic_segment"
                        ann_db_data = {"polygon": points, "isClosed": True}
                    else:
                        ann_db_type = "polygon"
                        ann_db_data = {"points": points}

                elif ann_type == "ellipse":
                    ed = ann.get("ellipse")
                    if ed and isinstance(ed, dict):
                        ann_db_type = "ellipse"
                        ann_db_data = {"cx": ed["cx"], "cy": ed["cy"], "rx": ed["rx"], "ry": ed["ry"]}
                    else:
                        bbox = ann.get("bbox", [])
                        if len(bbox) < 4:
                            continue
                        ann_db_type = "ellipse"
                        ann_db_data = {"cx": bbox[0] + bbox[2] / 2, "cy": bbox[1] + bbox[3] / 2,
                                       "rx": bbox[2] / 2, "ry": bbox[3] / 2}

                elif ann_type in ("rotated_box", "rotated_rectangle"):
                    rb = ann.get("rotated_box")
                    if rb and isinstance(rb, dict):
                        ann_db_type = "rotated_box"
                        ann_db_data = {"cx": rb["cx"], "cy": rb["cy"],
                                       "width": rb["width"], "height": rb["height"],
                                       "rotation": rb.get("angle", rb.get("rotation", 0))}
                    else:
                        bbox = ann.get("bbox", [])
                        if len(bbox) < 4:
                            continue
                        ann_db_type = "rotated_box"
                        ann_db_data = {"cx": bbox[0] + bbox[2] / 2, "cy": bbox[1] + bbox[3] / 2,
                                       "width": bbox[2], "height": bbox[3], "rotation": 0.0}

                elif ann_type in ("keypoints", "points"):
                    kf = ann.get("keypoints")
                    knames = ann.get("keypoint_names", [])
                    if kf and isinstance(kf, list):
                        pts = []
                        for i in range(0, len(kf), 3):
                            label = knames[i // 3] if i // 3 < len(knames) else f"P{i // 3 + 1}"
                            pts.append({"x": kf[i], "y": kf[i + 1], "label": label,
                                        "visibility": int(kf[i + 2]) if i + 2 < len(kf) else 2})
                        ann_db_type = "keypoints"
                        ann_db_data = {"points": pts}
                    else:
                        bbox = ann.get("bbox", [0, 0, 0, 0])
                        ann_db_type = "box2d"
                        ann_db_data = {"bbox": {"x": bbox[0], "y": bbox[1], "width": bbox[2], "height": bbox[3]}}

                else:
                    bbox = ann.get("bbox", [])
                    if len(bbox) < 4:
                        continue
                    ann_db_type = "box2d"
                    ann_db_data = {"bbox": {"x": bbox[0], "y": bbox[1], "width": bbox[2], "height": bbox[3]}}

                source_track_uuid: Optional[uuid.UUID] = None
                raw_track_id = ann.get("track_id")
                if raw_track_id:
                    try:
                        source_track_uuid = uuid.UUID(str(raw_track_id))
                    except (ValueError, AttributeError, TypeError):
                        source_track_uuid = None

                new_track_uuid: Optional[uuid.UUID] = None
                if source_track_uuid is not None:
                    track_meta = imported_tracks_2d.get(source_track_uuid)
                    if track_meta is None:
                        new_track_uuid = uuid.uuid4()
                        imported_tracks_2d[source_track_uuid] = {
                            "new_id": new_track_uuid,
                            "task_id": annotation_task.id,
                            "camera_id": camera_name,
                            "class_id": mapped_class_id,
                            "start_frame_index": frame_index,
                            "end_frame_index": frame_index,
                        }
                    else:
                        new_track_uuid = track_meta["new_id"]
                        track_meta["start_frame_index"] = min(track_meta["start_frame_index"], frame_index)
                        track_meta["end_frame_index"] = max(track_meta["end_frame_index"], frame_index)

                annotation_2d = Annotation2D(
                    task_id=annotation_task.id,
                    frame_id=frame.id,
                    camera_id=camera_name,
                    type=ann_db_type,
                    class_id=mapped_class_id,
                    taxonomy_id=annotation_task.taxonomy_id,
                    data=ann_db_data,
                    attributes=ann.get("attributes", {}),
                    track_id=new_track_uuid,
                    source="auto",
                )
                db.add(annotation_2d)
                annotations_2d_count += 1
        except Exception:
            continue

    for source_track_uuid, track_meta in imported_tracks_2d.items():
        override = track_meta_overrides.get(source_track_uuid, {})
        start_idx = override.get("start_frame_index")
        end_idx = override.get("end_frame_index")

        class_id = track_meta["class_id"]
        class_info = class_info_by_id.get(class_id, {})

        name = override.get("name")
        if not name:
            name = f"{class_id}_{track_meta['new_id']}"

        color = override.get("color") or class_info.get("color")

        db.add(Track2D(
            id=track_meta["new_id"],
            task_id=track_meta["task_id"],
            camera_id=track_meta["camera_id"],
            class_id=class_id,
            name=name,
            color=color,
            start_frame_index=start_idx if start_idx is not None else track_meta["start_frame_index"],
            end_frame_index=end_idx if end_idx is not None else track_meta["end_frame_index"],
            is_interpolated=bool(override.get("is_interpolated", False)),
            is_complete=bool(override.get("is_complete", False)),
            attributes=override.get("attributes") or {},
        ))
    if imported_tracks_2d:
        print(f"[IMPORT] Recreated {len(imported_tracks_2d)} 2D track(s) from imported annotations")

    try:
        label_files = sorted(annotations_dir.rglob("*.label"))
        if label_files:
            seg_dir = os.path.join(SEGMENTATION_ROOT, str(scene.id))
            os.makedirs(seg_dir, exist_ok=True)

            seg_frames_imported = 0
            for label_file in label_files:
                try:
                    frame_index = int(label_file.stem.lstrip("0") or "0")
                except ValueError:
                    print(f"[IMPORT] Cannot parse frame index from {label_file.name}")
                    continue

                frame = frame_by_index.get(frame_index)
                if not frame:
                    print(f"[IMPORT] No frame for index {frame_index} ({label_file.name})")
                    continue

                kitti = np.frombuffer(label_file.read_bytes(), dtype=np.uint32)

                semantic = (kitti & 0xFFFF).astype(np.int32)
                instances = (kitti >> 16).astype(np.int32)

                labels = np.where(semantic == 0, -1, semantic - 1).astype(np.int32)
                inst_arr = np.where(instances == 0, -1, instances).astype(np.int32)

                # Write BOTH segmentation layers. The editor opens in semantic mode
                # and renders the semantic layer (`_semantic.npy`); it also reads the
                # instance layer (`.npy` + `_instances.npy`). Writing only the instance
                # layer left the default semantic view empty ("labels not seen").
                np.save(os.path.join(seg_dir, f"{frame.id}_semantic.npy"), labels)
                np.save(os.path.join(seg_dir, f"{frame.id}.npy"), labels)
                if np.any(inst_arr >= 0):
                    np.save(os.path.join(seg_dir, f"{frame.id}_instances.npy"), inst_arr)

                seg_frames_imported += 1

            if seg_frames_imported:
                print(f"[IMPORT] Restored 3D segmentation for {seg_frames_imported} frame(s)")
                # Ensure the dataset has a segmentation_3d taxonomy whose class order
                # matches the stored 0-based labels, so the editor can color points.
                try:
                    ordered = _read_segmentation_class_order(annotations_dir)
                    if ordered:
                        seg_tax = await ensure_segmentation_taxonomy(db, scene, ordered)
                        # Bind the import task to the segmentation taxonomy. The task
                        # is created at scene-creation time — before this taxonomy
                        # exists — so it starts with taxonomy_id=None; wire it up here
                        # so it becomes a proper segmentation task (correct editor,
                        # task lists, workflow).
                        if seg_tax and task is not None and getattr(task, "taxonomy_id", None) is None:
                            task.taxonomy_id = seg_tax.id
                            await db.flush()
                except Exception as tax_err:
                    print(f"[IMPORT] Could not derive segmentation taxonomy: {tax_err}")
    except Exception as e:
        import traceback
        print(f"[IMPORT] Error restoring 3D segmentation: {type(e).__name__}: {str(e) or traceback.format_exc()}")

    return annotations_3d_count, annotations_2d_count


@router.post("/check-scene-names", response_model=SceneNameCheckResponse)
async def check_scene_names(
    request: SceneNameCheckRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> SceneNameCheckResponse:
    """Check which scene folder names already exist in the dataset before uploading."""
    conflicts: List[SceneConflict] = []
    for i, folder_name in enumerate(request.folder_names):
        scene_name = folder_name if request.preserve_folder_names else generate_smart_scene_name(folder_name, i + 1)
        result = await db.execute(
            select(Scene).where(
                Scene.dataset_id == request.dataset_id,
                Scene.name == scene_name,
                Scene.is_deleted == False,
            )
        )
        if result.scalar_one_or_none():
            suggested = f"{scene_name}_upload-{datetime.now().strftime('%Y%m%d_%H%M')}"
            conflicts.append(SceneConflict(original_name=scene_name, suggested_name=suggested))
    return SceneNameCheckResponse(conflicts=conflicts)


@router.post("/upload", response_model=ImportResponse)
async def upload_and_import_dataset(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_IMPORT))],
    dataset_id: str = Form(...),
    files: List[UploadFile] = File(...),
    derive_taxonomy: bool = Form(False),
    overwrite_annotations: bool = Form(False),
    preserve_folder_names: bool = Form(True),
    db: AsyncSession = Depends(get_db),
) -> ImportResponse:
    """
    Upload files from user's browser and import them as a dataset.
    Requires DATASETS_IMPORT permission.
    
    Files should be uploaded with their relative paths preserved.
    Files are stored permanently in /uploads/{dataset_id}/{scene_name}/
    
    Args:
        dataset_id: ID of the dataset to import into
        files: List of files to upload
        derive_taxonomy: If True, scan annotations and create/merge taxonomy from discovered classes
        overwrite_annotations: If True, delete existing annotations before importing new ones
        preserve_folder_names: If True, keep original folder names; if False, apply smart naming
    """
    query = select(Dataset).options(selectinload(Dataset.campaign)).where(Dataset.id == UUID(dataset_id))
    result = await db.execute(query)
    dataset = result.scalar_one_or_none()
    
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset not found: {dataset_id}"
        )
    
    dataset_upload_dir = UPLOAD_DIR / dataset_id
    dataset_upload_dir.mkdir(parents=True, exist_ok=True)
    
    temp_dir = tempfile.mkdtemp(prefix="dataset_upload_")
    
    try:
        for file in files:
            raw_path = file.filename or "unknown"

            relative_path = validate_upload_path(raw_path)

            content = await file.read()

            leaf_name = Path(relative_path).name
            leaf_ext = Path(leaf_name).suffix.lower()
            if leaf_ext in DATA_EXTENSIONS:
                validate_magic_bytes(content, leaf_name)

            file_path = Path(temp_dir) / relative_path
            file_path.parent.mkdir(parents=True, exist_ok=True)

            with open(file_path, "wb") as f:
                f.write(content)

        root_path = Path(temp_dir)
        
        print(f"[IMPORT DEBUG] Initial root_path: {root_path}")
        print(f"[IMPORT DEBUG] Contents: {list(root_path.iterdir())}")
        
        subdirs = [d for d in root_path.iterdir() if d.is_dir()]
        if len(subdirs) == 1 and not (root_path / "metadata.json").exists():
            root_path = subdirs[0]
        
        scenes_imported = 0
        frames_imported = 0
        errors: List[str] = []
        renamed_scenes: List[RenamedScene] = []

        metadata_path = root_path / "metadata.json"
        dataset_metadata = None
        if metadata_path.exists():
            with open(metadata_path) as f:
                dataset_metadata = json.load(f)
        
        calibration_data = {}
        calibration_path = root_path / "calibration"
        if calibration_path.exists():
            calibration_data = parse_calibration_file(calibration_path)
        
        def find_data_files(directory: Path) -> List[Path]:
            """Find all supported image and point cloud files in a directory."""
            supported_extensions = {".jpg", ".jpeg", ".png", ".pcd", ".bin", ".ply", ".gif", ".bmp", ".tiff", ".tif"}
            files = []
            for f in directory.iterdir():
                if f.is_file() and f.suffix.lower() in supported_extensions:
                    files.append(f)
            return sorted(files, key=lambda x: x.name)
        
        def is_scene_folder(directory: Path) -> bool:
            """Check if directory looks like a scene (has sensor data folders)."""
            sensor_folders = {"cameras", "lidar", "images", "pointcloud", "velodyne"}
            for item in directory.iterdir():
                if item.is_dir() and item.name.lower() in sensor_folders:
                    return True
            if (directory / "calibration.json").exists():
                return True
            return False
        
        scene_dirs = []
        scene_parent_names = {}
        
        if is_scene_folder(root_path):
            scene_dirs = [root_path]
        else:
            for item in root_path.iterdir():
                if item.is_dir() and item.name not in ["calibration", "metadata", "__MACOSX"]:
                    if is_scene_folder(item):
                        scene_dirs.append(item)
                        if item.name.lower() in GENERIC_FOLDER_NAMES and root_path.name.lower() not in GENERIC_FOLDER_NAMES:
                            scene_parent_names[item] = root_path.name
            
            if not scene_dirs:
                print(f"[IMPORT DEBUG] No scene folders found, checking for flat image structure...")
                root_data_files = find_data_files(root_path)
                print(f"[IMPORT DEBUG] Found {len(root_data_files)} data files in root")
                if root_data_files:
                    scene_dirs = [root_path]
                else:
                    if root_path.name.lower() in ["cameras", "data"]:
                        for subdir in root_path.iterdir():
                            if subdir.is_dir():
                                subdir_files = find_data_files(subdir)
                                if subdir_files:
                                    print(f"[IMPORT DEBUG] Found {len(subdir_files)} files in {subdir.name}, treating as scene")
                                    scene_dirs.append(subdir)
        
        print(f"[IMPORT DEBUG] Scene directories to import: {[d.name for d in scene_dirs]}")
        print(f"[IMPORT DEBUG] Number of scene_dirs: {len(scene_dirs)}")
        
        if derive_taxonomy and scene_dirs:
            print(f"[IMPORT] derive_taxonomy=True, scanning annotations for classes...")
            discovered_classes = scan_annotations_for_classes(scene_dirs)
            if discovered_classes:
                taxonomy = await derive_and_merge_taxonomy(
                    db=db,
                    dataset=dataset,
                    discovered_classes=discovered_classes,
                    user_id=current_user.id,
                )
                if taxonomy:
                    errors.append(f"Taxonomy: Created/updated '{taxonomy.name}' with {len(taxonomy.classes)} classes")
            else:
                errors.append("Taxonomy: No annotation classes found to derive")
        
        for scene_index, scene_dir in enumerate(scene_dirs, start=1):
            try:
                raw_folder_name = scene_parent_names.get(scene_dir, scene_dir.name)
                
                if preserve_folder_names and raw_folder_name.lower() not in GENERIC_FOLDER_NAMES:
                    scene_name = raw_folder_name
                else:
                    scene_name = generate_smart_scene_name(raw_folder_name, scene_index)
                
                scene_meta_path = scene_dir / "scene_metadata.json"
                scene_meta = {}
                if scene_meta_path.exists():
                    with open(scene_meta_path) as f:
                        scene_meta = json.load(f)
                
                lidar_path = scene_dir / "lidar"
                cameras_path = scene_dir / "cameras"
                images_path = scene_dir / "images"
                
                frame_count = 0
                data_files: List[Path] = []
                data_source = "unknown"
                
                if lidar_path.exists():
                    data_files = [f for f in lidar_path.iterdir() if f.suffix.lower() in [".pcd", ".bin", ".ply"]]
                    data_source = "lidar"
                elif cameras_path.exists():
                    for cam_dir in cameras_path.iterdir():
                        if cam_dir.is_dir():
                            data_files = [f for f in cam_dir.iterdir() if f.suffix.lower() in [".jpg", ".png", ".jpeg"]]
                            data_source = f"camera:{cam_dir.name}"
                            break
                elif images_path.exists():
                    data_files = [f for f in images_path.iterdir() if f.suffix.lower() in [".jpg", ".png", ".jpeg", ".gif", ".bmp", ".tiff", ".tif"]]
                    data_source = "images"
                else:
                    data_files = find_data_files(scene_dir)
                    data_source = "direct"
                
                data_files = sorted(data_files, key=lambda x: x.name)
                frame_count = len(data_files)
                
                if frame_count == 0:
                    errors.append(f"Scene {scene_name}: No frames detected")
                    continue
                
                scene_id = uuid.uuid4()
                permanent_scene_dir = dataset_upload_dir / str(scene_id)
                permanent_scene_dir.mkdir(parents=True, exist_ok=True)
                
                for item in scene_dir.iterdir():
                    src = item
                    dst = permanent_scene_dir / item.name
                    if item.is_dir():
                        shutil.copytree(src, dst)
                    else:
                        shutil.copy2(src, dst)
                
                uuid_rename_map = rename_data_files_to_uuid(permanent_scene_dir, DATA_EXTENSIONS)

                org_id_val = dataset.campaign.organization_id
                asyncio.get_event_loop().run_in_executor(
                    None, _mirror_scene_to_minio,
                    org_id_val, dataset.id, scene_id, permanent_scene_dir,
                )

                parent_dir = scene_dir.parent
                if parent_dir != scene_dir:
                    sibling_annotations = parent_dir / "annotations"
                    if sibling_annotations.exists() and sibling_annotations.is_dir():
                        annotations_dst = permanent_scene_dir / "annotations"
                        if not annotations_dst.exists():
                            try:
                                shutil.copytree(sibling_annotations, annotations_dst)
                            except Exception as e:
                                errors.append(f"Scene {scene_name}: Failed to copy annotations folder: {str(e)}")

                permanent_lidar_path = permanent_scene_dir / "lidar"
                permanent_images_path = permanent_scene_dir / "images"
                permanent_cameras_path = permanent_scene_dir / "cameras"
                
                relative_path_base = f"uploads/{dataset.id}/{scene_id}"
                
                cameras_storage_paths: Dict[str, str] = {}
                if permanent_cameras_path.exists():
                    for cam_dir in permanent_cameras_path.iterdir():
                        if cam_dir.is_dir():
                            cameras_storage_paths[cam_dir.name] = f"{relative_path_base}/cameras/{cam_dir.name}"

                permanent_ego_poses_file = permanent_scene_dir / "ego_poses" / "poses.json"
                if not permanent_ego_poses_file.exists():
                    permanent_ego_poses_file = permanent_scene_dir / "ego_poses" / "ego_poses.json"

                ego_poses_path = None
                ego_poses_data: Dict[int, Dict[str, Any]] = {}
                if permanent_ego_poses_file.exists():
                    ego_poses_path = f"{relative_path_base}/ego_poses/{permanent_ego_poses_file.name}"
                    with open(permanent_ego_poses_file, "r") as f:
                        poses_json = json.load(f)
                        if "frames" in poses_json:
                            for pose_entry in poses_json["frames"]:
                                frame_idx = pose_entry.get("frame_index", -1)
                                if frame_idx >= 0:
                                    ego_poses_data[frame_idx] = {
                                        "position": pose_entry.get("position", [0, 0, 0]),
                                        "rotation": pose_entry.get("rotation", [1, 0, 0, 0]),
                                        "velocity": pose_entry.get("velocity"),
                                        "timestamp": pose_entry.get("timestamp"),
                                    }
                else:
                    parent_metadata_file = scene_dir.parent / "metadata.json"
                    if parent_metadata_file.exists():
                        try:
                            with open(parent_metadata_file, "r") as f:
                                parent_meta = json.load(f)
                            for frame_entry in parent_meta.get("frames", []):
                                ep = frame_entry.get("ego_pose")
                                if ep and isinstance(ep, dict) and ep.get("position"):
                                    frame_idx = frame_entry.get("frame_index", -1)
                                    if frame_idx >= 0:
                                        ego_poses_data[frame_idx] = {
                                            "position": ep.get("position", [0, 0, 0]),
                                            "rotation": ep.get("rotation", [1, 0, 0, 0]),
                                            "velocity": ep.get("velocity"),
                                            "timestamp": ep.get("timestamp"),
                                        }
                            if ego_poses_data:
                                ego_poses_dir = permanent_scene_dir / "ego_poses"
                                ego_poses_dir.mkdir(exist_ok=True)
                                synth_poses_file = ego_poses_dir / "ego_poses.json"
                                poses_out = {"frames": [
                                    {"frame_index": idx, **data}
                                    for idx, data in sorted(ego_poses_data.items())
                                ]}
                                with open(synth_poses_file, "w") as f:
                                    json.dump(poses_out, f, indent=2)
                                ego_poses_path = f"{relative_path_base}/ego_poses/ego_poses.json"
                        except Exception as e:
                            print(f"[IMPORT] Failed to read ego_poses from metadata.json: {e}")

                permanent_calib_file = permanent_scene_dir / "calibration.json"
                permanent_calib_dir = permanent_scene_dir / "calibration"
                calibration_data = None
                if permanent_calib_file.exists():
                    calibration_data = parse_calibration_file(permanent_calib_file, ego_poses_data)
                elif permanent_calib_dir.exists():
                    calibration_data = parse_calibration_file(permanent_calib_dir, ego_poses_data)
                elif ego_poses_data:
                    rotation = detect_ego_to_lidar_rotation(ego_poses_data)
                    calibration_data = {
                        "lidar_to_cameras": {},
                        "ego_to_lidar": {"rotation": rotation, "translation": [0, 0, 0]},
                    }

                existing_scene_query = select(Scene).where(
                    Scene.dataset_id == dataset.id,
                    Scene.name == scene_name,
                    Scene.is_deleted == False,
                )
                existing_result = await db.execute(existing_scene_query)
                if existing_result.scalar_one_or_none():
                    original_name = scene_name
                    scene_name = f"{scene_name}_upload-{datetime.now().strftime('%Y%m%d_%H%M')}"
                    renamed_scenes.append(RenamedScene(original_name=original_name, new_name=scene_name, scene_id=str(scene_id)))

                scene = Scene(
                    id=scene_id,
                    dataset_id=dataset.id,
                    name=scene_name,
                    description=scene_meta.get("description", f"Imported scene: {scene_name}"),
                    frame_count=frame_count,
                    fps=scene_meta.get("fps", 10.0),
                    scene_metadata={
                        "location": scene_meta.get("location"),
                        "weather": scene_meta.get("weather"),
                        "time_of_day": scene_meta.get("time_of_day"),
                        "source": "browser_upload",
                        "data_source": data_source,
                    },
                    calibration=calibration_data,
                    storage_paths={
                        "root": str(permanent_scene_dir),
                        "lidar_base": f"{relative_path_base}/lidar" if permanent_lidar_path.exists() else None,
                        "images_base": f"{relative_path_base}/images" if permanent_images_path.exists() else None,
                        "cameras": cameras_storage_paths if cameras_storage_paths else None,
                        "ego_poses": ego_poses_path,
                    },
                )
                db.add(scene)
                await db.flush()
                await auto_create_tasks_for_scene(db, scene)
                await db.flush()

                permanent_data_files: List[Path] = []
                lidar_files: List[Path] = []
                camera_files: Dict[str, List[Path]] = {}
                
                if permanent_lidar_path.exists():
                    lidar_files = sorted([f for f in permanent_lidar_path.iterdir() if f.is_file()], key=lambda x: x.name)
                    permanent_data_files = lidar_files
                
                if permanent_cameras_path.exists():
                    for cam_dir in permanent_cameras_path.iterdir():
                        if cam_dir.is_dir():
                            cam_files = sorted([f for f in cam_dir.iterdir() if f.is_file()], key=lambda x: x.name)
                            if cam_files:
                                camera_files[cam_dir.name] = cam_files
                    if not permanent_data_files and camera_files:
                        first_cam = next(iter(camera_files.values()))
                        permanent_data_files = first_cam
                
                if not permanent_data_files:
                    if permanent_images_path.exists():
                        permanent_data_files = sorted([f for f in permanent_images_path.iterdir() if f.is_file()], key=lambda x: x.name)
                    else:
                        permanent_data_files = sorted(find_data_files(permanent_scene_dir), key=lambda x: x.name)
                
                if permanent_data_files and not camera_files and not lidar_files:
                    camera_name = scene_dir.name if scene_dir.name != "default_scene" else scene_name
                    camera_files = {camera_name: permanent_data_files}
                    cameras_storage_paths = {camera_name: f"{relative_path_base}"}
                    scene.storage_paths = {
                        **scene.storage_paths,
                        "cameras": cameras_storage_paths
                    }
                    attributes.flag_modified(scene, "storage_paths")
                    print(f"[IMPORT] Treating flat image structure as single camera: {camera_name}, path: {relative_path_base}")
                
                for frame_idx, data_file in enumerate(permanent_data_files):
                    frame_file_paths: Dict[str, Any] = {}
                    
                    if lidar_files and frame_idx < len(lidar_files):
                        frame_file_paths["lidar"] = lidar_files[frame_idx].name
                    
                    if camera_files:
                        cameras_dict = {}
                        for cam_name, cam_file_list in camera_files.items():
                            if frame_idx < len(cam_file_list):
                                cameras_dict[cam_name] = cam_file_list[frame_idx].name
                        if cameras_dict:
                            frame_file_paths["cameras"] = cameras_dict
                    
                    rel_key = str(data_file.relative_to(permanent_scene_dir))
                    original_name = (
                        uuid_rename_map.get(rel_key, {}).get("original_name")
                        or data_file.name
                    )
                    frame_file_paths["_meta"] = {
                        "absolute_path": str(data_file),
                        "relative_path": rel_key,
                        "original_filename": original_name,
                    }
                    
                    frame_ego_pose = ego_poses_data.get(frame_idx)
                    
                    if frame_ego_pose and isinstance(frame_ego_pose, dict) and "timestamp" in frame_ego_pose:
                        frame_timestamp = frame_ego_pose.get("timestamp")
                    else:
                        frame_timestamp = frame_idx * (1.0 / scene.fps)
                    
                    frame = Frame(
                        scene_id=scene.id,
                        frame_index=frame_idx,
                        timestamp=frame_timestamp,
                        file_paths=frame_file_paths,
                        ego_pose=frame_ego_pose if isinstance(frame_ego_pose, dict) else None,
                    )
                    db.add(frame)
                
                await db.flush()

                task = await get_or_create_scene_import_task(
                    db=db,
                    scene=scene,
                    assignee_id=current_user.id,
                    frame_count=frame_count,
                    description=f"Auto-created for {scene_name} ({frame_count} frames)",
                )
                print(f"[IMPORT] Using task {task.id} for imported annotations")
                
                try:
                    annotations_3d, annotations_2d = await import_scene_annotations(
                        db=db,
                        scene=scene,
                        scene_dir=permanent_scene_dir,
                        task=task,
                        overwrite=overwrite_annotations,
                    )
                    if annotations_3d > 0 or annotations_2d > 0:
                        errors.append(f"Scene {scene_name}: Imported {annotations_3d} 3D and {annotations_2d} 2D annotations")
                except Exception as e:
                    errors.append(f"Scene {scene_name}: Failed to import annotations: {str(e)}")
                
                scenes_imported += 1
                frames_imported += frame_count
                print(f"[IMPORT] Successfully imported scene {scene_name} with {frame_count} frames. Total: {scenes_imported} scenes, {frames_imported} frames")
                
            except Exception as e:
                import traceback
                print(f"[IMPORT ERROR] Scene {scene_dir.name}: {str(e)}")
                print(f"[IMPORT ERROR] Traceback: {traceback.format_exc()}")
                errors.append(f"Scene {scene_dir.name}: {str(e)}")
        
        await db.commit()
        
        return ImportResponse(
            success=scenes_imported > 0,
            message=f"Imported {scenes_imported} scenes with {frames_imported} frames",
            scenes_imported=scenes_imported,
            frames_imported=frames_imported,
            errors=errors,
            renamed_scenes=renamed_scenes,
        )

    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Upload failed: {str(e)}"
        )
    finally:
        try:
            shutil.rmtree(temp_dir)
        except Exception:
            pass


@router.post("/upload-zip", response_model=ImportResponse)
async def upload_zip_and_import_dataset(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_IMPORT))],
    dataset_id: str = Form(...),
    file: UploadFile = File(..., description="ZIP file containing the dataset folder"),
    derive_taxonomy: bool = Form(False),
    overwrite_annotations: bool = Form(False),
    preserve_folder_names: bool = Form(True),
    name_overrides: str = Form(default='{}'),
    scene_descriptions: str = Form(default='{}'),
    db: AsyncSession = Depends(get_db),
) -> ImportResponse:
    """
    Upload a ZIP file containing a dataset and import it.
    Requires DATASETS_IMPORT permission.
    
    Use this endpoint when you have more than 1000 files (browser limitation).
    The ZIP file should contain the dataset folder structure.
    
    Args:
        dataset_id: ID of the dataset to import into
        file: ZIP file containing the dataset
        derive_taxonomy: If True, scan annotations and create/merge taxonomy from discovered classes
        overwrite_annotations: If True, delete existing annotations before importing new ones
        preserve_folder_names: If True, keep original folder names; if False, apply smart naming
    """
    log.info(f"[ZIP IMPORT] Received upload request: dataset_id={dataset_id}, filename={file.filename}, content_type={file.content_type}")
    
    if not file.filename or not file.filename.lower().endswith('.zip'):
        log.error(f"[ZIP IMPORT] Invalid file extension: {file.filename}")
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="File must be a ZIP archive (.zip)"
        )
    validate_upload_path(file.filename)
    
    query = select(Dataset).options(selectinload(Dataset.campaign)).where(Dataset.id == UUID(dataset_id))
    result = await db.execute(query)
    dataset = result.scalar_one_or_none()
    
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset not found: {dataset_id}"
        )
    
    dataset_upload_dir = UPLOAD_DIR / dataset_id
    dataset_upload_dir.mkdir(parents=True, exist_ok=True)
    
    temp_dir = tempfile.mkdtemp(prefix="dataset_zip_upload_")
    zip_path = Path(temp_dir) / "upload.zip"
    
    try:
        print(f"[ZIP IMPORT] Receiving uploaded ZIP file...")
        file_size = 0
        chunk_size = 1024 * 1024 * 10
        
        with open(zip_path, "wb") as f:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                f.write(chunk)
                file_size += len(chunk)
                if file_size % (chunk_size * 10) == 0:
                    print(f"[ZIP IMPORT] Received {file_size / (1024*1024):.1f} MB...")
        
        print(f"[ZIP IMPORT] Uploaded file size: {file_size / (1024*1024):.1f} MB")
        print(f"[ZIP IMPORT] Extracting ZIP file...")
        extract_dir = Path(temp_dir) / "extracted"
        extract_dir.mkdir(parents=True, exist_ok=True)
        
        zip_magic = zip_path.read_bytes()[:4]
        if zip_magic != b"PK\x03\x04":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is not a valid ZIP archive (magic bytes mismatch).",
            )

        try:
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                safe_zip_extract(zip_ref, extract_dir)
        except zipfile.BadZipFile:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid or corrupted ZIP file"
            )
        
        root_path = extract_dir
        subdirs = [d for d in root_path.iterdir() if d.is_dir() and not d.name.startswith('.') and d.name != "__MACOSX"]

        if len(subdirs) == 1 and not (root_path / "metadata.json").exists():
            root_path = subdirs[0]

        try:
            name_overrides_dict: Dict[str, str] = json.loads(name_overrides)
        except Exception:
            name_overrides_dict = {}

        try:
            scene_descriptions_dict: Dict[str, str] = json.loads(scene_descriptions)
        except Exception:
            scene_descriptions_dict = {}

        scenes_imported = 0
        frames_imported = 0
        errors: List[str] = []
        renamed_scenes: List[RenamedScene] = []

        metadata_path = root_path / "metadata.json"
        dataset_metadata = None
        if metadata_path.exists():
            with open(metadata_path) as f:
                dataset_metadata = json.load(f)
        
        calibration_data = {}
        calibration_path = root_path / "calibration"
        if calibration_path.exists():
            calibration_data = parse_calibration_file(calibration_path)
        
        def find_data_files(directory: Path) -> List[Path]:
            """Find all supported image and point cloud files in a directory."""
            supported_extensions = {".jpg", ".jpeg", ".png", ".pcd", ".bin", ".ply", ".gif", ".bmp", ".tiff", ".tif"}
            files = []
            for f in directory.iterdir():
                if f.is_file() and f.suffix.lower() in supported_extensions:
                    files.append(f)
            return sorted(files, key=lambda x: x.name)
        
        def is_scene_folder(directory: Path) -> bool:
            """Check if directory looks like a scene (has sensor data folders)."""
            sensor_folders = {"cameras", "lidar", "images", "pointcloud", "velodyne"}
            for item in directory.iterdir():
                if item.is_dir() and item.name.lower() in sensor_folders:
                    return True
            if (directory / "calibration.json").exists():
                return True
            return False
        
        scene_dirs = []
        scene_parent_names = {}
        
        if is_scene_folder(root_path):
            scene_dirs = [root_path]
        else:
            for item in root_path.iterdir():
                if item.is_dir() and item.name not in ["calibration", "metadata", "__MACOSX"]:
                    if is_scene_folder(item):
                        scene_dirs.append(item)
                        if item.name.lower() in GENERIC_FOLDER_NAMES and root_path.name.lower() not in GENERIC_FOLDER_NAMES:
                            scene_parent_names[item] = root_path.name
            
            if not scene_dirs:
                root_data_files = find_data_files(root_path)
                if root_data_files:
                    scene_dirs = [root_path]
                else:
                    if root_path.name.lower() in ["cameras", "data"]:
                        for subdir in root_path.iterdir():
                            if subdir.is_dir():
                                subdir_files = find_data_files(subdir)
                                if subdir_files:
                                    scene_dirs.append(subdir)
        
        print(f"[ZIP IMPORT] Scene directories to import: {[d.name for d in scene_dirs]}")
        
        if derive_taxonomy and scene_dirs:
            print(f"[ZIP IMPORT] derive_taxonomy=True, scanning annotations for classes...")
            discovered_classes = scan_annotations_for_classes(scene_dirs)
            if discovered_classes:
                taxonomy = await derive_and_merge_taxonomy(
                    db=db,
                    dataset=dataset,
                    discovered_classes=discovered_classes,
                    user_id=current_user.id,
                )
                if taxonomy:
                    errors.append(f"Taxonomy: Created/updated '{taxonomy.name}' with {len(taxonomy.classes)} classes")
            else:
                errors.append("Taxonomy: No annotation classes found to derive")
        
        for scene_index, scene_dir in enumerate(scene_dirs, start=1):
            try:
                raw_folder_name = scene_parent_names.get(scene_dir, scene_dir.name)

                if preserve_folder_names and raw_folder_name.lower() not in GENERIC_FOLDER_NAMES:
                    scene_name = raw_folder_name
                else:
                    scene_name = generate_smart_scene_name(raw_folder_name, scene_index)

                original_scene_name = scene_name
                user_override = name_overrides_dict.get(scene_name)
                if user_override:
                    scene_name = user_override
                user_description = scene_descriptions_dict.get(original_scene_name) or None

                scene_meta_path = scene_dir / "scene_metadata.json"
                scene_meta = {}
                if scene_meta_path.exists():
                    with open(scene_meta_path) as f:
                        scene_meta = json.load(f)
                
                lidar_path = scene_dir / "lidar"
                cameras_path = scene_dir / "cameras"
                images_path = scene_dir / "images"
                
                frame_count = 0
                data_files: List[Path] = []
                data_source = "unknown"
                
                if lidar_path.exists():
                    data_files = [f for f in lidar_path.iterdir() if f.suffix.lower() in [".pcd", ".bin", ".ply"]]
                    data_source = "lidar"
                elif cameras_path.exists():
                    for cam_dir in cameras_path.iterdir():
                        if cam_dir.is_dir():
                            data_files = [f for f in cam_dir.iterdir() if f.suffix.lower() in [".jpg", ".png", ".jpeg"]]
                            data_source = f"camera:{cam_dir.name}"
                            break
                elif images_path.exists():
                    data_files = [f for f in images_path.iterdir() if f.suffix.lower() in [".jpg", ".png", ".jpeg", ".gif", ".bmp", ".tiff", ".tif"]]
                    data_source = "images"
                else:
                    data_files = find_data_files(scene_dir)
                    data_source = "direct"
                
                data_files = sorted(data_files, key=lambda x: x.name)
                frame_count = len(data_files)
                
                if frame_count == 0:
                    errors.append(f"Scene {scene_name}: No frames detected")
                    continue
                
                scene_id = uuid.uuid4()
                permanent_scene_dir = dataset_upload_dir / str(scene_id)
                permanent_scene_dir.mkdir(parents=True, exist_ok=True)
                
                for item in scene_dir.iterdir():
                    src = item
                    dst = permanent_scene_dir / item.name
                    if item.is_dir():
                        shutil.copytree(src, dst)
                    else:
                        shutil.copy2(src, dst)

                zip_uuid_rename_map = rename_data_files_to_uuid(
                    permanent_scene_dir, DATA_EXTENSIONS
                )

                org_id_val = dataset.campaign.organization_id
                asyncio.get_event_loop().run_in_executor(
                    None, _mirror_scene_to_minio,
                    org_id_val, dataset.id, scene_id, permanent_scene_dir,
                )

                parent_dir = scene_dir.parent
                if parent_dir != scene_dir:
                    sibling_annotations = parent_dir / "annotations"
                    if sibling_annotations.exists() and sibling_annotations.is_dir():
                        annotations_dst = permanent_scene_dir / "annotations"
                        if not annotations_dst.exists():
                            try:
                                shutil.copytree(sibling_annotations, annotations_dst)
                            except Exception as e:
                                errors.append(f"Scene {scene_name}: Failed to copy annotations folder: {str(e)}")
                
                permanent_lidar_path = permanent_scene_dir / "lidar"
                permanent_images_path = permanent_scene_dir / "images"
                permanent_cameras_path = permanent_scene_dir / "cameras"
                
                relative_path_base = f"uploads/{dataset.id}/{scene_id}"
                
                cameras_storage_paths: Dict[str, str] = {}
                if permanent_cameras_path.exists():
                    for cam_dir in permanent_cameras_path.iterdir():
                        if cam_dir.is_dir():
                            cameras_storage_paths[cam_dir.name] = f"{relative_path_base}/cameras/{cam_dir.name}"
                elif permanent_images_path.exists():
                    cameras_storage_paths["images"] = f"{relative_path_base}/images"
                
                ego_poses_data: Dict[int, Any] = {}
                ego_poses_path = permanent_scene_dir / "ego_poses" / "poses.json"
                if not ego_poses_path.exists():
                    ego_poses_path = permanent_scene_dir / "ego_poses" / "ego_poses.json"
                if ego_poses_path.exists():
                    with open(ego_poses_path) as f:
                        poses_raw = json.load(f)
                        if isinstance(poses_raw, dict) and "frames" in poses_raw:
                            for pose_entry in poses_raw["frames"]:
                                idx = pose_entry.get("frame_index", -1)
                                if idx >= 0:
                                    ego_poses_data[idx] = {
                                        "position": pose_entry.get("position", [0, 0, 0]),
                                        "rotation": pose_entry.get("rotation", [1, 0, 0, 0]),
                                        "velocity": pose_entry.get("velocity"),
                                        "timestamp": pose_entry.get("timestamp"),
                                    }
                        elif isinstance(poses_raw, list):
                            for idx, pose in enumerate(poses_raw):
                                ego_poses_data[idx] = pose

                scene_calibration = calibration_data
                scene_calibration_path = permanent_scene_dir / "calibration.json"
                scene_calib_dir = permanent_scene_dir / "calibration"
                if scene_calibration_path.exists():
                    scene_calibration = parse_calibration_file(scene_calibration_path, ego_poses_data)
                elif scene_calib_dir.exists():
                    scene_calibration = parse_calibration_file(scene_calib_dir, ego_poses_data)
                elif ego_poses_data:
                    rotation = detect_ego_to_lidar_rotation(ego_poses_data)
                    scene_calibration = {
                        "lidar_to_cameras": scene_calibration.get("lidar_to_cameras", {}) if isinstance(scene_calibration, dict) else {},
                        "ego_to_lidar": {"rotation": rotation, "translation": [0, 0, 0]},
                    }
                
                if not user_override:
                    existing_scene_query = select(Scene).where(
                        Scene.dataset_id == dataset.id,
                        Scene.name == scene_name,
                        Scene.is_deleted == False,
                    )
                    existing_result = await db.execute(existing_scene_query)
                    if existing_result.scalar_one_or_none():
                        original_name = scene_name
                        scene_name = f"{scene_name}_upload-{datetime.now().strftime('%Y%m%d_%H%M')}"
                        renamed_scenes.append(RenamedScene(original_name=original_name, new_name=scene_name, scene_id=str(scene_id)))

                scene = Scene(
                    dataset_id=dataset.id,
                    name=scene_name,
                    description=user_description or scene_meta.get("description"),
                    scene_metadata={
                        "location": scene_meta.get("location"),
                        "weather": scene_meta.get("weather"),
                        "time_of_day": scene_meta.get("time_of_day"),
                        "recording_date": scene_meta.get("recording_date"),
                    },
                    frame_count=frame_count,
                    fps=scene_meta.get("fps", 10.0),
                    calibration=scene_calibration if scene_calibration else {},
                    storage_paths={
                        "lidar_base": f"{relative_path_base}/lidar" if permanent_lidar_path.exists() else None,
                        "cameras": cameras_storage_paths,
                    },
                )
                db.add(scene)
                await db.flush()
                await auto_create_tasks_for_scene(db, scene)
                await db.flush()

                permanent_data_files = []
                lidar_files = []
                camera_files: Dict[str, List[Path]] = {}
                
                if permanent_lidar_path.exists():
                    lidar_files = sorted([f for f in permanent_lidar_path.iterdir() if f.suffix.lower() in [".pcd", ".bin", ".ply"]], key=lambda x: x.name)
                    permanent_data_files = lidar_files
                
                if permanent_cameras_path.exists():
                    for cam_dir in permanent_cameras_path.iterdir():
                        if cam_dir.is_dir():
                            cam_images = sorted([f for f in cam_dir.iterdir() if f.suffix.lower() in [".jpg", ".png", ".jpeg"]], key=lambda x: x.name)
                            camera_files[cam_dir.name] = cam_images
                            if not permanent_data_files:
                                permanent_data_files = cam_images
                elif permanent_images_path.exists():
                    images = sorted([f for f in permanent_images_path.iterdir() if f.suffix.lower() in [".jpg", ".png", ".jpeg", ".gif", ".bmp", ".tiff", ".tif"]], key=lambda x: x.name)
                    camera_files["images"] = images
                    if not permanent_data_files:
                        permanent_data_files = images
                
                if not permanent_data_files:
                    all_root_files = sorted(find_data_files(permanent_scene_dir), key=lambda x: x.name)
                    pcd_root_files = [f for f in all_root_files if f.suffix.lower() in {".pcd", ".bin", ".ply"}]
                    img_root_files = [f for f in all_root_files if f.suffix.lower() in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tiff", ".tif"}]

                    if pcd_root_files:
                        lidar_files = pcd_root_files
                        permanent_data_files = pcd_root_files
                        scene.storage_paths = {
                            **scene.storage_paths,
                            "lidar_base": relative_path_base,
                        }
                        attributes.flag_modified(scene, "storage_paths")

                    if img_root_files:
                        camera_files["default"] = img_root_files
                        if not permanent_data_files:
                            permanent_data_files = img_root_files
                        scene.storage_paths = {
                            **scene.storage_paths,
                            "cameras": {
                                **(scene.storage_paths.get("cameras") or {}),
                                "default": relative_path_base,
                            },
                        }
                        attributes.flag_modified(scene, "storage_paths")
                
                for frame_idx, data_file in enumerate(permanent_data_files):
                    frame_file_paths: Dict[str, Any] = {}
                    
                    if lidar_files and frame_idx < len(lidar_files):
                        frame_file_paths["lidar"] = lidar_files[frame_idx].name
                    
                    if camera_files:
                        cameras_dict = {}
                        for cam_name, cam_file_list in camera_files.items():
                            if frame_idx < len(cam_file_list):
                                cameras_dict[cam_name] = cam_file_list[frame_idx].name
                        if cameras_dict:
                            frame_file_paths["cameras"] = cameras_dict
                    
                    frame_file_paths["_meta"] = {
                        "absolute_path": str(data_file),
                        "relative_path": str(data_file.relative_to(permanent_scene_dir)),
                        "original_filename": (
                            zip_uuid_rename_map.get(
                                str(data_file.relative_to(permanent_scene_dir)), {}
                            ).get("original_name") or data_file.name
                        ),
                    }
                    
                    frame_ego_pose = ego_poses_data.get(frame_idx)
                    
                    if frame_ego_pose and isinstance(frame_ego_pose, dict) and "timestamp" in frame_ego_pose:
                        frame_timestamp = frame_ego_pose.get("timestamp")
                    else:
                        frame_timestamp = frame_idx * (1.0 / scene.fps)
                    
                    frame = Frame(
                        scene_id=scene.id,
                        frame_index=frame_idx,
                        timestamp=frame_timestamp,
                        file_paths=frame_file_paths,
                        ego_pose=frame_ego_pose if isinstance(frame_ego_pose, dict) else None,
                    )
                    db.add(frame)
                
                await db.flush()

                task = await get_or_create_scene_import_task(
                    db=db,
                    scene=scene,
                    assignee_id=current_user.id,
                    frame_count=frame_count,
                    description=f"Auto-created for {scene_name} ({frame_count} frames)",
                )
                print(f"[ZIP IMPORT] Using task {task.id} for imported annotations")
                
                try:
                    annotations_3d, annotations_2d = await import_scene_annotations(
                        db=db,
                        scene=scene,
                        scene_dir=permanent_scene_dir,
                        task=task,
                        overwrite=overwrite_annotations,
                    )
                    if annotations_3d > 0 or annotations_2d > 0:
                        errors.append(f"Scene {scene_name}: Imported {annotations_3d} 3D and {annotations_2d} 2D annotations")
                except Exception as e:
                    errors.append(f"Scene {scene_name}: Failed to import annotations: {str(e)}")
                
                scenes_imported += 1
                frames_imported += frame_count
                print(f"[ZIP IMPORT] Successfully imported scene {scene_name} with {frame_count} frames")
                
            except Exception as e:
                import traceback
                print(f"[ZIP IMPORT ERROR] Scene {scene_dir.name}: {str(e)}")
                print(f"[ZIP IMPORT ERROR] Traceback: {traceback.format_exc()}")
                errors.append(f"Scene {scene_dir.name}: {str(e)}")
        
        await db.commit()
        
        return ImportResponse(
            success=scenes_imported > 0,
            message=f"Imported {scenes_imported} scenes with {frames_imported} frames from ZIP",
            scenes_imported=scenes_imported,
            frames_imported=frames_imported,
            errors=errors,
            renamed_scenes=renamed_scenes,
        )
        
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"ZIP upload failed: {str(e)}"
        )
    finally:
        try:
            shutil.rmtree(temp_dir)
        except Exception:
            pass


@router.post("/upload-video", response_model=ImportResponse)
async def upload_video_and_import_dataset(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_IMPORT))],
    dataset_id: str = Form(...),
    file: UploadFile = File(..., description="Video file (MP4, AVI, MOV, MKV, WebM)"),
    extraction_fps: Optional[float] = Form(None, description="FPS to extract frames at (default: auto-detect)"),
    max_frames: Optional[int] = Form(None, description="Maximum number of frames to extract"),
    image_format: str = Form("jpg", description="Output image format (jpg, png, webp)"),
    preserve_folder_names: bool = Form(True),
    db: AsyncSession = Depends(get_db),
) -> ImportResponse:
    """
    Upload a video file and extract frames to create a scene with a task.
    Requires DATASETS_IMPORT permission.
    
    The video will be processed to extract frames at the specified FPS.
    Each video becomes a scene with extracted frames as camera images.
    A task is automatically created for annotation.
    
    Args:
        dataset_id: ID of the dataset to import into
        file: Video file to upload (MP4, AVI, MOV, MKV, WebM)
        extraction_fps: FPS to extract frames at (default: video's native FPS)
        max_frames: Maximum number of frames to extract (default: no limit)
        image_format: Output image format - jpg, png, or webp (default: jpg)
        preserve_folder_names: If True, use video filename as scene name
    """
    from app.services.video_service import (
        VIDEO_EXTENSIONS,
        extract_frames_async,
        get_video_metadata,
        is_ffmpeg_available,
        validate_video_magic_bytes,
    )
    from app.core.file_security import VIDEO_EXTENSIONS as ALLOWED_VIDEO_EXT
    
    if not is_ffmpeg_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Video processing is not available. Please install ffmpeg on the server."
        )
    
    if not file.filename:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Filename is required"
        )
    
    file_ext = Path(file.filename).suffix.lower()
    if file_ext not in ALLOWED_VIDEO_EXT:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid video format. Supported formats: {', '.join(ALLOWED_VIDEO_EXT)}"
        )
    
    validate_upload_path(file.filename)
    
    query = select(Dataset).options(selectinload(Dataset.campaign)).where(Dataset.id == UUID(dataset_id))
    result = await db.execute(query)
    dataset = result.scalar_one_or_none()
    
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset not found: {dataset_id}"
        )
    
    dataset_upload_dir = UPLOAD_DIR / dataset_id
    dataset_upload_dir.mkdir(parents=True, exist_ok=True)
    
    temp_dir = tempfile.mkdtemp(prefix="video_upload_")
    video_path = Path(temp_dir) / f"video{file_ext}"
    permanent_scene_dir = None

    try:
        log.info(f"[VIDEO IMPORT] Receiving video file: {file.filename}")
        file_size = 0
        chunk_size = 1024 * 1024 * 10
        
        with open(video_path, "wb") as f:
            while True:
                chunk = await file.read(chunk_size)
                if not chunk:
                    break
                f.write(chunk)
                file_size += len(chunk)
        
        log.info(f"[VIDEO IMPORT] Video file size: {file_size / (1024*1024):.1f} MB")
        
        with open(video_path, "rb") as f:
            header = f.read(16)
        
        if not validate_video_magic_bytes(header, file_ext):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File content does not match expected {file_ext.upper()[1:]} format"
            )
        
        metadata = get_video_metadata(video_path)
        if not metadata or metadata.get("duration", 0) <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Could not read video metadata. The file may be corrupted."
            )
        
        log.info(f"[VIDEO IMPORT] Video metadata: {metadata}")
        
        video_name = Path(file.filename).stem
        if preserve_folder_names and video_name.lower() not in GENERIC_FOLDER_NAMES:
            scene_name = video_name
        else:
            scene_name = generate_smart_scene_name(video_name, 1)
        
        existing_scene_query = select(Scene).where(
            Scene.dataset_id == dataset.id,
            Scene.name == scene_name,
            Scene.is_deleted == False,
        )
        existing_result = await db.execute(existing_scene_query)
        if existing_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A scene with the name '{scene_name}' already exists in this dataset",
            )
        
        scene_id = uuid.uuid4()
        permanent_scene_dir = dataset_upload_dir / str(scene_id)
        frames_dir = permanent_scene_dir / "cameras" / "video"
        frames_dir.mkdir(parents=True, exist_ok=True)
        
        log.info(f"[VIDEO IMPORT] Extracting frames at {extraction_fps or 'native'} FPS...")
        frame_paths, extraction_metadata = await extract_frames_async(
            video_path=video_path,
            output_dir=frames_dir,
            fps=extraction_fps,
            max_frames=max_frames,
            image_format=image_format,
        )
        
        frame_count = len(frame_paths)
        log.info(f"[VIDEO IMPORT] Extracted {frame_count} frames")
        
        if frame_count == 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No frames could be extracted from the video"
            )
        
        uuid_rename_map = rename_data_files_to_uuid(permanent_scene_dir, DATA_EXTENSIONS)
        
        org_id_val = dataset.campaign.organization_id
        asyncio.get_event_loop().run_in_executor(
            None, _mirror_scene_to_minio,
            org_id_val, dataset.id, scene_id, permanent_scene_dir,
        )
        
        relative_path_base = f"uploads/{dataset.id}/{scene_id}"
        cameras_storage_paths = {"video": f"{relative_path_base}/cameras/video"}
        
        video_scene_metadata = {
            "source": "video_upload",
            "original_filename": file.filename,
            "video_duration": extraction_metadata.get("duration"),
            "video_fps": extraction_metadata.get("fps"),
            "video_resolution": [extraction_metadata.get("width"), extraction_metadata.get("height")],
            "video_codec": extraction_metadata.get("codec"),
            "extraction_fps": extraction_metadata.get("extraction_fps"),
            "frames_extracted": frame_count,
        }
        
        scene = Scene(
            id=scene_id,
            dataset_id=dataset.id,
            name=scene_name,
            description=f"Extracted from video: {file.filename}",
            frame_count=frame_count,
            fps=extraction_metadata.get("extraction_fps") or extraction_metadata.get("fps") or 30.0,
            scene_metadata=video_scene_metadata,
            calibration={},
            storage_paths={
                "root": str(permanent_scene_dir),
                "cameras": cameras_storage_paths,
            },
        )
        db.add(scene)
        await db.flush()
        await auto_create_tasks_for_scene(db, scene)
        await db.flush()

        permanent_frame_files = sorted(frames_dir.glob(f"*.{image_format}"), key=lambda x: x.name)
        timestamps = extraction_metadata.get("timestamps", [])
        
        for frame_idx, frame_file in enumerate(permanent_frame_files):
            frame_file_paths = {
                "cameras": {"video": frame_file.name},
                "_meta": {
                    "absolute_path": str(frame_file),
                    "relative_path": str(frame_file.relative_to(permanent_scene_dir)),
                    "original_filename": uuid_rename_map.get(
                        str(frame_file.relative_to(permanent_scene_dir)), {}
                    ).get("original_name") or frame_file.name,
                },
            }
            
            frame_timestamp = timestamps[frame_idx] if frame_idx < len(timestamps) else frame_idx / scene.fps
            
            frame = Frame(
                scene_id=scene.id,
                frame_index=frame_idx,
                timestamp=frame_timestamp,
                file_paths=frame_file_paths,
                ego_pose=None,
            )
            db.add(frame)
        
        await db.flush()

        task = await get_or_create_scene_import_task(
            db=db,
            scene=scene,
            assignee_id=current_user.id,
            frame_count=frame_count,
            description=f"Auto-created for video {file.filename} ({frame_count} frames)",
        )
        log.info(f"[VIDEO IMPORT] Using task: {task.name}")
        
        await db.commit()
        
        return ImportResponse(
            success=True,
            message=f"Imported video as scene '{scene_name}' with {frame_count} frames",
            scenes_imported=1,
            frames_imported=frame_count,
            errors=[
                f"Video: {extraction_metadata.get('width')}x{extraction_metadata.get('height')} @ {extraction_metadata.get('fps'):.1f} fps",
                f"Extracted {frame_count} frames at {extraction_metadata.get('extraction_fps'):.1f} fps",
            ],
        )
        
    except HTTPException:
        raise
    except IntegrityError:
        await db.rollback()
        if permanent_scene_dir is not None:
            try:
                shutil.rmtree(permanent_scene_dir)
            except Exception:
                pass
        log.warning(
            f"[VIDEO IMPORT] Scene name '{scene_name}' already exists in dataset "
            f"{dataset_id} (duplicate or concurrent upload)"
        )
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"A scene named '{scene_name}' already exists in this dataset. "
                "It may have just been created by this same upload — refresh the "
                "dataset to check. To re-import, delete the existing scene or rename the file."
            ),
        )
    except Exception as e:
        await db.rollback()
        import traceback
        log.error(f"[VIDEO IMPORT ERROR] {str(e)}\n{traceback.format_exc()}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Video upload failed: {str(e)}"
        )
    finally:
        try:
            shutil.rmtree(temp_dir)
        except Exception:
            pass


@router.post("/import", response_model=ImportResponse)
async def import_dataset(
    request: ImportRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_IMPORT))],
    db: AsyncSession = Depends(get_db),
) -> ImportResponse:
    """
    Import scenes and frames from a local dataset folder structure.
    Requires DATASETS_IMPORT permission.
    
    Expected folder structure:
    ```
    root_path/
    ├── metadata.json
    ├── calibration/
    │   ├── extrinsics.json
    │   └── intrinsics/
    │       └── {camera_id}.json
    └── scenes/
        └── {scene_id}/
            ├── scene_metadata.json
            ├── lidar/
            │   └── {frame}.pcd
            ├── cameras/
            │   └── {camera_id}/
            │       └── {frame}.jpg
            ├── ego_poses/
            │   └── poses.json
            └── timestamps.json
    ```
    """
    root_path = Path(request.root_path)
    
    if not root_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Path does not exist: {root_path}"
        )
    
    dataset_query = select(Dataset).where(
        Dataset.id == request.dataset_id,
        Dataset.is_deleted == False,
    )
    result = await db.execute(dataset_query)
    dataset = result.scalar_one_or_none()
    
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {request.dataset_id} not found"
        )
    
    errors = []
    renamed_scenes: List[RenamedScene] = []
    scenes_imported = 0
    frames_imported = 0
    
    metadata_file = root_path / "metadata.json"
    sensor_config = {}
    if metadata_file.exists():
        with open(metadata_file, 'r') as f:
            metadata = json.load(f)
            sensor_config = metadata.get("sensors", {})
    
    calibration_path = root_path / "calibration"
    default_calibration = {}
    if calibration_path.exists():
        default_calibration = parse_calibration_file(calibration_path)
    
    scenes_path = root_path / "scenes"
    if not scenes_path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"No 'scenes' folder found in {root_path}"
        )
    
    for scene_dir in sorted(scenes_path.iterdir()):
        if not scene_dir.is_dir():
            continue
        
        try:
            scene_metadata_file = scene_dir / "scene_metadata.json"
            if scene_metadata_file.exists():
                with open(scene_metadata_file, 'r') as f:
                    scene_meta = json.load(f)
            else:
                lidar_path = scene_dir / "lidar"
                frame_count = len(list(lidar_path.glob("*.pcd"))) + len(list(lidar_path.glob("*.bin"))) if lidar_path.exists() else 0
                scene_meta = {
                    "scene_id": scene_dir.name,
                    "name": scene_dir.name,
                    "frame_count": frame_count,
                    "fps": 10.0
                }
            
            scene_calibration = default_calibration.copy()
            scene_ego_poses = load_ego_poses(scene_dir)
            scene_calib_file = scene_dir / "calibration.json"
            scene_calib_path = scene_dir / "calibration"
            if scene_calib_file.exists():
                scene_calibration = parse_calibration_file(scene_calib_file, scene_ego_poses)
            elif scene_calib_path.exists():
                scene_calibration = parse_calibration_file(scene_calib_path, scene_ego_poses)
            
            storage_paths = get_storage_paths(scene_dir, root_path)
            
            scene_id = uuid.uuid4()
            existing_scene_query = select(Scene).where(
                Scene.dataset_id == request.dataset_id,
                Scene.name == scene_name,
                Scene.is_deleted == False,
            )
            existing_result = await db.execute(existing_scene_query)
            if existing_result.scalar_one_or_none():
                original_name = scene_name
                scene_name = f"{scene_name}_upload-{datetime.now().strftime('%Y%m%d_%H%M')}"
                renamed_scenes.append(RenamedScene(original_name=original_name, new_name=scene_name, scene_id=str(scene_id)))

            scene = Scene(
                id=scene_id,
                dataset_id=request.dataset_id,
                name=scene_name,
                description=f"Imported from {scene_dir.name}",
                scene_metadata={
                    "location": scene_meta.get("location"),
                    "weather": scene_meta.get("weather"),
                    "time_of_day": scene_meta.get("time_of_day"),
                    "recording_date": scene_meta.get("recording_date"),
                    "duration_seconds": scene_meta.get("duration_seconds"),
                    "ego_vehicle": scene_meta.get("ego_vehicle"),
                },
                frame_count=scene_meta.get("frame_count", 0),
                fps=scene_meta.get("fps", 10.0),
                calibration=scene_calibration,
                storage_paths=storage_paths,
            )
            db.add(scene)
            await db.flush()
            await auto_create_tasks_for_scene(db, scene)
            await db.flush()

            frames_data = discover_frames(scene_dir, sensor_config)
            for frame_data in frames_data:
                frame = Frame(
                    scene_id=scene.id,
                    frame_index=frame_data["frame_index"],
                    timestamp=frame_data["timestamp"],
                    ego_pose=frame_data.get("ego_pose"),
                    file_paths=frame_data["file_paths"],
                )
                db.add(frame)
                frames_imported += 1
            
            scenes_imported += 1
            
        except Exception as e:
            errors.append(f"Error importing scene {scene_dir.name}: {str(e)}")
    
    await db.commit()
    
    return ImportResponse(
        success=len(errors) == 0,
        message=f"Imported {scenes_imported} scenes with {frames_imported} frames",
        scenes_imported=scenes_imported,
        frames_imported=frames_imported,
        errors=errors,
        renamed_scenes=renamed_scenes,
    )


@router.post("/validate", response_model=Dict[str, Any])
async def validate_dataset_structure(
    root_path: str,
) -> Dict[str, Any]:
    """
    Validate a dataset folder structure without importing.
    Returns information about what would be imported.
    """
    path = Path(root_path)
    
    if not path.exists():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Path does not exist: {root_path}"
        )
    
    result = {
        "valid": True,
        "metadata_found": False,
        "calibration_found": False,
        "scenes": [],
        "total_frames": 0,
        "sensors_detected": [],
        "warnings": [],
        "errors": []
    }
    
    metadata_file = path / "metadata.json"
    if metadata_file.exists():
        result["metadata_found"] = True
        with open(metadata_file, 'r') as f:
            metadata = json.load(f)
            sensors = metadata.get("sensors", {})
            if "lidar" in sensors:
                result["sensors_detected"].append(f"LiDAR: {sensors['lidar'].get('sensor_id', 'unknown')}")
            for cam in sensors.get("cameras", []):
                result["sensors_detected"].append(f"Camera: {cam.get('sensor_id', 'unknown')}")
    else:
        result["warnings"].append("No metadata.json found - sensor config will be inferred")
    
    calibration_path = path / "calibration"
    if calibration_path.exists():
        result["calibration_found"] = True
        extrinsics = calibration_path / "extrinsics.json"
        if not extrinsics.exists():
            result["warnings"].append("No extrinsics.json found in calibration folder")
    else:
        result["warnings"].append("No calibration folder found - 3D-to-2D projection may not work")
    
    scenes_path = path / "scenes"
    if not scenes_path.exists():
        result["valid"] = False
        result["errors"].append("No 'scenes' folder found")
        return result
    
    for scene_dir in sorted(scenes_path.iterdir()):
        if not scene_dir.is_dir():
            continue
        
        scene_info = {
            "name": scene_dir.name,
            "has_metadata": (scene_dir / "scene_metadata.json").exists(),
            "has_lidar": (scene_dir / "lidar").exists(),
            "has_cameras": (scene_dir / "cameras").exists(),
            "has_ego_poses": ((scene_dir / "ego_poses" / "poses.json").exists() or (scene_dir / "ego_poses" / "ego_poses.json").exists()),
            "has_timestamps": (scene_dir / "timestamps.json").exists(),
            "frame_count": 0,
            "cameras": []
        }
        
        lidar_path = scene_dir / "lidar"
        if lidar_path.exists():
            scene_info["frame_count"] = len(list(lidar_path.glob("*.pcd"))) + len(list(lidar_path.glob("*.bin")))
        
        cameras_path = scene_dir / "cameras"
        if cameras_path.exists():
            scene_info["cameras"] = [d.name for d in cameras_path.iterdir() if d.is_dir()]
        
        result["scenes"].append(scene_info)
        result["total_frames"] += scene_info["frame_count"]
    
    if len(result["scenes"]) == 0:
        result["valid"] = False
        result["errors"].append("No scene folders found in 'scenes' directory")
    
    return result

"""
Export API Endpoints

Provides export functionality for datasets, scenes, and tasks.
Supports exporting:
- Labels only (JSON format)
- Data + Labels (ZIP archive)
- Per-sensor COCO format annotations

Folder structure for exports:
    scene_export.zip/
    ├── data/
    │   ├── lidar/
    │   └── cameras/{camera_name}/
    ├── annotations/
    │   ├── lidar.json          # COCO-like format for 3D annotations
    │   ├── {camera_name}.json  # COCO format for each camera's 2D annotations
    │   └── ...
    └── metadata.json           # Scene metadata, calibration, taxonomy
"""
import io
import json
import math
import zipfile
import os
import re
from datetime import datetime
from pathlib import Path
from typing import Optional, Literal, Dict, List, Any
from uuid import UUID
from collections import defaultdict

import numpy as np

SEGMENTATION_ROOT = os.environ.get("SEGMENTATION_ROOT", "/uploads/segmentation")

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.models import (
    Dataset, Scene, Task, Frame,
    Annotation, Annotation2D, Annotation3D, Annotation4D, AnnotationFusion,
    Track2D, User, Taxonomy, dataset_taxonomy_association,
)
from app.api.v1.endpoints.auth import get_current_user

router = APIRouter()

DATA_BASE_PATH = Path("/data")


async def get_segmentation_taxonomy_classes(db: AsyncSession, dataset_id: UUID) -> Optional[List[dict]]:
    """
    Return the classes list of the segmentation_3d taxonomy linked to this dataset,
    or None if no such taxonomy is linked.
    """
    stmt = (
        select(Taxonomy)
        .join(dataset_taxonomy_association, Taxonomy.id == dataset_taxonomy_association.c.taxonomy_id)
        .where(
            dataset_taxonomy_association.c.dataset_id == dataset_id,
            dataset_taxonomy_association.c.mode == "segmentation_3d",
            Taxonomy.is_deleted == False,
        )
        .limit(1)
    )
    result = await db.execute(stmt)
    tax = result.scalar_one_or_none()
    return list(tax.classes) if tax and tax.classes else None


def merge_overlapping_annotations(all_annotations: Dict[str, List[dict]]) -> Dict[str, List[dict]]:
    """
    Merge annotations from overlapping tasks using Track ID merge strategy.
    
    For annotations with the same track_id and frame_index:
    - Keep the annotation with the most recent created_at timestamp ("Prefer Recent")
    
    For annotations without track_id:
    - Keep all (no merging possible without track identification)
    
    Special handling for annotations_4d which have frame_range instead of frame_index.
    """
    merged = {}
    
    for ann_type, annotations in all_annotations.items():
        if ann_type == "annotations_4d":
            merged[ann_type] = _merge_4d_annotations(annotations)
        else:
            merged[ann_type] = _merge_frame_indexed_annotations(annotations)
    
    return merged


def _merge_frame_indexed_annotations(annotations: List[dict]) -> List[dict]:
    """
    Merge annotations that have frame_index field.
    
    Groups by (track_id, frame_index) and keeps the most recent annotation.
    Annotations without track_id are kept as-is.
    """
    if not annotations:
        return []
    
    tracked = []
    untracked = []
    
    for ann in annotations:
        if ann.get("track_id"):
            tracked.append(ann)
        else:
            untracked.append(ann)
    
    merged_tracked = {}
    
    for ann in tracked:
        if "camera_id" in ann:
            key = (ann["track_id"], ann.get("frame_index"), ann.get("camera_id"))
        else:
            key = (ann["track_id"], ann.get("frame_index"))
        
        if key not in merged_tracked:
            merged_tracked[key] = ann
        else:
            existing_created = merged_tracked[key].get("created_at")
            new_created = ann.get("created_at")
            
            if not existing_created and new_created:
                merged_tracked[key] = ann
            elif existing_created and new_created:
                if new_created > existing_created:
                    merged_tracked[key] = ann
    
    return list(merged_tracked.values()) + untracked


def _merge_4d_annotations(annotations: List[dict]) -> List[dict]:
    """
    Merge 4D annotations that have frame_range instead of frame_index.
    
    4D annotations represent tracks across a frame range.
    For same track_id with overlapping frame ranges, prefer the more recent one.
    """
    if not annotations:
        return []
    
    tracked = []
    untracked = []
    
    for ann in annotations:
        if ann.get("track_id"):
            tracked.append(ann)
        else:
            untracked.append(ann)
    
    by_track: Dict[str, List[dict]] = defaultdict(list)
    for ann in tracked:
        by_track[ann["track_id"]].append(ann)
    
    merged_tracked = []
    
    for track_id, track_anns in by_track.items():
        if len(track_anns) == 1:
            merged_tracked.append(track_anns[0])
            continue
        
        sorted_anns = sorted(track_anns, key=lambda a: a.get("frame_range", {}).get("start", 0))
        
        result_anns = []
        
        for ann in sorted_anns:
            frame_range = ann.get("frame_range", {})
            ann_start = frame_range.get("start", 0)
            ann_end = frame_range.get("end", 0)
            ann_created = ann.get("created_at")
            
            overlap_idx = None
            for i, existing in enumerate(result_anns):
                existing_range = existing.get("frame_range", {})
                existing_start = existing_range.get("start", 0)
                existing_end = existing_range.get("end", 0)
                
                if ann_start <= existing_end and ann_end >= existing_start:
                    overlap_idx = i
                    break
            
            if overlap_idx is None:
                result_anns.append(ann)
            else:
                existing = result_anns[overlap_idx]
                existing_created = existing.get("created_at")
                
                if not existing_created and ann_created:
                    result_anns[overlap_idx] = ann
                elif existing_created and ann_created and ann_created > existing_created:
                    result_anns[overlap_idx] = ann
        
        merged_tracked.extend(result_anns)
    
    return merged_tracked + untracked


def resolve_storage_path(path_str: Optional[str], storage_paths: dict) -> Optional[Path]:
    """Resolve a stored path to an absolute filesystem path.

    Handles both absolute paths (written directly to storage_paths) and
    relative paths that may be anchored under /uploads (browser uploads) or
    the legacy DATA_BASE_PATH (/data).
    """
    if not path_str:
        return None

    direct = Path(path_str)
    if direct.is_absolute() and direct.exists():
        return direct

    uploads_candidate = Path("/") / path_str.lstrip("/")
    if uploads_candidate.exists():
        return uploads_candidate

    root_path = storage_paths.get("root")
    if root_path and not path_str.startswith("uploads"):
        candidate = Path(root_path) / path_str
        if candidate.exists():
            return candidate

    data_candidate = DATA_BASE_PATH / path_str
    if data_candidate.exists():
        return data_candidate

    return None



async def get_annotations_for_task(
    db: AsyncSession,
    task_id: UUID,
    taxonomy_id: Optional[UUID] = None,
    annotation_mode: Optional[str] = None,
) -> dict:
    """Get annotations for a task, optionally filtered to a specific taxonomy.

    When taxonomy_id is provided:
    - segmentation_3d mode  → returns empty (segmentation is file-based, handled separately)
    - all other modes       → filters Annotation3D/2D/Legacy by taxonomy_id;
                              AnnotationFusion and Annotation4D have no taxonomy_id column
                              so they are included only for non-segmentation exports.
    """
    annotations = {
        "cuboids_3d": [],
        "boxes_2d": [],
        "annotations_4d": [],
        "annotations_fusion": [],
        "annotations_legacy": [],
        "tracks_2d": [],
    }

    if annotation_mode == "segmentation_3d":
        return annotations

    where_3d = [Annotation3D.task_id == task_id]
    if taxonomy_id is not None:
        where_3d.append(Annotation3D.taxonomy_id == taxonomy_id)
    stmt = select(Annotation3D, Frame).join(Frame, Annotation3D.frame_id == Frame.id).where(*where_3d)
    result = await db.execute(stmt)
    for ann, frame in result.all():
        data = ann.data or {}
        center = data.get("center", {})
        dimensions = data.get("dimensions", {})
        rotation = data.get("rotation", {})
        annotations["cuboids_3d"].append({
            "id": str(ann.id),
            "track_id": str(ann.track_id) if ann.track_id else None,
            "frame_index": frame.frame_index,
            "class_id": ann.class_id,
            "position": {"x": center.get("x", 0), "y": center.get("y", 0), "z": center.get("z", 0)},
            "dimensions": {"length": dimensions.get("length", 0), "width": dimensions.get("width", 0), "height": dimensions.get("height", 0)},
            "rotation": {"yaw": rotation.get("yaw", 0), "pitch": rotation.get("pitch", 0), "roll": rotation.get("roll", 0)},
            "attributes": ann.attributes or {},
            "source": ann.source,
            "confidence": data.get("confidence", 1.0),
            "created_at": ann.created_at.isoformat() if ann.created_at else None,
        })

    where_2d = [Annotation2D.task_id == task_id]
    if taxonomy_id is not None:
        where_2d.append(Annotation2D.taxonomy_id == taxonomy_id)
    stmt = select(Annotation2D, Frame).join(Frame, Annotation2D.frame_id == Frame.id).where(*where_2d)
    result = await db.execute(stmt)
    for ann, frame in result.all():
        annotations["boxes_2d"].append({
            "id": str(ann.id),
            "track_id": str(ann.track_id) if ann.track_id else None,
            "frame_id": str(ann.frame_id),
            "frame_index": frame.frame_index,
            "camera_id": ann.camera_id,
            "class_id": ann.class_id,
            "type": ann.type,
            "data": ann.data,
            "attributes": ann.attributes or {},
            "source": ann.source,
            "created_at": ann.created_at.isoformat() if ann.created_at else None,
        })

    stmt = select(Annotation4D).where(Annotation4D.task_id == task_id)
    result = await db.execute(stmt)
    for ann in result.scalars().all():
        annotations["annotations_4d"].append({
            "id": str(ann.id),
            "track_id": str(ann.track_id) if ann.track_id else None,
            "class_id": ann.class_id,
            "frame_range": {"start": ann.frame_start, "end": ann.frame_end},
            "position": {"x": ann.position_x, "y": ann.position_y, "z": ann.position_z},
            "dimensions": {"length": ann.dimension_length, "width": ann.dimension_width, "height": ann.dimension_height},
            "rotation": {"yaw": ann.rotation_yaw, "pitch": ann.rotation_pitch, "roll": ann.rotation_roll},
            "is_static": ann.is_static,
            "attributes": ann.attributes or {},
            "source": ann.source,
            "created_at": ann.created_at.isoformat() if ann.created_at else None,
        })

    stmt = select(AnnotationFusion).where(AnnotationFusion.task_id == task_id)
    result = await db.execute(stmt)
    for ann in result.scalars().all():
        annotations["annotations_fusion"].append({
            "id": str(ann.id),
            "track_id": str(ann.track_id) if ann.track_id else None,
            "frame_index": ann.frame_index,
            "class_id": ann.class_id,
            "cuboid_3d": {
                "position": {"x": ann.position_x, "y": ann.position_y, "z": ann.position_z},
                "dimensions": {"length": ann.dimension_length, "width": ann.dimension_width, "height": ann.dimension_height},
                "rotation": {"yaw": ann.rotation_yaw, "pitch": ann.rotation_pitch, "roll": ann.rotation_roll},
            },
            "camera_projections": ann.camera_projections or {},
            "attributes": ann.attributes or {},
            "source": ann.source,
            "created_at": ann.created_at.isoformat() if ann.created_at else None,
        })

    where_leg = [Annotation.task_id == task_id]
    if taxonomy_id is not None:
        where_leg.append(Annotation.taxonomy_id == taxonomy_id)
    stmt = select(Annotation).where(*where_leg)
    result = await db.execute(stmt)
    for ann in result.scalars().all():
        annotations["annotations_legacy"].append({
            "id": str(ann.id),
            "track_id": str(ann.track_id) if ann.track_id else None,
            "frame_id": str(ann.frame_id) if ann.frame_id else None,
            "type": ann.type,
            "class_id": ann.class_id,
            "data": ann.data,
            "attributes": ann.attributes or {},
            "source": ann.source,
            "created_at": ann.created_at.isoformat() if ann.created_at else None,
        })

    stmt = select(Track2D).where(Track2D.task_id == task_id)
    result = await db.execute(stmt)
    for tr in result.scalars().all():
        annotations["tracks_2d"].append({
            "id": str(tr.id),
            "camera_id": tr.camera_id,
            "class_id": tr.class_id,
            "name": tr.name,
            "color": tr.color,
            "start_frame_index": tr.start_frame_index,
            "end_frame_index": tr.end_frame_index,
            "is_interpolated": tr.is_interpolated,
            "is_complete": tr.is_complete,
            "attributes": tr.attributes or {},
        })

    return annotations


def get_scene_metadata(scene: Scene) -> dict:
    """Get scene metadata for export."""
    return {
        "id": str(scene.id),
        "name": scene.name,
        "description": scene.description,
        "frame_count": scene.frame_count,
        "fps": scene.fps,
        "metadata": scene.scene_metadata,
        "calibration": scene.calibration,
        "storage_paths": scene.storage_paths,
        "created_at": scene.created_at.isoformat() if scene.created_at else None,
    }


async def get_frames_metadata(db: AsyncSession, scene_id: UUID) -> list:
    """Get all frames metadata for a scene."""
    stmt = select(Frame).where(Frame.scene_id == scene_id).order_by(Frame.frame_index)
    result = await db.execute(stmt)
    frames = []
    for frame in result.scalars().all():
        frames.append({
            "id": str(frame.id),
            "frame_index": frame.frame_index,
            "timestamp": frame.timestamp,
            "file_paths": frame.file_paths,
            "ego_pose": frame.ego_pose,
        })
    return frames


def add_segmentation_kitti_to_zip(
    zf: zipfile.ZipFile,
    scene: Scene,
    frames_data: list,
    taxonomy: dict,
    prefix: str = "annotations",
    scene_classes: Optional[List[dict]] = None,
) -> int:
    """
    Add 3D semantic segmentation .label files under {prefix}/lidar_segmentation/.

    Structure mirrors lidar.json exactly — same info/frames/categories shape:

        {prefix}/lidar_segmentation/
            labels_info.json   ← info + frames + categories  (same structure as lidar.json)
            000000.label       ← binary uint32 per point
            000001.label
            ...

    Encoding per uint32:
        bits  0-15: semantic class ID (0=unlabeled, 1=first taxonomy class, …)
        bits 16-31: instance ID       (0=no instance)
    """
    seg_root = Path(SEGMENTATION_ROOT) / str(scene.id)
    if not seg_root.exists():
        return 0

    classes = scene_classes if scene_classes is not None else taxonomy.get("classes", [])
    id_to_cat: Dict[int, Dict] = {0: {"id": 0, "name": "unlabeled", "color": "", "supercategory": ""}}
    for idx, cls in enumerate(classes):
        id_to_cat[idx + 1] = {
            "id": idx + 1,
            "name": cls.get("name", cls.get("id", f"class_{idx}")),
            "color": cls.get("color", ""),
            "supercategory": cls.get("supercategory", "object"),
        }

    frame_entries: List[Dict[str, Any]] = []
    frames_exported = 0

    for frame in frames_data:
        frame_id = frame.get("id") or frame.get("frame_id")
        frame_index = frame.get("frame_index", 0)

        file_paths = frame.get("file_paths") or {}
        pcd_file = file_paths.get("lidar", "") if isinstance(file_paths, dict) else ""

        labels_path = seg_root / f"{frame_id}.npy"
        has_labels = labels_path.exists()

        entry: Dict[str, Any] = {
            "id": frame_index,
            "frame_number": frame_index + 1,
            "frame_index": frame_index,
            "file_name": f"{frame_index:06d}.label",
            "pcd_file": pcd_file,
            "timestamp": frame.get("timestamp", 0.0),
            "has_labels": has_labels,
        }

        if has_labels:
            labels = np.load(str(labels_path))
            semantic_ids = np.where(labels < 0, 0, labels + 1).astype(np.uint32)

            instance_path = seg_root / f"{frame_id}_instances.npy"
            if instance_path.exists():
                instances = np.load(str(instance_path)).astype(np.uint32)
                instances = np.where(instances < 0, 0, instances)
                kitti_labels = semantic_ids | (instances << np.uint32(16))
            else:
                kitti_labels = semantic_ids

            labeled_mask = semantic_ids > 0
            entry["labeled_point_count"] = int(np.sum(labeled_mask))
            entry["total_point_count"] = int(len(labels))

            unique_ids, counts = np.unique(semantic_ids[labeled_mask], return_counts=True)
            class_dist = {}
            for sem_id, count in zip(unique_ids.tolist(), counts.tolist()):
                cat = id_to_cat.get(sem_id)
                cat_name = cat["name"] if cat else f"class_{sem_id}"
                class_dist[str(sem_id)] = {"name": cat_name, "point_count": count}
                if sem_id not in id_to_cat:
                    id_to_cat[sem_id] = {"id": sem_id, "name": f"class_{sem_id}", "color": "", "supercategory": "object"}
            entry["class_distribution"] = class_dist

            zf.writestr(f"{prefix}/lidar_segmentation/{frame_index:06d}.label", kitti_labels.tobytes())
            frames_exported += 1

        # labels. Encoding: uint32 class id (0=unlabeled, 1=first class, …).
        semantic_path = seg_root / f"{frame_id}_semantic.npy"
        if semantic_path.exists():
            sem = np.load(str(semantic_path))
            sem_kitti = np.where(sem < 0, 0, sem + 1).astype(np.uint32)
            zf.writestr(
                f"{prefix}/lidar_segmentation_semantic/{frame_index:06d}.label",
                sem_kitti.tobytes(),
            )
            entry["has_semantic"] = True

        frame_entries.append(entry)

    if frames_exported == 0:
        return 0

    categories = [id_to_cat[k] for k in sorted(id_to_cat.keys())]

    labels_info: Dict[str, Any] = {
        "info": {
            "description": "3D Semantic Segmentation — KITTI Semantic format",
            "format": "kitti_semantic",
            "encoding": (
                "uint32 per point: "
                "semantic_id = bits 0-15 (0=unlabeled, 1=first class, ...), "
                "instance_id = bits 16-31 (0=no instance)"
            ),
            "version": "1.0",
            "year": datetime.utcnow().year,
            "contributor": "CaliperGT Export",
            "date_created": datetime.utcnow().isoformat(),
            "scene_id": str(scene.id),
            "scene_name": scene.name,
            "coordinate_system": "lidar",
        },
        "frames": frame_entries,
        "categories": categories,
    }
    zf.writestr(
        f"{prefix}/lidar_segmentation/labels_info.json",
        json.dumps(labels_info, indent=2),
    )
    return frames_exported


def add_scene_data_to_zip(zf: zipfile.ZipFile, scene: Scene, frames_data: list, prefix: str = "data"):
    """Add actual data files (lidar, camera images) for a scene to the ZIP archive."""
    storage_paths = scene.storage_paths or {}
    
    lidar_base = storage_paths.get("lidar_base")
    lidar_path = resolve_storage_path(lidar_base, storage_paths)
    if lidar_path and lidar_path.exists():
        for lidar_file in lidar_path.iterdir():
            if lidar_file.is_file():
                arcname = f"{prefix}/lidar/{lidar_file.name}"
                zf.write(str(lidar_file), arcname)
    
    cameras = storage_paths.get("cameras", {})
    for camera_name, camera_path_str in cameras.items():
        camera_path = resolve_storage_path(camera_path_str, storage_paths)
        if camera_path and camera_path.exists():
            for img_file in camera_path.iterdir():
                if img_file.is_file():
                    arcname = f"{prefix}/cameras/{camera_name}/{img_file.name}"
                    zf.write(str(img_file), arcname)
    
    ego_poses_path = storage_paths.get("ego_poses")
    ego_file = resolve_storage_path(ego_poses_path, storage_paths)
    if ego_file and ego_file.exists():
        zf.write(str(ego_file), f"{prefix}/ego_poses/ego_poses.json")
    else:
        frame_poses = [
            {
                "frame_index": f["frame_index"],
                "timestamp": f.get("timestamp"),
                "position": f["ego_pose"]["position"],
                "rotation": f["ego_pose"]["rotation"],
                **({"velocity": f["ego_pose"]["velocity"]} if f["ego_pose"].get("velocity") else {}),
            }
            for f in frames_data
            if f.get("ego_pose") and isinstance(f["ego_pose"], dict) and f["ego_pose"].get("position")
        ]
        if frame_poses:
            poses_json = json.dumps({"frames": frame_poses}, indent=2)
            zf.writestr(f"{prefix}/ego_poses/ego_poses.json", poses_json)
    
    if scene.calibration:
        zf.writestr(f"{prefix}/calibration.json", json.dumps(scene.calibration, indent=2))



def _pts_to_coords(raw: list) -> list:
    """Normalise a raw point list to [(x, y), ...] tuples.
    Accepts both [[x,y],...] and [{"x":x,"y":y},...]  formats."""
    out = []
    for pt in raw or []:
        if isinstance(pt, (list, tuple)) and len(pt) >= 2:
            out.append((float(pt[0]), float(pt[1])))
        elif isinstance(pt, dict):
            out.append((float(pt.get("x", 0)), float(pt.get("y", 0))))
    return out


def _bbox_from_coords(coords: list) -> tuple:
    """Return (x, y, width, height) axis-aligned bounding box for a list of (x,y) pairs."""
    xs = [p[0] for p in coords]
    ys = [p[1] for p in coords]
    x, y = min(xs), min(ys)
    return x, y, max(xs) - x, max(ys) - y


def build_coco_categories(taxonomy: dict) -> List[Dict[str, Any]]:
    """Build COCO categories from taxonomy."""
    categories = []
    if not taxonomy:
        return categories
    
    classes = taxonomy.get("classes", [])
    for idx, cls in enumerate(classes):
        categories.append({
            "id": idx + 1,
            "name": cls.get("id", cls.get("name", f"class_{idx}")),
            "supercategory": cls.get("supercategory", "object"),
        })
    return categories


def get_category_id_map(taxonomy: dict) -> Dict[str, int]:
    """Map class_id to COCO category ID."""
    category_map = {}
    if not taxonomy:
        return category_map
    
    classes = taxonomy.get("classes", [])
    for idx, cls in enumerate(classes):
        class_id = cls.get("id", cls.get("name", f"class_{idx}"))
        category_map[class_id] = idx + 1
    return category_map


def convert_2d_annotations_to_coco(
    annotations_2d: List[Dict],
    frames_data: List[Dict],
    taxonomy: dict,
    scene: Scene,
    camera_id: str,
) -> Dict[str, Any]:
    """
    Convert 2D annotations for a specific camera to COCO format.
    
    COCO format:
    {
        "info": {...},
        "images": [...],
        "annotations": [...],
        "categories": [...]
    }
    """
    camera_annotations = [ann for ann in annotations_2d if ann.get("camera_id") == camera_id]
    
    category_map = get_category_id_map(taxonomy)
    categories = build_coco_categories(taxonomy)
    
    unique_class_ids = set(ann.get("class_id", "unknown") for ann in camera_annotations)
    next_cat_id = len(categories) + 1
    for class_id in unique_class_ids:
        if class_id not in category_map:
            category_map[class_id] = next_cat_id
            categories.append({
                "id": next_cat_id,
                "name": str(class_id),
                "supercategory": "object",
            })
            next_cat_id += 1
    
    images = []
    frame_id_to_coco_id = {}
    storage_paths = scene.storage_paths or {}
    cameras_config = storage_paths.get("cameras", {})
    
    for frame in frames_data:
        frame_index = frame["frame_index"]
        file_paths = frame.get("file_paths", {})
        camera_files = file_paths.get("cameras", {})
        camera_file = camera_files.get(camera_id, f"{frame_index:06d}.jpg")
        
        width, height = 1920, 1080
        if scene.calibration:
            lidar_to_cameras = scene.calibration.get("lidar_to_cameras", {})
            camera_calib = lidar_to_cameras.get(camera_id, {})
            intrinsic = camera_calib.get("intrinsic", {})
            if "cx" in intrinsic and "cy" in intrinsic:
                width = int(intrinsic.get("cx", 960) * 2)
                height = int(intrinsic.get("cy", 540) * 2)
        
        coco_image_id = frame_index + 1
        frame_id_to_coco_id[frame_index] = coco_image_id
        
        images.append({
            "id": coco_image_id,
            "file_name": camera_file,
            "width": width,
            "height": height,
            "frame_index": frame_index,
            "timestamp": frame.get("timestamp", 0.0),
        })
    
    coco_annotations = []
    for idx, ann in enumerate(camera_annotations):
        frame_index = ann.get("frame_index")
        if frame_index is None:
            continue
        
        coco_image_id = frame_id_to_coco_id.get(frame_index)
        if coco_image_id is None:
            continue
        
        class_id = ann.get("class_id", "unknown")
        category_id = category_map.get(class_id)
        if category_id is None:
            category_id = 1
        
        data = ann.get("data") or {}
        ann_type = ann.get("type", "box2d")
        x = y = width = height = 0.0
        segmentation = None
        extra_fields: dict = {}

        if ann_type in ("box2d", "box", "rectangle"):
            bbox_src = data.get("bbox", data)
            x      = float(bbox_src.get("x", 0))
            y      = float(bbox_src.get("y", 0))
            width  = float(bbox_src.get("width", 0))
            height = float(bbox_src.get("height", 0))

        elif ann_type in ("rotated_box", "rotated_rectangle"):
            cx    = float(data.get("cx", data.get("x", 0)))
            cy    = float(data.get("cy", data.get("y", 0)))
            w     = float(data.get("width", 0))
            h     = float(data.get("height", 0))
            angle = float(data.get("angle", data.get("rotation", 0)))
            hw, hh = w / 2, h / 2
            cos_a = abs(math.cos(math.radians(angle)))
            sin_a = abs(math.sin(math.radians(angle)))
            dx = hw * cos_a + hh * sin_a
            dy = hw * sin_a + hh * cos_a
            x, y = cx - dx, cy - dy
            width, height = dx * 2, dy * 2
            extra_fields["rotated_box"] = {"cx": cx, "cy": cy, "width": w, "height": h, "angle": angle}

        elif ann_type == "ellipse":
            cx = float(data.get("cx", data.get("x", 0)))
            cy = float(data.get("cy", data.get("y", 0)))
            rx = float(data["rx"]) if "rx" in data else float(data.get("width", 0)) / 2
            ry = float(data["ry"]) if "ry" in data else float(data.get("height", 0)) / 2
            x, y = cx - rx, cy - ry
            width, height = rx * 2, ry * 2
            extra_fields["ellipse"] = {"cx": cx, "cy": cy, "rx": rx, "ry": ry}

        elif ann_type in ("polygon", "semantic_segment"):
            coords = _pts_to_coords(data.get("polygon", data.get("points", [])))
            if not coords:
                continue
            x, y, width, height = _bbox_from_coords(coords)
            seg_flat: list = []
            for px, py in coords:
                seg_flat.extend([px, py])
            segmentation = [seg_flat]
            extra_fields["polygon"] = [[px, py] for px, py in coords]

        elif ann_type in ("polyline", "line", "bezier"):
            coords = _pts_to_coords(data.get("points", []))
            if not coords:
                continue
            x, y, width, height = _bbox_from_coords(coords)
            segmentation = None
            extra_fields["polyline"] = [[px, py] for px, py in coords]

        elif ann_type in ("keypoints", "points"):
            kp_dict = data.get("keypoints", {})
            if kp_dict:
                coords = [
                    (float(v.get("x", 0)), float(v.get("y", 0)))
                    for v in kp_dict.values()
                    if isinstance(v, dict) and v.get("visibility", 2) > 0
                ]
                kp_flat = []
                for name, v in kp_dict.items():
                    kp_flat.extend([float(v.get("x",0)), float(v.get("y",0)), int(v.get("visibility",2))])
                extra_fields["keypoints"] = kp_flat
                extra_fields["keypoint_names"] = list(kp_dict.keys())
            else:
                coords = _pts_to_coords(data.get("points", []))
                extra_fields["keypoints"] = [v for px, py in coords for v in (px, py, 2)]
            if not coords:
                continue
            x, y, width, height = _bbox_from_coords(coords)
            extra_fields["num_keypoints"] = len(coords)

        elif ann_type in ("segmentation_2d", "mask"):
            all_coords: list = []
            seg_polys: list = []
            for poly in data.get("polygons", []):
                c = _pts_to_coords(poly)
                if c:
                    all_coords.extend(c)
                    seg_flat = []
                    for px, py in c:
                        seg_flat.extend([px, py])
                    seg_polys.append(seg_flat)
            if all_coords:
                x, y, width, height = _bbox_from_coords(all_coords)
                segmentation = seg_polys if seg_polys else None
            if "mask_url" in data:
                extra_fields["mask_url"] = data["mask_url"]

        else:
            bbox_src = data.get("bbox", data)
            x      = float(bbox_src.get("x", 0)) if isinstance(bbox_src, dict) else 0.0
            y      = float(bbox_src.get("y", 0)) if isinstance(bbox_src, dict) else 0.0
            width  = float(bbox_src.get("width", 0)) if isinstance(bbox_src, dict) else 0.0
            height = float(bbox_src.get("height", 0)) if isinstance(bbox_src, dict) else 0.0

        area = width * height

        coco_ann = {
            "id": idx + 1,
            "image_id": coco_image_id,
            "category_id": category_id,
            "class": class_id,
            "type": ann_type,
            "bbox": [x, y, width, height],
            "area": area,
            "iscrowd": 0,
            "attributes": ann.get("attributes", {}),
            "track_id": ann.get("track_id"),
            "source": ann.get("source", "manual"),
        }

        if segmentation:
            coco_ann["segmentation"] = segmentation

        coco_ann.update(extra_fields)
        
        coco_annotations.append(coco_ann)
    
    return {
        "info": {
            "description": f"Annotations for camera: {camera_id}",
            "version": "1.0",
            "year": datetime.utcnow().year,
            "contributor": "CaliperGT Export",
            "date_created": datetime.utcnow().isoformat(),
            "scene_id": str(scene.id),
            "scene_name": scene.name,
        },
        "images": images,
        "annotations": coco_annotations,
        "categories": categories,
    }


def convert_3d_annotations_to_coco(
    annotations_3d: List[Dict],
    frames_data: List[Dict],
    taxonomy: dict,
    scene: Scene,
) -> Dict[str, Any]:
    """
    Convert 3D LiDAR annotations to COCO-like format.
    
    Extended COCO format for 3D:
    {
        "info": {...},
        "frames": [...],  # Instead of "images"
        "annotations": [...],
        "categories": [...]
    }
    """
    category_map = get_category_id_map(taxonomy)
    categories = build_coco_categories(taxonomy)
    
    unique_class_ids = set(ann.get("class_id", "unknown") for ann in annotations_3d)
    next_cat_id = len(categories) + 1
    for class_id in unique_class_ids:
        if class_id not in category_map:
            category_map[class_id] = next_cat_id
            categories.append({
                "id": next_cat_id,
                "name": str(class_id),
                "supercategory": "object",
            })
            next_cat_id += 1
    
    frames = []
    storage_paths = scene.storage_paths or {}
    
    for frame in frames_data:
        frame_index = frame["frame_index"]
        file_paths = frame.get("file_paths", {})
        lidar_file = file_paths.get("lidar", f"{frame_index:06d}.pcd")
        
        frames.append({
            "id": frame_index,
            "file_name": lidar_file,
            "timestamp": frame.get("timestamp", 0.0),
            "ego_pose": frame.get("ego_pose"),
        })
    
    coco_annotations = []
    for idx, ann in enumerate(annotations_3d):
        frame_index = ann.get("frame_index", 0)
        
        class_id = ann.get("class_id", "unknown")
        category_id = category_map.get(class_id)
        if category_id is None:
            category_id = 1
        
        position = ann.get("position", {})
        dimensions = ann.get("dimensions", {})
        rotation = ann.get("rotation", {})
        
        coco_ann = {
            "id": idx + 1,
            "frame_id": frame_index,
            "category_id": category_id,
            "class": class_id,
            "cuboid_3d": {
                "position": {
                    "x": position.get("x", 0),
                    "y": position.get("y", 0),
                    "z": position.get("z", 0),
                },
                "dimensions": {
                    "length": dimensions.get("length", 0),
                    "width": dimensions.get("width", 0),
                    "height": dimensions.get("height", 0),
                },
                "rotation": {
                    "yaw": rotation.get("yaw", 0),
                    "pitch": rotation.get("pitch", 0),
                    "roll": rotation.get("roll", 0),
                },
            },
            "attributes": ann.get("attributes", {}),
            "track_id": ann.get("track_id"),
            "source": ann.get("source", "manual"),
            "confidence": ann.get("confidence", 1.0),
        }
        
        coco_annotations.append(coco_ann)
    
    return {
        "info": {
            "description": "LiDAR 3D Annotations",
            "version": "1.0",
            "year": datetime.utcnow().year,
            "contributor": "CaliperGT Export",
            "date_created": datetime.utcnow().isoformat(),
            "scene_id": str(scene.id),
            "scene_name": scene.name,
            "coordinate_system": "lidar",
        },
        "frames": frames,
        "annotations": coco_annotations,
        "categories": categories,
    }


def convert_fusion_annotations_to_coco(
    annotations_fusion: List[Dict],
    frames_data: List[Dict],
    taxonomy: dict,
    scene: Scene,
) -> Dict[str, Any]:
    """
    Convert Fusion annotations (3D + 2D projections) to COCO-like format.
    """
    category_map = get_category_id_map(taxonomy)
    categories = build_coco_categories(taxonomy)
    
    unique_class_ids = set(ann.get("class_id", "unknown") for ann in annotations_fusion)
    next_cat_id = len(categories) + 1
    for class_id in unique_class_ids:
        if class_id not in category_map:
            category_map[class_id] = next_cat_id
            categories.append({
                "id": next_cat_id,
                "name": str(class_id),
                "supercategory": "object",
            })
            next_cat_id += 1
    
    frames = []
    for frame in frames_data:
        frame_index = frame["frame_index"]
        file_paths = frame.get("file_paths", {})
        
        frames.append({
            "id": frame_index,
            "lidar_file": file_paths.get("lidar", f"{frame_index:06d}.pcd"),
            "camera_files": file_paths.get("cameras", {}),
            "timestamp": frame.get("timestamp", 0.0),
            "ego_pose": frame.get("ego_pose"),
        })
    
    coco_annotations = []
    for idx, ann in enumerate(annotations_fusion):
        frame_index = ann.get("frame_index", 0)
        
        class_id = ann.get("class_id", "unknown")
        category_id = category_map.get(class_id)
        if category_id is None:
            category_id = 1
        
        cuboid_3d = ann.get("cuboid_3d", {})
        
        coco_ann = {
            "id": idx + 1,
            "frame_id": frame_index,
            "category_id": category_id,
            "class": class_id,
            "cuboid_3d": cuboid_3d,
            "camera_projections": ann.get("camera_projections", {}),
            "attributes": ann.get("attributes", {}),
            "track_id": ann.get("track_id"),
            "source": ann.get("source", "manual"),
        }
        
        coco_annotations.append(coco_ann)
    
    return {
        "info": {
            "description": "Fusion Annotations (3D + 2D projections)",
            "version": "1.0",
            "year": datetime.utcnow().year,
            "contributor": "CaliperGT Export",
            "date_created": datetime.utcnow().isoformat(),
            "scene_id": str(scene.id),
            "scene_name": scene.name,
        },
        "frames": frames,
        "annotations": coco_annotations,
        "categories": categories,
    }


def get_cameras_from_annotations(annotations_2d: List[Dict]) -> List[str]:
    """Extract unique camera IDs from 2D annotations."""
    cameras = set()
    for ann in annotations_2d:
        camera_id = ann.get("camera_id")
        if camera_id:
            cameras.add(camera_id)
    return sorted(list(cameras))


def build_task_export_folder_name(task: Task) -> str:
    """Create a readable, stable folder name for per-task scene exports."""
    base_name = task.name or f"task_{str(task.id)[:8]}"
    safe_name = re.sub(r"[^a-zA-Z0-9_-]+", "_", base_name).strip("_")
    if not safe_name:
        safe_name = "task"
    return f"{safe_name}__{str(task.id)[:8]}"


def add_sensor_annotations_to_zip(
    zf: zipfile.ZipFile,
    annotations: Dict[str, List],
    frames_data: List[Dict],
    taxonomy: dict,
    scene: Scene,
    prefix: str = "annotations",
) -> Dict[str, int]:
    """
    Add per-sensor COCO format annotation files to the ZIP archive.
    
    Creates:
    - annotations/lidar.json for 3D cuboid annotations
    - annotations/{camera_id}.json for each camera's 2D annotations
    - annotations/fusion.json for fusion annotations
    
    Returns dict with counts per sensor.
    """
    counts = {}
    
    cuboids_3d = annotations.get("cuboids_3d", [])
    if cuboids_3d:
        coco_lidar = convert_3d_annotations_to_coco(cuboids_3d, frames_data, taxonomy, scene)
        zf.writestr(f"{prefix}/lidar.json", json.dumps(coco_lidar, indent=2))
        counts["lidar"] = len(cuboids_3d)
    
    boxes_2d = annotations.get("boxes_2d", [])
    tracks_2d = annotations.get("tracks_2d", [])
    if boxes_2d:
        cameras = get_cameras_from_annotations(boxes_2d)
        for camera_id in cameras:
            camera_annotations = [ann for ann in boxes_2d if ann.get("camera_id") == camera_id]
            if camera_annotations:
                coco_camera = convert_2d_annotations_to_coco(
                    camera_annotations, frames_data, taxonomy, scene, camera_id
                )
                coco_camera["tracks"] = [
                    tr for tr in tracks_2d if tr.get("camera_id") == camera_id
                ]
                safe_camera_id = camera_id.replace("/", "_").replace("\\", "_")
                zf.writestr(f"{prefix}/{safe_camera_id}.json", json.dumps(coco_camera, indent=2))
                counts[camera_id] = len(camera_annotations)
    
    annotations_fusion = annotations.get("annotations_fusion", [])
    if annotations_fusion:
        coco_fusion = convert_fusion_annotations_to_coco(
            annotations_fusion, frames_data, taxonomy, scene
        )
        zf.writestr(f"{prefix}/fusion.json", json.dumps(coco_fusion, indent=2))
        counts["fusion"] = len(annotations_fusion)
    
    annotations_4d = annotations.get("annotations_4d", [])
    if annotations_4d:
        coco_4d = {
            "info": {
                "description": "4D Annotations (temporal tracking)",
                "version": "1.0",
                "year": datetime.utcnow().year,
                "contributor": "CaliperGT Export",
                "date_created": datetime.utcnow().isoformat(),
                "scene_id": str(scene.id),
                "scene_name": scene.name,
            },
            "annotations": annotations_4d,
            "categories": build_coco_categories(taxonomy),
        }
        zf.writestr(f"{prefix}/lidar_4d.json", json.dumps(coco_4d, indent=2))
        counts["lidar_4d"] = len(annotations_4d)
    
    return counts



@router.get("/tasks/{task_id}/export")
async def export_task(
    task_id: UUID,
    include_data: bool = Query(False, description="Include raw data files (images, point clouds)"),
    format: Literal["json", "coco"] = Query("coco", description="Export format (coco = per-sensor COCO files, json = legacy single file)"),
    taxonomy_id: Optional[UUID] = Query(None, description="Filter export to a specific taxonomy. Segmentation taxonomies export only .label files; others export only their DB annotations."),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Export a single task's annotations.
    
    - **include_data**: If True, returns a ZIP with data files + labels.
    - **format**: 
        - coco: Per-sensor COCO format files (annotations/lidar.json, annotations/camera_front.json, etc.)
        - json: Legacy single labels.json file
    
    ZIP structure for 'coco' format:
    ```
    task_export.zip/
    ├── data/
    │   ├── lidar/
    │   └── cameras/{camera_name}/
    ├── annotations/
    │   ├── lidar.json
    │   ├── {camera_name}.json
    │   └── fusion.json (if applicable)
    └── metadata.json
    ```
    """
    task = await db.get(Task, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    scene = await db.get(Scene, task.scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    dataset = await db.get(Dataset, scene.dataset_id)
    taxonomy = dataset.taxonomy if dataset else {}

    annotation_mode: Optional[str] = None
    if taxonomy_id is not None:
        tax_obj = await db.get(Taxonomy, taxonomy_id)
        if tax_obj:
            annotation_mode = tax_obj.annotation_mode

    scene_classes = await get_segmentation_taxonomy_classes(db, scene.dataset_id)

    annotations = await get_annotations_for_task(
        db, task_id, taxonomy_id=taxonomy_id, annotation_mode=annotation_mode
    )
    frames_data = await get_frames_metadata(db, scene.id)

    metadata = {
        "export_info": {
            "format_version": "2.0",
            "format": format,
            "exported_at": datetime.utcnow().isoformat(),
            "exported_by": current_user.username,
            "export_type": "task",
            "taxonomy_id": str(taxonomy_id) if taxonomy_id else None,
            "annotation_mode": annotation_mode,
        },
        "task": {
            "id": str(task.id),
            "status": task.status,
            "stage": task.stage,
            "frame_range": {"start": task.frame_range.lower if task.frame_range else 0, "end": (task.frame_range.upper - 1) if task.frame_range else 0},
        },
        "scene": get_scene_metadata(scene),
        "dataset": {
            "id": str(dataset.id) if dataset else None,
            "name": dataset.name if dataset else None,
        },
        "taxonomy": taxonomy,
        "frames": frames_data,
    }

    if format == "coco":
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            if annotation_mode != "segmentation_3d":
                annotation_counts = add_sensor_annotations_to_zip(
                    zf, annotations, frames_data, taxonomy, scene, prefix="annotations"
                )
                metadata["annotation_counts"] = annotation_counts

            if include_data:
                add_scene_data_to_zip(zf, scene, frames_data, prefix="data")

            if taxonomy_id is None or annotation_mode == "segmentation_3d":
                add_segmentation_kitti_to_zip(zf, scene, frames_data, taxonomy, prefix="annotations", scene_classes=scene_classes)

            # Write metadata LAST and exactly once, so annotation_counts (added
            # above when present) is included without a duplicate zip entry.
            zf.writestr("metadata.json", json.dumps(metadata, indent=2))

        zip_buffer.seek(0)
        filename = f"task_{task_id}_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    else:
        export_data = {
            **metadata,
            "annotations": annotations,
        }
        
        if include_data:
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("labels.json", json.dumps(export_data, indent=2))
                add_scene_data_to_zip(zf, scene, frames_data, prefix="data")
            
            zip_buffer.seek(0)
            filename = f"task_{task_id}_export_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"
            return StreamingResponse(
                zip_buffer,
                media_type="application/zip",
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )
        else:
            filename = f"task_{task_id}_labels_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
            return StreamingResponse(
                io.BytesIO(json.dumps(export_data, indent=2).encode()),
                media_type="application/json",
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )


@router.get("/scenes/{scene_id}/export")
async def export_scene(
    scene_id: UUID,
    include_data: bool = Query(False, description="Include raw data files"),
    format: Literal["json", "coco"] = Query("coco", description="Export format (coco = per-sensor COCO files, json = legacy single file)"),
    taxonomy_id: Optional[UUID] = Query(None, description="Filter export to a specific taxonomy."),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Export all annotations for a scene (across all tasks).
    
    - **include_data**: If True, includes raw data files in the ZIP.
    - **format**: 
        - coco: Per-sensor COCO format files (annotations/lidar.json, annotations/camera_front.json, etc.)
        - json: Legacy single labels.json file
    
    ZIP structure for 'coco' format:
    ```
    scene_export.zip/
    ├── data/
    │   ├── lidar/
    │   └── cameras/{camera_name}/
    ├── annotations/
    │   ├── lidar.json
    │   ├── {camera_name}.json
    │   └── fusion.json (if applicable)
    └── metadata.json
    ```
    """
    scene = await db.get(Scene, scene_id)
    if not scene:
        raise HTTPException(status_code=404, detail="Scene not found")

    dataset = await db.get(Dataset, scene.dataset_id)
    taxonomy = dataset.taxonomy if dataset else {}

    annotation_mode: Optional[str] = None
    if taxonomy_id is not None:
        tax_obj = await db.get(Taxonomy, taxonomy_id)
        if tax_obj:
            annotation_mode = tax_obj.annotation_mode

    scene_classes = await get_segmentation_taxonomy_classes(db, scene.dataset_id)

    stmt = select(Task).where(Task.scene_id == scene_id)
    result = await db.execute(stmt)
    tasks = list(result.scalars().all())

    all_annotations = {
        "cuboids_3d": [],
        "boxes_2d": [],
        "annotations_4d": [],
        "annotations_fusion": [],
        "annotations_legacy": [],
        "tracks_2d": [],
    }

    task_info = []
    task_annotations_by_id: Dict[str, Dict[str, List[dict]]] = {}
    for task in tasks:
        task_annotations = await get_annotations_for_task(
            db, task.id, taxonomy_id=taxonomy_id, annotation_mode=annotation_mode
        )
        task_annotations_by_id[str(task.id)] = task_annotations
        for key in all_annotations:
            all_annotations[key].extend(task_annotations[key])
        task_info.append({
            "id": str(task.id),
            "name": task.name,
            "status": task.status,
            "stage": task.stage,
            "taxonomy_id": str(task.taxonomy_id) if task.taxonomy_id else None,
            "frame_range": {"start": task.frame_range.lower if task.frame_range else 0, "end": (task.frame_range.upper - 1) if task.frame_range else 0},
        })

    all_annotations = merge_overlapping_annotations(all_annotations)
    frames_data = await get_frames_metadata(db, scene.id)

    metadata = {
        "export_info": {
            "format_version": "2.0",
            "format": format,
            "exported_at": datetime.utcnow().isoformat(),
            "exported_by": current_user.username,
            "export_type": "scene",
            "taxonomy_id": str(taxonomy_id) if taxonomy_id else None,
            "annotation_mode": annotation_mode,
        },
        "scene": get_scene_metadata(scene),
        "dataset": {
            "id": str(dataset.id) if dataset else None,
            "name": dataset.name if dataset else None,
        },
        "taxonomy": taxonomy,
        "tasks": task_info,
        "frames": frames_data,
    }

    if format == "coco":
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            if annotation_mode != "segmentation_3d":
                if len(tasks) > 1:
                    metadata["export_info"]["format_version"] = "3.0"
                    metadata["export_info"]["annotation_layout"] = "per_task_sensor_files"

                    task_exports = []
                    counts_by_task: Dict[str, Dict[str, int]] = {}
                    aggregate_counts: Dict[str, int] = defaultdict(int)

                    for task in tasks:
                        task_id_str = str(task.id)
                        task_folder = build_task_export_folder_name(task)
                        task_prefix = f"annotations/tasks/{task_folder}"

                        task_counts = add_sensor_annotations_to_zip(
                            zf,
                            task_annotations_by_id.get(task_id_str, {}),
                            frames_data,
                            taxonomy,
                            scene,
                            prefix=task_prefix,
                        )
                        counts_by_task[task_id_str] = task_counts
                        for sensor_name, count in task_counts.items():
                            aggregate_counts[sensor_name] += count

                        task_exports.append({
                            "task_id": task_id_str,
                            "task_name": task.name,
                            "task_taxonomy_id": str(task.taxonomy_id) if task.taxonomy_id else None,
                            "frame_range": {
                                "start": task.frame_range.lower if task.frame_range else 0,
                                "end": (task.frame_range.upper - 1) if task.frame_range else 0,
                            },
                            "folder": task_prefix,
                        })

                    metadata["task_exports"] = task_exports
                    metadata["annotation_counts_by_task"] = counts_by_task
                    metadata["annotation_counts"] = dict(aggregate_counts)
                else:
                    annotation_counts = add_sensor_annotations_to_zip(
                        zf, all_annotations, frames_data, taxonomy, scene, prefix="annotations"
                    )
                    metadata["annotation_counts"] = annotation_counts

            if include_data:
                add_scene_data_to_zip(zf, scene, frames_data, prefix="data")

            if taxonomy_id is None or annotation_mode == "segmentation_3d":
                add_segmentation_kitti_to_zip(zf, scene, frames_data, taxonomy, prefix="annotations", scene_classes=scene_classes)

            # Write metadata LAST and exactly once (avoids a duplicate zip entry).
            zf.writestr("metadata.json", json.dumps(metadata, indent=2))

        zip_buffer.seek(0)
        filename = f"scene_{scene.name}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    else:
        export_data = {
            **metadata,
            "annotations": all_annotations,
            "annotation_counts": {
                "cuboids_3d": len(all_annotations["cuboids_3d"]),
                "boxes_2d": len(all_annotations["boxes_2d"]),
                "annotations_4d": len(all_annotations["annotations_4d"]),
                "annotations_fusion": len(all_annotations["annotations_fusion"]),
                "total": sum(len(v) for v in all_annotations.values()),
            },
        }
        
        if include_data:
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("labels.json", json.dumps(export_data, indent=2))
                add_scene_data_to_zip(zf, scene, frames_data, prefix="data")
            
            zip_buffer.seek(0)
            filename = f"scene_{scene.name}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"
            return StreamingResponse(
                zip_buffer,
                media_type="application/zip",
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )
        else:
            filename = f"scene_{scene.name}_labels_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
            return StreamingResponse(
                io.BytesIO(json.dumps(export_data, indent=2).encode()),
                media_type="application/json",
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )


@router.get("/datasets/{dataset_id}/export")
async def export_dataset(
    dataset_id: UUID,
    include_data: bool = Query(False, description="Include raw data files"),
    accepted_only: bool = Query(False, description="Only export accepted/completed tasks"),
    format: Literal["json", "coco"] = Query("coco", description="Export format (coco = per-sensor COCO files, json = legacy single file)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Export all annotations for a dataset (across all scenes and tasks).
    
    - **include_data**: If True, includes raw data files in the ZIP.
    - **accepted_only**: If True, only exports annotations from accepted/completed tasks.
    - **format**: 
        - coco: Per-sensor COCO format files for each scene
        - json: Legacy single labels.json file
    
    ZIP structure for 'coco' format:
    ```
    dataset_export.zip/
    ├── {scene_name}/
    │   ├── data/
    │   │   ├── lidar/
    │   │   └── cameras/{camera_name}/
    │   └── annotations/
    │       ├── lidar.json
    │       ├── {camera_name}.json
    │       └── fusion.json
    └── metadata.json
    ```
    """
    dataset = await db.get(Dataset, dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    taxonomy = dataset.taxonomy or {}
    
    stmt = select(Scene).where(Scene.dataset_id == dataset_id)
    result = await db.execute(stmt)
    scenes = list(result.scalars().all())
    
    scenes_data = []
    total_annotations = {
        "cuboids_3d": 0,
        "boxes_2d": 0,
        "annotations_4d": 0,
        "annotations_fusion": 0,
        "annotations_legacy": 0,
        "tracks_2d": 0,
    }
    
    for scene in scenes:
        task_query = select(Task).where(Task.scene_id == scene.id)
        if accepted_only:
            task_query = task_query.where(Task.status == "accepted")
        result = await db.execute(task_query)
        tasks = list(result.scalars().all())
        
        scene_annotations = {
            "cuboids_3d": [],
            "boxes_2d": [],
            "annotations_4d": [],
            "annotations_fusion": [],
            "annotations_legacy": [],
            "tracks_2d": [],
        }

        for task in tasks:
            task_annotations = await get_annotations_for_task(db, task.id)
            for key in scene_annotations:
                scene_annotations[key].extend(task_annotations[key])
                total_annotations[key] += len(task_annotations[key])
        
        scene_annotations = merge_overlapping_annotations(scene_annotations)
        
        scenes_data.append({
            "scene": scene,
            "scene_metadata": get_scene_metadata(scene),
            "frames": await get_frames_metadata(db, scene.id),
            "task_count": len(tasks),
            "annotations": scene_annotations,
        })
    
    metadata = {
        "export_info": {
            "format_version": "2.0",
            "format": format,
            "exported_at": datetime.utcnow().isoformat(),
            "exported_by": current_user.username,
            "export_type": "dataset",
            "accepted_only": accepted_only,
        },
        "dataset": {
            "id": str(dataset.id),
            "name": dataset.name,
            "description": dataset.description,
            "sensor_config": dataset.sensor_config,
        },
        "taxonomy": taxonomy,
        "summary": {
            "scene_count": len(scenes),
            "total_annotations": total_annotations,
            "total_annotation_count": sum(total_annotations.values()),
        },
    }
    
    if format == "coco":
        zip_buffer = io.BytesIO()
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            all_scene_counts = {}
            for scene_data in scenes_data:
                scene = scene_data["scene"]
                scene_name = scene.name.replace("/", "_").replace("\\", "_")
                
                scene_metadata = {
                    "scene": scene_data["scene_metadata"],
                    "frames": scene_data["frames"],
                    "task_count": scene_data["task_count"],
                }
                zf.writestr(f"{scene_name}/metadata.json", json.dumps(scene_metadata, indent=2))
                
                annotation_counts = add_sensor_annotations_to_zip(
                    zf, scene_data["annotations"], scene_data["frames"], taxonomy, scene,
                    prefix=f"{scene_name}/annotations"
                )
                all_scene_counts[scene_name] = annotation_counts
                
                if include_data:
                    add_scene_data_to_zip(zf, scene, scene_data["frames"], prefix=f"{scene_name}/data")

                sc_classes = await get_segmentation_taxonomy_classes(db, scene.dataset_id)
                add_segmentation_kitti_to_zip(zf, scene, scene_data["frames"], taxonomy, prefix=f"{scene_name}/annotations", scene_classes=sc_classes)

            metadata["scene_annotation_counts"] = all_scene_counts
            zf.writestr("metadata.json", json.dumps(metadata, indent=2))
        
        zip_buffer.seek(0)
        filename = f"dataset_{dataset.name}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"
        return StreamingResponse(
            zip_buffer,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
    else:
        export_data = {
            **metadata,
            "scenes": [
                {
                    "scene": sd["scene_metadata"],
                    "frames": sd["frames"],
                    "task_count": sd["task_count"],
                    "annotations": sd["annotations"],
                }
                for sd in scenes_data
            ],
        }
        
        if include_data:
            zip_buffer = io.BytesIO()
            with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
                zf.writestr("labels.json", json.dumps(export_data, indent=2))
                
                for scene_data in scenes_data:
                    scene = scene_data["scene"]
                    scene_prefix = f"data/{scene.name}"
                    add_scene_data_to_zip(zf, scene, scene_data["frames"], prefix=scene_prefix)
            
            zip_buffer.seek(0)
            filename = f"dataset_{dataset.name}_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.zip"
            return StreamingResponse(
                zip_buffer,
                media_type="application/zip",
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )
        else:
            filename = f"dataset_{dataset.name}_labels_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}.json"
            return StreamingResponse(
                io.BytesIO(json.dumps(export_data, indent=2).encode()),
                media_type="application/json",
                headers={"Content-Disposition": f"attachment; filename={filename}"}
            )


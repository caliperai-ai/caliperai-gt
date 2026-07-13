"""
Annotation Import endpoints - Import annotations from external formats (COCO, KITTI, ZIP).

Supports:
- Single file imports (COCO JSON, KITTI TXT)
- ZIP file imports with per-sensor annotation files

Expected ZIP structure for multi-sensor import:
    annotations.zip/
    ├── annotations/
    │   ├── lidar.json          # COCO-like 3D annotations
    │   ├── camera_front.json   # COCO 2D annotations for camera_front
    │   ├── camera_rear.json    # COCO 2D annotations for camera_rear
    │   └── ...
    └── metadata.json (optional)
"""
import json
import io
import os
import zipfile
import random
import xml.etree.ElementTree as ET
from typing import Annotated, Optional, List, Dict, Any, Set

import numpy as np

SEGMENTATION_ROOT = os.environ.get("SEGMENTATION_ROOT", "/uploads/segmentation")
from uuid import UUID, uuid4
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import (
    Scene, Frame, Task, Annotation2D, Annotation3D, Track2D,
    User, Permission, AnnotationSource, Dataset, Taxonomy,
    dataset_taxonomy_association, TaxonomyAnnotationMode
)
from app.services.rbac_service import RequirePermissions

router = APIRouter()



FUSION_3D_TYPES = {"cuboid", "segmentation_3d", "cuboid_fusion"}

ONLY_2D_TYPES = {"box2d", "polygon", "polyline", "keypoints", "segmentation_2d", "semantic_segment"}

LIDAR_SENSOR_PATTERNS = {"lidar", "lidar_4d", "velodyne", "point_cloud", "pcd"}



def detect_annotation_mode_from_data(
    annotation_data: Dict[str, Any],
    sensor_name: Optional[str] = None,
) -> str:
    """
    Smart auto-detection of annotation mode based on annotation data.
    
    Returns:
        "fusion_3d" if the data contains 3D information (cuboids, 3D segmentation)
        "2d_only" if the data is pure 2D without 3D association
    """
    has_3d_position = any(key in annotation_data for key in [
        "position_x", "position_y", "position_z",
        "center", "position", "location"
    ])
    
    has_3d_dimensions = any(key in annotation_data for key in [
        "dimension_length", "dimension_width", "dimension_height",
        "dimensions", "size"
    ])
    
    has_rotation = any(key in annotation_data for key in [
        "rotation_yaw", "rotation_pitch", "rotation_roll",
        "rotation", "yaw"
    ])
    
    ann_type = annotation_data.get("type", "").lower()
    if ann_type in FUSION_3D_TYPES:
        return TaxonomyAnnotationMode.FUSION_3D.value
    
    if ann_type in ONLY_2D_TYPES and not has_3d_position and not has_3d_dimensions:
        return TaxonomyAnnotationMode.ONLY_2D.value
    
    if sensor_name:
        sensor_lower = sensor_name.lower()
        if any(pattern in sensor_lower for pattern in LIDAR_SENSOR_PATTERNS):
            return TaxonomyAnnotationMode.FUSION_3D.value
    
    if has_3d_position and has_3d_dimensions:
        return TaxonomyAnnotationMode.FUSION_3D.value
    
    return TaxonomyAnnotationMode.ONLY_2D.value


def detect_annotation_mode_from_file(
    file_content: Dict[str, Any],
    file_name: str,
) -> str:
    """
    Detect annotation mode from a file's structure and name.
    
    Returns:
        "fusion_3d" for 3D annotation files
        "2d_only" for pure 2D annotation files
    """
    sensor_name = file_name.replace('.json', '').split('/')[-1].lower()
    
    if any(pattern in sensor_name for pattern in LIDAR_SENSOR_PATTERNS):
        return TaxonomyAnnotationMode.FUSION_3D.value
    
    has_frames = "frames" in file_content
    has_images = "images" in file_content
    
    if has_frames and not has_images:
        return TaxonomyAnnotationMode.FUSION_3D.value
    
    annotations = file_content.get("annotations", [])
    if annotations:
        sample_ann = annotations[0] if isinstance(annotations, list) else annotations
        if isinstance(sample_ann, dict):
            if any(key in sample_ann for key in ["cuboid_3d", "position_3d", "dimensions_3d"]):
                return TaxonomyAnnotationMode.FUSION_3D.value
    
    return TaxonomyAnnotationMode.ONLY_2D.value


def generate_random_color() -> str:
    """Generate a random hex color."""
    return f"#{random.randint(0, 255):02x}{random.randint(0, 255):02x}{random.randint(0, 255):02x}"


def map_source_class_to_taxonomy(source_class_name: str, taxonomy: Dict[str, Any]) -> str:
    """Map a source annotation class name to a taxonomy class ID.
    
    This function handles the mismatch between class names in imported files
    (e.g., "Car", "Truck", "bi_cycle") and taxonomy class IDs/names.
    
    Only does EXACT matching (case-insensitive). If no exact match is found,
    returns the normalized source name so it can be added to taxonomy later.
    
    Args:
        source_class_name: Class name from the source file (KITTI, COCO, etc.)
        taxonomy: Dataset taxonomy dict with "classes" list
        
    Returns:
        The matching taxonomy class ID, or the normalized source name if no match found
    """
    if not taxonomy or "classes" not in taxonomy:
        return source_class_name.lower().replace(" ", "_").replace("-", "_")
    
    normalized_source = source_class_name.lower().replace(" ", "_").replace("-", "_")
    
    for cls in taxonomy["classes"]:
        cls_id = cls.get("id", "")
        cls_name = cls.get("name", "")
        
        if cls_id.lower() == normalized_source:
            return cls_id
        
        if cls_name.lower().replace(" ", "_").replace("-", "_") == normalized_source:
            return cls_id
    
    return normalized_source


async def create_taxonomy_from_classes(
    db: AsyncSession,
    task: Task,
    class_ids: Set[str],
    annotation_mode: str = TaxonomyAnnotationMode.FUSION_3D.value,
    coco_categories: Optional[Dict[int, Dict[str, Any]]] = None
) -> None:
    """Create or update taxonomy at the dataset level based on imported annotation classes.
    
    This function now supports annotation modes:
    - fusion_3d: Classes get cuboid, box2d, polygon types (for 3D/fusion annotations)
    - 2d_only: Classes get box2d, polygon, polyline types (for pure 2D annotations)
    
    Args:
        db: Database session
        task: Task whose dataset will receive the taxonomy
        class_ids: Set of unique class IDs found in annotations
        annotation_mode: "fusion_3d" or "2d_only" - determines annotation types for classes
        coco_categories: Optional COCO categories dict with id -> {name, supercategory}
    """
    import logging
    logger = logging.getLogger(__name__)
    
    if not class_ids:
        return
    
    try:
        scene_result = await db.execute(
            select(Scene).where(Scene.id == task.scene_id)
        )
        scene = scene_result.scalar_one_or_none()
        
        if not scene:
            logger.warning(f"Scene not found for task {task.id}")
            return
        
        dataset_result = await db.execute(
            select(Dataset).where(Dataset.id == scene.dataset_id)
        )
        dataset = dataset_result.scalar_one_or_none()
        
        if not dataset:
            logger.warning(f"Dataset not found for scene {scene.id}")
            return
        
        existing_taxonomy = dataset.taxonomy or {}
        existing_classes = {cls.get("id"): cls for cls in existing_taxonomy.get("classes", [])}
        
        updated = False
        for class_id in sorted(class_ids):
            if class_id not in existing_classes:
                class_name = class_id
                
                if coco_categories:
                    try:
                        coco_id = int(class_id)
                        if coco_id in coco_categories:
                            class_name = coco_categories[coco_id].get("name", class_id)
                    except (ValueError, KeyError):
                        pass
                
                if annotation_mode == TaxonomyAnnotationMode.FUSION_3D.value:
                    class_types = ["cuboid", "box2d", "polygon"]
                else:
                    class_types = ["box2d", "polygon", "polyline", "keypoints"]
                
                new_class = {
                    "id": class_id,
                    "name": class_name,
                    "color": generate_random_color(),
                    "type": class_types
                }
                
                if "classes" not in existing_taxonomy:
                    existing_taxonomy["classes"] = []
                
                existing_taxonomy["classes"].append(new_class)
                existing_classes[class_id] = new_class
                updated = True
                logger.info(f"Added class '{class_id}' to dataset taxonomy (mode: {annotation_mode})")
        
        if updated:
            if "attributes" not in existing_taxonomy:
                existing_taxonomy["attributes"] = []
            if "annotation_rules" not in existing_taxonomy:
                existing_taxonomy["annotation_rules"] = {}
            
            dataset.taxonomy = existing_taxonomy
            await db.commit()
            logger.info(f"Updated dataset {dataset.id} taxonomy with {len(class_ids)} classes (mode: {annotation_mode})")
        else:
            logger.info(f"All {len(class_ids)} classes already exist in dataset taxonomy")
    
    except Exception as e:
        logger.error(f"Error creating taxonomy: {e}", exc_info=True)
        pass

def parse_calipergt_2d_annotations(
    coco_data: dict,
    camera_id: str,
    frame_id_map: Dict[int, UUID],
    taxonomy: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Parse CaliperGT export format 2D annotations.

    CaliperGT format::

        {
            "categories": {
                "label": {
                    "labels": [{"name": "car", ...}, ...],
                    "attributes": [...]
                }
            },
            "items": [
                {
                    "id": "frame_basename",
                    "annotations": [
                        {"id": 0, "type": "bbox", "label_id": 0, "bbox": [x,y,w,h], "attributes": {...}}
                    ],
                    "attr": {"frame": 0}
                }
            ]
        }
    """
    annotations_to_create = []

    label_map: Dict[int, str] = {}
    labels = coco_data.get("categories", {}).get("label", {}).get("labels", [])
    for idx, label in enumerate(labels):
        label_name = label.get("name")
        if label_name:
            label_map[idx] = label_name
        else:
            label_map[idx] = f"unknown_class_{idx}"

    for item in coco_data.get("items", []):
        attr = item.get("attr", {})
        frame_index = attr.get("frame")
        if frame_index is None:
            try:
                frame_index = int(str(item.get("id", "0")).split(".")[0].lstrip("0") or "0")
            except (ValueError, TypeError):
                continue

        frame_id = frame_id_map.get(frame_index)
        if frame_id is None:
            continue

        for ann in item.get("annotations", []):
            if ann.get("type") != "bbox":
                continue

            bbox = ann.get("bbox", [0, 0, 0, 0])
            if len(bbox) < 4:
                continue

            label_id = ann.get("label_id", 0)
            source_class_name = label_map.get(label_id)
            if not source_class_name:
                source_class_name = f"unknown_class_{label_id}"
            class_id = map_source_class_to_taxonomy(source_class_name, taxonomy) if taxonomy else source_class_name

            annotations_to_create.append({
                "type": "2d",
                "frame_index": frame_index,
                "frame_id": frame_id,
                "camera_id": camera_id,
                "class_id": class_id,
                "bbox_x": bbox[0],
                "bbox_y": bbox[1],
                "bbox_width": bbox[2],
                "bbox_height": bbox[3],
                "attributes": {k: v for k, v in ann.get("attributes", {}).items()
                               if k not in ("uuid", "rotation")},
                "source": AnnotationSource.AUTO.value,
                "confidence": ann.get("attributes", {}).get("score", 1.0),
                "track_id": ann.get("attributes", {}).get("track_id"),
            })

    return annotations_to_create


def parse_coco_2d_annotations(
    coco_data: dict, 
    camera_id: str,
    frame_id_map: Dict[int, UUID],
    taxonomy: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Parse COCO format 2D annotations for a specific camera.
    
    COCO format structure:
    {
        "images": [{"id": 1, "file_name": "000001.jpg", "width": 1920, "height": 1080}],
        "annotations": [{"id": 1, "image_id": 1, "category_id": 1, "bbox": [x, y, w, h]}],
        "categories": [{"id": 1, "name": "car"}]
    }
    """
    annotations_to_create = []
    
    category_map = {}
    for cat in coco_data.get("categories", []):
        cat_id = cat.get("id")
        cat_name = cat.get("name", "")
        if cat_id is not None and cat_name:
            category_map[cat_id] = cat_name
            category_map[str(cat_id)] = cat_name
            if isinstance(cat_id, str):
                try:
                    category_map[int(cat_id)] = cat_name
                except ValueError:
                    pass
    
    image_to_frame = {}
    for img in coco_data.get("images", []):
        frame_index = img.get("frame_index")
        if frame_index is None:
            file_name = img.get("file_name", "")
            try:
                frame_index = int(file_name.split('.')[0].lstrip('0') or '0')
            except ValueError:
                frame_index = img["id"]
        image_to_frame[img["id"]] = frame_index
    
    for ann in coco_data.get("annotations", []):
        image_id = ann["image_id"]
        frame_index = image_to_frame.get(image_id)
        if frame_index is None:
            continue
        
        frame_id = frame_id_map.get(frame_index)
        if frame_id is None:
            continue
            
        bbox = ann.get("bbox", [0, 0, 0, 0])
        
        ann_type = ann.get("type", "").lower()

        polyline_points = None
        raw_polyline = ann.get("polyline")
        if ann_type in ("polyline", "line", "bezier") and raw_polyline:
            polyline_points = [{"x": p[0], "y": p[1]} for p in raw_polyline if len(p) >= 2]
        elif ann_type in ("polyline", "line", "bezier"):
            seg = ann.get("segmentation")
            if seg and isinstance(seg, list) and seg[0]:
                flat = seg[0]
                polyline_points = [
                    {"x": flat[i], "y": flat[i+1]}
                    for i in range(0, len(flat) - 1, 2)
                ]

        polygon_points = None
        if ann_type not in ("polyline", "line", "bezier"):
            segmentation = ann.get("segmentation")
            has_polygon = segmentation and isinstance(segmentation, list) and len(segmentation) > 0
            if has_polygon and isinstance(segmentation[0], list):
                polygon_points = segmentation[0]

        ellipse_data = ann.get("ellipse") if ann_type == "ellipse" else None

        rotated_box_data = ann.get("rotated_box") if ann_type in ("rotated_box", "rotated_rectangle") else None

        keypoints_flat = ann.get("keypoints") if ann_type in ("keypoints", "points") else None
        keypoint_names = ann.get("keypoint_names", []) if keypoints_flat else []
        
        cat_id = ann.get("category_id")
        source_class_name = category_map.get(cat_id) or category_map.get(str(cat_id) if cat_id else None)
        if not source_class_name:
            if cat_id is not None:
                if isinstance(cat_id, str) and not cat_id.isdigit():
                    source_class_name = cat_id
                else:
                    source_class_name = f"unknown_class_{cat_id}"
            else:
                source_class_name = "unknown"
        class_id = map_source_class_to_taxonomy(source_class_name, taxonomy) if taxonomy else source_class_name
        
        annotation_dict = {
            "type": "2d",
            "ann_type": ann_type,
            "frame_index": frame_index,
            "frame_id": frame_id,
            "camera_id": camera_id,
            "class_id": class_id,
            "bbox_x": bbox[0],
            "bbox_y": bbox[1],
            "bbox_width": bbox[2],
            "bbox_height": bbox[3],
            "attributes": ann.get("attributes", {}),
            "source": AnnotationSource.AUTO.value,
            "confidence": ann.get("score", 1.0),
            "track_id": ann.get("track_id"),
        }
        
        if polyline_points:
            annotation_dict["polyline_points"] = polyline_points
        elif polygon_points:
            annotation_dict["polygon_points"] = polygon_points
        if ellipse_data:
            annotation_dict["ellipse_data"] = ellipse_data
        if rotated_box_data:
            annotation_dict["rotated_box_data"] = rotated_box_data
        if keypoints_flat:
            annotation_dict["keypoints_flat"] = keypoints_flat
            annotation_dict["keypoint_names"] = keypoint_names
        
        annotations_to_create.append(annotation_dict)
    
    return annotations_to_create


def parse_coco_3d_annotations(
    coco_data: dict,
    frame_id_map: Dict[int, UUID],
    taxonomy: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Parse COCO-like 3D annotations for LiDAR.
    
    Expected format:
    {
        "frames": [{"id": 0, "file_name": "000000.pcd", "timestamp": 0.0}],
        "annotations": [
            {
                "id": 1, 
                "frame_id": 0, 
                "category_id": 1, 
                "cuboid_3d": {
                    "position": {"x": 10.0, "y": 5.0, "z": 0.5},
                    "dimensions": {"length": 4.5, "width": 2.0, "height": 1.5},
                    "rotation": {"yaw": 0.1, "pitch": 0.0, "roll": 0.0}
                }
            }
        ],
        "categories": [{"id": 1, "name": "car"}]
    }
    """
    annotations_to_create = []
    
    category_map = {cat["id"]: cat["name"] for cat in coco_data.get("categories", [])}

    json_frame_id_to_index: Dict[Any, int] = {}
    for frame in coco_data.get("frames", []):
        json_id = frame.get("id")
        if json_id is None:
            continue
        frame_index_val = frame.get("frame_index")
        if frame_index_val is None:
            file_name = frame.get("file_name", "")
            try:
                frame_index_val = int(file_name.split(".")[0].lstrip("0") or "0")
            except ValueError:
                frame_index_val = json_id
        json_frame_id_to_index[json_id] = int(frame_index_val)

    uuid_to_frame_index: Dict[str, int] = {
        str(uuid_val): idx for idx, uuid_val in frame_id_map.items()
    }

    for ann in coco_data.get("annotations", []):
        raw_frame_ref = ann.get("frame_id", ann.get("frame_index", 0))

        if json_frame_id_to_index and raw_frame_ref in json_frame_id_to_index:
            frame_index = json_frame_id_to_index[raw_frame_ref]
        elif isinstance(raw_frame_ref, str) and raw_frame_ref in uuid_to_frame_index:
            frame_index = uuid_to_frame_index[raw_frame_ref]
        else:
            try:
                frame_index = int(raw_frame_ref)
            except (TypeError, ValueError):
                continue
        
        cuboid = ann.get("cuboid_3d", {})
        position = cuboid.get("position", {})
        dimensions = cuboid.get("dimensions", {})
        rotation = cuboid.get("rotation", {})
        
        if not position or not dimensions:
            continue
        
        source_class_name = category_map.get(ann.get("category_id"), f"class_{ann.get('category_id', 0)}")
        class_id = map_source_class_to_taxonomy(source_class_name, taxonomy) if taxonomy else source_class_name
        
        annotations_to_create.append({
            "type": "3d",
            "frame_index": frame_index,
            "class_id": class_id,
            "position_x": position.get("x", 0),
            "position_y": position.get("y", 0),
            "position_z": position.get("z", 0),
            "dimension_length": dimensions.get("length", 0),
            "dimension_width": dimensions.get("width", 0),
            "dimension_height": dimensions.get("height", 0),
            "rotation_yaw": rotation.get("yaw", 0),
            "rotation_pitch": rotation.get("pitch", 0),
            "rotation_roll": rotation.get("roll", 0),
            "attributes": ann.get("attributes", {}),
            "source": AnnotationSource.AUTO.value,
            "confidence": ann.get("confidence", ann.get("score", 1.0)),
            "track_id": ann.get("track_id"),
        })
    
    return annotations_to_create


def parse_coco_annotations(coco_data: dict, scene: Scene, task: Task) -> List[Dict[str, Any]]:
    """Parse COCO format annotations and convert to internal format (legacy function).
    
    COCO format structure:
    {
        "images": [{"id": 1, "file_name": "000001.jpg", "width": 1920, "height": 1080}],
        "annotations": [{"id": 1, "image_id": 1, "category_id": 1, "bbox": [x, y, w, h]}],
        "categories": [{"id": 1, "name": "car"}]
    }
    """
    annotations_to_create = []
    
    category_map = {cat["id"]: cat["name"] for cat in coco_data.get("categories", [])}
    
    image_map = {}
    for img in coco_data.get("images", []):
        file_name = img["file_name"]
        try:
            frame_idx = int(file_name.split('.')[0].lstrip('0') or '0')
        except ValueError:
            frame_idx = img["id"]
        image_map[img["id"]] = frame_idx
    
    for ann in coco_data.get("annotations", []):
        image_id = ann["image_id"]
        if image_id not in image_map:
            continue
            
        frame_index = image_map[image_id]
        bbox = ann["bbox"]
        
        annotations_to_create.append({
            "frame_index": frame_index,
            "class_id": category_map.get(ann["category_id"], f"class_{ann['category_id']}"),
            "bbox_x": bbox[0],
            "bbox_y": bbox[1],
            "bbox_width": bbox[2],
            "bbox_height": bbox[3],
            "attributes": {},
            "source": AnnotationSource.AUTO_INTERPOLATED.value,
            "confidence": ann.get("score", 1.0),
            "camera_id": ann.get("camera_id", "camera_front")
        })
    
    return annotations_to_create


def parse_kitti_annotations(
    kitti_lines: List[str], 
    scene: Scene, 
    task: Task,
    taxonomy: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Parse KITTI format annotations and convert to internal format.
    
    KITTI format (one line per object):
    Type Truncated Occluded Alpha Bbox_2D[4] Dimensions[3] Location[3] Rotation_y Score
    Example: Car 0.00 0 -1.57 599.41 156.40 629.75 189.25 1.50 1.60 3.70 -0.30 1.65 46.70 -1.53
    """
    annotations_to_create = []
    
    for line in kitti_lines:
        parts = line.strip().split()
        if len(parts) < 15:
            continue
            
        class_name = parts[0]
        truncated = float(parts[1])
        occluded = int(parts[2])
        alpha = float(parts[3])
        
        bbox_2d = [float(parts[4]), float(parts[5]), float(parts[6]), float(parts[7])]
        
        height = float(parts[8])
        width = float(parts[9])
        length = float(parts[10])
        
        location_x = float(parts[11])
        location_y = float(parts[12])
        location_z = float(parts[13])
        
        rotation_y = float(parts[14])
        
        score = float(parts[15]) if len(parts) > 15 else 1.0
        
        class_id = map_source_class_to_taxonomy(class_name, taxonomy) if taxonomy else class_name.lower()
        
        annotations_to_create.append({
            "frame_index": 0,
            "class_id": class_id,
            "position_x": location_x,
            "position_y": location_y,
            "position_z": location_z,
            "dimension_length": length,
            "dimension_width": width,
            "dimension_height": height,
            "rotation_yaw": rotation_y,
            "rotation_pitch": 0.0,
            "rotation_roll": 0.0,
            "attributes": {
                "truncated": truncated,
                "occluded": occluded,
                "alpha": alpha
            },
            "source": AnnotationSource.AUTO.value,
            "confidence": score
        })
    
    return annotations_to_create


def parse_cvat_xml_annotations(xml_content: str, frame_id_map: Dict[int, UUID]) -> List[Dict[str, Any]]:
    """Parse CVAT XML format annotations with 3D attributes into per-frame 3D boxes.
    
    CVAT exports 3D annotations with box elements containing position_3d, rotation_3d, 
    and dimensions_3d as attributes. This parser handles both image-based and track-based formats.
    
    Expected format:
    <annotations>
      <image id="0" name="0">
        <box label="Car" track_id="0" ...>
          <attribute name="position_3d">x,y,z</attribute>
          <attribute name="rotation_3d">rx,ry,rz</attribute>
          <attribute name="dimensions_3d">l,w,h</attribute>
        </box>
      </image>
    </annotations>
    
    Or track-based format:
    <annotations>
      <track id="0" label="Car">
        <box frame="0" ...>
          <attribute name="position_3d">x,y,z</attribute>
          ...
        </box>
      </track>
    </annotations>
    """
    import logging
    logger = logging.getLogger(__name__)
    
    annotations: List[Dict[str, Any]] = []

    def parse_3d_values(value_str: str) -> tuple:
        """Parse comma-separated 3D values like 'x,y,z' into tuple of floats."""
        try:
            parts = value_str.split(',')
            return tuple(float(p.strip()) for p in parts)
        except Exception as e:
            logger.warning(f"Failed to parse 3D values '{value_str}': {e}")
            return (0.0, 0.0, 0.0)

    def get_box_attributes(box_el: ET.Element) -> Dict[str, Any]:
        """Extract 3D attributes from a box element."""
        attrs = {}
        for attr_el in box_el.findall('attribute'):
            name = attr_el.get('name', '')
            value = attr_el.text or ''
            attrs[name] = value
        return attrs

    try:
        root = ET.fromstring(xml_content)
        logger.info(f"Parsing CVAT XML, root tag: {root.tag}")
    except ET.ParseError as e:
        logger.error(f"Failed to parse XML: {e}")
        return annotations

    images_found = 0
    boxes_found = 0
    for image_el in root.findall('.//image'):
        images_found += 1
        frame_index = 0
        image_id = image_el.get('id', '')
        image_name = image_el.get('name', '')
        
        try:
            if image_id and image_id.isdigit():
                frame_index = int(image_id)
            elif image_name:
                name_clean = image_name.split('.')[0]
                name_clean = ''.join(filter(str.isdigit, name_clean)) or '0'
                frame_index = int(name_clean.lstrip('0') or '0')
        except ValueError:
            frame_index = 0

        for box_el in image_el.findall('box'):
            boxes_found += 1
            label = box_el.get('label', 'unknown').lower()
            track_id = box_el.get('track_id', '')
            occluded = int(box_el.get('occluded', '0'))
            
            attrs = get_box_attributes(box_el)
            
            position_3d = attrs.get('position_3d', '0,0,0')
            rotation_3d = attrs.get('rotation_3d', '0,0,0')
            dimensions_3d = attrs.get('dimensions_3d', '1,1,1')
            
            px, py, pz = parse_3d_values(position_3d)
            rx, ry, rz = parse_3d_values(rotation_3d)
            dim_l, dim_w, dim_h = parse_3d_values(dimensions_3d)
            
            if 'dimensions_3d' not in attrs:
                logger.warning(f"Box {track_id} at frame {frame_index} missing dimensions_3d attribute")
                continue
            
            annotations.append({
                "frame_index": frame_index,
                "class_id": label,
                "position_x": px,
                "position_y": py,
                "position_z": pz,
                "dimension_length": dim_l,
                "dimension_width": dim_w,
                "dimension_height": dim_h,
                "rotation_yaw": rz,
                "rotation_pitch": ry,
                "rotation_roll": rx,
                "attributes": {
                    "occluded": occluded,
                    "track_id": track_id,
                    "det_id": attrs.get('det_id', ''),
                },
                "source": AnnotationSource.AUTO.value,
                "confidence": 1.0,
                "track_id": track_id if track_id else None,
            })
    
    logger.info(f"Found {images_found} images, {boxes_found} boxes, created {len(annotations)} annotations from image format")

    tracks_found = 0
    track_boxes_found = 0
    for track_el in root.findall('.//track'):
        tracks_found += 1
        label = track_el.get('label', 'unknown').lower()
        track_id = track_el.get('id', '')
        
        for box_el in track_el.findall('box'):
            track_boxes_found += 1
            frame_str = box_el.get('frame', '0')
            try:
                frame_index = int(frame_str)
            except ValueError:
                frame_index = 0
            
            occluded = int(box_el.get('occluded', '0'))
            outside = int(box_el.get('outside', '0'))
            
            if outside:
                continue
            
            attrs = get_box_attributes(box_el)
            
            position_3d = attrs.get('position_3d', '0,0,0')
            rotation_3d = attrs.get('rotation_3d', '0,0,0')
            dimensions_3d = attrs.get('dimensions_3d', '1,1,1')
            
            px, py, pz = parse_3d_values(position_3d)
            rx, ry, rz = parse_3d_values(rotation_3d)
            dim_l, dim_w, dim_h = parse_3d_values(dimensions_3d)
            
            if 'dimensions_3d' not in attrs:
                logger.warning(f"Track {track_id} box at frame {frame_index} missing dimensions_3d attribute")
                continue
            
            annotations.append({
                "frame_index": frame_index,
                "class_id": label,
                "position_x": px,
                "position_y": py,
                "position_z": pz,
                "dimension_length": dim_l,
                "dimension_width": dim_w,
                "dimension_height": dim_h,
                "rotation_yaw": rz,
                "rotation_pitch": ry,
                "rotation_roll": rx,
                "attributes": {
                    "occluded": occluded,
                    "track_id": track_id,
                    "det_id": attrs.get('det_id', ''),
                },
                "source": AnnotationSource.AUTO.value,
                "confidence": 1.0,
                "track_id": track_id if track_id else None,
            })
    
    logger.info(f"Found {tracks_found} tracks, {track_boxes_found} track boxes, total annotations: {len(annotations)}")
    return annotations


def parse_cvat_json_annotations(
    cvat_data: dict,
    frame_id_map: Dict[int, UUID],
    taxonomy: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Parse CVAT JSON format 3D cuboid annotations.

    CVAT JSON structure (from auto-annotation export):
    {
        "version": "1.0",
        "tags": [],
        "shapes": [],
        "tracks": [
            {
                "frame": 0,
                "label": "truck",
                "shapes": [
                    {
                        "type": "cuboid",
                        "frame": 0,
                        "outside": false,
                        "points": [x, y, z, rx, ry, rz, length, width, height, 0, 0, 0, 0, 0, 0, 0]
                    }
                ]
            }
        ]
    }

    Points layout (16 values):
        [0:3]  position  x, y, z
        [3:6]  rotation  rx, ry, rz  (rz = yaw)
        [6:9]  dimensions  length, width, height
        [9:16] reserved / zeros
    """
    annotations: List[Dict[str, Any]] = []

    track_id_map_local: Dict[int, UUID] = {}

    for track_idx, track in enumerate(cvat_data.get("tracks", [])):
        label = track.get("label", "unknown").lower()
        class_id = map_source_class_to_taxonomy(label, taxonomy) if taxonomy else label

        if track_idx not in track_id_map_local:
            track_id_map_local[track_idx] = uuid4()
        track_uuid = track_id_map_local[track_idx]

        for shape in track.get("shapes", []):
            if shape.get("outside", False):
                continue

            if shape.get("type") != "cuboid":
                continue

            frame_index = shape.get("frame", 0)
            if frame_index not in frame_id_map:
                continue

            pts = shape.get("points", [])
            if len(pts) < 9:
                continue

            x, y, z = pts[0], pts[1], pts[2]
            rx, ry, rz = pts[3], pts[4], pts[5]
            width, length, height = pts[6], pts[7], pts[8]

            annotations.append({
                "type": "3d",
                "frame_index": frame_index,
                "class_id": class_id,
                "position_x": x,
                "position_y": y,
                "position_z": z,
                "dimension_length": length,
                "dimension_width": width,
                "dimension_height": height,
                "rotation_yaw": rz,
                "rotation_pitch": ry,
                "rotation_roll": rx,
                "attributes": shape.get("attributes", {}),
                "source": AnnotationSource.AUTO.value,
                "confidence": shape.get("confidence", 1.0),
                "track_id": str(track_uuid),
            })

    for shape in cvat_data.get("shapes", []):
        if shape.get("outside", False) or shape.get("type") != "cuboid":
            continue

        label = shape.get("label", "unknown").lower()
        class_id = map_source_class_to_taxonomy(label, taxonomy) if taxonomy else label
        frame_index = shape.get("frame", 0)
        if frame_index not in frame_id_map:
            continue

        pts = shape.get("points", [])
        if len(pts) < 9:
            continue

        x, y, z = pts[0], pts[1], pts[2]
        rx, ry, rz = pts[3], pts[4], pts[5]
        width, length, height = pts[6], pts[7], pts[8]

        annotations.append({
            "type": "3d",
            "frame_index": frame_index,
            "class_id": class_id,
            "position_x": x,
            "position_y": y,
            "position_z": z,
            "dimension_length": length,
            "dimension_width": width,
            "dimension_height": height,
            "rotation_yaw": rz,
            "rotation_pitch": ry,
            "rotation_roll": rx,
            "attributes": shape.get("attributes", {}),
            "source": AnnotationSource.AUTO.value,
            "confidence": shape.get("confidence", 1.0),
            "track_id": None,
        })

    return annotations


def parse_kitti_tracklet_annotations(xml_content: str, frame_id_map: Dict[int, UUID]) -> List[Dict[str, Any]]:
    """Parse KITTI tracklet_labels.xml annotations into per-frame 3D boxes.
    
    KITTI raw sequences provide 3D boxes in tracklet_labels.xml with one tracklet per object
    and per-frame poses. This converts each pose into an Annotation3D entry keyed by frame index.
    """
    annotations: List[Dict[str, Any]] = []

    def _get_float(el: Optional[ET.Element], tag: str, default: float = 0.0) -> float:
        try:
            text = el.find(tag).text if el is not None else None
            return float(text) if text is not None else default
        except Exception:
            return default

    def _get_int(el: Optional[ET.Element], tag: str, default: int = 0) -> int:
        try:
            text = el.find(tag).text if el is not None else None
            return int(text) if text is not None else default
        except Exception:
            return default

    try:
        root = ET.fromstring(xml_content)
    except ET.ParseError:
        return annotations

    for tracklet in root.findall('item'):
        class_name = (tracklet.findtext('objectType') or 'unknown').lower()
        height = _get_float(tracklet, 'h')
        width = _get_float(tracklet, 'w')
        length = _get_float(tracklet, 'l')
        first_frame = _get_int(tracklet, 'first_frame', 0)

        poses_el = tracklet.find('poses')
        if poses_el is None:
            continue

        for frame_offset, pose_el in enumerate(poses_el.findall('item')):
            frame_index = first_frame + frame_offset
            if frame_index not in frame_id_map:
                continue

            tx = _get_float(pose_el, 'tx')
            ty = _get_float(pose_el, 'ty')
            tz = _get_float(pose_el, 'tz')
            rx = _get_float(pose_el, 'rx')
            ry = _get_float(pose_el, 'ry')
            rz = _get_float(pose_el, 'rz')

            occlusion = _get_int(pose_el, 'occlusion', _get_int(pose_el, 'occlusion_kf', 0))
            truncation = _get_float(pose_el, 'truncation', 0.0)
            state = _get_int(pose_el, 'state', 0)

            annotations.append({
                "frame_index": frame_index,
                "class_id": class_name,
                "position_x": tx,
                "position_y": ty,
                "position_z": tz,
                "dimension_length": length,
                "dimension_width": width,
                "dimension_height": height,
                "rotation_yaw": rz,
                "rotation_pitch": ry,
                "rotation_roll": rx,
                "attributes": {
                    "truncated": truncation,
                    "occluded": occlusion,
                    "state": state,
                },
                "source": AnnotationSource.AUTO.value,
                "confidence": 1.0,
            })

    return annotations


def compute_annotation_fingerprint(frame_id: UUID, camera_id: str, bbox_x: float, bbox_y: float, bbox_w: float, bbox_h: float) -> str:
    """Compute a fingerprint for a 2D annotation for deduplication.
    
    Uses frame_id, camera_id, and rounded bbox coordinates to identify duplicates.
    Coordinates are rounded to handle minor floating point differences.
    """
    return f"{frame_id}:{camera_id}:{round(bbox_x, 1)}:{round(bbox_y, 1)}:{round(bbox_w, 1)}:{round(bbox_h, 1)}"


def compute_3d_annotation_fingerprint(frame_id: UUID, pos_x: float, pos_y: float, pos_z: float, dim_l: float, dim_w: float, dim_h: float) -> str:
    """Compute a fingerprint for a 3D annotation for deduplication."""
    return f"{frame_id}:{round(pos_x, 1)}:{round(pos_y, 1)}:{round(pos_z, 1)}:{round(dim_l, 1)}:{round(dim_w, 1)}:{round(dim_h, 1)}"


def build_empty_import_results() -> Dict[str, Any]:
    """Create a blank import results structure compatible with process_zip_annotations output."""
    return {
        "sensors_processed": {},
        "total_imported": 0,
        "errors": [],
        "unique_class_ids": set(),
        "coco_categories": {},
        "detected_modes": set(),
        "class_ids_by_mode": {
            TaxonomyAnnotationMode.FUSION_3D.value: set(),
            TaxonomyAnnotationMode.ONLY_2D.value: set(),
        },
        "skipped_duplicates": 0,
    }


def merge_import_results(base: Dict[str, Any], part: Dict[str, Any], sensor_prefix: Optional[str] = None) -> None:
    """Merge a per-task import result into an aggregated result."""
    for sensor_name, count in (part.get("sensors_processed") or {}).items():
        key = f"{sensor_prefix}/{sensor_name}" if sensor_prefix else sensor_name
        base["sensors_processed"][key] = base["sensors_processed"].get(key, 0) + count

    base["total_imported"] += int(part.get("total_imported", 0))
    base["errors"].extend(part.get("errors") or [])
    base["unique_class_ids"].update(part.get("unique_class_ids") or set())
    base["coco_categories"].update(part.get("coco_categories") or {})
    base["detected_modes"].update(part.get("detected_modes") or set())

    base_fusion = base["class_ids_by_mode"][TaxonomyAnnotationMode.FUSION_3D.value]
    base_2d = base["class_ids_by_mode"][TaxonomyAnnotationMode.ONLY_2D.value]
    part_modes = part.get("class_ids_by_mode") or {}
    base_fusion.update(part_modes.get(TaxonomyAnnotationMode.FUSION_3D.value, set()))
    base_2d.update(part_modes.get(TaxonomyAnnotationMode.ONLY_2D.value, set()))

    base["skipped_duplicates"] += int(part.get("skipped_duplicates", 0))


def extract_task_id_from_folder_name(folder_name: str) -> Optional[UUID]:
    """Extract a UUID from a task export folder name like 'Task_Name__ab12cd34' when possible."""
    if "__" not in folder_name:
        return None
    maybe_id = folder_name.split("__", 1)[1]
    try:
        return UUID(maybe_id)
    except Exception:
        return None


def build_subzip_for_task_folder(zip_content: bytes, task_folder_prefix: str, metadata: Optional[Dict[str, Any]] = None) -> Optional[bytes]:
    """Create an in-memory ZIP containing just one task folder remapped under annotations/."""
    if not task_folder_prefix:
        return None

    prefix = task_folder_prefix.strip("/") + "/"
    out = io.BytesIO()
    copied = 0

    with zipfile.ZipFile(io.BytesIO(zip_content), 'r') as src:
        with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED) as dst:
            for name in src.namelist():
                if not name.startswith(prefix):
                    continue
                rel = name[len(prefix):]
                if not rel:
                    continue
                dst.writestr(f"annotations/{rel}", src.read(name))
                copied += 1

            if copied > 0 and metadata:
                dst.writestr("metadata.json", json.dumps(metadata, indent=2))

    if copied == 0:
        return None
    return out.getvalue()


async def process_zip_annotations(
    zip_content: bytes,
    scene: Scene,
    task: Task,
    frame_id_map: Dict[int, UUID],
    db: AsyncSession,
    taxonomy_id: Optional[UUID] = None,
) -> Dict[str, Any]:
    """
    Process a ZIP file containing per-sensor annotation files.
    
    Expected ZIP structure:
        annotations/
        ├── lidar/
        │   ├── 000000.txt    # KITTI format per frame
        │   ├── 000001.txt
        │   └── ...
        ├── camera_front.json  # COCO format
        ├── camera_rear.json
        └── ...
    
    Returns dict with counts per sensor and any errors.
    """
    results = {
        "sensors_processed": {},
        "total_imported": 0,
        "errors": [],
        "unique_class_ids": set(),
        "coco_categories": {},
        "detected_modes": set(),
        "class_ids_by_mode": {
            TaxonomyAnnotationMode.FUSION_3D.value: set(),
            TaxonomyAnnotationMode.ONLY_2D.value: set(),
        }
    }
    
    dataset_result = await db.execute(
        select(Dataset).where(Dataset.id == scene.dataset_id)
    )
    dataset = dataset_result.scalar_one_or_none()
    taxonomy = dataset.taxonomy if dataset else None
    
    default_camera_id = "default"
    if frame_id_map:
        first_frame_id = list(frame_id_map.values())[0]
        frame_result = await db.execute(select(Frame).where(Frame.id == first_frame_id))
        first_frame = frame_result.scalar_one_or_none()
        if first_frame and first_frame.file_paths:
            cameras = first_frame.file_paths.get("cameras", {})
            if cameras:
                default_camera_id = list(cameras.keys())[0]
    
    existing_2d_fingerprints = set()
    existing_3d_fingerprints = set()
    
    existing_2d_query = select(Annotation2D).where(Annotation2D.task_id == task.id)
    existing_2d_result = await db.execute(existing_2d_query)
    for ann in existing_2d_result.scalars().all():
        data = ann.data or {}
        bbox = data.get("bbox", {})
        fp = compute_annotation_fingerprint(
            ann.frame_id, ann.camera_id or "",
            bbox.get("x", 0), bbox.get("y", 0), bbox.get("width", 0), bbox.get("height", 0)
        )
        existing_2d_fingerprints.add(fp)
    
    existing_3d_query = select(Annotation3D).where(Annotation3D.task_id == task.id)
    existing_3d_result = await db.execute(existing_3d_query)
    for ann in existing_3d_result.scalars().all():
        data = ann.data or {}
        center = data.get("center", {})
        dims = data.get("dimensions", {})
        fp = compute_3d_annotation_fingerprint(
            ann.frame_id,
            center.get("x", 0), center.get("y", 0), center.get("z", 0),
            dims.get("length", 0), dims.get("width", 0), dims.get("height", 0)
        )
        existing_3d_fingerprints.add(fp)
    
    skipped_duplicates = 0
    
    try:
        with zipfile.ZipFile(io.BytesIO(zip_content), 'r') as zf:
            json_files = [
                f for f in zf.namelist() 
                if f.endswith('.json') 
                and '__MACOSX' not in f 
                and not any(part.startswith('.') for part in f.split('/'))
            ]
            
            lidar_txt_files = [
                f for f in zf.namelist()
                if f.endswith('.txt')
                and ('lidar/' in f.lower() or '/lidar/' in f.lower() or 'label_2/' in f.lower() or '/label_2/' in f.lower())
                and '__MACOSX' not in f
                and not any(part.startswith('.') for part in f.split('/'))
            ]
            
            for json_file in json_files:
                file_name = json_file.split('/')[-1]
                if file_name == 'metadata.json':
                    continue
                
                sensor_name = file_name.replace('.json', '')
                
                try:
                    try:
                        content = zf.read(json_file).decode('utf-8')
                    except UnicodeDecodeError:
                        try:
                            content = zf.read(json_file).decode('latin-1')
                        except:
                            results["errors"].append(f"Encoding error in {json_file}")
                            continue
                    
                    coco_data = json.loads(content)
                    
                    if "categories" in coco_data and isinstance(coco_data["categories"], list):
                        for cat in coco_data["categories"]:
                            if isinstance(cat, dict) and "id" in cat:
                                results["coco_categories"][cat["id"]] = cat
                    
                    annotations_to_create = []
                    
                    is_lidar = sensor_name.lower() in ['lidar', 'lidar_4d', 'velodyne', 'point_cloud']
                    has_frames = 'frames' in coco_data
                    is_coco_2d = 'images' in coco_data and 'annotations' in coco_data
                    cvat_shaped_tracks = (
                        isinstance(coco_data.get('tracks'), list)
                        and any(isinstance(t, dict) and 'shapes' in t for t in coco_data['tracks'])
                    )
                    is_cvat_json = (not is_coco_2d) and (
                        cvat_shaped_tracks or ('shapes' in coco_data and 'version' in coco_data)
                    )
                    is_calipergt = (
                        "items" in coco_data
                        and isinstance(coco_data.get("categories"), dict)
                        and "label" in coco_data.get("categories", {})
                    )

                    file_mode = detect_annotation_mode_from_file(coco_data, sensor_name)
                    results["detected_modes"].add(file_mode)

                    if is_cvat_json:
                        annotations_to_create = parse_cvat_json_annotations(coco_data, frame_id_map, taxonomy)
                    elif is_calipergt:
                        annotations_to_create = parse_calipergt_2d_annotations(
                            coco_data, default_camera_id, frame_id_map, taxonomy
                        )
                    elif is_lidar or has_frames:
                        annotations_to_create = parse_coco_3d_annotations(coco_data, frame_id_map, taxonomy)
                    else:
                        annotations_to_create = parse_coco_2d_annotations(
                            coco_data, default_camera_id, frame_id_map, taxonomy
                        )
                    
                    track_id_remap: Dict[str, UUID] = {}
                    is_2d_file = not is_cvat_json and not (is_lidar or has_frames)
                    if is_2d_file:
                        for tr in (coco_data.get("tracks") or []):
                            orig_id = tr.get("id")
                            if orig_id is None:
                                continue
                            new_track = Track2D(
                                id=uuid4(),
                                task_id=task.id,
                                camera_id=default_camera_id,
                                class_id=tr.get("class_id") or "unknown",
                                name=tr.get("name"),
                                color=tr.get("color"),
                                start_frame_index=tr.get("start_frame_index"),
                                end_frame_index=tr.get("end_frame_index"),
                                is_interpolated=bool(tr.get("is_interpolated", False)),
                                is_complete=bool(tr.get("is_complete", False)),
                                attributes=tr.get("attributes") or {},
                            )
                            db.add(new_track)
                            track_id_remap[str(orig_id)] = new_track.id

                    sensor_count = 0
                    for ann_data in annotations_to_create:
                        try:
                            ann_mode = detect_annotation_mode_from_data(ann_data, sensor_name)
                            
                            if ann_data.get("type") == "3d" or "position_x" in ann_data:
                                frame_id = frame_id_map.get(ann_data["frame_index"])
                                if not frame_id:
                                    continue
                                
                                fp = compute_3d_annotation_fingerprint(
                                    frame_id,
                                    ann_data["position_x"], ann_data["position_y"], ann_data["position_z"],
                                    ann_data["dimension_length"], ann_data["dimension_width"], ann_data["dimension_height"]
                                )
                                if fp in existing_3d_fingerprints:
                                    skipped_duplicates += 1
                                    continue
                                existing_3d_fingerprints.add(fp)
                                
                                results["class_ids_by_mode"][TaxonomyAnnotationMode.FUSION_3D.value].add(ann_data["class_id"])
                                
                                annotation = Annotation3D(
                                    id=uuid4(),
                                    task_id=task.id,
                                    track_id=uuid4() if ann_data.get("track_id") else None,
                                    frame_id=frame_id,
                                    class_id=ann_data["class_id"],
                                    taxonomy_id=taxonomy_id,
                                    data={
                                        "center": {
                                            "x": ann_data["position_x"],
                                            "y": ann_data["position_y"],
                                            "z": ann_data["position_z"],
                                        },
                                        "dimensions": {
                                            "length": ann_data["dimension_length"],
                                            "width": ann_data["dimension_width"],
                                            "height": ann_data["dimension_height"],
                                        },
                                        "rotation": {
                                            "yaw": ann_data["rotation_yaw"],
                                            "pitch": ann_data.get("rotation_pitch", 0.0),
                                            "roll": ann_data.get("rotation_roll", 0.0),
                                        },
                                        "confidence": ann_data.get("confidence", 1.0),
                                    },
                                    attributes=ann_data.get("attributes", {}),
                                    source=ann_data.get("source", AnnotationSource.AUTO.value),
                                )
                            else:
                                frame_id = ann_data.get("frame_id")
                                if not frame_id:
                                    frame_id = frame_id_map.get(ann_data["frame_index"])
                                if not frame_id:
                                    continue
                                
                                results["class_ids_by_mode"][TaxonomyAnnotationMode.ONLY_2D.value].add(ann_data["class_id"])

                                resolved_track_id = None
                                orig_track_id = ann_data.get("track_id")
                                if orig_track_id is not None:
                                    track_key = str(orig_track_id)
                                    resolved_track_id = track_id_remap.get(track_key)
                                    if resolved_track_id is None:
                                        fallback_track = Track2D(
                                            id=uuid4(),
                                            task_id=task.id,
                                            camera_id=ann_data.get("camera_id", sensor_name),
                                            class_id=ann_data["class_id"],
                                            is_interpolated=False,
                                            is_complete=False,
                                            attributes={},
                                        )
                                        db.add(fallback_track)
                                        track_id_remap[track_key] = fallback_track.id
                                        resolved_track_id = fallback_track.id

                                polyline_points = ann_data.get("polyline_points")
                                polygon_points = ann_data.get("polygon_points")
                                if polyline_points:
                                    annotation = Annotation2D(
                                        id=uuid4(),
                                        task_id=task.id,
                                        track_id=resolved_track_id,
                                        frame_id=frame_id,
                                        camera_id=ann_data.get("camera_id", sensor_name),
                                        class_id=ann_data["class_id"],
                                        taxonomy_id=taxonomy_id,
                                        type="polyline",
                                        data={
                                            "points": polyline_points,
                                            "isBezier": False,
                                        },
                                        attributes=ann_data.get("attributes", {}),
                                        source=ann_data.get("source", AnnotationSource.AUTO.value)
                                    )
                                elif ann_data.get("ellipse_data"):
                                    ed = ann_data["ellipse_data"]
                                    annotation = Annotation2D(
                                        id=uuid4(),
                                        task_id=task.id,
                                        track_id=resolved_track_id,
                                        frame_id=frame_id,
                                        camera_id=ann_data.get("camera_id", sensor_name),
                                        class_id=ann_data["class_id"],
                                        taxonomy_id=taxonomy_id,
                                        type="ellipse",
                                        data={
                                            "cx": ed["cx"], "cy": ed["cy"],
                                            "rx": ed["rx"], "ry": ed["ry"],
                                        },
                                        attributes=ann_data.get("attributes", {}),
                                        source=ann_data.get("source", AnnotationSource.AUTO.value)
                                    )
                                elif ann_data.get("rotated_box_data"):
                                    rb = ann_data["rotated_box_data"]
                                    annotation = Annotation2D(
                                        id=uuid4(),
                                        task_id=task.id,
                                        track_id=resolved_track_id,
                                        frame_id=frame_id,
                                        camera_id=ann_data.get("camera_id", sensor_name),
                                        class_id=ann_data["class_id"],
                                        taxonomy_id=taxonomy_id,
                                        type="rotated_box",
                                        data={
                                            "cx": rb["cx"], "cy": rb["cy"],
                                            "width": rb["width"], "height": rb["height"],
                                            "rotation": rb.get("angle", rb.get("rotation", 0)),
                                        },
                                        attributes=ann_data.get("attributes", {}),
                                        source=ann_data.get("source", AnnotationSource.AUTO.value)
                                    )
                                elif ann_data.get("keypoints_flat"):
                                    kf = ann_data["keypoints_flat"]
                                    knames = ann_data.get("keypoint_names", [])
                                    pts = []
                                    for i in range(0, len(kf), 3):
                                        label = knames[i // 3] if i // 3 < len(knames) else f"P{i // 3 + 1}"
                                        pts.append({"x": kf[i], "y": kf[i+1], "label": label, "visibility": int(kf[i+2]) if i+2 < len(kf) else 2})
                                    annotation = Annotation2D(
                                        id=uuid4(),
                                        task_id=task.id,
                                        track_id=resolved_track_id,
                                        frame_id=frame_id,
                                        camera_id=ann_data.get("camera_id", sensor_name),
                                        class_id=ann_data["class_id"],
                                        taxonomy_id=taxonomy_id,
                                        type="keypoints",
                                        data={"points": pts},
                                        attributes=ann_data.get("attributes", {}),
                                        source=ann_data.get("source", AnnotationSource.AUTO.value)
                                    )
                                elif polygon_points:
                                    pts = []
                                    for i in range(0, len(polygon_points), 2):
                                        if i + 1 < len(polygon_points):
                                            pts.append({"x": polygon_points[i], "y": polygon_points[i + 1]})

                                    orig_type = ann_data.get("ann_type", "")
                                    if orig_type == "semantic_segment":
                                        ann_db_type = "semantic_segment"
                                        ann_db_data = {
                                            "polygon": pts,
                                            "isClosed": True,
                                        }
                                    else:
                                        ann_db_type = "polygon"
                                        ann_db_data = {"points": pts}

                                    annotation = Annotation2D(
                                        id=uuid4(),
                                        task_id=task.id,
                                        track_id=resolved_track_id,
                                        frame_id=frame_id,
                                        camera_id=ann_data.get("camera_id", sensor_name),
                                        class_id=ann_data["class_id"],
                                        taxonomy_id=taxonomy_id,
                                        type=ann_db_type,
                                        data=ann_db_data,
                                        attributes=ann_data.get("attributes", {}),
                                        source=ann_data.get("source", AnnotationSource.AUTO.value)
                                    )
                                else:
                                    fp = compute_annotation_fingerprint(
                                        frame_id, ann_data.get("camera_id", sensor_name),
                                        ann_data["bbox_x"], ann_data["bbox_y"],
                                        ann_data["bbox_width"], ann_data["bbox_height"]
                                    )
                                    if fp in existing_2d_fingerprints:
                                        skipped_duplicates += 1
                                        continue
                                    existing_2d_fingerprints.add(fp)
                                    
                                    annotation = Annotation2D(
                                        id=uuid4(),
                                        task_id=task.id,
                                        track_id=resolved_track_id,
                                        frame_id=frame_id,
                                        camera_id=ann_data.get("camera_id", sensor_name),
                                        class_id=ann_data["class_id"],
                                        taxonomy_id=taxonomy_id,
                                        type="box2d",
                                        data={
                                            "bbox": {
                                                "x": ann_data["bbox_x"],
                                                "y": ann_data["bbox_y"],
                                                "width": ann_data["bbox_width"],
                                                "height": ann_data["bbox_height"]
                                            }
                                        },
                                        attributes=ann_data.get("attributes", {}),
                                        source=ann_data.get("source", AnnotationSource.AUTO.value)
                                    )
                            
                            results["unique_class_ids"].add(ann_data["class_id"])
                            
                            db.add(annotation)
                            sensor_count += 1
                            
                        except Exception as e:
                            import traceback
                            error_msg = f"{type(e).__name__}: {str(e)}"
                            if not str(e):
                                error_msg = f"{type(e).__name__}: {traceback.format_exc()}"
                            results["errors"].append(f"Error creating annotation in {sensor_name}: {error_msg}")
                    
                    results["sensors_processed"][sensor_name] = sensor_count
                    results["total_imported"] += sensor_count
                    
                except json.JSONDecodeError as e:
                    results["errors"].append(f"Invalid JSON in {json_file}: {str(e)}")
                except Exception as e:
                    import traceback
                    error_msg = f"{type(e).__name__}: {str(e)}"
                    if not str(e):
                        error_msg = f"{type(e).__name__}: {traceback.format_exc()}"
                    results["errors"].append(f"Error processing {json_file}: {error_msg}")
            
            if lidar_txt_files:
                sensor_name = "lidar"
                sensor_count = 0
                
                try:
                    kitti_annotations = []
                    
                    for txt_file in lidar_txt_files:
                        try:
                            file_name = txt_file.split('/')[-1]
                            frame_index_str = file_name.replace('.txt', '')
                            try:
                                frame_index = int(frame_index_str.lstrip('0') or '0')
                            except ValueError:
                                results["errors"].append(f"Could not parse frame index from {txt_file}")
                                continue
                            
                            content = zf.read(txt_file).decode('utf-8')
                            kitti_lines = content.strip().split('\n')
                            
                            for line in kitti_lines:
                                parts = line.strip().split()
                                if len(parts) < 15:
                                    continue
                                
                                offset = 0
                                track_id_from_file = None
                                if len(parts) >= 17:
                                    try:
                                        int(parts[0])
                                        track_id_from_file = int(parts[1])
                                        offset = 2
                                    except ValueError:
                                        pass
                                
                                class_name = parts[0 + offset]
                                truncated = float(parts[1 + offset])
                                occluded = int(parts[2 + offset])
                                alpha = float(parts[3 + offset])
                                
                                height = float(parts[8 + offset])
                                width = float(parts[9 + offset])
                                length = float(parts[10 + offset])
                                
                                location_x = float(parts[11 + offset])
                                location_y = float(parts[12 + offset])
                                location_z = float(parts[13 + offset])
                                
                                rotation_y = float(parts[14 + offset])
                                
                                score = float(parts[15 + offset]) if len(parts) > (15 + offset) else 1.0
                                
                                class_id = map_source_class_to_taxonomy(class_name, taxonomy) if taxonomy else class_name.lower()
                                
                                if class_name.lower() == 'dontcare':
                                    continue
                                
                                ann_data = {
                                    "frame_index": frame_index,
                                    "class_id": class_id,
                                    "track_id_num": track_id_from_file,
                                    "position_x": location_x,
                                    "position_y": location_y,
                                    "position_z": location_z,
                                    "dimension_length": length,
                                    "dimension_width": width,
                                    "dimension_height": height,
                                    "rotation_yaw": rotation_y,
                                    "rotation_pitch": 0.0,
                                    "rotation_roll": 0.0,
                                    "attributes": {
                                        "truncated": truncated,
                                        "occluded": occluded,
                                        "alpha": alpha
                                    },
                                    "source": AnnotationSource.AUTO.value,
                                    "confidence": score
                                }
                                
                                kitti_annotations.append(ann_data)
                        
                        except Exception as e:
                            import traceback
                            error_msg = f"{type(e).__name__}: {str(e)}"
                            if not str(e):
                                error_msg = f"{type(e).__name__}: {traceback.format_exc()}"
                            results["errors"].append(f"Error reading {txt_file}: {error_msg}")
                    
                    track_id_mapping: Dict[int, UUID] = {}
                    
                    for ann_data in kitti_annotations:
                        try:
                            frame_id = frame_id_map.get(ann_data["frame_index"])
                            if not frame_id:
                                continue
                            
                            track_uuid = None
                            track_id_num = ann_data.get("track_id_num")
                            if track_id_num is not None:
                                if track_id_num not in track_id_mapping:
                                    track_id_mapping[track_id_num] = uuid4()
                                track_uuid = track_id_mapping[track_id_num]
                            
                            annotation = Annotation3D(
                                id=uuid4(),
                                task_id=task.id,
                                track_id=track_uuid,
                                frame_id=frame_id,
                                class_id=ann_data["class_id"],
                                taxonomy_id=taxonomy_id,
                                data={
                                    "center": {
                                        "x": ann_data["position_x"],
                                        "y": ann_data["position_y"],
                                        "z": ann_data["position_z"],
                                    },
                                    "dimensions": {
                                        "length": ann_data["dimension_length"],
                                        "width": ann_data["dimension_width"],
                                        "height": ann_data["dimension_height"],
                                    },
                                    "rotation": {
                                        "yaw": ann_data["rotation_yaw"],
                                        "pitch": ann_data.get("rotation_pitch", 0.0),
                                        "roll": ann_data.get("rotation_roll", 0.0),
                                    },
                                    "confidence": ann_data.get("confidence", 1.0),
                                },
                                attributes=ann_data.get("attributes", {}),
                                source=ann_data.get("source", AnnotationSource.AUTO.value),
                            )
                            
                            results["unique_class_ids"].add(ann_data["class_id"])
                            
                            db.add(annotation)
                            sensor_count += 1
                        
                        except Exception as e:
                            import traceback
                            error_msg = f"{type(e).__name__}: {str(e)}"
                            if not str(e):
                                error_msg = f"{type(e).__name__}: {traceback.format_exc()}"
                            results["errors"].append(f"Error creating 3D annotation from KITTI: {error_msg}")
                    
                    if sensor_count > 0:
                        results["sensors_processed"][sensor_name] = sensor_count
                        results["total_imported"] += sensor_count
                
                except Exception as e:
                    import traceback
                    error_msg = f"{type(e).__name__}: {str(e)}"
                    if not str(e):
                        error_msg = f"{type(e).__name__}: {traceback.format_exc()}"
                    results["errors"].append(f"Error processing KITTI lidar annotations: {error_msg}")

            all_label_files = sorted(f for f in zf.namelist() if f.endswith('.label'))
            semantic_label_files = [f for f in all_label_files if 'lidar_segmentation_semantic/' in f]
            label_files = [f for f in all_label_files if f not in set(semantic_label_files)]
            if all_label_files:
                seg_frames_imported = 0
                try:
                    int_to_class: Dict[int, str] = {}
                    all_names = zf.namelist()
                    for info_path in (
                        "annotations/lidar_segmentation/labels_info.json",
                        "segmentation/class_mapping.json",
                        "class_mapping.json",
                    ):
                        if info_path in all_names:
                            info_data = json.loads(zf.read(info_path))
                            if "categories" in info_data:
                                int_to_class = {c["id"]: c["name"] for c in info_data["categories"] if c["id"] != 0}
                            elif "classes" in info_data:
                                int_to_class = {int(k): v for k, v in info_data["classes"].items() if k != "0"}
                            break

                    seg_dir = os.path.join(SEGMENTATION_ROOT, str(scene.id))
                    os.makedirs(seg_dir, exist_ok=True)

                    for label_file in label_files:
                        try:
                            fname = label_file.split('/')[-1]
                            frame_index = int(fname.replace('.label', '').lstrip('0') or '0')
                        except ValueError:
                            results["errors"].append(f"Cannot parse frame index from {label_file}")
                            continue

                        frame_id = frame_id_map.get(frame_index)
                        if not frame_id:
                            results["errors"].append(f"No frame for index {frame_index} in {label_file}")
                            continue

                        raw = zf.read(label_file)
                        kitti = np.frombuffer(raw, dtype=np.uint32)

                        semantic = (kitti & 0xFFFF).astype(np.int32)
                        instances = (kitti >> 16).astype(np.int32)

                        labels = np.where(semantic == 0, -1, semantic - 1).astype(np.int32)
                        inst_arr = np.where(instances == 0, -1, instances).astype(np.int32)

                        np.save(os.path.join(seg_dir, f"{frame_id}.npy"), labels)
                        if np.any(inst_arr >= 0):
                            np.save(os.path.join(seg_dir, f"{frame_id}_instances.npy"), inst_arr)

                        seg_frames_imported += 1

                    for label_file in semantic_label_files:
                        try:
                            fname = label_file.split('/')[-1]
                            frame_index = int(fname.replace('.label', '').lstrip('0') or '0')
                        except ValueError:
                            results["errors"].append(f"Cannot parse frame index from {label_file}")
                            continue

                        frame_id = frame_id_map.get(frame_index)
                        if not frame_id:
                            results["errors"].append(f"No frame for index {frame_index} in {label_file}")
                            continue

                        kitti = np.frombuffer(zf.read(label_file), dtype=np.uint32)
                        sem = np.where(kitti == 0, -1, kitti.astype(np.int64) - 1).astype(np.int32)
                        np.save(os.path.join(seg_dir, f"{frame_id}_semantic.npy"), sem)
                        seg_frames_imported += 1

                    if seg_frames_imported:
                        results["sensors_processed"]["segmentation_3d"] = seg_frames_imported
                        results["total_imported"] += seg_frames_imported
                        if int_to_class:
                            for class_name in int_to_class.values():
                                results["unique_class_ids"].add(class_name)

                except Exception as e:
                    import traceback
                    results["errors"].append(
                        f"Error processing segmentation .label files: {type(e).__name__}: {str(e) or traceback.format_exc()}"
                    )

    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid ZIP file"
        )
    
    results["skipped_duplicates"] = skipped_duplicates
    return results



@router.post("/scenes/{scene_id}/import-annotations")
async def import_annotations(
    scene_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
    file: UploadFile = File(..., description="ZIP file containing annotations folder with COCO JSON or KITTI TXT files"),
    task_id: Optional[UUID] = Form(None, description="Optional task ID to associate annotations with"),
    overwrite: bool = Form(False, description="If true, delete existing annotations before importing"),
    sync_taxonomy: bool = Form(True, description="If true, derive and merge taxonomy from annotation classes"),
):
    """
    Import annotations from a ZIP file containing the annotations folder.
    
    Requires ANNOTATIONS_CREATE permission.
    
    **Supported Folder Structures:**
    
    Format 1: All COCO
    ```
    annotations/
    ├── lidar.json              # COCO 3D (cuboids)
    ├── front_camera.json       # COCO 2D
    └── ...
    ```
    
    Format 2: KITTI LiDAR + COCO Cameras (Hybrid)
    ```
    annotations/
    ├── lidar/                  # KITTI 3D per-frame
    │   ├── 0000.txt
    │   └── ...
    ├── front_camera.json       # COCO 2D
    └── ...
    ```
    
    **Auto-detection:**
    - lidar.json → COCO 3D cuboids
    - lidar/*.txt → KITTI 3D per-frame
    - *_camera.json or other *.json → COCO 2D bboxes
    
    **Parameters:**
    - **overwrite**: If true, delete all existing annotations for this scene before importing
    - **sync_taxonomy**: If true, discover class labels and merge into dataset taxonomy
    
    Returns:
        - success: boolean
        - imported_count: number of annotations created
        - sensors_processed: dict of sensor names to counts
        - derived_classes: list of new classes added to taxonomy (if sync_taxonomy=true)
        - errors: list of errors if any
    """
    scene_query = select(Scene).where(Scene.id == scene_id, Scene.is_deleted == False)
    result = await db.execute(scene_query)
    scene = result.scalar_one_or_none()
    
    if not scene:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scene {scene_id} not found"
        )

    if not file.filename.lower().endswith('.zip'):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please upload a ZIP file containing your annotations folder"
        )

    try:
        content = await file.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to read file: {str(e)}"
        )

    zip_metadata: Dict[str, Any] = {}
    zip_names: List[str] = []
    embedded_task_id: Optional[str] = None
    task_exports_meta: List[Dict[str, Any]] = []
    is_per_task_layout = False
    try:
        with zipfile.ZipFile(io.BytesIO(content), 'r') as _zf:
            zip_names = _zf.namelist()
            meta_names = [n for n in zip_names if n.endswith('metadata.json') and '__MACOSX' not in n]
            if meta_names:
                zip_metadata = json.loads(_zf.read(meta_names[0]).decode('utf-8'))
                embedded_task_id = (zip_metadata.get("task") or {}).get("id")
                task_exports_meta = list(zip_metadata.get("task_exports") or [])

                export_info = zip_metadata.get("export_info") or {}
                layout = export_info.get("annotation_layout")
                if layout == "per_task_sensor_files":
                    is_per_task_layout = True

            if not is_per_task_layout:
                is_per_task_layout = any(n.startswith("annotations/tasks/") for n in zip_names)
    except Exception:
        pass

    if task_id is None and embedded_task_id and not is_per_task_layout:
        try:
            candidate = UUID(str(embedded_task_id))
            _check = await db.execute(
                select(Task).where(
                    Task.id == candidate,
                    Task.scene_id == scene_id,
                    Task.is_deleted == False,
                )
            )
            if _check.scalar_one_or_none():
                task_id = candidate
        except Exception:
            pass

    if task_id:
        task_query = select(Task).where(Task.id == task_id, Task.is_deleted == False)
        result = await db.execute(task_query)
        task = result.scalar_one_or_none()
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Task {task_id} not found"
            )
    else:
        task_query = select(Task).where(
            Task.scene_id == scene_id,
            Task.is_deleted == False
        ).order_by(Task.created_at.desc()).limit(1)
        result = await db.execute(task_query)
        task = result.scalar_one_or_none()
        
        if not task:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No tasks found for scene {scene_id}. Create a task first."
            )
    
    frames_query = select(Frame).where(Frame.scene_id == scene.id).order_by(Frame.frame_index)
    frames_result = await db.execute(frames_query)
    frame_id_map = {frame.frame_index: frame.id for frame in frames_result.scalars().all()}
    
    derived_classes = []

    async def _delete_annotations_for_task(target_task_id: UUID) -> None:
        await db.execute(Annotation2D.__table__.delete().where(Annotation2D.task_id == target_task_id))
        await db.execute(Annotation3D.__table__.delete().where(Annotation3D.task_id == target_task_id))

    if is_per_task_layout and task_id is None:
        scene_tasks_result = await db.execute(
            select(Task).where(Task.scene_id == scene_id, Task.is_deleted == False)
        )
        scene_tasks = list(scene_tasks_result.scalars().all())
        scene_tasks_by_id = {str(t.id): t for t in scene_tasks}

        folder_entries: List[Dict[str, Any]] = []
        for entry in task_exports_meta:
            folder = str(entry.get("folder") or "").strip("/")
            if folder.startswith("annotations/tasks/"):
                folder_entries.append(entry)

        if not folder_entries:
            discovered = set()
            for name in zip_names:
                parts = name.strip("/").split("/")
                if len(parts) >= 3 and parts[0] == "annotations" and parts[1] == "tasks":
                    discovered.add("/".join(parts[:3]))
            folder_entries = [{"folder": f} for f in sorted(discovered)]

        if not folder_entries:
            if overwrite:
                try:
                    await _delete_annotations_for_task(task.id)
                    await db.commit()
                except Exception as e:
                    await db.rollback()
                    raise HTTPException(
                        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                        detail=f"Failed to delete existing annotations: {str(e)}"
                    )
            zip_results = await process_zip_annotations(content, scene, task, frame_id_map, db, taxonomy_id=scene.selected_taxonomy_id)
        else:
            zip_results = build_empty_import_results()
            routed_task_ids: Set[str] = set()
            overwritten_tasks: Set[str] = set()

            for entry in folder_entries:
                folder = str(entry.get("folder") or "").strip("/")
                task_name_from_meta = (entry.get("task_name") or "").strip()
                task_taxonomy_id = entry.get("task_taxonomy_id")
                frame_range = entry.get("frame_range") or {}

                target_task: Optional[Task] = None
                explicit_task_id = entry.get("task_id")
                if explicit_task_id and str(explicit_task_id) in scene_tasks_by_id:
                    target_task = scene_tasks_by_id[str(explicit_task_id)]

                if target_task is None and task_taxonomy_id:
                    matches = [
                        t for t in scene_tasks
                        if t.taxonomy_id and str(t.taxonomy_id) == str(task_taxonomy_id)
                    ]
                    if len(matches) == 1:
                        target_task = matches[0]

                if target_task is None and frame_range:
                    try:
                        r_start = int(frame_range.get("start"))
                        r_end = int(frame_range.get("end"))
                        matches = []
                        for t in scene_tasks:
                            t_start = t.frame_range.lower if t.frame_range else 0
                            t_end = (t.frame_range.upper - 1) if t.frame_range else 0
                            if t_start == r_start and t_end == r_end:
                                matches.append(t)
                        if len(matches) == 1:
                            target_task = matches[0]
                    except Exception:
                        pass

                if target_task is None and task_name_from_meta:
                    matches = [t for t in scene_tasks if (t.name or "").strip() == task_name_from_meta]
                    if len(matches) == 1:
                        target_task = matches[0]

                if target_task is None:
                    target_task = task

                subzip = build_subzip_for_task_folder(content, folder, metadata=zip_metadata)
                if not subzip:
                    continue

                target_task_id_str = str(target_task.id)
                if overwrite and target_task_id_str not in overwritten_tasks:
                    try:
                        await _delete_annotations_for_task(target_task.id)
                        overwritten_tasks.add(target_task_id_str)
                    except Exception as e:
                        await db.rollback()
                        raise HTTPException(
                            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                            detail=f"Failed to delete existing annotations: {str(e)}"
                        )

                per_task_results = await process_zip_annotations(
                    subzip,
                    scene,
                    target_task,
                    frame_id_map,
                    db,
                    taxonomy_id=scene.selected_taxonomy_id,
                )
                merge_import_results(
                    zip_results,
                    per_task_results,
                    sensor_prefix=f"{target_task.name} ({target_task_id_str[:8]})",
                )
                routed_task_ids.add(target_task_id_str)

            zip_results["routed_task_ids"] = sorted(routed_task_ids)
    else:
        if overwrite:
            try:
                await _delete_annotations_for_task(task.id)
                await db.commit()
            except Exception as e:
                await db.rollback()
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail=f"Failed to delete existing annotations: {str(e)}"
                )

        zip_results = await process_zip_annotations(content, scene, task, frame_id_map, db, taxonomy_id=scene.selected_taxonomy_id)
    
    try:
        await db.commit()
    except Exception as e:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save annotations: {str(e)}"
        )
    
    if sync_taxonomy and zip_results["unique_class_ids"]:
        try:
            dataset_result = await db.execute(
                select(Dataset).where(Dataset.id == scene.dataset_id)
            )
            dataset = dataset_result.scalar_one_or_none()
            
            if dataset:
                derived_classes = await derive_and_merge_taxonomy_for_scene(
                    db, dataset,
                    zip_results["unique_class_ids"],
                    zip_results.get("coco_categories"),
                    zip_results.get("class_ids_by_mode", {})
                )
        except Exception as e:
            zip_results["errors"].append(f"Failed to sync taxonomy: {str(e)}")
    
    return {
        "success": True,
        "imported_count": zip_results["total_imported"],
        "task_id": str(task.id),
        "task_ids": zip_results.get("routed_task_ids", [str(task.id)]),
        "sensors_processed": zip_results["sensors_processed"],
        "derived_classes": derived_classes,
        "errors": zip_results["errors"]
    }


@router.post("/scenes/{scene_id}/import-annotations-zip")
async def import_annotations_zip(
    scene_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
    file: UploadFile = File(..., description="ZIP file containing per-sensor annotation files"),
    task_id: Optional[UUID] = Form(None, description="Optional task ID to associate annotations with"),
    overwrite: bool = Form(False, description="If true, delete existing annotations before importing"),
    sync_taxonomy: bool = Form(True, description="If true, derive and merge taxonomy from annotation classes"),
):
    """
    Import annotations from a ZIP file. Alias for import_annotations endpoint.
    """
    return await import_annotations(
        scene_id=scene_id,
        file=file,
        task_id=task_id,
        overwrite=overwrite,
        sync_taxonomy=sync_taxonomy,
        current_user=current_user,
        db=db
    )


@router.post("/tasks/{task_id}/import-annotations")
async def import_annotations_for_task(
    task_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
    db: AsyncSession = Depends(get_db),
    file: UploadFile = File(..., description="ZIP file containing annotations folder"),
    overwrite: bool = Form(False, description="If true, delete existing annotations before importing"),
    sync_taxonomy: bool = Form(True, description="If true, derive and merge taxonomy from annotation classes"),
):
    """
    Import annotations directly to a specific task.
    
    Requires ANNOTATIONS_CREATE permission.
    """
    task_query = select(Task).where(Task.id == task_id, Task.is_deleted == False)
    result = await db.execute(task_query)
    task = result.scalar_one_or_none()
    
    if not task:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Task {task_id} not found"
        )
    
    scene_query = select(Scene).where(Scene.id == task.scene_id)
    result = await db.execute(scene_query)
    scene = result.scalar_one_or_none()
    
    if not scene:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Scene not found for task {task_id}"
        )
    
    return await import_annotations(
        scene_id=scene.id,
        file=file,
        task_id=task_id,
        overwrite=overwrite,
        sync_taxonomy=sync_taxonomy,
        current_user=current_user,
        db=db
    )



async def derive_and_merge_taxonomy_for_scene(
    db: AsyncSession,
    dataset: Dataset,
    unique_class_ids: Set[str],
    coco_categories: Optional[Dict[int, Dict]] = None,
    class_ids_by_mode: Optional[Dict[str, Set[str]]] = None
) -> List[str]:
    """
    Derive classes from annotations and merge into dataset's taxonomy.
    
    Returns list of newly added class names.
    """
    if not unique_class_ids:
        return []
    
    existing_taxonomy = dataset.taxonomy or {}
    
    existing_class_ids = set()
    existing_class_names = set()
    for c in existing_taxonomy.get("classes", []):
        cls_id = c.get("id", "")
        cls_name = c.get("name", "")
        if cls_id:
            existing_class_ids.add(cls_id.lower())
        if cls_name:
            existing_class_names.add(cls_name.lower())
    
    existing_classes = {c.get("name", c.get("id", "")): c for c in existing_taxonomy.get("classes", [])}
    
    fusion_3d_classes = class_ids_by_mode.get(TaxonomyAnnotationMode.FUSION_3D.value, set()) if class_ids_by_mode else set()
    only_2d_classes = class_ids_by_mode.get(TaxonomyAnnotationMode.ONLY_2D.value, set()) if class_ids_by_mode else set()
    
    used_colors = {c.get("color") for c in existing_classes.values() if c.get("color")}
    available_colors = [c for c in CLASS_COLOR_PALETTE if c not in used_colors]
    color_idx = 0
    
    new_classes = []
    for class_id in unique_class_ids:
        class_name = str(class_id)
        class_name_lower = class_name.lower()
        
        if class_name_lower in existing_class_ids or class_name_lower in existing_class_names:
            continue
        
        types = []
        if class_name in fusion_3d_classes:
            types.append("cuboid")
        if class_name in only_2d_classes:
            types.append("box2d")
        if not types:
            types = ["cuboid", "box2d"]
        
        color = None
        if coco_categories:
            for cat in coco_categories.values():
                if cat.get("name") == class_name:
                    color = cat.get("color")
                    break
        
        if not color:
            if color_idx < len(available_colors):
                color = available_colors[color_idx]
                color_idx += 1
            else:
                color = f"#{random.randint(0, 0xFFFFFF):06x}"
        
        display_name = class_name.replace("_", " ").title()
        
        new_class = {
            "id": class_name,
            "name": display_name,
            "color": color,
            "type": types,
            "attributes": {}
        }
        new_classes.append(new_class)
    
    if not new_classes:
        return []
    
    updated_taxonomy = existing_taxonomy.copy()
    if "classes" not in updated_taxonomy:
        updated_taxonomy["classes"] = []
    updated_taxonomy["classes"].extend(new_classes)
    
    dataset.taxonomy = updated_taxonomy
    await db.commit()
    
    return [c["name"] for c in new_classes]



CLASS_COLOR_PALETTE = [
    '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7',
    '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9',
    '#F1948A', '#82E0AA', '#F8C471', '#D7BDE2', '#A9CCE3',
    '#FAD7A0', '#A3E4D7', '#D5A6BD', '#AED6F1', '#F5B7B1',
]


def derive_taxonomy_from_annotations(
    annotation_files: Dict[str, dict],
    dataset_name: str
) -> Dict[str, Any]:
    """
    Derive a taxonomy from annotation files by extracting unique classes.
    
    Args:
        annotation_files: Dict mapping sensor_name to COCO-format annotation data
        dataset_name: Name of the dataset for taxonomy naming
        
    Returns:
        Taxonomy dict with classes, skeletons, and annotation_rules
    """
    classes_found = {}
    
    for sensor_name, coco_data in annotation_files.items():
        is_3d = sensor_name.lower() in ['lidar', 'velodyne', 'point_cloud', 'pointcloud']
        
        for cat in coco_data.get("categories", []):
            cat_name = cat.get("name", f"class_{cat.get('id', 0)}")
            if cat_name not in classes_found:
                classes_found[cat_name] = {"types": set(), "count": 0}
            
            if is_3d:
                classes_found[cat_name]["types"].add("cuboid")
            else:
                classes_found[cat_name]["types"].add("box2d")
        
        category_map = {cat["id"]: cat.get("name", f"class_{cat['id']}") for cat in coco_data.get("categories", [])}
        for ann in coco_data.get("annotations", []):
            cat_id = ann.get("category_id")
            if cat_id in category_map:
                class_name = category_map[cat_id]
                if class_name in classes_found:
                    classes_found[class_name]["count"] += 1
                    
                    if "bbox3d" in ann or "dimensions" in ann:
                        classes_found[class_name]["types"].add("cuboid")
                    if "segmentation" in ann and isinstance(ann["segmentation"], list):
                        if any(isinstance(seg, list) for seg in ann["segmentation"]):
                            classes_found[class_name]["types"].add("polygon")
                    if "keypoints" in ann:
                        classes_found[class_name]["types"].add("skeleton")
    
    taxonomy_classes = []
    for idx, (class_name, info) in enumerate(sorted(classes_found.items())):
        class_id = class_name.lower().replace(" ", "_").replace("-", "_")
        color = CLASS_COLOR_PALETTE[idx % len(CLASS_COLOR_PALETTE)]
        types = list(info["types"]) if info["types"] else ["box2d", "cuboid"]
        
        taxonomy_classes.append({
            "id": class_id,
            "name": class_name,
            "color": color,
            "type": types,
            "attributes": {},
        })
    
    timestamp = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    taxonomy_name = f"{dataset_name}_imported_{timestamp}"
    
    return {
        "name": taxonomy_name,
        "classes": taxonomy_classes,
        "skeletons": {},
        "annotation_rules": {
            "min_points_polyline": 2,
            "min_points_polygon": 3,
            "allow_overlapping_boxes": False,
            "require_track_id": True,
        },
    }


from app.models.models import Dataset, Taxonomy, dataset_taxonomy_association


@router.post("/datasets/{dataset_id}/import-annotations")
async def import_dataset_annotations(
    dataset_id: UUID,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_IMPORT))],
    db: AsyncSession = Depends(get_db),
    file: UploadFile = File(..., description="ZIP file containing per-sensor annotation JSON files"),
    derive_taxonomy: bool = Form(True, description="Automatically derive taxonomy from annotations"),
    overwrite: bool = Form(False, description="Overwrite existing annotations"),
):
    """
    Import annotations for an entire dataset with optional taxonomy derivation.
    
    This endpoint:
    1. Accepts a ZIP file with per-sensor annotation files
    2. Optionally derives a taxonomy from the annotation classes
    3. Creates annotations for all matching scenes/frames
    4. Links the derived taxonomy to the dataset
    
    Expected ZIP structure:
        annotations.zip/
        ├── scene_001/
        │   ├── lidar.json           # 3D annotations for scene_001
        │   ├── camera_front.json    # 2D annotations for camera_front
        │   └── ...
        ├── scene_002/
        │   └── ...
        └── (or flat structure for single scene)
            ├── lidar.json
            └── camera_front.json
    
    Requires DATASETS_IMPORT permission.
    """
    dataset_query = select(Dataset).where(Dataset.id == dataset_id)
    result = await db.execute(dataset_query)
    dataset = result.scalar_one_or_none()
    
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Dataset {dataset_id} not found"
        )
    
    scenes_query = select(Scene).where(Scene.dataset_id == dataset_id, Scene.is_deleted == False)
    result = await db.execute(scenes_query)
    scenes = result.scalars().all()
    
    if not scenes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Dataset has no scenes. Import sensor data first."
        )
    
    scene_map = {scene.name: scene for scene in scenes}
    
    try:
        content = await file.read()
        zip_buffer = io.BytesIO(content)
        
        if not zipfile.is_zipfile(zip_buffer):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is not a valid ZIP file"
            )
        
        zip_buffer.seek(0)
        
        annotations_by_scene: Dict[str, Dict[str, dict]] = {}
        all_annotation_files: Dict[str, dict] = {}
        
        with zipfile.ZipFile(zip_buffer, 'r') as zf:
            for file_info in zf.infolist():
                if file_info.is_dir():
                    continue
                
                file_path = file_info.filename
                
                if '__MACOSX' in file_path or file_path.startswith('.'):
                    continue
                
                if not file_path.endswith('.json'):
                    continue
                
                parts = file_path.replace('\\', '/').split('/')
                
                if len(parts) >= 2:
                    scene_name = parts[-2]
                    sensor_name = parts[-1].replace('.json', '')
                elif len(parts) == 1:
                    scene_name = scenes[0].name if len(scenes) == 1 else "default"
                    sensor_name = parts[0].replace('.json', '')
                else:
                    continue
                
                try:
                    json_content = zf.read(file_info.filename).decode('utf-8')
                    coco_data = json.loads(json_content)
                except (json.JSONDecodeError, UnicodeDecodeError) as e:
                    continue
                
                if scene_name not in annotations_by_scene:
                    annotations_by_scene[scene_name] = {}
                annotations_by_scene[scene_name][sensor_name] = coco_data
                
                all_annotation_files[sensor_name] = coco_data
        
        if not annotations_by_scene:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid annotation JSON files found in ZIP"
            )
        
    except zipfile.BadZipFile:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid or corrupted ZIP file"
        )
    
    derived_taxonomy = None
    derived_taxonomy_id = None
    
    if derive_taxonomy and all_annotation_files:
        derived_taxonomy = derive_taxonomy_from_annotations(
            all_annotation_files, 
            dataset.name
        )
        
        new_taxonomy = Taxonomy(
            id=uuid4(),
            name=derived_taxonomy["name"],
            description=f"Auto-derived taxonomy from imported annotations for {dataset.name}",
            version="1.0.0",
            classes=derived_taxonomy["classes"],
            skeletons=derived_taxonomy.get("skeletons", {}),
            annotation_rules=derived_taxonomy.get("annotation_rules", {}),
            created_by=current_user.id,
        )
        db.add(new_taxonomy)
        await db.flush()
        
        await db.execute(
            dataset_taxonomy_association.insert().values(
                dataset_id=dataset_id,
                taxonomy_id=new_taxonomy.id
            )
        )
        
        derived_taxonomy_id = str(new_taxonomy.id)
    
    total_imported = 0
    sensors_processed = {}
    errors = []
    scenes_processed = 0
    
    for scene_name_key, sensor_annotations in annotations_by_scene.items():
        scene = None
        for s_name, s in scene_map.items():
            if s_name == scene_name_key or scene_name_key in s_name or s_name in scene_name_key:
                scene = s
                break
        
        if not scene and len(scenes) == 1:
            scene = scenes[0]
        
        if not scene:
            errors.append(f"Scene '{scene_name_key}' not found in dataset")
            continue
        
        task_query = select(Task).where(
            Task.scene_id == scene.id,
            Task.is_deleted == False
        ).order_by(Task.created_at.desc())
        result = await db.execute(task_query)
        task = result.scalar_one_or_none()
        
        if not task:
            task = Task(
                id=uuid4(),
                scene_id=scene.id,
                status="pending",
                stage="annotation",
                created_at=datetime.utcnow(),
            )
            db.add(task)
            await db.flush()
        
        frames_query = select(Frame).where(Frame.scene_id == scene.id).order_by(Frame.frame_index)
        result = await db.execute(frames_query)
        frames = result.scalars().all()
        
        if not frames:
            errors.append(f"Scene '{scene.name}' has no frames")
            continue
        
        frame_id_map = {f.frame_index: f.id for f in frames}
        
        dataset_result = await db.execute(
            select(Dataset).where(Dataset.id == scene.dataset_id)
        )
        dataset = dataset_result.scalar_one_or_none()
        taxonomy = dataset.taxonomy if dataset else None
        resolved_taxonomy_id = task.taxonomy_id or (taxonomy.id if taxonomy else None)

        if overwrite:
            from sqlalchemy import delete
            await db.execute(delete(Annotation2D).where(Annotation2D.task_id == task.id))
            await db.execute(delete(Annotation3D).where(Annotation3D.task_id == task.id))
        
        for sensor_name, coco_data in sensor_annotations.items():
            is_3d = sensor_name.lower() in ['lidar', 'velodyne', 'point_cloud', 'pointcloud']
            
            if is_3d:
                parsed = parse_coco_3d_annotations(coco_data, frame_id_map, taxonomy)
                for ann_data in parsed:
                    ann = Annotation3D(
                        id=uuid4(),
                        task_id=task.id,
                        frame_id=ann_data["frame_id"],
                        class_id=ann_data["class_id"],
                        taxonomy_id=resolved_taxonomy_id,
                        position_x=ann_data["position"][0],
                        position_y=ann_data["position"][1],
                        position_z=ann_data["position"][2],
                        dimension_x=ann_data["dimensions"][0],
                        dimension_y=ann_data["dimensions"][1],
                        dimension_z=ann_data["dimensions"][2],
                        rotation_x=ann_data.get("rotation", [0, 0, 0])[0],
                        rotation_y=ann_data.get("rotation", [0, 0, 0])[1],
                        rotation_z=ann_data.get("rotation", [0, 0, 0])[2],
                        attributes=ann_data.get("attributes", {}),
                        source=AnnotationSource.AUTO,
                        confidence=ann_data.get("confidence", 1.0),
                    )
                    db.add(ann)
                    total_imported += 1
                    sensors_processed[sensor_name] = sensors_processed.get(sensor_name, 0) + 1
            else:
                parsed = parse_coco_2d_annotations(coco_data, sensor_name, frame_id_map, taxonomy)

                track_id_remap: Dict[str, UUID] = {}
                for tr in (coco_data.get("tracks") or []):
                    orig_id = tr.get("id")
                    if orig_id is None:
                        continue
                    new_track = Track2D(
                        id=uuid4(),
                        task_id=task.id,
                        camera_id=sensor_name,
                        class_id=tr.get("class_id") or "unknown",
                        name=tr.get("name"),
                        color=tr.get("color"),
                        start_frame_index=tr.get("start_frame_index"),
                        end_frame_index=tr.get("end_frame_index"),
                        is_interpolated=bool(tr.get("is_interpolated", False)),
                        is_complete=bool(tr.get("is_complete", False)),
                        attributes=tr.get("attributes") or {},
                    )
                    db.add(new_track)
                    track_id_remap[str(orig_id)] = new_track.id

                for ann_data in parsed:
                    resolved_track_id = None
                    orig_track_id = ann_data.get("track_id")
                    if orig_track_id is not None:
                        track_key = str(orig_track_id)
                        resolved_track_id = track_id_remap.get(track_key)
                        if resolved_track_id is None:
                            fallback_track = Track2D(
                                id=uuid4(),
                                task_id=task.id,
                                camera_id=sensor_name,
                                class_id=ann_data["class_id"],
                                is_interpolated=False,
                                is_complete=False,
                                attributes={},
                            )
                            db.add(fallback_track)
                            track_id_remap[track_key] = fallback_track.id
                            resolved_track_id = fallback_track.id

                    ann = Annotation2D(
                        id=uuid4(),
                        task_id=task.id,
                        track_id=resolved_track_id,
                        frame_id=ann_data["frame_id"],
                        camera_id=sensor_name,
                        class_id=ann_data["class_id"],
                        taxonomy_id=resolved_taxonomy_id,
                        type="box2d",
                        data={
                            "bbox": {
                                "x": ann_data["bbox_x"],
                                "y": ann_data["bbox_y"],
                                "width": ann_data["bbox_width"],
                                "height": ann_data["bbox_height"],
                            }
                        },
                        attributes=ann_data.get("attributes", {}),
                        source=AnnotationSource.AUTO.value,
                    )
                    db.add(ann)
                    total_imported += 1
                    sensors_processed[sensor_name] = sensors_processed.get(sensor_name, 0) + 1
        
        scenes_processed += 1
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Imported {total_imported} annotations for {scenes_processed} scenes",
        "imported_count": total_imported,
        "scenes_processed": scenes_processed,
        "sensors_processed": sensors_processed,
        "derived_taxonomy_id": derived_taxonomy_id,
        "derived_classes": [c["name"] for c in derived_taxonomy["classes"]] if derived_taxonomy else [],
        "errors": errors,
    }

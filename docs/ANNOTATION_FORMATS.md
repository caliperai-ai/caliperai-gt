# Annotation Import & Export Formats

This document specifies the formats the platform uses to **export** annotations and
the formats it can **import**. It complements [DATA_FORMAT.md](DATA_FORMAT.md),
which covers the *scene* bundle (LiDAR / cameras / calibration / ego-poses).

> Note: the platform does **not** use the Datumaro format. Import/export are the
> platform-native COCO-style JSON + KITTI/SemanticKITTI formats described below.

---

## Exporting

Three endpoints, all `GET`, all returning a `.zip` (COCO format) — task, scene, or
dataset scope:

| Endpoint | Scope |
|---|---|
| `GET /api/v1/export/tasks/{task_id}/export` | One task |
| `GET /api/v1/export/scenes/{scene_id}/export` | One scene (all its tasks) |
| `GET /api/v1/export/datasets/{dataset_id}/export` | Every scene in a dataset |

Query parameters:

| Param | Default | Meaning |
|---|---|---|
| `format` | `coco` | `coco` = per-sensor COCO files + KITTI segmentation; `json` = single legacy `labels.json` |
| `include_data` | `false` | If `true`, also bundle the raw point clouds + images under `data/` |
| `taxonomy_id` | – | Restrict to one taxonomy. A **segmentation_3d** taxonomy exports only the `.label` files; other taxonomies export only their DB annotations. |

### Task export ZIP (`format=coco`)

```
task_export.zip/
├── data/                                  (only if include_data=true)
│   ├── lidar/000000.pcd …
│   └── cameras/<camera>/000000.jpg …
├── annotations/
│   ├── lidar.json                         # 3D cuboids (platform JSON)
│   ├── <camera>.json                      # 2D annotations per camera (COCO)
│   ├── fusion.json                        # fusion annotations (if any)
│   └── lidar_segmentation/                # 3D segmentation (if present)
│       ├── 000000.label                   # SemanticKITTI uint32/point
│       └── labels_info.json               # class map + per-frame stats
└── metadata.json                          # scene, calibration, taxonomy, counts
```

The scene and dataset exports use the same building blocks; the scene export nests
per-task annotations under `annotations/tasks/<task>/…` when a scene has multiple
tasks, and the dataset export nests everything under `<scene_name>/…`.

---

## Annotation JSON schemas

### `metadata.json`

```json
{
  "export_info": {
    "format_version": "2.0",
    "format": "coco",
    "exported_at": "2026-01-01T00:00:00",
    "exported_by": "username",
    "export_type": "task",
    "taxonomy_id": "…|null",
    "annotation_mode": "fusion_3d | segmentation_3d | 2d_only | null"
  },
  "task": { "id": "…", "status": "…", "frame_range": {"start": 0, "end": 0} },
  "scene": { "…": "…", "calibration": { "lidar_to_cameras": { … } } },
  "dataset": { "id": "…", "name": "…" },
  "taxonomy": { "classes": [ … ] },
  "frames": [ { "frame_index": 0, "file_paths": { … } } ],
  "annotation_counts": { "lidar": 12, "<camera>": 8 }
}
```

### `annotations/lidar.json` — 3D cuboids

An array of boxes; each box:

```json
{
  "track_id": "uuid | null",
  "frame_index": 0,
  "class_id": "car",
  "position":   { "x": 0.0, "y": 0.0, "z": 0.0 },
  "dimensions": { "length": 4.2, "width": 1.8, "height": 1.5 },
  "rotation":   { "yaw": 0.0, "pitch": 0.0, "roll": 0.0 },
  "attributes": { }
}
```

Units are meters; `yaw/pitch/roll` in radians; coordinates are in the LiDAR frame.

### `annotations/<camera>.json` — 2D (standard COCO)

```json
{
  "info": { … },
  "images":     [ { "id": 1, "file_name": "000000.jpg", "width": 1920, "height": 1080 } ],
  "annotations":[ { "id": 1, "image_id": 1, "category_id": 3,
                    "bbox": [x, y, w, h], "segmentation": [...],
                    "attributes": { }, "track_id": "…|null" } ],
  "categories": [ { "id": 3, "name": "car", "supercategory": "object" } ]
}
```

2D boxes, polylines, polygons, and keypoints are all emitted here following COCO
conventions (`bbox` for boxes, `segmentation` for polygons, `keypoints` for
skeletons).

### `annotations/lidar_segmentation/` — 3D semantic segmentation

- **`000000.label`** — one **`uint32` per point**, in the same order as the frame's
  point cloud (SemanticKITTI convention):
  - bits **0–15** = semantic class id (`0` = unlabeled, `1` = first class, …)
  - bits **16–31** = instance id (`0` = no instance)
  - Decode: `semantic = value & 0xFFFF`, `instance = value >> 16`.
- **`labels_info.json`** — the class map and per-frame stats:

```json
{
  "info": { "format": "kitti_semantic", "scene_id": "…", "coordinate_system": "lidar" },
  "frames": [ {
    "frame_index": 0, "file_name": "000000.label", "pcd_file": "000000.pcd",
    "total_point_count": 800000, "labeled_point_count": 799970,
    "class_distribution": { "1": {"name": "road", "point_count": 302566}, "…": {} }
  } ]
}
```

The export also writes an `annotations/lidar_segmentation_semantic/000000.label`
for the semantic-only layer alongside the instance layer.

---

## Importing

Use the scene-import endpoint (`POST /api/v1/import/upload-zip`, see
[DATA_FORMAT.md](DATA_FORMAT.md)) with an `annotations/` folder in the bundle, or
the dedicated annotation-import endpoints. Accepted formats:

| Format | Location in bundle | Notes |
|---|---|---|
| **Platform-native** | `annotations/lidar.json`, `annotations/<camera>.json` | Round-trips with the export above |
| **KITTI 3D** | `annotations/lidar/*.txt` or `annotations/label_2/*.txt` | 15-column KITTI object labels; `rotation_y` → yaw, dims in meters |
| **COCO 2D** | `annotations/*.json` | Standard COCO boxes/polylines/polygons/keypoints |
| **SemanticKITTI** | `annotations/**/*.label` (+ `labels_info.json`) | 3D point segmentation, decoded as above |

Import behavior:
- Point-segmentation `.label` files are decoded and written to the segmentation
  store, and a `segmentation_3d` taxonomy is derived from `labels_info.json`
  (reusing an existing matching taxonomy rather than creating duplicates).
- Pass `derive_taxonomy=true` to auto-create/merge classes from discovered labels;
  otherwise the target dataset's existing taxonomy is used.

---

## Round-trip

Export a segmentation task → the resulting `annotations/lidar_segmentation/*.label`
+ `labels_info.json` re-import cleanly (the importer reads exactly these). The same
holds for `lidar.json`/`<camera>.json` and the KITTI/COCO importers.

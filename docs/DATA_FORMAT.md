# Scene Import Bundle Format

This document describes the data format the platform expects when you import a
scene — a single **`.zip`** containing LiDAR point clouds, camera images, sensor
calibration, and (optionally) ego-vehicle poses and pre-existing annotations.

If you're evaluating the platform, the fastest path is to package one scene as
described here and upload it via **Dataset → Import**.

---

## TL;DR — the canonical bundle

```
my_scene/
├── lidar/
│   ├── frame_000000.pcd
│   ├── frame_000001.pcd
│   └── …                         # one file per frame (.pcd or .bin)
├── cameras/
│   ├── front/
│   │   ├── frame_000000.jpg
│   │   └── …
│   └── left/
│       ├── frame_000000.jpg
│       └── …
├── calibration.json              # optional but needed for 3D↔2D projection
├── ego_poses/
│   └── poses.json                # optional; enables world-space / 4D
└── scene_metadata.json           # optional (fps, weather, location, …)
```

Zip it (`my_scene/` as the single top-level folder is fine) and upload.

> **The single most important rule:** frames are matched **by sorted filename
> position**, not by parsing numbers out of the name. Zero-pad every filename
> identically across `lidar/` and every `cameras/<cam>/` folder
> (`frame_000000`, `frame_000001`, …). `frame_2.pcd` sorts *after*
> `frame_10.pcd`, which will silently misalign LiDAR, images, and poses.

The **minimum viable bundle is just a `lidar/` folder** with one or more point
clouds — everything else is optional. Without calibration you get a 3D-only
scene (no camera projection); without cameras you get a LiDAR-only scene.

---

## `lidar/` — point clouds (required)

- One file per frame. **Frame order = lexicographic sort of the filenames**, so
  zero-pad consistently.
- Accepted extensions: **`.pcd`** and **`.bin`** (`.ply` is accepted on import
  but is not yet supported by the point-cloud renderer, so it may not display).

**`.pcd`** — standard Point Cloud Data file (ASCII or binary), PCL v0.7 header.
- Position read from fields `x`, `y`, `z`.
- Intensity read from field `intensity` (or `i`); **defaults to `0.5`** if
  absent.
- Optional per-point color via a packed `rgb`/`rgba` field or `r,g,b` /
  `red,green,blue` triples.

**`.bin`** — nuScenes-style raw buffer: `float32` array reshaped to `(-1, 4)`,
i.e. exactly four floats per point in the order `x, y, z, intensity`.

Units are **meters**. Coordinates may be in a local sensor frame or a global/UTM
frame; very large coordinates (centroid > 10 km) are automatically recentered at
display time.

---

## `cameras/<CameraName>/…` — images (optional)

- Each **subdirectory of `cameras/` is one camera**; the folder name becomes the
  camera ID (e.g. `front`, `left`, `rear`). These IDs must match the keys in
  `calibration.json → lidar_to_cameras`.
- Accepted image extensions: **`.jpg`, `.jpeg`, `.png`**.
- **Images are matched to LiDAR frames by sorted position**, not by filename
  stem: the Nth image (sorted) in each camera folder pairs with the Nth LiDAR
  frame. Keep the file counts aligned and the zero-padding identical so the
  ordering lines up.

Alternative layouts the importer also accepts:
- A top-level **`images/`** folder (no `cameras/`) → imported as a single camera
  named `images`.
- Loose image files at the scene root → a single camera named `default`.

---

## `calibration.json` — sensor calibration (optional)

Required only if you want LiDAR↔camera projection (3D boxes drawn on images,
Segment-to-3D, etc.). Shape:

```json
{
  "lidar_to_cameras": {
    "front": {
      "extrinsic": {
        "rotation":    [[r11, r12, r13],
                        [r21, r22, r23],
                        [r31, r32, r33]],
        "translation": [tx, ty, tz]
      },
      "intrinsic": {
        "fx": 1200.0, "fy": 1200.0,
        "cx": 960.0,  "cy": 540.0,
        "distortion": [k1, k2, k3, k4],
        "resolution": [1920, 1080],
        "camera_model": "pinhole"
      }
    }
  },
  "ego_to_lidar": {
    "rotation":    [[1,0,0],[0,1,0],[0,0,1]],
    "translation": [0, 0, 0]
  }
}
```

Key points:

- **`extrinsic`** is a **3×3 `rotation` matrix + 3-vector `translation`** (the
  LiDAR→camera transform) — **not** a flattened 4×4 matrix.
- **`intrinsic`**: `fx, fy, cx, cy` are required; `distortion`, `resolution`,
  and `camera_model` are optional.
- **`camera_model`** supports `"pinhole"` (default) and `"kannala_brandt"`
  (fisheye). If omitted, the viewer auto-detects fisheye when a 4-element
  `distortion` is present and `fx < imageWidth / 2`.
- The camera keys under `lidar_to_cameras` **must equal the `cameras/`
  subdirectory names**.
- **`ego_to_lidar`** is optional. ⚠️ If you omit it (or set it to the identity
  rotation) *and* the bundle has ego poses, the importer assumes a **y-forward
  LiDAR** convention and applies the fixed rotation
  `[[0,1,0],[-1,0,0],[0,0,1]]` (ego +x → LiDAR +y). If your sensor uses a
  different convention, you **must** supply a non-identity `ego_to_lidar` for it
  to be respected.

You may alternatively provide a `calibration/` directory containing
`extrinsics.json` and `intrinsics/<CameraName>.json` instead of a single
`calibration.json`.

---

## `ego_poses/poses.json` — ego trajectory (optional)

Enables world-space placement of per-frame clouds and 4D temporal stacking.
Looked up at `ego_poses/poses.json` (or `ego_poses/ego_poses.json`).

```json
{
  "frames": [
    { "frame_index": 0, "position": [x, y, z], "rotation": [w, x, y, z], "timestamp": 0.0 },
    { "frame_index": 1, "position": [x, y, z], "rotation": [w, x, y, z] }
  ]
}
```

- **`rotation` is a quaternion in `[w, x, y, z]` order** (w first). Identity is
  `[1, 0, 0, 0]`.
- `position` is `[x, y, z]` in meters; defaults to `[0, 0, 0]`.
- `frame_index` keys the pose to the LiDAR frame. Entries with a negative
  `frame_index` are dropped. Frames without a pose render without world placement.
- `timestamp` and `velocity` are optional. If `timestamp` is absent, it is
  synthesized from the scene fps (`frame_index / fps`).
- A bare JSON list `[ {…}, … ]` is also accepted and indexed positionally.
- Any `world_origin` key is **ignored** by the importer.

---

## `scene_metadata.json` — scene metadata (optional)

```json
{
  "description": "Downtown, dusk",
  "fps": 10.0,
  "location": "…",
  "weather": "clear",
  "time_of_day": "dusk",
  "recording_date": "2024-01-01"
}
```

`fps` defaults to `10.0` and is used to synthesize frame timestamps when ego
poses don't carry them.

---

## `annotations/` — pre-existing labels (optional)

If you're importing already-labeled data, include an `annotations/` folder. The
importer recognizes several formats:

- **KITTI 3D** — `annotations/lidar/*.txt` or `annotations/label_2/*.txt`
  (15-column KITTI object labels; dimensions in meters, `rotation_y` as yaw).
- **COCO-style JSON** — `annotations/*.json` (2D boxes, polylines, polygons,
  ellipses, rotated boxes, keypoints).
- **SemanticKITTI** — `*.label` files for 3D point segmentation.

Pass `derive_taxonomy=true` on import to auto-create classes from the labels you
provide; otherwise the target dataset's existing taxonomy is used. There is no
separate taxonomy file inside the bundle.

---

## Multi-scene bundles

A single zip may contain multiple scenes: make each scene its own top-level
folder (each containing its own `lidar/`, `cameras/`, `calibration.json`, …).
A folder counts as a scene if it contains any of `cameras/`, `lidar/`,
`images/`, `pointcloud/`, `velodyne/`, or a `calibration.json`. If the zip has a
single top-level folder and no root `metadata.json`, that folder is unwrapped and
treated as one scene.

---

## Video input (extract frames from a video)

Besides scene bundles, you can upload a **video file** and the platform extracts
its frames into a scene — each frame becomes a camera image ready for 2D
annotation and tracking. This is the quickest way to start labeling from
camera-only footage (no LiDAR or calibration required).

- **Endpoint:** `POST /api/v1/import/upload-video` (`multipart/form-data`),
  requires the `DATASETS_IMPORT` permission.
- **Requires `ffmpeg`** on the backend server (the endpoint returns `503` if it's
  not installed).
- **Accepted formats:** MP4, AVI, MOV, MKV, WebM.

| Field | Default | Meaning |
|---|---|---|
| `dataset_id` | – | **Required.** Target dataset UUID. |
| `file` | – | **Required.** The video file. |
| `extraction_fps` | video's native FPS | Frames-per-second to sample from the video. |
| `max_frames` | no limit | Cap the number of extracted frames. |
| `image_format` | `jpg` | Output image format: `jpg`, `png`, or `webp`. |
| `preserve_folder_names` | `true` | Use the video's filename as the scene name. |

**Result:** one video → one **scene** whose frames are the extracted images, plus
an **auto-created task**. Since a video has no point cloud, these scenes are
camera-only (2D annotation); to combine video/images with LiDAR, use the scene
bundle described above instead.

> Tip: lower `extraction_fps` (e.g. 1–5) or set `max_frames` for long videos so
> you don't create thousands of frames to label.

---

## Import endpoint (for scripted uploads)

`POST /api/v1/import/upload-zip` (`multipart/form-data`), requires the
`DATASETS_IMPORT` permission:

| Field | Type | Notes |
|---|---|---|
| `dataset_id` | string | **Required.** Target dataset UUID. |
| `file` | file | **Required.** The `.zip` bundle. |
| `derive_taxonomy` | bool | Auto-create/merge a taxonomy from discovered labels. |
| `overwrite_annotations` | bool | Replace existing task annotations. |
| `preserve_folder_names` | bool | Keep folder names as scene names (default `true`). |
| `name_overrides` | JSON string | `{ "derived_name": "override" }`. |
| `scene_descriptions` | JSON string | `{ "scene_name": "description" }`. |

The scene name is derived from the folder name; there is no campaign or
scene-name form field. Use `POST /api/v1/import/check-scene-names` first to
detect name collisions.

---

## Gotchas checklist

- [ ] Filenames zero-padded and consistently named across `lidar/` and all
      `cameras/<cam>/` folders (sort-order alignment).
- [ ] Camera folder names match `lidar_to_cameras` keys in `calibration.json`.
- [ ] `extrinsic` uses **3×3 rotation + 3-vector translation**, not a 4×4.
- [ ] Ego-pose `rotation` is a **`[w, x, y, z]`** quaternion.
- [ ] Provide a non-identity `ego_to_lidar` if your LiDAR is **not** y-forward.
- [ ] `.pcd` intensity field present (else it defaults to a flat 0.5).

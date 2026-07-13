# Annotation Guide

A practical walkthrough of how to label data in the platform — the workflow, the
editors, and the tools. For data formats see [DATA_FORMAT.md](DATA_FORMAT.md) and
[ANNOTATION_FORMATS.md](ANNOTATION_FORMATS.md).

---

## 1. The workflow

Work is organized as **Campaign → Dataset → Scene → Task**:

1. **Create a Campaign** (a project) and a **Dataset** inside it.
2. **Import a scene** into the dataset (a `.zip` of LiDAR + cameras + calibration —
   see [DATA_FORMAT.md](DATA_FORMAT.md)). Attach a **taxonomy** (the class list) to
   the dataset — this defines what you can label and drives which editor opens.
3. Importing (or creating) a scene **auto-creates a Task** per linked taxonomy,
   assigned to you. Open it from **My Tasks**.
4. **Annotate**, then submit the task into the **QA workflow**
   (Annotation → QA → Customer QA → Accepted).

The taxonomy's **annotation mode** decides the editor:

| Taxonomy mode | Editor | What you label |
|---|---|---|
| `fusion_3d` | Fusion editor | 3D cuboids on LiDAR + 2D on cameras, with 3D→2D projection |
| `segmentation_3d` | 3D Segmentation editor | Per-point class labels on the LiDAR cloud |
| `2d_only` | 2D editor | Boxes / polylines / polygons / keypoints on images |

---

## 2. Fusion editor — 3D cuboids + 2D

The main editor for autonomous-driving labeling. LiDAR in the center, synchronized
camera views around it, with real-time 3D→2D projection so a box drawn in 3D shows
on every camera.

**Draw a cuboid:** press `C`, click-drag in the LiDAR view. Then refine:

| Action | Keys |
|---|---|
| Select tool | `V` |
| Cuboid tool | `C` |
| Rotate yaw ±5° / ±1° | `Q`/`E` · `Shift+Q`/`Shift+E` |
| Reset rotation | `R` |
| Resize (L/W/H, ±0.1 m) | `W`/`S` · `A`/`D` · `Z`/`X` |
| Delete selected | `Delete` |
| Save | `Ctrl+S` |

Orthographic **BEV / Side / Front** insets let you fine-tune position and size
precisely. Because a rigid object keeps the same size across frames, set its
dimensions once — editing size on a tracked box propagates to the rest of the track.

**2D on cameras:** `B` for a 2D box, `L` polyline, `P` polygon. Boxes projected
from 3D can be nudged in image space.

---

## 3. Tracking across frames

Objects that persist across frames share a **track**. Assign a box to a track
("Assign to Track", `T`), and mark frames as **keyframes**; the platform
interpolates the box pose on in-between frames. Navigate frames with `←` / `→`.

> Tracking is keyframe/interpolation based and manual — you set identity and
> keyframes; there is no automatic cross-frame object matcher. Keep a track's
> dimensions consistent (set once) so interpolation stays stable.

---

## 4. 3D Segmentation editor — per-point labels

Opens for `segmentation_3d` tasks. You paint class labels directly onto LiDAR
points. Pick a tool, then a class, then paint:

| Tool | Key | Use |
|---|---|---|
| Select | `V` | inspect / select points |
| Brush | `B`* | paint the active class under a radius |
| Lasso | – | select a region, then label |
| Region grow | – | flood-fill from a seed by proximity |
| Eraser | – | remove labels |

The **class widget** appears when you pick a class-painting tool (brush / lasso /
region-grow) and hides on `Esc`. Work in **semantic** mode (class only) or
**instance** mode (class + per-object instance id). Toggle `Show only labeled`,
point size, and color mode (height / intensity / RGB) from the toolbar.

\* Segmentation tool keys are shown in-editor; press `H` for the shortcut list.

---

## 5. AI-assisted labeling (optional)

If SAM2 is enabled (see the README's *AI-Assisted Segmentation* section):

- **AI Segment (2D):** press `W`, click an object in a camera image — SAM2 returns a
  mask you can accept as a polygon.
- **Segment-to-3D:** segment an object in 2D, then lift the mask into a 3D box /
  point selection using calibration.

Without a running SAM2 model these tools operate in mock mode.

---

## 6. QA review

Reviewers step tasks through **Annotation → QA → Customer QA → Accepted**, and can
flag issues or mark missed objects:

| Key | Action |
|---|---|
| `1` | Approve |
| `2` | Reject |
| `3` | Flag issue |
| `F` | Flag a missing object (false negative) |

---

## 7. Discoverability

- Press **`H`** in either editor for the in-app keyboard-shortcut reference.
- First-time users get **guided tours** that auto-start per editor.
- Empty states point you to the next step (e.g. "Create your first campaign").

For the full shortcut table, see the **Keyboard Shortcuts** section of the
[README](../README.md#keyboard-shortcuts).

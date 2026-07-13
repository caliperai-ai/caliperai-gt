---
title: 3D Box Tool
category: tools/3d
tags: [tool, 3d, annotation]
related: [3d-bounding-box, tracking]
---

# 3D Box Tool

The **3D Box Tool** is the primary tool for creating 3D bounding boxes in the LiDAR editor.

## Activating the Tool

- **Keyboard**: Press `B` or `1`
- **Toolbar**: Click the box icon

## Creating a Box

### Method 1: Click and Drag
1. Click in the point cloud where object center should be
2. Drag to set initial size
3. Release to create box

### Method 2: Auto-fit
1. Hold `Shift` while clicking
2. Tool auto-fits box to nearby point cluster

## Adjusting the Box

After creating a box:

### Move
- **Drag the box** to move in XY plane
- **Drag Z handle** to move up/down
- **Arrow keys** for fine adjustment

### Resize
- **Drag corner handles** to resize
- **Shift + drag** to resize symmetrically

### Rotate
- **Drag rotation handle** 
- **R key + mouse movement** 
- **[ and ]** for 5° increments

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| B or 1 | Select box tool |
| Enter | Confirm annotation |
| Escape | Cancel current |
| Delete | Delete selected |
| [ / ] | Rotate 5° |
| Shift + [ ] | Rotate 1° |
| Arrow keys | Fine position adjustment |

## Tips for Accurate Boxes

1. **Use multiple views**: Check 3D, BEV, and side views
2. **Zoom in**: Get close to the object
3. **Follow points**: Box edges should touch point cloud
4. **Check ground**: Bottom should be at ground level
5. **Rotate properly**: Yaw should match object direction

## Common Mistakes

- Box floating above ground
- Box too large (includes empty space)
- Wrong rotation (not aligned with object)
- Covering multiple objects with one box

## Auto-fit Feature

Press **Shift + Click** on a point cluster:
- Automatically creates fitted box
- Estimates dimensions from points
- May need manual adjustment

---
title: 3D Bounding Boxes
category: concepts
tags: [beginner, 3d, annotation]
related: [point-cloud, box-tool]
---

# 3D Bounding Boxes

## What is a 3D Bounding Box?

A **3D bounding box** (or **cuboid**) is a rectangular box that completely encloses an object in 3D space. It's the primary annotation type in LiDAR data.

## Box Properties

Every 3D box has these properties:

### Position (x, y, z)
- **Center point** of the box in 3D space
- Coordinates relative to the LiDAR sensor

### Dimensions
- **Length (L)**: Front to back of the object
- **Width (W)**: Left to right
- **Height (H)**: Bottom to top

### Rotation (Yaw)
- **Yaw angle**: Rotation around the vertical axis (Z)
- Typically 0° = facing forward (X direction)
- 90° = facing left (Y direction)

## Box Alignment

For accurate annotation, boxes should:
1. **Tightly fit** the object's point cloud
2. **Touch the ground plane** for vehicles
3. **Match object orientation** (yaw aligned with direction)
4. Be **consistent across frames** for tracking

## Common Object Sizes

| Object | Length | Width | Height |
|--------|--------|-------|--------|
| Car | 4-5m | 1.8-2m | 1.4-1.6m |
| Truck | 5-12m | 2-2.5m | 2.5-4m |
| Pedestrian | 0.4-0.8m | 0.4-0.8m | 1.5-2m |
| Cyclist | 1.5-2m | 0.5-0.8m | 1.5-2m |

## AI Quality Checks for Boxes

CaliperGT automatically checks:
- **Ground alignment**: Is bottom at ground level?
- **Aspect ratio**: Do dimensions match expected proportions?
- **Overlapping boxes**: Are there duplicate annotations?
- **Point density**: Does box contain enough LiDAR points?

## Tips for Good Boxes

1. **Rotate the view** to verify box from multiple angles
2. **Check BEV** to ensure X/Y position is correct
3. **Verify height** in side view
4. **Ensure tight fit** - box should touch point cloud edges
5. **Match yaw** to object's facing direction

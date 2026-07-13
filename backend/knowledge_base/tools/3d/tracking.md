---
title: Object Tracking in 3D
category: tools/3d
tags: [tool, 3d, tracking, advanced]
related: [box-tool, interpolation]
---

# Object Tracking in 3D

## What is Tracking?

**Tracking** assigns the same ID to an object across multiple frames. This creates a continuous path showing the object's movement through time.

## Why Tracking Matters

- Enables AI to learn **object persistence**
- Trains **motion prediction** models
- Required for **temporal consistency**

## Creating Tracks

### Manual Track Creation
1. Create a box in first frame
2. Navigate to next frame
3. Create another box for same object
4. Select both → **Link to Track** (or press `T`)

### Auto-Track (Recommended)
1. Create initial box
2. Select it
3. Press **P** for **Propagate Track**
4. Tool predicts position in subsequent frames
5. Review and adjust as needed

## Track Propagation

The **Propagate Track** feature:
- Uses motion prediction to place boxes in future frames
- Press **P** or click Propagate button
- Works best for moving objects with consistent motion

### Propagation Settings
- **Forward only**: Propagate to later frames
- **Backward**: Propagate to earlier frames
- **Both directions**: Fill entire scene

## Editing Tracks

### Adjust Single Frame
1. Navigate to frame
2. Select the box
3. Move/resize as needed
4. Other frames keep their positions

### Batch Adjust
1. Select track
2. Use **Track Editor** panel
3. Adjust start/end frames
4. Apply transformations to range

## Track Boundaries

- **Start frame**: First frame where object appears
- **End frame**: Last frame where object is visible
- Set manually or let system infer from annotations

## AI Quality Checks for Tracks

CaliperGT checks:
- **Track gaps**: Missing frames within a track
- **Velocity outliers**: Impossible speed between frames
- **Dimension consistency**: Size shouldn't change drastically
- **ID switches**: Possible swapped track IDs
- **Ghost tracks**: Duplicate tracks on same object

## Tips

1. **Start with key frames**: Annotate important moments first
2. **Use propagation**: Let the tool do initial work
3. **Check motion path**: Verify movement is smooth
4. **Watch for occlusions**: Track through when object is hidden
5. **Consistent sizing**: Same object = same dimensions

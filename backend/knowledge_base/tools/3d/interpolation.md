---
title: Track Interpolation
category: tools/3d
tags: [tool, 3d, tracking, interpolation]
related: [tracking, box-tool]
---

# Track Interpolation

## What is Interpolation?

**Interpolation** automatically fills in gaps between annotated frames in a track. If you annotate frames 0, 10, and 20, interpolation creates boxes for frames 1-9 and 11-19.

## Types of Interpolation

### Linear Interpolation
- Straight-line movement between keyframes
- Position, size, rotation blend linearly
- Good for simple, straight motion

### Spline Interpolation
- Smooth curves through keyframes
- More natural motion paths
- Better for turning vehicles

## Using Interpolation

### Basic Workflow
1. Annotate **keyframes** (important positions)
2. Select the track
3. Click **Interpolate** or press `I`
4. Review generated frames
5. Adjust as needed

### Setting Keyframes
- Any manually annotated frame is a keyframe
- More keyframes = more accurate interpolation
- Minimum: 2 keyframes per track

## When to Add Keyframes

Add extra keyframes when:
- Object **changes speed** significantly
- Object **turns** or changes direction
- Object becomes **occluded** then reappears
- Object starts/stops moving
- Complex maneuvers

## Reviewing Interpolation

After interpolation:
1. **Scrub through frames** to check motion
2. Look for **unnatural jumps**
3. Verify **ground contact** throughout
4. Check **rotation** matches direction
5. Fix any problems by adding keyframes

## Common Issues

### Floating Objects
- Interpolated boxes may drift above ground
- Solution: Add keyframe with correct Z

### Wrong Rotation
- Yaw may not interpolate correctly through turns
- Solution: Add keyframe at turn apex

### Size Changes
- Dimensions shouldn't change (same object)
- Check that all keyframes have consistent size

## Tips

1. **Keyframe turning points**: Where motion changes
2. **Use playback**: Watch motion in real-time
3. **Check ground**: Vehicles should stay grounded
4. **Verify endpoints**: Start and end positions correct

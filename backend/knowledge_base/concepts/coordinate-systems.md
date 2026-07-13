---
title: Coordinate Systems
category: concepts
tags: [intermediate, 3d, coordinates]
related: [lidar-basics, 3d-bounding-box]
---

# Coordinate Systems

## LiDAR-Centered Coordinates

In CaliperGT, the **LiDAR sensor is at the origin** (0, 0, 0):

### Axes
- **X+**: Forward (direction of vehicle travel)
- **Y+**: Left (passenger side on right-hand drive)
- **Z+**: Up (towards sky)

### Common Values
- **Ground level**: Z ≈ -1.8m (sensor height above ground)
- **Forward objects**: Positive X values
- **Behind vehicle**: Negative X values
- **Left side**: Positive Y values
- **Right side**: Negative Y values

## Understanding Position Values

Example: A car annotation at position (15.2, -3.5, -0.8)
- **15.2m forward** of the sensor
- **3.5m to the right** (negative Y)
- **0.8m below sensor height** (ground level for a car)

## Rotation (Yaw)

Yaw rotation is measured in radians:
- **0 radians (0°)**: Facing forward (+X direction)
- **π/2 radians (90°)**: Facing left (+Y direction)  
- **π radians (180°)**: Facing backward (-X direction)
- **-π/2 radians (-90°)**: Facing right (-Y direction)

## Ego Vehicle Footprint

The annotation vehicle (ego vehicle) occupies space near the origin:
- Centered around (0, 0)
- LiDAR is typically 0.5m forward of vehicle center
- Any annotation inside this zone triggers an error

## Camera Coordinates

Each camera has its own coordinate system:
- Origin at camera position
- Different rotation relative to LiDAR
- Calibration matrices convert between systems

## Tips

1. **Use BEV** to understand X/Y positions
2. **Ground = Z around -1.8m** for typical sensor heights
3. **Yaw alignment** should match vehicle's forward direction
4. **Check ego collision** if annotations are near origin

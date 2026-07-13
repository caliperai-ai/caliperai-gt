---
title: View Controls in 3D Editor
category: tools/3d
tags: [tool, 3d, navigation]
related: [box-tool, keyboard-shortcuts]
---

# View Controls in 3D Editor

## Views Available

### Main 3D View
- Full 3D perspective of point cloud
- Rotate, pan, zoom freely
- Primary workspace for annotation

### Bird's Eye View (BEV)
- Top-down view (looking down Z axis)
- Great for X/Y positioning
- Shows object layout clearly

### Side Views
- Front view (looking -X)
- Side view (looking -Y or +Y)
- Useful for Z (height) adjustment

## Mouse Controls

### 3D View Navigation
| Mouse Action | Result |
|--------------|--------|
| Left drag | Rotate view |
| Right drag | Pan view |
| Scroll | Zoom in/out |
| Middle drag | Pan view |

### Object Manipulation
| Mouse Action | Result |
|--------------|--------|
| Left click | Select object |
| Left drag on object | Move object |
| Drag handle | Transform (resize/rotate) |

## Keyboard Navigation

| Key | Action |
|-----|--------|
| 1-4 | Switch views |
| Home | Reset camera |
| +/- | Zoom in/out |
| Arrow keys | Pan view |
| W/A/S/D | Fly through (if enabled) |

## Frame Navigation

| Key | Action |
|-----|--------|
| ← Left Arrow | Previous frame |
| → Right Arrow | Next frame |
| Shift + ← | Jump 10 frames back |
| Shift + → | Jump 10 frames forward |
| Home | First frame |
| End | Last frame |

## View Presets

- **Perspective**: Standard 3D view
- **Top (BEV)**: Bird's eye view
- **Front**: Looking at front of ego vehicle
- **Side**: Looking at side of scene

## Tips

1. **Use BEV** for positioning boxes in X/Y
2. **Use side view** to verify Z height
3. **Rotate 3D view** to check all angles
4. **Zoom in** on objects for precise fitting
5. **Reset view** if you get lost

## Double-Click Zoom

- **Double-click** on any object to zoom to it
- Centers view on that annotation
- Great for jumping to specific objects

## Point Cloud Rendering

Adjust point cloud settings:
- **Point size**: Larger = more visible
- **Color mode**: Height, intensity, or solid
- **Density**: Show more or fewer points

---
title: 2D Rectangle Tool
category: tools/2d
tags: [tool, 2d, annotation]
related: [polygon-tool, ai-segment]
---

# 2D Rectangle Tool

The **Rectangle Tool** creates 2D bounding boxes on camera images.

## When to Use

- Annotating objects in camera images
- Creating 2D boxes for image-only datasets
- Verifying 3D projections

## Activating the Tool

- **Keyboard**: Press `R` or `2`
- **Toolbar**: Click rectangle icon

## Creating a Rectangle

1. Click at one corner
2. Drag to opposite corner
3. Release to create box

## Adjusting Rectangles

### Move
- Drag inside the box to move

### Resize
- Drag corners or edges
- Hold Shift for proportional resize

### Fine Adjust
- Select box
- Use arrow keys for pixel-level adjustment

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| R or 2 | Select rectangle tool |
| Enter | Confirm annotation |
| Escape | Cancel current |
| Delete | Delete selected |
| Arrow keys | Nudge by 1px |
| Shift + Arrows | Nudge by 10px |

## Tips

1. **Tight fit**: Box should touch object edges
2. **Include all parts**: Entire object inside box
3. **Handle occlusion**: Mark objects as occluded if partially hidden
4. **Consistency**: Same object = same box sizing pattern

---
title: AI Segmentation Tool
category: tools/2d
tags: [tool, 2d, ai, segmentation]
related: [polygon-tool, ai-track]
---

# AI Segmentation Tool

The **AI Segment Tool** uses SAM (Segment Anything Model) to automatically create precise segmentation masks with just a click.

## What It Does

- Automatically identifies object boundaries
- Creates pixel-perfect segmentation masks
- Powered by SAM2 (Segment Anything Model 2)

## How to Use

### Point Mode (Click)
1. Select AI Segment tool (toolbar or `S`)
2. Click inside the object you want to segment
3. AI generates mask automatically
4. Accept or refine

### Box Mode
1. Draw a rough rectangle around object
2. AI refines to exact boundaries
3. More accurate than point for some objects

## Refining Results

If automatic result isn't perfect:

### Add Points (Include)
- Click areas that should be included
- Green dots = include this area

### Remove Points (Exclude)
- Shift+Click or right-click areas to exclude
- Red dots = exclude this area

### Iterate
- Add more points until satisfied
- Click Accept when done

## When to Use

Good for:
- Complex shapes (vehicles, people)
- Objects with clear boundaries
- Speeding up polygon creation

Less effective for:
- Transparent objects
- Heavily occluded items
- Very small objects

## Tips

1. **Click center** of object for best results
2. **Add exclude points** to remove background
3. **Use box mode** for difficult objects
4. **Verify edges** after acceptance
5. **GPU required** for fast performance

## Performance

- GPU mode: Nearly instant
- CPU mode: 2-5 seconds per segmentation
- Works best with clear object boundaries

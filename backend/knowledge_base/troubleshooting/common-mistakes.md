---
title: Common Mistakes
category: troubleshooting
tags: [troubleshooting, mistakes, beginner]
related: [annotation-basics, qa-review-process]
---

# Common Annotation Mistakes

## 3D Box Issues

### Floating Boxes
**Problem**: Box bottom is above ground level
**Solution**: Lower the box until Z-bottom ≈ -1.8m (ground plane)
**Check**: AI QA "Ground Plane Alignment" check

### Boxes Too Large
**Problem**: Excessive empty space inside box
**Solution**: Resize to fit point cloud tightly
**Check**: AI QA "Hull Tightness" check

### Wrong Rotation
**Problem**: Box yaw doesn't match object direction
**Solution**: Rotate box to align with object's facing direction
**Check**: AI QA "Heading-Motion Mismatch" check

### Missing Ego Check
**Problem**: Annotation placed inside ego vehicle zone
**Solution**: Don't annotate within the vehicle's footprint near origin
**Check**: AI QA "Ego Collision" check

## Tracking Issues

### Track Gaps
**Problem**: Missing frames within a track
**Solution**: Fill in missing frames or use interpolation
**Check**: AI QA "Track Gap" check

### ID Switches
**Problem**: Track ID changes mid-way for same object
**Solution**: Merge tracks or unlink and re-link correctly
**Check**: AI QA "ID Switch" check

### Velocity Jumps
**Problem**: Object appears to teleport between frames
**Solution**: Verify positions in both frames, check track continuity
**Check**: AI QA "Velocity Outlier" check

### Dimension Changes
**Problem**: Box size varies across frames for same object
**Solution**: Keep dimensions consistent (same object = same size)
**Check**: AI QA "Dimension Consistency" check

## Classification Issues

### Wrong Class
**Problem**: Object labeled with incorrect class
**Solution**: Change to correct class from taxonomy
**Impact**: Critical for AI training

### Missing Attributes
**Problem**: Occluded/truncated not set
**Solution**: Set all required attributes
**Check**: AI QA "Class Attributes" check

## Completeness Issues

### Missing Objects
**Problem**: Visible objects not annotated
**Solution**: Carefully scan each frame for all objects
**Impact**: False negatives in training data

### Not All Frames
**Problem**: Some frames skipped
**Solution**: Annotate or verify every frame in scene
**Check**: AI QA "Frame Annotation Count" check

## Prevention Tips

1. **Self-review** before submitting
2. **Run AI QA** and address issues
3. **Use multiple views** to verify 3D accuracy
4. **Playback tracks** to verify smooth motion
5. **Follow guidelines** exactly as specified

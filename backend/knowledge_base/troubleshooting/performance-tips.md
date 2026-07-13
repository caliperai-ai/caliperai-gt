---
title: Performance Tips
category: troubleshooting
tags: [troubleshooting, performance, help]
related: [view-controls, keyboard-shortcuts]
---

# Performance Tips

## Browser Performance

### Recommended Browsers
- **Chrome** (recommended)
- Firefox
- Edge (Chromium-based)

### Browser Settings
- Allow WebGL
- Enable hardware acceleration
- Close unnecessary tabs
- Use 64-bit browser version

## System Requirements

### Minimum
- 8GB RAM
- Modern multi-core CPU
- GPU with WebGL support
- Stable internet connection

### Recommended
- 16GB+ RAM
- GPU with dedicated memory
- SSD storage
- Fast internet (>25 Mbps)

## Improving Performance

### Reduce Point Cloud Density
- Use density slider in settings
- Lower density = faster rendering
- Increase only when needed

### Smaller View Sizes
- Collapse panels you're not using
- Use focused single view instead of split

### Clear Browser Cache
- Periodically clear cache
- Especially after updates

## If Things Are Slow

### Refresh the Page
- Saves current work
- Reloads clean session

### Close Other Apps
- Free up system memory
- Close memory-heavy applications

### Check Network
- Verify stable connection
- Test download speed

### Reduce Visible Frames
- Show fewer frames in timeline
- Work in smaller chunks

## Large Scenes

For scenes with many objects:
1. Hide annotation layers you're not editing
2. Focus on one object type at a time
3. Use filtering to show only relevant items

## GPU Usage

- CaliperGT uses WebGL for 3D rendering
- GPU acceleration helps significantly
- Check browser GPU settings are enabled

## Reporting Issues

If persistent problems:
1. Note which actions are slow
2. Check browser console for errors
3. Report with browser/OS details
4. Include scene/task ID

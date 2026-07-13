---
title: QA Review Process
category: workflow
tags: [workflow, qa, review]
related: [task-lifecycle, handling-rejections]
---

# QA Review Process

## Understanding QA

Quality Assurance (QA) ensures annotations meet project standards. Every submitted task goes through QA before acceptance.

## QA Levels

### Internal QA
- CaliperGT's QA reviewers
- Check annotation quality
- Provide feedback

### AI QA
- Automated quality checks
- Runs 24 different checks
- Flags potential issues

### Customer QA (if enabled)
- Client reviews final output
- May have additional requirements

## AI QA Checks

CaliperGT runs 24 automated checks across 5 categories:

### Geometry Checks (4)
- Ground plane alignment
- Aspect ratio validation
- Overlapping boxes detection
- Ego vehicle collision

### Track Checks (9)
- Track gaps
- Velocity outliers
- Dimension consistency
- ID switch detection
- And more...

### Point Cloud Checks (3)
- Point density
- Point-to-box fit
- Hull tightness

### Scene Checks (5)
- Semantic placement
- Distance range
- Attribute completeness
- And more...

### Cross-Modal Checks (3)
- Projection alignment
- Camera visibility
- Class verification

## Severity Levels

| Level | Icon | Meaning |
|-------|------|---------|
| CRITICAL | 🔴 | Must fix - blocks acceptance |
| HIGH | 🟠 | Should fix - affects quality |
| MEDIUM | 🟡 | Review needed |
| LOW | 🔵 | Minor issue |
| INFO | ⚪ | Informational only |

## Responding to QA

1. Review all issues flagged
2. Fix critical issues first
3. Address high severity issues
4. Explain any items you disagree with
5. Resubmit when resolved

## Common QA Flags

- **Empty boxes**: No LiDAR points inside
- **Ground floating**: Box not touching ground
- **Track gaps**: Missing frames in track
- **Bad velocity**: Object moves impossibly fast
- **Dimension change**: Size changes within track

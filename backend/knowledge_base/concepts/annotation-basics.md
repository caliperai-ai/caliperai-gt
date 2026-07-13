---
title: Annotation Basics
category: concepts
tags: [beginner, annotation]
related: [3d-bounding-box, task-lifecycle]
---

# Annotation Basics

## What is Annotation?

**Annotation** is the process of labeling objects in sensor data so that AI systems can learn to recognize them. In CaliperGT, you annotate:
- LiDAR point clouds (3D)
- Camera images (2D)
- Combined sensor data (fusion)

## Types of Annotations

### 3D Cuboids
- Rectangular boxes in 3D space
- Used for vehicles, pedestrians, cyclists
- Primary annotation type in LiDAR data

### 2D Boxes
- Rectangles on camera images
- Can be manually drawn or projected from 3D

### Polygons
- Freeform shapes for irregular objects
- Used in 2D camera images

### Polylines
- Connected line segments
- Used for lane markings, road edges

## Object Classes

Common classes you'll annotate:
- **car**: Passenger vehicles
- **truck**: Large vehicles
- **bus**: Public transport
- **pedestrian**: People walking
- **cyclist**: People on bicycles
- **motorcycle**: Two-wheeled motorized
- **traffic_cone**: Orange safety cones
- **barrier**: Road barriers

## Attributes

Beyond the class, annotations have attributes:
- **occluded**: Partially hidden by other objects
- **truncated**: Partially outside camera view
- **motion_state**: Moving, stopped, parked

## Tracks

A **track** connects the same object across multiple frames:
- Same vehicle from frame 0 to frame 100
- Enables AI to learn object tracking
- Track ID stays constant for one object

## Quality Expectations

Good annotations should:
1. **Tightly fit** the object
2. Be **correctly classified**
3. Have **complete attributes**
4. Be **consistent across frames** (for tracks)
5. **Touch ground plane** (for vehicles)

## Getting Started

1. Open a task assigned to you
2. Navigate frames using timeline
3. Select annotation tool
4. Draw boxes around objects
5. Set class and attributes
6. Create tracks for objects across frames
7. Submit when complete

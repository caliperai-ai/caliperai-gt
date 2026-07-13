---
title: What is a Point Cloud?
category: concepts
tags: [beginner, 3d, lidar]
related: [lidar-basics, 3d-bounding-box]
---

# What is a Point Cloud?

## Simple Explanation

A **point cloud** is like a 3D photograph made of dots instead of pixels.

Imagine standing in a room and measuring the distance to thousands of points on the walls, floor, and furniture. If you plotted all those measurements in 3D space, you'd have a point cloud!

## How It's Created

Point clouds come from **LiDAR sensors** (Light Detection and Ranging):

1. A laser spins rapidly on top of a vehicle
2. It shoots out beams of light in all directions
3. The light bounces off objects and returns to the sensor
4. The sensor measures how long each beam took to return
5. Using the time + direction, it calculates where each point is

## What You See in CaliperGT

When you open the 3D editor, you'll see:
- **Colored dots** representing the point cloud
- Colors usually show **height** (red = high, blue = low) or **intensity**
- The more dots, the more detail captured

## Your Job

As an annotator, you draw **3D boxes** around important objects in the point cloud. The boxes help train AI to recognize:
- 🚗 Vehicles (cars, trucks, buses)
- 🚶 Pedestrians
- 🚴 Cyclists
- 🚧 Traffic objects

## Tips for Beginners

1. **Rotate the view** to see objects from different angles
2. **Zoom in** on areas with lots of dots - that's where objects are
3. **Use the BEV (Bird's Eye View)** to see the layout from above
4. Objects appear as **dense clusters** of dots

## Point Density

- Objects closer to the sensor have **more points** (denser)
- Distant objects have **fewer points** (sparser)
- AI QA checks for empty or very sparse boxes

## Common Issues

- **Empty boxes**: No points inside - likely wrong position
- **Sparse boxes**: Too few points - might be too large or mispositioned
- **Dense boxes**: Many points - good sign of correct annotation

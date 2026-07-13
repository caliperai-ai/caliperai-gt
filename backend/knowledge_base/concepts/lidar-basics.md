---
title: LiDAR Basics
category: concepts
tags: [beginner, 3d, lidar, sensor]
related: [point-cloud, coordinate-systems]
---

# LiDAR Basics

## What is LiDAR?

**LiDAR** stands for **Li**ght **D**etection **a**nd **R**anging. It's a remote sensing method that uses laser light to measure distances.

## How It Works

1. **Laser Emission**: A laser pulses thousands of times per second
2. **Reflection**: Light bounces off objects and returns to the sensor
3. **Time Measurement**: The sensor calculates distance using time-of-flight
4. **3D Mapping**: Multiple points build a 3D map of the environment

## LiDAR on Autonomous Vehicles

On self-driving vehicles, LiDAR sensors are typically:
- Mounted on the **roof** for 360° visibility
- Spinning continuously (64-128 laser beams)
- Collecting millions of points per second

## Distance from LiDAR

The LiDAR sensor is at the center of the coordinate system (origin: 0, 0, 0):
- Objects near the sensor (0-20m): **High detail**, many points
- Medium distance (20-50m): **Medium detail**
- Far away (50-80m): **Low detail**, sparse points
- Beyond 80m: Often unreliable

## Sensor Height

The LiDAR is typically mounted **1.8m above ground**:
- Ground level in LiDAR coordinates is approximately **z = -1.8m**
- Vehicles touch ground at approximately this Z level
- This affects ground plane alignment checks

## LiDAR vs Camera

| Feature | LiDAR | Camera |
|---------|-------|--------|
| Data type | 3D points | 2D images |
| Distance | Accurate | Requires estimation |
| Lighting | Works in dark | Needs light |
| Weather | Affected by rain/fog | Affected by glare |
| Detail | Points only | Full visual detail |

## In CaliperGT

You'll work with:
- **Point clouds** from LiDAR in the 3D editor
- **Camera images** for visual verification
- **Fusion annotation** combines both for accuracy

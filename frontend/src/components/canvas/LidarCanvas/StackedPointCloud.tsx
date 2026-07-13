import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { StackedPointCloud as StackedPointCloudData } from '@/utils/egoTransform';
import { useEditorStore } from '@/store/editorStore';
import {
  buildOctree,
  getVisibleNodes,
  extractVisibleGeometry,
  voxelGridDownsample,
} from '@/utils/pointCloudOctree';
import { detectGroundPlane } from '@/utils/groundPlaneDetection';


const stackedVertexShader = `
  attribute float intensity;
  attribute float frameIndex;
  attribute float isGround;  // RANSAC-detected ground mask

  varying float vIntensity;
  varying float vHeight;
  varying float vFrameIndex;
  varying float vIsGround;
  varying float vClipped;   // 1.0 if outside clip box

  uniform float pointSize;
  uniform float referenceFrame;

  // Clip box uniforms (world/LiDAR space from origin)
  uniform bool  useClipBox;
  uniform float clipXMin;
  uniform float clipXMax;
  uniform float clipYMin;
  uniform float clipYMax;
  uniform float clipZMin;
  uniform float clipZMax;

  void main() {
    vIntensity = intensity;
    vHeight = position.z;
    vFrameIndex = frameIndex;
    vIsGround = isGround;

    // Clip box test
    if (useClipBox) {
      bool outside = position.x < clipXMin || position.x > clipXMax ||
                     position.y < clipYMin || position.y > clipYMax ||
                     position.z < clipZMin || position.z > clipZMax;
      vClipped = outside ? 1.0 : 0.0;
    } else {
      vClipped = 0.0;
    }

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    // Slightly larger points for reference frame
    float sizeMultiplier = (abs(frameIndex - referenceFrame) < 0.5) ? 1.2 : 1.0;

    gl_PointSize = pointSize * sizeMultiplier * (300.0 / -mvPosition.z);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const stackedFragmentShader = `
  varying float vIntensity;
  varying float vHeight;
  varying float vFrameIndex;
  varying float vIsGround;
  varying float vClipped;   // 1.0 if outside clip box

  uniform float minHeight;
  uniform float maxHeight;
  uniform float groundLevel;
  uniform float referenceFrame;
  uniform vec3 groundColor;         // Color for ground plane points (white)
  uniform bool showGroundPlane;     // Whether to highlight ground plane

  // Enhanced height-based color scheme with improved visibility and contrast
  vec3 getHeightColor(float height) {
    // Normalize height with ground at 0
    float normalizedHeight = height - groundLevel;

    // Refined color bands for better object discrimination:
    // Below ground (< -0.2m): Deep purple/blue - noise, artifacts
    // Ground level (-0.2 to 0.2m): Warm gray - roads, flat surfaces
    // Curb/Low (0.2 to 0.8m): Bright cyan - curbs, low barriers
    // Person height (0.8 to 1.8m): Vibrant green - pedestrians, car bodies
    // Vehicle/Sign (1.8 to 3.5m): Golden yellow - trucks, traffic signs, tall vehicles
    // Building/Pole (3.5m+): Red/magenta gradient - structures, poles, trees

    vec3 color;

    if (normalizedHeight < -0.2) {
      // Below ground - deep purple/blue for noise/artifacts
      float t = clamp((normalizedHeight + 2.0) / 1.8, 0.0, 1.0);
      color = mix(vec3(0.05, 0.0, 0.15), vec3(0.2, 0.15, 0.4), t);
    } else if (normalizedHeight < 0.2) {
      // Ground level - warm gray gradient for clear road surface
      float t = (normalizedHeight + 0.2) / 0.4;
      color = mix(vec3(0.25, 0.22, 0.20), vec3(0.35, 0.32, 0.28), t);
    } else if (normalizedHeight < 0.8) {
      // Low objects - bright cyan/aqua for high visibility
      float t = (normalizedHeight - 0.2) / 0.6;
      color = mix(vec3(0.0, 0.8, 0.9), vec3(0.0, 0.95, 0.85), t);
    } else if (normalizedHeight < 1.8) {
      // Person/Car height - vibrant lime to emerald green
      float t = (normalizedHeight - 0.8) / 1.0;
      color = mix(vec3(0.2, 0.95, 0.3), vec3(0.1, 0.85, 0.5), t);
    } else if (normalizedHeight < 3.5) {
      // Tall vehicles/signs - golden yellow to orange
      float t = (normalizedHeight - 1.8) / 1.7;
      color = mix(vec3(0.95, 0.85, 0.1), vec3(1.0, 0.6, 0.0), t);
    } else {
      // Very tall structures - red to magenta gradient
      float t = clamp((normalizedHeight - 3.5) / 4.5, 0.0, 1.0);
      color = mix(vec3(1.0, 0.2, 0.0), vec3(0.9, 0.0, 0.5), t);
    }

    return color;
  }

  void main() {
    // Discard points outside the clip box
    if (vClipped > 0.5) discard;

    // Circular point shape
    vec2 center = gl_PointCoord - vec2(0.5);
    if (dot(center, center) > 0.25) discard;

    vec3 color;

    // Check if this is a RANSAC-detected ground point
    if (showGroundPlane && vIsGround > 0.5) {
      color = groundColor;
    } else {
      color = getHeightColor(vHeight);
    }

    // Slight brightness boost for reference frame points
    if (abs(vFrameIndex - referenceFrame) < 0.5) {
      color *= 1.1;
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;


export interface StackedPointCloudProps {
  data: StackedPointCloudData;
  pointSize?: number;
  showGroundPlane?: boolean;
  distanceThreshold?: number;
  samplePercent?: number;
  maxPoints?: number;
  voxelSize?: number;
}

export const StackedPointCloud: React.FC<StackedPointCloudProps> = ({
  data,
  pointSize = 0.01,
  showGroundPlane = true,
  distanceThreshold = 0.15,
  samplePercent = 30,
  maxPoints = 100000,
  voxelSize = 0.25,
}) => {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const { camera } = useThree();

  const hasData = data && data.pointCount > 0;

  const downsampledData = useMemo(() => {
    if (!hasData) return null;

    if (!data.positions || !data.intensities || !data.frameIndices) {
      console.error('[StackedPointCloud] Invalid point cloud data');
      return null;
    }

    if (data.pointCount > 300000) {
      try {
        return voxelGridDownsample(
          data.positions,
          data.intensities,
          data.frameIndices,
          Math.max(voxelSize, 0.3)
        );
      } catch (error) {
        console.error('[StackedPointCloud] Downsampling failed:', error);
      }
    }

    return {
      positions: data.positions,
      intensities: data.intensities,
      frameIndices: data.frameIndices,
      pointCount: data.pointCount,
    };
  }, [data, voxelSize, hasData]);

  const groundMaskCacheRef = useRef<{
    cacheKey: string;
    mask: Float32Array | null;
  } | null>(null);

  const groundMask = useMemo(() => {
    if (!downsampledData || !showGroundPlane) return null;

    const positions = downsampledData.positions;
    const pointCount = downsampledData.pointCount;

    const cacheKey = `${pointCount}-${distanceThreshold}-${samplePercent}`;
    if (groundMaskCacheRef.current?.cacheKey === cacheKey) {
      return groundMaskCacheRef.current.mask;
    }

    // Use RANSAC to detect ground plane
    const result = detectGroundPlane(positions, {
      distanceThreshold,
      sampleFromLowestPercent: samplePercent,
    });
    const mask = result?.groundMask ?? null;

    // Cache the result
    groundMaskCacheRef.current = { cacheKey, mask };

    return mask;
  }, [downsampledData, showGroundPlane, distanceThreshold, samplePercent]);

  // Step 2: Build octree for frustum culling (skip if no data)
  // NOTE: Octree is optional - if memory constrained, skip it
  const octree = useMemo(() => {
    if (!downsampledData || downsampledData.pointCount === 0) return null;

    // MEMORY OPTIMIZATION: Skip octree for small point clouds
    // Octree overhead isn't worth it for <50k points
    if (downsampledData.pointCount < 50000) {
      return null;
    }

    try {
      // Use less depth for faster tree building and less memory
      const tree = buildOctree(downsampledData.positions, {
        maxDepth: 4,  // Reduced from 5 for less memory
        maxPointsPerNode: 2000,  // Increased from 1000
        minNodeSize: 2.0,  // Increased from 1.0 for fewer nodes
      });

      return tree;
    } catch {
      return null;
    }
  }, [downsampledData]);

  // Create base geometry (will be updated on frustum culling)
  const geometry = useMemo(() => {
    if (!downsampledData) return null;

    try {
      const geom = new THREE.BufferGeometry();

      // Use exact data size - no pre-allocation for dynamic updates
      // MEMORY OPTIMIZATION: Reduce max points to prevent huge allocations
      const actualPoints = Math.min(100000, downsampledData.pointCount);

      // IMPORTANT: Must COPY the data, not use subarray views!
      // Views become invalid when the source data is garbage collected
      let positionsData: Float32Array;
      let intensitiesData: Float32Array;
      let frameIndicesData: Float32Array;
      let isGroundData: Float32Array;

      try {
        positionsData = new Float32Array(actualPoints * 3);
        intensitiesData = new Float32Array(actualPoints);
        frameIndicesData = new Float32Array(actualPoints);
        isGroundData = new Float32Array(actualPoints);
      } catch {
        // If allocation fails, try with even smaller size
        try {
          const smallerSize = 50000;
          positionsData = new Float32Array(smallerSize * 3);
          intensitiesData = new Float32Array(smallerSize);
          frameIndicesData = new Float32Array(smallerSize);
          isGroundData = new Float32Array(smallerSize);
        } catch {
          return null;
        }
      }

      // Copy data with NaN filtering
      let validPoints = 0;
      const srcPos = downsampledData.positions;
      const srcInt = downsampledData.intensities;
      const srcFrame = downsampledData.frameIndices;

      for (let i = 0; i < actualPoints; i++) {
        const x = srcPos[i * 3];
        const y = srcPos[i * 3 + 1];
        const z = srcPos[i * 3 + 2];

        // Skip NaN or Infinite values
        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
          continue;
        }

        positionsData[validPoints * 3] = x;
        positionsData[validPoints * 3 + 1] = y;
        positionsData[validPoints * 3 + 2] = z;
        intensitiesData[validPoints] = srcInt[i];
        frameIndicesData[validPoints] = srcFrame[i];
        // Use RANSAC ground mask if available
        isGroundData[validPoints] = groundMask ? groundMask[i] : 0.0;
        validPoints++;
      }

      if (validPoints < actualPoints) {
        // Filtered some invalid points - this is normal
      }

      // Create buffer attributes from the copied data (using only valid count)
      const positions = new THREE.BufferAttribute(positionsData.subarray(0, validPoints * 3), 3);
      positions.setUsage(THREE.StaticDrawUsage);

      const intensities = new THREE.BufferAttribute(intensitiesData.subarray(0, validPoints), 1);
      intensities.setUsage(THREE.StaticDrawUsage);

      const frameIndices = new THREE.BufferAttribute(frameIndicesData.subarray(0, validPoints), 1);
      frameIndices.setUsage(THREE.StaticDrawUsage);

      const isGround = new THREE.BufferAttribute(isGroundData.subarray(0, validPoints), 1);
      isGround.setUsage(THREE.StaticDrawUsage);

      geom.setAttribute('position', positions);
      geom.setAttribute('intensity', intensities);
      geom.setAttribute('frameIndex', frameIndices);
      geom.setAttribute('isGround', isGround);

      geom.setDrawRange(0, validPoints);

      // Only compute bounding box/sphere if we have valid points
      if (validPoints > 0) {
        geom.computeBoundingBox();
        // Manually set bounding sphere to avoid NaN issues
        if (geom.boundingBox) {
          geom.boundingSphere = new THREE.Sphere();
          geom.boundingBox.getBoundingSphere(geom.boundingSphere);
        }
      } else {
        // Set empty bounding box/sphere to prevent errors
        geom.boundingBox = new THREE.Box3();
        geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);
      }

      geometryRef.current = geom;
      return geom;
    } catch (error) {
      console.error('[StackedPointCloud] Failed to allocate geometry:', error);
      return null;
    }
  }, [downsampledData, groundMask]);

  // Compute height range from data
  const { minHeight, maxHeight } = useMemo(() => {
    if (!downsampledData) return { minHeight: -5, maxHeight: 10 };

    let min = Infinity;
    let max = -Infinity;

    const positions = downsampledData.positions;
    const count = downsampledData.pointCount;

    // Sample every 10th point for faster computation
    const step = Math.max(1, Math.floor(count / 10000));

    for (let i = 0; i < count; i += step) {
      const z = positions[i * 3 + 2];
      // Skip NaN/Infinity values
      if (!isFinite(z)) continue;
      if (z < min) min = z;
      if (z > max) max = z;
    }

    return {
      minHeight: min === Infinity ? -5 : min,
      maxHeight: max === -Infinity ? 10 : max
    };
  }, [downsampledData]);

  // Read clip box from global editor store
  const clipBox = useEditorStore((s) => s.lidarView.clipBox);

  // Create shader material
  const material = useMemo(() => {
    // Ground plane color - white/light gray for clear visibility
    const groundColorVec = new THREE.Vector3(0.92, 0.92, 0.90);

    const useClipBox = clipBox?.enabled ?? false;

    return new THREE.ShaderMaterial({
      vertexShader: stackedVertexShader,
      fragmentShader: stackedFragmentShader,
      uniforms: {
        pointSize: { value: pointSize * 75 },
        minHeight: { value: minHeight },
        maxHeight: { value: maxHeight },
        groundLevel: { value: minHeight }, // Use minHeight as default for height coloring
        referenceFrame: { value: data?.referenceFrameIndex ?? 0 },
        // Ground plane detection uniforms
        groundColor: { value: groundColorVec },
        showGroundPlane: { value: showGroundPlane },
        // Clip box uniforms
        useClipBox: { value: useClipBox },
        clipXMin: { value: clipBox?.xMin ?? -50 },
        clipXMax: { value: clipBox?.xMax ?? 50 },
        clipYMin: { value: clipBox?.yMin ?? -50 },
        clipYMax: { value: clipBox?.yMax ?? 50 },
        clipZMin: { value: clipBox?.zMin ?? -5 },
        clipZMax: { value: clipBox?.zMax ?? 10 },
      },
      transparent: false,
      depthTest: true,
      depthWrite: true,
    });
  }, [pointSize, minHeight, maxHeight, showGroundPlane, data?.referenceFrameIndex, clipBox]);

  // CRITICAL: Cleanup geometry and material when component unmounts or data changes
  useEffect(() => {
    return () => {
      // Dispose geometry
      if (geometryRef.current) {
        // Dispose all buffer attributes by replacing with empty arrays
        const posAttr = geometryRef.current.getAttribute('position');
        const intAttr = geometryRef.current.getAttribute('intensity');
        const frameAttr = geometryRef.current.getAttribute('frameIndex');
        const groundAttr = geometryRef.current.getAttribute('isGround');

        // Clear the array references to help GC (these are typed as writable)
        if (posAttr) {
          const arr = posAttr as THREE.BufferAttribute;
          (arr as { array: Float32Array }).array = new Float32Array(0);
        }
        if (intAttr) {
          const arr = intAttr as THREE.BufferAttribute;
          (arr as { array: Float32Array }).array = new Float32Array(0);
        }
        if (frameAttr) {
          const arr = frameAttr as THREE.BufferAttribute;
          (arr as { array: Float32Array }).array = new Float32Array(0);
        }
        if (groundAttr) {
          const arr = groundAttr as THREE.BufferAttribute;
          (arr as { array: Float32Array }).array = new Float32Array(0);
        }

        geometryRef.current.dispose();
        geometryRef.current = null;
      }

      // Dispose material (don't null the ref, just dispose)
      if (materialRef.current) {
        materialRef.current.dispose();
      }
    };
  }, [downsampledData]);

  // Update material uniforms
  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.uniforms.pointSize.value = pointSize * 200;
    }
  }, [pointSize]);

  // MEMORY OPTIMIZATION: Only enable frustum culling if we have octree
  // Otherwise just render all points (which is fine for <50k points)
  const enableFrustumCulling = !!octree && downsampledData && downsampledData.pointCount > 50000;

  // Frustum culling callback (throttled more aggressively)
  const lastCullTime = useRef(0);
  const cullInterval = 300; // ms between culling updates (increased from 200)

  const updateVisiblePoints = useCallback(() => {
    // Skip if no octree (culling disabled)
    if (!enableFrustumCulling) return;
    if (!geometryRef.current || !octree || !downsampledData) return;

    // Get visible nodes from octree
    const visible = getVisibleNodes(octree, camera, { maxPoints });

    if (visible.nodes.length === 0) return;

    // Extract geometry from visible nodes
    try {
      const extracted = extractVisibleGeometry(
        visible.nodes,
        downsampledData.positions,
        downsampledData.intensities,
        downsampledData.frameIndices,
        maxPoints
      );

      // Update geometry buffers
      const posAttr = geometryRef.current.getAttribute('position') as THREE.BufferAttribute;
      const intAttr = geometryRef.current.getAttribute('intensity') as THREE.BufferAttribute;
      const frameAttr = geometryRef.current.getAttribute('frameIndex') as THREE.BufferAttribute;

      (posAttr.array as Float32Array).set(extracted.positions);
      (intAttr.array as Float32Array).set(extracted.intensities);
      (frameAttr.array as Float32Array).set(extracted.frameIndices);

      posAttr.needsUpdate = true;
      intAttr.needsUpdate = true;
      frameAttr.needsUpdate = true;

      geometryRef.current.setDrawRange(0, extracted.pointCount);
    } catch (e) {
      console.warn('[StackedPointCloud] Frustum culling failed:', e);
    }
  }, [enableFrustumCulling, octree, camera, downsampledData, maxPoints]);

  // Run frustum culling on camera changes (less frequently)
  useFrame(() => {
    if (!enableFrustumCulling) return;

    const now = performance.now();
    if (now - lastCullTime.current > cullInterval) {
      lastCullTime.current = now;
      updateVisiblePoints();
    }
  });

  // Initial culling (only if enabled)
  useEffect(() => {
    if (enableFrustumCulling) {
      updateVisiblePoints();
    }
  }, [updateVisiblePoints]);

  // Early return if no data
  if (!geometry || !material) {
    return null;
  }

  return (
    <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false}>
      <primitive object={material} ref={materialRef} />
    </points>
  );
};

export default StackedPointCloud;

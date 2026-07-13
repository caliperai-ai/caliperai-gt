import React, { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from '@react-three/drei';
import { useQueries, useQuery } from '@tanstack/react-query';
import { v4 as uuidv4 } from 'uuid';
import { useEditorStore } from '@/store/editorStore';
import { useAnnotation4DStore } from '@/store/annotation4DStore';
import { dataApi, sceneApi, FrameCuboidData, CuboidWorldData } from '@/api/client';
import type { Frame, SceneCalibration, CuboidData } from '@/types';
import { detectGroundPlane } from '@/utils/groundPlaneDetection';
import { usePointCloudWorker } from '@/hooks/usePointCloudWorker';

import { CuboidAnnotations4D } from './CuboidAnnotations4D';
import { CuboidCreator } from './CuboidCreator';
import { CursorTracker } from './CursorTracker';


const CanvasCleanup: React.FC = () => {
  const { gl } = useThree();

  useEffect(() => {
    return () => {
      if (gl) {
        try {
          gl.dispose();
        } catch (error) {
          console.debug('WebGL context cleanup error:', error);
        }
      }
    };
  }, [gl]);

  return null;
};


import { getBoxDoubleClickedFlag4D, clearBoxDoubleClickedFlag4D, setBoxDoubleClickedFlag4D } from './doubleClickFlags';

export const setBoxDoubleClickedFlag = setBoxDoubleClickedFlag4D;

const DoubleClickResetHandler4D: React.FC = () => {
  const { gl } = useThree();

  useEffect(() => {
    const handleDoubleClick = () => {
      setTimeout(() => {
        if (getBoxDoubleClickedFlag4D()) {
          console.log('[4D] Double-click on box detected, skipping reset');
          clearBoxDoubleClickedFlag4D();
          return;
        }
        console.log('[4D] Double-click on empty space, resetting camera');
        useEditorStore.getState().resetCameraView();
      }, 10);
    };

    gl.domElement.addEventListener('dblclick', handleDoubleClick);
    return () => {
      gl.domElement.removeEventListener('dblclick', handleDoubleClick);
    };
  }, [gl]);

  return null;
};


const DEFAULT_PERSPECTIVE_4D = { position: new THREE.Vector3(0, -50, 40), target: new THREE.Vector3(0, 0, 0) };
const TOP_VIEW_HEIGHT_4D = 100;

interface CameraController4DProps {
  disabled?: boolean;
  origin?: number[];
}

const CameraController4D: React.FC<CameraController4DProps> = ({ disabled = false, origin = [0, 0, 0] }) => {
  const { camera } = useThree();
  const lidarView = useEditorStore((s) => s.lidarView);
  const focusOnAnnotation = useEditorStore((s) => s.focusOnAnnotation);
  const annotations4D = useAnnotation4DStore((s) => s.annotations4D);
  const controlsRef = useRef<any>(null);
  const lastTopViewRef = useRef<boolean>(false);
  const lastFocusedAnnotationRef = useRef<string | undefined>(undefined);
  const lastResetCounterRef = useRef<number>(0);

  useEffect(() => {
    const isTopView = lidarView.isTopView;

    if (isTopView !== lastTopViewRef.current) {
      lastTopViewRef.current = isTopView;

      if (isTopView) {
        const currentTarget = controlsRef.current?.target?.clone() || new THREE.Vector3(0, 0, 0);

        camera.position.set(currentTarget.x, currentTarget.y, TOP_VIEW_HEIGHT_4D);
        camera.up.set(0, 1, 0);
        camera.lookAt(currentTarget.x, currentTarget.y, 0);

        if (controlsRef.current) {
          controlsRef.current.target.set(currentTarget.x, currentTarget.y, 0);
          controlsRef.current.enableRotate = false;
        }
      } else {
        camera.position.copy(DEFAULT_PERSPECTIVE_4D.position);
        camera.up.set(0, 0, 1);
        camera.lookAt(DEFAULT_PERSPECTIVE_4D.target);

        if (controlsRef.current) {
          controlsRef.current.target.copy(DEFAULT_PERSPECTIVE_4D.target);
          controlsRef.current.enableRotate = true;
          controlsRef.current.update();
        }
      }
    }
  }, [lidarView.isTopView, camera]);

  useEffect(() => {
    const focusedId = lidarView.focusedAnnotationId;
    console.log('[CameraController4D] Focus effect triggered, focusedId:', focusedId, 'lastRef:', lastFocusedAnnotationRef.current);

    if (focusedId !== lastFocusedAnnotationRef.current) {
      lastFocusedAnnotationRef.current = focusedId;

      if (focusedId) {
        console.log('[CameraController4D] Looking up annotation in 4D store, id:', focusedId);
        console.log('[CameraController4D] annotations4D size:', annotations4D.size);
        const annotation4D = annotations4D.get(focusedId);
        console.log('[CameraController4D] Found annotation4D:', annotation4D ? 'yes' : 'no');
        if (annotation4D && annotation4D.type === 'cuboid') {
          const worldData = annotation4D.world_data;
          const worldCenter = worldData.center;
          const dimensions = worldData.dimensions;

          const viewCenter = {
            x: worldCenter.x - origin[0],
            y: worldCenter.y - origin[1],
            z: worldCenter.z - origin[2],
          };

          const diagonal = Math.sqrt(
            dimensions.length ** 2 + dimensions.width ** 2 + dimensions.height ** 2
          );
          const optimalDistance = Math.max(diagonal * 2.5, 8);

          const direction = new THREE.Vector3()
            .subVectors(camera.position, controlsRef.current?.target || new THREE.Vector3())
            .normalize();

          if (direction.length() < 0.1) {
            direction.set(-0.5, -0.7, 0.5).normalize();
          }

          const newTarget = new THREE.Vector3(viewCenter.x, viewCenter.y, viewCenter.z);
          const newPosition = newTarget.clone().add(direction.multiplyScalar(optimalDistance));

          camera.position.copy(newPosition);

          camera.up.set(0, 0, 1);

          if (controlsRef.current) {
            controlsRef.current.target.copy(newTarget);
            controlsRef.current.enableRotate = true;
            controlsRef.current.update();
          }

          lastTopViewRef.current = false;

          console.log('[4D Camera] Focused on annotation:', focusedId, 'at view position:', viewCenter, 'distance:', optimalDistance);
        }

        focusOnAnnotation(undefined);
      }
    }
  }, [lidarView.focusedAnnotationId]);

  useEffect(() => {
    const resetCounter = lidarView.cameraResetCounter;

    if (resetCounter > lastResetCounterRef.current) {
      lastResetCounterRef.current = resetCounter;

      camera.position.copy(DEFAULT_PERSPECTIVE_4D.position);
      camera.up.set(0, 0, 1);
      camera.lookAt(DEFAULT_PERSPECTIVE_4D.target);

      if (controlsRef.current) {
        controlsRef.current.target.copy(DEFAULT_PERSPECTIVE_4D.target);
        controlsRef.current.enableRotate = true;
        controlsRef.current.update();
      }

      lastTopViewRef.current = false;
    }
  }, [lidarView.cameraResetCounter, camera]);

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.1}
      rotateSpeed={0.5}
      panSpeed={0.8}
      zoomSpeed={1.2}
      target={[0, 0, 0]}
      enabled={!disabled}
    />
  );
};


const getResolutionScale = (): number => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  const referencePixels = 1920 * 1080;
  const currentPixels = width * height;

  const resolutionRatio = Math.sqrt(currentPixels / referencePixels);

  const dprFactor = 1 / Math.sqrt(dpr);

  return Math.max(0.5, Math.min(1.5, resolutionRatio * dprFactor));
};


interface LidarCanvas4DProps {
  scanCount?: number;
  className?: string;
  onStackedDataReady?: (data: { positions: Float32Array; pointCount: number; origin?: [number, number, number] } | null) => void;
  onScanCountChange?: (count: number) => void;
}

interface EgoPose {
  position: number[];
  rotation: number[];
}


function quaternionToRotationMatrix(q: number[]): number[][] {
  const [w, x, y, z] = q;
  const len = Math.sqrt(w*w + x*x + y*y + z*z);
  if (len < 1e-6) return [[1,0,0], [0,1,0], [0,0,1]];

  const nw = w/len, nx = x/len, ny = y/len, nz = z/len;

  return [
    [1 - 2*(ny*ny + nz*nz), 2*(nx*ny - nw*nz), 2*(nx*nz + nw*ny)],
    [2*(nx*ny + nw*nz), 1 - 2*(nx*nx + nz*nz), 2*(ny*nz - nw*nx)],
    [2*(nx*nz - nw*ny), 2*(ny*nz + nw*nx), 1 - 2*(nx*nx + ny*ny)],
  ];
}

function transformToWorld(
  x: number, y: number, z: number,
  egoPose: EgoPose,
  lidarToEgo?: { rotation: number[][], translation: number[] }
): [number, number, number] {
  let ex = x, ey = y, ez = z;
  if (lidarToEgo) {
    const R = lidarToEgo.rotation;
    const T = lidarToEgo.translation;
    ex = R[0][0]*x + R[0][1]*y + R[0][2]*z + T[0];
    ey = R[1][0]*x + R[1][1]*y + R[1][2]*z + T[1];
    ez = R[2][0]*x + R[2][1]*y + R[2][2]*z + T[2];
  }

  const R_ego = quaternionToRotationMatrix(egoPose.rotation);
  const T_ego = egoPose.position;

  const wx = R_ego[0][0]*ex + R_ego[0][1]*ey + R_ego[0][2]*ez + T_ego[0];
  const wy = R_ego[1][0]*ex + R_ego[1][1]*ey + R_ego[1][2]*ez + T_ego[1];
  const wz = R_ego[2][0]*ex + R_ego[2][1]*ey + R_ego[2][2]*ez + T_ego[2];

  return [wx, wy, wz];
}

function getLidarToEgoTransform(egoToLidar: SceneCalibration['ego_to_lidar']): { rotation: number[][], translation: number[] } | undefined {
  if (!egoToLidar) return undefined;

  const R = egoToLidar.rotation;
  const T = egoToLidar.translation;

  const R_inv = [
    [R[0][0], R[1][0], R[2][0]],
    [R[0][1], R[1][1], R[2][1]],
    [R[0][2], R[1][2], R[2][2]],
  ];

  const T_inv = [
    -(R_inv[0][0]*T[0] + R_inv[0][1]*T[1] + R_inv[0][2]*T[2]),
    -(R_inv[1][0]*T[0] + R_inv[1][1]*T[1] + R_inv[1][2]*T[2]),
    -(R_inv[2][0]*T[0] + R_inv[2][1]*T[1] + R_inv[2][2]*T[2]),
  ];

  return { rotation: R_inv, translation: T_inv };
}


interface SimplePointCloudProps {
  positions: Float32Array;
  pointSize: number;
  showGroundPlane?: boolean;
  distanceThreshold?: number;
  samplePercent?: number;
}

function SimplePointCloud({
  positions,
  pointSize,
  showGroundPlane = true,
  distanceThreshold = 0.15,
  samplePercent = 30,
}: SimplePointCloudProps) {
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);

  const groundMaskCacheRef = useRef<{
    cacheKey: string;
    mask: Float32Array | null;
  } | null>(null);

  const groundMask = useMemo(() => {
    if (!showGroundPlane) return null;
    const pointCount = positions.length / 3;
    if (pointCount === 0) return null;

    const cacheKey = `${pointCount}-${distanceThreshold}-${samplePercent}`;
    if (groundMaskCacheRef.current?.cacheKey === cacheKey) {
      return groundMaskCacheRef.current.mask;
    }

    // RANSAC ground detection (logging removed for performance)
    const result = detectGroundPlane(positions, {
      distanceThreshold,
      sampleFromLowestPercent: samplePercent,
    });
    const mask = result?.groundMask ?? null;

    // Cache the result
    groundMaskCacheRef.current = { cacheKey, mask };

    return mask;
  }, [positions, showGroundPlane, distanceThreshold, samplePercent]);

  const geometry = useMemo(() => {
    // MEMORY OPTIMIZATION: Dispose old geometry before creating new one
    if (geometryRef.current) {
      geometryRef.current.dispose();
      geometryRef.current = null;
    }

    const geom = new THREE.BufferGeometry();
    const pointCount = positions.length / 3;

    // Safety check to prevent huge allocations (capped at 200k points)
    const safePointCount = Math.min(pointCount, 200000);

    // Set positions (use subarray if we capped the count)
    const posToUse = safePointCount < pointCount
      ? positions.subarray(0, safePointCount * 3)
      : positions;
    geom.setAttribute('position', new THREE.BufferAttribute(posToUse, 3));

    // Enhanced height-based colors with better object discrimination
    // MEMORY OPTIMIZATION: Create colors array only once
    let colors: Float32Array;
    try {
      colors = new Float32Array(safePointCount * 3);
    } catch {
      console.error('[SimplePointCloud] Failed to allocate colors array');
      return geom; // Return geometry without colors
    }

    // Helper function for color interpolation
    const mixColor = (c1: number[], c2: number[], t: number): number[] => {
      return [
        c1[0] * (1 - t) + c2[0] * t,
        c1[1] * (1 - t) + c2[1] * t,
        c1[2] * (1 - t) + c2[2] * t,
      ];
    };

    // Ground plane detection settings
    const groundPlaneColor = [0.92, 0.92, 0.90]; // White/light gray for ground

    // Calculate the ground level from RANSAC detection for height coloring
    // Use the average Z of ground points, or a default if no ground mask
    let groundLevelZ = -1.8; // default
    if (groundMask) {
      let sumZ = 0, groundCount = 0;
      for (let i = 0; i < safePointCount; i++) {
        if (groundMask[i] > 0.5) {
          sumZ += posToUse[i * 3 + 2];
          groundCount++;
        }
      }
      if (groundCount > 0) {
        groundLevelZ = sumZ / groundCount;
      }
    }

    for (let i = 0; i < safePointCount; i++) {
      const z = posToUse[i * 3 + 2];
      const normalizedHeight = z - groundLevelZ;
      let color: number[];

      // Check if this point is on the ground plane (from RANSAC)
      if (showGroundPlane && groundMask && groundMask[i] > 0.5) {
        // Ground plane - white/light gray for clear visibility
        color = groundPlaneColor;
      } else if (normalizedHeight < -0.2) {
        // Below ground - deep purple/blue
        const t = Math.max(0, Math.min(1, (normalizedHeight + 2.0) / 1.8));
        color = mixColor([0.05, 0.0, 0.15], [0.2, 0.15, 0.4], t);
      } else if (normalizedHeight < 0.8) {
        // Low objects - bright cyan/aqua
        const t = Math.max(0, normalizedHeight / 0.8);
        color = mixColor([0.0, 0.8, 0.9], [0.0, 0.95, 0.85], t);
      } else if (normalizedHeight < 1.8) {
        // Person/Car height - vibrant green
        const t = (normalizedHeight - 0.8) / 1.0;
        color = mixColor([0.2, 0.95, 0.3], [0.1, 0.85, 0.5], t);
      } else if (normalizedHeight < 3.5) {
        // Tall vehicles/signs - golden yellow to orange
        const t = (normalizedHeight - 1.8) / 1.7;
        color = mixColor([0.95, 0.85, 0.1], [1.0, 0.6, 0.0], t);
      } else {
        // Very tall structures - red to magenta
        const t = Math.max(0, Math.min(1, (normalizedHeight - 3.5) / 4.5));
        color = mixColor([1.0, 0.2, 0.0], [0.9, 0.0, 0.5], t);
      }

      colors[i * 3] = color[0];
      colors[i * 3 + 1] = color[1];
      colors[i * 3 + 2] = color[2];
    }

    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Compute bounding sphere
    geom.computeBoundingBox();
    if (geom.boundingBox) {
      const center = new THREE.Vector3();
      geom.boundingBox.getCenter(center);
      const radius = geom.boundingBox.getSize(new THREE.Vector3()).length() / 2;
      geom.boundingSphere = new THREE.Sphere(center, radius);
    }

    geometryRef.current = geom;
    return geom;
  }, [positions, groundMask, showGroundPlane]);

  // MEMORY OPTIMIZATION: Cleanup geometry on unmount
  useEffect(() => {
    return () => {
      if (geometryRef.current) {
        geometryRef.current.dispose();
        geometryRef.current = null;
      }
    };
  }, []);

  // Disable raycasting on points so it doesn't block interaction with other elements
  const noopRaycast = useCallback(() => {}, []);

  return (
    <points geometry={geometry} raycast={noopRaycast}>
      <pointsMaterial
        vertexColors
        size={pointSize * 9.375}  // Scale up point size for better visibility
        sizeAttenuation
        transparent
        opacity={0.9}
      />
    </points>
  );
}

// =============================================================================
// GROUND GRID HELPER
// =============================================================================

function GroundGrid() {
  return (
    <gridHelper
      args={[200, 100, '#404040', '#282828']}
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, 0, -2]}
    />
  );
}

// =============================================================================
// MAIN 4D CANVAS COMPONENT
// =============================================================================

export const LidarCanvas4DNew: React.FC<LidarCanvas4DProps> = ({
  scanCount: initialScanCount = 5,
  className = '',
  onStackedDataReady,
  onScanCountChange,
}) => {
  const {
    currentFrame,
    frames,
    scene,
    lidarView,
    activeTool,
    activeClassId,
    task,
  } = useEditorStore();

  // Get 4D annotation creation function
  const createAnnotation4D = useAnnotation4DStore((s) => s.createAnnotation4D);

  // Track Shift key for freezing camera
  const [shiftPressed, setShiftPressed] = useState(false);

  // Resolution-based scaling for point size
  const [resolutionScale, setResolutionScale] = useState(getResolutionScale);

  // Update resolution scale on window resize
  useEffect(() => {
    const handleResize = () => {
      setResolutionScale(getResolutionScale());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Local state for scan count slider
  const [scanCount, setScanCount] = useState(initialScanCount);
  const [debouncedScanCount, setDebouncedScanCount] = useState(initialScanCount);
  const [voxelSize, setVoxelSize] = useState(0.15);
  const [maxPoints, setMaxPoints] = useState(200000);
  const [showSettings, setShowSettings] = useState(false);
  const [useWebWorker, setUseWebWorker] = useState(true);  // Web Worker toggle

  // Web Worker for point cloud stacking
  const {
    stackedData: workerStackedData,
    isProcessing: workerProcessing,
    processScans
  } = usePointCloudWorker({
    voxelSize,
    maxPoints,
    enabled: useWebWorker,
  });

  // Debounce timer ref
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Debounce scan count changes - only update after 500ms of no changes
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedScanCount(scanCount);
    }, 500);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [scanCount]);

  // Shift key handling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftPressed(true);
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftPressed(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Calculate which frames to fetch (uses debounced scan count)
  // Must be declared before handleCuboidComplete which uses it
  const framesToFetch = useMemo((): Frame[] => {
    if (!currentFrame || !frames.length) {
      return [];
    }

    const currentIdx = currentFrame.frame_index;
    const result: Frame[] = [];

    // Get frames starting from current frame
    for (let i = 0; i < debouncedScanCount; i++) {
      const frameIdx = currentIdx + i;
      const frame = frames.find(f => f.frame_index === frameIdx);
      if (frame) result.push(frame);
    }

    return result;
  }, [currentFrame, frames, debouncedScanCount]);

  // Handle scan count change
  const handleScanCountChange = useCallback((count: number) => {
    setScanCount(count);
    onScanCountChange?.(count);
  }, [onScanCountChange]);

  // Build LiDAR paths
  const lidarPaths = useMemo((): string[] => {
    if (!scene?.storage_paths?.lidar_base) {
      return [];
    }

    const base = scene.storage_paths.lidar_base.replace(/\/$/, '');
    const paths = framesToFetch
      .filter(f => f.file_paths?.lidar)
      .map(f => `${base}/${f.file_paths.lidar}`);

    return paths;
  }, [scene?.storage_paths?.lidar_base, framesToFetch]);

  // Fetch calibration
  const calibrationQuery = useQuery({
    queryKey: ['calibration', scene?.id],
    queryFn: async () => {
      if (!scene?.id) return null;
      try {
        return await sceneApi.getCalibration(scene.id) as SceneCalibration;
      } catch {
        console.warn('[4D] No calibration found');
        return null;
      }
    },
    enabled: !!scene?.id,
    staleTime: Infinity,
  });

  // Fetch all LiDAR scans with aggressive cache cleanup
  const lidarQueries = useQueries({
    queries: lidarPaths.map((path, index) => ({
      queryKey: ['lidar-4d', path],
      queryFn: async () => {
        const response = await dataApi.getLidarData(path);
        return {
          positions: response.positions,
          intensities: response.intensities,
          pointCount: response.pointCount,
          frame: framesToFetch[index],
        };
      },
      enabled: !!path && framesToFetch.length > index,
      staleTime: 30 * 1000,  // Reduced from 5min to 30sec
      gcTime: 60 * 1000,     // Garbage collect after 1 minute of inactivity
    })),
  });

  const isLoading = lidarQueries.some(q => q.isLoading) || workerProcessing;
  const loadedCount = lidarQueries.filter(q => q.isSuccess).length;

  // Trigger Web Worker processing when scans are loaded
  useEffect(() => {
    if (!useWebWorker) return;

    const successfulScans = lidarQueries
      .filter(q => q.isSuccess && q.data)
      .map(q => q.data!);

    if (successfulScans.length === 0) return;

    // Prepare scan data for worker
    const scanData = successfulScans.map(scan => ({
      positions: scan.positions,
      intensities: scan.intensities,
      pointCount: scan.pointCount,
      egoPose: scan.frame.ego_pose ? {
        position: scan.frame.ego_pose.position,
        rotation: scan.frame.ego_pose.rotation,
      } : null,
    }));

    // Get calibration
    const calibration = calibrationQuery.data?.ego_to_lidar || null;

    // Send to worker
    processScans(scanData, calibration);
  }, [lidarQueries, calibrationQuery.data, useWebWorker, processScans]);

  // Stack all scans into world coordinates (fallback when worker is disabled)
  // MEMORY OPTIMIZATION: Use strict point limits

  const fallbackStackedData = useMemo(() => {
    // Skip computation if using Web Worker
    if (useWebWorker) return null;

    const successfulScans = lidarQueries
      .filter(q => q.isSuccess && q.data)
      .map(q => q.data!);

    if (successfulScans.length === 0) {
      return null;
    }

    // MEMORY CAP: Strict limit on maximum points (reduced from 500k)
    const safeMaxPoints = Math.min(Math.max(maxPoints, 10000), 150000);

    // Get calibration transform
    const lidarToEgo = getLidarToEgoTransform(calibrationQuery.data?.ego_to_lidar);

    // Use first frame's ego position as origin for centering the view
    // IMPORTANT: This origin is subtracted from world coordinates for visualization
    // When creating annotations, we must add this back to get true world coordinates
    const originFrame = successfulScans[0].frame;
    const origin: [number, number, number] = [
      originFrame.ego_pose?.position?.[0] || 0,
      originFrame.ego_pose?.position?.[1] || 0,
      originFrame.ego_pose?.position?.[2] || 0,
    ];

    // PRE-ALLOCATE fixed size buffers to avoid memory issues
    let outputPositions: Float32Array;
    let outputIntensities: Float32Array;

    try {
      outputPositions = new Float32Array(safeMaxPoints * 3);
      outputIntensities = new Float32Array(safeMaxPoints);
    } catch {
      try {
        outputPositions = new Float32Array(50000 * 3);
        outputIntensities = new Float32Array(50000);
      } catch {
        return null;
      }
    }

    const actualMaxPoints = outputPositions.length / 3;
    let writeIdx = 0;

    // Use voxel grid to avoid duplicates (numeric hash for performance)
    const HASH_PRIME1 = 73856093;
    const HASH_PRIME2 = 19349663;
    const HASH_PRIME3 = 83492791;
    const voxelMap = new Map<number, boolean>();

    // Calculate skip factor to sample evenly across all scans
    const totalInputPoints = successfulScans.reduce((sum, s) => sum + s.pointCount, 0);
    const skipFactor = Math.max(1, Math.floor(totalInputPoints / actualMaxPoints));

    let pointIndex = 0;

    for (const scan of successfulScans) {
      const egoPose = scan.frame.ego_pose;
      const hasValidPose = egoPose && egoPose.position && egoPose.rotation;

      for (let i = 0; i < scan.pointCount; i++) {
        // Skip points to sample evenly
        pointIndex++;
        if (pointIndex % skipFactor !== 0) continue;

        // Stop if buffer is full
        if (writeIdx >= actualMaxPoints) break;

        const x = scan.positions[i * 3];
        const y = scan.positions[i * 3 + 1];
        const z = scan.positions[i * 3 + 2];

        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;

        let wx: number, wy: number, wz: number;

        if (hasValidPose) {
          [wx, wy, wz] = transformToWorld(x, y, z, egoPose!, lidarToEgo);
        } else {
          wx = x; wy = y; wz = z;
        }

        if (!isFinite(wx) || !isFinite(wy) || !isFinite(wz)) continue;

        // Center at origin
        wx -= origin[0];
        wy -= origin[1];
        wz -= origin[2];

        // Voxel deduplication with numeric hash (faster than string keys)
        const vx = (wx / voxelSize) | 0;
        const vy = (wy / voxelSize) | 0;
        const vz = (wz / voxelSize) | 0;
        const hash = ((vx * HASH_PRIME1) ^ (vy * HASH_PRIME2) ^ (vz * HASH_PRIME3)) | 0;

        if (voxelMap.has(hash)) continue;
        voxelMap.set(hash, true);

        // Write to pre-allocated buffer
        const idx = writeIdx * 3;
        outputPositions[idx] = wx;
        outputPositions[idx + 1] = wy;
        outputPositions[idx + 2] = wz;
        outputIntensities[writeIdx] = scan.intensities[i];
        writeIdx++;
      }

      if (writeIdx >= actualMaxPoints) break;
    }

    // Return trimmed views (no copy, just view into existing buffer)
    // Include origin for annotation coordinate transforms
    return {
      positions: outputPositions.subarray(0, writeIdx * 3),
      intensities: outputIntensities.subarray(0, writeIdx),
      pointCount: writeIdx,
      origin,  // World origin used for centering - needed for annotations
    };
  }, [lidarQueries, calibrationQuery.data, voxelSize, maxPoints, useWebWorker]);

  // Use worker result when available, otherwise fallback
  const stackedData = useWebWorker ? workerStackedData : fallbackStackedData;

  // Handle cuboid creation - create in 4D annotation store
  // MUST be defined after stackedData to avoid "Cannot access before initialization" error
  const handleCuboidComplete = useCallback((cuboidData: CuboidData, _isTrackMode: boolean = false, classIdOverride?: string) => {
    const effectiveClassId = classIdOverride || activeClassId;
    if (!effectiveClassId) {
      console.warn('[4D] No active class selected');
      return;
    }

    if (!task) {
      console.warn('[4D] No task loaded');
      return;
    }

    // Get the frame IDs for all stacked frames
    const frameIds = framesToFetch.map(f => f.id);

    // Get the origin offset used for visualization centering
    // The cuboid was drawn in view coordinates (centered at origin)
    // We need to convert to true world coordinates by adding the origin offset
    const origin = stackedData?.origin || [0, 0, 0];

    console.log('[4D handleCuboidComplete] Creating annotation with:', {
      viewCenter: cuboidData.center,
      origin,
      stackedDataAvailable: !!stackedData,
    });

    // Convert view coordinates to true world coordinates
    const worldCenter = {
      x: cuboidData.center.x + origin[0],
      y: cuboidData.center.y + origin[1],
      z: cuboidData.center.z + origin[2],
    };

    console.log('[4D handleCuboidComplete] Computed worldCenter:', worldCenter);

    // Create frame_data with the position/rotation for each frame
    // FrameCuboidData only has center, rotation, is_keyframe (dimensions are in world_data)
    // Note: frame_data stores per-frame LiDAR coordinates, but for static objects
    // we'll compute these on migration. For now, store the world center.
    const frameData: Record<string, FrameCuboidData> = {};
    frameIds.forEach((fid, index) => {
      frameData[fid] = {
        center: worldCenter,  // True world coordinates
        rotation: cuboidData.rotation,
        is_keyframe: index === 0,  // First frame is keyframe
      };
    });

    // Create world_data in the correct format with TRUE world coordinates
    const worldData: CuboidWorldData = {
      center: worldCenter,  // True world coordinates (not view-relative)
      dimensions: cuboidData.dimensions,
      rotation: cuboidData.rotation,
      origin_frame_id: frameIds[0],  // First frame is origin
    };

    const annotation = createAnnotation4D({
      task_id: task.id,
      track_id: uuidv4(),  // Generate unique track ID for this 4D annotation
      class_id: effectiveClassId,
      world_data: worldData,
      frame_data: frameData,
      frame_ids: frameIds,
    });

    // Select the newly created annotation
    if (annotation) {
      useEditorStore.getState().selectAnnotation(annotation.id);
    }
  }, [activeClassId, task, framesToFetch, createAnnotation4D, stackedData]);

  // Notify parent
  useEffect(() => {
    if (onStackedDataReady) {
      onStackedDataReady(stackedData ? {
        positions: stackedData.positions,
        pointCount: stackedData.pointCount,
        origin: stackedData.origin,  // Include origin for coordinate transforms
      } : null);
    }
  }, [stackedData, onStackedDataReady]);

  return (
    <div className={`relative w-full h-full bg-[#0d1117] ${className}`}>
      {/* Stats Overlay - Bottom Left */}
      <div className="absolute bottom-4 left-4 z-20 bg-dark-panel/90 backdrop-blur-sm px-4 py-2 rounded-lg border border-purple-500/30">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
            <span className="text-purple-400 font-medium">4D Mode</span>
          </div>
          <div className="text-gray-400">
            Scans: <span className="text-white font-mono">{loadedCount}/{scanCount}</span>
          </div>
          <div className="text-gray-400">
            Points: <span className="text-white font-mono">{stackedData ? (stackedData.pointCount / 1000).toFixed(1) + 'k' : '0'}</span>
          </div>
        </div>
      </div>

      {/* Scan Count Slider */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-dark-panel/90 backdrop-blur-sm px-4 py-2 rounded-lg border border-gray-700/50">
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-gray-400">Scans:</span>
          <input
            type="range"
            min="1"
            max="20"
            value={scanCount}
            onChange={(e) => handleScanCountChange(Number(e.target.value))}
            className="w-32 h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
          />
          <span className="text-white font-mono text-sm w-6">{scanCount}</span>
        </div>
      </div>

      {/* Performance Settings */}
      <div className="absolute bottom-4 right-4 z-20">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="bg-dark-panel/90 backdrop-blur-sm px-3 py-2 rounded-lg border border-gray-700/50 text-gray-400 hover:text-white"
          title="Settings"
        >
          ⚙️
        </button>

        {showSettings && (
          <div className="absolute bottom-10 right-0 bg-dark-panel/95 px-4 py-3 rounded-lg border border-gray-700/50 min-w-[250px] max-h-[400px] overflow-y-auto">
            {/* Performance Section - FIRST for visibility */}
            <div className="text-[11px] text-gray-400 mb-3 font-medium">⚡ Performance</div>

            <div className="mb-3">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={useWebWorker}
                  onChange={(e) => setUseWebWorker(e.target.checked)}
                  className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
                />
                <span className="text-[10px] text-gray-300">Web Worker (non-blocking UI)</span>
              </label>
              <p className="text-[9px] text-gray-500 ml-5 mt-0.5">Process point clouds in background thread</p>
            </div>

            <div className="mb-3">
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-gray-400">Voxel Size</span>
                <span className="text-white font-mono">{(voxelSize * 100).toFixed(0)}cm</span>
              </div>
              <input
                type="range"
                min="5"
                max="50"
                value={voxelSize * 100}
                onChange={(e) => setVoxelSize(Number(e.target.value) / 100)}
                className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
              <p className="text-[9px] text-gray-500 mt-0.5">Larger = fewer points, faster</p>
            </div>

            <div className="mb-3">
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-gray-400">Max Points</span>
                <span className="text-white font-mono">{(maxPoints / 1000).toFixed(0)}k</span>
              </div>
              <input
                type="range"
                min="50000"
                max="500000"
                step="50000"
                value={maxPoints}
                onChange={(e) => setMaxPoints(Number(e.target.value))}
                className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
            </div>

            <div className="mb-3">
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-gray-400">Point Size</span>
                <span className="text-white font-mono">{(lidarView.pointSize * 100).toFixed(1)}</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="5"
                step="0.1"
                value={lidarView.pointSize * 100}
                onChange={(e) => {
                  const { setLidarView } = useEditorStore.getState();
                  setLidarView({ pointSize: Number(e.target.value) / 100 });
                }}
                className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
              <div className="flex justify-between text-[9px] text-gray-500 mt-0.5">
                <span>Small</span>
                <span>Large</span>
              </div>
            </div>

            <div className="border-t border-gray-700/50 pt-3 mt-3">
              {/* Ground Plane Settings */}
              <div className="text-[11px] text-gray-400 mb-3 font-medium">🏔️ Ground Plane Detection</div>

              <div className="mb-3">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={lidarView.groundPlane?.enabled ?? false}
                    onChange={(e) => {
                      const { lidarView, setLidarView } = useEditorStore.getState();
                      setLidarView({
                        groundPlane: {
                          ...lidarView.groundPlane,
                          enabled: e.target.checked,
                        },
                      });
                    }}
                    className="w-3.5 h-3.5 rounded border-gray-600 bg-gray-700 text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
                  />
                  <span className="text-[10px] text-gray-300">Enable RANSAC detection</span>
                </label>
                <p className="text-[9px] text-gray-500 ml-5 mt-0.5">⚠️ Slow - disable for faster loading</p>
              </div>

              {(lidarView.groundPlane?.enabled ?? false) && (
                <>
                  <div className="mb-3">
                    <div className="flex justify-between text-[10px] mb-1">
                      <span className="text-gray-400">Distance Threshold</span>
                      <span className="text-white font-mono">{((lidarView.groundPlane?.distanceThreshold ?? 0.15) * 100).toFixed(0)}cm</span>
                    </div>
                    <input
                      type="range"
                      min="5"
                      max="50"
                      step="5"
                      value={(lidarView.groundPlane?.distanceThreshold ?? 0.15) * 100}
                      onChange={(e) => {
                        const { lidarView, setLidarView } = useEditorStore.getState();
                        setLidarView({
                          groundPlane: {
                            ...lidarView.groundPlane,
                            distanceThreshold: Number(e.target.value) / 100,
                          },
                        });
                      }}
                      className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                    />
                    <div className="flex justify-between text-[9px] text-gray-500 mt-0.5">
                      <span>5cm</span>
                      <span>50cm</span>
                    </div>
                  </div>

                  <div className="mb-3">
                  <div className="flex justify-between text-[10px] mb-1">
                    <span className="text-gray-400">Sample Lowest %</span>
                    <span className="text-white font-mono">{lidarView.groundPlane?.samplePercent ?? 30}%</span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="60"
                    step="5"
                    value={lidarView.groundPlane?.samplePercent ?? 30}
                    onChange={(e) => {
                      const { lidarView, setLidarView } = useEditorStore.getState();
                      setLidarView({
                        groundPlane: {
                          ...lidarView.groundPlane,
                          samplePercent: Number(e.target.value),
                        },
                      });
                    }}
                    className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                  />
                  <div className="flex justify-between text-[9px] text-gray-500 mt-0.5">
                    <span>10%</span>
                    <span>60%</span>
                  </div>
                </div>
              </>
            )}
            </div>
          </div>
        )}
      </div>

      {/* Error State - positioned below the Top View toggle button */}
      {!isLoading && !stackedData && lidarPaths.length > 0 && (
        <div className="absolute top-28 left-4 z-20 bg-red-900/80 px-3 py-1.5 rounded-lg text-sm text-red-200">
          No point cloud data. Check console for errors.
        </div>
      )}

      {/* 3D Canvas */}
      <Canvas
        camera={{ position: [0, -50, 40], fov: 50, near: 0.1, far: 1000 }}
        gl={{ antialias: true, alpha: false, powerPreference: 'high-performance', failIfMajorPerformanceCaveat: false }}
        frameloop="demand"
      >
        <CanvasCleanup />
        <DoubleClickResetHandler4D />
        <color attach="background" args={['#0d1117']} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 10]} intensity={0.6} />

        <CameraController4D disabled={shiftPressed} origin={stackedData?.origin} />

        {(lidarView.showGrid ?? true) && <GroundGrid />}

        {stackedData && stackedData.pointCount > 0 && (
          <SimplePointCloud
            positions={stackedData.positions}
            pointSize={(lidarView.pointSize || 0.05) * resolutionScale}
            showGroundPlane={lidarView.groundPlane?.enabled ?? false}
            distanceThreshold={lidarView.groundPlane?.distanceThreshold ?? 0.15}
            samplePercent={lidarView.groundPlane?.samplePercent ?? 30}
          />
        )}

        {/* Cuboid Annotations */}
        <CuboidAnnotations4D
          stackedFrames={framesToFetch}
          originPosition={stackedData?.origin}
        />

        {/* Cuboid Creation Tool */}
        {(activeTool === 'cuboid' || activeTool === 'track') && (
          <CuboidCreator onComplete={handleCuboidComplete} />
        )}

        {/* Cursor Tracker */}
        <CursorTracker />
      </Canvas>
    </div>
  );
};

export default LidarCanvas4DNew;

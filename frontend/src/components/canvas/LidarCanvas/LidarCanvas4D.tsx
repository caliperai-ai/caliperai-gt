import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useEditorStore } from '@/store/editorStore';
import { dataApi, sceneApi } from '@/api/client';
import type { CuboidData, Frame, SceneCalibration } from '@/types';
import { stackPointClouds, ScanData, EgoToLidarCalibration } from '@/utils/egoTransform';

import { StackedPointCloud } from './StackedPointCloud';
import { CuboidAnnotations } from './CuboidAnnotations';
import { CuboidCreator } from './CuboidCreator';
import { CameraController } from './CameraController';
import { GroundGrid, AxesIndicator } from './SceneHelpers';
import { CursorTracker } from './CursorTracker';


interface LidarCanvas4DProps {
  scanCount?: number;
  className?: string;
  onStackedDataReady?: (data: { positions: Float32Array; pointCount: number } | null) => void;
}



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

export const LidarCanvas4D: React.FC<LidarCanvas4DProps> = ({
  scanCount = 5,
  className = '',
  onStackedDataReady,
}) => {
  const {
    activeClassId,
    createAnnotation,
    lidarView,
    selection,
    currentFrame,
    frames,
    scene,
    activeTool,
  } = useEditorStore();

  const hasSelection = selection.selectedAnnotationIds.length > 0;

  const [shiftPressed, setShiftPressed] = useState(false);

  const [resolutionScale, setResolutionScale] = useState(getResolutionScale);

  useEffect(() => {
    const handleResize = () => {
      setResolutionScale(getResolutionScale());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [showSettings, setShowSettings] = useState(false);
  const [maxPoints, setMaxPoints] = useState(300000);
  const [voxelSize, setVoxelSize] = useState(0.15);

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

  const frameIndices = useMemo(() => {
    if (!currentFrame || !frames.length) {
      console.warn('[LidarCanvas4D] No currentFrame or frames, returning empty indices');
      return [];
    }

    const currentIndex = currentFrame.frame_index;
    const halfWindow = Math.floor(scanCount / 2);
    const indices: number[] = [];

    for (let i = -halfWindow; i <= halfWindow; i++) {
      const frameIdx = currentIndex + i;
      const frame = frames.find(f => f.frame_index === frameIdx);
      if (frame) {
        indices.push(frameIdx);
      }
    }

    return indices;
  }, [currentFrame, frames, scanCount]);

  const framesToFetch = useMemo(() => {
    return frameIndices.map(idx => frames.find(f => f.frame_index === idx)).filter(Boolean) as Frame[];
  }, [frameIndices, frames]);

  const lidarPaths = useMemo(() => {
    if (!scene?.storage_paths?.lidar_base) {
      console.warn('[LidarCanvas4D] No lidar_base in storage_paths');
      return [];
    }

    const base = scene.storage_paths.lidar_base.replace(/\/$/, '');
    const paths = framesToFetch.map(frame => {
      if (!frame.file_paths?.lidar) {
        console.warn('[LidarCanvas4D] Frame missing lidar file_paths:', frame.frame_index);
        return null;
      }
      return `${base}/${frame.file_paths.lidar}`;
    }).filter(Boolean) as string[];
    return paths;
  }, [scene?.storage_paths?.lidar_base, framesToFetch]);

  // MEMORY SAFETY: Limit queries to prevent browser memory exhaustion
  const safeFramesToFetch = useMemo(() => framesToFetch.slice(0, 5), [framesToFetch]); // Max 5 scans for safety
  const safeLidarPaths = useMemo(() => lidarPaths.slice(0, 5), [lidarPaths]);

  // Fetch all LiDAR scans in parallel
  const lidarQueries = useQueries({
    queries: safeLidarPaths.map((path, index) => ({
      queryKey: ['lidar', path],
      queryFn: async () => {
        const response = await dataApi.getLidarData(path);
        const egoPose = safeFramesToFetch[index].ego_pose;

        // Validate ego pose
        if (!egoPose || !egoPose.position || !egoPose.rotation) {
          console.warn(`[LidarCanvas4D] Frame ${index} has invalid ego pose:`, egoPose);
        }

        return {
          ...response,
          frameIndex: safeFramesToFetch[index].frame_index,
          egoPose: egoPose || { position: [0, 0, 0], rotation: [1, 0, 0, 0] },
        };
      },
      enabled: !!path,
      staleTime: 5 * 60 * 1000,
    })),
  });

  // Fetch scene calibration for LiDAR to Ego transform
  const calibrationQuery = useQuery({
    queryKey: ['calibration', scene?.id],
    queryFn: async () => {
      if (!scene?.id) return null;
      try {
        const calibration = await sceneApi.getCalibration(scene.id);
        return calibration as SceneCalibration;
      } catch (error) {
        console.warn('[LidarCanvas4D] No calibration found, using identity transform');
        return null;
      }
    },
    enabled: !!scene?.id,
    staleTime: Infinity, // Calibration doesn't change
  });

  // Extract ego_to_lidar calibration
  const egoToLidar = useMemo((): EgoToLidarCalibration | undefined => {
    const calib = calibrationQuery.data;
    if (!calib?.ego_to_lidar) return undefined;
    return {
      rotation: calib.ego_to_lidar.rotation,
      translation: calib.ego_to_lidar.translation,
    };
  }, [calibrationQuery.data]);

  // Check loading state
  const isLoading = lidarQueries.some(q => q.isLoading);
  const loadedCount = lidarQueries.filter(q => q.isSuccess).length;

  // Stack all loaded scans
  const stackedData = useMemo(() => {
    const successfulScans = lidarQueries
      .filter(q => q.isSuccess && q.data)
      .map(q => q.data!);

    if (successfulScans.length === 0) {
      return null;
    }

    // Convert to ScanData format
    const scanDataArray: ScanData[] = successfulScans.map(scan => {
      // Create default ego pose if missing
      const defaultEgoPose = { position: [0, 0, 0], rotation: [1, 0, 0, 0] };
      const egoPose = scan.egoPose || defaultEgoPose;

      // Validate and fix ego pose
      const validPosition = egoPose.position && egoPose.position.length === 3
        ? egoPose.position
        : [0, 0, 0];
      const validRotation = egoPose.rotation && egoPose.rotation.length === 4
        ? egoPose.rotation
        : [1, 0, 0, 0];

      return {
        positions: new Float32Array(scan.positions),
        intensities: new Float32Array(scan.intensities),
        pointCount: scan.pointCount,
        frameIndex: scan.frameIndex,
        egoPose: {
          position: validPosition,
          rotation: validRotation
        },
      };
    });

    // Sort by frame index
    scanDataArray.sort((a, b) => a.frameIndex - b.frameIndex);

    if (scanDataArray.length === 0) {
      console.error('[LidarCanvas4D] No valid scans to stack after filtering!');
      return null;
    }

    // Find reference index (middle scan)
    const referenceIndex = Math.floor(scanDataArray.length / 2);

    // Stack with LOD factor of 2 for non-reference scans
    // Pass calibration for LiDAR → Ego → World transformation
    try {
      const result = stackPointClouds(scanDataArray, referenceIndex, 2, egoToLidar);
      return result;
    } catch (error) {
      console.error('[LidarCanvas4D] Error stacking point clouds:', error);
      return null;
    }
  }, [lidarQueries, egoToLidar]);

  // Notify parent when stacked data changes (for ortho views sync)
  useEffect(() => {
    if (onStackedDataReady) {
      if (stackedData) {
        onStackedDataReady({
          positions: stackedData.positions,
          pointCount: stackedData.pointCount,
        });
      } else {
        onStackedDataReady(null);
      }
    }
  }, [stackedData, onStackedDataReady]);

  // Handle cuboid creation - mark as static by default in 4D mode
  const handleCuboidComplete = useCallback((cuboidData: CuboidData, isTrackMode: boolean = false, classIdOverride?: string) => {
    const effectiveClassId = classIdOverride || activeClassId;
    if (!effectiveClassId) {
      console.warn('[LidarCanvas4D] No active class selected, cannot create annotation');
      return;
    }

    // In 4D mode, cuboids created are static objects by default
    createAnnotation({
      type: 'cuboid',
      class_id: effectiveClassId,
      data: cuboidData,
      is_keyframe: isTrackMode,
      is_static: true,  // Static object annotation
    });
  }, [activeClassId, createAnnotation]);

  // Total point count for stats display
  const totalPoints = stackedData?.pointCount || 0;
  const referenceFrame = stackedData?.referenceFrameIndex ?? currentFrame?.frame_index ?? 0;

  return (
    <div className={`relative w-full h-full bg-[#0d1117] ${className}`}>
      {/* 4D Mode Stats Overlay */}
      <div className="absolute top-4 left-4 z-20 bg-dark-panel/90 backdrop-blur-sm px-4 py-2 rounded-lg border border-purple-500/30">
        <div className="flex items-center gap-4 text-sm">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
            <span className="text-purple-400 font-medium">4D Mode</span>
          </div>
          <div className="text-gray-400">
            Scans: <span className="text-white font-mono">{loadedCount}/{scanCount}</span>
          </div>
          <div className="text-gray-400">
            Points: <span className="text-white font-mono">{(totalPoints / 1000).toFixed(1)}k</span>
          </div>
          <div className="text-gray-400">
            Ref: <span className="text-white font-mono">#{referenceFrame}</span>
          </div>
          {/* Frame indicator - 4D always uses World frame */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-purple-500/20 rounded border border-purple-500/30">
            <span className="text-[10px] text-gray-400">Frame:</span>
            <span className="text-[11px] font-medium text-purple-400">World</span>
          </div>
        </div>
      </div>

      {/* Performance Settings Panel */}
      <div className="absolute bottom-4 right-4 z-20">
        <button
          onClick={() => setShowSettings(!showSettings)}
          className="bg-dark-panel/90 backdrop-blur-sm px-3 py-2 rounded-lg border border-gray-700/50 text-gray-400 hover:text-white hover:border-gray-600 transition-colors"
          title="Performance Settings"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>

        {showSettings && (
          <div className="absolute bottom-10 right-0 bg-dark-panel/95 backdrop-blur-sm px-4 py-3 rounded-lg border border-gray-700/50 min-w-[220px]">
            <div className="text-[11px] text-gray-400 mb-3 font-medium">Performance Settings</div>

            {/* Max Points Slider */}
            <div className="mb-3">
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-gray-400">Max Points</span>
                <span className="text-white font-mono">{(maxPoints / 1000).toFixed(0)}k</span>
              </div>
              <input
                type="range"
                min="100000"
                max="1000000"
                step="50000"
                value={maxPoints}
                onChange={(e) => setMaxPoints(Number(e.target.value))}
                className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
              <div className="flex justify-between text-[9px] text-gray-500 mt-0.5">
                <span>100k</span>
                <span>1M</span>
              </div>
            </div>

            {/* Voxel Size Slider */}
            <div className="mb-2">
              <div className="flex justify-between text-[10px] mb-1">
                <span className="text-gray-400">Voxel Size</span>
                <span className="text-white font-mono">{(voxelSize * 100).toFixed(0)}cm</span>
              </div>
              <input
                type="range"
                min="0.05"
                max="0.5"
                step="0.05"
                value={voxelSize}
                onChange={(e) => setVoxelSize(Number(e.target.value))}
                className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
              <div className="flex justify-between text-[9px] text-gray-500 mt-0.5">
                <span>5cm (detail)</span>
                <span>50cm (fast)</span>
              </div>
            </div>

            {/* Presets */}
            <div className="flex gap-2 mt-3">
              <button
                onClick={() => { setMaxPoints(150000); setVoxelSize(0.2); }}
                className="flex-1 px-2 py-1 text-[9px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
              >
                Fast
              </button>
              <button
                onClick={() => { setMaxPoints(300000); setVoxelSize(0.15); }}
                className="flex-1 px-2 py-1 text-[9px] bg-purple-700 hover:bg-purple-600 text-white rounded transition-colors"
              >
                Balanced
              </button>
              <button
                onClick={() => { setMaxPoints(500000); setVoxelSize(0.08); }}
                className="flex-1 px-2 py-1 text-[9px] bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
              >
                Quality
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Loading Indicator */}
      {isLoading && (
        <div className="absolute top-16 left-4 z-20 bg-dark-panel/90 px-3 py-1.5 rounded-lg text-sm text-gray-300">
          Loading scans... {loadedCount}/{framesToFetch.length}
        </div>
      )}

      {/* Debug: Show message if no stacked data */}
      {!isLoading && !stackedData && (
        <div className="absolute top-16 left-4 z-20 bg-red-900/80 px-3 py-1.5 rounded-lg text-sm text-red-200">
          No point cloud data available. Check console for errors.
        </div>
      )}

      <Canvas
        camera={{
          position: [0, -50, 40],
          fov: 50,
          near: 0.1,
          far: 1000
        }}
        gl={{
          antialias: true,
          alpha: false,
          powerPreference: 'high-performance',
        }}
      >
        {/* Scene Setup */}
        <color attach="background" args={['#0d1117']} />
        <ambientLight intensity={0.4} />
        <directionalLight position={[10, 10, 10]} intensity={0.6} />

        {/* Camera Controls */}
        <CameraController
          disabled={hasSelection && !shiftPressed}
        />

        {/* Ground Reference */}
        <GroundGrid />
        <AxesIndicator />

        {/* Stacked Point Cloud */}
        {stackedData && (
          <StackedPointCloud
            data={stackedData}
            pointSize={lidarView.pointSize * resolutionScale}
            showGroundPlane={lidarView.groundPlane?.enabled ?? true}
            distanceThreshold={lidarView.groundPlane?.distanceThreshold ?? 0.15}
            samplePercent={lidarView.groundPlane?.samplePercent ?? 30}
            maxPoints={maxPoints}
            voxelSize={voxelSize}
          />
        )}

        {/* Cuboid Annotations */}
        <CuboidAnnotations />

        {/* Cuboid Creation Tool - active in cuboid or track mode */}
        {(activeTool === 'cuboid' || activeTool === 'track') && (
          <CuboidCreator onComplete={handleCuboidComplete} />
        )}

        {/* Cursor Tracker for precision */}
        <CursorTracker />
      </Canvas>
    </div>
  );
};

export default LidarCanvas4D;

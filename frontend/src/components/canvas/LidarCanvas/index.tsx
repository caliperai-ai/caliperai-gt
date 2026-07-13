import React, { useMemo, useCallback, useState, useEffect } from 'react';
import { Canvas, useThree, useFrame } from '@react-three/fiber';
import { useEditorStore, useCurrentFrameAnnotations } from '@/store/editorStore';
import { useTrackStore } from '@/store/trackStore';
import type { CuboidData, PointCloudData } from '@/types';

import { PointCloud } from './PointCloud';
import { CuboidAnnotations } from './CuboidAnnotations';
import { CuboidCreator } from './CuboidCreator';
import { CameraController } from './CameraController';
import { GroundGrid, AxesIndicator } from './SceneHelpers';
import { Brush3DTool } from './Brush3DTool';
import { CursorTracker } from './CursorTracker';
import { CameraViewOverlay } from './CameraViewOverlay';
import { ProjectedPointsOverlay } from './ProjectedPointsOverlay';
import { SegmentPolygonOverlay } from './SegmentPolygonOverlay';
import { SegmentClickHandler } from './SegmentClickHandler';
import { SegmentTo3DControls } from './SegmentTo3DControls';
import { HeadingArrowOverlay } from './HeadingArrowOverlay';
import { HeadingPickerOverlay } from './HeadingPickerOverlay';
import { CuboidProjectionOverlay } from './CuboidProjectionOverlay';
import { PointCloudClickHandler } from './PointCloudClickHandler';
import { useSegmentTo3DStore } from '@/store/segmentTo3DStore';
import { filterPointCloudByFrustum } from './frustumFilter';
import { QAFalseNegativeTool } from './QAFalseNegativeTool';
import type { CameraCalibration } from '@/types';


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


const ViewOffsetAdjuster: React.FC<{ rightInset: number }> = ({ rightInset }) => {
  const { camera, gl, size } = useThree();

  useEffect(() => {
    if (rightInset <= 0) {
      (camera as THREE.PerspectiveCamera).clearViewOffset?.();
      gl.setSize(size.width, size.height);
      return;
    }
    const cam = camera as THREE.PerspectiveCamera;
    cam.setViewOffset(
      size.width,
      size.height,
      rightInset / 2,
      0,
      size.width,
      size.height
    );
    cam.updateProjectionMatrix();
  }, [rightInset, camera, gl, size]);

  useFrame(() => {
    if (rightInset <= 0) return;
    const cam = camera as THREE.PerspectiveCamera;
    if (cam.view && cam.view.fullWidth !== size.width) {
      cam.setViewOffset(
        size.width, size.height,
        rightInset / 2, 0,
        size.width, size.height
      );
      cam.updateProjectionMatrix();
    }
  });

  return null;
};

import * as THREE from 'three';


import { getBoxDoubleClickedFlag3D, clearBoxDoubleClickedFlag3D } from './doubleClickFlags';

const DoubleClickResetHandler: React.FC = () => {
  const { gl } = useThree();

  useEffect(() => {
    const handleDoubleClick = () => {
      setTimeout(() => {
        if (getBoxDoubleClickedFlag3D()) {
          console.log('[3D] Double-click on box detected, skipping reset');
          clearBoxDoubleClickedFlag3D();
          return;
        }
        console.log('[3D] Double-click on empty space, resetting camera');
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


interface EgoPose {
  position: number[];
  rotation: number[];
}

interface EgoToLidarCalibration {
  rotation: number[][];
  translation: number[];
}

interface LidarCanvasProps {
  pointCloudData?: PointCloudData;
  egoPose?: EgoPose;
  egoToLidarCalibration?: EgoToLidarCalibration;
  cameraCalibrations?: Record<string, CameraCalibration>;
  getImageUrl?: (cameraId: string) => string | undefined;
  getOriginalImageUrl?: (cameraId: string) => string | undefined;
  className?: string;
  isQAMode?: boolean;
  onFlagMissingLocation?: (location: { x: number; y: number; z: number }) => void;
  onPointCloudClick?: (point: { x: number; y: number; z: number }) => void;
  rightInset?: number;
}


export const LidarCanvas: React.FC<LidarCanvasProps> = ({
  pointCloudData,
  cameraCalibrations,
  getImageUrl,
  getOriginalImageUrl,
  className = '',
  isQAMode = false,
  onFlagMissingLocation,
  onPointCloudClick,
  rightInset = 0,
}) => {
  const { taxonomy, activeClassId, createAnnotation, lidarView, currentFrame, scene } = useEditorStore();
  const currentFrameAnnotations = useCurrentFrameAnnotations();
  const { createTrack, addAnnotationToTrack, activeTrackId, setActiveTrack } = useTrackStore();

  const [shiftPressed, setShiftPressed] = useState(false);
  const [imageDisplaySize, setImageDisplaySize] = useState({ width: 0, height: 0, offsetX: 0, offsetY: 0, naturalWidth: 0, naturalHeight: 0 });
  const canvasContainerRef = React.useRef<HTMLDivElement>(null);

  const [cameraViewZoom, setCameraViewZoom] = useState(1);
  const [cameraViewPan, setCameraViewPan] = useState({ x: 0, y: 0 });

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

  const transformedPointCloud = pointCloudData;

  const egoTransform = undefined;

  const cameraCenterTarget = undefined;

  const classColors = useMemo(() => {
    const colors: Record<number, string> = {};
    taxonomy?.classes.forEach((cls, i) => {
      colors[i] = cls.color;
    });
    return colors;
  }, [taxonomy]);

  const handleCuboidComplete = useCallback((cuboidData: CuboidData, isTrackMode: boolean = false, classIdOverride?: string) => {
    const effectiveClassId = classIdOverride || activeClassId;
    if (!effectiveClassId) {
      console.warn('[LidarCanvas] No active class selected, cannot create annotation');
      return;
    }

    const annotation = createAnnotation({
      type: 'cuboid',
      class_id: effectiveClassId,
      data: cuboidData,
      is_keyframe: isTrackMode,
    });

    const segmentStore = useSegmentTo3DStore.getState();
    if (segmentStore.isActive && annotation) {
      segmentStore.setLastCreatedAnnotationId(annotation.id);
    }

    if (isTrackMode && annotation && currentFrame) {
      let trackId: string;

      const activeTrack = activeTrackId ? useTrackStore.getState().tracks.get(activeTrackId) : null;
      const activeTrackHasCurrentFrame = activeTrack?.frame_annotations.has(currentFrame.id);

      if (activeTrackId && !activeTrackHasCurrentFrame) {
        addAnnotationToTrack(activeTrackId, currentFrame.id, annotation.id, true);
        trackId = activeTrackId;
      } else {
        const newTrack = createTrack(effectiveClassId, {});
        addAnnotationToTrack(newTrack.id, currentFrame.id, annotation.id, true);
        trackId = newTrack.id;
      }

      requestAnimationFrame(() => {
        setTimeout(() => {
          const { propagateTrack, tracks } = useTrackStore.getState();
          const track = tracks.get(trackId);
          console.log('[LidarCanvas] Auto-propagate check:', {
            trackId: trackId.slice(0, 8),
            trackExists: !!track,
            frameAnnotationsSize: track?.frame_annotations.size ?? 0,
          });
          propagateTrack(trackId, 5, 'both');
          console.log('[LidarCanvas] Auto-propagated track ±5 frames:', trackId.slice(0, 8));
        }, 150);
      });
    }
  }, [activeClassId, createAnnotation, currentFrame, createTrack, addAnnotationToTrack, activeTrackId, setActiveTrack]);

  const handlePointsSelected = useCallback((_indices: number[]) => {
    // TODO: Implement point selection for segmentation
  }, []);

  const demoPointCloud = useMemo<PointCloudData>(() => {
    const count = 50000;
    const positions = new Float32Array(count * 3);
    const intensities = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.random() * 50;

      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = Math.sin(angle) * radius;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 6 - 1.5;

      intensities[i] = Math.random();
    }

    return {
      positions,
      intensities,
      pointCount: count,
    };
  }, []);

  const finalPointCloud = transformedPointCloud || demoPointCloud;

  const cameraViewActive = lidarView.cameraView.isActive;
  const cameraViewId = lidarView.cameraView.cameraId;
  const showImagePlane = lidarView.cameraView.showImagePlane;
  const frustumOnlyMode = lidarView.cameraView.frustumOnlyMode;
  const imageOnlyMode = lidarView.cameraView.imageOnlyMode ?? false;
  const cameraImageUrl = cameraViewId ? getImageUrl?.(cameraViewId) : undefined;

  useEffect(() => {
    setCameraViewZoom(1);
    setCameraViewPan({ x: 0, y: 0 });
  }, [cameraViewId]);

  const showImageOverlay = cameraViewActive && !frustumOnlyMode && showImagePlane;
  const show3DElements = !cameraViewActive || frustumOnlyMode;

  const activeCameraCalib = cameraViewId
    ? (cameraCalibrations || scene?.calibration?.lidar_to_cameras)?.[cameraViewId]
    : undefined;

  const frustumFilteredPointCloud = useMemo<PointCloudData | undefined>(() => {
    if (!cameraViewActive || frustumOnlyMode || !activeCameraCalib || !finalPointCloud) {
      return undefined;
    }

    if (!imageDisplaySize.naturalWidth || !imageDisplaySize.naturalHeight) {
      return undefined;
    }

    if (!activeCameraCalib.extrinsic || !activeCameraCalib.intrinsic) {
      console.warn('[LidarCanvas] Incomplete calibration data, skipping frustum filter');
      return undefined;
    }

    try {
      return filterPointCloudByFrustum(
        finalPointCloud,
        activeCameraCalib,
        imageDisplaySize.naturalWidth,
        imageDisplaySize.naturalHeight
      );
    } catch (err) {
      console.warn('[LidarCanvas] Frustum filtering failed:', err);
      return finalPointCloud;
    }
  }, [cameraViewActive, frustumOnlyMode, activeCameraCalib, finalPointCloud, imageDisplaySize.naturalWidth, imageDisplaySize.naturalHeight]);

  const displayPointCloud = showImageOverlay && frustumFilteredPointCloud
    ? frustumFilteredPointCloud
    : finalPointCloud;

  const render2DPane = () => (
    <div className="absolute top-0 bottom-0 left-0 z-10" style={{ right: rightInset }}>
      {/* Camera Image */}
      {cameraViewId && cameraImageUrl && (
        <CameraViewOverlay
          imageUrl={cameraImageUrl}
          cameraId={cameraViewId}
          opacity={0.85}
          onExit={() => useEditorStore.getState().deactivateCameraView()}
          onImageLoad={setImageDisplaySize}
          zoom={cameraViewZoom}
          pan={cameraViewPan}
          onZoomChange={setCameraViewZoom}
          onPanChange={setCameraViewPan}
        />
      )}

      {/* 2D Projected Points Overlay */}
      {(() => {
        const shouldShow = !imageOnlyMode && activeCameraCalib && pointCloudData && imageDisplaySize.width > 0 && imageDisplaySize.naturalWidth > 0;

        return shouldShow ? (
          <ProjectedPointsOverlay
            pointCloud={pointCloudData}
            calibration={activeCameraCalib}
            imageWidth={imageDisplaySize.naturalWidth}
            imageHeight={imageDisplaySize.naturalHeight}
            displayWidth={imageDisplaySize.width}
            displayHeight={imageDisplaySize.height}
            offsetX={imageDisplaySize.offsetX}
            offsetY={imageDisplaySize.offsetY}
            annotations={currentFrameAnnotations}
            taxonomy={taxonomy}
            zoom={cameraViewZoom}
            pan={cameraViewPan}
            onZoomChange={setCameraViewZoom}
          />
        ) : null;
      })()}

      {/* Segment-to-3D Click Handler */}
      {imageDisplaySize.width > 0 && (
        <SegmentClickHandler
          displayWidth={imageDisplaySize.width}
          displayHeight={imageDisplaySize.height}
          imageWidth={imageDisplaySize.naturalWidth}
          imageHeight={imageDisplaySize.naturalHeight}
          offsetX={imageDisplaySize.offsetX}
          offsetY={imageDisplaySize.offsetY}
          zoom={cameraViewZoom}
          pan={cameraViewPan}
          imageUrl={cameraViewId ? (getOriginalImageUrl?.(cameraViewId) || cameraImageUrl) : undefined}
          onZoomChange={setCameraViewZoom}
        />
      )}

      {/* Segment-to-3D Polygon Overlay */}
      {imageDisplaySize.width > 0 && (
        <SegmentPolygonOverlay
          displayWidth={imageDisplaySize.width}
          displayHeight={imageDisplaySize.height}
          imageWidth={imageDisplaySize.naturalWidth}
          imageHeight={imageDisplaySize.naturalHeight}
          offsetX={imageDisplaySize.offsetX}
          offsetY={imageDisplaySize.offsetY}
          zoom={cameraViewZoom}
          pan={cameraViewPan}
          pointCloud={pointCloudData}
          calibration={activeCameraCalib}
          onZoomChange={setCameraViewZoom}
        />
      )}

      {/* Heading Arrow Overlay (render-only visual feedback) */}
      {imageDisplaySize.width > 0 && (
        <HeadingArrowOverlay
          displayWidth={imageDisplaySize.width}
          displayHeight={imageDisplaySize.height}
          imageWidth={imageDisplaySize.naturalWidth}
          imageHeight={imageDisplaySize.naturalHeight}
          offsetX={imageDisplaySize.offsetX}
          offsetY={imageDisplaySize.offsetY}
          zoom={cameraViewZoom}
          pan={cameraViewPan}
        />
      )}

      {/* Heading Picker Overlay - 8 directional arrows on image */}
      {imageDisplaySize.width > 0 && (
        <HeadingPickerOverlay
          displayWidth={imageDisplaySize.width}
          displayHeight={imageDisplaySize.height}
          imageWidth={imageDisplaySize.naturalWidth}
          imageHeight={imageDisplaySize.naturalHeight}
          offsetX={imageDisplaySize.offsetX}
          offsetY={imageDisplaySize.offsetY}
          zoom={cameraViewZoom}
          pan={cameraViewPan}
          calibration={activeCameraCalib}
        />
      )}

      {/* Selected Cuboid Projection Overlay - shows 3D box on 2D image */}
      {imageDisplaySize.width > 0 && activeCameraCalib && (
        <CuboidProjectionOverlay
          displayWidth={imageDisplaySize.width}
          displayHeight={imageDisplaySize.height}
          imageWidth={imageDisplaySize.naturalWidth}
          imageHeight={imageDisplaySize.naturalHeight}
          offsetX={imageDisplaySize.offsetX}
          offsetY={imageDisplaySize.offsetY}
          zoom={cameraViewZoom}
          pan={cameraViewPan}
          calibration={activeCameraCalib}
          cameraId={cameraViewId ?? undefined}
        />
      )}
    </div>
  );

  const render3DCanvas = (showElements: boolean, pointCloud: PointCloudData | undefined, background: string) => (
    <Canvas
      camera={{ position: [0, -8, 5], fov: 60, near: 0.1, far: 1000, up: [0, 0, 1] }}
      gl={{
        antialias: true,
        alpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
        failIfMajorPerformanceCaveat: false,
      }}
      frameloop="demand"
      style={{ background }}
      onPointerMissed={(e) => {
        if (e.detail === 1) {
          useEditorStore.getState().deselectAll();
        }
      }}
    >
      <CanvasCleanup />
      <DoubleClickResetHandler />
      {rightInset > 0 && <ViewOffsetAdjuster rightInset={rightInset} />}
      <ambientLight intensity={0.5} />
      <directionalLight position={[10, 10, 10]} intensity={0.5} />

      <CameraController
        disabled={shiftPressed}
        centerTarget={cameraCenterTarget}
        cameraCalibrations={cameraCalibrations || scene?.calibration?.lidar_to_cameras}
      />

      {showElements && (lidarView.showGrid ?? true) && <GroundGrid />}
      {showElements && <AxesIndicator />}

      {showElements && pointCloud && (
        <PointCloud
          data={pointCloud}
          classColors={classColors}
        />
      )}

      {showElements && <CuboidAnnotations egoTransform={egoTransform} shiftPressed={shiftPressed} />}
      {showElements && <CuboidCreator onComplete={handleCuboidComplete} />}

      {showElements && transformedPointCloud && (
        <Brush3DTool
          pointCloud={transformedPointCloud}
          onPointsSelected={handlePointsSelected}
        />
      )}

      {showElements && isQAMode && onFlagMissingLocation && (
        <QAFalseNegativeTool
          isQAMode={isQAMode}
          onFlagLocation={onFlagMissingLocation}
        />
      )}

      <CursorTracker />
      {showElements && <PointCloudClickHandler onPointClick={onPointCloudClick} />}
    </Canvas>
  );

  return (
    <div ref={canvasContainerRef} className={`relative w-full h-full bg-dark ${className}`}>
      {/* Camera Image Overlay - full canvas background when in camera view mode (not frustum-only) */}
      {showImageOverlay && cameraViewId && cameraImageUrl && render2DPane()}

      {/* Segment-to-3D Controls - floating action panel on left side */}
      {showImageOverlay && cameraViewId && imageDisplaySize.width > 0 && (
        <div
          className="absolute top-14 left-4 z-[30]"
        >
          <SegmentTo3DControls
            imageWidth={imageDisplaySize.naturalWidth}
            imageHeight={imageDisplaySize.naturalHeight}
            cameraId={cameraViewId}
            calibration={activeCameraCalib}
            onCuboidComplete={handleCuboidComplete}
            onBoxCreated={(boxData) => {
              console.log('[LidarCanvas] 3D box created from segment:', boxData);
            }}
          />
        </div>
      )}

      {render3DCanvas(show3DElements, displayPointCloud, showImageOverlay ? 'transparent' : '#1a1a2e')}
    </div>
  );
};

export default LidarCanvas;

// Re-export components for external use
export { PointCloud } from './PointCloud';
export { CuboidMesh } from './CuboidMesh';
export { CuboidAnnotations } from './CuboidAnnotations';
export { CuboidCreator } from './CuboidCreator';
export { CameraController } from './CameraController';
export { GroundGrid, AxesIndicator } from './SceneHelpers';
export { Brush3DTool } from './Brush3DTool';
export { CursorTracker } from './CursorTracker';
export { pointCloudVertexShader, pointCloudFragmentShader } from './shaders';

// Segment-to-3D Components
export { SegmentPolygonOverlay } from './SegmentPolygonOverlay';
export { SegmentClickHandler } from './SegmentClickHandler';
export { SegmentTo3DControls } from './SegmentTo3DControls';
export { HeadingArrowOverlay } from './HeadingArrowOverlay';
export { HeadingPickerOverlay } from './HeadingPickerOverlay';

// Point cloud view controls
export { ClipBoxControls } from './ClipBoxControls';

// 4D Labeling Mode
export { LidarCanvas4D } from './LidarCanvas4D';
export { LidarCanvas4DNew } from './LidarCanvas4DNew';
export { StackedPointCloud } from './StackedPointCloud';


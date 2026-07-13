import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Stage, Layer, Image, Rect, Group, Text } from 'react-konva';
import Konva from 'konva';
import { useEditorStore, useCurrentFrameAnnotations } from '@/store/editorStore';
import {
  getCuboidCorners,
  projectLidarPointsToImage,
} from '@/utils/projection';
import type {
  Box2DData,
  PolylineData,
  PolygonData,
  KeypointsData,
  CuboidData,
  SkeletonDefinition,
} from '@/types';

import { BoundingBox2D } from './BoundingBox2D';
import { PolylineAnnotation } from './PolylineAnnotation';
import { PolygonAnnotation } from './PolygonAnnotation';
import { KeypointsAnnotation } from './KeypointsAnnotation';
import { ProjectedCuboid } from './ProjectedCuboid';
import { DrawingLayer } from './DrawingLayer';


interface ImageCanvasProps {
  imageUrl?: string;
  cameraId: string;
  className?: string;
}

export const ImageCanvas: React.FC<ImageCanvasProps> = ({
  imageUrl,
  cameraId,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  const {
    scene,
    taxonomy,
    selection,
    activeTool,
    activeClassId,
    createAnnotation,
    updateAnnotation,
    selectAnnotation,
    hoverAnnotation,
    deselectAll,
    lidarView,
  } = useEditorStore();

  const clipBox = lidarView.clipBox;

  const annotations = useCurrentFrameAnnotations();

  console.log('[ImageCanvas] All frame annotations:', annotations.length, 'cameraId prop:', cameraId);
  console.log('[ImageCanvas] Annotation types:', annotations.map(a => ({ type: a.type, camera_id: a.camera_id, data_camera_id: (a.data as any)?.camera_id })));

  const camera2DAnnotations = annotations.filter((ann) => {
    if (ann.type === 'box2d' || ann.type === 'polyline' ||
        ann.type === 'polygon' || ann.type === 'keypoints') {
      if (ann.camera_id === cameraId || ann.camera_id === 'default') return true;
      const data = ann.data as Box2DData | PolylineData | PolygonData | KeypointsData;
      return data.camera_id === cameraId || data.camera_id === 'default';
    }
    return false;
  });

  console.log('[ImageCanvas] Filtered camera2DAnnotations:', camera2DAnnotations.length);

  const cuboidAnnotations = useMemo(() => {
    const cuboids = annotations.filter((ann) => ann.type === 'cuboid');

    if (clipBox?.enabled) {
      return cuboids.filter((ann) => {
        const center = (ann.data as CuboidData).center;
        return center.x >= clipBox.xMin && center.x <= clipBox.xMax &&
               center.y >= clipBox.yMin && center.y <= clipBox.yMax &&
               center.z >= clipBox.zMin && center.z <= clipBox.zMax;
      });
    }

    return cuboids;
  }, [annotations, clipBox]);

  const imageSize = useMemo(() => {
    if (image && image.width > 0 && image.height > 0) {
      return { width: image.width, height: image.height };
    }
    return { width: 1920, height: 1080 };
  }, [image]);

  const allProjectedPoints: { id: string; x: number; y: number }[] = useMemo(() => {
    if (!scene?.calibration) return [];

    const arr: { id: string; x: number; y: number }[] = [];
    cuboidAnnotations.forEach((ann) => {
      const cuboid = ann.data as CuboidData;
      const cameraCalib = scene.calibration.lidar_to_cameras?.[cameraId];
      if (!cameraCalib) return;

      const corners = getCuboidCorners(cuboid);
      const corners2D = projectLidarPointsToImage(
        corners,
        cameraCalib.extrinsic,
        cameraCalib.intrinsic,
        imageSize
      );

      corners2D.forEach((pt: { x: number; y: number } | null) => {
        if (pt) {
          arr.push({ id: ann.id, x: pt.x, y: pt.y });
        }
      });
    });
    return arr.filter((pt, idx, arr2) =>
      arr2.findIndex(p => Math.abs(p.x - pt.x) < 1e-2 && Math.abs(p.y - pt.y) < 1e-2 && p.id === pt.id) === idx
    );
  }, [scene, cuboidAnnotations, cameraId, imageSize]);

  useEffect(() => {
    if (!imageUrl) {
      return;
    }
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = imageUrl;
    img.onload = () => {
      setImage(img);
    };
    img.onerror = (err) => {
      console.error('[ImageCanvas] Failed to load image:', imageUrl, err);
    };
  }, [imageUrl]);

  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (containerSize.width === 0 || containerSize.height === 0) return;

    const scaleX = containerSize.width / imageSize.width;
    const scaleY = containerSize.height / imageSize.height;
    const fitScale = Math.min(scaleX, scaleY) * 0.95;

    setScale(fitScale);

    const x = (containerSize.width - imageSize.width * fitScale) / 2;
    const y = (containerSize.height - imageSize.height * fitScale) / 2;

    setPosition({ x, y });
  }, [imageSize, containerSize.width, containerSize.height]);

  const getClassColor = useCallback((classId: string) => {
    const cls = taxonomy?.classes.find((c) => c.id === classId);
    return cls?.color ?? '#888888';
  }, [taxonomy]);

  const getSkeleton = useCallback((skeletonId: string): SkeletonDefinition | undefined => {
    return taxonomy?.skeletons?.[skeletonId];
  }, [taxonomy]);

  const handleDrawingComplete = useCallback((data: Box2DData | PolylineData | PolygonData) => {
    let type: 'box2d' | 'polyline' | 'polygon' | 'keypoints' = 'box2d';
    if ('bbox' in data) {
      type = 'box2d';
    } else if ('points' in data && 'is_closed' in data && !(data as PolylineData).is_closed) {
      type = 'polygon';
    } else if ('points' in data && 'is_closed' in data) {
      type = 'polyline';
    }

    createAnnotation({
      type,
      data: { ...data, camera_id: cameraId },
      class_id: activeClassId ?? undefined,
    });
  }, [createAnnotation, cameraId, activeClassId]);

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    const scaleBy = 1.1;
    const stage = e.target.getStage();
    if (!stage) return;

    const pointer = stage.getPointerPosition();

    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - position.x) / scale,
      y: (pointer.y - position.y) / scale,
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = direction > 0 ? scale * scaleBy : scale / scaleBy;
    const clampedScale = Math.min(Math.max(newScale, 0.1), 10);

    setScale(clampedScale);
    setPosition({
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    });
  }, [scale, position]);

  const isDrawingMode = ['box2d', 'polyline', 'polygon', 'keypoints'].includes(activeTool);

  return (
    <div ref={containerRef} className={`relative w-full h-full bg-dark ${className}`}>
      <Stage
        width={containerSize.width}
        height={containerSize.height}
        scaleX={scale}
        scaleY={scale}
        x={position.x}
        y={position.y}
        draggable={!isDrawingMode}
        onWheel={handleWheel}
        onClick={(e) => {
          if (e.target === e.target.getStage()) {
            deselectAll();
          }
        }}
      >
        {/* Image Layer */}
        <Layer>
          {image && (
            <Image
              image={image}
              width={imageSize.width}
              height={imageSize.height}
            />
          )}

          {/* Demo placeholder when no image */}
          {!image && (
            <Rect
              width={imageSize.width}
              height={imageSize.height}
              fill="#1e293b"
            />
          )}
        </Layer>

        {/* Projected 3D Cuboids Layer */}
        <Layer>
          {scene?.calibration && cuboidAnnotations.map((ann) => (
            <ProjectedCuboid
              key={ann.id}
              cuboid={ann.data as CuboidData}
              classColor={getClassColor(ann.class_id)}
              calibration={scene.calibration}
              cameraId={cameraId}
              imageSize={imageSize}
              isAutoAnnotation={ann.source !== 'manual'}
              isVerified={ann.is_verified}
            />
          ))}
        </Layer>

        {/* Debug Info Layer - Always visible */}
        <Layer>
          <Group x={10} y={10}>
             <Rect width={400} height={200} fill="rgba(0,0,0,0.92)" cornerRadius={5} />
             <Text
                text={`DEBUG INFO:\nCamera: ${cameraId}\nCuboids in Frame: ${cuboidAnnotations.length}\nCalibration Loaded: ${!!scene?.calibration}\nImage Size: ${imageSize.width}x${imageSize.height}\nTotal Annotations: ${annotations.length}\nCoord Frame: LiDAR Sensor\n\nCuboid Centers (LiDAR):\n${cuboidAnnotations.slice(0, 3).map(ann => {
                  const c = (ann.data as CuboidData).center;
                  return `  (${c.x.toFixed(2)}, ${c.y.toFixed(2)}, ${c.z.toFixed(2)})`;
                }).join('\n') || '(none)'}\n\nProjected 2D Points: ${allProjectedPoints.length}`}
                fill="lime"
                padding={10}
                fontSize={11}
                fontFamily="monospace"
             />
          </Group>
          {/* Fallback: Print all projected 2D points in a fixed overlay for debug */}
          {allProjectedPoints.length > 0 && (
            <Group x={10} y={220}>
              <Rect width={340} height={Math.max(30, Math.min(allProjectedPoints.length, 8) * 18 + 10)} fill="rgba(0,0,0,0.85)" cornerRadius={5} />
              <Text
                text={
                  'Projected 2D Points:\n' +
                  allProjectedPoints.slice(0, 8).map((pt) => `#${pt.id?.substring(0,4)}: (${pt.x.toFixed(1)}, ${pt.y.toFixed(1)})`).join('\n')
                }
                fill="yellow"
                padding={10}
                fontSize={13}
                fontFamily="monospace"
              />
            </Group>
          )}
        </Layer>

        {/* 2D Annotations Layer */}
        <Layer>
          {camera2DAnnotations.map((ann) => {
            const isSelected = selection.selectedAnnotationIds.includes(ann.id);
            const isHovered = selection.hoveredAnnotationId === ann.id;
            const classColor = getClassColor(ann.class_id);
            const isAutoAnnotation = ann.source !== 'manual';

            switch (ann.type) {
              case 'box2d':
                return (
                  <BoundingBox2D
                    key={ann.id}
                    annotation={ann}
                    isSelected={isSelected}
                    isHovered={isHovered}
                    classColor={classColor}
                    isAutoAnnotation={isAutoAnnotation}
                    onSelect={() => selectAnnotation(ann.id)}
                    onHover={(hover) => hoverAnnotation(hover ? ann.id : undefined)}
                    onUpdate={(data) => updateAnnotation(ann.id, { data })}
                  />
                );

              case 'polyline':
                return (
                  <PolylineAnnotation
                    key={ann.id}
                    annotation={ann}
                    isSelected={isSelected}
                    isHovered={isHovered}
                    classColor={classColor}
                    isAutoAnnotation={isAutoAnnotation}
                    onSelect={() => selectAnnotation(ann.id)}
                    onHover={(hover) => hoverAnnotation(hover ? ann.id : undefined)}
                    onUpdate={(data) => updateAnnotation(ann.id, { data })}
                  />
                );

              case 'polygon':
                return (
                  <PolygonAnnotation
                    key={ann.id}
                    annotation={ann}
                    isSelected={isSelected}
                    isHovered={isHovered}
                    classColor={classColor}
                    isAutoAnnotation={isAutoAnnotation}
                    onSelect={() => selectAnnotation(ann.id)}
                    onHover={(hover) => hoverAnnotation(hover ? ann.id : undefined)}
                    onUpdate={(data) => updateAnnotation(ann.id, { data })}
                  />
                );

              case 'keypoints':
                const kpData = ann.data as KeypointsData;
                return (
                  <KeypointsAnnotation
                    key={ann.id}
                    annotation={ann}
                    isSelected={isSelected}
                    isHovered={isHovered}
                    classColor={classColor}
                    skeleton={getSkeleton(kpData.skeleton_id)}
                    isAutoAnnotation={isAutoAnnotation}
                    onSelect={() => selectAnnotation(ann.id)}
                    onHover={(hover) => hoverAnnotation(hover ? ann.id : undefined)}
                    onUpdate={(data) => updateAnnotation(ann.id, { data })}
                  />
                );

              default:
                return null;
            }
          })}
        </Layer>

        {/* Drawing Layer */}
        {isDrawingMode && (
          <Layer>
            <DrawingLayer
              tool={activeTool as 'box2d' | 'polyline' | 'polygon' | 'keypoints'}
              onComplete={handleDrawingComplete}
              imageSize={imageSize}
              cameraId={cameraId}
            />
          </Layer>
        )}
      </Stage>

      {/* Zoom indicator */}
      <div className="absolute bottom-4 right-4 px-3 py-1 bg-dark-panel/80 rounded text-sm text-white">
        {Math.round(scale * 100)}%
      </div>

      {/* Camera selector */}
      <div className="absolute top-4 left-4 px-3 py-1 bg-dark-panel/80 rounded text-sm text-white">
        {cameraId}
      </div>
    </div>
  );
};

export default ImageCanvas;

// Re-export components for external use
export { BoundingBox2D } from './BoundingBox2D';
export { PolylineAnnotation } from './PolylineAnnotation';
export { PolygonAnnotation } from './PolygonAnnotation';
export { KeypointsAnnotation } from './KeypointsAnnotation';
export { ProjectedCuboid } from './ProjectedCuboid';
export { DrawingLayer } from './DrawingLayer';

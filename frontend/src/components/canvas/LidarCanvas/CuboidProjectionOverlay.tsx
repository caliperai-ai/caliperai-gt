import React, { useMemo } from 'react';
import { useEditorStore, useCurrentFrameAnnotations } from '@/store/editorStore';
import { useSegmentTo3DStore } from '@/store/segmentTo3DStore';
import { projectCuboidToImage } from '@/utils/projection';
import type { CameraCalibration, CuboidData, Point2D } from '@/types';

interface CuboidProjectionOverlayProps {
  displayWidth: number;
  displayHeight: number;
  imageWidth: number;
  imageHeight: number;
  offsetX: number;
  offsetY: number;
  zoom?: number;
  pan?: { x: number; y: number };
  calibration?: CameraCalibration | null;
  cameraId?: string;
  forceFisheye?: boolean;
}

export const CuboidProjectionOverlay: React.FC<CuboidProjectionOverlayProps> = ({
  displayWidth,
  displayHeight,
  imageWidth,
  imageHeight,
  offsetX,
  offsetY,
  zoom = 1,
  pan = { x: 0, y: 0 },
  calibration,
  cameraId: _cameraId,
  forceFisheye,
}) => {
  const { selection, taxonomy, lidarView } = useEditorStore();
  const annotations = useCurrentFrameAnnotations();
  const { isActive: smartBoxActive, lastCreatedAnnotationId } = useSegmentTo3DStore();

  const useFisheye = forceFisheye !== undefined ? forceFisheye : lidarView.useFisheyeProjection;

  const imageToCanvas = (x: number, y: number): { x: number; y: number } => {
    const scaleX = displayWidth / imageWidth;
    const scaleY = displayHeight / imageHeight;

    const canvasX = x * scaleX + offsetX;
    const canvasY = y * scaleY + offsetY;

    const centerX = displayWidth / 2;
    const centerY = displayHeight / 2;

    return {
      x: (canvasX - centerX) * zoom + centerX + pan.x,
      y: (canvasY - centerY) * zoom + centerY + pan.y,
    };
  };

  const getClassColor = (classId: string): string => {
    const classDef = taxonomy?.classes.find(c => c.id === classId);
    return classDef?.color || '#3b82f6';
  };

  const cuboidsToProject = useMemo(() => {
    const result: Array<{ cuboid: CuboidData; color: string; isGhost: boolean }> = [];

    if (!calibration) return result;

    const idsToShow = new Set<string>();

    if (smartBoxActive && lastCreatedAnnotationId) {
      idsToShow.add(lastCreatedAnnotationId);
    }

    for (const id of idsToShow) {
      const ann = annotations.find(a => a.id === id);
      if (ann && ann.type === 'cuboid' && ann.data) {
        const isLastCreated = id === lastCreatedAnnotationId;
        result.push({
          cuboid: ann.data as CuboidData,
          color: getClassColor(ann.class_id),
          isGhost: isLastCreated && smartBoxActive,
        });
      }
    }

    return result;
  }, [annotations, selection.selectedAnnotationIds, lastCreatedAnnotationId, smartBoxActive, calibration, taxonomy]);

  const projectedEdges = useMemo(() => {
    if (!calibration || cuboidsToProject.length === 0) return [];

    const allEdges: Array<{
      edges: { start: Point2D; end: Point2D }[];
      color: string;
      isGhost: boolean;
    }> = [];

    for (const { cuboid, color, isGhost } of cuboidsToProject) {
      try {
        const edges = projectCuboidToImage(
          cuboid,
          calibration.extrinsic,
          calibration.intrinsic,
          { width: imageWidth, height: imageHeight },
          useFisheye
        );

        if (edges.length > 0) {
          allEdges.push({ edges, color, isGhost });
        }
      } catch (err) {
        console.warn('[CuboidProjectionOverlay] Failed to project cuboid:', err);
      }
    }

    return allEdges;
  }, [cuboidsToProject, calibration, imageWidth, imageHeight, useFisheye]);

  if (projectedEdges.length === 0) {
    return null;
  }

  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 15 }}
      width={displayWidth}
      height={displayHeight}
    >
      {projectedEdges.map((group, groupIdx) => (
        <g key={groupIdx}>
          {group.edges.map((edge, edgeIdx) => {
            const start = imageToCanvas(edge.start.x, edge.start.y);
            const end = imageToCanvas(edge.end.x, edge.end.y);

            return (
              <line
                key={edgeIdx}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke={group.color}
                strokeWidth={group.isGhost ? 2 : 3}
                strokeOpacity={group.isGhost ? 0.6 : 0.9}
                strokeDasharray={group.isGhost ? '6,3' : 'none'}
              />
            );
          })}
        </g>
      ))}
    </svg>
  );
};

export default CuboidProjectionOverlay;

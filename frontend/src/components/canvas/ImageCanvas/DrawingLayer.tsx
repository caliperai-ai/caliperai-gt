import React, { useState } from 'react';
import { Rect, Line, Circle } from 'react-konva';
import Konva from 'konva';
import type { Box2DData, PolylineData, PolygonData, Point2D } from '@/types';

export interface DrawingLayerProps {
  tool: 'box2d' | 'polyline' | 'polygon' | 'keypoints';
  onComplete: (data: Box2DData | PolylineData | PolygonData) => void;
  imageSize: { width: number; height: number };
  cameraId: string;
}

export const DrawingLayer: React.FC<DrawingLayerProps> = ({
  tool,
  onComplete,
  imageSize,
  cameraId,
}) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const [startPoint, setStartPoint] = useState<Point2D | null>(null);
  const [currentPoint, setCurrentPoint] = useState<Point2D | null>(null);
  const [points, setPoints] = useState<number[][]>([]);

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const stage = e.target.getStage();
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    if (tool === 'box2d') {
      setIsDrawing(true);
      setStartPoint({ x: pos.x, y: pos.y });
      setCurrentPoint({ x: pos.x, y: pos.y });
    } else if (tool === 'polyline' || tool === 'polygon') {
      setPoints([...points, [pos.x, pos.y]]);
    }
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!isDrawing) return;

    const stage = e.target.getStage();
    if (!stage) return;

    const pos = stage.getPointerPosition();
    if (!pos) return;

    setCurrentPoint({ x: pos.x, y: pos.y });
  };

  const handleMouseUp = () => {
    if (tool === 'box2d' && startPoint && currentPoint) {
      const width = Math.abs(currentPoint.x - startPoint.x);
      const height = Math.abs(currentPoint.y - startPoint.y);

      if (width > 5 && height > 5) {
        onComplete({
          camera_id: cameraId,
          bbox: {
            x: Math.min(startPoint.x, currentPoint.x),
            y: Math.min(startPoint.y, currentPoint.y),
            width,
            height,
          },
        });
      }
    }

    setIsDrawing(false);
    setStartPoint(null);
    setCurrentPoint(null);
  };

  const handleDoubleClick = () => {
    if ((tool === 'polyline' || tool === 'polygon') && points.length >= 2) {
      if (tool === 'polyline') {
        onComplete({
          camera_id: cameraId,
          points,
          is_closed: false,
          bezier: false,
        });
      } else if (points.length >= 3) {
        onComplete({
          camera_id: cameraId,
          points,
        });
      }
      setPoints([]);
    }
  };

  const previewBox = startPoint && currentPoint ? {
    x: Math.min(startPoint.x, currentPoint.x),
    y: Math.min(startPoint.y, currentPoint.y),
    width: Math.abs(currentPoint.x - startPoint.x),
    height: Math.abs(currentPoint.y - startPoint.y),
  } : null;

  return (
    <>
      {/* Invisible interaction layer */}
      <Rect
        x={0}
        y={0}
        width={imageSize.width}
        height={imageSize.height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onDblClick={handleDoubleClick}
      />

      {/* Box preview */}
      {previewBox && (
        <Rect
          x={previewBox.x}
          y={previewBox.y}
          width={previewBox.width}
          height={previewBox.height}
          stroke="#3b82f6"
          strokeWidth={2}
          dash={[5, 5]}
        />
      )}

      {/* Polyline/Polygon preview */}
      {points.length > 0 && (
        <>
          <Line
            points={points.flat()}
            stroke="#3b82f6"
            strokeWidth={2}
            dash={[5, 5]}
            closed={tool === 'polygon'}
          />
          {points.map((point, i) => (
            <Circle
              key={i}
              x={point[0]}
              y={point[1]}
              radius={4}
              fill="#3b82f6"
            />
          ))}
        </>
      )}
    </>
  );
};

export default DrawingLayer;

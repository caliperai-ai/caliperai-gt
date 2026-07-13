import React, { useState, useCallback, useMemo } from 'react';
import { Line, Circle, Group, Text } from 'react-konva';
import type { KonvaEventObject } from 'konva/lib/Node';
import { bezierToPolyline, Point2D } from '@/utils/laneSmoothing';

export interface BezierLaneEditorProps {
  handles: [Point2D, Point2D, Point2D];
  color: string;
  isSelected: boolean;
  vanishingLineY?: number;
  onUpdate: (handles: [Point2D, Point2D, Point2D]) => void;
  onComplete?: (polylinePoints: Point2D[]) => void;
  onClick?: () => void;
  onHover?: (isHovered: boolean) => void;
  polylineResolution?: number;
}

interface HandleConfig {
  index: number;
  label: string;
  color: string;
  radius: number;
}

const HANDLE_CONFIGS: HandleConfig[] = [
  { index: 0, label: 'Start', color: '#22c55e', radius: 8 },
  { index: 1, label: 'Curve', color: '#f59e0b', radius: 10 },
  { index: 2, label: 'End', color: '#ef4444', radius: 8 },
];

export const BezierLaneEditor: React.FC<BezierLaneEditorProps> = ({
  handles,
  color,
  isSelected,
  vanishingLineY,
  onUpdate,
  onComplete,
  onClick,
  onHover,
  polylineResolution = 30,
}) => {
  const [draggingHandle, setDraggingHandle] = useState<number | null>(null);
  const [isHoveringCurve, setIsHoveringCurve] = useState(false);

  const curvePoints = useMemo(() => {
    const [start, control, end] = handles;
    return bezierToPolyline(start, control, end, polylineResolution);
  }, [handles, polylineResolution]);

  const flatPoints = useMemo(() =>
    curvePoints.flatMap(p => [p.x, p.y]),
    [curvePoints]
  );

  const tangentLines = useMemo(() => {
    const [start, control, end] = handles;
    return [
      [start.x, start.y, control.x, control.y],
      [control.x, control.y, end.x, end.y],
    ];
  }, [handles]);


  const handleDragStart = useCallback((index: number) => {
    setDraggingHandle(index);
  }, []);

  const handleDragMove = useCallback((index: number, e: KonvaEventObject<DragEvent>) => {
    const newHandles: [Point2D, Point2D, Point2D] = [...handles];
    let newX = e.target.x();
    let newY = e.target.y();

    if (index === 2 && vanishingLineY !== undefined) {
      newY = vanishingLineY;
      e.target.y(vanishingLineY);
    }

    newHandles[index] = { x: newX, y: newY };
    onUpdate(newHandles);
  }, [handles, vanishingLineY, onUpdate]);

  const handleDragEnd = useCallback((_index: number) => {
    setDraggingHandle(null);
    if (onComplete) {
      onComplete(curvePoints);
    }
  }, [curvePoints, onComplete]);

  const handleCurveClick = useCallback(() => {
    onClick?.();
  }, [onClick]);

  const handleCurveHover = useCallback((hovering: boolean) => {
    setIsHoveringCurve(hovering);
    onHover?.(hovering);
  }, [onHover]);


  const strokeWidth = isSelected || isHoveringCurve ? 4 : 3;

  return (
    <Group>
      {/* Tangent lines (only when selected) */}
      {isSelected && (
        <>
          <Line
            points={tangentLines[0]}
            stroke={HANDLE_CONFIGS[1].color}
            strokeWidth={1}
            dash={[4, 4]}
            opacity={0.5}
            listening={false}
          />
          <Line
            points={tangentLines[1]}
            stroke={HANDLE_CONFIGS[1].color}
            strokeWidth={1}
            dash={[4, 4]}
            opacity={0.5}
            listening={false}
          />
        </>
      )}

      {/* Main Bezier curve */}
      <Line
        points={flatPoints}
        stroke={color}
        strokeWidth={strokeWidth}
        lineCap="round"
        lineJoin="round"
        hitStrokeWidth={15}
        onClick={handleCurveClick}
        onMouseEnter={() => handleCurveHover(true)}
        onMouseLeave={() => handleCurveHover(false)}
        shadowColor={isSelected ? color : undefined}
        shadowBlur={isSelected ? 8 : 0}
        shadowOpacity={0.5}
      />

      {/* Control handles (only when selected) */}
      {isSelected && HANDLE_CONFIGS.map((config) => {
        const point = handles[config.index];
        const isDragging = draggingHandle === config.index;

        return (
          <Group key={config.index}>
            {/* Handle background glow */}
            <Circle
              x={point.x}
              y={point.y}
              radius={config.radius + 4}
              fill={`${config.color}33`}
              listening={false}
            />

            {/* Handle circle */}
            <Circle
              x={point.x}
              y={point.y}
              radius={config.radius}
              fill={isDragging ? config.color : 'white'}
              stroke={config.color}
              strokeWidth={3}
              draggable
              onDragStart={() => handleDragStart(config.index)}
              onDragMove={(e) => handleDragMove(config.index, e)}
              onDragEnd={() => handleDragEnd(config.index)}
              shadowColor="black"
              shadowBlur={4}
              shadowOpacity={0.3}
            />

            {/* Handle label */}
            <Text
              x={point.x + config.radius + 6}
              y={point.y - 6}
              text={config.label}
              fontSize={11}
              fontStyle="bold"
              fill={config.color}
              listening={false}
            />
          </Group>
        );
      })}

      {/* VP line constraint indicator (when dragging end handle) */}
      {isSelected && draggingHandle === 2 && vanishingLineY !== undefined && (
        <Line
          points={[handles[2].x - 30, vanishingLineY, handles[2].x + 30, vanishingLineY]}
          stroke="#ef4444"
          strokeWidth={2}
          dash={[6, 3]}
          opacity={0.8}
          listening={false}
        />
      )}
    </Group>
  );
};

export default BezierLaneEditor;

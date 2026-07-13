import React, { useCallback, useMemo } from 'react';
import { Line, Circle, Group, Rect, Text } from 'react-konva';
import { DASH_PATTERN } from '@/constants';
import type { Annotation, PolygonData } from '@/types';

export interface PolygonAnnotationProps {
  annotation: Annotation;
  isSelected: boolean;
  isHovered: boolean;
  classColor: string;
  isAutoAnnotation: boolean;
  onSelect: () => void;
  onHover: (hover: boolean) => void;
  onUpdate: (data: PolygonData) => void;
}

export const PolygonAnnotation: React.FC<PolygonAnnotationProps> = ({
  annotation,
  isSelected,
  isHovered,
  classColor,
  isAutoAnnotation,
  onSelect,
  onHover,
  onUpdate,
}) => {
  const data = annotation.data as PolygonData;

  const strokeWidth = isSelected ? 3 : 2;
  const dash = isAutoAnnotation && !annotation.is_verified ? DASH_PATTERN : undefined;
  const fillOpacity = isSelected ? 0.3 : isHovered ? 0.2 : 0.15;

  const normalizedPoints = useMemo(() => {
    if (!data.points || data.points.length === 0) return [];
    const firstPoint = data.points[0];
    if (typeof firstPoint === 'object' && !Array.isArray(firstPoint) && 'x' in firstPoint) {
      return (data.points as any).map((p: any) => [p.x, p.y]);
    }
    return data.points as number[][];
  }, [data.points]);

  const flatPoints = useMemo(() => normalizedPoints.flat(), [normalizedPoints]);

  const handlePointDrag = useCallback((index: number, x: number, y: number) => {
    const newPoints = [...data.points];
    newPoints[index] = [x, y];
    onUpdate({ ...data, points: newPoints });
  }, [data, onUpdate]);

  return (
    <Group onClick={onSelect} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      {/* Filled polygon */}
      <Line
        points={flatPoints}
        fill={classColor}
        opacity={fillOpacity}
        stroke={classColor}
        strokeWidth={strokeWidth}
        dash={dash}
        closed
        lineCap="round"
        lineJoin="round"
      />

      {/* AUTO badge if this is an auto annotation */}
      {isAutoAnnotation && normalizedPoints.length > 0 && (
        <Group x={normalizedPoints[0][0]} y={normalizedPoints[0][1] - 18}>
          <Rect
            width={28}
            height={12}
            fill="rgba(168, 85, 247, 0.9)"
            cornerRadius={2}
            stroke="rgba(255, 255, 255, 0.8)"
            strokeWidth={1}
          />
          <Text
            x={0}
            y={0}
            width={28}
            height={12}
            text="AUTO"
            fontSize={7}
            fill="white"
            fontStyle="bold"
            align="center"
            verticalAlign="middle"
          />
        </Group>
      )}

      {/* Control points */}
      {isSelected && normalizedPoints.map((point: number[], i: number) => (
        <Circle
          key={i}
          x={point[0]}
          y={point[1]}
          radius={5}
          fill="white"
          stroke={classColor}
          strokeWidth={2}
          draggable
          onDragMove={(e) => {
            handlePointDrag(i, e.target.x(), e.target.y());
          }}
        />
      ))}
    </Group>
  );
};

export default PolygonAnnotation;

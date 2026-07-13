import React, { useState, useCallback, useMemo } from 'react';
import { Line, Circle, Group } from 'react-konva';
import { DASH_PATTERN } from '@/constants';
import type { Annotation, PolylineData } from '@/types';

export interface PolylineAnnotationProps {
  annotation: Annotation;
  isSelected: boolean;
  isHovered: boolean;
  classColor: string;
  isAutoAnnotation: boolean;
  onSelect: () => void;
  onHover: (hover: boolean) => void;
  onUpdate: (data: PolylineData) => void;
}

export const PolylineAnnotation: React.FC<PolylineAnnotationProps> = ({
  annotation,
  isSelected,
  classColor,
  isAutoAnnotation,
  onSelect,
  onHover,
  onUpdate,
}) => {
  const data = annotation.data as PolylineData;
  const [_draggingPoint, _setDraggingPoint] = useState<number | null>(null);

  const strokeWidth = isSelected ? 10 : 8;
  const dash = isAutoAnnotation && !annotation.is_verified ? DASH_PATTERN : undefined;

  const flatPoints = useMemo(() => data.points.flat(), [data.points]);

  const handlePointDrag = useCallback((index: number, x: number, y: number) => {
    const newPoints = [...data.points];
    newPoints[index] = [x, y];
    onUpdate({ ...data, points: newPoints });
  }, [data, onUpdate]);

  return (
    <Group onClick={onSelect} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      {/* Main line */}
      <Line
        points={flatPoints}
        stroke={classColor}
        strokeWidth={strokeWidth}
        dash={dash}
        lineCap="round"
        lineJoin="round"
        closed={data.is_closed}
        tension={data.bezier ? 0.5 : 0}
        hitStrokeWidth={10}
      />

      {/* Control points */}
      {isSelected && data.points.map((point, i) => (
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

export default PolylineAnnotation;

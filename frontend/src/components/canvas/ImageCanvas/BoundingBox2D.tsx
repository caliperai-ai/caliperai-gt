import React, { useRef, useCallback } from 'react';
import { Rect, Group, Text } from 'react-konva';
import Konva from 'konva';
import { HANDLE_SIZE, DASH_PATTERN } from '@/constants';
import type { Annotation, Box2DData } from '@/types';

export interface BoundingBox2DProps {
  annotation: Annotation;
  isSelected: boolean;
  isHovered: boolean;
  classColor: string;
  isAutoAnnotation: boolean;
  onSelect: () => void;
  onHover: (hover: boolean) => void;
  onUpdate: (data: Box2DData) => void;
}

export const BoundingBox2D: React.FC<BoundingBox2DProps> = ({
  annotation,
  isSelected,
  isHovered,
  classColor,
  isAutoAnnotation,
  onSelect,
  onHover,
  onUpdate,
}) => {
  const data = annotation.data as Box2DData;
  const { bbox } = data;
  const groupRef = useRef<Konva.Group>(null);

  const strokeWidth = isSelected ? 3 : 2;
  const dash = isAutoAnnotation && !annotation.is_verified ? DASH_PATTERN : undefined;
  const fillOpacity = isSelected ? 0.2 : isHovered ? 0.1 : 0;

  const handles = isSelected ? [
    { x: 0, y: 0, cursor: 'nw-resize' },
    { x: 0.5, y: 0, cursor: 'n-resize' },
    { x: 1, y: 0, cursor: 'ne-resize' },
    { x: 1, y: 0.5, cursor: 'e-resize' },
    { x: 1, y: 1, cursor: 'se-resize' },
    { x: 0.5, y: 1, cursor: 's-resize' },
    { x: 0, y: 1, cursor: 'sw-resize' },
    { x: 0, y: 0.5, cursor: 'w-resize' },
  ] : [];

  const handleDragEnd = useCallback((e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    onUpdate({
      ...data,
      bbox: {
        ...bbox,
        x: node.x(),
        y: node.y(),
      },
    });
  }, [data, bbox, onUpdate]);

  return (
    <Group
      ref={groupRef}
      x={bbox.x}
      y={bbox.y}
      draggable={isSelected}
      onDragEnd={handleDragEnd}
      onClick={onSelect}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
    >
      {/* Main rectangle */}
      <Rect
        width={bbox.width}
        height={bbox.height}
        stroke={classColor}
        strokeWidth={strokeWidth}
        dash={dash}
        fill={classColor}
        opacity={fillOpacity}
      />

      {/* Label */}
      <Text
        x={0}
        y={-20}
        text={annotation.class_id}
        fontSize={12}
        fill={classColor}
        padding={2}
      />

      {/* AUTO badge if this is an auto annotation */}
      {isAutoAnnotation && (
        <Group x={bbox.width - 32} y={-18}>
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

      {/* Resize handles */}
      {handles.map((handle, i) => (
        <Rect
          key={i}
          x={handle.x * bbox.width - HANDLE_SIZE / 2}
          y={handle.y * bbox.height - HANDLE_SIZE / 2}
          width={HANDLE_SIZE}
          height={HANDLE_SIZE}
          fill="white"
          stroke={classColor}
          strokeWidth={1}
        />
      ))}
    </Group>
  );
};

export default BoundingBox2D;

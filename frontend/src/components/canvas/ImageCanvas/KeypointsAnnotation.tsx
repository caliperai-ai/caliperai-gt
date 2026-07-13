import React, { useCallback } from 'react';
import { Line, Circle, Group } from 'react-konva';
import { KEYPOINT_RADIUS, DASH_PATTERN } from '@/constants';
import type { Annotation, KeypointsData, SkeletonDefinition } from '@/types';

export interface KeypointsAnnotationProps {
  annotation: Annotation;
  isSelected: boolean;
  isHovered: boolean;
  classColor: string;
  skeleton?: SkeletonDefinition;
  isAutoAnnotation: boolean;
  onSelect: () => void;
  onHover: (hover: boolean) => void;
  onUpdate: (data: KeypointsData) => void;
}

export const KeypointsAnnotation: React.FC<KeypointsAnnotationProps> = ({
  annotation,
  isSelected,
  classColor,
  skeleton,
  isAutoAnnotation,
  onSelect,
  onHover,
  onUpdate,
}) => {
  const data = annotation.data as KeypointsData;

  const strokeWidth = isSelected ? 3 : 2;
  const dash = isAutoAnnotation && !annotation.is_verified ? DASH_PATTERN : undefined;

  const getKeypointColor = (visibility: number) => {
    switch (visibility) {
      case 0: return '#666666';
      case 1: return '#ffaa00';
      case 2: return classColor;
      default: return classColor;
    }
  };

  const handleKeypointDrag = useCallback((keypointId: string, x: number, y: number) => {
    const newKeypoints = { ...data.keypoints };
    newKeypoints[keypointId] = {
      ...newKeypoints[keypointId],
      x,
      y,
    };
    onUpdate({ ...data, keypoints: newKeypoints });
  }, [data, onUpdate]);

  return (
    <Group onClick={onSelect} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)}>
      {/* Skeleton bones */}
      {skeleton?.bones.map(([from, to], i) => {
        const fromKp = data.keypoints[from];
        const toKp = data.keypoints[to];

        if (!fromKp || !toKp || fromKp.visibility === 0 || toKp.visibility === 0) {
          return null;
        }

        return (
          <Line
            key={i}
            points={[fromKp.x, fromKp.y, toKp.x, toKp.y]}
            stroke={classColor}
            strokeWidth={strokeWidth}
            dash={dash}
            opacity={0.7}
          />
        );
      })}

      {/* Keypoints */}
      {Object.entries(data.keypoints).map(([id, kp]) => (
        <Circle
          key={id}
          x={kp.x}
          y={kp.y}
          radius={KEYPOINT_RADIUS}
          fill={getKeypointColor(kp.visibility)}
          stroke={isSelected ? 'white' : classColor}
          strokeWidth={2}
          draggable={isSelected}
          onDragMove={(e) => {
            handleKeypointDrag(id, e.target.x(), e.target.y());
          }}
        />
      ))}
    </Group>
  );
};

export default KeypointsAnnotation;

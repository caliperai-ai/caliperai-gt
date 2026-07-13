import React, { useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import { useEditorStore } from '@/store/editorStore';
import type { PointCloudData, Point3D } from '@/types';

interface BrushSelectorProps {
  position: Point3D;
  radius: number;
  visible: boolean;
}

const BrushSelector: React.FC<BrushSelectorProps> = ({ position, radius, visible }) => {
  if (!visible) return null;

  return (
    <mesh position={[position.x, position.y, position.z]}>
      <sphereGeometry args={[radius, 32, 32]} />
      <meshBasicMaterial
        color="#3b82f6"
        transparent
        opacity={0.3}
        depthWrite={false}
      />
    </mesh>
  );
};

export interface Brush3DToolProps {
  pointCloud: PointCloudData;
  onPointsSelected: (indices: number[]) => void;
}

export const Brush3DTool: React.FC<Brush3DToolProps> = ({ pointCloud, onPointsSelected }) => {
  const [brushPosition] = useState<Point3D>({ x: 0, y: 0, z: 0 });
  const [isActive] = useState(false);
  const [brushRadius] = useState(1.0);
  const { activeTool } = useEditorStore();

  const selectPointsInBrush = useCallback(() => {
    if (!isActive) return;

    const selectedIndices: number[] = [];
    const radiusSq = brushRadius * brushRadius;

    for (let i = 0; i < pointCloud.pointCount; i++) {
      const px = pointCloud.positions[i * 3];
      const py = pointCloud.positions[i * 3 + 1];
      const pz = pointCloud.positions[i * 3 + 2];

      const dx = px - brushPosition.x;
      const dy = py - brushPosition.y;
      const dz = pz - brushPosition.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq <= radiusSq) {
        selectedIndices.push(i);
      }
    }

    if (selectedIndices.length > 0) {
      onPointsSelected(selectedIndices);
    }
  }, [isActive, brushPosition, brushRadius, pointCloud, onPointsSelected]);

  useFrame(() => {
    selectPointsInBrush();
  });

  if (activeTool !== 'brush3d') return null;

  return (
    <BrushSelector
      position={brushPosition}
      radius={brushRadius}
      visible={true}
    />
  );
};

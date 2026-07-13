import React, { useRef, useMemo, useCallback } from 'react';
import { ThreeEvent } from '@react-three/fiber';
import { Html, Edges } from '@react-three/drei';
import * as THREE from 'three';
import type { CuboidData } from '@/types';

export interface PendingCuboid {
  id: string;
  classId: string;
  data: CuboidData;
}

interface PendingCuboid4DProps {
  pending: PendingCuboid;
  isSelected: boolean;
  classColor: string;
  className: string;
  onClick: () => void;
  onUpdate: (updates: Partial<CuboidData>) => void;
  onDelete: () => void;
}

export const PendingCuboid4D: React.FC<PendingCuboid4DProps> = ({
  pending,
  isSelected,
  classColor,
  className,
  onClick,
  onUpdate: _onUpdate,
  onDelete,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);

  const data = pending.data;
  const position: [number, number, number] = [
    data.center.x,
    data.center.y,
    data.center.z,
  ];

  const dimensions: [number, number, number] = [
    data.dimensions.length || 1,
    data.dimensions.width || 1,
    data.dimensions.height || 1,
  ];

  const yaw = data.rotation?.yaw || 0;

  const color = useMemo(() => new THREE.Color(classColor), [classColor]);

  const dashedMaterial = useMemo(() => {
    return new THREE.LineDashedMaterial({
      color: color,
      dashSize: 0.3,
      gapSize: 0.15,
      linewidth: 2,
    });
  }, [color]);

  const edgesGeometry = useMemo(() => {
    const boxGeom = new THREE.BoxGeometry(...dimensions);
    return new THREE.EdgesGeometry(boxGeom);
  }, [dimensions]);

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    onClick();
  }, [onClick]);

  React.useEffect(() => {
    if (!isSelected) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        onDelete();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSelected, onDelete]);

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[0, 0, yaw]}
    >
      {/* Invisible clickable mesh */}
      <mesh
        ref={meshRef}
        onPointerDown={handlePointerDown}
      >
        <boxGeometry args={dimensions} />
        <meshBasicMaterial
          color={color}
          transparent
          opacity={isSelected ? 0.25 : 0.15}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Dashed outline for pending state */}
      <lineSegments geometry={edgesGeometry} material={dashedMaterial} />

      {/* Solid edges when selected */}
      {isSelected && (
        <Edges
          scale={1}
          threshold={15}
          color={classColor}
          lineWidth={2}
        />
      )}

      {/* Label */}
      <Html
        position={[0, 0, dimensions[2] / 2 + 0.3]}
        center
        style={{ pointerEvents: 'none' }}
      >
        <div
          className="px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap"
          style={{
            backgroundColor: `${classColor}dd`,
            color: 'white',
            border: '1px dashed white',
            boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
          }}
        >
          {className} (pending)
        </div>
      </Html>
    </group>
  );
};

export default PendingCuboid4D;

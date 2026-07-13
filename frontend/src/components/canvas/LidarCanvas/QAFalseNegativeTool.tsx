import React, { useCallback, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '@/store/editorStore';
import { useIsQAMode } from '@/store/qaStore';

interface QAFalseNegativeToolProps {
  isQAMode?: boolean;
  onFlagLocation?: (location: { x: number; y: number; z: number }) => void;
}

export const QAFalseNegativeTool: React.FC<QAFalseNegativeToolProps> = ({
  isQAMode: isQAModeProp,
  onFlagLocation,
}) => {
  const { scene, camera, gl } = useThree();
  const isQAModeFromStore = useIsQAMode();
  const isQAMode = isQAModeProp ?? isQAModeFromStore;
  const activeTool = useEditorStore((s) => s.activeTool);

  const isActive = isQAMode && activeTool === 'flag_missing';

  const handleClick = useCallback((event: MouseEvent) => {
    if (!isActive) return;

    const canvas = gl.domElement;
    const rect = canvas.getBoundingClientRect();

    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.5 };
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    const intersects = raycaster.intersectObjects(scene.children, true);

    if (intersects.length > 0) {
      const point = intersects[0].point;
      const location = {
        x: parseFloat(point.x.toFixed(3)),
        y: parseFloat(point.y.toFixed(3)),
        z: parseFloat(point.z.toFixed(3)),
      };

      console.log('[QA FalseNegativeTool] Clicked at:', location);
      onFlagLocation?.(location);
    }
  }, [isActive, scene, camera, gl, onFlagLocation]);

  useEffect(() => {
    if (!isActive) return;

    const canvas = gl.domElement;
    canvas.addEventListener('click', handleClick);

    canvas.style.cursor = 'crosshair';

    return () => {
      canvas.removeEventListener('click', handleClick);
      canvas.style.cursor = 'default';
    };
  }, [isActive, gl, handleClick]);

  return null;
};

interface FlagMarkerProps {
  position: [number, number, number];
  color?: string;
}

export const FlagMarker: React.FC<FlagMarkerProps> = ({ position, color = '#ff4444' }) => {
  return (
    <group position={position}>
      {/* Sphere at flag location */}
      <mesh>
        <sphereGeometry args={[0.3, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} />
      </mesh>

      {/* Vertical line pointing up */}
      <mesh position={[0, 0, 1.5]}>
        <cylinderGeometry args={[0.02, 0.02, 3, 8]} />
        <meshBasicMaterial color={color} />
      </mesh>

      {/* Flag triangle at top */}
      <mesh position={[0.3, 0, 2.8]} rotation={[0, 0, Math.PI / 2]}>
        <coneGeometry args={[0.3, 0.5, 3]} />
        <meshBasicMaterial color={color} />
      </mesh>
    </group>
  );
};

import React, { useCallback } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useEditorStore } from '@/store/editorStore';

function collectPointsObjects(root: THREE.Object3D): THREE.Points[] {
  const result: THREE.Points[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Points) {
      result.push(obj);
    }
  });
  return result;
}

export const CursorTracker: React.FC = () => {
  const { scene, camera, gl } = useThree();
  const setCursorPosition = useEditorStore((s) => s.setCursorPosition);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const canvas = gl.domElement;
    const rect = canvas.getBoundingClientRect();

    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    const raycaster = new THREE.Raycaster();
    raycaster.params.Points = { threshold: 0.3 };
    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    const pointsObjects = collectPointsObjects(scene);
    const intersects = raycaster.intersectObjects(pointsObjects, false);

    if (intersects.length > 0) {
      const point = intersects[0].point;
      setCursorPosition({
        x: parseFloat(point.x.toFixed(3)),
        y: parseFloat(point.y.toFixed(3)),
        z: parseFloat(point.z.toFixed(3)),
      });
    } else {
      setCursorPosition(null);
    }
  }, [scene, camera, gl, setCursorPosition]);

  const handlePointerLeave = useCallback(() => {
    setCursorPosition(null);
  }, [setCursorPosition]);

  React.useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, [gl, handlePointerMove, handlePointerLeave]);

  return null;
};

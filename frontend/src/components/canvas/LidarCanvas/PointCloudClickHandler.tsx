import React, { useCallback, useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { Point3D } from '@/types';

interface PointCloudClickHandlerProps {
  onPointClick?: (point: Point3D) => void;
}

export const PointCloudClickHandler: React.FC<PointCloudClickHandlerProps> = ({ onPointClick }) => {
  const { scene, camera, gl } = useThree();
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = useCallback((e: PointerEvent) => {
    pointerDownPos.current = { x: e.clientX, y: e.clientY };
  }, []);

  const handleClick = useCallback(
    (e: MouseEvent) => {
      if (!onPointClick) return;

      if (e.detail !== 1) return;

      if (pointerDownPos.current) {
        const dx = e.clientX - pointerDownPos.current.x;
        const dy = e.clientY - pointerDownPos.current.y;
        if (dx * dx + dy * dy > 9) return;
      }

      const canvas = gl.domElement;
      const rect = canvas.getBoundingClientRect();
      const ndcX = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const ndcY = -((e.clientY - rect.top) / rect.height) * 2 + 1;

      const raycaster = new THREE.Raycaster();
      raycaster.params.Points = { threshold: 0.3 };
      raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), camera);

      const pointObjects: THREE.Object3D[] = [];
      scene.traverse((obj) => {
        if ((obj as THREE.Points).isPoints) {
          pointObjects.push(obj);
        }
      });

      if (pointObjects.length === 0) return;

      const intersects = raycaster.intersectObjects(pointObjects, false);
      if (intersects.length > 0) {
        const pt = intersects[0].point;
        onPointClick({
          x: parseFloat(pt.x.toFixed(3)),
          y: parseFloat(pt.y.toFixed(3)),
          z: parseFloat(pt.z.toFixed(3)),
        });
      }
    },
    [scene, camera, gl, onPointClick],
  );

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('click', handleClick);
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('click', handleClick);
    };
  }, [gl, handlePointerDown, handleClick]);

  return null;
};

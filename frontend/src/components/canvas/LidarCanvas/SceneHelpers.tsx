import React, { useRef, useEffect } from 'react';
import * as THREE from 'three';

export const GroundGrid: React.FC = () => {
  const ref = useRef<THREE.GridHelper>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.raycast = () => {};
    }
  }, []);

  return (
    <gridHelper
      ref={ref}
      args={[200, 200, '#334155', '#1e293b']}
      rotation={[Math.PI / 2, 0, 0]}
      position={[0, 0, -2]}
    />
  );
};

export const AxesIndicator: React.FC = () => {
  const ref = useRef<THREE.AxesHelper>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.raycast = () => {};
    }
  }, []);

  return (
    <group position={[-45, -45, 0]}>
      <axesHelper ref={ref} args={[5]} />
    </group>
  );
};

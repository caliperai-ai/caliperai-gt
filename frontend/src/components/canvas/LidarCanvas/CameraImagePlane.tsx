import React, { useRef, useMemo } from 'react';
import * as THREE from 'three';
import { useTexture } from '@react-three/drei';
import type { CameraCalibration, IntrinsicCalibration, ExtrinsicCalibration } from '@/types';

interface CameraImagePlaneProps {
  imageUrl: string;
  calibration: CameraCalibration;
  planeDistance?: number;
  opacity?: number;
  visible?: boolean;
}

function invertExtrinsic(extrinsic: ExtrinsicCalibration): { rotation: number[][], translation: number[] } {
  const R = extrinsic.rotation;
  const t = extrinsic.translation;

  const Rt = [
    [R[0][0], R[1][0], R[2][0]],
    [R[0][1], R[1][1], R[2][1]],
    [R[0][2], R[1][2], R[2][2]],
  ];

  const tInv = [
    -(Rt[0][0] * t[0] + Rt[0][1] * t[1] + Rt[0][2] * t[2]),
    -(Rt[1][0] * t[0] + Rt[1][1] * t[1] + Rt[1][2] * t[2]),
    -(Rt[2][0] * t[0] + Rt[2][1] * t[1] + Rt[2][2] * t[2]),
  ];

  return { rotation: Rt, translation: tInv };
}

function getCameraPositionInLidar(extrinsic: ExtrinsicCalibration): THREE.Vector3 {
  const inverted = invertExtrinsic(extrinsic);
  return new THREE.Vector3(
    inverted.translation[0],
    inverted.translation[1],
    inverted.translation[2]
  );
}

function getCameraRotationInLidar(extrinsic: ExtrinsicCalibration): THREE.Matrix4 {
  const inverted = invertExtrinsic(extrinsic);
  const R = inverted.rotation;

  const matrix = new THREE.Matrix4();
  matrix.set(
    R[0][0], R[0][1], R[0][2], 0,
    R[1][0], R[1][1], R[1][2], 0,
    R[2][0], R[2][1], R[2][2], 0,
    0, 0, 0, 1
  );

  return matrix;
}

function calculatePlaneSize(
  intrinsic: IntrinsicCalibration,
  distance: number,
  imageWidth: number = 1600,
  imageHeight: number = 900
): { width: number; height: number } {
  const { fx, fy } = intrinsic;

  const fovX = 2 * Math.atan(imageWidth / (2 * fx));
  const fovY = 2 * Math.atan(imageHeight / (2 * fy));

  const width = 2 * distance * Math.tan(fovX / 2);
  const height = 2 * distance * Math.tan(fovY / 2);

  return { width, height };
}

export const CameraImagePlane: React.FC<CameraImagePlaneProps> = ({
  imageUrl,
  calibration,
  planeDistance = 15,
  opacity = 0.7,
  visible = true,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);

  const texture = useTexture(imageUrl);

  const { cameraPosition, cameraMatrix, planeSize } = useMemo(() => {
    const pos = getCameraPositionInLidar(calibration.extrinsic);
    const rot = getCameraRotationInLidar(calibration.extrinsic);
    const size = calculatePlaneSize(calibration.intrinsic, planeDistance);

    return {
      cameraPosition: pos,
      cameraMatrix: rot,
      planeSize: size,
    };
  }, [calibration, planeDistance]);

  const planePosition = useMemo(() => {
    const viewDir = new THREE.Vector3(0, 0, 1);
    viewDir.applyMatrix4(cameraMatrix);

    return cameraPosition.clone().add(viewDir.multiplyScalar(planeDistance));
  }, [cameraPosition, cameraMatrix, planeDistance]);

  const planeRotation = useMemo(() => {
    const euler = new THREE.Euler();
    euler.setFromRotationMatrix(cameraMatrix);
    return euler;
  }, [cameraMatrix]);

  if (!visible) return null;

  return (
    <mesh
      ref={meshRef}
      position={planePosition}
      rotation={planeRotation}
    >
      <planeGeometry args={[planeSize.width, planeSize.height]} />
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={opacity}
        side={THREE.DoubleSide}
        depthWrite={false}
      />
    </mesh>
  );
};

interface CameraFrustumProps {
  calibration: CameraCalibration;
  frustumLength?: number;
  color?: string;
  visible?: boolean;
}

export const CameraFrustum: React.FC<CameraFrustumProps> = ({
  calibration,
  frustumLength = 20,
  color = '#00ff00',
  visible = true,
}) => {
  const lines = useMemo(() => {
    const cameraPos = getCameraPositionInLidar(calibration.extrinsic);
    const rotMatrix = getCameraRotationInLidar(calibration.extrinsic);

    const { fx, fy, cx, cy } = calibration.intrinsic;
    const imgW = 1600, imgH = 900;

    const corners = [
      new THREE.Vector3((0 - cx) / fx, (0 - cy) / fy, 1).normalize(),
      new THREE.Vector3((imgW - cx) / fx, (0 - cy) / fy, 1).normalize(),
      new THREE.Vector3((imgW - cx) / fx, (imgH - cy) / fy, 1).normalize(),
      new THREE.Vector3((0 - cx) / fx, (imgH - cy) / fy, 1).normalize(),
    ];

    const transformedCorners = corners.map(c => {
      const tc = c.clone().applyMatrix4(rotMatrix);
      return cameraPos.clone().add(tc.multiplyScalar(frustumLength));
    });

    const points: THREE.Vector3[] = [];

    for (const corner of transformedCorners) {
      points.push(cameraPos.clone(), corner);
    }

    for (let i = 0; i < 4; i++) {
      points.push(transformedCorners[i], transformedCorners[(i + 1) % 4]);
    }

    return points;
  }, [calibration, frustumLength]);

  if (!visible) return null;

  return (
    <lineSegments>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={lines.length}
          array={new Float32Array(lines.flatMap(v => [v.x, v.y, v.z]))}
          itemSize={3}
        />
      </bufferGeometry>
      <lineBasicMaterial color={color} transparent opacity={0.5} />
    </lineSegments>
  );
};

export default CameraImagePlane;

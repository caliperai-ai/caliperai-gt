import React, { useRef, useEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore } from '@/store/editorStore';
import type { CameraCalibration, ExtrinsicCalibration, IntrinsicCalibration, CuboidData } from '@/types';

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

function buildProjectionMatrix(
  intrinsic: IntrinsicCalibration,
  imageWidth: number,
  imageHeight: number,
  near: number,
  far: number
): THREE.Matrix4 {
  const { fx, fy, cx, cy } = intrinsic;


  const fxNorm = fx / imageWidth;
  const fyNorm = fy / imageHeight;
  const cxNorm = cx / imageWidth;
  const cyNorm = cy / imageHeight;

  const left = -cxNorm * 2 * near / (fxNorm * 2);
  const right = (1 - cxNorm) * 2 * near / (fxNorm * 2);
  const bottom = -(1 - cyNorm) * 2 * near / (fyNorm * 2);
  const top = cyNorm * 2 * near / (fyNorm * 2);

  const matrix = new THREE.Matrix4();
  matrix.makePerspective(left, right, top, bottom, near, far);

  return matrix;
}

export interface CameraControllerProps {
  disabled?: boolean;
  centerTarget?: { x: number; y: number; z: number };
  cameraCalibrations?: Record<string, CameraCalibration>;
}

const DEFAULT_PERSPECTIVE = { position: new THREE.Vector3(0, -8, 5), target: new THREE.Vector3(0, 30, 0) };
const TOP_VIEW_HEIGHT = 100;

export const CameraController: React.FC<CameraControllerProps> = ({
  disabled = false,
  centerTarget,
  cameraCalibrations,
}) => {
  const { camera } = useThree();
  const { lidarView, annotations } = useEditorStore();
  const focusOnAnnotation = useEditorStore((s) => s.focusOnAnnotation);
  const focusOnPosition = useEditorStore((s) => s.focusOnPosition);
  const controlsRef = useRef<any>(null);
  const lastCenterRef = useRef<string>('');
  const lastCameraViewRef = useRef<string | null>(null);
  const lastTopViewRef = useRef<boolean>(false);
  const lastFocusedAnnotationRef = useRef<string | undefined>(undefined);
  const lastFocusedPositionRef = useRef<{ x: number; y: number; z: number } | undefined>(undefined);
  const defaultCameraState = useRef<{ position: THREE.Vector3, fov: number }>({
    position: new THREE.Vector3(0, -8, 5),
    fov: 60
  });

  useEffect(() => {
    if (camera instanceof THREE.PerspectiveCamera) {
      defaultCameraState.current = {
        position: camera.position.clone(),
        fov: camera.fov,
      };
    }
  }, []);

  useEffect(() => {
    const { position, target } = lidarView.camera;
    camera.position.set(position.x, position.y, position.z);
    camera.up.set(0, 0, 1);
    if (controlsRef.current) {
      controlsRef.current.target.set(target.x, target.y, target.z);
      controlsRef.current.update();
    }
  }, []);

  useEffect(() => {
    if (lidarView.cameraView.isActive) return;

    const isTopView = lidarView.isTopView;

    if (isTopView !== lastTopViewRef.current) {
      lastTopViewRef.current = isTopView;

      if (isTopView) {

        const currentTarget = controlsRef.current?.target?.clone() || new THREE.Vector3(0, 0, 0);

        camera.position.set(currentTarget.x, currentTarget.y, TOP_VIEW_HEIGHT);
        camera.up.set(0, 1, 0);
        camera.lookAt(currentTarget.x, currentTarget.y, 0);

        if (controlsRef.current) {
          controlsRef.current.target.set(currentTarget.x, currentTarget.y, 0);
          controlsRef.current.enableRotate = false;
        }
      } else {
        camera.position.copy(DEFAULT_PERSPECTIVE.position);
        camera.up.set(0, 0, 1);
        camera.lookAt(DEFAULT_PERSPECTIVE.target);

        if (controlsRef.current) {
          controlsRef.current.target.copy(DEFAULT_PERSPECTIVE.target);
          controlsRef.current.enableRotate = true;
          controlsRef.current.update();
        }
      }
    }
  }, [lidarView.isTopView, lidarView.cameraView.isActive, camera]);

  useEffect(() => {
    const focusedId = lidarView.focusedAnnotationId;

    if (focusedId !== lastFocusedAnnotationRef.current) {
      lastFocusedAnnotationRef.current = focusedId;

      if (focusedId) {
        const annotation = annotations.get(focusedId);
        if (annotation && annotation.type === 'cuboid') {
          const data = annotation.data as CuboidData;
          const center = data.center;
          const dimensions = data.dimensions;

          const diagonal = Math.sqrt(
            dimensions.length ** 2 + dimensions.width ** 2 + dimensions.height ** 2
          );
          const optimalDistance = Math.max(diagonal * 2.5, 8);

          const direction = new THREE.Vector3()
            .subVectors(camera.position, controlsRef.current?.target || new THREE.Vector3())
            .normalize();

          if (direction.length() < 0.1) {
            direction.set(-0.5, -0.7, 0.5).normalize();
          }

          const newTarget = new THREE.Vector3(center.x, center.y, center.z);
          const newPosition = newTarget.clone().add(direction.multiplyScalar(optimalDistance));

          camera.position.copy(newPosition);

          camera.up.set(0, 0, 1);

          if (controlsRef.current) {
            controlsRef.current.target.copy(newTarget);
            controlsRef.current.enableRotate = true;
            controlsRef.current.update();
          }

          lastTopViewRef.current = false;

          console.log('[3D Camera] Focused on annotation:', focusedId, 'distance:', optimalDistance);
        }

        focusOnAnnotation(undefined);
      }
    }
  }, [lidarView.focusedAnnotationId, annotations, camera, focusOnAnnotation]);

  useEffect(() => {
    const focusedPos = lidarView.focusedPosition;
    const lastPos = lastFocusedPositionRef.current;

    const posChanged = focusedPos && (!lastPos ||
      focusedPos.x !== lastPos.x ||
      focusedPos.y !== lastPos.y ||
      focusedPos.z !== lastPos.z);

    if (posChanged && focusedPos) {
      lastFocusedPositionRef.current = focusedPos;

      const optimalDistance = 5;

      const direction = new THREE.Vector3()
        .subVectors(camera.position, controlsRef.current?.target || new THREE.Vector3())
        .normalize();

      if (direction.length() < 0.1) {
        direction.set(-0.5, -0.7, 0.5).normalize();
      }

      const newTarget = new THREE.Vector3(focusedPos.x, focusedPos.y, focusedPos.z);
      const newPosition = newTarget.clone().add(direction.multiplyScalar(optimalDistance));

      camera.position.copy(newPosition);

      camera.up.set(0, 0, 1);

      if (controlsRef.current) {
        controlsRef.current.target.copy(newTarget);
        controlsRef.current.enableRotate = true;
        controlsRef.current.update();
      }

      lastTopViewRef.current = false;

      console.log('[3D Camera] Focused on position:', focusedPos, 'distance:', optimalDistance);

      focusOnPosition(undefined);
    } else if (!focusedPos) {
      lastFocusedPositionRef.current = undefined;
    }
  }, [lidarView.focusedPosition, camera, focusOnPosition]);

  const lastResetCounterRef = useRef<number>(0);
  useEffect(() => {
    if (lidarView.cameraView.isActive) return;

    const resetCounter = lidarView.cameraResetCounter;

    if (resetCounter > lastResetCounterRef.current) {
      lastResetCounterRef.current = resetCounter;

      camera.position.copy(DEFAULT_PERSPECTIVE.position);
      camera.up.set(0, 0, 1);
      camera.lookAt(DEFAULT_PERSPECTIVE.target);

      if (controlsRef.current) {
        controlsRef.current.target.copy(DEFAULT_PERSPECTIVE.target);
        controlsRef.current.enableRotate = true;
        controlsRef.current.update();
      }

      lastTopViewRef.current = false;
    }
  }, [lidarView.cameraResetCounter, lidarView.cameraView.isActive, camera]);

  useEffect(() => {
    const { cameraView } = lidarView;

    if (!(camera instanceof THREE.PerspectiveCamera)) return;

    if (!cameraView.isActive || !cameraView.cameraId || !cameraCalibrations) {
      if (lastCameraViewRef.current !== null) {
        lastCameraViewRef.current = null;

        camera.fov = defaultCameraState.current.fov;
        camera.position.set(0, -8, 5);
        camera.up.set(0, 0, 1);
        camera.updateProjectionMatrix();

        if (controlsRef.current) {
          controlsRef.current.target.set(0, 30, 0);
          controlsRef.current.update();
        }
      }
      return;
    }

    const calibration = cameraCalibrations[cameraView.cameraId];
    if (!calibration || !calibration.extrinsic || !calibration.intrinsic) {
      console.warn('[CameraController] Incomplete calibration data for camera:', cameraView.cameraId);
      return;
    }

    const modeKey = `${cameraView.cameraId}-${cameraView.frustumOnlyMode ? 'frustum' : 'overlay'}`;
    const cameraChanged = lastCameraViewRef.current !== modeKey;

    if (!cameraChanged) return;

    lastCameraViewRef.current = modeKey;

    // Get camera position in LiDAR frame
    const inverted = invertExtrinsic(calibration.extrinsic);

    // Camera position in LiDAR frame
    const camPos = new THREE.Vector3(
      inverted.translation[0],
      inverted.translation[1],
      inverted.translation[2]
    );

    // The inverted rotation R^T tells us where camera axes point in LiDAR frame.
    // In OpenCV camera frame: X = right, Y = down, Z = forward (optical axis)
    // Each COLUMN of R^T represents where a camera axis points in LiDAR frame:
    // - Column 0: Camera X (right) in LiDAR
    // - Column 1: Camera Y (down) in LiDAR
    // - Column 2: Camera Z (optical/forward) in LiDAR
    const R = inverted.rotation;
    // const camRight = new THREE.Vector3(R[0][0], R[1][0], R[2][0]);  // Column 0 = camera X (right)
    const camDown = new THREE.Vector3(R[0][1], R[1][1], R[2][1]);    // Column 1 = camera Y (down)
    const camForward = new THREE.Vector3(R[0][2], R[1][2], R[2][2]); // Column 2 = camera Z (optical/forward)

    // Camera up is opposite of camera down
    const camUp = camDown.clone().negate();

    // Set camera position at the physical camera location
    camera.position.copy(camPos);

    // Set camera up vector (opposite of camera's down direction)
    camera.up.copy(camUp);

    // Look along the forward direction (camera's Z axis = optical axis)
    const lookAtPoint = camPos.clone().add(camForward.multiplyScalar(50));
    camera.lookAt(lookAtPoint);

    if (cameraView.frustumOnlyMode) {
      // In frustum-only mode: use standard perspective camera for free navigation
      // Use approximate FOV from intrinsics for initial view
      const imageWidth = calibration.intrinsic.resolution?.[0] ?? 1920;
      const fovY = 2 * Math.atan(imageWidth / (2 * calibration.intrinsic.fx)) * (180 / Math.PI);
      camera.fov = Math.min(fovY, 90); // Limit FOV to reasonable value
      camera.updateProjectionMatrix();
    } else {
      // In overlay mode: use exact projection matrix from intrinsics for pixel-perfect alignment
      const imageWidth = calibration.intrinsic.resolution?.[0] ?? 1920;
      const imageHeight = calibration.intrinsic.resolution?.[1] ?? 1080;
      const projMatrix = buildProjectionMatrix(
        calibration.intrinsic,
        imageWidth,
        imageHeight,
        0.1,   // near
        1000   // far
      );
      camera.projectionMatrix.copy(projMatrix);
      camera.projectionMatrixInverse.copy(projMatrix).invert();
    }

    // Update orbit controls to orbit around a point in front of camera
    if (controlsRef.current) {
      controlsRef.current.target.copy(camPos.clone().add(camForward.clone().normalize().multiplyScalar(20)));
      controlsRef.current.update();
    }

  }, [lidarView.cameraView, cameraCalibrations, camera]);

  // Update camera target when centerTarget changes (e.g., switching to World frame)
  useEffect(() => {
    if (!centerTarget || !controlsRef.current) return;
    if (lidarView.cameraView.isActive) return; // Don't update when in camera view mode

    // Create a key to detect actual position changes
    const centerKey = `${centerTarget.x.toFixed(2)},${centerTarget.y.toFixed(2)},${centerTarget.z.toFixed(2)}`;

    // Only update if the center actually changed
    if (centerKey !== lastCenterRef.current) {
      lastCenterRef.current = centerKey;

      // Set orbit controls target to the center position
      controlsRef.current.target.set(centerTarget.x, centerTarget.y, centerTarget.z);

      // Position camera relative to the new target (maintain offset from current position)
      const offset = new THREE.Vector3(0, -8, 5); // Default viewing offset
      camera.position.set(
        centerTarget.x + offset.x,
        centerTarget.y + offset.y,
        centerTarget.z + offset.z
      );

      controlsRef.current.update();
    }
  }, [centerTarget, camera, lidarView.cameraView.isActive]);

  // Only lock camera controls in image overlay mode, not in frustum-only mode
  const lockControls = lidarView.cameraView.isActive && !lidarView.cameraView.frustumOnlyMode;

  return (
    <OrbitControls
      ref={controlsRef}
      enabled={!disabled && !lockControls}
      enableDamping
      dampingFactor={0.1}
      rotateSpeed={0.5}
      panSpeed={0.8}
      zoomSpeed={1.2}
      mouseButtons={{
        LEFT: THREE.MOUSE.ROTATE,
        MIDDLE: THREE.MOUSE.PAN,
        RIGHT: THREE.MOUSE.PAN,
      }}
    />
  );
};

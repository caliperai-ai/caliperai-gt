
import type { CoordinateFrame, ExtrinsicCalibration, Point3D } from '@/types';


export interface EgoPose {
  position: number[];
  rotation: number[];
}

export interface FrameTransformContext {
  egoPose?: EgoPose;
  egoToLidar?: ExtrinsicCalibration;
  availableFrames: CoordinateFrame[];
}

export interface TransformResult {
  positions: Float32Array;
}


export function getAvailableFrames(
  hasEgoPose: boolean,
  hasCalibration: boolean
): CoordinateFrame[] {
  const frames: CoordinateFrame[] = ['lidar'];

  if (hasCalibration) {
    frames.push('ego');
  }

  if (hasCalibration && hasEgoPose) {
    frames.push('world');
  }

  return frames;
}

export function is4DModeAvailable(hasEgoPose: boolean, hasCalibration: boolean): boolean {
  return hasEgoPose && hasCalibration;
}


export function quaternionToMatrix(q: number[]): number[][] {
  const [qw, qx, qy, qz] = q;
  const len = Math.sqrt(qw*qw + qx*qx + qy*qy + qz*qz);
  const w = qw / len, x = qx / len, y = qy / len, z = qz / len;

  return [
    [1 - 2*(y*y + z*z), 2*(x*y - w*z), 2*(x*z + w*y)],
    [2*(x*y + w*z), 1 - 2*(x*x + z*z), 2*(y*z - w*x)],
    [2*(x*z - w*y), 2*(y*z + w*x), 1 - 2*(x*x + y*y)],
  ];
}

export function transposeMatrix(m: number[][]): number[][] {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

export function multiplyMatrices(a: number[][], b: number[][]): number[][] {
  const result: number[][] = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      result[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
    }
  }
  return result;
}

export function rotateVector(m: number[][], v: number[]): number[] {
  return [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ];
}


export function getLidarToEgoTransform(egoToLidar: ExtrinsicCalibration): {
  rotation: number[][];
  translation: number[];
} {
  const R = egoToLidar.rotation;
  const T = egoToLidar.translation;

  const R_inv = transposeMatrix(R);
  const T_inv = rotateVector(R_inv, T.map(v => -v));

  return { rotation: R_inv, translation: T_inv };
}

export function lidarToEgo(
  point: Point3D,
  egoToLidar: ExtrinsicCalibration
): Point3D {
  const { rotation: R, translation: T } = getLidarToEgoTransform(egoToLidar);

  const result = rotateVector(R, [point.x, point.y, point.z]);
  return {
    x: result[0] + T[0],
    y: result[1] + T[1],
    z: result[2] + T[2],
  };
}

export function egoToLidar(
  point: Point3D,
  egoToLidar: ExtrinsicCalibration
): Point3D {
  const R = egoToLidar.rotation;
  const T = egoToLidar.translation;

  const result = rotateVector(R, [point.x, point.y, point.z]);
  return {
    x: result[0] + T[0],
    y: result[1] + T[1],
    z: result[2] + T[2],
  };
}


export function egoToWorld(
  point: Point3D,
  egoPose: EgoPose
): Point3D {
  const R = quaternionToMatrix(egoPose.rotation);
  const T = egoPose.position;

  const result = rotateVector(R, [point.x, point.y, point.z]);
  return {
    x: result[0] + T[0],
    y: result[1] + T[1],
    z: result[2] + T[2],
  };
}

export function worldToEgo(
  point: Point3D,
  egoPose: EgoPose
): Point3D {
  const R = quaternionToMatrix(egoPose.rotation);
  const R_inv = transposeMatrix(R);
  const T = egoPose.position;

  const translated = [point.x - T[0], point.y - T[1], point.z - T[2]];
  const result = rotateVector(R_inv, translated);

  return { x: result[0], y: result[1], z: result[2] };
}


export function lidarToWorld(
  point: Point3D,
  egoPose: EgoPose,
  egoToLidarCalib: ExtrinsicCalibration
): Point3D {
  const egoPoint = lidarToEgo(point, egoToLidarCalib);
  return egoToWorld(egoPoint, egoPose);
}

export function worldToLidar(
  point: Point3D,
  egoPose: EgoPose,
  egoToLidarCalib: ExtrinsicCalibration
): Point3D {
  const egoPoint = worldToEgo(point, egoPose);
  return egoToLidar(egoPoint, egoToLidarCalib);
}


export function transformPoint(
  point: Point3D,
  fromFrame: CoordinateFrame,
  toFrame: CoordinateFrame,
  egoPose?: EgoPose,
  egoToLidarCalib?: ExtrinsicCalibration
): Point3D {
  if (fromFrame === toFrame) {
    return point;
  }

  if (fromFrame === 'lidar' && toFrame === 'ego') {
    if (!egoToLidarCalib) throw new Error('Missing calibration for LiDAR->Ego');
    return lidarToEgo(point, egoToLidarCalib);
  }

  if (fromFrame === 'ego' && toFrame === 'lidar') {
    if (!egoToLidarCalib) throw new Error('Missing calibration for Ego->LiDAR');
    return egoToLidar(point, egoToLidarCalib);
  }

  if (fromFrame === 'ego' && toFrame === 'world') {
    if (!egoPose) throw new Error('Missing ego pose for Ego->World');
    return egoToWorld(point, egoPose);
  }

  if (fromFrame === 'world' && toFrame === 'ego') {
    if (!egoPose) throw new Error('Missing ego pose for World->Ego');
    return worldToEgo(point, egoPose);
  }

  if (fromFrame === 'lidar' && toFrame === 'world') {
    if (!egoPose || !egoToLidarCalib) {
      throw new Error('Missing ego pose or calibration for LiDAR->World');
    }
    return lidarToWorld(point, egoPose, egoToLidarCalib);
  }

  if (fromFrame === 'world' && toFrame === 'lidar') {
    if (!egoPose || !egoToLidarCalib) {
      throw new Error('Missing ego pose or calibration for World->LiDAR');
    }
    return worldToLidar(point, egoPose, egoToLidarCalib);
  }

  throw new Error(`Unknown transform: ${fromFrame} -> ${toFrame}`);
}

// =============================================================================
// POINT CLOUD TRANSFORMS
// =============================================================================

/**
 * Transform entire point cloud from one frame to another
 * Optimized for Float32Array operations
 */
export function transformPointCloud(
  positions: Float32Array,
  fromFrame: CoordinateFrame,
  toFrame: CoordinateFrame,
  egoPose?: EgoPose,
  egoToLidarCalib?: ExtrinsicCalibration
): Float32Array {
  if (fromFrame === toFrame) {
    return positions;
  }

  const pointCount = positions.length / 3;
  const result = new Float32Array(positions.length);

  // Pre-compute combined transform matrices for efficiency
  let R: number[][] | null = null;
  let T: number[] | null = null;

  if (fromFrame === 'lidar' && toFrame === 'ego' && egoToLidarCalib) {
    const l2e = getLidarToEgoTransform(egoToLidarCalib);
    R = l2e.rotation;
    T = l2e.translation;
  } else if (fromFrame === 'ego' && toFrame === 'lidar' && egoToLidarCalib) {
    R = egoToLidarCalib.rotation;
    T = egoToLidarCalib.translation;
  } else if (fromFrame === 'ego' && toFrame === 'world' && egoPose) {
    R = quaternionToMatrix(egoPose.rotation);
    T = egoPose.position;
  } else if (fromFrame === 'world' && toFrame === 'ego' && egoPose) {
    R = transposeMatrix(quaternionToMatrix(egoPose.rotation));
    const invT = rotateVector(R, egoPose.position.map(v => -v));
    T = invT;
  } else if (fromFrame === 'lidar' && toFrame === 'world' && egoPose && egoToLidarCalib) {
    // Combined: R_ego * R_l2e, R_ego * T_l2e + T_ego
    const l2e = getLidarToEgoTransform(egoToLidarCalib);
    const R_ego = quaternionToMatrix(egoPose.rotation);
    R = multiplyMatrices(R_ego, l2e.rotation);
    const T_l2e_world = rotateVector(R_ego, l2e.translation);
    T = [
      T_l2e_world[0] + egoPose.position[0],
      T_l2e_world[1] + egoPose.position[1],
      T_l2e_world[2] + egoPose.position[2],
    ];
  } else if (fromFrame === 'world' && toFrame === 'lidar' && egoPose && egoToLidarCalib) {
    // Combined: R_e2l * R_ego^T, -R_e2l * R_ego^T * T_ego + T_e2l
    const R_ego_inv = transposeMatrix(quaternionToMatrix(egoPose.rotation));
    R = multiplyMatrices(egoToLidarCalib.rotation, R_ego_inv);
    const T_ego_in_ego = rotateVector(R_ego_inv, egoPose.position.map(v => -v));
    const T_ego_in_lidar = rotateVector(egoToLidarCalib.rotation, T_ego_in_ego);
    T = [
      T_ego_in_lidar[0] + egoToLidarCalib.translation[0],
      T_ego_in_lidar[1] + egoToLidarCalib.translation[1],
      T_ego_in_lidar[2] + egoToLidarCalib.translation[2],
    ];
  }

  if (!R || !T) {
    console.warn(`Cannot compute transform ${fromFrame} -> ${toFrame}, returning original`);
    return positions;
  }

  // Apply transform to all points
  for (let i = 0; i < pointCount; i++) {
    const idx = i * 3;
    const x = positions[idx];
    const y = positions[idx + 1];
    const z = positions[idx + 2];

    result[idx] = R[0][0] * x + R[0][1] * y + R[0][2] * z + T[0];
    result[idx + 1] = R[1][0] * x + R[1][1] * y + R[1][2] * z + T[1];
    result[idx + 2] = R[2][0] * x + R[2][1] * y + R[2][2] * z + T[2];
  }

  return result;
}

/**
 * Get yaw angle from rotation quaternion.
 * Auto-detects [qx,qy,qz,qw] (Waymo/scalar-last) and converts.
 */
export function getYawFromQuaternion(q: number[]): number {
  let nq = q;
  if (q.length === 4 && Math.abs(q[3]) > Math.abs(q[0]) + 0.1) {
    nq = [q[3], q[0], q[1], q[2]];
  }
  const [w, x, y, z] = nq;
  return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
}

/**
 * Transform yaw angle between frames
 */
export function transformYaw(
  yaw: number,
  fromFrame: CoordinateFrame,
  toFrame: CoordinateFrame,
  egoPose?: EgoPose,
  egoToLidarCalib?: ExtrinsicCalibration
): number {
  if (fromFrame === toFrame) return yaw;

  // Extract yaw rotation from calibration (ego_to_lidar)
  const getCalibYaw = (calib: ExtrinsicCalibration): number => {
    const R = calib.rotation;
    return Math.atan2(R[1][0], R[0][0]);
  };

  // Extract yaw from ego pose
  const getEgoYaw = (pose: EgoPose): number => {
    return getYawFromQuaternion(pose.rotation);
  };

  if (fromFrame === 'lidar' && toFrame === 'ego' && egoToLidarCalib) {
    // Lidar to Ego: subtract calibration yaw (inverse of ego_to_lidar rotation)
    return yaw - getCalibYaw(egoToLidarCalib);
  }

  if (fromFrame === 'ego' && toFrame === 'lidar' && egoToLidarCalib) {
    // Ego to Lidar: add calibration yaw
    return yaw + getCalibYaw(egoToLidarCalib);
  }

  if (fromFrame === 'ego' && toFrame === 'world' && egoPose) {
    // Ego to World: add ego yaw
    return yaw + getEgoYaw(egoPose);
  }

  if (fromFrame === 'world' && toFrame === 'ego' && egoPose) {
    // World to Ego: subtract ego yaw
    return yaw - getEgoYaw(egoPose);
  }

  if (fromFrame === 'lidar' && toFrame === 'world' && egoPose && egoToLidarCalib) {
    // Lidar to World: lidar -> ego -> world
    const egoYaw = yaw - getCalibYaw(egoToLidarCalib);
    return egoYaw + getEgoYaw(egoPose);
  }

  if (fromFrame === 'world' && toFrame === 'lidar' && egoPose && egoToLidarCalib) {
    // World to Lidar: world -> ego -> lidar
    const egoYaw = yaw - getEgoYaw(egoPose);
    return egoYaw + getCalibYaw(egoToLidarCalib);
  }

  return yaw;
}



export interface EgoPose {
  position: number[];
  rotation: number[];
}

export interface LidarToEgoTransform {
  rotation: number[][];
  translation: number[];
}

export interface EgoToLidarCalibration {
  rotation: number[][];
  translation: number[];
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}


export function quaternionToRotationMatrix(q: number[]): number[][] {
  const [w, x, y, z] = q;
  const len = Math.sqrt(w*w + x*x + y*y + z*z);
  if (len < 1e-6) return [[1,0,0], [0,1,0], [0,0,1]];

  const nw = w/len, nx = x/len, ny = y/len, nz = z/len;

  return [
    [1 - 2*(ny*ny + nz*nz), 2*(nx*ny - nw*nz), 2*(nx*nz + nw*ny)],
    [2*(nx*ny + nw*nz), 1 - 2*(nx*nx + nz*nz), 2*(ny*nz - nw*nx)],
    [2*(nx*nz - nw*ny), 2*(ny*nz + nw*nx), 1 - 2*(nx*nx + ny*ny)],
  ];
}

function transposeMatrix(R: number[][]): number[][] {
  return [
    [R[0][0], R[1][0], R[2][0]],
    [R[0][1], R[1][1], R[2][1]],
    [R[0][2], R[1][2], R[2][2]],
  ];
}


export function getLidarToEgoTransform(
  egoToLidar?: EgoToLidarCalibration
): LidarToEgoTransform | undefined {
  if (!egoToLidar) return undefined;

  const R = egoToLidar.rotation;
  const T = egoToLidar.translation;

  const R_inv = transposeMatrix(R);

  const T_inv = [
    -(R_inv[0][0]*T[0] + R_inv[0][1]*T[1] + R_inv[0][2]*T[2]),
    -(R_inv[1][0]*T[0] + R_inv[1][1]*T[1] + R_inv[1][2]*T[2]),
    -(R_inv[2][0]*T[0] + R_inv[2][1]*T[1] + R_inv[2][2]*T[2]),
  ];

  return { rotation: R_inv, translation: T_inv };
}

export function getEgoToLidarTransform(
  egoToLidar?: EgoToLidarCalibration
): LidarToEgoTransform | undefined {
  if (!egoToLidar) return undefined;
  return {
    rotation: egoToLidar.rotation,
    translation: egoToLidar.translation,
  };
}


export function transformToWorld(
  point: Point3D,
  egoPose: EgoPose,
  lidarToEgo?: LidarToEgoTransform
): Point3D {
  const { x, y, z } = point;

  let ex = x, ey = y, ez = z;
  if (lidarToEgo) {
    const R = lidarToEgo.rotation;
    const T = lidarToEgo.translation;
    ex = R[0][0]*x + R[0][1]*y + R[0][2]*z + T[0];
    ey = R[1][0]*x + R[1][1]*y + R[1][2]*z + T[1];
    ez = R[2][0]*x + R[2][1]*y + R[2][2]*z + T[2];
  }

  const R_ego = quaternionToRotationMatrix(egoPose.rotation);
  const T_ego = egoPose.position;

  const wx = R_ego[0][0]*ex + R_ego[0][1]*ey + R_ego[0][2]*ez + T_ego[0];
  const wy = R_ego[1][0]*ex + R_ego[1][1]*ey + R_ego[1][2]*ez + T_ego[1];
  const wz = R_ego[2][0]*ex + R_ego[2][1]*ey + R_ego[2][2]*ez + T_ego[2];

  return { x: wx, y: wy, z: wz };
}


export function transformFromWorld(
  worldPoint: Point3D,
  egoPose: EgoPose,
  egoToLidar?: EgoToLidarCalibration
): Point3D {
  const { x: wx, y: wy, z: wz } = worldPoint;

  const R_ego = quaternionToRotationMatrix(egoPose.rotation);
  const R_ego_T = transposeMatrix(R_ego);
  const T_ego = egoPose.position;

  const dx = wx - T_ego[0];
  const dy = wy - T_ego[1];
  const dz = wz - T_ego[2];

  const ex = R_ego_T[0][0]*dx + R_ego_T[0][1]*dy + R_ego_T[0][2]*dz;
  const ey = R_ego_T[1][0]*dx + R_ego_T[1][1]*dy + R_ego_T[1][2]*dz;
  const ez = R_ego_T[2][0]*dx + R_ego_T[2][1]*dy + R_ego_T[2][2]*dz;

  if (egoToLidar) {
    const R = egoToLidar.rotation;
    const T = egoToLidar.translation;
    const lx = R[0][0]*ex + R[0][1]*ey + R[0][2]*ez + T[0];
    const ly = R[1][0]*ex + R[1][1]*ey + R[1][2]*ez + T[1];
    const lz = R[2][0]*ex + R[2][1]*ey + R[2][2]*ez + T[2];
    return { x: lx, y: ly, z: lz };
  }

  return { x: ex, y: ey, z: ez };
}

export function transformYawFromWorld(
  worldYaw: number,
  egoPose: EgoPose,
  egoToLidar?: EgoToLidarCalibration
): number {
  const R_ego = quaternionToRotationMatrix(egoPose.rotation);
  const egoYaw = Math.atan2(R_ego[1][0], R_ego[0][0]);

  let lidarYaw = worldYaw - egoYaw;

  if (egoToLidar) {
    const R_e2l = egoToLidar.rotation;
    const e2lYaw = Math.atan2(R_e2l[1][0], R_e2l[0][0]);
    lidarYaw = lidarYaw + e2lYaw;
  }

  while (lidarYaw > Math.PI) lidarYaw -= 2 * Math.PI;
  while (lidarYaw < -Math.PI) lidarYaw += 2 * Math.PI;

  return lidarYaw;
}


export function computeLidarCoordsForFrames(
  worldCenter: Point3D,
  worldYaw: number,
  frames: Array<{ id: string; ego_pose?: EgoPose }>,
  egoToLidar?: EgoToLidarCalibration
): Record<string, { center: Point3D; rotation: { yaw: number; pitch: number; roll: number } }> {
  const result: Record<string, { center: Point3D; rotation: { yaw: number; pitch: number; roll: number } }> = {};

  for (const frame of frames) {
    if (!frame.ego_pose) {
      console.warn(`[worldTransforms] Frame ${frame.id} missing ego_pose, using identity`);
      // Use world coords as fallback
      result[frame.id] = {
        center: worldCenter,
        rotation: { yaw: worldYaw, pitch: 0, roll: 0 },
      };
      continue;
    }

    // Transform center from world to LiDAR for this frame
    const lidarCenter = transformFromWorld(worldCenter, frame.ego_pose, egoToLidar);

    // Transform yaw from world to LiDAR for this frame
    const lidarYaw = transformYawFromWorld(worldYaw, frame.ego_pose, egoToLidar);

    result[frame.id] = {
      center: lidarCenter,
      rotation: { yaw: lidarYaw, pitch: 0, roll: 0 },
    };
  }

  return result;
}

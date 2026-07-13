
interface ScanData {
  positions: Float32Array | number[];
  intensities: Float32Array | number[];
  pointCount: number;
  egoPose: {
    position: number[];
    rotation: number[];
  } | null;
}

interface WorkerInput {
  type: 'stack';
  scans: ScanData[];
  calibration: {
    rotation: number[][];
    translation: number[];
  } | null;
  voxelSize: number;
  maxPoints: number;
}

interface WorkerOutput {
  type: 'result';
  positions: Float32Array;
  intensities: Float32Array;
  pointCount: number;
  origin: [number, number, number];
}

interface WorkerError {
  type: 'error';
  message: string;
}

function quaternionToRotationMatrix(q: number[]): number[][] {
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

function transformToWorld(
  x: number, y: number, z: number,
  egoPose: { position: number[]; rotation: number[] },
  lidarToEgo?: { rotation: number[][]; translation: number[] }
): [number, number, number] {
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

  return [wx, wy, wz];
}

function getLidarToEgoTransform(egoToLidar: { rotation: number[][]; translation: number[] } | null | undefined) {
  if (!egoToLidar) return undefined;

  const R = egoToLidar.rotation;
  const T = egoToLidar.translation;

  const R_inv = [
    [R[0][0], R[1][0], R[2][0]],
    [R[0][1], R[1][1], R[2][1]],
    [R[0][2], R[1][2], R[2][2]],
  ];

  const T_inv = [
    -(R_inv[0][0]*T[0] + R_inv[0][1]*T[1] + R_inv[0][2]*T[2]),
    -(R_inv[1][0]*T[0] + R_inv[1][1]*T[1] + R_inv[1][2]*T[2]),
    -(R_inv[2][0]*T[0] + R_inv[2][1]*T[1] + R_inv[2][2]*T[2]),
  ];

  return { rotation: R_inv, translation: T_inv };
}

const HASH_PRIME1 = 73856093;
const HASH_PRIME2 = 19349663;
const HASH_PRIME3 = 83492791;

function hashVoxel(vx: number, vy: number, vz: number): number {
  return ((vx * HASH_PRIME1) ^ (vy * HASH_PRIME2) ^ (vz * HASH_PRIME3)) | 0;
}

function stackPointClouds(input: WorkerInput): WorkerOutput | WorkerError {
  try {
    const { scans, calibration, voxelSize, maxPoints } = input;

    if (scans.length === 0) {
      return { type: 'error', message: 'No scans provided' };
    }

    const lidarToEgo = getLidarToEgoTransform(calibration);

    const firstScan = scans[0];
    const origin: [number, number, number] = [
      firstScan.egoPose?.position?.[0] || 0,
      firstScan.egoPose?.position?.[1] || 0,
      firstScan.egoPose?.position?.[2] || 0,
    ];

    const safeMaxPoints = Math.min(Math.max(maxPoints, 10000), 200000);
    const outputPositions = new Float32Array(safeMaxPoints * 3);
    const outputIntensities = new Float32Array(safeMaxPoints);

    let writeIdx = 0;

    const voxelMap = new Map<number, boolean>();

    const totalInputPoints = scans.reduce((sum, s) => sum + s.pointCount, 0);
    const skipFactor = Math.max(1, Math.floor(totalInputPoints / safeMaxPoints));

    let pointIndex = 0;

    for (const scan of scans) {
      const egoPose = scan.egoPose;
      const hasValidPose = egoPose && egoPose.position && egoPose.rotation;

      for (let i = 0; i < scan.pointCount; i++) {
        pointIndex++;
        if (pointIndex % skipFactor !== 0) continue;
        if (writeIdx >= safeMaxPoints) break;

        const x = scan.positions[i * 3];
        const y = scan.positions[i * 3 + 1];
        const z = scan.positions[i * 3 + 2];

        if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;

        let wx: number, wy: number, wz: number;

        if (hasValidPose) {
          [wx, wy, wz] = transformToWorld(x, y, z, egoPose!, lidarToEgo);
        } else {
          wx = x; wy = y; wz = z;
        }

        if (!isFinite(wx) || !isFinite(wy) || !isFinite(wz)) continue;

        wx -= origin[0];
        wy -= origin[1];
        wz -= origin[2];

        const vx = (wx / voxelSize) | 0;
        const vy = (wy / voxelSize) | 0;
        const vz = (wz / voxelSize) | 0;
        const hash = hashVoxel(vx, vy, vz);

        if (voxelMap.has(hash)) continue;
        voxelMap.set(hash, true);

        const idx = writeIdx * 3;
        outputPositions[idx] = wx;
        outputPositions[idx + 1] = wy;
        outputPositions[idx + 2] = wz;
        outputIntensities[writeIdx] = scan.intensities[i];
        writeIdx++;
      }

      if (writeIdx >= safeMaxPoints) break;
    }

    return {
      type: 'result',
      positions: outputPositions.subarray(0, writeIdx * 3),
      intensities: outputIntensities.subarray(0, writeIdx),
      pointCount: writeIdx,
      origin,
    };
  } catch (error) {
    return { type: 'error', message: String(error) };
  }
}

self.onmessage = (event: MessageEvent<WorkerInput>) => {
  const result = stackPointClouds(event.data);

  if (result.type === 'result') {
    const transferables: Transferable[] = [
      result.positions.buffer as ArrayBuffer,
      result.intensities.buffer as ArrayBuffer,
    ];
    (self as unknown as Worker).postMessage(result, transferables);
  } else {
    self.postMessage(result);
  }
};

export {};


import { StreamingVoxelGrid } from './pointCloudOctree';

export interface EgoPose {
  position: number[];
  rotation: number[];
  velocity?: number[];
}

export interface TransformMatrix {
  rotation: number[][];
  translation: number[];
}

export interface EgoToLidarCalibration {
  rotation: number[][];
  translation: number[];
}

export function getLidarToEgoTransform(egoToLidar: EgoToLidarCalibration | undefined): TransformMatrix {
  if (!egoToLidar) {
    return {
      rotation: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      translation: [0, 0, 0],
    };
  }

  const R_e2l = egoToLidar.rotation;
  const T_e2l = egoToLidar.translation;

  const R_l2e = transposeMatrix3(R_e2l);

  const T_l2e = rotateVector(R_l2e, T_e2l.map(v => -v));

  return {
    rotation: R_l2e,
    translation: T_l2e,
  };
}

export function transformLidarToWorld(
  positions: Float32Array | number[],
  egoPose: EgoPose,
  lidarToEgo: TransformMatrix
): Float32Array {
  const posArr = positions instanceof Float32Array ? positions : new Float32Array(positions);
  const pointCount = posArr.length / 3;
  const result = new Float32Array(posArr.length);

  if (!egoPose || !egoPose.position || !egoPose.rotation) {
    console.error('[transformLidarToWorld] Invalid ego pose, returning original positions:', egoPose);
    return posArr instanceof Float32Array ? posArr : new Float32Array(posArr);
  }

  const R_ego = quaternionToRotationMatrix(egoPose.rotation);
  const T_ego = egoPose.position;

  const R_combined = multiplyMatrix3(R_ego, lidarToEgo.rotation);

  const T_l2e_in_world = rotateVector(R_ego, lidarToEgo.translation);
  const T_combined = [
    T_l2e_in_world[0] + T_ego[0],
    T_l2e_in_world[1] + T_ego[1],
    T_l2e_in_world[2] + T_ego[2],
  ];

  for (let i = 0; i < pointCount; i++) {
    const idx = i * 3;
    const x = posArr[idx];
    const y = posArr[idx + 1];
    const z = posArr[idx + 2];

    result[idx] = R_combined[0][0] * x + R_combined[0][1] * y + R_combined[0][2] * z + T_combined[0];
    result[idx + 1] = R_combined[1][0] * x + R_combined[1][1] * y + R_combined[1][2] * z + T_combined[1];
    result[idx + 2] = R_combined[2][0] * x + R_combined[2][1] * y + R_combined[2][2] * z + T_combined[2];
  }

  return result;
}

export function getYawFromRotation(rotation: number[]): number {
  if (rotation.length === 3) {
    return rotation[0];
  } else if (rotation.length === 4) {
    const [w, x, y, z] = rotation;
    return Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z));
  }
  return 0;
}

export function quaternionToRotationMatrix(q: number[]): number[][] {
  const [qw, qx, qy, qz] = q;

  const len = Math.sqrt(qw*qw + qx*qx + qy*qy + qz*qz);

  if (len < 1e-6) {
    return [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1]
    ];
  }

  const w = qw / len, x = qx / len, y = qy / len, z = qz / len;

  return [
    [1 - 2*(y*y + z*z), 2*(x*y - w*z), 2*(x*z + w*y)],
    [2*(x*y + w*z), 1 - 2*(x*x + z*z), 2*(y*z - w*x)],
    [2*(x*z - w*y), 2*(y*z + w*x), 1 - 2*(x*x + y*y)],
  ];
}

export function transposeMatrix3(m: number[][]): number[][] {
  return [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ];
}

export function multiplyMatrix3(a: number[][], b: number[][]): number[][] {
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

export function computeRelativeTransform(
  sourcePose: EgoPose,
  targetPose: EgoPose,
  debug: boolean = false
): TransformMatrix {
  const [sx, sy, sz] = sourcePose.position;
  const [tx, ty, tz] = targetPose.position;

  const R_source = quaternionToRotationMatrix(sourcePose.rotation);
  const R_target = quaternionToRotationMatrix(targetPose.rotation);

  const R_target_inv = transposeMatrix3(R_target);

  const R_combined = multiplyMatrix3(R_target_inv, R_source);

  const dT_world = [sx - tx, sy - ty, sz - tz];

  const translation = rotateVector(R_target_inv, dT_world);

  if (debug) {
  }

  return {
    rotation: R_combined,
    translation,
  };
}

export function transformPointCloud(
  positions: Float32Array,
  transform: TransformMatrix
): Float32Array {
  const result = new Float32Array(positions.length);
  const pointCount = positions.length / 3;

  const R = transform.rotation;
  const T = transform.translation;

  for (let i = 0; i < pointCount; i++) {
    const idx = i * 3;
    const x = positions[idx];
    const y = positions[idx + 1];
    const z = positions[idx + 2];

    const rx = R[0][0] * x + R[0][1] * y + R[0][2] * z;
    const ry = R[1][0] * x + R[1][1] * y + R[1][2] * z;
    const rz = R[2][0] * x + R[2][1] * y + R[2][2] * z;

    result[idx] = rx + T[0];
    result[idx + 1] = ry + T[1];
    result[idx + 2] = rz + T[2];
  }

  return result;
}

export function downsamplePointCloud(
  positions: Float32Array | number[],
  intensities: Float32Array | number[],
  factor: number
): { positions: Float32Array; intensities: Float32Array; pointCount: number } {
  const posArr = positions instanceof Float32Array ? positions : new Float32Array(positions);
  const intArr = intensities instanceof Float32Array ? intensities : new Float32Array(intensities);

  if (factor <= 1) {
    return { positions: posArr, intensities: intArr, pointCount: posArr.length / 3 };
  }

  const pointCount = posArr.length / 3;
  const keepCount = Math.ceil(pointCount / factor);

  const newPositions = new Float32Array(keepCount * 3);
  const newIntensities = new Float32Array(keepCount);

  for (let i = 0; i < keepCount; i++) {
    const srcIdx = Math.min(i * factor, pointCount - 1);
    const srcPos = srcIdx * 3;
    const dstPos = i * 3;

    newPositions[dstPos] = posArr[srcPos];
    newPositions[dstPos + 1] = posArr[srcPos + 1];
    newPositions[dstPos + 2] = posArr[srcPos + 2];
    newIntensities[i] = intArr[srcIdx];
  }

  return { positions: newPositions, intensities: newIntensities, pointCount: keepCount };
}

export interface ScanData {
  positions: Float32Array | number[];
  intensities: Float32Array | number[];
  pointCount: number;
  egoPose: EgoPose;
  frameIndex: number;
}

export interface StackedPointCloud {
  positions: Float32Array;
  intensities: Float32Array;
  frameIndices: Float32Array;
  pointCount: number;
  referenceFrameIndex: number;
}

export function stackPointClouds(
  scans: ScanData[],
  referenceIndex: number,
  lodFactor: number = 3,
  egoToLidar?: EgoToLidarCalibration,
  voxelSize: number = 0.4
): StackedPointCloud {
  if (scans.length === 0) {
    return {
      positions: new Float32Array(0),
      intensities: new Float32Array(0),
      frameIndices: new Float32Array(0),
      pointCount: 0,
      referenceFrameIndex: 0,
    };
  }

  const lidarToEgo = getLidarToEgoTransform(egoToLidar);

  const originPose = scans[0].egoPose;

  if (!originPose || !originPose.position || originPose.position.length !== 3) {
    console.error('[StackPointClouds] Invalid origin pose, cannot stack:', originPose);
    return {
      positions: new Float32Array(0),
      intensities: new Float32Array(0),
      frameIndices: new Float32Array(0),
      pointCount: 0,
      referenceFrameIndex: 0,
    };
  }

  const worldOrigin = originPose.position;

  if (!isFinite(worldOrigin[0]) || !isFinite(worldOrigin[1]) || !isFinite(worldOrigin[2])) {
    console.error('[StackPointClouds] worldOrigin has NaN/Infinity values:', worldOrigin);
    return {
      positions: new Float32Array(0),
      intensities: new Float32Array(0),
      frameIndices: new Float32Array(0),
      pointCount: 0,
      referenceFrameIndex: 0,
    };
  }

  const referenceFrameIndex = scans[referenceIndex].frameIndex;

  const voxelGrid = new StreamingVoxelGrid(voxelSize, 30000);

  for (let i = 0; i < scans.length; i++) {
    try {
      const scan = scans[i];
      const isReference = i === referenceIndex;

      let positions = scan.positions;
      let intensities = scan.intensities;
      let currentPointCount = scan.pointCount;

      const distFromRef = Math.abs(i - referenceIndex);
      const effectiveLodFactor = isReference ? 1 : lodFactor * (1 + distFromRef * 0.5);

      if (effectiveLodFactor > 1) {
        const downsampled = downsamplePointCloud(positions, intensities, effectiveLodFactor);
        positions = downsampled.positions;
        intensities = downsampled.intensities;
        currentPointCount = downsampled.pointCount;
      }

      const worldPositions = transformLidarToWorld(positions, scan.egoPose, lidarToEgo);

      for (let p = 0; p < currentPointCount; p++) {
        const idx = p * 3;
        worldPositions[idx] -= worldOrigin[0];
        worldPositions[idx + 1] -= worldOrigin[1];
        worldPositions[idx + 2] -= worldOrigin[2];
      }

      voxelGrid.addScan(
        worldPositions,
        intensities instanceof Float32Array ? intensities : new Float32Array(intensities),
        scan.frameIndex,
        isReference
      );

      if (i === 0 || i === scans.length - 1 || isReference) {
      }

    } catch (memError) {
      console.error(`[StackPointClouds] Memory error on scan ${i}, stopping with partial result:`, memError);
      break; // Stop processing but return what we have
    }
  }

  // Get final downsampled result
  const result = voxelGrid.getResult();

  // IMPORTANT: Dispose the voxel grid to release Maps and typed arrays
  voxelGrid.dispose();

  return {
    positions: result.positions,
    intensities: result.intensities,
    frameIndices: result.frameIndices,
    pointCount: result.pointCount,
    referenceFrameIndex,
  };
}

/**
 * Compute LOD factor based on camera distance for adaptive detail
 * @param cameraDistance Distance from camera to scene center
 * @returns LOD factor (1 = full detail, higher = more aggressive downsampling)
 */
export function computeLODFactor(cameraDistance: number): number {
  // Full detail up to 50m
  if (cameraDistance < 50) return 1;
  // Progressive downsampling
  if (cameraDistance < 100) return 2;
  if (cameraDistance < 200) return 4;
  return 8;
}

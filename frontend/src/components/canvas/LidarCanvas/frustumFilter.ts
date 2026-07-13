import type { PointCloudData, CameraCalibration } from '@/types';

function transformLidarToCamera(
  px: number, py: number, pz: number,
  R: number[][],
  t: number[]
): [number, number, number] {
  const camX = R[0][0] * px + R[0][1] * py + R[0][2] * pz + t[0];
  const camY = R[1][0] * px + R[1][1] * py + R[1][2] * pz + t[1];
  const camZ = R[2][0] * px + R[2][1] * py + R[2][2] * pz + t[2];

  return [camX, camY, camZ];
}

export function filterPointCloudByFrustum(
  pointCloud: PointCloudData,
  calibration: CameraCalibration,
  imageWidth: number,
  imageHeight: number,
  maxPoints: number = 5000
): PointCloudData {
  const { extrinsic, intrinsic } = calibration;

  if (!extrinsic?.rotation || !extrinsic?.translation || !intrinsic) {
    console.warn('[frustumFilter] Invalid calibration data:', calibration);
    return pointCloud;
  }

  const { fx, fy, cx, cy } = intrinsic;
  const R = extrinsic.rotation;
  const t = extrinsic.translation;

  if (!fx || !fy || !cx || !cy) {
    console.warn('[frustumFilter] Missing intrinsic values:', intrinsic);
    return pointCloud;
  }

  console.log('[frustumFilter] Filtering with:', {
    imageWidth, imageHeight, fx, fy, cx, cy,
    pointCount: pointCloud.pointCount
  });

  const positions = pointCloud.positions;
  const intensities = pointCloud.intensities;
  const labels = pointCloud.labels;

  const visibleIndices: number[] = [];

  for (let i = 0; i < pointCloud.pointCount; i++) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];

    const [camX, camY, camZ] = transformLidarToCamera(px, py, pz, R, t);

    if (camZ <= 0.1) continue;

    const u = (fx * camX / camZ) + cx;
    const v = (fy * camY / camZ) + cy;

    if (u >= 0 && u < imageWidth && v >= 0 && v < imageHeight) {
      visibleIndices.push(i);
    }
  }

  console.log('[frustumFilter] Found', visibleIndices.length, 'visible points out of', pointCloud.pointCount);

  let finalIndices = visibleIndices;
  if (visibleIndices.length > maxPoints) {
    const step = Math.ceil(visibleIndices.length / maxPoints);
    finalIndices = visibleIndices.filter((_, idx) => idx % step === 0);
    console.log('[frustumFilter] Downsampled from', visibleIndices.length, 'to', finalIndices.length, 'points');
  }

  const filteredCount = finalIndices.length;

  if (filteredCount === 0) {
    console.warn('[frustumFilter] No points found in frustum!');
    return pointCloud;
  }

  const filteredPositions = new Float32Array(filteredCount * 3);
  const filteredIntensities = intensities ? new Float32Array(filteredCount) : undefined;
  const filteredLabels = labels ? new Uint8Array(filteredCount) : undefined;

  for (let j = 0; j < filteredCount; j++) {
    const i = finalIndices[j];
    filteredPositions[j * 3] = positions[i * 3];
    filteredPositions[j * 3 + 1] = positions[i * 3 + 1];
    filteredPositions[j * 3 + 2] = positions[i * 3 + 2];
    if (intensities && filteredIntensities) {
      filteredIntensities[j] = intensities[i];
    }
    if (labels && filteredLabels) {
      filteredLabels[j] = labels[i];
    }
  }

  return {
    positions: filteredPositions,
    intensities: filteredIntensities,
    labels: filteredLabels,
    pointCount: filteredCount,
  };
}

export function isPointInFrustum(
  point: [number, number, number],
  calibration: CameraCalibration,
  imageWidth?: number,
  imageHeight?: number
): boolean {
  const { extrinsic, intrinsic } = calibration;
  const { fx, fy, cx, cy, resolution } = intrinsic;
  const R = extrinsic.rotation;
  const t = extrinsic.translation;

  const imgWidth = imageWidth ?? resolution?.[0] ?? 1920;
  const imgHeight = imageHeight ?? resolution?.[1] ?? 1080;

  const [px, py, pz] = point;

  const [camX, camY, camZ] = transformLidarToCamera(px, py, pz, R, t);

  if (camZ <= 0) return false;

  const u = (fx * camX / camZ) + cx;
  const v = (fy * camY / camZ) + cy;

  return u >= 0 && u < imgWidth && v >= 0 && v < imgHeight;
}

export function generateFrustumMask(
  pointCloud: PointCloudData,
  calibration: CameraCalibration,
  imageWidth?: number,
  imageHeight?: number
): Float32Array {
  const mask = new Float32Array(pointCloud.pointCount);

  const { extrinsic, intrinsic } = calibration;

  if (!extrinsic?.rotation || !extrinsic?.translation || !intrinsic) {
    console.warn('[frustumMask] Invalid calibration data');
    return mask;
  }

  const { fx, fy, cx, cy, resolution } = intrinsic;
  const R = extrinsic.rotation;
  const t = extrinsic.translation;

  if (!fx || !fy || !cx || !cy) {
    console.warn('[frustumMask] Missing intrinsic values');
    return mask;
  }

  const imgWidth = imageWidth ?? resolution?.[0] ?? 1920;
  const imgHeight = imageHeight ?? resolution?.[1] ?? 1080;

  const positions = pointCloud.positions;

  for (let i = 0; i < pointCloud.pointCount; i++) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];

    const [camX, camY, camZ] = transformLidarToCamera(px, py, pz, R, t);

    if (camZ <= 0.1) continue;

    const u = (fx * camX / camZ) + cx;
    const v = (fy * camY / camZ) + cy;

    if (u >= 0 && u < imgWidth && v >= 0 && v < imgHeight) {
      mask[i] = 1.0;
    }
  }

  return mask;
}

import type { CameraCalibration, CameraModel } from '@/types';

export interface Point2D {
  x: number;
  y: number;
}

export interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
  index: number;
  label: number;
}

function applyExtrinsic(
  point: [number, number, number],
  rotation: number[][],
  translation: number[]
): [number, number, number] {
  const [x, y, z] = point;
  const [r0, r1, r2] = rotation;
  const [tx, ty, tz] = translation;

  return [
    r0[0] * x + r0[1] * y + r0[2] * z + tx,
    r1[0] * x + r1[1] * y + r1[2] * z + ty,
    r2[0] * x + r2[1] * y + r2[2] * z + tz,
  ];
}

function computeThetaMax(distortion: number[]): number {
  const [k2, k3, k4, k5] = distortion;

  const steps = 1000;
  for (let i = steps; i >= 0; i--) {
    const theta = (i / steps) * Math.PI;
    const t2 = theta * theta;
    const t4 = t2 * t2;
    const t6 = t4 * t2;
    const t8 = t4 * t4;
    const derivative = 1 + 3 * k2 * t2 + 5 * k3 * t4 + 7 * k4 * t6 + 9 * k5 * t8;
    if (derivative > 0) {
      return theta;
    }
  }
  return Math.PI;
}

function projectKannalaBrandt(
  point: [number, number, number],
  fx: number,
  fy: number,
  cx: number,
  cy: number,
  distortion: number[],
  thetaMax: number = Math.PI
): Point2D | null {
  const [x, y, z] = point;
  const EPSILON = 1e-10;

  const r = Math.sqrt(x * x + y * y);

  const theta = Math.atan2(r, z);

  if (theta > thetaMax || theta < -thetaMax) {
    return null;
  }

  const k2 = distortion[0] ?? 0;
  const k3 = distortion[1] ?? 0;
  const k4 = distortion[2] ?? 0;
  const k5 = distortion[3] ?? 0;

  const theta2 = theta * theta;
  const theta4 = theta2 * theta2;
  const theta6 = theta4 * theta2;
  const theta8 = theta4 * theta4;
  const theta_d = theta * (1 + k2 * theta2 + k3 * theta4 + k4 * theta6 + k5 * theta8);

  let scale: number;
  if (r < EPSILON) {
    scale = 1.0;
  } else {
    scale = theta_d / r;
  }

  const u = fx * scale * x + cx;
  const v = fy * scale * y + cy;

  return { x: u, y: v };
}

function projectPinhole(
  point: [number, number, number],
  fx: number,
  fy: number,
  cx: number,
  cy: number
): Point2D | null {
  const [x, y, z] = point;

  if (z <= 0) return null;

  const u = (fx * x / z) + cx;
  const v = (fy * y / z) + cy;

  return { x: u, y: v };
}

function projectToImage(
  point: [number, number, number],
  fx: number,
  fy: number,
  cx: number,
  cy: number,
  cameraModel: CameraModel = 'pinhole',
  distortion?: number[],
  thetaMax?: number
): Point2D | null {
  if (cameraModel === 'kannala_brandt' && distortion) {
    return projectKannalaBrandt(point, fx, fy, cx, cy, distortion, thetaMax);
  }
  return projectPinhole(point, fx, fy, cx, cy);
}

export function detectFisheyeCamera(
  fx: number,
  imageWidth: number,
  distortionLength?: number
): boolean {
  return distortionLength === 4 && fx < imageWidth / 2;
}

export function projectPointsToCamera(
  positions: Float32Array,
  pointCount: number,
  labels: Int32Array | null,
  calibration: CameraCalibration,
  imageWidth: number,
  imageHeight: number,
  forceFisheye?: boolean
): ProjectedPoint[] {
  const { extrinsic, intrinsic } = calibration;
  const { rotation, translation } = extrinsic;
  const { fx, fy, cx, cy, distortion, camera_model } = intrinsic;

  let effectiveModel: CameraModel = camera_model || 'pinhole';
  if (forceFisheye !== undefined) {
    effectiveModel = forceFisheye ? 'kannala_brandt' : 'pinhole';
  }

  if (!camera_model && !forceFisheye) {
    if (detectFisheyeCamera(fx, imageWidth, distortion?.length)) {
      effectiveModel = 'kannala_brandt';
    }
  }

  const thetaMax = effectiveModel === 'kannala_brandt' && distortion
    ? computeThetaMax(distortion)
    : Math.PI;

  const projected: ProjectedPoint[] = [];

  for (let i = 0; i < pointCount; i++) {
    const idx = i * 3;
    const lidarPoint: [number, number, number] = [
      positions[idx],
      positions[idx + 1],
      positions[idx + 2],
    ];

    const cameraPoint = applyExtrinsic(lidarPoint, rotation, translation);

    const imagePoint = projectToImage(
      cameraPoint,
      fx,
      fy,
      cx,
      cy,
      effectiveModel,
      distortion,
      thetaMax
    );
    if (!imagePoint) continue;

    if (imagePoint.x < 0 || imagePoint.x >= imageWidth) continue;
    if (imagePoint.y < 0 || imagePoint.y >= imageHeight) continue;

    projected.push({
      x: imagePoint.x,
      y: imagePoint.y,
      depth: cameraPoint[2],
      index: i,
      label: labels ? labels[i] : -1,
    });
  }

  projected.sort((a, b) => b.depth - a.depth);

  return projected;
}

export function drawProjectedPoints(
  ctx: CanvasRenderingContext2D,
  points: ProjectedPoint[],
  classColors: Map<number, string>,
  pointSize: number = 3,
  showUnlabeled: boolean = false,
  scale: number = 1
): void {
  for (const point of points) {
    if (point.label < 0 && !showUnlabeled) continue;

    let color: string;
    if (point.label < 0) {
      color = 'rgba(100, 100, 100, 0.3)';
    } else {
      color = classColors.get(point.label) || '#808080';
    }

    ctx.beginPath();
    ctx.arc(
      point.x * scale,
      point.y * scale,
      pointSize * scale,
      0,
      2 * Math.PI
    );
    ctx.fillStyle = color;
    ctx.fill();
  }
}

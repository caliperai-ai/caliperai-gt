
import type {
  Point2D,
  Point3D,
  CuboidData,
  BBox2D,
  CameraCalibration,
  ExtrinsicCalibration,
  IntrinsicCalibration,
} from '@/types';


export function identity4x4(): number[][] {
  return [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
}

export function createTransformMatrix4x4(
  rotation: number[][],
  translation: number[]
): number[][] {
  return [
    [rotation[0][0], rotation[0][1], rotation[0][2], translation[0]],
    [rotation[1][0], rotation[1][1], rotation[1][2], translation[1]],
    [rotation[2][0], rotation[2][1], rotation[2][2], translation[2]],
    [0, 0, 0, 1],
  ];
}

export function transformPoint4x4(point: Point3D, matrix: number[][]): Point3D {
  const x = matrix[0][0] * point.x + matrix[0][1] * point.y + matrix[0][2] * point.z + matrix[0][3];
  const y = matrix[1][0] * point.x + matrix[1][1] * point.y + matrix[1][2] * point.z + matrix[1][3];
  const z = matrix[2][0] * point.x + matrix[2][1] * point.y + matrix[2][2] * point.z + matrix[2][3];

  return { x, y, z };
}

export function extrinsicTo4x4(extrinsic: ExtrinsicCalibration): number[][] {
  return createTransformMatrix4x4(extrinsic.rotation, extrinsic.translation);
}


export function createRotationMatrix(
  yaw: number,
  pitch: number = 0,
  roll: number = 0
): number[][] {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  const cr = Math.cos(roll);
  const sr = Math.sin(roll);

  return [
    [cy * cp, cy * sp * sr - sy * cr, cy * sp * cr + sy * sr],
    [sy * cp, sy * sp * sr + cy * cr, sy * sp * cr - cy * sr],
    [-sp, cp * sr, cp * cr],
  ];
}

export function rotatePoint(point: Point3D, rotMatrix: number[][]): Point3D {
  return {
    x: rotMatrix[0][0] * point.x + rotMatrix[0][1] * point.y + rotMatrix[0][2] * point.z,
    y: rotMatrix[1][0] * point.x + rotMatrix[1][1] * point.y + rotMatrix[1][2] * point.z,
    z: rotMatrix[2][0] * point.x + rotMatrix[2][1] * point.y + rotMatrix[2][2] * point.z,
  };
}


function computeKBThetaMax(distortion: number[]): number {
  const [k2 = 0, k3 = 0, k4 = 0, k5 = 0] = distortion;
  const steps = 1000;
  for (let i = steps; i >= 0; i--) {
    const theta = (i / steps) * Math.PI;
    const t2 = theta * theta;
    const t4 = t2 * t2;
    const t6 = t4 * t2;
    const t8 = t4 * t4;
    const derivative = 1 + 3 * k2 * t2 + 5 * k3 * t4 + 7 * k4 * t6 + 9 * k5 * t8;
    if (derivative > 0) return theta;
  }
  return Math.PI;
}

function projectCameraPointKB(
  cameraPoint: Point3D,
  intrinsic: IntrinsicCalibration,
  imageSize: { width: number; height: number },
  thetaMax: number = Math.PI
): Point2D | null {
  const { x, y, z } = cameraPoint;
  const { fx, fy, cx, cy, distortion } = intrinsic;
  const EPSILON = 1e-10;

  const r = Math.sqrt(x * x + y * y);
  const theta = Math.atan2(r, z);

  if (theta > thetaMax || theta < -thetaMax) return null;

  const k2 = distortion?.[0] ?? 0;
  const k3 = distortion?.[1] ?? 0;
  const k4 = distortion?.[2] ?? 0;
  const k5 = distortion?.[3] ?? 0;

  const theta2 = theta * theta;
  const theta4 = theta2 * theta2;
  const theta6 = theta4 * theta2;
  const theta8 = theta4 * theta4;
  const theta_d = theta * (1 + k2 * theta2 + k3 * theta4 + k4 * theta6 + k5 * theta8);

  const scale = r < EPSILON ? 1.0 : theta_d / r;

  const u = fx * scale * x + cx;
  const v = fy * scale * y + cy;

  const margin = 50;
  if (u < -margin || u > imageSize.width + margin ||
      v < -margin || v > imageSize.height + margin) {
    return null;
  }

  return { x: u, y: v };
}

export function projectCameraPointToImage(
  cameraPoint: Point3D,
  intrinsic: IntrinsicCalibration,
  imageSize: { width: number; height: number },
  forceFisheye?: boolean
): Point2D | null {
  const { x, y, z } = cameraPoint;
  const { fx, fy, cx, cy, camera_model, distortion } = intrinsic;

  let useFisheye = camera_model === 'kannala_brandt';
  if (forceFisheye !== undefined) {
    useFisheye = forceFisheye;
  }

  if (!camera_model && forceFisheye === undefined) {
    if (distortion?.length === 4 && fx < imageSize.width / 2) {
      useFisheye = true;
    }
  }

  if (useFisheye && distortion) {
    const thetaMax = computeKBThetaMax(distortion);
    return projectCameraPointKB(cameraPoint, intrinsic, imageSize, thetaMax);
  }

  if (z <= 0) {
    return null;
  }

  const u = (fx * x / z) + cx;
  const v = (fy * y / z) + cy;

  const margin = 50;
  if (u < -margin || u > imageSize.width + margin ||
      v < -margin || v > imageSize.height + margin) {
    return null;
  }

  return { x: u, y: v };
}

export function isPointInCameraFOV(
  cameraPoint: Point3D,
  intrinsic: IntrinsicCalibration,
  imageSize: { width: number; height: number },
  marginFactor: number = 0.1,
  forceFisheye?: boolean
): boolean {
  const { x, y, z } = cameraPoint;
  const { fx, fy, cx, cy, camera_model, distortion } = intrinsic;

  let useFisheye = camera_model === 'kannala_brandt';
  if (forceFisheye !== undefined) {
    useFisheye = forceFisheye;
  }
  if (!camera_model && forceFisheye === undefined) {
    if (distortion?.length === 4 && fx < imageSize.width / 2) {
      useFisheye = true;
    }
  }

  if (useFisheye && distortion) {
    const thetaMax = computeKBThetaMax(distortion);
    const projected = projectCameraPointKB(cameraPoint, intrinsic, imageSize, thetaMax);
    if (!projected) return false;

    const marginX = imageSize.width * marginFactor;
    const marginY = imageSize.height * marginFactor;
    return projected.x >= -marginX && projected.x <= imageSize.width + marginX &&
           projected.y >= -marginY && projected.y <= imageSize.height + marginY;
  }

  if (z <= 0) {
    return false;
  }

  const u = (fx * x / z) + cx;
  const v = (fy * y / z) + cy;

  const marginX = imageSize.width * marginFactor;
  const marginY = imageSize.height * marginFactor;

  return u >= -marginX && u <= imageSize.width + marginX &&
         v >= -marginY && v <= imageSize.height + marginY;
}


export function transformLidarToCamera(
  lidarPoint: Point3D,
  lidarToCamera: ExtrinsicCalibration
): Point3D {
  const T = extrinsicTo4x4(lidarToCamera);
  return transformPoint4x4(lidarPoint, T);
}

export function projectLidarPointToImage(
  lidarPoint: Point3D,
  lidarToCamera: ExtrinsicCalibration,
  intrinsic: IntrinsicCalibration,
  imageSize: { width: number; height: number },
  forceFisheye?: boolean
): Point2D | null {
  const cameraPoint = transformLidarToCamera(lidarPoint, lidarToCamera);
  return projectCameraPointToImage(cameraPoint, intrinsic, imageSize, forceFisheye);
}

export function projectLidarPointToImageWithDebug(
  lidarPoint: Point3D,
  lidarToCamera: ExtrinsicCalibration,
  intrinsic: IntrinsicCalibration,
  imageSize: { width: number; height: number },
  forceFisheye?: boolean
): {
  lidarPoint: Point3D;
  cameraPoint: Point3D;
  imagePoint: Point2D | null;
} {
  const cameraPoint = transformLidarToCamera(lidarPoint, lidarToCamera);
  const imagePoint = projectCameraPointToImage(cameraPoint, intrinsic, imageSize, forceFisheye);

  return {
    lidarPoint,
    cameraPoint,
    imagePoint,
  };
}

export function projectLidarPointsToImage(
  lidarPoints: Point3D[],
  lidarToCamera: ExtrinsicCalibration,
  intrinsic: IntrinsicCalibration,
  imageSize: { width: number; height: number },
  forceFisheye?: boolean
): (Point2D | null)[] {
  const T = extrinsicTo4x4(lidarToCamera);

  return lidarPoints.map(lidarPoint => {
    const cameraPoint = transformPoint4x4(lidarPoint, T);
    return projectCameraPointToImage(cameraPoint, intrinsic, imageSize, forceFisheye);
  });
}


export function getCuboidCorners(cuboid: CuboidData): Point3D[] {
  const { center, dimensions, rotation } = cuboid || {};

  const safeCenter = center || { x: 0, y: 0, z: 0 };
  const safeDimensions = dimensions || { length: 1, width: 1, height: 1 };
  const { length: l, width: w, height: h } = safeDimensions;

  const hl = l / 2;
  const hw = w / 2;
  const hh = h / 2;

  const localCorners: Point3D[] = [
    { x: -hl, y: -hw, z: -hh },
    { x: hl, y: -hw, z: -hh },
    { x: hl, y: hw, z: -hh },
    { x: -hl, y: hw, z: -hh },
    { x: -hl, y: -hw, z: hh },
    { x: hl, y: -hw, z: hh },
    { x: hl, y: hw, z: hh },
    { x: -hl, y: hw, z: hh },
  ];

  const safeRotation = rotation || { yaw: 0, pitch: 0, roll: 0 };
  const rotMatrix = createRotationMatrix(safeRotation.yaw || 0, safeRotation.pitch || 0, safeRotation.roll || 0);

  return localCorners.map(corner => {
    const rotated = rotatePoint(corner, rotMatrix);
    return {
      x: rotated.x + safeCenter.x,
      y: rotated.y + safeCenter.y,
      z: rotated.z + safeCenter.z,
    };
  });
}

export const CUBOID_EDGES: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 0],
  [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export function isCuboidVisibleInCamera(
  cuboid: CuboidData,
  lidarToCamera: ExtrinsicCalibration,
  intrinsic: IntrinsicCalibration,
  imageSize: { width: number; height: number },
  minVisibleCorners: number = 4,
  cameraId?: string
): boolean {
  const centerCamera = transformLidarToCamera(cuboid.center, lidarToCamera);

  const R = lidarToCamera.rotation;
  const t = lidarToCamera.translation;
  if (cameraId) {
    console.log(`[isCuboidVisible] ${cameraId} R[2]=[${R[2][0].toFixed(3)}, ${R[2][1].toFixed(3)}, ${R[2][2].toFixed(3)}] t=[${t[0].toFixed(2)}, ${t[1].toFixed(2)}, ${t[2].toFixed(2)}]`);
  }

  // Detect if this is a fisheye camera (fx < imageWidth/2 AND has 4 distortion coefficients)
  const isFisheye = intrinsic.fx < imageSize.width / 2 &&
                    intrinsic.distortion &&
                    intrinsic.distortion.length === 4;

  // For fisheye cameras with 180°+ FOV, allow much larger angles (camZ can be slightly negative)
  // For pinhole cameras, require the object to be more clearly in front
  const minCamZ = isFisheye ? -0.5 : 0.5;  // Fisheye: ~95° off-axis allowed, Pinhole: stricter

  // Check 1: Center must be in front of camera (or within FOV for fisheye)
  if (centerCamera.z <= minCamZ) {
    if (cameraId) {
      console.log(`[isCuboidVisible] ${cameraId}: BEHIND (camZ=${centerCamera.z.toFixed(2)}, threshold=${minCamZ}, fisheye=${isFisheye})`);
    }
    return false;
  }

  // Check 2: Count how many corners project successfully within the image
  const lidarCorners = getCuboidCorners(cuboid);
  const T = extrinsicTo4x4(lidarToCamera);
  let visibleCorners = 0;

  for (const corner of lidarCorners) {
    const cameraPoint = transformPoint4x4(corner, T);
    const projected = projectCameraPointToImage(cameraPoint, intrinsic, imageSize);
    if (projected !== null) {
      visibleCorners++;
    }
  }

  if (cameraId) {
    // Project center to see where it would appear
    const centerProjected = projectCameraPointToImage(centerCamera, intrinsic, imageSize);
    const projStr = centerProjected ? `Image(${centerProjected.x.toFixed(0)}, ${centerProjected.y.toFixed(0)})` : 'OUT_OF_BOUNDS';
    console.log(`[isCuboidVisible] ${cameraId}: camZ=${centerCamera.z.toFixed(2)}, corners=${visibleCorners}/${minVisibleCorners}, center->${projStr} => ${visibleCorners >= minVisibleCorners ? 'VISIBLE' : 'NOT_VISIBLE'}`);
  }

  return visibleCorners >= minVisibleCorners;
}

/**
 * Project a 3D cuboid from LiDAR frame to 2D image edges
 */
export function projectCuboidToImage(
  cuboid: CuboidData,
  lidarToCamera: ExtrinsicCalibration,
  intrinsic: IntrinsicCalibration,
  imageSize: { width: number; height: number },
  forceFisheye?: boolean
): { start: Point2D; end: Point2D }[] {
  // Get 3D corners in LiDAR frame
  const corners3D = getCuboidCorners(cuboid);

  // Project all corners to 2D
  const corners2D = projectLidarPointsToImage(corners3D, lidarToCamera, intrinsic, imageSize, forceFisheye);

  // Build edges (skip if any endpoint is null)
  const edges: { start: Point2D; end: Point2D }[] = [];

  for (const [i, j] of CUBOID_EDGES) {
    const start = corners2D[i];
    const end = corners2D[j];

    if (start && end) {
      edges.push({ start, end });
    }
  }

  return edges;
}

/**
 * Find all cameras where a cuboid is visible
 * Returns array of camera IDs where the cuboid projects successfully
 */
export function findVisibleCamerasForCuboid(
  cuboid: CuboidData,
  lidarToCameras: Record<string, { extrinsic: ExtrinsicCalibration; intrinsic: IntrinsicCalibration }>,
  imageSize: { width: number; height: number },
  minVisibleCorners: number = 3
): string[] {
  const visibleCameras: string[] = [];

  console.log(`[findVisibleCameras] Checking cuboid at LiDAR(${cuboid.center.x.toFixed(2)}, ${cuboid.center.y.toFixed(2)}, ${cuboid.center.z.toFixed(2)})`);

  for (const [cameraId, calib] of Object.entries(lidarToCameras)) {
    const isVisible = isCuboidVisibleInCamera(
      cuboid,
      calib.extrinsic,
      calib.intrinsic,
      imageSize,
      minVisibleCorners,
      cameraId  // Pass camera ID for debug logging
    );

    if (isVisible) {
      visibleCameras.push(cameraId);
    }
  }

  console.log(`[findVisibleCameras] Result: ${visibleCameras.join(', ') || 'NONE'}`);

  return visibleCameras;
}

/**
 * Find all cameras where a single 3D point (in LiDAR frame) is visible.
 * Returns array of camera IDs where the point projects within image bounds.
 */
export function findVisibleCamerasForPoint(
  point: Point3D,
  lidarToCameras: Record<string, { extrinsic: ExtrinsicCalibration; intrinsic: IntrinsicCalibration }>,
  imageSize: { width: number; height: number },
): string[] {
  const visibleCameras: string[] = [];

  for (const [cameraId, calib] of Object.entries(lidarToCameras)) {
    const projected = projectLidarPointToImage(
      point,
      calib.extrinsic,
      calib.intrinsic,
      imageSize,
    );
    if (projected) {
      visibleCameras.push(cameraId);
    }
  }

  return visibleCameras;
}

/**
 * Find the single best camera for a 3D point — the one where the projected
 * pixel is closest to the image centre (most head-on / least oblique view).
 * Returns null if no camera can see the point.
 */
export function findBestCameraForPoint(
  point: Point3D,
  lidarToCameras: Record<string, { extrinsic: ExtrinsicCalibration; intrinsic: IntrinsicCalibration }>,
  imageSize: { width: number; height: number },
): string | null {
  let bestCameraId: string | null = null;
  let bestDistSq = Infinity;

  const halfW = imageSize.width / 2;
  const halfH = imageSize.height / 2;

  for (const [cameraId, calib] of Object.entries(lidarToCameras)) {
    const projected = projectLidarPointToImage(
      point,
      calib.extrinsic,
      calib.intrinsic,
      imageSize,
    );
    if (!projected) continue;

    const dx = projected.x - halfW;
    const dy = projected.y - halfH;
    const distSq = dx * dx + dy * dy;

    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestCameraId = cameraId;
    }
  }

  return bestCameraId;
}

// =============================================================================
// LEGACY COMPATIBILITY (deprecated, use LiDAR frame functions above)
// =============================================================================

/**
 * @deprecated Use projectLidarPointToImage instead
 */
export function projectPointToImage(
  point3D: Point3D,
  calibration: CameraCalibration,
  imageSize: { width: number; height: number }
): Point2D | null {
  return projectLidarPointToImage(point3D, calibration.extrinsic, calibration.intrinsic, imageSize);
}

/**
 * @deprecated Use projectLidarPointsToImage instead
 */
export function projectPointsToImage(
  points3D: Point3D[],
  calibration: CameraCalibration,
  imageSize: { width: number; height: number }
): (Point2D | null)[] {
  return projectLidarPointsToImage(points3D, calibration.extrinsic, calibration.intrinsic, imageSize);
}

// Aliases for backwards compatibility
export const isCuboidVisibleInCameraLidarFrame = isCuboidVisibleInCamera;
export const projectLidarCuboidToImage = projectCuboidToImage;

// =============================================================================
// FUSION LABELING UTILITIES
// =============================================================================

/**
 * Compute a tight 2D bounding box from projected 3D cuboid corners
 * Returns null if not enough corners are visible
 */
export function computeTightBBox2D(
  cuboid: CuboidData,
  lidarToCamera: ExtrinsicCalibration,
  intrinsic: IntrinsicCalibration,
  imageSize: { width: number; height: number },
  minVisibleCorners: number = 3
): BBox2D | null {
  // Get 3D corners in LiDAR frame
  const corners3D = getCuboidCorners(cuboid);

  // Project all corners to 2D
  const corners2D = projectLidarPointsToImage(corners3D, lidarToCamera, intrinsic, imageSize);

  // Filter out null projections
  const validCorners = corners2D.filter((c): c is Point2D => c !== null);

  if (validCorners.length < minVisibleCorners) {
    return null;
  }

  // Compute bounding box
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const corner of validCorners) {
    minX = Math.min(minX, corner.x);
    minY = Math.min(minY, corner.y);
    maxX = Math.max(maxX, corner.x);
    maxY = Math.max(maxY, corner.y);
  }

  // Clamp to image bounds
  minX = Math.max(0, minX);
  minY = Math.max(0, minY);
  maxX = Math.min(imageSize.width, maxX);
  maxY = Math.min(imageSize.height, maxY);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

/**
 * Project a 3D cuboid to 2D bounding boxes for all visible cameras
 * Returns a map of cameraId -> BBox2D
 */
export function projectCuboidToAllCameras(
  cuboid: CuboidData,
  lidarToCameras: Record<string, { extrinsic: ExtrinsicCalibration; intrinsic: IntrinsicCalibration }>,
  imageSize: { width: number; height: number },
  minVisibleCorners: number = 3
): Record<string, BBox2D> {
  const result: Record<string, BBox2D> = {};

  for (const [cameraId, calib] of Object.entries(lidarToCameras)) {
    const bbox = computeTightBBox2D(
      cuboid,
      calib.extrinsic,
      calib.intrinsic,
      imageSize,
      minVisibleCorners
    );

    if (bbox && bbox.width > 10 && bbox.height > 10) {
      result[cameraId] = bbox;
    }
  }

  return result;
}

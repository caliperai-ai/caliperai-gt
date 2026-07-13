
export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface OrientedBoundingBox {
  center: Point3D;
  dimensions: {
    length: number;
    width: number;
    height: number;
  };
  rotation: {
    yaw: number;
    pitch: number;
    roll: number;
  };
  orientationConfidence: number;
  method: 'pca' | 'lshape' | 'hybrid' | 'minArea' | 'fallback';
}

export function fitOrientedBoundingBox(
  points: Point3D[],
  groundPlaneZ?: number
): OrientedBoundingBox {
  if (points.length === 0) {
    return createDefaultBox();
  }

  if (points.length < 4) {
    return fitAxisAlignedBox(points);
  }

  const xyPoints = points.map(p => ({ x: p.x, y: p.y }));

  const lShapeResult = tryLShapeFitting(xyPoints);

  const pcaResult = computePCAOrientation(xyPoints);

  let bestYaw: number;
  let confidence: number;
  let method: OrientedBoundingBox['method'];

  if (lShapeResult && lShapeResult.confidence > 0.7 && lShapeResult.confidence > pcaResult.confidence) {
    bestYaw = lShapeResult.yaw;
    confidence = lShapeResult.confidence;
    method = 'lshape';
  } else if (pcaResult.confidence > 0.5) {
    bestYaw = pcaResult.yaw;
    confidence = pcaResult.confidence;
    method = 'pca';
  } else {
    const totalConf = (lShapeResult?.confidence || 0) + pcaResult.confidence;
    if (totalConf > 0 && lShapeResult) {
      bestYaw = normalizeAngle(
        (lShapeResult.yaw * lShapeResult.confidence + pcaResult.yaw * pcaResult.confidence) / totalConf
      );
      confidence = Math.max(lShapeResult.confidence, pcaResult.confidence);
      method = 'hybrid';
    } else {
      bestYaw = pcaResult.yaw;
      confidence = pcaResult.confidence;
      method = 'fallback';
    }
  }

  const rotatedBox = computeBoxInRotatedFrame(points, bestYaw, groundPlaneZ);

  return {
    center: rotatedBox.center,
    dimensions: rotatedBox.dimensions,
    rotation: {
      yaw: bestYaw,
      pitch: 0,
      roll: 0,
    },
    orientationConfidence: confidence,
    method,
  };
}

function createDefaultBox(): OrientedBoundingBox {
  return {
    center: { x: 0, y: 0, z: 0 },
    dimensions: { length: 1, width: 1, height: 1 },
    rotation: { yaw: 0, pitch: 0, roll: 0 },
    orientationConfidence: 0,
    method: 'fallback',
  };
}

function fitAxisAlignedBox(points: Point3D[]): OrientedBoundingBox {
  if (points.length === 0) return createDefaultBox();

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }

  const dx = maxX - minX || 0.1;
  const dy = maxY - minY || 0.1;
  const dz = maxZ - minZ || 0.1;

  const length = Math.max(dx, dy);
  const width = Math.min(dx, dy);
  const yaw = dx >= dy ? 0 : Math.PI / 2;

  return {
    center: {
      x: (minX + maxX) / 2,
      y: (minY + maxY) / 2,
      z: (minZ + maxZ) / 2,
    },
    dimensions: {
      length,
      width,
      height: dz,
    },
    rotation: { yaw, pitch: 0, roll: 0 },
    orientationConfidence: 0.3,
    method: 'fallback',
  };
}

function computePCAOrientation(points: { x: number; y: number }[]): {
  yaw: number;
  confidence: number;
} {
  if (points.length < 2) {
    return { yaw: 0, confidence: 0 };
  }

  let cx = 0, cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length;
  cy /= points.length;

  let cxx = 0, cyy = 0, cxy = 0;
  for (const p of points) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    cxx += dx * dx;
    cyy += dy * dy;
    cxy += dx * dy;
  }
  cxx /= points.length;
  cyy /= points.length;
  cxy /= points.length;

  const trace = cxx + cyy;
  const det = cxx * cyy - cxy * cxy;
  const discriminant = Math.sqrt(Math.max(0, trace * trace / 4 - det));

  const lambda1 = trace / 2 + discriminant;
  const lambda2 = trace / 2 - discriminant;

  let yaw: number;

  if (Math.abs(cxy) > 1e-10) {
    const vx = lambda1 - cyy;
    const vy = cxy;
    yaw = Math.atan2(vy, vx);
  } else {
    yaw = cxx >= cyy ? 0 : Math.PI / 2;
  }

  const ratio = lambda2 > 1e-10 ? lambda1 / lambda2 : 10;
  const confidence = Math.min(1, (ratio - 1) / 4);

  return { yaw, confidence };
}

function tryLShapeFitting(points: { x: number; y: number }[]): {
  yaw: number;
  confidence: number;
} | null {
  if (points.length < 10) return null;


  const hull = computeConvexHull(points);
  if (hull.length < 4) return null;

  let bestScore = 0;
  let bestYaw = 0;

  for (let i = 0; i < hull.length; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % hull.length];

    const edgeAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const edgeLength = Math.sqrt(
      Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2)
    );

    const perpAngle = edgeAngle + Math.PI / 2;

    let edgeInliers = 0;
    let perpInliers = 0;

    for (const p of points) {
      const angleToPoint = Math.atan2(p.y - p1.y, p.x - p1.x);
      const angleDiff = Math.abs(normalizeAngle(angleToPoint - edgeAngle));

      if (angleDiff < 0.3 || angleDiff > Math.PI - 0.3) {
        edgeInliers++;
      }

      const perpDiff = Math.abs(normalizeAngle(angleToPoint - perpAngle));
      if (perpDiff < 0.3 || perpDiff > Math.PI - 0.3) {
        perpInliers++;
      }
    }

    const score = edgeLength * (edgeInliers + perpInliers);

    if (score > bestScore) {
      bestScore = score;
      bestYaw = edgeAngle;
    }
  }

  const maxPossibleScore = computeMaxScore(points);
  const confidence = Math.min(1, bestScore / (maxPossibleScore * 0.5));

  if (confidence < 0.3) return null;

  return { yaw: bestYaw, confidence };
}

function computeConvexHull(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length < 3) return [...points];

  let lowest = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].y < points[lowest].y ||
        (points[i].y === points[lowest].y && points[i].x < points[lowest].x)) {
      lowest = i;
    }
  }

  const pivot = points[lowest];

  const sorted = points
    .filter((_, i) => i !== lowest)
    .map(p => ({
      point: p,
      angle: Math.atan2(p.y - pivot.y, p.x - pivot.x),
      dist: Math.pow(p.x - pivot.x, 2) + Math.pow(p.y - pivot.y, 2),
    }))
    .sort((a, b) => {
      if (Math.abs(a.angle - b.angle) < 1e-10) {
        return a.dist - b.dist;
      }
      return a.angle - b.angle;
    });

  const hull: { x: number; y: number }[] = [pivot];

  for (const { point } of sorted) {
    while (hull.length >= 2) {
      const a = hull[hull.length - 2];
      const b = hull[hull.length - 1];
      const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);

      if (cross <= 0) {
        hull.pop();
      } else {
        break;
      }
    }
    hull.push(point);
  }

  return hull;
}

function computeMaxScore(points: { x: number; y: number }[]): number {
  let maxDist = 0;
  for (let i = 0; i < Math.min(points.length, 50); i++) {
    for (let j = i + 1; j < Math.min(points.length, 50); j++) {
      const dist = Math.sqrt(
        Math.pow(points[i].x - points[j].x, 2) +
        Math.pow(points[i].y - points[j].y, 2)
      );
      maxDist = Math.max(maxDist, dist);
    }
  }
  return maxDist * points.length;
}

function normalizeAngle(angle: number): number {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
}

function computeBoxInRotatedFrame(
  points: Point3D[],
  yaw: number,
  groundPlaneZ?: number
): {
  center: Point3D;
  dimensions: { length: number; width: number; height: number };
} {
  const cos = Math.cos(-yaw);
  const sin = Math.sin(-yaw);

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;
  let minZ = Infinity, maxZ = -Infinity;

  for (const p of points) {
    const rx = p.x * cos - p.y * sin;
    const ry = p.x * sin + p.y * cos;

    minX = Math.min(minX, rx);
    maxX = Math.max(maxX, rx);
    minY = Math.min(minY, ry);
    maxY = Math.max(maxY, ry);
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
  }

  const length = maxX - minX || 0.1;
  const width = maxY - minY || 0.1;
  const height = maxZ - minZ || 0.1;

  const rcx = (minX + maxX) / 2;
  const rcy = (minY + maxY) / 2;
  const rcz = groundPlaneZ !== undefined
    ? groundPlaneZ + height / 2
    : (minZ + maxZ) / 2;

  const cosInv = Math.cos(yaw);
  const sinInv = Math.sin(yaw);

  const centerX = rcx * cosInv - rcy * sinInv;
  const centerY = rcx * sinInv + rcy * cosInv;

  return {
    center: { x: centerX, y: centerY, z: rcz },
    dimensions: { length, width, height },
  };
}

export function fitMinimumAreaBox(points: Point3D[]): OrientedBoundingBox {
  if (points.length < 3) {
    return fitAxisAlignedBox(points);
  }

  const xyPoints = points.map(p => ({ x: p.x, y: p.y }));
  const hull = computeConvexHull(xyPoints);

  if (hull.length < 3) {
    return fitAxisAlignedBox(points);
  }

  let minArea = Infinity;
  let bestYaw = 0;

  for (let i = 0; i < hull.length; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % hull.length];

    const edgeAngle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    const box = computeBoxInRotatedFrame(points, edgeAngle);
    const area = box.dimensions.length * box.dimensions.width;

    if (area < minArea) {
      minArea = area;
      bestYaw = edgeAngle;
    }
  }

  const finalBox = computeBoxInRotatedFrame(points, bestYaw);

  return {
    center: finalBox.center,
    dimensions: finalBox.dimensions,
    rotation: { yaw: bestYaw, pitch: 0, roll: 0 },
    orientationConfidence: 0.8,
    method: 'minArea',
  };
}

export function estimateGroundPlane(points: Point3D[], percentile: number = 5): number {
  if (points.length === 0) return 0;

  const zValues = points.map(p => p.z).sort((a, b) => a - b);
  const index = Math.floor(zValues.length * percentile / 100);

  return zValues[index] || zValues[0];
}

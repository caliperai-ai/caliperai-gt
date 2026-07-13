
export interface PlaneEquation {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface GroundPlaneResult {
  plane: PlaneEquation;
  inlierCount: number;
  inlierRatio: number;
  groundMask: Float32Array;
}

export interface RANSACConfig {
  maxIterations: number;
  distanceThreshold: number;
  minInlierRatio: number;
  sampleFromLowestPercent: number;
  normalZThreshold: number;
}

const DEFAULT_CONFIG: RANSACConfig = {
  maxIterations: 100,
  distanceThreshold: 0.15,
  minInlierRatio: 0.1,
  sampleFromLowestPercent: 30,
  normalZThreshold: 0.8,
};

function planeFrom3Points(
  p1: [number, number, number],
  p2: [number, number, number],
  p3: [number, number, number]
): PlaneEquation | null {
  const v1 = [p2[0] - p1[0], p2[1] - p1[1], p2[2] - p1[2]];
  const v2 = [p3[0] - p1[0], p3[1] - p1[1], p3[2] - p1[2]];

  const a = v1[1] * v2[2] - v1[2] * v2[1];
  const b = v1[2] * v2[0] - v1[0] * v2[2];
  const c = v1[0] * v2[1] - v1[1] * v2[0];

  const len = Math.sqrt(a * a + b * b + c * c);
  if (len < 1e-10) return null;

  let na = a / len;
  let nb = b / len;
  let nc = c / len;

  if (nc < 0) {
    na = -na;
    nb = -nb;
    nc = -nc;
  }

  const d = -(na * p1[0] + nb * p1[1] + nc * p1[2]);

  return { a: na, b: nb, c: nc, d };
}

function pointToPlaneDistance(
  x: number, y: number, z: number,
  plane: PlaneEquation
): number {
  return plane.a * x + plane.b * y + plane.c * z + plane.d;
}

function getLowestPointIndices(
  positions: Float32Array,
  percentile: number,
  subsampleCount: number = 50000,
): number[] {
  const pointCount = positions.length / 3;
  if (pointCount === 0) return [];

  const useSubsample = pointCount > subsampleCount;
  const poolSize = useSubsample ? subsampleCount : pointCount;
  const indexed: Array<[number, number]> = new Array(poolSize);

  let kept = 0;
  if (useSubsample) {
    for (let k = 0; k < poolSize; k++) {
      const i = (Math.random() * pointCount) | 0;
      const z = positions[i * 3 + 2];
      if (isFinite(z)) {
        indexed[kept++] = [i, z];
      }
    }
  } else {
    for (let i = 0; i < pointCount; i++) {
      const z = positions[i * 3 + 2];
      if (isFinite(z)) {
        indexed[kept++] = [i, z];
      }
    }
  }
  indexed.length = kept;

  indexed.sort((a, b) => a[1] - b[1]);

  const count = Math.max(100, Math.floor(indexed.length * (percentile / 100)));
  const result = new Array<number>(Math.min(count, indexed.length));
  for (let i = 0; i < result.length; i++) result[i] = indexed[i][0];
  return result;
}

export function detectGroundPlane(
  positions: Float32Array,
  config: Partial<RANSACConfig> = {}
): GroundPlaneResult | null {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const pointCount = positions.length / 3;

  if (pointCount < 100) {
    console.warn('[GroundPlane] Not enough points for RANSAC');
    return null;
  }

  const candidateIndices = getLowestPointIndices(positions, cfg.sampleFromLowestPercent);

  if (candidateIndices.length < 3) {
    console.warn('[GroundPlane] Not enough candidate points');
    return null;
  }

  let bestPlane: PlaneEquation | null = null;
  let bestInlierCount = 0;

  const INLIER_SAMPLE_TARGET = 30000;
  const sampleSize = Math.min(pointCount, INLIER_SAMPLE_TARGET);
  const sampleIndices = new Uint32Array(sampleSize);
  if (sampleSize >= pointCount) {
    for (let i = 0; i < sampleSize; i++) sampleIndices[i] = i;
  } else {
    for (let i = 0; i < sampleSize; i++) {
      sampleIndices[i] = (Math.random() * pointCount) | 0;
    }
  }

  const candCount = candidateIndices.length;

  for (let iter = 0; iter < cfg.maxIterations; iter++) {
    const idx1 = candidateIndices[(Math.random() * candCount) | 0];
    const idx2 = candidateIndices[(Math.random() * candCount) | 0];
    const idx3 = candidateIndices[(Math.random() * candCount) | 0];
    if (idx1 === idx2 || idx2 === idx3 || idx1 === idx3) continue;

    const p1x = positions[idx1 * 3], p1y = positions[idx1 * 3 + 1], p1z = positions[idx1 * 3 + 2];
    const p2x = positions[idx2 * 3], p2y = positions[idx2 * 3 + 1], p2z = positions[idx2 * 3 + 2];
    const p3x = positions[idx3 * 3], p3y = positions[idx3 * 3 + 1], p3z = positions[idx3 * 3 + 2];

    if (!isFinite(p1x) || !isFinite(p2x) || !isFinite(p3x)) continue;

    const plane = planeFrom3Points([p1x, p1y, p1z], [p2x, p2y, p2z], [p3x, p3y, p3z]);
    if (!plane) continue;
    if (plane.c < cfg.normalZThreshold) continue;

    const pa = plane.a, pb = plane.b, pc = plane.c, pd = plane.d;
    const thresh = cfg.distanceThreshold;
    let inlierCount = 0;
    for (let s = 0; s < sampleSize; s++) {
      const i = sampleIndices[s];
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];
      const dist = pa * x + pb * y + pc * z + pd;
      if (dist > -thresh && dist < thresh) inlierCount++;
    }

    if (inlierCount > bestInlierCount) {
      bestInlierCount = inlierCount;
      bestPlane = plane;
    }
  }

  if (sampleSize > 0 && sampleSize < pointCount) {
    bestInlierCount = Math.floor((bestInlierCount * pointCount) / sampleSize);
  }

  if (!bestPlane || bestInlierCount < pointCount * cfg.minInlierRatio) {
    console.warn('[GroundPlane] No valid ground plane found');
    return null;
  }

  const groundMask = new Float32Array(pointCount);
  for (let i = 0; i < pointCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) {
      groundMask[i] = 0;
      continue;
    }

    const dist = Math.abs(pointToPlaneDistance(x, y, z, bestPlane));
    groundMask[i] = dist < cfg.distanceThreshold ? 1.0 : 0.0;
  }


  return {
    plane: bestPlane,
    inlierCount: bestInlierCount,
    inlierRatio: bestInlierCount / pointCount,
    groundMask,
  };
}

export function isPointOnGround(
  x: number, y: number, z: number,
  plane: PlaneEquation,
  threshold: number = 0.15
): boolean {
  const dist = Math.abs(pointToPlaneDistance(x, y, z, plane));
  return dist < threshold;
}

export function heightAboveGround(
  x: number, y: number, z: number,
  plane: PlaneEquation
): number {
  return pointToPlaneDistance(x, y, z, plane);
}

export function detectLocalGroundPlane(
  positions: Float32Array,
  centerX: number,
  centerY: number,
  radius: number = 5,
  config: Partial<RANSACConfig> = {}
): PlaneEquation | null {
  const cfg = {
    ...DEFAULT_CONFIG,
    sampleFromLowestPercent: 10,
    ...config
  };

  const pointCount = positions.length / 3;
  const radiusSq = radius * radius;

  const localPoints: Array<[number, number, number]> = [];

  for (let i = 0; i < pointCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    if (!isFinite(x) || !isFinite(y) || !isFinite(z)) continue;

    const dx = x - centerX;
    const dy = y - centerY;
    const distSq = dx * dx + dy * dy;

    if (distSq <= radiusSq) {
      localPoints.push([x, y, z]);
    }
  }

  if (localPoints.length < 50) {
    return null;
  }

  localPoints.sort((a, b) => a[2] - b[2]);
  const candidateCount = Math.max(20, Math.floor(localPoints.length * (cfg.sampleFromLowestPercent / 100)));
  const candidates = localPoints.slice(0, candidateCount);

  if (candidates.length < 3) {
    return null;
  }

  let bestPlane: PlaneEquation | null = null;
  let bestInlierCount = 0;

  for (let iter = 0; iter < cfg.maxIterations; iter++) {
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    const p1 = shuffled[0];
    const p2 = shuffled[1];
    const p3 = shuffled[2];

    const plane = planeFrom3Points(p1, p2, p3);
    if (!plane) continue;

    if (plane.c < cfg.normalZThreshold) continue;

    let inlierCount = 0;
    for (const pt of localPoints) {
      const dist = Math.abs(pointToPlaneDistance(pt[0], pt[1], pt[2], plane));
      if (dist < cfg.distanceThreshold) {
        inlierCount++;
      }
    }

    if (inlierCount > bestInlierCount) {
      bestInlierCount = inlierCount;
      bestPlane = plane;
    }
  }

  if (!bestPlane || bestInlierCount < localPoints.length * 0.1) {
    return null;
  }

  return bestPlane;
}

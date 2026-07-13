
export interface GroundPlaneResult {
  normal: [number, number, number];
  d: number;
  inlierIndices: number[];
  inlierFraction: number;
  groundZ: number;
}

export function ransacGroundPlane(
  positions: Float32Array,
  pointCount: number,
  opts: {
    iterations?: number;
    distanceThreshold?: number;
    minInlierRatio?: number;
    zFilter?: [number, number];
  } = {}
): GroundPlaneResult | null {
  const {
    iterations = 80,
    distanceThreshold = 0.15,
    minInlierRatio = 0.05,
    zFilter = [-5.0, 5.0],
  } = opts;

  const candidates: number[] = [];
  for (let i = 0; i < pointCount; i++) {
    const z = positions[i * 3 + 2];
    if (z >= zFilter[0] && z <= zFilter[1]) {
      candidates.push(i);
    }
  }

  if (candidates.length < 10) return null;

  let bestNormal: [number, number, number] = [0, 0, 1];
  let bestD = 0;
  let bestCount = 0;

  for (let iter = 0; iter < iterations; iter++) {
    const i0 = candidates[Math.floor(Math.random() * candidates.length)];
    const i1 = candidates[Math.floor(Math.random() * candidates.length)];
    const i2 = candidates[Math.floor(Math.random() * candidates.length)];
    if (i0 === i1 || i1 === i2 || i0 === i2) continue;

    const p0x = positions[i0 * 3], p0y = positions[i0 * 3 + 1], p0z = positions[i0 * 3 + 2];
    const p1x = positions[i1 * 3], p1y = positions[i1 * 3 + 1], p1z = positions[i1 * 3 + 2];
    const p2x = positions[i2 * 3], p2y = positions[i2 * 3 + 1], p2z = positions[i2 * 3 + 2];

    const ax = p1x - p0x, ay = p1y - p0y, az = p1z - p0z;
    const bx = p2x - p0x, by = p2y - p0y, bz = p2z - p0z;

    let nx = ay * bz - az * by;
    let ny = az * bx - ax * bz;
    let nz = ax * by - ay * bx;

    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len < 1e-6) continue;
    nx /= len; ny /= len; nz /= len;

    if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }

    if (Math.abs(nz) < 0.7) continue;

    const d = nx * p0x + ny * p0y + nz * p0z;

    let count = 0;
    for (let i = 0; i < pointCount; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];
      const dist = Math.abs(nx * px + ny * py + nz * pz - d);
      if (dist < distanceThreshold) count++;
    }

    if (count > bestCount) {
      bestCount = count;
      bestNormal = [nx, ny, nz];
      bestD = d;
    }
  }

  if (bestCount < pointCount * minInlierRatio) return null;

  const inlierIndices: number[] = [];
  let sumZ = 0;
  const [nx, ny, nz] = bestNormal;
  for (let i = 0; i < pointCount; i++) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];
    const dist = Math.abs(nx * px + ny * py + nz * pz - bestD);
    if (dist < distanceThreshold) {
      inlierIndices.push(i);
      sumZ += pz;
    }
  }

  const groundZ = inlierIndices.length > 0 ? sumZ / inlierIndices.length : 0;

  return {
    normal: bestNormal,
    d: bestD,
    inlierIndices,
    inlierFraction: inlierIndices.length / pointCount,
    groundZ,
  };
}

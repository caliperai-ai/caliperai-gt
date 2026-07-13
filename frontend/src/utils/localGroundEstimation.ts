
export interface LocalGroundConfig {
  cellSize: number;
  groundPercentile: number;
  maxGroundHeight: number;
}

const DEFAULT_CONFIG: LocalGroundConfig = {
  cellSize: 2.0,
  groundPercentile: 10,
  maxGroundHeight: 5.0,
};

export function computeHeightAboveGround(
  positions: Float32Array,
  config: Partial<LocalGroundConfig> = {}
): Float32Array {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const pointCount = positions.length / 3;
  const result = new Float32Array(pointCount);

  if (pointCount === 0) return result;

  const invCellSize = 1.0 / cfg.cellSize;

  let xMin = Infinity, xMax = -Infinity;
  let yMin = Infinity, yMax = -Infinity;

  for (let i = 0; i < pointCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    if (x < xMin) xMin = x;
    if (x > xMax) xMax = x;
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }

  const cols = Math.ceil((xMax - xMin) * invCellSize) + 1;

  const cellZValues = new Map<number, number[]>();
  const cellIndices = new Int32Array(pointCount);

  for (let i = 0; i < pointCount; i++) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];

    const col = Math.floor((x - xMin) * invCellSize);
    const row = Math.floor((y - yMin) * invCellSize);
    const cellIdx = row * cols + col;
    cellIndices[i] = cellIdx;

    let zArr = cellZValues.get(cellIdx);
    if (!zArr) {
      zArr = [];
      cellZValues.set(cellIdx, zArr);
    }
    zArr.push(z);
  }

  const cellGroundHeight = new Map<number, number>();
  const percentileRatio = cfg.groundPercentile / 100;

  cellZValues.forEach((zArr, cellIdx) => {
    zArr.sort((a, b) => a - b);
    const idx = Math.floor(zArr.length * percentileRatio);
    const clampedIdx = Math.min(idx, zArr.length - 1);
    cellGroundHeight.set(cellIdx, zArr[clampedIdx]);
  });

  for (let i = 0; i < pointCount; i++) {
    const z = positions[i * 3 + 2];
    const groundZ = cellGroundHeight.get(cellIndices[i]) ?? z;
    result[i] = z - groundZ;
  }

  return result;
}

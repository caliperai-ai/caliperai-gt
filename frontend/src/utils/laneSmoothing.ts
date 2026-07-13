
export interface Point2D {
  x: number;
  y: number;
}


const getLaneYDirection = (points: Point2D[]): 1 | -1 => {
  if (points.length < 2) return 1;
  const firstY = points[0].y;
  const lastY = points[points.length - 1].y;
  return lastY >= firstY ? 1 : -1;
};

const sortByMonotonicY = (points: Point2D[]): Point2D[] => {
  if (points.length < 2) return points;

  const dir = getLaneYDirection(points);
  const sorted = [...points].sort((a, b) => dir === 1 ? a.y - b.y : b.y - a.y);

  const unique: Point2D[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y !== sorted[i - 1].y) {
      unique.push(sorted[i]);
    }
  }

  return unique;
};

const interpolateXasF_ofY = (
  points: Point2D[],
  numOutputPoints: number,
  tension: number = 0.5
): Point2D[] => {
  if (points.length < 2) return points;
  if (points.length === 2) {
    const result: Point2D[] = [];
    for (let i = 0; i < numOutputPoints; i++) {
      const t = i / (numOutputPoints - 1);
      result.push({
        x: points[0].x + (points[1].x - points[0].x) * t,
        y: points[0].y + (points[1].y - points[0].y) * t,
      });
    }
    return result;
  }

  const yValues = points.map(p => p.y);
  const xValues = points.map(p => p.x);

  const yMin = yValues[0];
  const yMax = yValues[yValues.length - 1];
  const yRange = yMax - yMin;

  if (yRange < 1) return points;

  const result: Point2D[] = [];

  for (let i = 0; i < numOutputPoints; i++) {
    const t = i / (numOutputPoints - 1);
    const targetY = yMin + t * yRange;

    let segIdx = 0;
    for (let j = 0; j < yValues.length - 1; j++) {
      if (targetY >= yValues[j] && targetY <= yValues[j + 1]) {
        segIdx = j;
        break;
      }
      if (j === yValues.length - 2) segIdx = j;
    }

    const segYRange = yValues[segIdx + 1] - yValues[segIdx];
    const localT = segYRange > 0 ? (targetY - yValues[segIdx]) / segYRange : 0;

    const x0 = xValues[Math.max(0, segIdx - 1)];
    const x1 = xValues[segIdx];
    const x2 = xValues[segIdx + 1];
    const x3 = xValues[Math.min(xValues.length - 1, segIdx + 2)];

    const interpX = catmullRomValue(x0, x1, x2, x3, localT, tension);

    result.push({ x: interpX, y: targetY });
  }

  if (result.length >= 2) {
    result[0] = { ...points[0] };
    result[result.length - 1] = { ...points[points.length - 1] };
  }

  return result;
};

export const enforceMonotonicY = (points: Point2D[]): Point2D[] => {
  if (points.length < 3) return points;

  const dir = getLaneYDirection(points);
  const result = points.map(p => ({ ...p }));

  if (dir === 1) {
    for (let i = 1; i < result.length; i++) {
      if (result[i].y < result[i - 1].y) {
        result[i].y = result[i - 1].y + 0.1;
      }
    }
  } else {
    for (let i = 1; i < result.length; i++) {
      if (result[i].y > result[i - 1].y) {
        result[i].y = result[i - 1].y - 0.1;
      }
    }
  }

  return result;
};


const catmullRomValue = (
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
  tension: number = 0.5
): number => {
  const t2 = t * t;
  const t3 = t2 * t;

  const m0 = tension * (p2 - p0);
  const m1 = tension * (p3 - p1);

  return (2 * t3 - 3 * t2 + 1) * p1 +
         (t3 - 2 * t2 + t) * m0 +
         (-2 * t3 + 3 * t2) * p2 +
         (t3 - t2) * m1;
};

export const smoothLaneCatmullRom = (
  points: Point2D[],
  samplesPerSegment: number = 5,
  tension: number = 0.5
): Point2D[] => {
  if (points.length < 2) return points;
  if (points.length === 2) return points;

  const result: Point2D[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    if (i === 0) {
      result.push({ ...p1 });
    }

    for (let j = 1; j <= samplesPerSegment; j++) {
      const t = j / samplesPerSegment;
      result.push({
        x: catmullRomValue(p0.x, p1.x, p2.x, p3.x, t, tension),
        y: catmullRomValue(p0.y, p1.y, p2.y, p3.y, t, tension),
      });
    }
  }

  return enforceMonotonicY(result);
};


const perpendicularDistance = (
  point: Point2D,
  lineStart: Point2D,
  lineEnd: Point2D
): number => {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  if (dx === 0 && dy === 0) {
    return Math.hypot(point.x - lineStart.x, point.y - lineStart.y);
  }

  const lineLengthSquared = dx * dx + dy * dy;
  const t = Math.max(0, Math.min(1,
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lineLengthSquared
  ));

  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;

  return Math.hypot(point.x - projX, point.y - projY);
};

export const simplifyLaneDouglasPeucker = (
  points: Point2D[],
  epsilon: number = 3.0
): Point2D[] => {
  if (points.length < 3) return points;

  let maxDist = 0;
  let maxIndex = 0;

  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > epsilon) {
    const left = simplifyLaneDouglasPeucker(points.slice(0, maxIndex + 1), epsilon);
    const right = simplifyLaneDouglasPeucker(points.slice(maxIndex), epsilon);

    return [...left.slice(0, -1), ...right];
  }

  return [first, last];
};


export const smoothLaneMovingAverage = (
  points: Point2D[],
  windowSize: number = 3
): Point2D[] => {
  if (points.length < windowSize) return points;

  const halfWindow = Math.floor(windowSize / 2);
  const result: Point2D[] = [];

  for (let i = 0; i < points.length; i++) {
    if (i < halfWindow || i >= points.length - halfWindow) {
      result.push({ ...points[i] });
      continue;
    }

    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (let j = i - halfWindow; j <= i + halfWindow; j++) {
      sumX += points[j].x;
      sumY += points[j].y;
      count++;
    }

    result.push({
      x: sumX / count,
      y: sumY / count,
    });
  }

  return result;
};


const isCollinear = (prev: Point2D, curr: Point2D, next: Point2D, threshold: number = 3): boolean => {
  const dx = next.x - prev.x;
  const dy = next.y - prev.y;
  const len = Math.sqrt(dx * dx + dy * dy);

  if (len < 1) return true;

  const crossProduct = Math.abs((curr.x - prev.x) * dy - (curr.y - prev.y) * dx);
  const perpDist = crossProduct / len;

  return perpDist < threshold;
};

export const smoothLaneOverall = (
  points: Point2D[],
  strength: number = 3,
  simplifyAfter: boolean = true,
  targetPointCount: number = 0
): Point2D[] => {
  if (points.length < 3) return points;

  const s = Math.max(1, Math.min(5, strength));

  const firstPoint = { ...points[0] };
  const lastPoint = { ...points[points.length - 1] };

  const sorted = sortByMonotonicY(points);
  if (sorted.length < 2) return points;

  const numOutputPoints = Math.round(sorted.length * (2 + s));
  const tension = 0.5 - (s * 0.04);

  let result = interpolateXasF_ofY(sorted, numOutputPoints, tension);

  const laplacianPasses = Math.round(s * 2);
  const laplacianFactor = 0.2 + (s * 0.1);

  for (let pass = 0; pass < laplacianPasses; pass++) {
    const newPoints: Point2D[] = [];
    newPoints.push({ ...result[0] });

    for (let i = 1; i < result.length - 1; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      const next = result[i + 1];

      if (isCollinear(prev, curr, next, 2)) {
        newPoints.push({ ...curr });
        continue;
      }

      const avgX = (prev.x + next.x) / 2;

      newPoints.push({
        x: curr.x + (avgX - curr.x) * laplacianFactor,
        y: curr.y,
      });
    }

    newPoints.push({ ...result[result.length - 1] });
    result = newPoints;
  }

  if (simplifyAfter) {
    const target = targetPointCount > 0 ? targetPointCount : Math.max(points.length, 8);
    let epsilon = 1.0;
    let simplified = simplifyLaneDouglasPeucker(result, epsilon);

    let attempts = 0;
    while (simplified.length > target * 1.5 && attempts < 10) {
      epsilon *= 1.5;
      simplified = simplifyLaneDouglasPeucker(result, epsilon);
      attempts++;
    }
    while (simplified.length < target * 0.6 && epsilon > 0.5 && attempts < 15) {
      epsilon *= 0.7;
      simplified = simplifyLaneDouglasPeucker(result, epsilon);
      attempts++;
    }

    result = simplified;
  }

  if (result.length >= 2) {
    result[0] = firstPoint;
    result[result.length - 1] = lastPoint;
  }

  result = enforceMonotonicY(result);

  return result;
};

export const smoothLaneLaplacianLight = (
  points: Point2D[],
  iterations: number = 3,
  factor: number = 0.5,
  collinearThreshold: number = 3
): Point2D[] => {
  if (points.length < 3) return points;

  let result = points.map(p => ({ ...p }));

  for (let iter = 0; iter < iterations; iter++) {
    const newPoints: Point2D[] = [];

    newPoints.push({ ...result[0] });

    for (let i = 1; i < result.length - 1; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      const next = result[i + 1];

      if (isCollinear(prev, curr, next, collinearThreshold)) {
        newPoints.push({ ...curr });
        continue;
      }

      const avgX = (prev.x + next.x) / 2;
      const avgY = (prev.y + next.y) / 2;

      newPoints.push({
        x: curr.x + (avgX - curr.x) * factor,
        y: curr.y + (avgY - curr.y) * factor,
      });
    }

    newPoints.push({ ...result[result.length - 1] });

    result = newPoints;
  }

  return result;
};

export const smoothLaneWeighted = (
  points: Point2D[],
  iterations: number = 2,
  factor: number = 0.4
): Point2D[] => {
  if (points.length < 5) {
    return smoothLaneLaplacianLight(points, iterations, factor);
  }

  let result = points.map(p => ({ ...p }));

  for (let iter = 0; iter < iterations; iter++) {
    const newPoints: Point2D[] = [];

    newPoints.push({ ...result[0] });
    newPoints.push({ ...result[1] });

    for (let i = 2; i < result.length - 2; i++) {
      const p0 = result[i - 2];
      const p1 = result[i - 1];
      const curr = result[i];
      const p3 = result[i + 1];
      const p4 = result[i + 2];

      const weightedX = (p0.x + 4 * p1.x + 6 * curr.x + 4 * p3.x + p4.x) / 16;
      const weightedY = (p0.y + 4 * p1.y + 6 * curr.y + 4 * p3.y + p4.y) / 16;

      newPoints.push({
        x: curr.x + (weightedX - curr.x) * factor,
        y: curr.y + (weightedY - curr.y) * factor,
      });
    }

    newPoints.push({ ...result[result.length - 2] });
    newPoints.push({ ...result[result.length - 1] });

    result = newPoints;
  }

  return result;
};

export const smoothLaneChaikin = (
  points: Point2D[],
  iterations: number = 3
): Point2D[] => {
  if (points.length < 3) return points;

  let result = [...points];

  for (let iter = 0; iter < iterations; iter++) {
    const newPoints: Point2D[] = [];

    newPoints.push(result[0]);

    for (let i = 0; i < result.length - 1; i++) {
      const p0 = result[i];
      const p1 = result[i + 1];

      const q: Point2D = {
        x: 0.75 * p0.x + 0.25 * p1.x,
        y: 0.75 * p0.y + 0.25 * p1.y,
      };

      const r: Point2D = {
        x: 0.25 * p0.x + 0.75 * p1.x,
        y: 0.25 * p0.y + 0.75 * p1.y,
      };

      newPoints.push(q, r);
    }

    newPoints.push(result[result.length - 1]);

    result = newPoints;
  }

  return result;
};


export const fitPolynomialLane = (
  points: Point2D[],
  degree: number = 2,
  numOutputPoints: number = 20
): Point2D[] => {
  if (points.length < degree + 1) return points;

  const sorted = [...points].sort((a, b) => b.y - a.y);

  const yVals = sorted.map(p => p.y);
  const xVals = sorted.map(p => p.x);

  const yMin = Math.min(...yVals);
  const yMax = Math.max(...yVals);
  const yRange = yMax - yMin || 1;
  const yNorm = yVals.map(y => (y - yMin) / yRange);

  const n = points.length;
  const m = degree + 1;


  const AtA: number[][] = Array(m).fill(null).map(() => Array(m).fill(0));
  const Atb: number[] = Array(m).fill(0);

  for (let i = 0; i < n; i++) {
    const yi = yNorm[i];
    const xi = xVals[i];

    const powers: number[] = [];
    let yPow = 1;
    for (let j = 0; j <= degree; j++) {
      powers.push(yPow);
      yPow *= yi;
    }

    for (let j = 0; j < m; j++) {
      Atb[j] += powers[j] * xi;
      for (let k = 0; k < m; k++) {
        AtA[j][k] += powers[j] * powers[k];
      }
    }
  }

  const coeffs = solveLinearSystem(AtA, Atb);

  if (!coeffs) {
    return smoothLaneChaikin(points, 3);
  }

  const result: Point2D[] = [];
  for (let i = 0; i < numOutputPoints; i++) {
    const t = i / (numOutputPoints - 1);
    const y = yMin + t * yRange;
    const yN = t;

    let x = 0;
    let yPow = 1;
    for (let j = 0; j <= degree; j++) {
      x += coeffs[j] * yPow;
      yPow *= yN;
    }

    result.push({ x, y });
  }

  return result;
};

function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = A.length;

  const aug: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) {
        maxRow = row;
      }
    }

    [aug[col], aug[maxRow]] = [aug[maxRow], aug[col]];

    if (Math.abs(aug[col][col]) < 1e-10) {
      return null;
    }

    for (let row = col + 1; row < n; row++) {
      const factor = aug[row][col] / aug[col][col];
      for (let j = col; j <= n; j++) {
        aug[row][j] -= factor * aug[col][j];
      }
    }
  }

  const x: number[] = Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = aug[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= aug[i][j] * x[j];
    }
    x[i] /= aug[i][i];
  }

  return x;
}


export const smoothLaneCurvatureConstrained = (
  points: Point2D[],
  maxAngleChange: number = Math.PI / 6,
  iterations: number = 5
): Point2D[] => {
  if (points.length < 3) return points;

  let result = [...points].sort((a, b) => b.y - a.y);

  for (let iter = 0; iter < iterations; iter++) {
    const newPoints: Point2D[] = [result[0]];

    for (let i = 1; i < result.length - 1; i++) {
      const prev = result[i - 1];
      const curr = result[i];
      const next = result[i + 1];

      const angleIn = Math.atan2(curr.y - prev.y, curr.x - prev.x);
      const angleOut = Math.atan2(next.y - curr.y, next.x - curr.x);

      let angleDiff = angleOut - angleIn;
      while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
      while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

      if (Math.abs(angleDiff) > maxAngleChange) {
        const midX = (prev.x + next.x) / 2;
        const midY = (prev.y + next.y) / 2;

        const blendFactor = Math.min(0.7, Math.abs(angleDiff) / Math.PI);
        newPoints.push({
          x: curr.x * (1 - blendFactor) + midX * blendFactor,
          y: curr.y * (1 - blendFactor) + midY * blendFactor,
        });
      } else {
        newPoints.push(curr);
      }
    }

    newPoints.push(result[result.length - 1]);
    result = newPoints;
  }

  return result;
};


export const smoothLaneSmart = (
  points: Point2D[],
  polynomialDegree: number = 2
): Point2D[] => {
  if (points.length < 3) return points;

  const numPoints = Math.max(15, Math.min(30, points.length));
  const fitted = fitPolynomialLane(points, polynomialDegree, numPoints);

  const smoothed = smoothLaneChaikin(fitted, 1);

  const simplified = simplifyLaneDouglasPeucker(smoothed, 1.5);

  return simplified;
};


export const smoothLaneJointsOnly = (
  points: Point2D[],
  cornerRadius: number = 10
): Point2D[] => {
  if (points.length < 3) return points;

  const result: Point2D[] = [];

  result.push({ ...points[0] });

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const toPrev = { x: prev.x - curr.x, y: prev.y - curr.y };
    const toNext = { x: next.x - curr.x, y: next.y - curr.y };

    const distPrev = Math.hypot(toPrev.x, toPrev.y);
    const distNext = Math.hypot(toNext.x, toNext.y);

    if (distPrev < cornerRadius * 2 || distNext < cornerRadius * 2) {
      result.push({ ...curr });
      continue;
    }

    const angle = Math.atan2(
      toPrev.x * toNext.y - toPrev.y * toNext.x,
      toPrev.x * toNext.x + toPrev.y * toNext.y
    );

    if (Math.abs(angle) < Math.PI / 9) {
      result.push({ ...curr });
      continue;
    }

    const normPrev = { x: toPrev.x / distPrev, y: toPrev.y / distPrev };
    const normNext = { x: toNext.x / distNext, y: toNext.y / distNext };

    const offsetDist = Math.min(cornerRadius, distPrev / 3, distNext / 3);

    const p1: Point2D = {
      x: curr.x + normPrev.x * offsetDist,
      y: curr.y + normPrev.y * offsetDist,
    };

    const p2: Point2D = {
      x: curr.x + normNext.x * offsetDist,
      y: curr.y + normNext.y * offsetDist,
    };

    result.push(p1);
    result.push({ ...curr });
    result.push(p2);
  }

  result.push({ ...points[points.length - 1] });

  return result;
};

export const smoothLaneJointsMinimal = (
  points: Point2D[],
  maxAngle: number = Math.PI / 4,
  blendFactor: number = 0.3
): Point2D[] => {
  if (points.length < 3) return points;

  const result: Point2D[] = [];

  result.push({ ...points[0] });

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    const angleIn = Math.atan2(curr.y - prev.y, curr.x - prev.x);
    const angleOut = Math.atan2(next.y - curr.y, next.x - curr.x);

    let angleDiff = angleOut - angleIn;
    while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
    while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

    if (Math.abs(angleDiff) > maxAngle) {
      const midX = (prev.x + next.x) / 2;
      const midY = (prev.y + next.y) / 2;

      result.push({
        x: curr.x + (midX - curr.x) * blendFactor,
        y: curr.y + (midY - curr.y) * blendFactor,
      });
    } else {
      result.push({ ...curr });
    }
  }

  result.push({ ...points[points.length - 1] });

  return result;
};


export const snapLaneToVanishingLine = (
  points: Point2D[],
  vanishingLineY: number,
  imageWidth: number
): Point2D[] => {
  if (points.length < 2) return points;

  const sortedByY = [...points].sort((a, b) => a.y - b.y);
  const topPoint = sortedByY[0];
  const secondPoint = sortedByY[1];

  if (topPoint.y <= vanishingLineY) {
    return points.filter(p => p.y >= vanishingLineY);
  }

  const dx = topPoint.x - secondPoint.x;
  const dy = topPoint.y - secondPoint.y;

  if (dy === 0) {
    return [...points, { x: topPoint.x, y: vanishingLineY }];
  }

  const ratio = (vanishingLineY - topPoint.y) / dy;
  const newX = topPoint.x + dx * ratio;

  const clampedX = Math.max(0, Math.min(imageWidth, newX));

  const result = [...points, { x: clampedX, y: vanishingLineY }];

  return result.sort((a, b) => b.y - a.y);
};


export const fitQuadraticBezier = (
  points: Point2D[]
): { start: Point2D; control: Point2D; end: Point2D } => {
  if (points.length < 2) {
    return { start: points[0], control: points[0], end: points[0] };
  }

  const start = points[0];
  const end = points[points.length - 1];

  if (points.length === 2) {
    return {
      start,
      control: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
      end,
    };
  }

  let maxDeviation = 0;
  let controlPoint = points[Math.floor(points.length / 2)];

  for (const point of points) {
    const dist = perpendicularDistance(point, start, end);
    if (dist > maxDeviation) {
      maxDeviation = dist;
      controlPoint = point;
    }
  }

  return { start, control: controlPoint, end };
};

export const evaluateQuadraticBezier = (
  start: Point2D,
  control: Point2D,
  end: Point2D,
  t: number
): Point2D => {
  const mt = 1 - t;
  return {
    x: mt * mt * start.x + 2 * mt * t * control.x + t * t * end.x,
    y: mt * mt * start.y + 2 * mt * t * control.y + t * t * end.y,
  };
};

export const bezierToPolyline = (
  start: Point2D,
  control: Point2D,
  end: Point2D,
  numPoints: number = 20
): Point2D[] => {
  const result: Point2D[] = [];
  for (let i = 0; i <= numPoints; i++) {
    const t = i / numPoints;
    result.push(evaluateQuadraticBezier(start, control, end, t));
  }
  return result;
};


export const smoothLaneRegion = (
  points: Point2D[],
  yStart: number,
  yEnd: number,
  windowSize: number = 5
): Point2D[] => {
  const sorted = [...points].sort((a, b) => b.y - a.y);

  const before: Point2D[] = [];
  const region: Point2D[] = [];
  const after: Point2D[] = [];

  for (const p of sorted) {
    if (p.y > yStart) {
      before.push(p);
    } else if (p.y >= yEnd) {
      region.push(p);
    } else {
      after.push(p);
    }
  }

  const smoothedRegion = smoothLaneMovingAverage(region, windowSize);

  return [...before, ...smoothedRegion, ...after];
};


export const cleanupLane = (
  points: Point2D[],
  _simplifyEpsilon: number = 2.0,
  _smoothTension: number = 0.5,
  isAiPredicted: boolean = false
): Point2D[] => {
  if (points.length < 3) return points;

  if (isAiPredicted) {
    return enforceMonotonicY(points);
  }

  let result = smoothLanePCHIP(points, 60, true, 0, 10);
  result = enforceMonotonicY(result);
  return result;
};


const isLaneCollinear = (points: Point2D[], threshold: number = 5): boolean => {
  if (points.length <= 2) return true;
  const start = points[0];
  const end = points[points.length - 1];
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (len < 1) return true;
  for (let i = 1; i < points.length - 1; i++) {
    const dist = Math.abs(dy * points[i].x - dx * points[i].y + end.x * start.y - end.y * start.x) / len;
    if (dist > threshold) return false;
  }
  return true;
};

export const limitLanePoints = (
  points: Point2D[],
  maxCollinear: number = 4,
  maxCurved: number = 10,
  collinearThreshold: number = 5,
): Point2D[] => {
  if (points.length <= 2) return points;

  const collinear = isLaneCollinear(points, collinearThreshold);
  const maxPts = collinear ? maxCollinear : maxCurved;
  console.log(`[LimitPts] ${points.length} pts, collinear=${collinear}, target=${maxPts}`);

  if (points.length <= maxPts) return points;

  if (collinear) {
    // Pick evenly-spaced points FROM the original array — never interpolate
    const result: Point2D[] = [];
    for (let i = 0; i < maxPts; i++) {
      const idx = Math.round(i * (points.length - 1) / (maxPts - 1));
      result.push({ ...points[idx] });
    }
    return result;
  }

  // Curved: use RDP with increasing epsilon until we hit maxPts
  let eps = 1.0;
  let simplified = simplifyLaneDouglasPeucker(points, eps);
  for (let attempt = 0; attempt < 30 && simplified.length > maxPts; attempt++) {
    eps *= 1.3;
    simplified = simplifyLaneDouglasPeucker(points, eps);
  }
  // Ensure at least 3 points even with aggressive simplify
  if (simplified.length < 3 && points.length >= 3) {
    simplified = [points[0], points[Math.floor(points.length / 2)], points[points.length - 1]];
  }
  // Exact endpoints
  if (simplified.length >= 2) {
    simplified[0] = { ...points[0] };
    simplified[simplified.length - 1] = { ...points[points.length - 1] };
  }
  return simplified;
};

// =============================================================================
// CONVERT AUTO-DETECTED LANE TO 3-HANDLE BEZIER
// =============================================================================

/**
 * Convert a raw detected lane to a 3-handle Bezier representation.
 * This drastically reduces the number of interactive points for editing.
 *
 * Returns: start (bottom), control (middle - draggable for curvature), end (top at VP line)
 */
export const convertToEditableBezier = (
  points: Point2D[],
  vanishingLineY?: number,
  imageWidth?: number
): { handles: [Point2D, Point2D, Point2D]; originalPoints: Point2D[] } => {
  // First extend to VP line if provided
  let processed = points;
  if (vanishingLineY !== undefined && imageWidth !== undefined) {
    processed = snapLaneToVanishingLine(points, vanishingLineY, imageWidth);
  }

  // Fit bezier
  const { start, control, end } = fitQuadraticBezier(processed);

  return {
    handles: [start, control, end],
    originalPoints: processed,
  };
};

// =============================================================================
// PCHIP — Piecewise Cubic Hermite Interpolating Polynomial  (x = f(y))
// =============================================================================
//
// WHY PCHIP?
//  • Catmull-Rom can overshoot (wiggles between points).
//  • Polynomial fitting changes the lane shape.
//  • PCHIP is monotone-preserving: it NEVER introduces oscillations.
//    If x is monotone between two nearby y-samples, x stays monotone there.
//  • It passes through every original control point.
//  • Result looks smooth and physically realistic.
//
// KEY INVARIANT: Y is strictly monotone by construction (we sort + deduplicate).
//               X is interpolated as a smooth function of Y.

/**
 * Compute PCHIP tangent slopes (dx/dy at each point).
 * Uses the Fritsch–Carlson monotone-cubic algorithm.
 */
function pchipTangents(y: number[], x: number[]): number[] {
  const n = y.length;
  if (n < 2) return new Array(n).fill(0);

  // Step 1 — chord slopes δᵢ = Δxᵢ / Δyᵢ
  const h: number[] = [];      // interval lengths Δyᵢ
  const delta: number[] = [];  // chord slopes δᵢ
  for (let i = 0; i < n - 1; i++) {
    const dy = y[i + 1] - y[i];
    h.push(dy === 0 ? 1e-10 : dy);  // guard zero-length
    delta.push((x[i + 1] - x[i]) / h[i]);
  }

  // Step 2 — initial tangent estimates (arithmetic mean for interior)
  const d: number[] = new Array(n).fill(0);

  // Endpoints: non-centered three-point formula (clamped to not overshoot)
  const clampEndSlope = (slope: number, neighborDelta: number) => {
    if (Math.sign(slope) !== Math.sign(neighborDelta)) return 0;
    return Math.sign(slope) * Math.min(Math.abs(slope), 3 * Math.abs(neighborDelta));
  };

  if (n === 2) {
    d[0] = delta[0];
    d[1] = delta[0];
    return d;
  }

  // 3-point endpoint formula
  const d0Raw = ((2 * h[0] + h[1]) * delta[0] - h[0] * delta[1]) / (h[0] + h[1]);
  d[0] = clampEndSlope(d0Raw, delta[0]);

  const dNRaw = ((2 * h[n - 2] + h[n - 3]) * delta[n - 2] - h[n - 2] * delta[n - 3]) / (h[n - 2] + h[n - 3]);
  d[n - 1] = clampEndSlope(dNRaw, delta[n - 2]);

  // Interior: weighted harmonic mean (same sign) or 0 (extremum)
  for (let i = 1; i < n - 1; i++) {
    if (Math.sign(delta[i - 1]) !== Math.sign(delta[i])) {
      d[i] = 0;  // local extremum — set tangent to 0 for shape preservation
    } else {
      // h-weighted arithmetic mean (scipy's pchip formula)
      d[i] = (delta[i - 1] * h[i] + delta[i] * h[i - 1]) / (h[i - 1] + h[i]);
    }
  }

  // Step 3 — Fritsch–Carlson monotonicity limiter
  // Ensures no overshoot by scaling tangents so α²+β²≤9
  for (let i = 0; i < n - 1; i++) {
    if (Math.abs(delta[i]) < 1e-10) {
      d[i] = 0;
      d[i + 1] = 0;
      continue;
    }
    const alpha = d[i] / delta[i];
    const beta  = d[i + 1] / delta[i];
    const r = alpha * alpha + beta * beta;
    if (r > 9) {
      const tau = 3 / Math.sqrt(r);
      d[i]     = tau * alpha * Math.abs(delta[i]);
      d[i + 1] = tau * beta  * Math.abs(delta[i]);
    }
  }

  return d;
}

/**
 * Evaluate the cubic-Hermite polynomial at a single Y target within a segment.
 *
 * @param y0 y at left knot       @param y1 y at right knot
 * @param x0 x at left knot       @param x1 x at right knot
 * @param d0 dx/dy at left knot   @param d1 dx/dy at right knot
 * @param yTarget target y value
 */
function pchipEval(
  y0: number, y1: number,
  x0: number, x1: number,
  d0: number, d1: number,
  yTarget: number
): number {
  const h = y1 - y0;
  if (Math.abs(h) < 1e-10) return x0;
  const t  = (yTarget - y0) / h;
  const t2 = t * t;
  const t3 = t2 * t;

  // Cubic Hermite basis functions
  const h00 = 2 * t3 - 3 * t2 + 1;   // 1 at t=0, 0 at t=1
  const h10 = t3 - 2 * t2 + t;        // slope-scale at t=0
  const h01 = -2 * t3 + 3 * t2;       // 0 at t=0, 1 at t=1
  const h11 = t3 - t2;                 // slope-scale at t=1

  return h00 * x0 + h10 * h * d0 + h01 * x1 + h11 * h * d1;
}

/**
 * Smooth a lane using PCHIP (Monotone Piecewise Cubic Hermite Interpolation)
 * followed by iterative Laplacian smoothing on X.
 *
 * Pipeline:
 *  1. Sort by Y, deduplicate → monotone knots
 *  2. PCHIP-interpolate to dense curve (x = f(y), passes through originals)
 *  3. Laplacian smoothing on X only (Y stays fixed → monotone guaranteed)
 *     — This is what actually removes jaggedness!
 *  4. Douglas-Peucker simplify to manageable count
 *
 * @param points         Original lane control points (any order)
 * @param numOutputPoints How many densely-sampled points to return (default 60)
 * @param simplify       Whether to Douglas-Peucker simplify back
 * @param simplifyTarget Approximate target count after simplification (0 = auto)
 * @param smoothStrength Number of Laplacian passes (default 8; more = smoother)
 */
export const smoothLanePCHIP = (
  points: Point2D[],
  _numOutputPoints: number = 60,
  _simplify: boolean = true,
  _simplifyTarget: number = 0,
  smoothStrength: number = 8,
): Point2D[] => {
  console.log('[SMOOTH-v6] Input:', points.length, 'pts');
  if (points.length < 2) return points;

  // ─── PRINCIPLE ──────────────────────────────────────────────────
  // Control points are ground-truth (placed on the lane).
  // We NEVER move them. We only ADD Catmull-Rom interpolated points
  // between consecutive originals for a smooth visual curve.
  // All original points are preserved exactly in the output.
  // ────────────────────────────────────────────────────────────────

  // 1. Sort by Y ASCENDING (needed for monotonic lane math)
  const ascending = [...points].sort((a, b) => a.y - b.y);

  // Deduplicate by Y (keep first for each Y within 0.5px)
  const sorted: Point2D[] = [ascending[0]];
  for (let i = 1; i < ascending.length; i++) {
    if (Math.abs(ascending[i].y - sorted[sorted.length - 1].y) > 0.5) {
      sorted.push(ascending[i]);
    }
  }
  if (sorted.length < 2) return points;

  console.log('[SMOOTH-v7] Sorted ascending:', sorted.length, 'pts, yMin:', sorted[0].y, 'yMax:', sorted[sorted.length - 1].y);

  // Helper: check if 3 consecutive points are collinear
  const areThreeCollinear = (p0: Point2D, p1: Point2D, p2: Point2D, threshold: number = 3): boolean => {
    const dx = p2.x - p0.x;
    const dy = p2.y - p0.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1) return true;
    const dist = Math.abs(dy * p1.x - dx * p1.y + p2.x * p0.y - p2.y * p0.x) / len;
    return dist <= threshold;
  };

  // 2. Detect collinear runs (3+ consecutive points on straight line)
  //    For collinear segments: linear interpolation (preserves straight lines)
  //    For curved segments: cubic spline interpolation (smooth curves)
  const n = sorted.length;
  const isCollinearSegment: boolean[] = new Array(n - 1).fill(false);

  // Mark segments that are part of a collinear run
  for (let i = 0; i < n - 2; i++) {
    if (areThreeCollinear(sorted[i], sorted[i + 1], sorted[i + 2])) {
      isCollinearSegment[i] = true;
      isCollinearSegment[i + 1] = true;
    }
  }

  // Build tridiagonal system for cubic spline coefficients
  const yVals = sorted.map(p => p.y);
  const xVals = sorted.map(p => p.x);

  // Compute second derivatives using natural spline boundary conditions
  const h: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    h.push(yVals[i + 1] - yVals[i]);
  }

  const alpha: number[] = [0];
  for (let i = 1; i < n - 1; i++) {
    alpha.push(
      (3 / h[i]) * (xVals[i + 1] - xVals[i]) -
      (3 / h[i - 1]) * (xVals[i] - xVals[i - 1])
    );
  }

  const l: number[] = [1];
  const mu: number[] = [0];
  const z: number[] = [0];

  for (let i = 1; i < n - 1; i++) {
    l.push(2 * (yVals[i + 1] - yVals[i - 1]) - h[i - 1] * mu[i - 1]);
    mu.push(h[i] / l[i]);
    z.push((alpha[i] - h[i - 1] * z[i - 1]) / l[i]);
  }

  l.push(1);
  z.push(0);

  const c: number[] = new Array(n).fill(0);
  const b: number[] = new Array(n - 1);
  const d: number[] = new Array(n - 1);

  for (let j = n - 2; j >= 0; j--) {
    c[j] = z[j] - mu[j] * c[j + 1];
    b[j] = (xVals[j + 1] - xVals[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
    d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
  }

  // Generate interpolated points
  const ptsBetween = Math.max(5, Math.round(smoothStrength));
  const output: Point2D[] = [];

  for (let i = 0; i < n - 1; i++) {
    // Include original control point
    output.push({ ...sorted[i] });

    const p1 = sorted[i];
    const p2 = sorted[i + 1];

    // For collinear segments: linear interpolation (preserves straight lines)
    if (isCollinearSegment[i]) {
      for (let j = 1; j <= ptsBetween; j++) {
        const t = j / (ptsBetween + 1);
        output.push({
          x: p1.x + (p2.x - p1.x) * t,
          y: p1.y + (p2.y - p1.y) * t,
        });
      }
    } else {
      // For curved segments: cubic spline interpolation
      const yStart = yVals[i];
      const yEnd = yVals[i + 1];

      for (let j = 1; j <= ptsBetween; j++) {
        const t = j / (ptsBetween + 1);
        const y = yStart + t * (yEnd - yStart);
        const dy = y - yStart;

        // Cubic spline evaluation: x(y) = a + b*dy + c*dy² + d*dy³
        const x = xVals[i] + b[i] * dy + c[i] * dy * dy + d[i] * dy * dy * dy;

        output.push({ x, y });
      }
    }
  }

  // Include final control point
  output.push({ ...sorted[n - 1] });

  console.log('[SMOOTH-v7] Output:', output.length, 'pts (', n, 'original +', output.length - n, 'interpolated)');

  // Hybrid approach: linear for straight segments, cubic spline for curves
  return output;
};

/**
 * Ensure a lane has at least `minPoints` points.
 * For collinear/straight lanes the extra points are evenly spaced along the line.
 * For curved lanes the existing shape is preserved by PCHIP re-sampling.
 *
 * Use this right after lane creation so every lane starts with enough
 * control points for meaningful editing and smoothing.
 */
export const ensureMinLanePoints = (
  points: Point2D[],
  minPoints: number = 4,
): Point2D[] => {
  if (points.length >= minPoints) return points;
  if (points.length < 2) return points;

  const sorted = sortByMonotonicY(points);
  if (sorted.length < 2) return points;

  // For 2-3 points that are basically collinear, just linearly interpolate
  const first = sorted[0];
  const last  = sorted[sorted.length - 1];

  // Check collinearity: max deviation of interior points from the line first→last
  let maxDev = 0;
  const dx = last.x - first.x;
  const dy = last.y - first.y;
  const len2 = dx * dx + dy * dy;
  if (len2 > 0) {
    for (let i = 1; i < sorted.length - 1; i++) {
      const t = ((sorted[i].x - first.x) * dx + (sorted[i].y - first.y) * dy) / len2;
      const projX = first.x + t * dx;
      const projY = first.y + t * dy;
      const dev = Math.sqrt((sorted[i].x - projX) ** 2 + (sorted[i].y - projY) ** 2);
      if (dev > maxDev) maxDev = dev;
    }
  }

  // If nearly collinear (< 3px deviation), distribute points evenly on the line
  if (maxDev < 3 || sorted.length === 2) {
    const out: Point2D[] = [];
    for (let i = 0; i < minPoints; i++) {
      const t = i / (minPoints - 1);
      out.push({
        x: first.x + t * (last.x - first.x),
        y: first.y + t * (last.y - first.y),
      });
    }
    return out;
  }

  // Curved: use PCHIP to resample to minPoints (no simplification)
  const yKnots = sorted.map(p => p.y);
  const xKnots = sorted.map(p => p.x);
  const d = pchipTangents(yKnots, xKnots);
  const yMin = yKnots[0];
  const yMax = yKnots[yKnots.length - 1];
  const out: Point2D[] = [];
  for (let i = 0; i < minPoints; i++) {
    const t = i / (minPoints - 1);
    const yTarget = yMin + t * (yMax - yMin);
    let lo = 0;
    let hi = yKnots.length - 2;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (yKnots[mid + 1] < yTarget) lo = mid + 1;
      else hi = mid;
    }
    out.push({
      x: pchipEval(yKnots[lo], yKnots[lo + 1], xKnots[lo], xKnots[lo + 1], d[lo], d[lo + 1], yTarget),
      y: yTarget,
    });
  }
  // Force exact endpoints
  out[0] = { ...sorted[0] };
  out[out.length - 1] = { ...sorted[sorted.length - 1] };
  return out;
};

/**
 * Validate that a lane satisfies x = f(y) (strictly monotone Y).
 * Returns true if the lane is valid, false if it self-intersects in Y.
 */
export const isLaneMonotone = (points: Point2D[]): boolean => {
  if (points.length < 2) return true;
  const dir = getLaneYDirection(points);
  for (let i = 1; i < points.length; i++) {
    const dy = points[i].y - points[i - 1].y;
    if (dir === 1 && dy < 0) return false;
    if (dir === -1 && dy > 0) return false;
  }
  return true;
};

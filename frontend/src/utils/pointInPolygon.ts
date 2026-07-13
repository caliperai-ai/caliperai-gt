
export interface Point2D {
  x: number;
  y: number;
}

export function pointInPolygon(point: Point2D, polygon: Point2D[]): boolean {
  if (polygon.length < 3) return false;

  const { x, y } = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;

    const intersect = ((yi > y) !== (yj > y)) &&
                      (x < (xj - xi) * (y - yi) / (yj - yi) + xi);

    if (intersect) inside = !inside;
  }

  return inside;
}

export function pointsInPolygon(points: Point2D[], polygon: Point2D[]): boolean[] {
  return points.map(point => pointInPolygon(point, polygon));
}

export function filterPointsInPolygon<T extends Point2D>(
  points: T[],
  polygon: Point2D[]
): T[] {
  return points.filter(point => pointInPolygon(point, polygon));
}

export function getIndicesInPolygon(points: Point2D[], polygon: Point2D[]): number[] {
  const indices: number[] = [];

  for (let i = 0; i < points.length; i++) {
    if (pointInPolygon(points[i], polygon)) {
      indices.push(i);
    }
  }

  return indices;
}

export function polygonCentroid(polygon: Point2D[]): Point2D {
  if (polygon.length === 0) return { x: 0, y: 0 };

  let x = 0;
  let y = 0;

  for (const point of polygon) {
    x += point.x;
    y += point.y;
  }

  return {
    x: x / polygon.length,
    y: y / polygon.length,
  };
}

export function polygonBounds(polygon: Point2D[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  if (polygon.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const point of polygon) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, minY, maxX, maxY };
}

export function polygonArea(polygon: Point2D[]): number {
  if (polygon.length < 3) return 0;

  let area = 0;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    area += (polygon[j].x + polygon[i].x) * (polygon[j].y - polygon[i].y);
  }

  return area / 2;
}

export function simplifyPolygon(polygon: Point2D[], tolerance: number): Point2D[] {
  if (polygon.length <= 2) return polygon;

  let maxDist = 0;
  let maxIndex = 0;

  const start = polygon[0];
  const end = polygon[polygon.length - 1];

  for (let i = 1; i < polygon.length - 1; i++) {
    const dist = perpendicularDistance(polygon[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyPolygon(polygon.slice(0, maxIndex + 1), tolerance);
    const right = simplifyPolygon(polygon.slice(maxIndex), tolerance);

    return [...left.slice(0, -1), ...right];
  }

  return [start, end];
}

function perpendicularDistance(point: Point2D, lineStart: Point2D, lineEnd: Point2D): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  if (dx === 0 && dy === 0) {
    return Math.sqrt(
      Math.pow(point.x - lineStart.x, 2) +
      Math.pow(point.y - lineStart.y, 2)
    );
  }

  const area = Math.abs(
    (lineEnd.y - lineStart.y) * point.x -
    (lineEnd.x - lineStart.x) * point.y +
    lineEnd.x * lineStart.y -
    lineEnd.y * lineStart.x
  );

  const lineLength = Math.sqrt(dx * dx + dy * dy);

  return area / lineLength;
}

export function offsetPolygon(polygon: Point2D[], distance: number): Point2D[] {
  if (polygon.length < 3) return polygon;

  const result: Point2D[] = [];
  const n = polygon.length;

  for (let i = 0; i < n; i++) {
    const prev = polygon[(i - 1 + n) % n];
    const curr = polygon[i];
    const next = polygon[(i + 1) % n];

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const len1 = Math.sqrt(dx1 * dx1 + dy1 * dy1) || 1;
    const nx1 = -dy1 / len1;
    const ny1 = dx1 / len1;

    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;
    const len2 = Math.sqrt(dx2 * dx2 + dy2 * dy2) || 1;
    const nx2 = -dy2 / len2;
    const ny2 = dx2 / len2;

    let nx = (nx1 + nx2) / 2;
    let ny = (ny1 + ny2) / 2;
    const nlen = Math.sqrt(nx * nx + ny * ny) || 1;
    nx /= nlen;
    ny /= nlen;

    result.push({
      x: curr.x + nx * distance,
      y: curr.y + ny * distance,
    });
  }

  return result;
}

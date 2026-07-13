import polygonClipping from 'polygon-clipping';
import type { Annotation2D } from '@/store/annotation2DStore';

export type Pt = { x: number; y: number };

type Ring = [number, number][];
type Poly = Ring[];
type MultiPoly = Poly[];

export interface ClipResult {
  polygon: Pt[] | null;
  reason?: 'empty' | 'covered' | 'out_of_bounds';
  originalArea: number;
  clippedArea: number;
}

const toRing = (pts: Pt[]): Ring => {
  const r: Ring = pts.map((p) => [p.x, p.y]);
  if (r.length > 0) {
    const [fx, fy] = r[0];
    const [lx, ly] = r[r.length - 1];
    if (fx !== lx || fy !== ly) r.push([fx, fy]);
  }
  return r;
};

const fromRing = (ring: Ring): Pt[] => {
  const out = ring.map(([x, y]) => ({ x, y }));
  if (out.length > 1) {
    const f = out[0];
    const l = out[out.length - 1];
    if (f.x === l.x && f.y === l.y) out.pop();
  }
  return out;
};

const ringArea = (ring: Ring): number => {
  let a = 0;
  for (let i = 0, n = ring.length - 1; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
};

const polyArea = (poly: Poly): number => {
  if (poly.length === 0) return 0;
  let a = ringArea(poly[0]);
  for (let i = 1; i < poly.length; i++) a -= ringArea(poly[i]);
  return Math.max(0, a);
};

const extractPolygons = (ann: Annotation2D): Pt[][] => {
  const data = ann.data as { polygon?: Pt[]; points?: Pt[] };
  if (ann.type === 'semantic_segment' && Array.isArray(data.polygon) && data.polygon.length >= 3) {
    return [data.polygon];
  }
  if (ann.type === 'polygon' && Array.isArray(data.points) && data.points.length >= 3) {
    return [data.points];
  }
  return [];
};

export function clipAgainstExisting(
  polygon: Pt[],
  imageSize: { width: number; height: number },
  existingAnnotations: Annotation2D[],
  excludeId?: string,
): ClipResult {
  if (polygon.length < 3) {
    return { polygon: null, reason: 'empty', originalArea: 0, clippedArea: 0 };
  }

  const subjectRing = toRing(polygon);
  const subject: MultiPoly = [[subjectRing]];
  const originalArea = ringArea(subjectRing);

  const W = imageSize.width;
  const H = imageSize.height;
  const imageRect: MultiPoly = [[
    [
      [0, 0],
      [W, 0],
      [W, H],
      [0, H],
      [0, 0],
    ],
  ]];

  let clipped: MultiPoly;
  try {
    clipped = polygonClipping.intersection(subject, imageRect) as MultiPoly;
  } catch {
    return { polygon: null, reason: 'empty', originalArea, clippedArea: 0 };
  }
  if (!clipped || clipped.length === 0) {
    return { polygon: null, reason: 'out_of_bounds', originalArea, clippedArea: 0 };
  }

  const clippings: MultiPoly = [];
  for (const ann of existingAnnotations) {
    if (excludeId && ann.id === excludeId) continue;
    if (ann.isHidden) continue;
    for (const pts of extractPolygons(ann)) {
      const r = toRing(pts);
      if (r.length >= 4) clippings.push([r]);
    }
  }

  if (clippings.length > 0) {
    try {
      clipped = polygonClipping.difference(clipped, ...clippings) as MultiPoly;
    } catch {
      return { polygon: null, reason: 'empty', originalArea, clippedArea: 0 };
    }
  }

  if (!clipped || clipped.length === 0) {
    return { polygon: null, reason: 'covered', originalArea, clippedArea: 0 };
  }

  let bestPoly: Poly | null = null;
  let bestArea = 0;
  for (const poly of clipped) {
    const a = polyArea(poly);
    if (a > bestArea) {
      bestArea = a;
      bestPoly = poly;
    }
  }

  if (!bestPoly || bestArea <= 0) {
    return { polygon: null, reason: 'covered', originalArea, clippedArea: 0 };
  }

  return {
    polygon: fromRing(bestPoly[0]),
    originalArea,
    clippedArea: bestArea,
  };
}

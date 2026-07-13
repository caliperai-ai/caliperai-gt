
import type { QASuggestion } from '@/types';
import type { Annotation2D, BoxData, RotatedBoxData, EllipseData } from '@/store/annotation2DStore';


export interface Annotation2DMetrics {
  annotationId: string;
  area: number;
  aspectRatio: number;
  relativeSize: number;
  edgeProximity: number;
  complexity: number;
  isInterpolated: boolean;
}

export interface Track2DMetrics {
  trackId: string;
  annotations: Annotation2D[];
  frameCount: number;
  avgSize: number;
  sizeVariance: number;
  avgAspectRatio: number;
  aspectRatioVariance: number;
  avgVelocity: number;
  maxVelocity: number;
  directionChanges: number;
  hasGaps: boolean;
  gapCount: number;
}

export interface Difficulty2DScore {
  annotationId: string;
  trackId?: string;
  totalScore: number;
  confidence: number;
  breakdown: {
    sizeScore: number;
    aspectRatioScore: number;
    edgeScore: number;
    classScore: number;
    complexityScore: number;
    temporalScore: number;
    suggestionScore: number;
  };
  issues: string[];
  priorityRank: number;
}

export interface Box2DDifficulty {
  annotationId: string;
  frameId: string;
  trackId?: string;
  score: number;
  factors: {
    size: number;
    aspectRatio: number;
    edgeProximity: number;
    isInterpolated: boolean;
    velocityChange: number;
    sizeChange: number;
  };
  rank: number;
}


const CLASS_2D_DIFFICULTY: Record<string, number> = {
  'pedestrian': 0.9,
  'person': 0.9,
  'cyclist': 0.85,
  'bicycle': 0.85,
  'motorcycle': 0.85,
  'animal': 0.95,
  'dog': 0.9,
  'cat': 0.9,
  'bird': 0.95,
  'traffic_sign': 0.7,
  'traffic_light': 0.75,
  'car': 0.5,
  'vehicle': 0.5,
  'truck': 0.4,
  'bus': 0.35,
  'train': 0.3,
  'building': 0.3,
  'road': 0.25,
};

const SIZE_THRESHOLDS = {
  TINY: 1000,
  SMALL: 5000,
  MEDIUM: 20000,
  LARGE: 100000,
};

const ASPECT_RATIO_ANOMALY = {
  MIN_NORMAL: 0.25,
  MAX_NORMAL: 4.0,
  PEDESTRIAN_MIN: 0.3,
  PEDESTRIAN_MAX: 0.8,
  VEHICLE_MIN: 1.0,
  VEHICLE_MAX: 3.5,
};


function getBoundingBox(ann: Annotation2D): { x: number; y: number; width: number; height: number } | null {
  const data = ann.data;

  if ('x' in data && 'y' in data && 'width' in data && 'height' in data) {
    const boxData = data as BoxData;
    return { x: boxData.x, y: boxData.y, width: boxData.width, height: boxData.height };
  }

  if ('cx' in data && 'cy' in data && 'width' in data && 'height' in data) {
    const rotData = data as RotatedBoxData | EllipseData;
    const w = 'rx' in rotData ? rotData.rx * 2 : rotData.width;
    const h = 'ry' in rotData ? rotData.ry * 2 : rotData.height;
    return { x: rotData.cx - w / 2, y: rotData.cy - h / 2, width: w, height: h };
  }

  if ('points' in data || 'polygon' in data) {
    const points = 'polygon' in data ? (data as any).polygon : (data as any).points;
    if (!points || points.length === 0) return null;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  return null;
}

function getCenter(ann: Annotation2D): { x: number; y: number } | null {
  const box = getBoundingBox(ann);
  if (!box) return null;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function calculateArea(ann: Annotation2D): number {
  const box = getBoundingBox(ann);
  if (!box) return 0;
  return box.width * box.height;
}

function calculateAspectRatio(ann: Annotation2D): number {
  const box = getBoundingBox(ann);
  if (!box || box.height === 0) return 1;
  return box.width / box.height;
}

function calculateDistance(ann1: Annotation2D, ann2: Annotation2D): number {
  const c1 = getCenter(ann1);
  const c2 = getCenter(ann2);
  if (!c1 || !c2) return 0;
  return Math.sqrt((c2.x - c1.x) ** 2 + (c2.y - c1.y) ** 2);
}

function calculateEdgeProximity(ann: Annotation2D, imageWidth: number, imageHeight: number): number {
  const center = getCenter(ann);
  if (!center) return 0;

  const imgCenterX = imageWidth / 2;
  const imgCenterY = imageHeight / 2;

  const dx = Math.abs(center.x - imgCenterX) / imgCenterX;
  const dy = Math.abs(center.y - imgCenterY) / imgCenterY;

  return Math.max(dx, dy);
}

function getVertexCount(ann: Annotation2D): number {
  const data = ann.data;
  if ('points' in data) return (data as any).points?.length || 0;
  if ('polygon' in data) return (data as any).polygon?.length || 0;
  return 4;
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => (v - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}


export function calculate2DAnnotationMetrics(
  ann: Annotation2D,
  imageWidth: number = 1920,
  imageHeight: number = 1080
): Annotation2DMetrics {
  const area = calculateArea(ann);
  const aspectRatio = calculateAspectRatio(ann);
  const imageArea = imageWidth * imageHeight;

  return {
    annotationId: ann.id,
    area,
    aspectRatio,
    relativeSize: area / imageArea,
    edgeProximity: calculateEdgeProximity(ann, imageWidth, imageHeight),
    complexity: getVertexCount(ann),
    isInterpolated: ann.source === 'auto_interpolated' || ann.source === 'auto',
  };
}

export function calculate2DTrackMetrics(
  annotations: Annotation2D[],
  frameIds: string[]
): Track2DMetrics | null {
  if (annotations.length === 0) return null;

  const trackId = annotations[0].trackId || annotations[0].id;

  const sortedAnns = [...annotations].sort((a, b) => {
    const idxA = frameIds.indexOf(a.frameId);
    const idxB = frameIds.indexOf(b.frameId);
    return idxA - idxB;
  });

  const areas: number[] = [];
  const aspectRatios: number[] = [];
  const velocities: number[] = [];
  let directionChanges = 0;
  let prevDirection: { dx: number; dy: number } | null = null;

  for (let i = 0; i < sortedAnns.length; i++) {
    const ann = sortedAnns[i];
    areas.push(calculateArea(ann));
    aspectRatios.push(calculateAspectRatio(ann));

    if (i > 0) {
      const distance = calculateDistance(sortedAnns[i - 1], ann);
      velocities.push(distance);

      const c1 = getCenter(sortedAnns[i - 1]);
      const c2 = getCenter(ann);
      if (c1 && c2) {
        const dx = c2.x - c1.x;
        const dy = c2.y - c1.y;

        if (prevDirection) {
          const dotProduct = dx * prevDirection.dx + dy * prevDirection.dy;
          const mag1 = Math.sqrt(dx * dx + dy * dy);
          const mag2 = Math.sqrt(prevDirection.dx ** 2 + prevDirection.dy ** 2);
          if (mag1 > 0 && mag2 > 0) {
            const cosAngle = dotProduct / (mag1 * mag2);
            if (cosAngle < 0) directionChanges++;
          }
        }
        prevDirection = { dx, dy };
      }
    }
  }

  const frameSet = new Set(sortedAnns.map(a => a.frameId));
  let gapCount = 0;
  let hasGaps = false;

  const firstFrameIdx = frameIds.indexOf(sortedAnns[0].frameId);
  const lastFrameIdx = frameIds.indexOf(sortedAnns[sortedAnns.length - 1].frameId);

  for (let i = firstFrameIdx; i <= lastFrameIdx; i++) {
    if (!frameSet.has(frameIds[i])) {
      hasGaps = true;
      gapCount++;
    }
  }

  const avgArea = areas.reduce((a, b) => a + b, 0) / areas.length;
  const avgAspectRatio = aspectRatios.reduce((a, b) => a + b, 0) / aspectRatios.length;
  const avgVelocity = velocities.length > 0 ? velocities.reduce((a, b) => a + b, 0) / velocities.length : 0;

  return {
    trackId,
    annotations: sortedAnns,
    frameCount: sortedAnns.length,
    avgSize: avgArea,
    sizeVariance: stdDev(areas),
    avgAspectRatio,
    aspectRatioVariance: stdDev(aspectRatios),
    avgVelocity,
    maxVelocity: velocities.length > 0 ? Math.max(...velocities) : 0,
    directionChanges,
    hasGaps,
    gapCount,
  };
}

export function calculate2DDifficulty(
  ann: Annotation2D,
  imageWidth: number = 1920,
  imageHeight: number = 1080,
  suggestions: QASuggestion[] = [],
  prevAnn?: Annotation2D,
  nextAnn?: Annotation2D,
): Difficulty2DScore {
  const metrics = calculate2DAnnotationMetrics(ann, imageWidth, imageHeight);
  const issues: string[] = [];

  let sizeScore = 0;
  if (metrics.area < SIZE_THRESHOLDS.TINY) {
    sizeScore = 30;
    issues.push('Very small object (< 30x30 px)');
  } else if (metrics.area < SIZE_THRESHOLDS.SMALL) {
    sizeScore = 20;
    issues.push('Small object');
  } else if (metrics.area < SIZE_THRESHOLDS.MEDIUM) {
    sizeScore = 10;
  } else if (metrics.area > SIZE_THRESHOLDS.LARGE) {
    sizeScore = 5;
  }

  let aspectRatioScore = 0;
  const ar = metrics.aspectRatio;
  const classId = ann.classId.toLowerCase();

  if (classId.includes('person') || classId.includes('pedestrian')) {
    if (ar < ASPECT_RATIO_ANOMALY.PEDESTRIAN_MIN || ar > ASPECT_RATIO_ANOMALY.PEDESTRIAN_MAX) {
      aspectRatioScore = 25;
      issues.push(`Unusual aspect ratio for pedestrian: ${ar.toFixed(2)}`);
    }
  } else if (classId.includes('car') || classId.includes('vehicle') || classId.includes('truck')) {
    if (ar < ASPECT_RATIO_ANOMALY.VEHICLE_MIN || ar > ASPECT_RATIO_ANOMALY.VEHICLE_MAX) {
      aspectRatioScore = 20;
      issues.push(`Unusual aspect ratio for vehicle: ${ar.toFixed(2)}`);
    }
  } else {
    // Generic check
    if (ar < ASPECT_RATIO_ANOMALY.MIN_NORMAL || ar > ASPECT_RATIO_ANOMALY.MAX_NORMAL) {
      aspectRatioScore = 15;
      issues.push(`Extreme aspect ratio: ${ar.toFixed(2)}`);
    }
  }

  // 3. Edge proximity score (objects at edges harder)
  let edgeScore = 0;
  if (metrics.edgeProximity > 0.9) {
    edgeScore = 15;
    issues.push('Object at image edge (may be truncated)');
  } else if (metrics.edgeProximity > 0.8) {
    edgeScore = 10;
  } else if (metrics.edgeProximity > 0.7) {
    edgeScore = 5;
  }

  // 4. Class difficulty score
  const baseDifficulty = CLASS_2D_DIFFICULTY[classId] ?? 0.5;
  const classScore = baseDifficulty * 20;

  // 5. Complexity score (for polygons)
  let complexityScore = 0;
  if (metrics.complexity > 20) {
    complexityScore = 15;
    issues.push(`Complex polygon (${metrics.complexity} vertices)`);
  } else if (metrics.complexity > 10) {
    complexityScore = 8;
  }

  // 6. Temporal consistency score (for tracks)
  let temporalScore = 0;
  if (prevAnn || nextAnn) {
    // Check velocity
    if (prevAnn) {
      const velocity = calculateDistance(prevAnn, ann);
      if (velocity > 200) {
        temporalScore += 15;
        issues.push(`Large movement from previous frame (${velocity.toFixed(0)}px)`);
      } else if (velocity > 100) {
        temporalScore += 8;
      }

      // Check size change
      const prevArea = calculateArea(prevAnn);
      const currArea = calculateArea(ann);
      const sizeChange = Math.abs(currArea - prevArea) / Math.max(prevArea, 1);
      if (sizeChange > 0.3) {
        temporalScore += 10;
        issues.push(`Size changed ${(sizeChange * 100).toFixed(0)}% from previous frame`);
      }
    }

    if (metrics.isInterpolated) {
      temporalScore += 10;
      issues.push('Auto-interpolated frame (unverified)');
    }
  }

  // 7. Suggestion-based score
  let suggestionScore = 0;
  const annSuggestions = suggestions.filter(s => s.annotation_id === ann.id);
  for (const suggestion of annSuggestions) {
    switch (suggestion.severity) {
      case 'critical':
        suggestionScore += 30;
        break;
      case 'high':
        suggestionScore += 20;
        break;
      case 'medium':
        suggestionScore += 10;
        break;
      case 'low':
        suggestionScore += 5;
        break;
    }
    issues.push(suggestion.message);
  }

  const totalScore = Math.min(100,
    sizeScore +
    aspectRatioScore +
    edgeScore +
    classScore +
    complexityScore +
    temporalScore +
    suggestionScore
  );

  // Confidence based on amount of data we have
  const confidence = Math.min(1, 0.7 + (annSuggestions.length > 0 ? 0.2 : 0) + (prevAnn || nextAnn ? 0.1 : 0));

  return {
    annotationId: ann.id,
    trackId: ann.trackId,
    totalScore,
    confidence,
    breakdown: {
      sizeScore,
      aspectRatioScore,
      edgeScore,
      classScore,
      complexityScore,
      temporalScore,
      suggestionScore,
    },
    issues,
    priorityRank: 0, // Will be set by ranking function
  };
}

/**
 * Calculate difficulty for individual box within a track
 */
export function calculate2DBoxDifficulty(
  ann: Annotation2D,
  prevAnn?: Annotation2D,
  _nextAnn?: Annotation2D,
  _trackMetrics?: Track2DMetrics,
  imageWidth: number = 1920,
  imageHeight: number = 1080,
): Box2DDifficulty {
  const metrics = calculate2DAnnotationMetrics(ann, imageWidth, imageHeight);

  let velocityChange = 0;
  let sizeChange = 0;

  if (prevAnn) {
    velocityChange = calculateDistance(prevAnn, ann);
    const prevArea = calculateArea(prevAnn);
    const currArea = calculateArea(ann);
    sizeChange = prevArea > 0 ? Math.abs(currArea - prevArea) / prevArea : 0;
  }

  // Calculate composite score
  let score = 0;

  // Size factor (0-20)
  if (metrics.area < SIZE_THRESHOLDS.TINY) score += 20;
  else if (metrics.area < SIZE_THRESHOLDS.SMALL) score += 15;
  else if (metrics.area < SIZE_THRESHOLDS.MEDIUM) score += 10;

  // Aspect ratio factor (0-15)
  if (metrics.aspectRatio < 0.2 || metrics.aspectRatio > 5) score += 15;
  else if (metrics.aspectRatio < 0.3 || metrics.aspectRatio > 4) score += 10;

  // Edge proximity factor (0-15)
  score += metrics.edgeProximity * 15;

  // Interpolation factor (0-15)
  if (metrics.isInterpolated) score += 15;

  // Velocity change factor (0-20)
  if (velocityChange > 200) score += 20;
  else if (velocityChange > 100) score += 15;
  else if (velocityChange > 50) score += 10;

  // Size change factor (0-15)
  if (sizeChange > 0.3) score += 15;
  else if (sizeChange > 0.2) score += 10;
  else if (sizeChange > 0.1) score += 5;

  return {
    annotationId: ann.id,
    frameId: ann.frameId,
    trackId: ann.trackId,
    score: Math.min(100, score),
    factors: {
      size: metrics.area,
      aspectRatio: metrics.aspectRatio,
      edgeProximity: metrics.edgeProximity,
      isInterpolated: metrics.isInterpolated,
      velocityChange,
      sizeChange,
    },
    rank: 0,
  };
}

/**
 * Rank annotations by difficulty (highest first)
 */
export function rank2DAnnotationsByDifficulty(
  scores: Difficulty2DScore[]
): Difficulty2DScore[] {
  const sorted = [...scores].sort((a, b) => b.totalScore - a.totalScore);
  return sorted.map((score, idx) => ({
    ...score,
    priorityRank: idx + 1,
  }));
}

/**
 * Rank boxes by difficulty within a track
 */
export function rank2DBoxesByDifficulty(
  boxes: Box2DDifficulty[]
): Box2DDifficulty[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  return sorted.map((box, idx) => ({
    ...box,
    rank: idx + 1,
  }));
}

/**
 * Get priority queue of annotations/tracks for QA review
 */
export function getPriorityQueue(
  scores: Difficulty2DScore[],
  limit?: number
): Difficulty2DScore[] {
  const ranked = rank2DAnnotationsByDifficulty(scores);
  if (limit) {
    return ranked.slice(0, limit);
  }
  return ranked;
}

/**
 * Calculate overall task QA metrics
 */
export function calculateTaskQAMetrics(
  annotations: Annotation2D[],
  suggestions: QASuggestion[],
  imageWidth: number = 1920,
  imageHeight: number = 1080,
): {
  totalAnnotations: number;
  standaloneCount: number;
  trackedCount: number;
  avgDifficulty: number;
  highPriorityCount: number;
  issueCount: number;
} {
  const standalone = annotations.filter(a => !a.trackId);
  const tracked = annotations.filter(a => a.trackId);

  const scores = annotations.map(ann =>
    calculate2DDifficulty(ann, imageWidth, imageHeight, suggestions)
  );

  const avgDifficulty = scores.length > 0
    ? scores.reduce((sum, s) => sum + s.totalScore, 0) / scores.length
    : 0;

  const highPriorityCount = scores.filter(s => s.totalScore >= 50).length;
  const issueCount = scores.reduce((sum, s) => sum + s.issues.length, 0);

  return {
    totalAnnotations: annotations.length,
    standaloneCount: standalone.length,
    trackedCount: tracked.length,
    avgDifficulty,
    highPriorityCount,
    issueCount,
  };
}

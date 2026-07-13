
import type { Annotation, CuboidData, QASuggestion } from '@/types';

export interface TrackMetrics {
  trackId: string;
  annotations: Annotation[];
  frameCount: number;
  keyframeCount: number;
  interpolatedCount: number;
  avgSpeed: number;
  maxSpeed: number;
  avgDistance: number;
  minDistance: number;
  maxDistance: number;
  avgOcclusion: number;
  dimensionVariance: number;
  headingVariance: number;
  avgSize: number;
}

export interface DifficultyScore {
  trackId: string;
  totalScore: number;
  breakdown: {
    sizeScore: number;
    distanceScore: number;
    occlusionScore: number;
    velocityScore: number;
    interpolationScore: number;
    consistencyScore: number;
    trackLengthScore: number;
    classScore: number;
  };
  confidence: number;
  priorityRank: number;
  issues: string[];
}

export interface BoxDifficulty {
  annotationId: string;
  frameId: string;
  trackId: string;
  score: number;
  factors: {
    distance: number;
    size: number;
    occlusion: number;
    isInterpolated: boolean;
    headingChange: number;
    dimensionChange: number;
  };
  rank: number;
}

const CLASS_DIFFICULTY: Record<string, number> = {
  'pedestrian': 0.9,
  'cyclist': 0.85,
  'motorcycle': 0.85,
  'scooter': 0.8,
  'animal': 0.95,
  'debris': 0.7,
  'cone': 0.6,
  'barrier': 0.5,
  'car': 0.5,
  'truck': 0.4,
  'bus': 0.35,
  'construction_vehicle': 0.45,
  'trailer': 0.4,
};

const DISTANCE_THRESHOLDS = {
  CLOSE: 15,
  MEDIUM: 30,
  FAR: 50,
  VERY_FAR: 80
};

const SIZE_THRESHOLDS = {
  TINY: 0.5,
  SMALL: 2,
  MEDIUM: 15,
  LARGE: 50,
  HUGE: 100
};

function calculateDistance(center: { x: number; y: number; z: number }): number {
  return Math.sqrt(center.x ** 2 + center.y ** 2 + center.z ** 2);
}

function calculateVolume(dimensions: { length: number; width: number; height: number }): number {
  return dimensions.length * dimensions.width * dimensions.height;
}

function headingDiff(yaw1: number, yaw2: number): number {
  let diff = Math.abs(yaw1 - yaw2);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff * (180 / Math.PI);
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const squaredDiffs = values.map(v => (v - mean) ** 2);
  return Math.sqrt(squaredDiffs.reduce((a, b) => a + b, 0) / values.length);
}

export function calculateTrackMetrics(annotations: Annotation[]): TrackMetrics | null {
  if (!annotations.length) return null;

  const trackId = annotations[0].track_id || annotations[0].id;

  const cuboids = annotations.filter(a => a.type === 'cuboid');
  if (!cuboids.length) return null;

  const distances: number[] = [];
  const volumes: number[] = [];
  const occlusions: number[] = [];
  const headings: number[] = [];
  const speeds: number[] = [];
  let keyframeCount = 0;
  let interpolatedCount = 0;

  for (let i = 0; i < cuboids.length; i++) {
    const ann = cuboids[i];
    const data = ann.data as CuboidData;

    distances.push(calculateDistance(data.center));
    volumes.push(calculateVolume(data.dimensions));
    headings.push(data.rotation.yaw);

    if (ann.source === 'auto_interpolated') {
      interpolatedCount++;
    } else {
      keyframeCount++;
    }

    const occlusionAttr = ann.attributes?.occlusion as string;
    const occlusionMap: Record<string, number> = {
      'none': 0, 'partial': 0.5, 'heavy': 0.9, 'full': 1
    };
    occlusions.push(occlusionMap[occlusionAttr] ?? 0);

    if (i > 0) {
      const prevData = cuboids[i - 1].data as CuboidData;
      const dx = data.center.x - prevData.center.x;
      const dy = data.center.y - prevData.center.y;
      const dist = Math.sqrt(dx ** 2 + dy ** 2);
      speeds.push(dist * 10);
    }
  }

  return {
    trackId,
    annotations: cuboids,
    frameCount: cuboids.length,
    keyframeCount,
    interpolatedCount,
    avgSpeed: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length : 0,
    maxSpeed: speeds.length ? Math.max(...speeds) : 0,
    avgDistance: distances.reduce((a, b) => a + b, 0) / distances.length,
    minDistance: Math.min(...distances),
    maxDistance: Math.max(...distances),
    avgOcclusion: occlusions.reduce((a, b) => a + b, 0) / occlusions.length,
    dimensionVariance: stdDev(volumes) / (volumes.reduce((a, b) => a + b, 0) / volumes.length + 0.001),
    headingVariance: stdDev(headings),
    avgSize: volumes.reduce((a, b) => a + b, 0) / volumes.length,
  };
}

export function calculateTrackDifficulty(
  metrics: TrackMetrics,
  className?: string,
  suggestions?: QASuggestion[]
): DifficultyScore {
  const issues: string[] = [];

  let sizeScore = 0;
  if (metrics.avgSize < SIZE_THRESHOLDS.TINY) {
    sizeScore = 15;
    issues.push('Very small object (< 0.5m³)');
  } else if (metrics.avgSize < SIZE_THRESHOLDS.SMALL) {
    sizeScore = 12;
    issues.push('Small object');
  } else if (metrics.avgSize < SIZE_THRESHOLDS.MEDIUM) {
    sizeScore = 8;
  } else if (metrics.avgSize < SIZE_THRESHOLDS.LARGE) {
    sizeScore = 4;
  } else {
    sizeScore = 2;
  }

  let distanceScore = 0;
  if (metrics.avgDistance > DISTANCE_THRESHOLDS.VERY_FAR) {
    distanceScore = 15;
    issues.push('Very distant object (>80m)');
  } else if (metrics.avgDistance > DISTANCE_THRESHOLDS.FAR) {
    distanceScore = 12;
    issues.push('Distant object (>50m)');
  } else if (metrics.avgDistance > DISTANCE_THRESHOLDS.MEDIUM) {
    distanceScore = 8;
  } else if (metrics.avgDistance > DISTANCE_THRESHOLDS.CLOSE) {
    distanceScore = 4;
  } else {
    distanceScore = 2;
  }

  const occlusionScore = Math.round(metrics.avgOcclusion * 15);
  if (metrics.avgOcclusion > 0.5) {
    issues.push('High average occlusion');
  }

  let velocityScore = 0;
  if (metrics.maxSpeed > 30) {
    velocityScore = 15;
    issues.push('Very fast moving (>108 km/h)');
  } else if (metrics.maxSpeed > 20) {
    velocityScore = 12;
  } else if (metrics.maxSpeed > 10) {
    velocityScore = 8;
  } else if (metrics.maxSpeed > 5) {
    velocityScore = 4;
  } else {
    velocityScore = 2;
  }

  const interpolationRatio = metrics.interpolatedCount / metrics.frameCount;
  const interpolationScore = Math.round(interpolationRatio * 10);
  if (interpolationRatio > 0.7) {
    issues.push('Mostly interpolated (>70%)');
  }

  let consistencyScore = 0;
  if (metrics.dimensionVariance > 0.2) {
    consistencyScore += 5;
    issues.push('Inconsistent dimensions');
  }
  if (metrics.headingVariance > 0.5) {
    consistencyScore += 5;
    issues.push('Inconsistent heading');
  }

  let trackLengthScore = 0;
  if (metrics.frameCount < 3) {
    trackLengthScore = 10;
    issues.push('Very short track (<3 frames)');
  } else if (metrics.frameCount < 5) {
    trackLengthScore = 6;
    issues.push('Short track (<5 frames)');
  } else if (metrics.frameCount < 10) {
    trackLengthScore = 3;
  }

  const classDifficulty = CLASS_DIFFICULTY[className?.toLowerCase() || ''] ?? 0.5;
  const classScore = Math.round(classDifficulty * 10);

  if (suggestions && suggestions.length > 0) {
    const criticalCount = suggestions.filter(s => s.severity === 'critical').length;
    const highCount = suggestions.filter(s => s.severity === 'high').length;
    if (criticalCount > 0) issues.push(`${criticalCount} critical AI issue(s)`);
    if (highCount > 0) issues.push(`${highCount} high priority issue(s)`);
  }

  const totalScore = sizeScore + distanceScore + occlusionScore + velocityScore +
    interpolationScore + consistencyScore + trackLengthScore + classScore;

  return {
    trackId: metrics.trackId,
    totalScore: Math.min(100, totalScore),
    breakdown: {
      sizeScore,
      distanceScore,
      occlusionScore,
      velocityScore,
      interpolationScore,
      consistencyScore,
      trackLengthScore,
      classScore,
    },
    confidence: Math.min(1, metrics.frameCount / 10), // More frames = higher confidence
    priorityRank: 0, // Will be set after sorting all tracks
    issues,
  };
}

/**
 * Calculate difficulty for individual box within a track
 */
export function calculateBoxDifficulty(
  annotation: Annotation,
  prevAnnotation?: Annotation,
  _nextAnnotation?: Annotation,
  _trackMetrics?: TrackMetrics
): BoxDifficulty {
  const data = annotation.data as CuboidData;
  const distance = calculateDistance(data.center);
  const volume = calculateVolume(data.dimensions);
  const isInterpolated = annotation.source === 'auto_interpolated';

  // Get occlusion
  const occlusionAttr = annotation.attributes?.occlusion as string;
  const occlusionMap: Record<string, number> = {
    'none': 0, 'partial': 0.5, 'heavy': 0.9, 'full': 1
  };
  const occlusion = occlusionMap[occlusionAttr] ?? 0;

  // Calculate heading change
  let headingChange = 0;
  if (prevAnnotation && prevAnnotation.type === 'cuboid') {
    const prevData = prevAnnotation.data as CuboidData;
    headingChange = headingDiff(data.rotation.yaw, prevData.rotation.yaw);
  }

  // Calculate dimension change
  let dimensionChange = 0;
  if (prevAnnotation && prevAnnotation.type === 'cuboid') {
    const prevData = prevAnnotation.data as CuboidData;
    const prevVolume = calculateVolume(prevData.dimensions);
    dimensionChange = Math.abs(volume - prevVolume) / Math.max(volume, prevVolume);
  }

  // Compute score (0-100)
  let score = 0;

  // Distance factor (0-25)
  if (distance > DISTANCE_THRESHOLDS.VERY_FAR) score += 25;
  else if (distance > DISTANCE_THRESHOLDS.FAR) score += 20;
  else if (distance > DISTANCE_THRESHOLDS.MEDIUM) score += 12;
  else if (distance > DISTANCE_THRESHOLDS.CLOSE) score += 6;

  // Size factor (0-25)
  if (volume < SIZE_THRESHOLDS.TINY) score += 25;
  else if (volume < SIZE_THRESHOLDS.SMALL) score += 20;
  else if (volume < SIZE_THRESHOLDS.MEDIUM) score += 12;
  else if (volume < SIZE_THRESHOLDS.LARGE) score += 6;

  // Occlusion factor (0-20)
  score += Math.round(occlusion * 20);

  // Interpolation factor (0-15)
  if (isInterpolated) score += 15;

  // Heading change factor (0-10)
  if (headingChange > 30) score += 10;
  else if (headingChange > 15) score += 5;

  // Dimension change factor (0-5)
  if (dimensionChange > 0.2) score += 5;
  else if (dimensionChange > 0.1) score += 2;

  return {
    annotationId: annotation.id,
    frameId: annotation.frame_id,
    trackId: annotation.track_id || annotation.id,
    score: Math.min(100, score),
    factors: {
      distance,
      size: volume,
      occlusion,
      isInterpolated,
      headingChange,
      dimensionChange,
    },
    rank: 0, // Will be set after sorting
  };
}

/**
 * Rank tracks by difficulty (highest difficulty first)
 */
export function rankTracksByDifficulty(
  scores: DifficultyScore[]
): DifficultyScore[] {
  const sorted = [...scores].sort((a, b) => b.totalScore - a.totalScore);
  return sorted.map((score, index) => ({
    ...score,
    priorityRank: index + 1,
  }));
}

/**
 * Rank boxes by difficulty (highest difficulty first)
 */
export function rankBoxesByDifficulty(
  boxes: BoxDifficulty[]
): BoxDifficulty[] {
  const sorted = [...boxes].sort((a, b) => b.score - a.score);
  return sorted.map((box, index) => ({
    ...box,
    rank: index + 1,
  }));
}

/**
 * Get difficulty level label
 */
export function getDifficultyLevel(score: number): {
  label: string;
  color: string;
  bgColor: string;
  emoji: string;
} {
  if (score >= 70) {
    return { label: 'Critical', color: 'text-red-400', bgColor: 'bg-red-500/20', emoji: '🔴' };
  }
  if (score >= 50) {
    return { label: 'Hard', color: 'text-orange-400', bgColor: 'bg-orange-500/20', emoji: '🟠' };
  }
  if (score >= 30) {
    return { label: 'Medium', color: 'text-yellow-400', bgColor: 'bg-yellow-500/20', emoji: '🟡' };
  }
  return { label: 'Easy', color: 'text-green-400', bgColor: 'bg-green-500/20', emoji: '🟢' };
}

/**
 * Calculate overall QA priority score combining difficulty and AI suggestions
 */
export function calculateQAPriority(
  difficulty: DifficultyScore,
  suggestionCount: number,
  criticalSuggestions: number
): number {
  // Base score from difficulty (0-100)
  let priority = difficulty.totalScore;

  // Add suggestion bonus (each suggestion adds 5, critical adds 15)
  priority += suggestionCount * 5;
  priority += criticalSuggestions * 10; // Additional for critical

  // Cap at 100
  return Math.min(100, priority);
}

export default {
  calculateTrackMetrics,
  calculateTrackDifficulty,
  calculateBoxDifficulty,
  rankTracksByDifficulty,
  rankBoxesByDifficulty,
  getDifficultyLevel,
  calculateQAPriority,
};

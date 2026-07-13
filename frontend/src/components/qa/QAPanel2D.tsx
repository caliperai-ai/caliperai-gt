import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { QASuggestion, ReviewVerdict } from '@/types';
import type { Annotation2D } from '@/store/annotation2DStore';
import { useQAStore } from '@/store/qaStore';
import { qaApi } from '@/api/client';
import {
  calculate2DDifficulty,
  calculate2DTrackMetrics,
  calculate2DBoxDifficulty,
  rank2DAnnotationsByDifficulty,
  rank2DBoxesByDifficulty,
  type Difficulty2DScore,
  type Box2DDifficulty,
  type Track2DMetrics,
} from '@/utils/annotation2DDifficultyScorer';


const CheckIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const XIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const FlagIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);


type TabType = 'annotations' | 'tracks';
type SortMode = 'difficulty' | 'class' | 'frame';
type TrackStatus = 'pending' | 'in_progress' | 'approved' | 'rejected';

interface ReviewState {
  [annotationId: string]: {
    verdict: ReviewVerdict;
    notes?: string;
    issueTypes?: string[];
    reviewedAt: Date;
  };
}

interface Track2DData {
  trackId: string;
  annotations: Annotation2D[];
  classId: string;
  className: string;
  classColor: string;
  metrics: Track2DMetrics | null;
  difficulty: Difficulty2DScore;
  boxes: Box2DDifficulty[];
  suggestionCount: number;
  suggestions: QASuggestion[];
  status?: TrackStatus;
}

interface TaxonomyClass {
  id: string;
  name: string;
  color: string;
  attributes?: Record<string, {
    type: 'boolean' | 'enum' | 'string' | 'number';
    options?: string[];
    default?: unknown;
    required?: boolean;
    description?: string | null;
  }>;
}

interface QAPanel2DProps {
  annotations: Annotation2D[] | Map<string, Annotation2D>;
  frameId: string;
  frameIds: string[];
  suggestions?: QASuggestion[];
  taxonomy?: {
    classes: TaxonomyClass[];
  };
  imageWidth?: number;
  imageHeight?: number;
  isLoading?: boolean;
  onRefreshSuggestions?: () => void;
  onZoomToAnnotation: (annotationId: string, zoom?: number) => void;
  onSelectAnnotation: (annotationId: string) => void;
  onGoToFrame: (frameIndexOrId: number | string) => void;
  currentFrameIndex?: number;
  fnMode?: boolean;
  onToggleFnMode?: () => void;
  onUpdateAnnotationClass?: (annotationId: string, classId: string) => void;
  onUpdateAnnotationAttributes?: (annotationId: string, attributes: Record<string, unknown>) => void;
  selectedAnnotationId?: string | null;
  taskId?: string;
  revisionCount?: number;
  taskStage?: string;
}

export const ISSUE_TYPES_2D = [
  { id: 'box_too_loose', label: 'Box too loose', icon: '📦' },
  { id: 'box_too_tight', label: 'Box too tight', icon: '🔲' },
  { id: 'wrong_class', label: 'Wrong class', icon: '🏷️' },
  { id: 'boundary_mismatch', label: 'Boundary doesn\'t match object', icon: '🖼️' },
  { id: 'missing_object', label: 'Missing object in frame', icon: '🔍' },
  { id: 'duplicate_annotation', label: 'Duplicate annotation', icon: '📋' },
  { id: 'tracking_error', label: 'Tracking ID error', icon: '🔗' },
  { id: 'wrong_attributes', label: 'Wrong attributes', icon: '📝' },
  { id: 'other', label: 'Other', icon: '❓' },
] as const;


function getDifficultyLevel(score: number): 'low' | 'medium' | 'high' | 'critical' {
  if (score >= 70) return 'critical';
  if (score >= 50) return 'high';
  if (score >= 25) return 'medium';
  return 'low';
}

function getDifficultyColor(level: string): string {
  switch (level) {
    case 'critical': return 'text-red-400 bg-red-500/20 border-red-500/40';
    case 'high': return 'text-orange-400 bg-orange-500/20 border-orange-500/40';
    case 'medium': return 'text-yellow-400 bg-yellow-500/20 border-yellow-500/40';
    default: return 'text-green-400 bg-green-500/20 border-green-500/40';
  }
}

function getVerdictColor(verdict: ReviewVerdict | undefined): string {
  switch (verdict) {
    case 'approved': return 'bg-green-500/30 text-green-400';
    case 'rejected': return 'bg-red-500/30 text-red-400';
    case 'flagged': return 'bg-yellow-500/30 text-yellow-400';
    default: return 'bg-gray-700 text-gray-400';
  }
}

function getVerdictIcon(verdict: ReviewVerdict | undefined): string {
  switch (verdict) {
    case 'approved': return '✓';
    case 'rejected': return '✗';
    case 'flagged': return '!';
    default: return '○';
  }
}

function getTrackStatus(annotations: Annotation2D[], reviews: ReviewState): TrackStatus {
  let reviewed = 0;
  let hasRejectedOrFlagged = false;

  for (const ann of annotations) {
    const review = reviews[ann.id];
    if (review?.verdict && review.verdict !== 'pending') {
      reviewed++;
      if (review.verdict === 'rejected' || review.verdict === 'flagged') {
        hasRejectedOrFlagged = true;
      }
    }
  }

  if (hasRejectedOrFlagged) return 'rejected';
  if (reviewed === annotations.length && reviewed > 0) return 'approved';
  if (reviewed > 0) return 'in_progress';
  return 'pending';
}

function getTrackStatusConfig(status: TrackStatus) {
  const config = {
    pending: { bg: 'bg-gray-600/30', text: 'text-gray-400', label: '○' },
    in_progress: { bg: 'bg-blue-600/30', text: 'text-blue-400', label: '◐' },
    approved: { bg: 'bg-green-600/30', text: 'text-green-400', label: '✓' },
    rejected: { bg: 'bg-red-600/30', text: 'text-red-400', label: '✗' },
  };
  return config[status];
}


export const QAPanel2D: React.FC<QAPanel2DProps> = ({
  annotations,
  frameId,
  frameIds,
  suggestions = [],
  taxonomy,
  imageWidth = 1920,
  imageHeight = 1080,
  isLoading = false,
  onRefreshSuggestions: _onRefreshSuggestions,
  onZoomToAnnotation,
  onSelectAnnotation,
  onGoToFrame,
  currentFrameIndex = 0,
  fnMode = false,
  onToggleFnMode,
  onUpdateAnnotationClass,
  onUpdateAnnotationAttributes,
  selectedAnnotationId: parentSelectedAnnotationId,
  taskId,
  revisionCount = 0,
  taskStage,
}) => {
  const isReReviewMode = revisionCount > 0 && taskStage !== 'customer_qa';

  useEffect(() => {
    console.log('[QAPanel2D] Suggestions updated:', suggestions.length, 'items');
    if (suggestions.length > 0) {
      const withAnnotationId = suggestions.filter(s => s.annotation_id).length;
      console.log('[QAPanel2D] Suggestions with annotation_id:', withAnnotationId);
    }
  }, [suggestions.length]);

  const {
    approveAnnotation: storeApproveAnnotation,
    rejectAnnotation: storeRejectAnnotation,
    rejectAllVisible,
    flagAnnotation: storeFlagAnnotation,
    clearAnnotationReview,
    annotationReviews: storeReviews,
    approveAllVisible,
    qaSession,
  } = useQAStore();

  const [previousReviews, setPreviousReviews] = useState<Map<string, { verdict: string; issue_types?: string[]; notes?: string }>>(new Map());
  const [previousQACompletedAt, setPreviousQACompletedAt] = useState<Date | null>(null);
  const [showOnlyChanges, setShowOnlyChanges] = useState(false);

  useEffect(() => {
    const loadPreviousReviews = async () => {
      if (!isReReviewMode || !taskId) return;

      try {
        const completedReviews = await qaApi.getTaskReviews(taskId, 'completed');

        if (completedReviews.length > 0) {
          const lastReview = completedReviews[0];
          setPreviousQACompletedAt(lastReview.completed_at ? new Date(lastReview.completed_at) : null);

          const annReviews = await qaApi.getAnnotationReviews(lastReview.id);
          const reviewMap = new Map<string, { verdict: string; issue_types?: string[]; notes?: string }>();
          annReviews.forEach(r => {
            if (r.verdict) {
              reviewMap.set(r.annotation_id, {
                verdict: r.verdict,
                issue_types: r.issue_types,
                notes: r.notes,
              });
            }
          });
          setPreviousReviews(reviewMap);
          console.log('[QAPanel2D] Loaded previous reviews:', reviewMap.size, 'completed at:', lastReview.completed_at);
        }
      } catch (error) {
        console.error('[QAPanel2D] Failed to load previous reviews:', error);
      }
    };

    loadPreviousReviews();
  }, [isReReviewMode, taskId]);

  const reviews = useMemo(() => {
    const reviewState: ReviewState = {};
    storeReviews.forEach((review, annotationId) => {
      if (review.verdict) {
        reviewState[annotationId] = {
          verdict: review.verdict,
          notes: review.notes,
          issueTypes: review.issue_types,
          reviewedAt: new Date(review.created_at),
        };
      }
    });
    return reviewState;
  }, [storeReviews]);

  const [activeTab, setActiveTab] = useState<TabType>('tracks');
  const [sortMode, setSortMode] = useState<SortMode>('frame');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const [autoZoom, setAutoZoom] = useState(true);
  const [hasAutoSwitched, setHasAutoSwitched] = useState(false);
  const [showProperties, setShowProperties] = useState(true);

  useEffect(() => {
    if (parentSelectedAnnotationId !== undefined && parentSelectedAnnotationId !== selectedAnnotationId) {
      setSelectedAnnotationId(parentSelectedAnnotationId);
    }
  }, [parentSelectedAnnotationId]);

  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [rejectionTarget, setRejectionTarget] = useState<string | null>(null);
  const [rejectionTrackIds, setRejectionTrackIds] = useState<string[]>([]);
  const [rejectionNotes, setRejectionNotes] = useState('');
  const [selectedIssueTypes, setSelectedIssueTypes] = useState<string[]>([]);
  const [isRejecting, setIsRejecting] = useState(false);

  const selectedItemRef = useRef<HTMLDivElement>(null);

  const classLookup = useMemo(() => {
    const map = new Map<string, { name: string; color: string }>();
    taxonomy?.classes.forEach(c => map.set(c.id, { name: c.name, color: c.color }));
    return map;
  }, [taxonomy]);

  const findClass = useCallback((classId: string) => {
    return classLookup.get(classId) || { name: classId, color: '#888888' };
  }, [classLookup]);

  const needsReReview = useCallback((ann: Annotation2D): boolean => {
    if (!previousQACompletedAt) return true;

    const prevReview = previousReviews.get(ann.id);

    if (prevReview && (prevReview.verdict === 'rejected' || prevReview.verdict === 'flagged')) {
      return true;
    }

    if (ann.updatedAt && new Date(ann.updatedAt) > previousQACompletedAt) {
      return true;
    }

    if (ann.createdAt && new Date(ann.createdAt) > previousQACompletedAt) {
      return true;
    }

    return false;
  }, [previousQACompletedAt, previousReviews]);

  const allAnnotations = useMemo(() =>
    Array.isArray(annotations) ? annotations : Array.from(annotations.values()),
    [annotations]
  );

  const annotationsMap = useMemo(() => {
    const map = new Map<string, Annotation2D>();
    allAnnotations.forEach(ann => map.set(ann.id, ann));
    return map;
  }, [allAnnotations]);

  const allStandaloneAnnotations = useMemo(() =>
    allAnnotations.filter(a => !a.trackId),
    [allAnnotations]
  );

  const standaloneAnnotations = useMemo(() => {
    let filtered = allStandaloneAnnotations.filter(a => a.frameId === frameId);
    if (showOnlyChanges && previousQACompletedAt) {
      filtered = filtered.filter(needsReReview);
    }
    return filtered;
  }, [allStandaloneAnnotations, frameId, showOnlyChanges, previousQACompletedAt, needsReReview]);

  const trackedAnnotations = useMemo(() =>
    allAnnotations.filter(a => a.trackId),
    [allAnnotations]
  );

  const reReviewStats = useMemo(() => {
    if (!isReReviewMode) return null;

    const allNeedingReview = allAnnotations.filter(needsReReview);
    const rejected = allNeedingReview.filter(a => {
      const prev = previousReviews.get(a.id);
      return prev?.verdict === 'rejected';
    }).length;
    const flagged = allNeedingReview.filter(a => {
      const prev = previousReviews.get(a.id);
      return prev?.verdict === 'flagged';
    }).length;
    const modified = allNeedingReview.filter(a => {
      const prev = previousReviews.get(a.id);
      if (prev?.verdict === 'rejected' || prev?.verdict === 'flagged') return false;
      return a.updatedAt && previousQACompletedAt && new Date(a.updatedAt) > previousQACompletedAt;
    }).length;
    const newAnns = allNeedingReview.filter(a => {
      const prev = previousReviews.get(a.id);
      if (prev) return false;
      return a.createdAt && previousQACompletedAt && new Date(a.createdAt) > previousQACompletedAt;
    }).length;

    return {
      total: allNeedingReview.length,
      rejected,
      flagged,
      modified,
      new: newAnns,
    };
  }, [isReReviewMode, allAnnotations, needsReReview, previousReviews, previousQACompletedAt]);

  const annotationScores = useMemo(() => {
    const scores = standaloneAnnotations.map(ann =>
      calculate2DDifficulty(
        ann,
        imageWidth,
        imageHeight,
        suggestions.filter(s => s.annotation_id === ann.id)
      )
    );
    return rank2DAnnotationsByDifficulty(scores);
  }, [standaloneAnnotations, suggestions, imageWidth, imageHeight]);

  const trackData = useMemo(() => {
    const trackMap = new Map<string, Annotation2D[]>();

    trackedAnnotations.forEach(ann => {
      if (!ann.trackId) return;
      const existing = trackMap.get(ann.trackId) || [];
      existing.push(ann);
      trackMap.set(ann.trackId, existing);
    });

    const tracks: Track2DData[] = [];

    trackMap.forEach((annotations, trackId) => {
      const firstAnn = annotations[0];
      const classInfo = findClass(firstAnn.classId);

      const metrics = calculate2DTrackMetrics(annotations, frameIds);

      const trackSuggestions = suggestions.filter(s =>
        annotations.some(a => a.id === s.annotation_id)
      );

      if (trackSuggestions.length > 0) {
        console.log('[QAPanel2D] Track', trackId, 'has', trackSuggestions.length, 'suggestions');
      }

      const sortedAnns = [...annotations].sort((a, b) => {
        const idxA = frameIds.indexOf(a.frameId);
        const idxB = frameIds.indexOf(b.frameId);
        return idxA - idxB;
      });

      const boxes: Box2DDifficulty[] = sortedAnns.map((ann, idx) => {
        const prev = idx > 0 ? sortedAnns[idx - 1] : undefined;
        const next = idx < sortedAnns.length - 1 ? sortedAnns[idx + 1] : undefined;
        return calculate2DBoxDifficulty(ann, prev, next, metrics || undefined, imageWidth, imageHeight);
      });

      const rankedBoxes = rank2DBoxesByDifficulty(boxes);

      const maxBoxScore = Math.max(...boxes.map(b => b.score), 0);
      const trackDifficulty = calculate2DDifficulty(
        firstAnn,
        imageWidth,
        imageHeight,
        trackSuggestions
      );
      trackDifficulty.totalScore = Math.min(100, Math.max(maxBoxScore, trackDifficulty.totalScore));

      if (metrics) {
        if (metrics.hasGaps) {
          trackDifficulty.issues.push(`Track has ${metrics.gapCount} frame gap(s)`);
          trackDifficulty.totalScore = Math.min(100, trackDifficulty.totalScore + 15);
        }
        if (metrics.sizeVariance / metrics.avgSize > 0.3) {
          trackDifficulty.issues.push('Inconsistent box sizes across frames');
          trackDifficulty.totalScore = Math.min(100, trackDifficulty.totalScore + 10);
        }
        if (metrics.directionChanges > 3) {
          trackDifficulty.issues.push(`${metrics.directionChanges} direction changes`);
        }
      }

      // Calculate unique suggestion count (grouped by message)
      const uniqueSuggestionMessages = new Set(trackSuggestions.map(s => s.message));

      tracks.push({
        trackId,
        annotations: sortedAnns,
        classId: firstAnn.classId,
        className: classInfo.name,
        classColor: classInfo.color,
        metrics,
        difficulty: trackDifficulty,
        boxes: rankedBoxes,
        suggestionCount: uniqueSuggestionMessages.size,
        suggestions: trackSuggestions,
      });
    });

    return tracks;
  }, [trackedAnnotations, frameIds, suggestions, findClass, imageWidth, imageHeight]);

  // When "Changes only" is active and we have previous QA data, hide tracks where
  // no annotation was modified/rejected since the last review.
  const filteredTrackData = useMemo(() => {
    if (!showOnlyChanges || !previousQACompletedAt) return trackData;
    return trackData.filter(track => track.annotations.some(needsReReview));
  }, [trackData, showOnlyChanges, previousQACompletedAt, needsReReview]);

  // Auto-switch to appropriate tab based on data
  useEffect(() => {
    if (hasAutoSwitched) return;

    // If there are tracks, stay on tracks tab (default)
    // If no tracks but there are standalone annotations, switch to annotations
    if (trackData.length === 0 && standaloneAnnotations.length > 0) {
      setActiveTab('annotations');
    }
    setHasAutoSwitched(true);
  }, [trackData.length, standaloneAnnotations.length, hasAutoSwitched]);

  // Add track status to each track
  const tracksWithStatus = useMemo(() => {
    return filteredTrackData.map(track => ({
      ...track,
      status: getTrackStatus(track.annotations, reviews)
    }));
  }, [filteredTrackData, reviews]);

  // Sort tracks based on mode
  const sortedTracks = useMemo(() => {
    if (sortMode === 'difficulty') {
      return [...tracksWithStatus].sort((a, b) => b.difficulty.totalScore - a.difficulty.totalScore);
    } else if (sortMode === 'class') {
      return [...tracksWithStatus].sort((a, b) => a.className.localeCompare(b.className));
    } else if (sortMode === 'frame') {
      // Sort by earliest frame the track appears in
      return [...tracksWithStatus].sort((a, b) => {
        const aFirstFrameIdx = Math.min(...a.boxes.map(box => frameIds.indexOf(box.frameId)).filter(i => i >= 0));
        const bFirstFrameIdx = Math.min(...b.boxes.map(box => frameIds.indexOf(box.frameId)).filter(i => i >= 0));
        return aFirstFrameIdx - bFirstFrameIdx;
      });
    }
    return tracksWithStatus;
  }, [tracksWithStatus, sortMode, frameIds]);

  // Sort standalone annotations
  const sortedAnnotations = useMemo(() => {
    if (sortMode === 'difficulty') {
      return annotationScores;
    }
    // For other modes, map back to original annotations
    const scoreMap = new Map(annotationScores.map(s => [s.annotationId, s]));
    const sorted = [...standaloneAnnotations].sort((a, b) => {
      if (sortMode === 'class') {
        const classA = findClass(a.classId).name;
        const classB = findClass(b.classId).name;
        return classA.localeCompare(classB);
      }
      if (sortMode === 'frame') {
        const aFrameIdx = frameIds.indexOf(a.frameId);
        const bFrameIdx = frameIds.indexOf(b.frameId);
        return aFrameIdx - bFrameIdx;
      }
      return 0;
    });
    return sorted.map(ann => scoreMap.get(ann.id) || annotationScores.find(s => s.annotationId === ann.id)!);
  }, [annotationScores, standaloneAnnotations, sortMode, findClass, frameIds]);

  // Calculate progress (across ALL frames)
  const progress = useMemo(() => {
    let totalItems = 0;
    let reviewedItems = 0;
    let approved = 0;
    let rejected = 0;
    let flagged = 0;

    if (activeTab === 'annotations') {
      // Use allStandaloneAnnotations for cross-frame progress
      totalItems = allStandaloneAnnotations.length;
      allStandaloneAnnotations.forEach(ann => {
        const review = reviews[ann.id];
        if (review) {
          reviewedItems++;
          if (review.verdict === 'approved') approved++;
          else if (review.verdict === 'rejected') rejected++;
          else if (review.verdict === 'flagged') flagged++;
        }
      });
    } else {
      // For tracks, count all boxes
      filteredTrackData.forEach(track => {
        track.annotations.forEach(ann => {
          totalItems++;
          const review = reviews[ann.id];
          if (review) {
            reviewedItems++;
            if (review.verdict === 'approved') approved++;
            else if (review.verdict === 'rejected') rejected++;
            else if (review.verdict === 'flagged') flagged++;
          }
        });
      });
    }

    return { total: totalItems, reviewed: reviewedItems, approved, rejected, flagged };
  }, [activeTab, allStandaloneAnnotations, filteredTrackData, reviews]);

  // Calculate track-level progress (similar to 3D QA)
  const trackProgress = useMemo(() => {
    let totalTracks = tracksWithStatus.length;
    let approvedTracks = 0;
    let rejectedTracks = 0;
    let inProgressTracks = 0;

    tracksWithStatus.forEach(track => {
      if (track.status === 'approved') approvedTracks++;
      else if (track.status === 'rejected') rejectedTracks++;
      else if (track.status === 'in_progress') inProgressTracks++;
    });

    return { totalTracks, approvedTracks, rejectedTracks, inProgressTracks };
  }, [tracksWithStatus]);

  // Auto-scroll to selected item
  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedAnnotationId]);

  // Find next unreviewed annotation
  const findNextUnreviewed = useCallback((afterId?: string, items?: Difficulty2DScore[]): string | null => {
    let list: Array<{ annotationId: string }>;

    if (items) {
      list = items;
    } else if (activeTab === 'annotations') {
      list = sortedAnnotations;
    } else {
      // For tracks tab, first try to find next within current expanded track
      // Then move to next track's boxes
      const allBoxes: Array<{ annotationId: string }> = [];

      // If we have an expanded track, prioritize its boxes first
      if (expandedTrackId) {
        const expandedTrack = sortedTracks.find(t => t.trackId === expandedTrackId);
        if (expandedTrack) {
          // Sort boxes by frame index for sequential review
          const sortedBoxes = [...expandedTrack.boxes].sort((a, b) => {
            const aIdx = frameIds.indexOf(a.frameId);
            const bIdx = frameIds.indexOf(b.frameId);
            return aIdx - bIdx;
          });
          sortedBoxes.forEach(box => {
            allBoxes.push({ annotationId: box.annotationId });
          });
        }
      }

      // Then add boxes from other tracks
      sortedTracks.forEach(track => {
        if (track.trackId !== expandedTrackId) {
          const sortedBoxes = [...track.boxes].sort((a, b) => {
            const aIdx = frameIds.indexOf(a.frameId);
            const bIdx = frameIds.indexOf(b.frameId);
            return aIdx - bIdx;
          });
          sortedBoxes.forEach(box => {
            allBoxes.push({ annotationId: box.annotationId });
          });
        }
      });
      list = allBoxes;
    }

    const startIdx = afterId ? list.findIndex(s => s.annotationId === afterId) + 1 : 0;

    for (let i = startIdx; i < list.length; i++) {
      if (!reviews[list[i].annotationId]) {
        return list[i].annotationId;
      }
    }
    return null;
  }, [activeTab, sortedAnnotations, sortedTracks, reviews, expandedTrackId, frameIds]);

  // Advance to next unreviewed item (simple version - ignores track mode)
  const advanceToNext = useCallback((currentId: string) => {
    if (!autoAdvance) return;

    setTimeout(() => {
      const nextId = findNextUnreviewed(currentId);
      if (nextId) {
        setSelectedAnnotationId(nextId);
        onSelectAnnotation(nextId);

        // Navigate to frame if needed, then zoom
        const ann = annotationsMap.get(nextId);
        if (ann && ann.frameId !== frameId) {
          const frameIdx = frameIds.indexOf(ann.frameId);
          if (frameIdx >= 0) {
            onGoToFrame(frameIdx);
          }
        }

        // Zoom level 5 for QA to inspect bounding box tightness
        onZoomToAnnotation(nextId, 5);
      }
    }, 50);
  }, [autoAdvance, findNextUnreviewed, annotationsMap, frameId, frameIds, onSelectAnnotation, onZoomToAnnotation, onGoToFrame]);

  // Advance to next item - in track mode, navigate to next frame in track
  const advanceAfterReview = useCallback((currentId: string) => {
    if (!autoAdvance) return;

    // Use a small delay to allow the review animation to complete
    setTimeout(() => {
      // In track mode (track expanded), navigate to next frame in track
      if (expandedTrackId) {
        const track = sortedTracks.find(t => t.trackId === expandedTrackId);
        if (track) {
          // Sort boxes by frame index
          const sortedBoxes = [...track.boxes].sort((a, b) => {
            const aIdx = frameIds.indexOf(a.frameId);
            const bIdx = frameIds.indexOf(b.frameId);
            return aIdx - bIdx;
          });

          // Find current box index
          const currentIdx = sortedBoxes.findIndex(box => box.annotationId === currentId);

          if (currentIdx !== -1 && currentIdx < sortedBoxes.length - 1) {
            // Move to next frame in track
            const targetBox = sortedBoxes[currentIdx + 1];
            const frameIdx = frameIds.indexOf(targetBox.frameId);

            setSelectedAnnotationId(targetBox.annotationId);
            onSelectAnnotation(targetBox.annotationId);
            if (frameIdx >= 0 && frameIdx !== currentFrameIndex) {
              onGoToFrame(frameIdx);
            }
            setTimeout(() => {
              onZoomToAnnotation(targetBox.annotationId, 5);
            }, 100);
            return;
          }
        }
      }

      // Fall back to standard advanceToNext for non-track mode
      const nextId = findNextUnreviewed(currentId);
      if (nextId) {
        setSelectedAnnotationId(nextId);
        onSelectAnnotation(nextId);

        // Navigate to frame if needed, then zoom
        const ann = annotationsMap.get(nextId);
        if (ann && ann.frameId !== frameId) {
          const frameIdx = frameIds.indexOf(ann.frameId);
          if (frameIdx >= 0) {
            onGoToFrame(frameIdx);
          }
        }

        // Always zoom - use onZoomToAnnotation which sets pending zoom
        // This handles both same-frame and cross-frame cases
        // Zoom level 5 for QA to inspect bounding box tightness
        onZoomToAnnotation(nextId, 5);
      }
    }, 50);
  }, [autoAdvance, findNextUnreviewed, annotationsMap, frameId, frameIds, onSelectAnnotation, onZoomToAnnotation, onGoToFrame, expandedTrackId, sortedTracks, currentFrameIndex]);

  // Review handlers - use QA Store for persistence
  const handleApprove = useCallback(async (annotationId: string) => {
    if (!qaSession) {
      console.warn('[QAPanel2D] No QA session - review will not be persisted');
    }
    await storeApproveAnnotation(annotationId, frameId, undefined, 'annotations_2d');
    advanceAfterReview(annotationId);
  }, [storeApproveAnnotation, frameId, advanceAfterReview, qaSession]);

  const handleReject = useCallback((annotationId: string) => {
    setRejectionTarget(annotationId);
    setShowRejectionModal(true);
  }, []);

  const handleRejectConfirm = useCallback(async () => {
    if (isRejecting) return; // Prevent double-click
    setIsRejecting(true);

    // Handle track-level rejection (multiple annotations) - use bulk API
    if (rejectionTrackIds.length > 0) {
      try {
        await rejectAllVisible(rejectionTrackIds, selectedIssueTypes, rejectionNotes, 'annotations_2d');
      } catch (error) {
        console.error('[QAPanel2D] Error rejecting track annotations:', error);
      }
      // Always close modal and reset state
      setShowRejectionModal(false);
      setRejectionTrackIds([]);
      setRejectionNotes('');
      setSelectedIssueTypes([]);
      setIsRejecting(false);
      return;
    }

    // Handle single annotation rejection
    if (!rejectionTarget) {
      setIsRejecting(false);
      return;
    }

    try {
      await storeRejectAnnotation(rejectionTarget, selectedIssueTypes, rejectionNotes, frameId, undefined, 'annotations_2d');
    } catch (error) {
      console.error('[QAPanel2D] Error rejecting annotation:', error);
    }

    setShowRejectionModal(false);
    setRejectionTarget(null);
    setRejectionNotes('');
    setSelectedIssueTypes([]);
    setIsRejecting(false);

    advanceAfterReview(rejectionTarget);
  }, [rejectionTarget, rejectionTrackIds, selectedIssueTypes, rejectionNotes, storeRejectAnnotation, rejectAllVisible, frameId, advanceAfterReview, isRejecting]);

  const handleFlag = useCallback(async (annotationId: string, notes?: string) => {
    await storeFlagAnnotation(annotationId, notes, frameId, undefined, 'annotations_2d');
    advanceAfterReview(annotationId);
  }, [storeFlagAnnotation, frameId, advanceAfterReview]);

  const handleApproveTrack = useCallback(async (track: Track2DData) => {
    const annotationIds = track.annotations.map(ann => ann.id);
    await approveAllVisible(annotationIds, 'annotations_2d');

    // Auto-advance to next unreviewed item after track approval
    if (autoAdvance) {
      const lastBoxId = track.boxes[track.boxes.length - 1]?.annotationId;
      if (lastBoxId) {
        advanceToNext(lastBoxId);
      }
    }
  }, [approveAllVisible, autoAdvance, advanceToNext]);

  const handleRejectTrack = useCallback((track: Track2DData) => {
    const annotationIds = track.annotations.map(ann => ann.id);
    setRejectionTrackIds(annotationIds);
    setShowRejectionModal(true);
  }, []);

  // Bulk approve all unreviewed in current frame
  const handleApproveAllInFrame = useCallback(async () => {
    let annotationIds: string[] = [];

    if (activeTab === 'annotations') {
      // Approve standalone annotations in current frame
      annotationIds = standaloneAnnotations
        .filter(ann => !reviews[ann.id] || reviews[ann.id].verdict === 'pending')
        .map(ann => ann.id);
    } else {
      // Approve all boxes from tracks that are in current frame
      filteredTrackData.forEach(track => {
        track.annotations.forEach(ann => {
          if (ann.frameId === frameId && (!reviews[ann.id] || reviews[ann.id].verdict === 'pending')) {
            annotationIds.push(ann.id);
          }
        });
      });
    }

    if (annotationIds.length > 0) {
      await approveAllVisible(annotationIds, 'annotations_2d');
    }
  }, [activeTab, standaloneAnnotations, filteredTrackData, frameId, reviews, approveAllVisible]);

  // Bulk approve all unreviewed across all frames
  const handleApproveAll = useCallback(async () => {
    let annotationIds: string[] = [];

    if (activeTab === 'annotations') {
      // Use allStandaloneAnnotations to approve across ALL frames
      annotationIds = allStandaloneAnnotations
        .filter(ann => !reviews[ann.id] || reviews[ann.id].verdict === 'pending')
        .map(ann => ann.id);
    } else {
      // Approve all boxes from all tracks
      filteredTrackData.forEach(track => {
        track.annotations.forEach(ann => {
          if (!reviews[ann.id] || reviews[ann.id].verdict === 'pending') {
            annotationIds.push(ann.id);
          }
        });
      });
    }

    if (annotationIds.length > 0) {
      await approveAllVisible(annotationIds, 'annotations_2d');
    }
  }, [activeTab, allStandaloneAnnotations, filteredTrackData, reviews, approveAllVisible]);

  // Bulk approve all tracks at once (for tracks tab)
  const handleApproveAllTracks = useCallback(async () => {
    const annotationIds: string[] = [];

    filteredTrackData.forEach(track => {
      track.annotations.forEach(ann => {
        if (!reviews[ann.id] || reviews[ann.id].verdict === 'pending') {
          annotationIds.push(ann.id);
        }
      });
    });

    if (annotationIds.length > 0) {
      await approveAllVisible(annotationIds, 'annotations_2d');
    }
  }, [filteredTrackData, reviews, approveAllVisible]);

  // Selection handlers
  const handleSelectAnnotation = useCallback((annotationId: string, frameIdx?: number) => {
    setSelectedAnnotationId(annotationId);
    onSelectAnnotation(annotationId);

    // Navigate to the frame first (if different)
    // Use zoom level 5 for QA to inspect bounding box tightness
    if (frameIdx !== undefined && frameIdx !== currentFrameIndex) {
      onGoToFrame(frameIdx);
      // Delay zoom slightly to allow frame navigation to complete
      setTimeout(() => {
        onZoomToAnnotation(annotationId, 5);
      }, 50);
    } else {
      // Same frame - zoom immediately
      onZoomToAnnotation(annotationId, 5);
    }
  }, [onSelectAnnotation, onZoomToAnnotation, currentFrameIndex, onGoToFrame]);

  const handleToggleTrack = useCallback((trackId: string) => {
    const wasExpanded = expandedTrackId === trackId;
    setExpandedTrackId(wasExpanded ? null : trackId);

    // If expanding (not collapsing), auto-select the first unreviewed box in this track
    if (!wasExpanded) {
      const track = sortedTracks.find(t => t.trackId === trackId);
      if (track && track.boxes.length > 0) {
        // Sort boxes by frame order and find first unreviewed
        const sortedBoxes = [...track.boxes].sort((a, b) => {
          const aIdx = frameIds.indexOf(a.frameId);
          const bIdx = frameIds.indexOf(b.frameId);
          return aIdx - bIdx;
        });

        // Find first unreviewed, or first box if all reviewed
        const firstUnreviewed = sortedBoxes.find(box => !reviews[box.annotationId]);
        const targetBox = firstUnreviewed || sortedBoxes[0];

        if (targetBox) {
          const frameIdx = frameIds.indexOf(targetBox.frameId);
          // Select, navigate to frame, and zoom
          setSelectedAnnotationId(targetBox.annotationId);
          onSelectAnnotation(targetBox.annotationId);
          if (frameIdx >= 0 && frameIdx !== currentFrameIndex) {
            onGoToFrame(frameIdx);
          }
          // Zoom after a short delay to allow frame navigation
          setTimeout(() => {
onZoomToAnnotation(targetBox.annotationId, 5);
          }, 100);
        }
      }
    }
  }, [expandedTrackId, sortedTracks, frameIds, reviews, currentFrameIndex, onSelectAnnotation, onGoToFrame, onZoomToAnnotation]);

  // Navigate to next/previous frame within the current track
  const navigateTrackFrame = useCallback((direction: 'next' | 'prev') => {
    if (!expandedTrackId || !selectedAnnotationId) return;

    const track = sortedTracks.find(t => t.trackId === expandedTrackId);
    if (!track) return;

    // Sort boxes by frame index
    const sortedBoxes = [...track.boxes].sort((a, b) => {
      const aIdx = frameIds.indexOf(a.frameId);
      const bIdx = frameIds.indexOf(b.frameId);
      return aIdx - bIdx;
    });

    // Find current box index in sorted list
    const currentIdx = sortedBoxes.findIndex(box => box.annotationId === selectedAnnotationId);
    if (currentIdx === -1) {
      // Selected annotation not in this track - find box for current frame
      const currentFrameBox = sortedBoxes.find(box => frameIds.indexOf(box.frameId) === currentFrameIndex);
      if (currentFrameBox) {
        // Navigate to next/prev from current frame
        const frameBoxIdx = sortedBoxes.indexOf(currentFrameBox);
        const targetIdx = direction === 'next' ? frameBoxIdx + 1 : frameBoxIdx - 1;
        if (targetIdx >= 0 && targetIdx < sortedBoxes.length) {
          const targetBox = sortedBoxes[targetIdx];
          const frameIdx = frameIds.indexOf(targetBox.frameId);
          setSelectedAnnotationId(targetBox.annotationId);
          onSelectAnnotation(targetBox.annotationId);
          if (frameIdx >= 0 && frameIdx !== currentFrameIndex) {
            onGoToFrame(frameIdx);
          }
          setTimeout(() => {
            onZoomToAnnotation(targetBox.annotationId, 5);
          }, 100);
        }
      }
      return;
    }

    const targetIdx = direction === 'next' ? currentIdx + 1 : currentIdx - 1;

    if (targetIdx < 0 || targetIdx >= sortedBoxes.length) {
      // At the end/start of the track
      return;
    }

    const targetBox = sortedBoxes[targetIdx];
    const frameIdx = frameIds.indexOf(targetBox.frameId);

    // Select, navigate to frame, and zoom
    setSelectedAnnotationId(targetBox.annotationId);
    onSelectAnnotation(targetBox.annotationId);
    if (frameIdx >= 0 && frameIdx !== currentFrameIndex) {
      onGoToFrame(frameIdx);
    }
    // Zoom after a short delay to allow frame navigation
    // Use zoom level 5 for QA to inspect bounding box tightness
    setTimeout(() => {
      onZoomToAnnotation(targetBox.annotationId, 5);
    }, 100);
  }, [expandedTrackId, selectedAnnotationId, sortedTracks, frameIds, currentFrameIndex, onSelectAnnotation, onGoToFrame, onZoomToAnnotation]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Ignore if rejection modal is open
      if (showRejectionModal) return;

      if (!selectedAnnotationId) return;

      switch (e.key) {
        case '1':
          e.preventDefault();
          handleApprove(selectedAnnotationId);
          break;
        case '2':
          e.preventDefault();
          handleReject(selectedAnnotationId);
          break;
        case '3':
          e.preventDefault();
          handleFlag(selectedAnnotationId);
          break;
        case 'f':
        case 'F':
          // F key - navigate to next frame within the same track
          if (expandedTrackId) {
            e.preventDefault();
            navigateTrackFrame('next');
          }
          break;
        case 'd':
        case 'D':
          // D key - navigate to previous frame within the same track
          if (expandedTrackId) {
            e.preventDefault();
            navigateTrackFrame('prev');
          }
          break;
        case 'ArrowRight':
          // Arrow right in track mode = next frame in track, otherwise advance to next unreviewed
          e.preventDefault();
          if (expandedTrackId) {
            navigateTrackFrame('next');
          } else {
            advanceToNext(selectedAnnotationId);
          }
          break;
        case 'ArrowLeft':
          // Arrow left in track mode = previous frame in track
          if (expandedTrackId) {
            e.preventDefault();
            navigateTrackFrame('prev');
          }
          break;
        case 'n':
          e.preventDefault();
          advanceToNext(selectedAnnotationId);
          break;
        case 'z':
          if (autoZoom) {
            onZoomToAnnotation(selectedAnnotationId, 5);
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAnnotationId, handleApprove, handleReject, handleFlag, advanceToNext, autoZoom, onZoomToAnnotation, expandedTrackId, navigateTrackFrame, showRejectionModal]);

  return (
    <div className="flex flex-col h-full bg-gray-900 text-white overflow-hidden w-full">
      {/* Header - Compact */}
      <div className="flex-shrink-0 px-2 py-2 border-b border-gray-700">
        {/* Title row */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-bold text-white uppercase tracking-wide">QA Review</h3>
            {isLoading && (
              <svg className="w-3 h-3 animate-spin text-blue-400" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            )}
          </div>
          {/* Compact toggle row */}
          <div className="flex items-center gap-1">
            <label className="flex items-center gap-0.5 text-[10px] text-gray-400 cursor-pointer" title="Auto-advance after review">
              <input
                type="checkbox"
                checked={autoAdvance}
                onChange={(e) => setAutoAdvance(e.target.checked)}
                className="w-3 h-3 rounded text-blue-500 focus:ring-0 bg-gray-700 border-gray-600"
              />
              Auto
            </label>
            <label className="flex items-center gap-0.5 text-[10px] text-gray-400 cursor-pointer" title="Auto-zoom to annotation">
              <input
                type="checkbox"
                checked={autoZoom}
                onChange={(e) => setAutoZoom(e.target.checked)}
                className="w-3 h-3 rounded text-blue-500 focus:ring-0 bg-gray-700 border-gray-600"
              />
              Zoom
            </label>
            {onToggleFnMode && (
              <button
                onClick={onToggleFnMode}
                className={`px-1.5 py-0.5 text-[10px] rounded transition-colors whitespace-nowrap ${
                  fnMode
                    ? 'bg-orange-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
                title="Flag false negatives"
              >
                {fnMode ? 'FN ON' : 'FN'}
              </button>
            )}
          </div>
        </div>

        {/* Re-review mode banner */}
        {isReReviewMode && (
          <div className="mb-2 p-1.5 bg-amber-900/30 border border-amber-700/50 rounded">
            <div className="flex items-center justify-between">
              <div className="text-[10px] text-amber-300">
                <span className="font-medium">Re-review Mode</span>
                {reReviewStats && (
                  <span className="ml-2 text-amber-400">
                    {reReviewStats.total} items to review
                    {reReviewStats.rejected > 0 && <span className="text-red-400 ml-1">({reReviewStats.rejected} rejected)</span>}
                    {reReviewStats.flagged > 0 && <span className="text-yellow-400 ml-1">({reReviewStats.flagged} flagged)</span>}
                    {reReviewStats.modified > 0 && <span className="text-blue-400 ml-1">({reReviewStats.modified} modified)</span>}
                    {reReviewStats.new > 0 && <span className="text-green-400 ml-1">({reReviewStats.new} new)</span>}
                  </span>
                )}
              </div>
              <label className="flex items-center gap-1 text-[10px] text-amber-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showOnlyChanges}
                  onChange={(e) => setShowOnlyChanges(e.target.checked)}
                  className="w-3 h-3 rounded text-amber-500 focus:ring-0 bg-gray-700 border-gray-600"
                />
                Changes only
              </label>
            </div>
          </div>
        )}

        {/* Progress bar */}
        {activeTab === 'tracks' ? (
          <div>
            <div className="flex items-center justify-between text-[10px] mb-1">
              <span className="font-medium text-white">
                {trackProgress.approvedTracks + trackProgress.rejectedTracks}/{trackProgress.totalTracks} tracks
              </span>
              <div className="flex gap-2">
                <span className="text-green-400">✓{trackProgress.approvedTracks}</span>
                <span className="text-red-400">✗{trackProgress.rejectedTracks}</span>
                <span className="text-blue-400">◐{trackProgress.inProgressTracks}</span>
              </div>
            </div>
            <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-green-500"
                style={{
                  width: `${trackProgress.totalTracks > 0
                    ? ((trackProgress.approvedTracks + trackProgress.rejectedTracks) / trackProgress.totalTracks) * 100
                    : 0}%`
                }}
              />
            </div>
          </div>
        ) : (
          <div>
            <div className="flex justify-between text-[10px] mb-1">
              <span>{progress.reviewed}/{progress.total}</span>
              <div className="flex gap-1.5">
                <span className="text-green-400">{progress.approved}✓</span>
                <span className="text-red-400">{progress.rejected}✗</span>
                <span className="text-yellow-400">{progress.flagged}!</span>
              </div>
            </div>
            <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-blue-500"
                style={{ width: `${(progress.reviewed / Math.max(progress.total, 1)) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Tabs - Compact */}
      <div className="flex-shrink-0 flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab('annotations')}
          className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${
            activeTab === 'annotations'
              ? 'bg-blue-600/20 text-blue-400 border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          Annotations ({allStandaloneAnnotations.length})
        </button>
        <button
          onClick={() => setActiveTab('tracks')}
          className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors ${
            activeTab === 'tracks'
              ? 'bg-purple-600/20 text-purple-400 border-b-2 border-purple-500'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          Tracks ({filteredTrackData.length})
        </button>
      </div>

      {/* Sort & Bulk Actions - Compact row */}
      <div className="flex-shrink-0 px-2 py-1.5 border-b border-gray-700 flex items-center justify-between gap-1">
        <select
          value={sortMode}
          onChange={(e) => setSortMode(e.target.value as SortMode)}
          className="text-[10px] bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-white"
        >
          <option value="difficulty">By Difficulty</option>
          <option value="class">By Class</option>
          <option value="frame">By Frame</option>
        </select>

        <div className="flex items-center gap-1">
          {activeTab === 'tracks' ? (
            // Tracks tab: show "Approve This Track" and "Approve All Tracks" buttons
            <>
              {expandedTrackId && (() => {
                const expandedTrack = filteredTrackData.find(t => t.trackId === expandedTrackId);
                if (!expandedTrack || expandedTrack.status === 'approved') return null;
                const pendingBoxes = expandedTrack.annotations.filter(ann => !reviews[ann.id] || reviews[ann.id].verdict === 'pending').length;
                return pendingBoxes > 0 ? (
                  <button
                    onClick={() => handleApproveTrack(expandedTrack)}
                    className="px-1.5 py-0.5 bg-blue-600/40 hover:bg-blue-600 rounded text-[10px] text-blue-100 whitespace-nowrap"
                    title="Approve this track"
                  >
                    ✓This({pendingBoxes})
                  </button>
                ) : null;
              })()}
              {(() => {
                const pendingTracks = filteredTrackData.filter(t => t.status !== 'approved' && t.status !== 'rejected').length;
                return pendingTracks > 0 ? (
                  <button
                    onClick={handleApproveAllTracks}
                    className="px-1.5 py-0.5 bg-green-600/40 hover:bg-green-600 rounded text-[10px] text-green-100 whitespace-nowrap"
                    title="Approve all tracks"
                  >
                    ✓All({pendingTracks})
                  </button>
                ) : null;
              })()}
            </>
          ) : (
            // Annotations tab: show frame and all buttons
            <>
              {(() => {
                const pendingInFrame = standaloneAnnotations.filter(ann => !reviews[ann.id] || reviews[ann.id].verdict === 'pending').length;
                return pendingInFrame > 0 ? (
                  <button
                    onClick={handleApproveAllInFrame}
                    className="px-1.5 py-0.5 bg-blue-600/40 hover:bg-blue-600 rounded text-[10px] text-blue-100 whitespace-nowrap"
                    title="Approve all in frame"
                  >
                    ✓F({pendingInFrame})
                  </button>
                ) : null;
              })()}

              {progress.total - progress.reviewed > 0 && (
                <button
                  onClick={handleApproveAll}
                  className="px-1.5 py-0.5 bg-green-600/40 hover:bg-green-600 rounded text-[10px] text-green-100 whitespace-nowrap"
                  title="Approve all"
                >
                  ✓All({progress.total - progress.reviewed})
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'annotations' ? (
          // Standalone annotations list
          <div className="p-2 space-y-1">
            {sortedAnnotations.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-sm">
                No standalone annotations in this frame
              </div>
            ) : (
              sortedAnnotations.map((score) => {
                const ann = annotationsMap.get(score.annotationId);
                if (!ann) return null;

                const classInfo = findClass(ann.classId);
                const review = reviews[score.annotationId];
                const isSelected = selectedAnnotationId === score.annotationId;
                const diffLevel = getDifficultyLevel(score.totalScore);

                return (
                  <div
                    key={score.annotationId}
                    ref={isSelected ? selectedItemRef : undefined}
                    onClick={() => handleSelectAnnotation(score.annotationId)}
                    className={`
                      p-1.5 rounded cursor-pointer transition-all border
                      ${isSelected
                        ? 'bg-blue-600/30 border-blue-500'
                        : 'bg-gray-800 border-gray-700 hover:bg-gray-750 hover:border-gray-600'
                      }
                    `}
                  >
                    {/* Header row */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: classInfo.color }}
                        />
                        <span className="text-[11px] font-medium truncate">{classInfo.name}</span>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0">
                        <span className={`px-1 py-0.5 rounded text-[9px] font-medium ${getDifficultyColor(diffLevel)}`}>
                          Diff: {score.totalScore.toFixed(0)}
                        </span>
                        {review && (
                          <div className="flex items-center gap-0.5">
                            <span className={`w-4 h-4 rounded flex items-center justify-center text-[10px] font-bold ${getVerdictColor(review.verdict)}`}>
                              {getVerdictIcon(review.verdict)}
                            </span>
                            {isSelected && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  clearAnnotationReview(score.annotationId);
                                }}
                                className="p-0.5 bg-gray-600/50 hover:bg-gray-500 rounded text-gray-300 text-[10px]"
                                title="Undo and re-review"
                              >
                                ↻
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Issues */}
                    {score.issues.length > 0 && (
                      <div className="text-[9px] text-gray-400 mt-0.5 truncate">
                        ⚠️ {score.issues[0]}
                      </div>
                    )}

                    {/* Action buttons - icon only with keyboard hints */}
                    {isSelected && !review && (
                      <div className="flex gap-1 mt-1.5">
                        <button
                          onClick={(e) => { e.stopPropagation(); handleApprove(score.annotationId); }}
                          className="flex-1 flex items-center justify-center py-1 bg-green-600/40 hover:bg-green-600 rounded text-green-100 transition-colors"
                          title="Approve"
                        >
                          <CheckIcon className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleReject(score.annotationId); }}
                          className="flex-1 flex items-center justify-center py-1 bg-red-600/40 hover:bg-red-600 rounded text-red-100 transition-colors"
                          title="Reject"
                        >
                          <XIcon className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleFlag(score.annotationId); }}
                          className="flex-1 flex items-center justify-center py-1 bg-yellow-600/40 hover:bg-yellow-600 rounded text-yellow-100 transition-colors"
                          title="Flag for review"
                        >
                          <FlagIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        ) : (
          // Tracks view
          <div className="p-2 space-y-1">
            {sortedTracks.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-sm">
                No tracks found
              </div>
            ) : (
              <>
                {/* Approve All Tracks button */}
                {(() => {
                  const pendingTracksCount = sortedTracks.filter(t =>
                    t.annotations.some(ann => !reviews[ann.id] || reviews[ann.id].verdict === 'pending')
                  ).length;
                  const totalPendingBoxes = sortedTracks.reduce((count, track) =>
                    count + track.annotations.filter(ann => !reviews[ann.id] || reviews[ann.id].verdict === 'pending').length, 0);

                  return pendingTracksCount > 0 ? (
                    <button
                      onClick={handleApproveAllTracks}
                      className="w-full mb-1.5 px-2 py-1.5 bg-green-600/30 hover:bg-green-600 rounded text-[11px] text-green-100 transition-colors flex items-center justify-center gap-1"
                    >
                      <CheckIcon className="w-3 h-3" /> Approve All ({pendingTracksCount}T / {totalPendingBoxes}B)
                    </button>
                  ) : null;
                })()}

                {sortedTracks.map((track) => {
                const isExpanded = expandedTrackId === track.trackId;
                const diffLevel = getDifficultyLevel(track.difficulty.totalScore);
                const statusConfig = getTrackStatusConfig(track.status || 'pending');

                // Calculate frame range for track
                const frameIndices = track.boxes.map(b => frameIds.indexOf(b.frameId)).filter(i => i >= 0);
                const firstFrame = frameIndices.length > 0 ? Math.min(...frameIndices) + 1 : 0;
                const lastFrame = frameIndices.length > 0 ? Math.max(...frameIndices) + 1 : 0;
                const frameRange = firstFrame === lastFrame ? `F${firstFrame}` : `F${firstFrame}-${lastFrame}`;

                return (
                  <div key={track.trackId} className="bg-gray-800 rounded border border-gray-700">
                    {/* Track header - compact layout */}
                    <div
                      onClick={() => handleToggleTrack(track.trackId)}
                      className="flex items-center justify-between p-1.5 cursor-pointer hover:bg-gray-750"
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                        {/* Track status badge */}
                        <span className={`px-1 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${statusConfig.bg} ${statusConfig.text}`}>
                          {statusConfig.label}
                        </span>
                        <div
                          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                          style={{ backgroundColor: track.classColor }}
                        />
                        <span className="text-xs font-medium truncate">{track.className}</span>
                        {/* Frame range */}
                        <span className="text-[10px] text-blue-400 flex-shrink-0" title="Frame range">
                          {frameRange}
                        </span>
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {/* Issues */}
                        {isLoading ? (
                          <span className="text-[10px] text-blue-400 animate-pulse" title="Loading AI issues...">
                            <span className="text-gray-500">Loading AI...</span>
                          </span>
                        ) : track.suggestionCount > 0 ? (
                          <span className="text-[10px] text-yellow-400" title="AI suggestions/issues">
                            <span className="text-gray-500">Issues:</span> ⚠️{track.suggestionCount}
                          </span>
                        ) : null}

                        {/* Difficulty */}
                        <span className={`px-1 py-0.5 rounded text-[10px] font-medium border ${getDifficultyColor(diffLevel)}`} title="Difficulty score">
                          <span className="text-gray-400 font-normal">Diff:</span> {track.difficulty.totalScore.toFixed(0)}
                        </span>
                      </div>
                    </div>

                    {/* Expanded content */}
                    {isExpanded && (
                      <div className="border-t border-gray-700">
                        {/* AI Suggestions */}
                        {isLoading ? (
                          <div className="px-3 py-2 bg-blue-500/10 border-t border-gray-700">
                            <div className="text-[10px] text-blue-300 font-medium mb-1 flex items-center gap-2">
                              <span className="animate-pulse">Loading AI Issues...</span>
                            </div>
                          </div>
                        ) : track.suggestions.length > 0 && (() => {
                          // Group suggestions by message to avoid duplicates
                          const grouped = new Map<string, { suggestion: typeof track.suggestions[0]; count: number; frameIndices: number[] }>();
                          track.suggestions.forEach(s => {
                            const existing = grouped.get(s.message);
                            const frameIdx = s.frame_id ? frameIds.indexOf(s.frame_id) + 1 : 0;
                            if (existing) {
                              existing.count++;
                              if (frameIdx > 0) existing.frameIndices.push(frameIdx);
                            } else {
                              grouped.set(s.message, {
                                suggestion: s,
                                count: 1,
                                frameIndices: frameIdx > 0 ? [frameIdx] : []
                              });
                            }
                          });
                          const groupedIssues = Array.from(grouped.values());

                          return (
                            <div className="px-3 py-2 bg-orange-500/10 border-t border-gray-700">
                              <div className="text-[10px] text-orange-300 font-medium mb-1">
                                AI Issues ({groupedIssues.length}):
                              </div>
                              <div className="space-y-1 max-h-32 overflow-y-auto pr-2">
                                {groupedIssues.map(({ suggestion, count, frameIndices }) => (
                                  <div key={suggestion.id} className="text-[10px] text-orange-200 flex items-start gap-2">
                                    <span className={`flex-shrink-0 ${
                                      suggestion.severity === 'critical' ? 'text-red-400' :
                                      suggestion.severity === 'high' ? 'text-orange-400' :
                                      suggestion.severity === 'medium' ? 'text-yellow-400' : 'text-gray-400'
                                    }`}>
                                      {suggestion.severity === 'critical' ? '🔴' :
                                       suggestion.severity === 'high' ? '🟠' :
                                       suggestion.severity === 'medium' ? '🟡' : '⚪'}
                                    </span>
                                    <span className="flex-1">{suggestion.message}</span>
                                    <span className="text-gray-500 flex-shrink-0 ml-2">
                                      {count > 1
                                        ? `(${count} frames)`
                                        : frameIndices.length > 0 ? `F${frameIndices[0]}` : ''}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          );
                        })()}

                        {/* Bulk approve/reject buttons */}
                        {track.status !== 'approved' && (
                          <div className="px-2 py-1.5 border-b border-gray-700 flex gap-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleApproveTrack(track); }}
                              className="flex-1 px-2 py-1 bg-green-600/30 hover:bg-green-600 rounded text-[10px] text-green-100 transition-colors"
                            >
                              ✓ Approve Track ({track.annotations.length})
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); handleRejectTrack(track); }}
                              className="flex-1 px-2 py-1 bg-red-600/30 hover:bg-red-600 rounded text-[10px] text-red-100 transition-colors"
                            >
                              ✗ Reject Track ({track.annotations.length})
                            </button>
                          </div>
                        )}

                        {/* Mini timeline with dots (like 3D QA) */}
                        <div className="px-2 py-1">
                          {/* Timeline container */}
                          <div className="relative h-4 bg-gray-900 rounded overflow-hidden">
                            {/* Track span highlight */}
                            {track.boxes.length > 0 && (() => {
                              const frameIndices = track.boxes.map(b => frameIds.indexOf(b.frameId)).filter(i => i >= 0);
                              const firstIdx = Math.min(...frameIndices);
                              const lastIdx = Math.max(...frameIndices);
                              const totalFrames = frameIds.length;

                              return (
                                <div
                                  className="absolute top-0 h-full bg-purple-900/40"
                                  style={{
                                    left: `${totalFrames > 1 ? (firstIdx / (totalFrames - 1)) * 100 : 0}%`,
                                    width: `${totalFrames > 1 ? ((lastIdx - firstIdx) / (totalFrames - 1)) * 100 : 100}%`,
                                  }}
                                />
                              );
                            })()}

                            {/* Frame dots */}
                            {track.boxes.map((box) => {
                              const frameIdx = frameIds.indexOf(box.frameId);
                              if (frameIdx < 0) return null;

                              const totalFrames = frameIds.length;
                              const position = totalFrames > 1 ? (frameIdx / (totalFrames - 1)) * 100 : 50;
                              const review = reviews[box.annotationId];

                              let dotColor = 'bg-purple-400';
                              if (review?.verdict === 'approved') dotColor = 'bg-green-500';
                              else if (review?.verdict === 'rejected') dotColor = 'bg-red-500';
                              else if (review?.verdict === 'flagged') dotColor = 'bg-yellow-500';

                              return (
                                <div
                                  key={box.annotationId}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelectAnnotation(box.annotationId, frameIdx);
                                  }}
                                  className={`absolute top-1/2 w-1.5 h-1.5 rounded-full cursor-pointer hover:scale-150 transition-transform ${dotColor}`}
                                  style={{ left: `${position}%`, transform: 'translate(-50%, -50%)' }}
                                  title={`F${frameIdx + 1}${review ? ` - ${review.verdict}` : ''}`}
                                />
                              );
                            })}

                            {/* Current frame position indicator */}
                            <div
                              className="absolute top-0 h-full w-0.5 bg-white/80"
                              style={{
                                left: `${frameIds.length > 1 ? (currentFrameIndex / (frameIds.length - 1)) * 100 : 50}%`,
                                transform: 'translateX(-50%)'
                              }}
                            />
                          </div>

                          {/* Timeline labels */}
                          <div className="flex justify-between text-[8px] text-gray-500">
                            <span>1</span>
                            <span className="text-gray-400">F{currentFrameIndex + 1}</span>
                            <span>{frameIds.length}</span>
                          </div>
                        </div>

                        {/* Box list (detailed) - sorted by frame index, compact layout */}
                        <div className="max-h-48 overflow-y-auto">
                          {[...track.boxes]
                            .sort((a, b) => {
                              const aIdx = frameIds.indexOf(a.frameId);
                              const bIdx = frameIds.indexOf(b.frameId);
                              return aIdx - bIdx;
                            })
                            .map((box) => {
                            const ann = annotationsMap.get(box.annotationId);
                            if (!ann) return null;

                            const review = reviews[box.annotationId];
                            const frameIdx = frameIds.indexOf(box.frameId);
                            const isSelected = selectedAnnotationId === box.annotationId;
                            const boxDiffLevel = getDifficultyLevel(box.score);

                            return (
                              <div
                                key={box.annotationId}
                                ref={isSelected ? selectedItemRef : undefined}
                                onClick={() => handleSelectAnnotation(box.annotationId, frameIdx)}
                                className={`
                                  flex items-center justify-between px-2 py-1 cursor-pointer text-[10px] border-b border-gray-700/50 last:border-b-0
                                  ${isSelected ? 'bg-blue-600/30' : 'hover:bg-gray-750'}
                                `}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span className="text-gray-400 w-6">F{frameIdx + 1}</span>
                                  <span className={`px-1 rounded text-[9px] ${getDifficultyColor(boxDiffLevel)}`} title="Difficulty score for this box">
                                    <span className="text-gray-500">Diff:</span> {box.score.toFixed(0)}
                                  </span>
                                  {box.factors.isInterpolated && (
                                    <span className="text-purple-400 text-[10px] flex items-center gap-0.5" title="Auto-interpolated box">
                                      <span className="text-gray-500">Auto</span> 🔵
                                    </span>
                                  )}
                                </div>

                                {/* Review buttons - compact */}
                                {isSelected && !review ? (
                                  <div className="flex gap-0.5">
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleApprove(box.annotationId); }}
                                      className="p-0.5 bg-green-600/30 hover:bg-green-600 rounded text-green-300"
                                    >
                                      <CheckIcon className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleReject(box.annotationId); }}
                                      className="p-0.5 bg-red-600/30 hover:bg-red-600 rounded text-red-300"
                                    >
                                      <XIcon className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); handleFlag(box.annotationId); }}
                                      className="p-0.5 bg-yellow-600/30 hover:bg-yellow-600 rounded text-yellow-300"
                                    >
                                      <FlagIcon className="w-3 h-3" />
                                    </button>
                                  </div>
                                ) : review ? (
                                  <div className="flex items-center gap-0.5">
                                    <span className={`px-1 py-0.5 rounded text-[10px] font-bold ${getVerdictColor(review.verdict)}`}>
                                      {getVerdictIcon(review.verdict)}
                                    </span>
                                    {isSelected && (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          // Re-enable review buttons by clearing verdict
                                          const updatedReviews = { ...reviews };
                                          delete updatedReviews[box.annotationId];
                                          // Note: This is a local UI change. The backend review persists until overwritten.
                                        }}
                                        className="p-0.5 bg-gray-600/50 hover:bg-gray-500 rounded text-gray-300 text-[10px]"
                                        title="Undo and re-review"
                                      >
                                        ↻
                                      </button>
                                    )}
                                  </div>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
              </>
            )}
          </div>
        )}
      </div>

      {/* Properties Panel - shows selected annotation details */}
      {selectedAnnotationId && annotationsMap.get(selectedAnnotationId) && (
        <div className="flex-shrink-0 border-t border-gray-700 bg-gray-850">
          {/* Header with collapse toggle */}
          <button
            onClick={() => setShowProperties(!showProperties)}
            className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-gray-300 hover:bg-gray-800 transition-colors"
          >
            <span className="flex items-center gap-2">
              <svg className={`w-3 h-3 transition-transform ${showProperties ? 'rotate-0' : '-rotate-90'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              Properties
            </span>
            {(() => {
              const ann = annotationsMap.get(selectedAnnotationId)!;
              const classInfo = findClass(ann.classId);
              return (
                <span className="flex items-center gap-1.5">
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: classInfo.color }} />
                  <span className="text-gray-400">{classInfo.name}</span>
                </span>
              );
            })()}
          </button>

          {showProperties && (() => {
            const ann = annotationsMap.get(selectedAnnotationId)!;
            const classDef = taxonomy?.classes.find(c => c.id === ann.classId);

            return (
              <div className="px-3 pb-3 space-y-3">
                {/* Class selector */}
                {onUpdateAnnotationClass && taxonomy && (
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-gray-500 block mb-1">Class</label>
                    <select
                      value={ann.classId}
                      onChange={(e) => onUpdateAnnotationClass(ann.id, e.target.value)}
                      className="w-full text-xs bg-gray-800 border border-gray-600 rounded px-2 py-1.5 text-white cursor-pointer hover:border-gray-500 focus:border-primary focus:ring-1 focus:ring-primary transition-colors"
                    >
                      {taxonomy.classes.map((cls) => (
                        <option key={cls.id} value={cls.id}>
                          {cls.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {/* Annotation info */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  <div className="text-gray-500">Type:</div>
                  <div className="text-gray-300 capitalize">{ann.type}</div>
                  <div className="text-gray-500">Frame:</div>
                  <div className="text-gray-300">{frameIds.indexOf(ann.frameId) + 1}</div>
                  {ann.trackId && (
                    <>
                      <div className="text-gray-500">Track:</div>
                      <div className="text-cyan-400 text-[10px] truncate">{ann.trackId.substring(0, 12)}...</div>
                    </>
                  )}
                </div>

                {/* Attributes */}
                {classDef?.attributes && Object.keys(classDef.attributes).length > 0 && onUpdateAnnotationAttributes && (
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-gray-500 block mb-1.5">Attributes</label>
                    <div className="space-y-2">
                      {Object.entries(classDef.attributes).map(([key, def]) => (
                        <div key={key} className="flex items-center justify-between gap-2">
                          <label className="text-xs text-gray-400 flex-shrink-0">{key}</label>
                          {def.type === 'boolean' ? (
                            <button
                              onClick={() => {
                                const newValue = !(ann.attributes?.[key] as boolean ?? def.default ?? false);
                                const newAttributes = { ...(ann.attributes || {}), [key]: newValue };
                                onUpdateAnnotationAttributes(ann.id, newAttributes);
                              }}
                              className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                                ann.attributes?.[key] ? 'bg-primary' : 'bg-gray-600'
                              }`}
                            >
                              <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                                ann.attributes?.[key] ? 'translate-x-4' : ''
                              }`} />
                            </button>
                          ) : def.type === 'enum' && def.options ? (
                            <select
                              value={(ann.attributes?.[key] as string) ?? (def.default as string) ?? ''}
                              onChange={(e) => {
                                const newAttributes = { ...(ann.attributes || {}), [key]: e.target.value };
                                onUpdateAnnotationAttributes(ann.id, newAttributes);
                              }}
                              className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white"
                            >
                              <option value="">--</option>
                              {def.options.map((opt) => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type={def.type === 'number' ? 'number' : 'text'}
                              value={(ann.attributes?.[key] as string) ?? (def.default as string) ?? ''}
                              onChange={(e) => {
                                const value = def.type === 'number' ? parseFloat(e.target.value) : e.target.value;
                                const newAttributes = { ...(ann.attributes || {}), [key]: value };
                                onUpdateAnnotationAttributes(ann.id, newAttributes);
                              }}
                              className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-1.5 py-0.5 text-xs text-white"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ID - click to copy */}
                <div className="pt-1 border-t border-gray-700/50">
                  <span
                    className="font-mono text-[9px] text-gray-500 cursor-pointer hover:text-gray-300 transition-colors"
                    title="Click to copy annotation ID"
                    onClick={() => {
                      navigator.clipboard.writeText(ann.id);
                    }}
                  >
                    ID: {ann.id.substring(0, 16)}...
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Keyboard shortcuts hint */}
      <div className="flex-shrink-0 px-3 py-2 bg-gray-800 border-t border-gray-700 text-xs text-gray-500">
        <span className="font-medium">Shortcuts:</span>
        {' '}[1] Approve · [2] Reject · [3] Flag · [→/n] Next · [z] Zoom
      </div>

      {/* Rejection Modal */}
      {showRejectionModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => { setShowRejectionModal(false); setRejectionTrackIds([]); }}>
          <div className="bg-gray-800 rounded-lg shadow-xl w-96 max-h-[80vh] overflow-hidden" onClick={e => e.stopPropagation()}>
            <div className="px-4 py-3 border-b border-gray-700">
              <h3 className="font-medium text-white">
                {rejectionTrackIds.length > 0
                  ? `Reject Track (${rejectionTrackIds.length} annotations)`
                  : 'Reject Annotation'}
              </h3>
            </div>

            <div className="p-4 space-y-4 max-h-96 overflow-y-auto">
              {/* Issue types */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Issues</label>
                <div className="space-y-1">
                  {ISSUE_TYPES_2D.map(issue => (
                    <label key={issue.id} className="flex items-center gap-2 p-2 rounded hover:bg-gray-700 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedIssueTypes.includes(issue.id)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedIssueTypes(prev => [...prev, issue.id]);
                          } else {
                            setSelectedIssueTypes(prev => prev.filter(id => id !== issue.id));
                          }
                        }}
                        className="rounded text-red-500 focus:ring-red-500 bg-gray-700 border-gray-600"
                      />
                      <span>{issue.icon}</span>
                      <span className="text-sm text-gray-200">{issue.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Notes */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Notes (optional)</label>
                <textarea
                  value={rejectionNotes}
                  onChange={(e) => setRejectionNotes(e.target.value)}
                  placeholder="Additional details..."
                  className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-sm resize-none"
                  rows={3}
                />
              </div>
            </div>

            <div className="px-4 py-3 border-t border-gray-700 flex justify-end gap-2">
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); setShowRejectionModal(false); setRejectionTrackIds([]); }}
                className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded text-white"
              >
                Cancel
              </button>
              <button
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleRejectConfirm(); }}
                disabled={selectedIssueTypes.length === 0 || isRejecting}
                className="px-4 py-2 text-sm bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed rounded text-white"
              >
                {isRejecting ? 'Rejecting...' : 'Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default QAPanel2D;

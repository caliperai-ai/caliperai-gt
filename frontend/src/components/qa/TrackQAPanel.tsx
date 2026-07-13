import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useQAStore, useQASuggestions } from '@/store/qaStore';
import { useEditorStore } from '@/store/editorStore';
import { annotation3DApi, Annotation3DData, qaApi } from '@/api/client';
import { FlagModal } from './FlagModal';
import type { AnnotationReview } from '@/types';
import {
  calculateTrackMetrics,
  calculateTrackDifficulty,
  calculateBoxDifficulty,
  rankTracksByDifficulty,
  rankBoxesByDifficulty,
  getDifficultyLevel,
  type DifficultyScore,
  type BoxDifficulty,
} from '@/utils/trackDifficultyScorer';
import type { Annotation, ClassDefinition } from '@/types';

const ChevronDownIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const XIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const FlagIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
  </svg>
);

type SortMode = 'difficulty' | 'frames' | 'class';

interface TrackData {
  trackId: string;
  annotations: Annotation[];
  difficulty: DifficultyScore;
  className: string;
  classColor: string;
  suggestionCount: number;
  frameCount: number;
  boxes: BoxDifficulty[];
  previousIssues: AnnotationReview[];
}

interface TrackQAPanelProps {
  onJumpToAnnotation: (annotationId: string, frameId: string, zoomLevel?: number) => void;
  onSelectTrack: (trackId: string) => void;
}

export const TrackQAPanel: React.FC<TrackQAPanelProps> = ({
  onJumpToAnnotation,
  onSelectTrack,
}) => {
  const [sortMode, setSortMode] = useState<SortMode>('difficulty');
  const [expandedTrackId, setExpandedTrackId] = useState<string | null>(null);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const selectedBoxRef = useRef<HTMLDivElement>(null);
  const trackItemRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagAnnotationId, setFlagAnnotationId] = useState<string | null>(null);
  const pendingFlagRef = useRef<{ annotationId: string; trackId: string; frameId?: string; classId?: string } | null>(null);

  const pendingRejectionRef = useRef<{ annotationId: string; trackId: string; frameId?: string; classId?: string } | null>(null);

  const autoAdvanceRef = useRef(autoAdvance);
  useEffect(() => {
    autoAdvanceRef.current = autoAdvance;
  }, [autoAdvance]);

  const suggestions = useQASuggestions();
  const {
    approveAnnotation,
    approveAllVisible,
    openRejectionModal,
    flagAnnotation,
    clearAnnotationReview,
    getAnnotationReview,
    approveTrack,
    showRejectionModal,
    autoAdvanceEnabled: qaStoreAutoAdvance,
    setAutoAdvance: setQAStoreAutoAdvance,
    annotationReviews,
  } = useQAStore();

  useEffect(() => {
    const originalAutoAdvance = qaStoreAutoAdvance;
    setQAStoreAutoAdvance(false);

    return () => {
      setQAStoreAutoAdvance(originalAutoAdvance);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const falseNegativeSuggestions = useMemo(() =>
    suggestions.filter(s => s.suggestion_type === 'false_negative'),
    [suggestions]
  );
  const annotationSuggestions = useMemo(() =>
    suggestions.filter(s => s.suggestion_type !== 'false_negative'),
    [suggestions]
  );

  const taskId = useEditorStore((s) => s.task?.id);
  const { qaSession } = useQAStore();

  const { data: previousReviews } = useQuery({
    queryKey: ['previous-qa-reviews', taskId],
    queryFn: async () => {
      if (!taskId) return [];
      const reviews = await qaApi.getTaskReviews(taskId);
      console.log('[TrackQAPanel] Fetched task reviews:', reviews?.length, 'for task:', taskId);
      return reviews || [];
    },
    enabled: !!taskId,
    staleTime: 30 * 1000,
  });

  const { data: previousIssues } = useQuery({
    queryKey: ['previous-issues', taskId, qaSession?.id, previousReviews?.length],
    queryFn: async () => {
      if (!previousReviews || previousReviews.length === 0) {
        console.log('[TrackQAPanel] No previous reviews to fetch issues from');
        return [];
      }

      const previousSessionIds = previousReviews
        .filter(r => r.id !== qaSession?.id)
        .map(r => r.id);

      console.log('[TrackQAPanel] Previous session IDs:', previousSessionIds, 'Current session:', qaSession?.id);

      if (previousSessionIds.length === 0) {
        console.log('[TrackQAPanel] No previous sessions (all sessions are current)');
        return [];
      }

      const allPreviousIssues: AnnotationReview[] = [];
      for (const reviewId of previousSessionIds) {
        try {
          const reviews = await qaApi.getAnnotationReviews(reviewId);
          console.log('[TrackQAPanel] Fetched', reviews?.length, 'reviews from session:', reviewId);
          const issues = reviews.filter(r => r.verdict === 'rejected' || r.verdict === 'flagged');
          console.log('[TrackQAPanel] Found', issues.length, 'rejected/flagged issues');
          allPreviousIssues.push(...issues);
        } catch (e) {
          console.warn('[TrackQAPanel] Failed to fetch reviews for session:', reviewId, e);
        }
      }

      console.log('[TrackQAPanel] Total previous issues:', allPreviousIssues.length);
      return allPreviousIssues;
    },
    enabled: !!previousReviews && previousReviews.length > 0,
    staleTime: 30 * 1000,
  });

  const { data: allTaskAnnotations } = useQuery({
    queryKey: ['all-3d-annotations-qa', taskId],
    queryFn: async () => {
      if (!taskId) return [];
      return annotation3DApi.list(taskId);
    },
    enabled: !!taskId,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const allAnnotations: Annotation[] = useMemo(() => {
    if (!allTaskAnnotations) return [];
    return allTaskAnnotations.map((ann: Annotation3DData): Annotation => ({
      id: ann.id,
      task_id: ann.task_id,
      frame_id: ann.frame_id,
      track_id: ann.track_id,
      type: ann.type === 'bbox' ? 'box2d' : ann.type === 'point' ? 'keypoints' : ann.type as Annotation['type'],
      class_id: ann.class_id,
      data: ann.data,
      attributes: ann.attributes ?? {},
      source: 'manual' as Annotation['source'],
      is_keyframe: ann.is_keyframe,
      is_verified: false,
      created_at: ann.created_at,
      updated_at: ann.updated_at,
    }));
  }, [allTaskAnnotations]);

  const frames = useEditorStore((s) => s.frames);
  const taxonomy = useEditorStore((s) => s.taxonomy);
  const selectAnnotation = useEditorStore((s) => s.selectAnnotation);
  const goToFrame = useEditorStore((s) => s.goToFrame);
  const selection = useEditorStore((s) => s.selection);
  const currentFrameIndex = useEditorStore((s) => s.currentFrameIndex);
  const currentFrame = frames[currentFrameIndex];

  const currentFrameFalseNegatives = useMemo(() =>
    falseNegativeSuggestions.filter(s => s.frame_id === currentFrame?.id),
    [falseNegativeSuggestions, currentFrame]
  );

  const classLookup = useMemo(() => {
    const byId = new Map<string, ClassDefinition>();
    const byName = new Map<string, ClassDefinition>();
    taxonomy?.classes.forEach(c => {
      byId.set(c.id, c);
      byName.set(c.name.toLowerCase(), c);
    });
    return { byId, byName };
  }, [taxonomy]);

  const findClass = (classId: string): { name: string; color: string } => {
    let classDef = classLookup.byId.get(classId);
    if (classDef) return { name: classDef.name, color: classDef.color };

    classDef = classLookup.byName.get(classId.toLowerCase());
    if (classDef) return { name: classDef.name, color: classDef.color };

    return { name: classId, color: '#888888' };
  };

  const trackData = useMemo(() => {
    const trackMap = new Map<string, Annotation[]>();

    allAnnotations.forEach((ann) => {
      if (ann.type !== 'cuboid') return;
      const trackId = ann.track_id || ann.id;
      const existing = trackMap.get(trackId) || [];
      existing.push(ann);
      trackMap.set(trackId, existing);
    });

    const tracks: TrackData[] = [];

    trackMap.forEach((annotations, trackId) => {
      const firstAnn = annotations[0];
      const classInfo = findClass(firstAnn.class_id);
      const className = classInfo.name;
      const classColor = classInfo.color;

      const metrics = calculateTrackMetrics(annotations);
      if (!metrics) return;

      const trackSuggestions = annotationSuggestions.filter(
        s => s.annotation_id && annotations.some(a => a.id === s.annotation_id)
      );

      const difficulty = calculateTrackDifficulty(metrics, className, trackSuggestions);

      const sortedAnnotations = [...annotations].sort((a, b) => {
        const frameA = frames.findIndex(f => f.id === a.frame_id);
        const frameB = frames.findIndex(f => f.id === b.frame_id);
        return frameA - frameB;
      });

      const boxes: BoxDifficulty[] = sortedAnnotations.map((ann, idx) => {
        const prev = idx > 0 ? sortedAnnotations[idx - 1] : undefined;
        const next = idx < sortedAnnotations.length - 1 ? sortedAnnotations[idx + 1] : undefined;
        return calculateBoxDifficulty(ann, prev, next, metrics);
      });

      const rankedBoxes = rankBoxesByDifficulty(boxes);

      const trackPreviousIssues = (previousIssues || []).filter(issue => {
        const isInTrack = annotations.some(a => a.id === issue.annotation_id);
        if (!isInTrack) return false;
        const currentReview = getAnnotationReview(issue.annotation_id);
        const shouldShow = !currentReview?.verdict;
        if (isInTrack) {
          console.log('[TrackQAPanel] Issue', issue.annotation_id.substring(0,8), 'in track', trackId.substring(0,8),
            '- current review:', currentReview?.verdict, '- shouldShow:', shouldShow);
        }
        return shouldShow;
      });

      if (trackPreviousIssues.length > 0) {
        console.log('[TrackQAPanel] Track', trackId.substring(0,8), 'has', trackPreviousIssues.length, 'previous issues');
      }

      tracks.push({
        trackId,
        annotations,
        difficulty,
        className,
        classColor,
        suggestionCount: trackSuggestions.length,
        frameCount: metrics.frameCount,
        boxes: rankedBoxes,
        previousIssues: trackPreviousIssues,
      });
    });

    const rankedDifficulties = rankTracksByDifficulty(tracks.map(t => t.difficulty));
    tracks.forEach(t => {
      const ranked = rankedDifficulties.find(d => d.trackId === t.trackId);
      if (ranked) t.difficulty = ranked;
    });

    return tracks;
  }, [allAnnotations, annotationSuggestions, classLookup, frames, previousIssues, getAnnotationReview, annotationReviews]);

  const sortedTracks = useMemo(() => {
    let sorted = [...trackData];
    switch (sortMode) {
      case 'difficulty':
        sorted.sort((a, b) => b.difficulty.totalScore - a.difficulty.totalScore);
        break;
      case 'frames':
        sorted.sort((a, b) => b.frameCount - a.frameCount);
        break;
      case 'class':
        sorted.sort((a, b) => a.className.localeCompare(b.className));
        break;
    }
    return sorted;
  }, [trackData, sortMode]);

  const qaProgress = useMemo(() => {
    let totalBoxes = 0;
    let reviewedBoxes = 0;
    let approvedBoxes = 0;
    let rejectedBoxes = 0;
    let flaggedBoxes = 0;

    trackData.forEach(track => {
      track.annotations.forEach(ann => {
        totalBoxes++;
        const review = annotationReviews.get(ann.id);
        if (review?.verdict && review.verdict !== 'pending') {
          reviewedBoxes++;
          if (review.verdict === 'approved') approvedBoxes++;
          else if (review.verdict === 'rejected') rejectedBoxes++;
          else if (review.verdict === 'flagged') flaggedBoxes++;
        }
      });
    });

    return { totalBoxes, reviewedBoxes, approvedBoxes, rejectedBoxes, flaggedBoxes, fnCount: falseNegativeSuggestions.length };
  }, [trackData, annotationReviews, falseNegativeSuggestions]);

  const currentFrameProgress = useMemo(() => {
    let totalBoxes = 0;
    let pendingBoxes = 0;

    trackData.forEach(track => {
      track.annotations.forEach(ann => {
        if (ann.frame_id === currentFrame?.id) {
          totalBoxes++;
          const review = annotationReviews.get(ann.id);
          if (!review?.verdict || review.verdict === 'pending') {
            pendingBoxes++;
          }
        }
      });
    });

    return { total: totalBoxes, pending: pendingBoxes };
  }, [trackData, annotationReviews, currentFrame]);

  const handleApproveAllRemaining = useCallback(async () => {
    const unreviewedIds: string[] = [];

    trackData.forEach(track => {
      track.annotations.forEach(ann => {
        const review = annotationReviews.get(ann.id);
        if (!review?.verdict || review.verdict === 'pending') {
          unreviewedIds.push(ann.id);
        }
      });
    });

    if (unreviewedIds.length > 0) {
      await approveAllVisible(unreviewedIds);
    }
  }, [trackData, annotationReviews, approveAllVisible]);

  const handleApproveCurrentFrame = useCallback(async () => {
    const unreviewedIds: string[] = [];

    trackData.forEach(track => {
      track.annotations.forEach(ann => {
        if (ann.frame_id === currentFrame?.id) {
          const review = annotationReviews.get(ann.id);
          if (!review?.verdict || review.verdict === 'pending') {
            unreviewedIds.push(ann.id);
          }
        }
      });
    });

    if (unreviewedIds.length > 0) {
      await approveAllVisible(unreviewedIds);
    }
  }, [trackData, annotationReviews, currentFrame, approveAllVisible]);

  const handleToggleTrack = useCallback((trackId: string) => {
    if (expandedTrackId === trackId) {
      setExpandedTrackId(null);
      setSelectedBoxId(null);
    } else {
      setExpandedTrackId(trackId);
      setSelectedBoxId(null);
      onSelectTrack(trackId);
    }
  }, [expandedTrackId, onSelectTrack]);

  const handleSelectBox = useCallback((box: BoxDifficulty) => {
    setSelectedBoxId(box.annotationId);
    const frameIndex = frames.findIndex(f => f.id === box.frameId);
    if (frameIndex >= 0) {
      goToFrame(frameIndex);
      setTimeout(() => {
        selectAnnotation(box.annotationId);
        onJumpToAnnotation(box.annotationId, box.frameId, 3);
      }, 50);
    }
  }, [frames, goToFrame, selectAnnotation, onJumpToAnnotation]);

  const advanceToNextBox = useCallback((annotationId: string, track: TrackData) => {
    if (!autoAdvanceRef.current) return;

    const currentIdx = track.boxes.findIndex(b => b.annotationId === annotationId);

    requestAnimationFrame(() => {
      setTimeout(() => {
        if (currentIdx >= 0 && currentIdx < track.boxes.length - 1) {
          const nextBox = track.boxes[currentIdx + 1];
          setSelectedBoxId(nextBox.annotationId);
          const frameIndex = frames.findIndex(f => f.id === nextBox.frameId);
          if (frameIndex >= 0) {
            goToFrame(frameIndex);
            requestAnimationFrame(() => {
              selectAnnotation(nextBox.annotationId);
              onJumpToAnnotation(nextBox.annotationId, nextBox.frameId, 3);
            });
          }
        } else {
          const trackIdx = sortedTracks.findIndex(t => t.trackId === track.trackId);
          if (trackIdx >= 0 && trackIdx < sortedTracks.length - 1) {
            const nextTrack = sortedTracks[trackIdx + 1];
            setExpandedTrackId(nextTrack.trackId);
            if (nextTrack.boxes.length > 0) {
              const firstBox = nextTrack.boxes[0];
              setSelectedBoxId(firstBox.annotationId);
              const frameIndex = frames.findIndex(f => f.id === firstBox.frameId);
              if (frameIndex >= 0) {
                goToFrame(frameIndex);
                requestAnimationFrame(() => {
                  selectAnnotation(firstBox.annotationId);
                  onJumpToAnnotation(firstBox.annotationId, firstBox.frameId, 3);
                });
              }
            }
          }
        }
      }, 50);
    });
  }, [sortedTracks, frames, goToFrame, selectAnnotation, onJumpToAnnotation]);

  const handleApprove = useCallback(async (annotationId: string, track: TrackData, frameId?: string, classId?: string) => {
    let resolvedFrameId = frameId;
    let resolvedClassId = classId;
    if (!resolvedFrameId || !resolvedClassId) {
      const ann = allAnnotations.find(a => a.id === annotationId);
      resolvedFrameId = resolvedFrameId || ann?.frame_id;
      resolvedClassId = resolvedClassId || ann?.class_id;
    }

    await approveAnnotation(annotationId, resolvedFrameId, resolvedClassId);

    advanceToNextBox(annotationId, track);
  }, [approveAnnotation, advanceToNextBox, allAnnotations]);

  const handleReject = useCallback((annotationId: string, track: TrackData, frameId?: string, classId?: string) => {
    pendingRejectionRef.current = { annotationId, trackId: track.trackId, frameId, classId };
    openRejectionModal(annotationId, frameId, classId);
  }, [openRejectionModal]);

  const handleFlag = useCallback((annotationId: string, track: TrackData, frameId?: string, classId?: string) => {
    pendingFlagRef.current = { annotationId, trackId: track.trackId, frameId, classId };
    setFlagAnnotationId(annotationId);
    setShowFlagModal(true);
  }, []);

  const handleFlagSubmit = useCallback(async (annotationId: string, notes: string) => {
    let frameId = pendingFlagRef.current?.frameId;
    let classId = pendingFlagRef.current?.classId;
    if (!frameId || !classId) {
      const ann = allAnnotations.find(a => a.id === annotationId);
      frameId = frameId || ann?.frame_id;
      classId = classId || ann?.class_id;
    }

    await flagAnnotation(annotationId, notes, frameId, classId);
    setShowFlagModal(false);
    setFlagAnnotationId(null);

    if (pendingFlagRef.current) {
      const track = sortedTracks.find(t => t.trackId === pendingFlagRef.current?.trackId);
      if (track) {
        advanceToNextBox(annotationId, track);
      }
      pendingFlagRef.current = null;
    }
  }, [flagAnnotation, sortedTracks, advanceToNextBox, allAnnotations]);

  const handleFlagModalClose = useCallback(() => {
    setShowFlagModal(false);
    setFlagAnnotationId(null);
    pendingFlagRef.current = null;
  }, []);

  const lastProcessedRejectionRef = useRef<string | null>(null);

  useEffect(() => {
    if (!showRejectionModal && pendingRejectionRef.current) {
      const { annotationId, trackId } = pendingRejectionRef.current;

      if (lastProcessedRejectionRef.current === annotationId) {
        pendingRejectionRef.current = null;
        return;
      }

      const track = sortedTracks.find(t => t.trackId === trackId);

      const review = getAnnotationReview(annotationId);
      if (track && review?.verdict === 'rejected') {
        lastProcessedRejectionRef.current = annotationId;
        pendingRejectionRef.current = null;
        setTimeout(() => {
          advanceToNextBox(annotationId, track);
        }, 150);
      } else if (!showRejectionModal) {
        pendingRejectionRef.current = null;
      }
    }
  }, [showRejectionModal, sortedTracks, getAnnotationReview, advanceToNextBox]);

  const handleApproveTrack = useCallback(async (track: TrackData) => {
    const annotationIds = track.annotations.map(a => a.id);
    await approveTrack(track.trackId, annotationIds);
  }, [approveTrack]);

  useEffect(() => {
    const selectedAnnotationId = selection.selectedAnnotationIds[0];
    if (!selectedAnnotationId) return;

    if (selectedBoxId === selectedAnnotationId) return;

    const track = trackData.find(t =>
      t.annotations.some(a => a.id === selectedAnnotationId)
    );

    if (track) {
      if (expandedTrackId !== track.trackId) {
        setExpandedTrackId(track.trackId);
        onSelectTrack(track.trackId);
      }

      setSelectedBoxId(selectedAnnotationId);

      setTimeout(() => {
        const trackElement = trackItemRefs.current.get(track.trackId);
        if (trackElement) {
          trackElement.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 100);
    }
  }, [selection.selectedAnnotationIds, trackData, expandedTrackId, selectedBoxId, onSelectTrack]);

  useEffect(() => {
    if (selectedBoxRef.current) {
      selectedBoxRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedBoxId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!expandedTrackId || !selectedBoxId) return;

      const track = trackData.find(t => t.trackId === expandedTrackId);
      if (!track) return;

      const currentIdx = track.boxes.findIndex(b => b.annotationId === selectedBoxId);

      if ((e.key === 'ArrowDown' || e.key === 'j') && currentIdx < track.boxes.length - 1) {
        e.preventDefault();
        handleSelectBox(track.boxes[currentIdx + 1]);
      } else if ((e.key === 'ArrowUp' || e.key === 'k') && currentIdx > 0) {
        e.preventDefault();
        handleSelectBox(track.boxes[currentIdx - 1]);
      } else if (e.key === '1') {
        e.preventDefault();
        handleApprove(selectedBoxId, track);
      } else if (e.key === '2') {
        e.preventDefault();
        handleReject(selectedBoxId, track);
      } else if (e.key === '3') {
        e.preventDefault();
        handleFlag(selectedBoxId, track);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expandedTrackId, selectedBoxId, trackData, handleSelectBox, handleApprove, handleReject, handleFlag]);

  const handlePanelClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      className="flex flex-col h-full bg-gray-900"
      onClick={handlePanelClick}
      onMouseDown={handlePanelClick}
    >
      {/* QA Progress Header */}
      <div className="flex-shrink-0 px-3 py-2 bg-gray-800/50 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-white">
            QA Progress: {qaProgress.reviewedBoxes}/{qaProgress.totalBoxes}
          </span>
          <span className="text-xs text-gray-400">
            {qaProgress.totalBoxes > 0 ? Math.round((qaProgress.reviewedBoxes / qaProgress.totalBoxes) * 100) : 0}%
          </span>
        </div>
        {/* Progress bar */}
        <div className="mt-1.5 h-1.5 bg-gray-700 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-green-500 via-yellow-500 to-green-500 transition-all duration-300"
            style={{
              width: `${qaProgress.totalBoxes > 0 ? (qaProgress.reviewedBoxes / qaProgress.totalBoxes) * 100 : 0}%`
            }}
          />
        </div>
        {/* Breakdown */}
        <div className="flex items-center gap-3 mt-1.5 text-xs">
          <span className="text-green-400">✓ {qaProgress.approvedBoxes}</span>
          <span className="text-red-400">✗ {qaProgress.rejectedBoxes}</span>
          <span className="text-yellow-400">! {qaProgress.flaggedBoxes}</span>
          {qaProgress.fnCount > 0 && (
            <span className="text-orange-400">🚩 {qaProgress.fnCount} FN</span>
          )}
        </div>
      </div>

      {/* Controls row */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-700/50">
        <div className="flex items-center gap-2">
          <select
            value={sortMode}
            onChange={(e) => setSortMode(e.target.value as SortMode)}
            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-white"
          >
            <option value="difficulty">Hardest first</option>
            <option value="frames">Most frames</option>
            <option value="class">By class</option>
          </select>

          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-400">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(e) => setAutoAdvance(e.target.checked)}
              className="w-3 h-3 rounded"
            />
            Auto-next
          </label>
        </div>

        <div className="flex items-center gap-2">
          {/* Approve all in current frame */}
          {currentFrameProgress.pending > 0 && (
            <button
              onClick={handleApproveCurrentFrame}
              className="px-2 py-1 bg-blue-600/40 hover:bg-blue-600 rounded text-xs text-blue-100 transition-colors"
              title="Approve all tracked boxes in current frame"
            >
              ✓ Frame ({currentFrameProgress.pending})
            </button>
          )}

          {/* Approve all remaining */}
          {qaProgress.totalBoxes - qaProgress.reviewedBoxes > 0 && (
            <button
              onClick={handleApproveAllRemaining}
              className="px-2 py-1 bg-green-600/40 hover:bg-green-600 rounded text-xs text-green-100 transition-colors"
              title="Approve all remaining tracked boxes"
            >
              ✓ All ({qaProgress.totalBoxes - qaProgress.reviewedBoxes})
            </button>
          )}
        </div>
      </div>

      {/* Track list */}
      <div className="flex-1 overflow-y-auto">
        {/* False Negative Flags Section - Current Frame Only */}
        {currentFrameFalseNegatives.length > 0 && (
          <div className="m-2 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg">
            <div className="flex items-center gap-2 mb-2">
              <FlagIcon />
              <span className="text-sm font-medium text-orange-300">
                Missing Objects - Frame {currentFrameIndex + 1} ({currentFrameFalseNegatives.length})
              </span>
            </div>
            <div className="space-y-1.5">
              {currentFrameFalseNegatives.map(suggestion => {
                const location = suggestion.details?.location as { x: number; y: number; z: number } | undefined;
                const suggestedClass = suggestion.details?.suggested_class as string | undefined;
                return (
                  <div key={suggestion.id} className="p-2 bg-gray-900/50 rounded text-xs">
                    <div className="text-gray-300 mb-1">{suggestion.message}</div>
                    {location && (
                      <div className="text-gray-500 font-mono text-[10px]">
                        @ ({location.x.toFixed(1)}, {location.y.toFixed(1)}, {location.z.toFixed(1)})
                      </div>
                    )}
                    {suggestedClass && (
                      <div className="text-orange-400 text-[10px] mt-1">
                        Suggested: {taxonomy?.classes.find(c => c.id === suggestedClass)?.name || suggestedClass}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="p-2 space-y-1">
          {sortedTracks.map(track => {
            const isExpanded = expandedTrackId === track.trackId;
            const diffInfo = getDifficultyLevel(track.difficulty.totalScore);
            const trackReviewed = track.annotations.filter(a => {
              const r = getAnnotationReview(a.id);
              return r?.verdict && r.verdict !== 'pending';
            }).length;

            // Calculate frame range for track
            const frameIndices = track.boxes.map(b => {
              const idx = frames.findIndex(f => f.id === b.frameId);
              return idx >= 0 ? idx + 1 : 0;
            }).filter(i => i > 0);
            const firstFrame = frameIndices.length > 0 ? Math.min(...frameIndices) : 0;
            const lastFrame = frameIndices.length > 0 ? Math.max(...frameIndices) : 0;
            const frameRange = firstFrame === lastFrame ? `F${firstFrame}` : `F${firstFrame}-${lastFrame}`;

            console.log('[TrackQAPanel] Track:', track.className, 'frameRange:', frameRange, 'suggestionCount:', track.suggestionCount);

            return (
              <div
                key={track.trackId}
                className="rounded-lg overflow-hidden"
                ref={(el) => {
                  if (el) trackItemRefs.current.set(track.trackId, el);
                  else trackItemRefs.current.delete(track.trackId);
                }}
              >
                {/* Track header */}
                <div
                  onClick={() => handleToggleTrack(track.trackId)}
                  className={`
                    flex items-center gap-2 p-2 cursor-pointer transition-colors
                    ${isExpanded ? 'bg-blue-600/20 border-l-2 border-blue-500' : 'bg-gray-800/50 hover:bg-gray-800'}
                    ${track.previousIssues.length > 0 && !isExpanded ? 'border-l-2 border-orange-500' : ''}
                  `}
                >
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: track.classColor }} />
                  <span className="flex-1 text-sm font-medium text-white truncate">{track.className}</span>
                  {/* Frame range */}
                  <span className="text-[10px] text-blue-400 flex-shrink-0" title="Frame range">
                    {frameRange}
                  </span>
                  {track.previousIssues.length > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-xs bg-orange-500/20 text-orange-400 font-medium">
                      ⚠{track.previousIssues.length}
                    </span>
                  )}
                  {/* AI Issues count */}
                  {track.suggestionCount > 0 && (
                    <span className="text-[10px] text-yellow-400 flex-shrink-0" title="AI-detected issues">
                      <span className="text-gray-500">Issues:</span> ⚠️{track.suggestionCount}
                    </span>
                  )}
                  <span className={`px-1.5 py-0.5 rounded text-xs ${diffInfo.bgColor} ${diffInfo.color}`}>
                    {diffInfo.emoji}{track.difficulty.totalScore}
                  </span>
                  <span className="text-xs text-gray-500">{trackReviewed}/{track.boxes.length}</span>
                  <span className={`transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                    <ChevronDownIcon />
                  </span>
                </div>

                {/* Expanded boxes */}
                {isExpanded && (
                  <div className="bg-gray-800/30 border-l-2 border-blue-500/50">
                    {/* AI Issues Section */}
                    {track.suggestionCount > 0 && (() => {
                      // Get suggestions for this track
                      const trackSuggestions = annotationSuggestions.filter(
                        s => s.annotation_id && track.annotations.some(a => a.id === s.annotation_id)
                      );

                      // Group suggestions by message to avoid duplicates
                      const grouped = new Map<string, { suggestion: typeof trackSuggestions[0]; count: number; frameIndices: number[] }>();
                      trackSuggestions.forEach(s => {
                        const existing = grouped.get(s.message);
                        const frameIdx = s.frame_id ? frames.findIndex(f => f.id === s.frame_id) + 1 : 0;
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
                        <div className="px-3 py-2 bg-orange-500/10 border-b border-gray-700">
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

                    {/* Quick actions */}
                    <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700/50">
                      <span className="text-xs text-gray-500">
                        <kbd className="px-1 bg-gray-700 rounded">↑↓</kbd> nav
                        <kbd className="ml-2 px-1 bg-gray-700 rounded">1</kbd>✓
                        <kbd className="ml-1 px-1 bg-gray-700 rounded">2</kbd>✗
                        <kbd className="ml-1 px-1 bg-gray-700 rounded">3</kbd>!
                      </span>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleApproveTrack(track); }}
                        className="px-2 py-0.5 bg-green-600/40 hover:bg-green-600 rounded text-xs text-green-100"
                      >
                        ✓ Approve all
                      </button>
                    </div>

                    {/* Box list */}
                    <div className="space-y-0.5 p-1">
                      {track.boxes.map((box, idx) => {
                        const isSelected = selectedBoxId === box.annotationId;
                        const verdict = getAnnotationReview(box.annotationId)?.verdict || 'pending';
                        const boxDiff = getDifficultyLevel(box.score);
                        const isPending = verdict === 'pending';
                        const annotation = track.annotations.find(a => a.id === box.annotationId);
                        const boxFrameIndex = frames.findIndex(f => f.id === box.frameId);

                        return (
                          <div key={box.annotationId}>
                            <div
                              ref={isSelected ? selectedBoxRef : undefined}
                              onClick={() => handleSelectBox(box)}
                              className={`
                                flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all
                                ${isSelected
                                  ? 'bg-blue-500/30 border border-blue-500'
                                  : 'hover:bg-gray-700/50 border border-transparent'}
                              `}
                            >
                              <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${isSelected ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-400'}`}>
                                {idx + 1}
                              </span>
                              <span
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const frameIdx = frames.findIndex(f => f.id === box.frameId);
                                  if (frameIdx >= 0) {
                                    goToFrame(frameIdx);
                                    setTimeout(() => {
                                      selectAnnotation(box.annotationId);
                                      onJumpToAnnotation(box.annotationId, box.frameId, 3);
                                    }, 50);
                                  }
                                }}
                                className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 font-mono cursor-pointer transition-colors"
                                title={`Go to frame ${boxFrameIndex + 1}`}
                              >
                                F{boxFrameIndex + 1}
                              </span>
                              <span className={`px-1 py-0.5 rounded text-xs ${boxDiff.bgColor} ${boxDiff.color}`}>
                                {box.score}
                              </span>
                              <span className="flex-1 text-xs text-gray-400">
                                {box.factors.distance.toFixed(0)}m
                                {box.factors.isInterpolated && ' 🤖'}
                              </span>

                              {isPending ? (
                                <div className="flex items-center gap-0.5">
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleApprove(box.annotationId, track, box.frameId, track.annotations[0]?.class_id); }}
                                    className={`p-1 rounded ${isSelected ? 'bg-green-600 hover:bg-green-500' : 'bg-green-600/30 hover:bg-green-600/60'} text-green-100`}
                                  >
                                    <CheckIcon />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleReject(box.annotationId, track, box.frameId, track.annotations[0]?.class_id); }}
                                    className={`p-1 rounded ${isSelected ? 'bg-red-600 hover:bg-red-500' : 'bg-red-600/30 hover:bg-red-600/60'} text-red-100`}
                                  >
                                    <XIcon />
                                  </button>
                                  <button
                                    onClick={(e) => { e.stopPropagation(); handleFlag(box.annotationId, track, box.frameId, track.annotations[0]?.class_id); }}
                                    className={`p-1 rounded ${isSelected ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-yellow-600/30 hover:bg-yellow-600/60'} text-yellow-100`}
                                  >
                                    <FlagIcon />
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-0.5">
                                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                    verdict === 'approved' ? 'bg-green-500/30 text-green-400' :
                                    verdict === 'rejected' ? 'bg-red-500/30 text-red-400' :
                                    'bg-yellow-500/30 text-yellow-400'
                                  }`}>
                                    {verdict === 'approved' ? '✓' : verdict === 'rejected' ? '✗' : '!'}
                                  </span>
                                  {isSelected && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        clearAnnotationReview(box.annotationId);
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

                            {/* Selected box attributes - compact 2-line display */}
                            {isSelected && annotation && annotation.data && 'center' in annotation.data && 'dimensions' in annotation.data && (
                              <div className="mx-2 my-1 px-2 py-1.5 bg-gray-900/80 rounded border border-blue-500/30 text-xs font-mono">
                                <div className="text-gray-300">
                                  <span className="text-gray-500">L:</span>{annotation.data.dimensions.length?.toFixed(2)}
                                  <span className="text-gray-500 ml-2">W:</span>{annotation.data.dimensions.width?.toFixed(2)}
                                  <span className="text-gray-500 ml-2">H:</span>{annotation.data.dimensions.height?.toFixed(2)}
                                </div>
                                <div className="text-gray-300 mt-0.5">
                                  <span className="text-gray-500">X:</span>{annotation.data.center.x?.toFixed(2)}
                                  <span className="text-gray-500 ml-2">Y:</span>{annotation.data.center.y?.toFixed(2)}
                                  <span className="text-gray-500 ml-2">Z:</span>{annotation.data.center.z?.toFixed(2)}
                                  {'rotation' in annotation.data && (
                                    <span className="ml-2"><span className="text-gray-500">Yaw:</span>{(annotation.data.rotation.yaw * 180 / Math.PI).toFixed(1)}°</span>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Previous Issues Section - Show rejected/flagged items from previous reviews */}
                    {track.previousIssues.length > 0 && (
                      <div className="border-t border-orange-500/30 bg-orange-500/5">
                        <div className="px-3 py-1.5 flex items-center gap-2">
                          <span className="text-orange-400 text-xs font-semibold">⚠ Previous Issues ({track.previousIssues.length})</span>
                          <span className="text-gray-500 text-[10px]">Review annotator fixes</span>
                        </div>
                        <div className="space-y-0.5 p-1">
                          {track.previousIssues.map(issue => {
                            const issueFrameIndex = issue.frame_id
                              ? frames.findIndex(f => f.id === issue.frame_id)
                              : -1;
                            const issueAnnotation = track.annotations.find(a => a.id === issue.annotation_id);
                            const issueFrameId = issue.frame_id || issueAnnotation?.frame_id;
                            const issueClassId = issue.class_id || issueAnnotation?.class_id;

                            return (
                              <div
                                key={issue.id}
                                className="flex items-center gap-2 px-2 py-1.5 rounded bg-orange-500/10 border border-orange-500/20"
                              >
                                <span className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold ${
                                  issue.verdict === 'rejected' ? 'bg-red-500/30 text-red-400' : 'bg-yellow-500/30 text-yellow-400'
                                }`}>
                                  {issue.verdict === 'rejected' ? '✗' : '!'}
                                </span>
                                <button
                                  onClick={() => {
                                    if (issueFrameId) {
                                      const frameIdx = frames.findIndex(f => f.id === issueFrameId);
                                      if (frameIdx >= 0) {
                                        goToFrame(frameIdx);
                                        setTimeout(() => {
                                          selectAnnotation(issue.annotation_id);
                                          onJumpToAnnotation(issue.annotation_id, issueFrameId, 3);
                                        }, 50);
                                      }
                                    }
                                  }}
                                  className="px-2 py-0.5 bg-gray-700 hover:bg-gray-600 rounded text-xs text-gray-300 font-mono cursor-pointer transition-colors"
                                  title={`Go to frame ${issueFrameIndex + 1}`}
                                >
                                  {issueFrameIndex >= 0 ? `F${issueFrameIndex + 1}` : 'Go'}
                                </button>
                                <span className="flex-1 text-xs text-orange-300 truncate">
                                  {issue.issue_types?.map(t => t.replace(/_/g, ' ')).join(', ') || issue.notes || 'No details'}
                                </span>

                                {/* Quick approve/reject buttons */}
                                <div className="flex items-center gap-0.5">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleApprove(issue.annotation_id, track, issueFrameId, issueClassId);
                                    }}
                                    className="p-1 rounded bg-green-600/30 hover:bg-green-600 text-green-100"
                                    title="Approve fix"
                                  >
                                    <CheckIcon />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleReject(issue.annotation_id, track, issueFrameId, issueClassId);
                                    }}
                                    className="p-1 rounded bg-red-600/30 hover:bg-red-600 text-red-100"
                                    title="Still has issues"
                                  >
                                    <XIcon />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Flag Modal */}
      <FlagModal
        isOpen={showFlagModal}
        annotationId={flagAnnotationId}
        onClose={handleFlagModalClose}
        onSubmit={handleFlagSubmit}
      />
    </div>
  );
};

export default TrackQAPanel;

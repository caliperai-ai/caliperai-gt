import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEditorStore } from '@/store/editorStore';
import { useQAStore, useQASuggestions } from '@/store/qaStore';
import { qaApi, annotation3DApi, type Annotation3DData } from '@/api/client';
import { FlagModal } from './FlagModal';
import type { Annotation, ClassDefinition } from '@/types';

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

const WarningIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

interface FrameAnnotationsTabProps {
  onJumpToAnnotation: (annotationId: string, frameId: string, zoomLevel?: number) => void;
}

export const FrameAnnotationsTab: React.FC<FrameAnnotationsTabProps> = ({
  onJumpToAnnotation,
}) => {
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvance] = useState(true);
  const autoAdvanceRef = useRef(autoAdvance);
  const selectedItemRef = useRef<HTMLDivElement>(null);

  const isInitialMountRef = useRef(true);

  const [showFlagModal, setShowFlagModal] = useState(false);
  const [flagAnnotationId, setFlagAnnotationId] = useState<string | null>(null);
  const pendingFlagRef = useRef<string | null>(null);

  const pendingRejectionRef = useRef<string | null>(null);
  const lastProcessedRejectionRef = useRef<string | null>(null);

  useEffect(() => {
    autoAdvanceRef.current = autoAdvance;
  }, [autoAdvance]);

  const {
    approveAnnotation,
    approveAllVisible,
    openRejectionModal,
    flagAnnotation,
    clearAnnotationReview,
    getAnnotationReview,
    showRejectionModal,
    annotationReviews,
  } = useQAStore();

  const frames = useEditorStore((s) => s.frames);
  const taxonomy = useEditorStore((s) => s.taxonomy);
  const currentFrameIndex = useEditorStore((s) => s.currentFrameIndex);
  const goToFrame = useEditorStore((s) => s.goToFrame);
  const selectAnnotation = useEditorStore((s) => s.selectAnnotation);
  const selection = useEditorStore((s) => s.selection);
  const taskId = useEditorStore((s) => s.task?.id);

  const currentFrame = frames[currentFrameIndex];
  const queryClient = useQueryClient();

  const handleUpdateAnnotationAttributes = useCallback(async (annotationId: string, attributes: Record<string, unknown>) => {
    try {
      await annotation3DApi.update(annotationId, { attributes });
      queryClient.invalidateQueries({ queryKey: ['all-3d-annotations-frame-review', taskId] });
    } catch (error) {
      console.error('Failed to update annotation attributes:', error);
    }
  }, [taskId, queryClient]);

  const { data: allTaskAnnotations } = useQuery({
    queryKey: ['all-3d-annotations-frame-review', taskId],
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

  const { data: suggestions, isLoading: _suggestionsLoading, error: _suggestionsError } = useQuery({
    queryKey: ['qa-suggestions', taskId],
    queryFn: async () => {
      const result = await qaApi.getTaskSuggestions(taskId!);
      console.log('[FrameAnnotationsTab] Fetched suggestions from API:', {
        count: result?.length || 0,
        withAnnotationId: result?.filter((s: any) => s.annotation_id).length || 0,
        sample: result?.[0],
      });
      return result;
    },
    enabled: !!taskId,
    refetchInterval: 5000,
  });

  const allFalseNegatives = useMemo(() => {
    if (!suggestions) return [];
    return suggestions.filter(s =>
      s.suggestion_type === 'false_negative' &&
      !s.is_dismissed
    );
  }, [suggestions]);

  const falseNegativesByFrame = useMemo(() => {
    const byFrame = new Map<string, typeof allFalseNegatives>();
    allFalseNegatives.forEach(fn => {
      if (fn.frame_id) {
        const existing = byFrame.get(fn.frame_id) || [];
        existing.push(fn);
        byFrame.set(fn.frame_id, existing);
      }
    });
    return byFrame;
  }, [allFalseNegatives]);

  const qaSuggestions = useQASuggestions();

  const allSuggestions = useMemo(() => {
    const merged = [...(suggestions || [])];
    const seenIds = new Set(merged.map(s => s.id));
    qaSuggestions.forEach(s => {
      if (!seenIds.has(s.id)) {
        merged.push(s);
      }
    });
    return merged;
  }, [suggestions, qaSuggestions]);

  const annotationIssues = useMemo(() => {
    const issueMap = new Map<string, typeof allSuggestions>();
    const filteredSuggestions = allSuggestions
      .filter(s => s.suggestion_type !== 'false_negative' && s.annotation_id && !s.is_dismissed);

    console.log('[FrameAnnotationsTab] Building annotationIssues:', {
      totalSuggestions: allSuggestions.length,
      apiSuggestions: suggestions?.length || 0,
      storeSuggestions: qaSuggestions.length,
      withAnnotationId: filteredSuggestions.length,
    });

    filteredSuggestions.forEach(s => {
        if (s.annotation_id) {
          const existing = issueMap.get(s.annotation_id) || [];
          existing.push(s);
          issueMap.set(s.annotation_id, existing);
        }
      });
    return issueMap;
  }, [allSuggestions, suggestions, qaSuggestions]);

  const classLookup = useMemo(() => {
    const byId = new Map<string, ClassDefinition>();
    taxonomy?.classes.forEach(c => byId.set(c.id, c));
    return byId;
  }, [taxonomy]);

  const annotationLookup = useMemo(() => {
    const map = new Map<string, Annotation>();
    allAnnotations.forEach(ann => map.set(ann.id, ann));
    return map;
  }, [allAnnotations]);

  const allFrameAnnotations = useMemo(() => {
    const byFrame = new Map<string, { frameIndex: number; frameId: string; annotations: Annotation[] }>();

    frames.forEach((frame, idx) => {
      byFrame.set(frame.id, { frameIndex: idx, frameId: frame.id, annotations: [] });
    });

    allAnnotations.forEach(ann => {
      if (!ann.track_id && byFrame.has(ann.frame_id)) {
        byFrame.get(ann.frame_id)!.annotations.push(ann);
      }
    });

    byFrame.forEach((frameData) => {
      frameData.annotations.sort((a, b) => {
        const classA = classLookup.get(a.class_id)?.name || a.class_id;
        const classB = classLookup.get(b.class_id)?.name || b.class_id;
        return classA.localeCompare(classB);
      });
    });

    return Array.from(byFrame.values())
      .filter(f => f.annotations.length > 0)
      .sort((a, b) => a.frameIndex - b.frameIndex);
  }, [allAnnotations, frames, classLookup]);

  const trackedAnnotationCount = useMemo(() => {
    return allAnnotations.filter(ann => ann.track_id).length;
  }, [allAnnotations]);

  const uniqueTrackCount = useMemo(() => {
    const trackIds = new Set<string>();
    allAnnotations.forEach(ann => {
      if (ann.track_id) trackIds.add(ann.track_id);
    });
    return trackIds.size;
  }, [allAnnotations]);

  const flatAnnotations = useMemo(() => {
    return allFrameAnnotations.flatMap(f => f.annotations);
  }, [allFrameAnnotations]);

  const frameAnnotations = useMemo(() => {
    if (!currentFrame) return [];
    return flatAnnotations.filter(a => a.frame_id === currentFrame.id);
  }, [flatAnnotations, currentFrame]);

  const progress = useMemo(() => {
    let reviewed = 0;
    let approved = 0;
    let rejected = 0;
    let flagged = 0;

    flatAnnotations.forEach(ann => {
      const review = annotationReviews.get(ann.id);
      if (review?.verdict && review.verdict !== 'pending') {
        reviewed++;
        if (review.verdict === 'approved') approved++;
        else if (review.verdict === 'rejected') rejected++;
        else if (review.verdict === 'flagged') flagged++;
      }
    });

    const fnCount = allFalseNegatives.length;

    return { total: flatAnnotations.length, reviewed, approved, rejected, flagged, fnCount };
  }, [flatAnnotations, annotationReviews, allFalseNegatives]);

  const currentFrameProgress = useMemo(() => {
    const frameAnns = frameAnnotations;
    let reviewed = 0;

    frameAnns.forEach(ann => {
      const review = annotationReviews.get(ann.id);
      if (review?.verdict && review.verdict !== 'pending') {
        reviewed++;
      }
    });

    return { total: frameAnns.length, reviewed, pending: frameAnns.length - reviewed };
  }, [frameAnnotations, annotationReviews]);

  const findNextUnreviewed = useCallback((afterId?: string): Annotation | null => {
    const startIdx = afterId
      ? flatAnnotations.findIndex(a => a.id === afterId) + 1
      : 0;

    for (let i = startIdx; i < flatAnnotations.length; i++) {
      const review = annotationReviews.get(flatAnnotations[i].id);
      if (!review?.verdict || review.verdict === 'pending') {
        return flatAnnotations[i];
      }
    }
    return null;
  }, [flatAnnotations, annotationReviews]);

  const advanceToNext = useCallback((fromAnnotationId: string) => {
    if (!autoAdvanceRef.current) return;

    requestAnimationFrame(() => {
      setTimeout(() => {
        const nextAnnotation = findNextUnreviewed(fromAnnotationId);

        if (nextAnnotation) {
          const frameIndex = frames.findIndex(f => f.id === nextAnnotation.frame_id);

          if (frameIndex !== -1 && frameIndex !== currentFrameIndex) {
            goToFrame(frameIndex);
          }

          setSelectedAnnotationId(nextAnnotation.id);
          selectAnnotation(nextAnnotation.id);
          onJumpToAnnotation(nextAnnotation.id, nextAnnotation.frame_id, 2);
        }
      }, 50);
    });
  }, [findNextUnreviewed, selectAnnotation, onJumpToAnnotation, frames, currentFrameIndex, goToFrame]);

  useEffect(() => {
    if (isInitialMountRef.current) {
      isInitialMountRef.current = false;
      const firstUnreviewed = findNextUnreviewed();
      if (firstUnreviewed) {
        setSelectedAnnotationId(firstUnreviewed.id);
      } else if (frameAnnotations.length > 0) {
        setSelectedAnnotationId(frameAnnotations[0].id);
      }
      return;
    }

    const firstUnreviewed = findNextUnreviewed();
    if (firstUnreviewed) {
      setSelectedAnnotationId(firstUnreviewed.id);
    } else if (frameAnnotations.length > 0) {
      setSelectedAnnotationId(frameAnnotations[0].id);
    } else {
      setSelectedAnnotationId(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFrameIndex]);

  useEffect(() => {
    const editorSelected = selection.selectedAnnotationIds[0];
    if (editorSelected && editorSelected !== selectedAnnotationId) {
      const isKnownAnnotation = annotationLookup.has(editorSelected);
      if (isKnownAnnotation) {
        setSelectedAnnotationId(editorSelected);
      }
    }
  }, [selection.selectedAnnotationIds, selectedAnnotationId, annotationLookup]);

  useEffect(() => {
    if (selectedItemRef.current) {
      selectedItemRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [selectedAnnotationId]);

  const handleSelectAnnotation = useCallback((ann: Annotation) => {
    setSelectedAnnotationId(ann.id);
    selectAnnotation(ann.id);
    onJumpToAnnotation(ann.id, ann.frame_id, 2);
  }, [selectAnnotation, onJumpToAnnotation]);

  const handleApprove = useCallback(async (annotationId: string) => {
    const ann = annotationLookup.get(annotationId);
    const frameId = ann?.frame_id || currentFrame?.id;
    const classId = ann?.class_id;
    await approveAnnotation(annotationId, frameId, classId);
    advanceToNext(annotationId);
  }, [approveAnnotation, advanceToNext, annotationLookup, currentFrame]);

  const handleReject = useCallback((annotationId: string) => {
    const ann = annotationLookup.get(annotationId);
    const frameId = ann?.frame_id || currentFrame?.id;
    const classId = ann?.class_id;
    pendingRejectionRef.current = annotationId;
    openRejectionModal(annotationId, frameId, classId);
  }, [openRejectionModal, annotationLookup, currentFrame]);

  const handleFlag = useCallback((annotationId: string) => {
    pendingFlagRef.current = annotationId;
    setFlagAnnotationId(annotationId);
    setShowFlagModal(true);
  }, []);

  const handleFlagSubmit = useCallback(async (annotationId: string, notes: string) => {
    const ann = annotationLookup.get(annotationId);
    const frameId = ann?.frame_id || currentFrame?.id;
    const classId = ann?.class_id;
    await flagAnnotation(annotationId, notes, frameId, classId);
    setShowFlagModal(false);
    setFlagAnnotationId(null);

    if (pendingFlagRef.current) {
      advanceToNext(annotationId);
      pendingFlagRef.current = null;
    }
  }, [flagAnnotation, advanceToNext, annotationLookup, currentFrame]);

  const handleFlagModalClose = useCallback(() => {
    setShowFlagModal(false);
    setFlagAnnotationId(null);
    pendingFlagRef.current = null;
  }, []);

  const handleAcceptFN = useCallback(async (suggestionId: string) => {
    try {
      await qaApi.dismissSuggestion(suggestionId, 'FN fixed by annotator - accepted');
      console.log('[FrameAnnotationsTab] FN accepted:', suggestionId);
    } catch (error) {
      console.error('[FrameAnnotationsTab] Failed to accept FN:', error);
    }
  }, []);

  const handleDismissFN = useCallback(async (suggestionId: string) => {
    try {
      await qaApi.dismissSuggestion(suggestionId, 'FN dismissed - false flag or not needed');
      console.log('[FrameAnnotationsTab] FN dismissed:', suggestionId);
    } catch (error) {
      console.error('[FrameAnnotationsTab] Failed to dismiss FN:', error);
    }
  }, []);

  useEffect(() => {
    if (!showRejectionModal && pendingRejectionRef.current) {
      const annotationId = pendingRejectionRef.current;

      if (lastProcessedRejectionRef.current === annotationId) {
        pendingRejectionRef.current = null;
        return;
      }

      const review = getAnnotationReview(annotationId);
      if (review?.verdict === 'rejected') {
        lastProcessedRejectionRef.current = annotationId;
        pendingRejectionRef.current = null;
        setTimeout(() => {
          advanceToNext(annotationId);
        }, 150);
      } else if (!showRejectionModal) {
        pendingRejectionRef.current = null;
      }
    }
  }, [showRejectionModal, getAnnotationReview, advanceToNext]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!selectedAnnotationId) return;

      const currentIdx = flatAnnotations.findIndex(a => a.id === selectedAnnotationId);

      if ((e.key === 'ArrowDown' || e.key === 'j') && currentIdx < flatAnnotations.length - 1) {
        e.preventDefault();
        const nextAnn = flatAnnotations[currentIdx + 1];
        const frameIdx = frames.findIndex(f => f.id === nextAnn.frame_id);
        if (frameIdx !== -1 && frameIdx !== currentFrameIndex) {
          goToFrame(frameIdx);
        }
        handleSelectAnnotation(nextAnn);
      } else if ((e.key === 'ArrowUp' || e.key === 'k') && currentIdx > 0) {
        e.preventDefault();
        const prevAnn = flatAnnotations[currentIdx - 1];
        const frameIdx = frames.findIndex(f => f.id === prevAnn.frame_id);
        if (frameIdx !== -1 && frameIdx !== currentFrameIndex) {
          goToFrame(frameIdx);
        }
        handleSelectAnnotation(prevAnn);
      } else if (e.key === '1') {
        e.preventDefault();
        handleApprove(selectedAnnotationId);
      } else if (e.key === '2') {
        e.preventDefault();
        handleReject(selectedAnnotationId);
      } else if (e.key === '3') {
        e.preventDefault();
        handleFlag(selectedAnnotationId);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAnnotationId, flatAnnotations, frames, currentFrameIndex, goToFrame, handleSelectAnnotation, handleApprove, handleReject, handleFlag]);

  const handleApproveAllRemaining = useCallback(async () => {
    const unreviewedIds = flatAnnotations
      .filter(ann => {
        const review = annotationReviews.get(ann.id);
        return !review?.verdict || review.verdict === 'pending';
      })
      .map(ann => ann.id);

    if (unreviewedIds.length > 0) {
      await approveAllVisible(unreviewedIds);
    }
  }, [flatAnnotations, annotationReviews, approveAllVisible]);

  const handleApproveCurrentFrame = useCallback(async () => {
    const unreviewedIds = frameAnnotations
      .filter(ann => {
        const review = annotationReviews.get(ann.id);
        return !review?.verdict || review.verdict === 'pending';
      })
      .map(ann => ann.id);

    if (unreviewedIds.length > 0) {
      await approveAllVisible(unreviewedIds);
    }
  }, [frameAnnotations, annotationReviews, approveAllVisible]);

  return (
    <div className="flex flex-col h-full">
      {/* Header with progress - CURRENT FRAME ONLY */}
      <div className="flex-shrink-0 px-3 py-2 bg-gray-800/50 border-b border-gray-700">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm font-medium text-white">
            Frame {(currentFrame?.frame_index ?? currentFrameIndex) + 1} • {currentFrameProgress.reviewed}/{currentFrameProgress.total} reviewed
          </span>
          {currentFrameProgress.total > 0 && (
            <span className="text-xs text-gray-400">
              {Math.round((currentFrameProgress.reviewed / currentFrameProgress.total) * 100)}%
            </span>
          )}
        </div>

        {/* Progress bar */}
        {currentFrameProgress.total > 0 && (
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-500 to-green-500 transition-all duration-300"
              style={{ width: `${(currentFrameProgress.reviewed / currentFrameProgress.total) * 100}%` }}
            />
          </div>
        )}

        {/* Stats */}
        <div className="flex items-center gap-3 mt-1.5 text-xs">
          <span className="text-green-400">✓ {progress.approved}</span>
          <span className="text-red-400">✗ {progress.rejected}</span>
          <span className="text-yellow-400">! {progress.flagged}</span>
          {progress.fnCount > 0 && (
            <span className="text-orange-400">🚩 {progress.fnCount} FN</span>
          )}
        </div>
      </div>

      {/* Controls */}
      <div className="flex-shrink-0 flex items-center justify-between px-3 py-2 border-b border-gray-700/50">
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-400">
          <input
            type="checkbox"
            checked={autoAdvance}
            onChange={(e) => setAutoAdvance(e.target.checked)}
            className="w-3 h-3 rounded"
          />
          Auto-next
        </label>

        <div className="flex items-center gap-2">
          {/* Approve all in current frame */}
          {currentFrameProgress.pending > 0 && (
            <button
              onClick={handleApproveCurrentFrame}
              className="px-2 py-1 bg-blue-600/40 hover:bg-blue-600 rounded text-xs text-blue-100 transition-colors"
              title="Approve all annotations in current frame"
            >
              ✓ Frame ({currentFrameProgress.pending})
            </button>
          )}

          {/* Approve all remaining */}
          {progress.total - progress.reviewed > 0 && (
            <button
              onClick={handleApproveAllRemaining}
              className="px-2 py-1 bg-green-600/40 hover:bg-green-600 rounded text-xs text-green-100 transition-colors"
              title="Approve all remaining annotations across all frames"
            >
              ✓ All ({progress.total - progress.reviewed})
            </button>
          )}
        </div>
      </div>

      {/* Annotation list - CURRENT FRAME ONLY */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {frameAnnotations.length === 0 && (!currentFrame || !falseNegativesByFrame.get(currentFrame.id)?.length) ? (
          <div className="text-center py-8 text-gray-400 text-sm">
            <p className="text-gray-500">No standalone annotations in this frame</p>
            {trackedAnnotationCount > 0 ? (
              <div className="mt-3 p-3 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                <p className="text-purple-300 font-medium">
                  📦 {uniqueTrackCount} track{uniqueTrackCount !== 1 ? 's' : ''} ({trackedAnnotationCount} annotations)
                </p>
                <p className="text-xs text-purple-400 mt-1">
                  Tracked annotations appear in the <span className="font-semibold">Tracks</span> tab above
                </p>
              </div>
            ) : (
              <p className="text-xs mt-1 text-gray-500">Tracked annotations appear in the Tracks tab</p>
            )}
          </div>
        ) : (
          <>
            {/* Show ONLY current frame annotations */}
            {(() => {
              if (!currentFrame) return null;

              const currentFNs = falseNegativesByFrame.get(currentFrame.id) || [];

              return (
                <div className="space-y-0.5">
                  {/* FN flags for current frame first */}
                  {currentFNs.length > 0 && (
                    <div className="mb-2">
                      <div className="text-[10px] text-orange-400 font-semibold uppercase mb-1 px-1">Missing Objects (FN)</div>
                      {currentFNs.map((suggestion) => {
                        const loc = suggestion.details?.location as { x: number; y: number; z: number } | undefined;
                        const suggestedClass = suggestion.details?.suggested_class as string | undefined;
                        const classDef = suggestedClass ? classLookup.get(suggestedClass) : null;

                        return (
                          <div
                            key={suggestion.id}
                            className="flex items-center gap-2 px-2 py-1.5 rounded bg-orange-500/10 border border-orange-500/30 mb-1"
                          >
                            <span className="w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold bg-orange-500/30 text-orange-400">
                              🚩
                            </span>
                            {classDef && (
                              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: classDef.color }} />
                            )}
                            <div className="flex-1 min-w-0">
                              <div className="text-xs text-orange-300 truncate">
                                {classDef?.name || suggestedClass || 'Missing Object'}
                              </div>
                              {loc && (
                                <div className="text-[10px] text-gray-500">
                                  @ ({loc.x.toFixed(1)}, {loc.y.toFixed(1)}, {loc.z.toFixed(1)})
                                </div>
                              )}
                            </div>
                            {/* Accept/Dismiss buttons for FN review */}
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleAcceptFN(suggestion.id); }}
                                className="p-1 rounded bg-green-600/30 hover:bg-green-600/60 text-green-100"
                                title="Accept - Annotator fixed this FN"
                              >
                                <CheckIcon />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleDismissFN(suggestion.id); }}
                                className="p-1 rounded bg-red-600/30 hover:bg-red-600/60 text-red-100"
                                title="Dismiss - False flag or not needed"
                              >
                                <XIcon />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Annotations for current frame */}
                  {frameAnnotations.map((ann, idx) => {
                    const isSelected = selectedAnnotationId === ann.id;
                    const classDef = classLookup.get(ann.class_id);
                    const className = classDef?.name || ann.class_id;
                    const classColor = classDef?.color || '#888';
                    const review = getAnnotationReview(ann.id);
                    const verdict = review?.verdict || 'pending';
                    const isPending = verdict === 'pending';

                    // Get AI issues for this annotation (deduplicated by type+message)
                    const rawIssues = annotationIssues.get(ann.id) || [];
                    const seenIssues = new Set<string>();
                    const annIssues = rawIssues.filter(issue => {
                      const key = `${issue.suggestion_type}:${issue.message || ''}`;
                      if (seenIssues.has(key)) return false;
                      seenIssues.add(key);
                      return true;
                    });
                    const uniqueIssueTypes = new Set(annIssues.map(i => i.suggestion_type));

                    // Get annotation data for inline properties
                    const data = ann.data as {
                      center?: { x: number; y: number; z: number };
                      position?: { x: number; y: number; z: number };
                      dimensions?: { length: number; width: number; height: number };
                      rotation?: { yaw: number; pitch?: number; roll?: number };
                    } | undefined;
                    const attributes = ann.attributes || {};
                    const positionData = data?.center || data?.position;

                    return (
                      <div key={ann.id} className="mb-1">
                        {/* Annotation Row */}
                        <div
                          ref={isSelected ? selectedItemRef : undefined}
                          onClick={() => handleSelectAnnotation(ann)}
                          className={`
                            flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all
                            ${isSelected
                              ? 'bg-blue-500/30 border border-blue-500 rounded-b-none'
                              : 'bg-gray-800/50 hover:bg-gray-800 border border-transparent'}
                          `}
                        >
                          {/* Index */}
                          <span className={`w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold ${
                            isSelected ? 'bg-blue-500 text-white' : 'bg-gray-700 text-gray-400'
                          }`}>
                            {idx + 1}
                          </span>

                          {/* Class info */}
                          <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: classColor }} />
                          <span className="flex-1 text-xs text-white truncate">{className}</span>

                          {/* Track indicator */}
                          {ann.track_id && (
                            <span className="text-[9px] text-purple-400 bg-purple-500/20 px-1 rounded">T</span>
                          )}

                          {/* AI Issues badge */}
                          {annIssues.length > 0 && (
                            <span
                              className="flex items-center gap-0.5 text-[9px] text-orange-400 bg-orange-500/20 px-1 rounded"
                              title={`${annIssues.length} AI-detected issue(s): ${[...uniqueIssueTypes].join(', ')}`}
                            >
                              <WarningIcon />
                              <span>{annIssues.length}</span>
                            </span>
                          )}

                          {/* Actions or verdict */}
                          {isPending ? (
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={(e) => { e.stopPropagation(); handleApprove(ann.id); }}
                                className={`p-1 rounded ${isSelected ? 'bg-green-600 hover:bg-green-500' : 'bg-green-600/30 hover:bg-green-600/60'} text-green-100`}
                                title="Approve (1)"
                              >
                                <CheckIcon />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleReject(ann.id); }}
                                className={`p-1 rounded ${isSelected ? 'bg-red-600 hover:bg-red-500' : 'bg-red-600/30 hover:bg-red-600/60'} text-red-100`}
                                title="Reject (2)"
                              >
                                <XIcon />
                              </button>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleFlag(ann.id); }}
                                className={`p-1 rounded ${isSelected ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-yellow-600/30 hover:bg-yellow-600/60'} text-yellow-100`}
                                title="Flag (3)"
                              >
                                <FlagIcon />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-0.5">
                              <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
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
                                    clearAnnotationReview(ann.id);
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

                        {/* Inline Properties Panel - shows when selected */}
                        {isSelected && (
                          <div className="bg-gray-900/80 border border-t-0 border-blue-500 rounded-b px-3 py-3 space-y-3">
                            {/* Position */}
                            {positionData && (
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-gray-500 uppercase w-14 font-medium">Pos</span>
                                <div className="flex gap-3 flex-1">
                                  <span className="text-sm text-cyan-400">X:<span className="text-white ml-1 font-medium">{positionData.x.toFixed(2)}</span></span>
                                  <span className="text-sm text-green-400">Y:<span className="text-white ml-1 font-medium">{positionData.y.toFixed(2)}</span></span>
                                  <span className="text-sm text-blue-400">Z:<span className="text-white ml-1 font-medium">{positionData.z.toFixed(2)}</span></span>
                                </div>
                              </div>
                            )}

                            {/* Dimensions */}
                            {data?.dimensions && (
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-gray-500 uppercase w-14 font-medium">Size</span>
                                <div className="flex gap-3 flex-1">
                                  <span className="text-sm text-gray-400">L:<span className="text-white ml-1 font-medium">{data.dimensions.length.toFixed(2)}</span></span>
                                  <span className="text-sm text-gray-400">W:<span className="text-white ml-1 font-medium">{data.dimensions.width.toFixed(2)}</span></span>
                                  <span className="text-sm text-gray-400">H:<span className="text-white ml-1 font-medium">{data.dimensions.height.toFixed(2)}</span></span>
                                </div>
                              </div>
                            )}

                            {/* Heading */}
                            {data?.rotation && (
                              <div className="flex items-center gap-3">
                                <span className="text-xs text-gray-500 uppercase w-14 font-medium">Yaw</span>
                                <span className="text-sm text-white font-medium">{((data.rotation.yaw || 0) * 180 / Math.PI).toFixed(1)}°</span>
                              </div>
                            )}

                            {/* AI Issues Section */}
                            {annIssues.length > 0 && (
                              <div className="border-t border-gray-700/50 pt-2 mt-2">
                                <div className="flex items-center gap-2 mb-2">
                                  <WarningIcon />
                                  <span className="text-xs text-orange-400 uppercase font-medium">
                                    AI Issues ({annIssues.length})
                                  </span>
                                </div>
                                <div className="space-y-1.5">
                                  {annIssues.map((issue, issueIdx) => (
                                    <div
                                      key={issue.id || issueIdx}
                                      className={`flex items-start gap-2 px-2 py-1.5 rounded text-xs ${
                                        issue.severity === 'critical' ? 'bg-red-500/20 border border-red-500/30' :
                                        issue.severity === 'high' ? 'bg-orange-500/20 border border-orange-500/30' :
                                        issue.severity === 'medium' ? 'bg-yellow-500/20 border border-yellow-500/30' :
                                        'bg-blue-500/20 border border-blue-500/30'
                                      }`}
                                    >
                                      <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                        issue.severity === 'critical' ? 'bg-red-600 text-white' :
                                        issue.severity === 'high' ? 'bg-orange-600 text-white' :
                                        issue.severity === 'medium' ? 'bg-yellow-600 text-black' :
                                        'bg-blue-600 text-white'
                                      }`}>
                                        {issue.severity?.toUpperCase() || 'INFO'}
                                      </span>
                                      <div className="flex-1 min-w-0">
                                        <div className="text-gray-300 font-medium truncate">
                                          {issue.suggestion_type.replace(/_/g, ' ')}
                                        </div>
                                        {issue.message && (
                                          <div className="text-gray-500 text-[11px] mt-0.5 line-clamp-2">
                                            {issue.message}
                                          </div>
                                        )}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Editable Attributes Form */}
                            {(() => {
                              const classAttrs = classDef?.attributes || {};
                              const storedAttrs = attributes || {};
                              const hasClassAttrs = Object.keys(classAttrs).length > 0;

                              if (!hasClassAttrs) return null;

                              return (
                                <div className="border-t border-gray-700/50 pt-2 mt-2">
                                  <span className="text-xs text-gray-500 uppercase block mb-2 font-medium">Attributes</span>
                                  <div className="space-y-2">
                                    {Object.entries(classAttrs).map(([key, def]) => {
                                      const attrDef = def as { type: string; options?: string[]; default?: unknown };
                                      const currentValue = storedAttrs[key] ?? attrDef.default;

                                      return (
                                        <div key={key} className="flex items-center justify-between gap-3">
                                          <label className="text-sm text-gray-400 flex-shrink-0">{key}</label>
                                          {attrDef.type === 'boolean' ? (
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                const newValue = !(currentValue as boolean ?? false);
                                                const newAttributes = { ...storedAttrs, [key]: newValue };
                                                handleUpdateAnnotationAttributes(ann.id, newAttributes);
                                              }}
                                              className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                                                currentValue ? 'bg-primary' : 'bg-gray-600'
                                              }`}
                                            >
                                              <span className={`absolute top-1 left-1 w-4 h-4 bg-white rounded-full transition-transform ${
                                                currentValue ? 'translate-x-4' : ''
                                              }`} />
                                            </button>
                                          ) : attrDef.type === 'enum' && attrDef.options ? (
                                            <select
                                              value={(currentValue as string) ?? ''}
                                              onClick={(e) => e.stopPropagation()}
                                              onChange={(e) => {
                                                const newAttributes = { ...storedAttrs, [key]: e.target.value };
                                                handleUpdateAnnotationAttributes(ann.id, newAttributes);
                                              }}
                                              className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
                                            >
                                              <option value="">--</option>
                                              {attrDef.options.map((opt) => (
                                                <option key={opt} value={opt}>{opt}</option>
                                              ))}
                                            </select>
                                          ) : (
                                            <input
                                              type={attrDef.type === 'number' ? 'number' : 'text'}
                                              value={(currentValue as string) ?? ''}
                                              onClick={(e) => e.stopPropagation()}
                                              onChange={(e) => {
                                                const value = attrDef.type === 'number' ? parseFloat(e.target.value) : e.target.value;
                                                const newAttributes = { ...storedAttrs, [key]: value };
                                                handleUpdateAnnotationAttributes(ann.id, newAttributes);
                                              }}
                                              className="flex-1 min-w-0 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white"
                                            />
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </>
        )}
      </div>

      {/* Keyboard hints */}
      <div className="flex-shrink-0 px-3 py-2 border-t border-gray-700/50 bg-gray-800/30">
        <div className="text-xs text-gray-600 flex gap-3">
          <span><kbd className="px-1 bg-gray-700 rounded">↑↓</kbd> nav</span>
          <span><kbd className="px-1 bg-gray-700 rounded">1</kbd> ✓</span>
          <span><kbd className="px-1 bg-gray-700 rounded">2</kbd> ✗</span>
          <span><kbd className="px-1 bg-gray-700 rounded">3</kbd> !</span>
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

export default FrameAnnotationsTab;

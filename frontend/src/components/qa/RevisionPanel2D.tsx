import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { qaApi, workflowApi } from '@/api/client';
import type { AnnotationReview, QAReview, ReviewVerdict, QASuggestion } from '@/types';
import type { Annotation2D } from '@/store/annotation2DStore';
import { useEditorStore } from '@/store/editorStore';
import { useAnnotation4DStore } from '@/store/annotation4DStore';

const CheckIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const XIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const FlagIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
  </svg>
);

const ISSUE_TYPES_MAP: Record<string, { label: string; icon: string }> = {
  'box_too_loose': { label: 'Box too loose', icon: '📦' },
  'box_too_tight': { label: 'Box too tight', icon: '🔲' },
  'wrong_class': { label: 'Wrong class', icon: '🏷️' },
  'boundary_mismatch': { label: 'Boundary mismatch', icon: '🖼️' },
  'missing_object': { label: 'Missing object', icon: '🔍' },
  'duplicate_annotation': { label: 'Duplicate', icon: '📋' },
  'tracking_error': { label: 'Tracking error', icon: '🔗' },
  'wrong_attributes': { label: 'Wrong attributes', icon: '📝' },
  'position_incorrect': { label: 'Position incorrect', icon: '📍' },
  'size_incorrect': { label: 'Size incorrect', icon: '📐' },
  'occlusion_wrong': { label: 'Occlusion wrong', icon: '👁️' },
  'other': { label: 'Other', icon: '❓' },
};

interface TaxonomyClass {
  id: string;
  name: string;
  color?: string;
}

interface RevisionPanel2DProps {
  taskId: string;
  cameraId: string;
  annotations: Annotation2D[] | Map<string, Annotation2D>;
  frameId: string;
  frameIds: string[];
  taxonomy?: {
    classes: TaxonomyClass[];
  };
  taxonomyId?: string;
  onZoomToAnnotation: (annotationId: string, zoom?: number) => void;
  onSelectAnnotation: (annotationId: string) => void;
  onGoToFrame: (frameIndexOrId: number | string) => void;
  currentFrameIndex?: number;
  onSubmitFixes?: () => void;
}

type FilterType = 'all' | 'rejected' | 'flagged' | 'approved' | 'missing';

export const RevisionPanel2D: React.FC<RevisionPanel2DProps> = ({
  taskId,
  cameraId,
  annotations: annotationsProp,
  frameId: _frameId,
  frameIds,
  taxonomy,
  taxonomyId,
  onZoomToAnnotation,
  onSelectAnnotation,
  onGoToFrame,
  currentFrameIndex = 0,
  onSubmitFixes,
}) => {
  const annotationsMap = useMemo(() => {
    if (annotationsProp instanceof Map) return annotationsProp;
    const map = new Map<string, Annotation2D>();
    annotationsProp.forEach(ann => map.set(ann.id, ann));
    return map;
  }, [annotationsProp]);

  const [reviews, setReviews] = useState<AnnotationReview[]>([]);
  const [falseNegatives, setFalseNegatives] = useState<QASuggestion[]>([]);
  const [qaReview, setQaReview] = useState<QAReview | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<FilterType>('all');
  const [expandedReviewId, setExpandedReviewId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const selectedItemRef = useRef<HTMLDivElement>(null);

  const findClass = useCallback((classId: string | undefined) => {
    if (!classId || !taxonomy) return null;
    return taxonomy.classes.find(c => c.id === classId);
  }, [taxonomy]);

  useEffect(() => {
    const loadReviews = async () => {
      if (!taskId) return;

      setIsLoading(true);
      try {
        const taskReviews = await qaApi.getTaskReviews(taskId, 'completed');
        console.log('[RevisionPanel2D] Task reviews found:', taskReviews.length);

        if (taskReviews.length > 0) {
          const latestReview = taskReviews[0];
          console.log('[RevisionPanel2D] Using QA review:', latestReview.id, 'status:', latestReview.status);
          setQaReview(latestReview);

          const annotationReviews = await qaApi.getAnnotationReviews(latestReview.id);
          console.log('[RevisionPanel2D] Annotation reviews loaded:', annotationReviews.length);

          annotationReviews.slice(0, 3).forEach(r => {
            console.log('[RevisionPanel2D] Review:', {
              id: r.id,
              annotation_id: r.annotation_id,
              annotation_table: r.annotation_table,
              verdict: r.verdict,
              frame_id: r.frame_id
            });
          });

          setReviews(annotationReviews);
        } else {
          console.log('[RevisionPanel2D] No completed QA reviews found for task');
        }

        const suggestions = await qaApi.getTaskSuggestions(taskId);
        const fns = suggestions.filter(s => s.suggestion_type === 'false_negative' && !s.is_dismissed);
        console.log('[RevisionPanel2D] FN suggestions:', fns.length);
        setFalseNegatives(fns);
      } catch (error) {
        console.error('Failed to load QA reviews:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadReviews();
  }, [taskId]);

  const cameraAnnotationIds = useMemo(() => {
    return new Set(Array.from(annotationsMap.keys()));
  }, [annotationsMap]);

  const cameraReviews = useMemo(() => {
    console.log('[RevisionPanel2D] Filtering reviews for camera:', cameraId);
    console.log('[RevisionPanel2D] Total reviews loaded:', reviews.length);
    console.log('[RevisionPanel2D] Camera annotation IDs sample:', Array.from(cameraAnnotationIds).slice(0, 3));

    const reviews2D = reviews.filter(r => r.annotation_table === 'annotations_2d');
    console.log('[RevisionPanel2D] 2D reviews (annotations_2d table):', reviews2D.length);

    if (reviews2D.length > 0) {
      console.log('[RevisionPanel2D] Sample 2D review annotation_ids:', reviews2D.slice(0, 3).map(r => ({
        annotation_id: r.annotation_id,
        annotation_table: r.annotation_table,
        verdict: r.verdict
      })));
    }

    const filtered = reviews2D.filter(r => {
      if (r.verdict === 'rejected' || r.verdict === 'flagged') {
        return true;
      }
      return cameraAnnotationIds.has(r.annotation_id);
    });

    console.log('[RevisionPanel2D] Filtered camera reviews:', filtered.length);

    console.log('[RevisionPanel2D] Reviews by verdict:', {
      rejected: filtered.filter(r => r.verdict === 'rejected').length,
      flagged: filtered.filter(r => r.verdict === 'flagged').length,
      approved: filtered.filter(r => r.verdict === 'approved').length
    });

    return filtered;
  }, [reviews, cameraAnnotationIds, cameraId]);

  const cameraFalseNegatives = useMemo(() => {
    return falseNegatives.filter(fn => {
      const details = fn.details as { camera_id?: string; cameraId?: string } | undefined;
      return details?.camera_id === cameraId || details?.cameraId === cameraId;
    });
  }, [falseNegatives, cameraId]);

  const groupedReviews = useMemo(() => {
    const rejected: AnnotationReview[] = [];
    const flagged: AnnotationReview[] = [];
    const approved: AnnotationReview[] = [];

    cameraReviews.forEach(review => {
      if (review.verdict === 'rejected') rejected.push(review);
      else if (review.verdict === 'flagged') flagged.push(review);
      else if (review.verdict === 'approved') approved.push(review);
    });

    const sortByFrame = (a: AnnotationReview, b: AnnotationReview) => {
      const aFrameIdx = a.frame_id ? frameIds.indexOf(a.frame_id) : -1;
      const bFrameIdx = b.frame_id ? frameIds.indexOf(b.frame_id) : -1;
      return aFrameIdx - bFrameIdx;
    };

    rejected.sort(sortByFrame);
    flagged.sort(sortByFrame);
    approved.sort(sortByFrame);

    console.log('[RevisionPanel2D] Grouped reviews - rejected:', rejected.length, 'flagged:', flagged.length, 'approved:', approved.length);

    return { rejected, flagged, approved };
  }, [cameraReviews, frameIds]);

  const filteredReviews = useMemo(() => {
    switch (filter) {
      case 'rejected':
        return groupedReviews.rejected;
      case 'flagged':
        return groupedReviews.flagged;
      case 'approved':
        return groupedReviews.approved;
      default:
        return [
          ...groupedReviews.rejected,
          ...groupedReviews.flagged,
        ];
    }
  }, [filter, groupedReviews]);

  const handleNavigateToReview = useCallback((review: AnnotationReview) => {
    const annotationExists = cameraAnnotationIds.has(review.annotation_id);

    if (review.frame_id) {
      const frameIdx = frameIds.indexOf(review.frame_id);
      if (frameIdx >= 0 && frameIdx !== currentFrameIndex) {
        onGoToFrame(frameIdx);
        if (annotationExists) {
          setTimeout(() => {
            onSelectAnnotation(review.annotation_id);
            onZoomToAnnotation(review.annotation_id);
          }, 100);
        }
        return;
      }
    }

    if (annotationExists) {
      onSelectAnnotation(review.annotation_id);
      onZoomToAnnotation(review.annotation_id);
    }
  }, [frameIds, currentFrameIndex, onGoToFrame, onSelectAnnotation, onZoomToAnnotation, cameraAnnotationIds]);

  const getVerdictStyle = (verdict: ReviewVerdict | undefined) => {
    switch (verdict) {
      case 'rejected':
        return { bg: 'bg-red-500/20', text: 'text-red-400', icon: XIcon, label: 'Rejected' };
      case 'flagged':
        return { bg: 'bg-yellow-500/20', text: 'text-yellow-400', icon: FlagIcon, label: 'Flagged' };
      case 'approved':
        return { bg: 'bg-green-500/20', text: 'text-green-400', icon: CheckIcon, label: 'Approved' };
      default:
        return { bg: 'bg-gray-700', text: 'text-gray-400', icon: CheckIcon, label: 'Pending' };
    }
  };

  const stats = useMemo(() => ({
    total: groupedReviews.rejected.length + groupedReviews.flagged.length + cameraFalseNegatives.length,
    rejected: groupedReviews.rejected.length,
    flagged: groupedReviews.flagged.length,
    approved: groupedReviews.approved.length,
    missing: cameraFalseNegatives.length,
  }), [groupedReviews, cameraFalseNegatives.length]);

  const handleSubmitFixes = useCallback(async () => {
    if (!taskId) return;

    setIsSubmitting(true);
    try {
      const editorState = useEditorStore.getState();
      const annotation4DState = useAnnotation4DStore.getState();

      const errors: string[] = [];

      if (editorState.hasUnsavedChanges()) {
        const result3D = await editorState.saveAnnotations();
        if (!result3D.success) {
          errors.push(result3D.error || 'Failed to save annotations');
        }
      }

      const has4DChanges = Array.from(annotation4DState.annotations4D.values()).some(
        (a) => a.is_new || a.is_dirty || a.is_deleted
      );
      if (has4DChanges) {
        const result4D = await annotation4DState.saveAnnotations4D();
        if (!result4D.success) {
          errors.push(`4D: ${result4D.error || 'Unknown error'}`);
        }
      }

      // If any save failed, show error and don't proceed with submission
      if (errors.length > 0) {
        const errorMsg = `Failed to save annotations: ${errors.join('; ')}`;
        console.error(errorMsg);
        alert(errorMsg);
        return;
      }

      // Now submit the fixes (workflow transition)
      await workflowApi.submitFixes(taskId, taxonomyId);
      setShowSubmitConfirm(false);
      // Callback to parent for handling navigation/refresh
      onSubmitFixes?.();
    } catch (error: any) {
      console.error('Failed to submit fixes:', error);
      const errorMessage = error?.response?.data?.detail || error?.message || 'Unknown error';
      alert(`Failed to submit fixes: ${errorMessage}`);
    } finally {
      setIsSubmitting(false);
    }
  }, [taskId, taxonomyId, onSubmitFixes]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (cameraReviews.length === 0 && cameraFalseNegatives.length === 0) {
    return (
      <div className="text-center py-8 text-gray-400 text-sm">
        <svg className="w-8 h-8 mx-auto mb-2 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <p className="text-[11px]">No QA feedback for this camera</p>
        <p className="text-[10px] text-gray-500">QA reviews will appear here after review</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with QA reviewer info */}
      {qaReview && (
        <div className="px-2 py-1.5 border-b border-gray-700 bg-gray-800/50">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-gray-300">
              QA by <span className="text-gray-100">{qaReview.reviewer_name || 'Reviewer'}</span>
            </span>
            <span className="text-[9px] text-gray-400">
              {new Date(qaReview.completed_at || qaReview.updated_at).toLocaleDateString()}
            </span>
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="px-2 py-1.5 border-b border-gray-700 bg-gray-900/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-[10px]">
            <span className="text-red-400">✗ {stats.rejected}</span>
            <span className="text-yellow-400">⚑ {stats.flagged}</span>
            <span className="text-orange-400">🔍 {stats.missing}</span>
            <span className="text-green-400">✓ {stats.approved}</span>
          </div>
          <span className="text-[10px] text-gray-400">{stats.total} items</span>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex border-b border-gray-700 bg-gray-900/20">
        {(['all', 'rejected', 'flagged', 'missing', 'approved'] as FilterType[]).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex-1 px-1 py-1.5 text-[10px] font-medium transition-colors ${
              filter === f
                ? 'text-gray-100 border-b-2 border-primary bg-gray-800/40'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {f === 'all' ? 'All' : f === 'rejected' ? '✗ Fix' : f === 'flagged' ? '⚑ Flag' : f === 'missing' ? '🔍 FN' : '✓ OK'}
          </button>
        ))}
      </div>

      {/* Reviews list */}
      <div className="flex-1 overflow-y-auto">
        {filteredReviews.length === 0 && (filter !== 'missing' || cameraFalseNegatives.length === 0) ? (
          <div className="text-center py-6 text-gray-400 text-[11px]">
            No {filter !== 'all' ? filter : ''} items
          </div>
        ) : (
          <div className="p-1.5 space-y-1">
            {/* False Negatives Section - shown in 'all' or 'missing' filter */}
            {(filter === 'all' || filter === 'missing') && cameraFalseNegatives.length > 0 && (
              <>
                {filter === 'all' && (
                  <div className="text-[9px] text-orange-400 font-medium px-1 pt-1 pb-0.5">
                    🔍 Missing Objects ({cameraFalseNegatives.length})
                  </div>
                )}
                {cameraFalseNegatives.map((fn) => {
                  const frameIdx = fn.frame_id ? frameIds.indexOf(fn.frame_id) : -1;
                  // Extract location and suggested_class from details
                  const details = fn.details as { location?: { x: number; y: number; z?: number }; suggested_class?: string } | undefined;
                  const location = details?.location;
                  const suggestedClass = details?.suggested_class;
                  const classInfo = suggestedClass ? findClass(suggestedClass) : null;
                  const isExpanded = expandedReviewId === `fn-${fn.id}`;

                  return (
                    <div
                      key={`fn-${fn.id}`}
                      className="rounded-md border bg-orange-500/20 border-gray-700/50 transition-all"
                    >
                      {/* Main row */}
                      <div
                        onClick={() => {
                          if (frameIdx >= 0 && frameIdx !== currentFrameIndex) {
                            onGoToFrame(frameIdx);
                          }
                        }}
                        className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-white/5"
                      >
                        {/* Expand toggle */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedReviewId(isExpanded ? null : `fn-${fn.id}`);
                          }}
                          className="p-0 text-gray-400 hover:text-gray-100 flex-shrink-0"
                        >
                          <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>

                        {/* FN icon */}
                        <div className="p-0.5 rounded bg-orange-500/20">
                          <span className="text-[10px]">🔍</span>
                        </div>

                        {/* Class & Frame info */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1">
                            {classInfo && (
                              <div
                                className="w-2 h-2 rounded-sm flex-shrink-0"
                                style={{ backgroundColor: classInfo.color || '#6b7280' }}
                              />
                            )}
                            <span className="text-[10px] text-white truncate">
                              {classInfo?.name || suggestedClass || 'Missing Object'}
                            </span>
                            {frameIdx >= 0 && (
                              <span className="text-[9px] px-1 rounded bg-gray-700/50 text-gray-400">
                                F{frameIdx + 1}
                              </span>
                            )}
                          </div>
                        </div>

                        {/* Location indicator */}
                        {location && (
                          <span className="text-[9px] text-orange-400" title={`Location: (${location.x?.toFixed(0)}, ${location.y?.toFixed(0)})`}>
                            📍
                          </span>
                        )}
                      </div>

                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="px-2 pb-2 pt-0.5 border-t border-gray-700/30">
                          {fn.message && (
                            <div className="text-[10px] text-gray-400 bg-gray-800/50 rounded p-1.5 mb-1">
                              {fn.message}
                            </div>
                          )}
                          {location && (
                            <div className="text-[9px] text-gray-400">
                              Location: ({location.x?.toFixed(0)}, {location.y?.toFixed(0)})
                            </div>
                          )}
                          <div className="text-[9px] text-gray-400 mt-1">
                            Created: {new Date(fn.created_at).toLocaleString()}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* Regular annotation reviews */}
            {filter !== 'missing' && filteredReviews.map((review) => {
              const ann = annotationsMap.get(review.annotation_id);
              const annotationMissing = !ann;
              const classInfo = findClass(review.class_id || ann?.classId);
              const frameIdx = review.frame_id ? frameIds.indexOf(review.frame_id) : -1;
              const style = getVerdictStyle(review.verdict);
              const isExpanded = expandedReviewId === review.id;

              return (
                <div
                  key={review.id}
                  ref={isExpanded ? selectedItemRef : undefined}
                  className={`rounded-md border ${style.bg} border-gray-700/50 transition-all ${annotationMissing ? 'opacity-60' : ''}`}
                >
                  {/* Main row - clickable */}
                  <div
                    onClick={() => handleNavigateToReview(review)}
                    className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-white/5"
                  >
                    {/* Expand toggle */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedReviewId(isExpanded ? null : review.id);
                      }}
                      className="p-0 text-gray-400 hover:text-gray-100 flex-shrink-0"
                    >
                      <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>

                    {/* Verdict icon */}
                    <div className={`p-0.5 rounded ${style.bg}`}>
                      <style.icon className={`w-3 h-3 ${style.text}`} />
                    </div>

                    {/* Class & Frame info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        {classInfo && (
                          <div
                            className="w-2 h-2 rounded-sm flex-shrink-0"
                            style={{ backgroundColor: classInfo.color || '#6b7280' }}
                          />
                        )}
                        <span className={`text-[10px] truncate ${annotationMissing ? 'text-gray-400 line-through' : 'text-white'}`}>
                          {classInfo?.name || 'Unknown'}
                        </span>
                        {annotationMissing && (
                          <span className="text-[8px] px-1 rounded bg-gray-700 text-gray-400" title="Annotation was deleted">
                            deleted
                          </span>
                        )}
                        {frameIdx >= 0 && (
                          <span className="text-[9px] px-1 rounded bg-gray-700/50 text-gray-400">
                            F{frameIdx + 1}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Go to button */}
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleNavigateToReview(review);
                      }}
                      className="p-0.5 rounded hover:bg-white/10 text-gray-400 hover:text-white flex-shrink-0"
                      title="Go to annotation"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    </button>
                  </div>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="px-2 pb-2 pt-0.5 border-t border-gray-700/30">
                      {/* Issue types */}
                      {review.issue_types && review.issue_types.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1.5">
                          {review.issue_types.map(issueId => {
                            const issue = ISSUE_TYPES_MAP[issueId];
                            return (
                              <span
                                key={issueId}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-gray-700/50 text-[9px] text-gray-300"
                              >
                                {issue?.icon || '❓'} {issue?.label || issueId}
                              </span>
                            );
                          })}
                        </div>
                      )}

                      {/* Notes */}
                      {review.notes && (
                        <div className="text-[10px] text-gray-400 bg-gray-800/50 rounded p-1.5">
                          <span className="text-gray-400 font-medium">Note: </span>
                          {review.notes}
                        </div>
                      )}

                      {/* Timestamp */}
                      <div className="text-[9px] text-gray-400 mt-1">
                        Reviewed: {new Date(review.reviewed_at || review.created_at).toLocaleString()}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Submit Fixes Button */}
      <div className="px-2 py-2 border-t border-gray-700 bg-gray-800/50 mt-auto">
        <button
          onClick={() => setShowSubmitConfirm(true)}
          disabled={isSubmitting}
          className="w-full px-3 py-2 bg-primary hover:bg-primary/90 disabled:bg-gray-600 text-white text-[11px] font-medium rounded-md flex items-center justify-center gap-2 transition-colors"
        >
          {isSubmitting ? (
            <>
              <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
              Submitting...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Submit Fixes for QA Review
            </>
          )}
        </button>
        <p className="text-[9px] text-gray-400 text-center mt-1">
          {stats.rejected + stats.flagged > 0
            ? `${stats.rejected + stats.flagged} issue(s) to address`
            : 'All issues addressed'}
        </p>
      </div>

      {/* Confirmation Modal */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-gray-800 rounded-lg p-4 max-w-sm mx-4 shadow-xl border border-gray-700">
            <h3 className="text-white font-medium mb-2">Submit Fixes for QA?</h3>
            <p className="text-gray-400 text-sm mb-4">
              This will send the task back to QA for re-review.
              The QA reviewer will see all modified annotations and any issues you've addressed.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowSubmitConfirm(false)}
                className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmitFixes}
                disabled={isSubmitting}
                className="flex-1 px-3 py-2 bg-primary hover:bg-primary/90 disabled:bg-gray-600 text-white text-sm rounded-md transition-colors"
              >
                {isSubmitting ? 'Submitting...' : 'Submit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default RevisionPanel2D;

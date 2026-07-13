import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { qaApi, workflowApi, annotation3DApi } from '@/api/client';
import { useEditorStore } from '@/store/editorStore';
import type { AnnotationReview, AnnotationComment, QASuggestion, Annotation, TaxonomyConfig } from '@/types';

const ISSUE_LABELS: Record<string, string> = {
  box_too_loose: 'Box too loose',
  box_too_tight: 'Box too tight',
  wrong_class: 'Wrong class',
  wrong_orientation: 'Wrong orientation',
  tracking_error: 'Tracking error',
  position_incorrect: 'Position incorrect',
  size_incorrect: 'Size incorrect',
  occlusion_wrong: 'Occlusion wrong',
  missing_attributes: 'Missing attributes',
  other: 'Other issue',
};


const VerdictBadge: React.FC<{ verdict: string }> = ({ verdict }) => {
  const styles: Record<string, string> = {
    approved: 'bg-green-500/20 text-green-400 border-green-500/30',
    rejected: 'bg-red-500/20 text-red-400 border-red-500/30',
    flagged: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    pending: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase ${styles[verdict] || styles.pending}`}>
      {verdict}
    </span>
  );
};

const IssuePill: React.FC<{ issue: string }> = ({ issue }) => (
  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-300 border border-red-500/20">
    {ISSUE_LABELS[issue] || issue}
  </span>
);

// ============================================================================
// Annotation Review Item
// ============================================================================

interface ReviewItemProps {
  review: AnnotationReview;
  comments: AnnotationComment[];
  className?: string;
  annotationClassName?: string;
  frameLabel?: string;
  frameId?: string;
  annotation?: Annotation;
  taxonomy?: TaxonomyConfig | null;
  onJumpTo: (annotationId: string, frameId?: string) => void;
  onMarkFixed?: (annotationId: string, fixed: boolean) => void;
  onUpdateAttributes?: (annotationId: string, attributes: Record<string, unknown>) => Promise<void>;
  isMarkedFixed?: boolean;
}

const ReviewItem: React.FC<ReviewItemProps> = ({
  review,
  comments,
  annotationClassName,
  frameLabel,
  frameId,
  annotation,
  taxonomy,
  onJumpTo,
  onMarkFixed,
  onUpdateAttributes,
  isMarkedFixed = false,
}) => {
  const [expanded, setExpanded] = useState(review.verdict === 'rejected' || review.verdict === 'flagged');

  // Extract frame number from label like "F11" -> "11"
  const frameNumber = frameLabel ? frameLabel.replace('F', '') : null;

  // Get annotation data for display
  const annotationData = annotation?.data as {
    center?: { x: number; y: number; z: number };
    position?: { x: number; y: number; z: number };
    dimensions?: { length: number; width: number; height: number };
    rotation?: { yaw: number; pitch?: number; roll?: number };
  } | undefined;
  const center = annotationData?.center || annotationData?.position;
  const dims = annotationData?.dimensions;
  const rotation = annotationData?.rotation;

  // Get class definition for attributes
  const classDef = taxonomy?.classes?.find(c => c.id === annotation?.class_id);
  const attributeEntries = classDef?.attributes ? Object.entries(classDef.attributes) : [];
  const storedAttributes = (annotation?.attributes || {}) as Record<string, unknown>;

  // Handle attribute change
  const handleAttributeChange = (attrName: string, value: unknown) => {
    if (!annotation || !onUpdateAttributes) return;
    const newAttributes = { ...storedAttributes, [attrName]: value };
    onUpdateAttributes(annotation.id, newAttributes);
  };

  return (
    <div className={`border rounded-lg overflow-hidden ${
      isMarkedFixed ? 'border-green-500/50 bg-green-500/10' :
      review.verdict === 'rejected' ? 'border-red-500/30 bg-red-500/5' :
      review.verdict === 'flagged' ? 'border-yellow-500/30 bg-yellow-500/5' :
      review.verdict === 'approved' ? 'border-green-500/30 bg-green-500/5' :
      'border-gray-700 bg-dark-hover/50'
    }`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-white/5 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {isMarkedFixed ? (
            <span className="text-[10px] px-1.5 py-0.5 rounded border font-medium uppercase bg-green-500/20 text-green-400 border-green-500/30">
              ✓ FIXED
            </span>
          ) : (
            <VerdictBadge verdict={review.verdict || 'pending'} />
          )}
          <span className="text-xs text-gray-300 truncate">
            {annotationClassName || 'Unknown'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0 ml-2">
          {frameLabel && (
            <span className="text-[10px] text-gray-500 font-mono">{frameLabel}</span>
          )}
          {comments.length > 0 && (
            <span className="text-[10px] text-blue-400 flex items-center gap-0.5">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {comments.length}
            </span>
          )}
          <svg className={`w-3.5 h-3.5 text-gray-500 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-gray-700/50 space-y-2">
          {/* Issue types */}
          {review.issue_types && review.issue_types.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {review.issue_types.map(issue => (
                <IssuePill key={issue} issue={issue} />
              ))}
            </div>
          )}

          {/* Reviewer notes */}
          {review.notes && (
            <div className="mt-2 p-2 bg-dark/50 rounded text-xs text-gray-300 italic">
              "{review.notes}"
            </div>
          )}

          {/* Comments */}
          {comments.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <span className="text-[10px] text-gray-500 font-semibold uppercase">Comments</span>
              {comments.map(comment => (
                <div key={comment.id} className="p-2 bg-blue-500/5 border border-blue-500/20 rounded text-xs">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-blue-400 font-medium">{comment.user_name || 'Reviewer'}</span>
                    <span className="text-gray-600 text-[10px]">
                      {new Date(comment.created_at).toLocaleDateString()}
                    </span>
                    {comment.is_resolved && (
                      <span className="text-[10px] text-green-400">✓ Resolved</span>
                    )}
                  </div>
                  <p className="text-gray-300">{comment.content}</p>
                  {/* Replies */}
                  {comment.replies?.length > 0 && (
                    <div className="ml-3 mt-1.5 space-y-1 border-l border-gray-700 pl-2">
                      {comment.replies.map(reply => (
                        <div key={reply.id} className="text-xs">
                          <span className="text-blue-400 font-medium">{reply.user_name || 'Reviewer'}: </span>
                          <span className="text-gray-400">{reply.content}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Properties and Attributes - for editing */}
          {annotation && (
            <div className="mt-2 p-2 bg-gray-800/50 rounded space-y-2">
              {/* Position */}
              {center && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500 w-10">POS</span>
                  <span className="text-purple-400">X</span>
                  <span className="text-white">{center.x.toFixed(2)}</span>
                  <span className="text-purple-400 ml-2">Y</span>
                  <span className="text-white">{center.y.toFixed(2)}</span>
                  <span className="text-purple-400 ml-2">Z</span>
                  <span className="text-white">{center.z.toFixed(2)}</span>
                </div>
              )}
              {/* Dimensions */}
              {dims && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500 w-10">SIZE</span>
                  <span className="text-purple-400">L</span>
                  <span className="text-white">{dims.length.toFixed(2)}</span>
                  <span className="text-purple-400 ml-2">W</span>
                  <span className="text-white">{dims.width.toFixed(2)}</span>
                  <span className="text-purple-400 ml-2">H</span>
                  <span className="text-white">{dims.height.toFixed(2)}</span>
                </div>
              )}
              {/* Rotation */}
              {rotation && (
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-gray-500 w-10">YAW</span>
                  <span className="text-white">{((rotation.yaw || 0) * 180 / Math.PI).toFixed(1)}°</span>
                </div>
              )}

              {/* Attributes - Editable */}
              {attributeEntries.length > 0 && (
                <div className="mt-2 pt-2 border-t border-gray-700">
                  <span className="text-[10px] text-gray-500 font-semibold uppercase">Attributes</span>
                  <div className="mt-1 space-y-1.5">
                    {attributeEntries.map(([attrName, attr]) => {
                      const currentValue = storedAttributes[attrName];
                      return (
                        <div key={attrName} className="flex items-center justify-between gap-2 text-xs">
                          <span className="text-gray-400">{attrName}</span>
                          {attr.type === 'boolean' ? (
                            <button
                              onClick={() => handleAttributeChange(attrName, !currentValue)}
                              className={`w-8 h-4 rounded-full transition-colors ${currentValue ? 'bg-green-500' : 'bg-gray-600'}`}
                            >
                              <div className={`w-3 h-3 rounded-full bg-white transform transition-transform ${currentValue ? 'translate-x-4' : 'translate-x-0.5'}`} />
                            </button>
                          ) : attr.type === 'enum' && attr.options ? (
                            <select
                              value={(currentValue as string) || ''}
                              onChange={(e) => handleAttributeChange(attrName, e.target.value)}
                              className="bg-gray-700 text-white px-2 py-0.5 rounded text-xs border border-gray-600"
                            >
                              <option value="">--</option>
                              {attr.options.map(opt => (
                                <option key={opt} value={opt}>{opt}</option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={(currentValue as string) || ''}
                              onChange={(e) => handleAttributeChange(attrName, e.target.value)}
                              className="bg-gray-700 text-white px-2 py-0.5 rounded text-xs border border-gray-600 w-24"
                              placeholder="--"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Action buttons */}
          <div className="mt-2 flex gap-2">
            {/* Jump to annotation button */}
            <button
              onClick={() => onJumpTo(review.annotation_id, frameId)}
              className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded bg-primary/20 text-primary text-xs hover:bg-primary/30 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
              </svg>
              {frameNumber ? `Go to Frame ${frameNumber}` : 'Go to frame'}
            </button>

            {/* Mark as Fixed button (for annotators) */}
            {onMarkFixed && (
              <button
                onClick={() => onMarkFixed(review.annotation_id, !isMarkedFixed)}
                className={`px-3 py-1.5 rounded text-xs transition-colors flex items-center gap-1 ${
                  isMarkedFixed
                    ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                    : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600/50'
                }`}
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {isMarkedFixed ? 'Fixed' : 'Mark Fixed'}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// ============================================================================
// Suggestion Item (FN flags, AI issues)
// ============================================================================

interface SuggestionItemProps {
  suggestion: QASuggestion;
  frameLabel?: string;
  onJumpToFrame?: (frameId: string) => void;
  onJumpToAnnotation?: (annotationId: string, frameId?: string) => void;
  onMarkFixed?: (suggestionId: string, fixed: boolean) => void;
  isMarkedFixed?: boolean;
}

const SuggestionItem: React.FC<SuggestionItemProps> = ({ suggestion, frameLabel, onJumpToFrame, onJumpToAnnotation, onMarkFixed, isMarkedFixed = false }) => {
  const severityColors: Record<string, string> = {
    critical: 'text-red-400 bg-red-500/10 border-red-500/30',
    high: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
    medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
    low: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  };

  const typeLabels: Record<string, string> = {
    false_negative: '🔍 Missing Object',
    size_anomaly: 'Size anomaly',
    position_jump: 'Position jump',
    orientation_flip: 'Orientation flip',
    track_discontinuity: 'Track break',
    wrong_class: 'Wrong class',
    overlapping_cuboids: 'Overlapping boxes',
    ground_plane_misalignment: 'Ground alignment',
    track_dimension_inconsistency: 'Track size inconsistency',
  };

  return (
    <div className={`p-2.5 rounded-lg border ${isMarkedFixed ? 'border-green-500/50 bg-green-500/10' : severityColors[suggestion.severity] || severityColors.medium}`}>
      <div className="flex items-center justify-between mb-1">
        <span className={`text-xs font-medium ${isMarkedFixed ? 'text-green-400 line-through' : ''}`}>
          {isMarkedFixed ? '✓ ' : ''}{typeLabels[suggestion.suggestion_type] || suggestion.suggestion_type}
        </span>
        <div className="flex items-center gap-1.5">
          {frameLabel && (
            <span className="text-[10px] text-gray-500 font-mono">{frameLabel}</span>
          )}
          <span className="text-[10px] uppercase font-semibold opacity-70">
            {suggestion.severity}
          </span>
        </div>
      </div>
      <p className="text-xs text-gray-300">{suggestion.message}</p>
      {!!suggestion.details?.location && (
        <div className="mt-1 text-[10px] text-gray-500 font-mono">
          Location: ({(suggestion.details.location as { x: number; y: number; z: number }).x.toFixed(1)},
          {(suggestion.details.location as { x: number; y: number; z: number }).y.toFixed(1)},
          {(suggestion.details.location as { x: number; y: number; z: number }).z.toFixed(1)})
        </div>
      )}
      {suggestion.annotation_id && onJumpToAnnotation ? (
        <button
          onClick={() => onJumpToAnnotation(suggestion.annotation_id!, suggestion.frame_id)}
          className="mt-1.5 w-full flex items-center justify-center gap-1 py-1 rounded bg-white/5 text-gray-400 text-[10px] hover:bg-white/10 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
          </svg>
          Go to {frameLabel || 'frame'} & select
        </button>
      ) : suggestion.frame_id && onJumpToFrame ? (
        <button
          onClick={() => onJumpToFrame(suggestion.frame_id!)}
          className="mt-1.5 w-full flex items-center justify-center gap-1 py-1 rounded bg-white/5 text-gray-400 text-[10px] hover:bg-white/10 transition-colors"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
          </svg>
          Go to Frame {frameLabel ? frameLabel.replace('F', '') : '?'}
        </button>
      ) : null}

      {/* Mark as Fixed button for FNs */}
      {onMarkFixed && (
        <button
          onClick={() => onMarkFixed(suggestion.id, !isMarkedFixed)}
          className={`mt-1.5 w-full flex items-center justify-center gap-1 py-1.5 rounded text-xs transition-colors ${
            isMarkedFixed
              ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
              : 'bg-gray-700/50 text-gray-400 hover:bg-gray-600/50'
          }`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          {isMarkedFixed ? 'Done' : 'Mark as Done'}
        </button>
      )}
    </div>
  );
};

// ============================================================================
// Main QA Feedback Panel
// ============================================================================

interface QAFeedbackPanelProps {
  taskId: string;
  task: {
    stage: string;
    status: string;
    revision_count: number;
    review_notes?: string;
    reviewer_id?: string;
  };
  onJumpToAnnotation: (annotationId: string, frameId?: string) => void;
}

export const QAFeedbackPanel: React.FC<QAFeedbackPanelProps> = ({ taskId, task, onJumpToAnnotation }) => {
  const [activeTab, setActiveTab] = useState<'issues' | 'approved' | 'suggestions'>('issues');
  // Track which issues the annotator has marked as fixed (local state, stored in localStorage)
  const [markedFixed, setMarkedFixed] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(`qa-fixed-${taskId}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch {
      return new Set();
    }
  });

  const taxonomy = useEditorStore(s => s.taxonomy);
  // Use ALL annotations across ALL frames (not just current frame)
  const allAnnotations = useEditorStore(s => s.annotations);
  const frames = useEditorStore(s => s.frames);
  const goToFrame = useEditorStore(s => s.goToFrame);
  const queryClient = useQueryClient();

  // Handler to update annotation attributes
  const handleUpdateAnnotationAttributes = useCallback(async (annotationId: string, attributes: Record<string, unknown>) => {
    try {
      await annotation3DApi.update(annotationId, { attributes });
      // Invalidate cache to refetch updated data
      queryClient.invalidateQueries({ queryKey: ['all-3d-annotations-frame-review', taskId] });
    } catch (error) {
      console.error('Failed to update annotation attributes:', error);
    }
  }, [taskId, queryClient]);

  // Build frame index lookup
  const frameIndexMap = useMemo(() => {
    const map = new Map<string, number>();
    frames.forEach((f, i) => map.set(f.id, i));
    return map;
  }, [frames]);

  // Fetch ALL QA reviews for this task (review may be 'in_progress' or 'completed')
  const { data: reviews } = useQuery({
    queryKey: ['qa-reviews-all', taskId],
    queryFn: () => qaApi.getTaskReviews(taskId),
    enabled: !!taskId && task.revision_count > 0,
  });

  // Get the most recent review (any status — 'completed', 'in_progress', or 'paused')
  const latestReview = useMemo(() => {
    if (!reviews?.length) return null;
    const sorted = [...reviews].sort((a, b) =>
      new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime()
    );
    console.log('[QAFeedbackPanel] Found', sorted.length, 'reviews, latest status:', sorted[0]?.status, 'id:', sorted[0]?.id);
    return sorted[0];
  }, [reviews]);

  // Fetch annotation reviews for the latest review session
  const { data: annotationReviews } = useQuery({
    queryKey: ['qa-annotation-reviews', latestReview?.id],
    queryFn: async () => {
      const result = await qaApi.getAnnotationReviews(latestReview!.id);
      console.log('[QAFeedbackPanel] Loaded', result?.length, 'annotation reviews for review', latestReview!.id);
      return result;
    },
    enabled: !!latestReview?.id,
  });

  // Fetch QA suggestions for this task (including manually flagged items)
  const { data: suggestions } = useQuery({
    queryKey: ['qa-suggestions', taskId],
    queryFn: () => qaApi.getTaskSuggestions(taskId),
    enabled: !!taskId,
    refetchInterval: 5000, // Poll for new suggestions every 5s
  });

  // Fetch workflow history to get the rejection reason
  const { data: history } = useQuery({
    queryKey: ['workflow-history', taskId],
    queryFn: () => workflowApi.getHistory(taskId),
    enabled: !!taskId && task.revision_count > 0,
  });

  // Find the latest rejection reason from history
  const rejectionInfo = useMemo(() => {
    if (!history?.length) return null;
    // Find the most recent rejection transition (qa/customer_qa → annotation)
    const rejection = history
      .filter(h => h.to_stage === 'annotation' && h.to_status === 'pending' && h.reason)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
    return rejection || null;
  }, [history]);

  // Fetch all comments for reviewed annotations
  const [commentsByAnnotation, setCommentsByAnnotation] = useState<Map<string, AnnotationComment[]>>(new Map());

  useEffect(() => {
    if (!annotationReviews?.length) return;

    const fetchComments = async () => {
      const commentsMap = new Map<string, AnnotationComment[]>();
      // Fetch comments for rejected and flagged annotations
      const reviewsToFetch = annotationReviews.filter(
        r => r.verdict === 'rejected' || r.verdict === 'flagged'
      );

      await Promise.all(
        reviewsToFetch.map(async (review) => {
          try {
            const comments = await qaApi.getAnnotationComments(review.annotation_id, true);
            if (comments?.length) {
              commentsMap.set(review.annotation_id, comments);
            }
          } catch {
            // Silently skip if comments can't be fetched
          }
        })
      );

      setCommentsByAnnotation(commentsMap);
    };

    fetchComments();
  }, [annotationReviews]);

  // Split reviews: rejected/flagged as issues, approved separate
  const { issueReviews, approvedReviews } = useMemo(() => {
    if (!annotationReviews) return { issueReviews: [] as AnnotationReview[], approvedReviews: [] as AnnotationReview[] };
    const issues: AnnotationReview[] = [];
    const approved: AnnotationReview[] = [];
    for (const r of annotationReviews) {
      if (r.verdict === 'rejected' || r.verdict === 'flagged') {
        issues.push(r);
      } else if (r.verdict === 'approved') {
        approved.push(r);
      }
    }
    // Sort issues: rejected first, then flagged
    issues.sort((a, b) => {
      const order: Record<string, number> = { rejected: 0, flagged: 1 };
      return (order[a.verdict || ''] ?? 99) - (order[b.verdict || ''] ?? 99);
    });
    return { issueReviews: issues, approvedReviews: approved };
  }, [annotationReviews]);

  // Counts
  const counts = useMemo(() => {
    if (!annotationReviews) return { rejected: 0, flagged: 0, approved: 0, total: 0 };
    return {
      rejected: annotationReviews.filter(r => r.verdict === 'rejected').length,
      flagged: annotationReviews.filter(r => r.verdict === 'flagged').length,
      approved: annotationReviews.filter(r => r.verdict === 'approved').length,
      total: annotationReviews.length,
    };
  }, [annotationReviews]);

  // Get class name for an annotation (prefer review.class_id, fallback to annotation lookup)
  const getAnnotationClassName = useCallback((annotationId: string, classIdFromReview?: string) => {
    const classId = classIdFromReview || allAnnotations.get(annotationId)?.class_id;
    if (!classId) return 'Unknown';
    const cls = taxonomy?.classes?.find(c => c.id === classId);
    return cls?.name || 'Unknown class';
  }, [allAnnotations, taxonomy]);

  // Group approved reviews by track_id to show as single track entries
  const groupedApprovedTracks = useMemo(() => {
    const trackGroups = new Map<string, {
      trackId: string;
      className: string;
      classColor: string;
      reviews: typeof approvedReviews;
      frameNumbers: number[];
      firstAnnotationId: string;
      firstFrameId: string;
    }>();

    for (const review of approvedReviews) {
      const annotation = allAnnotations.get(review.annotation_id);
      const trackId = annotation?.track_id || review.annotation_id; // fallback to annotation_id if no track

      // Get frame number
      const frameId = review.frame_id || annotation?.frame_id;
      let frameNum: number | undefined;
      if (frameId) {
        const idx = frameIndexMap.get(frameId);
        if (idx !== undefined) {
          frameNum = (frames[idx]?.frame_index ?? idx) + 1;
        }
      }

      const existing = trackGroups.get(trackId);
      if (existing) {
        existing.reviews.push(review);
        if (frameNum !== undefined) existing.frameNumbers.push(frameNum);
      } else {
        const className = getAnnotationClassName(review.annotation_id, review.class_id);
        const classDef = taxonomy?.classes?.find(c => c.id === (review.class_id || annotation?.class_id));
        trackGroups.set(trackId, {
          trackId,
          className,
          classColor: classDef?.color || '#888',
          reviews: [review],
          frameNumbers: frameNum !== undefined ? [frameNum] : [],
          firstAnnotationId: review.annotation_id,
          firstFrameId: frameId || '',
        });
      }
    }

    // Convert to array with frame labels
    return Array.from(trackGroups.values()).map(group => {
      const sortedFrames = [...new Set(group.frameNumbers)].sort((a, b) => a - b);
      let frameLabel = '';
      if (sortedFrames.length === 1) {
        frameLabel = `F${sortedFrames[0]}`;
      } else if (sortedFrames.length > 1) {
        frameLabel = `F${sortedFrames[0]}-${sortedFrames[sortedFrames.length - 1]}`;
      }
      return { ...group, frameLabel, count: group.reviews.length };
    });
  }, [approvedReviews, allAnnotations, frameIndexMap, frames, getAnnotationClassName, taxonomy]);

  // Split suggestions: false_negatives go to issues, others to alerts
  // Also get set of rejected annotation IDs
  const rejectedAnnotationIds = useMemo(() => {
    return new Set(issueReviews.map(r => r.annotation_id));
  }, [issueReviews]);

  const { falseNegativeSuggestions, otherSuggestions } = useMemo(() => {
    const active = (suggestions || []).filter(s => !s.is_dismissed);
    return {
      falseNegativeSuggestions: active.filter(s => s.suggestion_type === 'false_negative'),
      // Only show alerts for rejected/flagged annotations
      otherSuggestions: active.filter(s => s.suggestion_type !== 'false_negative' && s.annotation_id && rejectedAnnotationIds.has(s.annotation_id)),
    };
  }, [suggestions, rejectedAnnotationIds]);

  // Group alerts by class and suggestion_type with frame ranges
  const groupedAlerts = useMemo(() => {
    // Group by annotation class + suggestion_type
    const groups = new Map<string, {
      className: string;
      suggestionType: string;
      severity: string;
      message: string;
      frameNumbers: number[];
      annotationIds: Set<string>;
      firstSuggestion: QASuggestion;
    }>();

    for (const suggestion of otherSuggestions) {
      const className = suggestion.annotation_id
        ? getAnnotationClassName(suggestion.annotation_id)
        : 'Unknown';
      const key = `${className}:${suggestion.suggestion_type}`;

      // Get frame number
      let frameNum: number | undefined;
      if (suggestion.frame_id) {
        const idx = frameIndexMap.get(suggestion.frame_id);
        if (idx !== undefined) {
          frameNum = (frames[idx]?.frame_index ?? idx) + 1;
        }
      }

      const existing = groups.get(key);
      if (existing) {
        if (frameNum !== undefined) existing.frameNumbers.push(frameNum);
        if (suggestion.annotation_id) existing.annotationIds.add(suggestion.annotation_id);
      } else {
        groups.set(key, {
          className,
          suggestionType: suggestion.suggestion_type,
          severity: suggestion.severity,
          message: suggestion.message,
          frameNumbers: frameNum !== undefined ? [frameNum] : [],
          annotationIds: suggestion.annotation_id ? new Set([suggestion.annotation_id]) : new Set(),
          firstSuggestion: suggestion,
        });
      }
    }

    // Convert to array and format frame ranges
    return Array.from(groups.values()).map(group => {
      const sortedFrames = [...new Set(group.frameNumbers)].sort((a, b) => a - b);
      let frameLabel = '';
      if (sortedFrames.length === 1) {
        frameLabel = `F${sortedFrames[0]}`;
      } else if (sortedFrames.length > 1) {
        frameLabel = `F${sortedFrames[0]}-${sortedFrames[sortedFrames.length - 1]}`;
      }
      return { ...group, frameLabel, sortedFrames };
    });
  }, [otherSuggestions, getAnnotationClassName, frameIndexMap, frames]);

  // Get frame label for an annotation (prefer review.frame_id, fallback to annotation lookup)
  const getFrameLabel = useCallback((annotationId: string, frameIdFromReview?: string) => {
    const frameId = frameIdFromReview || allAnnotations.get(annotationId)?.frame_id;
    if (!frameId) return '';
    const idx = frameIndexMap.get(frameId);
    if (idx === undefined) return '';
    // Use actual frame_index from frame data (1-based display)
    const actualFrameNumber = (frames[idx]?.frame_index ?? idx) + 1;
    return `F${actualFrameNumber}`;
  }, [allAnnotations, frameIndexMap, frames]);

  // Get frame ID for an annotation (prefer review.frame_id, fallback to annotation lookup)
  const getAnnotationFrameId = useCallback((annotationId: string, frameIdFromReview?: string) => {
    return frameIdFromReview || allAnnotations.get(annotationId)?.frame_id;
  }, [allAnnotations]);

  // Handle jump to annotation — navigates to correct frame + selects
  const handleJumpTo = useCallback((annotationId: string, frameId?: string) => {
    const resolvedFrameId = frameId || getAnnotationFrameId(annotationId);
    onJumpToAnnotation(annotationId, resolvedFrameId);
  }, [onJumpToAnnotation, getAnnotationFrameId]);

  // Handle jump to frame (for suggestions without a specific annotation)
  const handleJumpToFrame = useCallback((frameId: string) => {
    const idx = frameIndexMap.get(frameId);
    if (idx !== undefined) goToFrame(idx);
  }, [frameIndexMap, goToFrame]);

  // Handle marking an issue as fixed (persisted to localStorage)
  const handleMarkFixed = useCallback((annotationId: string, fixed: boolean) => {
    setMarkedFixed(prev => {
      const next = new Set(prev);
      if (fixed) {
        next.add(annotationId);
      } else {
        next.delete(annotationId);
      }
      // Persist to localStorage
      try {
        localStorage.setItem(`qa-fixed-${taskId}`, JSON.stringify([...next]));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, [taskId]);

  // Get frame label for a suggestion
  const getSuggestionFrameLabel = useCallback((frameId?: string) => {
    if (!frameId) return '';
    const idx = frameIndexMap.get(frameId);
    if (idx === undefined) return '';
    // Use actual frame_index from frame data (1-based display)
    const actualFrameNumber = (frames[idx]?.frame_index ?? idx) + 1;
    return `F${actualFrameNumber}`;
  }, [frameIndexMap, frames]);

  // Show panel if there's revision info, or if there are suggestions (flagged items)
  const hasSuggestions = (suggestions || []).filter(s => !s.is_dismissed).length > 0;
  if (!latestReview && !rejectionInfo && task.revision_count === 0 && !hasSuggestions) {
    return null;
  }

  return (
    <div className="flex flex-col h-full bg-dark-panel text-white" style={{ maxHeight: 'calc(100vh - 120px)' }}>
      {/* Rejection Banner */}
      {(rejectionInfo || task.revision_count > 0) && task.stage !== 'customer_qa' && task.stage !== 'accepted' && (
        <div className="px-4 py-3 bg-red-500/10 border-b border-red-500/30">
          <div className="flex items-center gap-2 mb-1">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <span className="text-sm font-semibold text-red-400">
              QA Rejected — Revision #{task.revision_count}
            </span>
          </div>
          {rejectionInfo?.reason && (
            <p className="text-xs text-red-300/80 ml-7">
              {rejectionInfo.reason}
            </p>
          )}
          {rejectionInfo && (
            <p className="text-[10px] text-gray-500 ml-7 mt-1">
              Rejected on {new Date(rejectionInfo.created_at).toLocaleDateString()} at{' '}
              {new Date(rejectionInfo.created_at).toLocaleTimeString()}
            </p>
          )}
        </div>
      )}

      {/* Summary counts */}
      {annotationReviews && (
        <div className="px-4 py-2 border-b border-gray-700 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-red-500" />
            <span className="text-xs text-gray-300">{counts.rejected} rejected</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-yellow-500" />
            <span className="text-xs text-gray-300">{counts.flagged} flagged</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-gray-300">{counts.approved} 🔒</span>
          </div>
          {markedFixed.size > 0 && (
            <div className="flex items-center gap-1.5 ml-auto">
              <span className="text-xs text-green-400">✓ {markedFixed.size} marked fixed</span>
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab('issues')}
          className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${
            activeTab === 'issues'
              ? 'text-red-400 border-b-2 border-red-500 bg-red-500/5'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Issues ({issueReviews.length + falseNegativeSuggestions.length})
        </button>
        <button
          onClick={() => setActiveTab('approved')}
          className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${
            activeTab === 'approved'
              ? 'text-green-400 border-b-2 border-green-500 bg-green-500/5'
              : 'text-gray-500 hover:text-gray-300'
          }`}
        >
          Approved ({groupedApprovedTracks.length})
        </button>
        {groupedAlerts.length > 0 && (
          <button
            onClick={() => setActiveTab('suggestions')}
            className={`flex-1 py-2 text-xs font-medium text-center transition-colors ${
              activeTab === 'suggestions'
                ? 'text-orange-400 border-b-2 border-orange-500 bg-orange-500/5'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            Alerts ({groupedAlerts.length})
          </button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'issues' && (
          <div className="p-3 space-y-2">
            {issueReviews.length === 0 && falseNegativeSuggestions.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-xs">
                No rejected or flagged annotations
              </div>
            ) : (
              <>
                {/* False negative (missing object) flags first */}
                {falseNegativeSuggestions.length > 0 && (
                  <>
                    <div className="text-[10px] text-orange-400 font-semibold uppercase mb-1">Missing Objects</div>
                    {falseNegativeSuggestions.map(suggestion => (
                      <SuggestionItem
                        key={suggestion.id}
                        suggestion={suggestion}
                        frameLabel={getSuggestionFrameLabel(suggestion.frame_id)}
                        onJumpToFrame={suggestion.frame_id ? handleJumpToFrame : undefined}
                        onJumpToAnnotation={suggestion.annotation_id ? handleJumpTo : undefined}
                        onMarkFixed={(id, fixed) => handleMarkFixed(`fn-${id}`, fixed)}
                        isMarkedFixed={markedFixed.has(`fn-${suggestion.id}`)}
                      />
                    ))}
                  </>
                )}
                {/* Rejected/flagged annotation reviews */}
                {issueReviews.length > 0 && falseNegativeSuggestions.length > 0 && (
                  <div className="text-[10px] text-red-400 font-semibold uppercase mb-1 mt-3">Annotation Issues</div>
                )}
                {issueReviews.map(review => (
                  <ReviewItem
                    key={review.id}
                    review={review}
                    comments={commentsByAnnotation.get(review.annotation_id) || []}
                    annotationClassName={getAnnotationClassName(review.annotation_id, review.class_id)}
                    frameLabel={getFrameLabel(review.annotation_id, review.frame_id)}
                    frameId={getAnnotationFrameId(review.annotation_id, review.frame_id)}
                    onJumpTo={handleJumpTo}
                    onMarkFixed={handleMarkFixed}
                    isMarkedFixed={markedFixed.has(review.annotation_id)}
                    annotation={allAnnotations.get(review.annotation_id)}
                    taxonomy={taxonomy}
                    onUpdateAttributes={handleUpdateAnnotationAttributes}
                  />
                ))}
              </>
            )}
          </div>
        )}

        {activeTab === 'approved' && (
          <div className="p-3 space-y-2">
            {groupedApprovedTracks.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-xs">
                No approved annotations
              </div>
            ) : (
              groupedApprovedTracks.map(track => (
                <div
                  key={track.trackId}
                  className="p-2.5 rounded-lg border border-green-500/30 bg-green-500/5"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-green-400">✓</span>
                      <span
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: track.classColor }}
                      />
                      <span className="text-xs text-gray-300">{track.className}</span>
                      {track.count > 1 && (
                        <span className="text-[10px] text-gray-500">({track.count} frames)</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {track.frameLabel && (
                        <span className="text-[10px] text-gray-500 font-mono">{track.frameLabel}</span>
                      )}
                      <button
                        onClick={() => handleJumpTo(track.firstAnnotationId, track.firstFrameId)}
                        className="text-[10px] text-primary hover:text-primary/80 flex items-center gap-0.5"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2z" />
                        </svg>
                        Jump
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {activeTab === 'suggestions' && (
          <div className="p-3 space-y-2">
            {groupedAlerts.length === 0 ? (
              <div className="text-center py-8 text-gray-500 text-xs">
                No QA alerts for rejected annotations
              </div>
            ) : (
              groupedAlerts.map((group, idx) => {
                const severityColors: Record<string, string> = {
                  critical: 'text-red-400 bg-red-500/10 border-red-500/30',
                  high: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
                  medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
                  low: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
                  info: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
                };
                const typeLabels: Record<string, string> = {
                  velocity_outlier: 'Impossible Speed',
                  heading_motion_mismatch: 'Wrong Direction',
                  track_boundary: 'Track Boundary',
                  annotation_source: 'Auto-generated Annotation',
                  size_anomaly: 'Size anomaly',
                  position_jump: 'Position jump',
                  orientation_flip: 'Orientation flip',
                  overlapping_cuboids: 'Overlapping boxes',
                  ground_plane_misalignment: 'Ground alignment',
                };
                return (
                  <div key={idx} className={`p-2.5 rounded-lg border ${severityColors[group.severity] || severityColors.medium}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium">
                        {typeLabels[group.suggestionType] || group.suggestionType}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {group.frameLabel && (
                          <span className="text-[10px] text-gray-400 font-mono">{group.frameLabel}</span>
                        )}
                        <span className="text-[10px] uppercase font-semibold opacity-70">
                          {group.severity}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-gray-300">{group.message}</p>
                    <div className="mt-1 text-[10px] text-gray-500">
                      <span className="font-medium">{group.className}</span>
                      {group.sortedFrames.length > 0 && (
                        <span> • Frames {group.sortedFrames[0]}-{group.sortedFrames[group.sortedFrames.length - 1]}</span>
                      )}
                    </div>
                    {group.firstSuggestion.annotation_id && (
                      <button
                        onClick={() => handleJumpTo(group.firstSuggestion.annotation_id!, group.firstSuggestion.frame_id)}
                        className="mt-1.5 w-full flex items-center justify-center gap-1 py-1 rounded bg-white/5 text-gray-400 text-[10px] hover:bg-white/10 transition-colors"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5" />
                        </svg>
                        Go to F{group.sortedFrames[0] || '?'} &amp; select
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Footer with approved annotation note */}
      <div className="px-4 py-2 border-t border-gray-700 bg-green-500/5">
        <div className="flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
          </svg>
          <span className="text-[10px] text-green-400">Green annotations are QA approved &amp; locked</span>
        </div>
      </div>
    </div>
  );
};

export default QAFeedbackPanel;

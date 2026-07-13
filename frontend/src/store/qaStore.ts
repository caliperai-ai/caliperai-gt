import { create } from 'zustand';
import { qaApi } from '@/api/client';
import type {
  QAReview,
  QAReviewMode,
  QAReviewSummary,
  AnnotationReview,
  QASuggestion,
  AnnotationComment,
  QATaskStats,
  ReviewVerdict,
} from '@/types';

export const ISSUE_TYPES = [
  { id: 'box_too_loose', label: 'Box too loose', icon: '📦' },
  { id: 'box_too_tight', label: 'Box too tight', icon: '🔲' },
  { id: 'wrong_class', label: 'Wrong class', icon: '🏷️' },
  { id: 'wrong_orientation', label: 'Wrong orientation', icon: '🔄' },
  { id: 'missing_attributes', label: 'Missing attributes', icon: '📝' },
  { id: 'tracking_error', label: 'Tracking error', icon: '🔗' },
  { id: 'position_incorrect', label: 'Position incorrect', icon: '📍' },
  { id: 'size_incorrect', label: 'Size incorrect', icon: '📐' },
  { id: 'occlusion_wrong', label: 'Occlusion label wrong', icon: '👁️' },
  { id: 'other', label: 'Other', icon: '❓' },
] as const;

export type IssueType = typeof ISSUE_TYPES[number]['id'];

interface QAState {
  isQAMode: boolean;
  qaSession: QAReview | null;
  qaMode: QAReviewMode;
  taskId: string | null;

  annotationIds: string[];
  currentAnnotationIndex: number;

  suggestions: QASuggestion[];
  currentSuggestionIndex: number;
  isLoadingSuggestions: boolean;

  annotationReviews: Map<string, AnnotationReview>;

  activeCommentThread: string | null;
  annotationComments: Map<string, AnnotationComment[]>;

  stats: QATaskStats | null;

  isLoading: boolean;
  showRejectionModal: boolean;
  rejectionAnnotationId: string | null;
  rejectionFrameId: string | null;
  rejectionClassId: string | null;

  startQASession: (taskId: string, mode?: QAReviewMode, reviewStage?: string) => Promise<void>;
  resumeQASession: (reviewId: string) => Promise<void>;
  endQASession: () => Promise<QAReviewSummary | null>;
  pauseQASession: () => Promise<void>;
  setQAMode: (mode: QAReviewMode) => Promise<void>;
  exitQAMode: () => void;

  loadSuggestions: (taskId: string) => Promise<void>;
  generateSuggestions: (taskId: string, regenerate?: boolean) => Promise<void>;
  jumpToSuggestion: (index: number) => void;
  nextSuggestion: () => void;
  prevSuggestion: () => void;
  dismissSuggestion: (suggestionId: string, reason?: string) => Promise<void>;
  getCurrentSuggestion: () => QASuggestion | null;

  reviewAnnotation: (
    annotationId: string,
    verdict: ReviewVerdict,
    issueTypes?: string[],
    notes?: string,
    frameId?: string,
    classId?: string,
    annotationTable?: string,
    location?: { x: number; y: number; z: number }
  ) => Promise<void>;
  approveAnnotation: (annotationId: string, frameId?: string, classId?: string, annotationTable?: string) => Promise<void>;
  rejectAnnotation: (annotationId: string, issueTypes: string[], notes?: string, frameId?: string, classId?: string, annotationTable?: string) => Promise<void>;
  flagAnnotation: (annotationId: string, notes?: string, frameId?: string, classId?: string, annotationTable?: string) => Promise<void>;
  createSpatialIssue: (frameId: string, location: { x: number; y: number; z: number }, issueTypes: string[], notes?: string, classId?: string) => Promise<void>;
  resolveSpatialIssue: (reviewId: string) => Promise<void>;
  clearAnnotationReview: (annotationId: string) => void;
  getAnnotationReview: (annotationId: string) => AnnotationReview | undefined;
  loadAnnotationReviews: () => Promise<void>;

  approveAllVisible: (annotationIds: string[], annotationTable?: string) => Promise<void>;
  approveTrack: (trackId: string, annotationIds: string[], annotationTable?: string) => Promise<void>;
  rejectAllVisible: (annotationIds: string[], issueTypes: string[], notes?: string, annotationTable?: string) => Promise<void>;

  openCommentThread: (annotationId: string) => void;
  closeCommentThread: () => void;
  loadComments: (annotationId: string) => Promise<void>;
  addComment: (annotationId: string, content: string, parentId?: string) => Promise<void>;
  resolveCommentThread: (commentId: string) => Promise<void>;

  loadStats: (taskId: string) => Promise<void>;
  refreshStats: () => Promise<void>;

  flagMissingObject: (params: {
    frameId: string;
    location: { x: number; y: number; z: number };
    suggestedClass?: string;
    message?: string;
  }) => Promise<void>;

  openRejectionModal: (annotationId: string, frameId?: string, classId?: string) => void;
  closeRejectionModal: () => void;

  setAnnotationList: (ids: string[]) => void;
  nextAnnotation: () => string | null;
  prevAnnotation: () => string | null;
  goToAnnotation: (index: number) => string | null;
  goToAnnotationById: (id: string) => void;
  getCurrentAnnotationId: () => string | null;
  getNavigationProgress: () => { current: number; total: number };

  autoAdvanceEnabled: boolean;
  setAutoAdvance: (enabled: boolean) => void;
  advanceAfterReview: () => void;

  _nextFrameCallback: (() => void) | null;
  _selectAnnotationCallback: ((id: string) => void) | null;
  setFrameNavigationCallbacks: (nextFrame: () => void, selectAnnotation: (id: string) => void) => void;
}

export const useQAStore = create<QAState>((set, get) => ({
  isQAMode: false,
  qaSession: null,
  qaMode: 'view_only',
  taskId: null,

  annotationIds: [],
  currentAnnotationIndex: 0,

  suggestions: [],
  currentSuggestionIndex: 0,
  isLoadingSuggestions: false,

  annotationReviews: new Map(),

  activeCommentThread: null,
  annotationComments: new Map(),

  stats: null,

  isLoading: false,
  showRejectionModal: false,
  rejectionAnnotationId: null,
  rejectionFrameId: null,
  rejectionClassId: null,

  autoAdvanceEnabled: true,
  _nextFrameCallback: null,
  _selectAnnotationCallback: null,

  startQASession: async (taskId: string, mode: QAReviewMode = 'view_only', reviewStage?: string) => {
    console.log('[QA] Starting QA session for task:', taskId, 'mode:', mode, 'stage:', reviewStage);
    set({ isLoading: true });
    try {
      let session = await qaApi.getActiveReview(taskId, reviewStage);

      if (session) {
        console.log('[QA] Found existing active session:', session.id);
      } else {
        console.log('[QA] Creating new QA session for stage:', reviewStage);
        session = await qaApi.startReview(taskId, mode, reviewStage);
      }

      set({
        isQAMode: true,
        qaSession: session,
        qaMode: session.mode as QAReviewMode,
        taskId,
        isLoading: false,
      });

      console.log('[QA] Loading suggestions, reviews, and stats');
      await get().loadSuggestions(taskId);
      await get().loadAnnotationReviews();
      await get().loadStats(taskId);

      const currentSuggestions = get().suggestions;
      if (currentSuggestions.length === 0) {
        console.log('[QA] No suggestions found, generating AI suggestions...');
        await qaApi.generateSuggestions(taskId, false);
        await get().loadSuggestions(taskId);
      }

      console.log('[QA] Session started successfully. Suggestions loaded:', get().suggestions.length);
    } catch (error) {
      console.error('[QA] Failed to start session:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  resumeQASession: async (reviewId: string) => {
    set({ isLoading: true });
    try {
      const session = await qaApi.resumeReview(reviewId);
      set({
        isQAMode: true,
        qaSession: session,
        qaMode: session.mode as QAReviewMode,
        taskId: session.task_id,
        isLoading: false,
      });

      await get().loadSuggestions(session.task_id);
      await get().loadAnnotationReviews();
      await get().loadStats(session.task_id);
    } catch (error) {
      console.error('[QA] Failed to resume session:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  endQASession: async (): Promise<QAReviewSummary | null> => {
    const { qaSession } = get();
    if (!qaSession) return null;

    set({ isLoading: true });
    try {
      const result = await qaApi.completeReview(qaSession.id);
      set({
        isQAMode: false,
        qaSession: null,
        qaMode: 'view_only',
        taskId: null,
        suggestions: [],
        annotationReviews: new Map(),
        stats: null,
        isLoading: false,
      });
      return result.summary ?? null;
    } catch (error) {
      console.error('[QA] Failed to end session:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  pauseQASession: async () => {
    const { qaSession } = get();
    if (!qaSession) return;

    try {
      await qaApi.pauseReview(qaSession.id);
      set({ isQAMode: false });
    } catch (error) {
      console.error('[QA] Failed to pause session:', error);
      throw error;
    }
  },

  setQAMode: async (mode: QAReviewMode) => {
    const { qaSession, taskId, suggestions } = get();
    if (qaSession) {
      qaApi.updateReview(qaSession.id, { mode }).catch(console.error);
    }
    set({ qaMode: mode });

    if (mode === 'suggest' && taskId) {
      if (suggestions.length === 0) {
        await get().generateSuggestions(taskId, false);
      } else {
        await get().loadSuggestions(taskId);
      }
    }
  },

  exitQAMode: () => {
    set({
      isQAMode: false,
    });
  },

  loadSuggestions: async (taskId: string) => {
    console.log('[QA] Loading suggestions for task:', taskId);
    set({ isLoadingSuggestions: true });
    try {
      const suggestions = await qaApi.getTaskSuggestions(taskId);
      console.log('[QA] Loaded suggestions:', suggestions.length, 'items');
      if (suggestions.length > 0) {
        console.log('[QA] First suggestion:', suggestions[0].suggestion_type, suggestions[0].severity, suggestions[0].annotation_id);
      }
      set({
        suggestions,
        currentSuggestionIndex: 0,
        isLoadingSuggestions: false,
      });
    } catch (error) {
      console.error('[QA] Failed to load suggestions:', error);
      set({ isLoadingSuggestions: false, suggestions: [] });
    }
  },

  generateSuggestions: async (taskId: string, regenerate = false) => {
    set({ isLoadingSuggestions: true });
    try {
      await qaApi.generateSuggestions(taskId, regenerate);
      await get().loadSuggestions(taskId);
    } catch (error) {
      console.error('[QA] Failed to generate suggestions:', error);
      set({ isLoadingSuggestions: false });
    }
  },

  jumpToSuggestion: (index: number) => {
    const { suggestions } = get();
    if (index >= 0 && index < suggestions.length) {
      set({ currentSuggestionIndex: index });
    }
  },

  nextSuggestion: () => {
    const { currentSuggestionIndex, suggestions } = get();
    if (currentSuggestionIndex < suggestions.length - 1) {
      set({ currentSuggestionIndex: currentSuggestionIndex + 1 });
    }
  },

  prevSuggestion: () => {
    const { currentSuggestionIndex } = get();
    if (currentSuggestionIndex > 0) {
      set({ currentSuggestionIndex: currentSuggestionIndex - 1 });
    }
  },

  dismissSuggestion: async (suggestionId: string, reason?: string) => {
    try {
      await qaApi.dismissSuggestion(suggestionId, reason);
      const { suggestions, currentSuggestionIndex } = get();
      const newSuggestions = suggestions.filter(s => s.id !== suggestionId);
      const newIndex = Math.min(currentSuggestionIndex, newSuggestions.length - 1);
      set({
        suggestions: newSuggestions,
        currentSuggestionIndex: Math.max(0, newIndex),
      });
    } catch (error) {
      console.error('[QA] Failed to dismiss suggestion:', error);
    }
  },

  getCurrentSuggestion: () => {
    const { suggestions, currentSuggestionIndex } = get();
    return suggestions[currentSuggestionIndex] ?? null;
  },

  reviewAnnotation: async (
    annotationId: string,
    verdict: ReviewVerdict,
    issueTypes?: string[],
    notes?: string,
    frameId?: string,
    classId?: string,
    annotationTable: string = 'annotations_4d',
    location?: { x: number; y: number; z: number }
  ) => {
    const { qaSession } = get();
    if (!qaSession) {
      console.error('[QA] No active session');
      return;
    }

    try {
      const review = await qaApi.reviewAnnotation(
        qaSession.id,
        annotationId,
        verdict,
        issueTypes,
        notes,
        annotationTable,
        frameId,
        classId,
        location
      );

      const { annotationReviews } = get();
      const newReviews = new Map(annotationReviews);
      newReviews.set(annotationId, review);
      set({ annotationReviews: newReviews });

      get().refreshStats();

      get().advanceAfterReview();
    } catch (error) {
      console.error('[QA] Failed to review annotation:', error);
      throw error;
    }
  },

  approveAnnotation: async (annotationId: string, frameId?: string, classId?: string, annotationTable?: string) => {
    await get().reviewAnnotation(annotationId, 'approved', undefined, undefined, frameId, classId, annotationTable);
  },

  rejectAnnotation: async (annotationId: string, issueTypes: string[], notes?: string, frameId?: string, classId?: string, annotationTable?: string) => {
    await get().reviewAnnotation(annotationId, 'rejected', issueTypes, notes, frameId, classId, annotationTable);
    set({ showRejectionModal: false, rejectionAnnotationId: null, rejectionFrameId: null, rejectionClassId: null });
  },

  flagAnnotation: async (annotationId: string, notes?: string, frameId?: string, classId?: string, annotationTable?: string) => {
    await get().reviewAnnotation(annotationId, 'flagged', undefined, notes, frameId, classId, annotationTable);
  },

  createSpatialIssue: async (
    frameId: string,
    location: { x: number; y: number; z: number },
    issueTypes: string[],
    notes?: string,
    classId?: string
  ) => {
    const annotationId = `spatial-${frameId}-${Date.now()}`;
    await get().reviewAnnotation(
      annotationId,
      'rejected',
      issueTypes,
      notes,
      frameId,
      classId,
      'segmentation_labels',
      location
    );
  },

  resolveSpatialIssue: async (reviewId: string) => {
    try {
      const updated = await qaApi.resolveAnnotationReview(reviewId);
      // The review is keyed by annotation_id in the Map, not by review id.
      // Look up by id to find the existing entry's key, then replace it.
      const { annotationReviews } = get();
      const newReviews = new Map(annotationReviews);
      for (const [key, existing] of newReviews) {
        if (existing.id === reviewId) {
          newReviews.set(key, updated);
          break;
        }
      }
      set({ annotationReviews: newReviews });
    } catch (error) {
      console.error('[QA] Failed to resolve spatial issue:', error);
      throw error;
    }
  },

  clearAnnotationReview: (annotationId: string) => {
    // Clear review from local state (allows re-reviewing)
    // Note: The backend review persists until overwritten with a new verdict
    const { annotationReviews } = get();
    const newReviews = new Map(annotationReviews);
    newReviews.delete(annotationId);
    set({ annotationReviews: newReviews });
  },

  getAnnotationReview: (annotationId: string) => {
    return get().annotationReviews.get(annotationId);
  },

  loadAnnotationReviews: async () => {
    const { qaSession } = get();
    if (!qaSession) return;

    try {
      const reviews = await qaApi.getAnnotationReviews(qaSession.id);
      const reviewMap = new Map<string, AnnotationReview>();
      reviews.forEach(r => reviewMap.set(r.annotation_id, r));
      set({ annotationReviews: reviewMap });
    } catch (error) {
      console.error('[QA] Failed to load annotation reviews:', error);
    }
  },

  // Bulk Actions
  approveAllVisible: async (annotationIds: string[], annotationTable: string = 'annotations_4d') => {
    const { qaSession } = get();
    if (!qaSession) return;

    try {
      const reviews = annotationIds.map(id => ({
        annotation_id: id,
        annotation_table: annotationTable,
        verdict: 'approved' as ReviewVerdict,
      }));

      await qaApi.bulkReviewAnnotations(qaSession.id, reviews);
      await get().loadAnnotationReviews();
      get().refreshStats();
    } catch (error) {
      console.error('[QA] Failed to bulk approve:', error);
    }
  },

  approveTrack: async (_trackId: string, annotationIds: string[], annotationTable?: string) => {
    await get().approveAllVisible(annotationIds, annotationTable);
  },

  rejectAllVisible: async (annotationIds: string[], issueTypes: string[], notes?: string, annotationTable: string = 'annotations_4d') => {
    const { qaSession } = get();
    if (!qaSession) return;

    try {
      const reviews = annotationIds.map(id => ({
        annotation_id: id,
        annotation_table: annotationTable,
        verdict: 'rejected' as ReviewVerdict,
        issue_types: issueTypes,
        notes: notes,
      }));

      await qaApi.bulkReviewAnnotations(qaSession.id, reviews);
      await get().loadAnnotationReviews();
      get().refreshStats();
    } catch (error) {
      console.error('[QA] Failed to bulk reject:', error);
    }
  },

  // Comments
  openCommentThread: (annotationId: string) => {
    set({ activeCommentThread: annotationId });
    get().loadComments(annotationId);
  },

  closeCommentThread: () => {
    set({ activeCommentThread: null });
  },

  loadComments: async (annotationId: string) => {
    try {
      const comments = await qaApi.getAnnotationComments(annotationId, true);
      const { annotationComments } = get();
      const newComments = new Map(annotationComments);
      newComments.set(annotationId, comments);
      set({ annotationComments: newComments });
    } catch (error) {
      console.error('[QA] Failed to load comments:', error);
    }
  },

  addComment: async (annotationId: string, content: string, parentId?: string) => {
    try {
      await qaApi.createComment(annotationId, content, parentId);
      await get().loadComments(annotationId);
    } catch (error) {
      console.error('[QA] Failed to add comment:', error);
    }
  },

  resolveCommentThread: async (commentId: string) => {
    const { activeCommentThread } = get();
    try {
      await qaApi.resolveComment(commentId);
      if (activeCommentThread) {
        await get().loadComments(activeCommentThread);
      }
    } catch (error) {
      console.error('[QA] Failed to resolve comment:', error);
    }
  },

  // Statistics
  loadStats: async (taskId: string) => {
    try {
      const stats = await qaApi.getTaskStats(taskId);
      set({ stats });
    } catch (error) {
      console.error('[QA] Failed to load stats:', error);
    }
  },

  refreshStats: async () => {
    const { taskId } = get();
    if (taskId) {
      await get().loadStats(taskId);
    }
  },

  // False Negative / Missing Object Flagging
  flagMissingObject: async ({ frameId, location, suggestedClass, message }) => {
    const { taskId } = get();
    if (!taskId) {
      console.error('[QA] Cannot flag missing object: no task ID');
      return;
    }

    // Optimistic update - add placeholder immediately
    const tempId = `temp-${Date.now()}`;
    const optimisticSuggestion = {
      id: tempId,
      task_id: taskId,
      frame_id: frameId,
      suggestion_type: 'false_negative' as const,
      severity: 'high' as const,
      message: message || `Missing object at (${location.x.toFixed(1)}, ${location.y.toFixed(1)}, ${location.z.toFixed(1)})`,
      details: { location, suggested_class: suggestedClass },
      is_dismissed: false,
      created_at: new Date().toISOString(),
    };

    set(state => ({
      suggestions: [...state.suggestions, optimisticSuggestion],
    }));

    try {
      const suggestion = await qaApi.createManualSuggestion({
        taskId,
        frameId,
        message: optimisticSuggestion.message,
        suggestionType: 'false_negative',
        severity: 'high',
        location,
        suggestedClass,
      });
      // Replace temp suggestion with real one from server
      set(state => ({
        suggestions: state.suggestions.map(s =>
          s.id === tempId ? suggestion : s
        ),
      }));
      console.log('[QA] Flagged missing object saved successfully:', suggestion);
    } catch (error) {
      // Remove optimistic suggestion on error
      set(state => ({
        suggestions: state.suggestions.filter(s => s.id !== tempId),
      }));
      console.error('[QA] Failed to flag missing object:', error);
      throw error;
    }
  },

  // Rejection Modal
  openRejectionModal: (annotationId: string, frameId?: string, classId?: string) => {
    set({
      showRejectionModal: true,
      rejectionAnnotationId: annotationId,
      rejectionFrameId: frameId ?? null,
      rejectionClassId: classId ?? null,
    });
  },

  closeRejectionModal: () => {
    set({
      showRejectionModal: false,
      rejectionAnnotationId: null,
      rejectionFrameId: null,
      rejectionClassId: null,
    });
  },

  // Annotation Navigation
  setAnnotationList: (ids: string[]) => {
    set({ annotationIds: ids, currentAnnotationIndex: 0 });
  },

  nextAnnotation: () => {
    const { annotationIds, currentAnnotationIndex } = get();
    if (annotationIds.length === 0) return null;

    const nextIndex = (currentAnnotationIndex + 1) % annotationIds.length;
    set({ currentAnnotationIndex: nextIndex });
    return annotationIds[nextIndex];
  },

  prevAnnotation: () => {
    const { annotationIds, currentAnnotationIndex } = get();
    if (annotationIds.length === 0) return null;

    const prevIndex = (currentAnnotationIndex - 1 + annotationIds.length) % annotationIds.length;
    set({ currentAnnotationIndex: prevIndex });
    return annotationIds[prevIndex];
  },

  goToAnnotation: (index: number) => {
    const { annotationIds } = get();
    if (index < 0 || index >= annotationIds.length) return null;

    set({ currentAnnotationIndex: index });
    return annotationIds[index];
  },

  goToAnnotationById: (id: string) => {
    const { annotationIds } = get();
    const index = annotationIds.indexOf(id);
    if (index !== -1) {
      set({ currentAnnotationIndex: index });
    }
  },

  getCurrentAnnotationId: () => {
    const { annotationIds, currentAnnotationIndex } = get();
    return annotationIds[currentAnnotationIndex] ?? null;
  },

  getNavigationProgress: () => {
    const { annotationIds, currentAnnotationIndex } = get();
    return {
      current: annotationIds.length > 0 ? currentAnnotationIndex + 1 : 0,
      total: annotationIds.length,
    };
  },

  // Auto-advance settings
  setAutoAdvance: (enabled: boolean) => {
    set({ autoAdvanceEnabled: enabled });
  },

  // Frame navigation callbacks (set by editor)
  setFrameNavigationCallbacks: (nextFrame: () => void, selectAnnotation: (id: string) => void) => {
    set({
      _nextFrameCallback: nextFrame,
      _selectAnnotationCallback: selectAnnotation,
    });
  },

  // Auto-advance after review - moves to next annotation or next frame
  advanceAfterReview: () => {
    const {
      autoAdvanceEnabled,
      annotationIds,
      currentAnnotationIndex,
      _nextFrameCallback,
      _selectAnnotationCallback,
    } = get();

    if (!autoAdvanceEnabled) return;

    // Check if we're at the last annotation in this frame
    const isLastAnnotation = currentAnnotationIndex >= annotationIds.length - 1;

    if (isLastAnnotation) {
      // Move to next frame
      if (_nextFrameCallback) {
        _nextFrameCallback();
        // Reset to first annotation (will be updated by frame change)
        set({ currentAnnotationIndex: 0 });
      }
    } else {
      // Move to next annotation in this frame
      const nextIndex = currentAnnotationIndex + 1;
      const nextId = annotationIds[nextIndex];
      set({ currentAnnotationIndex: nextIndex });

      // Select the annotation in the editor
      if (nextId && _selectAnnotationCallback) {
        _selectAnnotationCallback(nextId);
      }
    }
  },
}));

// Selectors
export const useIsQAMode = () => useQAStore(state => state.isQAMode);
export const useQASession = () => useQAStore(state => state.qaSession);
export const useQAMode = () => useQAStore(state => state.qaMode);
export const useQASuggestions = () => useQAStore(state => state.suggestions);
export const useCurrentSuggestion = () => useQAStore(state => state.getCurrentSuggestion());
export const useQAStats = () => useQAStore(state => state.stats);
export const useAnnotationReview = (annotationId: string) =>
  useQAStore(state => state.annotationReviews.get(annotationId));

// Get suggestions mapped by annotation ID for quick lookup
export const useSuggestionsByAnnotation = () => useQAStore(state => {
  const map = new Map<string, { count: number; maxSeverity: 'low' | 'medium' | 'high' | 'critical' }>();
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

  const validSuggestions = state.suggestions.filter(s => !s.is_dismissed && s.annotation_id);

  validSuggestions.forEach(s => {
      const existing = map.get(s.annotation_id!);
      const severity = s.severity as 'low' | 'medium' | 'high' | 'critical';
      if (existing) {
        existing.count++;
        if ((severityOrder[s.severity] ?? 3) < (severityOrder[existing.maxSeverity] ?? 3)) {
          existing.maxSeverity = severity;
        }
      } else {
        map.set(s.annotation_id!, { count: 1, maxSeverity: severity });
      }
    });

  return map;
});

// Annotation Navigation Selectors
export const useQAAnnotationNavigation = () => useQAStore(state => ({
  annotationIds: state.annotationIds,
  currentIndex: state.currentAnnotationIndex,
  currentId: state.annotationIds[state.currentAnnotationIndex] ?? null,
  total: state.annotationIds.length,
  hasNext: state.annotationIds.length > 1,
  hasPrev: state.annotationIds.length > 1,
}));
export const useCurrentQAAnnotationId = () => useQAStore(state =>
  state.annotationIds[state.currentAnnotationIndex] ?? null
);

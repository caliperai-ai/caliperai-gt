import React, { useEffect } from 'react';
import { useQAStore, useIsQAMode, useQASession, useQAStats, useQAAnnotationNavigation } from '@/store/qaStore';
import { useEditorStore, useCurrentFrameAnnotations } from '@/store/editorStore';
import { QAProgressBar } from './QAProgressBar';
import type { QAReviewMode } from '@/types';

const PlayIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const PauseIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

const SparklesIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  </svg>
);

const XIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const ChevronUpIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

interface QABannerProps {
  taskId: string;
  taskStage: string;
  mode?: QAReviewMode;
}

export const QABanner: React.FC<QABannerProps> = ({ taskId, taskStage, mode = 'view_only' }) => {
  const isQAMode = useIsQAMode();
  const session = useQASession();
  const stats = useQAStats();
  const navigation = useQAAnnotationNavigation();
  const {
    startQASession, pauseQASession, resumeQASession, endQASession, exitQAMode,
    setAnnotationList, nextAnnotation, prevAnnotation,
    autoAdvanceEnabled, setAutoAdvance
  } = useQAStore();
  const selectAnnotation = useEditorStore((s) => s.selectAnnotation);
  const currentFrameAnnotations = useCurrentFrameAnnotations();

  const [isLoading, setIsLoading] = React.useState(false);
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const [completionResult, setCompletionResult] = React.useState<{
    outcome: string;
    next_stage: string;
    approved: number;
    rejected: number;
    flagged: number;
  } | null>(null);

  const handleNextAnnotation = React.useCallback(() => {
    const nextId = nextAnnotation();
    if (nextId) {
      selectAnnotation(nextId);
    }
  }, [nextAnnotation, selectAnnotation]);

  const handlePrevAnnotation = React.useCallback(() => {
    const prevId = prevAnnotation();
    if (prevId) {
      selectAnnotation(prevId);
    }
  }, [prevAnnotation, selectAnnotation]);

  const prevAnnotationIdsRef = React.useRef<string>('');

  useEffect(() => {
    if (isQAMode && currentFrameAnnotations.length > 0) {
      const ids = currentFrameAnnotations.map(a => a.id);
      const idsKey = ids.join(',');

      if (idsKey !== prevAnnotationIdsRef.current) {
        prevAnnotationIdsRef.current = idsKey;
        setAnnotationList(ids);
      }
    }
  }, [isQAMode, currentFrameAnnotations, setAnnotationList]);

  useEffect(() => {
    const isQAStage = taskStage === 'qa' || taskStage === 'customer_qa';
    if (!isQAMode || !isQAStage) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'n' || e.key === 'N') {
        handleNextAnnotation();
      } else if (e.key === 'ArrowLeft' || e.key === 'p' || e.key === 'P') {
        handlePrevAnnotation();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isQAMode, taskStage, handleNextAnnotation, handlePrevAnnotation]);


  if (taskStage !== 'qa' && taskStage !== 'customer_qa') {
    return null;
  }


  const handleStartQA = async () => {
    setIsLoading(true);
    try {
      await startQASession(taskId, mode, taskStage);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePauseQA = async () => {
    setIsLoading(true);
    try {
      await pauseQASession();
    } finally {
      setIsLoading(false);
    }
  };

  const handleResumeQA = async () => {
    if (!session) return;
    setIsLoading(true);
    try {
      await resumeQASession(session.id);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCompleteQA = async () => {
    setIsLoading(true);
    try {
      const summary = await endQASession();
      if (summary) {
        setCompletionResult({
          outcome: summary.outcome || 'no_change',
          next_stage: summary.next_stage || taskStage,
          approved: summary.approved,
          rejected: summary.rejected,
          flagged: summary.flagged,
        });
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleDismissResult = () => {
    const nextStage = completionResult?.next_stage;
    setCompletionResult(null);

    if (nextStage && nextStage !== taskStage) {
      window.location.reload();
    }
  };

  if (!isQAMode || !session) {
    if (isCollapsed) {
      return (
        <div className="absolute top-16 right-4 z-50">
          <button
            onClick={() => setIsCollapsed(false)}
            className="flex items-center gap-2 px-3 py-1.5 bg-purple-600/80 hover:bg-purple-500 rounded-lg text-sm transition-colors shadow-lg"
            title="Show QA panel"
          >
            <SparklesIcon />
            <span className="text-purple-200">QA</span>
            <ChevronDownIcon />
          </button>
        </div>
      );
    }

    return (
      <div className="absolute top-16 right-4 z-50 flex items-center gap-2">
        <button
          onClick={handleStartQA}
          disabled={isLoading}
          className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg font-medium text-sm transition-colors shadow-lg"
        >
          <SparklesIcon />
          {isLoading ? 'Starting...' : 'Start QA Session'}
        </button>
        <button
          onClick={() => setIsCollapsed(true)}
          className="p-2 bg-gray-700/80 hover:bg-gray-600 rounded-lg transition-colors"
          title="Minimize QA panel"
        >
          <ChevronUpIcon />
        </button>
      </div>
    );
  }

  const isPaused = session.status === 'paused';

  if (isCollapsed) {
    return (
      <div className="absolute top-16 right-4 z-50">
        <button
          onClick={() => setIsCollapsed(false)}
          className="flex items-center gap-3 px-3 py-2 bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-500 hover:to-blue-500 rounded-lg text-sm transition-all shadow-lg"
          title="Expand QA panel"
        >
          <SparklesIcon />
          <span className="font-medium">QA Mode</span>
          {stats && (
            <span className="text-xs opacity-80">
              {stats.reviewed_count}/{stats.total_annotations}
            </span>
          )}
          {isPaused && <span className="text-yellow-300 text-xs">(Paused)</span>}
          <ChevronDownIcon />
        </button>
      </div>
    );
  }

  return (
    <div className="relative z-50 bg-gradient-to-r from-purple-900/80 to-blue-900/80 border-b border-purple-500/30">
      {/* Main Banner Row */}
      <div className="flex items-center justify-between px-4 py-2">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-purple-300">
            <SparklesIcon />
            <span className="font-medium">QA Mode</span>
            {isPaused && (
              <span className="px-2 py-0.5 bg-yellow-500/20 text-yellow-400 text-xs rounded">
                Paused
              </span>
            )}
          </div>

          {/* Stats */}
          {stats && (
            <div className="flex items-center gap-4 text-sm">
              <span className="text-gray-400">
                Reviewed: <span className="text-white font-medium">{stats.reviewed_count}</span> / {stats.total_annotations}
              </span>
              <span className="text-green-400">
                ✓ {stats.approved_count}
              </span>
              <span className="text-red-400">
                ✗ {stats.rejected_count}
              </span>
              <span className="text-yellow-400">
                ⚑ {stats.flagged_count}
              </span>
            </div>
          )}

          {/* Annotation Navigation */}
          {navigation.total > 0 && (
            <div className="flex items-center gap-2 ml-4 pl-4 border-l border-purple-500/30">
              <button
                onClick={handlePrevAnnotation}
                disabled={navigation.total <= 1}
                className="p-1.5 bg-purple-600/50 hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors"
                title="Previous annotation (← or P)"
              >
                <ChevronLeftIcon />
              </button>
              <span className="text-sm font-medium min-w-[60px] text-center">
                <span className="text-white">{navigation.currentIndex + 1}</span>
                <span className="text-gray-400"> / {navigation.total}</span>
              </span>
              <button
                onClick={handleNextAnnotation}
                disabled={navigation.total <= 1}
                className="p-1.5 bg-purple-600/50 hover:bg-purple-500 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg transition-colors"
                title="Next annotation (→ or N)"
              >
                <ChevronRightIcon />
              </button>

              {/* Auto-advance toggle */}
              <button
                onClick={() => setAutoAdvance(!autoAdvanceEnabled)}
                className={`ml-2 px-2 py-1 text-xs rounded transition-colors ${
                  autoAdvanceEnabled
                    ? 'bg-green-600/50 text-green-300 hover:bg-green-500/50'
                    : 'bg-gray-600/50 text-gray-400 hover:bg-gray-500/50'
                }`}
                title={autoAdvanceEnabled ? 'Auto-advance ON: automatically moves to next after review' : 'Auto-advance OFF: stay on current after review'}
              >
                {autoAdvanceEnabled ? '⏩ Auto' : '⏸ Manual'}
              </button>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Pause/Resume */}
          {isPaused ? (
            <button
              onClick={handleResumeQA}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 disabled:opacity-50 rounded-lg text-sm transition-colors"
            >
              <PlayIcon />
              Resume
            </button>
          ) : (
            <button
              onClick={handlePauseQA}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-1.5 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 rounded-lg text-sm transition-colors"
            >
              <PauseIcon />
              Pause
            </button>
          )}

          {/* Complete QA */}
          <button
            onClick={handleCompleteQA}
            disabled={isLoading}
            className="flex items-center gap-2 px-3 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 rounded-lg text-sm transition-colors"
          >
            <CheckIcon />
            Complete Review
          </button>

          {/* Minimize Banner */}
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 text-gray-400 hover:text-white transition-colors"
            title="Minimize QA panel"
          >
            <ChevronUpIcon />
          </button>

          {/* Exit QA Mode */}
          <button
            onClick={exitQAMode}
            className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
            title="Exit QA Mode"
          >
            <XIcon />
          </button>
        </div>
      </div>

      {/* Progress Bar Row */}
      {stats && (
        <div className="px-4 pb-2">
          <QAProgressBar />
        </div>
      )}

      {/* Completion Result Modal */}
      {completionResult && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[100]">
          <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
            {/* Header */}
            <div className="flex items-center gap-3 mb-4">
              {/* Always show as completed - no rejection outcome */}
              <div className="w-12 h-12 bg-green-600 rounded-full flex items-center justify-center">
                <CheckIcon />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Review Completed</h3>
                <p className="text-sm text-green-400">QA review session finished</p>
              </div>
            </div>

            {/* Summary */}
            <div className="bg-gray-900 rounded-lg p-4 mb-4">
              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-2xl font-bold text-green-400">{completionResult.approved}</div>
                  <div className="text-xs text-gray-400">Approved</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-red-400">{completionResult.rejected}</div>
                  <div className="text-xs text-gray-400">Rejected</div>
                </div>
                <div>
                  <div className="text-2xl font-bold text-yellow-400">{completionResult.flagged}</div>
                  <div className="text-xs text-gray-400">Flagged</div>
                </div>
              </div>
            </div>

            {/* Next Stage Info */}
            <div className="bg-blue-900/30 border border-blue-500/30 rounded-lg p-3 mb-4">
              <p className="text-sm text-blue-300">
                Task will move to <span className="font-semibold text-white">
                  {completionResult.next_stage === 'customer_qa' ? 'Customer QA' :
                   completionResult.next_stage === 'accepted' ? 'Accepted' :
                   completionResult.next_stage === 'qa' ? 'QA' :
                   completionResult.next_stage === 'annotation' ? 'Annotation' :
                   completionResult.next_stage}
                </span> stage.
              </p>
            </div>

            {/* Action Button */}
            <button
              onClick={handleDismissResult}
              className="w-full py-2 bg-blue-600 hover:bg-blue-500 rounded-lg font-medium text-sm transition-colors"
            >
              {completionResult.next_stage !== taskStage ? 'Close & Refresh' : 'Close'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default QABanner;

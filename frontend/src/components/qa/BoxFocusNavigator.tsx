import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { BoxDifficulty } from '@/utils/trackDifficultyScorer';
import { getDifficultyLevel } from '@/utils/trackDifficultyScorer';

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

const ZoomInIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v3m0 0v3m0-3h3m-3 0H7" />
  </svg>
);

const ZoomOutIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
  </svg>
);

type ReviewVerdict = 'approved' | 'rejected' | 'flagged' | 'pending';

interface BoxReviewState {
  annotationId: string;
  verdict: ReviewVerdict;
}

interface BoxFocusNavigatorProps {
  boxes: BoxDifficulty[];
  trackId: string;
  className: string;
  classColor: string;
  currentIndex: number;
  reviewStates: Map<string, BoxReviewState>;
  onNavigate: (index: number) => void;
  onFocusBox: (annotationId: string, frameId: string, zoomLevel?: number) => void;
  onApprove: (annotationId: string) => void;
  onReject: (annotationId: string) => void;
  onFlag: (annotationId: string) => void;
  onApproveAll: () => void;
  onCompleteTrack: () => void;
  autoAdvance?: boolean;
  onAutoAdvanceChange?: (enabled: boolean) => void;
}

export const BoxFocusNavigator: React.FC<BoxFocusNavigatorProps> = ({
  boxes,
  trackId,
  className,
  classColor,
  currentIndex,
  reviewStates,
  onNavigate,
  onFocusBox,
  onApprove,
  onReject,
  onFlag,
  onApproveAll,
  onCompleteTrack,
  autoAdvance = true,
  onAutoAdvanceChange,
}) => {
  const [zoomLevel, setZoomLevel] = useState(2);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const boxRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  const currentIndexRef = useRef(currentIndex);
  const autoAdvanceRef = useRef(autoAdvance);
  const boxesLengthRef = useRef(boxes.length);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
    autoAdvanceRef.current = autoAdvance;
    boxesLengthRef.current = boxes.length;
  }, [currentIndex, autoAdvance, boxes.length]);

  const reviewProgress = useMemo(() => {
    const reviewed = boxes.filter(b => {
      const verdict = reviewStates.get(b.annotationId)?.verdict;
      return verdict && verdict !== 'pending';
    }).length;
    return {
      reviewed,
      total: boxes.length,
      percent: boxes.length > 0 ? Math.round((reviewed / boxes.length) * 100) : 0,
      approved: boxes.filter(b => reviewStates.get(b.annotationId)?.verdict === 'approved').length,
      rejected: boxes.filter(b => reviewStates.get(b.annotationId)?.verdict === 'rejected').length,
      flagged: boxes.filter(b => reviewStates.get(b.annotationId)?.verdict === 'flagged').length,
    };
  }, [boxes, reviewStates]);

  const goToBox = useCallback((index: number) => {
    if (index >= 0 && index < boxes.length) {
      onNavigate(index);
      const box = boxes[index];
      onFocusBox(box.annotationId, box.frameId, zoomLevel);
    }
  }, [boxes, onNavigate, onFocusBox, zoomLevel]);

  const advanceToNext = useCallback(() => {
    const idx = currentIndexRef.current;
    const len = boxesLengthRef.current;
    if (idx < len - 1) {
      const nextIdx = idx + 1;
      onNavigate(nextIdx);
      const box = boxes[nextIdx];
      if (box) {
        onFocusBox(box.annotationId, box.frameId, zoomLevel);
      }
    }
  }, [boxes, onNavigate, onFocusBox, zoomLevel]);

  const handleApproveBox = useCallback((annotationId: string, isCurrentBox: boolean) => {
    onApprove(annotationId);
    if (isCurrentBox && autoAdvanceRef.current) {
      setTimeout(advanceToNext, 100);
    }
  }, [onApprove, advanceToNext]);

  const handleRejectBox = useCallback((annotationId: string, isCurrentBox: boolean) => {
    onReject(annotationId);
    if (isCurrentBox && autoAdvanceRef.current) {
      setTimeout(advanceToNext, 100);
    }
  }, [onReject, advanceToNext]);

  const handleFlagBox = useCallback((annotationId: string, isCurrentBox: boolean) => {
    onFlag(annotationId);
    if (isCurrentBox && autoAdvanceRef.current) {
      setTimeout(advanceToNext, 100);
    }
  }, [onFlag, advanceToNext]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      const idx = currentIndexRef.current;
      const len = boxesLengthRef.current;

      switch (e.key) {
        case 'ArrowDown':
        case 'j':
        case 'J':
          e.preventDefault();
          if (idx < len - 1) goToBox(idx + 1);
          break;
        case 'ArrowUp':
        case 'k':
        case 'K':
          e.preventDefault();
          if (idx > 0) goToBox(idx - 1);
          break;
        case '1':
          e.preventDefault();
          if (boxes[idx]) {
            handleApproveBox(boxes[idx].annotationId, true);
          }
          break;
        case '2':
          e.preventDefault();
          if (boxes[idx]) {
            handleRejectBox(boxes[idx].annotationId, true);
          }
          break;
        case '3':
          e.preventDefault();
          if (boxes[idx]) {
            handleFlagBox(boxes[idx].annotationId, true);
          }
          break;
        case '+':
        case '=':
          e.preventDefault();
          setZoomLevel(z => Math.min(4, z + 1));
          break;
        case '-':
          e.preventDefault();
          setZoomLevel(z => Math.max(1, z - 1));
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [boxes, goToBox, handleApproveBox, handleRejectBox, handleFlagBox]);

  useEffect(() => {
    const selectedRef = boxRefs.current.get(currentIndex);
    if (selectedRef) {
      selectedRef.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [currentIndex]);

  useEffect(() => {
    const box = boxes[currentIndex];
    if (box) {
      onFocusBox(box.annotationId, box.frameId, zoomLevel);
    }
  }, [currentIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  if (boxes.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500">
        No boxes to review
      </div>
    );
  }

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-700 overflow-hidden flex flex-col h-full max-h-[calc(100vh-180px)]">
      {/* Header with track info */}
      <div className="flex-shrink-0 px-4 py-3 bg-gradient-to-r from-gray-800 to-gray-900 border-b border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className="w-4 h-4 rounded-full"
              style={{ backgroundColor: classColor }}
            />
            <div>
              <h3 className="text-sm font-semibold text-white">{className}</h3>
              <span className="text-xs text-gray-500 font-mono">Track: {trackId.slice(0, 8)}</span>
            </div>
          </div>

          {/* Progress */}
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-sm font-medium text-white">
                {reviewProgress.reviewed} / {reviewProgress.total}
              </div>
              <div className="text-xs text-gray-500">
                {reviewProgress.percent}% done
              </div>
            </div>
            <div className="w-16 h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-green-500 transition-all"
                style={{ width: `${reviewProgress.percent}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Controls bar */}
      <div className="flex-shrink-0 px-3 py-2 border-b border-gray-700 bg-gray-800/50">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className="text-gray-500">Zoom:</span>
            <button
              onClick={() => setZoomLevel(z => Math.max(1, z - 1))}
              disabled={zoomLevel <= 1}
              className="p-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded"
            >
              <ZoomOutIcon />
            </button>
            <span className="w-5 text-center font-medium">{zoomLevel}x</span>
            <button
              onClick={() => setZoomLevel(z => Math.min(4, z + 1))}
              disabled={zoomLevel >= 4}
              className="p-1 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded"
            >
              <ZoomInIcon />
            </button>
          </div>

          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(e) => onAutoAdvanceChange?.(e.target.checked)}
              className="w-3 h-3 rounded border-gray-600 bg-gray-700 text-blue-500"
            />
            <span className="text-gray-400">Auto-next</span>
          </label>

          <div className="flex items-center gap-1 text-gray-600">
            <kbd className="px-1 bg-gray-700 rounded">↑↓</kbd>
            <kbd className="px-1 bg-gray-700 rounded">1</kbd>✓
            <kbd className="px-1 bg-gray-700 rounded">2</kbd>✗
            <kbd className="px-1 bg-gray-700 rounded">3</kbd>!
          </div>
        </div>
      </div>

      {/* Scrollable box list - ALL boxes always visible */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto"
      >
        <div className="p-2 space-y-1">
          {boxes.map((box, idx) => {
            const isSelected = idx === currentIndex;
            const review = reviewStates.get(box.annotationId);
            const diffInfo = getDifficultyLevel(box.score);
            const verdict = review?.verdict || 'pending';
            const isPending = verdict === 'pending';

            return (
              <div
                key={box.annotationId}
                ref={(el) => {
                  if (el) boxRefs.current.set(idx, el);
                  else boxRefs.current.delete(idx);
                }}
                onClick={() => goToBox(idx)}
                className={`
                  rounded-lg cursor-pointer transition-all duration-150
                  ${isSelected
                    ? 'bg-blue-600/20 border-2 border-blue-500 shadow-lg shadow-blue-500/10'
                    : 'bg-gray-800/40 border border-gray-700/50 hover:bg-gray-800/70 hover:border-gray-600'
                  }
                `}
              >
                <div className="flex items-center gap-2 p-2">
                  {/* Box number */}
                  <div className={`
                    flex-shrink-0 w-7 h-7 rounded flex items-center justify-center text-xs font-bold
                    ${isSelected ? 'bg-blue-500 text-white' : 'bg-gray-700/70 text-gray-400'}
                  `}>
                    {idx + 1}
                  </div>

                  {/* Difficulty */}
                  <div className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${diffInfo.bgColor} ${diffInfo.color}`}>
                    {diffInfo.emoji}{box.score}
                  </div>

                  {/* Details */}
                  <div className="flex-1 flex items-center gap-2 text-xs text-gray-400 min-w-0">
                    <span>📍{box.factors.distance.toFixed(0)}m</span>
                    <span>📦{box.factors.size.toFixed(1)}m³</span>
                    {box.factors.occlusion > 0.3 && <span className="text-orange-400">👁️{Math.round(box.factors.occlusion * 100)}%</span>}
                    {box.factors.isInterpolated && <span className="text-purple-400">🤖</span>}
                  </div>

                  {/* Action buttons - always visible */}
                  <div className="flex-shrink-0 flex items-center gap-1">
                    {isPending ? (
                      <>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleApproveBox(box.annotationId, isSelected); }}
                          className={`p-1.5 rounded transition-colors ${isSelected ? 'bg-green-600 hover:bg-green-500' : 'bg-green-600/30 hover:bg-green-600/60'} text-green-100`}
                          title="Approve (1)"
                        >
                          <CheckIcon />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRejectBox(box.annotationId, isSelected); }}
                          className={`p-1.5 rounded transition-colors ${isSelected ? 'bg-red-600 hover:bg-red-500' : 'bg-red-600/30 hover:bg-red-600/60'} text-red-100`}
                          title="Reject (2)"
                        >
                          <XIcon />
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleFlagBox(box.annotationId, isSelected); }}
                          className={`p-1.5 rounded transition-colors ${isSelected ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-yellow-600/30 hover:bg-yellow-600/60'} text-yellow-100`}
                          title="Flag (3)"
                        >
                          <FlagIcon />
                        </button>
                      </>
                    ) : (
                      <span className={`
                        px-2 py-1 rounded text-xs font-bold
                        ${verdict === 'approved' ? 'bg-green-500/30 text-green-400' :
                          verdict === 'rejected' ? 'bg-red-500/30 text-red-400' :
                          'bg-yellow-500/30 text-yellow-400'}
                      `}>
                        {verdict === 'approved' ? '✓ Approved' : verdict === 'rejected' ? '✗ Rejected' : '! Flagged'}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Footer with stats and bulk actions */}
      <div className="flex-shrink-0 px-3 py-2 bg-gray-800/50 border-t border-gray-700">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-green-400">
              <span className="w-2 h-2 bg-green-500 rounded-full" />
              {reviewProgress.approved}
            </span>
            <span className="flex items-center gap-1 text-red-400">
              <span className="w-2 h-2 bg-red-500 rounded-full" />
              {reviewProgress.rejected}
            </span>
            <span className="flex items-center gap-1 text-yellow-400">
              <span className="w-2 h-2 bg-yellow-500 rounded-full" />
              {reviewProgress.flagged}
            </span>
            <span className="text-gray-500">• {boxes.length - reviewProgress.reviewed} pending</span>
          </div>

          <div className="flex items-center gap-2">
            {boxes.length - reviewProgress.reviewed > 0 && (
              <button
                onClick={onApproveAll}
                className="px-2 py-1 bg-green-600/50 hover:bg-green-600 rounded text-xs font-medium transition-colors"
              >
                ✓ Approve All ({boxes.length - reviewProgress.reviewed})
              </button>
            )}

            {reviewProgress.reviewed === reviewProgress.total && (
              <button
                onClick={onCompleteTrack}
                className="px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium transition-colors"
              >
                Next Track →
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default BoxFocusNavigator;

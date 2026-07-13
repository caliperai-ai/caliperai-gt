import React, { useMemo } from 'react';
import type { DifficultyScore } from '@/utils/trackDifficultyScorer';
import { getDifficultyLevel } from '@/utils/trackDifficultyScorer';

const PlayIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
  </svg>
);

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const FlagIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const AlertIcon = () => (
  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

interface TrackReviewCardProps {
  trackId: string;
  className: string;
  classColor: string;
  difficulty: DifficultyScore;
  frameCount: number;
  keyframeCount: number;
  suggestionCount: number;
  isSelected?: boolean;
  isReviewed?: boolean;
  verdict?: 'approved' | 'rejected' | 'flagged';
  onSelect: () => void;
  onApprove: () => void;
  onReject: () => void;
  onFlag: () => void;
}

export const TrackReviewCard: React.FC<TrackReviewCardProps> = ({
  trackId,
  className,
  classColor,
  difficulty,
  frameCount,
  keyframeCount,
  suggestionCount,
  isSelected,
  isReviewed,
  verdict,
  onSelect,
  onApprove,
  onReject: _onReject,
  onFlag,
}) => {
  const difficultyLevel = useMemo(() => getDifficultyLevel(difficulty.totalScore), [difficulty.totalScore]);

  const shortTrackId = trackId.slice(0, 8);

  const verdictStyles = useMemo(() => {
    if (!verdict) return null;
    const styles = {
      approved: { bg: 'bg-green-500/10 border-green-500/50', icon: '✓', text: 'text-green-400' },
      rejected: { bg: 'bg-red-500/10 border-red-500/50', icon: '✗', text: 'text-red-400' },
      flagged: { bg: 'bg-yellow-500/10 border-yellow-500/50', icon: '!', text: 'text-yellow-400' },
    };
    return styles[verdict];
  }, [verdict]);

  return (
    <div
      className={`
        relative p-3 rounded-lg border transition-all cursor-pointer
        ${isSelected
          ? 'bg-blue-500/20 border-blue-500 ring-2 ring-blue-500/50'
          : verdictStyles
            ? `${verdictStyles.bg} border`
            : 'bg-gray-800/50 border-gray-700 hover:bg-gray-800 hover:border-gray-600'
        }
      `}
      onClick={onSelect}
    >
      {/* Priority badge - top left */}
      <div className={`
        absolute -top-2 -left-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
        ${difficulty.priorityRank <= 3 ? 'bg-red-500 text-white' :
          difficulty.priorityRank <= 10 ? 'bg-orange-500 text-white' :
          'bg-gray-600 text-gray-200'}
      `}>
        {difficulty.priorityRank}
      </div>

      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {/* Class color indicator */}
          <div
            className="w-3 h-3 rounded-full flex-shrink-0"
            style={{ backgroundColor: classColor }}
          />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-medium text-white truncate">
                {className}
              </span>
              {suggestionCount > 0 && (
                <span className="flex items-center gap-0.5 px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded text-xs">
                  <AlertIcon />
                  {suggestionCount}
                </span>
              )}
            </div>
            <span className="text-xs text-gray-500 font-mono">
              {shortTrackId}
            </span>
          </div>
        </div>

        {/* Difficulty badge */}
        <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${difficultyLevel.bgColor} ${difficultyLevel.color}`}>
          <span>{difficultyLevel.emoji}</span>
          <span>{difficulty.totalScore}</span>
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-xs text-gray-400 mb-2">
        <span title="Total frames">
          📹 {frameCount} frames
        </span>
        <span title="Keyframes (manually annotated)">
          🔑 {keyframeCount} keyframes
        </span>
        {verdict && (
          <span className={verdictStyles?.text}>
            {verdictStyles?.icon} {verdict}
          </span>
        )}
      </div>

      {/* Issues preview */}
      {difficulty.issues.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {difficulty.issues.slice(0, 3).map((issue, idx) => (
            <span
              key={idx}
              className="px-1.5 py-0.5 bg-gray-700/50 text-gray-300 rounded text-xs truncate max-w-[140px]"
              title={issue}
            >
              {issue}
            </span>
          ))}
          {difficulty.issues.length > 3 && (
            <span className="px-1.5 py-0.5 bg-gray-700/50 text-gray-400 rounded text-xs">
              +{difficulty.issues.length - 3} more
            </span>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex items-center gap-2 mt-2 pt-2 border-t border-gray-700/50">
        <button
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
          className="flex items-center gap-1 px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-xs font-medium transition-colors"
          title="Review this track"
        >
          <PlayIcon />
          Review
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); onApprove(); }}
          className="flex items-center gap-1 px-2 py-1 bg-green-600/80 hover:bg-green-500 rounded text-xs font-medium transition-colors"
          title="Approve entire track"
        >
          <CheckIcon />
        </button>

        <button
          onClick={(e) => { e.stopPropagation(); onFlag(); }}
          className="flex items-center gap-1 px-2 py-1 bg-yellow-600/80 hover:bg-yellow-500 rounded text-xs font-medium transition-colors"
          title="Flag for review"
        >
          <FlagIcon />
        </button>

        <div className="flex-1" />

        <ChevronRightIcon />
      </div>

      {/* Progress indicator for reviewed tracks */}
      {isReviewed && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 rounded-lg pointer-events-none">
          <div className={`text-3xl ${verdictStyles?.text || 'text-gray-400'}`}>
            {verdictStyles?.icon || '?'}
          </div>
        </div>
      )}
    </div>
  );
};

export default TrackReviewCard;

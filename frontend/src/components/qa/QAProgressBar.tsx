import React from 'react';
import { useQAStats, useQASuggestions } from '@/store/qaStore';

export const QAProgressBar: React.FC = () => {
  const stats = useQAStats();
  const suggestions = useQASuggestions();

  const dismissedCount = suggestions.filter(s => s.is_dismissed).length;
  const activeIssues = suggestions.length - dismissedCount;

  if (!stats) {
    return (
      <div className="animate-pulse">
        <div className="h-2 bg-gray-700 rounded-full" />
        <div className="flex justify-between mt-2">
          <div className="h-4 w-20 bg-gray-700 rounded" />
          <div className="h-4 w-12 bg-gray-700 rounded" />
        </div>
      </div>
    );
  }

  const {
    total_annotations,
    reviewed_count,
    approved_count,
    rejected_count,
    flagged_count,
    review_progress_percent,
  } = stats;

  const getPercent = (count: number) =>
    total_annotations > 0 ? (count / total_annotations) * 100 : 0;

  const getOverallStatus = () => {
    if (rejected_count > 0) return { text: 'Issues Found', color: 'text-red-400' };
    if (flagged_count > 0) return { text: 'Needs Review', color: 'text-yellow-400' };
    if (review_progress_percent >= 100) return { text: 'Complete', color: 'text-green-400' };
    return { text: 'In Progress', color: 'text-blue-400' };
  };

  const status = getOverallStatus();

  return (
    <div>
      {/* Header with status */}
      <div className="flex justify-between items-center mb-2">
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-300">
            {reviewed_count}/{total_annotations}
          </span>
          <span className={`text-xs font-medium ${status.color}`}>
            {status.text}
          </span>
        </div>
        <span className="text-sm font-bold text-white">
          {review_progress_percent.toFixed(0)}%
        </span>
      </div>

      {/* Stacked Progress Bar */}
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden flex">
        {/* Approved (green) */}
        <div
          className="bg-green-500 transition-all duration-300"
          style={{ width: `${getPercent(approved_count)}%` }}
          title={`Approved: ${approved_count}`}
        />
        {/* Rejected (red) */}
        <div
          className="bg-red-500 transition-all duration-300"
          style={{ width: `${getPercent(rejected_count)}%` }}
          title={`Rejected: ${rejected_count}`}
        />
        {/* Flagged (yellow) */}
        <div
          className="bg-yellow-500 transition-all duration-300"
          style={{ width: `${getPercent(flagged_count)}%` }}
          title={`Flagged: ${flagged_count}`}
        />
      </div>

      {/* Compact Legend */}
      <div className="flex items-center justify-between mt-2">
        <div className="flex gap-3 text-xs">
          {approved_count > 0 && (
            <span className="flex items-center gap-1 text-green-400">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
              {approved_count}
            </span>
          )}
          {rejected_count > 0 && (
            <span className="flex items-center gap-1 text-red-400">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
              {rejected_count}
            </span>
          )}
          {flagged_count > 0 && (
            <span className="flex items-center gap-1 text-yellow-400">
              <span className="w-1.5 h-1.5 rounded-full bg-yellow-500" />
              {flagged_count}
            </span>
          )}
        </div>

        {/* AI Issues indicator */}
        {activeIssues > 0 && (
          <span className="text-xs text-orange-400">
            ⚠️ {activeIssues} AI issue{activeIssues !== 1 ? 's' : ''}
          </span>
        )}
      </div>
    </div>
  );
};

export default QAProgressBar;

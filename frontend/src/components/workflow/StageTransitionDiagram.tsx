import React from 'react';
import type { TaskStageHistoryItem } from '@/api/client';

interface StageTransitionDiagramProps {
  history: TaskStageHistoryItem[];
  isLoading?: boolean;
}

const STAGE_COLORS: Record<string, { bg: string; border: string; text: string; dot: string }> = {
  annotation: { bg: 'bg-blue-500/20', border: 'border-blue-500/50', text: 'text-blue-400', dot: 'bg-blue-500' },
  qa: { bg: 'bg-orange-500/20', border: 'border-orange-500/50', text: 'text-orange-400', dot: 'bg-orange-500' },
  customer_qa: { bg: 'bg-purple-500/20', border: 'border-purple-500/50', text: 'text-purple-400', dot: 'bg-purple-500' },
  accepted: { bg: 'bg-emerald-500/20', border: 'border-emerald-500/50', text: 'text-emerald-400', dot: 'bg-emerald-500' },
};

const STATUS_ICONS: Record<string, string> = {
  pending: '⏳',
  assigned: '👤',
  in_progress: '🔧',
  submitted: '📤',
  accepted: '✅',
  rejected: '❌',
};

const DEFAULT_COLORS = { bg: 'bg-gray-500/20', border: 'border-gray-500/50', text: 'text-gray-400', dot: 'bg-gray-500' };

function stageLabel(stage: string): string {
  const labels: Record<string, string> = {
    annotation: 'Annotation',
    qa: 'QA Review',
    customer_qa: 'Customer QA',
    accepted: 'Accepted',
  };
  return labels[stage] || stage;
}

function formatTs(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const StageTransitionDiagram: React.FC<StageTransitionDiagramProps> = ({
  history,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <div className="animate-spin w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full" />
        <span className="ml-2 text-sm text-gray-400">Loading transitions...</span>
      </div>
    );
  }

  if (history.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 text-gray-500">
        <span className="text-2xl mb-1">📊</span>
        <span className="text-sm">No stage transitions recorded yet.</span>
      </div>
    );
  }

  const sorted = [...history].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  );

  const isBackward = (h: TaskStageHistoryItem) => {
    const order = ['annotation', 'qa', 'customer_qa', 'accepted'];
    return order.indexOf(h.to_stage) < order.indexOf(h.from_stage);
  };

  return (
    <div className="space-y-0">
      {sorted.map((h, idx) => {
        const fromColors = STAGE_COLORS[h.from_stage] || DEFAULT_COLORS;
        const toColors = STAGE_COLORS[h.to_stage] || DEFAULT_COLORS;
        const backward = isBackward(h);
        const isStageChange = h.from_stage !== h.to_stage;

        return (
          <div key={h.id} className="relative flex items-stretch">
            {/* Vertical timeline line */}
            <div className="flex flex-col items-center mr-3 flex-shrink-0 w-6">
              {/* Dot */}
              <div
                className={`w-3 h-3 rounded-full ring-2 ring-gray-900 flex-shrink-0 ${
                  backward ? 'bg-red-500' : isStageChange ? toColors.dot : 'bg-gray-500'
                }`}
              />
              {/* Line */}
              {idx < sorted.length - 1 && (
                <div className={`w-0.5 flex-1 ${backward ? 'bg-red-500/30' : 'bg-gray-700'}`} />
              )}
            </div>

            {/* Content card */}
            <div
              className={`
                flex-1 mb-2 p-2.5 rounded-lg border text-xs transition-all
                ${backward
                  ? 'bg-red-500/10 border-red-500/30'
                  : isStageChange
                    ? `${toColors.bg} ${toColors.border}`
                    : 'bg-gray-800/50 border-gray-700/40'
                }
              `}
            >
              {/* From → To */}
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* From badge */}
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${fromColors.bg} ${fromColors.text}`}>
                  {STATUS_ICONS[h.from_status] || '•'} {stageLabel(h.from_stage)}/{h.from_status.replace('_', ' ')}
                </span>

                {/* Arrow */}
                <span className={backward ? 'text-red-400' : 'text-gray-400'}>
                  {backward ? '⟲' : '→'}
                </span>

                {/* To badge */}
                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded ${toColors.bg} ${toColors.text} font-semibold`}>
                  {STATUS_ICONS[h.to_status] || '•'} {stageLabel(h.to_stage)}/{h.to_status.replace('_', ' ')}
                </span>
              </div>

              {/* Reason */}
              {h.reason && (
                <p className="mt-1 text-[11px] text-gray-400 italic truncate" title={h.reason}>
                  {h.reason}
                </p>
              )}

              {/* Timestamp */}
              <div className="mt-1 text-[10px] text-gray-500">
                {formatTs(h.created_at)}
              </div>
            </div>
          </div>
        );
      })}

      {/* Summary bar */}
      <div className="flex items-center justify-between px-1 pt-2 text-[10px] text-gray-500 border-t border-gray-800">
        <span>
          {sorted.length} transition{sorted.length !== 1 ? 's' : ''}
          {sorted.filter(isBackward).length > 0 && (
            <span className="ml-2 text-red-400">
              ({sorted.filter(isBackward).length} rejection{sorted.filter(isBackward).length !== 1 ? 's' : ''})
            </span>
          )}
        </span>
        {sorted.length >= 2 && (
          <span>
            Duration: {(() => {
              const ms = new Date(sorted[sorted.length - 1].created_at).getTime() - new Date(sorted[0].created_at).getTime();
              const mins = Math.floor(ms / 60000);
              const hours = Math.floor(mins / 60);
              const days = Math.floor(hours / 24);
              if (days > 0) return `${days}d ${hours % 24}h`;
              if (hours > 0) return `${hours}h ${mins % 60}m`;
              if (mins > 0) return `${mins}m`;
              return '<1m';
            })()}
          </span>
        )}
      </div>
    </div>
  );
};

export default StageTransitionDiagram;

import React from 'react';
import type { TaskStage, TaskStatus } from '@/types';

interface StageProgressPipelineProps {
  currentStage: TaskStage;
  currentStatus: TaskStatus;
  revisionCount?: number;
  compact?: boolean;
  showLabels?: boolean;
  onStageClick?: (stage: TaskStage) => void;
  allowedTransitions?: TaskStage[];
}

const STAGE_ORDER: TaskStage[] = ['annotation', 'qa', 'customer_qa', 'accepted'];

const STAGE_CONFIG: Record<TaskStage, {
  label: string;
  shortLabel: string;
  icon: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  annotation: {
    label: 'Annotation',
    shortLabel: 'Annot',
    icon: '✏️',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    borderColor: 'border-blue-500/50',
  },
  qa: {
    label: 'QA Review',
    shortLabel: 'QA',
    icon: '🔍',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/20',
    borderColor: 'border-orange-500/50',
  },
  customer_qa: {
    label: 'Customer QA',
    shortLabel: 'Cust QA',
    icon: '👁️',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
    borderColor: 'border-purple-500/50',
  },
  accepted: {
    label: 'Completed',
    shortLabel: 'Done',
    icon: '✅',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/20',
    borderColor: 'border-emerald-500/50',
  },
};

const STATUS_INDICATORS: Record<TaskStatus, { pulse: boolean; ring: string }> = {
  pending: { pulse: false, ring: 'ring-gray-500/30' },
  assigned: { pulse: false, ring: 'ring-blue-500/30' },
  in_progress: { pulse: true, ring: 'ring-yellow-500/50' },
  submitted: { pulse: false, ring: 'ring-purple-500/50' },
  accepted: { pulse: false, ring: 'ring-emerald-500/50' },
  rejected: { pulse: true, ring: 'ring-red-500/50' },
};

const DEFAULT_STATUS_INDICATOR = { pulse: false, ring: 'ring-gray-500/30' };

export const StageProgressPipeline: React.FC<StageProgressPipelineProps> = ({
  currentStage,
  currentStatus,
  revisionCount = 0,
  compact = false,
  showLabels = true,
  onStageClick,
  allowedTransitions,
}) => {
  const currentStageIndex = STAGE_ORDER.indexOf(currentStage);
  const statusIndicator = STATUS_INDICATORS[currentStatus] || DEFAULT_STATUS_INDICATOR;

  return (
    <div className={`flex items-center ${compact ? 'gap-1' : 'gap-2'} w-full`}>
      {STAGE_ORDER.map((stage, index) => {
        const config = STAGE_CONFIG[stage];
        const isCompleted = index < currentStageIndex;
        const isCurrent = index === currentStageIndex;
        // const isFuture = index > currentStageIndex; // Reserved for future use
        const isClickable = onStageClick && allowedTransitions?.includes(stage);

        // Show revision badge on annotation stage if there are revisions
        // Hide once task has progressed to customer_qa or accepted (revision is resolved)
        const showRevisionBadge = stage === 'annotation' && revisionCount > 0 && (isCurrent || isCompleted)
          && currentStage !== 'customer_qa' && currentStage !== 'accepted';

        return (
          <React.Fragment key={stage}>
            {/* Stage Node */}
            <div
              className={`
                relative flex items-center justify-center transition-all duration-300
                ${compact ? 'min-w-[32px] h-8' : 'min-w-[40px] h-10'}
                ${isClickable ? 'cursor-pointer hover:scale-105' : ''}
              `}
              onClick={() => isClickable && onStageClick?.(stage)}
              title={`${config.label}${isCurrent ? ' (Current)' : ''}${isCompleted ? ' (Completed)' : ''}`}
            >
              {/* Background Circle/Pill */}
              <div
                className={`
                  flex items-center gap-1.5 px-2 py-1 rounded-full border transition-all duration-300
                  ${isCompleted
                    ? `${config.bgColor} ${config.borderColor} opacity-90`
                    : isCurrent
                      ? `${config.bgColor} ${config.borderColor} ring-2 ${statusIndicator.ring}`
                      : 'bg-gray-800/50 border-gray-700/50 opacity-40'
                  }
                  ${statusIndicator.pulse && isCurrent ? 'animate-pulse' : ''}
                  ${isClickable ? 'hover:opacity-100 hover:ring-2 hover:ring-cyan-500/50' : ''}
                `}
              >
                <span className={`text-sm ${isCurrent || isCompleted ? '' : 'grayscale'}`}>
                  {isCompleted ? '✓' : config.icon}
                </span>
                {showLabels && !compact && (
                  <span className={`text-xs font-medium whitespace-nowrap ${
                    isCurrent ? config.color : isCompleted ? 'text-gray-300' : 'text-gray-500'
                  }`}>
                    {config.shortLabel}
                  </span>
                )}
              </div>

              {/* Revision Badge */}
              {showRevisionBadge && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center ring-2 ring-gray-900">
                  {revisionCount}
                </div>
              )}

              {/* Current Status Indicator */}
              {isCurrent && currentStatus === 'rejected' && (
                <div className="absolute -bottom-4 text-[10px] text-red-400 font-medium whitespace-nowrap">
                  Needs Revision
                </div>
              )}
            </div>

            {/* Connector Arrow */}
            {index < STAGE_ORDER.length - 1 && (
              <div className={`flex-shrink-0 transition-all duration-300 ${compact ? 'w-3' : 'w-4'}`}>
                <svg
                  viewBox="0 0 16 8"
                  className={`w-full h-2 ${
                    index < currentStageIndex
                      ? 'text-gray-400'
                      : 'text-gray-600/30'
                  }`}
                  fill="currentColor"
                >
                  <path d="M0 4 L12 4 M10 1 L14 4 L10 7" strokeWidth="1.5" stroke="currentColor" fill="none"/>
                </svg>
              </div>
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// Compact inline version for task rows
export const StageProgressInline: React.FC<{
  currentStage: TaskStage;
  currentStatus: TaskStatus;
  revisionCount?: number;
}> = ({ currentStage, currentStatus, revisionCount = 0 }) => {
  const currentIndex = STAGE_ORDER.indexOf(currentStage);

  return (
    <div className="flex items-center gap-0.5">
      {STAGE_ORDER.map((stage, idx) => {
        const config = STAGE_CONFIG[stage];
        const isCompleted = idx < currentIndex;
        const isCurrent = idx === currentIndex;

        return (
          <React.Fragment key={stage}>
            <div
              className={`
                w-5 h-5 rounded-full flex items-center justify-center text-[10px]
                transition-all duration-200
                ${isCompleted
                  ? 'bg-gray-600 text-white'
                  : isCurrent
                    ? `${config.bgColor} ${config.color} ring-2 ring-offset-1 ring-offset-gray-900 ${
                        currentStatus === 'rejected' ? 'ring-red-500' :
                        currentStatus === 'in_progress' ? 'ring-yellow-500 animate-pulse' :
                        'ring-current'
                      }`
                    : 'bg-gray-800 text-gray-600'
                }
              `}
              title={`${config.label}${isCurrent ? ` - ${currentStatus}` : ''}`}
            >
              {isCompleted ? '✓' : config.icon}
            </div>
            {idx < STAGE_ORDER.length - 1 && (
              <div className={`w-2 h-0.5 ${idx < currentIndex ? 'bg-gray-600' : 'bg-gray-800'}`} />
            )}
          </React.Fragment>
        );
      })}
      {revisionCount > 0 && currentStage !== 'customer_qa' && currentStage !== 'accepted' && (
        <span className="ml-1.5 px-1 py-0.5 text-[9px] bg-red-500/20 text-red-400 rounded font-medium">
          R{revisionCount}
        </span>
      )}
    </div>
  );
};

export default StageProgressPipeline;

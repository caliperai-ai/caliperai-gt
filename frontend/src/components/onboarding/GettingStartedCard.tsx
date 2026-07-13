import React from 'react';


export type GettingStartedStep = 'upload' | 'taxonomy' | 'tasks';

interface GettingStartedCardProps {
  completedSteps: {
    hasScenes: boolean;
    hasTaxonomy: boolean;
    hasTasks: boolean;
  };
  datasetName: string;
  onUploadClick: () => void;
  onLinkTaxonomyClick: () => void;
  onCreateTaskClick?: () => void;
  compact?: boolean;
}


interface StepCardProps {
  stepNumber: number;
  isCompleted: boolean;
  isActive: boolean;
  icon: string;
  title: string;
  description: string;
  buttonLabel: string;
  buttonColor: string;
  onClick: () => void;
  compact?: boolean;
}

const StepCard: React.FC<StepCardProps> = ({
  stepNumber,
  isCompleted,
  isActive,
  icon,
  title,
  description,
  buttonLabel,
  buttonColor,
  onClick,
  compact = false,
}) => (
  <div
    className={`relative p-4 rounded-xl border transition-all duration-300 ${
      isCompleted
        ? 'bg-green-500/5 border-green-500/30'
        : isActive
          ? `bg-gradient-to-br from-${buttonColor}-500/10 to-${buttonColor}-500/5 border-${buttonColor}-500/40 shadow-lg shadow-${buttonColor}-500/10`
          : 'bg-gray-800/30 border-gray-700/30 opacity-50'
    }`}
  >
    {/* Step number badge */}
    <div className={`absolute -top-2 -left-2 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
      isCompleted ? 'bg-green-500 text-white' : isActive ? `bg-${buttonColor}-500 text-white` : 'bg-gray-700 text-gray-400'
    }`}>
      {isCompleted ? '✓' : stepNumber}
    </div>

    <div className={`flex ${compact ? 'flex-row items-center gap-4' : 'flex-col'}`}>
      <div className={`${compact ? 'flex-1' : ''}`}>
        <div className="flex items-center gap-2 mb-1">
          <span className="text-lg">{icon}</span>
          <h4 className={`font-semibold ${isCompleted ? 'text-green-400' : 'text-white'}`}>{title}</h4>
          {isCompleted && (
            <span className="px-2 py-0.5 text-xs bg-green-500/20 text-green-400 rounded-full font-medium">
              Done
            </span>
          )}
        </div>
        {!compact && (
          <p className="text-sm text-gray-400 mb-3">{description}</p>
        )}
      </div>

      {!isCompleted && isActive && (
        <button
          onClick={onClick}
          className={`${compact ? '' : 'w-full'} px-4 py-2 bg-gradient-to-r from-${buttonColor}-500 to-${buttonColor}-600 text-white rounded-lg font-medium text-sm hover:from-${buttonColor}-400 hover:to-${buttonColor}-500 transition-all shadow-lg shadow-${buttonColor}-500/20`}
        >
          {buttonLabel}
        </button>
      )}
    </div>
  </div>
);

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const GettingStartedCard: React.FC<GettingStartedCardProps> = ({
  completedSteps,
  datasetName,
  onUploadClick,
  onLinkTaxonomyClick,
  onCreateTaskClick,
  compact = false,
}) => {
  const { hasScenes, hasTaxonomy, hasTasks } = completedSteps;

  // Determine progress
  const completedCount = [hasScenes, hasTaxonomy, hasTasks].filter(Boolean).length;
  const isFullySetup = completedCount === 3;

  // If fully setup, show completion state
  if (isFullySetup) {
    return (
      <div className="p-6 bg-gradient-to-br from-green-500/10 to-emerald-500/5 rounded-xl border border-green-500/30 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-green-500/20 flex items-center justify-center">
          <span className="text-3xl">🎉</span>
        </div>
        <h3 className="text-lg font-semibold text-green-400 mb-2">Dataset Ready!</h3>
        <p className="text-gray-400 text-sm">
          Your dataset is fully configured and ready for annotation work.
        </p>
      </div>
    );
  }

  return (
    <div className={`${compact ? 'p-4' : 'p-6'} bg-gradient-to-br from-slate-800/50 to-slate-900/50 rounded-xl border border-slate-700/50`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white flex items-center gap-2">
            <span className="text-xl">🚀</span>
            Get Started
          </h3>
          {!compact && (
            <p className="text-sm text-gray-400 mt-1">
              Complete these steps to set up "{datasetName}"
            </p>
          )}
        </div>

        {/* Progress indicator */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full ${
                  i < completedCount ? 'bg-green-500' : 'bg-gray-600'
                }`}
              />
            ))}
          </div>
          <span className="text-sm text-gray-400">{completedCount}/3</span>
        </div>
      </div>

      {/* Steps */}
      <div className={`${compact ? 'space-y-2' : 'space-y-3'}`}>
        <StepCard
          stepNumber={1}
          isCompleted={hasScenes}
          isActive={!hasScenes}
          icon="📤"
          title="Upload Data"
          description="Import your LiDAR point clouds, camera images, and calibration files."
          buttonLabel="Upload Now"
          buttonColor="cyan"
          onClick={onUploadClick}
          compact={compact}
        />

        <StepCard
          stepNumber={2}
          isCompleted={hasTaxonomy}
          isActive={!hasTaxonomy}
          icon="🏷️"
          title="Configure Taxonomy"
          description="Link a taxonomy to define object classes for annotation."
          buttonLabel="Link Taxonomy"
          buttonColor="purple"
          onClick={onLinkTaxonomyClick}
          compact={compact}
        />

        {onCreateTaskClick && (
          <StepCard
            stepNumber={3}
            isCompleted={hasTasks}
            isActive={hasScenes && hasTaxonomy && !hasTasks}
            icon="📋"
            title="Create Tasks"
            description="Assign annotation tasks to your team members."
            buttonLabel="Create Task"
            buttonColor="amber"
            onClick={onCreateTaskClick}
            compact={compact}
          />
        )}
      </div>

      {/* Quick tips */}
      {!compact && !hasScenes && (
        <div className="mt-4 p-3 bg-blue-500/10 rounded-lg border border-blue-500/20">
          <h4 className="text-sm font-medium text-blue-400 mb-1 flex items-center gap-1">
            <span>💡</span> Quick Tip
          </h4>
          <p className="text-xs text-gray-400">
            Enable <span className="text-cyan-400 font-medium">"Auto-derive taxonomy"</span> during upload
            to automatically create label classes from your annotation files.
          </p>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// INLINE PROGRESS BANNER
// =============================================================================

interface SetupProgressBannerProps {
  completedSteps: {
    hasScenes: boolean;
    hasTaxonomy: boolean;
    hasTasks: boolean;
  };
  onUploadClick: () => void;
  onLinkTaxonomyClick: () => void;
  onCreateTaskClick?: () => void;
}

export const SetupProgressBanner: React.FC<SetupProgressBannerProps> = ({
  completedSteps,
  onUploadClick,
  onLinkTaxonomyClick,
  onCreateTaskClick,
}) => {
  const { hasScenes, hasTaxonomy, hasTasks } = completedSteps;
  const completedCount = [hasScenes, hasTaxonomy, hasTasks].filter(Boolean).length;

  // Don't show if all complete
  if (completedCount === 3) return null;

  // Determine next action
  const nextAction = !hasScenes
    ? { label: 'Upload Data', onClick: onUploadClick, icon: '📤' }
    : !hasTaxonomy
      ? { label: 'Link Taxonomy', onClick: onLinkTaxonomyClick, icon: '🏷️' }
      : { label: 'Create Tasks', onClick: onCreateTaskClick ?? (() => {}), icon: '📋' };

  return (
    <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-cyan-500/10 via-purple-500/10 to-pink-500/10 rounded-xl border border-cyan-500/20 mb-6">
      <div className="flex items-center gap-4">
        {/* Progress bar */}
        <div className="flex items-center gap-1">
          {[hasScenes, hasTaxonomy, hasTasks].map((done, i) => (
            <React.Fragment key={i}>
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                done ? 'bg-green-500 text-white' : 'bg-gray-700 text-gray-400'
              }`}>
                {done ? '✓' : i + 1}
              </div>
              {i < 2 && (
                <div className={`w-6 h-0.5 ${done ? 'bg-green-500' : 'bg-gray-700'}`} />
              )}
            </React.Fragment>
          ))}
        </div>

        <div>
          <p className="text-white font-medium text-sm">
            Setup {completedCount}/3 complete
          </p>
          <p className="text-gray-400 text-xs">
            Next: {nextAction.label}
          </p>
        </div>
      </div>

      <button
        onClick={nextAction.onClick}
        className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-purple-500 text-white rounded-lg font-medium text-sm hover:from-cyan-400 hover:to-purple-400 transition-all flex items-center gap-2"
      >
        <span>{nextAction.icon}</span>
        {nextAction.label}
      </button>
    </div>
  );
};

export default GettingStartedCard;

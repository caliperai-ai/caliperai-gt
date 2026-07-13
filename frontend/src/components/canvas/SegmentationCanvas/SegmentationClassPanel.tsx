import React, { useMemo, useCallback } from 'react';
import { useSegmentationStore, useLabelStats, type ColorMode } from '@/store/segmentationStore';
import type { ClassDefinition, Taxonomy } from '@/types';


interface SegmentationClassPanelProps {
  taxonomy: Taxonomy | null;
  onClose?: () => void;
}


interface ClassItemProps {
  cls: ClassDefinition;
  classIndex: number;
  isActive: boolean;
  pointCount: number;
  totalPoints: number;
  onClick: () => void;
}

const ClassItem: React.FC<ClassItemProps> = ({
  cls,
  classIndex,
  isActive,
  pointCount,
  totalPoints,
  onClick,
}) => {
  const percentage = totalPoints > 0 ? ((pointCount / totalPoints) * 100).toFixed(1) : '0.0';

  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg transition-all ${
        isActive
          ? 'bg-primary/20 border border-primary/50'
          : 'hover:bg-dark-hover border border-transparent'
      }`}
    >
      {/* Color swatch */}
      <div
        className="w-4 h-4 rounded-sm flex-shrink-0 border border-white/20"
        style={{ backgroundColor: cls.color }}
      />

      {/* Class info */}
      <div className="flex-1 min-w-0 text-left">
        <div className="flex items-center justify-between">
          <span className={`text-sm truncate ${isActive ? 'text-white font-medium' : 'text-gray-300'}`}>
            {cls.name}
          </span>
          <span className="text-xs text-gray-500 ml-2">
            {classIndex}
          </span>
        </div>

        {/* Count bar */}
        {pointCount > 0 && (
          <div className="mt-1">
            <div className="flex items-center justify-between text-[10px] text-gray-500 mb-0.5">
              <span>{pointCount.toLocaleString()} pts</span>
              <span>{percentage}%</span>
            </div>
            <div className="h-1 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${Math.min(100, (pointCount / totalPoints) * 100)}%`,
                  backgroundColor: cls.color,
                }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Active indicator */}
      {isActive && (
        <div className="w-2 h-2 rounded-full bg-primary animate-pulse flex-shrink-0" />
      )}
    </button>
  );
};

// =============================================================================
// STATS CARD
// =============================================================================

interface StatsCardProps {
  total: number;
  labeled: number;
  unlabeled: number;
}

const StatsCard: React.FC<StatsCardProps> = ({ total, labeled, unlabeled }) => {
  const labeledPercent = total > 0 ? ((labeled / total) * 100).toFixed(1) : '0.0';

  return (
    <div className="bg-dark-surface rounded-lg p-3 border border-gray-700">
      <div className="text-xs text-gray-500 mb-2 font-medium">Label Progress</div>

      {/* Progress bar */}
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden mb-2">
        <div
          className="h-full bg-gradient-to-r from-green-500 to-emerald-400 rounded-full transition-all duration-500"
          style={{ width: `${Math.min(100, (labeled / total) * 100)}%` }}
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-2 text-center">
        <div>
          <div className="text-lg font-semibold text-white">{total.toLocaleString()}</div>
          <div className="text-[10px] text-gray-500">Total</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-green-400">{labeled.toLocaleString()}</div>
          <div className="text-[10px] text-gray-500">Labeled</div>
        </div>
        <div>
          <div className="text-lg font-semibold text-gray-400">{unlabeled.toLocaleString()}</div>
          <div className="text-[10px] text-gray-500">Remaining</div>
        </div>
      </div>

      <div className="mt-2 text-center">
        <span className="text-sm font-medium text-emerald-400">{labeledPercent}%</span>
        <span className="text-xs text-gray-500"> complete</span>
      </div>
    </div>
  );
};

// =============================================================================
// VIEW SETTINGS
// =============================================================================

const ViewSettings: React.FC = () => {
  const showOnlyLabeled = useSegmentationStore((s) => s.showOnlyLabeled);
  const setShowOnlyLabeled = useSegmentationStore((s) => s.setShowOnlyLabeled);
  const labelOpacity = useSegmentationStore((s) => s.labelOpacity);
  const setLabelOpacity = useSegmentationStore((s) => s.setLabelOpacity);
  const colorMode = useSegmentationStore((s) => s.colorMode);
  const setColorMode = useSegmentationStore((s) => s.setColorMode);

  const colorModeOptions: { value: ColorMode; label: string; description: string }[] = [
    { value: 'height', label: 'Height (Rainbow)', description: 'Color by Z-axis height' },
    { value: 'intensity', label: 'Reflectivity', description: 'Color by intensity/reflectivity' },
    { value: 'rgb', label: 'RGB (File color)', description: 'Use per-point RGB stored in the file (falls back to gray if absent)' },
    { value: 'none', label: 'Gray', description: 'Uniform gray color' },
  ];

  return (
    <div className="bg-dark-surface rounded-lg p-3 border border-gray-700">
      <div className="text-xs text-gray-500 mb-3 font-medium">View Settings</div>

      {/* Color mode dropdown */}
      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-gray-300">Unlabeled Points Color</span>
        </div>
        <select
          value={colorMode}
          onChange={(e) => setColorMode(e.target.value as ColorMode)}
          className="w-full px-2 py-1.5 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-200 focus:outline-none focus:border-primary"
        >
          {colorModeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Dim unlabeled toggle */}
      <label className="flex items-center justify-between cursor-pointer mb-3">
        <span className="text-sm text-gray-300">Dim Unlabeled Points</span>
        <div className="relative">
          <input
            type="checkbox"
            checked={showOnlyLabeled}
            onChange={(e) => setShowOnlyLabeled(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
        </div>
      </label>

      {/* Label opacity slider */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="text-sm text-gray-300">Label Opacity</span>
          <span className="text-xs text-gray-500">{Math.round(labelOpacity * 100)}%</span>
        </div>
        <input
          type="range"
          min={0.1}
          max={1}
          step={0.05}
          value={labelOpacity}
          onChange={(e) => setLabelOpacity(parseFloat(e.target.value))}
          className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer"
        />
      </div>
    </div>
  );
};

// =============================================================================
// 4D SETTINGS
// =============================================================================

const Settings4D: React.FC = () => {
  const is4DMode = useSegmentationStore((s) => s.is4DMode);
  const setIs4DMode = useSegmentationStore((s) => s.setIs4DMode);
  const scanCount = useSegmentationStore((s) => s.scanCount);
  const setScanCount = useSegmentationStore((s) => s.setScanCount);

  return (
    <div className="bg-dark-surface rounded-lg p-3 border border-gray-700">
      <div className="text-xs text-gray-500 mb-3 font-medium">4D Mode (Multi-Frame)</div>

      {/* 4D Mode toggle */}
      <label className="flex items-center justify-between cursor-pointer mb-3">
        <span className="text-sm text-gray-300">Enable 4D Overlay</span>
        <div className="relative">
          <input
            type="checkbox"
            checked={is4DMode}
            onChange={(e) => setIs4DMode(e.target.checked)}
            className="sr-only peer"
          />
          <div className="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
        </div>
      </label>

      {/* Scan count slider (only visible when 4D enabled) */}
      {is4DMode && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-sm text-gray-300">Scan Count</span>
            <span className="text-xs text-gray-500">{scanCount} frames</span>
          </div>
          <input
            type="range"
            min={1}
            max={20}
            step={1}
            value={scanCount}
            onChange={(e) => setScanCount(parseInt(e.target.value))}
            className="w-full h-1.5 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
          <p className="text-[9px] text-gray-600 mt-1">
            Stack {scanCount} frames using ego pose alignment
          </p>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const SegmentationClassPanel: React.FC<SegmentationClassPanelProps> = ({
  taxonomy,
  onClose,
}) => {
  const activeClassId = useSegmentationStore((s) => s.activeClassId);
  const setActiveClass = useSegmentationStore((s) => s.setActiveClass);
  const labelSelectedPoints = useSegmentationStore((s) => s.labelSelectedPoints);
  const selectedPointCount = useSegmentationStore((s) => s.selectedPointIndices.size);
  const clearAllLabels = useSegmentationStore((s) => s.clearAllLabels);

  const labelStats = useLabelStats();

  // Build class list with indices
  const classesWithIndex = useMemo(() => {
    if (!taxonomy?.classes) return [];
    return taxonomy.classes.map((cls, index) => ({
      cls,
      index,
      pointCount: labelStats.byClass[index] || 0,
    }));
  }, [taxonomy?.classes, labelStats.byClass]);

  // Handle class click
  const handleClassClick = useCallback((classIndex: number) => {
    const classId = String(classIndex);
    setActiveClass(classId);

    // If points are selected, label them with this class
    if (selectedPointCount > 0) {
      labelSelectedPoints(classId);
    }
  }, [setActiveClass, selectedPointCount, labelSelectedPoints]);

  // Handle keyboard shortcuts for class selection (1-9)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const num = parseInt(e.key);
      if (num >= 1 && num <= 9 && classesWithIndex.length >= num) {
        e.preventDefault();
        handleClassClick(num - 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [classesWithIndex.length, handleClassClick]);

  if (!taxonomy) {
    return (
      <div className="w-72 bg-dark-panel border-l border-gray-700 p-4">
        <div className="text-sm text-gray-500 text-center py-8">
          No taxonomy loaded
        </div>
      </div>
    );
  }

  return (
    <div className="w-72 bg-dark-panel border-l border-gray-700 flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-700 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">Classes</h2>
          <p className="text-xs text-gray-500">{taxonomy.name}</p>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-dark-hover text-gray-400 hover:text-white"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="p-3 border-b border-gray-700">
        <StatsCard
          total={labelStats.total}
          labeled={labelStats.labeled}
          unlabeled={labelStats.unlabeled}
        />
      </div>

      {/* Class list */}
      <div className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {classesWithIndex.map(({ cls, index, pointCount }) => (
            <ClassItem
              key={cls.id}
              cls={cls}
              classIndex={index}
              isActive={activeClassId === String(index)}
              pointCount={pointCount}
              totalPoints={labelStats.total}
              onClick={() => handleClassClick(index)}
            />
          ))}
        </div>

        {/* Keyboard hint */}
        <div className="mt-3 px-2 py-2 bg-dark-surface/50 rounded-lg">
          <p className="text-[10px] text-gray-500 text-center">
            Press <kbd className="px-1 py-0.5 bg-gray-700 rounded text-gray-300">1</kbd>-
            <kbd className="px-1 py-0.5 bg-gray-700 rounded text-gray-300">9</kbd> to select class
          </p>
        </div>
      </div>

      {/* View settings */}
      <div className="p-3 border-t border-gray-700">
        <ViewSettings />
      </div>

      {/* 4D Settings */}
      <div className="p-3 border-t border-gray-700">
        <Settings4D />
      </div>

      {/* Actions */}
      <div className="p-3 border-t border-gray-700">
        {/* Selected points info */}
        {selectedPointCount > 0 && (
          <div className="mb-3 px-3 py-2 bg-primary/10 border border-primary/30 rounded-lg">
            <div className="flex items-center justify-between">
              <span className="text-sm text-primary-light">
                {selectedPointCount.toLocaleString()} points selected
              </span>
              {activeClassId && (
                <button
                  onClick={() => labelSelectedPoints(activeClassId)}
                  className="text-xs bg-primary/20 hover:bg-primary/30 text-primary-light px-2 py-1 rounded"
                >
                  Apply
                </button>
              )}
            </div>
          </div>
        )}

        {/* Clear all button */}
        <button
          onClick={() => {
            if (confirm('Clear all labels for this frame? This action can be undone.')) {
              clearAllLabels();
            }
          }}
          className="w-full px-3 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 text-sm rounded-lg transition-colors"
        >
          Clear All Labels
        </button>
      </div>
    </div>
  );
};

export default SegmentationClassPanel;

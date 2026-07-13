import React, { useMemo, useState } from 'react';
import { useQAStore, useQASuggestions } from '@/store/qaStore';
import { SuggestionCard } from './SuggestionCard';
import { QAProgressBar } from './QAProgressBar';
import type { QASuggestion, SuggestionSeverity } from '@/types';

const ChevronLeftIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

const RefreshIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

const FilterIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
  </svg>
);

const SparklesIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  </svg>
);

const TYPE_CATEGORIES: Record<string, string[]> = {
  'Critical Issues': ['velocity_outlier', 'overlapping_cuboids'],
  'Spatial Issues': ['ground_plane_misalignment', 'position_jump', 'heading_motion_mismatch'],
  'Dimension Issues': ['size_anomaly', 'track_dimension_inconsistency', 'aspect_ratio_anomaly'],
  'Track Issues': ['short_track', 'track_gap', 'track_boundary_issue', 'track_discontinuity', 'class_mismatch', 'stationary_with_motion_class'],
  'Quality Issues': ['orientation_flip', 'low_confidence', 'missing_attributes', 'occlusion_issue'],
  'Review Items': ['auto_interpolated', 'imported_unchecked'],
};

const getCategoryForType = (type: string): string => {
  for (const [category, types] of Object.entries(TYPE_CATEGORIES)) {
    if (types.includes(type)) return category;
  }
  return 'Other';
};

const SEVERITY_PRIORITY: Record<SuggestionSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

interface SeverityBadgeProps {
  severity: SuggestionSeverity;
  count: number;
  selected?: boolean;
  onClick?: () => void;
}

const SeverityBadge: React.FC<SeverityBadgeProps> = ({ severity, count, selected, onClick }) => {
  const colorMap = {
    critical: selected ? 'bg-red-600 text-white ring-2 ring-red-400' : 'bg-red-600/30 text-red-400 hover:bg-red-600/50',
    high: selected ? 'bg-orange-500 text-white ring-2 ring-orange-400' : 'bg-orange-500/30 text-orange-400 hover:bg-orange-500/50',
    medium: selected ? 'bg-yellow-500 text-black ring-2 ring-yellow-400' : 'bg-yellow-500/30 text-yellow-400 hover:bg-yellow-500/50',
    low: selected ? 'bg-blue-500 text-white ring-2 ring-blue-400' : 'bg-blue-500/30 text-blue-400 hover:bg-blue-500/50',
  };

  const labelMap = {
    critical: '🔴',
    high: '🟠',
    medium: '🟡',
    low: '🔵',
  };

  if (count === 0) return null;

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium transition-all cursor-pointer ${colorMap[severity]}`}
    >
      {labelMap[severity]} {count}
    </button>
  );
};

interface GroupHeaderProps {
  category: string;
  count: number;
  expanded: boolean;
  onToggle: () => void;
  severity: SuggestionSeverity;
}

const GroupHeader: React.FC<GroupHeaderProps> = ({ category, count, expanded, onToggle, severity }) => {
  const severityColors = {
    critical: 'text-red-400 bg-red-500/10 border-red-500/30',
    high: 'text-orange-400 bg-orange-500/10 border-orange-500/30',
    medium: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
    low: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  };

  return (
    <button
      onClick={onToggle}
      className={`w-full px-3 py-2 flex items-center justify-between text-sm font-medium border-b transition-colors
        ${severityColors[severity]} hover:bg-gray-700/50`}
    >
      <div className="flex items-center gap-2">
        <span className={`transform transition-transform ${expanded ? 'rotate-0' : '-rotate-90'}`}>
          <ChevronDownIcon />
        </span>
        <span>{category}</span>
      </div>
      <span className="px-2 py-0.5 rounded-full bg-gray-700 text-xs">
        {count}
      </span>
    </button>
  );
};

// View modes
type ViewMode = 'list' | 'grouped';

interface QASidebarProps {
  onJumpToAnnotation?: (annotationId: string, frameId?: string) => void;
}

export const QASidebar: React.FC<QASidebarProps> = ({ onJumpToAnnotation }) => {
  const allSuggestions = useQASuggestions();
  const {
    currentSuggestionIndex,
    jumpToSuggestion,
    nextSuggestion,
    prevSuggestion,
    dismissSuggestion,
    generateSuggestions,
    taskId,
    isLoadingSuggestions,
  } = useQAStore();

  // Debug logging

  // Local state
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [severityFilter, setSeverityFilter] = useState<SuggestionSeverity | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['Critical Issues', 'Spatial Issues']));
  const [showFilters, setShowFilters] = useState(false);

  // Filter and sort suggestions
  const suggestions = useMemo(() => {
    let filtered = allSuggestions;
    if (severityFilter) {
      filtered = filtered.filter(s => s.severity === severityFilter);
    }
    return [...filtered].sort((a, b) =>
      SEVERITY_PRIORITY[a.severity] - SEVERITY_PRIORITY[b.severity]
    );
  }, [allSuggestions, severityFilter]);

  // Count by severity (from all, not filtered)
  const severityCounts = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    allSuggestions.forEach(s => {
      counts[s.severity as keyof typeof counts]++;
    });
    return counts;
  }, [allSuggestions]);

  // Group by category
  const groupedSuggestions = useMemo(() => {
    const groups: Record<string, { suggestions: QASuggestion[]; maxSeverity: SuggestionSeverity }> = {};

    suggestions.forEach(s => {
      const category = getCategoryForType(s.suggestion_type);
      if (!groups[category]) {
        groups[category] = { suggestions: [], maxSeverity: 'low' };
      }
      groups[category].suggestions.push(s);

      if (SEVERITY_PRIORITY[s.severity] < SEVERITY_PRIORITY[groups[category].maxSeverity]) {
        groups[category].maxSeverity = s.severity;
      }
    });

    return Object.entries(groups).sort(([, a], [, b]) =>
      SEVERITY_PRIORITY[a.maxSeverity] - SEVERITY_PRIORITY[b.maxSeverity]
    );
  }, [suggestions]);

  // Handle focus on suggestion
  const handleFocus = (suggestion: QASuggestion, index: number) => {
    console.log('[QA Sidebar] Focusing on suggestion:', {
      index,
      annotationId: suggestion.annotation_id,
      frameId: suggestion.frame_id,
      type: suggestion.suggestion_type,
    });
    jumpToSuggestion(index);
    if (suggestion.annotation_id && onJumpToAnnotation) {
      onJumpToAnnotation(suggestion.annotation_id, suggestion.frame_id ?? undefined);
    } else {
      console.warn('[QA Sidebar] Cannot jump: annotation_id is missing or onJumpToAnnotation not provided');
    }
  };

  // Handle regenerate
  const handleRegenerate = async () => {
    if (taskId) {
      await generateSuggestions(taskId, true);
    }
  };

  // Toggle severity filter
  const toggleSeverityFilter = (severity: SuggestionSeverity) => {
    setSeverityFilter(current => current === severity ? null : severity);
  };

  // Toggle group expansion
  const toggleGroup = (category: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Dismissed count
  const dismissedCount = allSuggestions.filter(s => s.is_dismissed).length;

  return (
    <div className="fixed top-12 bottom-0 right-0 z-30 w-80 bg-gray-900 border-l border-gray-700 flex flex-col shadow-2xl">
      {/* Header */}
      <div className="p-4 border-b border-gray-700 bg-gradient-to-r from-gray-900 to-gray-800">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-blue-500/20 rounded-lg text-blue-400">
              <SparklesIcon />
            </div>
            <div>
              <h3 className="font-semibold text-white">AI Quality Check</h3>
              <p className="text-xs text-gray-400">
                {suggestions.length} issue{suggestions.length !== 1 ? 's' : ''} found
                {dismissedCount > 0 && ` • ${dismissedCount} dismissed`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`p-1.5 rounded transition-colors ${showFilters ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-gray-700'}`}
              title="Filter"
            >
              <FilterIcon />
            </button>
            <button
              onClick={handleRegenerate}
              disabled={isLoadingSuggestions}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors disabled:opacity-50"
              title="Regenerate suggestions"
            >
              <RefreshIcon />
            </button>
          </div>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="mt-3 pt-3 border-t border-gray-700">
            <div className="text-xs text-gray-500 mb-2">Filter by severity</div>
            <div className="flex gap-2 flex-wrap">
              <SeverityBadge
                severity="critical"
                count={severityCounts.critical}
                selected={severityFilter === 'critical'}
                onClick={() => toggleSeverityFilter('critical')}
              />
              <SeverityBadge
                severity="high"
                count={severityCounts.high}
                selected={severityFilter === 'high'}
                onClick={() => toggleSeverityFilter('high')}
              />
              <SeverityBadge
                severity="medium"
                count={severityCounts.medium}
                selected={severityFilter === 'medium'}
                onClick={() => toggleSeverityFilter('medium')}
              />
              <SeverityBadge
                severity="low"
                count={severityCounts.low}
                selected={severityFilter === 'low'}
                onClick={() => toggleSeverityFilter('low')}
              />
            </div>

            {/* View mode toggle */}
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-gray-500">View:</span>
              <button
                onClick={() => setViewMode('list')}
                className={`px-2 py-1 text-xs rounded ${viewMode === 'list' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              >
                List
              </button>
              <button
                onClick={() => setViewMode('grouped')}
                className={`px-2 py-1 text-xs rounded ${viewMode === 'grouped' ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'}`}
              >
                Grouped
              </button>
            </div>
          </div>
        )}

        {/* Quick severity summary when filters hidden */}
        {!showFilters && (
          <div className="flex gap-2 mt-2 flex-wrap">
            <SeverityBadge severity="critical" count={severityCounts.critical} onClick={() => { setShowFilters(true); setSeverityFilter('critical'); }} />
            <SeverityBadge severity="high" count={severityCounts.high} onClick={() => { setShowFilters(true); setSeverityFilter('high'); }} />
            <SeverityBadge severity="medium" count={severityCounts.medium} onClick={() => { setShowFilters(true); setSeverityFilter('medium'); }} />
            <SeverityBadge severity="low" count={severityCounts.low} onClick={() => { setShowFilters(true); setSeverityFilter('low'); }} />
          </div>
        )}
      </div>

      {/* Progress */}
      <div className="px-4 py-3 border-b border-gray-700 bg-gray-800/50">
        <QAProgressBar />
      </div>

      {/* Suggestions List */}
      <div className="flex-1 overflow-y-auto">
        {isLoadingSuggestions ? (
          <div className="flex flex-col items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500" />
            <p className="text-sm text-gray-400 mt-2">Running AI checks...</p>
          </div>
        ) : suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-500 px-4">
            <span className="text-5xl mb-3">✨</span>
            <p className="text-base font-medium text-gray-300">All Clear!</p>
            <p className="text-sm mt-1 text-center">
              {severityFilter
                ? `No ${severityFilter} severity issues found`
                : 'AI found no quality issues'
              }
            </p>
            {severityFilter && (
              <button
                onClick={() => setSeverityFilter(null)}
                className="mt-3 px-3 py-1 text-sm bg-gray-700 hover:bg-gray-600 rounded"
              >
                Clear filter
              </button>
            )}
          </div>
        ) : viewMode === 'grouped' ? (
          // Grouped view
          <div>
            {groupedSuggestions.map(([category, { suggestions: groupSuggestions, maxSeverity }]) => (
              <div key={category}>
                <GroupHeader
                  category={category}
                  count={groupSuggestions.length}
                  expanded={expandedGroups.has(category)}
                  onToggle={() => toggleGroup(category)}
                  severity={maxSeverity}
                />
                {expandedGroups.has(category) && (
                  <div className="divide-y divide-gray-800">
                    {groupSuggestions.map((suggestion) => {
                      const globalIndex = suggestions.findIndex(s => s.id === suggestion.id);
                      return (
                        <SuggestionCard
                          key={suggestion.id}
                          suggestion={suggestion}
                          isActive={globalIndex === currentSuggestionIndex}
                          index={globalIndex}
                          onFocus={() => handleFocus(suggestion, globalIndex)}
                          onDismiss={() => dismissSuggestion(suggestion.id)}
                        />
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          // List view
          <div className="divide-y divide-gray-800">
            {suggestions.map((suggestion, idx) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                isActive={idx === currentSuggestionIndex}
                index={idx}
                onFocus={() => handleFocus(suggestion, idx)}
                onDismiss={() => dismissSuggestion(suggestion.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Navigation Footer */}
      {suggestions.length > 0 && (
        <div className="p-4 border-t border-gray-700 bg-gray-800/50">
          <div className="flex items-center justify-between">
            <button
              onClick={prevSuggestion}
              disabled={currentSuggestionIndex === 0}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm transition-colors"
            >
              <ChevronLeftIcon />
              <span>Prev</span>
            </button>

            <div className="text-center">
              <span className="text-sm font-medium text-white">
                {currentSuggestionIndex + 1} / {suggestions.length}
              </span>
              {severityFilter && (
                <p className="text-xs text-gray-500">
                  {severityFilter} only
                </p>
              )}
            </div>

            <button
              onClick={nextSuggestion}
              disabled={currentSuggestionIndex === suggestions.length - 1}
              className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm transition-colors"
            >
              <span>Next</span>
              <ChevronRightIcon />
            </button>
          </div>

          <div className="mt-2 text-center">
            <p className="text-xs text-gray-500">
              <kbd className="px-1 py-0.5 bg-gray-700 rounded text-gray-400">J</kbd> prev
              <span className="mx-2">•</span>
              <kbd className="px-1 py-0.5 bg-gray-700 rounded text-gray-400">K</kbd> next
              <span className="mx-2">•</span>
              <kbd className="px-1 py-0.5 bg-gray-700 rounded text-gray-400">D</kbd> dismiss
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

export default QASidebar;

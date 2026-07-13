import React from 'react';
import type { QASuggestion } from '@/types';

const FocusIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
  </svg>
);

const DismissIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const getSeverityStyles = (severity: string) => {
  switch (severity) {
    case 'critical':
      return {
        bg: 'bg-red-900/30',
        border: 'border-l-red-500',
        badge: 'bg-red-600 text-white',
        icon: '🔴',
      };
    case 'high':
      return {
        bg: 'bg-orange-900/30',
        border: 'border-l-orange-500',
        badge: 'bg-orange-500 text-white',
        icon: '🟠',
      };
    case 'medium':
      return {
        bg: 'bg-yellow-900/30',
        border: 'border-l-yellow-500',
        badge: 'bg-yellow-500 text-black',
        icon: '🟡',
      };
    case 'low':
      return {
        bg: 'bg-blue-900/30',
        border: 'border-l-blue-500',
        badge: 'bg-blue-500 text-white',
        icon: '🔵',
      };
    default:
      return {
        bg: 'bg-gray-800',
        border: 'border-l-gray-500',
        badge: 'bg-gray-500 text-white',
        icon: '⚪',
      };
  }
};

const getSuggestionTypeLabel = (type: string): { label: string; icon: string } => {
  const types: Record<string, { label: string; icon: string }> = {
    size_anomaly: { label: 'Size Anomaly', icon: '📐' },
    position_jump: { label: 'Position Jump', icon: '🚀' },
    orientation_flip: { label: 'Orientation Flip', icon: '🔄' },
    track_discontinuity: { label: 'Track Break', icon: '🔗' },
    low_confidence: { label: 'Low Confidence', icon: '❓' },
    class_mismatch: { label: 'Class Mismatch', icon: '🏷️' },
    missing_attributes: { label: 'Missing Attributes', icon: '📝' },
    auto_interpolated: { label: 'Auto-Interpolated', icon: '🤖' },
    imported_unchecked: { label: 'Imported', icon: '📥' },
    occlusion_issue: { label: 'Occlusion Issue', icon: '👁️' },
    ground_plane_misalignment: { label: 'Ground Alignment', icon: '⬇️' },
    track_dimension_inconsistency: { label: 'Dimension Mismatch', icon: '📏' },
    velocity_outlier: { label: 'Impossible Speed', icon: '⚡' },
    heading_motion_mismatch: { label: 'Wrong Direction', icon: '🧭' },
    overlapping_cuboids: { label: 'Overlapping Boxes', icon: '🔲' },
    short_track: { label: 'Short Track', icon: '📍' },
    aspect_ratio_anomaly: { label: 'Wrong Proportions', icon: '📊' },
    stationary_with_motion_class: { label: 'Not Moving', icon: '🚫' },
    track_gap: { label: 'Track Gap', icon: '🔗' },
    track_boundary_issue: { label: 'Boundary Issue', icon: '🚪' },
  };

  return types[type] || { label: type, icon: '⚠️' };
};

interface SuggestionCardProps {
  suggestion: QASuggestion;
  isActive: boolean;
  index: number;
  onFocus: () => void;
  onDismiss: () => void;
}

export const SuggestionCard: React.FC<SuggestionCardProps> = ({
  suggestion,
  isActive,
  index,
  onFocus,
  onDismiss,
}) => {
  const styles = getSeverityStyles(suggestion.severity);
  const typeInfo = getSuggestionTypeLabel(suggestion.suggestion_type);

  return (
    <div
      className={`
        p-3 border-l-4 transition-colors cursor-pointer
        ${styles.border}
        ${isActive ? styles.bg : 'hover:bg-gray-800/50'}
        ${isActive ? 'ring-1 ring-inset ring-blue-500/50' : ''}
      `}
      onClick={onFocus}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-lg">{typeInfo.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-white truncate">
                {typeInfo.label}
              </span>
              <span className={`px-1.5 py-0.5 rounded text-xs ${styles.badge}`}>
                {suggestion.severity}
              </span>
            </div>
            {suggestion.frame_id && (
              <p className="text-xs text-gray-500 mt-0.5">
                Frame: {suggestion.frame_id.substring(0, 8)}...
              </p>
            )}
          </div>
        </div>

        {/* Index badge for active */}
        {isActive && (
          <span className="flex-shrink-0 w-6 h-6 bg-blue-600 rounded-full flex items-center justify-center text-xs font-bold">
            {index + 1}
          </span>
        )}
      </div>

      {/* Message */}
      <p className="text-sm text-gray-300 mt-2 line-clamp-2">
        {suggestion.message}
      </p>

      {/* Details preview */}
      {suggestion.details && Object.keys(suggestion.details).length > 0 && (
        <div className="mt-2 text-xs text-gray-500 font-mono bg-gray-800/50 rounded p-2">
          {Object.entries(suggestion.details).slice(0, 2).map(([key, value]) => (
            <div key={key} className="truncate">
              <span className="text-gray-400">{key}:</span>{' '}
              <span className="text-gray-300">
                {typeof value === 'object' ? JSON.stringify(value) : String(value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 mt-3">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onFocus();
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded transition-colors"
        >
          <FocusIcon />
          Focus
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDismiss();
          }}
          className="flex items-center gap-1 px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded transition-colors"
        >
          <DismissIcon />
          Dismiss
        </button>
      </div>
    </div>
  );
};

export default SuggestionCard;

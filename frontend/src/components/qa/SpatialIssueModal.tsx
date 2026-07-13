import React, { useState } from 'react';

const SEGMENTATION_ISSUE_TYPES = [
  { id: 'missing_label', label: 'Missing label', description: 'Points should be labeled but are not' },
  { id: 'wrong_class', label: 'Wrong class', description: 'Points are labeled with incorrect class' },
  { id: 'boundary_error', label: 'Boundary error', description: 'Label boundaries are incorrect' },
  { id: 'over_segmentation', label: 'Over-segmented', description: 'Too many adjacent areas labeled' },
  { id: 'under_segmentation', label: 'Under-segmented', description: 'Missed some parts that should be labeled' },
  { id: 'noise_labeled', label: 'Noise labeled', description: 'Noise points were incorrectly labeled' },
  { id: 'other', label: 'Other', description: 'Other issue' },
];

interface SpatialIssueModalProps {
  isOpen: boolean;
  location: { x: number; y: number; z: number } | null;
  onClose: () => void;
  onSubmit: (issueTypes: string[], notes: string) => void;
}

export const SpatialIssueModal: React.FC<SpatialIssueModalProps> = ({
  isOpen,
  location,
  onClose,
  onSubmit,
}) => {
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');

  if (!isOpen || !location) return null;

  const handleToggleIssue = (issueId: string) => {
    setSelectedIssues(prev => {
      const newSet = new Set(prev);
      if (newSet.has(issueId)) {
        newSet.delete(issueId);
      } else {
        newSet.add(issueId);
      }
      return newSet;
    });
  };

  const handleSubmit = () => {
    if (selectedIssues.size === 0 && !notes.trim()) return;
    const issueTypes = selectedIssues.size > 0 ? Array.from(selectedIssues) : ['other'];
    onSubmit(issueTypes, notes.trim());
    setSelectedIssues(new Set());
    setNotes('');
  };

  const handleClose = () => {
    setSelectedIssues(new Set());
    setNotes('');
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[9999]" onClick={handleClose}>
      <div
        className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-red-500/10">
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              <svg className="w-5 h-5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              Add Point Issue
            </h3>
            <p className="text-xs text-gray-400 mt-1">
              Location: ({location.x.toFixed(2)}, {location.y.toFixed(2)}, {location.z.toFixed(2)})
            </p>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors p-1"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Issue type selection */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Issue Type <span className="text-red-400">*</span>
            </label>
            <div className="grid grid-cols-2 gap-2">
              {SEGMENTATION_ISSUE_TYPES.map((issue) => (
                <button
                  key={issue.id}
                  onClick={() => handleToggleIssue(issue.id)}
                  className={`text-left p-2 rounded-lg border transition-colors ${
                    selectedIssues.has(issue.id)
                      ? 'bg-red-500/20 border-red-500/50 text-red-300'
                      : 'bg-gray-700/50 border-gray-600 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  <span className="text-sm font-medium">{issue.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Describe the issue at this location..."
              rows={3}
              className="w-full bg-gray-700/50 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-red-500/50"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-700 bg-gray-800/50">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={selectedIssues.size === 0 && !notes.trim()}
            className="px-4 py-2 text-sm font-medium bg-red-500 hover:bg-red-600 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            Add Issue
          </button>
        </div>
      </div>
    </div>
  );
};

export default SpatialIssueModal;

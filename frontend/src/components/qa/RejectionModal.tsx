import React, { useState } from 'react';
import { useQAStore, ISSUE_TYPES } from '@/store/qaStore';

const XIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

export const RejectionModal: React.FC = () => {
  const {
    showRejectionModal,
    rejectionAnnotationId,
    rejectionFrameId,
    rejectionClassId,
    closeRejectionModal,
    rejectAnnotation,
  } = useQAStore();

  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!showRejectionModal || !rejectionAnnotationId) return null;

  const toggleIssue = (issueId: string) => {
    const newSelected = new Set(selectedIssues);
    if (newSelected.has(issueId)) {
      newSelected.delete(issueId);
    } else {
      newSelected.add(issueId);
    }
    setSelectedIssues(newSelected);
  };

  const handleSubmit = async () => {
    if (selectedIssues.size === 0) {
      return;
    }

    setIsSubmitting(true);
    try {
      await rejectAnnotation(
        rejectionAnnotationId,
        Array.from(selectedIssues),
        notes || undefined,
        rejectionFrameId ?? undefined,
        rejectionClassId ?? undefined
      );
      setSelectedIssues(new Set());
      setNotes('');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    closeRejectionModal();
    setSelectedIssues(new Set());
    setNotes('');
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={handleClose}>
      <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h3 className="text-lg font-semibold text-white">Reject Annotation</h3>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <XIcon />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <p className="text-sm text-gray-400 mb-4">
            Select the issues with this annotation:
          </p>

          {/* Issue checkboxes */}
          <div className="grid grid-cols-2 gap-2 mb-6">
            {ISSUE_TYPES.map((issue) => (
              <label
                key={issue.id}
                className={`
                  flex items-center gap-2 p-3 rounded-lg cursor-pointer transition-colors
                  ${selectedIssues.has(issue.id)
                    ? 'bg-red-600/20 border border-red-500'
                    : 'bg-gray-700/50 border border-transparent hover:bg-gray-700'
                  }
                `}
              >
                <input
                  type="checkbox"
                  checked={selectedIssues.has(issue.id)}
                  onChange={() => toggleIssue(issue.id)}
                  className="sr-only"
                />
                <span className="text-lg">{issue.icon}</span>
                <span className="text-sm">{issue.label}</span>
              </label>
            ))}
          </div>

          {/* Notes */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Additional Notes (optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add any additional details..."
              rows={3}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm focus:outline-none focus:border-red-500 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={selectedIssues.size === 0 || isSubmitting}
              className="px-6 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
            >
              {isSubmitting ? 'Rejecting...' : 'Reject Annotation'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RejectionModal;

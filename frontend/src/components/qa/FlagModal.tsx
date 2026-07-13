import React, { useState, useEffect, useRef } from 'react';

const XIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const FlagIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
  </svg>
);

const FLAG_REASONS = [
  { id: 'need_second_opinion', label: 'Need second opinion', icon: '👀' },
  { id: 'unclear_object', label: 'Unclear object', icon: '❓' },
  { id: 'occlusion_unclear', label: 'Occlusion unclear', icon: '🌫️' },
  { id: 'edge_case', label: 'Edge case', icon: '⚠️' },
  { id: 'boundary_issue', label: 'Object at boundary', icon: '📍' },
  { id: 'other', label: 'Other', icon: '📝' },
] as const;

interface FlagModalProps {
  isOpen: boolean;
  annotationId: string | null;
  onClose: () => void;
  onSubmit: (annotationId: string, notes: string) => Promise<void>;
}

export const FlagModal: React.FC<FlagModalProps> = ({
  isOpen,
  annotationId,
  onClose,
  onSubmit,
}) => {
  const [selectedReason, setSelectedReason] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isOpen) {
      setSelectedReason(null);
      setNotes('');
      setIsSubmitting(false);
      setTimeout(() => textareaRef.current?.focus(), 100);
    }
  }, [isOpen]);

  if (!isOpen || !annotationId) return null;

  const handleReasonSelect = (reasonId: string) => {
    setSelectedReason(reasonId);
    const reason = FLAG_REASONS.find(r => r.id === reasonId);
    if (reason && reasonId !== 'other') {
      setNotes(reason.label);
    } else {
      setNotes('');
    }
  };

  const handleSubmit = async () => {
    if (!notes.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      await onSubmit(annotationId, notes.trim());
      onClose();
    } catch (error) {
      console.error('Failed to flag annotation:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.ctrlKey && notes.trim()) {
      handleSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg shadow-xl w-full max-w-md mx-4"
        onClick={e => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
          <div className="flex items-center gap-2 text-yellow-400">
            <FlagIcon />
            <span className="font-medium">Flag for Review</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 hover:bg-gray-700 rounded"
          >
            <XIcon />
          </button>
        </div>

        {/* Quick Reasons */}
        <div className="px-4 py-3">
          <div className="text-sm text-gray-400 mb-2">Quick Select:</div>
          <div className="grid grid-cols-2 gap-2">
            {FLAG_REASONS.map(reason => (
              <button
                key={reason.id}
                onClick={() => handleReasonSelect(reason.id)}
                className={`
                  flex items-center gap-2 px-3 py-2 rounded text-sm text-left
                  transition-colors
                  ${selectedReason === reason.id
                    ? 'bg-yellow-600/30 border border-yellow-500 text-yellow-300'
                    : 'bg-gray-700 border border-gray-600 hover:border-gray-500 text-gray-300'
                  }
                `}
              >
                <span>{reason.icon}</span>
                <span className="truncate">{reason.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Notes */}
        <div className="px-4 pb-3">
          <label className="block text-sm text-gray-400 mb-1">
            Notes <span className="text-red-400">*</span>
          </label>
          <textarea
            ref={textareaRef}
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="Describe why this needs further review..."
            className="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded
                       text-white placeholder-gray-500 text-sm
                       focus:outline-none focus:border-yellow-500
                       resize-none"
            rows={3}
          />
          <div className="text-xs text-gray-500 mt-1">
            Press Ctrl+Enter to submit
          </div>
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-gray-300 hover:text-white
                       hover:bg-gray-700 rounded transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!notes.trim() || isSubmitting}
            className={`
              px-4 py-2 text-sm rounded font-medium transition-colors
              flex items-center gap-2
              ${!notes.trim() || isSubmitting
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-yellow-600 text-white hover:bg-yellow-500'
              }
            `}
          >
            <FlagIcon />
            {isSubmitting ? 'Flagging...' : 'Flag for Review'}
          </button>
        </div>
      </div>
    </div>
  );
};

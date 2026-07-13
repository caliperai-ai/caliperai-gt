import React, { useState } from 'react';
import { useQAStore } from '@/store/qaStore';

const CheckIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
  </svg>
);

const XIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const FlagIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" />
  </svg>
);

const CommentIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
  </svg>
);

const EyeIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
  </svg>
);

const EditIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
  </svg>
);

const LightbulbIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
  </svg>
);

interface QAToolbarProps {
  annotationId?: string;
  frameId?: string;
  classId?: string;
}

export const QAToolbar: React.FC<QAToolbarProps> = ({ annotationId, frameId, classId }) => {
  const {
    qaMode,
    setQAMode,
    approveAnnotation,
    openRejectionModal,
    flagAnnotation,
    openCommentThread,
    getAnnotationReview,
  } = useQAStore();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showFlagInput, setShowFlagInput] = useState(false);
  const [flagNotes, setFlagNotes] = useState('');

  const currentReview = annotationId ? getAnnotationReview(annotationId) : undefined;
  const hasAnnotation = !!annotationId;

  const handleApprove = async () => {
    if (!annotationId) return;
    setIsSubmitting(true);
    try {
      await approveAnnotation(annotationId, frameId, classId);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = () => {
    if (!annotationId) return;
    openRejectionModal(annotationId, frameId, classId);
  };

  const handleFlag = async () => {
    if (!annotationId) return;
    if (showFlagInput) {
      setIsSubmitting(true);
      try {
        await flagAnnotation(annotationId, flagNotes || undefined, frameId, classId);
        setShowFlagInput(false);
        setFlagNotes('');
      } finally {
        setIsSubmitting(false);
      }
    } else {
      setShowFlagInput(true);
    }
  };

  const handleComment = () => {
    if (!annotationId) return;
    openCommentThread(annotationId);
  };

  const getVerdictIndicator = () => {
    if (!currentReview?.verdict) return null;

    const indicators: Record<string, { color: string; label: string }> = {
      approved: { color: 'bg-green-500', label: '✓ Approved' },
      rejected: { color: 'bg-red-500', label: '✗ Rejected' },
      flagged: { color: 'bg-yellow-500', label: '! Flagged' },
    };

    const info = indicators[currentReview.verdict];
    if (!info) return null;

    return (
      <div className={`px-2 py-1 rounded text-xs font-medium ${info.color} text-white`}>
        {info.label}
      </div>
    );
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-2 flex items-center gap-2 z-50">
      {/* Mode Toggle */}
      <div className="flex bg-gray-900 rounded-lg p-1 mr-2">
        <button
          onClick={() => setQAMode('view_only')}
          className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm transition-colors ${
            qaMode === 'view_only'
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
          title="View Only - Cannot edit annotations"
        >
          <EyeIcon />
          <span className="hidden sm:inline">View</span>
        </button>
        <button
          onClick={() => setQAMode('edit')}
          className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm transition-colors ${
            qaMode === 'edit'
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
          title="Edit Mode - Can modify annotations"
        >
          <EditIcon />
          <span className="hidden sm:inline">Edit</span>
        </button>
        <button
          onClick={() => setQAMode('suggest')}
          className={`flex items-center gap-1 px-3 py-1.5 rounded text-sm transition-colors ${
            qaMode === 'suggest'
              ? 'bg-blue-600 text-white'
              : 'text-gray-400 hover:text-white'
          }`}
          title="Suggest Mode - Changes are suggestions"
        >
          <LightbulbIcon />
          <span className="hidden sm:inline">Suggest</span>
        </button>
      </div>

      <div className="w-px h-8 bg-gray-700" />

      {/* Current verdict indicator */}
      {getVerdictIndicator()}

      {/* Action Buttons */}
      <button
        onClick={handleApprove}
        disabled={isSubmitting || !hasAnnotation}
        className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
        title="Approve annotation (1)"
      >
        <CheckIcon />
        <span>Approve</span>
        <kbd className="hidden sm:inline-block ml-1 px-1.5 py-0.5 bg-green-700 rounded text-xs">1</kbd>
      </button>

      <button
        onClick={handleReject}
        disabled={isSubmitting || !hasAnnotation}
        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
        title="Reject annotation (2)"
      >
        <XIcon />
        <span>Reject</span>
        <kbd className="hidden sm:inline-block ml-1 px-1.5 py-0.5 bg-red-700 rounded text-xs">2</kbd>
      </button>

      <button
        onClick={handleFlag}
        disabled={isSubmitting || !hasAnnotation}
        className="flex items-center gap-2 px-4 py-2 bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium text-black transition-colors"
        title="Flag for discussion (3)"
      >
        <FlagIcon />
        <span>Flag</span>
        <kbd className="hidden sm:inline-block ml-1 px-1.5 py-0.5 bg-yellow-700 rounded text-xs text-white">3</kbd>
      </button>

      <button
        onClick={handleComment}
        disabled={!hasAnnotation}
        className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm font-medium transition-colors"
        title="Add comment (C)"
      >
        <CommentIcon />
        <span>Comment</span>
        <kbd className="hidden sm:inline-block ml-1 px-1.5 py-0.5 bg-gray-600 rounded text-xs">C</kbd>
      </button>

      {/* Flag notes input (appears when flag clicked) */}
      {showFlagInput && (
        <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 bg-gray-800 border border-gray-700 rounded-lg p-3 shadow-xl min-w-[300px]">
          <label className="block text-sm font-medium mb-2">Flag Note (optional)</label>
          <input
            type="text"
            value={flagNotes}
            onChange={(e) => setFlagNotes(e.target.value)}
            placeholder="Add a note..."
            className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-sm focus:outline-none focus:border-yellow-500"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleFlag();
              if (e.key === 'Escape') setShowFlagInput(false);
            }}
          />
          <div className="flex justify-end gap-2 mt-2">
            <button
              onClick={() => setShowFlagInput(false)}
              className="px-3 py-1 text-sm text-gray-400 hover:text-white"
            >
              Cancel
            </button>
            <button
              onClick={handleFlag}
              className="px-3 py-1 text-sm bg-yellow-600 hover:bg-yellow-500 rounded text-black font-medium"
            >
              Flag
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default QAToolbar;

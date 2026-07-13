import React, { useState } from 'react';
import type { TaskStage } from '@/types';

interface QACompleteModalProps {
  stage: TaskStage;
  onAccept: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  onClose: () => void;
}

export const QACompleteModal: React.FC<QACompleteModalProps> = ({
  stage,
  onAccept,
  onReject,
  onClose,
}) => {
  const [mode, setMode] = useState<'choose' | 'reject'>('choose');
  const [rejectReason, setRejectReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isCustomerQA = stage === 'customer_qa';
  const acceptText = isCustomerQA ? 'Accept - Mark as Complete' : 'Accept QA - Move to Customer QA';
  const rejectText = isCustomerQA ? 'Reject - Send back to QA' : 'Reject - Send back to Annotator';
  const title = isCustomerQA ? 'Complete Customer QA Review' : 'Complete QA Review';
  const description = isCustomerQA
    ? 'Accept to mark task as complete, or reject to send back to internal QA'
    : 'Accept to move to Customer QA, or reject to send back to annotator';

  const handleAccept = async () => {
    setIsSubmitting(true);
    try {
      await onAccept();
      onClose();
    } catch (error) {
      console.error('Failed to accept QA:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;

    setIsSubmitting(true);
    try {
      await onReject(rejectReason);
      onClose();
    } catch (error) {
      console.error('Failed to reject QA:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {mode === 'choose' ? (
          <>
            {/* Header */}
            <div className="px-6 py-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-white">{title}</h3>
              <p className="text-sm text-gray-400 mt-1">
                {description}
              </p>
            </div>

            {/* Actions */}
            <div className="p-6 space-y-3">
              <button
                onClick={handleAccept}
                disabled={isSubmitting}
                className="w-full px-6 py-3 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium text-white transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {isSubmitting ? 'Accepting...' : acceptText}
              </button>

              <button
                onClick={() => setMode('reject')}
                disabled={isSubmitting}
                className="w-full px-6 py-3 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium text-white transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
                {rejectText}
              </button>

              <button
                onClick={onClose}
                disabled={isSubmitting}
                className="w-full px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </>
        ) : (
          <>
            {/* Reject Reason */}
            <div className="px-6 py-4 border-b border-gray-700 bg-red-500/10">
              <h3 className="text-lg font-semibold text-white">Reject {isCustomerQA ? 'Customer QA' : 'QA Review'}</h3>
              <p className="text-sm text-gray-400 mt-1">
                Provide a reason for rejection. Task will be sent back to {isCustomerQA ? 'internal QA' : 'the annotator'}.
              </p>
            </div>

            <div className="p-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Rejection Reason *
              </label>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g., Missing annotations on frames 10-15, incorrect class labels on pedestrians..."
                rows={4}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500 resize-none"
                autoFocus
              />

              <div className="flex gap-3 mt-4">
                <button
                  onClick={handleReject}
                  disabled={!rejectReason.trim() || isSubmitting}
                  className="flex-1 px-6 py-2.5 bg-red-600 hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium text-white transition-colors"
                >
                  {isSubmitting ? 'Rejecting...' : 'Confirm Rejection'}
                </button>
                <button
                  onClick={() => {
                    setMode('choose');
                    setRejectReason('');
                  }}
                  disabled={isSubmitting}
                  className="px-6 py-2.5 text-gray-400 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Back
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default QACompleteModal;

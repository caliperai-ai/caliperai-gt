
import React from 'react';
import { createPortal } from 'react-dom';
import type { TrackChangeScope } from '@/hooks/useTrackChangeConfirmation';

interface TrackChangeConfirmationModalProps {
  isOpen: boolean;
  changeDescription: string;
  onConfirm: (scope: TrackChangeScope) => void;
  onCancel: () => void;
}

export const TrackChangeConfirmationModal: React.FC<TrackChangeConfirmationModalProps> = ({
  isOpen,
  changeDescription,
  onConfirm,
  onCancel,
}) => {
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
      />

      {/* Modal */}
      <div className="relative bg-dark-panel border border-gray-600 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-700 bg-gradient-to-r from-amber-500/10 to-orange-500/10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white">Modify Tracked Object</h3>
              <p className="text-sm text-gray-400">This annotation is part of a track</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          <p className="text-gray-300 mb-4">
            You're changing <span className="text-white font-medium">{changeDescription}</span> on a tracked object.
          </p>
          <p className="text-gray-400 text-sm mb-6">
            How would you like to apply this change?
          </p>

          {/* Options */}
          <div className="space-y-3">
            {/* Current Frame Only */}
            <button
              onClick={() => onConfirm('current_frame')}
              className="w-full flex items-center gap-4 p-4 rounded-lg border border-gray-600 hover:border-blue-500 hover:bg-blue-500/10 transition-all group text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/30 transition-colors">
                <svg className="w-5 h-5 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-white font-medium">Current Frame Only</div>
                <div className="text-sm text-gray-400">Change only this frame, keep other frames unchanged</div>
              </div>
            </button>

            {/* Entire Track */}
            <button
              onClick={() => onConfirm('entire_track')}
              className="w-full flex items-center gap-4 p-4 rounded-lg border border-gray-600 hover:border-green-500 hover:bg-green-500/10 transition-all group text-left"
            >
              <div className="w-10 h-10 rounded-lg bg-green-500/20 flex items-center justify-center group-hover:bg-green-500/30 transition-colors">
                <svg className="w-5 h-5 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div className="flex-1">
                <div className="text-white font-medium">Entire Track</div>
                <div className="text-sm text-gray-400">Apply this change to all frames in the track</div>
              </div>
            </button>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 bg-dark-bg/50">
          <button
            onClick={onCancel}
            className="w-full px-4 py-2 text-gray-400 hover:text-white transition-colors text-sm"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};

export default TrackChangeConfirmationModal;

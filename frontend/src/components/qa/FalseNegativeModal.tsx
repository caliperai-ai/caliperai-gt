import React, { useState } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { getDefaultCuboidDimensions } from '@/utils/cuboidDimensions';

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

const PlusIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
  </svg>
);

interface FalseNegativeModalProps {
  location: { x: number; y: number; z: number } | null;
  onFlag: (classId?: string, message?: string) => void;
  onCreateAnnotation: (classId: string) => void;
  onClose: () => void;
  allowDirectCreation?: boolean;
}

export const FalseNegativeModal: React.FC<FalseNegativeModalProps> = ({
  location,
  onFlag,
  onCreateAnnotation,
  onClose,
  allowDirectCreation = true,
}) => {
  const { taxonomy, createAnnotation, activeClassId } = useEditorStore();
  const [selectedClassId, setSelectedClassId] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  if (!location) return null;

  const handleFlag = async () => {
    setIsSubmitting(true);
    try {
      await onFlag(
        selectedClassId || undefined,
        message || `Missing object at (${location.x.toFixed(1)}, ${location.y.toFixed(1)}, ${location.z.toFixed(1)})`
      );

      // ALSO create a placeholder cuboid so the annotator can easily find it
      const classIdToUse = selectedClassId || activeClassId || taxonomy?.classes[0]?.id;
      if (classIdToUse) {
        const [length, width, height] = getDefaultCuboidDimensions(classIdToUse, taxonomy);
        console.log('[FN Modal] Creating placeholder cuboid for annotator at:', location);
        createAnnotation({
          type: 'cuboid',
          data: {
            center: { x: location.x, y: location.y, z: location.z },
            dimensions: { length, width, height },
            rotation: { yaw: 0, pitch: 0, roll: 0 },
          },
          class_id: classIdToUse,
          source: 'qa_correction',
          attributes: {
            _isFalseNegative: true,
            _fnDescription: message || 'False Negative - needs annotation',
          },
        });
        console.log('[FN Modal] Placeholder cuboid created');
      }

      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreate = async () => {
    if (!selectedClassId) return;
    setIsSubmitting(true);
    try {
      await onCreateAnnotation(selectedClassId);
      handleClose();
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    onClose();
    setSelectedClassId(null);
    setMessage('');
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div className="bg-gray-800 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-amber-600/10">
          <div className="flex items-center gap-2">
            <FlagIcon />
            <h3 className="text-lg font-semibold text-white">Flag Missing Object</h3>
          </div>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <XIcon />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          {/* Location Display */}
          <div className="mb-4 p-3 bg-gray-700/50 rounded-lg">
            <div className="text-xs text-gray-400 mb-1">Clicked Location</div>
            <div className="font-mono text-sm text-amber-400">
              X: {location.x.toFixed(2)}, Y: {location.y.toFixed(2)}, Z: {location.z.toFixed(2)}
            </div>
          </div>

          {/* Class Selection (Optional) */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Suggested Class (optional)
            </label>
            <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
              {taxonomy?.classes?.map((cls) => (
                <button
                  key={cls.id}
                  onClick={() => setSelectedClassId(selectedClassId === cls.id ? null : cls.id)}
                  className={`
                    flex items-center gap-2 p-2 rounded-lg text-left transition-colors
                    ${selectedClassId === cls.id
                      ? 'bg-amber-600/20 border border-amber-500'
                      : 'bg-gray-700/50 border border-transparent hover:bg-gray-700'
                    }
                  `}
                >
                  <span
                    className="w-3 h-3 rounded flex-shrink-0"
                    style={{ backgroundColor: cls.color }}
                  />
                  <span className="text-xs truncate">{cls.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Message */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Message for Annotator
            </label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe what's missing (e.g., 'Pedestrian walking behind parked car')"
              rows={2}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm focus:outline-none focus:border-amber-500 resize-none"
            />
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-3">
            {/* Info text */}
            <div className="text-xs text-gray-400 bg-gray-700/30 rounded p-2">
              💡 <strong>Flag for Annotator</strong> creates a red placeholder cuboid at the clicked location to help the annotator find and fix this FN.
            </div>

            {/* Primary action: Flag for annotator (with box creation) */}
            <button
              onClick={handleFlag}
              disabled={isSubmitting}
              className="flex items-center justify-center gap-2 w-full px-6 py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg font-medium transition-colors"
            >
              <FlagIcon />
              {isSubmitting ? 'Flagging...' : 'Flag for Annotator'}
            </button>

            {/* Secondary action: Create annotation directly */}
            {allowDirectCreation && (
              <button
                onClick={handleCreate}
                disabled={!selectedClassId || isSubmitting}
                className="flex items-center justify-center gap-2 w-full px-6 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-sm transition-colors"
              >
                <PlusIcon />
                Create Annotation Directly
              </button>
            )}

            <button
              onClick={handleClose}
              className="w-full px-4 py-2 text-gray-400 hover:text-white transition-colors text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default FalseNegativeModal;

import React, { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { exportApi, ExportOptions } from '@/api/client';


export type ExportEntityType = 'dataset' | 'scene' | 'task';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  entityType: ExportEntityType;
  entityId: string;
  entityName: string;
  taxonomyId?: string;
  taxonomyName?: string;
}


export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  entityType,
  entityId,
  entityName,
  taxonomyId,
  taxonomyName,
}) => {
  const [includeData, setIncludeData] = useState(false);
  const [acceptedOnly, setAcceptedOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportMutation = useMutation({
    mutationFn: async () => {
      const options: ExportOptions = {
        includeData,
        acceptedOnly: entityType === 'dataset' ? acceptedOnly : undefined,
        taxonomyId: taxonomyId || undefined,
      };

      let blob: Blob;
      let filename: string;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

      options.format = 'coco';

      switch (entityType) {
        case 'task':
          blob = await exportApi.exportTask(entityId, options);
          filename = `task_${entityName}_${timestamp}.zip`;
          break;
        case 'scene':
          blob = await exportApi.exportScene(entityId, options);
          filename = `scene_${entityName}_${timestamp}.zip`;
          break;
        case 'dataset':
          blob = await exportApi.exportDataset(entityId, options);
          filename = `dataset_${entityName}_${timestamp}.zip`;
          break;
        default:
          throw new Error('Unknown entity type');
      }

      return { blob, filename };
    },
    onSuccess: ({ blob, filename }) => {
      exportApi.downloadBlob(blob, filename);
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message || 'Export failed');
    },
  });

  const handleExport = () => {
    setError(null);
    exportMutation.mutate();
  };

  if (!isOpen) return null;

  const entityLabel = entityType.charAt(0).toUpperCase() + entityType.slice(1);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
      <div
        className="absolute inset-0"
        onClick={onClose}
      />

      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-md shadow-xl border border-gray-700 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <svg className="w-5 h-5 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-white">Export {entityLabel}</h2>
            <p className="text-sm text-gray-400 truncate max-w-[280px]">{entityName}</p>
            {/* Taxonomy pill or reminder */}
            {taxonomyName ? (
              <span className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-0.5 rounded-full bg-teal-500/15 border border-teal-500/30 text-teal-300 text-xs font-medium">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 10V5a2 2 0 012-2z" />
                </svg>
                {taxonomyName}
              </span>
            ) : (
              <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
                <svg className="w-3 h-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                </svg>
                Please select a taxonomy first
              </p>
            )}
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Export Options */}
        <div className="space-y-4 mb-6">
          {/* Labels Only vs Data + Labels */}
          <div className="space-y-3">
            <label className="text-sm font-medium text-gray-300">Export Contents</label>

            <label className="flex items-start gap-3 p-3 bg-dark rounded-lg cursor-pointer border border-gray-600 hover:border-gray-500 transition-colors">
              <input
                type="radio"
                name="exportType"
                checked={!includeData}
                onChange={() => setIncludeData(false)}
                className="mt-1 accent-primary"
              />
              <div>
                <div className="font-medium text-white">Labels Only</div>
                <div className="text-sm text-gray-400">
                  Export as ZIP with per-sensor annotation files (lidar.json, camera_*.json) in COCO format. Includes metadata and calibration.
                </div>
              </div>
            </label>

            <label className="flex items-start gap-3 p-3 bg-dark rounded-lg cursor-pointer border border-gray-600 hover:border-gray-500 transition-colors">
              <input
                type="radio"
                name="exportType"
                checked={includeData}
                onChange={() => setIncludeData(true)}
                className="mt-1 accent-primary"
              />
              <div>
                <div className="font-medium text-white">Data + Labels</div>
                <div className="text-sm text-gray-400">
                  Export as ZIP with both per-sensor annotations and raw data files (point clouds, images).
                </div>
              </div>
            </label>
          </div>

          {/* Dataset-specific: Accepted only filter */}
          {entityType === 'dataset' && (
            <label className="flex items-center gap-3 p-3 bg-dark rounded-lg cursor-pointer border border-gray-600 hover:border-gray-500 transition-colors">
              <input
                type="checkbox"
                checked={acceptedOnly}
                onChange={(e) => setAcceptedOnly(e.target.checked)}
                className="accent-primary w-4 h-4"
              />
              <div>
                <div className="font-medium text-white">Accepted Tasks Only</div>
                <div className="text-sm text-gray-400">
                  Only include annotations from tasks that have been accepted/completed.
                </div>
              </div>
            </label>
          )}
        </div>

        {/* Taxonomy filter indicator */}
        {taxonomyId && (
          <div className="mb-4 p-3 bg-teal-500/10 border border-teal-500/30 rounded text-teal-300 text-sm flex items-center gap-2">
            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 10V5a2 2 0 012-2z" />
            </svg>
            <span>Exporting <strong>selected taxonomy only</strong> — segmentation labels or object detection annotations are exported separately based on the active taxonomy.</span>
          </div>
        )}

        {/* Info box */}
        <div className="mb-6 p-3 bg-blue-500/10 border border-blue-500/30 rounded text-blue-300 text-sm">
          <strong>Export Format:</strong> Labels are exported in native JSON format with full annotation
          details including 3D cuboids, 2D boxes, 4D annotations, and fusion annotations.
        </div>

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={exportMutation.isPending}
            className="px-4 py-2 text-gray-300 hover:text-white transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={exportMutation.isPending}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {exportMutation.isPending ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Exporting...
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Export
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// EXPORT BUTTON (Convenience component)
// =============================================================================

interface ExportButtonProps {
  entityType: ExportEntityType;
  entityId: string;
  entityName: string;
  className?: string;
  variant?: 'icon' | 'text' | 'full';
  taxonomyId?: string;
  taxonomyName?: string;
}

export const ExportButton: React.FC<ExportButtonProps> = ({
  entityType,
  entityId,
  entityName,
  className = '',
  variant = 'icon',
  taxonomyId,
  taxonomyName,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const buttonContent = {
    icon: (
      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
      </svg>
    ),
    text: 'Download',
    full: (
      <>
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
        </svg>
        Download
      </>
    ),
  };

  const baseClasses = {
    icon: 'p-2 rounded hover:bg-gray-700 transition-colors text-gray-400 hover:text-white',
    text: 'px-3 py-1.5 rounded text-sm hover:bg-gray-700 transition-colors text-gray-400 hover:text-white',
    full: 'px-3 py-2 rounded-lg bg-dark hover:bg-gray-700 transition-colors text-white flex items-center gap-2 text-sm',
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setIsModalOpen(true)}
        className={`${baseClasses[variant]} ${className}`}
        title={`Export ${entityType}`}
      >
        {buttonContent[variant]}
      </button>

      <ExportModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        entityType={entityType}
        entityId={entityId}
        entityName={entityName}
        taxonomyId={taxonomyId}
        taxonomyName={taxonomyName}
      />
    </>
  );
};

export default ExportModal;

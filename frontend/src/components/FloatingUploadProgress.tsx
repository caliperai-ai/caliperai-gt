import React from 'react';
import { useUpload, UploadTask } from '../providers/UploadProvider';
import { useCurrentOrganizationId } from '@/store/organizationStore';
import { useLocation } from 'react-router-dom';

const UploadItem: React.FC<{ upload: UploadTask; onCancel: () => void; onRemove: () => void }> = ({ 
  upload, 
  onCancel, 
  onRemove 
}) => {
  const isActive = upload.status === 'uploading' || upload.status === 'processing';
  const isComplete = upload.status === 'complete';
  const isError = upload.status === 'error';

  return (
    <div className="p-3 border-b border-gray-700 last:border-b-0">
      <div className="flex items-center justify-between mb-1">
        <div className="flex-1 min-w-0 mr-2">
          <p className="text-sm text-white truncate font-medium" title={upload.fileName}>
            {upload.fileName}
          </p>
          <p className="text-xs text-gray-400 truncate" title={upload.datasetName}>
            {upload.datasetName}
          </p>
        </div>
        {isActive && (
          <button
            onClick={onCancel}
            className="text-gray-400 hover:text-red-400 p-1 transition-colors"
            title="Cancel upload"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
        {(isComplete || isError) && (
          <button
            onClick={onRemove}
            className="text-gray-400 hover:text-gray-200 p-1 transition-colors"
            title="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
      
      {isActive && (
        <>
          <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
            <span>
              {upload.status === 'processing' ? 'Processing...' : `${upload.progress.toFixed(1)}%`}
            </span>
            {upload.speed && upload.status === 'uploading' && (
              <span>{upload.speed}</span>
            )}
          </div>
          <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
            {upload.status === 'processing' ? (
              <div className="h-full bg-cyan-500 animate-pulse w-full" />
            ) : (
              <div 
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${upload.progress}%` }}
              />
            )}
          </div>
        </>
      )}
      
      {isComplete && (
        <div className="flex items-center gap-1 text-xs text-green-400">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span>Upload complete</span>
        </div>
      )}
      
      {isError && (
        <div className="text-xs text-red-400" title={upload.error}>
          <span className="line-clamp-2">{upload.error || 'Upload failed'}</span>
        </div>
      )}
    </div>
  );
};

export const FloatingUploadProgress: React.FC = () => {
  const { uploads, cancelUpload, removeUpload, isMinimized, setMinimized } = useUpload();
  const currentOrganizationId = useCurrentOrganizationId();
  const location = useLocation();

  const isTaskPage = location.pathname.startsWith('/tasks/');
  const visibleUploads = uploads.filter((upload) => upload.organizationId === currentOrganizationId);

  if (isTaskPage || visibleUploads.length === 0) return null;

  const activeUploads = visibleUploads.filter(u => u.status === 'uploading' || u.status === 'processing');
  const completedUploads = visibleUploads.filter(u => u.status === 'complete' || u.status === 'error');
  const hasCompleted = completedUploads.length > 0;

  // Calculate overall progress for minimized view
  const overallProgress = activeUploads.length > 0
    ? activeUploads.reduce((sum, u) => sum + u.progress, 0) / activeUploads.length
    : 100;

  const clearVisibleCompleted = () => {
    visibleUploads
      .filter((upload) => upload.status === 'complete' || upload.status === 'error')
      .forEach((upload) => removeUpload(upload.id));
  };

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 bg-dark-panel border border-gray-700 rounded-lg shadow-2xl overflow-hidden">
      {/* Header */}
      <div 
        className="flex items-center justify-between px-3 py-2 bg-dark border-b border-gray-700 cursor-pointer"
        onClick={() => setMinimized(!isMinimized)}
      >
        <div className="flex items-center gap-2">
          {activeUploads.length > 0 ? (
            <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          <span className="text-sm font-medium text-white">
            {activeUploads.length > 0 
              ? `Uploading ${activeUploads.length} file${activeUploads.length > 1 ? 's' : ''}`
              : `${completedUploads.length} upload${completedUploads.length > 1 ? 's' : ''} complete`
            }
          </span>
        </div>
        <div className="flex items-center gap-1">
          {hasCompleted && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                clearVisibleCompleted();
              }}
              className="text-xs text-gray-400 hover:text-white px-2 py-1 rounded hover:bg-gray-700 transition-colors"
            >
              Clear
            </button>
          )}
          <button className="text-gray-400 hover:text-white p-1 transition-colors">
            <svg 
              className={`w-4 h-4 transition-transform ${isMinimized ? '' : 'rotate-180'}`} 
              fill="none" 
              stroke="currentColor" 
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>
      </div>

      {/* Minimized progress bar */}
      {isMinimized && activeUploads.length > 0 && (
        <div className="h-1 bg-gray-700">
          <div 
            className="h-full bg-primary transition-all duration-300"
            style={{ width: `${overallProgress}%` }}
          />
        </div>
      )}

      {/* Upload list */}
      {!isMinimized && (
        <div className="max-h-64 overflow-y-auto">
          {visibleUploads.map(upload => (
            <UploadItem
              key={upload.id}
              upload={upload}
              onCancel={() => cancelUpload(upload.id)}
              onRemove={() => removeUpload(upload.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import JSZip from 'jszip';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { datasetApi, taxonomyApi, importApi, sceneApi, taskApi, userApi, dataopsApi, campaignApi, workflowApi, type ValidateResponse, type ImportResponse, type RenamedScene, type BrowseFolderResponse, type FolderItem } from '@/api/client';
import type { Dataset, Taxonomy, Scene, Task } from '@/types';
import TaskCreationModal from '@/components/TaskCreationModal';
import { TaskDetailModal } from '@/components/TaskDetailModal';
import { ExportButton } from '@/components/ExportModal';
import { ImportAnnotationsModal } from '@/components/ImportAnnotationsModal';
import { GCSBrowser } from '@/components/GCSBrowser';
import { AdminOnly } from '@/components/auth/ProtectedRoute';
import { AppLayout } from '@/components/layout';
import { StageProgressInline } from '@/components/workflow';
import { useUpload } from '@/providers/UploadProvider';
import { useCurrentOrganizationId } from '@/store/organizationStore';
import { GettingStartedCard, SetupProgressBanner } from '@/components/onboarding';

interface ImportDataModalProps {
  isOpen: boolean;
  datasetId: string;
  datasetName: string;
  onClose: () => void;
  onSuccess: () => void;
  onRenamedScenes: (scenes: RenamedScene[]) => void;
}

const FolderBrowser: React.FC<{
  currentPath: string;
  onSelectPath: (path: string) => void;
  onClose: () => void;
}> = ({ currentPath, onSelectPath, onClose }) => {
  const [browsePath, setBrowsePath] = useState(currentPath || '/');
  const [folderData, setFolderData] = useState<BrowseFolderResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFolder = async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await importApi.browse(path);
      setFolderData(data);
      setBrowsePath(data.current_path);
    } catch (err: unknown) {
      const e = err as Error & { response?: { data?: { detail?: string } } };
      setError(e.response?.data?.detail || e.message || 'Failed to browse folder');
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    loadFolder(browsePath);
  }, []);

  const handleSelectFolder = (item: FolderItem) => {
    if (item.is_directory) {
      loadFolder(item.path);
    }
  };

  const handleGoUp = () => {
    if (folderData?.parent_path) {
      loadFolder(folderData.parent_path);
    }
  };

  const handleConfirm = () => {
    onSelectPath(browsePath);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />
      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-xl mx-4 shadow-xl border border-gray-700 max-h-[80vh] flex flex-col">
        <h3 className="text-lg font-semibold text-white mb-4">Browse Folders</h3>

        {/* Current Path */}
        <div className="mb-4 p-2 bg-dark rounded border border-gray-600">
          <p className="text-sm text-gray-400">Current Path:</p>
          <p className="text-white font-mono text-sm truncate">{browsePath}</p>
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex-1 flex items-center justify-center py-8">
            <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full"></div>
          </div>
        ) : (
          <div className="flex-1 overflow-auto border border-gray-600 rounded bg-dark mb-4">
            {/* Parent Directory */}
            {folderData?.parent_path && (
              <button
                onClick={handleGoUp}
                className="w-full px-4 py-2 text-left hover:bg-gray-700 flex items-center gap-2 border-b border-gray-700"
              >
                <span className="text-yellow-400">📁</span>
                <span className="text-gray-300">..</span>
              </button>
            )}

            {/* Folder Contents */}
            {folderData?.items.map((item) => (
              <button
                key={item.path}
                onClick={() => handleSelectFolder(item)}
                className={`w-full px-4 py-2 text-left hover:bg-gray-700 flex items-center gap-2 ${
                  item.is_directory ? '' : 'opacity-50 cursor-default'
                }`}
                disabled={!item.is_directory}
              >
                <span>{item.is_directory ? '📁' : '📄'}</span>
                <span className={item.is_directory ? 'text-white' : 'text-gray-500'}>{item.name}</span>
                {!item.is_directory && item.size && (
                  <span className="ml-auto text-xs text-gray-500">
                    {(item.size / 1024).toFixed(1)} KB
                  </span>
                )}
              </button>
            ))}

            {folderData?.items.length === 0 && (
              <div className="p-4 text-center text-gray-500">
                Empty folder
              </div>
            )}
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
          >
            Select This Folder
          </button>
        </div>
      </div>
    </div>
  );
};

// ─── Duplicate Scene Rename Modal ──────────────────────────────────────────

interface DuplicateSceneModalProps {
  scenes: RenamedScene[];
  onClose: () => void;
}

const DuplicateSceneModal: React.FC<DuplicateSceneModalProps> = ({ scenes, onClose }) => {
  const [editedNames, setEditedNames] = useState<Record<string, string>>(() =>
    Object.fromEntries(scenes.map(s => [s.scene_id, s.new_name]))
  );
  const [comments, setComments] = useState<Record<string, string>>(() =>
    Object.fromEntries(scenes.map(s => [s.scene_id, '']))
  );
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        scenes.map(s => {
          const update: Record<string, string> = {};
          if (editedNames[s.scene_id] !== s.new_name) update.name = editedNames[s.scene_id];
          if (comments[s.scene_id]?.trim()) update.description = comments[s.scene_id].trim();
          if (Object.keys(update).length > 0) return sceneApi.update(s.scene_id, update);
          return Promise.resolve();
        })
      );
    } finally {
      setSaving(false);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-lg mx-4 shadow-xl border border-amber-500/40">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-8 h-8 rounded-full bg-amber-500/20 flex items-center justify-center text-amber-400 text-lg">!</div>
          <div>
            <h2 className="text-white font-semibold">Duplicate Scene{scenes.length > 1 ? 's' : ''} Detected</h2>
            <p className="text-xs text-gray-400">
              {scenes.length === 1
                ? 'A scene with this name already existed. It has been saved with a new name.'
                : `${scenes.length} scenes already existed and were saved with new names.`}
            </p>
          </div>
        </div>

        <div className="space-y-5 max-h-[60vh] overflow-y-auto pr-1">
          {scenes.map(s => (
            <div key={s.scene_id} className="bg-gray-800/60 rounded-lg p-4 border border-gray-700">
              <p className="text-xs text-gray-500 mb-1">Original name</p>
              <p className="text-sm text-gray-300 font-mono mb-3 line-clamp-1">{s.original_name}</p>

              <label className="block text-xs text-gray-400 mb-1">New scene name (editable)</label>
              <input
                type="text"
                value={editedNames[s.scene_id] ?? s.new_name}
                onChange={e => setEditedNames(prev => ({ ...prev, [s.scene_id]: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-cyan-500 font-mono"
              />

              <label className="block text-xs text-gray-400 mt-3 mb-1">Comment (optional)</label>
              <textarea
                rows={2}
                placeholder="Add a note about this re-upload…"
                value={comments[s.scene_id] ?? ''}
                onChange={e => setComments(prev => ({ ...prev, [s.scene_id]: e.target.value }))}
                className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500 resize-none"
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-3 mt-5">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Done
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 text-sm bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white rounded transition-colors"
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

const ImportDataModal: React.FC<ImportDataModalProps> = ({
  isOpen,
  datasetId,
  datasetName,
  onClose,
  onSuccess,
  onRenamedScenes,
}) => {
  const { addUpload, updateUpload } = useUpload();
  const currentOrganizationId = useCurrentOrganizationId();
  const [uploadMode, setUploadMode] = useState<'local' | 'server' | 'gcs'>('local');
  const [showGCSBrowser, setShowGCSBrowser] = useState(false);
  const [rootPath, setRootPath] = useState('/home');
  const [step, setStep] = useState<'input' | 'validating' | 'validated' | 'importing' | 'complete' | 'checking' | 'conflict'>('input');
  const [validationResult, setValidationResult] = useState<ValidateResponse | null>(null);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<Array<{ original_name: string; suggested_name: string }>>([]);
  const [conflictNames, setConflictNames] = useState<Record<string, string>>({});
  const [conflictComment, setConflictComment] = useState<Record<string, string>>({});
  const [conflictError, setConflictError] = useState<string | null>(null);
  const pendingUploadRef = React.useRef<((overrides: Record<string, string>, descriptions?: Record<string, string>) => void) | null>(null);
  const [showBrowser, setShowBrowser] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
  const [deriveTaxonomy, setDeriveTaxonomy] = useState(true); // Default to enabled
  const [overwriteAnnotations, setOverwriteAnnotations] = useState(false); // Default to disabled
  const [uploadType, setUploadType] = useState<'folder' | 'zip' | 'video'>('folder');
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const zipInputRef = React.useRef<HTMLInputElement>(null);
  const videoInputRef = React.useRef<HTMLInputElement>(null);
  // Synchronous lock so a fast double-click can't fire two upload requests
  // (state updates are async, so a `step`-based guard isn't enough).
  const uploadInFlightRef = React.useRef(false);
  const [selectedZipFile, setSelectedZipFile] = useState<File | null>(null);
  const [selectedVideoFile, setSelectedVideoFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadSpeed, setUploadSpeed] = useState<string>('');
  const [preserveFolderNames, setPreserveFolderNames] = useState(true); // Default to preserving names
  const [videoExtractionFps, setVideoExtractionFps] = useState<string>(''); // Empty = auto-detect
  const [videoMaxFrames, setVideoMaxFrames] = useState<string>(''); // Empty = no limit

  // Browser file count limit warning
  const FILE_COUNT_LIMIT = 100;  // Lower limit for safety (was 1000)
  const FILE_COUNT_WARNING = 50; // Show warning at 50 files
  const SIZE_WARNING_MB = 500;   // Warn if total size > 500 MB
  const SIZE_LIMIT_MB = 2000;    // Block folder upload if > 2 GB

  const showFileLimitWarning = selectedFiles && selectedFiles.length >= FILE_COUNT_LIMIT;
  const showFileLimitSoftWarning = selectedFiles && selectedFiles.length >= FILE_COUNT_WARNING && selectedFiles.length < FILE_COUNT_LIMIT;

  // Calculate total size for size-based warnings (especially for 4K images)
  const totalSizeMB = selectedFiles ?
    Array.from(selectedFiles).reduce((sum, file) => sum + file.size, 0) / (1024 * 1024) : 0;
  const showSizeWarning = totalSizeMB > SIZE_WARNING_MB && totalSizeMB < SIZE_LIMIT_MB;
  const showSizeLimit = totalSizeMB >= SIZE_LIMIT_MB;

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setSelectedFiles(e.target.files);
      setSelectedZipFile(null);
      setSelectedVideoFile(null);
      setError(null);
    }
  };

  const handleZipSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (file.name.toLowerCase().endsWith('.zip')) {
        setSelectedZipFile(file);
        setSelectedFiles(null);
        setSelectedVideoFile(null);
        setError(null);
      } else {
        setError('Please select a ZIP file (.zip)');
      }
    }
  };

  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const validExtensions = ['.mp4', '.avi', '.mov', '.mkv', '.webm', '.m4v'];
      const ext = file.name.toLowerCase().slice(file.name.lastIndexOf('.'));
      if (validExtensions.includes(ext)) {
        setSelectedVideoFile(file);
        setSelectedFiles(null);
        setSelectedZipFile(null);
        setError(null);
      } else {
        setError(`Please select a valid video file (${validExtensions.join(', ')})`);
      }
    }
  };

  const handleUploadFiles = async () => {
    // Handle Video upload
    if (uploadType === 'video' && selectedVideoFile) {
      // Guard against double-submit (a fast double-click can fire two requests
      // before the button unmounts, since state updates are async).
      if (uploadInFlightRef.current) return;
      uploadInFlightRef.current = true;

      setStep('importing');
      setError(null);
      setUploadProgress(0);
      setUploadSpeed('');

      try {
        const result = await importApi.uploadVideo(
          datasetId,
          selectedVideoFile,
          {
            extractionFps: videoExtractionFps ? parseFloat(videoExtractionFps) : undefined,
            maxFrames: videoMaxFrames ? parseInt(videoMaxFrames, 10) : undefined,
            imageFormat: 'jpg',
            preserveFolderNames,
          },
          (progress, speed) => {
            setUploadProgress(progress);
            if (speed) setUploadSpeed(speed);
          }
        );
        setImportResult(result);
        if (result.renamed_scenes?.length) onRenamedScenes(result.renamed_scenes);
        setStep('complete');
        onSuccess();
      } catch (err: unknown) {
        const error = err as Error;
        setError(error.message || 'Video upload failed');
        setStep('input');
        setUploadProgress(0);
        setUploadSpeed('');
      } finally {
        uploadInFlightRef.current = false;
      }
      return;
    }

    // Handle ZIP upload — pre-check scene names before uploading
    if (uploadType === 'zip' && selectedZipFile) {
      // Helper: start the actual background upload with optional name overrides + descriptions
      const startZipUpload = (nameOverrides: Record<string, string>, descriptions: Record<string, string> = {}) => {
        const uploadId = addUpload({
          organizationId: currentOrganizationId,
          datasetId,
          datasetName: datasetName || 'Dataset',
          fileName: selectedZipFile.name,
          progress: 0,
          speed: '',
          status: 'uploading',
        });

        handleClose();

        (async () => {
          try {
            const formData = new FormData();
            formData.append('dataset_id', datasetId);
            formData.append('derive_taxonomy', deriveTaxonomy.toString());
            formData.append('overwrite_annotations', overwriteAnnotations.toString());
            formData.append('preserve_folder_names', preserveFolderNames.toString());
            formData.append('name_overrides', JSON.stringify(nameOverrides));
            formData.append('scene_descriptions', JSON.stringify(descriptions));
            formData.append('file', selectedZipFile);

            const xhr = new XMLHttpRequest();
            const startTime = Date.now();
            let lastLoaded = 0;
            let lastTime = startTime;

            xhr.upload.addEventListener('progress', (e) => {
              if (e.lengthComputable) {
                const percentComplete = (e.loaded / e.total) * 100;
                const now = Date.now();
                const timeDiff = (now - lastTime) / 1000;
                const loadedDiff = e.loaded - lastLoaded;
                let speedStr = '';
                if (timeDiff > 0.5) {
                  const speedMBps = (loadedDiff / (1024 * 1024)) / timeDiff;
                  speedStr = `${speedMBps.toFixed(1)} MB/s`;
                  lastLoaded = e.loaded;
                  lastTime = now;
                }
                updateUpload(uploadId, { progress: percentComplete, speed: speedStr || undefined });
              }
            });

            const token = localStorage.getItem('auth-storage')
              ? JSON.parse(localStorage.getItem('auth-storage') || '{}').state?.accessToken
              : '';

            xhr.open('POST', '/api/v1/import/upload-zip');
            xhr.setRequestHeader('Authorization', `Bearer ${token}`);

            xhr.onload = async () => {
              if (xhr.status === 200) {
                try {
                  const result = JSON.parse(xhr.responseText);
                  if (!result.success && result.scenes_imported === 0) {
                    const errMsg = (result.errors || []).join('; ') || 'Upload failed: no scenes were imported';
                    updateUpload(uploadId, { status: 'error', error: errMsg });
                  } else {
                    updateUpload(uploadId, { status: 'complete', progress: 100 });
                    onSuccess();
                  }
                } catch {
                  updateUpload(uploadId, { status: 'complete', progress: 100 });
                  onSuccess();
                }
              } else {
                let errorMessage = `Upload failed with status ${xhr.status}`;
                try {
                  const errorData = JSON.parse(xhr.responseText);
                  errorMessage = errorData.detail || errorMessage;
                } catch { /* keep default */ }
                updateUpload(uploadId, { status: 'error', error: errorMessage });
              }
            };

            xhr.ontimeout = () => updateUpload(uploadId, { status: 'error', error: 'Upload timed out.' });
            xhr.onerror = () => updateUpload(uploadId, { status: 'error', error: 'Network error during upload.' });
            xhr.send(formData);
          } catch (err: unknown) {
            const e = err as Error;
            updateUpload(uploadId, { status: 'error', error: e.message || 'ZIP upload failed' });
          }
        })();
      };

      // Step 1: read zip folder names and check for conflicts before uploading
      setStep('checking');
      setError(null);
      try {
        const zip = await JSZip.loadAsync(selectedZipFile);
        const paths = Object.keys(zip.files);

        // Mirror backend logic: collect top-level dirs; if single wrapper, look one level deeper
        const depth0Dirs = new Set<string>();
        paths.forEach(p => { const f = p.split('/')[0]; if (f) depth0Dirs.add(f); });

        let candidateDirs: string[];
        const hasRootMetadata = paths.includes('metadata.json');
        if (depth0Dirs.size === 1 && !hasRootMetadata) {
          // Single top-level wrapper — scene dirs are one level inside
          const wrapper = [...depth0Dirs][0];
          const depth1 = new Set<string>();
          paths.forEach(p => {
            const parts = p.split('/');
            if (parts[0] === wrapper && parts[1]) depth1.add(parts[1]);
          });
          candidateDirs = [...depth1];
        } else {
          candidateDirs = [...depth0Dirs];
        }

        const token = localStorage.getItem('auth-storage')
          ? JSON.parse(localStorage.getItem('auth-storage') || '{}').state?.accessToken
          : '';

        const checkResp = await fetch('/api/v1/import/check-scene-names', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            dataset_id: datasetId,
            folder_names: candidateDirs,
            preserve_folder_names: preserveFolderNames,
          }),
        });
        const checkData = await checkResp.json();

        if (checkData.conflicts && checkData.conflicts.length > 0) {
          setConflicts(checkData.conflicts);
          setConflictNames(Object.fromEntries(checkData.conflicts.map((c: { original_name: string; suggested_name: string }) => [c.original_name, c.suggested_name])));
          setConflictComment(Object.fromEntries(checkData.conflicts.map((c: { original_name: string }) => [c.original_name, ''])));
          setConflictError(null);
          pendingUploadRef.current = startZipUpload;
          setStep('conflict');
          return;
        }

        // No conflicts — upload immediately
        startZipUpload({});
      } catch (err: unknown) {
        console.error('[zip-check] failed, uploading without pre-check:', err);
        startZipUpload({});
      }
      return;
    }

    // Handle folder upload
    if (!selectedFiles || selectedFiles.length === 0) {
      setError('Please select files to upload');
      return;
    }

    setStep('importing');
    setError(null);

    try {
      const formData = new FormData();
      formData.append('dataset_id', datasetId);
      formData.append('derive_taxonomy', deriveTaxonomy.toString());
      formData.append('overwrite_annotations', overwriteAnnotations.toString());
      formData.append('preserve_folder_names', preserveFolderNames.toString());

      // Add all selected files
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        // Use webkitRelativePath if available (folder upload), otherwise just filename
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        formData.append('files', file, relativePath);
      }

      const response = await fetch('/api/v1/import/upload', {
        method: 'POST',
        body: formData,
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('auth-storage') ? JSON.parse(localStorage.getItem('auth-storage') || '{}').state?.accessToken : ''}`,
        },
        // Add signal for abort on timeout (optional, but good practice)
        signal: AbortSignal.timeout(7200000), // 2 hour timeout matching backend
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: `Upload failed with status ${response.status}` }));
        throw new Error(errorData.detail || `Upload failed with status ${response.status}. For large datasets (100+ files), use ZIP upload.`);
      }

      const result = await response.json();
      setImportResult(result);
      if (result.renamed_scenes?.length) onRenamedScenes(result.renamed_scenes);
      setStep('complete');
      onSuccess();
    } catch (err: unknown) {
      const error = err as Error;
      setError(error.message || 'Upload failed');
      setStep('input');
    }
  };

  const handleValidate = async () => {
    setStep('validating');
    setError(null);
    try {
      const result = await importApi.validate(rootPath);
      setValidationResult(result);
      setStep('validated');
    } catch (err: unknown) {
      const error = err as Error & { response?: { data?: { detail?: string } } };
      setError(error.response?.data?.detail || error.message || 'Validation failed');
      setStep('input');
    }
  };

  const handleImport = async () => {
    setStep('importing');
    setError(null);
    try {
      const result = await importApi.import({
        dataset_id: datasetId,
        root_path: rootPath,
      });
      setImportResult(result);
      if (result.renamed_scenes?.length) onRenamedScenes(result.renamed_scenes);
      setStep('complete');
      onSuccess();
    } catch (err: unknown) {
      const error = err as Error & { response?: { data?: { detail?: string } } };
      setError(error.response?.data?.detail || error.message || 'Import failed');
      setStep('validated');
    }
  };

  const handleClose = () => {
    setStep('input');
    setValidationResult(null);
    setImportResult(null);
    setError(null);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={handleClose} />

      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-2xl mx-4 shadow-xl border border-gray-700 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-white mb-4">Import Sensor Data</h2>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Folder Structure Helper */}
        <details className="mb-4 group">
          <summary className="cursor-pointer text-sm text-cyan-400 hover:text-cyan-300 flex items-center gap-2">
            <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            📁 Expected Folder Structure
          </summary>
          <div className="mt-3 p-4 bg-dark/50 border border-gray-700 rounded-lg text-xs font-mono text-gray-300 overflow-x-auto">
            <pre className="whitespace-pre">{`dataset_folder/
├── data/                        # Sensor data (required)
│   ├── calibrations.json        # Camera-to-lidar calibrations
│   ├── lidar/                   # LiDAR point clouds
│   │   ├── 000000.pcd           # Frame 0
│   │   ├── 000001.pcd           # Frame 1
│   │   └── ...
│   ├── cameras/                 # Camera images per sensor
│   │   ├── camera_front/
│   │   │   ├── 000000.jpg
│   │   │   └── ...
│   │   ├── camera_rear/
│   │   └── ...
│   └── ego_poses/               # Vehicle pose data (optional)
│       └── poses.json
│
└── annotations/                 # Pre-existing annotations (optional)
    ├── lidar.json               # 3D annotations (COCO format)
    ├── camera_front.json        # 2D annotations per camera
    └── ...`}</pre>
            <div className="mt-3 pt-3 border-t border-gray-700 text-gray-400 font-sans text-xs space-y-1">
              <p><span className="text-green-400">✓</span> <strong>data/</strong> folder with sensor data is required</p>
              <p><span className="text-blue-400">○</span> <strong>annotations/</strong> folder is optional - can be uploaded separately</p>
              <p><span className="text-purple-400">★</span> If annotations included, a taxonomy will be auto-derived from class names</p>
              <p><span className="text-cyan-400">🎬</span> <strong>Video:</strong> Upload MP4, AVI, MOV files directly - frames are extracted automatically</p>
            </div>
          </div>
        </details>

        {/* Step 1: Input Path */}
        {step === 'input' && (
          <div>
            {/* Upload Mode Toggle */}
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Upload Source
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setUploadMode('local')}
                  className={`flex-1 px-4 py-3 rounded-lg border transition-colors flex items-center justify-center gap-2 ${
                    uploadMode === 'local'
                      ? 'bg-primary/20 border-primary text-white'
                      : 'bg-dark border-gray-600 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                  My Computer
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode('server')}
                  className={`flex-1 px-4 py-3 rounded-lg border transition-colors flex items-center justify-center gap-2 ${
                    uploadMode === 'server'
                      ? 'bg-primary/20 border-primary text-white'
                      : 'bg-dark border-gray-600 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" />
                  </svg>
                  Server Path
                </button>
                <button
                  type="button"
                  onClick={() => setUploadMode('gcs')}
                  className={`flex-1 px-4 py-3 rounded-lg border transition-colors flex items-center justify-center gap-2 ${
                    uploadMode === 'gcs'
                      ? 'bg-primary/20 border-primary text-white'
                      : 'bg-dark border-gray-600 text-gray-400 hover:border-gray-500'
                  }`}
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                  </svg>
                  Cloud Storage
                </button>
              </div>
            </div>

            {/* GCS Upload Mode */}
            {uploadMode === 'gcs' && (
              <div className="mb-6">
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-4 mb-4">
                  <div className="flex items-start gap-3">
                    <svg className="w-5 h-5 text-blue-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <h4 className="text-blue-400 font-medium">Google Cloud Storage</h4>
                      <p className="text-gray-400 text-sm mt-1">
                        Import datasets directly from your GCS buckets. You'll need a service account JSON key with storage.objects.list and storage.objects.get permissions.
                      </p>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowGCSBrowser(true)}
                  className="w-full py-4 bg-dark border-2 border-dashed border-gray-600 rounded-lg hover:border-primary hover:bg-dark-lighter transition-colors flex flex-col items-center justify-center gap-2"
                >
                  <svg className="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
                  </svg>
                  <span className="text-gray-300">Browse Cloud Storage</span>
                  <span className="text-gray-500 text-sm">Connect to GCS and select scenes to import</span>
                </button>
              </div>
            )}

            {/* Local Upload Mode */}
            {uploadMode === 'local' && (
              <div className="mb-6">
                {/* Upload Type Toggle */}
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Upload Type
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setUploadType('folder')}
                      className={`flex-1 px-3 py-2 rounded-lg border transition-colors flex items-center justify-center gap-2 text-sm ${
                        uploadType === 'folder'
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-dark border-gray-600 text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                      </svg>
                      Folder
                    </button>
                    <button
                      type="button"
                      onClick={() => setUploadType('zip')}
                      className={`flex-1 px-3 py-2 rounded-lg border transition-colors flex items-center justify-center gap-2 text-sm ${
                        uploadType === 'zip'
                          ? 'bg-purple-600/20 border-purple-500 text-white'
                          : 'bg-dark border-gray-600 text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                      ZIP File
                    </button>
                    <button
                      type="button"
                      onClick={() => setUploadType('video')}
                      className={`flex-1 px-3 py-2 rounded-lg border transition-colors flex items-center justify-center gap-2 text-sm ${
                        uploadType === 'video'
                          ? 'bg-green-600/20 border-green-500 text-white'
                          : 'bg-dark border-gray-600 text-gray-400 hover:border-gray-500'
                      }`}
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Video
                    </button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    {uploadType === 'folder'
                      ? 'Select a folder directly (recommended for <50 files & <100 MB)'
                      : uploadType === 'zip'
                      ? 'Upload a ZIP file (recommended for 50+ files, 500+ MB, or 4K images)'
                      : 'Upload a video file (MP4, AVI, MOV) - frames will be extracted automatically'}
                  </p>
                </div>

                {/* Folder Upload */}
                {uploadType === 'folder' && (
                  <>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Select Folder *
                    </label>
                    <div
                      className="border-2 border-dashed border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-primary hover:bg-primary/5 transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        // @ts-expect-error webkitdirectory is non-standard but widely supported
                        webkitdirectory=""
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                      <svg className="w-12 h-12 mx-auto text-gray-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                      </svg>
                      {selectedFiles && selectedFiles.length > 0 ? (
                        <div>
                          <p className="text-white font-medium">{selectedFiles.length} files selected</p>
                          <p className="text-gray-400 text-sm mt-1">
                            {totalSizeMB.toFixed(0)} MB total • Click to change
                          </p>
                        </div>
                      ) : (
                        <div>
                          <p className="text-gray-300">Click to select a folder</p>
                          <p className="text-gray-500 text-sm mt-1">Select the dataset folder from your computer</p>
                        </div>
                      )}
                    </div>

                    {/* File count limit warning */}
                    {showFileLimitWarning && (
                      <div className="mt-3 bg-red-500/20 border border-red-500/50 rounded-lg p-3 flex items-start gap-3">
                        <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div>
                          <p className="text-red-400 font-medium text-sm">Too many files for folder upload ({selectedFiles?.length} files)</p>
                          <p className="text-red-300/80 text-xs mt-1">
                            Browser folder upload is unreliable with 100+ files. Use <button onClick={() => setUploadType('zip')} className="underline hover:text-red-200 font-medium">ZIP upload</button> instead.
                          </p>
                        </div>
                      </div>
                    )}

                    {showFileLimitSoftWarning && (
                      <div className="mt-3 bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-3 flex items-start gap-3">
                        <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <p className="text-yellow-400 font-medium text-sm">Large dataset detected ({selectedFiles?.length} files)</p>
                          <p className="text-yellow-300/80 text-xs mt-1">
                            For {selectedFiles?.length}+ files, <button onClick={() => setUploadType('zip')} className="underline hover:text-yellow-200 font-medium">ZIP upload</button> is more reliable.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Size-based warnings for 4K images */}
                    {showSizeLimit && (
                      <div className="mt-3 bg-red-500/20 border border-red-500/50 rounded-lg p-3 flex items-start gap-3">
                        <svg className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div>
                          <p className="text-red-400 font-medium text-sm">Dataset too large for folder upload ({totalSizeMB.toFixed(0)} MB)</p>
                          <p className="text-red-300/80 text-xs mt-1">
                            Datasets over 2 GB require <button onClick={() => setUploadType('zip')} className="underline hover:text-red-200 font-medium">ZIP upload</button>. This is common with 4K images.
                          </p>
                        </div>
                      </div>
                    )}

                    {showSizeWarning && !showSizeLimit && (
                      <div className="mt-3 bg-yellow-500/20 border border-yellow-500/50 rounded-lg p-3 flex items-start gap-3">
                        <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <div>
                          <p className="text-yellow-400 font-medium text-sm">Large dataset detected ({totalSizeMB.toFixed(0)} MB)</p>
                          <p className="text-yellow-300/80 text-xs mt-1">
                            For datasets over 500 MB (e.g., 4K images), <button onClick={() => setUploadType('zip')} className="underline hover:text-yellow-200 font-medium">ZIP upload</button> is more reliable.
                          </p>
                        </div>
                      </div>
                    )}

                    {selectedFiles && selectedFiles.length > 0 && !showFileLimitWarning && !showFileLimitSoftWarning && !showSizeLimit && !showSizeWarning && (
                      <div className="mt-3 p-3 bg-dark rounded-lg max-h-32 overflow-auto">
                        <p className="text-xs text-gray-500 mb-2">Selected files ({totalSizeMB.toFixed(0)} MB total):</p>
                        {Array.from(selectedFiles).slice(0, 10).map((file, i) => (
                          <div key={i} className="text-xs text-gray-400 truncate">
                            {(file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name}
                          </div>
                        ))}
                        {selectedFiles.length > 10 && (
                          <div className="text-xs text-gray-500 mt-1">...and {selectedFiles.length - 10} more</div>
                        )}
                      </div>
                    )}
                  </>
                )}

                {/* ZIP Upload */}
                {uploadType === 'zip' && (
                  <>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Select ZIP File *
                    </label>
                    <div
                      className="border-2 border-dashed border-purple-600 rounded-lg p-8 text-center cursor-pointer hover:border-purple-400 hover:bg-purple-500/5 transition-colors"
                      onClick={() => zipInputRef.current?.click()}
                    >
                      <input
                        ref={zipInputRef}
                        type="file"
                        accept=".zip"
                        onChange={handleZipSelect}
                        className="hidden"
                      />
                      <svg className="w-12 h-12 mx-auto text-purple-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                      </svg>
                      {selectedZipFile ? (
                        <div>
                          <p className="text-white font-medium">{selectedZipFile.name}</p>
                          <p className="text-gray-400 text-sm mt-1">
                            {(selectedZipFile.size / (1024 * 1024)).toFixed(1)} MB - Click to change
                          </p>
                          {selectedZipFile.size > 1024 * 1024 * 1024 && (
                            <p className="text-yellow-400 text-xs mt-2 flex items-center justify-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Large file - upload may take several minutes
                            </p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <p className="text-gray-300">Click to select a ZIP file</p>
                          <p className="text-gray-500 text-sm mt-1">ZIP your dataset folder and upload it here</p>
                        </div>
                      )}
                    </div>
                    <div className="mt-2 p-2 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                      <p className="text-xs text-purple-300">
                        💡 <strong>Tip:</strong> Create a ZIP file of your dataset folder using: <code className="bg-dark px-1 rounded">zip -r dataset.zip your_folder/</code>
                      </p>
                    </div>
                  </>
                )}

                {/* Video Upload */}
                {uploadType === 'video' && (
                  <>
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                      Select Video File *
                    </label>
                    <div
                      className="border-2 border-dashed border-green-600 rounded-lg p-8 text-center cursor-pointer hover:border-green-400 hover:bg-green-500/5 transition-colors"
                      onClick={() => videoInputRef.current?.click()}
                    >
                      <input
                        ref={videoInputRef}
                        type="file"
                        accept=".mp4,.avi,.mov,.mkv,.webm,.m4v,video/*"
                        onChange={handleVideoSelect}
                        className="hidden"
                      />
                      <svg className="w-12 h-12 mx-auto text-green-400 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      {selectedVideoFile ? (
                        <div>
                          <p className="text-white font-medium">{selectedVideoFile.name}</p>
                          <p className="text-gray-400 text-sm mt-1">
                            {(selectedVideoFile.size / (1024 * 1024)).toFixed(1)} MB - Click to change
                          </p>
                          {selectedVideoFile.size > 1024 * 1024 * 500 && (
                            <p className="text-yellow-400 text-xs mt-2 flex items-center justify-center gap-1">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                              </svg>
                              Large video - processing may take several minutes
                            </p>
                          )}
                        </div>
                      ) : (
                        <div>
                          <p className="text-gray-300">Click to select a video file</p>
                          <p className="text-gray-500 text-sm mt-1">Supported formats: MP4, AVI, MOV, MKV, WebM</p>
                        </div>
                      )}
                    </div>

                    {/* Video Extraction Options */}
                    <div className="mt-4 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
                      <div className="flex items-center gap-2 mb-3">
                        <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        <span className="text-green-300 font-medium text-sm">Frame Extraction Options</span>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Extract at FPS (optional)</label>
                          <input
                            type="number"
                            value={videoExtractionFps}
                            onChange={(e) => setVideoExtractionFps(e.target.value)}
                            placeholder="Auto-detect"
                            min="0.1"
                            max="60"
                            step="0.1"
                            className="w-full px-3 py-1.5 bg-dark border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-green-400"
                          />
                          <p className="text-xs text-gray-500 mt-1">Leave empty for video's native FPS</p>
                        </div>
                        <div>
                          <label className="block text-xs text-gray-400 mb-1">Max frames (optional)</label>
                          <input
                            type="number"
                            value={videoMaxFrames}
                            onChange={(e) => setVideoMaxFrames(e.target.value)}
                            placeholder="No limit"
                            min="1"
                            max="10000"
                            className="w-full px-3 py-1.5 bg-dark border border-gray-600 rounded text-white text-sm focus:outline-none focus:border-green-400"
                          />
                          <p className="text-xs text-gray-500 mt-1">Leave empty to extract all frames</p>
                        </div>
                      </div>
                    </div>

                    <div className="mt-2 p-2 bg-green-500/10 border border-green-500/30 rounded-lg">
                      <p className="text-xs text-green-300">
                        🎬 <strong>Video Import:</strong> Frames will be extracted from your video and saved as images. A scene and task will be automatically created for annotation.
                      </p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Server Path Mode */}
            {uploadMode === 'server' && (
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Dataset Root Path *
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={rootPath}
                    onChange={(e) => setRootPath(e.target.value)}
                  className="flex-1 px-4 py-2 bg-dark border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary"
                  placeholder="/path/to/dataset"
                />
                <button
                  type="button"
                  onClick={() => setShowBrowser(true)}
                  className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-2"
                >
                  <span>📁</span> Browse
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Enter the absolute path or click Browse to select your dataset folder on the server
              </p>
            </div>
            )}

            {/* Scene Naming Options */}
            <div className="mb-4 p-4 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-lg">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-5 h-5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <span className="text-purple-300 font-semibold">Scene Naming</span>
              </div>

              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={preserveFolderNames}
                  onChange={(e) => setPreserveFolderNames(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-gray-600 bg-dark text-purple-500 focus:ring-purple-500 focus:ring-offset-0"
                />
                <div>
                  <span className="text-white font-medium">📁 Preserve original folder names</span>
                  <p className="text-xs text-gray-400 mt-1">
                    <span className="text-purple-300">Enabled:</span> Folders keep their exact names (e.g., "data" stays "data")<br/>
                    <span className="text-pink-300">Disabled:</span> Smart formatting applied (e.g., "data" → "Scene_01", "urban_night" → "Urban_Night")
                  </p>
                </div>
              </label>
            </div>

            {/* Taxonomy Options */}
            <div className="mb-4 p-4 bg-dark/50 border border-gray-700 rounded-lg">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deriveTaxonomy}
                  onChange={(e) => setDeriveTaxonomy(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-gray-600 bg-dark text-primary focus:ring-primary focus:ring-offset-0"
                />
                <div>
                  <span className="text-white font-medium">Sync taxonomy from annotations</span>
                  <p className="text-xs text-gray-400 mt-1">
                    Scan annotation files and add any new class labels to the taxonomy.
                    Imported class names will be mapped to existing taxonomy classes (case-insensitive).
                  </p>
                </div>
              </label>
            </div>

            {/* Annotation Import Mode */}
            <div className="mb-6 p-4 bg-dark/50 border border-gray-700 rounded-lg">
              <label className="block text-sm font-medium text-gray-300 mb-3">
                Annotation Import Mode
              </label>
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={!overwriteAnnotations}
                    onChange={() => setOverwriteAnnotations(false)}
                    className="mt-1 w-4 h-4 border-gray-600 bg-dark text-primary focus:ring-primary focus:ring-offset-0"
                  />
                  <div>
                    <span className="text-white font-medium">Augment</span>
                    <span className="text-green-400 text-xs ml-2">(Recommended)</span>
                    <p className="text-xs text-gray-400 mt-1">
                      Keep existing annotations and add new ones. Duplicate annotations may result if the same frame is imported twice.
                    </p>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="importMode"
                    checked={overwriteAnnotations}
                    onChange={() => setOverwriteAnnotations(true)}
                    className="mt-1 w-4 h-4 border-gray-600 bg-dark text-orange-500 focus:ring-orange-500 focus:ring-offset-0"
                  />
                  <div>
                    <span className="text-white font-medium">Replace</span>
                    <span className="text-orange-400 text-xs ml-2">⚠️</span>
                    <p className="text-xs text-gray-400 mt-1">
                      Delete all existing annotations before importing. Use this to fully replace annotations with updated versions.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              {uploadMode === 'local' ? (
                <button
                  onClick={handleUploadFiles}
                  disabled={(uploadType === 'folder' && (!selectedFiles || selectedFiles.length === 0)) ||
                           (uploadType === 'zip' && !selectedZipFile) ||
                           (uploadType === 'video' && !selectedVideoFile) ||
                           showFileLimitWarning ||
                           showSizeLimit}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {uploadType === 'zip' ? 'Upload ZIP & Import' : uploadType === 'video' ? 'Upload Video & Extract Frames' : 'Upload & Import'}
                </button>
              ) : (
                <button
                  onClick={handleValidate}
                  disabled={!rootPath}
                  className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50"
                >
                  Validate Structure
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 2: Validating */}
        {step === 'validating' && (
          <div className="text-center py-8">
            <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-400">Validating dataset structure...</p>
          </div>
        )}

        {/* Step 3: Validated */}
        {step === 'validated' && validationResult && (
          <div>
            {validationResult.valid ? (
              <div className="mb-6">
                <div className="p-4 bg-green-500/20 border border-green-500 rounded mb-4">
                  <div className="flex items-center text-green-400 font-semibold">
                    <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    Dataset structure is valid
                  </div>
                </div>

                <div className="bg-dark rounded-lg p-4 mb-4">
                  <h4 className="text-white font-medium mb-3">Dataset Overview</h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-gray-500">Scenes:</span>
                      <span className="ml-2 text-white">{validationResult.scenes.length}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Total Frames:</span>
                      <span className="ml-2 text-white">{validationResult.total_frames}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Has Calibration:</span>
                      <span className="ml-2 text-white">{validationResult.calibration_found ? 'Yes' : 'No'}</span>
                    </div>
                    <div>
                      <span className="text-gray-500">Sensors:</span>
                      <span className="ml-2 text-white">{validationResult.sensors_detected.length}</span>
                    </div>
                  </div>
                  <div className="mt-3">
                    <span className="text-gray-500 text-sm">Detected Sensors:</span>
                    <div className="flex flex-wrap gap-2 mt-1">
                      {validationResult.sensors_detected.map((sensor) => (
                        <span key={sensor} className="px-2 py-1 text-xs bg-blue-500/20 text-blue-400 rounded">
                          {sensor}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="mt-3">
                    <span className="text-gray-500 text-sm">Scenes:</span>
                    <div className="mt-2 space-y-2">
                      {validationResult.scenes.map((scene) => (
                        <div key={scene.name} className="p-2 bg-dark-panel rounded text-sm flex justify-between items-center">
                          <span className="text-white">{scene.name}</span>
                          <span className="text-gray-400">{scene.frame_count} frames</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {validationResult.warnings.length > 0 && (
                  <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded mb-4">
                    <div className="text-yellow-400 text-sm font-medium mb-2">Warnings:</div>
                    <ul className="list-disc list-inside text-yellow-300 text-sm">
                      {validationResult.warnings.map((w, i) => (
                        <li key={i}>{w}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="mb-6">
                <div className="p-4 bg-red-500/20 border border-red-500 rounded mb-4">
                  <div className="text-red-400 font-semibold mb-2">Validation Failed</div>
                  <ul className="list-disc list-inside text-red-300 text-sm">
                    {validationResult.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setStep('input')}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Back
              </button>
              {validationResult.valid && (
                <button
                  onClick={handleImport}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Import Dataset
                </button>
              )}
            </div>
          </div>
        )}

        {/* Step 4: Importing */}
        {/* Step: Checking scene names */}
        {step === 'checking' && (
          <div className="text-center py-10">
            <div className="animate-spin w-10 h-10 border-4 border-cyan-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-400 text-sm">Checking scene names for conflicts…</p>
          </div>
        )}

        {/* Step: Conflict — name already exists */}
        {step === 'conflict' && (
          <div>
            <div className="flex items-start gap-3 mb-5 p-3 bg-amber-500/10 border border-amber-500/40 rounded-lg">
              <span className="text-amber-400 text-lg mt-0.5">⚠</span>
              <div>
                <p className="text-amber-300 font-medium text-sm">Duplicate scene name detected</p>
                <p className="text-gray-400 text-xs mt-0.5">
                  A scene with this name already exists. Edit the suggested name below, then click Upload.
                </p>
              </div>
            </div>

            {conflicts.map(c => (
              <div key={c.original_name} className="mb-5">
                <p className="text-xs text-gray-500 mb-1">Existing scene name</p>
                <p className="text-sm text-gray-300 font-mono bg-gray-800 rounded px-3 py-1.5 mb-3">{c.original_name}</p>

                <label className="block text-xs text-gray-400 mb-1">New scene name (editable)</label>
                <input
                  type="text"
                  value={conflictNames[c.original_name] ?? c.suggested_name}
                  onChange={e => {
                    setConflictNames(prev => ({ ...prev, [c.original_name]: e.target.value }));
                    setConflictError(null);
                  }}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-white font-mono focus:outline-none focus:border-cyan-500 mb-3"
                />

                <label className="block text-xs text-gray-400 mb-1">Comment (optional)</label>
                <textarea
                  rows={2}
                  placeholder="Add a note about this re-upload…"
                  value={conflictComment[c.original_name] ?? ''}
                  onChange={e => setConflictComment(prev => ({ ...prev, [c.original_name]: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-600 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-cyan-500 resize-none"
                />
              </div>
            ))}

            {conflictError && (
              <p className="text-red-400 text-sm mb-4">{conflictError}</p>
            )}

            <div className="flex justify-end gap-3 mt-2">
              <button
                onClick={() => setStep('input')}
                className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  // Change 3: block if user enters same name as original
                  for (const c of conflicts) {
                    const entered = (conflictNames[c.original_name] ?? c.suggested_name).trim();
                    if (!entered) {
                      setConflictError('Scene name cannot be empty.');
                      return;
                    }
                    if (entered === c.original_name) {
                      setConflictError(`"${entered}" already exists in this dataset. Please enter a different name.`);
                      return;
                    }
                  }
                  // Build overrides and descriptions maps keyed by original_name
                  const overrides: Record<string, string> = {};
                  const descriptions: Record<string, string> = {};
                  for (const c of conflicts) {
                    overrides[c.original_name] = (conflictNames[c.original_name] ?? c.suggested_name).trim();
                    const comment = conflictComment[c.original_name]?.trim();
                    if (comment) descriptions[c.original_name] = comment;
                  }
                  if (pendingUploadRef.current) {
                    pendingUploadRef.current(overrides, descriptions);
                    pendingUploadRef.current = null;
                  }
                }}
                className="px-4 py-2 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded transition-colors"
              >
                Upload with this name
              </button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div className="text-center py-8">
            <div className="animate-spin w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-gray-400 mb-4">
              {uploadType === 'zip' && uploadProgress > 0 && uploadProgress < 100
                ? 'Uploading ZIP file...'
                : 'Importing sensor data...'}
            </p>

            {/* Upload Progress Bar (for ZIP uploads) */}
            {uploadType === 'zip' && uploadProgress > 0 && (
              <div className="max-w-md mx-auto">
                <div className="flex justify-between text-xs text-gray-400 mb-2">
                  <span>{uploadProgress.toFixed(1)}% complete</span>
                  {uploadSpeed && <span className="text-green-400">{uploadSpeed}</span>}
                </div>
                <div className="w-full bg-dark border border-gray-600 rounded-full h-3 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-green-500 to-emerald-500 transition-all duration-300 rounded-full"
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
                {uploadProgress >= 100 && (
                  <p className="text-xs text-gray-500 mt-2">Processing on server...</p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Step 5: Complete */}
        {step === 'complete' && importResult && (
          <div>
            {importResult.scenes_imported > 0 ? (
              <div className="p-4 bg-green-500/20 border border-green-500 rounded mb-6">
                <div className="flex items-center text-green-400 font-semibold mb-2">
                  <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Import Successful!
                </div>
                <div className="text-sm text-gray-300">
                  <p>Imported {importResult.scenes_imported} scenes with {importResult.frames_imported} total frames.</p>
                </div>
              </div>
            ) : (
              <div className="p-4 bg-red-500/20 border border-red-500 rounded mb-6">
                <div className="flex items-center text-red-400 font-semibold mb-2">
                  <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Import Failed
                </div>
                <div className="text-sm text-gray-300">
                  <p>No scenes were imported.</p>
                </div>
              </div>
            )}

            {/* Show any errors/warnings from the import */}
            {importResult.errors && importResult.errors.length > 0 && (
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/50 rounded mb-6">
                <div className="flex items-center text-yellow-400 font-semibold mb-2">
                  <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  {importResult.scenes_imported > 0 ? 'Warnings' : 'Errors'}
                </div>
                <ul className="text-sm text-gray-300 list-disc list-inside space-y-1">
                  {importResult.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Folder Browser Modal */}
      {showBrowser && (
        <FolderBrowser
          currentPath={rootPath}
          onSelectPath={(path) => setRootPath(path)}
          onClose={() => setShowBrowser(false)}
        />
      )}

      {/* GCS Browser Modal */}
      {showGCSBrowser && (
        <GCSBrowser
          datasetId={datasetId}
          onImportComplete={(result) => {
            setShowGCSBrowser(false);
            if (result.success) {
              setStep('complete');
              setImportResult({
                success: true,
                message: result.message,
                scenes_imported: 1,
                frames_imported: 0,
                errors: [],
                renamed_scenes: [],
              });
              onSuccess();
            } else {
              setError(result.message);
            }
          }}
          onClose={() => setShowGCSBrowser(false)}
        />
      )}
    </div>
  );
};

// =============================================================================
// IMPORT DATASET ANNOTATIONS MODAL
// =============================================================================

interface ImportDatasetAnnotationsModalProps {
  isOpen: boolean;
  datasetId: string;
  datasetName: string;
  onClose: () => void;
  onSuccess: () => void;
}

const ImportDatasetAnnotationsModal: React.FC<ImportDatasetAnnotationsModalProps> = ({
  isOpen,
  datasetId,
  datasetName,
  onClose,
  onSuccess,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [deriveTaxonomy, setDeriveTaxonomy] = useState(true);
  const [overwrite, setOverwrite] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    message: string;
    imported_count: number;
    scenes_processed: number;
    derived_classes: string[];
    errors: string[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.endsWith('.zip')) {
        setFile(droppedFile);
        setError(null);
      } else {
        setError('Please upload a ZIP file');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.name.endsWith('.zip')) {
        setFile(selectedFile);
        setError(null);
      } else {
        setError('Please upload a ZIP file');
      }
    }
  };

  const handleSubmit = async () => {
    if (!file) {
      setError('Please select a ZIP file');
      return;
    }

    setIsImporting(true);
    setError(null);

    try {
      const response = await datasetApi.importAnnotations(datasetId, file, deriveTaxonomy, overwrite);
      setResult(response);
      queryClient.invalidateQueries({ queryKey: ['dataset-detail', datasetId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['scenes'] });
      onSuccess();
    } catch (err: unknown) {
      const e = err as Error & { response?: { data?: { detail?: string } } };
      setError(e.response?.data?.detail || e.message || 'Import failed');
    } finally {
      setIsImporting(false);
    }
  };

  const handleClose = () => {
    setFile(null);
    setResult(null);
    setError(null);
    setDeriveTaxonomy(true);
    setOverwrite(false);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80" onClick={handleClose} />

      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-xl mx-4 shadow-xl border border-gray-700 max-h-[85vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-white mb-2">Import Annotations</h2>
        <p className="text-sm text-gray-400 mb-4">
          Import pre-existing annotations for <span className="text-white">{datasetName}</span>
        </p>

        {/* Result View */}
        {result ? (
          <div className="space-y-4">
            <div className={`p-4 rounded-lg ${result.success ? 'bg-green-500/20 border border-green-500' : 'bg-red-500/20 border border-red-500'}`}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xl">{result.success ? '✅' : '❌'}</span>
                <span className={`font-medium ${result.success ? 'text-green-300' : 'text-red-300'}`}>
                  {result.message}
                </span>
              </div>
              <div className="text-sm space-y-1">
                <p className="text-gray-300">
                  <span className="text-gray-500">Annotations imported:</span> {result.imported_count}
                </p>
                <p className="text-gray-300">
                  <span className="text-gray-500">Scenes processed:</span> {result.scenes_processed}
                </p>
              </div>
            </div>

            {/* Derived Classes */}
            {result.derived_classes && result.derived_classes.length > 0 && (
              <div className="bg-purple-500/10 border border-purple-500/30 rounded-lg p-4">
                <h4 className="text-sm font-medium text-purple-300 mb-2 flex items-center gap-2">
                  <span>🏷️</span> Derived Taxonomy Classes
                </h4>
                <div className="flex flex-wrap gap-2">
                  {result.derived_classes.map((cls, i) => (
                    <span key={i} className="px-2 py-1 bg-purple-500/20 rounded text-sm text-purple-200">
                      {cls}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-purple-400 mt-2">
                  A new taxonomy has been created and linked to this dataset
                </p>
              </div>
            )}

            {/* Errors */}
            {result.errors && result.errors.length > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
                <h4 className="text-sm font-medium text-yellow-300 mb-2">Warnings</h4>
                <ul className="text-xs text-yellow-200 space-y-1">
                  {result.errors.slice(0, 5).map((err, i) => (
                    <li key={i}>• {err}</li>
                  ))}
                  {result.errors.length > 5 && (
                    <li className="text-yellow-400">...and {result.errors.length - 5} more</li>
                  )}
                </ul>
              </div>
            )}

            <div className="flex justify-end">
              <button
                onClick={handleClose}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {error && (
              <div className="p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
                {error}
              </div>
            )}

            {/* Expected Structure Helper */}
            <details className="group">
              <summary className="cursor-pointer text-sm text-cyan-400 hover:text-cyan-300 flex items-center gap-2">
                <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
                📦 Expected ZIP Structure
              </summary>
              <div className="mt-2 p-3 bg-dark/50 border border-gray-700 rounded-lg text-xs font-mono text-gray-300">
                <pre className="whitespace-pre">{`annotations.zip/
├── scene_001/                    # Per-scene folders (optional)
│   ├── lidar.json                # 3D annotations (COCO format)
│   ├── camera_front.json         # 2D annotations per camera
│   └── camera_rear.json
├── scene_002/
│   └── ...
└── (or flat structure)
    ├── lidar.json
    └── camera_front.json`}</pre>
              </div>
            </details>

            {/* File Drop Zone */}
            <div
              onDragEnter={handleDrag}
              onDragLeave={handleDrag}
              onDragOver={handleDrag}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                dragActive
                  ? 'border-cyan-500 bg-cyan-500/10'
                  : file
                    ? 'border-green-500 bg-green-500/10'
                    : 'border-gray-600 hover:border-gray-500'
              }`}
              onClick={() => document.getElementById('annotation-file-input')?.click()}
            >
              <input
                id="annotation-file-input"
                type="file"
                accept=".zip"
                onChange={handleFileChange}
                className="hidden"
              />
              {file ? (
                <div className="text-green-300">
                  <span className="text-2xl mb-2 block">📦</span>
                  <p className="font-medium">{file.name}</p>
                  <p className="text-sm text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
                  <p className="text-xs text-gray-500 mt-2">Click to change file</p>
                </div>
              ) : (
                <div className="text-gray-400">
                  <span className="text-3xl mb-2 block">📤</span>
                  <p>Drag & drop a ZIP file here, or click to browse</p>
                  <p className="text-xs text-gray-500 mt-1">Only .zip files are accepted</p>
                </div>
              )}
            </div>

            {/* Options */}
            <div className="space-y-3 p-4 bg-gray-800/50 rounded-lg">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={deriveTaxonomy}
                  onChange={(e) => setDeriveTaxonomy(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-cyan-500 focus:ring-cyan-500"
                />
                <div>
                  <span className="text-white text-sm">Auto-derive taxonomy from annotations</span>
                  <p className="text-xs text-gray-500">Creates a new taxonomy based on class names found</p>
                </div>
              </label>

              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-600 bg-gray-700 text-cyan-500 focus:ring-cyan-500"
                />
                <div>
                  <span className="text-white text-sm">Overwrite existing annotations</span>
                  <p className="text-xs text-gray-500">Replace any existing annotations for matched scenes</p>
                </div>
              </label>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!file || isImporting}
                className="px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                {isImporting ? (
                  <>
                    <span className="animate-spin">⏳</span> Importing...
                  </>
                ) : (
                  <>
                    <span>📥</span> Import Annotations
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// LINK TAXONOMY MODAL
// =============================================================================

interface LinkTaxonomyModalProps {
  isOpen: boolean;
  datasetId: string;
  linkedTaxonomyIds: string[];
  onClose: () => void;
  onSuccess: () => void;
}

const LinkTaxonomyModal: React.FC<LinkTaxonomyModalProps> = ({
  isOpen,
  datasetId,
  linkedTaxonomyIds,
  onClose,
  onSuccess,
}) => {
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const queryClient = useQueryClient();
  const currentOrgId = useCurrentOrganizationId();

  const { data: allTaxonomies, isLoading } = useQuery({
    queryKey: ['taxonomies', currentOrgId],
    queryFn: () => taxonomyApi.list(1, 20, undefined, undefined, currentOrgId || undefined),
    enabled: isOpen,
  });

  const linkMutation = useMutation({
    mutationFn: (taxonomyId: string) => datasetApi.linkTaxonomy(datasetId, taxonomyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dataset-detail', datasetId] });
      queryClient.invalidateQueries({ queryKey: ['dataset-taxonomies', datasetId] });
      queryClient.invalidateQueries({ queryKey: ['dataset-primary-taxonomy', datasetId] });
      setSelectedTaxonomyId('');
      setError(null);
      onSuccess();
      onClose();
    },
    onError: (err: Error & { response?: { data?: { detail?: string } } }) => {
      setError(err.response?.data?.detail || err.message || 'Failed to link taxonomy');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTaxonomyId) {
      setError('Please select a taxonomy');
      return;
    }
    linkMutation.mutate(selectedTaxonomyId);
  };

  const availableTaxonomies = allTaxonomies?.items?.filter(
    (t: Taxonomy) => !linkedTaxonomyIds.includes(t.id)
  ) || [];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-700">
        <h2 className="text-xl font-semibold text-white mb-4">Link Taxonomy to Dataset</h2>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="mb-6">
            <label htmlFor="taxonomy" className="block text-sm font-medium text-gray-300 mb-2">
              Select Taxonomy *
            </label>
            {isLoading ? (
              <div className="text-gray-400">Loading taxonomies...</div>
            ) : availableTaxonomies.length === 0 ? (
              <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded text-yellow-300 text-sm">
                No available taxonomies to link. All taxonomies are already linked or you need to create a new one.
              </div>
            ) : (
              <select
                id="taxonomy"
                value={selectedTaxonomyId}
                onChange={(e) => setSelectedTaxonomyId(e.target.value)}
                className="w-full px-4 py-2 bg-dark border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary"
              >
                <option value="">-- Select a taxonomy --</option>
                {availableTaxonomies.map((taxonomy: Taxonomy) => (
                  <option key={taxonomy.id} value={taxonomy.id}>
                    {taxonomy.name} (v{taxonomy.version}) - {taxonomy.classes?.length || 0} classes
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={linkMutation.isPending || !selectedTaxonomyId || availableTaxonomies.length === 0}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {linkMutation.isPending ? 'Linking...' : 'Link Taxonomy'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// TAXONOMY CARD
// =============================================================================

interface TaxonomyCardProps {
  taxonomy: Taxonomy;
  datasetId: string;
  onUnlink: () => void;
}

const TaxonomyCard: React.FC<TaxonomyCardProps> = ({ taxonomy, datasetId, onUnlink }) => {
  const queryClient = useQueryClient();
  const [showConfirm, setShowConfirm] = useState(false);

  const unlinkMutation = useMutation({
    mutationFn: () => datasetApi.unlinkTaxonomy(datasetId, taxonomy.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dataset-detail', datasetId] });
      queryClient.invalidateQueries({ queryKey: ['dataset-taxonomies', datasetId] });
      queryClient.invalidateQueries({ queryKey: ['dataset-primary-taxonomy', datasetId] });
      onUnlink();
    },
  });

  return (
    <div className="bg-dark-panel rounded-lg p-6 border border-gray-700">
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-lg font-semibold text-white">{taxonomy.name}</h3>
          <span className="text-sm text-gray-500">v{taxonomy.version}</span>
        </div>
        <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded">
          Linked
        </span>
      </div>

      <p className="text-gray-400 text-sm mb-4 line-clamp-2">
        {taxonomy.description || 'No description'}
      </p>

      {/* Classes preview */}
      <div className="mb-4">
        <div className="text-sm text-gray-500 mb-2">Classes ({taxonomy.classes?.length || 0})</div>
        <div className="flex flex-wrap gap-2">
          {taxonomy.classes?.slice(0, 5).map((cls) => (
            <span
              key={cls.id}
              className="px-2 py-1 text-xs rounded"
              style={{ backgroundColor: `${cls.color}20`, color: cls.color }}
            >
              {cls.name}
            </span>
          ))}
          {(taxonomy.classes?.length || 0) > 5 && (
            <span className="px-2 py-1 text-xs text-gray-500">
              +{taxonomy.classes!.length - 5} more
            </span>
          )}
        </div>
      </div>

      {/* Actions */}
      {showConfirm ? (
        <div className="flex items-center gap-2">
          <span className="text-sm text-yellow-400">Unlink this taxonomy?</span>
          <button
            onClick={() => unlinkMutation.mutate()}
            disabled={unlinkMutation.isPending}
            className="px-3 py-1 bg-red-500 text-white text-sm rounded hover:bg-red-600 disabled:opacity-50"
          >
            {unlinkMutation.isPending ? 'Removing...' : 'Yes, Unlink'}
          </button>
          <button
            onClick={() => setShowConfirm(false)}
            className="px-3 py-1 text-gray-400 text-sm hover:text-white"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowConfirm(true)}
          className="text-sm text-red-400 hover:text-red-300 transition-colors"
        >
          Unlink Taxonomy
        </button>
      )}
    </div>
  );
};

// =============================================================================
// TAXONOMY TAB COMPONENT
// =============================================================================

interface TaxonomyTabProps {
  dataset: { id: string; name: string; taxonomy?: { classes?: Array<{ id: string; name: string; color: string }> } };
  datasetId: string;
  linkedTaxonomies: Taxonomy[] | undefined;
  loadingTaxonomies: boolean;
  onLinkClick: () => void;
}

const TaxonomyTab: React.FC<TaxonomyTabProps> = ({
  dataset,
  datasetId,
  linkedTaxonomies,
  loadingTaxonomies,
  onLinkClick
}) => {
  const queryClient = useQueryClient();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showVariantsConfirm, setShowVariantsConfirm] = useState(false);

  const clearDefaultTaxonomyMutation = useMutation({
    mutationFn: () => datasetApi.clearDefaultTaxonomy(datasetId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dataset', datasetId] });
      setShowClearConfirm(false);
    },
  });

  const createVariantsMutation = useMutation({
    mutationFn: () => datasetApi.createVariantsFromTaxonomies(datasetId),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      setShowVariantsConfirm(false);
      // Navigate to campaign page to see new datasets
      if (data.created_datasets.length > 0) {
        alert(`Created ${data.created_datasets.length} dataset variant(s):\n${data.created_datasets.map(d => d.name).join('\n')}`);
      }
    },
  });

  const hasDefaultTaxonomy = dataset.taxonomy?.classes && dataset.taxonomy.classes.length > 0;
  const hasLinkedTaxonomies = linkedTaxonomies && linkedTaxonomies.length > 0;

  // Calculate total classes from both embedded and linked taxonomies
  const embeddedClassCount = dataset.taxonomy?.classes?.length || 0;
  const linkedClassCount = linkedTaxonomies?.reduce((sum, t) => sum + (t.classes?.length || 0), 0) || 0;
  const totalClassCount = embeddedClassCount > 0 ? embeddedClassCount : linkedClassCount;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-white">Annotation Classes</h2>
          <p className="text-sm text-gray-400 mt-1">
            {totalClassCount} class{totalClassCount !== 1 ? 'es' : ''} available
            {hasLinkedTaxonomies && ` • ${linkedTaxonomies.length} taxonomy linked`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasLinkedTaxonomies && (
            <button
              onClick={() => setShowVariantsConfirm(true)}
              className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors text-sm"
              title="Create separate datasets for each linked taxonomy"
            >
              Create Variants
            </button>
          )}
          <button
            onClick={onLinkClick}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm"
          >
            + Link Taxonomy
          </button>
        </div>
      </div>

      {/* Show linked taxonomy classes if no embedded classes */}
      {!hasDefaultTaxonomy && hasLinkedTaxonomies && (
        <div className="bg-gradient-to-r from-primary/10 to-transparent rounded-xl p-6 border border-primary/30 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-primary uppercase tracking-wider">
              Classes from {linkedTaxonomies[0].name} ({linkedTaxonomies[0].classes?.length || 0} classes)
            </h3>
            <span className="px-2 py-1 bg-primary/20 text-primary text-xs rounded">From Linked Taxonomy</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {linkedTaxonomies[0].classes?.map((cls) => (
              <div
                key={cls.id}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:scale-105"
                style={{
                  backgroundColor: `${cls.color}15`,
                  color: cls.color,
                  border: `1px solid ${cls.color}40`
                }}
              >
                <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: cls.color }}></span>
                {cls.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Default/Embedded Taxonomy Section */}
      {hasDefaultTaxonomy && (
        <div className="bg-gray-800/40 rounded-xl p-6 border border-gray-700/50 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">
              Default Taxonomy ({dataset.taxonomy?.classes?.length || 0} classes)
            </h3>
            {showClearConfirm ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-yellow-400">Clear default taxonomy?</span>
                <button
                  onClick={() => clearDefaultTaxonomyMutation.mutate()}
                  disabled={clearDefaultTaxonomyMutation.isPending}
                  className="px-3 py-1 bg-red-500 text-white text-xs rounded hover:bg-red-600 disabled:opacity-50"
                >
                  {clearDefaultTaxonomyMutation.isPending ? 'Clearing...' : 'Yes, Clear'}
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-3 py-1 text-gray-400 text-xs hover:text-white"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="text-sm text-orange-400 hover:text-orange-300 transition-colors"
              >
                Clear Default
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {dataset.taxonomy?.classes?.map((cls) => (
              <div
                key={cls.id}
                className="px-3 py-1.5 rounded-lg text-sm font-medium transition-all hover:scale-105"
                style={{
                  backgroundColor: `${cls.color}15`,
                  color: cls.color,
                  border: `1px solid ${cls.color}40`
                }}
              >
                <span className="inline-block w-2 h-2 rounded-full mr-2" style={{ backgroundColor: cls.color }}></span>
                {cls.name}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Linked Taxonomies Section */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Linked Taxonomies</h3>
        {hasLinkedTaxonomies && (
          <span className="text-xs text-gray-500">
            {linkedTaxonomies.length} taxonomy/ies linked
          </span>
        )}
      </div>

      {loadingTaxonomies ? (
        <div className="text-gray-400">Loading...</div>
      ) : hasLinkedTaxonomies ? (
        <div className="grid grid-cols-2 gap-4 mb-6">
          {linkedTaxonomies.map((taxonomy: Taxonomy) => (
            <TaxonomyCard key={taxonomy.id} taxonomy={taxonomy} datasetId={datasetId} onUnlink={() => {}} />
          ))}
        </div>
      ) : (
        <div className="text-center py-8 bg-gray-800/30 rounded-xl border border-dashed border-gray-700 mb-6">
          <p className="text-gray-500 text-sm">No taxonomies linked</p>
        </div>
      )}

      {/* Create Variants Confirmation Modal */}
      {showVariantsConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/70" onClick={() => setShowVariantsConfirm(false)} />
          <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-700">
            <h3 className="text-lg font-semibold text-white mb-4">Create Dataset Variants</h3>
            <p className="text-gray-400 text-sm mb-4">
              This will create <strong className="text-white">{linkedTaxonomies?.length || 0}</strong> new dataset(s),
              one for each linked taxonomy. Each variant will have the same name with the taxonomy name appended.
            </p>
            <div className="bg-gray-800 rounded p-3 mb-4 max-h-40 overflow-auto">
              {linkedTaxonomies?.map((tax) => (
                <div key={tax.id} className="text-sm text-gray-300 py-1">
                  → {dataset.name} ({tax.name})
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowVariantsConfirm(false)}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => createVariantsMutation.mutate()}
                disabled={createVariantsMutation.isPending}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
              >
                {createVariantsMutation.isPending ? 'Creating...' : 'Create Variants'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// DATAOPS TAB COMPONENT
// =============================================================================

interface DataOpsTabProps {
  datasetId: string;
  onImportAnnotations?: () => void;
}

const DataOpsTab: React.FC<DataOpsTabProps> = ({ datasetId, onImportAnnotations }) => {
  const [activeSection, setActiveSection] = useState<'overview' | 'history' | 'snapshots'>('overview');
  const [historyFilter, setHistoryFilter] = useState<string>('all');
  const [historyOffset, setHistoryOffset] = useState(0);
  const [snapshotsOffset, setSnapshotsOffset] = useState(0);

  // Fetch DataOps stats
  const { data: stats, isLoading: loadingStats } = useQuery({
    queryKey: ['dataops-stats', datasetId],
    queryFn: () => dataopsApi.getDatasetStats(datasetId),
    enabled: !!datasetId,
  });

  // Fetch annotation history
  const { data: history, isLoading: loadingHistory } = useQuery({
    queryKey: ['dataops-history', datasetId, historyFilter, historyOffset],
    queryFn: () => dataopsApi.getDatasetHistory(datasetId, {
      change_type: historyFilter === 'all' ? undefined : historyFilter,
      limit: 50,
      offset: historyOffset,
    }),
    enabled: !!datasetId && activeSection === 'history',
  });

  // Fetch snapshots
  const { data: snapshots, isLoading: loadingSnapshots } = useQuery({
    queryKey: ['dataops-snapshots', datasetId, snapshotsOffset],
    queryFn: () => dataopsApi.getDatasetSnapshots(datasetId, {
      limit: 20,
      offset: snapshotsOffset,
    }),
    enabled: !!datasetId && (activeSection === 'snapshots' || activeSection === 'overview'),
  });

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getChangeTypeColor = (type: string) => {
    switch (type) {
      case 'created': return 'text-green-400 bg-green-500/10';
      case 'updated': return 'text-blue-400 bg-blue-500/10';
      case 'deleted': return 'text-red-400 bg-red-500/10';
      default: return 'text-gray-400 bg-gray-500/10';
    }
  };

  const getStageIcon = (stage: string) => {
    switch (stage) {
      case 'annotation': return '✏️';
      case 'qa': return '🔍';
      case 'customer_qa': return '👤';
      case 'accepted': return '✅';
      default: return '📋';
    }
  };

  if (loadingStats) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header with Navigation */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">DataOps</h2>
          <p className="text-sm text-gray-400 mt-1">Label version history and stage snapshots</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Import Annotations Button */}
          {onImportAnnotations && (
            <button
              onClick={onImportAnnotations}
              className="px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 text-white text-sm font-medium rounded-lg hover:from-cyan-500 hover:to-blue-500 transition-all flex items-center gap-2 shadow-lg"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
              </svg>
              Import Annotations
            </button>
          )}
          <div className="flex items-center gap-2">
            {['overview', 'history', 'snapshots'].map((section) => (
              <button
                key={section}
                onClick={() => setActiveSection(section as typeof activeSection)}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                  activeSection === section
                    ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                    : 'text-gray-400 hover:text-white hover:bg-gray-700/50'
                }`}
              >
                {section.charAt(0).toUpperCase() + section.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Overview Section */}
      {activeSection === 'overview' && (
        <div className="grid grid-cols-3 gap-6">
          {/* Stats Cards */}
          <div className="bg-gray-800/40 rounded-xl p-6 border border-gray-700/50">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center">
                <span className="text-lg">📝</span>
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{stats?.total_changes || 0}</p>
                <p className="text-sm text-gray-400">Total Changes</p>
              </div>
            </div>
            <div className="flex gap-4 text-xs">
              <span className="text-green-400">+{stats?.changes_by_type?.created || 0} created</span>
              <span className="text-blue-400">↺{stats?.changes_by_type?.updated || 0} updated</span>
              <span className="text-red-400">-{stats?.changes_by_type?.deleted || 0} deleted</span>
            </div>
          </div>

          <div className="bg-gray-800/40 rounded-xl p-6 border border-gray-700/50">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-purple-500/20 flex items-center justify-center">
                <span className="text-lg">📸</span>
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{stats?.total_snapshots || 0}</p>
                <p className="text-sm text-gray-400">Stage Snapshots</p>
              </div>
            </div>
            <p className="text-xs text-gray-500">Captured at each stage transition</p>
          </div>

          <div className="bg-gray-800/40 rounded-xl p-6 border border-gray-700/50">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
                <span className="text-lg">📋</span>
              </div>
              <div>
                <p className="text-2xl font-bold text-white">{stats?.tasks_with_history || 0}/{stats?.total_tasks || 0}</p>
                <p className="text-sm text-gray-400">Tasks with History</p>
              </div>
            </div>
            <p className="text-xs text-gray-500">Tasks with recorded changes</p>
          </div>

          {/* Recent Snapshots */}
          <div className="col-span-3 bg-gray-800/40 rounded-xl p-6 border border-gray-700/50">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-medium text-gray-400 uppercase tracking-wider">Recent Stage Snapshots</h3>
              <button
                onClick={() => setActiveSection('snapshots')}
                className="text-xs text-cyan-400 hover:text-cyan-300"
              >
                View All →
              </button>
            </div>

            {loadingSnapshots ? (
              <div className="text-gray-500 text-sm">Loading snapshots...</div>
            ) : snapshots?.items && snapshots.items.length > 0 ? (
              <div className="space-y-3">
                {snapshots.items.slice(0, 5).map((snapshot) => (
                  <div
                    key={snapshot.id}
                    className="flex items-center justify-between p-3 bg-gray-900/50 rounded-lg border border-gray-700/50"
                  >
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2 text-sm">
                        <span>{getStageIcon(snapshot.from_stage)}</span>
                        <span className="text-gray-400">{snapshot.from_stage}</span>
                        <span className="text-gray-600">→</span>
                        <span>{getStageIcon(snapshot.to_stage)}</span>
                        <span className="text-white">{snapshot.to_stage}</span>
                      </div>
                      <div className="text-xs text-gray-500">
                        {snapshot.total_annotations} annotations
                      </div>
                    </div>
                    <div className="text-xs text-gray-500">
                      {formatDate(snapshot.created_at)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-gray-500 text-sm">
                No snapshots recorded yet. Snapshots are created when tasks transition between stages.
              </div>
            )}
          </div>
        </div>
      )}

      {/* History Section */}
      {activeSection === 'history' && (
        <div className="bg-gray-800/40 rounded-xl border border-gray-700/50">
          {/* Filter Bar */}
          <div className="p-4 border-b border-gray-700/50 flex items-center gap-4">
            <span className="text-sm text-gray-400">Filter:</span>
            {['all', 'created', 'updated', 'deleted'].map((filter) => (
              <button
                key={filter}
                onClick={() => { setHistoryFilter(filter); setHistoryOffset(0); }}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-colors ${
                  historyFilter === filter
                    ? getChangeTypeColor(filter) + ' border border-current'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {filter.charAt(0).toUpperCase() + filter.slice(1)}
              </button>
            ))}
            <span className="ml-auto text-sm text-gray-500">
              {history?.total || 0} total changes
            </span>
          </div>

          {/* History List */}
          <div className="divide-y divide-gray-700/50">
            {loadingHistory ? (
              <div className="p-8 text-center text-gray-500">Loading history...</div>
            ) : history?.items && history.items.length > 0 ? (
              <>
                {history.items.map((item) => (
                  <div key={item.id} className="p-4 hover:bg-gray-700/20 transition-colors">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <span className={`px-2 py-0.5 text-xs font-medium rounded ${getChangeTypeColor(item.change_type)}`}>
                          {item.change_type}
                        </span>
                        <div>
                          <div className="flex items-center gap-2 text-sm">
                            <span className="text-white font-medium">
                              {String(item.annotation_data?.class_name || 'Unknown class')}
                            </span>
                            <span className="text-gray-500">•</span>
                            <span className="text-gray-400">{String(item.annotation_data?.type || 'Unknown type')}</span>
                          </div>
                          <div className="flex items-center gap-2 mt-1 text-xs text-gray-500">
                            <span>v{item.version}</span>
                            <span>•</span>
                            <span>Stage: {item.task_stage}</span>
                            <span>•</span>
                            <span>Status: {item.task_status}</span>
                          </div>
                        </div>
                      </div>
                      <span className="text-xs text-gray-500">{formatDate(item.created_at)}</span>
                    </div>
                  </div>
                ))}

                {/* Pagination */}
                {history.total > 50 && (
                  <div className="p-4 flex items-center justify-center gap-4">
                    <button
                      onClick={() => setHistoryOffset(Math.max(0, historyOffset - 50))}
                      disabled={historyOffset === 0}
                      className="px-3 py-1 text-sm text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ← Previous
                    </button>
                    <span className="text-sm text-gray-500">
                      {historyOffset + 1} - {Math.min(historyOffset + 50, history.total)} of {history.total}
                    </span>
                    <button
                      onClick={() => setHistoryOffset(historyOffset + 50)}
                      disabled={historyOffset + 50 >= history.total}
                      className="px-3 py-1 text-sm text-gray-400 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="p-8 text-center text-gray-500">
                No annotation history recorded yet. History is recorded when annotations are created, modified, or deleted.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Snapshots Section */}
      {activeSection === 'snapshots' && (
        <div className="bg-gray-800/40 rounded-xl border border-gray-700/50">
          <div className="p-4 border-b border-gray-700/50">
            <h3 className="text-sm font-medium text-white">Stage Snapshots Timeline</h3>
            <p className="text-xs text-gray-500 mt-1">Full annotation state captured at each workflow stage transition</p>
          </div>

          <div className="p-4">
            {loadingSnapshots ? (
              <div className="text-center py-8 text-gray-500">Loading snapshots...</div>
            ) : snapshots?.items && snapshots.items.length > 0 ? (
              <div className="relative">
                {/* Timeline line */}
                <div className="absolute left-6 top-0 bottom-0 w-px bg-gray-700"></div>

                <div className="space-y-6">
                  {snapshots.items.map((snapshot) => (
                    <div key={snapshot.id} className="relative pl-14">
                      {/* Timeline dot */}
                      <div className={`absolute left-4 w-4 h-4 rounded-full border-2 ${
                        snapshot.to_stage === 'accepted'
                          ? 'bg-green-500 border-green-400'
                          : 'bg-gray-700 border-gray-500'
                      }`}></div>

                      <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50">
                        <div className="flex items-center justify-between mb-3">
                          <div className="flex items-center gap-3">
                            <span className="text-lg">{getStageIcon(snapshot.from_stage)}</span>
                            <span className="text-gray-400 text-sm">{snapshot.from_stage}</span>
                            <span className="text-gray-600">→</span>
                            <span className="text-lg">{getStageIcon(snapshot.to_stage)}</span>
                            <span className="text-white text-sm font-medium">{snapshot.to_stage}</span>
                          </div>
                          <span className="text-xs text-gray-500">{formatDate(snapshot.created_at)}</span>
                        </div>

                        <div className="grid grid-cols-4 gap-4 text-sm">
                          <div>
                            <span className="text-gray-500">Total Annotations</span>
                            <p className="text-white font-medium">{snapshot.total_annotations}</p>
                          </div>
                          <div>
                            <span className="text-gray-500">By Class</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {Object.entries(snapshot.annotations_by_class || {}).slice(0, 3).map(([cls, count]) => (
                                <span key={cls} className="px-2 py-0.5 bg-gray-700/50 rounded text-xs">
                                  {cls}: {count as number}
                                </span>
                              ))}
                              {Object.keys(snapshot.annotations_by_class || {}).length > 3 && (
                                <span className="text-gray-500 text-xs">+{Object.keys(snapshot.annotations_by_class).length - 3} more</span>
                              )}
                            </div>
                          </div>
                          <div>
                            <span className="text-gray-500">By Type</span>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {Object.entries(snapshot.annotations_by_type || {}).map(([type, count]) => (
                                <span key={type} className="px-2 py-0.5 bg-gray-700/50 rounded text-xs">
                                  {type}: {count as number}
                                </span>
                              ))}
                            </div>
                          </div>
                          <div>
                            <span className="text-gray-500">Notes</span>
                            <p className="text-gray-400 text-xs truncate">{snapshot.notes || '-'}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {snapshots.total > 20 && (
                  <div className="mt-6 flex items-center justify-center gap-4">
                    <button
                      onClick={() => setSnapshotsOffset(Math.max(0, snapshotsOffset - 20))}
                      disabled={snapshotsOffset === 0}
                      className="px-3 py-1 text-sm text-gray-400 hover:text-white disabled:opacity-50"
                    >
                      ← Previous
                    </button>
                    <span className="text-sm text-gray-500">
                      {snapshotsOffset + 1} - {Math.min(snapshotsOffset + 20, snapshots.total)} of {snapshots.total}
                    </span>
                    <button
                      onClick={() => setSnapshotsOffset(snapshotsOffset + 20)}
                      disabled={snapshotsOffset + 20 >= snapshots.total}
                      className="px-3 py-1 text-sm text-gray-400 hover:text-white disabled:opacity-50"
                    >
                      Next →
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-4xl mb-4">📸</div>
                <h3 className="text-white font-medium mb-2">No Snapshots Yet</h3>
                <p className="text-gray-500 text-sm max-w-md mx-auto">
                  Stage snapshots are automatically created when tasks transition between workflow stages
                  (e.g., from Annotation to QA, or QA to Customer QA).
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// SPLIT TASK MODAL
// =============================================================================

interface SplitTaskModalProps {
  task: any;
  onClose: () => void;
  onSplit: (subTasks: { name: string; frame_start: number; frame_end: number }[]) => Promise<void>;
}

const SplitTaskModal: React.FC<SplitTaskModalProps> = ({ task, onClose, onSplit }) => {
  const frameStart: number = task.frame_range?.start ?? 0;
  const frameEnd: number = task.frame_range?.end ?? 0;
  const totalFrames = frameEnd - frameStart + 1;

  const [numParts, setNumParts] = useState(2);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Compute equal sub-ranges
  const subTasks = useMemo(() => {
    const parts = Math.max(2, numParts);
    const framesPerPart = Math.floor(totalFrames / parts);
    return Array.from({ length: parts }, (_, i) => {
      const start = frameStart + i * framesPerPart;
      const end = i === parts - 1 ? frameEnd : start + framesPerPart - 1;
      return {
        name: `${task.name} (Part ${i + 1})`,
        frame_start: start,
        frame_end: end,
      };
    });
  }, [numParts, frameStart, frameEnd, totalFrames, task.name]);

  const handleSplit = async () => {
    setLoading(true);
    setError('');
    try {
      await onSplit(subTasks);
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Split failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-md p-6">
        <h2 className="text-white font-semibold text-lg mb-1">Split Task</h2>
        <p className="text-gray-400 text-sm mb-4">
          {task.name} — Frames {frameStart + 1}–{frameEnd + 1} ({totalFrames} frames)
        </p>

        <div className="mb-4">
          <label className="block text-gray-300 text-sm mb-1">Number of sub-tasks</label>
          <input
            type="number"
            min={2}
            max={totalFrames}
            value={numParts}
            onChange={(e) => setNumParts(Math.max(2, parseInt(e.target.value) || 2))}
            className="w-full bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm"
          />
        </div>

        <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
          {subTasks.map((sub, i) => (
            <div key={i} className="flex items-center justify-between bg-gray-800 rounded-lg px-3 py-2 text-sm">
              <span className="text-gray-300">{sub.name}</span>
              <span className="text-gray-500">Frames {sub.frame_start + 1}–{sub.frame_end + 1}</span>
            </div>
          ))}
        </div>

        <p className="text-amber-400 text-xs mb-4">
          Annotations will be redistributed to the correct sub-task. The original task will be deleted.
        </p>

        {error && <p className="text-red-400 text-sm mb-3">{error}</p>}

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSplit}
            disabled={loading}
            className="px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-500 disabled:opacity-50 transition-all"
          >
            {loading ? 'Splitting…' : `Split into ${numParts} tasks`}
          </button>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// TASK CARD WITH PER-TAXONOMY STATUS
// =============================================================================

interface TaskCardProps {
  task: any;
  taskIdx: number;
  selectedTaxonomyId: string | null | undefined;
  onSelectTask: (task: any) => void;
  onOpenEditor: (taskId: string) => void;
}

const TaskCard: React.FC<TaskCardProps> = ({ task, taskIdx, selectedTaxonomyId, onSelectTask, onOpenEditor }) => {
  // Fetch per-taxonomy workflow status when a taxonomy is selected
  const { data: taxonomyWorkflowInfo } = useQuery({
    queryKey: ['workflow-info', task.id, selectedTaxonomyId],
    queryFn: () => workflowApi.getInfo(task.id, selectedTaxonomyId!),
    enabled: !!selectedTaxonomyId,
    staleTime: 30000, // Cache for 30 seconds
  });

  // Use per-taxonomy status if available, otherwise fall back to global task status
  const effectiveStage = taxonomyWorkflowInfo?.stage ?? task.stage ?? 'annotation';
  const effectiveStatus = taxonomyWorkflowInfo?.status ?? task.status ?? 'pending';
  const effectiveRevisionCount = taxonomyWorkflowInfo?.revision_count ?? task.revision_count ?? 0;

  const stageColors: Record<string, string> = {
    annotation: 'border-l-blue-500',
    qa: 'border-l-orange-500',
    customer_qa: 'border-l-violet-500',
    accepted: 'border-l-emerald-500',
  };
  const statusBgColors: Record<string, string> = {
    pending: 'bg-gray-500/10 text-gray-400',
    assigned: 'bg-blue-500/10 text-blue-400',
    in_progress: 'bg-yellow-500/10 text-yellow-400',
    submitted: 'bg-purple-500/10 text-purple-400',
    accepted: 'bg-emerald-500/10 text-emerald-400',
    rejected: 'bg-red-500/10 text-red-400',
  };

  return (
    <div
      className={`bg-gray-800/50 rounded-xl border-l-4 ${stageColors[effectiveStage]} overflow-hidden transition-all group hover:shadow-lg hover:shadow-cyan-500/5`}
    >
      {/* Task Header */}
      <div
        onClick={() => onSelectTask(task)}
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-800/70 transition-all"
      >
        <div className="flex items-center gap-4">
          {/* Task Number Badge */}
          <div className="flex flex-col items-center">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500/20 to-orange-500/20 border border-amber-500/30 flex items-center justify-center">
              <span className="text-amber-400 font-bold text-sm">#{taskIdx + 1}</span>
            </div>
          </div>

          {/* Task Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm text-white font-semibold group-hover:text-cyan-300 transition-colors truncate">
                {task.name}
              </p>
              {effectiveRevisionCount > 0 && effectiveStage !== 'customer_qa' && effectiveStage !== 'accepted' && (
                <span className="px-1.5 py-0.5 text-[9px] bg-red-500/20 text-red-400 rounded font-medium">
                  R{effectiveRevisionCount}
                </span>
              )}
            </div>
            <p className="text-xs text-gray-500">
              Frames {(task.frame_range?.start || 0) + 1} - {(task.frame_range?.end || 0) + 1}
              {task.assignee?.full_name && (
                <span className="ml-2 text-gray-400">• {task.assignee.full_name}</span>
              )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          {/* Stage Progress Inline */}
          <StageProgressInline
            currentStage={effectiveStage}
            currentStatus={effectiveStatus}
            revisionCount={effectiveRevisionCount}
          />

          {/* Status Badge */}
          <span className={`px-2.5 py-1 text-xs rounded-lg font-medium capitalize ${statusBgColors[effectiveStatus] || 'bg-gray-700'}`}>
            {effectiveStatus.replace('_', ' ')}
          </span>
        </div>
      </div>

      {/* Task Actions Bar */}
      <div className="flex items-center justify-end px-4 py-2 bg-gray-900/30 border-t border-gray-700/30">
        {/* Right Actions */}
        <div className="flex items-center gap-2">
          <div onClick={(e) => e.stopPropagation()}>
            <ExportButton
              entityType="task"
              entityId={task.id}
              entityName={task.name}
              variant="icon"
              className="p-1.5 text-gray-400 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all"
              taxonomyId={selectedTaxonomyId || undefined}
            />
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOpenEditor(task.id);
            }}
            className="px-3 py-1.5 text-xs bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 rounded-lg font-medium hover:bg-cyan-500/30 transition-all"
          >
            Open Editor
          </button>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// DATASET DETAIL PAGE
// =============================================================================

type TabType = 'scenes' | 'taxonomy' | 'dataops' | 'settings';
type StatusFilter = 'all' | 'pending' | 'assigned' | 'in_progress' | 'submitted' | 'accepted' | 'rejected';
type StageFilter = 'all' | 'annotation' | 'qa' | 'customer_qa' | 'accepted';

export const DatasetDetail: React.FC = () => {
  const { datasetId } = useParams<{ datasetId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isLinkModalOpen, setIsLinkModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [renamedScenes, setRenamedScenes] = useState<RenamedScene[]>([]);
  const [isImportAnnotationsModalOpen, setIsImportAnnotationsModalOpen] = useState(false);
  const [importAnnotationsSceneId, setImportAnnotationsSceneId] = useState<string | null>(null);
  const [creatingTaskForScene, setCreatingTaskForScene] = useState<string | null>(null);
  void creatingTaskForScene; // Suppress unused variable warning
  const [taskCreationSceneId, setTaskCreationSceneId] = useState<string | null>(null);
  const [splitTask, setSplitTask] = useState<any | null>(null);
  // Track which scenes have opened the modal to prevent accidental re-opens
  const [modalOpenedSceneIds, setModalOpenedSceneIds] = useState<Set<string>>(new Set());
  // Task detail modal
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  // Scene deletion
  const [sceneToDelete, setSceneToDelete] = useState<Scene | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  // Auto-annotation
  // Dataset deletion
  const [showDeleteDatasetConfirm, setShowDeleteDatasetConfirm] = useState(false);
  // Edit metadata
  const [isEditMetadataOpen, setIsEditMetadataOpen] = useState(false);

  // NEW: Tab and filter state for cleaner UI
  const [activeTab, setActiveTab] = useState<TabType>('scenes');
  const [isOverviewExpanded, setIsOverviewExpanded] = useState(false);
  const [expandedScenes, setExpandedScenes] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [stageFilter, setStageFilter] = useState<StageFilter>('all');

  // Dataset-level taxonomy selection - affects stage/status display for all scenes/tasks
  // Persist in URL so it's maintained when navigating back
  const selectedDatasetTaxonomyId = searchParams.get('taxonomy') || '';
  const setSelectedDatasetTaxonomyId = useCallback((taxonomyId: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (taxonomyId) {
      newParams.set('taxonomy', taxonomyId);
    } else {
      newParams.delete('taxonomy');
    }
    setSearchParams(newParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const queryClient = useQueryClient();

  // Mutation: auto-create tasks for all scenes for the selected taxonomy
  const createTasksMutation = useMutation({
    mutationFn: (taxonomyId: string) => datasetApi.createTasksForTaxonomy(datasetId!, taxonomyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dataset-detail', datasetId] });
    },
  });

  const handleCreateTasks = () => {
    // Use selected taxonomy, or first linked taxonomy as fallback
    const taxId = selectedDatasetTaxonomyId || linkedTaxonomies?.[0]?.id;
    if (taxId) createTasksMutation.mutate(taxId);
  };

  // Use optimized combined endpoint to fetch all data in one call
  const { data: datasetDetail, isLoading: loadingDatasetDetail } = useQuery({
    queryKey: ['dataset-detail', datasetId],
    queryFn: () => datasetApi.getDetail(datasetId!),
    enabled: !!datasetId,
    staleTime: 0, // Always fetch fresh so task stages are up to date
  });

  // Extract data from combined response
  const dataset = datasetDetail;

  // Fetch campaign details for breadcrumb
  const { data: campaign } = useQuery({
    queryKey: ['campaign', dataset?.campaign_id],
    queryFn: () => campaignApi.get(dataset!.campaign_id),
    enabled: !!dataset?.campaign_id,
    staleTime: 60000, // Cache for 60 seconds
  });
  const linkedTaxonomies = datasetDetail?.taxonomies;
  const scenes = datasetDetail?.scenes;

  // Resolve the display name of the currently selected taxonomy (undefined when "All Taxonomies")
  const selectedTaxonomyName: string | undefined =
    selectedDatasetTaxonomyId
      ? (linkedTaxonomies as any[])?.find((t: any) => t.id === selectedDatasetTaxonomyId)?.name
      : undefined;
  const loadingDataset = loadingDatasetDetail;
  const loadingTaxonomies = loadingDatasetDetail;
  const loadingScenes = loadingDatasetDetail;

  // Handle URL action parameters (from SetupWizard navigation)
  useEffect(() => {
    const action = searchParams.get('action');
    if (action && dataset) {
      // Clear the action param to prevent re-triggering
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('action');
      setSearchParams(newParams, { replace: true });

      // Trigger the corresponding action
      switch (action) {
        case 'upload':
          setIsImportModalOpen(true);
          break;
        case 'link-taxonomy':
          setActiveTab('taxonomy');
          setTimeout(() => setIsLinkModalOpen(true), 100);
          break;
      }
    }
  }, [searchParams, dataset, setSearchParams]);

  // Toggle scene expansion
  const toggleSceneExpanded = (sceneId: string) => {
    const newExpanded = new Set(expandedScenes);
    if (newExpanded.has(sceneId)) {
      newExpanded.delete(sceneId);
    } else {
      newExpanded.add(sceneId);
    }
    setExpandedScenes(newExpanded);
  };

  // Filtered scenes based on task filters and selected taxonomy
  const filteredScenes = useMemo(() => {
    if (!scenes) return [];

    const linkedTaxonomyIds = new Set((linkedTaxonomies || []).map((t: any) => t.id));
    const hasTaxonomyData = linkedTaxonomyIds.size > 0;

    return scenes.map((scene: Scene) => {
      const filteredTasks = (scene.tasks || []).filter((task: any) => {
        // Only filter by linked taxonomy when we have taxonomy data loaded
        if (hasTaxonomyData && (!task.taxonomy_id || !linkedTaxonomyIds.has(task.taxonomy_id))) return false;
        const taxonomyMatch = !selectedDatasetTaxonomyId || task.taxonomy_id === selectedDatasetTaxonomyId;
        const statusMatch = statusFilter === 'all' || task.status === statusFilter;
        const stageMatch = stageFilter === 'all' || (task.stage || 'annotation') === stageFilter;
        return taxonomyMatch && statusMatch && stageMatch;
      });
      return { ...scene, tasks: filteredTasks };
    }).filter((scene: Scene) => (scene.tasks && scene.tasks.length > 0) || (statusFilter === 'all' && stageFilter === 'all'));
  }, [scenes, statusFilter, stageFilter, selectedDatasetTaxonomyId, linkedTaxonomies]);

  // Stats computed from scenes, filtered by selected taxonomy
  const stats = useMemo(() => {
    if (!scenes) return { total: 0, accepted: 0, pending: 0, inProgress: 0, qa: 0 };
    const linkedTaxonomyIds = new Set((linkedTaxonomies || []).map((t: any) => t.id));
    const hasTaxonomyData = linkedTaxonomyIds.size > 0;
    const allTasks: any[] = [];
    scenes.forEach((scene: any) => {
      if (scene.tasks) allTasks.push(...scene.tasks);
    });
    // Mirror the scene/task list filtering so the header count matches what's
    // displayed: exclude tasks not linked to any current taxonomy, then apply
    // the explicit taxonomy filter when one is selected.
    const taxTasks = allTasks.filter(t => {
      if (hasTaxonomyData && (!t.taxonomy_id || !linkedTaxonomyIds.has(t.taxonomy_id))) return false;
      if (selectedDatasetTaxonomyId && t.taxonomy_id !== selectedDatasetTaxonomyId) return false;
      return true;
    });
    return {
      total: taxTasks.length,
      accepted: taxTasks.filter(t => t.stage === 'accepted').length,
      pending: taxTasks.filter(t => t.status === 'pending').length,
      inProgress: taxTasks.filter(t => t.status === 'in_progress').length,
      qa: taxTasks.filter(t => t.stage === 'qa' || t.stage === 'customer_qa').length,
    };
  }, [scenes, selectedDatasetTaxonomyId, linkedTaxonomies]);

  // Fetch users for task assignment dropdown
  const { data: users } = useQuery({
    queryKey: ['users'],
    queryFn: () => userApi.list(),
    staleTime: 60000, // Cache users for 1 minute
  });

  // @ts-ignore
  const createTaskMutation = useMutation({
    mutationFn: (scene: Scene) => taskApi.create({
      scene_id: scene.id,
      name: `Annotation Task - ${scene.name}`,
      frame_range: {
        start: 0,
        end: (scene.frame_count || 1) - 1,
      },
    }),
    onSuccess: (task: Task) => {
      queryClient.invalidateQueries({ queryKey: ['dataset-detail', datasetId] });
      setCreatingTaskForScene(null);
      // Navigate to the editor
      navigate(`/tasks/${task.id}`);
    },
    onError: () => {
      setCreatingTaskForScene(null);
    },
  });

  // Delete scene mutation
  const deleteSceneMutation = useMutation({
    mutationFn: (sceneId: string) => sceneApi.delete(sceneId),
    onSuccess: async () => {
      await queryClient.refetchQueries({ queryKey: ['dataset-detail', datasetId] });
      setSceneToDelete(null);
      setIsDeleting(false);
    },
    onError: () => {
      setIsDeleting(false);
    },
  });

  // Delete dataset mutation
  const deleteDatasetMutation = useMutation({
    mutationFn: () => datasetApi.delete(datasetId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      // Navigate back to the campaign or home
      navigate(-1);
    },
  });

  const handleDeleteDataset = () => {
    deleteDatasetMutation.mutate();
  };

  const handleDeleteScene = async () => {
    if (!sceneToDelete) return;
    setIsDeleting(true);
    deleteSceneMutation.mutate(sceneToDelete.id);
  };

  if (loadingDataset) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-gray-400">Loading dataset...</div>
        </div>
      </AppLayout>
    );
  }

  if (!dataset) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="text-red-400 mb-4">Dataset not found</div>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 bg-primary text-white rounded-lg"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </AppLayout>
    );
  }

  const linkedTaxonomyIds = linkedTaxonomies?.map((t: Taxonomy) => t.id) || [];

  const progressPercent = stats.total > 0 ? Math.round((stats.accepted / stats.total) * 100) : 0;

  const selectedScenePreviewTaxonomy = selectedDatasetTaxonomyId
    ? linkedTaxonomies?.find((tax: Taxonomy) => tax.id === selectedDatasetTaxonomyId)
    : null;

  const scenePreviewClasses =
    selectedScenePreviewTaxonomy?.classes && selectedScenePreviewTaxonomy.classes.length > 0
      ? selectedScenePreviewTaxonomy.classes
      : (dataset.taxonomy?.classes || []);

  // Breadcrumb header content
  const breadcrumbContent = (
    <nav className="flex items-center gap-2 text-sm">
      <Link to="/" className="text-gray-400 hover:text-white transition-colors">Home</Link>
      <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      <Link
        to={`/campaigns/${dataset.campaign_id}`}
        className="text-gray-400 hover:text-white transition-colors"
      >
        {campaign?.name || 'Campaign'}
      </Link>
      <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      <span className="text-white font-medium">{dataset.name}</span>
    </nav>
  );

  return (
    <AppLayout headerContent={breadcrumbContent}>
      {/* Quick Stats Row */}
      <div className="bg-gray-900/60 border-b border-gray-700/30">
        <div className="max-w-7xl mx-auto px-6 py-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-sm">
              <span className="px-2 py-1 bg-cyan-500/10 text-cyan-400 rounded-md font-medium">{scenes?.length || 0} scenes</span>
              <span className="px-2 py-1 bg-amber-500/10 text-amber-400 rounded-md font-medium">{stats.total} tasks</span>
              {linkedTaxonomies && linkedTaxonomies.length > 0 && (
                <span className="px-2 py-1 bg-purple-500/10 text-purple-400 rounded-md font-medium flex items-center gap-1.5">
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                  </svg>
                  {linkedTaxonomies.length} {linkedTaxonomies.length === 1 ? 'taxonomy' : 'taxonomies'}
                </span>
              )}
              <div className="flex items-center gap-2 px-2 py-1 bg-emerald-500/10 rounded-md">
                <span className="text-emerald-400 font-medium">{progressPercent}%</span>
                <div className="w-16 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${progressPercent}%` }} />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <ExportButton
                entityType="dataset"
                entityId={dataset.id}
                entityName={dataset.name}
                variant="full"
                className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-indigo-600 text-white rounded-lg hover:from-blue-600 hover:to-indigo-700 transition-all text-xs font-medium"
                taxonomyId={selectedDatasetTaxonomyId || undefined}
              />
              <button
                onClick={() => setIsImportModalOpen(true)}
                className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-emerald-500 to-teal-600 text-white rounded-lg hover:from-emerald-600 hover:to-teal-700 transition-all text-xs font-medium"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Upload
              </button>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-center gap-1 -mb-px">
            {[
              { id: 'scenes' as TabType, label: 'Scenes & Tasks', icon: '🎬', count: scenes?.length || 0 },
              { id: 'taxonomy' as TabType, label: 'Taxonomy', icon: '🏷️', count: linkedTaxonomies?.length || 0 },
              { id: 'dataops' as TabType, label: 'DataOps', icon: '📊' },
              { id: 'settings' as TabType, label: 'Settings', icon: '⚙️' },
            ].map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium transition-all border-b-2 ${
                  activeTab === tab.id
                    ? 'text-white border-cyan-500 bg-cyan-500/5'
                    : 'text-gray-400 border-transparent hover:text-gray-300 hover:bg-gray-800/50'
                }`}
              >
                <span className="mr-1.5">{tab.icon}</span>
                {tab.label}
                {tab.count !== undefined && <span className="ml-1.5 text-xs opacity-60">({tab.count})</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-6">

        {/* Setup Progress Banner - Shows if dataset is not fully configured */}
        <SetupProgressBanner
          completedSteps={{
            hasScenes: !!(scenes && scenes.length > 0),
            hasTaxonomy: !!(linkedTaxonomies && linkedTaxonomies.length > 0),
            hasTasks: stats.total > 0,
          }}
          onUploadClick={() => setIsImportModalOpen(true)}
          onLinkTaxonomyClick={() => setIsLinkModalOpen(true)}
          onCreateTaskClick={handleCreateTasks}
        />

        {/* SCENES TAB */}
        {activeTab === 'scenes' && (
          <div>
            {/* Collapsible Overview */}
            <div className="mb-6">
              <div
                className="w-full flex items-center justify-between p-4 bg-gray-800/50 rounded-xl border border-gray-700/50 hover:bg-gray-800/70 transition-all group"
              >
                <button
                  onClick={() => setIsOverviewExpanded(!isOverviewExpanded)}
                  className="flex items-center gap-4 flex-1"
                >
                  <span className="text-sm font-medium text-gray-300">📊 Dataset Overview</span>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-400 rounded">{stats.accepted} done</span>
                    <span className="px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded">{stats.inProgress} active</span>
                    <span className="px-2 py-0.5 bg-orange-500/20 text-orange-400 rounded">{stats.qa} in QA</span>
                  </div>
                </button>
                <div className="flex items-center gap-3">
                  {/* Dataset-level Taxonomy Dropdown */}
                  {linkedTaxonomies && linkedTaxonomies.length > 1 && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <select
                        value={selectedDatasetTaxonomyId}
                        onChange={(e) => setSelectedDatasetTaxonomyId(e.target.value)}
                        className="px-3 py-1.5 text-xs bg-purple-500/20 border border-purple-500/30 rounded-lg text-purple-300 focus:outline-none focus:ring-2 focus:ring-purple-500/50 cursor-pointer min-w-[150px]"
                        title="Select taxonomy to view stage/status for all tasks"
                      >
                        <option value="" className="bg-gray-800">All Taxonomies</option>
                        {linkedTaxonomies.map((tax: Taxonomy) => (
                          <option key={tax.id} value={tax.id} className="bg-gray-800">
                            {tax.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <button onClick={() => setIsOverviewExpanded(!isOverviewExpanded)}>
                    <svg className={`w-5 h-5 text-gray-500 transition-transform ${isOverviewExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>
              </div>

              {isOverviewExpanded && (
                <div className="mt-2 p-5 bg-gray-800/30 rounded-xl border border-gray-700/30 space-y-4 animate-in slide-in-from-top-2">
                  {/* Quick Stats Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="bg-cyan-500/10 border border-cyan-500/20 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-cyan-400">{scenes?.length || 0}</div>
                      <div className="text-xs text-gray-400 mt-1">Total Scenes</div>
                    </div>
                    <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-amber-400">{stats.total}</div>
                      <div className="text-xs text-gray-400 mt-1">Total Tasks</div>
                    </div>
                    <div className="bg-purple-500/10 border border-purple-500/20 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-purple-400">{dataset.taxonomy?.classes?.length || 0}</div>
                      <div className="text-xs text-gray-400 mt-1">Classes</div>
                    </div>
                    <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-3 text-center">
                      <div className="text-2xl font-bold text-emerald-400">{progressPercent}%</div>
                      <div className="text-xs text-gray-400 mt-1">Complete</div>
                    </div>
                  </div>

                  {/* Custom Metadata */}
                  {dataset.custom_metadata && Object.keys(dataset.custom_metadata).length > 0 ? (
                    <div className="bg-gradient-to-br from-gray-800/80 to-gray-900/80 rounded-xl p-4 border border-gray-600/50">
                      <div className="flex items-center justify-between mb-3">
                        <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                          <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                          </svg>
                          Custom Attributes
                        </h3>
                        <AdminOnly>
                          <button
                            onClick={() => setIsEditMetadataOpen(true)}
                            className="px-3 py-1 text-xs text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10 rounded-lg transition-colors flex items-center gap-1"
                          >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Edit
                          </button>
                        </AdminOnly>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {Object.entries(dataset.custom_metadata).map(([key, value]) => (
                          <div key={key} className="bg-gray-900/70 rounded-lg px-3 py-2.5 border border-gray-700/50">
                            <div className="text-xs text-gray-500 uppercase tracking-wider mb-1">{key}</div>
                            <div className="text-sm text-white font-medium truncate" title={String(value)}>
                              {String(value)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <AdminOnly>
                      <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-xl p-4 border border-dashed border-gray-600/50">
                        <button
                          onClick={() => setIsEditMetadataOpen(true)}
                          className="w-full flex items-center justify-center gap-2 py-2 text-sm text-gray-400 hover:text-cyan-400 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                          </svg>
                          Add Custom Attributes
                        </button>
                      </div>
                    </AdminOnly>
                  )}

                  {/* Sensor Info */}
                  <div className="bg-gray-900/50 rounded-lg p-4 border border-gray-700/50">
                    <div className="text-xs text-gray-500 font-medium uppercase mb-3">Available Sensors</div>
                    <div className="flex flex-wrap gap-3">
                      {/* LiDAR */}
                      <div className="flex items-center gap-2 px-3 py-2 bg-green-500/10 border border-green-500/30 rounded-lg">
                        <span className="text-lg">📡</span>
                        <div>
                          <div className="text-sm font-medium text-green-400">LiDAR</div>
                          <div className="text-xs text-gray-500">1 sensor</div>
                        </div>
                      </div>
                      {/* Cameras */}
                      {(() => {
                        // Get camera list from first scene
                        const firstScene = scenes?.[0];
                        const cameras = firstScene?.storage_paths?.cameras ? Object.keys(firstScene.storage_paths.cameras) : [];
                        const cameraCount = cameras.length || 6; // Default to 6 if not available
                        return (
                          <div className="flex items-center gap-2 px-3 py-2 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                            <span className="text-lg">📷</span>
                            <div>
                              <div className="text-sm font-medium text-blue-400">Cameras</div>
                              <div className="text-xs text-gray-500">{cameraCount} sensors</div>
                            </div>
                          </div>
                        );
                      })()}
                      {/* Camera list preview */}
                      {(() => {
                        const firstScene = scenes?.[0];
                        const cameras = firstScene?.storage_paths?.cameras ? Object.keys(firstScene.storage_paths.cameras) : [];
                        if (cameras.length === 0) return null;
                        return (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {cameras.map(cam => (
                              <span key={cam} className="px-2 py-1 text-xs bg-gray-800 text-gray-300 rounded border border-gray-700">
                                {cam.replace(/_/g, ' ').replace(/camera/i, '').trim() || cam}
                              </span>
                            ))}
                          </div>
                        );
                      })()}
                    </div>
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-sm mb-2">
                      <span className="text-gray-400">Overall Progress</span>
                      <span className="text-emerald-400 font-semibold">{progressPercent}%</span>
                    </div>
                    <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all" style={{ width: `${progressPercent}%` }} />
                    </div>
                  </div>

                  {/* Stage Pipeline */}
                  <div className="flex items-center justify-between gap-2">
                    {[
                      { stage: 'annotation', label: 'Annotation', color: 'blue' },
                      { stage: 'qa', label: 'QA Review', color: 'orange' },
                      { stage: 'customer_qa', label: 'Customer QA', color: 'violet' },
                      { stage: 'accepted', label: 'Completed', color: 'emerald' },
                    ].map((s, idx) => {
                      const count = scenes?.reduce((acc: number, sc: any) =>
                        acc + (sc.tasks?.filter((t: any) => (t.stage || 'annotation') === s.stage).length || 0), 0) || 0;
                      return (
                        <React.Fragment key={s.stage}>
                          <div className={`flex-1 text-center p-3 rounded-lg bg-${s.color}-500/10 border border-${s.color}-500/20`}>
                            <div className={`text-2xl font-bold text-${s.color}-400`}>{count}</div>
                            <div className="text-xs text-gray-400 mt-1">{s.label}</div>
                          </div>
                          {idx < 3 && <svg className="w-4 h-4 text-gray-600 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>}
                        </React.Fragment>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Section Header - Scenes */}
            <div className="flex items-center gap-3 mb-3">
              <div className="flex items-center gap-2">
                <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                </svg>
                <h2 className="text-lg font-bold text-white">Scenes</h2>
                <span className="text-sm text-gray-500">({filteredScenes?.length || 0})</span>
              </div>
            </div>

            {/* Filter Bar */}
            <div className="flex items-center gap-3 mb-4 p-3 bg-gray-800/30 rounded-xl border border-gray-700/30">
              <span className="text-xs text-gray-500 font-medium uppercase">Filter:</span>
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value as StatusFilter)}
                className="px-3 py-1.5 text-sm bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="all">All Status</option>
                <option value="pending">Pending</option>
                <option value="assigned">Assigned</option>
                <option value="in_progress">In Progress</option>
                <option value="submitted">Submitted</option>
                <option value="accepted">Accepted</option>
                <option value="rejected">Rejected</option>
              </select>
              <select
                value={stageFilter}
                onChange={e => setStageFilter(e.target.value as StageFilter)}
                className="px-3 py-1.5 text-sm bg-gray-900 border border-gray-700 rounded-lg text-white focus:outline-none focus:border-cyan-500"
              >
                <option value="all">All Stages</option>
                <option value="annotation">Annotation</option>
                <option value="qa">QA Review</option>
                <option value="customer_qa">Customer QA</option>
                <option value="accepted">Completed</option>
              </select>
              {(statusFilter !== 'all' || stageFilter !== 'all') && (
                <button
                  onClick={() => { setStatusFilter('all'); setStageFilter('all'); }}
                  className="text-xs text-cyan-400 hover:text-cyan-300"
                >
                  Clear filters
                </button>
              )}
              <div className="ml-auto text-xs text-gray-500">
                {filteredScenes.reduce((acc: number, s: any) => acc + (s.tasks?.length || 0), 0)} tasks shown
              </div>
            </div>

            {/* Scenes List - Accordion Style */}
            {loadingScenes ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-cyan-500"></div>
              </div>
            ) : filteredScenes && filteredScenes.length > 0 ? (
              <div className="space-y-2">
                {filteredScenes.map((scene: Scene, idx: number) => {
                  const isExpanded = expandedScenes.has(scene.id);
                  const taskCount = scene.tasks?.length || 0;
                  const completedCount = scene.tasks?.filter((t: any) => t.stage === 'accepted').length || 0;

                  return (
                    <div key={scene.id} className={`rounded-xl overflow-hidden transition-all ${
                      isExpanded
                        ? 'bg-gradient-to-r from-cyan-500/15 via-gray-800/40 to-gray-800/40 border-2 border-cyan-500/40 shadow-lg shadow-cyan-500/10'
                        : 'bg-gray-800/40 border border-gray-700/50'
                    }`}>
                      {/* Scene Header - Always Visible */}
                      <div
                        className={`flex items-center justify-between p-4 cursor-pointer transition-all ${
                          isExpanded ? 'bg-cyan-500/5' : 'hover:bg-gray-800/60'
                        }`}
                        onClick={() => toggleSceneExpanded(scene.id)}
                      >
                        <div className="flex items-center gap-3">
                          {/* Scene Badge with Label */}
                          <div className="flex flex-col items-center">
                            <span className={`text-[9px] uppercase tracking-wider mb-0.5 ${isExpanded ? 'text-cyan-400 font-semibold' : 'text-gray-500'}`}>Scene</span>
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                              isExpanded
                                ? 'bg-gradient-to-br from-cyan-500/40 to-blue-600/40 border-2 border-cyan-400/60 shadow-lg shadow-cyan-500/30'
                                : 'bg-gradient-to-br from-cyan-500/20 to-blue-600/20 border border-cyan-500/30'
                            }`}>
                              <span className={`font-bold text-xs ${isExpanded ? 'text-cyan-300' : 'text-cyan-400'}`}>#{idx + 1}</span>
                            </div>
                          </div>
                          {/* Scene Film Icon */}
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all ${
                            isExpanded ? 'bg-cyan-500/20 border border-cyan-500/40' : 'bg-gray-700/50'
                          }`}>
                            <svg className={`w-4 h-4 transition-colors ${isExpanded ? 'text-cyan-400' : 'text-gray-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                            </svg>
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-3">
                              <h3 className={`font-medium ${isExpanded ? 'text-white' : 'text-white'}`}>{scene.name}</h3>
                              {/* Quick Status Summary Badges */}
                              {taskCount > 0 && (
                                <div className="hidden sm:flex items-center gap-1">
                                  {(() => {
                                    const statusCounts: Record<string, number> = {};
                                    scene.tasks?.forEach((t: any) => {
                                      statusCounts[t.status] = (statusCounts[t.status] || 0) + 1;
                                    });
                                    const badges: { status: string; count: number; color: string; icon: string }[] = [];
                                    if (statusCounts.pending) badges.push({ status: 'pending', count: statusCounts.pending, color: 'bg-slate-500/30 text-slate-300', icon: '⏳' });
                                    if (statusCounts.assigned) badges.push({ status: 'assigned', count: statusCounts.assigned, color: 'bg-blue-500/30 text-blue-300', icon: '👤' });
                                    if (statusCounts.in_progress) badges.push({ status: 'in_progress', count: statusCounts.in_progress, color: 'bg-amber-500/30 text-amber-300', icon: '⚡' });
                                    if (statusCounts.submitted) badges.push({ status: 'submitted', count: statusCounts.submitted, color: 'bg-violet-500/30 text-violet-300', icon: '📤' });
                                    if (statusCounts.rejected) badges.push({ status: 'rejected', count: statusCounts.rejected, color: 'bg-rose-500/30 text-rose-300', icon: '❌' });
                                    if (statusCounts.accepted) badges.push({ status: 'accepted', count: statusCounts.accepted, color: 'bg-emerald-500/30 text-emerald-300', icon: '✅' });
                                    return badges.map(b => (
                                      <span key={b.status} className={`px-1.5 py-0.5 text-xs rounded ${b.color} font-medium`} title={b.status}>
                                        {b.icon} {b.count}
                                      </span>
                                    ));
                                  })()}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-xs text-gray-500 mt-0.5">
                              <span>📷 {scene.frame_count || 0} frames</span>
                              <span>•</span>
                              <span>📋 {taskCount} task{taskCount !== 1 ? 's' : ''}</span>
                              {scene.storage_paths?.cameras && (
                                <>
                                  <span>•</span>
                                  <span>🎥 {Object.keys(scene.storage_paths.cameras).length} cameras</span>
                                </>
                              )}
                            </div>
                            {scene.description && (
                              <p className="text-xs text-gray-500 italic mt-1 line-clamp-1" title={scene.description}>
                                💬 {scene.description}
                              </p>
                            )}
                            {/* Taxonomy Classes Preview */}
                            {scenePreviewClasses.length > 0 && (
                              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                <span className="text-xs text-gray-500">🏷️</span>
                                {scenePreviewClasses.slice(0, 5).map((cls) => (
                                  <span
                                    key={cls.id}
                                    className="px-1.5 py-0.5 text-xs rounded-md font-medium"
                                    style={{
                                      backgroundColor: `${cls.color}20`,
                                      color: cls.color,
                                      border: `1px solid ${cls.color}40`
                                    }}
                                  >
                                    {cls.name}
                                  </span>
                                ))}
                                {scenePreviewClasses.length > 5 && (
                                  <span className="text-xs text-gray-500">
                                    +{scenePreviewClasses.length - 5} more
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          {/* Mini progress for scene */}
                          {taskCount > 0 && (
                            <div className="flex items-center gap-2">
                              <div className="w-20 h-1.5 bg-gray-700 rounded-full overflow-hidden">
                                <div
                                  className="h-full bg-emerald-500 rounded-full"
                                  style={{ width: `${Math.round((completedCount / taskCount) * 100)}%` }}
                                />
                              </div>
                              <span className="text-xs text-gray-500">{Math.round((completedCount / taskCount) * 100)}%</span>
                            </div>
                          )}

                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!modalOpenedSceneIds.has(scene.id)) {
                                setModalOpenedSceneIds(new Set(modalOpenedSceneIds).add(scene.id));
                                setTaskCreationSceneId(scene.id);
                              }
                            }}
                            disabled={modalOpenedSceneIds.has(scene.id)}
                            className="px-3 py-1.5 text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/30 disabled:opacity-50 font-medium"
                          >
                            + Task
                          </button>

                          {/* Export Scene Button */}
                          <div onClick={(e) => e.stopPropagation()}>
                            <ExportButton
                              entityType="scene"
                              entityId={scene.id}
                              entityName={scene.name}
                              variant="icon"
                              className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                              taxonomyId={selectedDatasetTaxonomyId || undefined}
                              taxonomyName={selectedTaxonomyName}
                            />
                          </div>

                          {/* Import Annotations Button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setImportAnnotationsSceneId(scene.id);
                            }}
                            className="p-1.5 text-gray-500 hover:text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-colors"
                            title="Import annotations"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                            </svg>
                          </button>

                          {/* Delete Scene Button */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSceneToDelete(scene);
                            }}
                            className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                            title="Delete scene"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>

                          <svg className={`w-5 h-5 text-gray-500 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                          </svg>
                        </div>
                      </div>

                      {/* Expanded Content */}
                      {isExpanded && scene.tasks && scene.tasks.length > 0 && (() => {
                        const sortedTasks = [...scene.tasks].sort((a: any, b: any) =>
                          (a.frame_range?.start ?? 0) - (b.frame_range?.start ?? 0)
                        );
                        const showGrouped = !selectedDatasetTaxonomyId && (linkedTaxonomies?.length ?? 0) > 1;

                        if (showGrouped) {
                          // Group tasks by taxonomy
                          const groups: { tax: any; tasks: any[] }[] = (linkedTaxonomies || []).map((tax: any) => ({
                            tax,
                            tasks: sortedTasks.filter((t: any) => t.taxonomy_id === tax.id),
                          })).filter((g: any) => g.tasks.length > 0);

                          return (
                            <div className="border-t border-gray-700/50 p-4 bg-gray-900/30 space-y-5">
                              {groups.map(({ tax, tasks: groupTasks }) => (
                                <div key={tax.id}>
                                  <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs font-semibold text-purple-400 uppercase tracking-wide">{tax.name}</span>
                                    <span className="text-xs text-gray-500">({groupTasks.length})</span>
                                  </div>
                                  <div className="space-y-3">
                                    {groupTasks.map((task: any, taskIdx: number) => (
                                      <TaskCard
                                        key={task.id}
                                        task={task}
                                        taskIdx={taskIdx}
                                        selectedTaxonomyId={tax.id}
                                        onSelectTask={setSelectedTask}
                                        onOpenEditor={(taskId) => navigate(`/tasks/${taskId}?taxonomy=${tax.id}`)}
                                      />
                                    ))}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        }

                        return (
                          <div className="border-t border-gray-700/50 p-4 bg-gray-900/30">
                            <div className="flex items-center gap-2 mb-3">
                              <svg className="w-4 h-4 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                              </svg>
                              <span className="text-sm font-medium text-white">Tasks</span>
                              <span className="text-xs text-gray-500">({scene.tasks.length})</span>
                            </div>
                            <div className="space-y-3">
                              {sortedTasks.map((task: any, taskIdx: number) => (
                                <TaskCard
                                  key={task.id}
                                  task={task}
                                  taskIdx={taskIdx}
                                  selectedTaxonomyId={selectedDatasetTaxonomyId || null}
                                  onSelectTask={setSelectedTask}
                                  onOpenEditor={(taskId) => {
                                    const url = selectedDatasetTaxonomyId
                                      ? `/tasks/${taskId}?taxonomy=${selectedDatasetTaxonomyId}`
                                      : `/tasks/${taskId}`;
                                    navigate(url);
                                  }}
                                />
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {isExpanded && (!scene.tasks || scene.tasks.length === 0) && (
                        <div className="border-t border-gray-700/50 p-6 text-center text-gray-500 text-sm">
                          No tasks yet. Click "+ Task" to create one.
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-6">
                {/* Getting Started Card for empty datasets */}
                {statusFilter === 'all' && stageFilter === 'all' && (
                  <GettingStartedCard
                    completedSteps={{
                      hasScenes: false,
                      hasTaxonomy: !!(linkedTaxonomies && linkedTaxonomies.length > 0),
                      hasTasks: false,
                    }}
                    datasetName={dataset.name}
                    onUploadClick={() => setIsImportModalOpen(true)}
                    onLinkTaxonomyClick={() => setIsLinkModalOpen(true)}
                    onCreateTaskClick={() => {}}
                  />
                )}

                {/* Filter active message */}
                {(statusFilter !== 'all' || stageFilter !== 'all') && (
                  <div className="text-center py-16 bg-gray-800/30 rounded-xl border border-dashed border-gray-700">
                    <svg className="w-12 h-12 mx-auto mb-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                    </svg>
                    <p className="text-gray-400 mb-2">No scenes match your filters</p>
                    <button
                      onClick={() => { setStatusFilter('all'); setStageFilter('all'); }}
                      className="px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm"
                    >
                      Clear Filters
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAXONOMY TAB */}
        {activeTab === 'taxonomy' && (
          <TaxonomyTab
            dataset={dataset}
            datasetId={datasetId!}
            linkedTaxonomies={linkedTaxonomies}
            loadingTaxonomies={loadingTaxonomies}
            onLinkClick={() => setIsLinkModalOpen(true)}
          />
        )}

        {/* DATAOPS TAB */}
        {activeTab === 'dataops' && (
          <DataOpsTab
            datasetId={datasetId!}
            onImportAnnotations={() => setIsImportAnnotationsModalOpen(true)}
          />
        )}

        {/* SETTINGS TAB */}
        {activeTab === 'settings' && (
          <div className="bg-gray-800/40 rounded-xl p-6 border border-gray-700/50">
            <h2 className="text-lg font-semibold text-white mb-4">Dataset Settings</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm text-gray-400 mb-1">Name</label>
                <p className="text-white">{dataset.name}</p>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Description</label>
                <p className="text-white">{dataset.description || 'No description'}</p>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Created</label>
                <p className="text-white">{new Date(dataset.created_at).toLocaleDateString()}</p>
              </div>
              <AdminOnly>
                <div className="pt-4 border-t border-gray-700">
                  <button
                    onClick={() => setShowDeleteDatasetConfirm(true)}
                    className="px-4 py-2 bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-lg hover:bg-rose-500/30 transition-colors text-sm"
                  >
                    Delete Dataset
                  </button>
                </div>
              </AdminOnly>
            </div>
          </div>
        )}

        {/* Delete Dataset Confirmation Modal */}
        {showDeleteDatasetConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70" onClick={() => setShowDeleteDatasetConfirm(false)} />
            <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-700">
              <h2 className="text-xl font-semibold text-white mb-4">Delete Dataset</h2>
              <p className="text-gray-400 mb-6">
                Are you sure you want to delete <span className="text-white font-medium">"{dataset.name}"</span>?
                This action cannot be undone and will remove all associated scenes and tasks.
              </p>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowDeleteDatasetConfirm(false)}
                  className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDeleteDataset}
                  disabled={deleteDatasetMutation.isPending}
                  className="px-4 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors disabled:opacity-50"
                >
                  {deleteDatasetMutation.isPending ? 'Deleting...' : 'Delete Dataset'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Link Taxonomy Modal */}
      {datasetId && (
        <LinkTaxonomyModal
          isOpen={isLinkModalOpen}
          datasetId={datasetId}
          linkedTaxonomyIds={linkedTaxonomyIds}
          onClose={() => setIsLinkModalOpen(false)}
          onSuccess={() => {}}
        />
      )}

      {/* Import Data Modal */}
      {datasetId && (
        <ImportDataModal
          isOpen={isImportModalOpen}
          datasetId={datasetId}
          datasetName={dataset?.name || 'Dataset'}
          onClose={() => setIsImportModalOpen(false)}
          onSuccess={async () => {
            await queryClient.refetchQueries({ queryKey: ['dataset-detail', datasetId] });
          }}
          onRenamedScenes={setRenamedScenes}
        />
      )}

      {/* Duplicate Scene Rename Modal */}
      {renamedScenes.length > 0 && (
        <DuplicateSceneModal
          scenes={renamedScenes}
          onClose={async () => {
            setRenamedScenes([]);
            await queryClient.refetchQueries({ queryKey: ['dataset-detail', datasetId] });
          }}
        />
      )}

      {/* Task Creation Modal */}
      {taskCreationSceneId && (
        <TaskCreationModal
          sceneId={taskCreationSceneId}
          sceneName={scenes?.find(s => s.id === taskCreationSceneId)?.name || 'Scene'}
          datasetName={datasetDetail?.name}
          frameCount={scenes?.find(s => s.id === taskCreationSceneId)?.frame_count || 0}
          existingTasks={(() => {
            const effectiveTaxId = selectedDatasetTaxonomyId || (linkedTaxonomies?.length === 1 ? linkedTaxonomies[0].id : undefined);
            return scenes?.find(s => s.id === taskCreationSceneId)?.tasks?.filter((t: any) => !effectiveTaxId || t.taxonomy_id === effectiveTaxId).map((t: any) => ({ id: t.id, name: t.name })) || [];
          })()}
          taxonomyId={
            selectedDatasetTaxonomyId ||
            (linkedTaxonomies?.length === 1 ? linkedTaxonomies[0].id : undefined)
          }
          taxonomyName={
            (selectedDatasetTaxonomyId
              ? linkedTaxonomies?.find((t: any) => t.id === selectedDatasetTaxonomyId)
              : linkedTaxonomies?.length === 1 ? linkedTaxonomies[0] : undefined
            )?.name
          }
          onClose={() => {
            // Clear modal state
            const newIds = new Set(modalOpenedSceneIds);
            newIds.delete(taskCreationSceneId);
            setModalOpenedSceneIds(newIds);
            setTaskCreationSceneId(null);
          }}
          onTasksCreated={async () => {
            await queryClient.refetchQueries({ queryKey: ['dataset-detail', datasetId] });
            const newIds = new Set(modalOpenedSceneIds);
            newIds.delete(taskCreationSceneId);
            setModalOpenedSceneIds(newIds);
            setTaskCreationSceneId(null);
          }}
          annotators={users?.map(u => ({ id: u.id, name: u.full_name || u.username, role: u.role })) || []}
        />
      )}

      {/* Split Task Modal */}
      {splitTask && (
        <SplitTaskModal
          task={splitTask}
          onClose={() => setSplitTask(null)}
          onSplit={async (subTasks) => {
            await taskApi.split(splitTask.id, subTasks);
            await queryClient.refetchQueries({ queryKey: ['dataset-detail', datasetId] });
            setSplitTask(null);
          }}
        />
      )}

      {/* Task Detail Modal */}
      <TaskDetailModal
        isOpen={!!selectedTask}
        task={selectedTask}
        taxonomyId={selectedDatasetTaxonomyId || undefined}
        onClose={() => {
          setSelectedTask(null);
          // Refresh data to update task list
          queryClient.refetchQueries({ queryKey: ['dataset-detail', datasetId] });
        }}
      />

      {/* Import Annotations Modal */}
      {importAnnotationsSceneId && dataset && (
        <ImportAnnotationsModal
          isOpen={!!importAnnotationsSceneId}
          sceneId={importAnnotationsSceneId}
          sceneName={dataset.scenes?.find(s => s.id === importAnnotationsSceneId)?.name || 'Unknown Scene'}
          onClose={() => setImportAnnotationsSceneId(null)}
          taxonomyName={selectedTaxonomyName}
        />
      )}

      {/* Import Dataset Annotations Modal (for entire dataset) */}
      {datasetId && dataset && (
        <ImportDatasetAnnotationsModal
          isOpen={isImportAnnotationsModalOpen}
          datasetId={datasetId}
          datasetName={dataset.name}
          onClose={() => setIsImportAnnotationsModalOpen(false)}
          onSuccess={async () => {
            await queryClient.refetchQueries({ queryKey: ['dataset-detail', datasetId] });
          }}
        />
      )}

      {/* Delete Scene Confirmation Modal */}
      {sceneToDelete && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-800 border border-gray-700 rounded-xl shadow-2xl p-6 max-w-md w-full mx-4">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-red-500/20 border border-red-500/30 rounded-full flex items-center justify-center">
                <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-white">Delete Scene</h3>
                <p className="text-sm text-gray-400">This action cannot be undone</p>
              </div>
            </div>

            <div className="bg-gray-900/50 rounded-lg p-4 mb-4 border border-gray-700/50">
              <p className="text-white font-medium">{sceneToDelete.name}</p>
              <p className="text-sm text-gray-400 mt-1">
                {sceneToDelete.frame_count || 0} frames • {sceneToDelete.tasks?.length || 0} tasks
              </p>
              {sceneToDelete.tasks && sceneToDelete.tasks.length > 0 && (
                <p className="text-sm text-amber-400 mt-2">
                  ⚠️ All {sceneToDelete.tasks.length} task(s) will also be deleted
                </p>
              )}
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setSceneToDelete(null)}
                disabled={isDeleting}
                className="flex-1 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded-lg font-medium text-sm transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteScene}
                disabled={isDeleting}
                className="flex-1 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 rounded-lg font-medium text-sm transition-colors flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Deleting...
                  </>
                ) : (
                  'Delete Scene'
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Metadata Modal */}
      <EditDatasetMetadataModal
        isOpen={isEditMetadataOpen}
        dataset={dataset}
        onClose={() => setIsEditMetadataOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['dataset-detail', datasetId] });
          setIsEditMetadataOpen(false);
        }}
      />
    </AppLayout>
  );
};

// =============================================================================
// EDIT DATASET METADATA MODAL
// =============================================================================

interface EditDatasetMetadataModalProps {
  isOpen: boolean;
  dataset: Dataset;
  onClose: () => void;
  onSuccess: () => void;
}

const EditDatasetMetadataModal: React.FC<EditDatasetMetadataModalProps> = ({
  isOpen,
  dataset,
  onClose,
  onSuccess,
}) => {
  const [metadataEntries, setMetadataEntries] = useState<Array<{ key: string; value: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // Initialize from dataset metadata
  React.useEffect(() => {
    if (isOpen && dataset.custom_metadata) {
      const entries = Object.entries(dataset.custom_metadata).map(([key, value]) => ({
        key,
        value: String(value),
      }));
      setMetadataEntries(entries.length > 0 ? entries : [{ key: '', value: '' }]);
    }
  }, [isOpen, dataset]);

  const updateMutation = useMutation({
    mutationFn: (metadata: Record<string, unknown>) =>
      datasetApi.update(dataset.id, { custom_metadata: metadata }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['dataset-detail', dataset.id] });
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      setError(null);
      onSuccess();
    },
    onError: (err: Error & { response?: { data?: { detail?: string } } }) => {
      setError(err.response?.data?.detail || err.message || 'Failed to update metadata');
    },
  });

  const addEntry = () => {
    setMetadataEntries([...metadataEntries, { key: '', value: '' }]);
  };

  const removeEntry = (index: number) => {
    setMetadataEntries(metadataEntries.filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...metadataEntries];
    updated[index][field] = value;
    setMetadataEntries(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    // Convert to object
    const metadata: Record<string, unknown> = {};
    metadataEntries.forEach((entry) => {
      if (entry.key.trim()) {
        metadata[entry.key.trim()] = entry.value;
      }
    });

    updateMutation.mutate(metadata);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-2xl mx-4 shadow-xl border border-gray-700 max-h-[80vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-white mb-4">Edit Custom Attributes</h2>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-300">
                Attribute Fields
              </label>
              <button
                type="button"
                onClick={addEntry}
                className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Field
              </button>
            </div>

            {metadataEntries.length === 0 ? (
              <p className="text-sm text-gray-500 italic py-4 text-center">No attribute fields. Click "Add Field" to add.</p>
            ) : (
              <div className="space-y-2">
                {metadataEntries.map((entry, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      value={entry.key}
                      onChange={(e) => updateEntry(index, 'key', e.target.value)}
                      placeholder="Key (e.g., weather)"
                      className="flex-1 px-3 py-2 bg-dark border border-gray-600 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-cyan-500"
                    />
                    <input
                      type="text"
                      value={entry.value}
                      onChange={(e) => updateEntry(index, 'value', e.target.value)}
                      placeholder="Value (e.g., sunny)"
                      className="flex-1 px-3 py-2 bg-dark border border-gray-600 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-cyan-500"
                    />
                    <button
                      type="button"
                      onClick={() => removeEntry(index)}
                      className="px-3 py-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-colors"
                      title="Remove"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending}
              className="px-4 py-2 bg-cyan-500 text-white rounded-lg hover:bg-cyan-600 transition-colors disabled:opacity-50"
            >
              {updateMutation.isPending ? 'Saving...' : 'Save Attributes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default DatasetDetail;

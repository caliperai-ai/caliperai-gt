import React, { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/authStore';

interface GCSBucket {
  name: string;
  location: string | null;
  storage_class: string | null;
  created: string | null;
}

interface GCSObject {
  name: string;
  path: string;
  is_folder: boolean;
  size: number;
  updated: string | null;
  content_type: string | null;
}

interface GCSScene {
  scene_id: string;
  path: string;
  bucket: string;
  prefix: string;
  frame_count: number;
  sensors: string[];
  has_calibration: boolean;
  has_annotations: boolean;
  has_metadata: boolean;
  metadata: Record<string, unknown>;
}

interface GCSBrowserProps {
  datasetId: string;
  onImportComplete: (result: { success: boolean; message: string; scene_id?: string }) => void;
  onClose: () => void;
}

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
type BrowserMode = 'connect' | 'buckets' | 'browse' | 'scenes';

export const GCSBrowser: React.FC<GCSBrowserProps> = ({ datasetId, onImportComplete, onClose }) => {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('disconnected');
  const [connectionMessage, setConnectionMessage] = useState<string>('');
  const [credentialsJson, setCredentialsJson] = useState<string>('');
  const [projectId, setProjectId] = useState<string>('');

  const [mode, setMode] = useState<BrowserMode>('connect');
  const [buckets, setBuckets] = useState<GCSBucket[]>([]);
  const [selectedBucket, setSelectedBucket] = useState<string>('');
  const [currentPrefix, setCurrentPrefix] = useState<string>('');
  const [objects, setObjects] = useState<GCSObject[]>([]);
  const [scenes, setScenes] = useState<GCSScene[]>([]);
  const [selectedObject, setSelectedObject] = useState<GCSObject | null>(null);

  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<string>('');
  const [deriveTaxonomy, setDeriveTaxonomy] = useState(true);
  const [overwriteAnnotations, setOverwriteAnnotations] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAuthHeaders = (): HeadersInit => {
    const token = useAuthStore.getState().accessToken;
    return {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    };
  };

  // Check initial connection status
  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    try {
      const response = await fetch('/api/v1/gcs/status', {
        headers: getAuthHeaders(),
      });
      if (response.ok) {
        const data = await response.json();
        if (data.user_has_session) {
          setConnectionStatus('connected');
          setConnectionMessage(`Connected to GCS project: ${data.project_id || 'default'}`);
          setMode('buckets');
          loadBuckets();
        }
      }
    } catch (e) {
      // Ignore - not connected
    }
  };

  const handleConnect = async () => {
    if (!credentialsJson.trim()) {
      setError('Please paste your GCS service account JSON credentials');
      return;
    }

    setConnectionStatus('connecting');
    setError(null);

    try {
      const response = await fetch('/api/v1/gcs/connect', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          credentials_json: credentialsJson,
          project_id: projectId || undefined,
        }),
      });

      const data = await response.json();

      if (data.success) {
        setConnectionStatus('connected');
        setConnectionMessage(data.message);
        setMode('buckets');
        loadBuckets();
      } else {
        setConnectionStatus('error');
        setError(data.message || 'Failed to connect to GCS');
      }
    } catch (e) {
      setConnectionStatus('error');
      setError(e instanceof Error ? e.message : 'Connection failed');
    }
  };

  const handleDisconnect = async () => {
    try {
      await fetch('/api/v1/gcs/disconnect', {
        method: 'POST',
        headers: getAuthHeaders(),
      });
    } catch (e) {
      // Ignore errors
    }
    setConnectionStatus('disconnected');
    setConnectionMessage('');
    setMode('connect');
    setBuckets([]);
    setSelectedBucket('');
    setCurrentPrefix('');
    setObjects([]);
    setScenes([]);
  };

  const loadBuckets = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/gcs/buckets', {
        headers: getAuthHeaders(),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to load buckets');
      }

      const data = await response.json();
      setBuckets(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load buckets');
    } finally {
      setIsLoading(false);
    }
  };

  const selectBucket = async (bucketName: string) => {
    setSelectedBucket(bucketName);
    setCurrentPrefix('');
    setMode('browse');
    await browseFolder(bucketName, '');
  };

  const browseFolder = async (bucket: string, prefix: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const encodedPrefix = encodeURIComponent(prefix);
      const response = await fetch(`/api/v1/gcs/buckets/${bucket}/browse?prefix=${encodedPrefix}`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const data = await response.json();
        // Check if session expired
        if (response.status === 400 && data.detail?.includes('Not connected')) {
          setConnectionStatus('disconnected');
          setMode('connect');
          throw new Error('GCS session expired. Please reconnect.');
        }
        throw new Error(data.detail || 'Failed to browse folder');
      }

      const data = await response.json();
      setObjects(data.objects);
      setCurrentPrefix(prefix);
      setSelectedObject(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to browse folder');
    } finally {
      setIsLoading(false);
    }
  };

  const navigateToFolder = (folderPath: string) => {
    browseFolder(selectedBucket, folderPath);
  };

  const navigateUp = () => {
    if (!currentPrefix) {
      setMode('buckets');
      return;
    }

    // Go up one level
    const parts = currentPrefix.replace(/\/$/, '').split('/');
    parts.pop();
    const newPrefix = parts.length > 0 ? parts.join('/') + '/' : '';
    browseFolder(selectedBucket, newPrefix);
  };

  const discoverScenes = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const encodedPrefix = encodeURIComponent(currentPrefix);
      const response = await fetch(`/api/v1/gcs/buckets/${selectedBucket}/discover-scenes?prefix=${encodedPrefix}`, {
        headers: getAuthHeaders(),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Failed to discover scenes');
      }

      const data = await response.json();
      setScenes(data.scenes);
      setMode('scenes');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to discover scenes');
    } finally {
      setIsLoading(false);
    }
  };

  const importFromPath = async (path: string) => {
    setIsImporting(true);
    setImportProgress('Downloading from GCS...');
    setError(null);

    try {
      const response = await fetch('/api/v1/gcs/import', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          bucket: selectedBucket,
          prefix: path,
          dataset_id: datasetId,
          derive_taxonomy: deriveTaxonomy,
          overwrite_annotations: overwriteAnnotations,
        }),
      });

      const data = await response.json();

      if (data.success) {
        onImportComplete({
          success: true,
          message: data.message,
          scene_id: data.scene_id,
        });
      } else {
        setError(data.message || 'Import failed');
        onImportComplete({
          success: false,
          message: data.message || 'Import failed',
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Import failed';
      setError(message);
      onImportComplete({ success: false, message });
    } finally {
      setIsImporting(false);
      setImportProgress('');
    }
  };

  const importScene = async (scene: GCSScene) => {
    setIsImporting(true);
    setImportProgress('Downloading scene from GCS...');
    setError(null);

    try {
      const response = await fetch('/api/v1/gcs/import', {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          bucket: scene.bucket,
          prefix: scene.prefix,
          dataset_id: datasetId,
          derive_taxonomy: deriveTaxonomy,
          overwrite_annotations: overwriteAnnotations,
        }),
      });

      const data = await response.json();

      if (data.success) {
        onImportComplete({
          success: true,
          message: data.message,
          scene_id: data.scene_id,
        });
      } else {
        setError(data.message || 'Import failed');
        onImportComplete({
          success: false,
          message: data.message || 'Import failed',
        });
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Import failed';
      setError(message);
      onImportComplete({ success: false, message });
    } finally {
      setIsImporting(false);
      setImportProgress('');
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderConnectView = () => (
    <div className="space-y-4">
      <div className="bg-dark-panel p-4 rounded-lg border border-gray-700">
        <h3 className="text-lg font-medium text-white mb-2 flex items-center gap-2">
          <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
          </svg>
          Connect to Google Cloud Storage
        </h3>
        <p className="text-gray-400 text-sm mb-4">
          Paste your GCS service account JSON credentials to browse and import data from your buckets.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Service Account JSON Credentials
            </label>
            <textarea
              value={credentialsJson}
              onChange={(e) => setCredentialsJson(e.target.value)}
              placeholder='{"type": "service_account", "project_id": "...", ...}'
              className="w-full h-32 px-3 py-2 bg-dark border border-gray-600 rounded-lg text-white font-mono text-sm focus:ring-2 focus:ring-primary focus:border-transparent resize-none"
            />
            <p className="text-xs text-gray-500 mt-1">
              Create a service account key in the GCS Console → IAM & Admin → Service Accounts
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Project ID (optional)
            </label>
            <input
              type="text"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="my-gcs-project"
              className="w-full px-3 py-2 bg-dark border border-gray-600 rounded-lg text-white focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          {error && (
            <div className="bg-red-500/10 border border-red-500 text-red-400 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          <button
            onClick={handleConnect}
            disabled={connectionStatus === 'connecting'}
            className="w-full py-3 bg-primary hover:bg-primary-dark text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {connectionStatus === 'connecting' ? (
              <>
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Connecting...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
                Connect to GCS
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );

  const renderBucketsView = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-medium text-white">Select a Bucket</h3>
        <button
          onClick={handleDisconnect}
          className="text-sm text-gray-400 hover:text-white flex items-center gap-1"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          Disconnect
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <svg className="animate-spin h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : (
        <div className="grid gap-2">
          {buckets.map((bucket) => (
            <button
              key={bucket.name}
              onClick={() => selectBucket(bucket.name)}
              className="w-full p-4 bg-dark border border-gray-700 rounded-lg hover:border-primary hover:bg-dark-panel transition-colors text-left"
            >
              <div className="flex items-center gap-3">
                <svg className="w-8 h-8 text-yellow-400" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M5 3a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V8l-5-5H5z" />
                </svg>
                <div>
                  <div className="text-white font-medium">{bucket.name}</div>
                  <div className="text-gray-400 text-sm">
                    {bucket.location} • {bucket.storage_class}
                  </div>
                </div>
              </div>
            </button>
          ))}

          {buckets.length === 0 && (
            <div className="text-center py-8 text-gray-400">
              No buckets found. Make sure your service account has storage.buckets.list permission.
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderBrowseView = () => (
    <div className="space-y-4">
      {/* Breadcrumb navigation */}
      <div className="flex items-center gap-2 text-sm">
        <button
          onClick={() => setMode('buckets')}
          className="text-primary hover:underline"
        >
          Buckets
        </button>
        <span className="text-gray-500">/</span>
        <button
          onClick={() => browseFolder(selectedBucket, '')}
          className="text-primary hover:underline"
        >
          {selectedBucket}
        </button>
        {currentPrefix && currentPrefix.split('/').filter(Boolean).map((part, idx, arr) => {
          const path = arr.slice(0, idx + 1).join('/') + '/';
          return (
            <React.Fragment key={path}>
              <span className="text-gray-500">/</span>
              <button
                onClick={() => browseFolder(selectedBucket, path)}
                className="text-primary hover:underline"
              >
                {part}
              </button>
            </React.Fragment>
          );
        })}
      </div>

      {/* Action bar */}
      <div className="flex items-center justify-between">
        <button
          onClick={navigateUp}
          className="flex items-center gap-1 text-gray-400 hover:text-white"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back
        </button>
        <button
          onClick={discoverScenes}
          className="flex items-center gap-2 px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          Discover Scenes
        </button>
      </div>

      {/* File/folder listing */}
      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <svg className="animate-spin h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </div>
      ) : (
        <div className="border border-gray-700 rounded-lg overflow-hidden">
          <table className="w-full">
            <thead className="bg-dark-panel">
              <tr className="text-left text-gray-400 text-sm">
                <th className="px-4 py-2"></th>
                <th className="px-4 py-2">Name</th>
                <th className="px-4 py-2">Size</th>
                <th className="px-4 py-2">Modified</th>
                <th className="px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {objects.map((obj) => (
                <tr
                  key={obj.path}
                  className={`border-t border-gray-700 hover:bg-dark-panel cursor-pointer ${
                    selectedObject?.path === obj.path ? 'bg-primary/20 border-primary' : ''
                  }`}
                  onClick={() => {
                    if (obj.is_folder) {
                      navigateToFolder(obj.path);
                    } else {
                      setSelectedObject(selectedObject?.path === obj.path ? null : obj);
                    }
                  }}
                >
                  <td className="px-2 py-3 w-8">
                    <input
                      type="radio"
                      name="selectedObject"
                      checked={selectedObject?.path === obj.path}
                      onChange={() => setSelectedObject(obj)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-4 h-4 text-primary"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {obj.is_folder ? (
                        <svg className="w-5 h-5 text-yellow-400" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                      ) : obj.name.endsWith('.zip') ? (
                        <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      )}
                      <span className="text-white">{obj.name}</span>
                      {obj.is_folder && (
                        <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-sm">
                    {obj.is_folder ? '—' : formatBytes(obj.size)}
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-sm">
                    {obj.updated ? new Date(obj.updated).toLocaleDateString() : '—'}
                  </td>
                  <td className="px-4 py-3">
                    {(obj.is_folder || obj.name.endsWith('.zip')) && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedObject(obj);
                        }}
                        className={`px-2 py-1 text-xs rounded ${
                          selectedObject?.path === obj.path
                            ? 'bg-primary text-white'
                            : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                        }`}
                      >
                        Select
                      </button>
                    )}
                  </td>
                </tr>
              ))}

              {objects.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                    No files or folders found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Import selected item */}
      {selectedObject && (
        <div className="bg-dark border border-primary rounded-lg p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white font-medium">Selected: {selectedObject.name}</p>
              <p className="text-gray-400 text-sm">{selectedObject.path}</p>
            </div>
            <button
              onClick={() => setSelectedObject(null)}
              className="text-gray-400 hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 text-gray-300">
              <input
                type="checkbox"
                checked={deriveTaxonomy}
                onChange={(e) => setDeriveTaxonomy(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              Derive taxonomy from annotations
            </label>
            <label className="flex items-center gap-2 text-gray-300">
              <input
                type="checkbox"
                checked={overwriteAnnotations}
                onChange={(e) => setOverwriteAnnotations(e.target.checked)}
                className="w-4 h-4 rounded"
              />
              Overwrite existing annotations
            </label>
          </div>

          <button
            onClick={() => importFromPath(selectedObject.path)}
            disabled={isImporting}
            className="w-full py-3 bg-green-600 hover:bg-green-700 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isImporting ? (
              <>
                <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                {importProgress || 'Importing...'}
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                Import This {selectedObject.is_folder ? 'Folder' : 'File'}
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );

  const renderScenesView = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <button
          onClick={() => setMode('browse')}
          className="flex items-center gap-1 text-gray-400 hover:text-white"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to Browser
        </button>
        <span className="text-gray-400 text-sm">
          Found {scenes.length} scene(s)
        </span>
      </div>

      {/* Import options */}
      <div className="bg-dark-panel p-4 rounded-lg border border-gray-700 space-y-3">
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={deriveTaxonomy}
            onChange={(e) => setDeriveTaxonomy(e.target.checked)}
            className="rounded border-gray-600 bg-dark text-primary focus:ring-primary"
          />
          Derive taxonomy from annotations
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer">
          <input
            type="checkbox"
            checked={overwriteAnnotations}
            onChange={(e) => setOverwriteAnnotations(e.target.checked)}
            className="rounded border-gray-600 bg-dark text-primary focus:ring-primary"
          />
          Overwrite existing annotations
        </label>
      </div>

      {/* Scene cards */}
      <div className="grid gap-3">
        {scenes.map((scene) => (
          <div
            key={scene.path}
            className="p-4 bg-dark border border-gray-700 rounded-lg hover:border-primary transition-colors"
          >
            <div className="flex items-start justify-between">
              <div className="flex-1">
                <h4 className="text-white font-medium text-lg">{scene.scene_id}</h4>
                <p className="text-gray-400 text-sm mt-1">{scene.path}</p>

                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded">
                    {scene.frame_count} frames
                  </span>
                  {scene.sensors.map((sensor) => (
                    <span key={sensor} className="px-2 py-1 bg-gray-700 text-gray-300 text-xs rounded">
                      {sensor}
                    </span>
                  ))}
                  {scene.has_calibration && (
                    <span className="px-2 py-1 bg-green-500/20 text-green-400 text-xs rounded">
                      Calibration
                    </span>
                  )}
                  {scene.has_annotations && (
                    <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded">
                      Annotations
                    </span>
                  )}
                </div>
              </div>

              <button
                onClick={() => importScene(scene)}
                disabled={isImporting}
                className="px-4 py-2 bg-primary hover:bg-primary-dark text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
              >
                {isImporting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Importing...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    Import
                  </>
                )}
              </button>
            </div>
          </div>
        ))}

        {scenes.length === 0 && (
          <div className="text-center py-8 text-gray-400">
            <p>No scenes found in this location.</p>
            <p className="text-sm mt-2">Scenes should have a structure with lidar/ or camera_* folders.</p>
          </div>
        )}
      </div>

      {isImporting && importProgress && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-dark-panel p-6 rounded-lg border border-gray-700 max-w-md w-full mx-4">
            <div className="flex items-center gap-3">
              <svg className="animate-spin h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-white">{importProgress}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
      <div className="bg-dark-panel rounded-lg border border-gray-700 max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <div className="flex items-center gap-3">
            <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 10-9.78 2.096A4.001 4.001 0 003 15z" />
            </svg>
            <h2 className="text-xl font-semibold text-white">Import from Google Cloud Storage</h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Connection status banner */}
        {connectionStatus === 'connected' && (
          <div className="px-6 py-2 bg-green-500/10 border-b border-green-500/30 flex items-center gap-2">
            <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
            <span className="text-green-400 text-sm">{connectionMessage}</span>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && mode !== 'connect' && (
            <div className="mb-4 bg-red-500/10 border border-red-500 text-red-400 px-4 py-2 rounded-lg text-sm">
              {error}
            </div>
          )}

          {mode === 'connect' && renderConnectView()}
          {mode === 'buckets' && renderBucketsView()}
          {mode === 'browse' && renderBrowseView()}
          {mode === 'scenes' && renderScenesView()}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-700 flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default GCSBrowser;

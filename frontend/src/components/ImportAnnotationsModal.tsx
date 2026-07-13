import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { sceneApi } from '@/api/client';
import { useAnnotation2DStore } from '@/store/annotation2DStore';

interface ImportAnnotationsModalProps {
  isOpen: boolean;
  sceneId: string;
  sceneName: string;
  onClose: () => void;
  taskId?: string;
  taxonomyName?: string;
}

export const ImportAnnotationsModal: React.FC<ImportAnnotationsModalProps> = ({
  isOpen,
  sceneId,
  sceneName,
  onClose,
  taskId,
  taxonomyName,
}) => {
  const [file, setFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [importMode, setImportMode] = useState<'augment' | 'replace'>('augment');
  const [syncTaxonomy, setSyncTaxonomy] = useState(true);
  const queryClient = useQueryClient();

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!file) throw new Error('No file selected');
      return sceneApi.importAnnotations(
        sceneId,
        file,
        importMode === 'replace',
        syncTaxonomy,
        taskId
      );
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['annotations'] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['taxonomies'] });
      useAnnotation2DStore.getState().triggerAnnotationReload();

      let message = `Success! Imported ${data.imported_count} annotations`;
      if (data.sensors_processed) {
        const sensors = Object.entries(data.sensors_processed)
          .map(([sensor, count]) => `${sensor}: ${count}`)
          .join(', ');
        message = `Success! Imported annotations:\n${sensors}`;
      }
      if (data.derived_classes && data.derived_classes.length > 0) {
        message += `\n\nTaxonomy updated with classes: ${data.derived_classes.join(', ')}`;
      }
      if (data.errors && data.errors.length > 0) {
        message += `\n\nWarnings: ${data.errors.slice(0, 3).join(', ')}`;
        if (data.errors.length > 3) {
          message += ` and ${data.errors.length - 3} more...`;
        }
      }

      alert(message);
      onClose();
      resetForm();
    },
    onError: (error: Error) => {
      alert(`Import failed: ${error.message}`);
    },
  });

  const resetForm = () => {
    setFile(null);
    setImportMode('augment');
    setSyncTaxonomy(true);
  };

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
      } else if (droppedFile.name.endsWith('.json')) {
        handleJsonImport(droppedFile);
      } else {
        alert('Please upload a ZIP file or a COCO JSON file');
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // Check if multiple files were selected (folder import)
    if (files.length > 1 && (files[0] as any).webkitRelativePath) {
      handleFolderImport(files);
      return;
    }

    const selectedFile = files[0];
    if (selectedFile.name.endsWith('.zip')) {
      setFile(selectedFile);
    } else if (selectedFile.name.endsWith('.json')) {
      handleJsonImport(selectedFile);
    } else {
      alert('Please upload a ZIP file or a COCO JSON file');
    }
  };

  // Handle JSON import by wrapping it in a ZIP with annotations/ folder structure
  const handleJsonImport = async (jsonFile: File) => {
    try {
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();
      const baseName = jsonFile.name.replace(/\.json$/i, '');
      zip.file(`annotations/${jsonFile.name}`, jsonFile);
      const blob = await zip.generateAsync({ type: 'blob' });
      const zipFile = new File([blob], `${baseName}.zip`, { type: 'application/zip' });
      setFile(zipFile);
    } catch (error) {
      alert('Error processing JSON file: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  // Handle folder import by creating a ZIP file
  const handleFolderImport = async (files: FileList) => {
    try {
      // Dynamically import JSZip
      const JSZip = (await import('jszip')).default;
      const zip = new JSZip();

      // Derive a name from the top-level folder
      const firstPath = (files[0] as any).webkitRelativePath as string;
      let rootFolder = '';
      if (firstPath && firstPath.includes('/')) {
        rootFolder = firstPath.split('/')[0];
      }

      if (!rootFolder) {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        rootFolder = `annotations_${timestamp}`;
      }

      // Add all files to the ZIP, preserving folder structure
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const webkitRelativePath = (file as any).webkitRelativePath || file.name;
        // Skip existing zip files and hidden files
        if (file.name.toLowerCase().endsWith('.zip')) continue;
        if (file.name.startsWith('.')) continue;
        zip.file(webkitRelativePath, file);
      }

      // Generate the ZIP blob
      const blob = await zip.generateAsync({ type: 'blob' });
      const zipFile = new File([blob], `${rootFolder}.zip`, { type: 'application/zip' });

      setFile(zipFile);
    } catch (error) {
      alert('Error creating ZIP from folder: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
  };

  const handleSubmit = () => {
    if (!file) {
      alert('Please select a file or folder');
      return;
    }
    importMutation.mutate();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/80" onClick={onClose} />

      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-lg mx-4 shadow-xl border border-gray-700 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-white mb-1">
          Import Annotations
        </h2>

        {/* Scene name */}
        <p className="text-sm text-gray-400 mb-2">
          Scene: <span className="text-white font-medium">{sceneName}</span>
        </p>

        {/* Taxonomy pill or reminder */}
        {taxonomyName ? (
          <div className="flex items-center gap-2 mb-6">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-teal-500/15 border border-teal-500/30 text-teal-300 text-xs font-medium">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-5 5a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 10V5a2 2 0 012-2z" />
              </svg>
              {taxonomyName}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-2 mb-6 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/30">
            <svg className="w-4 h-4 text-amber-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
            <p className="text-amber-300 text-xs">Please select a taxonomy in the Dataset Overview before importing.</p>
          </div>
        )}

        {/* File Upload */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-2">
            Annotations Folder
          </label>

          <div
            onDragEnter={handleDrag}
            onDragLeave={handleDrag}
            onDragOver={handleDrag}
            onDrop={handleDrop}
            className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
              dragActive
                ? 'border-cyan-500 bg-cyan-500/10'
                : 'border-gray-600 bg-gray-800 hover:border-gray-500'
            }`}
          >
            {file ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <svg className="w-8 h-8 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                  </svg>
                  <div className="text-left">
                    <p className="text-white font-medium">{file.name}</p>
                    <p className="text-xs text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
                <button
                  onClick={() => setFile(null)}
                  className="p-2 text-gray-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <>
                <svg className="w-12 h-12 mx-auto mb-3 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
                <p className="text-gray-400 mb-2">
                  Drop your annotations folder, ZIP, or COCO JSON here
                </p>
                <p className="text-sm text-gray-500 mb-3">or</p>
                <div className="flex gap-2 justify-center">
                  <label className="inline-block px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 cursor-pointer transition-colors">
                    Browse Folder
                    <input
                      type="file"
                      onChange={handleFileChange}
                      {...{ webkitdirectory: '', mozdirectory: '' } as any}
                      className="hidden"
                    />
                  </label>
                  <label className="inline-block px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-500 cursor-pointer transition-colors">
                    Upload ZIP / JSON
                    <input
                      type="file"
                      onChange={handleFileChange}
                      accept=".zip,.json"
                      className="hidden"
                    />
                  </label>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Import Mode */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-3">
            Import Mode
          </label>
          <div className="space-y-2">
            <label className="flex items-start gap-3 p-3 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-750 border border-transparent hover:border-gray-600 transition-colors">
              <input
                type="radio"
                name="importMode"
                value="augment"
                checked={importMode === 'augment'}
                onChange={() => setImportMode('augment')}
                className="mt-0.5 w-4 h-4 text-cyan-500 bg-gray-700 border-gray-600 focus:ring-cyan-500"
              />
              <div>
                <span className="text-white font-medium">Augment</span>
                <p className="text-xs text-gray-400 mt-0.5">Add new annotations alongside existing ones</p>
              </div>
            </label>
            <label className="flex items-start gap-3 p-3 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-750 border border-transparent hover:border-gray-600 transition-colors">
              <input
                type="radio"
                name="importMode"
                value="replace"
                checked={importMode === 'replace'}
                onChange={() => setImportMode('replace')}
                className="mt-0.5 w-4 h-4 text-cyan-500 bg-gray-700 border-gray-600 focus:ring-cyan-500"
              />
              <div>
                <span className="text-white font-medium">Replace</span>
                <p className="text-xs text-gray-400 mt-0.5">Delete existing annotations before importing</p>
              </div>
            </label>
          </div>
        </div>

        {/* Taxonomy Sync */}
        <div className="mb-6">
          <label className="flex items-center gap-3 p-3 bg-gray-800 rounded-lg cursor-pointer hover:bg-gray-750 transition-colors">
            <input
              type="checkbox"
              checked={syncTaxonomy}
              onChange={(e) => setSyncTaxonomy(e.target.checked)}
              className="w-4 h-4 text-cyan-500 bg-gray-700 border-gray-600 rounded focus:ring-cyan-500"
            />
            <div>
              <span className="text-white font-medium">Sync taxonomy from annotations</span>
              <p className="text-xs text-gray-400 mt-0.5">Add new class labels to the dataset taxonomy</p>
            </div>
          </label>
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-colors"
            disabled={importMutation.isPending}
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!file || importMutation.isPending}
            className="flex-1 px-4 py-2 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium"
          >
            {importMutation.isPending ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Importing...
              </span>
            ) : (
              'Import'
            )}
          </button>
        </div>

        {/* Info Box */}
        <div className="mt-6 p-4 bg-blue-500/10 border border-blue-500/30 rounded-lg">
          <div className="flex gap-3">
            <svg className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div className="text-sm text-blue-300">
              <p className="font-medium mb-2">Supported Formats:</p>
              <ul className="text-xs text-blue-200 space-y-1">
                <li>• <code className="bg-blue-900/30 px-1 rounded">lidar.json</code> → COCO 3D cuboids</li>
                <li>• <code className="bg-blue-900/30 px-1 rounded">lidar/*.txt</code> → KITTI 3D per-frame</li>
                <li>• <code className="bg-blue-900/30 px-1 rounded">*_camera.json</code> → COCO 2D bboxes</li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

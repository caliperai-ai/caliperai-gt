import React, { useState, useEffect } from 'react';
import { Link, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { campaignApi, datasetApi } from '@/api/client';
import type { Campaign, Dataset } from '@/types';
import { AdminOnly } from '@/components/auth/ProtectedRoute';
import { AppLayout } from '@/components/layout';
import { SetupWizard } from '@/components/onboarding';


interface CreateDatasetModalProps {
  isOpen: boolean;
  campaignId: string;
  campaignName: string;
  onClose: () => void;
  onSuccess: (dataset?: { id: string; name: string }) => void;
}

const CreateDatasetModal: React.FC<CreateDatasetModalProps> = ({
  isOpen,
  campaignId,
  campaignName,
  onClose,
  onSuccess
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [metadataEntries, setMetadataEntries] = useState<Array<{ key: string; value: string }>>([]);
  const [useAutoName, setUseAutoName] = useState(true);
  const [datasetCounter, setDatasetCounter] = useState(1);
  const [datasetCategory, setDatasetCategory] = useState<string>('Training');

  const generateDatasetName = () => {
    const now = new Date();
    const month = now.toLocaleString('default', { month: 'short' });
    const day = String(now.getDate()).padStart(2, '0');
    return `Dataset_${datasetCategory}_${String(datasetCounter).padStart(2, '0')}_${month}${day}`;
  };

  const autoName = generateDatasetName();
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data: Partial<Dataset> & { campaign_id: string; name: string }) => datasetApi.create(data),
    onSuccess: (createdDataset) => {
      queryClient.invalidateQueries({ queryKey: ['datasets', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      const datasetName = useAutoName ? autoName : name;
      setName('');
      setDescription('');
      setDeadline('');
      setMetadataEntries([]);
      setError(null);
      onSuccess({ id: createdDataset.id, name: datasetName });
      onClose();
    },
    onError: (err: Error & { response?: { data?: { detail?: string | Array<{msg: string}> } } }) => {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        setError(detail.map(e => e.msg).join(', '));
      } else {
        setError(detail || err.message || 'Failed to create dataset');
      }
    },
  });

  const addMetadataEntry = () => {
    setMetadataEntries([...metadataEntries, { key: '', value: '' }]);
  };

  const removeMetadataEntry = (index: number) => {
    setMetadataEntries(metadataEntries.filter((_, i) => i !== index));
  };

  const updateMetadataEntry = (index: number, field: 'key' | 'value', value: string) => {
    const updated = [...metadataEntries];
    updated[index][field] = value;
    setMetadataEntries(updated);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = useAutoName ? autoName : name;
    if (!finalName.trim()) {
      setError('Dataset name is required');
      return;
    }

    const customMetadata: Record<string, unknown> = {};
    metadataEntries.forEach(entry => {
      if (entry.key.trim()) {
        customMetadata[entry.key.trim()] = entry.value;
      }
    });

    let deadlineISO: string | undefined;
    if (deadline && deadline.trim()) {
      const deadlineDate = new Date(deadline);
      if (!isNaN(deadlineDate.getTime())) {
        deadlineISO = deadlineDate.toISOString();
      }
    }

    createMutation.mutate({
      campaign_id: campaignId,
      name: finalName.trim(),
      description: description.trim() || undefined,
      custom_metadata: customMetadata,
      deadline: deadlineISO,
      taxonomy: {
        classes: [],
        skeletons: {},
        annotation_rules: {
          min_points_polyline: 2,
          min_points_polygon: 3,
          allow_overlapping_boxes: false,
          require_track_id: true,
        },
      },
      sensor_config: {
        lidar: { type: 'velodyne_64' },
        cameras: [],
      },
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-700 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-3 pb-3 border-b border-gray-700">
          <span className="text-cyan-400">📁 Campaign</span>
          <span>→</span>
          <span className="text-white font-medium truncate max-w-[150px]" title={campaignName}>{campaignName}</span>
          <span>→</span>
          <span className="text-purple-400">📊 New Dataset</span>
        </div>

        <h2 className="text-xl font-semibold text-white mb-4">Create New Dataset</h2>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="mb-4 p-3 bg-gradient-to-r from-purple-500/10 to-pink-500/10 border border-purple-500/30 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-300">🎯 Smart Auto-Name</span>
              <button
                type="button"
                onClick={() => setUseAutoName(!useAutoName)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  useAutoName ? 'bg-purple-500' : 'bg-gray-600'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  useAutoName ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </div>
            {useAutoName && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-gray-400">Category:</label>
                  <select
                    value={datasetCategory}
                    onChange={(e) => setDatasetCategory(e.target.value)}
                    className="text-xs bg-dark border border-gray-600 rounded px-2 py-1 text-white"
                  >
                    <option value="Training">Training</option>
                    <option value="Validation">Validation</option>
                    <option value="Testing">Testing</option>
                    <option value="Production">Production</option>
                    <option value="Urban">Urban</option>
                    <option value="Highway">Highway</option>
                    <option value="Night">Night</option>
                    <option value="Rainy">Rainy</option>
                    <option value="Mixed">Mixed</option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setDatasetCounter(prev => prev + 1)}
                    className="text-xs text-gray-400 hover:text-white px-1.5 py-0.5 bg-gray-700 rounded"
                    title="Increment counter"
                  >
                    +1
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-purple-300">
                    Preview: <span className="font-mono bg-dark/50 px-2 py-0.5 rounded">{autoName}</span>
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="mb-4">
            <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">
              Dataset Name {!useAutoName && '*'}
            </label>
            <input
              type="text"
              id="name"
              value={useAutoName ? autoName : name}
              onChange={(e) => { setUseAutoName(false); setName(e.target.value); }}
              className={`w-full px-4 py-2 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary ${
                useAutoName ? 'bg-dark/50 border-gray-700' : 'bg-dark border-gray-600'
              }`}
              placeholder="e.g., Urban Driving Q4 2025"
              autoFocus
            />
          </div>

          <div className="mb-4">
            <label htmlFor="description" className="block text-sm font-medium text-gray-300 mb-2">
              Description
            </label>
            <textarea
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 bg-dark border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary resize-none"
              placeholder="Enter dataset description (optional)"
            />
          </div>

          <div className="mb-4">
            <label htmlFor="dataset-deadline" className="block text-sm font-medium text-gray-300 mb-2">
              Deadline
            </label>
            <input
              type="datetime-local"
              id="dataset-deadline"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full px-4 py-2 bg-dark border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary"
            />
            <p className="text-xs text-gray-500 mt-1">Optional target completion date for this dataset</p>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-300">
                Custom Metadata
              </label>
              <button
                type="button"
                onClick={addMetadataEntry}
                className="text-xs text-primary hover:text-primary/80 transition-colors"
              >
                + Add Field
              </button>
            </div>

            {metadataEntries.length === 0 ? (
              <p className="text-sm text-gray-500 italic">No custom metadata. Click "Add Field" to add.</p>
            ) : (
              <div className="space-y-2">
                {metadataEntries.map((entry, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      value={entry.key}
                      onChange={(e) => updateMetadataEntry(index, 'key', e.target.value)}
                      placeholder="Key"
                      className="flex-1 px-3 py-1.5 bg-dark border border-gray-600 rounded text-white placeholder-gray-500 text-sm focus:outline-none focus:border-primary"
                    />
                    <input
                      type="text"
                      value={entry.value}
                      onChange={(e) => updateMetadataEntry(index, 'value', e.target.value)}
                      placeholder="Value"
                      className="flex-1 px-3 py-1.5 bg-dark border border-gray-600 rounded text-white placeholder-gray-500 text-sm focus:outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => removeMetadataEntry(index)}
                      className="px-2 py-1 text-red-400 hover:text-red-300 transition-colors"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mb-6 p-3 bg-blue-500/10 border border-blue-500/30 rounded text-blue-300 text-sm">
            <strong>Note:</strong> You can link or create a taxonomy after the dataset is created
            in the Taxonomy tab of the dataset settings.
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
              disabled={createMutation.isPending}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Dataset'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// EDIT CAMPAIGN NAME MODAL
// =============================================================================

interface EditCampaignNameModalProps {
  isOpen: boolean;
  campaignId: string;
  currentName: string;
  onClose: () => void;
  onSuccess: () => void;
}

const EditCampaignNameModal: React.FC<EditCampaignNameModalProps> = ({
  isOpen,
  campaignId,
  currentName,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (data: { name: string }) => campaignApi.update(campaignId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      setError(null);
      setName(currentName);
      onSuccess();
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to update campaign name');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Campaign name is required');
      return;
    }
    if (name === currentName) {
      onClose();
      return;
    }
    updateMutation.mutate({ name: name.trim() });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-700">
        <h2 className="text-xl font-semibold text-white mb-4">Edit Campaign Name</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 bg-dark border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary"
              placeholder="Enter campaign name"
              autoFocus
            />
          </div>
          {error && <div className="mb-4 text-sm text-red-400">{error}</div>}
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
              disabled={updateMutation.isPending}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updateMutation.isPending ? 'Updating...' : 'Update'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// EDIT DATASET NAME MODAL
// =============================================================================

interface EditDatasetNameModalProps {
  isOpen: boolean;
  datasetId: string;
  currentName: string;
  onClose: () => void;
  onSuccess: () => void;
}

const EditDatasetNameModal: React.FC<EditDatasetNameModalProps> = ({
  isOpen,
  datasetId,
  currentName,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState(currentName);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const updateMutation = useMutation({
    mutationFn: (data: { name: string }) => datasetApi.update(datasetId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['datasets'] });
      queryClient.invalidateQueries({ queryKey: ['dataset-details', datasetId] });
      setError(null);
      setName(currentName);
      onSuccess();
      onClose();
    },
    onError: (err: Error) => {
      setError(err.message || 'Failed to update dataset name');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Dataset name is required');
      return;
    }
    if (name === currentName) {
      onClose();
      return;
    }
    updateMutation.mutate({ name: name.trim() });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-700">
        <h2 className="text-xl font-semibold text-white mb-4">Edit Dataset Name</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 bg-dark border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary"
              placeholder="Enter dataset name"
              autoFocus
            />
          </div>
          {error && <div className="mb-4 text-sm text-red-400">{error}</div>}
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
              disabled={updateMutation.isPending}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {updateMutation.isPending ? 'Updating...' : 'Update'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// DATASET CARD
// =============================================================================

const DatasetCard: React.FC<{ dataset: Dataset; onEditName?: () => void }> = ({ dataset, onEditName }) => {
  const hasEmbeddedClasses = dataset.taxonomy?.classes && dataset.taxonomy.classes.length > 0;

  const { data: linkedTaxonomies } = useQuery({
    queryKey: ['dataset-taxonomies', dataset.id],
    queryFn: () => datasetApi.getTaxonomies(dataset.id),
    enabled: !hasEmbeddedClasses,
  });

  const { data: datasetDetails } = useQuery({
    queryKey: ['dataset-details', dataset.id],
    queryFn: async () => {
      const result = await datasetApi.getDetail(dataset.id);
      return result;
    },
  });

  const displayClasses = hasEmbeddedClasses
    ? dataset.taxonomy.classes
    : linkedTaxonomies?.[0]?.classes || [];
  const classCount = displayClasses.length;

  const taxonomy = datasetDetails?.taxonomies?.[0] || linkedTaxonomies?.[0];
  const taxonomyName = taxonomy?.name || (hasEmbeddedClasses ? 'Embedded Taxonomy' : null);
  const annotationMode = taxonomy?.annotation_mode || 'fusion_3d';
  const is3D = annotationMode === 'fusion_3d';
  const modeLabel = is3D ? '3D' : '2D';

  return (
    <>
      <div className="group relative bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-xl p-6 border border-gray-700/50 hover:border-cyan-500/50 transition-all duration-300 block overflow-hidden hover:shadow-lg hover:shadow-cyan-500/10 hover:-translate-y-1">
        <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

        <div className="relative z-10">
          <div className="mb-3">
            <div className="flex items-start gap-3 mb-2">
              <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500/20 to-cyan-500/20 flex items-center justify-center flex-shrink-0">
                <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <Link
                  to={`/datasets/${dataset.id}`}
                  className="text-lg font-semibold text-white group-hover:text-cyan-100 transition-colors break-words block hover:underline"
                >
                  {dataset.name}
                </Link>
              </div>
              {onEditName && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onEditName();
                  }}
                  className="p-1.5 rounded-lg bg-gray-700/50 hover:bg-cyan-500/20 text-gray-400 hover:text-cyan-400 transition-colors flex-shrink-0"
                  title="Edit dataset name"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 ml-[52px]">
              <span className={`px-2.5 py-1 text-xs rounded-md font-semibold border whitespace-nowrap ${
                is3D
                  ? 'bg-purple-500/20 text-purple-400 border-purple-500/30'
                  : 'bg-green-500/20 text-green-400 border-green-500/30'
              }`}>
                {modeLabel}
              </span>
              <span className={`px-2.5 py-1 text-xs rounded-md font-medium whitespace-nowrap ${
                classCount > 0 ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30' : 'bg-gray-700 text-gray-400'
              }`}>
                {classCount} classes
              </span>
            </div>
          </div>

          <p className="text-gray-400 text-sm mb-3 line-clamp-2 min-h-[2.5rem]">
            {dataset.description || 'No description provided'}
          </p>

          {taxonomyName && (
            <div className="mb-3 px-3 py-2 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 rounded-lg border border-cyan-500/20">
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4 text-cyan-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                </svg>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-gray-400 font-medium">Taxonomy</div>
                  <div className="text-sm text-cyan-300 font-medium truncate">{taxonomyName}</div>
                </div>
              </div>
            </div>
          )}

          {dataset.custom_metadata && Object.keys(dataset.custom_metadata).length > 0 && (
            <div className="mb-3 p-2 bg-gray-900/50 rounded-lg border border-gray-700/50">
              <div className="text-xs text-gray-500 font-medium mb-1.5 flex items-center gap-1">
                <svg className="w-3 h-3 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A2 2 0 013 12V7a4 4 0 014-4z" />
                </svg>
                Attributes
              </div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(dataset.custom_metadata).slice(0, 3).map(([key, value]) => (
                  <span key={key} className="px-2 py-0.5 text-xs bg-gray-800 text-gray-300 rounded border border-gray-700 truncate max-w-full">
                    {key}: {String(value).slice(0, 20)}{String(value).length > 20 ? '...' : ''}
                  </span>
                ))}
                {Object.keys(dataset.custom_metadata).length > 3 && (
                  <span className="px-2 py-0.5 text-xs text-gray-500">
                    +{Object.keys(dataset.custom_metadata).length - 3} more
                  </span>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-wrap gap-2 mb-4">
            {displayClasses.slice(0, 4).map((cls) => (
              <span
                key={cls.id}
                className="px-2.5 py-1 text-xs rounded-md font-medium border truncate max-w-[120px]"
                style={{
                  backgroundColor: `${cls.color}15`,
                  color: cls.color,
                  borderColor: `${cls.color}30`
                }}
                title={cls.name}
              >
                {cls.name}
              </span>
            ))}
            {classCount > 4 && (
              <span className="px-2.5 py-1 text-xs text-gray-500 bg-gray-800/50 rounded-md">
                +{classCount - 4} more
              </span>
            )}
            {classCount === 0 && (
              <span className="text-xs text-gray-500 italic">No classes configured</span>
            )}
          </div>

          {datasetDetails?.stats && (
            <div className="grid grid-cols-2 gap-2 mb-3">
              <div className="px-2 py-1.5 bg-gray-900/50 rounded-lg border border-gray-700/50 min-w-0">
                <div className="text-xs text-gray-500 mb-0.5">Scenes</div>
                <div className="text-lg font-semibold text-purple-400 truncate">{datasetDetails.stats.scene_count || 0}</div>
              </div>
              <div className="px-2 py-1.5 bg-gray-900/50 rounded-lg border border-gray-700/50 min-w-0">
                <div className="text-xs text-gray-500 mb-0.5">Tasks</div>
                <div className="text-lg font-semibold text-amber-400 truncate">{datasetDetails.stats.total_tasks || 0}</div>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 text-sm pt-3 border-t border-gray-700/50">
            <span className="text-gray-500 flex items-center gap-1.5 min-w-0">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="truncate">{new Date(dataset.created_at).toLocaleDateString()}</span>
            </span>
            <Link
              to={`/datasets/${dataset.id}`}
              className="flex items-center gap-1 text-cyan-400 group-hover:translate-x-1 transition-transform flex-shrink-0"
            >
              <span className="text-xs whitespace-nowrap">Open</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
};

// =============================================================================
// CAMPAIGN DETAIL PAGE
// =============================================================================

export const CampaignDetail: React.FC = () => {
  const { campaignId } = useParams<{ campaignId: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isEditMetadataOpen, setIsEditMetadataOpen] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [createdDataset, setCreatedDataset] = useState<{ id: string; name: string } | null>(null);
  const [editCampaignNameOpen, setEditCampaignNameOpen] = useState(false);
  const [editDatasetNameOpen, setEditDatasetNameOpen] = useState(false);
  const [editingDatasetId, setEditingDatasetId] = useState<string | null>(null);
  const [editingDatasetName, setEditingDatasetName] = useState<string | null>(null);
  // ── NEW: controls the settings dropdown ──────────────────────────────────
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);

  useEffect(() => {
    const action = searchParams.get('action');
    if (action) {
      const newParams = new URLSearchParams(searchParams);
      newParams.delete('action');
      setSearchParams(newParams, { replace: true });
      switch (action) {
        case 'create-dataset':
          setIsCreateModalOpen(true);
          break;
      }
    }
  }, [searchParams, setSearchParams]);

  const { data: campaign, isLoading: loadingCampaign } = useQuery({
    queryKey: ['campaign', campaignId],
    queryFn: () => campaignApi.get(campaignId!),
    enabled: !!campaignId,
  });

  const { data: datasets, isLoading: loadingDatasets } = useQuery({
    queryKey: ['datasets', campaignId],
    queryFn: () => datasetApi.list(campaignId),
    enabled: !!campaignId,
  });

  const deleteCampaignMutation = useMutation({
    mutationFn: () => campaignApi.delete(campaignId!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      navigate('/');
    },
  });

  const handleDeleteCampaign = () => {
    deleteCampaignMutation.mutate();
  };

  if (loadingCampaign) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-gray-400">Loading campaign...</div>
        </div>
      </AppLayout>
    );
  }

  if (!campaign) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <div className="text-red-400 mb-4">Campaign not found</div>
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

  // ── CHANGED: breadcrumb no longer has the inline edit button ─────────────
  const breadcrumbContent = (
    <nav className="flex items-center gap-2 text-sm">
      <Link to="/" className="text-gray-400 hover:text-white transition-colors">Home</Link>
      <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      <span className="text-white font-medium">{campaign.name}</span>
    </nav>
  );

  return (
    <AppLayout headerContent={breadcrumbContent}>
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Campaign Info */}
        <div className="bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-xl p-6 mb-8 border border-gray-700/50">
          <div className="flex items-start justify-between mb-6">
            <div className="flex-1">
              <p className="text-gray-400 mb-6 text-base leading-relaxed">{campaign.description || 'No description provided'}</p>

              {campaign.custom_metadata && Object.keys(campaign.custom_metadata).length > 0 ? (
                <div className="mb-6 p-4 bg-gradient-to-br from-gray-800/80 to-gray-900/80 rounded-xl border border-gray-600/50">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                      <svg className="w-4 h-4 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                      </svg>
                      Custom Metadata
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
                    {Object.entries(campaign.custom_metadata).map(([key, value]) => (
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
                  <div className="mb-6 p-4 bg-gradient-to-br from-gray-800/50 to-gray-900/50 rounded-xl border border-dashed border-gray-600/50">
                    <button
                      onClick={() => setIsEditMetadataOpen(true)}
                      className="w-full flex items-center justify-center gap-2 py-2 text-sm text-gray-400 hover:text-cyan-400 transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      Add Custom Metadata
                    </button>
                  </div>
                </AdminOnly>
              )}

              <div className="grid grid-cols-4 gap-4">
                {[
                  { label: 'Datasets', value: datasets?.length || 0, color: 'text-blue-400', icon: '📊' },
                  { label: 'Scenes', value: campaign.stats.total_scenes, color: 'text-purple-400', icon: '🎬' },
                  { label: 'Tasks', value: campaign.stats.total_tasks, color: 'text-amber-400', icon: '📋' },
                  { label: 'Completed', value: campaign.stats.completed_tasks, color: 'text-emerald-400', icon: '✅' },
                ].map((stat) => (
                  <div key={stat.label} className="bg-gray-900/50 rounded-xl p-4 border border-gray-700/50 text-center">
                    <div className="text-2xl mb-1">{stat.icon}</div>
                    <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
                    <div className="text-xs text-gray-500 uppercase tracking-wider">{stat.label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* ── CHANGED: settings gear now opens a dropdown with Rename + Delete ── */}
            <div className="flex items-center gap-3 ml-6">
              <div className="text-sm text-gray-500">
                Created {new Date(campaign.created_at).toLocaleDateString()}
              </div>
              <AdminOnly>
                <div className="relative">
                  <button
                    onClick={() => setShowSettingsMenu(!showSettingsMenu)}
                    className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors"
                    title="Campaign Settings"
                  >
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                  </button>

                  {showSettingsMenu && (
                    <>
                      {/* invisible backdrop to close on outside click */}
                      <div className="fixed inset-0 z-40" onClick={() => setShowSettingsMenu(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-gray-800 border border-gray-700 rounded-lg shadow-xl overflow-hidden">
                        <button
                          onClick={() => {
                            setShowSettingsMenu(false);
                            setEditCampaignNameOpen(true);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-gray-700 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          Rename Campaign
                        </button>
                        <div className="border-t border-gray-700" />
                        <button
                          onClick={() => {
                            setShowSettingsMenu(false);
                            setShowDeleteConfirm(true);
                          }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                          Delete Campaign
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </AdminOnly>
            </div>
          </div>

          {campaign.stats.total_tasks > 0 && (
            <div className="mt-6 pt-6 border-t border-gray-700/50">
              <div className="flex justify-between text-sm mb-2">
                <span className="text-gray-400 font-medium">Overall Progress</span>
                <span className="text-cyan-400 font-bold">
                  {Math.round((campaign.stats.completed_tasks / campaign.stats.total_tasks) * 100)}%
                </span>
              </div>
              <div className="w-full bg-gray-800 rounded-full h-3 overflow-hidden shadow-inner">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-purple-500 transition-all duration-500 relative"
                  style={{
                    width: `${(campaign.stats.completed_tasks / campaign.stats.total_tasks) * 100}%`
                  }}
                >
                  <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/20" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Delete Confirmation Modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-black/70" onClick={() => setShowDeleteConfirm(false)} />
            <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-700">
              <h2 className="text-xl font-semibold text-white mb-4">Delete Campaign</h2>
              <p className="text-gray-400 mb-6">
                Are you sure you want to delete <span className="text-white font-medium">"{campaign.name}"</span>?
                This action cannot be undone and will remove all associated datasets, scenes, and tasks.
              </p>
              <AdminOnly>
                <div className="mb-4 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg">
                  <p className="text-sm text-rose-300">
                    ⚠️ This action requires admin privileges and cannot be undone.
                  </p>
                </div>
              </AdminOnly>
              <div className="flex justify-end gap-3">
                <button
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
                >
                  Cancel
                </button>
                <AdminOnly>
                  <button
                    onClick={handleDeleteCampaign}
                    disabled={deleteCampaignMutation.isPending}
                    className="px-4 py-2 bg-rose-500 text-white rounded-lg hover:bg-rose-600 transition-colors disabled:opacity-50"
                  >
                    {deleteCampaignMutation.isPending ? 'Deleting...' : 'Delete Campaign'}
                  </button>
                </AdminOnly>
              </div>
            </div>
          </div>
        )}

        {/* Datasets Section */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-bold text-white flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-cyan-500/20 to-blue-500/20 flex items-center justify-center">
                <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
              </div>
              Datasets
            </h2>
            <AdminOnly>
              <button
                onClick={() => setIsCreateModalOpen(true)}
                className="group px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-xl hover:from-cyan-400 hover:to-blue-400 transition-all duration-300 shadow-lg shadow-cyan-500/25 hover:shadow-cyan-500/40 font-medium flex items-center gap-2"
              >
                <svg className="w-4 h-4 group-hover:rotate-90 transition-transform duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                New Dataset
              </button>
            </AdminOnly>
          </div>

          {loadingDatasets ? (
            <div className="text-gray-400">Loading datasets...</div>
          ) : (
            <div className="grid grid-cols-3 gap-6">
              {datasets?.map((dataset) => (
                <DatasetCard
                  key={dataset.id}
                  dataset={dataset}
                  onEditName={() => {
                    setEditingDatasetId(dataset.id);
                    setEditingDatasetName(dataset.name);
                    setEditDatasetNameOpen(true);
                  }}
                />
              ))}

              {(!datasets || datasets.length === 0) && (
                <div className="col-span-3 text-center py-16 bg-gradient-to-br from-gray-800/30 to-gray-900/30 rounded-xl border border-dashed border-gray-700">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-gray-700/50 to-gray-800/50 flex items-center justify-center">
                    <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-300 mb-2">No datasets yet</h3>
                  <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">Create a dataset to start organizing your annotation data and importing scenes.</p>
                  <AdminOnly>
                    <button
                      onClick={() => setIsCreateModalOpen(true)}
                      className="px-6 py-2.5 bg-gradient-to-r from-cyan-500 to-blue-500 text-white rounded-xl hover:from-cyan-400 hover:to-blue-400 transition-all duration-300 shadow-lg shadow-cyan-500/25 font-medium"
                    >
                      Create Your First Dataset
                    </button>
                  </AdminOnly>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Create Dataset Modal */}
      {campaignId && (
        <CreateDatasetModal
          isOpen={isCreateModalOpen}
          campaignId={campaignId}
          campaignName={campaign.name}
          onClose={() => setIsCreateModalOpen(false)}
          onSuccess={(dataset) => {
            if (dataset) {
              setCreatedDataset(dataset);
              setShowSetupWizard(true);
            }
          }}
        />
      )}

      {/* Post-Creation Setup Wizard */}
      {createdDataset && campaignId && (
        <SetupWizard
          type="dataset_created"
          isOpen={showSetupWizard}
          onClose={() => {
            setShowSetupWizard(false);
            setCreatedDataset(null);
          }}
          resourceId={createdDataset.id}
          resourceName={createdDataset.name}
          parentId={campaignId}
          parentName={campaign.name}
        />
      )}

      {/* Edit Metadata Modal */}
      <EditCampaignMetadataModal
        isOpen={isEditMetadataOpen}
        campaign={campaign}
        onClose={() => setIsEditMetadataOpen(false)}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: ['campaign', campaignId] });
          setIsEditMetadataOpen(false);
        }}
      />

      {/* Edit Campaign Name Modal */}
      {campaignId && (
        <EditCampaignNameModal
          isOpen={editCampaignNameOpen}
          campaignId={campaignId}
          currentName={campaign.name}
          onClose={() => setEditCampaignNameOpen(false)}
          onSuccess={() => setEditCampaignNameOpen(false)}
        />
      )}

      {/* Edit Dataset Name Modal */}
      {editingDatasetId && editingDatasetName && (
        <EditDatasetNameModal
          isOpen={editDatasetNameOpen}
          datasetId={editingDatasetId}
          currentName={editingDatasetName}
          onClose={() => {
            setEditDatasetNameOpen(false);
            setEditingDatasetId(null);
            setEditingDatasetName(null);
          }}
          onSuccess={() => {
            setEditDatasetNameOpen(false);
            setEditingDatasetId(null);
            setEditingDatasetName(null);
          }}
        />
      )}
    </AppLayout>
  );
};

// =============================================================================
// EDIT CAMPAIGN METADATA MODAL
// =============================================================================

interface EditCampaignMetadataModalProps {
  isOpen: boolean;
  campaign: Campaign;
  onClose: () => void;
  onSuccess: () => void;
}

const EditCampaignMetadataModal: React.FC<EditCampaignMetadataModalProps> = ({
  isOpen,
  campaign,
  onClose,
  onSuccess,
}) => {
  const [metadataEntries, setMetadataEntries] = useState<Array<{ key: string; value: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  React.useEffect(() => {
    if (isOpen && campaign.custom_metadata) {
      const entries = Object.entries(campaign.custom_metadata).map(([key, value]) => ({
        key,
        value: String(value),
      }));
      setMetadataEntries(entries.length > 0 ? entries : [{ key: '', value: '' }]);
    }
  }, [isOpen, campaign]);

  const updateMutation = useMutation({
    mutationFn: (metadata: Record<string, unknown>) =>
      campaignApi.update(campaign.id, { custom_metadata: metadata }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['campaign', campaign.id] });
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
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
        <h2 className="text-xl font-semibold text-white mb-4">Edit Custom Metadata</h2>
        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
              {error}
            </div>
          )}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-300">
                Metadata Fields
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
              <p className="text-sm text-gray-500 italic py-4 text-center">No metadata fields. Click "Add Field" to add.</p>
            ) : (
              <div className="space-y-2">
                {metadataEntries.map((entry, index) => (
                  <div key={index} className="flex gap-2">
                    <input
                      type="text"
                      value={entry.key}
                      onChange={(e) => updateEntry(index, 'key', e.target.value)}
                      placeholder="Key (e.g., location)"
                      className="flex-1 px-3 py-2 bg-dark border border-gray-600 rounded-lg text-white placeholder-gray-500 text-sm focus:outline-none focus:border-cyan-500"
                    />
                    <input
                      type="text"
                      value={entry.value}
                      onChange={(e) => updateEntry(index, 'value', e.target.value)}
                      placeholder="Value (e.g., San Francisco)"
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
              {updateMutation.isPending ? 'Saving...' : 'Save Metadata'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CampaignDetail;
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BRAND } from '@/config/branding';
import { campaignApi, taskApi, organizationApi } from '@/api/client';
import type { Campaign, Task } from '@/types';
import { AdminOnly } from '@/components/auth/ProtectedRoute';
import { useAuthStore } from '@/store/authStore';
import { useCurrentOrganizationId } from '@/store/organizationStore';
import { AppLayout } from '@/components/layout';
import { SetupWizard } from '@/components/onboarding';


interface CreateCampaignModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (campaign?: { id: string; name: string }) => void;
}

const generateCampaignName = () => {
  const now = new Date();
  const quarter = Math.ceil((now.getMonth() + 1) / 3);
  const year = now.getFullYear();
  const month = now.toLocaleString('default', { month: 'short' });
  const day = String(now.getDate()).padStart(2, '0');

  return `Campaign_Q${quarter}_${year}_${month}${day}`;
};

// Helper to extract error message from various error formats
const extractErrorMessage = (error: any): string => {
  if (!error) return 'An unknown error occurred';

  // Handle Pydantic validation errors (array of {type, loc, msg, input})
  if (Array.isArray(error)) {
    return error.map((e: any) => {
      const field = e.loc?.slice(1)?.join('.') || 'field';
      return `${field}: ${e.msg}`;
    }).join(', ');
  }

  // Handle string error
  if (typeof error === 'string') return error;

  // Handle object with message property
  if (error.msg) return error.msg;
  if (error.message) return error.message;

  return 'An unknown error occurred';
};

const CreateCampaignModal: React.FC<CreateCampaignModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [deadline, setDeadline] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [metadataEntries, setMetadataEntries] = useState<Array<{ key: string; value: string }>>([]);
  const [useAutoName, setUseAutoName] = useState(true);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState<string>('');

  // Fetch user's organizations
  const { data: organizationsData } = useQuery({
    queryKey: ['my-organizations'],
    queryFn: () => organizationApi.getMyOrganizations(),
    enabled: isOpen,
  });

  // Auto-select first organization when data loads
  useEffect(() => {
    if (organizationsData && organizationsData.length > 0 && !selectedOrganizationId) {
      setSelectedOrganizationId(organizationsData[0].id);
    }
  }, [organizationsData, selectedOrganizationId]);

  // Generate auto-name when modal opens
  const autoName = generateCampaignName();

  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data: { name: string; description?: string; config?: Record<string, unknown>; custom_metadata?: Record<string, unknown>; deadline?: string; organization_id: string }) =>
      campaignApi.create(data),
    onSuccess: (createdCampaign) => {
      queryClient.invalidateQueries({ queryKey: ['campaigns'] });
      const campaignName = useAutoName ? autoName : name;
      setName('');
      setDescription('');
      setDeadline('');
      setMetadataEntries([]);
      setError(null);
      onSuccess({ id: createdCampaign.id, name: campaignName });
      onClose();
    },
    onError: (err: Error & { response?: { data?: { detail?: any } } }) => {
      const errorDetail = err.response?.data?.detail;
      setError(extractErrorMessage(errorDetail) || err.message || 'Failed to create campaign');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = useAutoName ? autoName : name;
    if (!finalName.trim()) {
      setError('Campaign name is required');
      return;
    }
    if (!selectedOrganizationId) {
      setError('Please select an organization');
      return;
    }

    // Convert metadata entries to object
    const customMetadata: Record<string, unknown> = {};
    metadataEntries.forEach(entry => {
      if (entry.key.trim()) {
        customMetadata[entry.key.trim()] = entry.value;
      }
    });

    // Validate deadline if provided
    let deadlineISO: string | undefined;
    if (deadline && deadline.trim()) {
      const deadlineDate = new Date(deadline);
      if (!isNaN(deadlineDate.getTime())) {
        deadlineISO = deadlineDate.toISOString();
      }
    }

    createMutation.mutate({
      name: finalName.trim(),
      description: description.trim() || undefined,
      config: {
        quality_thresholds: {},
        priority: 'normal',
        tags: [],
      },
      custom_metadata: customMetadata,
      deadline: deadlineISO,
      organization_id: selectedOrganizationId,
    });
  };

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-700 max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl font-semibold text-white mb-4">Create New Campaign</h2>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
              {error}
            </div>
          )}

          {/* Organization Selection */}
          <div className="mb-4">
            <label htmlFor="organization" className="block text-sm font-medium text-gray-300 mb-2">
              Organization *
            </label>
            <select
              id="organization"
              value={selectedOrganizationId}
              onChange={(e) => setSelectedOrganizationId(e.target.value)}
              className="w-full px-4 py-2 bg-dark border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary"
              required
            >
              <option value="">Select an organization</option>
              {organizationsData?.map((org: any) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </select>
          </div>

          {/* Auto-naming toggle */}
          <div className="mb-4 p-3 bg-gradient-to-r from-cyan-500/10 to-blue-500/10 border border-cyan-500/30 rounded-lg">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-300">🎯 Smart Auto-Name</span>
              <button
                type="button"
                onClick={() => setUseAutoName(!useAutoName)}
                className={`relative w-10 h-5 rounded-full transition-colors ${
                  useAutoName ? 'bg-cyan-500' : 'bg-gray-600'
                }`}
              >
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
                  useAutoName ? 'translate-x-5' : 'translate-x-0'
                }`} />
              </button>
            </div>
            {useAutoName && (
              <div className="text-xs text-cyan-300">
                Preview: <span className="font-mono bg-dark/50 px-2 py-0.5 rounded">{autoName}</span>
              </div>
            )}
          </div>

          <div className="mb-4">
            <label htmlFor="name" className="block text-sm font-medium text-gray-300 mb-2">
              Campaign Name {!useAutoName && '*'}
            </label>
            <input
              type="text"
              id="name"
              value={useAutoName ? autoName : name}
              onChange={(e) => { setUseAutoName(false); setName(e.target.value); }}
              className={`w-full px-4 py-2 border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary ${
                useAutoName ? 'bg-dark/50 border-gray-700' : 'bg-dark border-gray-600'
              }`}
              placeholder="Enter campaign name or use auto-generated"
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
              placeholder="Enter campaign description (optional)"
            />
          </div>

          {/* Deadline */}
          <div className="mb-4">
            <label htmlFor="deadline" className="block text-sm font-medium text-gray-300 mb-2">
              Deadline
            </label>
            <input
              type="datetime-local"
              id="deadline"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full px-4 py-2 bg-dark border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary"
            />
            <p className="text-xs text-gray-500 mt-1">Optional target completion date for this campaign</p>
          </div>

          {/* Metadata Section */}
          <div className="mb-6">
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
              {createMutation.isPending ? 'Creating...' : 'Create Campaign'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// CREATE ORGANIZATION MODAL
// =============================================================================

// Convert a free-form name into a URL-safe slug that matches the backend pattern
// (^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$). Single-char names get a 'o' suffix
// so the resulting slug stays valid.
const slugify = (name: string): string => {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!base) return '';
  return base.length === 1 ? `${base}o` : base;
};

interface CreateOrganizationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  /** When true the user has no orgs yet, so closing is hidden. */
  required?: boolean;
}

const CreateOrganizationModal: React.FC<CreateOrganizationModalProps> = ({ isOpen, onClose, onSuccess, required }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const createMutation = useMutation({
    mutationFn: (data: { name: string; slug: string; description?: string }) =>
      organizationApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-organizations'] });
      setName('');
      setDescription('');
      setError(null);
      onSuccess();
      onClose();
    },
    onError: (err: Error & { response?: { data?: { detail?: any } } }) => {
      const detail = err.response?.data?.detail;
      setError(extractErrorMessage(detail) || err.message || 'Failed to create organization');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError('Organization name must be at least 2 characters');
      return;
    }
    const slug = slugify(trimmed);
    if (!slug) {
      setError('Name must contain at least one letter or number');
      return;
    }
    createMutation.mutate({
      name: trimmed,
      slug,
      description: description.trim() || undefined,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/70"
        onClick={required ? undefined : onClose}
      />
      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-700">
        <h2 className="text-xl font-semibold text-white mb-1">
          {required ? 'Create your organization' : 'Create New Organization'}
        </h2>
        {required && (
          <p className="text-sm text-gray-400 mb-4">
            You need an organization before you can create campaigns. Set one up to get started.
          </p>
        )}

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="org-name" className="block text-sm font-medium text-gray-300 mb-2">
              Organization Name *
            </label>
            <input
              type="text"
              id="org-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2 bg-dark border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary"
              placeholder={`e.g. ${BRAND.company}`}
              autoFocus
              required
              minLength={2}
              maxLength={255}
            />
            {name.trim() && (
              <p className="text-xs text-gray-500 mt-1">
                URL slug: <span className="font-mono text-gray-400">{slugify(name) || '—'}</span>
              </p>
            )}
          </div>

          <div className="mb-6">
            <label htmlFor="org-description" className="block text-sm font-medium text-gray-300 mb-2">
              Description
            </label>
            <textarea
              id="org-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-4 py-2 bg-dark border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary resize-none"
              placeholder="Optional description"
            />
          </div>

          <div className="flex justify-end gap-3">
            {!required && (
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Organization'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

const TaskStatusBadge: React.FC<{ status: string }> = ({ status }) => {
  const colors: Record<string, { bg: string; text: string; dot: string }> = {
    draft: { bg: 'bg-gray-500/20', text: 'text-gray-300', dot: 'bg-gray-400' },
    assigned: { bg: 'bg-blue-500/20', text: 'text-blue-300', dot: 'bg-blue-400' },
    in_progress: { bg: 'bg-amber-500/20', text: 'text-amber-300', dot: 'bg-amber-400' },
    submitted: { bg: 'bg-purple-500/20', text: 'text-purple-300', dot: 'bg-purple-400' },
    accepted: { bg: 'bg-emerald-500/20', text: 'text-emerald-300', dot: 'bg-emerald-400' },
    rejected: { bg: 'bg-rose-500/20', text: 'text-rose-300', dot: 'bg-rose-400' },
  };

  const style = colors[status] || colors.draft;

  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${style.bg} ${style.text}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${style.dot} animate-pulse`} />
      {status.replace('_', ' ').charAt(0).toUpperCase() + status.replace('_', ' ').slice(1)}
    </span>
  );
};

const CampaignCard: React.FC<{ campaign: Campaign }> = ({ campaign }) => {
  const progressPercent = campaign.stats.total_tasks > 0
    ? Math.round((campaign.stats.completed_tasks / campaign.stats.total_tasks) * 100)
    : 0;

  // Color based on progress
  const progressColor = progressPercent === 100 ? 'from-emerald-500 to-teal-400'
    : progressPercent >= 50 ? 'from-blue-500 to-cyan-400'
    : 'from-amber-500 to-orange-400';

  return (
    <Link
      to={`/campaigns/${campaign.id}`}
      className="group relative overflow-hidden bg-gray-800/40 backdrop-blur-sm rounded-2xl p-6 hover:bg-gray-800/60 transition-all duration-300 block border border-gray-700/50 hover:border-cyan-500/50 hover:shadow-xl hover:shadow-cyan-500/10 hover:-translate-y-1"
    >
      {/* Subtle gradient overlay on hover */}
      <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-purple-500/5 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />

      <div className="relative z-10">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 flex items-center justify-center group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 shadow-lg">
              <svg className="w-6 h-6 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-semibold text-white group-hover:text-cyan-300 transition-colors">{campaign.name}</h3>
              <span className="text-xs text-gray-500">{campaign.stats.total_datasets} datasets</span>
            </div>
          </div>

          {/* Progress circle */}
          <div className="relative w-12 h-12">
            <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="currentColor" strokeWidth="2" className="text-gray-700" />
              <circle
                cx="18" cy="18" r="15.5" fill="none"
                strokeWidth="2"
                strokeDasharray={`${progressPercent} 100`}
                strokeLinecap="round"
                className={`text-cyan-400 transition-all duration-500`}
              />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-xs font-bold text-white">
              {progressPercent}%
            </span>
          </div>
        </div>

        <p className="text-gray-400 text-sm mb-5 line-clamp-2 min-h-[40px]">{campaign.description || 'No description provided'}</p>

        {/* Stats grid with better styling */}
        <div className="grid grid-cols-4 gap-2 text-center mb-4">
          <div className="bg-gray-900/50 rounded-lg py-2">
            <span className="text-white font-bold text-lg">{campaign.stats.total_scenes}</span>
            <span className="text-gray-500 text-[10px] block">Scenes</span>
          </div>
          <div className="bg-gray-900/50 rounded-lg py-2">
            <span className="text-white font-bold text-lg">{campaign.stats.total_tasks}</span>
            <span className="text-gray-500 text-[10px] block">Tasks</span>
          </div>
          <div className="bg-gray-900/50 rounded-lg py-2">
            <span className="text-emerald-400 font-bold text-lg">{campaign.stats.completed_tasks}</span>
            <span className="text-gray-500 text-[10px] block">Done</span>
          </div>
          <div className="bg-gray-900/50 rounded-lg py-2">
            <span className="text-amber-400 font-bold text-lg">{campaign.stats.total_tasks - campaign.stats.completed_tasks}</span>
            <span className="text-gray-500 text-[10px] block">Pending</span>
          </div>
        </div>

        {/* Progress bar with gradient */}
        <div className="relative">
          <div className="w-full bg-gray-700/30 rounded-full h-1.5 overflow-hidden">
            <div
              className={`bg-gradient-to-r ${progressColor} h-1.5 rounded-full transition-all duration-700`}
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>

        {/* Open indicator */}
        <div className="mt-4 flex items-center justify-end text-gray-500 text-xs group-hover:text-cyan-400 transition-colors">
          <span className="mr-1">Open</span>
          <svg className="w-4 h-4 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
};

const TaskRow: React.FC<{ task: Task }> = ({ task }) => {
  // Get priority color
  const priorityColor = task.priority >= 8 ? 'text-rose-400 bg-rose-500/10'
    : task.priority >= 5 ? 'text-amber-400 bg-amber-500/10'
    : 'text-gray-400 bg-gray-500/10';

  return (
    <Link
      to={`/tasks/${task.id}`}
      className="group relative overflow-hidden flex items-center justify-between p-4 bg-gray-800/30 rounded-xl hover:bg-gray-800/50 transition-all duration-300 border border-gray-700/30 hover:border-cyan-500/30 hover:shadow-lg hover:shadow-cyan-500/5"
    >
      {/* Hover glow effect */}
      <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

      <div className="relative flex-1 flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-600/20 flex items-center justify-center group-hover:scale-105 transition-transform">
          <svg className="w-6 h-6 text-blue-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-white font-medium group-hover:text-cyan-300 transition-colors truncate">{task.name}</h4>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-gray-500 text-sm flex items-center gap-1">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4" />
              </svg>
              Frames {task.frame_range.start + 1}-{task.frame_range.end + 1}
            </span>
            <span className="text-gray-600">•</span>
            <span className="text-gray-500 text-sm">
              {task.frame_range.end - task.frame_range.start + 1} frames
            </span>
          </div>
        </div>
      </div>

      <div className="relative flex items-center gap-4">
        <TaskStatusBadge status={task.status} />

        <div className={`px-2.5 py-1.5 rounded-lg ${priorityColor} text-xs font-medium`}>
          P{task.priority}
        </div>

        <div className="w-8 h-8 rounded-lg bg-gray-800/50 flex items-center justify-center group-hover:bg-cyan-500/20 transition-colors">
          <svg className="w-4 h-4 text-gray-500 group-hover:text-cyan-400 group-hover:translate-x-0.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </div>
      </div>
    </Link>
  );
};

export const Dashboard: React.FC = () => {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isCreateOrgModalOpen, setIsCreateOrgModalOpen] = useState(false);
  const [showSetupWizard, setShowSetupWizard] = useState(false);
  const [createdCampaign, setCreatedCampaign] = useState<{ id: string; name: string } | null>(null);
  const { user } = useAuthStore();

  // Get current organization from store
  const currentOrgId = useCurrentOrganizationId();

  // Fetch the user's orgs so we can gate campaign creation behind having at least one.
  const { data: myOrgs, isLoading: loadingOrgs } = useQuery({
    queryKey: ['my-organizations'],
    queryFn: () => organizationApi.getMyOrganizations(),
  });
  const hasOrganization = (myOrgs?.length ?? 0) > 0;
  const orgGateReady = !loadingOrgs;

  const { data: campaigns, isLoading: loadingCampaigns } = useQuery({
    queryKey: ['campaigns', currentOrgId],
    queryFn: () => campaignApi.list({ organization_id: currentOrgId || undefined }),
  });

  const { data: tasks, isLoading: loadingTasks } = useQuery({
    queryKey: ['tasks', 'assigned', currentOrgId],
    queryFn: () => taskApi.list({ status: 'assigned', organizationId: currentOrgId || undefined }),
  });

  // Calculate aggregate stats
  const totalCampaigns = campaigns?.items.length ?? 0;
  const completedTasks = campaigns?.items.reduce((acc, c) => acc + c.stats.completed_tasks, 0) ?? 0;
  const totalScenes = campaigns?.items.reduce((acc, c) => acc + c.stats.total_scenes, 0) ?? 0;

  return (
    <AppLayout>
      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Welcome Section */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-white mb-2">
            Welcome back{user?.full_name ? `, ${user.full_name.split(' ')[0]}` : ''}! 👋
          </h2>
          <p className="text-gray-400">Here's an overview of your annotation workspace</p>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          {[
            {
              label: 'Campaigns',
              value: totalCampaigns,
              icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              ),
              gradient: 'from-blue-500 to-cyan-500',
              bgGradient: 'from-blue-500/10 to-cyan-500/5',
            },
            {
              label: 'Your Tasks',
              value: tasks?.length ?? 0,
              icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              ),
              gradient: 'from-amber-500 to-orange-500',
              bgGradient: 'from-amber-500/10 to-orange-500/5',
            },
            {
              label: 'Total Scenes',
              value: totalScenes,
              icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z" />
                </svg>
              ),
              gradient: 'from-purple-500 to-pink-500',
              bgGradient: 'from-purple-500/10 to-pink-500/5',
            },
            {
              label: 'Completed',
              value: completedTasks,
              icon: (
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
              gradient: 'from-emerald-500 to-teal-500',
              bgGradient: 'from-emerald-500/10 to-teal-500/5',
            },
          ].map((stat, i) => (
            <div
              key={i}
              className={`group relative overflow-hidden bg-gradient-to-br ${stat.bgGradient} backdrop-blur-sm rounded-2xl p-5 border border-gray-700/30 hover:border-gray-600/50 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg`}
            >
              {/* Glow effect on hover */}
              <div className={`absolute -top-12 -right-12 w-24 h-24 bg-gradient-to-br ${stat.gradient} rounded-full blur-2xl opacity-20 group-hover:opacity-40 transition-opacity`} />

              <div className="relative">
                <div className={`inline-flex p-3 rounded-xl bg-gradient-to-br ${stat.gradient} mb-4 shadow-lg`}>
                  <span className="text-white">{stat.icon}</span>
                </div>
                <div className="text-4xl font-bold text-white mb-1">{stat.value}</div>
                <div className="text-gray-400 text-sm">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Campaigns Section */}
        <section className="mb-10">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-white">Campaigns</h2>
              <p className="text-gray-500 text-sm mt-1">Manage your annotation projects</p>
            </div>
            <AdminOnly>
              {orgGateReady && !hasOrganization ? (
                <button
                  onClick={() => setIsCreateOrgModalOpen(true)}
                  className="px-5 py-2.5 bg-gradient-to-r from-primary to-blue-600 text-white rounded-xl hover:shadow-lg hover:shadow-primary/25 transition-all duration-200 font-medium text-sm flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Create Organization
                </button>
              ) : (
                <button
                  onClick={() => setIsCreateModalOpen(true)}
                  disabled={!hasOrganization}
                  title={!hasOrganization ? 'Create an organization first' : undefined}
                  className="px-5 py-2.5 bg-gradient-to-r from-primary to-blue-600 text-white rounded-xl hover:shadow-lg hover:shadow-primary/25 transition-all duration-200 font-medium text-sm flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:shadow-none"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  New Campaign
                </button>
              )}
            </AdminOnly>
          </div>

          {loadingCampaigns ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-400">Loading campaigns...</p>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {campaigns?.items.map((campaign) => (
                <CampaignCard key={campaign.id} campaign={campaign} />
              ))}

              {(!campaigns?.items || campaigns.items.length === 0) && (
                <div className="col-span-full text-center py-16 bg-gray-800/30 rounded-2xl border border-dashed border-gray-700">
                  {orgGateReady && !hasOrganization ? (
                    <>
                      <svg className="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                      </svg>
                      <p className="text-gray-400 mb-2 text-lg">Set up your organization first</p>
                      <p className="text-gray-500 text-sm mb-4">Campaigns live inside an organization. Create one to get started.</p>
                      <AdminOnly>
                        <button
                          onClick={() => setIsCreateOrgModalOpen(true)}
                          className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm"
                        >
                          Create Organization
                        </button>
                      </AdminOnly>
                    </>
                  ) : (
                    <>
                      <svg className="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                      </svg>
                      <p className="text-gray-400 mb-2 text-lg">No campaigns yet</p>
                      <p className="text-gray-500 text-sm mb-4">Create your first campaign to start organizing annotation work</p>
                      <AdminOnly>
                        <button
                          onClick={() => setIsCreateModalOpen(true)}
                          className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary/90 transition-colors text-sm"
                        >
                          Create Campaign
                        </button>
                      </AdminOnly>
                    </>
                  )}
                </div>
              )}
            </div>
          )}
        </section>

        {/* Assigned Tasks Section */}
        <section>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-semibold text-white">Your Assigned Tasks</h2>
              <p className="text-gray-500 text-sm mt-1">Tasks waiting for your attention</p>
            </div>
          </div>

          {loadingTasks ? (
            <div className="flex items-center justify-center py-16">
              <div className="flex flex-col items-center gap-4">
                <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                <p className="text-gray-400">Loading tasks...</p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {tasks?.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}

              {(!tasks || tasks.length === 0) && (
                <div className="text-center py-16 bg-gray-800/30 rounded-2xl border border-dashed border-gray-700">
                  <svg className="w-16 h-16 mx-auto mb-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  <p className="text-gray-400 mb-2 text-lg">No tasks assigned to you</p>
                  <p className="text-gray-500 text-sm">Check back later or contact your project manager</p>
                </div>
              )}
            </div>
          )}
        </section>
      </div>

      {/* Create Organization Modal — required on first launch before any campaign can be made */}
      <CreateOrganizationModal
        isOpen={isCreateOrgModalOpen}
        onClose={() => setIsCreateOrgModalOpen(false)}
        onSuccess={() => {
          // Org now exists; nothing else to do — the campaign CTAs will swap automatically
          // once the my-organizations query refetches.
        }}
        required={!hasOrganization}
      />

      {/* Create Campaign Modal */}
      <CreateCampaignModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onSuccess={(campaign) => {
          if (campaign) {
            setCreatedCampaign(campaign);
            setShowSetupWizard(true);
          }
        }}
      />

      {/* Post-Creation Setup Wizard */}
      {createdCampaign && (
        <SetupWizard
          type="campaign_created"
          isOpen={showSetupWizard}
          onClose={() => {
            setShowSetupWizard(false);
            setCreatedCampaign(null);
          }}
          resourceId={createdCampaign.id}
          resourceName={createdCampaign.name}
        />
      )}
    </AppLayout>
  );
};

export default Dashboard;

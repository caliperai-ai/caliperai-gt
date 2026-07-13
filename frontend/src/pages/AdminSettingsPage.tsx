import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import api from '@/api/client';
import { AppLayout } from '@/components/layout';
import { useCurrentOrganizationId } from '@/store/organizationStore';

interface User {
  id: string;
  email: string;
  username: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
}

interface CreateUserData {
  email: string;
  username: string;
  password: string;
  full_name?: string;
  role: string;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  member_count?: number;
  my_role?: string;
}

interface OrganizationMember {
  id: string;
  user_id: string;
  organization_id: string;
  role: 'owner' | 'admin' | 'member';
  is_default: boolean;
  joined_at: string;
  created_at: string;
  updated_at: string;
  user?: User;
}

interface CreateOrganizationData {
  name: string;
  slug?: string;
  description?: string;
}

interface AddMemberData {
  user_id: string;
  role: 'owner' | 'admin' | 'member';
}

const usersApi = {
  list: async (organizationId?: string): Promise<User[]> => {
    const params = new URLSearchParams();
    if (organizationId) params.append('organization_id', organizationId);
    const { data } = await api.get(`/users?${params}`);
    return data;
  },
  create: async (userData: CreateUserData, organizationId?: string): Promise<User> => {
    const params = organizationId ? `?organization_id=${organizationId}` : '';
    const { data } = await api.post(`/users${params}`, userData);
    return data;
  },
  update: async ({ id, ...userData }: { id: string } & Partial<CreateUserData>): Promise<User> => {
    const { data } = await api.patch(`/users/${id}`, userData);
    return data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/users/${id}`);
  },
};

// Organization API calls
const organizationsApi = {
  list: async (): Promise<Organization[]> => {
    const { data } = await api.get('/organizations/my');
    // The response contains organizations array with membership info
    return data.organizations?.map((item: any) => ({
      id: item.id,
      name: item.name,
      slug: item.slug,
      description: item.description,
      settings: item.settings,
      created_at: item.created_at,
      updated_at: item.updated_at,
      my_role: item.membership?.role,
    })) || [];
  },
  listAll: async (): Promise<Organization[]> => {
    // Admin can list all organizations
    const { data } = await api.get('/organizations');
    return data.organizations || [];
  },
  create: async (orgData: CreateOrganizationData): Promise<Organization> => {
    const { data } = await api.post('/organizations', orgData);
    return data;
  },
  update: async ({ id, ...orgData }: { id: string } & Partial<CreateOrganizationData>): Promise<Organization> => {
    const { data } = await api.patch(`/organizations/${id}`, orgData);
    return data;
  },
  delete: async (id: string): Promise<void> => {
    await api.delete(`/organizations/${id}`);
  },
  getMembers: async (orgId: string): Promise<OrganizationMember[]> => {
    const { data } = await api.get(`/organizations/${orgId}/members`);
    return data.members || [];
  },
  addMember: async ({ orgId, ...memberData }: { orgId: string } & AddMemberData): Promise<OrganizationMember> => {
    const { data } = await api.post(`/organizations/${orgId}/members`, memberData);
    return data;
  },
  updateMember: async ({ orgId, userId, role }: { orgId: string; userId: string; role: string }): Promise<OrganizationMember> => {
    const { data } = await api.patch(`/organizations/${orgId}/members/${userId}`, { role });
    return data;
  },
  removeMember: async ({ orgId, userId }: { orgId: string; userId: string }): Promise<void> => {
    await api.delete(`/organizations/${orgId}/members/${userId}`);
  },
};

// Role badge component
function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    admin: 'bg-red-500/20 text-red-400 border-red-500/50',
    project_manager: 'bg-blue-500/20 text-blue-400 border-blue-500/50',
    annotator: 'bg-green-500/20 text-green-400 border-green-500/50',
    qa_reviewer: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/50',
    customer_qa: 'bg-purple-500/20 text-purple-400 border-purple-500/50',
  };

  const labels: Record<string, string> = {
    admin: 'Admin',
    project_manager: 'Project Manager',
    annotator: 'Annotator',
    qa_reviewer: 'QA Reviewer',
    customer_qa: 'Customer QA',
  };

  return (
    <span className={`px-2 py-1 text-xs rounded border ${colors[role] || 'bg-gray-500/20 text-gray-400'}`}>
      {labels[role] || role}
    </span>
  );
}

// Create User Modal
function CreateUserModal({ isOpen, onClose, onSuccess, organizationId }: { isOpen: boolean; onClose: () => void; onSuccess: () => void; organizationId?: string }) {
  const [formData, setFormData] = useState({
    email: '',
    username: '',
    password: '',
    full_name: '',
    role: 'annotator',
  });
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: (userData: CreateUserData) => usersApi.create(userData, organizationId),
    onSuccess: () => {
      onSuccess();
      onClose();
      setFormData({ email: '', username: '', password: '', full_name: '', role: 'annotator' });
      setError(null);
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail;
      if (typeof detail === 'string') {
        setError(detail);
      } else if (Array.isArray(detail)) {
        // Pydantic validation errors are arrays of {loc, msg, type, ctx}
        const messages = detail.map((e: any) => {
          // Extract field name from loc array (e.g., ["body", "username"] -> "Username")
          const fieldName = Array.isArray(e.loc) && e.loc.length > 1
            ? e.loc[e.loc.length - 1].charAt(0).toUpperCase() + e.loc[e.loc.length - 1].slice(1).replace(/_/g, ' ')
            : 'Field';
          // Extract min_length from ctx if available
          const minLength = e.ctx?.min_length;
          if (minLength) {
            return `${fieldName} must be at least ${minLength} characters`;
          }
          return `${fieldName}: ${e.msg || e.message}`;
        });
        setError(messages.join('. '));
      } else if (detail && typeof detail === 'object') {
        setError(detail.msg || detail.message || JSON.stringify(detail));
      } else {
        setError(err.message || 'Failed to create user');
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.email || !formData.username || !formData.password) {
      setError('Email, username, and password are required');
      return;
    }

    createMutation.mutate({
      email: formData.email,
      username: formData.username,
      password: formData.password,
      full_name: formData.full_name || undefined,
      role: formData.role,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-700">
        <h2 className="text-xl font-semibold text-white mb-4">Create New User</h2>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Email *</label>
              <input
                type="email"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="user@example.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Username *</label>
              <input
                type="text"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="johndoe"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Password *</label>
              <input
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="••••••••"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Full Name</label>
              <input
                type="text"
                value={formData.full_name}
                onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="John Doe"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Role</label>
              <select
                value={formData.role}
                onChange={(e) => setFormData({ ...formData, role: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="annotator">Annotator</option>
                <option value="qa_reviewer">QA Reviewer</option>
                <option value="project_manager">Project Manager</option>
                <option value="customer_qa">Customer QA</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
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
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Organization role badge component
function OrgRoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    owner: 'bg-purple-500/20 text-purple-400 border-purple-500/50',
    admin: 'bg-red-500/20 text-red-400 border-red-500/50',
    member: 'bg-green-500/20 text-green-400 border-green-500/50',
  };

  return (
    <span className={`px-2 py-1 text-xs rounded border ${colors[role] || 'bg-gray-500/20 text-gray-400'}`}>
      {role.charAt(0).toUpperCase() + role.slice(1)}
    </span>
  );
}

// Create Organization Modal
function CreateOrganizationModal({
  isOpen,
  onClose,
  onSuccess
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    description: '',
  });
  const [error, setError] = useState<string | null>(null);

  const createMutation = useMutation({
    mutationFn: organizationsApi.create,
    onSuccess: () => {
      onSuccess();
      onClose();
      setFormData({ name: '', slug: '', description: '' });
      setError(null);
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail;
      // Handle Pydantic validation errors (array of error objects)
      if (Array.isArray(detail)) {
        const messages = detail.map((e: any) => e.msg || e.message || JSON.stringify(e)).join(', ');
        setError(messages);
      } else if (typeof detail === 'string') {
        setError(detail);
      } else if (detail && typeof detail === 'object') {
        setError(detail.msg || detail.message || JSON.stringify(detail));
      } else {
        setError(err.message || 'Failed to create organization');
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData.name) {
      setError('Organization name is required');
      return;
    }

    // Generate slug from name if not provided
    const slug = formData.slug.trim() || formData.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    // Validate slug format (must be at least 1 char, alphanumeric with hyphens)
    if (!slug || slug.length < 1) {
      setError('Slug is required');
      return;
    }

    createMutation.mutate({
      name: formData.name,
      slug: slug,
      description: formData.description || undefined,
    });
  };

  // Auto-generate slug from name
  const handleNameChange = (name: string) => {
    setFormData({
      ...formData,
      name,
      slug: formData.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-700">
        <h2 className="text-xl font-semibold text-white mb-4">Create New Organization</h2>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Organization Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) => handleNameChange(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Acme Corporation"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Slug</label>
              <input
                type="text"
                value={formData.slug}
                onChange={(e) => setFormData({ ...formData, slug: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="acme-corp"
              />
              <p className="text-xs text-gray-400 mt-1">URL-friendly identifier. Auto-generated from name if left empty.</p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Description</label>
              <textarea
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Optional description..."
                rows={3}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
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
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {createMutation.isPending ? 'Creating...' : 'Create Organization'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Add Member Modal
function AddMemberModal({
  isOpen,
  onClose,
  onSuccess,
  organizationId,
  existingMemberIds
}: {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  organizationId: string;
  existingMemberIds: string[];
}) {
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedRole, setSelectedRole] = useState<'owner' | 'admin' | 'member'>('member');
  const [error, setError] = useState<string | null>(null);

  // Scope the picker to the currently-selected organization (the active tenant),
  // NOT the global user list. Fetching all users leaked every other tenant's
  // users into the dropdown. Falls back to the organization being edited when no
  // org is selected in the sidebar, so we never fetch the unfiltered user list.
  const currentOrgId = useCurrentOrganizationId();
  const scopeOrgId = currentOrgId ?? organizationId;
  const { data: allUsers } = useQuery({
    queryKey: ['users', 'org-picker', scopeOrgId],
    queryFn: () => usersApi.list(scopeOrgId || undefined),
    enabled: !!scopeOrgId,
  });

  const availableUsers = allUsers?.filter(u => !existingMemberIds.includes(u.id)) || [];

  const addMutation = useMutation({
    mutationFn: organizationsApi.addMember,
    onSuccess: () => {
      onSuccess();
      onClose();
      setSelectedUserId('');
      setSelectedRole('member');
      setError(null);
    },
    onError: (err: any) => {
      const detail = err.response?.data?.detail;
      if (Array.isArray(detail)) {
        const messages = detail.map((e: any) => e.msg || e.message || JSON.stringify(e)).join(', ');
        setError(messages);
      } else if (typeof detail === 'string') {
        setError(detail);
      } else if (detail && typeof detail === 'object') {
        setError(detail.msg || detail.message || JSON.stringify(detail));
      } else {
        setError(err.message || 'Failed to add member');
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!selectedUserId) {
      setError('Please select a user');
      return;
    }

    addMutation.mutate({
      orgId: organizationId,
      user_id: selectedUserId,
      role: selectedRole,
    });
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-700">
        <h2 className="text-xl font-semibold text-white mb-4">Add Member</h2>

        <form onSubmit={handleSubmit}>
          {error && (
            <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">User *</label>
              <select
                value={selectedUserId}
                onChange={(e) => setSelectedUserId(e.target.value)}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select a user...</option>
                {availableUsers.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.full_name || u.username} ({u.email})
                  </option>
                ))}
              </select>
              {availableUsers.length === 0 && (
                <p className="text-xs text-yellow-400 mt-1">All users are already members of this organization.</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Role</label>
              <select
                value={selectedRole}
                onChange={(e) => setSelectedRole(e.target.value as 'owner' | 'admin' | 'member')}
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={addMutation.isPending || availableUsers.length === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {addMutation.isPending ? 'Adding...' : 'Add Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Organization Members Panel
function OrganizationMembersPanel({
  organization,
  onBack
}: {
  organization: Organization;
  onBack: () => void;
}) {
  const queryClient = useQueryClient();
  const [showAddMemberModal, setShowAddMemberModal] = useState(false);

  const { data: members, isLoading } = useQuery({
    queryKey: ['organization-members', organization.id],
    queryFn: () => organizationsApi.getMembers(organization.id),
  });

  const updateRoleMutation = useMutation({
    mutationFn: organizationsApi.updateMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-members', organization.id] });
    },
  });

  const removeMemberMutation = useMutation({
    mutationFn: organizationsApi.removeMember,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organization-members', organization.id] });
    },
  });

  const existingMemberIds = members?.map(m => m.user_id) || [];

  return (
    <div>
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div>
          <h2 className="text-lg font-semibold text-white">{organization.name}</h2>
          <p className="text-sm text-gray-400">Manage organization members</p>
        </div>
        <button
          onClick={() => setShowAddMemberModal(true)}
          className="ml-auto flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          Add Member
        </button>
      </div>

      {isLoading ? (
        <div className="text-gray-400 text-center py-8">Loading members...</div>
      ) : (
        <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-700/50">
              <tr>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">User</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Role</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Joined</th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members?.map((member) => (
                <tr key={member.user_id} className="border-b border-gray-700 hover:bg-gray-800/50">
                  <td className="px-4 py-3">
                    <div>
                      <div className="font-medium text-white">
                        {member.user?.full_name || member.user?.username || member.user_id}
                      </div>
                      <div className="text-sm text-gray-400">{member.user?.email}</div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <select
                        value={member.role}
                        onChange={(e) => updateRoleMutation.mutate({
                          orgId: organization.id,
                          userId: member.user_id,
                          role: e.target.value,
                        })}
                        className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
                        disabled={updateRoleMutation.isPending}
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                        <option value="owner">Owner</option>
                      </select>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-400 text-sm">
                    {new Date(member.joined_at).toLocaleDateString()}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => {
                        if (confirm(`Remove ${member.user?.full_name || member.user?.username} from this organization?`)) {
                          removeMemberMutation.mutate({
                            orgId: organization.id,
                            userId: member.user_id,
                          });
                        }
                      }}
                      disabled={removeMemberMutation.isPending}
                      className="text-gray-400 hover:text-red-400 transition-colors disabled:opacity-50"
                      title="Remove member"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                      </svg>
                    </button>
                  </td>
                </tr>
              ))}
              {(!members || members.length === 0) && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-gray-400">
                    No members found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <AddMemberModal
        isOpen={showAddMemberModal}
        onClose={() => setShowAddMemberModal(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['organization-members', organization.id] })}
        organizationId={organization.id}
        existingMemberIds={existingMemberIds}
      />
    </div>
  );
}

// Organization row component
function OrganizationRow({
  organization,
  onManageMembers
}: {
  organization: Organization;
  onManageMembers: (org: Organization) => void;
}) {
  const queryClient = useQueryClient();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: organizationsApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      setShowDeleteConfirm(false);
    },
  });

  return (
    <>
      <tr className="border-b border-gray-700 hover:bg-gray-800/50">
        <td className="px-4 py-3">
          <div>
            <div className="font-medium text-white">{organization.name}</div>
            <div className="text-sm text-gray-400">/{organization.slug}</div>
          </div>
        </td>
        <td className="px-4 py-3 text-gray-300">
          {organization.description || <span className="text-gray-500 italic">No description</span>}
        </td>
        <td className="px-4 py-3">
          {organization.my_role && <OrgRoleBadge role={organization.my_role} />}
        </td>
        <td className="px-4 py-3 text-gray-400 text-sm">
          {new Date(organization.created_at).toLocaleDateString()}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => onManageMembers(organization)}
              className="text-blue-400 hover:text-blue-300 transition-colors text-sm"
            >
              Manage Members
            </button>
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-gray-400 hover:text-red-400 transition-colors"
              title="Delete organization"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        </td>
      </tr>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <tr>
          <td colSpan={5} className="p-0">
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/70" onClick={() => setShowDeleteConfirm(false)} />
              <div className="relative bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-700">
                <h3 className="text-lg font-semibold text-white mb-2">Delete Organization</h3>
                <p className="text-gray-300 mb-4">
                  Are you sure you want to delete <strong>{organization.name}</strong>?
                  This will remove all member associations. This action cannot be undone.
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate(organization.id)}
                    disabled={deleteMutation.isPending}
                    className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {deleteMutation.isPending ? 'Deleting...' : 'Delete Organization'}
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// User row component
function UserRow({ user, currentUserId }: { user: User; currentUserId?: string }) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [editRole, setEditRole] = useState(user.role);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; role?: string; is_active?: boolean }) => usersApi.update(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setIsEditing(false);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: usersApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowDeleteConfirm(false);
    },
  });

  const toggleActive = () => {
    updateMutation.mutate({ id: user.id, is_active: !user.is_active });
  };

  const saveRole = () => {
    updateMutation.mutate({ id: user.id, role: editRole });
  };

  const handleDelete = () => {
    deleteMutation.mutate(user.id);
  };

  // Don't allow deleting yourself
  const isCurrentUser = user.id === currentUserId;

  return (
    <>
      <tr className={`border-b border-gray-700 hover:bg-gray-800/50 ${!user.is_active ? 'opacity-60 bg-gray-900/50' : ''}`}>
        <td className="px-4 py-3">
          <div>
            <div className="font-medium text-white">
              {user.full_name || user.username}
              {isCurrentUser && <span className="ml-2 text-xs text-blue-400">(You)</span>}
              {!user.is_active && <span className="ml-2 text-xs text-red-400">(Deactivated)</span>}
            </div>
            <div className="text-sm text-gray-400">@{user.username}</div>
          </div>
        </td>
        <td className="px-4 py-3 text-gray-300">{user.email}</td>
        <td className="px-4 py-3">
          {isEditing ? (
            <div className="flex items-center gap-2">
              <select
                value={editRole}
                onChange={(e) => setEditRole(e.target.value)}
                className="px-2 py-1 bg-gray-700 border border-gray-600 rounded text-white text-sm"
              >
                <option value="annotator">Annotator</option>
                <option value="qa_reviewer">QA Reviewer</option>
                <option value="project_manager">Project Manager</option>
                <option value="customer_qa">Customer QA</option>
                <option value="admin">Admin</option>
              </select>
              <button
                onClick={saveRole}
                className="px-2 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700"
              >
                Save
              </button>
              <button
                onClick={() => setIsEditing(false)}
                className="px-2 py-1 text-gray-400 hover:text-white text-xs"
              >
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <RoleBadge role={user.role} />
              <button
                onClick={() => setIsEditing(true)}
                className="text-gray-400 hover:text-white"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
              </button>
            </div>
          )}
        </td>
        <td className="px-4 py-3">
          <button
            onClick={toggleActive}
            className={`px-2 py-1 rounded text-xs font-medium ${
              user.is_active
                ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
                : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
            }`}
          >
            {user.is_active ? 'Active' : 'Inactive'}
          </button>
        </td>
        <td className="px-4 py-3 text-gray-400 text-sm">
          {new Date(user.created_at).toLocaleDateString()}
        </td>
        <td className="px-4 py-3">
          {!isCurrentUser && (
            <button
              onClick={() => setShowDeleteConfirm(true)}
              className="text-gray-400 hover:text-red-400 transition-colors"
              title="Delete user"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </td>
      </tr>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <tr>
          <td colSpan={6} className="p-0">
            <div className="fixed inset-0 z-50 flex items-center justify-center">
              <div className="absolute inset-0 bg-black/70" onClick={() => setShowDeleteConfirm(false)} />
              <div className="relative bg-gray-800 rounded-lg p-6 w-full max-w-md mx-4 shadow-xl border border-gray-700">
                <h3 className="text-lg font-semibold text-white mb-2">Delete User</h3>
                <p className="text-gray-300 mb-4">
                  Are you sure you want to delete <strong>{user.full_name || user.username}</strong>?
                  This action cannot be undone.
                </p>
                <div className="flex justify-end gap-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 text-gray-300 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={deleteMutation.isPending}
                    className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors disabled:opacity-50"
                  >
                    {deleteMutation.isPending ? 'Deleting...' : 'Delete User'}
                  </button>
                </div>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// Main Admin Settings Page
export function AdminSettingsPage() {
  const { user, isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'users' | 'organizations' | 'system'>('users');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showCreateOrgModal, setShowCreateOrgModal] = useState(false);
  const [selectedOrganization, setSelectedOrganization] = useState<Organization | null>(null);

  // Get current organization for filtering
  const currentOrgId = useCurrentOrganizationId();

  const { data: users, isLoading, error } = useQuery({
    queryKey: ['users', currentOrgId],
    queryFn: () => usersApi.list(currentOrgId || undefined),
  });

  const { data: organizations, isLoading: orgsLoading, error: orgsError } = useQuery({
    queryKey: ['organizations'],
    queryFn: organizationsApi.list,
  });

  // Check if user has admin access (isAdmin checks role === 'admin' || is_superuser)
  const hasAdminAccess = isAdmin();

  if (!hasAdminAccess) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
            <p className="text-gray-400 mb-4">You don't have permission to access admin settings.</p>
            {user && (
              <div className="mb-4 p-4 bg-gray-800 rounded-lg text-left max-w-md mx-auto">
                <p className="text-sm text-gray-400 mb-2">Signed in as:</p>
                <p className="text-white font-medium">{user.full_name || user.username}</p>
                <p className="text-gray-400 text-sm">{user.email}</p>
                <p className="text-gray-400 text-sm mt-2">
                  Role: {user.role} | Superuser: {String(user.is_superuser ?? false)}
                </p>
                <p className="text-yellow-400 text-xs mt-2">
                  If you believe this is an error, try logging out and back in.
                </p>
              </div>
            )}
            <div className="flex gap-4 justify-center mt-4">
              <Link to="/" className="text-blue-400 hover:text-blue-300">
                Go to Dashboard
              </Link>
              <button
                onClick={() => {
                  localStorage.clear();
                  window.location.href = '/login';
                }}
                className="text-red-400 hover:text-red-300"
              >
                Clear Session & Login
              </button>
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  // Header content with page title
  const headerContent = (
    <nav className="flex items-center gap-2 text-sm">
      <Link to="/" className="text-gray-400 hover:text-white transition-colors">Home</Link>
      <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      <span className="text-white font-medium">Admin Settings</span>
    </nav>
  );

  return (
    <AppLayout headerContent={headerContent}>
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div data-tour="admin-tabs" className="flex gap-4 mb-6 border-b border-gray-700">
          <button
            data-tour="user-management-tab"
            onClick={() => setActiveTab('users')}
            className={`pb-3 px-2 font-medium transition-colors ${
              activeTab === 'users'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            User Management
          </button>
          <button
            data-tour="org-management-tab"
            onClick={() => { setActiveTab('organizations'); setSelectedOrganization(null); }}
            className={`pb-3 px-2 font-medium transition-colors ${
              activeTab === 'organizations'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            Organizations
          </button>
          <button
            onClick={() => setActiveTab('system')}
            className={`pb-3 px-2 font-medium transition-colors ${
              activeTab === 'system'
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-gray-400 hover:text-white'
            }`}
          >
            System Settings
          </button>
        </div>

        {/* Users Tab */}
        {activeTab === 'users' && (
          <div data-tour="user-management">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-white">Users</h2>
              <button
                data-tour="add-user"
                onClick={() => setShowCreateModal(true)}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add User
              </button>
            </div>

            {isLoading ? (
              <div className="text-gray-400 text-center py-8">Loading users...</div>
            ) : error ? (
              <div className="text-red-400 text-center py-8">
                Failed to load users: {(error as Error).message}
              </div>
            ) : (
              <div data-tour="user-list" className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-700/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">User</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Email</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Role</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Status</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Created</th>
                      <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users?.map((u) => (
                      <UserRow
                        key={u.id}
                        user={u}
                        currentUserId={user?.id}
                      />
                    ))}
                    {(!users || users.length === 0) && (
                      <tr>
                        <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                          No users found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Organizations Tab */}
        {activeTab === 'organizations' && (
          <div>
            {selectedOrganization ? (
              <OrganizationMembersPanel
                organization={selectedOrganization}
                onBack={() => setSelectedOrganization(null)}
              />
            ) : (
              <>
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-semibold text-white">Organizations</h2>
                  <button
                    onClick={() => setShowCreateOrgModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Create Organization
                  </button>
                </div>

                {orgsLoading ? (
                  <div className="text-gray-400 text-center py-8">Loading organizations...</div>
                ) : orgsError ? (
                  <div className="text-red-400 text-center py-8">
                    Failed to load organizations: {(orgsError as Error).message}
                  </div>
                ) : (
                  <div className="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden">
                    <table className="w-full">
                      <thead className="bg-gray-700/50">
                        <tr>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Organization</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Description</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Your Role</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Created</th>
                          <th className="px-4 py-3 text-left text-sm font-medium text-gray-300">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {organizations?.map((org) => (
                          <OrganizationRow
                            key={org.id}
                            organization={org}
                            onManageMembers={setSelectedOrganization}
                          />
                        ))}
                        {(!organizations || organizations.length === 0) && (
                          <tr>
                            <td colSpan={5} className="px-4 py-8 text-center text-gray-400">
                              No organizations found. Create one to get started.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* System Tab */}
        {activeTab === 'system' && (
          <div className="space-y-6">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Platform Information</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-gray-400">Platform Version</div>
                  <div className="text-white">1.0.0</div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">API Status</div>
                  <div className="text-green-400">Online</div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Database</div>
                  <div className="text-white">PostgreSQL</div>
                </div>
                <div>
                  <div className="text-sm text-gray-400">Cache</div>
                  <div className="text-white">Redis</div>
                </div>
              </div>
            </div>

            <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
              <h3 className="text-lg font-semibold text-white mb-4">Configuration</h3>
              <p className="text-gray-400">
                System configuration settings will be available in a future update.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Create User Modal */}
      <CreateUserModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['users'] })}
        organizationId={currentOrgId || undefined}
      />

      {/* Create Organization Modal */}
      <CreateOrganizationModal
        isOpen={showCreateOrgModal}
        onClose={() => setShowCreateOrgModal(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['organizations'] })}
      />
    </AppLayout>
  );
}

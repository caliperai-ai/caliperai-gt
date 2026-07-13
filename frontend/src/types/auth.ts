

export type UserRole =
  | 'admin'
  | 'project_manager'
  | 'annotator'
  | 'qa_reviewer'
  | 'customer_qa';

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrator',
  project_manager: 'Project Manager',
  annotator: 'Annotator',
  qa_reviewer: 'QA Reviewer',
  customer_qa: 'Customer QA',
};

export const USER_ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  admin: 'Full system access, user management, and configuration',
  project_manager: 'Campaign and project management, task assignment',
  annotator: 'Create and edit annotations on assigned tasks',
  qa_reviewer: 'Review and approve/reject annotations',
  customer_qa: 'Final review and acceptance of completed work',
};


export type Permission =
  | 'users:read'
  | 'users:read_all'
  | 'users:create'
  | 'users:update'
  | 'users:delete'
  | 'users:assign_role'
  | 'campaigns:read'
  | 'campaigns:read_all'
  | 'campaigns:create'
  | 'campaigns:update'
  | 'campaigns:delete'
  | 'datasets:read'
  | 'datasets:read_all'
  | 'datasets:create'
  | 'datasets:update'
  | 'datasets:delete'
  | 'datasets:import'
  | 'scenes:read'
  | 'scenes:read_all'
  | 'scenes:create'
  | 'scenes:update'
  | 'scenes:delete'
  | 'taxonomies:read'
  | 'taxonomies:create'
  | 'taxonomies:update'
  | 'taxonomies:delete'
  | 'tasks:read'
  | 'tasks:read_all'
  | 'tasks:read_assigned'
  | 'tasks:create'
  | 'tasks:update'
  | 'tasks:delete'
  | 'tasks:assign'
  | 'tasks:start'
  | 'tasks:submit'
  | 'annotations:read'
  | 'annotations:create'
  | 'annotations:update'
  | 'annotations:delete'
  | 'qa:review'
  | 'qa:accept'
  | 'qa:reject'
  | 'qa:issues_create'
  | 'qa:issues_read'
  | 'customer_qa:review'
  | 'customer_qa:accept'
  | 'customer_qa:reject'
  | 'dashboard:view_global'
  | 'dashboard:view_team'
  | 'dashboard:view_own'
  | 'reports:export'
  | 'organizations:create'
  | 'organizations:read'
  | 'organizations:update'
  | 'organizations:delete'
  | 'organizations:manage_members'
  | 'system:config'
  | 'system:audit_logs';

export const PERMISSION_GROUPS = {
  USER_MANAGEMENT: ['users:read', 'users:create', 'users:update', 'users:delete'] as Permission[],
  CAMPAIGN_MANAGEMENT: ['campaigns:read', 'campaigns:create', 'campaigns:update', 'campaigns:delete'] as Permission[],
  DATASET_MANAGEMENT: ['datasets:read', 'datasets:create', 'datasets:update', 'datasets:delete', 'datasets:import'] as Permission[],
  ANNOTATION_WORK: ['annotations:read', 'annotations:create', 'annotations:update', 'annotations:delete'] as Permission[],
  QA_WORK: ['qa:review', 'qa:issues_create', 'qa:issues_read'] as Permission[],
};


export interface AuthUser {
  id: string;
  email: string;
  username: string;
  full_name?: string;
  role: UserRole;
  permissions: Permission[];
  is_active: boolean;
  is_superuser?: boolean;
  must_change_password?: boolean;
  created_at?: string;
  updated_at?: string;
}


export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  refresh_token?: string | null;
  token_type: string;
  expires_in: number;
  user: AuthUser;
}

export interface TokenRefreshResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface ChangePasswordRequest {
  current_password: string;
  new_password: string;
}


export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  admin: [
    'users:read', 'users:read_all', 'users:create', 'users:update', 'users:delete', 'users:assign_role',
    'campaigns:read', 'campaigns:read_all', 'campaigns:create', 'campaigns:update', 'campaigns:delete',
    'datasets:read', 'datasets:read_all', 'datasets:create', 'datasets:update', 'datasets:delete', 'datasets:import',
    'scenes:read', 'scenes:read_all', 'scenes:create', 'scenes:update', 'scenes:delete',
    'taxonomies:read', 'taxonomies:create', 'taxonomies:update', 'taxonomies:delete',
    'tasks:read', 'tasks:read_all', 'tasks:read_assigned', 'tasks:create', 'tasks:update', 'tasks:delete', 'tasks:assign', 'tasks:start', 'tasks:submit',
    'annotations:read', 'annotations:create', 'annotations:update', 'annotations:delete',
    'qa:review', 'qa:accept', 'qa:reject', 'qa:issues_create', 'qa:issues_read',
    'customer_qa:review', 'customer_qa:accept', 'customer_qa:reject',
    'dashboard:view_global', 'dashboard:view_team', 'dashboard:view_own', 'reports:export',
    'organizations:create', 'organizations:read', 'organizations:update', 'organizations:delete', 'organizations:manage_members',
    'system:config', 'system:audit_logs',
  ],
  project_manager: [
    'users:read', 'users:read_all', 'users:create', 'users:update', 'users:delete', 'users:assign_role',
    'campaigns:read', 'campaigns:read_all', 'campaigns:create', 'campaigns:update', 'campaigns:delete',
    'datasets:read', 'datasets:read_all', 'datasets:create', 'datasets:update', 'datasets:delete', 'datasets:import',
    'scenes:read', 'scenes:read_all', 'scenes:create', 'scenes:update', 'scenes:delete',
    'taxonomies:read', 'taxonomies:create', 'taxonomies:update', 'taxonomies:delete',
    'tasks:read', 'tasks:read_all', 'tasks:read_assigned', 'tasks:create', 'tasks:update', 'tasks:delete', 'tasks:assign', 'tasks:start', 'tasks:submit',
    'annotations:read', 'annotations:create', 'annotations:update', 'annotations:delete',
    'qa:review', 'qa:accept', 'qa:reject', 'qa:issues_create', 'qa:issues_read',
    'customer_qa:review', 'customer_qa:accept', 'customer_qa:reject',
    'dashboard:view_global', 'dashboard:view_team', 'dashboard:view_own', 'reports:export',
    'organizations:read', 'organizations:update', 'organizations:manage_members',
    'system:audit_logs',
  ],
  annotator: [
    'campaigns:read',
    'datasets:read',
    'scenes:read',
    'taxonomies:read',
    'tasks:read_assigned', 'tasks:start', 'tasks:submit',
    'annotations:read', 'annotations:create', 'annotations:update', 'annotations:delete',
    'dashboard:view_own',
  ],
  qa_reviewer: [
    'campaigns:read',
    'datasets:read',
    'scenes:read',
    'taxonomies:read',
    'tasks:read', 'tasks:read_assigned',
    'annotations:read', 'annotations:update',
    'qa:review', 'qa:accept', 'qa:reject', 'qa:issues_create', 'qa:issues_read',
    'dashboard:view_team', 'dashboard:view_own',
  ],
  customer_qa: [
    'campaigns:read',
    'datasets:read',
    'scenes:read',
    'taxonomies:read',
    'tasks:read', 'tasks:read_assigned',
    'annotations:read',
    'customer_qa:review', 'customer_qa:accept', 'customer_qa:reject',
    'qa:issues_read',
    'dashboard:view_own',
  ],
};

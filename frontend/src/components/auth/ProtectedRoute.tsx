import { Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { useOrganizationStore } from '@/store/organizationStore';
import { organizationApi } from '@/api/client';
import type { Permission, UserRole } from '@/types/auth';
import { ReactNode, useEffect, useState } from 'react';
import { checkAuth } from '@/api/auth';

interface ProtectedRouteProps {
  children: ReactNode;
  permissions?: Permission | Permission[];
  roles?: UserRole | UserRole[];
  loginPath?: string;
  unauthorizedPath?: string;
  fallback?: ReactNode;
}

let permissionsRefreshedThisSession = false;

export function ProtectedRoute({
  children,
  permissions,
  roles,
  loginPath = '/login',
  unauthorizedPath = '/unauthorized',
  fallback = <LoadingSpinner />,
}: ProtectedRouteProps) {
  const location = useLocation();
  const { isAuthenticated, hasPermission, hasAnyPermission, hasRole } = useAuthStore();
  const { setOrganizations, setLoading: setOrgLoading, organizations } = useOrganizationStore();
  const [isChecking, setIsChecking] = useState(!isAuthenticated);
  const [isValid, setIsValid] = useState(isAuthenticated);

  useEffect(() => {
    const verify = async () => {
      if (isAuthenticated) {
        setIsValid(true);
        setIsChecking(false);
        if (!permissionsRefreshedThisSession) {
          permissionsRefreshedThisSession = true;
          checkAuth();
        }
      } else {
        const valid = await checkAuth();
        setIsValid(valid);
        setIsChecking(false);
      }
    };
    verify();
  }, [isAuthenticated]);

  useEffect(() => {
    const loadOrganizations = async () => {
      if (isValid && organizations.length === 0) {
        setOrgLoading(true);
        try {
          const orgs = await organizationApi.getMyOrganizations();
          setOrganizations(orgs);
        } catch (err) {
          console.error('Failed to load organizations:', err);
        } finally {
          setOrgLoading(false);
        }
      }
    };
    loadOrganizations();
  }, [isValid, organizations.length, setOrganizations, setOrgLoading]);

  if (isChecking) {
    return <>{fallback}</>;
  }

  if (!isValid) {
    return <Navigate to={loginPath} state={{ from: location }} replace />;
  }

  if (permissions) {
    const hasAccess = Array.isArray(permissions)
      ? hasAnyPermission(permissions)
      : hasPermission(permissions);

    if (!hasAccess) {
      return <Navigate to={unauthorizedPath} state={{ from: location }} replace />;
    }
  }

  if (roles) {
    const { isAdmin } = useAuthStore.getState();
    const roleList = Array.isArray(roles) ? roles : [roles];

    const hasAccess = roleList.some(role => {
      if (role === 'admin') {
        return isAdmin();
      }
      return hasRole(role);
    });

    if (!hasAccess) {
      return <Navigate to={unauthorizedPath} state={{ from: location }} replace />;
    }
  }

  return <>{children}</>;
}


function LoadingSpinner() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-900">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400">Loading...</p>
      </div>
    </div>
  );
}


interface CanProps {
  children: ReactNode;
  permission?: Permission | Permission[];
  role?: UserRole | UserRole[];
  all?: boolean;
  fallback?: ReactNode;
}

export function Can({ children, permission, role, all = false, fallback = null }: CanProps) {
  const { hasAnyPermission, hasAllPermissions, hasAnyRole, isAuthenticated } =
    useAuthStore();

  if (!isAuthenticated) {
    return <>{fallback}</>;
  }

  if (permission) {
    const permissions = Array.isArray(permission) ? permission : [permission];
    const hasAccess = all ? hasAllPermissions(permissions) : hasAnyPermission(permissions);

    if (!hasAccess) {
      return <>{fallback}</>;
    }
  }

  if (role) {
    const roles = Array.isArray(role) ? role : [role];
    const hasAccess = hasAnyRole(roles);

    if (!hasAccess) {
      return <>{fallback}</>;
    }
  }

  return <>{children}</>;
}


interface CannotProps {
  children: ReactNode;
  permission?: Permission | Permission[];
  role?: UserRole | UserRole[];
  all?: boolean;
}

export function Cannot({ children, permission, role, all = false }: CannotProps) {
  const { hasAnyPermission, hasAllPermissions, hasAnyRole, isAuthenticated } =
    useAuthStore();

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  if (permission) {
    const permissions = Array.isArray(permission) ? permission : [permission];
    const hasAccess = all ? hasAllPermissions(permissions) : hasAnyPermission(permissions);

    if (hasAccess) {
      return null;
    }
  }

  if (role) {
    const roles = Array.isArray(role) ? role : [role];
    const hasAccess = hasAnyRole(roles);

    if (hasAccess) {
      return null;
    }
  }

  return <>{children}</>;
}


interface RoleProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export function AdminOnly({ children, fallback = null }: RoleProps) {
  const { isAdmin, isAuthenticated } = useAuthStore();

  if (!isAuthenticated || !isAdmin()) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

export function ManagerOnly({ children, fallback = null }: RoleProps) {
  return (
    <Can role={['admin', 'project_manager']} fallback={fallback}>
      {children}
    </Can>
  );
}

export function AnnotatorAccess({ children, fallback = null }: RoleProps) {
  return (
    <Can permission="annotations:create" fallback={fallback}>
      {children}
    </Can>
  );
}

export function QAAccess({ children, fallback = null }: RoleProps) {
  return (
    <Can permission="qa:review" fallback={fallback}>
      {children}
    </Can>
  );
}

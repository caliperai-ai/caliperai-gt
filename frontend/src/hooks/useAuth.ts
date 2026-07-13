import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { checkAuth, login as loginApi, logout as logoutApi } from '@/api/auth';
import type { Permission, UserRole } from '@/types/auth';


export function useAuth() {
  const {
    user,
    isAuthenticated,
    isLoading,
    error,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    hasRole,
    hasAnyRole,
    isAdmin,
    isProjectManager,
    isAnnotator,
    isQAReviewer,
    isCustomerQA,
    canManageUsers,
    canManageCampaigns,
    canManageDatasets,
    canAnnotate,
    canReviewQA,
    canAssignTasks,
  } = useAuthStore();

  const login = useCallback(async (username: string, password: string) => {
    return loginApi(username, password);
  }, []);

  const handleLogout = useCallback(() => {
    logoutApi();
  }, []);

  return {
    user,
    isAuthenticated,
    isLoading,
    error,
    login,
    logout: handleLogout,
    hasPermission,
    hasAnyPermission,
    hasAllPermissions,
    hasRole,
    hasAnyRole,
    isAdmin,
    isProjectManager,
    isAnnotator,
    isQAReviewer,
    isCustomerQA,
    canManageUsers,
    canManageCampaigns,
    canManageDatasets,
    canAnnotate,
    canReviewQA,
    canAssignTasks,
  };
}


export function useRequireAuth(redirectTo = '/login') {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading } = useAuthStore();
  const [isChecking, setIsChecking] = useState(true);

  useEffect(() => {
    const verify = async () => {
      if (!isAuthenticated) {
        const valid = await checkAuth();
        if (!valid) {
          navigate(redirectTo);
        }
      }
      setIsChecking(false);
    };
    verify();
  }, [isAuthenticated, navigate, redirectTo]);

  return { isLoading: isLoading || isChecking };
}


export function useRequirePermission(
  permission: Permission | Permission[],
  redirectTo = '/unauthorized'
) {
  const navigate = useNavigate();
  const { isAuthenticated, hasPermission, hasAnyPermission } = useAuthStore();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    const hasAccess = Array.isArray(permission)
      ? hasAnyPermission(permission)
      : hasPermission(permission);

    if (!hasAccess) {
      navigate(redirectTo);
    } else {
      setIsAuthorized(true);
    }
  }, [isAuthenticated, permission, hasPermission, hasAnyPermission, navigate, redirectTo]);

  return { isAuthorized };
}


export function useRequireRole(role: UserRole | UserRole[], redirectTo = '/unauthorized') {
  const navigate = useNavigate();
  const { isAuthenticated, hasRole, hasAnyRole } = useAuthStore();
  const [isAuthorized, setIsAuthorized] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      navigate('/login');
      return;
    }

    const hasAccess = Array.isArray(role) ? hasAnyRole(role) : hasRole(role);

    if (!hasAccess) {
      navigate(redirectTo);
    } else {
      setIsAuthorized(true);
    }
  }, [isAuthenticated, role, hasRole, hasAnyRole, navigate, redirectTo]);

  return { isAuthorized };
}


export function usePermission(permission: Permission): boolean {
  const { hasPermission, isAuthenticated } = useAuthStore();
  return isAuthenticated && hasPermission(permission);
}


export function usePermissions(permissions: Permission[], mode: 'any' | 'all' = 'any'): boolean {
  const { hasAnyPermission, hasAllPermissions, isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return false;
  return mode === 'any' ? hasAnyPermission(permissions) : hasAllPermissions(permissions);
}


export function useRole(role: UserRole | UserRole[]): boolean {
  const { hasRole, hasAnyRole, isAuthenticated } = useAuthStore();
  if (!isAuthenticated) return false;
  return Array.isArray(role) ? hasAnyRole(role) : hasRole(role);
}

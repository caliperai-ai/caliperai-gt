import axios from 'axios';
import type {
  LoginRequest,
  LoginResponse,
  TokenRefreshResponse,
  ChangePasswordRequest,
  AuthUser,
  UserRole,
  Permission,
} from '@/types/auth';
import { useAuthStore } from '@/store/authStore';

const authApi = axios.create({
  baseURL: '/api/v1/auth',
  headers: {
    'Content-Type': 'application/json',
  },
});


export const authApiClient = {
  login: async (credentials: LoginRequest): Promise<LoginResponse> => {
    const { data } = await authApi.post<LoginResponse>('/login', credentials);
    return data;
  },

  me: async (token: string): Promise<AuthUser> => {
    const { data } = await authApi.get<AuthUser>('/me', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data;
  },

  /**
   * Refresh access token
   */
  refreshToken: async (refreshToken: string): Promise<TokenRefreshResponse> => {
    const { data } = await authApi.post<TokenRefreshResponse>('/refresh', {
      refresh_token: refreshToken,
    });
    return data;
  },

  /**
   * Change password
   */
  changePassword: async (
    token: string,
    request: ChangePasswordRequest
  ): Promise<{ message: string }> => {
    const { data } = await authApi.post<{ message: string }>('/change-password', request, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return data;
  },

  /**
   * Get available roles
   */
  getRoles: async (): Promise<{ role: UserRole; label: string; description: string }[]> => {
    const { data } = await authApi.get<{ role: UserRole; label: string; description: string }[]>('/roles');
    return data;
  },

  /**
   * Get permissions for a role
   */
  getPermissions: async (role: UserRole): Promise<Permission[]> => {
    const { data } = await authApi.get<Permission[]>(`/permissions?role=${role}`);
    return data;
  },
};

// =============================================================================
// SSO API
// =============================================================================

export interface SSOProvider {
  provider: string;
  name: string;
  login_url: string;
}

const ssoApi = axios.create({
  baseURL: '/api/v1/auth/sso',
  headers: { 'Content-Type': 'application/json' },
});

export const ssoApiClient = {
  /**
   * Fetch the list of SSO providers enabled on the server.
   */
  getProviders: async (): Promise<SSOProvider[]> => {
    const { data } = await ssoApi.get<SSOProvider[]>('/providers');
    return data;
  },

  /**
   * Build the backend URL that starts the SSO flow for a given provider.
   * The browser is redirected to this URL directly (not via fetch).
   */
  getLoginUrl: (provider: string): string => `/api/v1/auth/sso/${provider}`,
};

// =============================================================================
// AUTH HELPERS
// =============================================================================

/**
 * Login and store auth state
 */
export const login = async (username: string, password: string): Promise<AuthUser> => {
  const store = useAuthStore.getState();
  store.setLoading(true);
  store.setError(null);

  try {
    const response = await authApiClient.login({ username, password });
    store.setAuth(response.user, response.access_token, response.refresh_token || '');

    // Reset the global session timer for this user on every fresh login.
    // We remove their per-user key so GlobalActivityProvider always starts
    // from 0:00 on a new login, regardless of what was stored from a prior
    // session earlier the same day.
    try {
      const timerKey = `global_session_timer:${response.user.id}`;
      localStorage.removeItem(timerKey);
    } catch {
      // localStorage unavailable – ignore
    }

    return response.user;
  } catch (error: unknown) {
    const message = axios.isAxiosError(error)
      ? error.response?.data?.detail || 'Login failed'
      : 'Login failed';
    store.setError(message);
    throw error;
  } finally {
    store.setLoading(false);
  }
};

/**
 * Logout and clear auth state
 */
export const logout = (): void => {
  useAuthStore.getState().logout();
  // Optionally redirect to login page
  window.location.href = '/login';
};

/**
 * Refresh the access token
 */
export const refreshAccessToken = async (): Promise<string | null> => {
  const store = useAuthStore.getState();
  const refreshToken = store.refreshToken;

  if (!refreshToken) {
    store.logout();
    return null;
  }

  try {
    const response = await authApiClient.refreshToken(refreshToken);
    store.setTokens(response.access_token);
    return response.access_token;
  } catch {
    store.logout();
    return null;
  }
};

/**
 * Change current user's password
 */
export const changePassword = async (
  currentPassword: string,
  newPassword: string
): Promise<{ message: string }> => {
  const store = useAuthStore.getState();
  const token = store.accessToken;

  if (!token) {
    throw new Error('Not authenticated');
  }

  return await authApiClient.changePassword(token, {
    current_password: currentPassword,
    new_password: newPassword,
  });
};

/**
 * Check if user is authenticated and token is valid
 */
export const checkAuth = async (): Promise<boolean> => {
  const store = useAuthStore.getState();
  const token = store.accessToken;

  if (!token) {
    return false;
  }

  try {
    const user = await authApiClient.me(token);
    // Update user in case permissions changed
    store.setAuth(user, token, store.refreshToken!);
    return true;
  } catch {
    // Try to refresh token
    const newToken = await refreshAccessToken();
    return newToken !== null;
  }
};
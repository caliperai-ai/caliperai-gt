import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { efficiencyApi, LoginSessionHeartbeatResponse } from '@/api/client';
import { useCurrentOrganizationId } from '@/store/organizationStore';
import { useAuthStore } from '@/store/authStore';

const getAccessToken = () => useAuthStore.getState().accessToken;
const getUserId = () => useAuthStore.getState().user?.id ?? null;


const STORAGE_KEY_PREFIX = 'global_session_timer';

const getStorageKey = (userId?: string | null): string =>
  userId ? `${STORAGE_KEY_PREFIX}:${userId}` : STORAGE_KEY_PREFIX;

interface StoredSessionData {
  date: string; // ISO date string (YYYY-MM-DD)
  todayActiveSeconds: number;
  sessionId: string | null;
  lastUpdated: number; // timestamp
}

const getTodayDateString = (): string => {
  return new Date().toISOString().split('T')[0];
};

const loadStoredSession = (userId?: string | null): Partial<StoredSessionData> | null => {
  try {
    const key = getStorageKey(userId);
    const stored = localStorage.getItem(key);
    if (!stored) return null;

    const data: StoredSessionData = JSON.parse(stored);
    const today = getTodayDateString();

    // If data is from a different day, return null (will reset to 0)
    if (data.date !== today) {
      localStorage.removeItem(key);
      return null;
    }

    return data;
  } catch {
    return null;
  }
};

const saveStoredSession = (
  sessionId: string | null,
  todayActiveSeconds: number,
  userId?: string | null,
): void => {
  try {
    const key = getStorageKey(userId);
    // Always use max to never lose progress within the same user's session
    const existing = loadStoredSession(userId);
    const maxSeconds = Math.max(existing?.todayActiveSeconds || 0, todayActiveSeconds);

    const data: StoredSessionData = {
      date: getTodayDateString(),
      todayActiveSeconds: maxSeconds,
      sessionId,
      lastUpdated: Date.now(),
    };
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Ignore storage errors
  }
};

// =============================================================================
// Types
// =============================================================================

interface ActivityState {
  sessionId: string | null;
  isTracking: boolean;
  isWindowFocused: boolean;
  isMouseInWindow: boolean;
  isUserActive: boolean;
  activeTimeSeconds: number;
  idleTimeSeconds: number;
  totalSessionSeconds: number;
  todayActiveSeconds: number;
  sessionStartedAt: Date | null;
}

interface GlobalActivityContextType extends ActivityState {
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
}

// =============================================================================
// Context
// =============================================================================

const GlobalActivityContext = createContext<GlobalActivityContextType | null>(null);

const DEFAULT_ACTIVITY_STATE: GlobalActivityContextType = {
  sessionId: null,
  isTracking: false,
  isWindowFocused: true,
  isMouseInWindow: true,
  isUserActive: false,
  activeTimeSeconds: 0,
  idleTimeSeconds: 0,
  totalSessionSeconds: 0,
  todayActiveSeconds: 0,
  sessionStartedAt: null,
  startTracking: async () => {},
  stopTracking: async () => {},
};

export const useGlobalActivity = () => {
  const context = useContext(GlobalActivityContext);
  // Return safe defaults when context is unavailable (e.g. HMR reload, outside provider)
  return context ?? DEFAULT_ACTIVITY_STATE;
};

// =============================================================================
// Provider Component
// =============================================================================

interface GlobalActivityProviderProps {
  children: React.ReactNode;
  heartbeatIntervalMs?: number;  // Default: 30000 (30 seconds)
  idleThresholdMs?: number;      // Default: 180000 (3 minutes)
  enabled?: boolean;              // Default: true (auto-start when user is logged in)
}

export const GlobalActivityProvider: React.FC<GlobalActivityProviderProps> = ({
  children,
  heartbeatIntervalMs = 30000,
  idleThresholdMs = 180000,
  enabled = true,
}) => {
  const organizationId = useCurrentOrganizationId();

  // Load initial state from localStorage (persists across hot reloads)
  const [state, setState] = useState<ActivityState>(() => {
    // Scope session to the currently-logged-in user so a new login always
    // resets the timer to 0 (different user, or same user starting fresh).
    const userId = getUserId();
    const stored = loadStoredSession(userId);
    // Check if we have a valid token - if not, don't restore session
    const token = getAccessToken();
    const storedSessionId = stored?.sessionId || null;
    const hasValidSession = token && storedSessionId;

    return {
      sessionId: hasValidSession ? storedSessionId : null,
      isTracking: !!hasValidSession,
      isWindowFocused: true,
      isMouseInWindow: true,
      isUserActive: true,
      activeTimeSeconds: 0,
      idleTimeSeconds: 0,
      totalSessionSeconds: 0,
      // Only restore seconds for the current user; new login = 0
      todayActiveSeconds: hasValidSession ? (stored?.todayActiveSeconds || 0) : 0,
      sessionStartedAt: null,
    };
  });

  // Refs for tracking
  const lastActivityTime = useRef<number>(Date.now());
  const heartbeatInterval = useRef<number | null>(null);
  const localTickInterval = useRef<number | null>(null);
  const isStartingSession = useRef(false);
  const isEndingSession = useRef(false);
  const isUserActiveRef = useRef<boolean>(state.isUserActive);

  // Keep ref in sync with state
  useEffect(() => {
    isUserActiveRef.current = state.isUserActive;
  }, [state.isUserActive]);

  // ==========================================================================
  // Activity Detection
  // ==========================================================================

  const handleUserActivity = useCallback(() => {
    lastActivityTime.current = Date.now();
    if (!state.isUserActive) {
      setState(prev => ({ ...prev, isUserActive: true }));
    }
  }, [state.isUserActive]);

  const handleVisibilityChange = useCallback(() => {
    const isVisible = document.visibilityState === 'visible';
    setState(prev => ({ ...prev, isWindowFocused: isVisible }));
    if (isVisible) {
      handleUserActivity();
    }
  }, [handleUserActivity]);

  const handleWindowFocus = useCallback(() => {
    setState(prev => ({ ...prev, isWindowFocused: true }));
    handleUserActivity();
  }, [handleUserActivity]);

  const handleWindowBlur = useCallback(() => {
    setState(prev => ({ ...prev, isWindowFocused: false }));
  }, []);

  const handleMouseEnter = useCallback(() => {
    setState(prev => ({ ...prev, isMouseInWindow: true }));
    handleUserActivity();
  }, [handleUserActivity]);

  const handleMouseLeave = useCallback(() => {
    setState(prev => ({ ...prev, isMouseInWindow: false }));
  }, []);

  // ==========================================================================
  // Session Management
  // ==========================================================================

  const startTracking = useCallback(async () => {
    if (state.sessionId || isStartingSession.current || !enabled) return;

    // Double-check we have a token before making API calls
    const token = getAccessToken();
    if (!token) {
      return;
    }

    isStartingSession.current = true;

    try {
      const clientInfo = {
        browser: navigator.userAgent.includes('Chrome') ? 'Chrome' :
                 navigator.userAgent.includes('Firefox') ? 'Firefox' :
                 navigator.userAgent.includes('Safari') ? 'Safari' : 'Other',
        os: navigator.platform,
        screen_resolution: `${window.screen.width}x${window.screen.height}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      const response = await efficiencyApi.startLoginSession({
        organizationId: organizationId || undefined,
        clientInfo,
      });

      setState(prev => ({
        ...prev,
        sessionId: response.session_id,
        isTracking: true,
        sessionStartedAt: new Date(response.started_at),
        activeTimeSeconds: 0,
        idleTimeSeconds: 0,
        totalSessionSeconds: 0,
      }));

      // Save sessionId to localStorage for hot reload resilience
      const userId = getUserId();
      const stored = loadStoredSession(userId);
      saveStoredSession(response.session_id, stored?.todayActiveSeconds || 0, userId);

      lastActivityTime.current = Date.now();
      console.log('[GlobalActivity] Session started:', response.session_id);
    } catch (error) {
      console.error('[GlobalActivity] Failed to start session:', error);
      // Handle auth errors silently - user not logged in
      const status = (error as { response?: { status: number } })?.response?.status;
      if (status === 401 || status === 403) {
        // Clear any stored session data
        saveStoredSession(null, 0, getUserId());
      }
    } finally {
      isStartingSession.current = false;
    }
  }, [state.sessionId, enabled, organizationId]);

  const stopTracking = useCallback(async () => {
    if (!state.sessionId || isEndingSession.current) return;

    isEndingSession.current = true;

    try {
      const response = await efficiencyApi.endLoginSession(state.sessionId);
      console.log('[GlobalActivity] Session ended. Active:', response.total_active_seconds, 's');

      // Clear sessionId from localStorage but keep today's time
      saveStoredSession(null, state.todayActiveSeconds, getUserId());

      setState(prev => ({
        ...prev,
        sessionId: null,
        isTracking: false,
        activeTimeSeconds: 0,
        idleTimeSeconds: 0,
        totalSessionSeconds: 0,
        sessionStartedAt: null,
      }));
    } catch (error) {
      console.error('[GlobalActivity] Failed to end session:', error);
    } finally {
      isEndingSession.current = false;
    }
  }, [state.sessionId]);

  // ==========================================================================
  // Heartbeat
  // ==========================================================================

  const sendHeartbeat = useCallback(async () => {
    if (!state.sessionId || !state.isTracking) return;

    // Don't send heartbeat if no token (not logged in)
    const token = getAccessToken();
    if (!token) {
      saveStoredSession(null, state.todayActiveSeconds, getUserId());
      setState(prev => ({ ...prev, sessionId: null, isTracking: false }));
      return;
    }

    const now = Date.now();
    const timeSinceLastActivity = now - lastActivityTime.current;
    const isCurrentlyActive = timeSinceLastActivity < idleThresholdMs;

    // Update local active state
    if (!isCurrentlyActive && state.isUserActive) {
      setState(prev => ({ ...prev, isUserActive: false }));
    }

    try {
      const response: LoginSessionHeartbeatResponse = await efficiencyApi.loginSessionHeartbeat({
        sessionId: state.sessionId,
        isWindowFocused: state.isWindowFocused,
        isMouseInWindow: state.isMouseInWindow,
        isActive: isCurrentlyActive,
      });

      setState(prev => {
        // Only update todayActiveSeconds if server has a HIGHER value (never lose local progress)
        const newTodaySeconds = Math.max(prev.todayActiveSeconds, response.today_active_seconds);
        return {
          ...prev,
          activeTimeSeconds: response.active_duration_seconds,
          idleTimeSeconds: response.idle_duration_seconds,
          totalSessionSeconds: response.total_session_seconds,
          todayActiveSeconds: newTodaySeconds,
        };
      });

      // Persist to localStorage - saveStoredSession already uses Math.max
      saveStoredSession(state.sessionId, state.todayActiveSeconds, getUserId());
    } catch (error) {
      const status = (error as { response?: { status: number } })?.response?.status;
      // Expected failures should quietly clear the stale session instead of
      // surfacing as a noisy console error or triggering auth refresh loops.
      if (status === 401 || status === 403) {
        // Auth failed - clear everything and stop
        console.log('[GlobalActivity] Auth failed, clearing session');
        saveStoredSession(null, state.todayActiveSeconds, getUserId());
        setState(prev => ({
          ...prev,
          sessionId: null,
          isTracking: false,
        }));
        return;
      }
      // Session might be invalid, try to restart
      if (status === 404) {
        // Clear invalid sessionId from localStorage but keep today's time
        saveStoredSession(null, state.todayActiveSeconds, getUserId());
        setState(prev => ({
          ...prev,
          sessionId: null,
          isTracking: false,
        }));
        return;
      }

      console.error('[GlobalActivity] Heartbeat failed:', error);
    }
  }, [state.sessionId, state.isTracking, state.isWindowFocused, state.isMouseInWindow, state.isUserActive, state.todayActiveSeconds, idleThresholdMs]);

  // ==========================================================================
  // Effects
  // ==========================================================================

  // Set up event listeners
  useEffect(() => {
    if (!enabled) return;

    // Visibility change (tab switching)
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Window focus/blur
    window.addEventListener('focus', handleWindowFocus);
    window.addEventListener('blur', handleWindowBlur);

    // Mouse enter/leave window
    document.documentElement.addEventListener('mouseenter', handleMouseEnter);
    document.documentElement.addEventListener('mouseleave', handleMouseLeave);

    // User activity detection
    const activityEvents = ['mousedown', 'keydown', 'touchstart', 'scroll'];
    let mouseMoveTimeout: number | null = null;

    const throttledMouseMove = () => {
      if (mouseMoveTimeout) return;
      mouseMoveTimeout = window.setTimeout(() => {
        handleUserActivity();
        mouseMoveTimeout = null;
      }, 1000);
    };

    const handleEvent = (e: Event) => {
      if (e.type === 'mousemove') {
        throttledMouseMove();
      } else {
        handleUserActivity();
      }
    };

    activityEvents.forEach(event => {
      document.addEventListener(event, handleEvent, { passive: true });
    });
    document.addEventListener('mousemove', handleEvent, { passive: true });

    // Cleanup
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleWindowFocus);
      window.removeEventListener('blur', handleWindowBlur);
      document.documentElement.removeEventListener('mouseenter', handleMouseEnter);
      document.documentElement.removeEventListener('mouseleave', handleMouseLeave);

      activityEvents.forEach(event => {
        document.removeEventListener(event, handleEvent);
      });
      document.removeEventListener('mousemove', handleEvent);

      if (mouseMoveTimeout) clearTimeout(mouseMoveTimeout);
    };
  }, [enabled, handleVisibilityChange, handleWindowFocus, handleWindowBlur, handleMouseEnter, handleMouseLeave, handleUserActivity]);

  // Auto-start session when provider mounts (user is logged in)
  useEffect(() => {
    if (enabled && !state.sessionId && !isStartingSession.current) {
      startTracking();
    }
  }, [enabled, state.sessionId, startTracking]);

  // Set up heartbeat interval
  useEffect(() => {
    if (!state.isTracking || !state.sessionId) return;

    // Send initial heartbeat
    sendHeartbeat();

    // Set up interval
    heartbeatInterval.current = window.setInterval(sendHeartbeat, heartbeatIntervalMs);

    return () => {
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
        heartbeatInterval.current = null;
      }
    };
  }, [state.isTracking, state.sessionId, sendHeartbeat, heartbeatIntervalMs]);

  // Local time tracking - increment every second when active
  // This ensures time is tracked even when GlobalSessionTimer is unmounted
  useEffect(() => {
    if (!state.isTracking || !state.sessionId) return;

    const currentSessionId = state.sessionId;

    localTickInterval.current = window.setInterval(() => {
      // Only increment if user is active (use ref to avoid stale closure)
      if (isUserActiveRef.current) {
        setState(prev => {
          const newSeconds = prev.todayActiveSeconds + 1;
          // Save to localStorage immediately
          saveStoredSession(currentSessionId, newSeconds, getUserId());
          return {
            ...prev,
            todayActiveSeconds: newSeconds,
          };
        });
      }
    }, 1000);

    return () => {
      if (localTickInterval.current) {
        clearInterval(localTickInterval.current);
        localTickInterval.current = null;
      }
    };
  }, [state.isTracking, state.sessionId]);

  // Handle page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (state.sessionId) {
        // Use sendBeacon for reliable delivery on page close
        const payload = JSON.stringify({ session_id: state.sessionId });
        navigator.sendBeacon('/api/efficiency/login-sessions/end', payload);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [state.sessionId]);

  // ==========================================================================
  // Render
  // ==========================================================================

  const contextValue: GlobalActivityContextType = {
    ...state,
    startTracking,
    stopTracking,
  };

  return (
    <GlobalActivityContext.Provider value={contextValue}>
      {children}
    </GlobalActivityContext.Provider>
  );
};

export default GlobalActivityProvider;
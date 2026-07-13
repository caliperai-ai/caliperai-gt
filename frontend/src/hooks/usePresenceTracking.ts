import { useEffect, useRef, useState, useCallback } from 'react';
import { efficiencyApi } from '@/api/client';

interface PresenceState {
  sessionId: string | null;
  isActive: boolean;
  isIdle: boolean;
  activeTimeSeconds: number;
  idleTimeSeconds: number;
  actionCount: number;
  sessionStartTime: Date | null;
}

interface UsePresenceTrackingOptions {
  heartbeatIntervalMs?: number;
  idleThresholdMs?: number;
  enabled?: boolean;
  onSessionStart?: (sessionId: string) => void;
  onSessionEnd?: (stats: { activeSeconds: number; idleSeconds: number; actionCount: number }) => void;
}

interface UsePresenceTrackingReturn {
  sessionId: string | null;
  isActive: boolean;
  isIdle: boolean;
  activeTimeSeconds: number;
  idleTimeSeconds: number;
  actionCount: number;
  sessionDurationSeconds: number;
  logActivity: (eventType: string, metadata?: Record<string, unknown>) => void;
  endSession: () => Promise<void>;
}

export function usePresenceTracking(
  taskId: string | null | undefined,
  options: UsePresenceTrackingOptions = {}
): UsePresenceTrackingReturn {
  const {
    heartbeatIntervalMs = 30000,
    idleThresholdMs = 180000,
    enabled = true,
    onSessionStart,
    onSessionEnd,
  } = options;

  const [state, setState] = useState<PresenceState>({
    sessionId: null,
    isActive: false,
    isIdle: false,
    activeTimeSeconds: 0,
    idleTimeSeconds: 0,
    actionCount: 0,
    sessionStartTime: null,
  });

  const lastActivityTime = useRef<number>(Date.now());
  const heartbeatInterval = useRef<number | null>(null);
  const activityBuffer = useRef<Array<{ eventType: string; metadata?: Record<string, unknown> }>>([]);
  const isEndingSession = useRef(false);

  const handleActivity = useCallback(() => {
    lastActivityTime.current = Date.now();
    if (state.isIdle) {
      setState(prev => ({ ...prev, isIdle: false }));
    }
  }, [state.isIdle]);

  const logActivity = useCallback((eventType: string, metadata?: Record<string, unknown>) => {
    if (!state.sessionId || !enabled) return;

    activityBuffer.current.push({ eventType, metadata });
    setState(prev => ({ ...prev, actionCount: prev.actionCount + 1 }));
    handleActivity();

    if (activityBuffer.current.length >= 10) {
      const events = [...activityBuffer.current];
      activityBuffer.current = [];

      efficiencyApi.logActivityBatch({
        sessionId: state.sessionId,
        taskId: taskId || undefined,
        events,
      }).catch(console.error);
    }
  }, [state.sessionId, taskId, enabled, handleActivity]);

  const startSession = useCallback(async () => {
    if (!taskId || !enabled || state.sessionId) return;

    try {
      const clientInfo = {
        browser: navigator.userAgent.includes('Chrome') ? 'Chrome' :
                 navigator.userAgent.includes('Firefox') ? 'Firefox' :
                 navigator.userAgent.includes('Safari') ? 'Safari' : 'Other',
        os: navigator.platform,
        screen_resolution: `${window.screen.width}x${window.screen.height}`,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      };

      const response = await efficiencyApi.startSession(taskId, clientInfo);

      setState({
        sessionId: response.session_id,
        isActive: true,
        isIdle: false,
        activeTimeSeconds: 0,
        idleTimeSeconds: 0,
        actionCount: 0,
        sessionStartTime: new Date(response.started_at),
      });

      lastActivityTime.current = Date.now();
      onSessionStart?.(response.session_id);
    } catch (error) {
      console.error('Failed to start session:', error);
    }
  }, [taskId, enabled, state.sessionId, onSessionStart]);

  // End session
  const endSession = useCallback(async () => {
    if (!state.sessionId || isEndingSession.current) return;

    isEndingSession.current = true;

    try {
      // Flush any remaining activity buffer
      if (activityBuffer.current.length > 0) {
        await efficiencyApi.logActivityBatch({
          sessionId: state.sessionId,
          taskId: taskId || undefined,
          events: activityBuffer.current,
        });
        activityBuffer.current = [];
      }

      const response = await efficiencyApi.endSession(state.sessionId);

      onSessionEnd?.({
        activeSeconds: response.total_active_seconds,
        idleSeconds: response.total_idle_seconds,
        actionCount: response.action_count,
      });

      setState({
        sessionId: null,
        isActive: false,
        isIdle: false,
        activeTimeSeconds: 0,
        idleTimeSeconds: 0,
        actionCount: 0,
        sessionStartTime: null,
      });
    } catch (error) {
      console.error('Failed to end session:', error);
    } finally {
      isEndingSession.current = false;
    }
  }, [state.sessionId, taskId, onSessionEnd]);

  // Send heartbeat
  const sendHeartbeat = useCallback(async () => {
    if (!state.sessionId || !enabled) return;

    const now = Date.now();
    const timeSinceLastActivity = now - lastActivityTime.current;
    const isCurrentlyIdle = timeSinceLastActivity > idleThresholdMs;

    try {
      const response = await efficiencyApi.sendHeartbeat(
        state.sessionId,
        !isCurrentlyIdle,
        undefined // current frame could be passed here
      );

      setState(prev => ({
        ...prev,
        isIdle: response.is_idle,
        activeTimeSeconds: response.active_duration_seconds,
        idleTimeSeconds: response.idle_duration_seconds,
      }));
    } catch (error) {
      console.error('Failed to send heartbeat:', error);
    }
  }, [state.sessionId, enabled, idleThresholdMs]);

  // Set up activity listeners
  useEffect(() => {
    if (!enabled || !state.sessionId) return;

    const events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove'];

    // Throttle mousemove to avoid too many updates
    let mouseMoveTimeout: number | null = null;
    const throttledMouseMove = () => {
      if (mouseMoveTimeout) return;
      mouseMoveTimeout = window.setTimeout(() => {
        handleActivity();
        mouseMoveTimeout = null;
      }, 1000);
    };

    const handleEvent = (e: Event) => {
      if (e.type === 'mousemove') {
        throttledMouseMove();
      } else {
        handleActivity();
      }
    };

    events.forEach(event => {
      document.addEventListener(event, handleEvent, { passive: true });
    });

    return () => {
      events.forEach(event => {
        document.removeEventListener(event, handleEvent);
      });
      if (mouseMoveTimeout) {
        clearTimeout(mouseMoveTimeout);
      }
    };
  }, [enabled, state.sessionId, handleActivity]);

  // Start session when taskId changes
  useEffect(() => {
    if (taskId && enabled && !state.sessionId) {
      startSession();
    }
  }, [taskId, enabled, state.sessionId, startSession]);

  // Set up heartbeat interval
  useEffect(() => {
    if (!state.sessionId || !enabled) return;

    heartbeatInterval.current = window.setInterval(sendHeartbeat, heartbeatIntervalMs);

    return () => {
      if (heartbeatInterval.current) {
        clearInterval(heartbeatInterval.current);
        heartbeatInterval.current = null;
      }
    };
  }, [state.sessionId, enabled, heartbeatIntervalMs, sendHeartbeat]);

  // Clean up on unmount or taskId change
  useEffect(() => {
    return () => {
      if (state.sessionId && !isEndingSession.current) {
        // Fire and forget - we're unmounting
        efficiencyApi.endSession(state.sessionId).catch(console.error);
      }
    };
  }, [state.sessionId]);

  // Handle page visibility changes
  useEffect(() => {
    if (!state.sessionId) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        // Page is hidden - send a heartbeat with idle state
        sendHeartbeat();
      } else {
        // Page is visible again
        handleActivity();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [state.sessionId, sendHeartbeat, handleActivity]);

  // Handle beforeunload
  useEffect(() => {
    if (!state.sessionId) return;

    const handleBeforeUnload = () => {
      // Use sendBeacon for reliable delivery
      const payload = JSON.stringify({ session_id: state.sessionId });
      navigator.sendBeacon('/api/v1/efficiency/sessions/end', payload);
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [state.sessionId]);

  // Calculate session duration
  const sessionDurationSeconds = state.sessionStartTime
    ? Math.floor((Date.now() - state.sessionStartTime.getTime()) / 1000)
    : 0;

  return {
    sessionId: state.sessionId,
    isActive: state.isActive && !state.isIdle,
    isIdle: state.isIdle,
    activeTimeSeconds: state.activeTimeSeconds,
    idleTimeSeconds: state.idleTimeSeconds,
    actionCount: state.actionCount,
    sessionDurationSeconds,
    logActivity,
    endSession,
  };
}

export default usePresenceTracking;

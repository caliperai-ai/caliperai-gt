import React, { useState, useEffect } from 'react';
import { usePresenceTracking } from '@/hooks/usePresenceTracking';
import { Clock, Activity, Pause, Flame, Target, Trophy, ChevronDown, ChevronUp } from 'lucide-react';

interface SessionTimerProps {
  taskId?: string | null | undefined;
  compact?: boolean;
  showStats?: boolean;
  className?: string;
}

const formatTime = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

export const SessionTimer: React.FC<SessionTimerProps> = ({
  taskId,
  compact = false,
  showStats = true,
  className = '',
}) => {
  const {
    isActive,
    isIdle,
    activeTimeSeconds,
    idleTimeSeconds,
    actionCount,
    sessionDurationSeconds,
  } = usePresenceTracking(taskId);

  const [expanded, setExpanded] = useState(false);
  const [displayTime, setDisplayTime] = useState(0);

  // Update display time every second
  useEffect(() => {
    const interval = setInterval(() => {
      setDisplayTime(activeTimeSeconds + (isActive && !isIdle ? 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [activeTimeSeconds, isActive, isIdle]);

  // Sync with server time
  useEffect(() => {
    setDisplayTime(activeTimeSeconds);
  }, [activeTimeSeconds]);

  if (!taskId) return null;

  if (compact) {
    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-surface border border-gray-700 ${className}`}>
        <div className={`w-2 h-2 rounded-full ${isIdle ? 'bg-yellow-500' : 'bg-green-500'} animate-pulse`} />
        <Clock className="w-4 h-4 text-gray-400" />
        <span className="font-mono text-sm text-white">{formatTime(displayTime)}</span>
      </div>
    );
  }

  return (
    <div className={`bg-dark-surface rounded-xl border border-gray-700 overflow-hidden ${className}`}>
      {/* Main Timer Display */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-800/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {/* Status Indicator */}
          <div className={`
            w-10 h-10 rounded-full flex items-center justify-center
            ${isIdle ? 'bg-yellow-500/20 text-yellow-500' : 'bg-green-500/20 text-green-500'}
          `}>
            {isIdle ? <Pause className="w-5 h-5" /> : <Activity className="w-5 h-5" />}
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-2xl font-bold text-white">
                {formatTime(displayTime)}
              </span>
              <span className={`
                text-xs px-2 py-0.5 rounded-full
                ${isIdle ? 'bg-yellow-500/20 text-yellow-500' : 'bg-green-500/20 text-green-500'}
              `}>
                {isIdle ? 'IDLE' : 'ACTIVE'}
              </span>
            </div>
            <span className="text-xs text-gray-500">Active Time This Session</span>
          </div>
        </div>

        <button className="p-2 hover:bg-gray-700 rounded-lg transition-colors">
          {expanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
        </button>
      </div>

      {/* Expanded Stats */}
      {expanded && showStats && (
        <div className="px-4 pb-4 border-t border-gray-700">
          <div className="grid grid-cols-3 gap-4 mt-4">
            {/* Actions */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-blue-400">
                <Target className="w-4 h-4" />
                <span className="font-bold text-lg">{actionCount}</span>
              </div>
              <span className="text-xs text-gray-500">Actions</span>
            </div>

            {/* Session Duration */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-purple-400">
                <Clock className="w-4 h-4" />
                <span className="font-bold text-lg">{formatTime(sessionDurationSeconds)}</span>
              </div>
              <span className="text-xs text-gray-500">Total Session</span>
            </div>

            {/* Idle Time */}
            <div className="text-center">
              <div className="flex items-center justify-center gap-1 text-yellow-400">
                <Pause className="w-4 h-4" />
                <span className="font-bold text-lg">{formatTime(idleTimeSeconds)}</span>
              </div>
              <span className="text-xs text-gray-500">Idle Time</span>
            </div>
          </div>

          {/* Efficiency Bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs text-gray-400 mb-1">
              <span>Session Efficiency</span>
              <span>
                {sessionDurationSeconds > 0
                  ? Math.round((activeTimeSeconds / sessionDurationSeconds) * 100)
                  : 100}%
              </span>
            </div>
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-green-500 to-emerald-400 transition-all duration-300"
                style={{
                  width: `${sessionDurationSeconds > 0
                    ? Math.min((activeTimeSeconds / sessionDurationSeconds) * 100, 100)
                    : 100}%`
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/**
 * TodayProgressWidget - Shows daily progress toward goals
 */
interface TodayProgressWidgetProps {
  labelsToday: number;
  goalLabels: number;
  activeTimeSeconds: number;
  streakDays: number;
  className?: string;
}

export const TodayProgressWidget: React.FC<TodayProgressWidgetProps> = ({
  labelsToday,
  goalLabels,
  activeTimeSeconds,
  streakDays,
  className = '',
}) => {
  const progress = Math.min((labelsToday / goalLabels) * 100, 100);
  const hours = Math.floor(activeTimeSeconds / 3600);
  const minutes = Math.floor((activeTimeSeconds % 3600) / 60);

  return (
    <div className={`bg-dark-surface rounded-xl border border-gray-700 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Today's Progress</h3>
        {streakDays > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-orange-500/20 text-orange-400">
            <Flame className="w-4 h-4" />
            <span className="text-sm font-medium">{streakDays} day streak</span>
          </div>
        )}
      </div>

      {/* Labels Progress */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-400">Labels</span>
          <span className="text-sm font-medium text-white">{labelsToday} / {goalLabels}</span>
        </div>
        <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              progress >= 100
                ? 'bg-gradient-to-r from-green-500 to-emerald-400'
                : 'bg-gradient-to-r from-blue-500 to-indigo-400'
            }`}
            style={{ width: `${progress}%` }}
          />
        </div>
        {progress >= 100 && (
          <div className="flex items-center gap-1 mt-2 text-green-400 text-sm">
            <Trophy className="w-4 h-4" />
            <span>Daily goal achieved!</span>
          </div>
        )}
      </div>

      {/* Time Worked */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-gray-400">Time Worked</span>
        <span className="font-medium text-white">
          {hours > 0 ? `${hours}h ` : ''}{minutes}m
        </span>
      </div>
    </div>
  );
};

/**
 * MiniStatsBar - Compact stats bar for editor header
 */
interface MiniStatsBarProps {
  taskId?: string | null | undefined;
  labelsCreated?: number;
  className?: string;
}

export const MiniStatsBar: React.FC<MiniStatsBarProps> = ({
  taskId,
  labelsCreated = 0,
  className = '',
}) => {
  const { isIdle, activeTimeSeconds } = usePresenceTracking(taskId, { enabled: !!taskId });

  if (!taskId) return null;

  return (
    <div className={`flex items-center gap-4 px-3 py-1.5 rounded-lg bg-gray-800/50 ${className}`}>
      {/* Status Dot */}
      <div className="flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${isIdle ? 'bg-yellow-500' : 'bg-green-500'} animate-pulse`} />
        <span className="text-xs text-gray-400">{isIdle ? 'Idle' : 'Active'}</span>
      </div>

      {/* Timer */}
      <div className="flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5 text-gray-400" />
        <span className="font-mono text-sm text-white">{formatTime(activeTimeSeconds)}</span>
      </div>

      {/* Labels */}
      <div className="flex items-center gap-1.5">
        <Target className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-sm text-white">{labelsCreated}</span>
      </div>
    </div>
  );
};

export default SessionTimer;

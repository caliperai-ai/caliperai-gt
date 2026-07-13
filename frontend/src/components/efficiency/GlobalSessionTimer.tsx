import React from 'react';
import { useGlobalActivity } from '@/providers/GlobalActivityProvider';
import { Clock, Pause } from 'lucide-react';

interface GlobalSessionTimerProps {
  className?: string;
}

const formatTime = (seconds: number): string => {
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

export const GlobalSessionTimer: React.FC<GlobalSessionTimerProps> = ({
  className = '',
}) => {
  const {
    isTracking,
    isUserActive,
    todayActiveSeconds,
  } = useGlobalActivity();

  if (!isTracking) {
    // Show time even when not actively tracking (session ended or offline)
    if (todayActiveSeconds > 0) {
      return (
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-surface border border-gray-700 ${className}`}>
          <div className="w-2 h-2 rounded-full bg-gray-500" />
          <Clock className="w-4 h-4 text-gray-400" />
          <span className="font-mono text-sm font-medium text-gray-400">
            {formatTime(todayActiveSeconds)}
          </span>
          <span className="text-xs text-gray-500">Offline</span>
        </div>
      );
    }
    return null;
  }

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg bg-dark-surface border border-gray-700 ${className}`}>
      {/* Status indicator */}
      <div className={`w-2 h-2 rounded-full ${isUserActive ? 'bg-green-500 animate-pulse' : 'bg-yellow-500'}`} />

      {/* Icon */}
      {isUserActive ? (
        <Clock className="w-4 h-4 text-green-400" />
      ) : (
        <Pause className="w-4 h-4 text-yellow-500" />
      )}

      {/* Timer */}
      <span className={`font-mono text-sm font-medium ${isUserActive ? 'text-white' : 'text-yellow-500'}`}>
        {formatTime(todayActiveSeconds)}
      </span>

      {/* Status label */}
      <span className={`text-xs ${isUserActive ? 'text-gray-400' : 'text-yellow-500'}`}>
        {isUserActive ? '' : 'Paused'}
      </span>
    </div>
  );
};

export default GlobalSessionTimer;

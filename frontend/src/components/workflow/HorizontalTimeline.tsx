import React, { useRef, useEffect } from 'react';
import type { TaskAssignmentHistoryItem } from '@/api/client';

interface TimelineEvent {
  id: string;
  action: string;
  timestamp: string;
  userName?: string;
  role?: string;
  changedBy?: string;
  reason?: string;
  fromStage?: string;
  toStage?: string;
  fromStatus?: string;
  toStatus?: string;
}

interface HorizontalTimelineProps {
  events: TimelineEvent[];
  isLoading?: boolean;
  emptyMessage?: string;
}

const ACTION_CONFIG: Record<string, {
  icon: string;
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  assigned: {
    icon: '👤',
    label: 'Assigned',
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
    borderColor: 'border-green-500/40',
  },
  unassigned: {
    icon: '🚪',
    label: 'Unassigned',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/40',
  },
  stage_change: {
    icon: '🔄',
    label: 'Stage Change',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
    borderColor: 'border-purple-500/40',
  },
  stage_change_cleared: {
    icon: '↩️',
    label: 'Reassigned',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20',
    borderColor: 'border-yellow-500/40',
  },
  status_change: {
    icon: '📋',
    label: 'Status Update',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
    borderColor: 'border-blue-500/40',
  },
  submitted: {
    icon: '📤',
    label: 'Submitted',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/20',
    borderColor: 'border-purple-500/40',
  },
  accepted: {
    icon: '✅',
    label: 'Accepted',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/20',
    borderColor: 'border-emerald-500/40',
  },
  rejected: {
    icon: '❌',
    label: 'Rejected',
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
    borderColor: 'border-red-500/40',
  },
  created: {
    icon: '🆕',
    label: 'Created',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/20',
    borderColor: 'border-cyan-500/40',
  },
  default: {
    icon: '📝',
    label: 'Update',
    color: 'text-gray-400',
    bgColor: 'bg-gray-500/20',
    borderColor: 'border-gray-500/40',
  },
};

const ROLE_LABELS: Record<string, string> = {
  annotator: '🎨 Annotator',
  reviewer: '🔍 QA Reviewer',
  customer_reviewer: '👁️ Customer QA',
};

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  if (minutes > 0) return `${minutes}m`;
  return '<1m';
}

function formatTimestamp(timestamp: string): { date: string; time: string } {
  const date = new Date(timestamp);
  return {
    date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    time: date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
  };
}

const TimelineEventCard: React.FC<{
  event: TimelineEvent;
  durationToNext?: number;
  isFirst?: boolean;
  isLast?: boolean;
}> = ({ event, durationToNext, isFirst, isLast }) => {
  const config = ACTION_CONFIG[event.action] || ACTION_CONFIG.default;
  const { date, time } = formatTimestamp(event.timestamp);

  return (
    <div className="flex items-center flex-shrink-0">
      {/* Event Card */}
      <div className={`
        relative flex flex-col items-center p-3 rounded-xl border transition-all duration-200
        ${config.bgColor} ${config.borderColor}
        hover:scale-105 hover:shadow-lg hover:shadow-current/20
        min-w-[120px] max-w-[160px]
      `}>
        {/* First/Last Indicator */}
        {isFirst && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[9px] bg-cyan-500/30 text-cyan-300 rounded font-medium">
            START
          </div>
        )}
        {isLast && (
          <div className="absolute -top-2 left-1/2 -translate-x-1/2 px-1.5 py-0.5 text-[9px] bg-emerald-500/30 text-emerald-300 rounded font-medium">
            LATEST
          </div>
        )}

        {/* Icon */}
        <span className="text-2xl mb-1">{config.icon}</span>

        {/* Action Label */}
        <span className={`text-xs font-semibold ${config.color} mb-1`}>
          {config.label}
        </span>

        {/* User Info */}
        {event.userName && (
          <span className="text-xs text-white font-medium truncate max-w-full" title={event.userName}>
            {event.userName}
          </span>
        )}

        {/* Role */}
        {event.role && (
          <span className="text-[10px] text-gray-400 truncate max-w-full">
            {ROLE_LABELS[event.role] || event.role}
          </span>
        )}

        {/* Stage Transition */}
        {event.fromStage && event.toStage && (
          <div className="flex items-center gap-1 text-[10px] text-gray-400 mt-1">
            <span className="capitalize">{event.fromStage.replace('_', ' ')}</span>
            <span>→</span>
            <span className="capitalize text-white">{event.toStage.replace('_', ' ')}</span>
          </div>
        )}

        {/* Reason */}
        {event.reason && (
          <p className="text-[10px] text-gray-500 mt-1 text-center line-clamp-2" title={event.reason}>
            "{event.reason}"
          </p>
        )}

        {/* Timestamp */}
        <div className="mt-2 pt-2 border-t border-white/10 w-full text-center">
          <div className="text-xs text-gray-300">{date}</div>
          <div className="text-[10px] text-gray-500">{time}</div>
        </div>

        {/* Changed By */}
        {event.changedBy && event.changedBy !== event.userName && (
          <div className="text-[9px] text-gray-600 mt-1">
            by {event.changedBy}
          </div>
        )}
      </div>

      {/* Duration Connector */}
      {durationToNext !== undefined && (
        <div className="flex flex-col items-center flex-shrink-0 px-2">
          <div className="flex items-center gap-1">
            <div className="w-8 h-0.5 bg-gradient-to-r from-gray-600 to-gray-500" />
            <div className="px-2 py-1 bg-gray-800 rounded-full border border-gray-700">
              <span className="text-[10px] text-gray-400 font-medium whitespace-nowrap">
                ⏱️ {formatDuration(durationToNext)}
              </span>
            </div>
            <div className="w-8 h-0.5 bg-gradient-to-r from-gray-500 to-gray-600" />
          </div>
        </div>
      )}
    </div>
  );
};

export const HorizontalTimeline: React.FC<HorizontalTimelineProps> = ({
  events,
  isLoading = false,
  emptyMessage = 'No history available',
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest (rightmost) event
  useEffect(() => {
    if (scrollRef.current && events.length > 0) {
      scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }
  }, [events.length]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <div className="animate-spin w-6 h-6 border-2 border-cyan-500 border-t-transparent rounded-full" />
        <span className="ml-2 text-sm text-gray-400">Loading history...</span>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-gray-500">
        <span className="text-3xl mb-2">📜</span>
        <span className="text-sm">{emptyMessage}</span>
      </div>
    );
  }

  // Sort events by timestamp (oldest first for left-to-right flow)
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Calculate durations between events
  const eventsWithDuration = sortedEvents.map((event, idx) => {
    const nextEvent = sortedEvents[idx + 1];
    const duration = nextEvent
      ? new Date(nextEvent.timestamp).getTime() - new Date(event.timestamp).getTime()
      : undefined;
    return { event, duration };
  });

  return (
    <div className="relative">
      {/* Scroll Shadow Indicators */}
      <div className="absolute left-0 top-0 bottom-0 w-8 bg-gradient-to-r from-gray-900 to-transparent z-10 pointer-events-none" />
      <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-gray-900 to-transparent z-10 pointer-events-none" />

      {/* Timeline Container */}
      <div
        ref={scrollRef}
        className="flex items-center gap-2 overflow-x-auto py-4 px-4 scrollbar-thin scrollbar-track-gray-800 scrollbar-thumb-gray-600 hover:scrollbar-thumb-gray-500"
        style={{ scrollBehavior: 'smooth' }}
      >
        {eventsWithDuration.map(({ event, duration }, idx) => (
          <TimelineEventCard
            key={event.id}
            event={event}
            durationToNext={duration}
            isFirst={idx === 0}
            isLast={idx === eventsWithDuration.length - 1}
          />
        ))}
      </div>

      {/* Summary Stats */}
      <div className="flex items-center justify-between px-4 py-2 border-t border-gray-800 text-xs text-gray-500">
        <span>
          📊 {events.length} events
        </span>
        {events.length >= 2 && (
          <span>
            ⏱️ Total Duration: {formatDuration(
              new Date(sortedEvents[sortedEvents.length - 1].timestamp).getTime() -
              new Date(sortedEvents[0].timestamp).getTime()
            )}
          </span>
        )}
      </div>
    </div>
  );
};

// Helper function to convert TaskAssignmentHistoryItem to TimelineEvent
export function convertAssignmentHistoryToEvents(
  history: TaskAssignmentHistoryItem[]
): TimelineEvent[] {
  return history.map(item => ({
    id: item.id,
    action: item.action,
    timestamp: item.created_at,
    userName: item.user_name ?? undefined,
    role: item.role,
    changedBy: item.changed_by_name ?? undefined,
    reason: item.reason ?? undefined,
    fromStage: (item as any).from_stage,
    toStage: (item as any).to_stage,
    fromStatus: (item as any).from_status,
    toStatus: (item as any).to_status,
  }));
}

export default HorizontalTimeline;

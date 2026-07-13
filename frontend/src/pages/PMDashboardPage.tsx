import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { analyticsApi, campaignApi } from '@/api/client';
import { useCurrentOrganizationId } from '@/store/organizationStore';
import type {
  PMDashboardStats,
  AnnotatorStats,
  TaskBreakdown,
  EfficiencyMetrics,
  Campaign
} from '@/types';
import { AppLayout } from '@/components/layout';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';


const formatDuration = (seconds: number): string => {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    return `${mins}m ${secs}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
};

const formatNumber = (num: number): string => {
  if (num >= 1000000) return `${(num / 1000000).toFixed(1)}M`;
  if (num >= 1000) return `${(num / 1000).toFixed(1)}K`;
  return num.toString();
};

const getTimeAgo = (timestamp: string): string => {
  const diff = Date.now() - new Date(timestamp).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
};

// =============================================================================
// STAT CARD COMPONENT
// =============================================================================

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: 'up' | 'down' | 'stable';
  trendValue?: string;
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'cyan';
}

const StatCard: React.FC<StatCardProps> = ({
  title,
  value,
  subtitle,
  icon,
  trend,
  trendValue,
  color = 'blue'
}) => {
  const colorClasses = {
    blue: 'from-blue-500/20 to-blue-600/10 border-blue-500/30',
    green: 'from-green-500/20 to-green-600/10 border-green-500/30',
    yellow: 'from-yellow-500/20 to-yellow-600/10 border-yellow-500/30',
    red: 'from-red-500/20 to-red-600/10 border-red-500/30',
    purple: 'from-purple-500/20 to-purple-600/10 border-purple-500/30',
    cyan: 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/30',
  };

  const trendIcons = {
    up: '↑',
    down: '↓',
    stable: '→',
  };

  const trendColors = {
    up: 'text-green-400',
    down: 'text-red-400',
    stable: 'text-gray-400',
  };

  return (
    <div className={`bg-gradient-to-br ${colorClasses[color]} rounded-xl p-5 border`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-400 mb-1">{title}</p>
          <p className="text-3xl font-bold text-white">{value}</p>
          {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
          {trend && trendValue && (
            <p className={`text-xs mt-2 ${trendColors[trend]}`}>
              {trendIcons[trend]} {trendValue}
            </p>
          )}
        </div>
        {icon && (
          <div className="text-2xl opacity-60">{icon}</div>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// PROGRESS BAR COMPONENT
// =============================================================================

interface ProgressBarProps {
  value: number;
  max: number;
  label?: string;
  color?: string;
  showPercentage?: boolean;
}

const ProgressBar: React.FC<ProgressBarProps> = ({
  value,
  max,
  label,
  color = 'bg-primary',
  showPercentage = true
}) => {
  const percentage = max > 0 ? (value / max) * 100 : 0;

  return (
    <div className="w-full">
      {label && (
        <div className="flex justify-between text-sm mb-1">
          <span className="text-gray-400">{label}</span>
          {showPercentage && (
            <span className="text-white font-medium">{percentage.toFixed(1)}%</span>
          )}
        </div>
      )}
      <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${Math.min(percentage, 100)}%` }}
        />
      </div>
    </div>
  );
};

// =============================================================================
// TASK STATUS BREAKDOWN
// =============================================================================

interface TaskStatusBreakdownProps {
  breakdown: TaskBreakdown;
}

const TaskStatusBreakdown: React.FC<TaskStatusBreakdownProps> = ({ breakdown }) => {
  const statuses = [
    { key: 'accepted', label: 'Completed', color: 'bg-green-500', value: breakdown.accepted },
    { key: 'submitted', label: 'Submitted', color: 'bg-blue-500', value: breakdown.submitted },
    { key: 'in_progress', label: 'In Progress', color: 'bg-yellow-500', value: breakdown.in_progress },
    { key: 'assigned', label: 'Assigned', color: 'bg-purple-500', value: breakdown.assigned },
    { key: 'pending', label: 'Pending', color: 'bg-gray-500', value: breakdown.pending },
    { key: 'rejected', label: 'Rejected', color: 'bg-red-500', value: breakdown.rejected },
  ];

  return (
    <div className="bg-dark-panel rounded-xl p-5 border border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4">Task Status Distribution</h3>

      {/* Visual bar */}
      <div className="h-4 flex rounded-full overflow-hidden mb-4">
        {statuses.map((status) => {
          const percentage = breakdown.total > 0 ? (status.value / breakdown.total) * 100 : 0;
          if (percentage === 0) return null;
          return (
            <div
              key={status.key}
              className={`${status.color} transition-all duration-300`}
              style={{ width: `${percentage}%` }}
              title={`${status.label}: ${status.value}`}
            />
          );
        })}
      </div>

      {/* Legend */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {statuses.map((status) => (
          <div key={status.key} className="flex items-center gap-2">
            <div className={`w-3 h-3 rounded-full ${status.color}`} />
            <span className="text-sm text-gray-400">{status.label}</span>
            <span className="text-sm font-medium text-white ml-auto">{status.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

// =============================================================================
// ANNOTATOR LEADERBOARD
// =============================================================================

interface AnnotatorLeaderboardProps {
  annotators: AnnotatorStats[];
}

const AnnotatorLeaderboard: React.FC<AnnotatorLeaderboardProps> = ({ annotators }) => {
  const [sortBy, setSortBy] = useState<'completed' | 'speed' | 'quality'>('completed');

  const sortedAnnotators = [...annotators].sort((a, b) => {
    switch (sortBy) {
      case 'speed':
        // Lower avg time is better
        return a.avg_time_per_task_seconds - b.avg_time_per_task_seconds;
      case 'quality':
        // Lower revision rate is better
        return a.revision_rate - b.revision_rate;
      default:
        // More completed is better
        return b.tasks_completed - a.tasks_completed;
    }
  });

  const getMedalEmoji = (index: number) => {
    if (index === 0) return '🥇';
    if (index === 1) return '🥈';
    if (index === 2) return '🥉';
    return '';
  };

  return (
    <div className="bg-dark-panel rounded-xl p-5 border border-gray-700">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-white">Top Annotators</h3>
        <div className="flex gap-1 bg-dark-bg rounded-lg p-1">
          {(['completed', 'speed', 'quality'] as const).map((option) => (
            <button
              key={option}
              onClick={() => setSortBy(option)}
              className={`px-3 py-1 text-xs rounded-md transition-colors ${
                sortBy === option
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {option === 'completed' ? 'Tasks' : option === 'speed' ? 'Speed' : 'Quality'}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        {sortedAnnotators.slice(0, 5).map((annotator, index) => (
          <div
            key={annotator.id}
            className="flex items-center gap-3 p-3 bg-dark-bg rounded-lg"
          >
            <span className="text-xl w-8">{getMedalEmoji(index)}</span>
            <div className="flex-1">
              <p className="text-white font-medium">{annotator.alias}</p>
              <p className="text-xs text-gray-500">
                {annotator.frames_annotated} frames • {formatDuration(annotator.total_time_seconds)} total
              </p>
            </div>
            <div className="text-right">
              <p className="text-white font-semibold">{annotator.tasks_completed}</p>
              <p className="text-xs text-gray-500">completed</p>
            </div>
            <div className="text-right">
              <p className="text-cyan-400 font-medium">
                {formatDuration(annotator.avg_time_per_task_seconds)}
              </p>
              <p className="text-xs text-gray-500">avg/task</p>
            </div>
            <div className="text-right">
              <p className={`font-medium ${
                annotator.revision_rate < 10 ? 'text-green-400' :
                annotator.revision_rate < 25 ? 'text-yellow-400' : 'text-red-400'
              }`}>
                {annotator.revision_rate.toFixed(1)}%
              </p>
              <p className="text-xs text-gray-500">revisions</p>
            </div>
          </div>
        ))}

        {annotators.length === 0 && (
          <p className="text-center text-gray-500 py-4">No annotators with completed tasks yet</p>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// EFFICIENCY METRICS PANEL
// =============================================================================

interface EfficiencyPanelProps {
  efficiency: EfficiencyMetrics;
}

const EfficiencyPanel: React.FC<EfficiencyPanelProps> = ({ efficiency }) => {
  const trendIcon = {
    increasing: '📈',
    decreasing: '📉',
    stable: '➡️',
  };

  const trendColor = {
    increasing: 'text-green-400',
    decreasing: 'text-red-400',
    stable: 'text-gray-400',
  };

  return (
    <div className="bg-dark-panel rounded-xl p-5 border border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4">Efficiency Metrics</h3>

      <div className="grid grid-cols-2 gap-4">
        <div className="p-3 bg-dark-bg rounded-lg">
          <p className="text-xs text-gray-500 mb-1">Avg Time / Task</p>
          <p className="text-xl font-bold text-white">
            {formatDuration(efficiency.avg_time_per_task_seconds)}
          </p>
        </div>

        <div className="p-3 bg-dark-bg rounded-lg">
          <p className="text-xs text-gray-500 mb-1">Avg Time / Frame</p>
          <p className="text-xl font-bold text-white">
            {formatDuration(efficiency.avg_time_per_frame_seconds)}
          </p>
        </div>

        <div className="p-3 bg-dark-bg rounded-lg">
          <p className="text-xs text-gray-500 mb-1">First-Time Accept Rate</p>
          <p className={`text-xl font-bold ${
            efficiency.first_time_accept_rate >= 80 ? 'text-green-400' :
            efficiency.first_time_accept_rate >= 60 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {efficiency.first_time_accept_rate.toFixed(1)}%
          </p>
        </div>

        <div className="p-3 bg-dark-bg rounded-lg">
          <p className="text-xs text-gray-500 mb-1">Avg Revisions / Task</p>
          <p className={`text-xl font-bold ${
            efficiency.avg_revisions_per_task < 1 ? 'text-green-400' :
            efficiency.avg_revisions_per_task < 2 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {efficiency.avg_revisions_per_task.toFixed(2)}
          </p>
        </div>
      </div>

      <div className="mt-4 p-3 bg-dark-bg rounded-lg">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs text-gray-500 mb-1">Velocity Trend</p>
            <p className={`text-lg font-semibold ${trendColor[efficiency.velocity_trend]}`}>
              {trendIcon[efficiency.velocity_trend]} {efficiency.velocity_trend.charAt(0).toUpperCase() + efficiency.velocity_trend.slice(1)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-2xl font-bold text-white">{efficiency.tasks_completed_last_7_days}</p>
            <p className="text-xs text-gray-500">completed this week</p>
          </div>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// RECENT ACTIVITY FEED
// =============================================================================

interface RecentActivityFeedProps {
  activities: PMDashboardStats['recent_activity'];
}

const RecentActivityFeed: React.FC<RecentActivityFeedProps> = ({ activities }) => {
  const navigate = useNavigate();

  const actionIcons: Record<string, string> = {
    completed: '✅',
    submitted: '📤',
    started: '▶️',
    assigned: '👤',
    updated: '📝',
  };

  const actionColors: Record<string, string> = {
    completed: 'text-green-400',
    submitted: 'text-blue-400',
    started: 'text-yellow-400',
    assigned: 'text-purple-400',
    updated: 'text-gray-400',
  };

  return (
    <div className="bg-dark-panel rounded-xl p-5 border border-gray-700">
      <h3 className="text-lg font-semibold text-white mb-4">Recent Activity</h3>

      <div className="space-y-3 max-h-[400px] overflow-y-auto">
        {activities.map((activity, index) => (
          <div
            key={`${activity.task_id}-${index}`}
            onClick={() => navigate(`/tasks/${activity.task_id}/editor`)}
            className="flex items-start gap-3 p-2 hover:bg-dark-bg/50 rounded-lg transition-colors cursor-pointer group"
            title="Open task in editor"
          >
            <span className="text-lg">{actionIcons[activity.action] || '📝'}</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate group-hover:text-blue-400 transition-colors">
                {activity.task_name}
              </p>
              <p className="text-xs text-gray-500">
                <span className={actionColors[activity.action]}>
                  {activity.action.charAt(0).toUpperCase() + activity.action.slice(1)}
                </span>
                {activity.annotator_alias && (
                  <span> by {activity.annotator_alias}</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500 whitespace-nowrap">
                {getTimeAgo(activity.timestamp)}
              </span>
              <span className="text-gray-600 group-hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100 text-xs">
                →
              </span>
            </div>
          </div>
        ))}

        {activities.length === 0 && (
          <p className="text-center text-gray-500 py-4">No recent activity</p>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// MOST TIME CONSUMING TASK CARD
// =============================================================================

interface MostTimeConsumingCardProps {
  task?: PMDashboardStats['most_time_consuming_task'];
}

const MostTimeConsumingCard: React.FC<MostTimeConsumingCardProps> = ({ task }) => {
  if (!task) {
    return (
      <div className="bg-dark-panel rounded-xl p-5 border border-gray-700">
        <h3 className="text-lg font-semibold text-white mb-4">⏱️ Most Time-Consuming Task</h3>
        <p className="text-gray-500 text-center py-4">No completed tasks with time tracking yet</p>
      </div>
    );
  }

  return (
    <div className="bg-gradient-to-br from-orange-500/20 to-red-500/10 rounded-xl p-5 border border-orange-500/30">
      <h3 className="text-lg font-semibold text-white mb-4">⏱️ Most Time-Consuming Task</h3>

      <div className="space-y-3">
        <div>
          <p className="text-xl font-bold text-white">{task.task_name}</p>
          <p className="text-sm text-gray-400">
            {task.dataset_name} / {task.scene_name}
          </p>
        </div>

        <div className="flex items-center gap-4">
          <div>
            <p className="text-3xl font-bold text-orange-400">{task.total_time_formatted}</p>
            <p className="text-xs text-gray-500">Total time</p>
          </div>
          <div className="text-right">
            <p className="text-lg font-semibold text-white">{task.frame_count}</p>
            <p className="text-xs text-gray-500">frames</p>
          </div>
          {task.annotator_alias && (
            <div className="text-right">
              <p className="text-lg font-medium text-white">{task.annotator_alias}</p>
              <p className="text-xs text-gray-500">annotator</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// MAIN DASHBOARD PAGE
// =============================================================================

export default function PMDashboardPage() {
  const [selectedCampaign, setSelectedCampaign] = useState<string>('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshStatus, setRefreshStatus] = useState<'idle' | 'updated' | 'no-change'>('idle');
  const prevStatsRef = React.useRef<string | null>(null);
  const currentOrgId = useCurrentOrganizationId();

  // Fetch campaigns for filter
  const { data: campaignsData } = useQuery({
    queryKey: ['campaigns', currentOrgId],
    queryFn: () => campaignApi.list({ organization_id: currentOrgId || undefined } as any),
  });

  const campaigns = campaignsData?.items ?? [];

  // Fetch dashboard stats
  const {
    data: stats,
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['pm-dashboard', selectedCampaign, currentOrgId],
    queryFn: () => analyticsApi.getDashboard({
      campaignId: selectedCampaign || undefined,
      organizationId: currentOrgId || undefined,
    }),
    refetchInterval: 60000,
  });

  const { data: annotationStats, isLoading: isLoadingAnnotations, error: annotationError, refetch: refetchAnnotations } = useQuery({
    queryKey: ['annotation-daily', currentOrgId],
    queryFn: () => analyticsApi.getAnnotationDailyStats(30, currentOrgId || undefined),
  });

  // Smart refresh: fetch fresh data and compare key metrics to detect real changes
  const handleRefresh = async () => {
    setIsRefreshing(true);
    setRefreshStatus('idle');
    const snapshot = prevStatsRef.current;
    await Promise.all([refetch(), refetchAnnotations()]);
    // After refetch, the useEffect below will compare and set status
    // If no stats yet just mark as no-change
    if (!snapshot) {
      setRefreshStatus('no-change');
      setTimeout(() => setRefreshStatus('idle'), 3000);
    }
    setIsRefreshing(false);
  };

  // Detect actual data changes after any refetch (manual or automatic)
  React.useEffect(() => {
    if (!stats) return;
    const current = JSON.stringify({
      total: stats.task_breakdown.total,
      accepted: stats.task_breakdown.accepted,
      in_progress: stats.task_breakdown.in_progress,
      submitted: stats.task_breakdown.submitted,
    });
    if (prevStatsRef.current === null) {
      // First load — just store, don't show badge
      prevStatsRef.current = current;
      return;
    }
    if (prevStatsRef.current !== current) {
      prevStatsRef.current = current;
      setRefreshStatus('updated');
      setIsRefreshing(false);
      setTimeout(() => setRefreshStatus('idle'), 3000);
    } else {
      setRefreshStatus('no-change');
      setIsRefreshing(false);
      setTimeout(() => setRefreshStatus('idle'), 3000);
    }
  }, [stats]);

  console.log('[PMDashboard] annotationStats:', annotationStats, 'error:', annotationError);

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-white">PM Dashboard</h1>
            <p className="text-gray-400 text-sm">
              Project management analytics and insights
            </p>
          </div>

          <div className="flex items-center gap-4">
            {/* Campaign Filter */}
            <select
              value={selectedCampaign}
              onChange={(e) => setSelectedCampaign(e.target.value)}
              className="bg-dark-panel border border-gray-700 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-primary"
            >
              <option value="">All Campaigns</option>
              {campaigns.map((campaign: Campaign) => (
                <option key={campaign.id} value={campaign.id}>
                  {campaign.name}
                </option>
              ))}
            </select>

            <button
              onClick={handleRefresh}
              disabled={isRefreshing}
              className={`relative px-4 py-2 border rounded-lg transition-colors flex items-center gap-2
                ${isRefreshing
                  ? 'bg-dark-panel border-gray-700 text-gray-500 cursor-not-allowed'
                  : refreshStatus === 'updated'
                  ? 'bg-green-500/10 border-green-500/50 text-green-400'
                  : refreshStatus === 'no-change'
                  ? 'bg-dark-panel border-gray-700 text-gray-400'
                  : 'bg-dark-panel border-gray-700 text-gray-400 hover:text-white hover:border-gray-600'
                }`}
            >
              <span className={isRefreshing ? 'animate-spin inline-block' : ''}>↻</span>
              {isRefreshing
                ? 'Refreshing...'
                : refreshStatus === 'updated'
                ? 'Updated!'
                : refreshStatus === 'no-change'
                ? 'Up to date'
                : 'Refresh'}
            </button>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-500/20 border border-red-500 rounded-lg p-4 text-red-300">
            Failed to load dashboard: {(error as Error).message}
          </div>
        )}

        {/* Dashboard Content */}
        {stats && (
          <div className="space-y-6">
            {/* Overview Stats Row */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-4 gap-4">
              <StatCard
                title="Total Tasks"
                value={formatNumber(stats.task_breakdown.total)}
                icon="📋"
                color="blue"
              />
              <StatCard
                title="Completed"
                value={formatNumber(stats.task_breakdown.accepted)}
                subtitle={`${stats.completion_rate.toFixed(1)}% complete`}
                icon="✅"
                color="green"
              />
              <StatCard
                title="In Progress"
                value={formatNumber(stats.task_breakdown.in_progress)}
                icon="⚡"
                color="yellow"
              />
              <StatCard
                title="Submitted for QA"
                value={formatNumber(stats.task_breakdown.submitted)}
                icon="📤"
                color="purple"
              />

            </div>

            {/* Annotation Throughput Chart */}
            <div className="bg-dark-panel rounded-xl p-5 border border-gray-700">
              <h3 className="text-lg font-semibold text-white mb-4">Labels Throughput (Last 30 Days)</h3>
              {isLoadingAnnotations ? (
                <div className="h-64 flex items-center justify-center">
                  <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                </div>
              ) : annotationError ? (
                <div className="h-64 flex items-center justify-center text-red-400">
                  <p>Failed to load annotation stats</p>
                </div>
              ) : annotationStats && annotationStats.length > 0 ? (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={annotationStats}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                      <XAxis
                        dataKey="date"
                        stroke="#9CA3AF"
                        tick={{ fill: '#9CA3AF', fontSize: 10 }}
                        tickFormatter={(val: string) => val.split('-').slice(1).join('/')}
                      />
                      <YAxis stroke="#9CA3AF" tick={{ fill: '#9CA3AF', fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#1F2937', borderColor: '#374151', color: '#F3F4F6' }}
                        itemStyle={{ color: '#F3F4F6' }}
                      />
                      <Legend />
                      <Bar dataKey="created_count" name="Created" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="submitted_count" name="Submitted" fill="#8B5CF6" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="accepted_count" name="Accepted" fill="#10B981" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">
                  <p>No annotation data available for the selected period</p>
                </div>
              )}
            </div>

            {/* Main Content Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column - Task Distribution & Efficiency */}
              <div className="lg:col-span-2 space-y-6">
                <TaskStatusBreakdown breakdown={stats.task_breakdown} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <EfficiencyPanel efficiency={stats.efficiency} />
                  <MostTimeConsumingCard task={stats.most_time_consuming_task} />
                </div>

                <AnnotatorLeaderboard annotators={stats.top_annotators} />
              </div>

              {/* Right Column - Activity Feed */}
              <div className="space-y-6">
                {/* Quick Stats */}
                <div className="bg-dark-panel rounded-xl p-5 border border-gray-700">
                  <h3 className="text-lg font-semibold text-white mb-4">📊 Quick Stats</h3>
                  <div className="space-y-3">
                    <ProgressBar
                      value={stats.task_breakdown.accepted}
                      max={stats.task_breakdown.total}
                      label="Completion Progress"
                      color="bg-green-500"
                    />
                    <ProgressBar
                      value={stats.stage_breakdown.qa + stats.stage_breakdown.customer_qa}
                      max={stats.task_breakdown.total}
                      label="In QA Pipeline"
                      color="bg-blue-500"
                    />
                    <div className="pt-2 border-t border-gray-700">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-400">Last 7 days</span>
                        <span className="text-white font-medium">
                          {stats.efficiency.tasks_completed_last_7_days} tasks
                        </span>
                      </div>
                      <div className="flex justify-between text-sm mt-1">
                        <span className="text-gray-400">Last 30 days</span>
                        <span className="text-white font-medium">
                          {stats.efficiency.tasks_completed_last_30_days} tasks
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                <RecentActivityFeed activities={stats.recent_activity} />
              </div>
            </div>

            {/* Footer - Last Updated */}
            <div className="text-center text-xs text-gray-500 pt-4">
              Last updated: {new Date(stats.generated_at).toLocaleString()}
            </div>
          </div>
        )}
      </div>
    </AppLayout>
  );
}
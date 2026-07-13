import React, { useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { analyticsApi, efficiencyApi, segmentationApi, taskApi } from '@/api/client';
import { Task } from '@/types';
import { AppLayout } from '@/components/layout';
import { useCurrentOrganizationId } from '@/store/organizationStore';
import { useOnboardingStore } from '@/store/onboardingStore';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Area,
  AreaChart,
} from 'recharts';
import {
  AchievementsPanel,
  Leaderboard,
  TeamChallenges,
  StreakIndicator,
} from '@/components/efficiency';
import {
  Clock,
  Target,
  Zap,
  TrendingUp,
  Activity,
  CheckCircle2,
  Calendar,
  HelpCircle,
  Plus,
  X,
  Pencil,
  Trash2,
} from 'lucide-react';


interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: { value: number; isPositive: boolean };
  color?: 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'cyan' | 'orange';
}

const StatCard: React.FC<StatCardProps> = ({ title, value, subtitle, icon, trend, color = 'blue' }) => {
  const colorClasses = {
    blue: 'from-blue-500/20 to-blue-600/10 border-blue-500/30',
    green: 'from-green-500/20 to-green-600/10 border-green-500/30',
    yellow: 'from-yellow-500/20 to-yellow-600/10 border-yellow-500/30',
    red: 'from-red-500/20 to-red-600/10 border-red-500/30',
    purple: 'from-purple-500/20 to-purple-600/10 border-purple-500/30',
    cyan: 'from-cyan-500/20 to-cyan-600/10 border-cyan-500/30',
    orange: 'from-orange-500/20 to-orange-600/10 border-orange-500/30',
  };

  return (
    <div className={`bg-gradient-to-br ${colorClasses[color]} rounded-xl p-5 border`}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-gray-400 text-sm font-medium mb-1">{title}</h3>
          <div className="text-2xl font-bold text-white mb-1">{value}</div>
          {subtitle && <div className="text-xs text-gray-500">{subtitle}</div>}
          {trend && (
            <div className={`text-xs mt-1 flex items-center gap-1 ${trend.isPositive ? 'text-green-400' : 'text-red-400'}`}>
              <TrendingUp className={`w-3 h-3 ${!trend.isPositive && 'rotate-180'}`} />
              {trend.isPositive ? '+' : ''}{trend.value}% vs last week
            </div>
          )}
        </div>
        {icon && (
          <div className="text-gray-500 opacity-60">{icon}</div>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// GOAL PROGRESS CARD
// =============================================================================

// =============================================================================
// MY TASKS TABLE COMPONENT
// =============================================================================

const formatTs = (iso: string | undefined): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
};

const formatDuration = (seconds: number): string => {
  if (!seconds) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};



interface TimerData {
  elapsed: number;
  running: boolean;
  startedAt?: string;
  lastActivityAt?: string;
  breaks?: { pausedAt: string; resumedAt?: string }[];
}

const getTaskTimerData = (taskId: string, taxonomyId?: string): TimerData | null => {
  try {
    const key = taxonomyId
      ? `task_timer_${taskId}_${taxonomyId}`
      : `task_timer_${taskId}`;
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
};


interface TaskStat {
  task_id: string;
  label_count: number;
  frames_visited: number;
  total_frames: number;
}

interface MyTasksTableProps {
  tasks: Task[];
  isLoading: boolean;
}

const MyTasksTable: React.FC<MyTasksTableProps> = ({ tasks, isLoading }) => {
  const [now, setNow] = React.useState(() => Date.now());
  const [taskStats, setTaskStats] = React.useState<Record<string, TaskStat>>({});

  // Tick every second for live duration
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Stats keyed by `${taskId}` (task-level), `${taskId}_${taxonomyId}` (per-taxonomy DB),
  // or `${taskId}_seg` (per-task file-based segmentation fallback)
  React.useEffect(() => {
    if (!tasks.length) return;
    const ids = tasks.map(t => t.id);

    // Task-level stats (each task now has its own taxonomy_id, so task-level stat is correct)
    taskApi.stats(ids).then(results => {
      const map: Record<string, TaskStat> = {};
      results.forEach(r => { map[r.task_id] = r; });
      setTaskStats(prev => ({ ...prev, ...map }));
    }).catch(() => {});

    // File-based segmentation stats for ALL tasks — stored under `${taskId}_seg`.
    // Called unconditionally so it works even if annotation_mode isn't populated.
    // Only written when labeled_frames > 0 to avoid overriding correct DB counts with zero.
    ids.forEach(taskId => {
      segmentationApi.getStats(taskId).then(seg => {
        if (seg.labeled_frames > 0 || seg.total_instances > 0) {
          setTaskStats(prev => ({
            ...prev,
            [`${taskId}_seg`]: {
              task_id: taskId,
              label_count: seg.total_instances,
              frames_visited: seg.labeled_frames,
              total_frames: seg.total_frames,
            },
          }));
        }
      }).catch(() => {});
    });
  }, [tasks]);

  const getLiveDuration = (task: Task, taxonomyId?: string): number => {
    const timer = getTaskTimerData(task.id, taxonomyId);
    if (timer) {
      const elapsed = timer.elapsed || 0;
      if (timer.running && timer.startedAt) {
        const liveSecs = (now - new Date(timer.startedAt).getTime()) / 1000;
        return elapsed + Math.max(0, liveSecs);
      }
      return elapsed;
    }
    // No taxonomy-specific data — fall back to task-level only when no taxonomy given
    if (!taxonomyId) {
      const base = task.total_time_seconds || 0;
      return base;
    }
    return 0;
  };

  const getBreakCount = (task: Task, taxonomyId?: string): number => {
    const timer = getTaskTimerData(task.id, taxonomyId);
    return timer?.breaks?.filter(b => b.resumedAt).length ?? 0;
  };

  const getFrameTimeExtremes = (taskId: string, taxonomyId?: string): {
    min: { index: number; seconds: number } | null;
    max: { index: number; seconds: number } | null;
  } => {
    try {
      // Try taxonomy-specific key first, fall back to task-level key for backwards compat
      const taxKey = taxonomyId ? `task_frame_times_${taskId}_${taxonomyId}` : null;
      const taskKey = `task_frame_times_${taskId}`;
      const raw = (taxKey ? localStorage.getItem(taxKey) : null) ?? localStorage.getItem(taskKey);
      if (!raw) return { min: null, max: null };
      const data: Record<string, { totalSeconds: number; visits: number }> = JSON.parse(raw);
      const entries = Object.entries(data).map(([idx, v]) => ({ index: Number(idx), seconds: v.totalSeconds }));
      if (!entries.length) return { min: null, max: null };
      entries.sort((a, b) => a.seconds - b.seconds);
      return { min: entries[0], max: entries[entries.length - 1] };
    } catch {
      return { min: null, max: null };
    }
  };

  const fmtSecs = (s: number): string => {
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m ${s % 60}s`;
  };

  const getTimePerFrame = (task: Task, taxonomyId?: string): string => {
    // Prefer per-frame localStorage data (accurate): average of actual tracked frame times
    const taxKey = taxonomyId ? `task_frame_times_${task.id}_${taxonomyId}` : null;
    const taskKey = `task_frame_times_${task.id}`;
    const raw = (taxKey ? localStorage.getItem(taxKey) : null) ?? localStorage.getItem(taskKey);
    if (raw) {
      try {
        const data: Record<string, { totalSeconds: number; visits: number }> = JSON.parse(raw);
        const entries = Object.values(data);
        if (entries.length > 0) {
          const totalSeconds = entries.reduce((sum, v) => sum + v.totalSeconds, 0);
          return `${(totalSeconds / entries.length).toFixed(1)}s`;
        }
      } catch {}
    }

    // Fallback: total elapsed / frames_visited (less accurate — inflated if many frames navigated)
    const elapsed = getLiveDuration(task, taxonomyId);
    const statKey = taxonomyId ? `${task.id}_${taxonomyId}` : task.id;
    let stat = taskStats[statKey];
    if ((!stat || stat.frames_visited === 0) && taskStats[`${task.id}_seg`]) {
      stat = taskStats[`${task.id}_seg`];
    }
    const visited = stat?.frames_visited ?? 0;
    if (!elapsed || !visited) return '—';
    return `${(elapsed / visited).toFixed(1)}s`;
  };

  return (
    <div className="bg-dark-surface rounded-xl border border-gray-700 p-5">
      <div className="flex items-center gap-2 mb-4">
        <CheckCircle2 className="w-5 h-5 text-blue-500" />
        <h3 className="text-lg font-medium text-white">My Tasks</h3>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-500" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <CheckCircle2 className="w-8 h-8 mx-auto mb-2 opacity-40" />
          <p className="text-sm">No tasks assigned yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left">
                {/* Task */}
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider leading-tight rounded-l-lg bg-blue-500/10 text-blue-300 border-b border-blue-500/20">
                  Task
                </th>
                {/* Taxonomy */}
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider leading-tight bg-teal-500/10 text-teal-300 border-b border-teal-500/20">
                  Taxonomy
                </th>
                {/* Progress group */}
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider leading-tight bg-purple-500/10 text-purple-300 border-b border-purple-500/20">
                  Frames
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider leading-tight bg-purple-500/10 text-purple-300 border-b border-purple-500/20">
                  Labels
                </th>
                {/* Time group */}
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider leading-tight bg-cyan-500/10 text-cyan-300 border-b border-cyan-500/20">
                  Start<br />Time
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider leading-tight bg-cyan-500/10 text-cyan-300 border-b border-cyan-500/20">
                  End<br />Time
                </th>
                {/* Activity group */}
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider leading-tight bg-green-500/10 text-green-300 border-b border-green-500/20">
                  Active<br />Time
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider leading-tight bg-green-500/10 text-green-300 border-b border-green-500/20">
                  Breaks
                </th>
                {/* Per-frame stats group */}
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider leading-tight bg-amber-500/10 text-amber-300 border-b border-amber-500/20">
                  Time/<br />Frame
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider leading-tight bg-amber-500/10 text-amber-300 border-b border-amber-500/20">
                  Min<br />Time/Frame
                </th>
                <th className="px-3 py-2.5 text-xs font-semibold uppercase tracking-wider leading-tight rounded-r-lg bg-amber-500/10 text-amber-300 border-b border-amber-500/20">
                  Max<br />Time/Frame
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {tasks.map(task => {
                const timer = getTaskTimerData(task.id, task.taxonomy_id);
                const duration = getLiveDuration(task, task.taxonomy_id);
                const breakCount = getBreakCount(task, task.taxonomy_id);
                const startedAt = task.started_at || timer?.startedAt;

                // Stat key: task-level (each task IS one taxonomy now)
                let s = taskStats[task.id];
                if ((!s || s.label_count === 0) && taskStats[`${task.id}_seg`]) {
                  s = taskStats[`${task.id}_seg`];
                }

                const { min, max } = getFrameTimeExtremes(task.id, task.taxonomy_id);
                const hasActiveTime = duration > 0;
                const placeholder = hasActiveTime
                  ? <span className="text-gray-600 text-xs">—</span>
                  : <span className="text-gray-600">—</span>;

                return (
                  <tr key={task.id} className="hover:bg-gray-700/20 transition-colors">
                    <td className="py-3 px-3">
                      <span className="text-white font-medium text-sm leading-snug line-clamp-2 max-w-[240px]" title={task.name}>
                        {task.name}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      {(task as any).taxonomy_name ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-teal-500/15 text-teal-300 text-xs font-medium whitespace-nowrap max-w-[160px] truncate" title={(task as any).taxonomy_name}>
                          {(task as any).taxonomy_name}
                        </span>
                      ) : <span className="text-gray-500 text-xs">—</span>}
                    </td>
                    <td className="py-3 px-3 text-gray-300 whitespace-nowrap">
                      {s ? (
                        <span>
                          <span className="text-purple-300 font-medium">{s.frames_visited}</span>
                          <span className="text-gray-500"> / {s.total_frames}</span>
                        </span>
                      ) : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="py-3 px-3 text-gray-300">
                      {s != null && s.label_count != null
                        ? <span className="text-purple-300 font-medium">{s.label_count.toLocaleString()}</span>
                        : <span className="text-gray-600">—</span>}
                    </td>
                    <td className="py-3 px-3 text-gray-400 text-xs whitespace-nowrap">
                      {startedAt ? formatTs(startedAt) : '—'}
                    </td>
                    <td className="py-3 px-3 text-gray-400 text-xs whitespace-nowrap">
                      {task.submitted_at && task.stage !== 'annotation' ? formatTs(task.submitted_at) : '—'}
                    </td>
                    <td className="py-3 px-3 whitespace-nowrap">
                      <span className="text-green-400 font-medium">{formatDuration(duration)}</span>
                    </td>
                    <td className="py-3 px-3 text-center">
                      {breakCount > 0
                        ? <span className="inline-flex items-center justify-center min-w-[1.5rem] px-1.5 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 text-xs font-medium">{breakCount}</span>
                        : <span className="text-gray-500">0</span>}
                    </td>
                    <td className="py-3 px-3 text-gray-300 whitespace-nowrap">
                      {getTimePerFrame(task, task.taxonomy_id)}
                    </td>
                    <td className="py-3 px-3">
                      {min ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-gray-400 text-xs">Frame {min.index + 1}</span>
                          <span className="text-green-400 text-xs font-medium">{fmtSecs(min.seconds)}</span>
                        </div>
                      ) : placeholder}
                    </td>
                    <td className="py-3 px-3">
                      {max ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-gray-400 text-xs">Frame {max.index + 1}</span>
                          <span className="text-red-400 text-xs font-medium">{fmtSecs(max.seconds)}</span>
                        </div>
                      ) : placeholder}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};


// =============================================================================
// GOAL PROGRESS CARD
// =============================================================================

interface GoalProgressCardProps {
  goals: Array<{
    id: string;
    goal_type: string;
    target_value: number;
    current_value: number;
    progress_percentage: number;
    period_end: string;
  }>;
  onAddGoal?: () => void;
  onEditGoal?: (goal: GoalProgressCardProps['goals'][0]) => void;
  onRefresh?: () => void;
}

const GoalProgressCard: React.FC<GoalProgressCardProps> = ({ goals, onAddGoal, onEditGoal, onRefresh }) => {
  const getGoalLabel = (type: string) => {
    const labels: Record<string, string> = {
      daily_labels: 'Daily Labels',
      weekly_labels: 'Weekly Labels',
      monthly_labels: 'Monthly Labels',
      daily_hours: 'Daily Hours',
      weekly_tasks: 'Weekly Tasks',
      acceptance_rate: 'Acceptance Rate',
    };
    return labels[type] || type;
  };

  const deleteMutation = useMutation({
    mutationFn: (goalId: string) => efficiencyApi.deleteGoal(goalId),
    onSuccess: () => { onRefresh?.(); },
    onError: () => { alert('Failed to delete goal.'); },
  });

  const handleDelete = (goalId: string) => {
    if (confirm('Are you sure you want to delete this goal?')) {
      deleteMutation.mutate(goalId);
    }
  };

  const activeGoals = goals.filter(g => new Date(g.period_end) > new Date());

  return (
    <div className="bg-dark-surface rounded-xl border border-gray-700 p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Target className="w-5 h-5 text-blue-500" />
          <h3 className="text-lg font-medium text-white">My Goals</h3>
        </div>
        <button
          onClick={onAddGoal}
          className="p-1.5 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
          title="Add goal"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {activeGoals.length === 0 ? (
        <div className="text-center py-6 text-gray-500">
          <Target className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">No active goals</p>
          <button onClick={onAddGoal} className="mt-2 text-sm text-blue-400 hover:text-blue-300">
            Set a goal
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {activeGoals.map(goal => (
            <div key={goal.id} className="group">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm text-gray-300">{getGoalLabel(goal.goal_type)}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">
                    {Math.round(goal.current_value)} / {goal.target_value}
                  </span>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => onEditGoal?.(goal)} className="p-1 hover:bg-gray-700 rounded transition-colors" title="Edit">
                      <Pencil className="w-3 h-3 text-gray-400 hover:text-white" />
                    </button>
                    <button onClick={() => handleDelete(goal.id)} className="p-1 hover:bg-gray-700 rounded transition-colors" title="Delete">
                      <Trash2 className="w-3 h-3 text-gray-400 hover:text-red-500" />
                    </button>
                  </div>
                </div>
              </div>
              <div className="h-2.5 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    goal.progress_percentage >= 100
                      ? 'bg-gradient-to-r from-green-500 to-emerald-400'
                      : 'bg-gradient-to-r from-blue-500 to-indigo-400'
                  }`}
                  style={{ width: `${Math.min(goal.progress_percentage, 100)}%` }}
                />
              </div>
              {goal.progress_percentage >= 100 && (
                <div className="flex items-center gap-1 mt-1 text-green-400 text-xs">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Goal achieved!
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// GOAL CREATION MODAL
// =============================================================================

interface GoalCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const GoalCreationModal: React.FC<GoalCreationModalProps> = ({ isOpen, onClose, onSuccess }) => {
  const [goalType, setGoalType] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [targetValue, setTargetValue] = useState<number>(100);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const calculatePeriodDates = (type: 'daily' | 'weekly' | 'monthly') => {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    switch (type) {
      case 'daily':
        end.setDate(end.getDate() + 1);
        break;
      case 'weekly': {
        const daysUntilSunday = 7 - start.getDay();
        end.setDate(end.getDate() + daysUntilSunday);
        break;
      }
      case 'monthly':
        end.setMonth(end.getMonth() + 1);
        end.setDate(0);
        break;
    }
    return { period_start: start.toISOString(), period_end: end.toISOString() };
  };

  const getDaysRemaining = (type: 'daily' | 'weekly' | 'monthly') => {
    const { period_end } = calculatePeriodDates(type);
    const diff = Math.ceil((new Date(period_end).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return diff;
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      const { period_start, period_end } = calculatePeriodDates(goalType);
      await efficiencyApi.createGoal({
        goal_type: `${goalType}_labels`,
        target_value: targetValue,
        period_start,
        period_end,
      });
      onSuccess();
      onClose();
    } catch (error) {
      console.error('Failed to create goal:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-surface rounded-2xl border border-gray-700 w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 flex items-center justify-center">
              <Target className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-xl font-semibold text-white">Set a Goal</h2>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Period selection */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-3">Goal Period</label>
          <div className="grid grid-cols-3 gap-2">
            {(['daily', 'weekly', 'monthly'] as const).map((type) => (
              <button
                key={type}
                onClick={() => setGoalType(type)}
                className={`py-3 px-4 rounded-lg text-sm font-medium transition-all ${
                  goalType === type
                    ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/25'
                    : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
                }`}
              >
                {type.charAt(0).toUpperCase() + type.slice(1)}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500 mt-2">
            {getDaysRemaining(goalType)} days remaining in this {goalType} period
          </p>
        </div>

        {/* Target value */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-300 mb-3">Annotation Target</label>
          <div className="flex items-center gap-4">
            <input
              type="range" min="10" max="1000" step="10"
              value={targetValue}
              onChange={(e) => setTargetValue(Number(e.target.value))}
              className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
            />
            <input
              type="number" min="1" max="10000"
              value={targetValue}
              onChange={(e) => setTargetValue(Number(e.target.value) || 1)}
              className="w-20 bg-gray-800 border border-gray-600 rounded-lg px-3 py-2 text-white text-center text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <p className="text-xs text-gray-500 mt-2">
            That's about {Math.ceil(targetValue / Math.max(getDaysRemaining(goalType), 1))} annotations per day
          </p>
        </div>

        {/* Preview */}
        <div className="bg-gray-800/50 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-400">
              {goalType.charAt(0).toUpperCase() + goalType.slice(1)} Annotation Goal
            </span>
            <span className="text-sm font-medium text-blue-400">0%</span>
          </div>
          <div className="h-3 bg-gray-700 rounded-full overflow-hidden mb-2">
            <div className="h-full w-0 bg-gradient-to-r from-blue-500 to-indigo-400 rounded-full" />
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500">
            <span>0 / {targetValue} annotations</span>
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>{getDaysRemaining(goalType)} days left</span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-3 px-4 rounded-lg bg-gray-800 text-gray-300 font-medium hover:bg-gray-700 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="flex-1 py-3 px-4 rounded-lg bg-gradient-to-r from-blue-500 to-indigo-500 text-white font-medium hover:from-blue-600 hover:to-indigo-600 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-blue-500/25"
          >
            {isSubmitting ? 'Creating...' : 'Create Goal'}
          </button>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const formatTime = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

const MyDashboardPage: React.FC = () => {
  const [days, setDays] = useState(7);
  const [showGoalModal, setShowGoalModal] = useState(false);
  const currentOrgId = useCurrentOrganizationId();
  const { startTour } = useOnboardingStore();
  const queryClient = useQueryClient();

  // Get period label based on days
  const getPeriodLabel = (d: number) => {
    if (d === 1) return "Today's";
    if (d === 7) return "Last 7 Days";
    if (d === 14) return "Last 14 Days";
    if (d === 30) return "Last 30 Days";
    return `Last ${d} Days`;
  };

  // Legacy analytics data
  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['my-dashboard', days, currentOrgId],
    queryFn: () => analyticsApi.getMyDashboard(days, currentOrgId || undefined),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    refetchInterval: 30000,
  });

  // Efficiency stats
  const { data: efficiencyStats, isLoading: efficiencyLoading } = useQuery({
    queryKey: ['my-efficiency-stats', currentOrgId, days],
    queryFn: () => efficiencyApi.getMyEfficiencyStats(currentOrgId || undefined, days),
  });

  // Goals
  const { data: goals = [] } = useQuery({
    queryKey: ['my-goals'],
    queryFn: () => efficiencyApi.getMyGoals(false),
  });

  // My tasks — scoped to selected organization
  const { data: rawMyTasks = [], isLoading: tasksLoading } = useQuery({
    queryKey: ['my-dashboard-tasks', currentOrgId],
    queryFn: () => taskApi.list({ myTasks: true, pageSize: 100, organizationId: currentOrgId || undefined }),
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
  // Only show tasks that belong to a taxonomy (filter out legacy null-taxonomy tasks)
  const myTasks = rawMyTasks.filter((t: Task) => !!t.taxonomy_id);

  const isLoading = statsLoading || efficiencyLoading;

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex h-screen items-center justify-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      </AppLayout>
    );
  }

  const dailyStats = stats?.daily_stats || [];

  return (
    <AppLayout>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-white">My Dashboard</h1>
              {efficiencyStats && efficiencyStats.current_streak_days > 0 && (
                <StreakIndicator streakDays={efficiencyStats.current_streak_days} />
              )}
            </div>
            <p className="text-gray-400 text-sm mt-1">Your personal performance metrics</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => startTour('efficiency')}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded-lg text-amber-400 text-sm transition-colors"
            >
              <HelpCircle className="w-4 h-4" />
              Tour Efficiency Features
            </button>

            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary [&>option]:bg-gray-800 [&>option]:text-white"
            >
              <option value={1}>Today</option>
              <option value={7}>Last 7 Days</option>
              <option value={14}>Last 14 Days</option>
              <option value={30}>Last 30 Days</option>
            </select>
          </div>
        </div>

        {/* Today's Progress Banner */}
        {efficiencyStats && (
          <div className="bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-pink-500/10 rounded-xl border border-gray-700 p-5">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="w-5 h-5 text-blue-400" />
              <h2 className="text-lg font-semibold text-white">{getPeriodLabel(days)} Activity</h2>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
              <div>
                <div className="text-3xl font-bold text-white">{efficiencyStats.today_labels}</div>
                <div className="text-sm text-gray-400">Labels Created</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-white">{formatTime(efficiencyStats.today_active_time_seconds)}</div>
                <div className="text-sm text-gray-400">Active Time</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-white">{efficiencyStats.labels_per_hour}</div>
                <div className="text-sm text-gray-400">Labels/Hour</div>
              </div>
              <div>
                <div className="text-3xl font-bold text-white">{efficiencyStats.today_sessions}</div>
                <div className="text-sm text-gray-400">Sessions</div>
              </div>
            </div>
          </div>
        )}

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Week Labels"
            value={efficiencyStats?.week_labels || stats?.total_labels_created || 0}
            icon={<Target className="w-6 h-6" />}
            subtitle="This week"
            color="blue"
          />
          <StatCard
            title="Labels/Hour"
            value={efficiencyStats?.labels_per_hour || '--'}
            icon={<Zap className="w-6 h-6" />}
            subtitle="Current velocity"
            color="purple"
          />
          <StatCard
            title="Acceptance Rate"
            value={efficiencyStats?.acceptance_rate != null ? `${Math.round(efficiencyStats.acceptance_rate)}%` : '--'}
            icon={<CheckCircle2 className="w-6 h-6" />}
            subtitle="First-time accepts"
            color="green"
          />
          <StatCard
            title="Week Active Time"
            value={efficiencyStats ? formatTime(efficiencyStats.week_active_time_seconds) : '--'}
            icon={<Clock className="w-6 h-6" />}
            subtitle="Total work time"
            color="cyan"
          />
        </div>

        {/* My Tasks — full width above the chart grid */}
        <MyTasksTable tasks={myTasks} isLoading={tasksLoading} />

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* Left Column - Charts + Goals */}
          <div className="lg:col-span-3 space-y-6">
            {/* Throughput History */}
            <div className="bg-dark-surface rounded-xl border border-gray-700 p-5">
              <h3 className="text-lg font-medium text-white mb-6">Throughput History</h3>
              {dailyStats.length > 0 ? (
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dailyStats}>
                      <defs>
                        <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                        </linearGradient>
                        <linearGradient id="colorSubmitted" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3}/>
                          <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0}/>
                        </linearGradient>
                      </defs>
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
                      <Area
                        type="monotone"
                        dataKey="labels_created"
                        name="Created"
                        stroke="#3B82F6"
                        fillOpacity={1}
                        fill="url(#colorCreated)"
                      />
                      <Area
                        type="monotone"
                        dataKey="labels_submitted"
                        name="Submitted"
                        stroke="#8B5CF6"
                        fillOpacity={1}
                        fill="url(#colorSubmitted)"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="h-64 flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <Calendar className="w-10 h-10 mx-auto mb-2 opacity-50" />
                    <p className="mb-2">No annotation data for this period</p>
                    <p className="text-xs text-gray-600">Complete some annotation tasks to see your statistics here</p>
                  </div>
                </div>
              )}
            </div>

            {/* Goals Progress */}
            <GoalProgressCard
              goals={goals}
              onAddGoal={() => setShowGoalModal(true)}
              onRefresh={() => queryClient.invalidateQueries({ queryKey: ['my-goals'] })}
            />
          </div>

          {/* Right Column - Gamification */}
          <div className="space-y-6">
            {/* Achievements */}
            <AchievementsPanel />

            {/* Leaderboard */}
            <Leaderboard />

            {/* Team Challenges */}
            <TeamChallenges />
          </div>
        </div>

      </div>

      <GoalCreationModal
        isOpen={showGoalModal}
        onClose={() => setShowGoalModal(false)}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: ['my-goals'] })}
      />
    </AppLayout>
  );
};

export default MyDashboardPage;

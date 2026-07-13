import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { taskApi } from '@/api/client';
import type { Task, TaskStatus } from '@/types';
import { AppLayout } from '@/components/layout';
import { useAuthStore } from '@/store/authStore';
import { StageProgressPipeline, InlineStageStepper } from '@/components/workflow';


const statusColors: Record<TaskStatus, string> = {
  pending: 'bg-gray-500/20 text-gray-300 border-gray-500/30',
  assigned: 'bg-blue-500/20 text-blue-300 border-blue-500/30',
  in_progress: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
  submitted: 'bg-purple-500/20 text-purple-300 border-purple-500/30',
  accepted: 'bg-green-500/20 text-green-300 border-green-500/30',
  rejected: 'bg-red-500/20 text-red-300 border-red-500/30',
};

const StatusBadge: React.FC<{ status: TaskStatus }> = ({ status }) => (
  <span
    data-tour="task-status"
    className={`px-2 py-0.5 text-xs font-medium rounded border ${statusColors[status]}`}
  >
    {status.replace('_', ' ')}
  </span>
);

// =============================================================================
// TASK CARD - Enhanced with Stage Progress & Quick Actions
// =============================================================================

interface TaskCardProps {
  task: Task;
  onOpen: (taskId: string) => void;
  currentUserId?: string;
  isNewest?: boolean;
}

const TaskCard: React.FC<TaskCardProps> = ({
  task,
  onOpen,
  currentUserId: _currentUserId,
  isNewest = false,
}) => {
  const deadlineDate = task.deadline ? new Date(task.deadline) : null;
  const isOverdue = deadlineDate && deadlineDate < new Date();
  const daysUntilDeadline = deadlineDate
    ? Math.ceil((deadlineDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  // Status-based glow effects
  const statusGlow: Record<TaskStatus, string> = {
    pending: '',
    assigned: 'hover:shadow-blue-500/20',
    in_progress: 'ring-1 ring-yellow-500/30 hover:shadow-yellow-500/20',
    submitted: 'ring-1 ring-purple-500/30 hover:shadow-purple-500/20',
    accepted: 'ring-1 ring-emerald-500/30 hover:shadow-emerald-500/20',
    rejected: 'ring-2 ring-red-500/50 hover:shadow-red-500/20',
  };

  // ─── CHANGED ────────────────────────────────────────────────────────────────
  // The newest task gets the `animate-border-blink` class which pulses the
  // cyan border between full opacity and nearly invisible (1.4 s loop).
  // All other cards keep the plain gray border.
  const newestBorder = isNewest
    ? 'border-cyan-400 animate-border-blink shadow-[0_0_0_1px_rgba(34,211,238,0.25)]'
    : 'border-gray-700';
  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div
      className={`bg-dark-panel ${newestBorder} rounded-xl overflow-hidden transition-all group hover:border-cyan-500/50 hover:shadow-lg ${statusGlow[task.status]}`}
    >
      {/* Main Content Area */}
      <div className="p-5">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-white truncate group-hover:text-cyan-400 transition-colors">
                {task.name}
              </h3>
              {isNewest && (
                <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 rounded">
                  Latest
                </span>
              )}
              {task.revision_count > 0 &&
                task.stage !== 'customer_qa' &&
                task.stage !== 'accepted' && (
                  <span className="px-2 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded-full font-medium animate-pulse">
                    Revision #{task.revision_count}
                  </span>
                )}
            </div>
            {task.description && (
              <p className="text-sm text-gray-400 line-clamp-2">{task.description}</p>
            )}
          </div>
          <StatusBadge status={task.status} />
        </div>

        {/* Stage Progress Pipeline */}
        <div
          data-tour="task-stage"
          className="mb-4 p-3 bg-gray-800/30 rounded-lg border border-gray-700/30"
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500 font-medium">Stage Progress</span>
            <span className="text-xs text-gray-400 capitalize">
              {task.stage.replace('_', ' ')}
            </span>
          </div>
          <StageProgressPipeline
            currentStage={task.stage}
            currentStatus={task.status}
            revisionCount={task.revision_count}
            compact
            showLabels={false}
          />
        </div>

        {/* Taxonomy badge */}
        <div className="flex flex-wrap gap-1.5 mb-3">
          {task.taxonomy_name ? (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-teal-500/15 text-teal-300 border border-teal-500/30">
              {task.taxonomy_name}
            </span>
          ) : (
            <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-700/40 text-gray-500 border border-gray-600/30">
              No taxonomy
            </span>
          )}
        </div>

        {/* Details Grid */}
        <div className="grid grid-cols-2 gap-3 text-sm text-gray-400 mb-4">
          <div className="flex items-center gap-1.5">
            <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 4v16M17 4v16M3 8h4m10 0h4M3 12h18M3 16h4m10 0h4M4 20h16a1 1 0 001-1V5a1 1 0 00-1-1H4a1 1 0 00-1 1v14a1 1 0 001 1z"
              />
            </svg>
            <span className="truncate">
              Frames {task.frame_range.start + 1}-{task.frame_range.end + 1}
            </span>
          </div>

          {task.total_time_seconds > 0 && (
            <div className="flex items-center gap-1.5">
              <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>{Math.round(task.total_time_seconds / 60)}m spent</span>
            </div>
          )}
        </div>

        {/* Deadline Alert */}
        {deadlineDate && (
          <div
            className={`flex items-center gap-2 mb-4 px-3 py-2 rounded-lg ${
              isOverdue
                ? 'bg-red-500/10 border border-red-500/30 text-red-400'
                : daysUntilDeadline && daysUntilDeadline <= 2
                ? 'bg-yellow-500/10 border border-yellow-500/30 text-yellow-400'
                : 'bg-gray-800/50 text-gray-400'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <span className="text-sm font-medium">
              {isOverdue
                ? `⚠️ Overdue by ${Math.abs(daysUntilDeadline!)} days`
                : daysUntilDeadline === 0
                ? '⏰ Due today!'
                : `Due in ${daysUntilDeadline} days`}
            </span>
          </div>
        )}
      </div>

      {/* Actions Bar */}
      <div className="flex items-center justify-between px-5 py-3 bg-gray-900/30 border-t border-gray-700/50">
        {/* Quick Stage Actions */}
        <InlineStageStepper
          taskId={task.id}
          currentStage={task.stage}
          currentStatus={task.status}
          compact
        />

        {/* Open Button */}
        <button
          data-tour="task-open"
          onClick={() => onOpen(task.id)}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg font-medium transition-colors flex items-center gap-2 shadow-lg shadow-cyan-500/20"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
            />
          </svg>
          Open Editor
        </button>
      </div>
    </div>
  );
};

// =============================================================================
// FILTER TABS
// =============================================================================

// Tab definitions that map to actual workflow states:
// - all       : everything assigned to the user
// - active    : annotation stage, currently being worked on (assigned/in_progress)
// - submitted : qa or customer_qa stage — submitted for review, awaiting decision
// - revision  : annotation stage, returned after a QA rejection (revision_count > 0)
type FilterTab = 'all' | 'active' | 'submitted' | 'revision';

const FilterTabs: React.FC<{
  activeTab: FilterTab;
  onChange: (tab: FilterTab) => void;
  counts: Record<FilterTab, number>;
}> = ({ activeTab, onChange, counts }) => {
  const tabs: { key: FilterTab; label: string; color: string }[] = [
    { key: 'all', label: 'All Tasks', color: 'gray' },
    { key: 'active', label: 'Active', color: 'cyan' },
    { key: 'submitted', label: 'Awaiting Review', color: 'purple' },
    { key: 'revision', label: 'Needs Revision', color: 'red' },
  ];

  return (
    <div className="flex gap-2 mb-6">
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`px-4 py-2 rounded-lg font-medium transition-all ${
            activeTab === tab.key
              ? `bg-${tab.color}-500/20 text-${tab.color}-300 border border-${tab.color}-500/50`
              : 'bg-dark-panel text-gray-400 border border-gray-700 hover:border-gray-600'
          }`}
        >
          {tab.label}
          {counts[tab.key] > 0 && (
            <span className="ml-2 px-2 py-0.5 text-xs bg-black/30 rounded-full">
              {counts[tab.key]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
};


export const MyTasksPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [filterTab, setFilterTab] = useState<FilterTab>('all');

  const { data: tasks, isLoading, error, refetch } = useQuery({
    queryKey: ['my-tasks', user?.id],
    queryFn: () =>
      taskApi.list({
        pageSize: 100,
        myTasks: true,
      }),
    refetchInterval: 30000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
    enabled: !!user?.id,
  });

  const handleOpenTask = (taskId: string) => {
    navigate(`/tasks/${taskId}`);
  };

  const myTasks = (tasks ?? []).filter(t => {
    if (!t.taxonomy_id) return false; // skip legacy null-taxonomy tasks
    const involved =
      t.assignee_id === user?.id ||
      t.reviewer_id === user?.id ||
      t.customer_reviewer_id === user?.id;
    if (!involved) return false;
    if (t.stage === 'annotation' && t.status === 'pending' && t.revision_count === 0)
      return false;
    return true;
  });

  // Helpers that cover both annotator and reviewer roles:

  // Active: annotation stage work in progress (annotator role)
  const isActiveAnnotation = (task: Task) =>
    task.stage === 'annotation' &&
    ['assigned', 'in_progress'].includes(task.status) &&
    task.revision_count === 0;

  // Awaiting Review: submitted for QA — visible to both the annotator AND the reviewer
  const isAwaitingReview = (task: Task) =>
    task.stage === 'qa' || task.stage === 'customer_qa';

  // Needs Revision: rejected and back at annotation stage
  const isNeedsRevision = (task: Task) =>
    task.stage === 'annotation' && task.revision_count > 0;

  // Calculate filter counts based on workflow-accurate helpers
  const filterCounts: Record<FilterTab, number> = {
    all:       myTasks.length,
    active:    myTasks.filter(isActiveAnnotation).length,
    submitted: myTasks.filter(isAwaitingReview).length,
    revision:  myTasks.filter(isNeedsRevision).length,
  };

  // Apply filter using workflow-accurate helpers
  const filteredTasks = myTasks.filter(task => {
    switch (filterTab) {
      case 'active':    return isActiveAnnotation(task);
      case 'submitted': return isAwaitingReview(task);
      case 'revision':  return isNeedsRevision(task);
      default:          return true; // 'all'
    }
  });

  // Sort: revision tasks first (need attention), then in_progress, then assigned/pending,
  // then by priority, then by deadline, and finally by most recently active (newest first).
  const sortedTasks = [...filteredTasks].sort((a, b) => {
    // Revision tasks first (need rework)
    const aRevision = isNeedsRevision(a) ? 0 : 1;
    const bRevision = isNeedsRevision(b) ? 0 : 1;
    if (aRevision !== bRevision) return aRevision - bRevision;

    // In-progress before assigned/pending
    const statusOrder: Record<string, number> = { in_progress: 0, assigned: 1, pending: 2 };
    const aOrder = statusOrder[a.status] ?? 3;
    const bOrder = statusOrder[b.status] ?? 3;
    if (aOrder !== bOrder) return aOrder - bOrder;

    // Then by deadline (sooner first)
    if (a.deadline && b.deadline) {
      return new Date(a.deadline).getTime() - new Date(b.deadline).getTime();
    }
    if (a.deadline) return -1;
    if (b.deadline) return 1;

    // Finally: most recently active on top.
    // started_at beats assigned_at beats created_at — whichever is latest wins.
    const aTime = a.started_at ?? a.assigned_at ?? a.created_at;
    const bTime = b.started_at ?? b.assigned_at ?? b.created_at;
    return new Date(bTime).getTime() - new Date(aTime).getTime();
  });

  // The task at index 0 after sorting is the most recent — used to highlight its card.
  const newestTaskId = sortedTasks[0]?.id ?? null;

  // Header content
  const headerContent = (
    <div className="flex items-center justify-between w-full">
      <div className="flex items-center gap-4">
        <h1 className="text-xl font-bold text-white">My Tasks</h1>
        <span className="text-gray-400">|</span>
        <span className="text-gray-300">{user?.full_name || user?.username}</span>
      </div>
      <button
        onClick={() => refetch()}
        className="p-2 text-gray-400 hover:text-white transition-colors"
        title="Refresh tasks"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
      </button>
    </div>
  );

  // Loading state
  if (isLoading) {
    return (
      <AppLayout headerContent={headerContent}>
        <div className="flex items-center justify-center h-96">
          <div className="animate-spin rounded-full h-12 w-12 border-4 border-cyan-500 border-t-transparent"></div>
        </div>
      </AppLayout>
    );
  }

  // Error state
  if (error) {
    return (
      <AppLayout headerContent={headerContent}>
        <div className="flex flex-col items-center justify-center h-96 text-center">
          <svg className="w-16 h-16 text-red-500 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
          <h2 className="text-xl font-semibold text-white mb-2">Failed to load tasks</h2>
          <p className="text-gray-400 mb-4">{(error as Error).message}</p>
          <button
            onClick={() => refetch()}
            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg"
          >
            Retry
          </button>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout headerContent={headerContent}>
      <div className="p-6 max-w-6xl mx-auto">
        {/* Quick stats */}
        <div className="grid grid-cols-4 gap-4 mb-6">
          <div className="bg-dark-panel border border-gray-700 rounded-lg p-4">
            <div className="text-3xl font-bold text-cyan-400">{filterCounts.active}</div>
            <div className="text-sm text-gray-400">Active Tasks</div>
          </div>
          <div className="bg-dark-panel border border-gray-700 rounded-lg p-4">
            <div className="text-3xl font-bold text-purple-400">{filterCounts.submitted}</div>
            <div className="text-sm text-gray-400">Awaiting Review</div>
          </div>
          <div className="bg-dark-panel border border-gray-700 rounded-lg p-4">
            <div className="text-3xl font-bold text-red-400">{filterCounts.revision}</div>
            <div className="text-sm text-gray-400">Need Revision</div>
          </div>
          <div className="bg-dark-panel border border-gray-700 rounded-lg p-4">
            <div className="text-3xl font-bold text-green-400">
              {myTasks.filter(t => t.stage === 'accepted').length}
            </div>
            <div className="text-sm text-gray-400">Completed</div>
          </div>
        </div>

        {/* Filter tabs */}
        <FilterTabs activeTab={filterTab} onChange={setFilterTab} counts={filterCounts} />

        {/* Task list - wrapper always has data-tour for onboarding */}
        <div data-tour="task-list">
          {sortedTasks.length === 0 ? (
            <div className="text-center py-16">
              <svg
                className="w-16 h-16 mx-auto text-gray-600 mb-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1.5}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"
                />
              </svg>
              <h3 className="text-lg font-medium text-gray-400 mb-2">
                {filterTab === 'all'
                  ? 'No tasks assigned'
                  : filterTab === 'submitted'
                  ? 'No tasks awaiting review'
                  : filterTab === 'revision'
                  ? 'No tasks need revision'
                  : 'No active tasks'}
              </h3>
              <p className="text-gray-500">
                {filterTab === 'all'
                  ? 'Tasks assigned to you will appear here.'
                  : 'Switch tabs to view tasks in other states.'}
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              {sortedTasks.map(task => (
                <TaskCard
                  key={task.id}
                  task={task}
                  onOpen={handleOpenTask}
                  currentUserId={user?.id}
                  isNewest={task.id === newestTaskId}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </AppLayout>
  );
};

export default MyTasksPage;

// =============================================================================
// REQUIRED: global CSS  (e.g. src/index.css or src/globals.css)
// =============================================================================
//
// @keyframes border-blink {
//   0%, 100% {
//     border-color: rgba(34, 211, 238, 0.9);
//     box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.3), 0 0 14px rgba(34, 211, 238, 0.18);
//   }
//   50% {
//     border-color: rgba(34, 211, 238, 0.12);
//     box-shadow: 0 0 0 1px rgba(34, 211, 238, 0.04);
//   }
// }
//
// .animate-border-blink {
//   animation: border-blink 1.4s ease-in-out infinite;
// }
//
// =============================================================================
// REQUIRED: tailwind.config.js  (so the class survives production purge)
// =============================================================================
//
// module.exports = {
//   theme: {
//     extend: {
//       animation: {
//         'border-blink': 'border-blink 1.4s ease-in-out infinite',
//       },
//       keyframes: {
//         'border-blink': {
//           '0%, 100%': {
//             borderColor: 'rgba(34, 211, 238, 0.9)',
//             boxShadow:
//               '0 0 0 1px rgba(34,211,238,0.3), 0 0 14px rgba(34,211,238,0.18)',
//           },
//           '50%': {
//             borderColor: 'rgba(34, 211, 238, 0.12)',
//             boxShadow: '0 0 0 1px rgba(34,211,238,0.04)',
//           },
//         },
//       },
//     },
//   },
// };
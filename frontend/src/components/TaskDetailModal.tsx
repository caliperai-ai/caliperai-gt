import React, { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { taskApi, userApi, workflowApi } from '@/api/client';
import type { Task, TaskStage } from '@/types';
import { StageProgressPipeline, HorizontalTimeline, StageTransitionDiagram, convertAssignmentHistoryToEvents } from './workflow';

interface TaskDetailModalProps {
  isOpen: boolean;
  task: Task | null;
  onClose: () => void;
  taxonomyId?: string;
}

export const TaskDetailModal: React.FC<TaskDetailModalProps> = ({
  isOpen,
  task,
  onClose,
  taxonomyId,
}) => {
  const queryClient = useQueryClient();
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string>('');
  void selectedAssigneeId;
  const [localStatus, setLocalStatus] = useState<string>(task?.status || '');
  const [localStage, setLocalStage] = useState<TaskStage>('annotation');
  const [reviewNotes, setReviewNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [showAssignmentHistory, setShowAssignmentHistory] = useState(false);
  const [showTransitionDiagram, setShowTransitionDiagram] = useState(false);

  const invalidateAllTaskQueries = () => {
    queryClient.invalidateQueries({
      queryKey: ['task', currentTask?.id],
      refetchType: 'all'
    });
    queryClient.invalidateQueries({
      queryKey: ['tasks'],
      refetchType: 'all'
    });
    queryClient.invalidateQueries({
      queryKey: ['my-tasks'],
      refetchType: 'all'
    });
    queryClient.invalidateQueries({
      queryKey: ['scenes'],
      refetchType: 'all'
    });
    queryClient.invalidateQueries({
      queryKey: ['dataset-detail'],
      refetchType: 'all'
    });
    queryClient.invalidateQueries({
      queryKey: ['assignment-history', currentTask?.id],
      refetchType: 'all'
    });
    queryClient.invalidateQueries({
      queryKey: ['stage-history', currentTask?.id],
      refetchType: 'all'
    });
    queryClient.invalidateQueries({
      queryKey: ['workflow-info'],
      refetchType: 'all'
    });
  };

  const { data: liveTask } = useQuery({
    queryKey: ['task', task?.id],
    queryFn: () => task ? taskApi.get(task.id) : Promise.reject(),
    enabled: isOpen && !!task?.id,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
  });

  const currentTask = liveTask || task;

  const { data: taxonomyWorkflowInfo } = useQuery({
    queryKey: ['workflow-info', task?.id, taxonomyId],
    queryFn: () => task ? workflowApi.getInfo(task.id, taxonomyId) : Promise.reject(),
    enabled: isOpen && !!task?.id && !!taxonomyId,
    staleTime: 0,
    refetchOnMount: true,
  });

  const effectiveStage = (taxonomyId && taxonomyWorkflowInfo?.stage)
    ? (taxonomyWorkflowInfo.stage as TaskStage)
    : (currentTask?.stage as TaskStage) || 'annotation';

  const effectiveStatus = (taxonomyId && taxonomyWorkflowInfo?.status)
    ? taxonomyWorkflowInfo.status
    : currentTask?.status || 'pending';

  useEffect(() => {
    if (effectiveStatus) {
      setLocalStatus(effectiveStatus);
    }
  }, [effectiveStatus]);

  useEffect(() => {
    if (effectiveStage) {
      setLocalStage(effectiveStage);
    }
  }, [effectiveStage]);

  const { data: users = [] } = useQuery({
    queryKey: ['users'],
    queryFn: () => userApi.list(),
    enabled: isOpen,
  });

  const { data: assignmentHistory = [], isLoading: historyLoading } = useQuery({
    queryKey: ['assignment-history', currentTask?.id],
    queryFn: () => currentTask ? workflowApi.getAssignmentHistory(currentTask.id) : Promise.reject(),
    enabled: isOpen && !!currentTask?.id && showAssignmentHistory,
  });

  const { data: stageHistory = [], isLoading: stageHistoryLoading } = useQuery({
    queryKey: ['stage-history', currentTask?.id],
    queryFn: () => currentTask ? workflowApi.getHistory(currentTask.id) : Promise.reject(),
    enabled: isOpen && !!currentTask?.id && showTransitionDiagram,
  });

  const assignMutation = useMutation({
    mutationFn: (assigneeId: string) =>
      currentTask ? workflowApi.assignTask(currentTask.id, assigneeId, taxonomyId || undefined) : Promise.reject(),
    onSuccess: () => {
      invalidateAllTaskQueries();
      setError(null);
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || 'Failed to assign task');
    },
  });

  const unassignMutation = useMutation({
    mutationFn: () =>
      currentTask ? workflowApi.unassignTask(currentTask.id, taxonomyId || undefined) : Promise.reject(),
    onSuccess: () => {
      invalidateAllTaskQueries();
      setError(null);
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || 'Failed to unassign task');
    },
  });

  const assignReviewerMutation = useMutation({
    mutationFn: (reviewerId: string) =>
      currentTask ? workflowApi.assignReviewer(currentTask.id, reviewerId) : Promise.reject(),
    onSuccess: () => {
      invalidateAllTaskQueries();
      setError(null);
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || 'Failed to assign reviewer');
    },
  });

  const assignCustomerReviewerMutation = useMutation({
    mutationFn: (reviewerId: string) =>
      currentTask ? workflowApi.assignCustomerReviewer(currentTask.id, reviewerId) : Promise.reject(),
    onSuccess: () => {
      invalidateAllTaskQueries();
      setError(null);
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || 'Failed to assign customer reviewer');
    },
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      currentTask ? taskApi.updateStatus(currentTask.id, status, reviewNotes) : Promise.reject(),
    onSuccess: () => {
      invalidateAllTaskQueries();
      setError(null);
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || 'Failed to update status');
    },
  });

  const stageMutation = useMutation({
    mutationFn: (stage: TaskStage) =>
      currentTask
        ? workflowApi.setStage(currentTask.id, stage, taxonomyId)
        : Promise.reject(),
    onSuccess: () => {
      invalidateAllTaskQueries();
      if (taxonomyId) {
        queryClient.invalidateQueries({
          queryKey: ['workflow-info', currentTask?.id, taxonomyId],
          refetchType: 'all'
        });
      }
      setError(null);
    },
    onError: (err: any) => {
      setError(err.response?.data?.detail || 'Failed to update stage');
    },
  });

  const taskStatuses = ['pending', 'assigned', 'in_progress', 'submitted', 'accepted', 'rejected'];
  const taskStages: TaskStage[] = ['annotation', 'qa', 'customer_qa', 'accepted'] as const;

  const statusColors: Record<string, string> = {
    pending: 'bg-gray-600',
    assigned: 'bg-blue-600',
    in_progress: 'bg-yellow-600',
    submitted: 'bg-purple-600',
    accepted: 'bg-green-600',
    rejected: 'bg-red-600',
  };

  const stageColors: Record<string, string> = {
    annotation: 'bg-blue-500',
    qa: 'bg-orange-500',
    customer_qa: 'bg-purple-500',
    accepted: 'bg-green-500',
  };

  const handleAssign = async (userId: string) => {
    setSelectedAssigneeId(userId);
    await assignMutation.mutateAsync(userId);
  };

  const handleRemoveAssign = async () => {
    setSelectedAssigneeId('');
    try {
      await unassignMutation.mutateAsync();
    } catch (err) {
      await taskApi.update(currentTask!.id, { assignee_id: undefined as any });
      invalidateAllTaskQueries();
    }
  };

  const handleStatusChange = async (newStatus: string) => {
    if (effectiveStatus === newStatus || localStatus === newStatus) {
      return;
    }

    setLocalStatus(newStatus);
    try {
      await statusMutation.mutateAsync(newStatus);
    } catch (err) {
      console.error('[TaskDetailModal] Status update failed:', err);
      setLocalStatus(effectiveStatus || '');
    }
  };

  const handleStageChange = async (newStage: TaskStage) => {
    if (effectiveStage === newStage || localStage === newStage) {
      return;
    }

    setLocalStage(newStage);
    try {
      await stageMutation.mutateAsync(newStage);
    } catch (err) {
      console.error('[TaskDetailModal] Stage update failed:', err);
      setLocalStage(effectiveStage || 'annotation');
    }
  };

  if (!isOpen || !currentTask) return null;

  const effectiveAssigneeId = (taxonomyId && taxonomyWorkflowInfo?.assignee_id)
    ? taxonomyWorkflowInfo.assignee_id
    : currentTask.assignee_id;
  const assignee = users.find(u => u.id === effectiveAssigneeId);
  const reviewer = users.find(u => u.id === (currentTask as any).reviewer_id);
  const customerReviewer = users.find(u => u.id === (currentTask as any).customer_reviewer_id);

  const currentStageValue = effectiveStage || 'annotation';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />

      <div className="relative bg-dark-panel rounded-lg p-6 w-full max-w-2xl mx-4 shadow-xl border border-gray-700 max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-semibold text-white">{currentTask.name}</h2>
            <p className="text-sm text-gray-500 mt-1">
              Frames: {currentTask.frame_range.start + 1} - {currentTask.frame_range.end + 1}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white"
          >
            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Visual Stage Progress Pipeline */}
        <div className="mb-6 p-4 bg-gradient-to-r from-gray-800/50 to-gray-900/50 rounded-xl border border-gray-700/50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-300 flex items-center gap-2">
              <span>🔄</span> Stage Progress
              {(currentTask as any).revision_count > 0 && localStage !== 'customer_qa' && localStage !== 'accepted' && (
                <span className="px-1.5 py-0.5 text-[10px] bg-red-500/20 text-red-400 rounded font-medium">
                  {(currentTask as any).revision_count} revision{(currentTask as any).revision_count > 1 ? 's' : ''}
                </span>
              )}
            </h3>
            <span className="text-xs text-gray-500">
              Current: {localStage.replace('_', ' ')}
            </span>
          </div>
          <StageProgressPipeline
            currentStage={localStage}
            currentStatus={localStatus as any}
            revisionCount={(currentTask as any).revision_count || 0}
            showLabels={true}
          />
        </div>

        {error && (
          <div className="mb-4 p-3 bg-red-500/20 border border-red-500 rounded text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Current Status with Workflow */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Status Workflow</h3>

          {/* Status Workflow Visualization */}
          <div className="flex items-center gap-1.5 flex-wrap mb-4 p-3 bg-gray-800/50 rounded-lg">
            {taskStatuses.map((status, idx) => {
              const isActive = localStatus === status;
              const statusColor = statusColors[status];

              return (
                <React.Fragment key={status}>
                  <div
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                      isActive
                        ? `${statusColor} text-white ring-2 ring-offset-1 ring-offset-gray-800 ring-white/30`
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                    onClick={() => !statusMutation.isPending && handleStatusChange(status)}
                  >
                    {status.replace('_', ' ')}
                    {isActive && <span className="ml-1 text-xs">✓</span>}
                  </div>
                  {idx < taskStatuses.length - 1 && (
                    <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Status Dropdown */}
          <div className="relative">
            <label className="block text-xs text-gray-400 mb-1">Quick Change Status:</label>
            <select
              value={localStatus}
              onChange={(e) => handleStatusChange(e.target.value)}
              disabled={statusMutation.isPending}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {taskStatuses.map(status => (
                <option key={status} value={status}>
                  {status.replace('_', ' ')}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Review Notes (for rejected status) */}
        {(currentTask.status === 'rejected' || localStatus === 'rejected') && (
          <div className="mb-6">
            <label className="block text-sm font-semibold text-gray-300 mb-2">
              Review Notes
            </label>
            <textarea
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="Add notes about why this task was rejected..."
              className="w-full px-4 py-2 bg-dark border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-primary"
              rows={3}
            />
          </div>
        )}

        {/* Current Stage with Workflow */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Stage Workflow</h3>

          {/* Stage Workflow Visualization */}
          <div className="flex items-center gap-1.5 flex-wrap mb-4 p-3 bg-gray-800/50 rounded-lg">
            {taskStages.map((stage, idx) => {
              const isActive = localStage === stage;
              const stageColor = stageColors[stage];
              const stageLabels: Record<string, string> = {
                annotation: 'Annotation',
                qa: 'QA',
                customer_qa: 'Customer QA',
                accepted: 'Accepted',
              };

              return (
                <React.Fragment key={stage}>
                  <div
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-all cursor-pointer ${
                      isActive
                        ? `${stageColor} text-white ring-2 ring-offset-1 ring-offset-gray-800 ring-white/30`
                        : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                    }`}
                    onClick={() => !stageMutation.isPending && handleStageChange(stage)}
                  >
                    {stageLabels[stage]}
                    {isActive && <span className="ml-1 text-xs">✓</span>}
                  </div>
                  {idx < taskStages.length - 1 && (
                    <svg className="w-4 h-4 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                    </svg>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Stage Dropdown */}
          <div className="relative">
            <label className="block text-xs text-gray-400 mb-1">Quick Change Stage:</label>
            <select
              value={localStage}
              onChange={(e) => handleStageChange(e.target.value as any)}
              disabled={stageMutation.isPending}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="annotation">Annotation</option>
              <option value="qa">QA</option>
              <option value="customer_qa">Customer QA</option>
              <option value="accepted">Accepted</option>
            </select>
          </div>
        </div>

        {/* Assign to User - Stage-aware */}
        <div className="mb-6">
          <h3 className="text-sm font-semibold text-gray-300 mb-3">Assignment</h3>

          {/* Annotation Stage - Annotator Assignment */}
          {currentStageValue === 'annotation' && (
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">🎨 Annotator</label>
              {assignee ? (
                <div className="p-3 bg-blue-500/20 border border-blue-500 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{assignee.full_name || assignee.username}</p>
                      <p className="text-xs text-gray-400">{assignee.email}</p>
                    </div>
                    <button
                      onClick={handleRemoveAssign}
                      disabled={assignMutation.isPending}
                      className="px-3 py-1 text-xs bg-red-500 hover:bg-red-600 text-white rounded transition-colors disabled:opacity-50"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg mb-2">
                  <p className="text-xs text-yellow-300">⚠️ No annotator assigned. Please assign someone to start work.</p>
                </div>
              )}
              <select
                value={effectiveAssigneeId || ''}
                onChange={(e) => { if (e.target.value) handleAssign(e.target.value); }}
                disabled={assignMutation.isPending}
                className="w-full mt-2 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary disabled:opacity-50"
              >
                <option value="">-- Select Annotator --</option>
                {users.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.full_name || user.username} ({user.email})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* QA Stage - Reviewer Assignment */}
          {currentStageValue === 'qa' && (
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">🔍 QA Reviewer</label>
              {reviewer ? (
                <div className="p-3 bg-orange-500/20 border border-orange-500 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{reviewer.full_name || reviewer.username}</p>
                      <p className="text-xs text-gray-400">{reviewer.email}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg mb-2">
                  <p className="text-xs text-yellow-300">⚠️ No QA reviewer assigned. Please assign a reviewer.</p>
                </div>
              )}
              <select
                value={(currentTask as any).reviewer_id || ''}
                onChange={(e) => { if (e.target.value) assignReviewerMutation.mutate(e.target.value); }}
                disabled={assignReviewerMutation.isPending}
                className="w-full mt-2 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary disabled:opacity-50"
              >
                <option value="">-- Select QA Reviewer --</option>
                {users.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.full_name || user.username} ({user.email})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Customer QA Stage - Customer Reviewer Assignment */}
          {currentStageValue === 'customer_qa' && (
            <div className="mb-3">
              <label className="block text-xs text-gray-400 mb-1.5 font-medium">👁️ Customer QA Reviewer</label>
              {customerReviewer ? (
                <div className="p-3 bg-purple-500/20 border border-purple-500 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-white">{customerReviewer.full_name || customerReviewer.username}</p>
                      <p className="text-xs text-gray-400">{customerReviewer.email}</p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg mb-2">
                  <p className="text-xs text-yellow-300">⚠️ No customer reviewer assigned. Please assign a reviewer.</p>
                </div>
              )}
              <select
                value={(currentTask as any).customer_reviewer_id || ''}
                onChange={(e) => { if (e.target.value) assignCustomerReviewerMutation.mutate(e.target.value); }}
                disabled={assignCustomerReviewerMutation.isPending}
                className="w-full mt-2 px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:border-primary disabled:opacity-50"
              >
                <option value="">-- Select Customer Reviewer --</option>
                {users.map(user => (
                  <option key={user.id} value={user.id}>
                    {user.full_name || user.username} ({user.email})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Accepted Stage - No assignment needed */}
          {currentStageValue === 'accepted' && (
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
              <p className="text-xs text-emerald-300">✅ Task completed. No assignment needed.</p>
            </div>
          )}
        </div>

        {/* Stage Transition Diagram */}
        <div className="mb-6">
          <button
            onClick={() => setShowTransitionDiagram(!showTransitionDiagram)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-300 hover:text-white transition-colors mb-3"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showTransitionDiagram ? 'rotate-90' : ''}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
            <span>📊 Stage Transition Diagram</span>
            {stageHistory.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-400 rounded">
                {stageHistory.length} transitions
              </span>
            )}
          </button>

          {showTransitionDiagram && (
            <div className="bg-gray-800/30 rounded-xl border border-gray-700/50 p-4 overflow-hidden">
              <StageTransitionDiagram
                history={stageHistory}
                isLoading={stageHistoryLoading}
              />
            </div>
          )}
        </div>

        {/* Assignment History - Horizontal Timeline */}
        <div className="mb-6">
          <button
            onClick={() => setShowAssignmentHistory(!showAssignmentHistory)}
            className="flex items-center gap-2 text-sm font-semibold text-gray-300 hover:text-white transition-colors mb-3"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showAssignmentHistory ? 'rotate-90' : ''}`}
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                clipRule="evenodd"
              />
            </svg>
            <span>📜 Workflow History Timeline</span>
            {assignmentHistory.length > 0 && (
              <span className="ml-2 px-1.5 py-0.5 text-[10px] bg-cyan-500/20 text-cyan-400 rounded">
                {assignmentHistory.length} events
              </span>
            )}
          </button>

          {showAssignmentHistory && (
            <div className="bg-gray-800/30 rounded-xl border border-gray-700/50 overflow-hidden">
              <HorizontalTimeline
                events={convertAssignmentHistoryToEvents(assignmentHistory)}
                isLoading={historyLoading}
                emptyMessage="No workflow history yet. Events will appear as the task progresses through stages."
              />
            </div>
          )}
        </div>

        {/* Close Button */}
        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

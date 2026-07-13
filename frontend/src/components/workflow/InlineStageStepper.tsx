import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { taskApi } from '@/api/client';
import type { TaskStage, TaskStatus } from '@/types';

interface InlineStageStepperProps {
  taskId: string;
  currentStage: TaskStage;
  currentStatus: TaskStatus;
  compact?: boolean;
  onUpdate?: () => void;
  disabled?: boolean;
}

const STAGE_ORDER: TaskStage[] = ['annotation', 'qa', 'customer_qa', 'accepted'];

const VALID_ACTIONS: Record<TaskStage, Record<TaskStatus, {
  primary?: { action: 'submit' | 'accept' | 'reject' | 'start' | 'nextStage'; label: string; color: string };
  secondary?: { action: 'submit' | 'accept' | 'reject' | 'start' | 'prevStage'; label: string; color: string };
}>> = {
  annotation: {
    pending: {
      primary: { action: 'start', label: 'Start', color: 'bg-blue-500 hover:bg-blue-600' },
    },
    assigned: {
      primary: { action: 'start', label: 'Start Work', color: 'bg-blue-500 hover:bg-blue-600' },
    },
    in_progress: {
      primary: { action: 'submit', label: 'Submit', color: 'bg-purple-500 hover:bg-purple-600' },
    },
    submitted: {},
    accepted: {
      primary: { action: 'nextStage', label: 'Send to QA', color: 'bg-orange-500 hover:bg-orange-600' },
    },
    rejected: {
      primary: { action: 'start', label: 'Revise', color: 'bg-yellow-500 hover:bg-yellow-600' },
    },
  },
  qa: {
    pending: {},
    assigned: {
      primary: { action: 'start', label: 'Start QA', color: 'bg-orange-500 hover:bg-orange-600' },
    },
    in_progress: {
      primary: { action: 'accept', label: 'Approve', color: 'bg-emerald-500 hover:bg-emerald-600' },
      secondary: { action: 'reject', label: 'Reject', color: 'bg-red-500 hover:bg-red-600' },
    },
    submitted: {
      primary: { action: 'accept', label: 'Accept', color: 'bg-emerald-500 hover:bg-emerald-600' },
      secondary: { action: 'reject', label: 'Reject', color: 'bg-red-500 hover:bg-red-600' },
    },
    accepted: {
      primary: { action: 'nextStage', label: 'Customer QA', color: 'bg-purple-500 hover:bg-purple-600' },
      secondary: { action: 'prevStage', label: 'Back', color: 'bg-gray-500 hover:bg-gray-600' },
    },
    rejected: {},
  },
  customer_qa: {
    pending: {},
    assigned: {
      primary: { action: 'start', label: 'Start Review', color: 'bg-purple-500 hover:bg-purple-600' },
    },
    in_progress: {
      primary: { action: 'accept', label: 'Approve', color: 'bg-emerald-500 hover:bg-emerald-600' },
      secondary: { action: 'reject', label: 'Request Changes', color: 'bg-red-500 hover:bg-red-600' },
    },
    submitted: {
      primary: { action: 'accept', label: 'Final Accept', color: 'bg-emerald-500 hover:bg-emerald-600' },
      secondary: { action: 'reject', label: 'Request Changes', color: 'bg-red-500 hover:bg-red-600' },
    },
    accepted: {
      primary: { action: 'nextStage', label: 'Complete ✓', color: 'bg-emerald-500 hover:bg-emerald-600' },
    },
    rejected: {},
  },
  accepted: {
    pending: {},
    assigned: {},
    in_progress: {},
    submitted: {},
    accepted: {},
    rejected: {},
  },
};

export const InlineStageStepper: React.FC<InlineStageStepperProps> = ({
  taskId,
  currentStage,
  currentStatus,
  compact = false,
  onUpdate,
  disabled = false,
}) => {
  const queryClient = useQueryClient();
  const [isLoading, setIsLoading] = useState(false);

  const actions = VALID_ACTIONS[currentStage]?.[currentStatus] || {};

  const statusMutation = useMutation({
    mutationFn: (status: string) => taskApi.updateStatus(taskId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['scenes'] });
      queryClient.invalidateQueries({ queryKey: ['dataset-detail'] });
      onUpdate?.();
    },
  });

  const stageMutation = useMutation({
    mutationFn: (stage: TaskStage) => taskApi.updateStage(taskId, stage),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['scenes'] });
      queryClient.invalidateQueries({ queryKey: ['dataset-detail'] });
      onUpdate?.();
    },
  });

  const handleAction = async (action: string) => {
    if (disabled || isLoading) return;

    setIsLoading(true);
    try {
      switch (action) {
        case 'start':
          await statusMutation.mutateAsync('in_progress');
          break;
        case 'submit':
          await statusMutation.mutateAsync('submitted');
          break;
        case 'accept':
          await statusMutation.mutateAsync('accepted');
          break;
        case 'reject':
          await statusMutation.mutateAsync('rejected');
          break;
        case 'nextStage': {
          const currentIndex = STAGE_ORDER.indexOf(currentStage);
          if (currentIndex < STAGE_ORDER.length - 1) {
            await stageMutation.mutateAsync(STAGE_ORDER[currentIndex + 1]);
          }
          break;
        }
        case 'prevStage': {
          const currentIndex = STAGE_ORDER.indexOf(currentStage);
          if (currentIndex > 0) {
            await stageMutation.mutateAsync(STAGE_ORDER[currentIndex - 1]);
          }
          break;
        }
      }
    } finally {
      setIsLoading(false);
    }
  };

  if (!actions.primary && !actions.secondary) {
    return null;
  }

  return (
    <div className={`flex items-center ${compact ? 'gap-1' : 'gap-2'}`}>
      {/* Secondary Action (less prominent) */}
      {actions.secondary && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleAction(actions.secondary!.action);
          }}
          disabled={disabled || isLoading}
          className={`
            ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'}
            ${actions.secondary.color}
            text-white rounded-lg font-medium
            transition-all duration-200
            disabled:opacity-50 disabled:cursor-not-allowed
            hover:shadow-lg
          `}
        >
          {isLoading ? (
            <span className="flex items-center gap-1">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </span>
          ) : (
            actions.secondary.label
          )}
        </button>
      )}

      {/* Primary Action */}
      {actions.primary && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            handleAction(actions.primary!.action);
          }}
          disabled={disabled || isLoading}
          className={`
            ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'}
            ${actions.primary.color}
            text-white rounded-lg font-medium
            transition-all duration-200
            disabled:opacity-50 disabled:cursor-not-allowed
            hover:shadow-lg
            ${actions.primary.action === 'nextStage' || actions.primary.action === 'accept' ? 'ring-1 ring-white/20' : ''}
          `}
        >
          {isLoading ? (
            <span className="flex items-center gap-1">
              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            </span>
          ) : (
            actions.primary.label
          )}
        </button>
      )}
    </div>
  );
};

// Compact icon-only version for tight spaces
export const InlineStageStepperIcons: React.FC<InlineStageStepperProps> = (props) => {
  return <InlineStageStepper {...props} compact />;
};

export default InlineStageStepper;

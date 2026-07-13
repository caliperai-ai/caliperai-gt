import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { taskApi, annotation3DApi } from '@/api/client';
import { useEditorStore } from '@/store/editorStore';
import { useAnnotation4DStore } from '@/store/annotation4DStore';
import type { ViewMode } from './types';
import type { Task } from '@/types';

interface HeaderProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
}

interface SubmissionModalProps {
  isOpen: boolean;
  nextTask: Task | null;
  isLoadingNextTask: boolean;
  onOpenNextTask: () => void;
  onGoToTaskList: () => void;
  onClose: () => void;
}

const SubmissionModal: React.FC<SubmissionModalProps> = ({
  isOpen,
  nextTask,
  isLoadingNextTask,
  onOpenNextTask,
  onGoToTaskList,
  onClose: _onClose,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-dark-panel border border-gray-600 rounded-xl shadow-2xl max-w-md w-full mx-4 overflow-hidden">
        {/* Header */}
        <div className="bg-green-600/20 border-b border-green-600/30 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-600 rounded-full flex items-center justify-center">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Task Submitted!</h2>
              <p className="text-sm text-green-300">Your work has been sent for review</p>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="px-6 py-5">
          {isLoadingNextTask ? (
            <div className="flex items-center gap-3 text-gray-400">
              <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              <span>Checking for next task...</span>
            </div>
          ) : nextTask ? (
            <div>
              <p className="text-gray-300 mb-4">
                Would you like to start your next assigned task?
              </p>
              <div className="bg-dark rounded-lg p-3 border border-gray-700">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium text-white">{nextTask.name}</h3>
                    <p className="text-sm text-gray-400 mt-1">
                      Frames {nextTask.frame_range.start + 1} - {nextTask.frame_range.end + 1}
                    </p>
                  </div>
                  <span className="px-2 py-0.5 text-xs font-medium rounded bg-blue-500/20 text-blue-300 border border-blue-500/30">
                    {nextTask.status.replace('_', ' ')}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="text-center py-4">
              <div className="w-12 h-12 bg-gray-700 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-gray-300 font-medium">All caught up!</p>
              <p className="text-sm text-gray-500 mt-1">
                No more tasks are currently assigned to you.
              </p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="px-6 py-4 bg-dark/50 border-t border-gray-700 flex gap-3">
          {nextTask ? (
            <>
              <button
                onClick={onGoToTaskList}
                className="flex-1 px-4 py-2.5 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 font-medium transition-colors"
              >
                Go to Task List
              </button>
              <button
                onClick={onOpenNextTask}
                className="flex-1 px-4 py-2.5 rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 font-medium transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                </svg>
                Open Next Task
              </button>
            </>
          ) : (
            <button
              onClick={onGoToTaskList}
              className="flex-1 px-4 py-2.5 rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 font-medium transition-colors"
            >
              Go to Task List
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export const Header: React.FC<HeaderProps> = ({ viewMode, setViewMode }) => {
  const { task, isSaving, hasUnsavedChanges, saveAnnotations, setAnnotations } = useEditorStore();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<boolean>(false);
  const [isMigrating, setIsMigrating] = useState(false);

  const [showSubmissionModal, setShowSubmissionModal] = useState(false);
  const [nextTask, setNextTask] = useState<Task | null>(null);
  const [isLoadingNextTask, setIsLoadingNextTask] = useState(false);

  const annotations4D = useAnnotation4DStore((s) => s.annotations4D);
  const saveAnnotations4D = useAnnotation4DStore((s) => s.saveAnnotations4D);
  const migrateToAnnotations = useAnnotation4DStore((s) => s.migrateToAnnotations);

  const has4DAnnotations = useMemo(() => {
    return Array.from(annotations4D.values()).some(a => !a.is_deleted);
  }, [annotations4D]);

  const hasUnsaved4DChanges = useMemo(() => {
    return Array.from(annotations4D.values()).some(a => a.is_new || a.is_dirty || a.is_deleted);
  }, [annotations4D]);

  const statusMutation = useMutation({
    mutationFn: ({ status }: { status: string }) =>
      taskApi.updateStatus(task!.id, status),
    onSuccess: async () => {
      setIsLoadingNextTask(true);
      setShowSubmissionModal(true);

      try {
        const next = await taskApi.getNextAssignedTask(task?.id);
        setNextTask(next);
      } catch (err) {
        console.error('Failed to fetch next task:', err);
        setNextTask(null);
      } finally {
        setIsLoadingNextTask(false);
      }
    },
  });

  const handleOpenNextTask = () => {
    if (nextTask) {
      setShowSubmissionModal(false);
      navigate(`/tasks/${nextTask.id}`);
    }
  };

  // Handle going to task list
  const handleGoToTaskList = () => {
    setShowSubmissionModal(false);
    navigate('/my-tasks');
  };

  // Handle closing modal (same as going to task list)
  const handleCloseModal = () => {
    handleGoToTaskList();
  };

  const handleSave = async () => {
    setSaveError(null);
    setSaveSuccess(false);
    const result = await saveAnnotations();
    if (!result.success) {
      setSaveError(result.error || 'Failed to save');
    } else {
      // Refetch annotations to sync with backend after successful save
      await queryClient.invalidateQueries({ queryKey: ['annotations', task?.id] });
      setSaveSuccess(true);
      // Hide success message after 3 seconds
      setTimeout(() => setSaveSuccess(false), 3000);
    }
  };

  // Handle 4D Save & Migrate: Save 4D annotations, then migrate to 3D
  const handleSave4D = async () => {
    if (!task) return;

    setSaveError(null);
    setSaveSuccess(false);
    setIsMigrating(true);

    try {
      // Step 1: Save any pending 4D annotation changes
      if (hasUnsaved4DChanges) {
        const saveResult = await saveAnnotations4D();
        if (!saveResult.success) {
          setSaveError(saveResult.error || 'Failed to save 4D annotations');
          setIsMigrating(false);
          return;
        }
      }

      // Step 2: Migrate 4D annotations to 3D (creates one annotation per frame)
      if (has4DAnnotations) {
        const migrateResult = await migrateToAnnotations(task.id);
        if (!migrateResult.success) {
          setSaveError(migrateResult.error || 'Failed to migrate to 3D');
          setIsMigrating(false);
          return;
        }

        // Step 3: Reload annotations from Annotation3D table to see migrated ones
        const freshAnnotations = await annotation3DApi.list(task.id);
        // Convert to the format expected by setAnnotations
        const formattedAnnotations = freshAnnotations.map((ann: any) => ({
          ...ann,
          id: ann.id.toString(),
          task_id: ann.task_id.toString(),
          frame_id: ann.frame_id.toString(),
          track_id: ann.track_id?.toString() || null,
        }));
        setAnnotations(formattedAnnotations);

      }

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Migration failed');
    } finally {
      setIsMigrating(false);
    }
  };

  const handleSubmit = async () => {
    if (task) {
      // In 4D mode, migrate first
      if (viewMode === '4d' && has4DAnnotations) {
        await handleSave4D();
      }
      // Save first, then submit
      const saveResult = await saveAnnotations();
      if (saveResult.success) {
        statusMutation.mutate({ status: 'submitted' });
      } else {
        setSaveError(saveResult.error || 'Failed to save before submit');
      }
    }
  };

  const hasDirtyChanges = hasUnsavedChanges();

  return (
    <div className="absolute top-0 left-0 right-0 h-12 z-40 bg-dark-panel/95 backdrop-blur-sm border-b border-gray-700">
      <div className="h-full flex items-center justify-between px-4">
        {/* Left */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate(-1)}
            className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-dark-hover"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>
          <div className="h-6 w-px bg-gray-700" />
          <div>
            <h1 className="text-white font-medium text-sm">{task?.name ?? 'Loading...'}</h1>
            {task && (
              <span className={`text-xs px-2 py-0.5 rounded ${
                task.status === 'assigned' ? 'bg-blue-500/20 text-blue-400' :
                task.status === 'accepted' ? 'bg-yellow-500/20 text-yellow-400' :
                task.status === 'rejected' ? 'bg-red-500/20 text-red-400' :
                'bg-gray-500/20 text-gray-400'
              }`}>
                {task.status.replace('_', ' ')}
              </span>
            )}
          </div>
        </div>

        {/* Center: View Mode */}
        <div className="flex items-center bg-dark rounded-lg p-0.5">
          {(['3d', 'fusion', '4d', '2d'] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                viewMode === mode
                  ? mode === '4d' ? 'bg-purple-600 text-white' : 'bg-primary text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
              title={mode === '4d' ? 'Stack multiple LiDAR scans for static object labeling' : undefined}
            >
              {mode === 'fusion' ? 'FUSION' : mode.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Right */}
        <div className="flex items-center gap-2">
          {saveSuccess && (
            <span className="text-xs text-green-400 mr-2">✓ Saved</span>
          )}
          {saveError && (
            <span className="text-xs text-red-400 mr-2">{saveError}</span>
          )}

          {/* 4D Mode: Show Save & Migrate button */}
          {viewMode === '4d' ? (
            <>
              {has4DAnnotations && (
                <span className="text-xs text-purple-400 mr-2">
                  {annotations4D.size} 4D annotations
                </span>
              )}
              <button
                onClick={handleSave4D}
                disabled={isMigrating || (!hasUnsaved4DChanges && !has4DAnnotations)}
                className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
                  (hasUnsaved4DChanges || has4DAnnotations)
                    ? 'bg-purple-600 text-white hover:bg-purple-500'
                    : 'text-gray-300 hover:bg-dark-hover'
                } disabled:opacity-50`}
                title="Save 4D annotations and migrate to 3D annotations for each frame"
              >
                {isMigrating ? 'Migrating...' : hasUnsaved4DChanges ? 'Save & Migrate*' : 'Save & Migrate'}
              </button>
            </>
          ) : (
            /* Regular mode: Standard Save button */
            <button
              onClick={handleSave}
              disabled={isSaving || !hasDirtyChanges}
              className={`px-4 py-1.5 rounded-lg text-sm transition-colors ${
                hasDirtyChanges
                  ? 'bg-amber-600 text-white hover:bg-amber-500'
                  : 'text-gray-300 hover:bg-dark-hover'
              } disabled:opacity-50`}
            >
              {isSaving ? 'Saving...' : hasDirtyChanges ? 'Save*' : 'Save'}
            </button>
          )}

          <button
            onClick={handleSubmit}
            className="px-4 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 text-sm disabled:opacity-50"
            disabled={!task || !['assigned', 'in_progress'].includes(task.status) || isSaving || isMigrating}
          >
            Submit
          </button>
        </div>
      </div>

      {/* Submission Success Modal */}
      <SubmissionModal
        isOpen={showSubmissionModal}
        nextTask={nextTask}
        isLoadingNextTask={isLoadingNextTask}
        onOpenNextTask={handleOpenNextTask}
        onGoToTaskList={handleGoToTaskList}
        onClose={handleCloseModal}
      />
    </div>
  );
};

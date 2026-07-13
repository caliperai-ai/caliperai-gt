import { useState, useMemo } from 'react';
import { taskApi } from '@/api/client';
// @ts-ignore - Crypto UUID import not used in component
import type { UUID } from 'crypto';

interface Task {
  name: string;
  frame_start: number;
  frame_end: number;
  assignee_id: string;
}

interface ExistingTask {
  id: string;
  name: string;
}

interface Annotator {
  id: string;
  name: string;
  role?: string;
}

interface TaskCreationModalProps {
  sceneId: string;
  sceneName: string;
  datasetName?: string;
  frameCount: number;
  onClose: () => void;
  onTasksCreated: () => void;
  annotators: Annotator[];
  existingTasks?: ExistingTask[];
  taxonomyId?: string;
  taxonomyName?: string;
}

export default function TaskCreationModal({
  sceneId,
  sceneName,
  datasetName,
  frameCount,
  onClose,
  onTasksCreated,
  annotators,
  existingTasks = [],
  taxonomyId,
  taxonomyName,
}: TaskCreationModalProps) {
  const [numTasks, setNumTasks] = useState(2);
  const [overlapFrames, setOverlapFrames] = useState(5);
  const [taskAssignees, setTaskAssignees] = useState<Record<number, string>>({});
  const [deadline, setDeadline] = useState('');
  const [loading, setLoading] = useState(false);
  const [taskPrefix, setTaskPrefix] = useState<string>('Annot');
  const [replaceExisting, setReplaceExisting] = useState(existingTasks.length === 1);

  const shortSceneName = useMemo(() => {
    const parts = sceneName.split(/[/\\-_]/);
    const lastPart = parts[parts.length - 1] || sceneName;
    return lastPart.substring(0, 15);
  }, [sceneName]);

  const taxSuffix = taxonomyName ? `_${taxonomyName.replace(/\s+/g, '').substring(0, 10)}` : '';

  // Calculate frame ranges based on number of tasks and overlap
  const tasks = useMemo(() => {
    if (numTasks <= 0) return [];

    const tasks: Task[] = [];

    if (numTasks === 1) {
      // Single task covers entire scene - use frame range in name
      const assignee = annotators.find(a => a.id === taskAssignees[0]);
      const assigneePart = assignee ? `_${assignee.name.split(' ')[0]}` : '';
      tasks.push({
        name: `${taskPrefix}_${shortSceneName}_F1-${frameCount}${taxSuffix}${assigneePart}`,
        frame_start: 0,
        frame_end: frameCount - 1,
        assignee_id: taskAssignees[0] || '',
      });
    } else {
      // Multiple tasks with overlap
      // Total frames needed = numTasks * framesPerTask - (numTasks - 1) * overlapFrames = frameCount
      // Solving: framesPerTask = (frameCount + (numTasks - 1) * overlapFrames) / numTasks
      const totalOverlap = overlapFrames * (numTasks - 1);
      const framesPerTask = Math.ceil((frameCount + totalOverlap) / numTasks);

      for (let i = 0; i < numTasks; i++) {
        // Each task starts at: previous_task_end - overlapFrames + 1
        // Which simplifies to: i * (framesPerTask - overlapFrames)
        let frame_start = i * (framesPerTask - overlapFrames);
        let frame_end = frame_start + framesPerTask - 1;

        // Adjust last task to end at the last frame
        if (i === numTasks - 1) {
          frame_end = frameCount - 1;
        }

        // Ensure we don't exceed scene bounds
        frame_end = Math.min(frame_end, frameCount - 1);
        frame_start = Math.max(0, frame_start);

        // Generate intuitive name with frame range (1-indexed for display) and optional assignee
        const assignee = annotators.find(a => a.id === taskAssignees[i]);
        const assigneePart = assignee ? `_${assignee.name.split(' ')[0]}` : '';
        // Format: {Prefix}_{Scene}_F{start}-{end}_{Assignee}
        // Examples: Annot_Urban_F1-100_Alice, Label_Highway_F101-200_Bob
        tasks.push({
          name: `${taskPrefix}_${shortSceneName}_F${frame_start + 1}-${frame_end + 1}${taxSuffix}${assigneePart}`,
          frame_start,
          frame_end,
          assignee_id: taskAssignees[i] || '',
        });
      }
    }

    return tasks;
  }, [numTasks, overlapFrames, frameCount, shortSceneName, taskAssignees, annotators, taskPrefix, taxSuffix]);

  const updateTaskAssignee = (index: number, assignee_id: string) => {
    setTaskAssignees({ ...taskAssignees, [index]: assignee_id });
  };

  const annotatorRoleUsers = useMemo(
    () => annotators.filter(a => a.role === 'annotator'),
    [annotators]
  );

  const handleAutoAssign = () => {
    if (annotatorRoleUsers.length === 0) {
      alert('No users with the "annotator" role are available to assign.');
      return;
    }
    const next: Record<number, string> = {};
    for (let i = 0; i < numTasks; i++) {
      next[i] = annotatorRoleUsers[i % annotatorRoleUsers.length].id;
    }
    setTaskAssignees(next);
  };

  const handleCreateTasks = async () => {
    setLoading(true);
    try {
      let deadlineISO: string | undefined;
      if (deadline && deadline.trim()) {
        const d = new Date(deadline);
        if (!isNaN(d.getTime())) deadlineISO = d.toISOString();
      }

      // Single existing task + replace = split (preserves annotations)
      if (replaceExisting && existingTasks.length === 1 && tasks.length > 1) {
        const subTasks = tasks.map(t => ({
          name: t.name,
          frame_start: Math.max(0, t.frame_start),
          frame_end: Math.min(t.frame_end, frameCount - 1),
        }));
        await taskApi.split(existingTasks[0].id, subTasks);
        await onTasksCreated();
        onClose();
        return;
      }

      // Multiple existing tasks: delete them first if replace is on
      if (replaceExisting && existingTasks.length > 0) {
        for (const existingTask of existingTasks) {
          try { await taskApi.delete(existingTask.id); } catch {}
        }
      }

      // Create new tasks
      for (const task of tasks) {
        const frameStart = Math.max(0, task.frame_start);
        const frameEnd = Math.min(task.frame_end, frameCount - 1);
        const payload = {
          scene_id: sceneId,
          taxonomy_id: taxonomyId ?? undefined,
          name: task.name,
          description: `Frames ${frameStart + 1}-${frameEnd + 1}`,
          frame_range: { start: frameStart, end: frameEnd },
          context_buffer_before: 0,
          context_buffer_after: 0,
          priority: 5,
          deadline: deadlineISO,
          config: {
            required_annotation_types: [],
            required_classes: [],
            auto_annotation_enabled: true,
            quality_checks: [],
          },
        };
        const taskData = await taskApi.create(payload);
        if (task.assignee_id) {
          try { await taskApi.assign(taskData.id, task.assignee_id); } catch {}
        }
      }

      await onTasksCreated();
      onClose();
    } catch (error) {
      console.error('Error creating tasks:', error);
      alert(`Failed to create tasks: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-dark-panel rounded-lg p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto border border-gray-700">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-gray-500 mb-3 pb-3 border-b border-gray-700">
          {datasetName && (
            <>
              <span className="text-purple-400">📊 Dataset</span>
              <span>→</span>
              <span className="text-white truncate max-w-[100px]" title={datasetName}>{datasetName}</span>
              <span>→</span>
            </>
          )}
          <span className="text-amber-400">🎬 Scene</span>
          <span>→</span>
          <span className="text-white font-medium truncate max-w-[150px]" title={sceneName}>{sceneName}</span>
          <span>→</span>
          <span className="text-green-400">📋 New Tasks</span>
        </div>

        <h2 className="text-xl font-semibold text-white mb-1">Create Annotation Tasks</h2>
        <p className="text-gray-400 text-sm mb-4">
          Scene: <span className="text-white">{sceneName}</span> •
          <span className="ml-2">{frameCount} frames</span>
          {existingTasks.length > 0 && (
            <span className="ml-2 text-amber-400">• {existingTasks.length} existing task{existingTasks.length > 1 ? 's' : ''}</span>
          )}
        </p>

        {/* Smart naming info */}
        <div className="mb-4 p-3 bg-gradient-to-r from-green-500/10 to-emerald-500/10 border border-green-500/30 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-2 text-sm text-green-300">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              <span>Smart Naming</span>
            </div>
            <select
              value={taskPrefix}
              onChange={(e) => setTaskPrefix(e.target.value)}
              className="ml-auto text-xs bg-dark border border-gray-600 rounded px-2 py-1 text-white"
            >
              <option value="Annot">Annot (Annotation)</option>
              <option value="Label">Label (Labeling)</option>
              <option value="QA">QA (Quality Check)</option>
              <option value="Review">Review</option>
              <option value="Verify">Verify</option>
              <option value="Track">Track (Tracking)</option>
            </select>
          </div>
          <p className="text-xs text-gray-400 mt-2">
            Format: <span className="font-mono text-green-300">{taskPrefix}_Scene_F1-100_Name</span>
          </p>
        </div>

        {/* Configuration Section */}
        <div className="bg-dark-bg p-4 rounded border border-gray-700 mb-6">
          <h3 className="text-lg font-medium text-white mb-4">Task Configuration</h3>

          {/* Replace Existing Tasks Option */}
          {existingTasks.length > 0 && (
            <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={replaceExisting}
                  onChange={(e) => setReplaceExisting(e.target.checked)}
                  className="mt-1 w-4 h-4 rounded border-amber-500/50 bg-gray-800 text-amber-500 focus:ring-amber-500 focus:ring-offset-0"
                />
                <div className="flex-1">
                  <div className="text-sm font-medium text-amber-300">
                    Replace existing {existingTasks.length} task{existingTasks.length > 1 ? 's' : ''}
                  </div>
                  <div className="text-xs text-amber-400/70 mt-0.5">
                    Delete old tasks before creating new ones (recommended when re-splitting a scene)
                  </div>
                </div>
              </label>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-sm text-gray-400 block mb-2">Number of Tasks</label>
              <input
                type="number"
                min="1"
                value={numTasks}
                onChange={(e) => setNumTasks(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-full bg-gray-800 text-white px-3 py-2 rounded border border-gray-700 text-sm focus:outline-none focus:border-blue-500"
              />
              <p className="text-xs text-gray-500 mt-1">Frames per task: ~{Math.ceil(frameCount / numTasks)}</p>
            </div>

            <div>
              <label className={`text-sm block mb-2 ${numTasks === 1 ? 'text-gray-600' : 'text-gray-400'}`}>
                Overlap Frames
              </label>
              <input
                type="number"
                min="0"
                value={overlapFrames}
                onChange={(e) => setOverlapFrames(Math.max(0, parseInt(e.target.value) || 0))}
                disabled={numTasks === 1}
                className={`w-full px-3 py-2 rounded border text-sm focus:outline-none ${
                  numTasks === 1
                    ? 'bg-gray-700 text-gray-500 border-gray-600 cursor-not-allowed'
                    : 'bg-gray-800 text-white border-gray-700 focus:border-blue-500'
                }`}
              />
              <p className="text-xs text-gray-500 mt-1">
                {numTasks === 1 ? 'Only available with 2+ tasks' : 'Frames shared between adjacent tasks'}
              </p>
            </div>
          </div>

          {/* Deadline */}
          <div className="mt-4">
            <label className="text-sm text-gray-400 block mb-2">
              Deadline <span className="text-gray-600 text-xs">(optional, applies to all tasks)</span>
            </label>
            <input
              type="datetime-local"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
              className="w-full bg-gray-800 text-white px-3 py-2 rounded border border-gray-700 text-sm focus:outline-none focus:border-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">Target completion date for these tasks</p>
          </div>
        </div>

        {/* Tasks Preview and Assignment */}
        <div className="space-y-3 mb-6">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-medium text-white">Tasks Preview</h3>
            <button
              type="button"
              onClick={handleAutoAssign}
              disabled={annotatorRoleUsers.length === 0 || tasks.length === 0}
              className="px-3 py-1.5 text-xs bg-blue-500/20 text-blue-300 border border-blue-500/30 rounded-lg hover:bg-blue-500/30 disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-1.5"
              title={
                annotatorRoleUsers.length === 0
                  ? 'No users with the "annotator" role available'
                  : `Distribute tasks equally among ${annotatorRoleUsers.length} annotator${annotatorRoleUsers.length > 1 ? 's' : ''}`
              }
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Auto Assign
            </button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Assignment is optional - tasks can be created unassigned.
            {annotatorRoleUsers.length > 0 && (
              <span className="ml-1 text-gray-400">
                Auto Assign distributes tasks across {annotatorRoleUsers.length} annotator{annotatorRoleUsers.length > 1 ? 's' : ''}.
              </span>
            )}
          </p>
          {tasks.map((task, index) => (
            <div key={index} className="bg-dark-bg p-4 rounded border border-gray-700">
              <div className="grid grid-cols-3 gap-4 items-center">
                <div>
                  <p className="text-white font-medium">{task.name}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    Frames: {task.frame_start + 1} - {task.frame_end + 1}
                    <span className="ml-2 text-gray-500">
                      ({task.frame_end - task.frame_start + 1} frames)
                    </span>
                  </p>
                </div>

                <div>
                  <label className="text-sm text-gray-400 block mb-1">Assign To <span className="text-gray-600 text-xs">(optional)</span></label>
                  <select
                    value={taskAssignees[index] || ''}
                    onChange={(e) => updateTaskAssignee(index, e.target.value)}
                    className="w-full bg-gray-800 text-white px-3 py-2 rounded border border-gray-700 text-sm focus:outline-none focus:border-blue-500"
                  >
                    <option value="">No Assignment</option>
                    {annotators.map((annotator) => (
                      <option key={annotator.id} value={annotator.id}>
                        {annotator.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="text-right">
                  <p className="text-xs text-gray-500">
                    Status: <span className="text-gray-400 font-medium">Draft</span>
                  </p>
                  {!taskAssignees[index] && (
                    <p className="text-xs text-yellow-600 mt-1">Unassigned</p>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded text-sm font-medium"
          >
            Cancel
          </button>
          <button
            onClick={handleCreateTasks}
            disabled={loading || tasks.length === 0}
            className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded text-sm font-medium disabled:opacity-50"
          >
            {loading ? 'Creating...' : `Create ${tasks.length} Task${tasks.length > 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}

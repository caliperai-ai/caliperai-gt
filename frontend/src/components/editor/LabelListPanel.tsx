import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useEditorStore, useCurrentFrameAnnotations } from '@/store/editorStore';
import { useTrackStore } from '@/store/trackStore';
import { useAnnotation4DStore } from '@/store/annotation4DStore';
import { annotation3DApi, annotationApi, annotation2DApi, taskApi } from '@/api/client';
import { useFusionLabels } from './hooks';
import type { Annotation, CuboidData } from '@/types';

const KeyframeIcon = () => (
  <svg className="w-3 h-3 text-yellow-400" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 2L2 12l10 10 10-10L12 2z" />
  </svg>
);

const InterpolatedIcon = () => (
  <svg className="w-3 h-3 text-blue-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="4" />
  </svg>
);

const TrackIcon = () => (
  <svg className="w-3 h-3 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 12h14M12 5l7 7-7 7"/>
  </svg>
);

interface InlinePropertiesProps {
  annotation: Annotation;
  taxonomy: { classes: { id: string; name: string; color: string }[] } | null;
  onUpdate: (id: string, updates: Partial<Annotation>) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

const InlinePropertiesEditor: React.FC<InlinePropertiesProps> = ({
  annotation,
  taxonomy,
  onUpdate,
  onDelete,
  onClose
}) => {
  const cuboidData = annotation.type === 'cuboid' ? annotation.data as CuboidData : null;
  const yawRadians = cuboidData?.rotation?.yaw ?? 0;

  return (
    <div className="mt-2 p-3 bg-dark/50 rounded-lg border border-gray-600/50 space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-300">Edit Properties</span>
        <button
          onClick={(e) => { e.stopPropagation(); onClose(); }}
          className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Class Selector */}
      <div>
        <label className="text-[10px] text-gray-500 mb-1 block">Class</label>
        <select
          value={annotation.class_id}
          onChange={(e) => { e.stopPropagation(); onUpdate(annotation.id, { class_id: e.target.value }); }}
          onClick={(e) => e.stopPropagation()}
          className="w-full bg-dark border border-gray-600 rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-primary"
        >
          {taxonomy?.classes.map((cls) => (
            <option key={cls.id} value={cls.id}>{cls.name}</option>
          ))}
        </select>
        {/* Quick class buttons */}
        <div className="flex flex-wrap gap-1 mt-1.5">
          {taxonomy?.classes.slice(0, 5).map((cls) => (
            <button
              key={cls.id}
              onClick={(e) => { e.stopPropagation(); onUpdate(annotation.id, { class_id: cls.id }); }}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-all ${
                annotation.class_id === cls.id
                  ? 'bg-primary/20 border border-primary/50 text-white'
                  : 'bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700'
              }`}
            >
              <div className="w-1.5 h-1.5 rounded" style={{ backgroundColor: cls.color }} />
              {cls.name.slice(0, 6)}
            </button>
          ))}
        </div>
      </div>

      {/* Position (if cuboid) */}
      {cuboidData?.center && (
        <div>
          <label className="text-[10px] text-gray-500 mb-1 block">Position (X, Y, Z)</label>
          <div className="grid grid-cols-3 gap-1">
            <input
              type="number"
              step="0.1"
              value={cuboidData.center.x.toFixed(2)}
              onChange={(e) => {
                e.stopPropagation();
                onUpdate(annotation.id, {
                  data: { ...annotation.data, center: { ...cuboidData.center, x: parseFloat(e.target.value) || 0 } }
                });
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-dark border border-gray-600 rounded px-1.5 py-1 text-white text-[10px] font-mono text-center focus:outline-none focus:border-red-400"
            />
            <input
              type="number"
              step="0.1"
              value={cuboidData.center.y.toFixed(2)}
              onChange={(e) => {
                e.stopPropagation();
                onUpdate(annotation.id, {
                  data: { ...annotation.data, center: { ...cuboidData.center, y: parseFloat(e.target.value) || 0 } }
                });
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-dark border border-gray-600 rounded px-1.5 py-1 text-white text-[10px] font-mono text-center focus:outline-none focus:border-green-400"
            />
            <input
              type="number"
              step="0.1"
              value={cuboidData.center.z.toFixed(2)}
              onChange={(e) => {
                e.stopPropagation();
                onUpdate(annotation.id, {
                  data: { ...annotation.data, center: { ...cuboidData.center, z: parseFloat(e.target.value) || 0 } }
                });
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-dark border border-gray-600 rounded px-1.5 py-1 text-white text-[10px] font-mono text-center focus:outline-none focus:border-blue-400"
            />
          </div>
        </div>
      )}

      {/* Dimensions (if cuboid) */}
      {cuboidData?.dimensions && (
        <div>
          <label className="text-[10px] text-gray-500 mb-1 block">Dimensions (L, W, H)</label>
          <div className="grid grid-cols-3 gap-1">
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={cuboidData.dimensions.length.toFixed(2)}
              onChange={(e) => {
                e.stopPropagation();
                onUpdate(annotation.id, {
                  data: { ...annotation.data, dimensions: { ...cuboidData.dimensions, length: parseFloat(e.target.value) || 0.1 } }
                });
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-dark border border-gray-600 rounded px-1.5 py-1 text-white text-[10px] font-mono text-center focus:outline-none focus:border-primary"
            />
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={cuboidData.dimensions.width.toFixed(2)}
              onChange={(e) => {
                e.stopPropagation();
                onUpdate(annotation.id, {
                  data: { ...annotation.data, dimensions: { ...cuboidData.dimensions, width: parseFloat(e.target.value) || 0.1 } }
                });
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-dark border border-gray-600 rounded px-1.5 py-1 text-white text-[10px] font-mono text-center focus:outline-none focus:border-primary"
            />
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={cuboidData.dimensions.height.toFixed(2)}
              onChange={(e) => {
                e.stopPropagation();
                onUpdate(annotation.id, {
                  data: { ...annotation.data, dimensions: { ...cuboidData.dimensions, height: parseFloat(e.target.value) || 0.1 } }
                });
              }}
              onClick={(e) => e.stopPropagation()}
              className="bg-dark border border-gray-600 rounded px-1.5 py-1 text-white text-[10px] font-mono text-center focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      )}

      {/* Rotation (if cuboid) */}
      {cuboidData?.rotation !== undefined && (
        <div>
          <label className="text-[10px] text-gray-500 mb-1 block">Heading (°)</label>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="-180"
              max="180"
              step="1"
              value={((yawRadians * 180) / Math.PI).toFixed(0)}
              onChange={(e) => {
                e.stopPropagation();
                const newYaw = (parseFloat(e.target.value) * Math.PI) / 180;
                onUpdate(annotation.id, {
                  data: { ...annotation.data, rotation: { ...cuboidData.rotation, yaw: newYaw } }
                });
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 h-1.5 accent-primary"
            />
            <input
              type="number"
              step="1"
              value={((yawRadians * 180) / Math.PI).toFixed(0)}
              onChange={(e) => {
                e.stopPropagation();
                const newYaw = (parseFloat(e.target.value) * Math.PI) / 180;
                onUpdate(annotation.id, {
                  data: { ...annotation.data, rotation: { ...cuboidData.rotation, yaw: newYaw } }
                });
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-14 bg-dark border border-gray-600 rounded px-1.5 py-1 text-white text-[10px] font-mono text-center focus:outline-none focus:border-primary"
            />
          </div>
        </div>
      )}

      {/* Delete Button */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          if (confirm('Delete this annotation?')) {
            onDelete(annotation.id);
            onClose();
          }
        }}
        className="w-full py-1.5 bg-red-500/10 text-red-400 rounded text-xs hover:bg-red-500/20 flex items-center justify-center gap-1.5"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Delete
      </button>
    </div>
  );
};

export const LabelListPanel: React.FC = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showKeyframesOnly, setShowKeyframesOnly] = useState(false);
  const [showInterpolatedOnly, setShowInterpolatedOnly] = useState(false);
  const [show2DLabels, setShow2DLabels] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [expandedCameras, setExpandedCameras] = useState<Set<string>>(new Set());
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [expandedPropertiesId, setExpandedPropertiesId] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const allAnnotations = useCurrentFrameAnnotations();
  const { task, selection, selectAnnotation, updateAnnotation, deleteAnnotation, taxonomy, annotations: allAnnotationsMap, setSuppressPropertiesPanel, setAnnotations, setTask } = useEditorStore();
  const { mergeTracks, interpolateTrack } = useTrackStore();
  const { clearAnnotations4D } = useAnnotation4DStore();

  const handleDeleteAll = async () => {
    if (!task?.id) return;
    setIsDeletingAll(true);
    try {
      await Promise.all([
        annotation2DApi.deleteByTask(task.id).catch(() => null),
        (async () => {
          const ann3d = await annotation3DApi.list(task.id).catch(() => []);
          if (ann3d.length > 0) {
            await annotation3DApi.deleteBulk(ann3d.map((a: { id: string }) => a.id)).catch(() => null);
          }
        })(),
        (async () => {
          let allLegacy: any[] = [];
          let page = 1;
          let hasMore = true;
          while (hasMore) {
            const legacy = await annotationApi.list({ taskId: task.id, pageSize: 1000, page }).catch(() => []);
            allLegacy.push(...legacy);
            hasMore = legacy.length === 1000;
            page++;
          }
          if (allLegacy.length > 0) {
            for (let i = 0; i < allLegacy.length; i += 50) {
              const batch = allLegacy.slice(i, i + 50);
              await Promise.all(batch.map((a: { id: string }) => annotationApi.delete(a.id).catch(() => null)));
            }
          }
        })(),
      ]);
      // Clear frontend state
      setAnnotations([]);
      clearAnnotations4D();
      // Use setQueryData instead of removeQueries — removeQueries won't remove queries
      // that have active observers, so cached per-frame data would still be used by
      // mergeAnnotationsFromServer when navigating frames.
      queryClient.getQueriesData<any[]>({ queryKey: ['annotations', task.id] })
        .forEach(([queryKey]) => { queryClient.setQueryData(queryKey, []); });
      queryClient.setQueryData(['all-3d-annotations', task.id], []);

      // Always reset task back to annotation stage and clear all revision/QA data.
      try {
        const updatedTask = await taskApi.update(task.id, { stage: 'annotation', revision_count: 0 } as any);
        setTask(updatedTask);
        queryClient.invalidateQueries({ queryKey: ['task', task.id] });
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
        queryClient.invalidateQueries({ queryKey: ['dataset-tasks'] });
        // Optimistically patch the task in all dataset-detail caches so the R badge
        // disappears immediately when the user navigates back (no stale-data flash).
        const taskIdStr = String(task.id);
        const patchTaskInDetail = (old: any) => {
          if (!old) return old;
          return {
            ...old,
            scenes: old.scenes?.map((s: any) => ({
              ...s,
              tasks: s.tasks?.map((t: any) =>
                String(t.id) === taskIdStr ? { ...t, revision_count: 0 } : t
              ),
            })),
          };
        };
        queryClient.getQueriesData<any>({ predicate: (q) => q.queryKey[0] === 'dataset-detail' })
          .forEach(([key]) => queryClient.setQueryData(key, patchTaskInDetail));
        queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'dataset-detail' });
      } catch (resetErr) {
        console.error('Failed to reset task stage after delete all:', resetErr);
      }
    } catch (err) {
      console.error('Failed to delete all annotations:', err);
    } finally {
      setIsDeletingAll(false);
      setShowDeleteAllModal(false);
    }
  };
  const { labelsByCamera, camerasWithLabels } = useFusionLabels();
  const [mergeMode, setMergeMode] = useState<{ active: boolean; sourceTrackId: string | null }>({
    active: false,
    sourceTrackId: null
  });

  // Sync suppress flag with panel open state
  React.useEffect(() => {
    setSuppressPropertiesPanel(isOpen);
  }, [isOpen, setSuppressPropertiesPanel]);

  // Toggle camera expansion
  const toggleCamera = (cameraId: string) => {
    setExpandedCameras(prev => {
      const next = new Set(prev);
      if (next.has(cameraId)) {
        next.delete(cameraId);
      } else {
        next.add(cameraId);
      }
      return next;
    });
  };

  // Get class color
  const getClassColor = (classId: string): string => {
    const classDef = taxonomy?.classes?.find(c => c.id === classId);
    return classDef?.color || '#00ff00';
  };

  // Handle double-click to start editing
  const handleDoubleClick = (editKey: string, currentValue: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setEditingId(editKey);
    setEditValue(currentValue);
  };

  const handleSaveEdit = (annId: string, field: 'track_id') => {
    if (field === 'track_id' && editValue.trim()) {
      updateAnnotation(annId, { track_id: editValue.trim() });
    }
    setEditingId(null);
    setEditValue('');
  };

  // Filter annotations based on toggle state
  const annotations = useMemo(() => {
    let filtered = allAnnotations;
    if (showKeyframesOnly) {
      filtered = filtered.filter(ann => ann.is_keyframe === true);
    }
    if (showInterpolatedOnly) {
      filtered = filtered.filter(ann => ann.source === 'auto_interpolated');
    }
    return filtered;
  }, [allAnnotations, showKeyframesOnly, showInterpolatedOnly]);

  // Group by class
  const groupedAnnotations = useMemo(() => {
    const groups: Record<string, typeof annotations> = {};
    annotations.forEach(ann => {
      if (!groups[ann.class_id]) groups[ann.class_id] = [];
      groups[ann.class_id].push(ann);
    });
    return groups;
  }, [annotations]);

  // Count total 2D labels
  const total2DLabels = useMemo(() => {
    let count = 0;
    Object.values(labelsByCamera).forEach(labels => {
      count += labels.length;
    });
    return count;
  }, [labelsByCamera]);

  const toggleSelection = (id: string, multi: boolean) => {
    selectAnnotation(id, multi);
  };

  // Handle merge mode click
  const handleTrackClick = (trackId: string) => {
    if (!mergeMode.active) return;

    if (mergeMode.sourceTrackId === null) {
      // First track selected
      setMergeMode({ active: true, sourceTrackId: trackId });
    } else if (mergeMode.sourceTrackId !== trackId) {
      // Second track selected - perform merge
      mergeTracks(mergeMode.sourceTrackId, trackId);
      setMergeMode({ active: false, sourceTrackId: null });
    }
  };

  // Handle toggling the panel
  const handleTogglePanel = () => {
    const newIsOpen = !isOpen;
    setIsOpen(newIsOpen);
    if (!newIsOpen) {
      // Panel is closing, reset expanded properties
      setExpandedPropertiesId(null);
    }
    // Note: suppressPropertiesPanel is synced via useEffect
  };

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={handleTogglePanel}
        className={`absolute left-4 top-32 z-30 p-2.5 rounded-xl shadow-lg transition-all duration-200 ${
          isOpen
            ? 'bg-primary text-white translate-x-80'
            : 'bg-dark-panel/90 backdrop-blur text-gray-400 hover:text-white hover:bg-dark-hover'
        }`}
        title="Toggle Label List"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Panel */}
      <div
        className={`absolute left-4 top-32 bottom-32 w-80 bg-dark-panel/95 backdrop-blur-md border border-gray-700/50 rounded-2xl shadow-2xl z-20 flex flex-col overflow-hidden transition-all duration-300 origin-left ${
          isOpen ? 'opacity-100 scale-100 translate-x-0' : 'opacity-0 scale-95 -translate-x-full pointer-events-none'
        }`}
      >
        <div className="p-4 border-b border-gray-700/50 flex items-center justify-between bg-gradient-to-r from-gray-800/50 to-transparent">
          <h3 className="font-semibold text-white text-sm tracking-wide">Scene Objects</h3>
          <div className="flex items-center gap-2">
            {/* Filter menu (burger icon) */}
            <div className="relative">
              <button
                onClick={() => setShowMenu(!showMenu)}
                className={`p-1.5 rounded transition-colors ${showMenu || showKeyframesOnly || showInterpolatedOnly ? 'bg-primary/30 text-primary-light' : 'text-gray-400 hover:text-white hover:bg-gray-700/50'}`}
                title="Filter options"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
              {showMenu && (
                <div className="absolute right-0 mt-1 w-52 bg-dark-panel border border-gray-700 rounded-lg shadow-xl z-50 py-1">
                  <button
                    onClick={() => { setShowKeyframesOnly(!showKeyframesOnly); setShowInterpolatedOnly(false); }}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2 transition-colors ${
                      showKeyframesOnly ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:bg-gray-700/50 hover:text-white'
                    }`}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2L2 12l10 10 10-10L12 2z" />
                    </svg>
                    Show Keyframes Only
                    {showKeyframesOnly && <span className="ml-auto text-yellow-400">✓</span>}
                  </button>
                  <button
                    onClick={() => { setShowInterpolatedOnly(!showInterpolatedOnly); setShowKeyframesOnly(false); }}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2 transition-colors ${
                      showInterpolatedOnly ? 'bg-blue-500/20 text-blue-300' : 'text-gray-400 hover:bg-gray-700/50 hover:text-white'
                    }`}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="4" />
                    </svg>
                    Show Interpolated Only
                    {showInterpolatedOnly && <span className="ml-auto text-blue-400">✓</span>}
                  </button>
                  <div className="border-t border-gray-700 my-1" />
                  <button
                    onClick={() => setShow2DLabels(!show2DLabels)}
                    className={`w-full px-3 py-2 text-left text-xs flex items-center gap-2 transition-colors ${
                      show2DLabels ? 'bg-green-500/20 text-green-300' : 'text-gray-400 hover:bg-gray-700/50 hover:text-white'
                    }`}
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="3" width="18" height="18" rx="2"/>
                    </svg>
                    Show 2D Labels by Camera
                    {show2DLabels && <span className="ml-auto text-green-400">✓</span>}
                  </button>
                  <div className="border-t border-gray-700 my-1" />
                  <button
                    onClick={() => { setShowKeyframesOnly(false); setShowInterpolatedOnly(false); setShowMenu(false); }}
                    className="w-full px-3 py-2 text-left text-xs text-gray-400 hover:bg-gray-700/50 hover:text-white"
                  >
                    Show All
                  </button>
                  <div className="border-t border-gray-700 my-1" />
                  <button
                    onClick={() => { setShowDeleteAllModal(true); setShowMenu(false); }}
                    className="w-full px-3 py-2 text-left text-xs flex items-center gap-2 text-red-400 hover:bg-red-500/20 hover:text-red-300 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Delete All Annotations
                  </button>
                </div>
              )}
            </div>
            {/* Merge tracks button */}
            <button
              onClick={() => setMergeMode(m => ({ active: !m.active, sourceTrackId: null }))}
              className={`text-xs px-2 py-1 rounded ${
                mergeMode.active
                  ? 'bg-orange-500/30 text-orange-300 border border-orange-500/50'
                  : 'bg-gray-700/50 text-gray-400 hover:text-gray-200'
              }`}
              title="Merge two tracks into one"
            >
              {mergeMode.active ? (mergeMode.sourceTrackId ? 'Select target' : 'Select first track') : 'Merge'}
            </button>
            <span className="bg-primary/20 text-primary-light text-xs px-2 py-0.5 rounded-full font-mono">
              {annotations.length}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-4 custom-scrollbar">
          {Object.entries(groupedAnnotations).map(([classId, items]) => (
            <div key={classId}>
              <div className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1 flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-gray-600" />
                {classId}
              </div>
              <div className="space-y-1">
                {items.map(ann => {
                  const isSelected = (selection.selectedAnnotationIds || []).includes(ann.id);
                  const hasTrack = !!ann.track_id;
                  const isKeyframe = ann.is_keyframe === true;
                  const isInterpolated = ann.source === 'auto_interpolated';
                  const isMergeSource = mergeMode.sourceTrackId === ann.track_id;

                  return (
                    <div
                      key={ann.id}
                      onClick={(e) => {
                        if (mergeMode.active && ann.track_id) {
                          handleTrackClick(ann.track_id);
                        } else {
                          toggleSelection(ann.id, e.metaKey || e.ctrlKey);
                          // Auto-expand inline properties editor when clicking annotation from list
                          // This suppresses the floating properties panel
                          setExpandedPropertiesId(ann.id);
                          setSuppressPropertiesPanel(true);
                        }
                      }}
                      className={`group px-3 py-2.5 rounded-lg text-sm cursor-pointer transition-all border ${
                        isMergeSource
                          ? 'bg-orange-500/20 border-orange-500/50 text-white'
                          : isSelected
                            ? 'bg-primary/20 border-primary/30 text-white shadow-sm'
                            : 'border-transparent hover:bg-white/5 text-gray-400 hover:text-gray-200'
                      }`}
                    >
                      {/* UUID + Icons Row */}
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          {/* Keyframe/Interpolated/Track icons */}
                          {hasTrack && <TrackIcon />}
                          {isKeyframe && <KeyframeIcon />}
                          {isInterpolated && <InterpolatedIcon />}

                          {/* Annotation UUID - full, click to copy */}
                          <span
                            className="font-mono text-[10px] text-primary-light select-all cursor-pointer hover:underline"
                            title="Click to copy UUID"
                            onClick={(e) => {
                              e.stopPropagation();
                              navigator.clipboard.writeText(ann.id);
                            }}
                          >
                            {ann.id}
                          </span>
                        </div>
                        {/* Action buttons - visible on hover */}
                        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              // Toggle inline properties and suppress the main properties panel
                              const newExpandedId = expandedPropertiesId === ann.id ? null : ann.id;
                              setExpandedPropertiesId(newExpandedId);
                              setSuppressPropertiesPanel(newExpandedId !== null);
                            }}
                            className={`p-1 rounded ${expandedPropertiesId === ann.id ? 'bg-blue-500/40 text-blue-300' : 'hover:bg-blue-500/30 text-blue-400'}`}
                            title="Edit Properties"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (confirm('Delete this annotation?')) {
                                deleteAnnotation(ann.id);
                              }
                            }}
                            className="p-1 rounded hover:bg-red-500/30 text-red-400"
                            title="Delete annotation"
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                        <div className={`w-2 h-2 rounded-full transition-colors flex-shrink-0 ml-2 ${isSelected ? 'bg-primary' : 'bg-gray-700 group-hover:bg-gray-600'}`} />
                      </div>

                      {/* Static Object Badge */}
                      {ann.is_static && (
                        <span className="inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 bg-purple-500/20 text-purple-300 rounded mt-1">
                          <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <rect x="3" y="3" width="18" height="18" rx="2"/>
                          </svg>
                          Static
                        </span>
                      )}

                      {/* Track Info with Interpolate button */}
                      {ann.track_id && (
                        <div className="mt-1.5 flex items-center justify-between">
                          {editingId === `track-${ann.id}` ? (
                            <input
                              type="text"
                              value={editValue}
                              onChange={(e) => setEditValue(e.target.value)}
                              onBlur={() => handleSaveEdit(ann.id, 'track_id')}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveEdit(ann.id, 'track_id');
                                if (e.key === 'Escape') { setEditingId(null); setEditValue(''); }
                              }}
                              onClick={(e) => e.stopPropagation()}
                              autoFocus
                              className="font-mono text-[10px] text-purple-400 bg-purple-500/20 border border-purple-500/50 rounded px-1.5 py-0.5 flex-1 mr-2 outline-none"
                              placeholder="Enter Track ID"
                            />
                          ) : (
                            <div
                              className="text-[10px] text-gray-500 truncate flex-1 cursor-pointer hover:text-gray-300"
                              title="Double-click to edit Track ID"
                              onDoubleClick={(e) => handleDoubleClick(`track-${ann.id}`, ann.track_id || '', e)}
                              onClick={(e) => e.stopPropagation()}
                            >
                              Track: <span className="font-mono text-purple-400 hover:underline">{ann.track_id}</span>
                            </div>
                          )}
                          {hasTrack && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                interpolateTrack(ann.track_id!);
                              }}
                              className="text-[9px] px-1.5 py-0.5 bg-blue-500/20 text-blue-300 rounded hover:bg-blue-500/30"
                              title="Interpolate between keyframes"
                            >
                              Interpolate
                            </button>
                          )}
                        </div>
                      )}

                      {/* Inline Properties Editor */}
                      {expandedPropertiesId === ann.id && (
                        <InlinePropertiesEditor
                          annotation={ann}
                          taxonomy={taxonomy}
                          onUpdate={updateAnnotation}
                          onDelete={deleteAnnotation}
                          onClose={() => {
                            setExpandedPropertiesId(null);
                            setSuppressPropertiesPanel(false);
                          }}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {annotations.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500 text-sm italic">
              No annotations
            </div>
          )}

          {/* 2D Labels Section - Grouped by Camera */}
          {show2DLabels && camerasWithLabels.length > 0 && (
            <div className="mt-4 pt-4 border-t border-gray-700/50">
              <div className="px-2 py-1 text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                  </svg>
                  2D Labels
                </div>
                <span className="bg-green-500/20 text-green-400 text-[10px] px-1.5 py-0.5 rounded-full">
                  {total2DLabels}
                </span>
              </div>

              {camerasWithLabels.map((cameraId) => {
                const labels = labelsByCamera[cameraId] || [];
                const isExpanded = expandedCameras.has(cameraId);

                return (
                  <div key={cameraId} className="mb-2">
                    {/* Camera Header */}
                    <button
                      onClick={() => toggleCamera(cameraId)}
                      className="w-full px-2 py-1.5 flex items-center justify-between text-xs text-gray-400 hover:text-white hover:bg-gray-700/30 rounded transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <svg
                          className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
                        >
                          <path d="M9 18l6-6-6-6"/>
                        </svg>
                        <svg className="w-3 h-3 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                          <circle cx="12" cy="13" r="4"/>
                        </svg>
                        <span className="font-medium">{cameraId.replace(/_/g, ' ')}</span>
                      </div>
                      <span className="bg-cyan-500/20 text-cyan-400 text-[9px] px-1.5 py-0.5 rounded-full">
                        {labels.length}
                      </span>
                    </button>

                    {/* Labels for this camera */}
                    {isExpanded && (
                      <div className="ml-4 mt-1 space-y-1">
                        {labels.map((label) => {
                          const isSelected = selection.selectedAnnotationIds.includes(label.annotationId);
                          const color = getClassColor(label.classId);

                          return (
                            <div
                              key={`${label.annotationId}-${label.cameraId}`}
                              onClick={(e) => toggleSelection(label.annotationId, e.metaKey || e.ctrlKey)}
                              className={`group px-2 py-1.5 rounded-lg text-xs cursor-pointer transition-all border ${
                                isSelected
                                  ? 'bg-primary/20 border-primary/30 text-white'
                                  : 'border-transparent hover:bg-white/5 text-gray-400 hover:text-gray-200'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  {/* Color indicator */}
                                  <div
                                    className="w-3 h-3 rounded border border-white/30"
                                    style={{ backgroundColor: color }}
                                  />
                                  <span className="font-medium">{label.classId}</span>
                                  {label.trackId && (
                                    <span className="text-[9px] text-purple-400 font-mono bg-purple-500/20 px-1 rounded">
                                      {label.trackId}
                                    </span>
                                  )}
                                </div>
                                {label.isManuallyAdjusted && (
                                  <span className="text-[9px] text-orange-400 bg-orange-500/20 px-1 rounded">
                                    edited
                                  </span>
                                )}
                              </div>
                              {/* BBox info */}
                              <div className="mt-1 grid grid-cols-4 gap-1 text-[9px] font-mono text-gray-500">
                                <div>x: {Math.round(label.bbox.x)}</div>
                                <div>y: {Math.round(label.bbox.y)}</div>
                                <div>w: {Math.round(label.bbox.width)}</div>
                                <div>h: {Math.round(label.bbox.height)}</div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Delete All Confirmation Modal — rendered via portal to escape overflow:hidden ancestors */}
      {showDeleteAllModal && createPortal(
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999]">
          <div className="bg-dark-panel border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-red-400 mb-2 flex items-center gap-2">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              Delete All Annotations
            </h3>
            <p className="text-sm text-gray-400 mb-4">
              Are you sure you want to delete <span className="text-white font-semibold">{allAnnotationsMap.size}</span> annotations? This action cannot be undone.
            </p>

            <div className="space-y-3">
              <button
                onClick={handleDeleteAll}
                disabled={isDeletingAll}
                className="w-full px-4 py-3 bg-red-500/30 text-red-300 rounded-lg hover:bg-red-500/50 transition-colors flex items-center justify-center gap-2 font-medium disabled:opacity-50"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                {isDeletingAll ? 'Deleting...' : 'Yes, Delete All'}
              </button>

              <button
                onClick={() => setShowDeleteAllModal(false)}
                className="w-full px-4 py-3 bg-gray-700/50 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      , document.body)}
    </>
  );
};

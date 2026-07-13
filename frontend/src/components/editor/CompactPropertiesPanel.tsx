import React, { useState, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEditorStore, useSelectedAnnotations } from '@/store/editorStore';
import { useAnnotation4DStore } from '@/store/annotation4DStore';
import { useTrackStore } from '@/store/trackStore';
import { useTrackChangeConfirmation } from '@/hooks/useTrackChangeConfirmation';
import { TrackChangeConfirmationModal } from './TrackChangeConfirmationModal';
import { getEffectiveAttributesForClass } from '@/utils/taxonomyUtils';
import type { Annotation, CuboidData } from '@/types';


interface CollapsibleSectionProps {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
  badge?: string | number;
}

const CollapsibleSection: React.FC<CollapsibleSectionProps> = ({
  title,
  icon,
  defaultOpen = true,
  children,
  badge
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-gray-700/50 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-2 py-1.5 bg-dark-panel/50 hover:bg-dark-panel transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="text-xs font-medium text-gray-300">{title}</span>
          {badge && (
            <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-700 text-gray-400">
              {badge}
            </span>
          )}
        </div>
        <svg
          className={`w-3.5 h-3.5 text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {isOpen && (
        <div className="p-2 bg-dark/30">
          {children}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// NUMERIC INPUT WITH INCREMENT/DECREMENT
// =============================================================================

interface NumericInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  step?: number;
  min?: number;
  max?: number;
  colorClass?: string;
  unit?: string;
}

const NumericInput: React.FC<NumericInputProps> = ({
  label,
  value,
  onChange,
  step = 0.1,
  min,
  max,
  colorClass = 'text-gray-400',
  unit
}) => {
  const handleIncrement = () => {
    const newVal = value + step;
    if (max === undefined || newVal <= max) onChange(newVal);
  };

  const handleDecrement = () => {
    const newVal = value - step;
    if (min === undefined || newVal >= min) onChange(newVal);
  };

  return (
    <div className="flex flex-col">
      <label className={`text-[9px] font-medium mb-0.5 ${colorClass}`}>{label}</label>
      <div className="flex items-center">
        <button
          onClick={handleDecrement}
          className="px-1 py-0.5 bg-gray-700 hover:bg-gray-600 rounded-l text-gray-300 text-xs"
        >
          −
        </button>
        <input
          type="number"
          step={step}
          value={value.toFixed(2)}
          onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
          className="w-12 bg-dark border-y border-gray-700 px-1 py-0.5 text-white text-[10px] font-mono text-center focus:outline-none focus:border-primary"
        />
        <button
          onClick={handleIncrement}
          className="px-1 py-0.5 bg-gray-700 hover:bg-gray-600 rounded-r text-gray-300 text-xs"
        >
          +
        </button>
        {unit && <span className="ml-1 text-[9px] text-gray-500">{unit}</span>}
      </div>
    </div>
  );
};

// =============================================================================
// HEADING DIAL (Visual Rotation Control)
// =============================================================================

const HeadingDial: React.FC<{
  value: number; // in radians
  onChange: (value: number) => void;
}> = ({ value, onChange }) => {
  const [isDragging, setIsDragging] = useState(false);
  const dialRef = React.useRef<HTMLDivElement>(null);

  const degrees = (value * 180 / Math.PI);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  React.useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dialRef.current) return;
      const rect = dialRef.current.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX);
      // Adjust to make 0° point up
      const adjusted = angle + Math.PI / 2;
      onChange(adjusted);
    };

    const handleMouseUp = () => setIsDragging(false);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, onChange]);

  return (
    <div className="flex items-center gap-2">
      {/* Dial */}
      <div
        ref={dialRef}
        className={`relative w-12 h-12 rounded-full border-2 border-gray-600 cursor-pointer ${
          isDragging ? 'border-primary' : 'hover:border-gray-500'
        }`}
        onMouseDown={handleMouseDown}
      >
        {/* Cardinal directions */}
        <span className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[7px] text-gray-500">N</span>
        <span className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 text-[7px] text-gray-500">S</span>
        <span className="absolute left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[7px] text-gray-500">W</span>
        <span className="absolute right-0 top-1/2 translate-x-1/2 -translate-y-1/2 text-[7px] text-gray-500">E</span>

        {/* Direction indicator */}
        <div
          className="absolute top-1/2 left-1/2 w-5 h-1 bg-red-500 origin-left rounded"
          style={{ transform: `translate(0, -50%) rotate(${-value}rad)` }}
        />

        {/* Center dot */}
        <div className="absolute top-1/2 left-1/2 w-1.5 h-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gray-400" />
      </div>

      {/* Numeric input */}
      <div className="flex flex-col">
        <label className="text-[9px] text-gray-400 mb-0.5">Heading</label>
        <div className="flex items-center">
          <input
            type="number"
            step={1}
            value={degrees.toFixed(0)}
            onChange={(e) => onChange((parseFloat(e.target.value) || 0) * Math.PI / 180)}
            className="w-12 bg-dark border border-gray-700 rounded px-1.5 py-0.5 text-white text-[10px] font-mono text-center focus:outline-none focus:border-primary"
          />
          <span className="ml-1 text-[9px] text-gray-500">°</span>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// MAIN PROPERTIES PANEL
// =============================================================================

export const CompactPropertiesPanel: React.FC = () => {
  const selectedAnnotations = useSelectedAnnotations();
  const { taxonomy, updateAnnotation: updateAnnotationRegular, deleteAnnotation, currentFrame, selection, frames, task } = useEditorStore();
  const queryClient = useQueryClient();
  const {
    tracks,
    createTrack,
    addAnnotationToTrack,
    addKeyframe,
    removeKeyframe,
    isKeyframe,
    propagateTrack,
    setTrackStart,
    setTrackEnd,
  } = useTrackStore();

  // 4D annotation support - use selection from editorStore to trigger re-renders
  const selectedIds = selection.selectedAnnotationIds;
  const annotations4D = useAnnotation4DStore((s) => s.annotations4D);
  const selectedAnnotation4D = selectedIds.length > 0 ? annotations4D.get(selectedIds[0]) ?? null : null;
  const updateAnnotation4D = useAnnotation4DStore((s) => s.updateAnnotation4D);
  const deleteAnnotation4D = useAnnotation4DStore((s) => s.deleteAnnotation4D);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showTrackList, setShowTrackList] = useState(false);
  const [showPropagateInput, setShowPropagateInput] = useState(false);

  // Track change confirmation hook
  const { confirmation, requestChange, confirmChange, cancelChange } = useTrackChangeConfirmation();
  const [propagateFrames, setPropagateFrames] = useState(10);
  const [propagateDirection, setPropagateDirection] = useState<'forward' | 'backward' | 'both'>('forward');

  // Check if we have a selection
  const has4DSelection = selectedAnnotation4D !== null && !selectedAnnotation4D.is_deleted;
  const hasRegularSelection = selectedAnnotations.length > 0;

  if (!hasRegularSelection && !has4DSelection) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-gray-500 p-4">
        <svg className="w-10 h-10 mb-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
        <p className="text-sm text-center">Select an annotation to view and edit its properties</p>
      </div>
    );
  }

  // Build annotation object (prefer 4D if available)
  let ann: Annotation;
  let is4D = false;

  if (has4DSelection && selectedAnnotation4D) {
    is4D = true;
    const worldData = selectedAnnotation4D.world_data;
    ann = {
      id: selectedAnnotation4D.id,
      task_id: selectedAnnotation4D.task_id,
      frame_id: selectedAnnotation4D.frame_ids[0] || '',
      track_id: selectedAnnotation4D.track_id,
      type: selectedAnnotation4D.type as Annotation['type'],
      class_id: selectedAnnotation4D.class_id,
      data: {
        center: worldData.center,
        dimensions: worldData.dimensions,
        rotation: worldData.rotation,
        confidence: 1,
      },
      attributes: selectedAnnotation4D.attributes,
      source: selectedAnnotation4D.source as Annotation['source'],
      is_verified: false,
      is_keyframe: true,
      is_static: selectedAnnotation4D.is_static,
      created_at: '',
      updated_at: '',
    };
  } else {
    ann = selectedAnnotations[0];
  }

  // Unified update function with track change confirmation
  const updateAnnotation = (id: string, updates: Partial<Annotation>) => {
    // is_static is a track-level property — apply immediately to the whole track, no modal
    if (typeof updates.is_static === 'boolean' && ann.track_id) {
      useTrackStore.getState().updateTrackIsStatic(ann.track_id, updates.is_static);
      // Also directly update this annotation as a fallback to guarantee the toggle visual updates
      // (in case updateTrackIsStatic can't find the annotation in editorStore for any reason)
      updateAnnotationRegular(id, { is_static: updates.is_static });
      const { is_static: _ignored, ...rest } = updates;
      updates = rest;
      if (Object.keys(updates).length === 0) return;
    }

    // If annotation has a track, check if we need confirmation for significant changes
    if (ann.track_id) {
      const isSignificantChange =
        updates.class_id !== undefined ||
        (updates.attributes && Object.keys(updates.attributes).length > 0) ||
        (updates.data && (updates.data as CuboidData).dimensions);

      if (isSignificantChange) {
        const needsConfirmation = requestChange(id, ann.track_id, updates, is4D);
        if (needsConfirmation) {
          return; // Wait for user confirmation
        }
      }
    }

    // Apply the change directly
    applyAnnotationUpdate(id, updates);
  };

  // Helper to actually apply annotation updates
  const applyAnnotationUpdate = (id: string, updates: Partial<Annotation>) => {
    if (is4D && selectedAnnotation4D) {
      const data = updates.data as CuboidData | undefined;
      if (data) {
        const existingWorldData = selectedAnnotation4D.world_data;
        const newWorldData = {
          center: data.center ?? existingWorldData.center,
          dimensions: data.dimensions ?? existingWorldData.dimensions,
          rotation: data.rotation ?? existingWorldData.rotation,
        };
        updateAnnotation4D(id, { world_data: newWorldData });
      }
      if (updates.attributes) {
        updateAnnotation4D(id, { attributes: updates.attributes as Record<string, unknown> });
      }
      if (updates.class_id) {
        updateAnnotation4D(id, { class_id: updates.class_id });
      }
    } else {
      updateAnnotationRegular(id, updates);
    }
  };

  const handleDelete = () => {
    if (ann.track_id) {
      setShowDeleteModal(true);
    } else {
      if (is4D) {
        deleteAnnotation4D(ann.id);
      } else {
        deleteAnnotation(ann.id);
      }
    }
  };

  const handleDeleteAnnotation = () => {
    if (is4D) {
      deleteAnnotation4D(ann.id);
    } else {
      deleteAnnotation(ann.id);
    }
    setShowDeleteModal(false);
  };

  const handleDeleteTrack = async () => {
    if (!ann.track_id) return;
    const trackId = ann.track_id;

    try {
      if (is4D) {
        annotations4D.forEach((a) => {
          if (a.track_id === trackId && !a.is_deleted) {
            deleteAnnotation4D(a.id);
          }
        });
        await useEditorStore.getState().saveAnnotations();
      } else {
        // Call backend API to delete ALL annotations with this track_id across ALL frames
        const { annotation3DApi } = await import('@/api/client');
        await annotation3DApi.deleteByTrack(trackId);

        // Clear local state — remove only this track's annotations.
        // Also remove their dirty entries (scoped, not wiping other tracks).
        const editorState = useEditorStore.getState();
        const allAnnotations = new Map(editorState.annotations);
        const allDirty = new Map(editorState.dirtyAnnotations);
        Array.from(allAnnotations.entries()).forEach(([id, a]) => {
          if (a.track_id === trackId) {
            allAnnotations.delete(id);
            allDirty.delete(id);
          }
        });
        useEditorStore.setState({ annotations: allAnnotations, dirtyAnnotations: allDirty });
        useEditorStore.getState().deselectAll();

        // Delete the track from trackStore
        useTrackStore.getState().deleteTrack(trackId);

        setShowDeleteModal(false);

        // Remove stale React Query cache so navigating to old frames doesn't
        // re-add deleted annotations via mergeAnnotationsFromServer.
        queryClient.removeQueries({ queryKey: ['annotations', task?.id] });
        queryClient.removeQueries({ queryKey: ['all-3d-annotations', task?.id] });
      }
    } catch (error) {
      console.error('Failed to delete track:', error);
      alert('Failed to delete track. Please try again.');
    }
  };

  const classDef = taxonomy?.classes.find((c) => c.id === ann.class_id);

  // Get effective attributes for this class (merging shared + class-specific)
  const effectiveAttributes = useMemo(() =>
    getEffectiveAttributesForClass(ann.class_id, taxonomy),
    [ann.class_id, taxonomy]
  );

  const isUnknownClass = !ann.class_id || ann.class_id === 'unknown' || ann.class_id.trim() === '';
  const displayClassName = classDef?.name || (isUnknownClass
    ? 'Unclassified'
    : ann.class_id.split('_').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
  const displayClassColor = classDef?.color || (isUnknownClass ? '#6b7280' : '#3b82f6');
  const cuboidData = ann.type === 'cuboid' ? ann.data as CuboidData : null;

  // Debug logging
  console.log('[CompactPropertiesPanel] ann.track_id:', ann.track_id, 'hasTrack:', !!ann.track_id);

  const hasTrack = !!ann.track_id;
  const track = hasTrack ? tracks.get(ann.track_id!) : undefined;
  console.log('[CompactPropertiesPanel] track found:', !!track, 'track details:', track);
  const frameIsKeyframe = hasTrack && currentFrame ? isKeyframe(ann.track_id!, currentFrame.id) : false;

  return (
    <div className="h-full overflow-y-auto p-2 space-y-2">
      {/* Header with class indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: displayClassColor }} />
          <span className="text-sm font-medium text-white">{displayClassName}</span>
        </div>
        <span className="text-[10px] text-gray-500 font-mono">{ann.id.slice(0, 8)}...</span>
      </div>

      {/* Source Badge - shows auto/manual_auto/manual */}
      {ann.source && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500">Source:</span>
          <div className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
            ann.source === 'auto' || ann.source === 'airflow_model_v1' || ann.source === 'airflow_model_v2'
              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
              : ann.source === 'auto_manual' || ann.source === 'auto_interpolated'
                ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                : 'bg-green-500/20 text-green-300 border border-green-500/30'
          }`}>
            {ann.source === 'auto' || ann.source === 'airflow_model_v1' || ann.source === 'airflow_model_v2' ? '🤖 Auto' : ann.source === 'auto_manual' || ann.source === 'auto_interpolated' ? '✏️ Auto+Manual' : '✏️ Manual'}
          </div>
        </div>
      )}

      {/* Class Selector */}
      <CollapsibleSection
        title="Classification"
        icon={<svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>}
        defaultOpen={false}
      >
        <div className="space-y-2">
          <select
            value={ann.class_id}
            onChange={(e) => updateAnnotation(ann.id, { class_id: e.target.value })}
            className="w-full bg-dark border border-gray-600 rounded px-2 py-1.5 text-white text-sm focus:outline-none focus:border-primary"
          >
            {taxonomy?.classes.map((cls) => (
              <option key={cls.id} value={cls.id}>{cls.name}</option>
            ))}
          </select>

          {/* Quick class buttons */}
          <div className="flex flex-wrap gap-1">
            {taxonomy?.classes.slice(0, 6).map((cls) => (
              <button
                key={cls.id}
                onClick={() => updateAnnotation(ann.id, { class_id: cls.id })}
                className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-all ${
                  ann.class_id === cls.id
                    ? 'bg-primary/20 border border-primary/50 text-white'
                    : 'bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700'
                }`}
              >
                <div className="w-2 h-2 rounded" style={{ backgroundColor: cls.color }} />
                {cls.name.slice(0, 8)}
              </button>
            ))}
          </div>
        </div>
      </CollapsibleSection>

      {/* Position (3D Cuboid) */}
      {cuboidData?.center && (
        <CollapsibleSection
          title="Position"
          icon={<svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /></svg>}
          defaultOpen={false}
        >
          <div className="grid grid-cols-3 gap-2">
            <NumericInput
              label="X"
              value={cuboidData.center.x}
              onChange={(v) => updateAnnotation(ann.id, {
                data: { ...ann.data, center: { ...cuboidData.center, x: v } }
              })}
              colorClass="text-red-400"
              unit="m"
            />
            <NumericInput
              label="Y"
              value={cuboidData.center.y}
              onChange={(v) => updateAnnotation(ann.id, {
                data: { ...ann.data, center: { ...cuboidData.center, y: v } }
              })}
              colorClass="text-green-400"
              unit="m"
            />
            <NumericInput
              label="Z"
              value={cuboidData.center.z}
              onChange={(v) => updateAnnotation(ann.id, {
                data: { ...ann.data, center: { ...cuboidData.center, z: v } }
              })}
              colorClass="text-blue-400"
              unit="m"
            />
          </div>
        </CollapsibleSection>
      )}

      {/* Dimensions */}
      {cuboidData?.dimensions && (
        <CollapsibleSection
          title="Dimensions"
          icon={<svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/></svg>}
          defaultOpen={false}
        >
          <div className="grid grid-cols-3 gap-2">
            <NumericInput
              label="Length"
              value={cuboidData.dimensions.length}
              onChange={(v) => updateAnnotation(ann.id, {
                data: { ...ann.data, dimensions: { ...cuboidData.dimensions, length: Math.max(0.1, v) } }
              })}
              min={0.1}
              unit="m"
            />
            <NumericInput
              label="Width"
              value={cuboidData.dimensions.width}
              onChange={(v) => updateAnnotation(ann.id, {
                data: { ...ann.data, dimensions: { ...cuboidData.dimensions, width: Math.max(0.1, v) } }
              })}
              min={0.1}
              unit="m"
            />
            <NumericInput
              label="Height"
              value={cuboidData.dimensions.height}
              onChange={(v) => updateAnnotation(ann.id, {
                data: { ...ann.data, dimensions: { ...cuboidData.dimensions, height: Math.max(0.1, v) } }
              })}
              min={0.1}
              unit="m"
            />
          </div>
        </CollapsibleSection>
      )}

      {/* Heading/Rotation */}
      {cuboidData && (
        <CollapsibleSection
          title="Orientation"
          icon={<svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>}
          defaultOpen={false}
        >
          <HeadingDial
            value={cuboidData.rotation?.yaw ?? 0}
            onChange={(yaw) => {
              const currentRotation = cuboidData.rotation ?? { yaw: 0, pitch: 0, roll: 0 };
              updateAnnotation(ann.id, {
                data: {
                  ...ann.data,
                  rotation: { ...currentRotation, yaw }
                }
              });
            }}
          />
        </CollapsibleSection>
      )}

      {/* Options */}
      <CollapsibleSection
        title="Options"
        icon={<svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>}
        defaultOpen={false}
      >
        <div className="space-y-2">
          {/* Static toggle */}
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-xs text-gray-400">Static Object</span>
            <div className="relative">
              <input
                type="checkbox"
                checked={ann.is_static ?? false}
                onChange={(e) => updateAnnotation(ann.id, { is_static: e.target.checked })}
                className="sr-only"
              />
              <div className={`w-8 h-4 rounded-full transition-colors ${
                ann.is_static ? 'bg-purple-500' : 'bg-gray-600'
              }`}>
                <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                  ann.is_static ? 'translate-x-4' : ''
                }`} />
              </div>
            </div>
          </label>
        </div>
      </CollapsibleSection>

      {/* Attributes - Using effectiveAttributes which merges shared + class-specific */}
      {Object.keys(effectiveAttributes).length > 0 && (
        <CollapsibleSection
          title="Attributes"
          icon={<svg className="w-3.5 h-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" /></svg>}
          badge={Object.keys(effectiveAttributes).length}
          defaultOpen={false}
        >
          <div className="space-y-2.5">
            {Object.entries(effectiveAttributes).map(([key, def]) => (
              <div key={key}>
                <label className="text-xs text-gray-400 block mb-1">{key}</label>
                {def.type === 'boolean' ? (
                  <label className="flex items-center justify-between cursor-pointer">
                    <span className="text-xs text-white">{ann.attributes?.[key] ? 'Yes' : 'No'}</span>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={(ann.attributes?.[key] as boolean) ?? def.default ?? false}
                        onChange={(e) => updateAnnotation(ann.id, {
                          attributes: { ...(ann.attributes || {}), [key]: e.target.checked }
                        })}
                        className="sr-only"
                      />
                      <div className={`w-8 h-4 rounded-full transition-colors ${
                        ann.attributes?.[key] ? 'bg-primary' : 'bg-gray-600'
                      }`}>
                        <div className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${
                          ann.attributes?.[key] ? 'translate-x-4' : ''
                        }`} />
                      </div>
                    </div>
                  </label>
                ) : def.type === 'enum' && def.options ? (
                  <select
                    value={(ann.attributes?.[key] as string) ?? def.default ?? ''}
                    onChange={(e) => updateAnnotation(ann.id, {
                      attributes: { ...(ann.attributes || {}), [key]: e.target.value }
                    })}
                    className="w-full bg-dark border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-primary"
                  >
                    {def.options.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={(ann.attributes?.[key] as string) ?? ''}
                    onChange={(e) => updateAnnotation(ann.id, {
                      attributes: { ...(ann.attributes || {}), [key]: e.target.value }
                    })}
                    className="w-full bg-dark border border-gray-600 rounded px-2 py-1 text-xs text-white focus:outline-none focus:border-primary"
                    placeholder="Enter value"
                  />
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Track Management */}
      <CollapsibleSection
        title="Tracking"
        icon={<svg className="w-3.5 h-3.5 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7"/></svg>}
        badge={hasTrack ? track?.keyframe_ids.size : undefined}
        defaultOpen={hasTrack}
      >
        {hasTrack && track ? (
          <div className="space-y-2">
            {/* Track ID */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-gray-500">Track ID</span>
              <button
                onClick={() => navigator.clipboard.writeText(ann.track_id!)}
                className="font-mono text-purple-400 hover:underline"
              >
                {ann.track_id!.slice(0, 12)}...
              </button>
            </div>

            {/* Keyframe toggle */}
            <button
              onClick={() => {
                if (!ann.track_id || !currentFrame) return;
                if (frameIsKeyframe) {
                  removeKeyframe(ann.track_id, currentFrame.id);
                  updateAnnotation(ann.id, { is_keyframe: false } as any);
                } else {
                  addKeyframe(ann.track_id, currentFrame.id, ann.id);
                }
              }}
              className={`w-full py-1.5 rounded text-xs flex items-center justify-center gap-1.5 ${
                frameIsKeyframe
                  ? 'bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30'
                  : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
              }`}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill={frameIsKeyframe ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 12l10 10 10-10L12 2z" />
              </svg>
              {frameIsKeyframe ? 'Keyframe ✓' : 'Mark as Keyframe'}
            </button>

            {/* Track Lifecycle Controls */}
            <div className="flex gap-1.5">
              <button
                onClick={() => {
                  if (ann.track_id && currentFrame) {
                    const sortedFrames = [...frames].sort((a, b) => a.frame_index - b.frame_index);
                    const frameIdx = sortedFrames.findIndex(f => f.id === currentFrame.id);
                    if (frameIdx !== -1) {
                      setTrackStart(ann.track_id, sortedFrames[frameIdx].frame_index);
                    }
                  }
                }}
                className={`flex-1 py-1 rounded text-[10px] flex items-center justify-center gap-1 ${
                  track.start_frame_index !== null
                    ? 'bg-orange-500/20 text-orange-300'
                    : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'
                }`}
                title="Set this frame as track start (where object first appears)"
              >
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 12H5M12 5l-7 7 7 7"/>
                </svg>
                {track.start_frame_index !== null ? `Start: F${track.start_frame_index + 1}` : 'Set Start'}
              </button>
              <button
                onClick={() => {
                  if (ann.track_id && currentFrame) {
                    const sortedFrames = [...frames].sort((a, b) => a.frame_index - b.frame_index);
                    const frameIdx = sortedFrames.findIndex(f => f.id === currentFrame.id);
                    if (frameIdx !== -1) {
                      setTrackEnd(ann.track_id, sortedFrames[frameIdx].frame_index);
                    }
                  }
                }}
                className={`flex-1 py-1 rounded text-[10px] flex items-center justify-center gap-1 ${
                  track.end_frame_index !== null
                    ? 'bg-red-500/20 text-red-300'
                    : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'
                }`}
                title="Set this frame as track end (where object disappears)"
              >
                {track.end_frame_index !== null ? `End: F${track.end_frame_index + 1}` : 'Set End'}
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </button>
            </div>

            {/* Clear track boundaries */}
            {(track.start_frame_index !== null || track.end_frame_index !== null) && (
              <button
                onClick={() => {
                  if (ann.track_id) {
                    setTrackStart(ann.track_id, null);
                    setTrackEnd(ann.track_id, null);
                  }
                }}
                className="w-full py-1 bg-gray-700/30 text-gray-500 rounded text-[10px] hover:bg-gray-700/50 hover:text-gray-400"
              >
                Clear Track Boundaries
              </button>
            )}

            {/* Status info - interpolation now happens automatically */}
            {track.keyframe_ids.size >= 1 && (
              <div className="text-[10px] text-gray-500 text-center py-1 border-t border-gray-700/50 mt-1">
                {track.keyframe_ids.size} keyframe{track.keyframe_ids.size > 1 ? 's' : ''} • Auto-interpolating
              </div>
            )}

            {/* Propagate Forward */}
            <div className="border-t border-gray-700 pt-2 mt-2">
              {showPropagateInput ? (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={propagateFrames}
                      onChange={(e) => setPropagateFrames(Math.max(1, parseInt(e.target.value) || 1))}
                      className="flex-1 px-2 py-1 bg-dark rounded text-xs text-white border border-gray-600 focus:border-primary outline-none w-12"
                      placeholder="N"
                    />
                    <select
                      value={propagateDirection}
                      onChange={(e) => setPropagateDirection(e.target.value as 'forward' | 'backward' | 'both')}
                      className="flex-1 px-2 py-1 bg-dark rounded text-xs text-white border border-gray-600 focus:border-primary outline-none"
                    >
                      <option value="forward">Forward</option>
                      <option value="backward">Backward</option>
                      <option value="both">Both</option>
                    </select>
                    <button
                      onClick={async () => {
                        let trackId = ann.track_id;
                        // Auto-create track if none exists
                        if (!trackId && currentFrame) {
                          const newTrack = createTrack(ann.class_id, ann.attributes || {});
                          addAnnotationToTrack(newTrack.id, currentFrame.id, ann.id, true);
                          trackId = newTrack.id;
                        }
                        if (trackId) {
                          await propagateTrack(trackId, propagateFrames, propagateDirection);
                          setShowPropagateInput(false);
                        }
                      }}
                      className="px-2 py-1 bg-green-500/20 text-green-300 rounded text-xs hover:bg-green-500/30"
                    >
                      Go
                    </button>
                    <button
                      onClick={() => setShowPropagateInput(false)}
                      className="px-1.5 py-1 text-gray-400 hover:text-white text-xs"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowPropagateInput(true)}
                  className="w-full py-1.5 bg-green-500/20 text-green-300 rounded text-xs hover:bg-green-500/30 flex items-center justify-center gap-1.5"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M13 5l7 7-7 7M5 5l7 7-7 7"/>
                  </svg>
                  Propagate Frames
                </button>
              )}
              <p className="text-[10px] text-gray-500 mt-1">
                Copy box to N frames. Edit any to auto-interpolate.
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <button
              onClick={() => {
                const newTrack = createTrack(ann.class_id, ann.attributes);
                if (currentFrame) {
                  addAnnotationToTrack(newTrack.id, currentFrame.id, ann.id, true);
                }
              }}
              className="w-full py-1.5 bg-purple-500/20 text-purple-300 rounded text-xs hover:bg-purple-500/30 flex items-center justify-center gap-1.5"
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Create New Track
            </button>

            {tracks.size > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowTrackList(!showTrackList)}
                  className="w-full py-1.5 bg-gray-700/50 text-gray-300 rounded text-xs hover:bg-gray-700 flex items-center justify-center gap-1.5"
                >
                  Assign to Existing Track
                </button>

                {showTrackList && (
                  <div className="absolute left-0 right-0 bottom-full mb-1 bg-dark-panel border border-gray-600 rounded shadow-xl z-20 max-h-32 overflow-y-auto">
                    {Array.from(tracks.values()).map(t => (
                      <button
                        key={t.id}
                        onClick={() => {
                          if (currentFrame) addAnnotationToTrack(t.id, currentFrame.id, ann.id, true);
                          setShowTrackList(false);
                        }}
                        className="w-full px-2 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-700/50"
                      >
                        <span className="font-mono text-purple-400">{t.id.slice(0, 8)}</span>
                        <span className="text-gray-500 ml-2">({t.keyframe_ids.size} keyframes)</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CollapsibleSection>

      {/* Delete button */}
      <button
        onClick={handleDelete}
        className="w-full py-2 bg-red-500/10 text-red-400 rounded-lg text-xs hover:bg-red-500/20 flex items-center justify-center gap-2 mt-4"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Delete Annotation
      </button>

      {/* Delete confirmation modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-dark-panel border border-gray-700 rounded-xl p-4 max-w-xs w-full mx-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-white mb-2">Delete Options</h3>
            <p className="text-xs text-gray-400 mb-3">
              This annotation is part of a track.
            </p>

            <div className="space-y-2">
              <button
                onClick={handleDeleteAnnotation}
                className="w-full px-3 py-2 bg-orange-500/20 text-orange-300 rounded text-xs hover:bg-orange-500/30"
              >
                Delete This Box Only
              </button>

              <button
                onClick={handleDeleteTrack}
                className="w-full px-3 py-2 bg-red-500/20 text-red-300 rounded text-xs hover:bg-red-500/30"
              >
                Delete Entire Track
              </button>

              <button
                onClick={() => setShowDeleteModal(false)}
                className="w-full px-3 py-2 bg-gray-700/50 text-gray-300 rounded text-xs hover:bg-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Track Change Confirmation Modal */}
      <TrackChangeConfirmationModal
        isOpen={confirmation.isOpen}
        changeDescription={confirmation.changeDescription}
        onConfirm={confirmChange}
        onCancel={cancelChange}
      />
    </div>
  );
};

export default CompactPropertiesPanel;

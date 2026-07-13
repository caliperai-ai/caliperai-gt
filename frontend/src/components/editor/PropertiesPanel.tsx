import React, { useState, useEffect, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEditorStore, useSelectedAnnotations } from '@/store/editorStore';
import { useAnnotation4DStore, LocalAnnotation4D } from '@/store/annotation4DStore';
import { useTrackStore } from '@/store/trackStore';
import { useTrackChangeConfirmation } from '@/hooks/useTrackChangeConfirmation';
import { TrackChangeConfirmationModal } from './TrackChangeConfirmationModal';
import { getEffectiveAttributesForClass } from '@/utils/taxonomyUtils';
import type { Annotation, CuboidData } from '@/types';
import type { ViewMode } from './types';


interface TrackManagementProps {
  annotation: ReturnType<typeof useSelectedAnnotations>[0];
  is4D?: boolean;
}

const TrackManagement: React.FC<TrackManagementProps> = ({ annotation, is4D = false }) => {
  const {
    tracks,
    createTrack,
    addKeyframe,
    removeKeyframe,
    isKeyframe,
    interpolateTrack,
    propagateTrack,
    addAnnotationToTrack,
  } = useTrackStore();
  const { currentFrame, updateAnnotation } = useEditorStore();
  const annotations4D = useAnnotation4DStore((s) => s.annotations4D);
  const updateAnnotation4D = useAnnotation4DStore((s) => s.updateAnnotation4D);
  const [showTrackList, setShowTrackList] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showPropagateInput, setShowPropagateInput] = useState(false);
  const [propagateFrames, setPropagateFrames] = useState(10);
  const [isPropagating, setIsPropagating] = useState(false);

  const hasTrack = !!annotation.track_id;
  const track = hasTrack ? tracks.get(annotation.track_id!) : undefined;
  const frameIsKeyframe = hasTrack && currentFrame ? isKeyframe(annotation.track_id!, currentFrame.id) : false;

  const otherTracks4D = useMemo(() => {
    if (!is4D || !annotation.track_id) return [];
    const result: { id: string; trackId: string; classId: string }[] = [];
    annotations4D.forEach((ann) => {
      if (ann.track_id && ann.track_id !== annotation.track_id && !ann.is_deleted) {
        if (!result.find(r => r.trackId === ann.track_id)) {
          result.push({ id: ann.id, trackId: ann.track_id, classId: ann.class_id });
        }
      }
    });
    return result;
  }, [annotations4D, annotation.track_id, is4D]);

  const deleteAnnotation4D = useAnnotation4DStore((s) => s.deleteAnnotation4D);

  const handleMergeTracks = (targetTrackId: string) => {
    if (!annotation.track_id) return;

    const sourceTrackId = annotation.track_id;

    const targetAnnotations: LocalAnnotation4D[] = [];
    const targetFrameIds = new Set<string>();

    annotations4D.forEach((ann) => {
      if (ann.track_id === targetTrackId && !ann.is_deleted) {
        targetAnnotations.push(ann);
        ann.frame_ids.forEach(fid => targetFrameIds.add(fid));
      }
    });

    const sourceAnnotations: LocalAnnotation4D[] = [];
    annotations4D.forEach((ann) => {
      if (ann.track_id === sourceTrackId && !ann.is_deleted) {
        sourceAnnotations.push(ann);
      }
    });

    sourceAnnotations.forEach((sourceAnn) => {
      const uniqueFrames = sourceAnn.frame_ids.filter(fid => !targetFrameIds.has(fid));

      if (uniqueFrames.length > 0 && targetAnnotations.length > 0) {
        const targetAnn = targetAnnotations[0];
        const extendedFrameIds = [...new Set([...targetAnn.frame_ids, ...uniqueFrames])];

        const mergedFrameData = { ...targetAnn.frame_data };
        uniqueFrames.forEach(fid => {
          if (sourceAnn.frame_data[fid]) {
            mergedFrameData[fid] = sourceAnn.frame_data[fid];
          }
        });

        updateAnnotation4D(targetAnn.id, {
          frame_ids: extendedFrameIds,
          frame_data: mergedFrameData
        });
      }

      deleteAnnotation4D(sourceAnn.id);
    });

    setShowMergeModal(false);
  };

  const handleCreateTrack = () => {
    const newTrack = createTrack(annotation.class_id, annotation.attributes);
    if (currentFrame) {
      addAnnotationToTrack(newTrack.id, currentFrame.id, annotation.id, true);
    }
  };

  const handleToggleKeyframe = () => {
    if (!annotation.track_id || !currentFrame) return;

    if (frameIsKeyframe) {
      removeKeyframe(annotation.track_id, currentFrame.id);
      updateAnnotation(annotation.id, { is_keyframe: false });
    } else {
      addKeyframe(annotation.track_id, currentFrame.id, annotation.id);
    }
  };

  const handleInterpolate = () => {
    if (!annotation.track_id) return;
    interpolateTrack(annotation.track_id);
  };

  const handlePropagate = async () => {
    if (propagateFrames < 1) return;

    let trackId = annotation.track_id;

    if (!trackId && currentFrame) {
      console.log('[PropertiesPanel] Auto-creating track for propagation');
      const newTrack = createTrack(annotation.class_id, annotation.attributes || {});
      addAnnotationToTrack(newTrack.id, currentFrame.id, annotation.id, true);
      trackId = newTrack.id;
    }

    if (!trackId) return;

    setIsPropagating(true);
    try {
      await propagateTrack(trackId, propagateFrames);
      setShowPropagateInput(false);
    } catch (error) {
      console.error('Failed to propagate track:', error);
    } finally {
      setIsPropagating(false);
    }
  };

  const handleAssignToTrack = (trackId: string) => {
    if (!currentFrame) return;
    addAnnotationToTrack(trackId, currentFrame.id, annotation.id, true);
    setShowTrackList(false);
  };

  if (is4D && hasTrack) {
    return (
      <div className="bg-dark rounded-xl p-3">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-sm font-medium text-gray-300 flex items-center gap-2">
            <svg className="w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
            Track (4D)
          </h4>
          <span className="text-xs text-purple-400 bg-purple-500/20 px-2 py-0.5 rounded-full">
            Tracked
          </span>
        </div>

        <div className="space-y-3">
          <div className="bg-dark-panel rounded-lg p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-500">Track ID</span>
              <button
                onClick={() => navigator.clipboard.writeText(annotation.track_id!)}
                className="text-xs text-primary hover:underline"
              >
                Copy
              </button>
            </div>
            <div className="font-mono text-sm text-purple-400 break-all select-all">
              {annotation.track_id}
            </div>
          </div>

          {otherTracks4D.length > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowMergeModal(!showMergeModal)}
                className="w-full py-2 bg-orange-500/20 text-orange-300 rounded-lg text-xs hover:bg-orange-500/30 flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M8 7L5 10l3 3"/>
                  <path d="M16 7l3 3-3 3"/>
                  <path d="M5 10h14"/>
                </svg>
                Merge into Another Track
              </button>

              {showMergeModal && (
                <div className="absolute left-0 right-0 mt-1 bg-dark-panel border border-gray-600 rounded-lg shadow-xl z-10 max-h-48 overflow-y-auto">
                  <div className="px-3 py-2 border-b border-gray-700 text-xs text-gray-400">
                    Select target track to merge into:
                  </div>
                  {otherTracks4D.map(t => (
                    <button
                      key={t.trackId}
                      onClick={() => handleMergeTracks(t.trackId)}
                      className="w-full px-3 py-2 text-left text-xs text-gray-300 hover:bg-gray-700/50 flex items-center gap-2"
                    >
                      <span className="font-mono text-purple-400">{t.trackId.slice(0, 8)}...</span>
                      <span className="text-gray-500 text-[10px]">({t.classId.slice(0, 8)})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-dark rounded-xl p-3">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium text-gray-300 flex items-center gap-2">
          <svg className="w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 12h14M12 5l7 7-7 7"/>
          </svg>
          Track
        </h4>
        {hasTrack && (
          <span className="text-xs text-purple-400 bg-purple-500/20 px-2 py-0.5 rounded-full">
            Tracked
          </span>
        )}
      </div>

      {hasTrack && track ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Track ID</span>
            <button
              onClick={() => navigator.clipboard.writeText(annotation.track_id!)}
              className="font-mono text-xs text-purple-400 hover:underline"
            >
              {annotation.track_id!.slice(0, 8)}...
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Keyframe</span>
            <button
              onClick={handleToggleKeyframe}
              className={`flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                frameIsKeyframe
                  ? 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/30'
                  : 'bg-gray-700/50 text-gray-400 hover:text-gray-200'
              }`}
            >
              <svg className="w-3 h-3" viewBox="0 0 24 24" fill={frameIsKeyframe ? "currentColor" : "none"} stroke="currentColor">
                <path d="M12 2L2 12l10 10 10-10L12 2z" />
              </svg>
              {frameIsKeyframe ? 'Keyframe' : 'Mark as Keyframe'}
            </button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Keyframes</span>
            <span className="text-xs text-gray-300">{track.keyframe_ids.size}</span>
          </div>

          {track.keyframe_ids.size >= 2 && (
            <button
              onClick={handleInterpolate}
              className="w-full py-2 bg-blue-500/20 text-blue-300 rounded-lg text-xs hover:bg-blue-500/30 flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M12 5l7 7-7 7"/>
              </svg>
              Interpolate Between Keyframes
            </button>
          )}

          {/* Propagate Section */}
          <div className="border-t border-gray-700 pt-3 mt-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-400">Propagate Forward</span>
            </div>
            {showPropagateInput ? (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={propagateFrames}
                  onChange={(e) => setPropagateFrames(Math.max(1, parseInt(e.target.value) || 1))}
                  min={1}
                  max={100}
                  className="flex-1 px-2 py-1.5 bg-dark-panel rounded text-xs text-white border border-gray-600 focus:border-primary outline-none w-16"
                  placeholder="Frames"
                />
                <span className="text-xs text-gray-500">frames</span>
                <button
                  onClick={handlePropagate}
                  disabled={isPropagating}
                  className="px-3 py-1.5 bg-green-500/20 text-green-300 rounded text-xs hover:bg-green-500/30 disabled:opacity-50"
                >
                  {isPropagating ? '...' : 'Go'}
                </button>
                <button
                  onClick={() => setShowPropagateInput(false)}
                  className="px-2 py-1.5 text-gray-400 hover:text-white text-xs"
                >
                  ✕
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowPropagateInput(true)}
                className="w-full py-2 bg-green-500/20 text-green-300 rounded-lg text-xs hover:bg-green-500/30 flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
                Propagate to N Frames
              </button>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <button
            onClick={handleCreateTrack}
            className="w-full py-2 bg-purple-500/20 text-purple-300 rounded-lg text-xs hover:bg-purple-500/30 flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Create New Track
          </button>

          {tracks.size > 0 && (
            <div className="relative">
              <button
                onClick={() => setShowTrackList(!showTrackList)}
                className="w-full py-2 bg-gray-700/50 text-gray-300 rounded-lg text-xs hover:bg-gray-700 flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
                Assign to Existing Track
              </button>

              {showTrackList && (
                <div className="absolute left-0 right-0 mt-1 bg-dark-panel border border-gray-600 rounded-lg shadow-xl z-10 max-h-40 overflow-y-auto">
                  {Array.from(tracks.values()).map(t => (
                    <button
                      key={t.id}
                      onClick={() => handleAssignToTrack(t.id)}
                      className="w-full px-3 py-2 text-left text-xs text-gray-300 hover:bg-gray-700/50 flex items-center gap-2"
                    >
                      <span className="font-mono text-purple-400">{t.id.slice(0, 8)}</span>
                      <span className="text-gray-500">({t.keyframe_ids.size} keyframes)</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ============================================================================
// PROPERTIES PANEL
// ============================================================================

interface PropertiesPanelProps {
  orthoViewsWidth?: number;
  showOrthoViews?: boolean;
  viewMode?: ViewMode;
}

export const PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  orthoViewsWidth = 480,
  showOrthoViews = false,
  viewMode = '3d'
}) => {
  void orthoViewsWidth;
  const selectedAnnotations = useSelectedAnnotations();
  const { taxonomy, updateAnnotation: updateAnnotationRegular, deleteAnnotation, selection } = useEditorStore();
  const queryClient = useQueryClient();

  // 4D annotation support - use selection from editorStore to trigger re-renders
  const selectedIds = selection.selectedAnnotationIds;
  const annotations4D = useAnnotation4DStore((s) => s.annotations4D);
  const selectedAnnotation4D = selectedIds.length > 0 ? annotations4D.get(selectedIds[0]) ?? null : null;
  const updateAnnotation4D = useAnnotation4DStore((s) => s.updateAnnotation4D);
  const deleteAnnotation4D = useAnnotation4DStore((s) => s.deleteAnnotation4D);

  const [isVisible, setIsVisible] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);

  // Track change confirmation hook
  const { confirmation, requestChange, confirmChange, cancelChange } = useTrackChangeConfirmation();

  const has4DSelection = selectedAnnotation4D !== null && !selectedAnnotation4D.is_deleted;
  const hasRegularSelection = selectedAnnotations.length > 0;

  useEffect(() => {
    setIsVisible(hasRegularSelection || has4DSelection);
  }, [selectedAnnotations.length, has4DSelection, hasRegularSelection]);

  if (!isVisible || (!hasRegularSelection && !has4DSelection)) return null;

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

  const updateAnnotation = (id: string, updates: Partial<Annotation>) => {
    // If annotation has a track, check if we need confirmation for significant changes
    if (ann.track_id) {
      // Check if this is a significant change that needs confirmation
      const isSignificantChange =
        updates.class_id !== undefined ||
        (updates.attributes && Object.keys(updates.attributes).length > 0) ||
        (updates.data && (updates.data as CuboidData).dimensions);

      if (isSignificantChange) {
        // Request confirmation - this will open the modal
        const needsConfirmation = requestChange(id, ann.track_id, updates, is4D);
        if (needsConfirmation) {
          return; // Don't apply yet, wait for user confirmation
        }
      }
    }

    // Apply the change directly (non-tracked or position-only changes)
    applyAnnotationUpdate(id, updates);
  };

  // Helper to actually apply annotation updates
  const applyAnnotationUpdate = (id: string, updates: Partial<Annotation>) => {
    // is_static is a track-level property — always apply to the whole track at once
    if (typeof updates.is_static === 'boolean' && ann.track_id) {
      useTrackStore.getState().updateTrackIsStatic(ann.track_id, updates.is_static);
      // Remove from updates so the per-annotation paths below don't double-apply
      const { is_static: _ignored, ...rest } = updates;
      updates = rest;
      if (Object.keys(updates).length === 0) return;
    }

    if (is4D && selectedAnnotation4D) {
      const data = updates.data as CuboidData | undefined;
      const existingWorldData = selectedAnnotation4D.world_data;

      if (data) {
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
      if (typeof updates.is_static === 'boolean') {
        updateAnnotation4D(id, { is_static: updates.is_static });
      }
    } else {
      updateAnnotationRegular(id, updates);
    }
  };

  const hasTrack = !!ann.track_id;

  const handleDeleteClick = () => {
    if (hasTrack) {
      setShowDeleteModal(true);
    } else {
      handleDeleteAnnotation();
    }
  };

  const handleDeleteAnnotation = () => {
    if (is4D) {
      deleteAnnotation4D(ann.id);
    } else {
      deleteAnnotation(ann.id);
    }
    setShowDeleteModal(false);
    setIsVisible(false);
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

        // Clear local state - remove ALL annotations belonging to this track.
        // Also remove their dirty entries (scoped — don't wipe the whole dirty map).
        const editorState = useEditorStore.getState();
        const allAnnotations = new Map(editorState.annotations);
        const allDirty = new Map(editorState.dirtyAnnotations);
        Array.from(allAnnotations.entries()).forEach(([id, a]) => {
          if (a.track_id === trackId) {
            allAnnotations.delete(id);
            allDirty.delete(id);
          }
        });
        // Clear selection so the canvas doesn't keep highlighting deleted annotations
        useEditorStore.setState({ annotations: allAnnotations, dirtyAnnotations: allDirty });
        useEditorStore.getState().deselectAll();

        // Remove the track from trackStore
        useTrackStore.getState().deleteTrack(trackId);

        setShowDeleteModal(false);
        setIsVisible(false);

        // Remove stale React Query cache so navigating to old frames doesn't
        // re-add deleted annotations via mergeAnnotationsFromServer.
        const currentTaskId = useEditorStore.getState().task?.id;
        queryClient.removeQueries({ queryKey: ['annotations', currentTaskId] });
        queryClient.removeQueries({ queryKey: ['all-3d-annotations', currentTaskId] });
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

  // Debug logging
  console.log('[PropertiesPanel] classDef:', classDef);
  console.log('[PropertiesPanel] classDef.attributes:', classDef?.attributes);
  console.log('[PropertiesPanel] ann.class_id:', ann.class_id);
  console.log('[PropertiesPanel] taxonomy classes:', taxonomy?.classes?.map(c => ({ id: c.id, name: c.name, hasAttributes: !!c.attributes })));
  console.log('[PropertiesPanel] taxonomy shared_attributes:', taxonomy?.shared_attributes);
  console.log('[PropertiesPanel] effectiveAttributes:', effectiveAttributes);

  const cuboidData = ann.type === 'cuboid' ? ann.data as {
    center?: { x: number; y: number; z: number };
    dimensions?: { length: number; width: number; height: number };
    rotation?: { yaw?: number; pitch?: number; roll?: number };
  } : null;

  const radToDeg = (rad: number) => (rad * 180 / Math.PI);

  const updatePosition = (axis: 'x' | 'y' | 'z', value: number) => {
    if (!cuboidData?.center) return;
    updateAnnotation(ann.id, {
      data: { ...ann.data, center: { ...cuboidData.center, [axis]: value } }
    });
  };

  const updateDimension = (dim: 'length' | 'width' | 'height', value: number) => {
    if (!cuboidData?.dimensions) return;
    updateAnnotation(ann.id, {
      data: { ...ann.data, dimensions: { ...cuboidData.dimensions, [dim]: Math.max(0.1, value) } }
    });
  };

  const updateHeading = (degrees: number) => {
    const radians = (degrees * Math.PI / 180);
    const currentRotation = cuboidData?.rotation ?? { yaw: 0, pitch: 0, roll: 0 };
    updateAnnotation(ann.id, {
      data: {
        ...ann.data,
        rotation: {
          yaw: radians,
          pitch: currentRotation.pitch ?? 0,
          roll: currentRotation.roll ?? 0
        }
      }
    });
  };

  const shouldSplit = showOrthoViews && viewMode !== '2d';
  const rightOffset = shouldSplit ? '25vw' : '0';

  return (
    <div
      className={`fixed top-12 bottom-0 z-30 bg-dark-panel border-l border-gray-700 shadow-2xl overflow-y-auto transition-all duration-300 ${!shouldSplit ? 'w-96' : ''}`}
      style={{ right: rightOffset, width: shouldSplit ? '12.5vw' : undefined }}
    >
      {/* Header */}
      <div className="sticky top-0 bg-dark-panel border-b border-gray-700 px-3 py-2 flex items-center justify-between">
        <h3 className="text-white font-medium">Properties</h3>
        <button
          onClick={() => setIsVisible(false)}
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-dark-hover"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Class Card */}
        <div className="bg-dark rounded-xl p-3">
          <div className="flex items-center gap-3 mb-3">
            <span className="w-8 h-8 rounded-lg" style={{ backgroundColor: displayClassColor }} />
            <div className="flex-1">
              <div className="text-white font-medium">{displayClassName}</div>
              <div className="text-xs text-gray-400 capitalize">{ann.type}</div>
            </div>
          </div>

          <select
            value={ann.class_id}
            onChange={(e) => updateAnnotation(ann.id, { class_id: e.target.value })}
            className="w-full bg-dark-panel border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary"
          >
            {taxonomy?.classes.map((cls) => (
              <option key={cls.id} value={cls.id}>{cls.name}</option>
            ))}
          </select>
        </div>

        {/* Source Badge - shows auto/manual_auto/manual */}
        {ann.source && (
          <div className="bg-dark rounded-xl p-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-gray-300 flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                Source
              </h4>
              <div className={`inline-block px-3 py-1 rounded-lg text-sm font-medium ${
                ann.source === 'auto' || ann.source === 'airflow_model_v1' || ann.source === 'airflow_model_v2'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                  : ann.source === 'auto_manual' || ann.source === 'auto_interpolated'
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                    : 'bg-green-500/20 text-green-300 border border-green-500/30'
              }`}>
                {ann.source === 'auto' || ann.source === 'airflow_model_v1' || ann.source === 'airflow_model_v2' ? '🤖 Auto' : ann.source === 'auto_manual' || ann.source === 'auto_interpolated' ? '✏️ Auto+Manual' : '✏️ Manual'}
              </div>
            </div>
          </div>
        )}

        {/* UUID */}
        <div className="bg-dark rounded-xl p-3">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium text-gray-300 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2" />
              </svg>
              UUID
            </h4>
            <button
              onClick={() => navigator.clipboard.writeText(ann.id)}
              className="text-xs text-primary hover:underline"
            >
              Copy
            </button>
          </div>
          <div className="font-mono text-xs text-gray-400 break-all bg-dark-panel rounded p-2 select-all">
            {ann.id}
          </div>
        </div>

        {/* Position (3D Cuboid) */}
        {ann.type === 'cuboid' && cuboidData?.center && (
          <div className="bg-dark rounded-xl p-3">
            <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
              </svg>
              Position
            </h4>
            <div className="grid grid-cols-3 gap-2">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <div key={axis}>
                  <label className={`text-xs block mb-1 font-semibold ${
                    axis === 'x' ? 'text-red-400' : axis === 'y' ? 'text-green-400' : 'text-blue-400'
                  }`}>{axis.toUpperCase()}</label>
                  <input
                    type="number"
                    step="0.1"
                    value={cuboidData.center?.[axis]?.toFixed(2) ?? '0.00'}
                    onChange={(e) => updatePosition(axis, parseFloat(e.target.value) || 0)}
                    className="w-full bg-dark-panel border border-gray-600 rounded-lg px-3 py-2.5 text-white text-base font-mono"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Dimensions (3D Cuboid) */}
        {ann.type === 'cuboid' && cuboidData?.dimensions && (
          <div className="bg-dark rounded-xl p-3">
            <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
              </svg>
              Dimensions
            </h4>
            <div className="grid grid-cols-3 gap-2">
              {(['length', 'width', 'height'] as const).map((dim) => (
                <div key={dim}>
                  <label className="text-xs text-gray-500 block mb-1">{dim.charAt(0).toUpperCase()}</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={cuboidData.dimensions?.[dim]?.toFixed(2) ?? '1.00'}
                    onChange={(e) => updateDimension(dim, parseFloat(e.target.value) || 0.1)}
                    className="w-full bg-dark-panel border border-gray-600 rounded-lg px-3 py-2.5 text-white text-base font-mono"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Heading/Rotation (3D Cuboid) */}
        {ann.type === 'cuboid' && (
          <div className="bg-dark rounded-xl p-3">
            <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Heading (Yaw)
            </h4>
            <div className="flex items-center gap-3">
              <input
                type="range"
                min="-180"
                max="180"
                step="1"
                value={radToDeg(cuboidData?.rotation?.yaw ?? 0).toFixed(0)}
                onChange={(e) => updateHeading(parseFloat(e.target.value))}
                className="flex-1 h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-primary"
              />
              <div className="w-24">
                <input
                  type="number"
                  step="1"
                  value={radToDeg(cuboidData?.rotation?.yaw ?? 0).toFixed(1)}
                  onChange={(e) => updateHeading(parseFloat(e.target.value) || 0)}
                  className="w-full bg-dark-panel border border-gray-600 rounded-lg px-3 py-2.5 text-white text-base font-mono text-center"
                />
              </div>
              <span className="text-gray-500 text-xs">°</span>
            </div>
            {/* Visual heading indicator */}
            <div className="mt-3 flex items-center justify-center">
              <div className="relative w-16 h-16 rounded-full border-2 border-gray-600">
                <div
                  className="absolute top-1/2 left-1/2 w-6 h-0.5 bg-red-500 origin-left"
                  style={{ transform: `translateY(-50%) rotate(${-(cuboidData?.rotation?.yaw ?? 0)}rad)` }}
                />
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 text-[8px] text-gray-500">N</div>
                <div className="absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1 text-[8px] text-gray-500">S</div>
                <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-2 text-[8px] text-gray-500">W</div>
                <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-2 text-[8px] text-gray-500">E</div>
              </div>
            </div>
          </div>
        )}

        {/* Track Management */}
        <TrackManagement annotation={ann} is4D={is4D} />

        {/* Static Object Toggle */}
        <div className="bg-dark rounded-xl p-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M12 8v8M8 12h8"/>
              </svg>
              <span className="text-sm font-medium text-gray-300">Static Object</span>
            </div>
            <label className="flex items-center gap-2 cursor-pointer">
              <div className="relative">
                <input
                  type="checkbox"
                  checked={ann.is_static ?? false}
                  onChange={(e) => updateAnnotation(ann.id, { is_static: e.target.checked })}
                  className="sr-only"
                />
                <div className={`w-10 h-5 rounded-full transition-colors ${
                  ann.is_static ? 'bg-purple-500' : 'bg-gray-600'
                }`}>
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                    ann.is_static ? 'translate-x-5' : ''
                  }`} />
                </div>
              </div>
            </label>
          </div>
          <p className="text-[10px] text-gray-500 mt-2">
            Mark objects that don't move (buildings, signs, poles, etc.)
          </p>
        </div>

        {/* Attributes - Using effectiveAttributes which merges shared + class-specific */}
        {Object.keys(effectiveAttributes).length > 0 && (
          <div className="bg-dark rounded-xl p-3">
            <h4 className="text-sm font-medium text-gray-300 mb-2">Attributes</h4>
            <div className="space-y-3">
              {Object.entries(effectiveAttributes).map(([key, def]) => (
                <div key={key}>
                  <label className="text-xs text-gray-400 block mb-1.5">{key}</label>
                  {def.type === 'boolean' ? (
                    <label className="flex items-center gap-3 cursor-pointer">
                      <div className="relative">
                        <input
                          type="checkbox"
                          checked={(ann.attributes?.[key] as boolean) ?? def.default ?? false}
                          onChange={(e) => updateAnnotation(ann.id, {
                            attributes: { ...(ann.attributes || {}), [key]: e.target.checked }
                          })}
                          className="sr-only"
                        />
                        <div className={`w-10 h-5 rounded-full transition-colors ${
                          ann.attributes?.[key] ? 'bg-primary' : 'bg-gray-600'
                        }`}>
                          <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
                            ann.attributes?.[key] ? 'translate-x-5' : ''
                          }`} />
                        </div>
                      </div>
                      <span className="text-sm text-white">{ann.attributes?.[key] ? 'Yes' : 'No'}</span>
                    </label>
                  ) : def.type === 'enum' && def.options ? (
                    <select
                      value={(ann.attributes?.[key] as string) ?? def.default ?? ''}
                      onChange={(e) => updateAnnotation(ann.id, {
                        attributes: { ...(ann.attributes || {}), [key]: e.target.value }
                      })}
                      className="w-full bg-dark-panel border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
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
                      className="w-full bg-dark-panel border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
                      placeholder="Enter value"
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Meta Info */}
        <div className="bg-dark rounded-xl p-3 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Source</span>
            <span className={ann.source === 'manual' ? 'text-green-400' : 'text-yellow-400'}>
              {ann.source}
            </span>
          </div>
          {ann.source !== 'manual' && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Verified</span>
              <span className={ann.is_verified ? 'text-green-400' : 'text-red-400'}>
                {ann.is_verified ? 'Yes' : 'No'}
              </span>
            </div>
          )}
        </div>

        {/* Delete Button */}
        <button
          onClick={handleDeleteClick}
          className="w-full px-4 py-3 bg-red-500/10 text-red-400 rounded-xl hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Delete {hasTrack ? '...' : 'Annotation'}
        </button>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-dark-panel border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-2">Delete Options</h3>
            <p className="text-sm text-gray-400 mb-4">
              This annotation is part of a track. What would you like to delete?
            </p>

            <div className="space-y-3">
              <button
                onClick={handleDeleteAnnotation}
                className="w-full px-4 py-3 bg-orange-500/20 text-orange-300 rounded-lg hover:bg-orange-500/30 transition-colors flex items-center gap-3"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
                </svg>
                <div className="text-left">
                  <div className="font-medium">Delete This Box Only</div>
                  <div className="text-xs text-orange-400/70">Remove only this annotation</div>
                </div>
              </button>

              <button
                onClick={handleDeleteTrack}
                className="w-full px-4 py-3 bg-red-500/20 text-red-300 rounded-lg hover:bg-red-500/30 transition-colors flex items-center gap-3"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                <div className="text-left">
                  <div className="font-medium">Delete Entire Track</div>
                  <div className="text-xs text-red-400/70">Remove all boxes in track {ann.track_id?.slice(0, 8)}...</div>
                </div>
              </button>

              <button
                onClick={() => setShowDeleteModal(false)}
                className="w-full px-4 py-3 bg-gray-700/50 text-gray-300 rounded-lg hover:bg-gray-700 transition-colors"
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

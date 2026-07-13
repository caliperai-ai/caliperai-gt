import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useEditorStore, useCurrentFrameAnnotations } from '@/store/editorStore';
import { useAnnotation4DStore } from '@/store/annotation4DStore';
import { useTrackStore } from '@/store/trackStore';
import { annotation3DApi, qaApi } from '@/api/client';
import { useIsQAMode } from '@/store/qaStore';
import { getEffectiveAttributesForClass } from '@/utils/taxonomyUtils';
import type { Annotation, CuboidData, TaxonomyConfig } from '@/types';


type TrackFilter = 'all' | 'tracked' | 'untracked';

interface AnnotationListPanelProps {
  isVisible?: boolean;
  onToggle?: () => void;
  onWidthChange?: (width: number) => void;
}


interface ExpandedEditorProps {
  annotation: Annotation;
  is4D: boolean;
  taxonomy: TaxonomyConfig | null;
  isLocked: boolean;
}

const ExpandedEditor: React.FC<ExpandedEditorProps> = ({ annotation, is4D, taxonomy, isLocked }) => {
  const queryClient = useQueryClient();
  const ann = annotation;
  const cuboidData = ann.type === 'cuboid' ? ann.data as CuboidData : null;

  const updateAnnotationRegular = useEditorStore(s => s.updateAnnotation);
  const deleteAnnotation = useEditorStore(s => s.deleteAnnotation);
  const currentFrame = useEditorStore(s => s.currentFrame);
  const frames = useEditorStore(s => s.frames);
  const allAnnotations = useEditorStore(s => s.annotations);
  const saveAnnotations = useEditorStore(s => s.saveAnnotations);

  const { tracks, createTrack, addAnnotationToTrack, isKeyframe, markAsKeyframe, removeKeyframe, propagateTrack, deleteTrack, setTrackStart, setTrackEnd } = useTrackStore();
  const updateAnnotation4D = useAnnotation4DStore(s => s.updateAnnotation4D);
  const deleteAnnotation4D = useAnnotation4DStore(s => s.deleteAnnotation4D);
  const annotations4D = useAnnotation4DStore(s => s.annotations4D);

  const taskId = useEditorStore(s => s.task?.id);

  const [localPosition, setLocalPosition] = useState({ x: '', y: '', z: '' });
  const [localDimensions, setLocalDimensions] = useState({ length: '', width: '', height: '' });
  const [localHeading, setLocalHeading] = useState('');
  const [showTrackList, setShowTrackList] = useState(false);
  const [showPropagateInput, setShowPropagateInput] = useState(false);
  const [propagateFrames, setPropagateFrames] = useState(10);
  const [propagateDirection, setPropagateDirection] = useState<'forward' | 'backward' | 'both'>('forward');
  const [isPropagating, setIsPropagating] = useState(false);
  const [propagateSuccess, setPropagateSuccess] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showTrackChangeModal, setShowTrackChangeModal] = useState(false);
  const [pendingTrackChange, setPendingTrackChange] = useState<{ updates: Partial<Annotation>; changeType: string } | null>(null);
  const [isApplyingTrackChange, setIsApplyingTrackChange] = useState(false);

  useEffect(() => {
    if (cuboidData?.center) {
      setLocalPosition({
        x: cuboidData.center.x?.toFixed(2) ?? '0',
        y: cuboidData.center.y?.toFixed(2) ?? '0',
        z: cuboidData.center.z?.toFixed(2) ?? '0',
      });
    }
    if (cuboidData?.dimensions) {
      setLocalDimensions({
        length: cuboidData.dimensions.length?.toFixed(2) ?? '1',
        width: cuboidData.dimensions.width?.toFixed(2) ?? '1',
        height: cuboidData.dimensions.height?.toFixed(2) ?? '1',
      });
    }
    if (cuboidData?.rotation) {
      const yawDeg = (cuboidData.rotation.yaw ?? 0) * 180 / Math.PI;
      setLocalHeading(yawDeg.toFixed(1));
    }
  }, [cuboidData]);

  const hasTrack = !!ann.track_id;
  const track = hasTrack ? tracks.get(ann.track_id!) : undefined;
  const keyframeCount = track?.keyframe_ids.size ?? 0;
  const frameIsKeyframe = ann.track_id && currentFrame ? isKeyframe(ann.track_id, currentFrame.id) : false;

  const effectiveAttributes = getEffectiveAttributesForClass(ann.class_id, taxonomy);
  const hasAttributes = Object.keys(effectiveAttributes).length > 0;

  const isSignificantChange = (updates: Partial<Annotation>): { significant: boolean; type: string } => {
    if (updates.class_id) return { significant: true, type: 'class' };
    if (typeof updates.is_static === 'boolean') return { significant: true, type: 'static flag' };
    if (updates.attributes && Object.keys(updates.attributes).length > 0) return { significant: true, type: 'attributes' };
    if (updates.data && (updates.data as CuboidData).dimensions) return { significant: true, type: 'dimensions' };
    if (updates.data && (updates.data as CuboidData).center) return { significant: true, type: 'position' };
    if (updates.data && (updates.data as CuboidData).rotation) return { significant: true, type: 'rotation' };
    return { significant: false, type: '' };
  };

  const executeUpdate = async (updates: Partial<Annotation>, applyToTrack: boolean = false) => {
    if (is4D) {
      const ann4D = annotations4D.get(ann.id);
      if (!ann4D) return;

      const data = updates.data as CuboidData | undefined;

      if (applyToTrack && ann4D.track_id) {
        const trackId = ann4D.track_id;
        const newAnnotations4D = new Map(annotations4D);

        newAnnotations4D.forEach((a, aId) => {
          if (a.track_id === trackId && !a.is_deleted) {
            let updatedAnnotation = { ...a };
            let changed = false;

            if (updates.class_id) { updatedAnnotation.class_id = updates.class_id; changed = true; }
            if (updates.attributes) { updatedAnnotation.attributes = updates.attributes as Record<string, unknown>; changed = true; }
            if (typeof updates.is_static === 'boolean') { updatedAnnotation.is_static = updates.is_static; changed = true; }
            if (data?.dimensions) { updatedAnnotation.world_data = { ...a.world_data, dimensions: data.dimensions }; changed = true; }

            if (changed) newAnnotations4D.set(aId, updatedAnnotation);
          }
        });

        useAnnotation4DStore.setState({ annotations4D: newAnnotations4D });
        await saveAnnotations();
        queryClient.invalidateQueries({ queryKey: ['task-annotations'] });
      } else {
        if (data) {
          updateAnnotation4D(ann.id, { world_data: { ...ann4D.world_data, ...data } });
        }
        if (updates.attributes) updateAnnotation4D(ann.id, { attributes: updates.attributes as Record<string, unknown> });
        if (updates.class_id) updateAnnotation4D(ann.id, { class_id: updates.class_id });
        if (typeof updates.is_static === 'boolean') updateAnnotation4D(ann.id, { is_static: updates.is_static });
      }
    } else {
      if (applyToTrack && ann.track_id) {
        const trackId = ann.track_id;
        const trackUpdatePayload: Record<string, unknown> = {};

        if (updates.class_id) trackUpdatePayload.class_id = updates.class_id;
        if (updates.attributes) trackUpdatePayload.attributes = updates.attributes;
        if (typeof updates.is_static === 'boolean') trackUpdatePayload.is_static = updates.is_static;
        if (updates.data) {
          const updateData = updates.data as CuboidData;
          if (updateData.dimensions) trackUpdatePayload.dimensions = updateData.dimensions;
        }

        try {
          await annotation3DApi.updateByTrack(trackId, trackUpdatePayload);

          const newAnnotations = new Map(allAnnotations);
          newAnnotations.forEach((a, aId) => {
            if (a.track_id === trackId) {
              const updatedAnnotation = { ...a, ...updates };
              if (updates.data) {
                updatedAnnotation.data = { ...(a.data as CuboidData), ...(updates.data as CuboidData) };
              }
              updatedAnnotation.updated_at = new Date().toISOString();
              newAnnotations.set(aId, updatedAnnotation);
            }
          });

          useEditorStore.setState({ annotations: newAnnotations });
          queryClient.invalidateQueries({ queryKey: ['task-annotations'] });
        } catch (error) {
          console.error('Failed to update track:', error);
        }
      } else {
        updateAnnotationRegular(ann.id, updates);

        if (ann.track_id && currentFrame && updates.data) {
          markAsKeyframe(ann.track_id, currentFrame.id);
        }
      }
    }
  };

  const updateAnnotation = async (updates: Partial<Annotation>, changeTypeHint: string = '') => {
    const { significant, type } = isSignificantChange(updates);
    if (ann.track_id && significant) {
      setPendingTrackChange({ updates, changeType: type || changeTypeHint });
      setShowTrackChangeModal(true);
      return;
    }
    await executeUpdate(updates, false);
  };

  const handleTrackChangeConfirm = async (applyToTrack: boolean) => {
    if (pendingTrackChange) {
      setIsApplyingTrackChange(true);
      try {
        await executeUpdate(pendingTrackChange.updates, applyToTrack);
      } finally {
        setIsApplyingTrackChange(false);
      }
    }
    setShowTrackChangeModal(false);
    setPendingTrackChange(null);
  };

  const handleDeleteAnnotation = () => {
    if (is4D) deleteAnnotation4D(ann.id);
    else deleteAnnotation(ann.id);
    setShowDeleteModal(false);
  };

  const handleDeleteTrack = async () => {
    if (!ann.track_id) return;
    const trackId = ann.track_id;

    try {
      if (is4D) {
        annotations4D.forEach(a => {
          if (a.track_id === trackId && !a.is_deleted) deleteAnnotation4D(a.id);
        });
        await saveAnnotations();
      } else {
        await annotation3DApi.deleteByTrack(trackId);
        const newAnnotations = new Map(allAnnotations);
        const dirtyAnnotations = new Map(useEditorStore.getState().dirtyAnnotations);
        newAnnotations.forEach((a, id) => {
          if (a.track_id === trackId) {
            newAnnotations.delete(id);
            dirtyAnnotations.delete(id);
          }
        });
        useEditorStore.setState({ annotations: newAnnotations, dirtyAnnotations });
        deleteTrack(trackId);
        queryClient.removeQueries({ queryKey: ['annotations', taskId] });
      }
    } catch (error) {
      console.error('Failed to delete track:', error);
    }
    setShowDeleteModal(false);
  };

  const handlePropagate = async () => {
    if (!ann.track_id) return;
    setIsPropagating(true);
    setPropagateSuccess(false);
    try {
      await propagateTrack(ann.track_id, propagateFrames, propagateDirection);
      setPropagateSuccess(true);
      setTimeout(() => {
        setPropagateSuccess(false);
        setShowPropagateInput(false);
      }, 1500);
    } finally {
      setIsPropagating(false);
    }
  };

  return (
    <div className={`space-y-2 ${isLocked ? 'pointer-events-none opacity-60' : ''}`}>
      {/* Class Selector */}
      <div>
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Class</label>
        <select
          value={ann.class_id}
          onChange={(e) => updateAnnotation({ class_id: e.target.value })}
          className="w-full bg-[#1a1a1a] border border-gray-800 rounded px-2 py-1.5 text-xs text-white focus:outline-none focus:border-gray-600"
        >
          {taxonomy?.classes.map(cls => (
            <option key={cls.id} value={cls.id}>{cls.name}</option>
          ))}
        </select>
      </div>

      {/* Position */}
      {cuboidData?.center && (
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Position</label>
          <div className="grid grid-cols-3 gap-1">
            {(['x', 'y', 'z'] as const).map(axis => (
              <div key={axis}>
                <span className={`text-xs font-bold ${axis === 'x' ? 'text-red-400' : axis === 'y' ? 'text-green-400' : 'text-blue-400'}`}>
                  {axis.toUpperCase()}
                </span>
                <input
                  type="number"
                  step="0.1"
                  value={localPosition[axis]}
                  onChange={(e) => setLocalPosition(prev => ({ ...prev, [axis]: e.target.value }))}
                  onBlur={() => {
                    const value = parseFloat(localPosition[axis]) || 0;
                    if (value !== cuboidData.center?.[axis]) {
                      const currentCenter = cuboidData.center ?? { x: 0, y: 0, z: 0 };
                      updateAnnotation({ data: { ...ann.data, center: { ...currentCenter, [axis]: value } } });
                    }
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="w-full bg-[#1a1a1a] border border-gray-800 rounded px-1.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-gray-600"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dimensions */}
      {cuboidData?.dimensions && (
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Dimensions</label>
          <div className="grid grid-cols-3 gap-1">
            {(['length', 'width', 'height'] as const).map(dim => (
              <div key={dim}>
                <span className="text-xs text-gray-500">{dim.charAt(0).toUpperCase()}</span>
                <input
                  type="number"
                  step="0.1"
                  min="0.1"
                  value={localDimensions[dim]}
                  onChange={(e) => setLocalDimensions(prev => ({ ...prev, [dim]: e.target.value }))}
                  onBlur={() => {
                    const value = Math.max(0.1, parseFloat(localDimensions[dim]) || 0.1);
                    if (value !== cuboidData.dimensions?.[dim]) {
                      const currentDims = cuboidData.dimensions ?? { length: 1, width: 1, height: 1 };
                      updateAnnotation({ data: { ...ann.data, dimensions: { ...currentDims, [dim]: value } } });
                    }
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  className="w-full bg-[#1a1a1a] border border-gray-800 rounded px-1.5 py-1 text-xs text-white font-mono focus:outline-none focus:border-gray-600"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Heading */}
      {cuboidData && (
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Heading</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              step="1"
              value={localHeading}
              onChange={(e) => setLocalHeading(e.target.value)}
              onBlur={() => {
                const degrees = parseFloat(localHeading) || 0;
                const radians = degrees * Math.PI / 180;
                const currentYaw = cuboidData.rotation?.yaw ?? 0;
                if (Math.abs(radians - currentYaw) > 0.001) {
                  const currentRotation = cuboidData.rotation ?? { yaw: 0, pitch: 0, roll: 0 };
                  updateAnnotation({ data: { ...ann.data, rotation: { ...currentRotation, yaw: radians } } });
                }
              }}
              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              className="flex-1 bg-[#1a1a1a] border border-gray-800 rounded px-2 py-1 text-xs text-white font-mono text-center focus:outline-none focus:border-gray-600"
            />
            <span className="text-xs text-gray-500">deg</span>
            {/* Visual indicator */}
            <div className="w-6 h-6 rounded-full border border-gray-700 bg-[#1a1a1a] relative">
              <div className="absolute top-1/2 left-1/2 w-2.5 h-0.5 bg-red-500 origin-left rounded"
                   style={{ transform: `translateY(-50%) rotate(${-(cuboidData.rotation?.yaw ?? 0)}rad)` }} />
            </div>
          </div>
        </div>
      )}

      {/* Static Toggle */}
      <div className="flex items-center justify-between py-1">
        <span className="text-xs text-gray-400">Static Object</span>
        <button
          onClick={() => updateAnnotation({ is_static: !ann.is_static })}
          className={`w-8 h-4 rounded-full transition-colors relative ${ann.is_static ? 'bg-cyan-500' : 'bg-gray-700'}`}
        >
          <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${ann.is_static ? 'left-4' : 'left-0.5'}`} />
        </button>
      </div>

      {/* Attributes */}
      {hasAttributes && (
        <div>
          <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1 block">Attributes</label>
          <div className="space-y-1.5">
            {Object.entries(effectiveAttributes).map(([key, def]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="text-xs text-gray-400">{key}</span>
                {def.type === 'boolean' ? (
                  <button
                    onClick={() => updateAnnotation({ attributes: { ...(ann.attributes || {}), [key]: !ann.attributes?.[key] } })}
                    className={`w-8 h-4 rounded-full transition-colors relative ${ann.attributes?.[key] ? 'bg-primary' : 'bg-gray-700'}`}
                  >
                    <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${ann.attributes?.[key] ? 'left-4' : 'left-0.5'}`} />
                  </button>
                ) : def.type === 'enum' && def.options ? (
                  <select
                    value={(ann.attributes?.[key] as string) ?? def.default ?? ''}
                    onChange={(e) => updateAnnotation({ attributes: { ...(ann.attributes || {}), [key]: e.target.value } })}
                    className="bg-[#1a1a1a] border border-gray-800 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                  >
                    {def.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={(ann.attributes?.[key] as string) ?? ''}
                    onChange={(e) => updateAnnotation({ attributes: { ...(ann.attributes || {}), [key]: e.target.value } })}
                    className="w-20 bg-[#1a1a1a] border border-gray-800 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Track Section */}
      <div className="pt-2 border-t border-gray-800">
        <label className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1.5 block">Track</label>

        {hasTrack ? (
          <div className="space-y-1.5">
            {/* Track ID badge */}
            <div className="flex items-center justify-between text-xs">
              <span className="text-purple-400 font-mono">{ann.track_id?.slice(0, 8)}</span>
              <span className="text-gray-500">{keyframeCount} keyframes</span>
            </div>

            {/* Keyframe toggle */}
            <button
              onClick={() => {
                if (!ann.track_id || !currentFrame) return;
                if (frameIsKeyframe) removeKeyframe(ann.track_id, currentFrame.id);
                else markAsKeyframe(ann.track_id, currentFrame.id);
              }}
              className={`w-full py-1 rounded text-xs flex items-center justify-center gap-1 transition-colors ${
                frameIsKeyframe ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill={frameIsKeyframe ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                <path d="M12 2L2 12l10 10 10-10L12 2z" />
              </svg>
              {frameIsKeyframe ? 'Keyframe ✓' : 'Set Keyframe'}
            </button>

            {/* Start/End */}
            <div className="flex gap-1">
              <button
                onClick={() => {
                  if (!ann.track_id || !currentFrame) return;
                  const sortedFrames = [...frames].sort((a, b) => a.frame_index - b.frame_index);
                  const frameIdx = sortedFrames.findIndex(f => f.id === currentFrame.id);
                  if (frameIdx !== -1) {
                    const currentStartIdx = sortedFrames[frameIdx].frame_index;
                    if (track?.start_frame_index === currentStartIdx) setTrackStart(ann.track_id, null);
                    else setTrackStart(ann.track_id, currentStartIdx);
                  }
                }}
                className={`flex-1 py-1 rounded text-xs ${
                  track?.start_frame_index != null ? 'bg-orange-500/20 text-orange-300' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                Start: {track?.start_frame_index != null ? track.start_frame_index + 1 : '—'}
              </button>
              <button
                onClick={() => {
                  if (!ann.track_id || !currentFrame) return;
                  const sortedFrames = [...frames].sort((a, b) => a.frame_index - b.frame_index);
                  const frameIdx = sortedFrames.findIndex(f => f.id === currentFrame.id);
                  if (frameIdx !== -1) {
                    const currentEndIdx = sortedFrames[frameIdx].frame_index;
                    if (track?.end_frame_index === currentEndIdx) setTrackEnd(ann.track_id, null);
                    else setTrackEnd(ann.track_id, currentEndIdx);
                  }
                }}
                className={`flex-1 py-1 rounded text-xs ${
                  track?.end_frame_index != null ? 'bg-red-500/20 text-red-300' : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
                }`}
              >
                End: {track?.end_frame_index != null ? track.end_frame_index + 1 : '—'}
              </button>
            </div>

            {/* Propagate */}
            {showPropagateInput ? (
              <div className="space-y-1">
                <div className="flex gap-1">
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={propagateFrames}
                    onChange={(e) => setPropagateFrames(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-12 bg-[#1a1a1a] border border-gray-800 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                    placeholder="N"
                  />
                  <select
                    value={propagateDirection}
                    onChange={(e) => setPropagateDirection(e.target.value as 'forward' | 'backward' | 'both')}
                    className="flex-1 bg-[#1a1a1a] border border-gray-800 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none"
                  >
                    <option value="forward">Forward</option>
                    <option value="backward">Backward</option>
                    <option value="both">Both</option>
                  </select>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={handlePropagate}
                    disabled={isPropagating}
                    className={`flex-1 py-1 rounded text-xs ${
                      propagateSuccess ? 'bg-green-500/30 text-green-300' : isPropagating ? 'bg-green-500/20 text-green-300 cursor-wait' : 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                    }`}
                  >
                    {propagateSuccess ? '✓' : isPropagating ? '...' : 'Go'}
                  </button>
                  <button
                    onClick={() => setShowPropagateInput(false)}
                    className="px-2 py-1 bg-gray-800 text-gray-400 rounded text-xs hover:bg-gray-700"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowPropagateInput(true)}
                className="w-full py-1 bg-green-500/10 text-green-400 rounded text-xs hover:bg-green-500/20 flex items-center justify-center gap-1"
              >
                <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M13 5l7 7-7 7M5 5l7 7-7 7"/>
                </svg>
                Propagate
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            <button
              onClick={() => {
                const newTrack = createTrack(ann.class_id, ann.attributes);
                if (currentFrame) addAnnotationToTrack(newTrack.id, currentFrame.id, ann.id, true);
              }}
              className="w-full py-1.5 bg-purple-500/10 text-purple-400 rounded text-xs hover:bg-purple-500/20 flex items-center justify-center gap-1"
            >
              <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 5v14M5 12h14"/>
              </svg>
              Create Track
            </button>

            {tracks.size > 0 && (
              <div className="relative">
                <button
                  onClick={() => setShowTrackList(!showTrackList)}
                  className="w-full py-1 bg-gray-800 text-gray-400 rounded text-xs hover:bg-gray-700"
                >
                  Assign to Track
                </button>
                {showTrackList && (
                  <div className="absolute left-0 right-0 bottom-full mb-1 bg-[#1a1a1a] border border-gray-800 rounded shadow-xl z-20 max-h-24 overflow-y-auto">
                    {Array.from(tracks.values()).map(t => (
                      <button
                        key={t.id}
                        onClick={() => {
                          if (currentFrame) addAnnotationToTrack(t.id, currentFrame.id, ann.id, true);
                          setShowTrackList(false);
                        }}
                        className="w-full px-2 py-1 text-left text-xs text-gray-300 hover:bg-gray-800 border-b border-gray-800 last:border-b-0"
                      >
                        <span className="text-purple-400 font-mono">{t.id.slice(0, 8)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Delete */}
      <button
        onClick={() => hasTrack ? setShowDeleteModal(true) : handleDeleteAnnotation()}
        className="w-full py-1.5 bg-red-500/10 text-red-400 rounded text-xs hover:bg-red-500/20 flex items-center justify-center gap-1"
      >
        <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
        </svg>
        Delete
      </button>

      {/* Track Change Modal */}
      {showTrackChangeModal && pendingTrackChange && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100]" onClick={() => setShowTrackChangeModal(false)}>
          <div className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-3 max-w-xs w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-xs font-semibold text-white mb-2">Apply to Track?</h3>
            <p className="text-xs text-gray-400 mb-3">
              Apply <strong className="text-white">{pendingTrackChange.changeType}</strong> change to all frames in track?
            </p>
            {isApplyingTrackChange ? (
              <div className="text-center py-2 text-xs text-gray-400">Applying...</div>
            ) : (
              <div className="space-y-1.5">
                <button onClick={() => handleTrackChangeConfirm(false)} className="w-full py-1.5 bg-blue-500/20 text-blue-300 rounded text-xs hover:bg-blue-500/30">This Frame Only</button>
                <button onClick={() => handleTrackChangeConfirm(true)} className="w-full py-1.5 bg-green-500/20 text-green-300 rounded text-xs hover:bg-green-500/30">All Frames</button>
                <button onClick={() => setShowTrackChangeModal(false)} className="w-full py-1.5 bg-gray-800 text-gray-400 rounded text-xs hover:bg-gray-700">Cancel</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100]" onClick={() => setShowDeleteModal(false)}>
          <div className="bg-[#1a1a1a] border border-gray-800 rounded-lg p-3 max-w-xs w-full mx-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-xs font-semibold text-white mb-2">Delete Options</h3>
            <div className="space-y-1.5">
              <button onClick={handleDeleteAnnotation} className="w-full py-1.5 bg-orange-500/20 text-orange-300 rounded text-xs hover:bg-orange-500/30">This Box Only</button>
              <button onClick={handleDeleteTrack} className="w-full py-1.5 bg-red-500/20 text-red-300 rounded text-xs hover:bg-red-500/30">Entire Track</button>
              <button onClick={() => setShowDeleteModal(false)} className="w-full py-1.5 bg-gray-800 text-gray-400 rounded text-xs hover:bg-gray-700">Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// ANNOTATION LIST ITEM
// =============================================================================

interface AnnotationListItemProps {
  annotation: Annotation;
  is4D: boolean;
  isSelected: boolean;
  isExpanded: boolean;
  taxonomy: TaxonomyConfig | null;
  isLocked: boolean;
  isHidden: boolean;
  onSelect: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onToggleExpand: (id: string) => void;
}

const AnnotationListItem: React.FC<AnnotationListItemProps> = ({
  annotation,
  is4D,
  isSelected,
  isExpanded,
  taxonomy,
  isLocked,
  isHidden,
  onSelect,
  onToggleVisibility,
  onToggleExpand,
}) => {
  const classDef = taxonomy?.classes.find(c => c.id === annotation.class_id);
  const className = classDef?.name ?? annotation.class_id;
  const classColor = classDef?.color ?? '#666666';
  const hasTrack = !!annotation.track_id;
  const cuboidData = annotation.type === 'cuboid' ? annotation.data as CuboidData : null;

  // Generate a track-based accent color for visual distinction
  const trackAccent = hasTrack ? (() => {
    const hash = annotation.track_id!.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const hue = (hash * 137) % 360;
    return `hsl(${hue}, 70%, 50%)`;
  })() : null;

  return (
    <div
      className={`rounded-lg transition-all duration-200 ${
        isSelected
          ? 'bg-gradient-to-r from-white/[0.08] to-transparent ring-1 ring-white/20'
          : 'bg-white/[0.02] hover:bg-white/[0.05]'
      } ${isHidden ? 'opacity-50' : ''}`}
      style={trackAccent ? { borderLeft: `2px solid ${trackAccent}` } : { borderLeft: '2px solid transparent' }}
    >
      {/* Header - click to select & expand */}
      <div
        className="flex items-center gap-2 px-2.5 py-2 cursor-pointer"
        onClick={() => onSelect(annotation.id)}
      >
        {/* Class color indicator */}
        <div
          className="w-2.5 h-2.5 rounded-sm flex-shrink-0 shadow-sm"
          style={{ backgroundColor: classColor }}
        />

        {/* Class name */}
        <span className={`text-xs font-medium flex-1 truncate ${isHidden ? 'text-gray-500 line-through' : 'text-gray-100'}`}>{className}</span>

        {/* Compact badges */}
        <div className="flex items-center gap-1">
          {hasTrack && (
            <span
              className="text-xs px-1.5 py-0.5 rounded font-mono font-medium"
              style={{ backgroundColor: `${trackAccent}20`, color: trackAccent! }}
            >
              T:{annotation.track_id?.slice(0, 4)}
            </span>
          )}
          {annotation.is_static && (
            <span className="text-xs px-1 py-0.5 bg-cyan-500/20 text-cyan-400 rounded font-medium">S</span>
          )}
          {is4D && (
            <span className="text-xs px-1 py-0.5 bg-amber-500/20 text-amber-400 rounded font-medium">4D</span>
          )}
        </div>

        {/* Expand/Collapse chevron */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpand(annotation.id);
          }}
          className="p-1 rounded transition-colors text-gray-500 hover:text-gray-200"
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          <svg
            className={`w-3.5 h-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-90' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>
        </button>

        {/* Visibility toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleVisibility(annotation.id);
          }}
          className={`p-1 rounded transition-colors ${isHidden ? 'text-yellow-400' : 'text-gray-400 hover:text-white'}`}
          title={isHidden ? 'Show' : 'Hide'}
        >
          {isHidden ? (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
            </svg>
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          )}
        </button>

        {/* Selection indicator */}
        <div className={`w-1.5 h-1.5 rounded-full transition-colors ${isSelected ? 'bg-white' : 'bg-gray-700'}`} />
      </div>

      {/* Summary Row - shown when collapsed */}
      {!isExpanded && cuboidData && (
        <div className="px-2.5 pb-2 flex items-center gap-3 text-xs text-gray-500">
          {/* Position summary */}
          <span className="font-mono">
            <span className="text-red-400/60">x</span>{cuboidData.center?.x?.toFixed(1) ?? '0'}
            <span className="text-green-400/60 ml-1">y</span>{cuboidData.center?.y?.toFixed(1) ?? '0'}
          </span>
          {/* Dimensions summary */}
          <span className="font-mono text-gray-600">
            {cuboidData.dimensions?.length?.toFixed(1) ?? '?'}×{cuboidData.dimensions?.width?.toFixed(1) ?? '?'}×{cuboidData.dimensions?.height?.toFixed(1) ?? '?'}
          </span>
          {/* Heading */}
          <span className="font-mono">
            {((cuboidData.rotation?.yaw ?? 0) * 180 / Math.PI).toFixed(0)}°
          </span>
        </div>
      )}

      {/* Expanded Content */}
      {isExpanded && (
        <div className="px-2 pb-2 border-t border-gray-800/50">
          <ExpandedEditor
            annotation={annotation}
            is4D={is4D}
            taxonomy={taxonomy}
            isLocked={isLocked}
          />
        </div>
      )}
    </div>
  );
};

// =============================================================================
// MAIN PANEL
// =============================================================================

export const AnnotationListPanel: React.FC<AnnotationListPanelProps> = ({
  isVisible = true,
  onToggle,
  onWidthChange,
}) => {
  // Store state
  const currentFrameAnnotations = useCurrentFrameAnnotations();
  const taxonomy = useEditorStore(s => s.taxonomy);
  const currentFrame = useEditorStore(s => s.currentFrame);
  const selectAnnotation = useEditorStore(s => s.selectAnnotation);
  const focusOnAnnotation = useEditorStore(s => s.focusOnAnnotation);
  const selectedIds = useEditorStore(s => s.selection.selectedAnnotationIds);
  const hiddenAnnotationIds = useEditorStore(s => s.hiddenAnnotationIds);
  const toggleAnnotationVisibility = useEditorStore(s => s.toggleAnnotationVisibility);
  const taskId = useEditorStore(s => s.task?.id);
  const taskRevisionCount = useEditorStore(s => s.task?.revision_count ?? 0);
  const taskStage = useEditorStore(s => s.task?.stage);

  // 4D annotations
  const annotations4D = useAnnotation4DStore(s => s.annotations4D);
  const tracks = useTrackStore(s => s.tracks);

  // QA locked check
  const isQAMode = useIsQAMode();
  const isRevisionMode = taskRevisionCount > 0 && taskStage === 'annotation';

  const { data: revisionReviews } = useQuery({
    queryKey: ['qa-reviews-for-revision', taskId],
    queryFn: () => qaApi.getTaskReviews(taskId!),
    enabled: isRevisionMode && !!taskId,
    staleTime: 5 * 60 * 1000,
  });

  const latestReviewId = useMemo(() => {
    if (!revisionReviews?.length) return null;
    return [...revisionReviews].sort((a, b) =>
      new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime()
    )[0]?.id || null;
  }, [revisionReviews]);

  const { data: annotationReviews } = useQuery({
    queryKey: ['qa-annotation-reviews-revision', latestReviewId],
    queryFn: () => qaApi.getAnnotationReviews(latestReviewId!),
    enabled: !!latestReviewId,
    staleTime: 5 * 60 * 1000,
  });

  const lockedIds = useMemo(() => {
    const set = new Set<string>();
    if (!annotationReviews) return set;
    for (const r of annotationReviews) {
      if (r.verdict === 'approved') set.add(r.annotation_id);
    }
    return set;
  }, [annotationReviews]);

  // Panel state
  const [trackFilter, setTrackFilter] = useState<TrackFilter>('all');
  const [classFilter, setClassFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [panelWidth, setPanelWidth] = useState(280);
  const panelRef = useRef<HTMLDivElement>(null);

  // Persist and notify width changes
  useEffect(() => {
    const saved = localStorage.getItem('annotationListPanelWidth');
    if (saved) {
      const width = parseInt(saved);
      if (width >= 260 && width <= 450) setPanelWidth(width);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('annotationListPanelWidth', String(panelWidth));
    onWidthChange?.(panelWidth);
  }, [panelWidth, onWidthChange]);

  // Build annotation list - all annotations in current frame
  const annotationList = useMemo(() => {
    const result: Array<{ annotation: Annotation; is4D: boolean }> = [];

    // Current frame annotations
    currentFrameAnnotations.forEach(ann => {
      result.push({ annotation: ann, is4D: false });
    });

    // 4D annotations for current frame
    annotations4D.forEach(ann4D => {
      if (!ann4D.is_deleted && currentFrame && ann4D.frame_ids.includes(currentFrame.id)) {
        const converted: Annotation = {
          id: ann4D.id,
          task_id: ann4D.task_id,
          frame_id: currentFrame.id,
          track_id: ann4D.track_id,
          type: ann4D.type as Annotation['type'],
          class_id: ann4D.class_id,
          data: { center: ann4D.world_data.center, dimensions: ann4D.world_data.dimensions, rotation: ann4D.world_data.rotation, confidence: 1 },
          attributes: ann4D.attributes,
          source: ann4D.source as Annotation['source'],
          is_verified: false,
          is_static: ann4D.is_static,
          created_at: '',
          updated_at: '',
        };
        if (!currentFrameAnnotations.some(a => a.id === ann4D.id)) {
          result.push({ annotation: converted, is4D: true });
        }
      }
    });

    return result;
  }, [currentFrameAnnotations, annotations4D, currentFrame]);

  // Apply filters
  const filteredAnnotations = useMemo(() => {
    let result = annotationList;

    if (trackFilter === 'tracked') result = result.filter(item => !!item.annotation.track_id);
    else if (trackFilter === 'untracked') result = result.filter(item => !item.annotation.track_id);

    if (classFilter) result = result.filter(item => item.annotation.class_id === classFilter);

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(item =>
        item.annotation.id.toLowerCase().includes(q) ||
        item.annotation.track_id?.toLowerCase().includes(q)
      );
    }

    // Sort: selected annotations first, then preserve order
    result.sort((a, b) => {
      const aSelected = selectedIds.includes(a.annotation.id);
      const bSelected = selectedIds.includes(b.annotation.id);
      if (aSelected && !bSelected) return -1;
      if (!aSelected && bSelected) return 1;
      return 0; // Preserve relative order
    });

    return result;
  }, [annotationList, trackFilter, classFilter, searchQuery, selectedIds]);

  // Unique classes
  const uniqueClasses = useMemo(() => {
    const classes = new Set<string>();
    annotationList.forEach(item => classes.add(item.annotation.class_id));
    return Array.from(classes);
  }, [annotationList]);

  // Expanded state - independent of selection
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Auto-expand when a new annotation is selected
  const prevSelectedIds = useRef<string[]>([]);
  useEffect(() => {
    const newlySelected = selectedIds.filter(id => !prevSelectedIds.current.includes(id));
    if (newlySelected.length > 0) {
      setExpandedIds(prev => {
        const next = new Set(prev);
        newlySelected.forEach(id => next.add(id));
        return next;
      });
    }
    prevSelectedIds.current = selectedIds;
  }, [selectedIds]);

  // Handlers
  const handleSelect = useCallback((id: string) => {
    selectAnnotation(id, false);
    focusOnAnnotation(id);
  }, [selectAnnotation, focusOnAnnotation]);

  const handleToggleExpand = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Resize handler
  const handleResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = panelWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = startX - e.clientX;
      const newWidth = Math.max(260, Math.min(450, startWidth + delta));
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [panelWidth]);

  if (!isVisible) {
    return (
      <button
        onClick={onToggle}
        className="fixed left-4 z-30 bg-white/5 backdrop-blur-sm border border-white/10 rounded-lg p-2.5 hover:bg-white/10 hover:border-white/20 transition-all shadow-lg"
        style={{ top: '6.5rem' }}
        title="Show annotations"
      >
        <svg className="w-4 h-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
      </button>
    );
  }

  return (
    <div
      ref={panelRef}
      className="fixed right-0 top-14 bottom-0 z-20 bg-[#0a0a0a]/95 backdrop-blur-md border-l border-white/5 flex flex-col shadow-2xl"
      style={{ width: `${panelWidth}px` }}
    >
      {/* Resize Handle */}
      <div
        className="absolute top-0 bottom-0 left-0 w-1.5 bg-transparent hover:bg-gradient-to-b hover:from-blue-500/50 hover:to-purple-500/50 cursor-col-resize transition-all"
        onMouseDown={handleResize}
      />

      {/* Header */}
      <div className="px-3 py-3 border-b border-white/5 bg-gradient-to-b from-white/[0.02] to-transparent">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-4 bg-gradient-to-b from-blue-500 to-purple-500 rounded-full" />
            <h3 className="text-sm font-semibold text-gray-200">Annotations</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400 px-2 py-0.5 bg-white/5 rounded-full font-medium">{filteredAnnotations.length}</span>
            {onToggle && (
              <button onClick={onToggle} className="p-1.5 rounded-md hover:bg-white/5 text-gray-500 hover:text-gray-300 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-2">
          <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search annotations..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-white/5 border border-white/5 rounded-lg text-white placeholder-gray-600 focus:outline-none focus:border-white/20 focus:bg-white/[0.08] transition-all"
          />
        </div>

        {/* Filters */}
        <div className="flex gap-1.5">
          <select
            value={classFilter}
            onChange={(e) => setClassFilter(e.target.value)}
            className="flex-1 py-1.5 px-2 text-xs bg-white/5 border border-white/5 rounded-lg text-white focus:outline-none focus:border-white/20 cursor-pointer appearance-none"
          >
            <option value="">All Classes</option>
            {uniqueClasses.map(clsId => {
              const cls = taxonomy?.classes.find(c => c.id === clsId);
              return <option key={clsId} value={clsId}>{cls?.name ?? clsId}</option>;
            })}
          </select>
          <select
            value={trackFilter}
            onChange={(e) => setTrackFilter(e.target.value as TrackFilter)}
            className="flex-1 py-1.5 px-2 text-xs bg-white/5 border border-white/5 rounded-lg text-white focus:outline-none focus:border-white/20 cursor-pointer appearance-none"
          >
            <option value="all">All</option>
            <option value="tracked">Tracked</option>
            <option value="untracked">Untracked</option>
          </select>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {filteredAnnotations.length === 0 ? (
          <div className="text-center py-12 text-gray-500 text-xs">
            <svg className="w-8 h-8 mx-auto mb-2 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            No annotations in frame
          </div>
        ) : (
          filteredAnnotations.map(({ annotation, is4D }) => (
            <AnnotationListItem
              key={annotation.id}
              annotation={annotation}
              is4D={is4D}
              isSelected={selectedIds.includes(annotation.id)}
              isExpanded={expandedIds.has(annotation.id)}
              taxonomy={taxonomy}
              isLocked={lockedIds.has(annotation.id) || (isQAMode && annotation.source !== 'qa_correction')}
              isHidden={hiddenAnnotationIds.has(annotation.id)}
              onSelect={handleSelect}
              onToggleVisibility={toggleAnnotationVisibility}
              onToggleExpand={handleToggleExpand}
            />
          ))
        )}
      </div>

      {/* Footer */}
      <div className="px-3 py-2 border-t border-white/5 bg-gradient-to-t from-white/[0.02] to-transparent">
        <div className="flex justify-between text-xs text-gray-500">
          <span className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-purple-500/60" />
            {filteredAnnotations.filter(a => a.annotation.track_id).length} tracked
          </span>
          <span className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-500/60" />
            {filteredAnnotations.filter(a => a.annotation.is_static).length} static
          </span>
          <span className="text-gray-600">{tracks.size} tracks total</span>
        </div>
      </div>
    </div>
  );
};

export default AnnotationListPanel;

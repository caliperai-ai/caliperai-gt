import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { BRAND } from '@/config/branding';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { taskApi, annotationApi, annotation2DApi, annotation3DApi, annotation4DApi, sceneApi, datasetApi, dataApi, workflowApi, qaApi, type PointCloudResponse } from '@/api/client';
import { useEditorStore, useCurrentFrameAnnotations, useSelectedAnnotations } from '@/store/editorStore';
import { useAuthStore } from '@/store/authStore';
import { useOnboardingStore } from '@/store/onboardingStore';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useAnnotation4DStore, LocalAnnotation4D } from '@/store/annotation4DStore';
import { useAnnotation2DStore } from '@/store/annotation2DStore';
import { useTrackStore } from '@/store/trackStore';
import { useQAStore, useIsQAMode } from '@/store/qaStore';
import { useLidarCacheStore } from '@/store/lidarCacheStore';
import { useImageCacheStore } from '@/store/imageCacheStore';
import { LidarCanvas, LidarCanvas4DNew } from '@/components/canvas/LidarCanvas';
import { ClipBoxControls } from '@/components/canvas/LidarCanvas/ClipBoxControls';
import { ImageCanvas } from '@/components/canvas/ImageCanvas';
import { OrthographicViews } from '@/components/canvas/OrthographicViews';
import { OrthographicViews4D } from '@/components/canvas/OrthographicViews4D';
import { Image2DAnnotationView } from '@/components/canvas/Image2DAnnotationView';
import { CameraThumbnail } from '@/components/CameraThumbnail';
import { RejectionModal, AnnotationComments, TabbedQAPanel, FalseNegativeModal, QACompleteModal, QAFeedbackPanel } from '@/components/qa';
import { AnnotationListPanel } from '@/components/AnnotationListPanel';
import {
  findVisibleCamerasForCuboid,
  findBestCameraForPoint,
  projectCuboidToAllCameras,
} from '@/utils/projection';
import type { PointCloudData, CuboidData, BBox2D, Annotation, Task, Taxonomy } from '@/types';
import { taxonomyApi } from '@/api/client';
import { getEffectiveAttributesForClass } from '@/utils/taxonomyUtils';
import { getDefaultCuboidDimensions } from '@/utils/cuboidDimensions';


type ToolType = 'select' | 'cuboid' | 'box2d' | 'polygon' | 'polyline' | 'brush3d' | 'track' | 'flag_missing';
type AnnotationCapability = 'bounding_box_3d' | 'bounding_box_2d' | 'semantic_segmentation' | 'instance_segmentation' | 'tracking' | 'polygon' | 'polyline';
type ViewMode = '3d' | 'fusion' | '2d' | '4d' | 'focus';
type OrthoViewType = 'top' | 'side' | 'front';

type AnnotationModeTab = 'fusion_3d' | '2d_only';

interface Tool {
  id: ToolType;
  name: string;
  icon: JSX.Element;
  shortcut: string;
  capability?: AnnotationCapability;
}

interface FusionLabel {
  annotationId: string;
  cameraId: string;
  bbox: BBox2D;
  classId: string;
  trackId?: string;
  isManuallyAdjusted: boolean;
}


const useFusionLabels = () => {
  const { scene } = useEditorStore();
  const currentFrameAnnotations = useCurrentFrameAnnotations();

  const cuboidAnnotations = useMemo(() =>
    currentFrameAnnotations.filter(ann => ann.type === 'cuboid'),
    [currentFrameAnnotations]
  );

  const lidarToCameras = useMemo(() => {
    if (!scene?.calibration?.lidar_to_cameras) return {};
    return scene.calibration.lidar_to_cameras;
  }, [scene?.calibration]);

  const cameras = useMemo(() =>
    scene?.storage_paths?.cameras ? Object.keys(scene.storage_paths.cameras) : [],
    [scene?.storage_paths?.cameras]
  );

  const imageSize = useMemo(() => ({ width: 1600, height: 900 }), []);

  const fusionLabels = useMemo(() => {
    if (!cuboidAnnotations.length || !Object.keys(lidarToCameras).length) {
      return new Map<string, FusionLabel[]>();
    }

    const labels = new Map<string, FusionLabel[]>();

    for (const ann of cuboidAnnotations) {
      const cuboidData = ann.data as CuboidData;
      const projections = projectCuboidToAllCameras(cuboidData, lidarToCameras, imageSize);

      for (const [cameraId, bbox] of Object.entries(projections)) {
        const fusionLabel: FusionLabel = {
          annotationId: ann.id,
          cameraId,
          bbox,
          classId: ann.class_id,
          trackId: ann.track_id,
          isManuallyAdjusted: false,
        };

        if (!labels.has(ann.id)) {
          labels.set(ann.id, []);
        }
        labels.get(ann.id)!.push(fusionLabel);
      }
    }

    return labels;
  }, [cuboidAnnotations, lidarToCameras]);

  const camerasWithLabels = useMemo(() => {
    const cameraSet = new Set<string>();
    fusionLabels.forEach((annLabels) => {
      annLabels.forEach(l => cameraSet.add(l.cameraId));
    });
    return Array.from(cameraSet);
  }, [fusionLabels]);

  const labelsByCamera = useMemo(() => {
    const grouped: Record<string, FusionLabel[]> = {};
    fusionLabels.forEach((annLabels) => {
      annLabels.forEach(label => {
        if (!grouped[label.cameraId]) {
          grouped[label.cameraId] = [];
        }
        grouped[label.cameraId].push(label);
      });
    });
    return grouped;
  }, [fusionLabels]);

  return {
    fusionLabels,
    camerasWithLabels,
    labelsByCamera,
    cameras,
    lidarToCameras,
    cuboidAnnotations,
  };
};


const allTools: Tool[] = [
  {
    id: 'cuboid',
    name: '3D Box',
    icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
    shortcut: 'C',
    capability: 'bounding_box_3d'
  },
  {
    id: 'track',
    name: 'Track',
    icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>,
    shortcut: 'T',
    capability: 'tracking'
  },
];

const qaTools: Tool[] = [
  {
    id: 'flag_missing',
    name: 'Flag Missing',
    icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-13.5V9" /></svg>,
    shortcut: 'F',
  },
];


const ClassPickerPanel: React.FC = () => {
  const { activeTool, taxonomy, activeClassId, setActiveClass, isBoxPlacementActive, pendingClassDigits } = useEditorStore();

  const showClassPicker = (activeTool === 'cuboid' || activeTool === 'track') && !isBoxPlacementActive;
  const activeClass = taxonomy?.classes?.find(c => c.id === activeClassId);

  const classPickerScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activeClassId || !classPickerScrollRef.current) return;
    const el = classPickerScrollRef.current.querySelector(`[data-classpicker-id="${activeClassId}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeClassId, showClassPicker]);

  if (!showClassPicker || !taxonomy?.classes?.length) return null;

  return (
    <div className="w-52 bg-dark-panel/95 backdrop-blur-sm rounded-xl border border-gray-700 shadow-xl overflow-hidden">
      <div className="px-3 py-1.5 border-b border-gray-700 flex items-center justify-between">
        <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
          {activeTool === 'track' ? 'Track Class' : 'Box Class'}
        </span>
        {pendingClassDigits ? (
          <span className="text-[10px] font-mono bg-primary/30 text-primary px-1.5 py-0.5 rounded border border-primary/50 animate-pulse">
            #{pendingClassDigits}…
          </span>
        ) : (
          <span className="text-[10px] text-gray-600 font-mono">1-9, 0, 10+</span>
        )}
      </div>
      <div className="max-h-52 overflow-y-auto" ref={classPickerScrollRef}>
        {taxonomy.classes.map((cls, idx) => (
          <button
            key={cls.id}
            data-classpicker-id={cls.id}
            onClick={() => setActiveClass(cls.id)}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all ${
              activeClassId === cls.id
                ? 'bg-primary/20 text-white'
                : 'text-gray-400 hover:bg-dark-hover hover:text-white'
            }`}
          >
            <span
              className="w-2.5 h-2.5 rounded flex-shrink-0"
              style={{ backgroundColor: cls.color }}
            />
            <span className="text-xs truncate flex-1">{cls.name}</span>
            {activeClassId === cls.id && (
              <svg className="w-3 h-3 text-primary shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            )}
            <kbd
              className="text-[10px] px-1.5 py-0.5 rounded font-bold flex-shrink-0 border"
              style={{
                color: cls.color,
                backgroundColor: `${cls.color}22`,
                borderColor: `${cls.color}55`,
              }}
            >
              {idx + 1}
            </kbd>
          </button>
        ))}
      </div>
      {activeClass && (
        <div className="px-3 py-1.5 border-t border-gray-700 flex items-center gap-1.5">
          <span className="w-2 h-2 rounded" style={{ backgroundColor: activeClass.color }} />
          <span className="text-[10px] text-gray-400">Click on scene to place</span>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// TOOL PALETTE
// =============================================================================

interface ToolPaletteProps {
  availableCapabilities: AnnotationCapability[];
  isQAMode?: boolean;
}

const ToolPalette: React.FC<ToolPaletteProps> = ({ availableCapabilities, isQAMode = false }) => {
  const { activeTool, setActiveTool } = useEditorStore();
  const taskId = useEditorStore((s) => s.task?.id);

  // Timer nudge toast — shown when user picks an annotation tool without the timer running
  const [showTimerToast, setShowTimerToast] = useState(false);
  const timerToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Default to false (locked) so tools are always locked until timer state is confirmed.
  // This covers both first-load and page-refresh scenarios where taskId may not be
  // available yet at mount time (task is loaded asynchronously from the store).
  const [timerRunning, setTimerRunning] = useState<boolean>(false);

  // Re-read timer state from localStorage whenever taskId becomes available.
  // The lazy useState initializer only runs once at mount — if taskId is undefined
  // at that point (async task load), the localStorage read is skipped. This effect
  // fills that gap and ensures the correct persisted state is restored on refresh.
  useEffect(() => {
    if (!taskId) return;
    try {
      const raw = localStorage.getItem(`task_timer_${taskId}`);
      if (raw !== null) {
        setTimerRunning(JSON.parse(raw).running === true);
      }
      // If no localStorage entry exists the timer has never been started — keep locked (false).
    } catch { /* ignore parse errors, remain locked */ }
  }, [taskId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ running: boolean; taskId: string }>).detail;
      if (detail?.taskId === taskId) {
        setTimerRunning(detail.running);
        if (detail.running) {
          setShowTimerToast(false);
          if (timerToastTimeoutRef.current) clearTimeout(timerToastTimeoutRef.current);
        }
      }
    };
    window.addEventListener('timerStateChange', handler);
    return () => window.removeEventListener('timerStateChange', handler);
  }, [taskId]);

  // Filter available tools based on capabilities
  const availableTools = allTools.filter(tool => {
    if (!tool.capability) return true;
    return availableCapabilities.includes(tool.capability);
  });

  // In QA mode: ONLY show QA-specific tools (hide annotation creation tools)
  // In annotation mode: show standard annotation tools
  const toolsToShow = isQAMode ? qaTools : availableTools;

  return (
    <>
      {/* Timer nudge toast */}
      {showTimerToast && createPortal(
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[300] pointer-events-none flex justify-center">
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gray-900 border border-amber-500/45 animate-fadeInDown animate-timerToastGlow pointer-events-auto">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" d="M12 7v5l3 3" />
              </svg>
            </span>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-amber-300 leading-tight">Start the timer</span>
              <span className="text-[11px] text-gray-400 leading-tight mt-0.5">Press play on the timer (top-right) to log your work time</span>
            </div>
            <button
              className="ml-1 flex-shrink-0 text-gray-500 hover:text-gray-300 transition-colors"
              onClick={() => { setShowTimerToast(false); if (timerToastTimeoutRef.current) clearTimeout(timerToastTimeoutRef.current); }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>,
        document.body
      )}
      <div data-tour="tool-palette-3d" className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex items-start gap-2">
      <div className="bg-dark-panel/95 backdrop-blur-sm rounded-xl border border-gray-700 p-2 shadow-xl">
        <div className="flex flex-col gap-1">
          {toolsToShow.map((tool, index) => {
            const isAnnotationTool = tool.id !== 'flag_missing';
            const timerLocked = isAnnotationTool && !timerRunning;
            return (
            <React.Fragment key={tool.id}>
              {/* Add separator before QA tools */}
              {isQAMode && index === availableTools.filter(t => !t.capability || availableCapabilities.includes(t.capability)).length && (
                <div className="border-t border-orange-500/50 my-1" />
              )}
              <button
                data-tour={`${tool.id}-tool`}
                onMouseEnter={() => {
                  if (timerLocked) window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: true } }));
                }}
                onMouseLeave={() => {
                  if (timerLocked) window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: false } }));
                }}
                onFocus={() => {
                  if (timerLocked) window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: true } }));
                }}
                onBlur={() => {
                  if (timerLocked) window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: false } }));
                }}
                onClick={() => {
                  if (timerLocked) {
                    if (timerToastTimeoutRef.current) clearTimeout(timerToastTimeoutRef.current);
                    setShowTimerToast(true);
                    timerToastTimeoutRef.current = setTimeout(() => setShowTimerToast(false), 8000);
                    return;
                  }
                  setActiveTool(tool.id);
                }}
                className={`group relative p-3 rounded-lg transition-all ${
                  timerLocked
                    ? 'text-amber-700/40 cursor-not-allowed'
                    : activeTool === tool.id
                    ? tool.id === 'flag_missing'
                      ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/30'
                      : 'bg-primary text-white shadow-lg shadow-primary/30'
                    : tool.id === 'flag_missing'
                      ? 'text-orange-400 hover:bg-orange-500/20 hover:text-orange-300'
                      : 'text-gray-400 hover:bg-dark-hover hover:text-white'
                }`}
                aria-label={`${tool.name} (${tool.shortcut})`}
              >
                {tool.icon}
                {timerLocked ? (
                  <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 whitespace-nowrap px-3 py-2 rounded-lg bg-white border border-amber-400 text-sm font-medium text-amber-700 shadow-xl z-50 invisible scale-95 group-hover:visible group-hover:scale-100 group-focus-visible:visible group-focus-visible:scale-100 transition-transform duration-150">
                    {tool.name} — start the timer first
                  </span>
                ) : (
                  <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 whitespace-nowrap px-3 py-2 rounded-lg bg-white border border-gray-200 text-sm text-gray-800 shadow-xl z-50 invisible scale-95 group-hover:visible group-hover:scale-100 group-focus-visible:visible group-focus-visible:scale-100 transition-transform duration-150">
                    {tool.name} ({tool.shortcut})
                  </span>
                )}
                {/* Lock badge overlay for timer-locked tools */}
                {timerLocked && (
                  <span className="absolute bottom-0.5 right-0.5 w-3 h-3 flex items-center justify-center">
                    <svg className="w-2.5 h-2.5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                    </svg>
                  </span>
                )}
              </button>
            </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
    </>
  );
};

// =============================================================================
// TRACK MANAGEMENT COMPONENT
// =============================================================================

interface TrackManagementProps {
  annotation: ReturnType<typeof useSelectedAnnotations>[0];
  is4D?: boolean;  // True if this is a 4D annotation
}

// TrackManagement component - used in full properties panel mode (not compact)
const _TrackManagement: React.FC<TrackManagementProps> = ({ annotation: annotationProp, is4D = false }) => {
  const {
    tracks,
    createTrack,
    removeKeyframe,
    isKeyframe,
    interpolateTrack,
    addAnnotationToTrack,
    propagateTrack,
    markAsKeyframe,
  } = useTrackStore();
  const { currentFrame, updateAnnotation, annotations } = useEditorStore();
  const annotations4D = useAnnotation4DStore((s) => s.annotations4D);
  const updateAnnotation4D = useAnnotation4DStore((s) => s.updateAnnotation4D);
  const [showTrackList, setShowTrackList] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [propagateFrames, setPropagateFrames] = useState(10);
  const [showPropagateInput, setShowPropagateInput] = useState(false);
  const [isInterpolating, setIsInterpolating] = useState(false);
  const [interpolateSuccess, setInterpolateSuccess] = useState(false);
  const [isPropagating, setIsPropagating] = useState(false);
  const [propagateSuccess, setPropagateSuccess] = useState(false);
  const [, forceUpdate] = useState(0);

  // Always get the fresh annotation from the store to avoid stale closure issues
  const annotation = annotations.get(annotationProp.id) || annotationProp;

  const hasTrack = !!annotation.track_id;
  const track = hasTrack ? tracks.get(annotation.track_id!) : undefined;
  const frameIsKeyframe = hasTrack && currentFrame ? isKeyframe(annotation.track_id!, currentFrame.id) : false;

  // Get all other tracks for merging (exclude current track)
  const otherTracks4D = useMemo(() => {
    if (!is4D || !annotation.track_id) return [];
    const result: { id: string; trackId: string; classId: string }[] = [];
    annotations4D.forEach((ann) => {
      if (ann.track_id && ann.track_id !== annotation.track_id && !ann.is_deleted) {
        // Only add unique track IDs
        if (!result.find(r => r.trackId === ann.track_id)) {
          result.push({ id: ann.id, trackId: ann.track_id, classId: ann.class_id });
        }
      }
    });
    return result;
  }, [annotations4D, annotation.track_id, is4D]);

  // Get deleteAnnotation4D for merge operation
  const deleteAnnotation4D = useAnnotation4DStore((s) => s.deleteAnnotation4D);

  // Merge current track into another track
  // Strategy:
  // - For overlapping frames, keep target's annotation data
  // - Extend target to cover source's unique frames
  // - Delete source annotations
  const handleMergeTracks = (targetTrackId: string) => {
    if (!annotation.track_id) return;

    const sourceTrackId = annotation.track_id;

    // Collect target annotations and their covered frames
    const targetAnnotations: LocalAnnotation4D[] = [];
    const targetFrameIds = new Set<string>();

    annotations4D.forEach((ann) => {
      if (ann.track_id === targetTrackId && !ann.is_deleted) {
        targetAnnotations.push(ann);
        ann.frame_ids.forEach(fid => targetFrameIds.add(fid));
      }
    });

    // Collect source annotations
    const sourceAnnotations: LocalAnnotation4D[] = [];
    annotations4D.forEach((ann) => {
      if (ann.track_id === sourceTrackId && !ann.is_deleted) {
        sourceAnnotations.push(ann);
      }
    });

    // For each source annotation, find unique frames not covered by target
    sourceAnnotations.forEach((sourceAnn) => {
      const uniqueFrames = sourceAnn.frame_ids.filter(fid => !targetFrameIds.has(fid));

      if (uniqueFrames.length > 0 && targetAnnotations.length > 0) {
        // Extend the first target annotation to include unique frames from source
        const targetAnn = targetAnnotations[0];
        const extendedFrameIds = [...new Set([...targetAnn.frame_ids, ...uniqueFrames])];

        // Also merge frame_data for the unique frames
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

      // Delete the source annotation
      deleteAnnotation4D(sourceAnn.id);
    });

    setShowMergeModal(false);
  };

  // Create a new track for this annotation
  const handleCreateTrack = () => {

    const newTrack = createTrack(annotation.class_id, annotation.attributes);

    if (currentFrame) {
      addAnnotationToTrack(newTrack.id, currentFrame.id, annotation.id, true);
    }
  };

  // Toggle keyframe status
  const handleToggleKeyframe = () => {
    if (!annotation.track_id || !currentFrame) return;

    if (frameIsKeyframe) {
      removeKeyframe(annotation.track_id, currentFrame.id);
      updateAnnotation(annotation.id, { is_keyframe: false });
    } else {
      // Mark as keyframe (user must click Interpolate button to interpolate)
      markAsKeyframe(annotation.track_id, currentFrame.id);
      updateAnnotation(annotation.id, { is_keyframe: true });
    }
  };

  // Run interpolation with feedback
  const handleInterpolate = async () => {
    if (!annotation.track_id) return;
    setIsInterpolating(true);
    setInterpolateSuccess(false);

    try {
      // Run interpolation
      interpolateTrack(annotation.track_id);

      // Wait a moment for state to propagate
      await new Promise(resolve => setTimeout(resolve, 100));

      // Force a re-render to show updated positions
      forceUpdate(n => n + 1);

      setInterpolateSuccess(true);
      setTimeout(() => setInterpolateSuccess(false), 2000);
    } finally {
      setIsInterpolating(false);
    }
  };

  // Propagate to N frames
  const handlePropagate = async () => {

    let trackId = annotation.track_id;

    // Auto-create a track if none exists
    if (!trackId) {
      const newTrack = createTrack(annotation.class_id, annotation.attributes);

      if (currentFrame) {
        addAnnotationToTrack(newTrack.id, currentFrame.id, annotation.id, true);
        trackId = newTrack.id;
      } else {
        console.error('[TrackManagement] No current frame, cannot create track');
        return;
      }
    }

    setIsPropagating(true);
    setPropagateSuccess(false);

    try {
      await propagateTrack(trackId, propagateFrames);

      // Wait a moment for state to propagate
      await new Promise(resolve => setTimeout(resolve, 100));

      // Force a re-render to show updated positions
      forceUpdate(n => n + 1);

      setPropagateSuccess(true);
      setTimeout(() => {
        setPropagateSuccess(false);
        setShowPropagateInput(false);
      }, 2000);
    } finally {
      setIsPropagating(false);
    }
  };

  // Assign to existing track
  const handleAssignToTrack = (trackId: string) => {
    if (!currentFrame) return;
    addAnnotationToTrack(trackId, currentFrame.id, annotation.id, true);
    setShowTrackList(false);
  };

  // For 4D annotations, show simplified track info
  if (is4D && hasTrack) {
    return (
      <div className="bg-dark rounded-xl p-4">
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
          {/* Track ID - Full display with copy */}
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

          {/* Merge Tracks */}
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
    <div className="bg-dark rounded-xl p-4">
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
          {/* Track ID */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Track ID</span>
            <button
              onClick={() => navigator.clipboard.writeText(annotation.track_id!)}
              className="font-mono text-xs text-purple-400 hover:underline"
            >
              {annotation.track_id!.slice(0, 8)}...
            </button>
          </div>

          {/* Keyframe Toggle */}
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

          {/* Keyframe count */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-gray-500">Keyframes</span>
            <span className="text-xs text-gray-300">{track.keyframe_ids.size}</span>
          </div>

          {/* Interpolate Button - needs 2+ keyframes */}
          {track.keyframe_ids.size >= 2 ? (
            <button
              onClick={handleInterpolate}
              disabled={isInterpolating}
              className={`w-full py-2 rounded-lg text-xs flex items-center justify-center gap-2 transition-all ${
                interpolateSuccess
                  ? 'bg-green-500/30 text-green-300'
                  : isInterpolating
                    ? 'bg-blue-500/10 text-blue-200 cursor-wait'
                    : 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
              }`}
            >
              {isInterpolating ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="10" strokeOpacity="0.25"/>
                    <path d="M12 2a10 10 0 0 1 10 10" strokeLinecap="round"/>
                  </svg>
                  Interpolating...
                </>
              ) : interpolateSuccess ? (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M20 6L9 17l-5-5"/>
                  </svg>
                  Done! Annotations Updated
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M5 12h14M12 5l7 7-7 7"/>
                  </svg>
                  Interpolate Between Keyframes
                </>
              )}
            </button>
          ) : (
            <div className="text-xs text-gray-500 text-center py-2 bg-gray-800/30 rounded-lg">
              Need 2+ keyframes to interpolate. Navigate to another frame and mark it as keyframe.
            </div>
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
                  disabled={isPropagating}
                />
                <span className="text-xs text-gray-500">frames</span>
                <button
                  onClick={handlePropagate}
                  disabled={isPropagating}
                  className={`px-3 py-1.5 rounded text-xs transition-all ${
                    propagateSuccess
                      ? 'bg-green-500/40 text-green-200'
                      : isPropagating
                        ? 'bg-green-500/10 text-green-200 cursor-wait'
                        : 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                  }`}
                >
                  {isPropagating ? '...' : propagateSuccess ? '✓' : 'Go'}
                </button>
                {!isPropagating && !propagateSuccess && (
                  <button
                    onClick={() => setShowPropagateInput(false)}
                    className="px-2 py-1.5 text-gray-400 hover:text-white text-xs"
                  >
                    ✕
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={() => setShowPropagateInput(true)}
                className="w-full py-2 bg-green-500/20 text-green-300 rounded-lg text-xs hover:bg-green-500/30 flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M13 5l7 7-7 7M5 5l7 7-7 7"/>
                </svg>
                Copy to Next Frames
              </button>
            )}
            <p className="text-xs text-gray-500 mt-1.5">
              Copy box to next N frames. Edit any frame to create keyframe & auto-interpolate.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Create New Track */}
          <button
            onClick={handleCreateTrack}
            className="w-full py-2 bg-purple-500/20 text-purple-300 rounded-lg text-xs hover:bg-purple-500/30 flex items-center justify-center gap-2"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            Create New Track
          </button>

          {/* Assign to Existing Track */}
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

// =============================================================================
// PROPERTIES PANEL - Compact overlay inside 3D canvas
// =============================================================================

interface PropertiesPanelProps {
  orthoViewsWidth?: number;
  showOrthoViews?: boolean;
  viewMode?: ViewMode;
}

const _PropertiesPanel: React.FC<PropertiesPanelProps> = ({
  orthoViewsWidth = 480,
  showOrthoViews = false,
  viewMode = '3d'
}) => {
  void orthoViewsWidth; // Suppress unused parameter warning
  void showOrthoViews; // Suppress unused parameter warning
  void viewMode; // Suppress unused parameter warning
  const selectedAnnotations = useSelectedAnnotations();
  const { taxonomy, updateAnnotation: updateAnnotationRegular, deleteAnnotation, currentFrame, saveAnnotations, frames, goToFrame, annotations: allAnnotations, scene } = useEditorStore();
  const queryClient = useQueryClient();

  // Detect QA mode to expand sections by default
  const isQAModeActive = useIsQAMode();

  // Track store for track management
  const { tracks, createTrack, addAnnotationToTrack, addKeyframe, removeKeyframe, isKeyframe, markAsKeyframe, propagateTrack, deleteTrack } = useTrackStore();
  const [showTrackList, setShowTrackList] = useState(false);
  const [showPropagateInput, setShowPropagateInput] = useState(false);
  const [propagateFrames, setPropagateFrames] = useState(10);
  const [propagateDirection, setPropagateDirection] = useState<'forward' | 'backward' | 'both'>('forward');
  const [isPropagating, setIsPropagating] = useState(false);
  const [propagateSuccess, setPropagateSuccess] = useState(false);

  // 4D annotation support
  const selectedAnnotation4D = useAnnotation4DStore((s) => {
    const selectedIds = useEditorStore.getState().selection.selectedAnnotationIds;
    if (selectedIds.length === 0) return null;
    return s.annotations4D.get(selectedIds[0]) ?? null;
  });
  const updateAnnotation4D = useAnnotation4DStore((s) => s.updateAnnotation4D);
  const deleteAnnotation4D = useAnnotation4DStore((s) => s.deleteAnnotation4D);
  const annotations4D = useAnnotation4DStore((s) => s.annotations4D);

  // Get task ID for loading all annotations
  const taskId = useEditorStore((s) => s.task?.id);
  const taskRevisionCount = useEditorStore((s) => s.task?.revision_count ?? 0);
  const taskStage = useEditorStore((s) => s.task?.stage);

  // Check if selected annotation is locked (QA-approved in revision mode OR in QA mode for non-false-negatives)
  const isRevisionMode = taskRevisionCount > 0 && taskStage === 'annotation';
  const { data: ppRevisionReviews } = useQuery({
    queryKey: ['qa-reviews-for-revision', taskId],
    queryFn: () => qaApi.getTaskReviews(taskId!),
    enabled: isRevisionMode && !!taskId,
    staleTime: 5 * 60 * 1000,
  });
  const ppLatestReviewId = useMemo(() => {
    if (!ppRevisionReviews?.length) return null;
    return [...ppRevisionReviews].sort((a, b) =>
      new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime()
    )[0]?.id || null;
  }, [ppRevisionReviews]);
  const { data: ppAnnotationReviews } = useQuery({
    queryKey: ['qa-annotation-reviews-revision', ppLatestReviewId],
    queryFn: () => qaApi.getAnnotationReviews(ppLatestReviewId!),
    enabled: !!ppLatestReviewId,
    staleTime: 5 * 60 * 1000,
  });
  const ppLockedIds = useMemo(() => {
    const set = new Set<string>();
    if (!ppAnnotationReviews) return set;
    for (const r of ppAnnotationReviews) {
      if (r.verdict === 'approved') set.add(r.annotation_id);
    }
    return set;
  }, [ppAnnotationReviews]);
  // In QA mode, lock all existing annotations except false negatives (qa_correction source)
  const isQALockedAnnotation = isQAModeActive && selectedAnnotations.length === 1 && selectedAnnotations[0]?.source !== 'qa_correction';
  const isSelectedLocked = (selectedAnnotations.length === 1 && ppLockedIds.has(selectedAnnotations[0]?.id)) || isQALockedAnnotation;

  // Filter by taxonomy when scene has selected_taxonomy_id
  const selectedTaxonomyId = scene?.selected_taxonomy_id;

  // Lightweight summary (track_id + frame_id only) — used for track navigation.
  // Loads fast regardless of dataset size because it skips all geometry/attribute data.
  const { data: annotationSummary } = useQuery({
    queryKey: ['annotations-3d-summary', taskId, selectedTaxonomyId],
    queryFn: async () => {
      if (!taskId) return [];
      return annotation3DApi.summary(taskId, selectedTaxonomyId || undefined);
    },
    enabled: !!taskId && !!scene,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const [isVisible, setIsVisible] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [showTrackChangeModal, setShowTrackChangeModal] = useState(false);
  const [pendingTrackChange, setPendingTrackChange] = useState<{ id: string; updates: Partial<Annotation>; is4D: boolean; changeType: string } | null>(null);
  const [isApplyingTrackChange, setIsApplyingTrackChange] = useState(false);
  const [panelSize, setPanelSize] = useState({ width: 280, height: 500 });
  const [panelPosition, setPanelPosition] = useState({ x: -1, y: -1 }); // -1 means use default
  const isResizingRef = useRef<'width' | 'height' | 'corner' | null>(null);
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0, panelX: 0, panelY: 0 });

  // Local state for numeric inputs (to allow typing without immediate updates)
  const [localPosition, setLocalPosition] = useState({ x: '', y: '', z: '' });
  const [localDimensions, setLocalDimensions] = useState({ length: '', width: '', height: '' });
  const [localHeading, setLocalHeading] = useState('');
  const [activePropertiesTab, setActivePropertiesTab] = useState<'position' | 'attributes'>('position');

  // Collapsible sections state - expand all sections by default in QA mode
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    position: isQAModeActive,
    dimensions: isQAModeActive,
    heading: isQAModeActive,
    attributes: isQAModeActive,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({
      ...prev,
      [section]: !prev[section]
    }));
  };

  // Auto-expand sections when entering QA mode
  React.useEffect(() => {
    if (isQAModeActive) {
      setExpandedSections({
        position: true,
        dimensions: true,
        heading: true,
        attributes: true,
      });
    }
  }, [isQAModeActive]);

  // Check if properties panel should be suppressed (e.g., when using inline editing in LabelListPanel)
  const suppressPropertiesPanel = useEditorStore((s) => s.suppressPropertiesPanel);

  // Check if we have a selected annotation (from either store)
  const has4DSelection = selectedAnnotation4D !== null && !selectedAnnotation4D.is_deleted;
  const hasRegularSelection = selectedAnnotations.length > 0;

  // Get cuboid data for sync effect - computed before hooks
  // This works with nullable values since the useEffect checks for null
  const syncCuboidData = React.useMemo(() => {
    if (has4DSelection && selectedAnnotation4D) {
      return {
        id: selectedAnnotation4D.id,
        center: selectedAnnotation4D.world_data.center,
        dimensions: selectedAnnotation4D.world_data.dimensions,
        rotation: selectedAnnotation4D.world_data.rotation,
      };
    }
    if (hasRegularSelection && selectedAnnotations.length > 0) {
      const ann = selectedAnnotations[0];
      if (ann.type === 'cuboid') {
        const data = ann.data as CuboidData;
        return {
          id: ann.id,
          center: data.center,
          dimensions: data.dimensions,
          rotation: data.rotation,
        };
      }
    }
    return null;
  }, [has4DSelection, selectedAnnotation4D, hasRegularSelection, selectedAnnotations]);

  // Get selected track ID before early returns - needed for trackFrameInfo hook
  const selectedTrackId = React.useMemo(() => {
    if (has4DSelection && selectedAnnotation4D) {
      return selectedAnnotation4D.track_id || null;
    }
    if (hasRegularSelection && selectedAnnotations.length > 0) {
      // Get fresh annotation from store to ensure track_id is up-to-date
      const freshAnn = allAnnotations.get(selectedAnnotations[0].id);
      return freshAnn?.track_id || selectedAnnotations[0].track_id || null;
    }
    return null;
  }, [has4DSelection, selectedAnnotation4D, hasRegularSelection, selectedAnnotations, allAnnotations]);

  // Track navigation - find all frames that contain annotations from this track
  // MUST BE BEFORE EARLY RETURNS - uses annotationSummary which has ALL frames, not just current
  const trackFrameInfo = React.useMemo(() => {
    if (!selectedTrackId || !frames.length || !annotationSummary?.length) {
      return { frameIndices: [] as number[], currentTrackFrameIndex: -1, totalTrackFrames: 0, firstFrameIndex: -1, lastFrameIndex: -1 };
    }

    // Find all annotation frame_ids for this track from the lightweight summary
    const trackFrameIds = new Set<string>();
    annotationSummary.forEach((a) => {
      if (a.track_id === selectedTrackId) {
        trackFrameIds.add(a.frame_id.toString());
      }
    });

    // Map frame_ids to frame indices and sort
    const frameIndices: number[] = [];
    frames.forEach((frame, index) => {
      if (trackFrameIds.has(frame.id)) {
        frameIndices.push(index);
      }
    });
    frameIndices.sort((a, b) => a - b);

    // Find current frame's position in the track
    const currentFrameIdx = frames.findIndex(f => f.id === currentFrame?.id);
    const currentTrackFrameIndex = frameIndices.indexOf(currentFrameIdx);

    return {
      frameIndices,
      currentTrackFrameIndex,
      totalTrackFrames: frameIndices.length,
      firstFrameIndex: frameIndices.length > 0 ? frameIndices[0] : -1,
      lastFrameIndex: frameIndices.length > 0 ? frameIndices[frameIndices.length - 1] : -1,
    };
  }, [selectedTrackId, frames, annotationSummary, currentFrame?.id]);

  // Sync local state from annotation when annotation changes - MUST BE BEFORE EARLY RETURNS
  useEffect(() => {
    if (!syncCuboidData) return;

    if (syncCuboidData.center) {
      setLocalPosition({
        x: syncCuboidData.center.x?.toFixed(2) ?? '0',
        y: syncCuboidData.center.y?.toFixed(2) ?? '0',
        z: syncCuboidData.center.z?.toFixed(2) ?? '0',
      });
    }
    if (syncCuboidData.dimensions) {
      setLocalDimensions({
        length: syncCuboidData.dimensions.length?.toFixed(2) ?? '1',
        width: syncCuboidData.dimensions.width?.toFixed(2) ?? '1',
        height: syncCuboidData.dimensions.height?.toFixed(2) ?? '1',
      });
    }
    if (syncCuboidData.rotation) {
      const yawDeg = (syncCuboidData.rotation.yaw ?? 0) * 180 / Math.PI;
      setLocalHeading(yawDeg.toFixed(1));
    }
  }, [syncCuboidData?.id, syncCuboidData?.center?.x, syncCuboidData?.center?.y, syncCuboidData?.center?.z,
      syncCuboidData?.dimensions?.length, syncCuboidData?.dimensions?.width, syncCuboidData?.dimensions?.height,
      syncCuboidData?.rotation?.yaw]);

  // ALL HOOKS MUST BE BEFORE ANY EARLY RETURNS
  useEffect(() => {
    // Don't show if suppressed (using inline editing in LabelListPanel)
    // BUT: Always show if there's a new selection (allow panel to appear for newly created annotations)
    if (suppressPropertiesPanel && isVisible) {
      // Only hide if panel is already visible and suppress flag is set
      setIsVisible(false);
    } else if (!suppressPropertiesPanel) {
      // Show panel when not suppressed and there's a selection
      setIsVisible(hasRegularSelection || has4DSelection);
    }
  }, [selectedAnnotations.length, has4DSelection, hasRegularSelection, suppressPropertiesPanel, isVisible]);

  // Resize and drag handlers for the properties panel - must be before early return
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      // Handle dragging
      if (isDraggingRef.current) {
        const newX = e.clientX - dragStartRef.current.x + dragStartRef.current.panelX;
        const newY = e.clientY - dragStartRef.current.y + dragStartRef.current.panelY;
        // Clamp to viewport
        const clampedX = Math.max(0, Math.min(window.innerWidth - panelSize.width - 10, newX));
        const clampedY = Math.max(56, Math.min(window.innerHeight - 100, newY));
        setPanelPosition({ x: clampedX, y: clampedY });
        return;
      }
      // Handle resizing
      if (isResizingRef.current === 'width' || isResizingRef.current === 'corner') {
        const newWidth = Math.max(200, Math.min(450, window.innerWidth - e.clientX - 10));
        setPanelSize(prev => ({ ...prev, width: newWidth }));
      }
      if (isResizingRef.current === 'height' || isResizingRef.current === 'corner') {
        const newHeight = Math.max(250, Math.min(700, e.clientY - (panelPosition.y >= 0 ? panelPosition.y : 56)));
        setPanelSize(prev => ({ ...prev, height: newHeight }));
      }
    };

    const handleMouseUp = () => {
      isResizingRef.current = null;
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // EARLY RETURN - after all hooks
  // Check suppressPropertiesPanel directly (not just isVisible) to avoid race condition
  if (suppressPropertiesPanel) return null;
  if (!isVisible || (!hasRegularSelection && !has4DSelection)) return null;

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
      is_static: selectedAnnotation4D.is_static,  // 4D annotations have is_static
      created_at: '',
      updated_at: '',
    };
  } else {
    ann = selectedAnnotations[0];
  }

  // Get fresh annotation from store to ensure track_id is up-to-date
  const freshAnn = useEditorStore.getState().annotations.get(ann.id);
  if (freshAnn) {
    ann = freshAnn;
  }

  // Get cuboid data for the current annotation (for display purposes)
  const cuboidData = ann.type === 'cuboid' ? ann.data as CuboidData : null;

  // Check if update is a "significant" change that should prompt for track-wide update
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const isSignificantChange = (updates: Partial<Annotation>, _changeType: string): { significant: boolean; type: string } => {
    // Class change (dropdown) - YES, prompt
    if (updates.class_id) return { significant: true, type: 'class' };
    // Static flag change (checkbox) - YES, prompt
    if (typeof updates.is_static === 'boolean') return { significant: true, type: 'static flag' };
    // Attributes change - YES, prompt
    if (updates.attributes && Object.keys(updates.attributes).length > 0) return { significant: true, type: 'attributes' };
    // Dimension changes - YES, prompt (called on blur)
    if (updates.data && (updates.data as CuboidData).dimensions) return { significant: true, type: 'dimensions' };
    // Position changes - YES, prompt (called on blur)
    if (updates.data && (updates.data as CuboidData).center) return { significant: true, type: 'position' };
    // Rotation changes - YES, prompt (called on blur)
    if (updates.data && (updates.data as CuboidData).rotation) return { significant: true, type: 'rotation' };
    return { significant: false, type: '' };
  };

  // Execute the actual update (called after confirmation or directly for non-tracked)
  const executeUpdate = async (id: string, updates: Partial<Annotation>, applyToTrack: boolean = false) => {
    const currentAnnotation = useEditorStore.getState().annotations.get(id);
    const isGeometryEdit = updates.data && (
      (updates.data as CuboidData).center ||
      (updates.data as CuboidData).dimensions ||
      (updates.data as CuboidData).rotation
    );
    const shouldAutoKeyframe = currentAnnotation &&
      currentAnnotation.track_id &&
      !currentAnnotation.is_keyframe &&
      isGeometryEdit &&
      currentFrame;

    if (is4D && selectedAnnotation4D) {
      const data = updates.data as CuboidData | undefined;
      const existingWorldData = selectedAnnotation4D.world_data;

      if (applyToTrack && selectedAnnotation4D.track_id) {
        // Apply to entire track - update all 4D annotations with this track_id
        // Batch all updates into a single state change
        const trackId = selectedAnnotation4D.track_id;
        const annotations4DMap = useAnnotation4DStore.getState().annotations4D;
        const newAnnotations4D = new Map(annotations4DMap);

        newAnnotations4D.forEach((a, aId) => {
          if (a.track_id === trackId && !a.is_deleted) {
            let updatedAnnotation = { ...a };
            let changed = false;

            if (updates.class_id) {
              updatedAnnotation.class_id = updates.class_id;
              changed = true;
            }
            if (updates.attributes) {
              updatedAnnotation.attributes = updates.attributes as Record<string, unknown>;
              changed = true;
            }
            if (typeof updates.is_static === 'boolean') {
              updatedAnnotation.is_static = updates.is_static;
              changed = true;
            }
            if (data?.dimensions) {
              updatedAnnotation.world_data = { ...a.world_data, dimensions: data.dimensions };
              changed = true;
            }

            if (changed) {
              newAnnotations4D.set(aId, updatedAnnotation);
            }
          }
        });

        // Single state update for all 4D track annotations
        useAnnotation4DStore.setState({ annotations4D: newAnnotations4D });

        // Save all modified 4D annotations to the database
        await saveAnnotations();
        // Invalidate queries to refresh data
        queryClient.invalidateQueries({ queryKey: ['task-annotations'] });
        queryClient.invalidateQueries({ queryKey: ['annotations4D'] });
      } else {
        // Apply to current annotation only
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
      }
    } else {
      if (applyToTrack && currentAnnotation?.track_id) {
        // Apply to entire track via backend API
        // This ensures ALL annotations in the track are updated, not just loaded ones
        const trackId = currentAnnotation.track_id;

        console.log('[Track Update] Updating track via API:', trackId);

        // Build the update payload for the backend
        const trackUpdatePayload: {
          class_id?: string;
          attributes?: Record<string, unknown>;
          dimensions?: { length: number; width: number; height: number };
          is_static?: boolean;
        } = {};

        if (updates.class_id) {
          trackUpdatePayload.class_id = updates.class_id;
        }
        if (updates.attributes) {
          trackUpdatePayload.attributes = updates.attributes;
        }
        if (typeof updates.is_static === 'boolean') {
          trackUpdatePayload.is_static = updates.is_static;
        }
        if (updates.data) {
          const updateData = updates.data as CuboidData;
          if (updateData.dimensions) {
            trackUpdatePayload.dimensions = updateData.dimensions;
          }
        }

        try {
          // Call backend API to update all annotations in the track
          const result = await annotation3DApi.updateByTrack(trackId, trackUpdatePayload);
          console.log('[Track Update] API result:', result);

          // Now also update the local state for immediate UI feedback
          const allAnnotations = useEditorStore.getState().annotations;
          const newAnnotations = new Map(allAnnotations);

          newAnnotations.forEach((a, aId) => {
            if (a.track_id === trackId) {
              const updatedAnnotation = { ...a };

              if (updates.class_id) {
                updatedAnnotation.class_id = updates.class_id;
              }
              if (updates.attributes) {
                updatedAnnotation.attributes = updates.attributes;
              }
              if (typeof updates.is_static === 'boolean') {
                updatedAnnotation.is_static = updates.is_static;
              }
              if (updates.data) {
                const existingData = a.data as CuboidData;
                const updateData = updates.data as CuboidData;
                const newData = { ...existingData };

                if (updateData.dimensions) {
                  newData.dimensions = updateData.dimensions;
                }
                if (updateData.center) {
                  newData.center = updateData.center;
                }
                if (updateData.rotation) {
                  newData.rotation = updateData.rotation;
                }

                updatedAnnotation.data = newData;
              }

              updatedAnnotation.updated_at = new Date().toISOString();
              newAnnotations.set(aId, updatedAnnotation);
            }
          });

          // Update local state (no need to mark as dirty since backend is already updated)
          useEditorStore.setState({ annotations: newAnnotations });

          // Also update local input state if dimensions changed
          if (updates.data) {
            const updateData = updates.data as CuboidData;
            if (updateData.dimensions) {
              setLocalDimensions({
                length: updateData.dimensions.length?.toFixed(2) ?? '1',
                width: updateData.dimensions.width?.toFixed(2) ?? '1',
                height: updateData.dimensions.height?.toFixed(2) ?? '1',
              });
            }
            if (updateData.center) {
              setLocalPosition({
                x: updateData.center.x?.toFixed(2) ?? '0',
                y: updateData.center.y?.toFixed(2) ?? '0',
                z: updateData.center.z?.toFixed(2) ?? '0',
              });
            }
            if (updateData.rotation) {
              const yawDeg = (updateData.rotation.yaw ?? 0) * 180 / Math.PI;
              setLocalHeading(yawDeg.toFixed(1));
            }
          }

          // Invalidate queries to refresh data
          queryClient.invalidateQueries({ queryKey: ['task-annotations'] });
          queryClient.invalidateQueries({ queryKey: ['annotations-3d'] });
          queryClient.invalidateQueries({ queryKey: ['all-3d-annotations'] });
          queryClient.invalidateQueries({ queryKey: ['annotations'] });

          // Reload all annotations from the backend to ensure all frames are updated
          const taskId = useEditorStore.getState().task?.id;
          const taxonomyIdForReload = useEditorStore.getState().scene?.selected_taxonomy_id;
          if (taskId) {
            console.log('[Track Update] Reloading all annotations from backend...');
            const freshAnnotations = await annotation3DApi.list(taskId, undefined, undefined, taxonomyIdForReload || undefined);
            // Convert to the format expected by setAnnotations
            const formattedAnnotations = freshAnnotations.map((ann: any) => ({
              ...ann,
              id: ann.id.toString(),
              task_id: ann.task_id.toString(),
              frame_id: ann.frame_id.toString(),
              track_id: ann.track_id?.toString() || null,
            }));
            useEditorStore.getState().setAnnotations(formattedAnnotations);
            console.log('[Track Update] Annotations reloaded:', formattedAnnotations.length);
          }
        } catch (error) {
          console.error('[Track Update] API error:', error);
          alert('Failed to update track annotations. Please try again.');
        }
      } else {
        updateAnnotationRegular(id, updates);
      }

      // Mark as keyframe for tracked annotations when geometry is edited
      if (shouldAutoKeyframe && currentAnnotation?.track_id && currentFrame) {
        markAsKeyframe(currentAnnotation.track_id, currentFrame.id);
      }
    }
  };

  // Unified update function with track confirmation
  const updateAnnotation = async (id: string, updates: Partial<Annotation>, changeTypeHint: string = '') => {
    const currentAnnotation = useEditorStore.getState().annotations.get(id) ||
                              (is4D && selectedAnnotation4D ? ann : null);

    // Check if this annotation is part of a track and the change is significant
    const { significant, type } = isSignificantChange(updates, changeTypeHint);
    if (currentAnnotation?.track_id && significant) {
      // Show confirmation modal
      setPendingTrackChange({ id, updates, is4D, changeType: type });
      setShowTrackChangeModal(true);
      return;
    }

    // No track or not a significant change - apply directly
    await executeUpdate(id, updates, false);
  };

  // Handle track change confirmation
  const handleTrackChangeConfirm = async (applyToTrack: boolean) => {
    if (pendingTrackChange) {
      setIsApplyingTrackChange(true);
      try {
        await executeUpdate(pendingTrackChange.id, pendingTrackChange.updates, applyToTrack);
      } finally {
        setIsApplyingTrackChange(false);
      }
    }
    setShowTrackChangeModal(false);
    setPendingTrackChange(null);
  };

  const handleTrackChangeCancel = () => {
    setShowTrackChangeModal(false);
    setPendingTrackChange(null);
    // Re-sync local state from annotation (cancel the pending change)
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
  };
    // Check if annotation has a track (use pre-computed selectedTrackId)
  const hasTrack = !!selectedTrackId;

  // Navigate to previous/next frame in track
  const goToPrevTrackFrame = () => {
    if (trackFrameInfo.currentTrackFrameIndex > 0) {
      const prevIdx = trackFrameInfo.frameIndices[trackFrameInfo.currentTrackFrameIndex - 1];
      const trackId = selectedTrackId; // Capture before navigation
      goToFrame(prevIdx);
      // Select the annotation on the new frame after annotations are loaded
      setTimeout(() => {
        const frame = frames[prevIdx];
        if (frame && trackId) {
          // Get fresh annotations from store (will have new frame's annotations after load)
          const freshAnnotations = useEditorStore.getState().annotations;
          const trackAnnotation = Array.from(freshAnnotations.values()).find(
            a => a.track_id === trackId && a.frame_id === frame.id
          );
          if (trackAnnotation) {
            useEditorStore.getState().selectAnnotation(trackAnnotation.id, false);
          }
        }
      }, 200);
    }
  };

  const goToNextTrackFrame = () => {
    if (trackFrameInfo.currentTrackFrameIndex < trackFrameInfo.totalTrackFrames - 1) {
      const nextIdx = trackFrameInfo.frameIndices[trackFrameInfo.currentTrackFrameIndex + 1];
      const trackId = selectedTrackId; // Capture before navigation
      goToFrame(nextIdx);
      // Select the annotation on the new frame after annotations are loaded
      setTimeout(() => {
        const frame = frames[nextIdx];
        if (frame && trackId) {
          const freshAnnotations = useEditorStore.getState().annotations;
          const trackAnnotation = Array.from(freshAnnotations.values()).find(
            a => a.track_id === trackId && a.frame_id === frame.id
          );
          if (trackAnnotation) {
            useEditorStore.getState().selectAnnotation(trackAnnotation.id, false);
          }
        }
      }, 200);
    }
  };

  const goToFirstTrackFrame = () => {
    const firstIdx = trackFrameInfo.firstFrameIndex;
    if (firstIdx >= 0) {
      const trackId = selectedTrackId; // Capture before navigation
      goToFrame(firstIdx);
      // Select the annotation on the new frame after annotations are loaded
      setTimeout(() => {
        const frame = frames[firstIdx];
        if (frame && trackId) {
          const freshAnnotations = useEditorStore.getState().annotations;
          const trackAnnotation = Array.from(freshAnnotations.values()).find(
            a => a.track_id === trackId && a.frame_id === frame.id
          );
          if (trackAnnotation) {
            useEditorStore.getState().selectAnnotation(trackAnnotation.id, false);
          }
        }
      }, 200);
    }
  };

  const goToLastTrackFrame = () => {
    const lastIdx = trackFrameInfo.lastFrameIndex;
    if (lastIdx >= 0) {
      const trackId = selectedTrackId; // Capture before navigation
      goToFrame(lastIdx);
      // Select the annotation on the new frame after annotations are loaded
      setTimeout(() => {
        const frame = frames[lastIdx];
        if (frame && trackId) {
          const freshAnnotations = useEditorStore.getState().annotations;
          const trackAnnotation = Array.from(freshAnnotations.values()).find(
            a => a.track_id === trackId && a.frame_id === frame.id
          );
          if (trackAnnotation) {
            useEditorStore.getState().selectAnnotation(trackAnnotation.id, false);
          }
        }
      }, 200);
    }
  };

    // Handle delete button click - show modal if tracked (for both 3D and 4D)
  const handleDeleteClick = () => {
    if (hasTrack) {
      setShowDeleteModal(true);
    } else {
      handleDeleteAnnotation();
    }
  };

  // Delete just this annotation
  const handleDeleteAnnotation = () => {
    if (is4D) {
      deleteAnnotation4D(ann.id);
    } else {
      deleteAnnotation(ann.id);
    }
      setShowDeleteModal(false);
    setIsVisible(false);
  };

  // Delete the entire track (all annotations with this track_id)
  const handleDeleteTrack = async () => {
    if (!ann.track_id) return;

    const trackId = ann.track_id;

    try {
      if (is4D) {
        // Delete all 4D annotations with this track_id
        annotations4D.forEach((a) => {
          if (a.track_id === trackId && !a.is_deleted) {
            deleteAnnotation4D(a.id);
          }
        });
        await saveAnnotations();
      } else {
        // Call backend API to delete ALL annotations with this track_id across ALL frames
        const { annotation3DApi } = await import('@/api/client');
        await annotation3DApi.deleteByTrack(trackId);

        // Clear local state — remove only this track's annotations.
        // Scoped dirty cleanup so other tracks are not affected.
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
        deleteTrack(trackId);

        setShowDeleteModal(false);
        setIsVisible(false);

        // Remove stale React Query cache so navigating to old frames doesn't
        // re-add deleted annotations via mergeAnnotationsFromServer.
        queryClient.removeQueries({ queryKey: ['annotations', taskId] });
        queryClient.removeQueries({ queryKey: ['all-3d-annotations', taskId] });
      }
    } catch (error) {
      console.error('Failed to delete track:', error);
      alert('Failed to delete track. Please try again.');
    }
  };

  const classDef = taxonomy?.classes.find((c) => c.id === ann.class_id);

  // Get effective attributes for this class (merging shared + class-specific)
  // Not using useMemo here to avoid hooks ordering issues with early returns
  const effectiveAttributes = getEffectiveAttributesForClass(ann.class_id, taxonomy);
  const hasAttributes = Object.keys(effectiveAttributes).length > 0;
  const hasPositionTab = ann.type === 'cuboid';
  const showPropertyTabs = hasAttributes && hasPositionTab;
  const resolvedPropertiesTab = showPropertyTabs
    ? activePropertiesTab
    : hasPositionTab
    ? 'position'
    : 'attributes';

  // Default position is now left side of screen
  const defaultLeft = '8px';

  // Start dragging the panel
  const handleDragStart = (e: React.MouseEvent) => {
    isDraggingRef.current = true;
    const rect = (e.target as HTMLElement).closest('.properties-panel')?.getBoundingClientRect();
    if (rect) {
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        panelX: rect.left,
        panelY: rect.top,
      };
      // Initialize position if not set
      if (panelPosition.x < 0) {
        setPanelPosition({ x: rect.left, y: rect.top });
      }
    }
    document.body.style.cursor = 'move';
    document.body.style.userSelect = 'none';
  };

  return (
    <div
      className="properties-panel fixed z-30 bg-dark-panel/95 backdrop-blur-sm border border-gray-700/50 rounded-xl shadow-2xl overflow-hidden flex flex-col group"
      style={{
        top: panelPosition.y >= 0 ? `${panelPosition.y}px` : '56px',
        left: panelPosition.x >= 0 ? `${panelPosition.x}px` : defaultLeft,
        right: 'auto',
        width: `${panelSize.width}px`,
        minWidth: '200px',
        maxWidth: '450px',
        height: `${panelSize.height}px`,
        minHeight: '250px',
        maxHeight: '700px',
      }}
    >
      {/* Draggable Header */}
      <div
        className="bg-gradient-to-r from-primary/20 to-dark-panel border-b border-gray-700/50 px-3 py-2 flex items-center justify-between cursor-move select-none"
        onMouseDown={handleDragStart}
      >
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 3v18M3 12h18"/>
            <rect x="8" y="8" width="8" height="8" rx="1"/>
          </svg>
          <span className="text-sm font-semibold text-white">Properties</span>
        </div>
        <div className="flex items-center gap-2">
          {/* Class color badge */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 bg-dark/50 rounded">
            <span className="w-2.5 h-2.5 rounded" style={{ backgroundColor: classDef?.color ?? '#888888' }} />
            <span className="text-xs text-gray-300">
              {classDef?.name ?? (ann.class_id ? `⚠️ ${ann.class_id}` : 'Unknown')}
            </span>
          </div>
          <button
            onClick={() => {
              useEditorStore.getState().deselectAll();
              useTrackStore.getState().setActiveTrack(null);
            }}
            onMouseDown={(e) => e.stopPropagation()}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-dark-hover transition-colors"
            title="Close (Esc)"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Resize handles */}
      <div
        className="absolute top-0 bottom-0 left-0 w-1.5 bg-transparent hover:bg-primary/50 cursor-col-resize transition-colors"
        onMouseDown={() => {
          isResizingRef.current = 'width';
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
      />
      <div
        className="absolute bottom-0 left-0 right-0 h-1.5 bg-transparent hover:bg-primary/50 cursor-row-resize transition-colors"
        onMouseDown={() => {
          isResizingRef.current = 'height';
          document.body.style.cursor = 'row-resize';
          document.body.style.userSelect = 'none';
        }}
      />
      <div
        className="absolute bottom-0 left-0 w-4 h-4 bg-transparent hover:bg-primary/50 cursor-nesw-resize transition-colors rounded-tr"
        onMouseDown={() => {
          isResizingRef.current = 'corner';
          document.body.style.cursor = 'nesw-resize';
          document.body.style.userSelect = 'none';
        }}
      />

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2">
        {/* QA Mode Notice */}
        {isQALockedAnnotation && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-2 text-xs text-amber-200">
            🔒 <strong>QA Mode:</strong> Editing locked. Only false negative annotations can be edited.
          </div>
        )}

        {/* Class Selector */}
        <div className={`space-y-1 ${isSelectedLocked ? 'pointer-events-none opacity-50' : ''}`}>
          <label className="text-xs font-medium text-gray-400">Class</label>
          {(() => {
            // Check if current class is in taxonomy
            const isUnknownClass = ann.class_id && taxonomy?.classes && !taxonomy.classes.some(c => c.id === ann.class_id);
            return (
              <>
                {isUnknownClass && (
                  <div className="text-xs text-yellow-400 bg-yellow-400/10 px-2 py-1 rounded mb-1">
                    ⚠️ Class "{ann.class_id}" not in taxonomy
                  </div>
                )}
                <select
                  value={ann.class_id}
                  onChange={(e) => updateAnnotation(ann.id, { class_id: e.target.value })}
                  disabled={isSelectedLocked}
                  className={`w-full bg-dark border border-gray-600/50 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/30 ${isSelectedLocked ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  {isUnknownClass && (
                    <option value={ann.class_id}>⚠️ {ann.class_id} (unknown)</option>
                  )}
                  {taxonomy?.classes.map((cls) => (
                    <option key={cls.id} value={cls.id}>{cls.name}</option>
                  ))}
                </select>
              </>
            );
          })()}
        </div>

        {/* Track Navigation - Right after class selector */}
        {hasTrack && trackFrameInfo.totalTrackFrames > 0 && (
          <div className="bg-purple-500/10 rounded-lg p-2 border border-purple-500/30">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-purple-300 font-medium flex items-center gap-1">
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/>
                  <path d="M22 6l-10 7L2 6"/>
                </svg>
                Track: {ann.track_id?.slice(0, 6)}...
              </span>
              <span className="text-gray-300 font-mono text-xs">
                {trackFrameInfo.currentTrackFrameIndex >= 0
                  ? `${trackFrameInfo.currentTrackFrameIndex + 1} / ${trackFrameInfo.totalTrackFrames}`
                  : `${trackFrameInfo.totalTrackFrames} frames`
                }
              </span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={goToFirstTrackFrame}
                disabled={trackFrameInfo.currentTrackFrameIndex <= 0}
                className="flex-1 py-1.5 rounded text-xs flex items-center justify-center bg-purple-600/30 text-purple-200 hover:bg-purple-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Go to first frame of track"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 19l-7-7 7-7M18 19l-7-7 7-7"/>
                </svg>
              </button>
              <button
                onClick={goToPrevTrackFrame}
                disabled={trackFrameInfo.currentTrackFrameIndex <= 0}
                className="flex-1 py-1.5 rounded text-xs flex items-center justify-center bg-purple-600/30 text-purple-200 hover:bg-purple-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Previous track frame"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 19l-7-7 7-7"/>
                </svg>
              </button>
              <button
                onClick={goToNextTrackFrame}
                disabled={trackFrameInfo.currentTrackFrameIndex >= trackFrameInfo.totalTrackFrames - 1}
                className="flex-1 py-1.5 rounded text-xs flex items-center justify-center bg-purple-600/30 text-purple-200 hover:bg-purple-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Next track frame"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M9 5l7 7-7 7"/>
                </svg>
              </button>
              <button
                onClick={goToLastTrackFrame}
                disabled={trackFrameInfo.currentTrackFrameIndex >= trackFrameInfo.totalTrackFrames - 1}
                className="flex-1 py-1.5 rounded text-xs flex items-center justify-center bg-purple-600/30 text-purple-200 hover:bg-purple-600/50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Go to last frame of track"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M13 5l7 7-7 7M6 5l7 7-7 7"/>
                </svg>
              </button>
            </div>
            <div className="flex justify-between text-[10px] text-gray-400 mt-1.5">
              <span>Frame {trackFrameInfo.firstFrameIndex >= 0 ? trackFrameInfo.firstFrameIndex + 1 : '-'}</span>
              <span>→</span>
              <span>Frame {trackFrameInfo.lastFrameIndex >= 0 ? trackFrameInfo.lastFrameIndex + 1 : '-'}</span>
            </div>
          </div>
        )}

        {showPropertyTabs && (
          <div className="bg-dark/30 rounded-lg p-1 border border-gray-700/30">
            <div className="flex gap-1">
              <button
                onClick={() => setActivePropertiesTab('position')}
                className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
                  resolvedPropertiesTab === 'position'
                    ? 'bg-purple-500/30 text-purple-200'
                    : 'bg-gray-700/40 text-gray-400 hover:bg-gray-700/60'
                }`}
              >
                Position
              </button>
              <button
                onClick={() => setActivePropertiesTab('attributes')}
                className={`flex-1 py-1 rounded text-[10px] font-medium transition-colors ${
                  resolvedPropertiesTab === 'attributes'
                    ? 'bg-purple-500/30 text-purple-200'
                    : 'bg-gray-700/40 text-gray-400 hover:bg-gray-700/60'
                }`}
              >
                Attributes
              </button>
            </div>
          </div>
        )}

        {resolvedPropertiesTab === 'position' && (
          <div className={isSelectedLocked ? 'pointer-events-none opacity-50' : ''}>
          <>
            {/* Position (3D Cuboid) */}
            {ann.type === 'cuboid' && cuboidData?.center && (
              <div className="bg-dark/30 rounded-lg p-2 border border-gray-700/30">
                <button
                  onClick={() => toggleSection('position')}
                  className="w-full flex items-center justify-between text-sm font-medium text-gray-300 mb-2 hover:text-white transition-colors"
                >
                  <span>Position</span>
                  <svg className={`w-4 h-4 transition-transform ${expandedSections.position ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {expandedSections.position && (
                  <>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      {(['x', 'y', 'z'] as const).map((axis) => (
                        <div key={axis}>
                          <label className={`text-sm block font-semibold mb-1 ${
                            axis === 'x' ? 'text-red-400' : axis === 'y' ? 'text-green-400' : 'text-blue-400'
                          }`}>{axis.toUpperCase()}</label>
                          <input
                            type="number"
                            step="0.1"
                            value={localPosition[axis]}
                            onChange={(e) => setLocalPosition(prev => ({ ...prev, [axis]: e.target.value }))}
                            onBlur={() => {
                              const value = parseFloat(localPosition[axis]) || 0;
                              if (value !== cuboidData.center?.[axis]) {
                                const currentCenter = cuboidData.center ?? { x: 0, y: 0, z: 0 };
                                updateAnnotation(ann.id, {
                                  data: { ...ann.data, center: { x: currentCenter.x, y: currentCenter.y, z: currentCenter.z, [axis]: value } }
                                });
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            className="w-full bg-dark-panel border border-gray-600/50 rounded-md px-2 py-1.5 text-white text-sm font-mono focus:border-primary focus:outline-none"
                          />
                        </div>
                      ))}
                    </div>
                    {/* Distance from Center */}
                    <div className="pt-2 border-t border-gray-700/50">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-400">Distance from Center</span>
                        <span className="text-sm font-mono text-cyan-400">
                          {(() => {
                            const x = cuboidData.center.x;
                            const y = cuboidData.center.y;
                            const z = cuboidData.center.z;
                            const distance = Math.sqrt(x*x + y*y + z*z);
                            return distance.toFixed(2) + 'm';
                          })()}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Dimensions (3D Cuboid) */}
            {ann.type === 'cuboid' && cuboidData?.dimensions && (
              <div className="bg-dark/30 rounded-lg p-2 border border-gray-700/30">
                <button
                  onClick={() => toggleSection('dimensions')}
                  className="w-full flex items-center justify-between text-sm font-medium text-gray-300 mb-2 hover:text-white transition-colors"
                >
                  <span>Dimensions</span>
                  <svg className={`w-4 h-4 transition-transform ${expandedSections.dimensions ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {expandedSections.dimensions && (
                  <div className="grid grid-cols-3 gap-2">
                    {(['length', 'width', 'height'] as const).map((dim) => (
                      <div key={dim}>
                        <label className="text-sm text-gray-400 block mb-1 font-medium">{dim.charAt(0).toUpperCase() + dim.slice(1)}</label>
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
                              updateAnnotation(ann.id, {
                                data: { ...ann.data, dimensions: { length: currentDims.length, width: currentDims.width, height: currentDims.height, [dim]: value } }
                              });
                            }
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              (e.target as HTMLInputElement).blur();
                            }
                          }}
                          className="w-full bg-dark-panel border border-gray-600/50 rounded-md px-2 py-1.5 text-white text-sm font-mono focus:border-primary focus:outline-none"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Heading/Rotation (3D Cuboid) */}
            {ann.type === 'cuboid' && (
              <div className="bg-dark/30 rounded-lg p-2 border border-gray-700/30">
                <button
                  onClick={() => toggleSection('heading')}
                  className="w-full flex items-center justify-between text-sm font-medium text-gray-300 mb-2 hover:text-white transition-colors"
                >
                  <span>Heading</span>
                  <svg className={`w-4 h-4 transition-transform ${expandedSections.heading ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {expandedSections.heading && (
                  <div className="space-y-2">
                    <div className="flex-1">
                      <input
                        type="number"
                        step="1"
                        value={localHeading}
                        onChange={(e) => setLocalHeading(e.target.value)}
                        onBlur={() => {
                          const degrees = parseFloat(localHeading) || 0;
                          const radians = (degrees * Math.PI / 180);
                          const currentYaw = cuboidData?.rotation?.yaw ?? 0;
                          if (Math.abs(radians - currentYaw) > 0.001) {
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
                          }
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            (e.target as HTMLInputElement).blur();
                          }
                        }}
                        className="w-full bg-dark-panel border border-gray-600/50 rounded-md px-2 py-1.5 text-white text-sm font-mono text-center focus:border-primary focus:outline-none"
                      />
                      <div className="text-center text-xs text-gray-500 mt-1">degrees</div>
                    </div>
                    {/* Visual heading indicator */}
                    <div className="relative w-12 h-12 rounded-full border-2 border-gray-600 bg-dark/50">
                      <div className="absolute top-1/2 left-1/2 w-1 h-1 bg-gray-400 rounded-full -translate-x-1/2 -translate-y-1/2" />
                      <div
                        className="absolute top-1/2 left-1/2 w-5 h-0.5 bg-red-500 origin-left rounded"
                        style={{ transform: `translateY(-50%) rotate(${-(cuboidData?.rotation?.yaw ?? 0)}rad)` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
          </div>
        )}

        {/* Static Object Toggle */}
        <div className={`bg-dark/30 rounded-lg p-2 border border-gray-700/30 ${isSelectedLocked ? 'pointer-events-none opacity-50' : ''}`}>
          <div className="flex items-center justify-between">
            <div>
              <span className="text-sm font-medium text-gray-300">Static Object</span>
              <p className="text-xs text-gray-500">Object doesn't move</p>
            </div>
            <label className="cursor-pointer">
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
                  <div className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    ann.is_static ? 'translate-x-5' : ''
                  }`} />
                </div>
              </div>
            </label>
          </div>
        </div>

        {/* Attributes */}
        {resolvedPropertiesTab === 'attributes' && hasAttributes && (
          <div className={`bg-dark/30 rounded-lg p-2 border border-gray-700/30 ${isSelectedLocked ? 'pointer-events-none opacity-50' : ''}`}>
            <button
              onClick={() => toggleSection('attributes')}
              className="w-full flex items-center justify-between text-sm font-medium text-gray-300 mb-2 hover:text-white transition-colors"
            >
              <span>Attributes</span>
              <svg className={`w-4 h-4 transition-transform ${expandedSections.attributes ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expandedSections.attributes && (
              <div className="space-y-2">
                {Object.entries(effectiveAttributes).map(([key, def]) => (
                  <div key={key}>
                    <label className="text-sm text-gray-400 block mb-1.5 font-medium">{key}</label>
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
            )}
          </div>
        )}

        {/* Track Management - Compact */}
        <div className={`bg-dark/50 rounded p-1.5 ${isSelectedLocked ? 'pointer-events-none opacity-50' : ''}`}>
          <div className="text-xs text-gray-400 mb-1 flex items-center justify-between">
            <span>Track</span>
            {hasTrack && (
              <span className="text-xs text-purple-400 bg-purple-500/20 px-1 py-0.5 rounded">
                {ann.track_id?.slice(0, 6)}...
              </span>
            )}
          </div>

          {hasTrack ? (
            <div className="space-y-1">
              {/* Track Info */}
              {(() => {
                const track = ann.track_id ? tracks.get(ann.track_id) : undefined;
                const keyframeCount = track?.keyframe_ids.size ?? 0;
                const frameIsKeyframe = ann.track_id && currentFrame ? isKeyframe(ann.track_id, currentFrame.id) : false;
                const hasExplicitStart = track?.start_frame_index !== null && track?.start_frame_index !== undefined;
                const hasExplicitEnd = track?.end_frame_index !== null && track?.end_frame_index !== undefined;
                const inferredStart = trackFrameInfo.firstFrameIndex >= 0
                  ? frames[trackFrameInfo.firstFrameIndex]?.frame_index
                  : null;
                const inferredEnd = trackFrameInfo.lastFrameIndex >= 0
                  ? frames[trackFrameInfo.lastFrameIndex]?.frame_index
                  : null;
                const displayStart = hasExplicitStart ? track?.start_frame_index : inferredStart;
                const displayEnd = hasExplicitEnd ? track?.end_frame_index : inferredEnd;
                const hasDisplayStart = displayStart !== null && displayStart !== undefined;
                const hasDisplayEnd = displayEnd !== null && displayEnd !== undefined;

                return (
                  <>
                    {/* Keyframe Status */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-gray-500">Keyframes</span>
                      <span className="text-gray-300">{keyframeCount}</span>
                    </div>

                    {/* Toggle Keyframe Button */}
                    <button
                      onClick={() => {
                        if (!ann.track_id || !currentFrame) return;
                        if (frameIsKeyframe) {
                          removeKeyframe(ann.track_id, currentFrame.id);
                          updateAnnotation(ann.id, { is_keyframe: false } as Partial<Annotation>);
                        } else {
                          addKeyframe(ann.track_id, currentFrame.id, ann.id);
                        }
                      }}
                      className={`w-full py-1 rounded text-xs flex items-center justify-center gap-1 ${
                        frameIsKeyframe
                          ? 'bg-yellow-500/20 text-yellow-300 hover:bg-yellow-500/30'
                          : 'bg-gray-700/50 text-gray-300 hover:bg-gray-700'
                      }`}
                    >
                      <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill={frameIsKeyframe ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
                        <path d="M12 2L2 12l10 10 10-10L12 2z" />
                      </svg>
                      {frameIsKeyframe ? 'Keyframe ✓' : 'Mark as Keyframe'}
                    </button>

                    {/* Track Lifecycle Controls - Set Start/End */}
                    <div className="flex gap-1">
                      <button
                        onClick={() => {
                          if (ann.track_id && currentFrame) {
                            const { setTrackStart, tracks } = useTrackStore.getState();
                            const { frames: editorFrames } = useEditorStore.getState();
                            const sortedFrames = [...editorFrames].sort((a, b) => a.frame_index - b.frame_index);
                            const frameIdx = sortedFrames.findIndex(f => f.id === currentFrame.id);
                            const currentTrack = tracks.get(ann.track_id);
                            if (frameIdx !== -1) {
                              const currentStartIdx = sortedFrames[frameIdx].frame_index;
                              // Toggle: if already set to this frame, clear it
                              if (currentTrack?.start_frame_index === currentStartIdx) {
                                setTrackStart(ann.track_id, null);
                              } else {
                                setTrackStart(ann.track_id, currentStartIdx);
                              }
                            }
                          }
                        }}
                        className={`flex-1 py-1 rounded text-xs flex items-center justify-center gap-0.5 ${
                          hasDisplayStart
                            ? 'bg-orange-500/20 text-orange-300'
                            : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'
                        }`}
                        title={hasExplicitStart ? "Click to clear start frame" : "Set track start frame"}
                      >
                        <svg className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M19 12H5M12 5l-7 7 7 7"/>
                        </svg>
                        {hasDisplayStart ? `S:${displayStart + 1}` : 'Start'}
                      </button>
                      <button
                        onClick={() => {
                          if (ann.track_id && currentFrame) {
                            const { setTrackEnd, tracks } = useTrackStore.getState();
                            const { frames: editorFrames } = useEditorStore.getState();
                            const sortedFrames = [...editorFrames].sort((a, b) => a.frame_index - b.frame_index);
                            const frameIdx = sortedFrames.findIndex(f => f.id === currentFrame.id);
                            const currentTrack = tracks.get(ann.track_id);
                            if (frameIdx !== -1) {
                              const currentEndIdx = sortedFrames[frameIdx].frame_index;
                              // Toggle: if already set to this frame, clear it
                              if (currentTrack?.end_frame_index === currentEndIdx) {
                                setTrackEnd(ann.track_id, null);
                              } else {
                                setTrackEnd(ann.track_id, currentEndIdx);
                              }
                            }
                          }
                        }}
                        className={`flex-1 py-1 rounded text-xs flex items-center justify-center gap-0.5 ${
                          hasDisplayEnd
                            ? 'bg-red-500/20 text-red-300'
                            : 'bg-gray-700/50 text-gray-400 hover:bg-gray-700'
                        }`}
                        title={hasExplicitEnd ? "Click to clear end frame" : "Set track end frame"}
                      >
                        {hasDisplayEnd ? `E:${displayEnd + 1}` : 'End'}
                        <svg className="w-2 h-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M5 12h14M12 5l7 7-7 7"/>
                        </svg>
                      </button>
                    </div>

                    {/* Auto-interpolation status */}
                    {keyframeCount >= 1 && (
                      <div className="text-xs text-gray-500 text-center py-0.5 border-t border-gray-700/50">
                        {keyframeCount} keyframe{keyframeCount > 1 ? 's' : ''} • Auto-interpolating
                      </div>
                    )}

                    {/* Propagate Frames */}
                    {showPropagateInput ? (
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-400">Frames:</span>
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={propagateFrames}
                            onChange={(e) => setPropagateFrames(Math.max(1, parseInt(e.target.value) || 1))}
                            className="flex-1 px-1 py-0.5 bg-dark-panel border border-gray-600 rounded text-xs text-white focus:border-primary outline-none"
                            placeholder="N"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-xs text-gray-400">Dir:</span>
                          <select
                            value={propagateDirection}
                            onChange={(e) => setPropagateDirection(e.target.value as 'forward' | 'backward' | 'both')}
                            className="flex-1 bg-dark-panel border border-gray-600/50 rounded px-1 py-0.5 text-xs text-gray-300"
                          >
                            <option value="forward">Forward</option>
                            <option value="backward">Backward</option>
                            <option value="both">Both</option>
                          </select>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={async () => {
                              if (ann.track_id) {
                                // Get fresh tracks from store (not stale closure)
                                const freshTracks = useTrackStore.getState().tracks;
                                const track = freshTracks.get(ann.track_id);
                                if (!track) {
                                  console.error('[PropertiesPanel] Track not found in store:', ann.track_id);
                                  return;
                                }
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
                              }
                            }}
                            disabled={isPropagating}
                            className={`flex-1 py-0.5 rounded text-xs transition-all ${
                              propagateSuccess
                                ? 'bg-green-500/40 text-green-200'
                                : isPropagating
                                ? 'bg-green-500/30 text-green-200 cursor-wait'
                                : 'bg-green-500/20 text-green-300 hover:bg-green-500/30'
                            }`}
                          >
                            {propagateSuccess ? '✓ Done!' : isPropagating ? 'Working...' : 'Go'}
                          </button>
                          <button
                            onClick={() => setShowPropagateInput(false)}
                            className="px-1 py-0.5 text-gray-400 hover:text-white text-xs"
                            disabled={isPropagating}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowPropagateInput(true)}
                        className="w-full py-1 bg-green-500/20 text-green-300 rounded text-xs hover:bg-green-500/30 flex items-center justify-center gap-1"
                      >
                        <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M13 5l7 7-7 7M5 5l7 7-7 7"/>
                        </svg>
                        Propagate Frames
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          ) : (
            <div className="space-y-1">
              <button
                onClick={() => {
                  const newTrack = createTrack(ann.class_id, ann.attributes);
                  if (currentFrame) {
                    addAnnotationToTrack(newTrack.id, currentFrame.id, ann.id, true);
                  }
                }}
                className="w-full py-1 bg-purple-500/20 text-purple-300 rounded text-xs hover:bg-purple-500/30 flex items-center justify-center gap-1"
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
                    className="w-full py-1 bg-gray-700/50 text-gray-300 rounded text-xs hover:bg-gray-700 flex items-center justify-center gap-1"
                  >
                    <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M5 12h14M12 5l7 7-7 7"/>
                    </svg>
                    Assign to Track
                  </button>

                  {showTrackList && (
                    <div className="absolute left-0 right-0 bottom-full mb-1 bg-dark-panel border border-gray-600 rounded shadow-xl z-20 max-h-32 overflow-y-auto">
                      {Array.from(tracks.values()).map(t => {
                        const trackClass = taxonomy?.classes.find(c => c.id === t.class_id);
                        return (
                          <button
                            key={t.id}
                            onClick={() => {
                              if (currentFrame) {
                                addAnnotationToTrack(t.id, currentFrame.id, ann.id, true);
                              }
                              setShowTrackList(false);
                            }}
                            className="w-full px-2 py-1.5 text-left text-xs text-gray-300 hover:bg-gray-700/50 border-b border-gray-700/50 last:border-b-0"
                          >
                            <div className="flex items-center gap-1">
                              <span
                                className="w-2 h-2 rounded-sm flex-shrink-0"
                                style={{ backgroundColor: trackClass?.color ?? '#8b5cf6' }}
                              />
                              <span className="font-mono text-purple-400 truncate">{t.id.slice(0, 8)}</span>
                            </div>
                            <div className="flex items-center justify-between mt-0.5 text-xs text-gray-500">
                              <span>{trackClass?.name ?? 'Unknown'}</span>
                              <span>{t.keyframe_ids.size} keyframes</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Lock Banner - shown when annotation is QA-approved */}
        {isSelectedLocked && (
          <div className="px-2 py-1.5 bg-green-500/10 border border-green-500/30 rounded flex items-center gap-1.5 mb-1">
            <span className="text-xs">🔒</span>
            <span className="text-xs text-green-400 font-medium">QA Approved — Locked</span>
          </div>
        )}

        {/* Delete Button - Compact */}
        <button
          onClick={handleDeleteClick}
          disabled={isSelectedLocked}
          className={`w-full px-2 py-1 rounded text-xs transition-colors flex items-center justify-center gap-1 ${
            isSelectedLocked
              ? 'bg-gray-700/30 text-gray-600 cursor-not-allowed'
              : 'bg-red-500/10 text-red-400 hover:bg-red-500/20'
          }`}
        >
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
          Delete
        </button>
      </div>

      {/* Track Change Confirmation Modal */}
      {showTrackChangeModal && pendingTrackChange && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
          <div className="bg-dark-panel border border-gray-700 rounded-xl p-4 max-w-sm w-full mx-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-white mb-2">
              Track {pendingTrackChange.changeType.charAt(0).toUpperCase() + pendingTrackChange.changeType.slice(1)} Change
            </h3>
            <p className="text-xs text-gray-400 mb-3">
              This annotation is part of a track. Would you like to apply this <strong className="text-white">{pendingTrackChange.changeType}</strong> change to all frames in the track, or just this frame?
            </p>

            {isApplyingTrackChange ? (
              <div className="flex items-center justify-center py-4">
                <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-green-400"></div>
                <span className="ml-2 text-sm text-gray-300">Applying changes...</span>
              </div>
            ) : (
              <div className="space-y-2">
                <button
                  onClick={() => handleTrackChangeConfirm(false)}
                  className="w-full px-3 py-2 bg-blue-500/20 text-blue-300 rounded text-xs hover:bg-blue-500/30 transition-colors"
                >
                  This Frame Only
                </button>

                <button
                  onClick={() => handleTrackChangeConfirm(true)}
                  className="w-full px-3 py-2 bg-green-500/20 text-green-300 rounded text-xs hover:bg-green-500/30 transition-colors"
                >
                  Apply to All Frames
                </button>

                <button
                  onClick={handleTrackChangeCancel}
                  className="w-full px-3 py-2 bg-gray-700/50 text-gray-300 rounded text-xs hover:bg-gray-700 transition-colors"
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal - Same as before */}
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
                className="w-full px-3 py-2 bg-orange-500/20 text-orange-300 rounded text-xs hover:bg-orange-500/30 transition-colors"
              >
                Delete This Box Only
              </button>

              <button
                onClick={handleDeleteTrack}
                className="w-full px-3 py-2 bg-red-500/20 text-red-300 rounded text-xs hover:bg-red-500/30 transition-colors"
              >
                Delete Entire Track
              </button>

              <button
                onClick={() => setShowDeleteModal(false)}
                className="w-full px-3 py-2 bg-gray-700/50 text-gray-300 rounded text-xs hover:bg-gray-700 transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// TRACK MANAGEMENT - Removed from compact panel for now
// =============================================================================

// =============================================================================
// FOCUSED CAMERA VIEWS - Shows cameras where selected cuboid is visible
// =============================================================================

interface FocusedCameraViewsProps {
  visibleCameras: string[];
  selectedCuboid: CuboidData | null;
  classColor: string;
  panelHeight: number;
  onHeightChange: (height: number) => void;
  isFullWidth?: boolean; // True when showing all cameras (no selection)
  orthoViewsWidth?: number; // Width of orthographic views panel for dynamic sizing
  qaPanelOffset?: number; // Additional offset for QA panel when in QA mode
  clickedPoint?: { x: number; y: number; z: number } | null;
  onCameraClick?: (cameraId: string) => void; // Override camera card click behavior
}

// Single camera view with projected cuboid overlay
const FocusedCameraCard: React.FC<{
  cameraId: string;
  imageUrl: string | undefined;
  selectedCuboid: CuboidData | null;
  classColor: string;
  onClick: () => void;
  clickedPoint?: { x: number; y: number; z: number } | null;
}> = React.memo(({ cameraId, imageUrl, selectedCuboid, classColor, onClick, clickedPoint }) => {
  const scene = useEditorStore(state => state.scene);
  const useFisheyeProjection = useEditorStore(state => state.lidarView.useFisheyeProjection);
  const clipBox = useEditorStore(state => state.lidarView.clipBox);
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  // Bumped when full-res image loads so canvas draws with correct naturalWidth/Height
  const [_imgVersion, setImgVersion] = useState(0);

  // Zoom and pan state
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  // Get camera calibration
  const cameraCalib = scene?.calibration?.lidar_to_cameras?.[cameraId];

  // Store stable image dimensions - use calibration data as primary source
  // This avoids projection jitter when switching frames (naturalWidth might be 0 briefly)
  const stableImageSize = useMemo(() => {
    if (!cameraCalib?.intrinsic) return { width: 1920, height: 1080 };
    const { cx, cy, resolution } = cameraCalib.intrinsic;
    // Prefer explicit resolution from calibration, fall back to cx*2/cy*2
    return {
      width: resolution?.[0] ?? Math.round(cx * 2),
      height: resolution?.[1] ?? Math.round(cy * 2),
    };
  }, [cameraCalib?.intrinsic]);

  // Handle cached images (already complete before React attaches onLoad)
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setImgVersion(v => v + 1);
    }
  }, [imageUrl]);

  // Track container size
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Draw cuboid projection on canvas — mirrors ProjectedPointsOverlay exactly.
  // Runs whenever cuboid, calibration, container size, or colour changes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use parent clientWidth/Height like ProjectedPointsOverlay does, falling back to containerSize
    const parent = canvas.parentElement;
    const w = parent?.clientWidth  || containerSize.width  || canvas.offsetWidth;
    const h = parent?.clientHeight || containerSize.height || canvas.offsetHeight;

    canvas.width  = w;
    canvas.height = h;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!cameraCalib || !canvas.width || !canvas.height) return;
    if (!selectedCuboid && !clickedPoint) return;

    // XYZ Range Filter: Skip rendering if cuboid center is outside the clipBox bounds
    if (clipBox?.enabled && selectedCuboid) {
      const center = selectedCuboid.center;
      if (center.x < clipBox.xMin || center.x > clipBox.xMax ||
          center.y < clipBox.yMin || center.y > clipBox.yMax ||
          center.z < clipBox.zMin || center.z > clipBox.zMax) {
        return;
      }
    }

    const { extrinsic, intrinsic } = cameraCalib;
    const { fx, fy, cx, cy, camera_model, distortion } = intrinsic;
    const R_stored = extrinsic.rotation;
    const t_stored = extrinsic.translation;

    // Use actual image dimensions when available, fall back to calibration-derived size
    // This matches how ProjectedPointsOverlay uses naturalWidth/naturalHeight
    const img = imgRef.current;
    const imageWidth = (img && img.naturalWidth > 0) ? img.naturalWidth : stableImageSize.width;
    const imageHeight = (img && img.naturalHeight > 0) ? img.naturalHeight : stableImageSize.height;

    // Check if extrinsics need to be inverted
    // DISABLED: Inversion was causing projections to appear in wrong cameras
    const needsInversion = false; // Disabled - see if projection appears in correct camera

    let R: number[][];
    let t: number[];

    if (needsInversion) {
      // Invert the transform: R_inv = R^T, t_inv = -R^T @ t
      R = [
        [R_stored[0][0], R_stored[1][0], R_stored[2][0]],
        [R_stored[0][1], R_stored[1][1], R_stored[2][1]],
        [R_stored[0][2], R_stored[1][2], R_stored[2][2]],
      ];
      t = [
        -(R[0][0]*t_stored[0] + R[0][1]*t_stored[1] + R[0][2]*t_stored[2]),
        -(R[1][0]*t_stored[0] + R[1][1]*t_stored[1] + R[1][2]*t_stored[2]),
        -(R[2][0]*t_stored[0] + R[2][1]*t_stored[1] + R[2][2]*t_stored[2]),
      ];
    } else {
      R = R_stored;
      t = t_stored;
    }

    // Compute displayed image area (CSS object-contain equivalent)
    const cW = canvas.width;
    const cH = canvas.height;
    const containerAspect = cW / cH;
    const imageAspect     = imageWidth / imageHeight;
    let displayWidth: number, displayHeight: number;
    if (containerAspect > imageAspect) {
      displayHeight = cH;
      displayWidth  = cH * imageAspect;
    } else {
      displayWidth  = cW;
      displayHeight = cW / imageAspect;
    }
    const oX     = (cW - displayWidth)  / 2;
    const oY     = (cH - displayHeight) / 2;
    const scaleX = displayWidth  / imageWidth;
    const scaleY = displayHeight / imageHeight;

    // Fisheye detection: small focal length relative to image + 4 distortion params
    // OR toggle is enabled OR camera_model is explicitly kannala_brandt
    const isAutoFisheye = distortion?.length === 4 && fx < imageWidth / 2;
    const useFisheye = useFisheyeProjection || camera_model === 'kannala_brandt' || isAutoFisheye;

    console.log('[FocusedCameraCard] Projection params for', cameraId, {
      fx, fy, cx, cy,
      imageWidth, imageHeight,
      camera_model,
      distortion,
      isAutoFisheye,
      useFisheye,
      needsInversion,
      useFisheyeProjection,
    });

    // Debug: Show camera look direction (R[2] row determines camera Z/depth direction in LiDAR coords)
    // R[2][0], R[2][1], R[2][2] = how much LiDAR X, Y, Z contribute to camera Z
    console.log(`[FocusedCameraCard] ${cameraId} R[2] (cam Z direction): [${R[2][0].toFixed(3)}, ${R[2][1].toFixed(3)}, ${R[2][2].toFixed(3)}], t: [${t[0].toFixed(3)}, ${t[1].toFixed(3)}, ${t[2].toFixed(3)}]`);

    // Debug: Test projection of the cuboid center to see coordinates
    if (selectedCuboid) {
      const testPx = selectedCuboid.center.x;
      const testPy = selectedCuboid.center.y;
      const testPz = selectedCuboid.center.z;
      const testCamX = R[0][0]*testPx + R[0][1]*testPy + R[0][2]*testPz + t[0];
      const testCamY = R[1][0]*testPx + R[1][1]*testPy + R[1][2]*testPz + t[1];
      const testCamZ = R[2][0]*testPx + R[2][1]*testPy + R[2][2]*testPz + t[2];

      // Also compute projected u, v for this camera
      let testU = 0, testV = 0, projType = '';
      // For fisheye, allow camZ down to -1.0 (up to ~100° off-axis)
      // For pinhole, require camZ > 0.1 (must be in front)
      const minCamZForProjection = useFisheye ? -1.0 : 0.1;
      if (testCamZ > minCamZForProjection) {
        if (useFisheye) {
          const r = Math.sqrt(testCamX * testCamX + testCamY * testCamY);
          const theta = Math.atan2(r, testCamZ);
          const k2 = distortion?.[0] ?? 0;
          const k3 = distortion?.[1] ?? 0;
          const k4 = distortion?.[2] ?? 0;
          const k5 = distortion?.[3] ?? 0;
          const theta2 = theta * theta;
          const theta_d = theta * (1 + k2*theta2 + k3*theta2*theta2 + k4*theta2*theta2*theta2 + k5*theta2*theta2*theta2*theta2);
          const scale = r > 1e-8 ? theta_d / r : 1;
          testU = fx * scale * testCamX + cx;
          testV = fy * scale * testCamY + cy;
          projType = 'fisheye';
        } else {
          testU = (fx * testCamX / testCamZ) + cx;
          testV = (fy * testCamY / testCamZ) + cy;
          projType = 'pinhole';
        }
      }
      const inBounds = testU >= 0 && testU <= imageWidth && testV >= 0 && testV <= imageHeight;
      console.log(`[FocusedCameraCard] ${cameraId} Cuboid center: LiDAR(${testPx.toFixed(2)}, ${testPy.toFixed(2)}, ${testPz.toFixed(2)}) -> Camera(${testCamX.toFixed(2)}, ${testCamY.toFixed(2)}, ${testCamZ.toFixed(2)}) -> Image(${testU.toFixed(0)}, ${testV.toFixed(0)}) [${projType}] ${testCamZ > minCamZForProjection ? (inBounds ? 'IN_BOUNDS' : 'OUT_OF_BOUNDS') : 'BEHIND'}`);
    }

    // Fisheye projection (Kannala-Brandt KB4 model)
    const projectFisheye = (camX: number, camY: number, camZ: number): { u: number; v: number } | null => {
      // After extrinsic inversion, no need to flip X
      const r = Math.sqrt(camX * camX + camY * camY);
      const theta = Math.atan2(r, camZ);

      if (theta > Math.PI * 0.9) return null;

      const k2 = distortion?.[0] ?? 0;
      const k3 = distortion?.[1] ?? 0;
      const k4 = distortion?.[2] ?? 0;
      const k5 = distortion?.[3] ?? 0;

      const theta2 = theta * theta;
      const theta4 = theta2 * theta2;
      const theta6 = theta4 * theta2;
      const theta8 = theta4 * theta4;
      const theta_d = theta * (1 + k2 * theta2 + k3 * theta4 + k4 * theta6 + k5 * theta8);

      if (r < 1e-8) {
        return { u: cx, v: cy };
      }
      const scale = theta_d / r;
      return {
        u: fx * scale * camX + cx,
        v: fy * scale * camY + cy
      };
    };

    // Project LiDAR point → canvas coords (with image bounds check)
    const project = (px: number, py: number, pz: number) => {
      const camX = R[0][0]*px + R[0][1]*py + R[0][2]*pz + t[0];
      const camY = R[1][0]*px + R[1][1]*py + R[1][2]*pz + t[1];
      const camZ = R[2][0]*px + R[2][1]*py + R[2][2]*pz + t[2];
      // For fisheye, allow wider angles (camZ can be down to -1.0 for ~100° off-axis)
      // For pinhole, require camZ > 0.1 (must be clearly in front)
      const minCamZ = useFisheye ? -1.0 : 0.1;
      if (camZ <= minCamZ) return null;

      let u: number, v: number;
      if (useFisheye) {
        const result = projectFisheye(camX, camY, camZ);
        if (!result) return null;
        u = result.u;
        v = result.v;
      } else {
        u = (fx * camX / camZ) + cx;
        v = (fy * camY / camZ) + cy;
      }

      // Bounds check: return null if projected point is outside image with margin
      const margin = 0.3; // 30% margin for fisheye where edges may be distorted
      const marginX = imageWidth * margin;
      const marginY = imageHeight * margin;
      if (u < -marginX || u > imageWidth + marginX || v < -marginY || v > imageHeight + marginY) {
        return null;
      }

      return {
        x: u * scaleX + oX,
        y: v * scaleY + oY,
      };
    };

    // Build 8 corners from cuboid data (skip if no cuboid selected)
    if (selectedCuboid) {
    const { center, dimensions, rotation } = selectedCuboid;
    const yaw = rotation?.yaw ?? 0;
    const hl = (dimensions?.length ?? 1) / 2;
    const hw = (dimensions?.width  ?? 1) / 2;
    const hh = (dimensions?.height ?? 1) / 2;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const local: [number, number, number][] = [
      [ hl,  hw, -hh], [ hl, -hw, -hh], [-hl, -hw, -hh], [-hl,  hw, -hh],
      [ hl,  hw,  hh], [ hl, -hw,  hh], [-hl, -hw,  hh], [-hl,  hw,  hh],
    ];
    const pts = local.map(([lx, ly, lz]) =>
      project(
        center.x + cos*lx - sin*ly,
        center.y + sin*lx + cos*ly,
        center.z + lz,
      )
    );

    const edges: [number, number][] = [
      [0,1],[1,2],[2,3],[3,0],
      [4,5],[5,6],[6,7],[7,4],
      [0,4],[1,5],[2,6],[3,7],
    ];

    ctx.strokeStyle = classColor;
    ctx.lineWidth   = 2;
    ctx.globalAlpha = 1.0;
    ctx.lineCap     = 'round';

    for (const [i, j] of edges) {
      const a = pts[i];
      const b = pts[j];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }

    // Fill front face (corners 0,1,5,4)
    const fc = [pts[0], pts[1], pts[5], pts[4]];
    if (fc.every(p => p !== null)) {
      ctx.fillStyle   = classColor;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.moveTo(fc[0]!.x, fc[0]!.y);
      fc.slice(1).forEach(p => ctx.lineTo(p!.x, p!.y));
      ctx.closePath();
      ctx.fill();
    }
    } // end if (selectedCuboid)

    // Draw the clicked LiDAR point colored by depth — matches point cloud rendering style
    if (clickedPoint) {
      const { x: px, y: py, z: pz } = clickedPoint;
      const camZ = R[2][0]*px + R[2][1]*py + R[2][2]*pz + t[2];
      const ptCanvas = project(px, py, pz);
      if (ptCanvas && camZ > 0) {
        const c = Math.max(0, Math.min(255, 255 * (1 - camZ / 50.0)));
        const pointColor = `rgb(${255 - c}, 0, ${c})`;
        ctx.save();
        ctx.globalAlpha = 1.0;
        ctx.fillStyle = pointColor;
        ctx.beginPath();
        ctx.arc(ptCanvas.x, ptCanvas.y, 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }, [selectedCuboid, cameraCalib, containerSize, classColor, stableImageSize, useFisheyeProjection, clipBox, _imgVersion, clickedPoint]);

  // Auto-zoom to clicked point
  useEffect(() => {
    if (!clickedPoint || !cameraCalib || !containerSize.width || !containerSize.height) {
      if (!clickedPoint) { setZoom(1); setPan({ x: 0, y: 0 }); }
      return;
    }
    const img = imgRef.current;
    const imageWidth  = (img && img.naturalWidth  > 0) ? img.naturalWidth  : stableImageSize.width;
    const imageHeight = (img && img.naturalHeight > 0) ? img.naturalHeight : stableImageSize.height;
    const cW = containerSize.width;
    const cH = containerSize.height;

    const containerAspect = cW / cH;
    const imageAspect = imageWidth / imageHeight;
    let displayWidth: number, displayHeight: number;
    if (containerAspect > imageAspect) {
      displayHeight = cH; displayWidth = cH * imageAspect;
    } else {
      displayWidth = cW; displayHeight = cW / imageAspect;
    }
    const oX = (cW - displayWidth)  / 2;
    const oY = (cH - displayHeight) / 2;
    const scaleX = displayWidth  / imageWidth;
    const scaleY = displayHeight / imageHeight;

    const { extrinsic, intrinsic } = cameraCalib;
    const { fx, fy, cx, cy, camera_model, distortion } = intrinsic;
    const R = extrinsic.rotation;
    const t = extrinsic.translation;
    const isAutoFisheye = distortion?.length === 4 && fx < imageWidth / 2;
    const useFisheye = useFisheyeProjection || camera_model === 'kannala_brandt' || isAutoFisheye;

    const { x: px, y: py, z: pz } = clickedPoint;
    const camX = R[0][0]*px + R[0][1]*py + R[0][2]*pz + t[0];
    const camY = R[1][0]*px + R[1][1]*py + R[1][2]*pz + t[1];
    const camZ = R[2][0]*px + R[2][1]*py + R[2][2]*pz + t[2];
    if (camZ <= (useFisheye ? -1.0 : 0.1)) return;

    let u: number, v: number;
    if (useFisheye) {
      const r = Math.sqrt(camX * camX + camY * camY);
      const theta = Math.atan2(r, camZ);
      if (theta > Math.PI * 0.9) return;
      const k2 = distortion?.[0] ?? 0, k3 = distortion?.[1] ?? 0;
      const k4 = distortion?.[2] ?? 0, k5 = distortion?.[3] ?? 0;
      const th2 = theta * theta;
      const theta_d = theta * (1 + k2*th2 + k3*th2*th2 + k4*th2*th2*th2 + k5*th2*th2*th2*th2);
      const scale = r > 1e-8 ? theta_d / r : 1;
      u = fx * scale * camX + cx;
      v = fy * scale * camY + cy;
    } else {
      u = fx * camX / camZ + cx;
      v = fy * camY / camZ + cy;
    }
    if (u < 0 || u > imageWidth || v < 0 || v > imageHeight) return;

    const canvasX = u * scaleX + oX;
    const canvasY = v * scaleY + oY;

    const targetZoom = 4;
    setZoom(targetZoom);
    setPan({ x: (cW / 2 - canvasX) * targetZoom, y: (cH / 2 - canvasY) * targetZoom });
  }, [clickedPoint, containerSize, cameraCalib, stableImageSize, useFisheyeProjection, _imgVersion]);

  // Wheel zoom handler
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const factor = e.deltaY > 0 ? -1 : 1;
    setZoom(prev => factor > 0 ? Math.min(prev * 1.15, 10) : Math.max(prev / 1.15, 1));
  }, []);

  // Pan handlers
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (zoom <= 1) return;
    e.preventDefault();
    e.stopPropagation();
    isDragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [zoom]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current) return;
    e.preventDefault();
    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    setPan(prev => ({ x: prev.x + dx, y: prev.y + dy }));
  }, []);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (isDragging.current) {
      isDragging.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  }, []);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const transformStyle = {
    transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
    transformOrigin: 'center center',
  };

  return (
    <div
      ref={containerRef}
      onClick={zoom <= 1 ? onClick : undefined}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onDoubleClick={handleDoubleClick}
      className="relative rounded-lg overflow-hidden border border-gray-600 hover:border-primary transition-all cursor-pointer group bg-black flex items-center justify-center"
      style={{ cursor: zoom > 1 ? 'grab' : 'pointer' }}
    >
      {imageUrl ? (
        <>
          <img
            ref={imgRef}
            src={imageUrl}
            alt={cameraId}
            className="max-w-full max-h-full object-contain"
            style={{ ...transformStyle, pointerEvents: 'none' }}
            draggable={false}
            onLoad={() => setImgVersion(v => v + 1)}
          />

          {/* Canvas overlay — drawn by the useEffect above */}
          <canvas
            ref={canvasRef}
            className="absolute inset-0 pointer-events-none"
            style={{ ...transformStyle, width: '100%', height: '100%' }}
          />

          <div className="absolute inset-0 bg-black/10 group-hover:bg-transparent transition-colors pointer-events-none" />
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent text-white text-[10px] px-2 py-1.5 pointer-events-none">
            {cameraId.replace(/_/g, ' ')}
          </div>
          <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-500 shadow pointer-events-none" />
          {zoom > 1 && (
            <div className="absolute top-1 left-1 px-1.5 py-0.5 bg-black/70 rounded text-white text-[9px] pointer-events-none">
              {Math.round(zoom * 100)}%
            </div>
          )}
        </>
      ) : (
        <div className="w-full h-full bg-dark flex flex-col items-center justify-center min-h-[60px]">
          <svg className="w-6 h-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          </svg>
          <span className="text-[10px] text-gray-400 mt-1 px-1 text-center">
            {cameraId.replace(/_/g, ' ')}
          </span>
        </div>
      )}
    </div>
  );
});

const FocusedCameraViews: React.FC<FocusedCameraViewsProps> = ({
  visibleCameras,
  selectedCuboid,
  classColor,
  panelHeight,
  onHeightChange,
  isFullWidth = false,
  orthoViewsWidth = 384,
  qaPanelOffset = 0,
  clickedPoint,
  onCameraClick,
}) => {
  const { scene, currentFrame } = useEditorStore();
  const getCachedImage = useImageCacheStore((s) => s.getCached);
  const [isResizing, setIsResizing] = useState(false);

  // Build image URL for a camera - check cache first for instant display
  // FocusedCameraCard needs full-res images so naturalWidth matches the calibration
  // intrinsic coordinate space. Thumbnails (width=600) cause projection misalignment.
  const getImageUrl = (cameraId: string): string | undefined => {
    if (!scene?.storage_paths?.cameras?.[cameraId] || !currentFrame?.file_paths?.cameras?.[cameraId]) {
      return undefined;
    }
    const basePath = scene.storage_paths.cameras[cameraId].replace(/\/$/, '');
    const filename = currentFrame.file_paths.cameras[cameraId];
    const fullPath = `${basePath}/${filename}`;

    // Check cache first for instant load (no network delay)
    const cached = getCachedImage(fullPath);
    if (cached) {
      return cached; // Return cached blob URL
    }

    // Fallback to API endpoint
    const token = useAuthStore.getState().accessToken;
    const baseUrl = `/api/v1/data/image/${basePath}/${filename}`;
    const params = new URLSearchParams();
    if (token) params.append('token', token);
    // No width restriction — full-res so naturalWidth matches calibration intrinsic space
    return `${baseUrl}?${params.toString()}`;
  };

  // Handle resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newHeight = window.innerHeight - e.clientY;
      onHeightChange(Math.max(120, Math.min(newHeight, 500)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, onHeightChange]);

  if (visibleCameras.length === 0) return null;

  // Calculate grid layout based on number of visible cameras
  const getGridClass = () => {
    if (isFullWidth) {
      // Full width mode - use more columns for all cameras
      if (visibleCameras.length <= 2) return 'grid-cols-2';
      if (visibleCameras.length <= 4) return 'grid-cols-4';
      return 'grid-cols-4';
    }
    if (visibleCameras.length === 1) return 'grid-cols-1';
    if (visibleCameras.length === 2) return 'grid-cols-2';
    if (visibleCameras.length <= 4) return 'grid-cols-2';
    return 'grid-cols-3';
  };

  // Calculate total right offset: ortho views + QA panel (if visible)
  const totalRightOffset = (isFullWidth ? 0 : orthoViewsWidth) + qaPanelOffset;

  return (
    <div
      className="absolute bottom-0 left-0 z-20 transition-all duration-300"
      style={{ height: panelHeight, right: totalRightOffset }}
    >
      <div className="h-full bg-dark-panel/95 backdrop-blur-sm border-t border-gray-700 relative">
        {/* Resize Handle */}
        <div
          className="absolute top-0 left-0 right-0 h-1.5 cursor-ns-resize hover:bg-primary/50 z-50 group"
          onMouseDown={(e) => {
            e.preventDefault();
            setIsResizing(true);
          }}
        >
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-12 h-1 rounded-full bg-gray-600 group-hover:bg-primary transition-colors" />
        </div>

        {/* Header */}
        <div className="h-8 bg-dark-panel border-b border-gray-700 flex items-center px-3 mt-1">
          <svg className="w-4 h-4 text-primary mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span className="text-xs font-medium text-white">
            {isFullWidth ? 'All Cameras' : 'Visible Cameras'} ({visibleCameras.length})
          </span>
          <span className="ml-2 text-[10px] text-gray-500">
            {isFullWidth ? 'Click a 3D box to see projected views' : 'Showing cameras where box is visible'}
          </span>
          <span className="ml-auto text-[10px] text-gray-500">Drag to resize</span>
        </div>

        {/* Camera grid - use flexbox for better aspect ratio handling */}
        <div className={`p-2 h-[calc(100%-2.5rem)] overflow-auto grid ${getGridClass()} gap-2`}>
          {visibleCameras.map((cameraId) => (
            <FocusedCameraCard
              key={cameraId}
              cameraId={cameraId}
              imageUrl={getImageUrl(cameraId)}
              selectedCuboid={selectedCuboid}
              classColor={classColor}
              onClick={() => onCameraClick ? onCameraClick(cameraId) : useEditorStore.getState().activateCameraView(cameraId)}
              clickedPoint={clickedPoint}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// CAMERA PANEL
// =============================================================================

const CameraPanel: React.FC<{ viewMode: ViewMode; taskId?: string }> = ({ viewMode, taskId }) => {
  const { scene, selectedCameraId, setSelectedCamera, currentFrame, frames, taxonomy } = useEditorStore();
  const getCachedImage = useImageCacheStore((s) => s.getCached);
  const [isExpanded, setIsExpanded] = useState(true); // Expanded by default
  const [height, setHeight] = useState(280); // Larger default height
  const [isResizing, setIsResizing] = useState(false);

  const cameras = scene?.storage_paths?.cameras
    ? Object.keys(scene.storage_paths.cameras)
    : ['front_camera', 'front_left_camera', 'front_right_camera', 'rear_camera'];

  // Handle resizing
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newHeight = window.innerHeight - e.clientY;
      setHeight(Math.max(100, Math.min(newHeight, 600)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing]);

  // Build image URL for the selected camera (check cache first, then fallback to API)
  // For thumbnails (isThumb=true), requests a resized version from API for faster initial load
  const getImageUrl = useCallback((cameraId: string, isThumb: boolean = false): string | undefined => {
    if (!scene?.storage_paths?.cameras?.[cameraId] || !currentFrame?.file_paths?.cameras?.[cameraId]) {
      return undefined;
    }
    const basePath = scene.storage_paths.cameras[cameraId].replace(/\/$/, '');
    const filename = currentFrame.file_paths.cameras[cameraId];
    const fullPath = `${basePath}/${filename}`;

    // Check cache first for instant load
    const cached = getCachedImage(fullPath);
    if (cached) {
      return cached; // Return blob URL (always full resolution)
    }

    // Fallback to API endpoint - use smaller size for thumbnails
    const token = useAuthStore.getState().accessToken;
    const baseUrl = `/api/v1/data/image/${basePath}/${filename}`;
    const params = new URLSearchParams();
    if (token) params.append('token', token);
    if (isThumb) params.append('width', '400'); // Thumbnail width for faster load
    return `${baseUrl}?${params.toString()}`;
  }, [scene?.storage_paths?.cameras, currentFrame?.file_paths?.cameras, getCachedImage]);

  // Build original API image URL (never returns cached blob URL)
  // Used for SAM2 embedding since backend can't fetch blob URLs
  const getOriginalImageUrl = useCallback((cameraId: string): string | undefined => {
    if (!scene?.storage_paths?.cameras?.[cameraId] || !currentFrame?.file_paths?.cameras?.[cameraId]) {
      return undefined;
    }
    const basePath = scene.storage_paths.cameras[cameraId].replace(/\/$/, '');
    const filename = currentFrame.file_paths.cameras[cameraId];

    // Always return API endpoint (never cached blob)
    const token = useAuthStore.getState().accessToken;
    const baseUrl = `/api/v1/data/image/${basePath}/${filename}`;
    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
  }, [scene?.storage_paths?.cameras, currentFrame?.file_paths?.cameras]);

  // Build image URL for any frame by frame ID (check cache first for preloading)
  const getFrameImageUrl = useCallback((frameId: string, cameraId: string): string | undefined => {
    if (!scene?.storage_paths?.cameras?.[cameraId]) {
      return undefined;
    }
    // Find the frame by ID
    const frame = frames.find(f => f.id === frameId);
    if (!frame?.file_paths?.cameras?.[cameraId]) {
      return undefined;
    }
    const basePath = scene.storage_paths.cameras[cameraId].replace(/\/$/, '');
    const filename = frame.file_paths.cameras[cameraId];
    const fullPath = `${basePath}/${filename}`;

    // Check cache first for instant load
    const cached = getCachedImage(fullPath);
    if (cached) {
      return cached; // Return blob URL
    }

    // Fallback to API endpoint
    const token = useAuthStore.getState().accessToken;
    const baseUrl = `/api/v1/data/image/${fullPath}`;
    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
  }, [scene?.storage_paths?.cameras, frames, getCachedImage]);

  // Build original API image URL for any frame (never returns cached blob URL)
  // Used for SAM2/video propagation since backend can't fetch blob URLs
  const getOriginalFrameImageUrl = useCallback((frameId: string, cameraId: string): string | undefined => {
    if (!scene?.storage_paths?.cameras?.[cameraId]) {
      return undefined;
    }
    const frame = frames.find(f => f.id === frameId);
    if (!frame?.file_paths?.cameras?.[cameraId]) {
      return undefined;
    }
    const basePath = scene.storage_paths.cameras[cameraId].replace(/\/$/, '');
    const filename = frame.file_paths.cameras[cameraId];
    const fullPath = `${basePath}/${filename}`;

    // Always return API endpoint (never cached blob)
    const token = useAuthStore.getState().accessToken;
    const baseUrl = `/api/v1/data/image/${fullPath}`;
    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
  }, [scene?.storage_paths?.cameras, frames]);

  // In fusion view, show camera selector differently
  if (viewMode === 'fusion') {
    return (
      <div className="absolute right-0 top-12 bottom-0 w-1/2 border-l border-gray-700 overflow-hidden">
        {/* Camera tabs */}
        <div className="absolute top-0 left-0 right-0 h-10 bg-dark-panel border-b border-gray-700 flex items-center px-2 gap-1 overflow-x-auto z-10">
          {cameras.map((camera) => (
            <button
              key={camera}
              onClick={() => setSelectedCamera(camera)}
              className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-colors ${
                selectedCameraId === camera
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:bg-dark-hover hover:text-white'
              }`}
            >
              {camera.replace(/_/g, ' ')}
            </button>
          ))}
        </div>

        {/* Image canvas */}
        <div className="absolute top-10 bottom-0 left-0 right-0">
          <ImageCanvas cameraId={selectedCameraId} imageUrl={getImageUrl(selectedCameraId)} />
        </div>
      </div>
    );
  }

  // In 2D view, show full screen camera view with CVAT-like annotation tools
  if (viewMode === '2d') {
    const frameId = currentFrame?.id || `frame-${currentFrame?.frame_index ?? 0}`;
    const frameIndex = currentFrame?.frame_index ?? 0;

    // Convert frames to the format expected by Image2DAnnotationView
    const frameInfos = frames.map(f => ({
      id: f.id,
      frame_index: f.frame_index,
    }));

    return (
      <div className="absolute inset-0 top-12 bg-black z-10">
        <Image2DAnnotationView
          cameras={cameras}
          getImageUrl={getImageUrl}
          getOriginalImageUrl={getOriginalImageUrl}
          getFrameImageUrl={getFrameImageUrl}
          getOriginalFrameImageUrl={getOriginalFrameImageUrl}
          frameId={frameId}
          frameIndex={frameIndex}
          frames={frameInfos}
          taskId={taskId}
          taxonomy={taxonomy ? {
            classes: taxonomy.classes.map(c => ({
              id: c.id,
              name: c.name,
              color: c.color,
              attributes: c.attributes,
            })),
            shared_attributes: taxonomy.shared_attributes,
          } : undefined}
        />
      </div>
    );
  }

  // In 3D view, show collapsible camera thumbnails
  return (
    <>
      {/* Toggle button - Floating Capsule Style */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`fixed left-4 z-30 px-4 py-2.5 bg-gray-900/40 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl text-white/80 hover:text-white hover:bg-gray-900/60 hover:border-white/20 transition-all duration-300 flex items-center gap-2`}
        style={{ bottom: isExpanded ? height + 16 : 32 }}
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
        </svg>
        <span className="text-xs font-medium">Cameras</span>
        <svg
          className={`w-3 h-3 transition-transform duration-300 ${isExpanded ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
        </svg>
      </button>

      <div
        className={`absolute left-0 right-0 bottom-0 z-20 transition-all duration-300`}
        style={{ height: isExpanded ? height : 0 }}
      >
        {isExpanded && (
          <div className="h-full bg-dark-panel/95 backdrop-blur-sm border-t border-gray-700 relative">
            {/* Resize Handle */}
            <div
              className="absolute top-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-primary/50 z-50"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsResizing(true);
              }}
            />

            <div className="flex items-center gap-3 h-full px-4 overflow-x-auto pt-2 pb-2">
              {cameras.map((camera) => (
                <CameraThumbnail
                  key={`${camera}-${currentFrame?.id}`}
                  camera={camera}
                  imageUrl={getImageUrl(camera, true)}
                  isSelected={selectedCameraId === camera}
                  onClick={() => {
                    // Activate camera view mode - moves 3D camera to match and shows image plane
                    useEditorStore.getState().activateCameraView(camera);
                  }}
                  onDoubleClick={() => {
                    // Double-click to deactivate camera view and return to normal 3D view
                    useEditorStore.getState().deactivateCameraView();
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

// =============================================================================
// FUSION LABELING VIEW
// =============================================================================

interface FusionLabelingViewProps {
  showOrthoViews?: boolean;
  orthoViewsWidth?: number;
  cameraPanelHeight?: number;
  qaPanelOffset?: number;
}

const FusionLabelingView: React.FC<FusionLabelingViewProps> = ({ showOrthoViews = false, orthoViewsWidth = 480, cameraPanelHeight = 0, qaPanelOffset = 0 }) => {
  const {
    scene,
    currentFrame,
    taxonomy,
    selection,
    selectAnnotation,
  } = useEditorStore();
  const getCachedImage = useImageCacheStore((s) => s.getCached);

  // Use the shared fusion labels hook
  const { cameras, lidarToCameras, cuboidAnnotations, camerasWithLabels } = useFusionLabels();

  // State for manual adjustments (Map<labelKey, BBox2D>)
  const [manualAdjustments, setManualAdjustments] = useState<Map<string, BBox2D>>(new Map());

  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_editingLabel, setEditingLabel] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{
    labelKey: string;
    startX: number;
    startY: number;
    startBbox: BBox2D;
    mode: 'move' | 'resize-br' | 'resize-tl' | 'resize-tr' | 'resize-bl';
  } | null>(null);

  // Container and image refs for proper overlay positioning
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number }>({ width: 1600, height: 900 });
  const [imageDisplayBounds, setImageDisplayBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Use a stable reference for image size to avoid triggering re-renders
  const imageSizeRef = useRef({ width: 1600, height: 900 });

  // Use the natural size for rendering (this is what the SVG viewBox should use)
  const imageSize = imageNaturalSize;

  // Track if first camera has been auto-selected
  const hasAutoSelectedRef = useRef(false);

  // Update the ref when natural size changes (no state update, just ref)
  useEffect(() => {
    imageSizeRef.current = imageNaturalSize;
  }, [imageNaturalSize]);

  // Compute fusion labels from 3D annotations using useMemo
  const computedFusionLabels = useMemo(() => {
    if (!cuboidAnnotations.length || !Object.keys(lidarToCameras).length) {
      return new Map<string, FusionLabel[]>();
    }

    const newLabels = new Map<string, FusionLabel[]>();
    const imageSize = imageSizeRef.current;

    for (const ann of cuboidAnnotations) {
      const cuboidData = ann.data as CuboidData;
      const projections = projectCuboidToAllCameras(cuboidData, lidarToCameras, imageSize);

      for (const [cameraId, bbox] of Object.entries(projections)) {
        const labelKey = `${ann.id}-${cameraId}`;

        // Check if we have a manual adjustment
        const manualBbox = manualAdjustments.get(labelKey);

        const fusionLabel: FusionLabel = {
          annotationId: ann.id,
          cameraId,
          bbox: manualBbox || bbox,
          classId: ann.class_id,
          trackId: ann.track_id,
          isManuallyAdjusted: !!manualBbox,
        };

        if (!newLabels.has(ann.id)) {
          newLabels.set(ann.id, []);
        }
        newLabels.get(ann.id)!.push(fusionLabel);
      }
    }

    return newLabels;
  }, [cuboidAnnotations, lidarToCameras, manualAdjustments]);

  // Auto-select first camera with visible labels (only once)
  useEffect(() => {
    if (!selectedCameraId && !hasAutoSelectedRef.current && computedFusionLabels.size > 0) {
      const firstLabels = Array.from(computedFusionLabels.values())[0];
      if (firstLabels && firstLabels.length > 0) {
        setSelectedCameraId(firstLabels[0].cameraId);
        hasAutoSelectedRef.current = true;
      }
    }
  }, [computedFusionLabels, selectedCameraId]);

  // Get labels for selected camera
  const labelsForCamera = useMemo(() => {
    if (!selectedCameraId) return [];
    const labels: FusionLabel[] = [];
    computedFusionLabels.forEach((annLabels) => {
      const label = annLabels.find(l => l.cameraId === selectedCameraId);
      if (label) labels.push(label);
    });
    return labels;
  }, [computedFusionLabels, selectedCameraId]);

  // Build image URL - check cache first for instant display
  const getImageUrl = (cameraId: string): string | undefined => {
    if (!scene?.storage_paths?.cameras?.[cameraId] || !currentFrame?.file_paths?.cameras?.[cameraId]) {
      return undefined;
    }
    const basePath = scene.storage_paths.cameras[cameraId].replace(/\/$/, '');
    const filename = currentFrame.file_paths.cameras[cameraId];
    const fullPath = `${basePath}/${filename}`;

    // Check cache first for instant load
    const cached = getCachedImage(fullPath);
    if (cached) {
      return cached;
    }

    // Fallback to API
    const token = useAuthStore.getState().accessToken;
    const baseUrl = `/api/v1/data/image/${basePath}/${filename}`;
    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
  };

  // Compute image display bounds when container or image changes
  const updateImageDisplayBounds = useCallback(() => {
    if (!containerRef.current || !imageRef.current) return;

    const container = containerRef.current.getBoundingClientRect();
    const img = imageRef.current;

    if (!img.naturalWidth || !img.naturalHeight) return;

    // Compute how object-contain positions the image
    const containerAspect = container.width / container.height;
    const imageAspect = img.naturalWidth / img.naturalHeight;

    let displayWidth: number, displayHeight: number;
    let offsetX: number, offsetY: number;

    if (imageAspect > containerAspect) {
      // Image is wider - fits to width
      displayWidth = container.width;
      displayHeight = container.width / imageAspect;
      offsetX = 0;
      offsetY = (container.height - displayHeight) / 2;
    } else {
      // Image is taller - fits to height
      displayHeight = container.height;
      displayWidth = container.height * imageAspect;
      offsetX = (container.width - displayWidth) / 2;
      offsetY = 0;
    }

    setImageDisplayBounds({
      x: offsetX,
      y: offsetY,
      width: displayWidth,
      height: displayHeight,
    });
  }, []);

  // Handle image load
  const handleImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    updateImageDisplayBounds();
  }, [updateImageDisplayBounds]);

  // Update bounds on resize (window or container)
  useEffect(() => {
    const handleResize = () => updateImageDisplayBounds();
    window.addEventListener('resize', handleResize);

    // Also observe container resize (e.g. when ortho views toggle)
    let resizeObserver: ResizeObserver | null = null;
    if (containerRef.current) {
      resizeObserver = new ResizeObserver(() => {
        updateImageDisplayBounds();
      });
      resizeObserver.observe(containerRef.current);
    }

    return () => {
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        resizeObserver.disconnect();
      }
    };
  }, [updateImageDisplayBounds]);

  // Update bounds when image changes
  useEffect(() => {
    updateImageDisplayBounds();
  }, [selectedCameraId, currentFrame, updateImageDisplayBounds]);

  // Handle label drag/resize
  const handleLabelMouseDown = (e: React.MouseEvent, label: FusionLabel, mode: 'move' | 'resize-br' | 'resize-tl' | 'resize-tr' | 'resize-bl') => {
    e.stopPropagation();
    e.preventDefault();
    const labelKey = `${label.annotationId}-${label.cameraId}`;
    setDragState({
      labelKey,
      startX: e.clientX,
      startY: e.clientY,
      startBbox: { ...label.bbox },
      mode,
    });
    setEditingLabel(labelKey);
    selectAnnotation(label.annotationId);
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!dragState || !imageDisplayBounds) return;

    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;

    // Scale factor for image display based on actual rendered size
    const scaleX = imageSize.width / imageDisplayBounds.width;
    const scaleY = imageSize.height / imageDisplayBounds.height;

    const scaledDx = dx * scaleX;
    const scaledDy = dy * scaleY;

    let newBbox: BBox2D;

    if (dragState.mode === 'move') {
      newBbox = {
        x: Math.max(0, dragState.startBbox.x + scaledDx),
        y: Math.max(0, dragState.startBbox.y + scaledDy),
        width: dragState.startBbox.width,
        height: dragState.startBbox.height,
      };
    } else {
      // Resize modes
      const { x, y, width, height } = dragState.startBbox;
      switch (dragState.mode) {
        case 'resize-br':
          newBbox = {
            x, y,
            width: Math.max(20, width + scaledDx),
            height: Math.max(20, height + scaledDy),
          };
          break;
        case 'resize-tl':
          newBbox = {
            x: x + scaledDx,
            y: y + scaledDy,
            width: Math.max(20, width - scaledDx),
            height: Math.max(20, height - scaledDy),
          };
          break;
        case 'resize-tr':
          newBbox = {
            x, y: y + scaledDy,
            width: Math.max(20, width + scaledDx),
            height: Math.max(20, height - scaledDy),
          };
          break;
        case 'resize-bl':
          newBbox = {
            x: x + scaledDx, y,
            width: Math.max(20, width - scaledDx),
            height: Math.max(20, height + scaledDy),
          };
          break;
        default:
          newBbox = dragState.startBbox;
      }
    }

    // Update manual adjustments state
    setManualAdjustments(prev => {
      const next = new Map(prev);
      next.set(dragState.labelKey, newBbox);
      return next;
    });
  };

  const handleMouseUp = () => {
    setDragState(null);
  };

  // Get class color
  const getClassColor = (classId: string): string => {
    const classDef = taxonomy?.classes?.find(c => c.id === classId);
    return classDef?.color || '#00ff00';
  };

  // Calculate right offset and width based on ortho views visibility and dynamic width
  const totalRightOffset = (showOrthoViews ? orthoViewsWidth : 0) + qaPanelOffset;
  const rightOffset = `${totalRightOffset}px`;
  const panelWidth = showOrthoViews ? `calc(50% - ${orthoViewsWidth / 2}px)` : '50%';
  const bottomOffset = cameraPanelHeight > 0 ? `${cameraPanelHeight}px` : '0';

  if (cameras.length === 0) {
    return (
      <div
        className="absolute top-12 bg-dark-panel flex items-center justify-center text-gray-500 transition-all duration-300"
        style={{ width: panelWidth, right: rightOffset, bottom: bottomOffset }}
      >
        No cameras available
      </div>
    );
  }

  return (
    <div
      className="absolute top-12 border-l border-gray-700 flex flex-col bg-dark-panel transition-all duration-300"
      style={{ width: panelWidth, right: rightOffset, bottom: bottomOffset }}
    >
      {/* Camera Tabs */}
      <div className="h-10 bg-dark-panel border-b border-gray-700 flex items-center px-2 gap-1 overflow-x-auto flex-shrink-0">
        {cameras.map((camera) => {
          const hasLabels = camerasWithLabels.includes(camera);
          return (
            <button
              key={camera}
              onClick={() => setSelectedCameraId(camera)}
              className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                selectedCameraId === camera
                  ? 'bg-primary text-white'
                  : hasLabels
                    ? 'text-green-400 hover:bg-dark-hover hover:text-green-300 border border-green-500/30'
                    : 'text-gray-400 hover:bg-dark-hover hover:text-white'
              }`}
            >
              {hasLabels && (
                <span className="w-2 h-2 bg-green-400 rounded-full" />
              )}
              {camera.replace(/_/g, ' ')}
            </button>
          );
        })}
      </div>

      {/* Image with Labels */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden bg-black flex items-center justify-center"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        {selectedCameraId && getImageUrl(selectedCameraId) && (
          <>
            <img
              ref={imageRef}
              src={getImageUrl(selectedCameraId)}
              alt={selectedCameraId}
              className="w-full h-full object-contain"
              draggable={false}
              onLoad={handleImageLoad}
            />

            {/* Overlay for labels - positioned exactly over the image */}
            {imageDisplayBounds && (
              <svg
                className="absolute pointer-events-none"
                style={{
                  left: imageDisplayBounds.x,
                  top: imageDisplayBounds.y,
                  width: imageDisplayBounds.width,
                  height: imageDisplayBounds.height,
                }}
                viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
                preserveAspectRatio="none"
              >
              {labelsForCamera.map((label) => {
                const isSelected = selection.selectedAnnotationIds.includes(label.annotationId);
                const color = getClassColor(label.classId);
                const { x, y, width, height } = label.bbox;

                return (
                  <g key={`${label.annotationId}-${label.cameraId}`} className="pointer-events-auto">
                    {/* Main bounding box */}
                    <rect
                      x={x}
                      y={y}
                      width={width}
                      height={height}
                      fill="transparent"
                      stroke={color}
                      strokeWidth={isSelected ? 3 : 2}
                      strokeDasharray={label.isManuallyAdjusted ? "none" : "5,5"}
                      className="cursor-move"
                      onMouseDown={(e) => handleLabelMouseDown(e as any, label, 'move')}
                    />

                    {/* Label tag */}
                    <rect
                      x={x}
                      y={y - 24}
                      width={Math.max(80, label.classId.length * 8 + (label.trackId ? 50 : 0))}
                      height={22}
                      fill={color}
                      rx={2}
                    />
                    <text
                      x={x + 4}
                      y={y - 8}
                      fill="white"
                      fontSize={12}
                      fontFamily="monospace"
                    >
                      {label.classId}{label.trackId ? ` | ${label.trackId}` : ''}
                    </text>

                    {/* Resize handles (only when selected) */}
                    {isSelected && (
                      <>
                        {/* Corner handles */}
                        <rect x={x - 4} y={y - 4} width={8} height={8} fill={color}
                          className="cursor-nwse-resize"
                          onMouseDown={(e) => handleLabelMouseDown(e as any, label, 'resize-tl')}
                        />
                        <rect x={x + width - 4} y={y - 4} width={8} height={8} fill={color}
                          className="cursor-nesw-resize"
                          onMouseDown={(e) => handleLabelMouseDown(e as any, label, 'resize-tr')}
                        />
                        <rect x={x - 4} y={y + height - 4} width={8} height={8} fill={color}
                          className="cursor-nesw-resize"
                          onMouseDown={(e) => handleLabelMouseDown(e as any, label, 'resize-bl')}
                        />
                        <rect x={x + width - 4} y={y + height - 4} width={8} height={8} fill={color}
                          className="cursor-nwse-resize"
                          onMouseDown={(e) => handleLabelMouseDown(e as any, label, 'resize-br')}
                        />
                      </>
                    )}

                    {/* Manual adjustment indicator */}
                    {label.isManuallyAdjusted && (
                      <circle
                        cx={x + width - 8}
                        cy={y + 8}
                        r={6}
                        fill="#f59e0b"
                        stroke="white"
                        strokeWidth={1}
                      />
                    )}
                  </g>
                );
              })}
              </svg>
            )}
          </>
        )}

        {/* No image placeholder */}
        {selectedCameraId && !getImageUrl(selectedCameraId) && (
          <div className="flex items-center justify-center h-full text-gray-500">
            No image available for {selectedCameraId}
          </div>
        )}

        {!selectedCameraId && (
          <div className="flex items-center justify-center h-full text-gray-500">
            Select a camera to view fusion labels
          </div>
        )}
      </div>

      {/* Info bar */}
      <div className="h-8 bg-dark-panel border-t border-gray-700 flex items-center justify-between px-3 text-xs text-gray-400 flex-shrink-0">
        <span>
          {labelsForCamera.length} label{labelsForCamera.length !== 1 ? 's' : ''} in view
        </span>
        <span>
          {camerasWithLabels.length} camera{camerasWithLabels.length !== 1 ? 's' : ''} with labels
        </span>
      </div>
    </div>
  );
};

// =============================================================================
// LABEL LIST PANEL
// =============================================================================

const _LabelListPanel: React.FC<{ viewMode: ViewMode }> = ({ viewMode }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showKeyframesOnly, setShowKeyframesOnly] = useState(false);
  const [showInterpolatedOnly, setShowInterpolatedOnly] = useState(false);
  const [show2DLabels, setShow2DLabels] = useState(true);
  const [expandedCameras, setExpandedCameras] = useState<Set<string>>(new Set());
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedPropertiesId, setExpandedPropertiesId] = useState<string | null>(null);
  const [editingTrackId, setEditingTrackId] = useState<string | null>(null);
  const [newTrackIdValue, setNewTrackIdValue] = useState('');
  const annotationRefs = React.useRef<Map<string, HTMLDivElement>>(new Map());
  // Load annotations from appropriate store based on view mode
  const allAnnotations3D = useCurrentFrameAnnotations();
  const annotations4DMap = useAnnotation4DStore((s) => s.annotations4D);
  const annotations4DArray = React.useMemo(() =>
    Array.from(annotations4DMap.values()).filter(ann => !ann.is_deleted),
    [annotations4DMap]
  );

  // Use 4D annotations in 4D mode, otherwise use regular 3D annotations
  const allAnnotations = viewMode === '4d' ? annotations4DArray : allAnnotations3D;

  const { task: labelListTask, selection, selectAnnotation, updateAnnotation: updateAnnotationDirect, deleteAnnotation, taxonomy, annotations: allAnnotationsMap, setSuppressPropertiesPanel, currentFrame } = useEditorStore();
  const { taskId: labelListTaskId } = useParams<{ taskId: string }>();
  const { tracks, createTrack, addAnnotationToTrack, interpolateTrack, mergeTracks, propagateTrack } = useTrackStore();

  const labelListQueryClient = useQueryClient();
  const { setAnnotations: labelListSetAnnotations, setTask: labelListSetTask, scene: labelListScene } = useEditorStore();
  const { clearAnnotations4D: labelListClearAnnotations4D } = useAnnotation4DStore();

  const handleDeleteAll = async () => {
    if (!labelListTask?.id || !labelListTaskId) return;
    setIsDeletingAll(true);
    try {
      await Promise.all([
        annotation2DApi.deleteByTask(labelListTask.id).catch(() => null),
        (async () => {
          const ann3d = await annotation3DApi.list(labelListTask.id).catch(() => []);
          if (ann3d.length > 0) {
            await annotation3DApi.deleteBulk(ann3d.map((a: { id: string }) => a.id)).catch(() => null);
          }
        })(),
        (async () => {
          let allLegacy: any[] = [];
          let page = 1;
          let hasMore = true;
          while (hasMore) {
            const legacy = await annotationApi.list({ taskId: labelListTask.id, pageSize: 1000, page }).catch(() => []);
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
        // Delete 4D annotations from database
        (async () => {
          const ann4d = await annotation4DApi.list(labelListTask.id).catch(() => []);
          if (ann4d.length > 0) {
            await annotation4DApi.deleteBulk(ann4d.map((a: { id: string }) => a.id)).catch(() => null);
          }
        })(),
      ]);

      // Clear frontend state
      labelListSetAnnotations([]);
      useTrackStore.setState({ tracks: new Map() });
      useAnnotation2DStore.getState().clearAnnotations();
      labelListClearAnnotations4D();

      // Remove React Query caches
      labelListQueryClient.removeQueries({ queryKey: ['annotations', labelListTask.id] });
      labelListQueryClient.removeQueries({ queryKey: ['all-3d-annotations', labelListTask.id] });
      labelListQueryClient.removeQueries({ queryKey: ['annotations-4d', labelListTask.id] });

      // Always reset task back to annotation stage and clear all revision/QA data.
      try {
        // Get current taxonomy ID for per-taxonomy reset
        const currentTaxonomyId = labelListScene?.selected_taxonomy_id;

        // Reset per-taxonomy workflow if a taxonomy is selected
        if (currentTaxonomyId) {
          await workflowApi.setStage(labelListTask.id, 'annotation', currentTaxonomyId, true);
        }

        // Also reset global task
        const updatedTask = await taskApi.update(labelListTask.id, { stage: 'annotation', revision_count: 0 } as any);
        labelListSetTask(updatedTask);

        // Invalidate all relevant caches
        labelListQueryClient.invalidateQueries({ queryKey: ['task', labelListTask.id] });
        labelListQueryClient.invalidateQueries({ queryKey: ['tasks'] });
        labelListQueryClient.invalidateQueries({ queryKey: ['my-tasks'] });
        labelListQueryClient.invalidateQueries({ queryKey: ['dataset-tasks'] });
        // Invalidate per-taxonomy workflow info cache
        labelListQueryClient.invalidateQueries({ queryKey: ['workflow-info', labelListTask.id] });
        labelListQueryClient.invalidateQueries({ queryKey: ['workflow-info-2d', labelListTask.id] });
        // Optimistically patch the task in the dataset-detail cache so the R badge
        // disappears immediately when the user navigates back (no stale-data flash).
        const taskIdStr = String(labelListTask.id);
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
        if (labelListScene?.dataset_id) {
          labelListQueryClient.setQueryData(['dataset-detail', labelListScene.dataset_id], patchTaskInDetail);
        } else {
          // Fallback: patch all dataset-detail caches
          labelListQueryClient.getQueriesData<any>({ predicate: (q) => q.queryKey[0] === 'dataset-detail' })
            .forEach(([key]) => labelListQueryClient.setQueryData(key, patchTaskInDetail));
        }
        labelListQueryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'dataset-detail' });
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

  // For LabelListPanel, use the direct updateAnnotation since the main PropertiesPanel handles confirmation
  // This panel is for quick overview, not detailed editing
  const updateAnnotation = updateAnnotationDirect;

  const [mergeMode, setMergeMode] = useState<{ active: boolean; sourceTrackId: string | null }>({
    active: false,
    sourceTrackId: null
  });

  // Propagate track state
  const [showPropagateInput, setShowPropagateInput] = useState(false);
  const [propagateFrames, setPropagateFrames] = useState(10);
  const [propagateDirection, setPropagateDirection] = useState<'forward' | 'backward' | 'both'>('forward');

  // Get existing tracks for dropdown
  const existingTracks = React.useMemo(() => Array.from(tracks.values()), [tracks]);

  // Get selected annotation ID
  const selectedAnnotationId = selection.selectedAnnotationIds?.[0] || null;

  // Sync suppress flag with panel open state - use useLayoutEffect to set before render
  // This ensures the floating panel never shows when burger menu is open
  React.useLayoutEffect(() => {
    setSuppressPropertiesPanel(isOpen);
  }, [isOpen, setSuppressPropertiesPanel]);

  // Also subscribe to selection changes and set suppress flag synchronously
  React.useLayoutEffect(() => {
    if (isOpen) {
      // Make absolutely sure suppress is set when panel is open
      setSuppressPropertiesPanel(true);
    }
  }, [isOpen, selectedAnnotationId, setSuppressPropertiesPanel]);

  // Auto-expand and scroll to selected annotation when selection changes (from any source like 3D canvas)
  React.useEffect(() => {
    if (isOpen && selectedAnnotationId) {
      // Auto-expand the properties for the selected annotation
      setExpandedPropertiesId(selectedAnnotationId);

      // Scroll to the annotation in the list after a small delay to allow render
      setTimeout(() => {
        const ref = annotationRefs.current.get(selectedAnnotationId);
        if (ref) {
          ref.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }
  }, [isOpen, selectedAnnotationId]);

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

  // Filter annotations based on toggle state
  const annotations = React.useMemo((): (Annotation | LocalAnnotation4D)[] => {
    if (viewMode === '4d') {
      // In 4D mode, use 4D annotations (which don't have is_keyframe or source fields)
      // Just filter by type
      return allAnnotations.filter(ann => ann.type === 'cuboid') as LocalAnnotation4D[];
    }

    // In non-4D modes, use regular annotations with full filtering
    let filtered = allAnnotations as Annotation[];

    // In 3D/fusion view, only show cuboid (3D) annotations
    if (viewMode === '3d' || viewMode === 'fusion') {
      filtered = filtered.filter(ann => ann.type === 'cuboid');
    }

    if (showKeyframesOnly) {
      filtered = filtered.filter(ann => 'is_keyframe' in ann && ann.is_keyframe === true);
    }
    if (showInterpolatedOnly) {
      filtered = filtered.filter(ann => 'source' in ann && ann.source === 'auto_interpolated');
    }

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(ann => {
        const classId = ann.class_id?.toLowerCase() || '';
        const className = taxonomy?.classes?.find(c => c.id === ann.class_id)?.name?.toLowerCase() || '';
        const trackId = ann.track_id?.toLowerCase() || '';
        const annId = ann.id.toLowerCase();
        return classId.includes(query) || className.includes(query) || trackId.includes(query) || annId.includes(query);
      });
    }

    return filtered;
  }, [allAnnotations, viewMode, showKeyframesOnly, showInterpolatedOnly]);

  // Group by class
  const groupedAnnotations = React.useMemo(() => {
    const groups: Record<string, typeof annotations> = {};
    annotations.forEach(ann => {
      if (!groups[ann.class_id]) groups[ann.class_id] = [];
      groups[ann.class_id].push(ann);
    });
    return groups;
  }, [annotations]);

  // Count total 2D labels
  const total2DLabels = React.useMemo(() => {
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

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
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
                <div className="absolute right-0 mt-1 w-52 bg-dark-panel border border-gray-700 rounded-lg shadow-xl z-[60] py-1">
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

        {/* Search Bar */}
        <div className="px-4 py-2 border-b border-gray-700/50">
          <div className="relative">
            <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search annotations..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-8 py-1.5 bg-gray-800/50 border border-gray-600/50 rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:border-primary/50 focus:bg-gray-800"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar">
          {Object.entries(groupedAnnotations).map(([classId, items]) => {
            const className = taxonomy?.classes?.find(c => c.id === classId)?.name || classId;
            const classColor = getClassColor(classId);

            return (
              <div key={classId} className="bg-dark/30 rounded-lg overflow-hidden">
                {/* Class Header */}
                <div className="px-3 py-2 flex items-center gap-2 border-b border-gray-700/30 bg-dark/50">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: classColor }} />
                  <span className="text-sm font-medium text-white">{className}</span>
                  <span className="ml-auto text-xs text-gray-500 bg-dark/50 px-2 py-0.5 rounded">{items.length}</span>
                </div>

                {/* Annotation Items */}
                <div className="divide-y divide-gray-700/20">
                  {items.map(ann => {
                    const isSelected = (selection.selectedAnnotationIds || []).includes(ann.id);
                    const hasTrack = !!ann.track_id;
                    const isKeyframe = viewMode !== '4d' && 'is_keyframe' in ann && ann.is_keyframe === true;
                    const isInterpolated = viewMode !== '4d' && 'source' in ann && ann.source === 'auto_interpolated';
                    const isMergeSource = mergeMode.sourceTrackId === ann.track_id;

                    // Get position/dimensions
                    const annData = ann as any;
                    const centerData = annData.data?.center || annData.world_data?.center;
                    const dimensionsData = annData.data?.dimensions || annData.world_data?.dimensions;
                    const rotationData = annData.data?.rotation || annData.world_data?.rotation;
                    const isExpanded = expandedPropertiesId === ann.id;

                    return (
                      <div
                        key={ann.id}
                        ref={(el) => {
                          if (el) annotationRefs.current.set(ann.id, el);
                          else annotationRefs.current.delete(ann.id);
                        }}
                        onClick={(e) => {
                          if (mergeMode.active && ann.track_id) {
                            handleTrackClick(ann.track_id);
                          } else {
                            toggleSelection(ann.id, e.metaKey || e.ctrlKey);
                            // Auto-expand inline properties when clicking
                            setExpandedPropertiesId(ann.id);
                          }
                        }}
                        className={`group px-3 py-2 cursor-pointer transition-all ${
                          isMergeSource
                            ? 'bg-orange-500/20'
                            : isSelected
                              ? 'bg-primary/20'
                              : 'hover:bg-white/5'
                        }`}
                      >
                        {/* Main Row */}
                        <div className="flex items-center gap-2">
                          {/* Selection indicator */}
                          <div className={`w-1.5 h-8 rounded-full transition-colors ${
                            isSelected ? 'bg-primary' : 'bg-transparent group-hover:bg-gray-600'
                          }`} />

                          {/* Content */}
                          <div className="flex-1 min-w-0">
                            {/* Track ID or Short ID */}
                            <div className="flex items-center gap-2">
                              {hasTrack ? (
                                <span className="text-xs font-mono text-purple-400 truncate">
                                  {ann.track_id?.slice(0, 8)}
                                </span>
                              ) : (
                                <span className="text-xs font-mono text-gray-500">
                                  {ann.id.slice(0, 8)}
                                </span>
                              )}

                              {/* Badges */}
                              <div className="flex items-center gap-1">
                                {hasTrack && (
                                  <span className="px-1.5 py-0.5 text-[10px] bg-purple-500/20 text-purple-300 rounded">
                                    Track
                                  </span>
                                )}
                                {isKeyframe && (
                                  <span className="px-1.5 py-0.5 text-[10px] bg-yellow-500/20 text-yellow-300 rounded">
                                    Key
                                  </span>
                                )}
                                {isInterpolated && (
                                  <span className="px-1.5 py-0.5 text-[10px] bg-blue-500/20 text-blue-300 rounded">
                                    Interp
                                  </span>
                                )}
                                {ann.is_static && (
                                  <span className="px-1.5 py-0.5 text-[10px] bg-gray-500/20 text-gray-300 rounded">
                                    Static
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* Position */}
                            {centerData && (
                              <div className="text-[11px] font-mono text-gray-500 mt-0.5">
                                x:{centerData.x?.toFixed(1)} y:{centerData.y?.toFixed(1)} z:{centerData.z?.toFixed(1)}
                              </div>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setExpandedPropertiesId(isExpanded ? null : ann.id);
                              }}
                              className={`p-1.5 rounded ${isExpanded ? 'bg-blue-500/30 text-blue-400' : 'hover:bg-blue-500/30 text-gray-400 hover:text-blue-400'}`}
                              title={isExpanded ? "Collapse Properties" : "Edit Properties"}
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                if (confirm('Delete this annotation?')) deleteAnnotation(ann.id);
                              }}
                              className="p-1.5 rounded hover:bg-red-500/30 text-gray-400 hover:text-red-400"
                              title="Delete"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Inline Properties Editor */}
                        {isExpanded && (
                          <div className="mt-2 p-3 bg-dark/50 rounded-lg border border-gray-600/50 space-y-3" onClick={(e) => e.stopPropagation()}>
                            {/* Header */}
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-gray-300">Edit Properties</span>
                              <button
                                onClick={() => setExpandedPropertiesId(null)}
                                className="p-1 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </button>
                            </div>

                            {/* UUID (Read-only with copy) */}
                            <div>
                              <label className="text-[10px] text-gray-500 mb-1 block">Annotation UUID</label>
                              <div className="flex items-center gap-1">
                                <input type="text" readOnly value={ann.id}
                                  className="flex-1 bg-dark border border-gray-600 rounded px-2 py-1.5 text-gray-400 text-[10px] font-mono focus:outline-none" />
                                <button
                                  onClick={() => { navigator.clipboard.writeText(ann.id); }}
                                  className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-400 hover:text-white"
                                  title="Copy UUID"
                                >
                                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                  </svg>
                                </button>
                              </div>
                            </div>

                            {/* Class Selector - Uses taxonomy from editor store */}
                            <div>
                              <label className="text-[10px] text-gray-500 mb-1 block">Class</label>
                              {(() => {
                                // Check if current class_id exists in taxonomy
                                const currentClassInTaxonomy = taxonomy?.classes?.find(c => c.id === ann.class_id);
                                const isUnknownClass = !currentClassInTaxonomy && ann.class_id;

                                return (
                                  <>
                                    {isUnknownClass && (
                                      <div className="mb-1.5 px-2 py-1 bg-orange-500/20 border border-orange-500/30 rounded text-[10px] text-orange-300">
                                        ⚠️ Class "{ann.class_id}" not in taxonomy
                                      </div>
                                    )}
                                    <select
                                      value={ann.class_id}
                                      onChange={(e) => updateAnnotation(ann.id, { class_id: e.target.value })}
                                      className={`w-full bg-dark border rounded px-2 py-1.5 text-white text-xs focus:outline-none focus:border-primary ${
                                        isUnknownClass ? 'border-orange-500/50' : 'border-gray-600'
                                      }`}
                                    >
                                      {/* Show current class if not in taxonomy */}
                                      {isUnknownClass && (
                                        <option value={ann.class_id} className="text-orange-300">
                                          {ann.class_id} (not in taxonomy)
                                        </option>
                                      )}
                                      {taxonomy?.classes?.map((cls) => (
                                        <option key={cls.id} value={cls.id}>{cls.name}</option>
                                      ))}
                                    </select>
                                  </>
                                );
                              })()}
                              {/* Quick class buttons */}
                              <div className="flex flex-wrap gap-1 mt-1.5">
                                {taxonomy?.classes?.slice(0, 6).map((cls) => (
                                  <button
                                    key={cls.id}
                                    onClick={() => updateAnnotation(ann.id, { class_id: cls.id })}
                                    className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] transition-all ${
                                      ann.class_id === cls.id
                                        ? 'bg-primary/20 border border-primary/50 text-white'
                                        : 'bg-gray-700/50 text-gray-400 hover:text-white hover:bg-gray-700'
                                    }`}
                                  >
                                    <div className="w-1.5 h-1.5 rounded" style={{ backgroundColor: cls.color }} />
                                    {cls.name.length > 8 ? cls.name.slice(0, 8) + '...' : cls.name}
                                  </button>
                                ))}
                              </div>
                            </div>

                            {/* Track Management */}
                            <div>
                              <label className="text-[10px] text-gray-500 mb-1 block">Track</label>
                              {editingTrackId === ann.id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={newTrackIdValue}
                                    onChange={(e) => setNewTrackIdValue(e.target.value)}
                                    placeholder="Enter track ID or leave blank"
                                    className="flex-1 bg-dark border border-purple-500/50 rounded px-2 py-1.5 text-white text-xs focus:outline-none"
                                    autoFocus
                                  />
                                  <button
                                    onClick={() => {
                                      if (newTrackIdValue.trim()) {
                                        updateAnnotation(ann.id, { track_id: newTrackIdValue.trim() });
                                      } else {
                                        updateAnnotation(ann.id, { track_id: undefined });
                                      }
                                      setEditingTrackId(null);
                                      setNewTrackIdValue('');
                                    }}
                                    className="p-1.5 bg-green-500/20 hover:bg-green-500/30 rounded text-green-400"
                                    title="Save"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                    </svg>
                                  </button>
                                  <button
                                    onClick={() => { setEditingTrackId(null); setNewTrackIdValue(''); }}
                                    className="p-1.5 bg-red-500/20 hover:bg-red-500/30 rounded text-red-400"
                                    title="Cancel"
                                  >
                                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  </button>
                                </div>
                              ) : (
                                <div className="space-y-1.5">
                                  <div className="flex items-center gap-1">
                                    <span className={`flex-1 text-xs font-mono px-2 py-1.5 rounded ${ann.track_id ? 'bg-purple-500/20 text-purple-300' : 'bg-gray-700/50 text-gray-500'}`}>
                                      {ann.track_id ? ann.track_id.slice(0, 16) + (ann.track_id.length > 16 ? '...' : '') : 'No track assigned'}
                                    </span>
                                    <button
                                      onClick={() => { setEditingTrackId(ann.id); setNewTrackIdValue(ann.track_id || ''); }}
                                      className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-400 hover:text-white"
                                      title="Edit Track ID"
                                    >
                                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                                      </svg>
                                    </button>
                                    {ann.track_id && (
                                      <button
                                        onClick={() => { navigator.clipboard.writeText(ann.track_id!); }}
                                        className="p-1.5 bg-gray-700 hover:bg-gray-600 rounded text-gray-400 hover:text-white"
                                        title="Copy Track ID"
                                      >
                                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                                        </svg>
                                      </button>
                                    )}
                                  </div>
                                  {/* Quick track actions */}
                                  <div className="flex flex-wrap gap-1">
                                    {!ann.track_id && (
                                      <button
                                        onClick={() => {
                                          const newTrack = createTrack(ann.class_id);
                                          if (newTrack && currentFrame) {
                                            updateAnnotation(ann.id, { track_id: newTrack.id });
                                            addAnnotationToTrack(newTrack.id, currentFrame.id, ann.id, true);
                                          }
                                        }}
                                        className="text-[10px] px-2 py-1 bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 rounded"
                                      >
                                        + New Track
                                      </button>
                                    )}
                                    {ann.track_id && (
                                      <>
                                        <button
                                          onClick={() => {
                                            if (confirm('Remove from track? This will unlink this annotation from the track.')) {
                                              updateAnnotation(ann.id, { track_id: undefined });
                                            }
                                          }}
                                          className="text-[10px] px-2 py-1 bg-orange-500/20 text-orange-300 hover:bg-orange-500/30 rounded"
                                        >
                                          Unlink
                                        </button>
                                        <button
                                          onClick={() => interpolateTrack(ann.track_id!)}
                                          className="text-[10px] px-2 py-1 bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 rounded"
                                        >
                                          Interpolate
                                        </button>
                                        {showPropagateInput ? (
                                          <div className="flex items-center gap-1 w-full">
                                            <input
                                              type="number"
                                              min={1}
                                              max={100}
                                              value={propagateFrames}
                                              onChange={(e) => setPropagateFrames(Math.max(1, parseInt(e.target.value) || 1))}
                                              className="w-12 px-1.5 py-0.5 bg-dark rounded text-[10px] text-white border border-gray-600 focus:border-primary outline-none"
                                              placeholder="N"
                                            />
                                            <select
                                              value={propagateDirection}
                                              onChange={(e) => setPropagateDirection(e.target.value as 'forward' | 'backward' | 'both')}
                                              className="flex-1 px-1.5 py-0.5 bg-dark rounded text-[10px] text-white border border-gray-600 focus:border-primary outline-none"
                                            >
                                              <option value="forward">→</option>
                                              <option value="backward">←</option>
                                              <option value="both">↔</option>
                                            </select>
                                            <button
                                              onClick={async () => {
                                                if (ann.track_id) {
                                                  await propagateTrack(ann.track_id, propagateFrames, propagateDirection);
                                                  setShowPropagateInput(false);
                                                }
                                              }}
                                              className="px-1.5 py-0.5 bg-green-500/20 text-green-300 rounded text-[10px] hover:bg-green-500/30"
                                            >
                                              Go
                                            </button>
                                            <button
                                              onClick={() => setShowPropagateInput(false)}
                                              className="px-1 py-0.5 text-gray-400 hover:text-white text-[10px]"
                                            >
                                              ✕
                                            </button>
                                          </div>
                                        ) : (
                                          <button
                                            onClick={() => setShowPropagateInput(true)}
                                            className="text-[10px] px-2 py-1 bg-green-500/20 text-green-300 hover:bg-green-500/30 rounded flex items-center gap-1"
                                          >
                                            <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                              <path d="M13 5l7 7-7 7M5 5l7 7-7 7"/>
                                            </svg>
                                            Propagate
                                          </button>
                                        )}
                                      </>
                                    )}
                                    {existingTracks.length > 0 && !ann.track_id && (
                                      <select
                                        onChange={(e) => {
                                          if (e.target.value && currentFrame) {
                                            updateAnnotation(ann.id, { track_id: e.target.value });
                                            addAnnotationToTrack(e.target.value, currentFrame.id, ann.id, true);
                                          }
                                        }}
                                        className="text-[10px] px-2 py-1 bg-gray-700/50 text-gray-300 rounded border-0 focus:outline-none"
                                        defaultValue=""
                                      >
                                        <option value="" disabled>Assign to track...</option>
                                        {existingTracks.slice(0, 10).map(track => (
                                          <option key={track.id} value={track.id}>
                                            {track.id.slice(0, 12)}... ({track.class_id})
                                          </option>
                                        ))}
                                      </select>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>

                            {/* Position (if cuboid) */}
                            {centerData && (
                              <div>
                                <label className="text-[10px] text-gray-500 mb-1 block">Position (X, Y, Z)</label>
                                <div className="grid grid-cols-3 gap-1">
                                  <input type="number" step="0.1" value={centerData.x?.toFixed(2) || 0}
                                    onChange={(e) => updateAnnotation(ann.id, { data: { ...annData.data, center: { ...centerData, x: parseFloat(e.target.value) || 0 } } })}
                                    className="bg-dark border border-gray-600 rounded px-1.5 py-1 text-white text-[10px] font-mono text-center focus:outline-none focus:border-red-400" />
                                  <input type="number" step="0.1" value={centerData.y?.toFixed(2) || 0}
                                    onChange={(e) => updateAnnotation(ann.id, { data: { ...annData.data, center: { ...centerData, y: parseFloat(e.target.value) || 0 } } })}
                                    className="bg-dark border border-gray-600 rounded px-1.5 py-1 text-white text-[10px] font-mono text-center focus:outline-none focus:border-green-400" />
                                  <input type="number" step="0.1" value={centerData.z?.toFixed(2) || 0}
                                    onChange={(e) => updateAnnotation(ann.id, { data: { ...annData.data, center: { ...centerData, z: parseFloat(e.target.value) || 0 } } })}
                                    className="bg-dark border border-gray-600 rounded px-1.5 py-1 text-white text-[10px] font-mono text-center focus:outline-none focus:border-blue-400" />
                                </div>
                              </div>
                            )}

                            {/* Dimensions (if cuboid) */}
                            {dimensionsData && (
                              <div>
                                <label className="text-[10px] text-gray-500 mb-1 block">Dimensions (L, W, H)</label>
                                <div className="grid grid-cols-3 gap-1">
                                  <input type="number" step="0.1" min="0.1" value={dimensionsData.length?.toFixed(2) || 0}
                                    onChange={(e) => updateAnnotation(ann.id, { data: { ...annData.data, dimensions: { ...dimensionsData, length: parseFloat(e.target.value) || 0.1 } } })}
                                    className="bg-dark border border-gray-600 rounded px-1.5 py-1 text-white text-[10px] font-mono text-center focus:outline-none focus:border-primary" />
                                  <input type="number" step="0.1" min="0.1" value={dimensionsData.width?.toFixed(2) || 0}
                                    onChange={(e) => updateAnnotation(ann.id, { data: { ...annData.data, dimensions: { ...dimensionsData, width: parseFloat(e.target.value) || 0.1 } } })}
                                    className="bg-dark border border-gray-600 rounded px-1.5 py-1 text-white text-[10px] font-mono text-center focus:outline-none focus:border-primary" />
                                  <input type="number" step="0.1" min="0.1" value={dimensionsData.height?.toFixed(2) || 0}
                                    onChange={(e) => updateAnnotation(ann.id, { data: { ...annData.data, dimensions: { ...dimensionsData, height: parseFloat(e.target.value) || 0.1 } } })}
                                    className="bg-dark border border-gray-600 rounded px-1.5 py-1 text-white text-[10px] font-mono text-center focus:outline-none focus:border-primary" />
                                </div>
                              </div>
                            )}

                            {/* Rotation/Heading (if cuboid) */}
                            {rotationData && (
                              <div>
                                <label className="text-[10px] text-gray-500 mb-1 block">Heading (°)</label>
                                <div className="flex items-center gap-2">
                                  <input type="range" min="-180" max="180" step="1"
                                    value={((rotationData.yaw || 0) * 180 / Math.PI).toFixed(0)}
                                    onChange={(e) => updateAnnotation(ann.id, { data: { ...annData.data, rotation: { ...rotationData, yaw: parseFloat(e.target.value) * Math.PI / 180 } } })}
                                    className="flex-1 h-1.5 accent-primary" />
                                  <input type="number" step="1"
                                    value={((rotationData.yaw || 0) * 180 / Math.PI).toFixed(0)}
                                    onChange={(e) => updateAnnotation(ann.id, { data: { ...annData.data, rotation: { ...rotationData, yaw: parseFloat(e.target.value) * Math.PI / 180 } } })}
                                    className="w-14 bg-dark border border-gray-600 rounded px-1.5 py-1 text-white text-[10px] font-mono text-center focus:outline-none focus:border-primary" />
                                </div>
                              </div>
                            )}

                            {/* Delete Button */}
                            <button
                              onClick={() => {
                                if (confirm('Delete this annotation?')) {
                                  deleteAnnotation(ann.id);
                                  setExpandedPropertiesId(null);
                                }
                              }}
                              className="w-full py-1.5 bg-red-500/10 text-red-400 rounded text-xs hover:bg-red-500/20 flex items-center justify-center gap-1.5"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              Delete Annotation
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {annotations.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 text-gray-500 text-sm italic">
              No annotations
            </div>
          )}

          {/* 2D Labels Section - Grouped by Camera (hidden in 4D mode) */}
          {show2DLabels && viewMode !== '4d' && camerasWithLabels.length > 0 && (
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

      {/* Delete All Confirmation Modal */}
      {showDeleteAllModal && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
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
      )}
    </>
  );
};

// =============================================================================
// TIMELINE - Fixed-width sleek pill, all controls always visible
// =============================================================================

type PlaybackSpeed = 0.25 | 0.5 | 1 | 2 | 4;
const PLAYBACK_SPEEDS: PlaybackSpeed[] = [0.25, 0.5, 1, 2, 4];
const BASE_INTERVAL = 200; // ms at 1x speed

interface TimelineProps {
  isLoadingFrame?: boolean;
  displayedFrameIndex?: number;
}

const Timeline: React.FC<TimelineProps> = ({ isLoadingFrame = false, displayedFrameIndex }) => {
  const { frames, scene, task, currentFrameIndex, goToFrame, nextFrame, prevFrame } = useEditorStore();
  const lidarPrefetchStatus = useLidarCacheStore((s) => s.prefetchStatus);
  const lidarPrefetchProgress = useLidarCacheStore((s) => s.prefetchProgress);
  const lidarPrefetchTotal = useLidarCacheStore((s) => s.prefetchTotal);
  const imagePrefetchStatus = useImageCacheStore((s) => s.prefetchStatus);
  const imagePrefetchProgress = useImageCacheStore((s) => s.prefetchProgress);
  const imagePrefetchTotal = useImageCacheStore((s) => s.prefetchTotal);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [isEditingFrame, setIsEditingFrame] = useState(false);
  const [frameInputValue, setFrameInputValue] = useState('');
  const playIntervalRef = useRef<number | null>(null);
  const frameInputRef = useRef<HTMLInputElement>(null);

  // Drag-to-move state
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const initialOffset = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      setOffset({
        x: initialOffset.current.x + (e.clientX - dragStart.current.x),
        y: initialOffset.current.y + (e.clientY - dragStart.current.y),
      });
    };
    const handleMouseUp = () => setIsDragging(false);
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handlePillMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button') || (e.target as HTMLElement).closest('input')) return;
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    initialOffset.current = { ...offset };
  };

  // Use displayed frame index if provided, otherwise fall back to current
  const shownFrameIndex = displayedFrameIndex ?? currentFrameIndex;

  useEffect(() => {
    if (isPlaying) {
      const interval = BASE_INTERVAL / playbackSpeed;
      playIntervalRef.current = window.setInterval(() => {
        if (isLoadingFrame) return;
        const store = useEditorStore.getState();
        if (store.currentFrameIndex < store.frames.length - 1) {
          store.nextFrame();
        } else {
          setIsPlaying(false);
        }
      }, interval);
    } else {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, isLoadingFrame, playbackSpeed]);

  const goToFirstFrame = useCallback(() => {
    goToFrame(0);
    setIsPlaying(false);
  }, [goToFrame]);

  const goToLastFrame = useCallback(() => {
    goToFrame(frames.length - 1);
    setIsPlaying(false);
  }, [goToFrame, frames.length]);

  const handleFrameInputStart = () => {
    setIsEditingFrame(true);
    setFrameInputValue(String(shownFrameIndex + 1));
    setTimeout(() => frameInputRef.current?.select(), 0);
  };

  const handleFrameInputSubmit = () => {
    const frameNum = parseInt(frameInputValue);
    if (!isNaN(frameNum) && frameNum >= 1 && frameNum <= frames.length) {
      goToFrame(frameNum - 1);
    }
    setIsEditingFrame(false);
  };

  const handleFrameInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleFrameInputSubmit();
    else if (e.key === 'Escape') setIsEditingFrame(false);
  };

  const cyclePlaybackSpeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length;
    setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
  };

  const progress = frames.length > 1 ? (shownFrameIndex / (frames.length - 1)) * 100 : 0;

  const isPrefetching = lidarPrefetchStatus === 'prefetching' || imagePrefetchStatus === 'prefetching';
  const isPrefetchComplete = lidarPrefetchStatus === 'complete' && imagePrefetchStatus === 'complete' && lidarPrefetchTotal > 0 && imagePrefetchTotal > 0;

  const iconBtn = (disabled = false) =>
    `p-1 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors ${disabled ? 'opacity-25 pointer-events-none' : ''}`;

  return (
    <div
      data-tour="timeline"
      className="absolute bottom-5 left-1/2 z-40"
      style={{ transform: `translate(calc(-50% + ${offset.x}px), ${offset.y}px)` }}
    >
      <div
        className={`flex items-center gap-1 px-2.5 py-1.5 bg-gray-950/85 backdrop-blur-xl border border-white/8 rounded-full shadow-2xl shadow-black/50 select-none ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
        onMouseDown={handlePillMouseDown}
      >

        {/* ── First Frame ── */}
        <button
          onClick={goToFirstFrame}
          disabled={currentFrameIndex === 0}
          className={iconBtn(currentFrameIndex === 0)}
          title="First Frame (Home)"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z"/>
          </svg>
        </button>

        {/* ── Prev Frame ── */}
        <button
          onClick={prevFrame}
          disabled={currentFrameIndex === 0}
          className={iconBtn(currentFrameIndex === 0)}
          title="Previous (←)"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
          </svg>
        </button>

        {/* ── Play / Pause ── */}
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors duration-150 ${
            isPlaying
              ? 'bg-white text-gray-900 shadow-md shadow-white/20'
              : 'bg-white/12 text-white hover:bg-white/20'
          }`}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
            </svg>
          ) : (
            <svg className="w-3 h-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>

        {/* ── Next Frame ── */}
        <button
          onClick={nextFrame}
          disabled={currentFrameIndex >= frames.length - 1}
          className={iconBtn(currentFrameIndex >= frames.length - 1)}
          title="Next (→)"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
          </svg>
        </button>

        {/* ── Last Frame ── */}
        <button
          onClick={goToLastFrame}
          disabled={currentFrameIndex >= frames.length - 1}
          className={iconBtn(currentFrameIndex >= frames.length - 1)}
          title="Last Frame (End)"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7L8 5zM18 5v14h2V5h-2z"/>
          </svg>
        </button>

        {/* ── Divider ── */}
        <div className="mx-1 w-px h-4 bg-white/10" />

        {/* ── Progress Scrubber ── */}
        <div className="relative group flex items-center">
          <div className="relative w-36 h-1.5 bg-white/10 rounded-full overflow-visible cursor-pointer">
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-400 to-cyan-400 rounded-full pointer-events-none"
              style={{ width: `${progress}%` }}
            />
            <div
              className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `calc(${progress}% - 5px)` }}
            />
            <input
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              value={currentFrameIndex}
              onChange={(e) => goToFrame(parseInt(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="mx-1 w-px h-4 bg-white/10" />

        {/* ── Frame Counter ── */}
        {isEditingFrame ? (
          <input
            ref={frameInputRef}
            type="text"
            value={frameInputValue}
            onChange={(e) => setFrameInputValue(e.target.value.replace(/\D/g, ''))}
            onBlur={handleFrameInputSubmit}
            onKeyDown={handleFrameInputKeyDown}
            className="w-12 px-1 py-0.5 text-[10px] font-mono bg-white/10 border border-blue-400/50 rounded text-white text-center focus:outline-none"
            autoFocus
          />
        ) : (
          <button
            onClick={handleFrameInputStart}
            className="flex items-center gap-px text-[10px] font-mono hover:text-white transition-colors whitespace-nowrap"
            title="Click to jump to frame"
          >
            <span className="font-semibold text-white/90">{(frames[shownFrameIndex]?.frame_index ?? shownFrameIndex) + 1}</span>
            <span className="text-white/35">/{task?.frame_range ? task.frame_range.end + 1 : (scene?.frame_count ?? frames.length)}</span>
            {isLoadingFrame && (
              <span className="ml-0.5 w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
            )}
          </button>
        )}

        {/* ── Divider ── */}
        <div className="mx-1 w-px h-4 bg-white/10" />

        {/* ── Speed Control ── */}
        <button
          onClick={cyclePlaybackSpeed}
          className={`px-1.5 py-0.5 text-[10px] font-semibold rounded transition-colors ${
            playbackSpeed !== 1
              ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
              : 'text-white/45 hover:text-white hover:bg-white/10'
          }`}
          title="Click to cycle speed"
        >
          {playbackSpeed}×
        </button>

        {/* ── Prefetch Status ── */}
        {isPrefetching && (
          <>
            <div className="mx-1 w-px h-4 bg-white/10" />
            <div className="w-8 h-1 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-cyan-400/60 transition-all duration-300"
                style={{ width: `${Math.max(lidarPrefetchProgress, imagePrefetchProgress)}%` }}
              />
            </div>
          </>
        )}
        {isPrefetchComplete && (
          <span title="All frames ready" className="ml-1">
            <svg className="w-3 h-3 text-green-400/70" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
          </span>
        )}

      </div>
    </div>
  );
};

interface TrackTimelinePanelProps {
  displayedFrameIndex?: number;
  viewerBottomOffsetPx?: number;
}

const TrackTimelinePanel: React.FC<TrackTimelinePanelProps> = ({
  displayedFrameIndex,
  viewerBottomOffsetPx = 0,
}) => {
  const selectedAnnotations = useSelectedAnnotations();
  const {
    frames,
    currentFrame,
    currentFrameIndex,
    goToFrame,
    annotations,
    selectAnnotation,
  } = useEditorStore();
  const focusOnAnnotation = useEditorStore((s) => s.focusOnAnnotation);
  const {
    tracks,
    activeTrackId,
    addKeyframe,
    removeKeyframe,
    isKeyframe,
    setTrackStart,
    setTrackEnd,
    propagateAndInterpolateTrack,
  } = useTrackStore();
  const railRef = useRef<HTMLDivElement | null>(null);
  const panelDragRef = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null);
  const boundaryDragRef = useRef<{
    boundary: 'start' | 'end';
    startIdx: number;
    endIdx: number;
    initialStartIdx: number;
    initialEndIdx: number;
    moved: boolean;
  } | null>(null);
  const [panelOffset, setPanelOffset] = useState({ x: 0, y: 0 });
  const [isDraggingPanel, setIsDraggingPanel] = useState(false);
  const [draggingBoundary, setDraggingBoundary] = useState<null | 'start' | 'end'>(null);
  const [draftStartIndex, setDraftStartIndex] = useState<number | null>(null);
  const [draftEndIndex, setDraftEndIndex] = useState<number | null>(null);

  // Playback state
  type PlaybackSpeed = 0.5 | 1 | 2 | 4;
  const PLAYBACK_SPEEDS: PlaybackSpeed[] = [0.5, 1, 2, 4];
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const playbackRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const selectedTrackId = selectedAnnotations[0]?.track_id || activeTrackId || null;
  const track = selectedTrackId ? tracks.get(selectedTrackId) : null;
  const shownFrameIndex = displayedFrameIndex ?? currentFrameIndex;

  const frameIdToIndex = useMemo(
    () => new Map(frames.map((frame, idx) => [frame.id, idx])),
    [frames]
  );
  const frameIndexToArrayIndex = useMemo(
    () => new Map(frames.map((frame, idx) => [frame.frame_index, idx])),
    [frames]
  );
  const frameIdToFrameIndex = useMemo(
    () => new Map(frames.map((frame) => [frame.id, frame.frame_index])),
    [frames]
  );

  const keyframeIndices = useMemo(() => {
    if (!track) return [];
    return Array.from(track.keyframe_ids)
      .map(frameId => frameIdToIndex.get(frameId))
      .filter((idx): idx is number => idx !== undefined)
      .sort((a, b) => a - b);
  }, [track, frameIdToIndex]);
  const autoReviewIndices = useMemo(() => {
    if (!track) return [];
    const indices = new Set<number>();
    for (const ann of annotations.values()) {
      if (ann.track_id !== track.id || ann.type !== 'cuboid' || ann.is_keyframe) continue;
      const source = ann.source as string | undefined;
      if (source !== 'auto_interpolated' && source !== 'propagated') continue;
      const idx = frameIdToIndex.get(ann.frame_id);
      if (idx !== undefined) indices.add(idx);
    }
    return Array.from(indices).sort((a, b) => a - b);
  }, [track, annotations, frameIdToIndex]);
  const trackFrameIndices = useMemo(() => {
    if (!track) return [];
    return Array.from(track.frame_annotations.keys())
      .map(frameId => frameIdToIndex.get(frameId))
      .filter((idx): idx is number => idx !== undefined)
      .sort((a, b) => a - b);
  }, [track, frameIdToIndex]);

  const prevKeyframeIndex = useMemo(() => {
    for (let i = keyframeIndices.length - 1; i >= 0; i--) {
      if (keyframeIndices[i] < shownFrameIndex) return keyframeIndices[i];
    }
    return null;
  }, [keyframeIndices, shownFrameIndex]);

  const nextKeyframeIndex = useMemo(() => {
    for (const idx of keyframeIndices) {
      if (idx > shownFrameIndex) return idx;
    }
    return null;
  }, [keyframeIndices, shownFrameIndex]);

  const currentFrameAnnotationId = useMemo(() => {
    if (!track || !currentFrame) return null;

    const fromTrackMap = track.frame_annotations.get(currentFrame.id);
    if (fromTrackMap) return fromTrackMap;

    for (const [annId, ann] of annotations.entries()) {
      if (ann.track_id === track.id && ann.frame_id === currentFrame.id) {
        return annId;
      }
    }
    return null;
  }, [track, currentFrame, annotations]);
  const explicitStartIndex = useMemo(() => {
    if (!track || track.start_frame_index === null) return null;
    return frameIndexToArrayIndex.get(track.start_frame_index) ?? null;
  }, [track, frameIndexToArrayIndex]);
  const explicitEndIndex = useMemo(() => {
    if (!track || track.end_frame_index === null) return null;
    return frameIndexToArrayIndex.get(track.end_frame_index) ?? null;
  }, [track, frameIndexToArrayIndex]);

  const inferredStartIndex = trackFrameIndices.length > 0 ? trackFrameIndices[0] : null;
  const inferredEndIndex = trackFrameIndices.length > 0 ? trackFrameIndices[trackFrameIndices.length - 1] : null;
  const resolvedStartIndex = explicitStartIndex ?? inferredStartIndex ?? 0;
  const resolvedEndIndex = explicitEndIndex ?? inferredEndIndex ?? Math.max(0, frames.length - 1);
  const baseStartIndex = Math.min(resolvedStartIndex, resolvedEndIndex);
  const baseEndIndex = Math.max(resolvedStartIndex, resolvedEndIndex);
  const activeStartIndex = draftStartIndex ?? baseStartIndex;
  const activeEndIndex = draftEndIndex ?? baseEndIndex;

  const clampSliderIndex = useCallback((idx: number) => {
    const max = Math.max(0, frames.length - 1);
    return Math.max(0, Math.min(max, idx));
  }, [frames.length]);
  const indexFromClientX = useCallback((clientX: number): number | null => {
    const railEl = railRef.current;
    if (!railEl) return null;
    const rect = railEl.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const ratio = (clientX - rect.left) / rect.width;
    const clampedRatio = Math.max(0, Math.min(1, ratio));
    return clampSliderIndex(Math.round(clampedRatio * Math.max(0, frames.length - 1)));
  }, [clampSliderIndex, frames.length]);

  useEffect(() => {
    setDraftStartIndex(null);
    setDraftEndIndex(null);
    setDraggingBoundary(null);
    boundaryDragRef.current = null;
  }, [track?.id]);

  useEffect(() => {
    if (!isDraggingPanel) return;
    const onMove = (event: MouseEvent) => {
      const dragState = panelDragRef.current;
      if (!dragState) return;
      setPanelOffset({
        x: dragState.originX + (event.clientX - dragState.startX),
        y: dragState.originY + (event.clientY - dragState.startY),
      });
    };
    const onUp = () => {
      panelDragRef.current = null;
      setIsDraggingPanel(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isDraggingPanel]);

  useEffect(() => {
    if (!draggingBoundary || !track) return;
    const onMove = (event: MouseEvent) => {
      const idx = indexFromClientX(event.clientX);
      const dragState = boundaryDragRef.current;
      if (idx === null || !dragState) return;

      if (dragState.boundary === 'start') {
        if (idx !== dragState.initialStartIdx) dragState.moved = true;
        dragState.startIdx = Math.min(idx, dragState.endIdx);
        setDraftStartIndex(dragState.startIdx);
      } else {
        if (idx !== dragState.initialEndIdx) dragState.moved = true;
        dragState.endIdx = Math.max(idx, dragState.startIdx);
        setDraftEndIndex(dragState.endIdx);
      }
    };
    const onUp = () => {
      const dragState = boundaryDragRef.current;
      if (dragState && track) {
        if (!dragState.moved) {
          const clickIdx = dragState.boundary === 'start' ? dragState.initialStartIdx : dragState.initialEndIdx;
          jumpToFrame(clickIdx, true);
        } else {
          const startFrame = frames[dragState.startIdx];
          const endFrame = frames[dragState.endIdx];
          if (startFrame && endFrame) {
            setTrackStart(track.id, startFrame.frame_index);
            setTrackEnd(track.id, endFrame.frame_index);
            propagateAndInterpolateTrack(track.id);
          }
        }
      }
      boundaryDragRef.current = null;
      setDraggingBoundary(null);
      setDraftStartIndex(null);
      setDraftEndIndex(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [draggingBoundary, track, indexFromClientX, frames, setTrackStart, setTrackEnd, propagateAndInterpolateTrack]);

  // Playback interval effect — advances frames within track range
  useEffect(() => {
    if (playbackRef.current) {
      clearInterval(playbackRef.current);
      playbackRef.current = null;
    }
    if (!isPlaying || !track || frames.length === 0) return;
    const intervalMs = Math.round(200 / playbackSpeed);
    playbackRef.current = setInterval(() => {
      const state = useEditorStore.getState();
      const curIdx = state.currentFrameIndex;
      const endIdx = activeEndIndex;
      if (curIdx >= endIdx) {
        // Loop back to start of track range
        state.goToFrame(activeStartIndex);
      } else {
        state.goToFrame(curIdx + 1);
      }
    }, intervalMs);
    return () => {
      if (playbackRef.current) clearInterval(playbackRef.current);
    };
  }, [isPlaying, playbackSpeed, track, frames.length, activeStartIndex, activeEndIndex]);

  // Stop playback when track changes or component unmounts
  useEffect(() => {
    return () => {
      setIsPlaying(false);
      if (playbackRef.current) clearInterval(playbackRef.current);
    };
  }, [track?.id]);

  if (!track || !currentFrame || frames.length === 0) {
    return null;
  }

  const currentIsKeyframe = isKeyframe(track.id, currentFrame.id);
  const canAddOrCreateKeyframe = !!currentFrame && (currentFrameAnnotationId !== null || track.keyframe_ids.size > 0);
  const progress = frames.length > 1 ? (shownFrameIndex / (frames.length - 1)) * 100 : 0;
  const rangeStartProgress = frames.length > 1 ? (activeStartIndex / (frames.length - 1)) * 100 : 0;
  const rangeEndProgress = frames.length > 1 ? (activeEndIndex / (frames.length - 1)) * 100 : 0;
  const trackBandWidth = Math.max(0, rangeEndProgress - rangeStartProgress);
  const startFrameLabel = (frames[activeStartIndex]?.frame_index ?? activeStartIndex) + 1;
  const endFrameLabel = (frames[activeEndIndex]?.frame_index ?? activeEndIndex) + 1;

  const focusTrackAnnotationForFrame = (frameId: string) => {
    const tryFocus = () => {
      const latestTrack = useTrackStore.getState().tracks.get(track.id);
      const latestAnnotations = useEditorStore.getState().annotations;

      let annotationId = latestTrack?.frame_annotations.get(frameId) ?? null;
      if (!annotationId) {
        for (const [annId, ann] of latestAnnotations.entries()) {
          if (ann.track_id === track.id && ann.frame_id === frameId) {
            annotationId = annId;
            break;
          }
        }
      }
      if (!annotationId) return false;

      selectAnnotation(annotationId);
      focusOnAnnotation(annotationId);
      return true;
    };

    if (tryFocus()) return;

    let attempts = 0;
    const maxAttempts = 20;
    const poll = window.setInterval(() => {
      attempts += 1;
      if (tryFocus() || attempts >= maxAttempts) {
        window.clearInterval(poll);
      }
    }, 100);
  };

  const jumpToFrame = (targetIndex: number, shouldFocus: boolean = false) => {
    if (targetIndex < 0 || targetIndex >= frames.length) return;
    goToFrame(targetIndex);
    if (!shouldFocus) return;
    const targetFrame = frames[targetIndex];
    if (!targetFrame) return;
    focusTrackAnnotationForFrame(targetFrame.id);
  };

  const startPanelDrag = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    panelDragRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      originX: panelOffset.x,
      originY: panelOffset.y,
    };
    setIsDraggingPanel(true);
    event.preventDefault();
  };

  const startBoundaryDrag = (boundary: 'start' | 'end', event: React.MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    boundaryDragRef.current = {
      boundary,
      startIdx: activeStartIndex,
      endIdx: activeEndIndex,
      initialStartIdx: activeStartIndex,
      initialEndIdx: activeEndIndex,
      moved: false,
    };
    setDraftStartIndex(activeStartIndex);
    setDraftEndIndex(activeEndIndex);
    setDraggingBoundary(boundary);
  };

  const ensureAnnotationForCurrentFrame = (): string | null => {
    const latestTrackBefore = useTrackStore.getState().tracks.get(track.id);
    if (!latestTrackBefore || !currentFrame) return null;

    const currentFrameIdx = currentFrame.frame_index;
    const existingFrameIndexValues = Array.from(latestTrackBefore.frame_annotations.keys())
      .map(fid => frameIdToFrameIndex.get(fid))
      .filter((idx): idx is number => idx !== undefined);
    const inferredStartFrameIndex = existingFrameIndexValues.length > 0
      ? Math.min(...existingFrameIndexValues)
      : currentFrameIdx;
    const inferredEndFrameIndex = existingFrameIndexValues.length > 0
      ? Math.max(...existingFrameIndexValues)
      : currentFrameIdx;

    const currentStartFrameIndex = latestTrackBefore.start_frame_index ?? inferredStartFrameIndex;
    const currentEndFrameIndex = latestTrackBefore.end_frame_index ?? inferredEndFrameIndex;

    if (currentFrameIdx < currentStartFrameIndex) {
      setTrackStart(track.id, currentFrameIdx);
    }
    if (currentFrameIdx > currentEndFrameIndex) {
      setTrackEnd(track.id, currentFrameIdx);
    }

    propagateAndInterpolateTrack(track.id);

    const latestTrackAfter = useTrackStore.getState().tracks.get(track.id);
    const fromTrackMap = latestTrackAfter?.frame_annotations.get(currentFrame.id);
    if (fromTrackMap) return fromTrackMap;

    const latestAnnotations = useEditorStore.getState().annotations;
    for (const [annId, ann] of latestAnnotations.entries()) {
      if (ann.track_id === track.id && ann.frame_id === currentFrame.id) {
        return annId;
      }
    }
    return null;
  };

  const toggleCurrentKeyframe = () => {
    if (!currentFrame) return;
    if (currentIsKeyframe) {
      removeKeyframe(track.id, currentFrame.id);
      return;
    }
    const annotationId = currentFrameAnnotationId ?? ensureAnnotationForCurrentFrame();
    if (annotationId) {
      addKeyframe(track.id, currentFrame.id, annotationId);
    }
  };

  return (
    <div
      className="absolute left-1/2 z-30 w-[min(420px,32vw)] min-w-[340px] pointer-events-auto"
      style={{
        bottom: `${Math.max(96, viewerBottomOffsetPx + 72)}px`,
        transform: `translate(calc(-50% + ${panelOffset.x}px), ${panelOffset.y}px)`,
      }}
    >
      <div className="bg-gray-900/85 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl px-2.5 py-2">
        {/* Compact header: drag handle + info + keyframe toggle */}
        <div
          className={`flex items-center gap-1.5 mb-1.5 select-none ${isDraggingPanel ? 'cursor-grabbing' : 'cursor-grab'}`}
          onMouseDown={startPanelDrag}
        >
          {/* Drag grip */}
          <svg className="w-3 h-3 text-gray-600 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="8" cy="6" r="1.5"/><circle cx="16" cy="6" r="1.5"/>
            <circle cx="8" cy="12" r="1.5"/><circle cx="16" cy="12" r="1.5"/>
            <circle cx="8" cy="18" r="1.5"/><circle cx="16" cy="18" r="1.5"/>
          </svg>
          <span className="text-[9px] font-mono text-purple-400/80 truncate max-w-[80px]">{track.id.slice(0, 8)}</span>
          <span className="text-[9px] px-1 py-px rounded bg-purple-500/15 text-purple-300/80">{keyframeIndices.length} KF</span>
          {autoReviewIndices.length > 0 && (
            <span className="text-[9px] px-1 py-px rounded bg-yellow-500/15 text-yellow-300/80">{autoReviewIndices.length} auto</span>
          )}
          <div className="flex-1" />
          {/* Keyframe toggle - icon button */}
          <button
            onClick={(e) => { e.stopPropagation(); toggleCurrentKeyframe(); }}
            disabled={!currentIsKeyframe && !canAddOrCreateKeyframe}
            className={`p-1 rounded transition-colors ${
              currentIsKeyframe
                ? 'bg-yellow-500/25 text-yellow-300 hover:bg-yellow-500/35'
                : 'text-gray-500 hover:text-cyan-300 hover:bg-white/5'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
            title={currentIsKeyframe ? 'Unset keyframe' : 'Set keyframe'}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill={currentIsKeyframe ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 12l10 10 10-10L12 2z" />
            </svg>
          </button>
          {/* Frame counter */}
          <span className="text-[9px] text-gray-500 tabular-nums font-mono">
            {(frames[shownFrameIndex]?.frame_index ?? shownFrameIndex) + 1}/{frames.length}
          </span>
        </div>

        {/* Timeline rail */}
        <div className="relative mb-1">
          <div ref={railRef} className="relative h-2 rounded-full bg-white/8 overflow-visible">
            {/* Track range band */}
            <div
              className="absolute inset-y-0 bg-emerald-500/20 border-y border-emerald-400/30 rounded-full"
              style={{ left: `${rangeStartProgress}%`, width: `${trackBandWidth}%` }}
            />
            {/* Progress fill */}
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-purple-500/80 to-cyan-400/80"
              style={{ width: `${progress}%` }}
            />
            {/* Playhead */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-white border-[1.5px] border-cyan-400 shadow z-20"
              style={{ left: `calc(${progress}% - 5px)` }}
            />
            {/* Boundary handles */}
            <button
              onMouseDown={(event) => startBoundaryDrag('start', event)}
              className="group absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-emerald-400 border border-emerald-200 shadow z-30 cursor-ew-resize"
              style={{ left: `calc(${rangeStartProgress}% - 8px)` }}
              title={`Start: frame ${startFrameLabel}`}
            >
              <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-7 whitespace-nowrap px-1.5 py-0.5 rounded bg-black/90 text-[9px] text-gray-200 shadow-lg z-50 opacity-0 group-hover:opacity-100 transition-opacity">
                S:{startFrameLabel}
              </span>
            </button>
            <button
              onMouseDown={(event) => startBoundaryDrag('end', event)}
              className="group absolute top-1/2 -translate-y-1/2 w-4 h-4 rounded-full bg-red-400 border border-red-200 shadow z-30 cursor-ew-resize"
              style={{ left: `calc(${rangeEndProgress}% - 8px)` }}
              title={`End: frame ${endFrameLabel}`}
            >
              <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-7 whitespace-nowrap px-1.5 py-0.5 rounded bg-black/90 text-[9px] text-gray-200 shadow-lg z-50 opacity-0 group-hover:opacity-100 transition-opacity">
                E:{endFrameLabel}
              </span>
            </button>
            {/* Invisible range scrubber */}
            <input
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              value={shownFrameIndex}
              onChange={(e) => jumpToFrame(parseInt(e.target.value, 10), false)}
              onMouseUp={(e) => jumpToFrame((e.target as HTMLInputElement).valueAsNumber, true)}
              onTouchEnd={(e) => jumpToFrame((e.target as HTMLInputElement).valueAsNumber, true)}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
          </div>

          {/* Keyframe markers */}
          {keyframeIndices.map((idx) => {
            const left = frames.length > 1 ? (idx / (frames.length - 1)) * 100 : 0;
            const isCurrent = idx === shownFrameIndex;
            return (
              <button
                key={`${track.id}-kf-${idx}`}
                onClick={() => jumpToFrame(idx, true)}
                className="group absolute top-1/2 -translate-y-1/2 w-3 h-3 flex items-center justify-center z-20"
                style={{ left: `calc(${left}% - 6px)` }}
                title={`Keyframe ${(frames[idx]?.frame_index ?? idx) + 1}`}
              >
                <span className={`w-2 h-2 rotate-45 border transition-transform group-hover:scale-150 ${
                  isCurrent ? 'bg-yellow-300 border-yellow-200' : 'bg-purple-400 border-purple-200'
                }`} />
              </button>
            );
          })}
          {/* Auto markers */}
          {autoReviewIndices.map((idx) => {
            const left = frames.length > 1 ? (idx / (frames.length - 1)) * 100 : 0;
            return (
              <button
                key={`${track.id}-auto-${idx}`}
                onClick={() => jumpToFrame(idx, true)}
                className="group absolute top-1/2 -translate-y-1/2 w-2 h-2 flex items-center justify-center z-10"
                style={{ left: `calc(${left}% - 4px)` }}
                title={`Auto frame ${(frames[idx]?.frame_index ?? idx) + 1}`}
              >
                <span className="w-1.5 h-1.5 rounded-full bg-yellow-300/80 border border-yellow-100/60" />
              </button>
            );
          })}
        </div>

        {/* Transport controls — single compact row */}
        <div className="flex items-center justify-center gap-0.5">
          <button onClick={() => jumpToFrame(activeStartIndex, true)} className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-white" title="Track start">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z"/></svg>
          </button>
          <button onClick={() => prevKeyframeIndex !== null && jumpToFrame(prevKeyframeIndex, true)} disabled={prevKeyframeIndex === null} className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-white disabled:opacity-25" title="Prev keyframe">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
          </button>
          <button onClick={() => { setIsPlaying(false); jumpToFrame(Math.max(activeStartIndex, shownFrameIndex - 1), true); }} disabled={shownFrameIndex <= activeStartIndex} className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-white disabled:opacity-25" title="Prev frame">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
          </button>
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className={`p-1 rounded-full mx-0.5 transition-colors ${isPlaying ? 'bg-cyan-500/30 text-cyan-300' : 'bg-white/8 text-white hover:bg-white/15'}`}
            title={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying
              ? <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
              : <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
            }
          </button>
          <button onClick={() => { setIsPlaying(false); jumpToFrame(Math.min(activeEndIndex, shownFrameIndex + 1), true); }} disabled={shownFrameIndex >= activeEndIndex} className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-white disabled:opacity-25" title="Next frame">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z"/></svg>
          </button>
          <button onClick={() => nextKeyframeIndex !== null && jumpToFrame(nextKeyframeIndex, true)} disabled={nextKeyframeIndex === null} className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-white disabled:opacity-25" title="Next keyframe">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
          </button>
          <button onClick={() => jumpToFrame(activeEndIndex, true)} className="p-0.5 rounded hover:bg-white/10 text-gray-500 hover:text-white" title="Track end">
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor"><path d="M16 18h2V6h-2v12zM6 18l8.5-6L6 6v12z"/></svg>
          </button>
          <div className="w-px h-3 bg-white/10 mx-1" />
          {PLAYBACK_SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setPlaybackSpeed(s)}
              className={`px-1 py-px rounded text-[9px] font-mono transition-colors ${
                playbackSpeed === s ? 'bg-cyan-500/25 text-cyan-200' : 'text-gray-600 hover:text-gray-300'
              }`}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// COORDINATE DISPLAY - Shows LiDAR cursor position (X, Y, Z)
// =============================================================================

const CoordinateDisplay: React.FC = () => {
  const cursorPosition = useEditorStore((s) => s.cursorPosition);
  const coordinateFrame = useEditorStore((s) => s.lidarView.coordinateFrame);

  const frameLabel = coordinateFrame === 'world' ? 'World' :
                     coordinateFrame === 'ego' ? 'Ego' : 'LiDAR';

  return (
    <div className="absolute bottom-4 left-4 z-20">
      <div className="flex items-center gap-4 px-4 py-2 bg-gray-900/40 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl">
        <div className="flex items-center gap-1 text-xs text-white/60">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="font-medium">{frameLabel} Frame</span>
        </div>

        <div className="w-px h-4 bg-white/10" />

        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="flex items-center gap-1">
            <span className="text-red-400 font-bold">X</span>
            <span className="text-white/90 min-w-[40px] text-right">
              {cursorPosition ? cursorPosition.x.toFixed(2) : '—'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-green-400 font-bold">Y</span>
            <span className="text-white/90 min-w-[40px] text-right">
              {cursorPosition ? cursorPosition.y.toFixed(2) : '—'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-blue-400 font-bold">Z</span>
            <span className="text-white/90 min-w-[40px] text-right">
              {cursorPosition ? cursorPosition.z.toFixed(2) : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// HEADER
// =============================================================================

interface HeaderProps {
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  annotationModeTab: AnnotationModeTab;
  setAnnotationModeTab: (mode: AnnotationModeTab) => void;
  availableModes: { fusion_3d: boolean; '2d_only': boolean };
  onOpenQACompleteModal: () => void;
  // Auto-save status
  isAutoSaving?: boolean;
  lastSavedAt?: Date | null;
  autoSaveError?: string | null;
  // Submission modal callbacks (state managed by parent)
  onShowSubmissionModal: (show: boolean) => void;
  onSetNextTask: (task: Task | null) => void;
  onSetLoadingNextTask: (loading: boolean) => void;
  // Taxonomy selection
  linkedTaxonomies?: Taxonomy[];
  urlTaxonomyId?: string | null;  // Taxonomy ID from URL for initial display
  taxonomyReady?: boolean;  // Whether URL taxonomy has been applied to scene
  // Per-taxonomy effective status (overrides task.stage/status when taxonomy is selected)
  effectiveStage?: string;
  effectiveStatus?: string;
  effectiveRevisionCount?: number;
}

const PointSizeSlider: React.FC = () => {
  const lidarView = useEditorStore((s) => s.lidarView);
  const setLidarView = useEditorStore((s) => s.setLidarView);

  return (
    <div className="flex items-center gap-2 bg-dark rounded-lg p-0.5 border border-gray-700 mx-1">
      <span className="text-[10px] text-gray-400 px-1">Size:</span>
      <input
        type="range"
        min="0.5"
        max="5"
        step="0.1"
        value={(lidarView.pointSize || 0.01) * 100}
        onChange={(e) => setLidarView({ pointSize: Number(e.target.value) / 100 })}
        className="w-16 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
        title={`Point Size: ${((lidarView.pointSize || 0.01) * 100).toFixed(1)}`}
      />
    </div>
  );
};

const PointCloudColorSelector: React.FC = () => {
  const lidarView = useEditorStore((s) => s.lidarView);
  const setLidarView = useEditorStore((s) => s.setLidarView);

  return (
    <div className="flex items-center gap-1 bg-dark rounded-lg p-0.5 border border-gray-700 mx-1">
      <span className="text-[10px] text-gray-400 px-1">Points:</span>
      <select
        value={lidarView.colorMode}
        onChange={(e) => setLidarView({ colorMode: e.target.value as any })}
        className="bg-transparent text-[10px] font-medium text-gray-200 focus:outline-none cursor-pointer"
      >
        <option value="height" className="bg-dark text-gray-200">Height</option>
        <option value="height_above_ground" className="bg-dark text-gray-200">Above Ground</option>
        <option value="intensity" className="bg-dark text-gray-200">Intensity</option>
        <option value="class" className="bg-dark text-gray-200">Class</option>
      </select>
    </div>
  );
};

const ColorModeSelector: React.FC = () => {
  const annotationColorMode = useEditorStore((s) => s.annotationColorMode);
  const setAnnotationColorMode = useEditorStore((s) => s.setAnnotationColorMode);
  const taxonomy = useEditorStore((s) => s.taxonomy);
  const activeAttributeForColor = useEditorStore((s) => s.activeAttributeForColor);
  const setActiveAttributeForColor = useEditorStore((s) => s.setActiveAttributeForColor);

  const uniqueAttributes = React.useMemo(() => {
    if (!taxonomy?.classes) return [];
    return Array.from(new Set(
      taxonomy.classes.flatMap(c => Object.keys(c.attributes || {}))
    )).sort();
  }, [taxonomy]);

  return (
    <div className="flex items-center gap-2 bg-dark rounded-lg p-0.5 border border-gray-700 mx-2">
       <div className="flex items-center gap-1 px-1">
          <span className="text-[10px] text-gray-400">Color:</span>
          <select
            value={annotationColorMode}
            onChange={(e) => setAnnotationColorMode(e.target.value as any)}
            className="bg-transparent text-[10px] font-medium text-gray-200 focus:outline-none cursor-pointer"
          >
            <option value="class" className="bg-dark text-gray-200">Class</option>
            <option value="attribute" className="bg-dark text-gray-200">Attribute</option>
            <option value="qa_status" className="bg-dark text-gray-200">QA Status</option>
          </select>
       </div>

       {annotationColorMode === 'attribute' && (
         <>
           <div className="w-px h-3 bg-gray-700" />
           <select
              value={activeAttributeForColor ?? ''}
              onChange={(e) => setActiveAttributeForColor(e.target.value || null)}
              className="bg-transparent text-[10px] font-medium text-gray-200 focus:outline-none max-w-[80px] cursor-pointer"
           >
              <option value="" className="bg-dark text-gray-400">Attribute...</option>
               {uniqueAttributes.map(attr => (
                 <option key={attr} value={attr} className="bg-dark text-gray-200">{attr}</option>
               ))}
           </select>
         </>
       )}
    </div>
  );
};

const Header: React.FC<HeaderProps> = ({ viewMode, setViewMode, annotationModeTab, setAnnotationModeTab, availableModes, onOpenQACompleteModal, isAutoSaving, lastSavedAt, autoSaveError, onShowSubmissionModal, onSetNextTask, onSetLoadingNextTask, linkedTaxonomies, urlTaxonomyId, taxonomyReady = true, effectiveStage, effectiveStatus, effectiveRevisionCount }) => {
  const { task, isSaving, hasUnsavedChanges, saveAnnotations, setAnnotations, frames, scene, annotations } = useEditorStore();
  // Also get 4D annotations to include in delete count
  const annotations4D = useAnnotation4DStore((s) => s.annotations4D);
  // Compute total annotation count (regular + 4D)
  const totalAnnotationCount = React.useMemo(() => {
    const regularCount = annotations.size;
    const count4D = Array.from(annotations4D.values()).filter(a => !a.is_deleted).length;
    return regularCount + count4D;
  }, [annotations, annotations4D]);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = React.useState<boolean>(false);
  const [isMigrating, setIsMigrating] = React.useState(false);
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);
  const [isChangingTaxonomy, setIsChangingTaxonomy] = React.useState(false);

  // Session timer with pause/resume — state persisted per task+taxonomy in localStorage
  const [isTimerRunning, setIsTimerRunning] = React.useState(false);
  const [showTimerHint, setShowTimerHint] = React.useState(false);
  const [elapsedSeconds, setElapsedSeconds] = React.useState(0);
  const [timerStartedAt, setTimerStartedAt] = React.useState<string | null>(null);
  const timerIntervalRef = React.useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs so the save-on-switch effect reads current values without stale closures
  const isTimerRunningRef = React.useRef(false);
  const elapsedSecondsRef = React.useRef(0);
  isTimerRunningRef.current = isTimerRunning;
  elapsedSecondsRef.current = elapsedSeconds;
  const prevTaxonomyIdRef = React.useRef<string>('');

  const timerStorageKey = task?.id && scene?.selected_taxonomy_id
    ? `task_timer_${task.id}_${scene.selected_taxonomy_id}`
    : task?.id
      ? `task_timer_${task.id}`
      : null;

  const clearTimerInterval = () => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  };

  const startTimerInterval = () => {
    clearTimerInterval();
    timerIntervalRef.current = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
  };

  // Save previous taxonomy's timer and restore the new one whenever task or taxonomy changes
  React.useEffect(() => {
    if (!task?.id) return;
    const currentTaxId = scene?.selected_taxonomy_id ?? '';
    const prevTaxId = prevTaxonomyIdRef.current;

    // If taxonomy changed, save the outgoing timer state first
    if (prevTaxId && prevTaxId !== currentTaxId) {
      const prevKey = `task_timer_${task.id}_${prevTaxId}`;
      const currentElapsed = elapsedSecondsRef.current;
      const currentRunning = isTimerRunningRef.current;
      clearTimerInterval();
      try {
        const existing = JSON.parse(localStorage.getItem(prevKey) || '{}');
        if (currentRunning) {
          setIsTimerRunning(false);
          const breaks: { pausedAt: string; resumedAt?: string }[] = existing.breaks ?? [];
          breaks.push({ pausedAt: new Date().toISOString() });
          localStorage.setItem(prevKey, JSON.stringify({
            ...existing,
            elapsed: currentElapsed,
            running: false,
            lastActivityAt: new Date().toISOString(),
            breaks,
          }));
          if (currentElapsed > 0) {
            taskApi.update(task.id, { total_time_seconds: currentElapsed } as any).catch(() => {});
          }
        } else {
          localStorage.setItem(prevKey, JSON.stringify({ ...existing, elapsed: currentElapsed, running: false }));
        }
      } catch {}
    }

    prevTaxonomyIdRef.current = currentTaxId;

    // Restore new taxonomy's timer state
    clearTimerInterval();
    const newKey = currentTaxId
      ? `task_timer_${task.id}_${currentTaxId}`
      : `task_timer_${task.id}`;
    try {
      const raw = localStorage.getItem(newKey);
      if (raw) {
        const { elapsed, running, startedAt } = JSON.parse(raw) as { elapsed: number; running: boolean; startedAt?: string };
        setElapsedSeconds(elapsed ?? 0);
        setTimerStartedAt(startedAt ?? null);
        if (running) {
          startTimerInterval();
          setIsTimerRunning(true);
        } else {
          setIsTimerRunning(false);
        }
      } else {
        setElapsedSeconds(0);
        setTimerStartedAt(null);
        setIsTimerRunning(false);
      }
    } catch {
      setElapsedSeconds(0);
      setTimerStartedAt(null);
      setIsTimerRunning(false);
    }
    return () => clearTimerInterval();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, scene?.selected_taxonomy_id]);

  // Persist on every tick and on pause/resume — preserve breaks array
  React.useEffect(() => {
    if (!timerStorageKey) return;
    // Skip saving until the restore effect has applied its values. In React 18
    // Strict Mode the effect runs twice; if we save zeros on the first pass we
    // overwrite the real saved state before the second pass can read it.
    if (elapsedSeconds === 0 && !isTimerRunning && timerStartedAt === null) return;
    try {
      const existing = JSON.parse(localStorage.getItem(timerStorageKey) || '{}');
      localStorage.setItem(timerStorageKey, JSON.stringify({
        ...existing,
        elapsed: elapsedSeconds,
        running: isTimerRunning,
        startedAt: timerStartedAt,
      }));
    } catch {
      localStorage.setItem(timerStorageKey, JSON.stringify({ elapsed: elapsedSeconds, running: isTimerRunning, startedAt: timerStartedAt }));
    }
  }, [elapsedSeconds, isTimerRunning, timerStartedAt, timerStorageKey]);

  // Broadcast timer state to same-tab listeners (e.g. Image2DAnnotationView tool lock)
  React.useEffect(() => {
    if (!task?.id) return;
    window.dispatchEvent(new CustomEvent('timerStateChange', { detail: { running: isTimerRunning, taskId: task.id } }));
  }, [isTimerRunning, task?.id]);

  React.useEffect(() => {
    const handleTimerHint = (event: Event) => {
      const detail = (event as CustomEvent<{ active?: boolean }>).detail;
      setShowTimerHint(Boolean(detail?.active));
    };

    window.addEventListener('timerControlAttention', handleTimerHint);
    return () => window.removeEventListener('timerControlAttention', handleTimerHint);
  }, []);

  React.useEffect(() => {
    if (isTimerRunning) {
      setShowTimerHint(false);
    }
  }, [isTimerRunning]);

  // Sync elapsed time to backend (fire-and-forget, best-effort)
  const syncTimerToBackend = React.useCallback((seconds: number) => {
    if (!task?.id || seconds <= 0) return;
    taskApi.update(task.id, { total_time_seconds: seconds } as any).catch(() => {});
  }, [task?.id]);

  // Sync on unmount so navigating away saves the time
  React.useEffect(() => {
    return () => {
      if (task?.id) {
        const taxId = scene?.selected_taxonomy_id;
        const key = taxId ? `task_timer_${task.id}_${taxId}` : `task_timer_${task.id}`;
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const { elapsed } = JSON.parse(raw) as { elapsed: number };
            if (elapsed > 0) taskApi.update(task.id, { total_time_seconds: elapsed } as any).catch(() => {});
          } catch {}
        }
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [task?.id, scene?.selected_taxonomy_id]);

  const handleToggleTimer = () => {
    if (isTimerRunning) {
      clearTimerInterval();
      setIsTimerRunning(false);
      // Record break start and sync to backend
      if (timerStorageKey) {
        try {
          const raw = localStorage.getItem(timerStorageKey);
          const existing = raw ? JSON.parse(raw) : {};
          const breaks: { pausedAt: string; resumedAt?: string }[] = existing.breaks ?? [];
          breaks.push({ pausedAt: new Date().toISOString() });
          localStorage.setItem(timerStorageKey, JSON.stringify({
            ...existing,
            elapsed: elapsedSeconds,
            running: false,
            lastActivityAt: new Date().toISOString(),
            breaks,
          }));
        } catch {}
      }
      syncTimerToBackend(elapsedSeconds);
    } else {
      // Record resume time on existing break
      if (timerStorageKey) {
        try {
          const raw = localStorage.getItem(timerStorageKey);
          const existing = raw ? JSON.parse(raw) : {};
          const breaks: { pausedAt: string; resumedAt?: string }[] = existing.breaks ?? [];
          if (breaks.length > 0 && !breaks[breaks.length - 1].resumedAt) {
            breaks[breaks.length - 1].resumedAt = new Date().toISOString();
          }
          localStorage.setItem(timerStorageKey, JSON.stringify({ ...existing, breaks }));
        } catch {}
      }
      if (!timerStartedAt) {
        setTimerStartedAt(new Date().toISOString());
      }
      startTimerInterval();
      setIsTimerRunning(true);
    }
  };

  const formatSessionTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  // ── Per-frame time tracking (keyed per task + taxonomy) ──────────────────
  const frameEnterTimeRef = React.useRef<number | null>(null);
  const frameIndexRef = React.useRef<number>(-1);
  const _frameIndexForTracking = useEditorStore((s) => s.currentFrameIndex);

  React.useEffect(() => {
    const idx = _frameIndexForTracking;

    const saveFrameTime = (frameIndex: number, enterTime: number) => {
      if (!task?.id || frameIndex < 0) return;
      const spent = Math.round((Date.now() - enterTime) / 1000);
      if (spent <= 0 || spent >= 3600) return;
      try {
        const taxId = scene?.selected_taxonomy_id;
        const key = taxId
          ? `task_frame_times_${task.id}_${taxId}`
          : `task_frame_times_${task.id}`;
        const raw = localStorage.getItem(key);
        const data: Record<number, { totalSeconds: number; visits: number }> = raw ? JSON.parse(raw) : {};
        const entry = data[frameIndex] ?? { totalSeconds: 0, visits: 0 };
        entry.totalSeconds += spent;
        entry.visits += 1;
        data[frameIndex] = entry;
        localStorage.setItem(key, JSON.stringify(data));
      } catch {}
    };

    if (!task?.id || !isTimerRunning) {
      // Timer stopped — record time for the current frame before resetting
      if (frameEnterTimeRef.current !== null) {
        saveFrameTime(frameIndexRef.current, frameEnterTimeRef.current);
      }
      frameEnterTimeRef.current = null;
      frameIndexRef.current = idx;
      return;
    }

    const now = Date.now();
    const prevIndex = frameIndexRef.current;

    // Frame changed — record time spent on previous frame
    if (prevIndex >= 0 && frameEnterTimeRef.current !== null) {
      saveFrameTime(prevIndex, frameEnterTimeRef.current);
    }

    frameEnterTimeRef.current = now;
    frameIndexRef.current = idx;
  }, [_frameIndexForTracking, task?.id, isTimerRunning, scene?.selected_taxonomy_id]);

  // Mutation to update scene's selected taxonomy
  const updateSceneTaxonomyMutation = useMutation({
    mutationFn: ({ sceneId, taxonomyId }: { sceneId: string; taxonomyId: string | null }) =>
      sceneApi.updateSelectedTaxonomy(sceneId, taxonomyId),
    onSuccess: (updatedScene: any) => {
      // Update scene in editor store
      useEditorStore.getState().setScene(updatedScene);
      // Clear annotations from store so fresh ones are loaded
      setAnnotations([]);
      // Invalidate scene query to refresh
      queryClient.invalidateQueries({ queryKey: ['scene', scene?.id] });
      // Also invalidate annotation queries so they reload with new taxonomy filter
      queryClient.invalidateQueries({ queryKey: ['annotations'] });
      queryClient.invalidateQueries({ queryKey: ['all-3d-annotations'] });
      setIsChangingTaxonomy(false);
    },
    onError: (err: Error) => {
      console.error('Failed to update scene taxonomy:', err);
      setIsChangingTaxonomy(false);
    },
  });

  const handleTaxonomyChange = (taxonomyId: string) => {
    if (!scene?.id || isChangingTaxonomy) return;
    const newTaxonomyId = taxonomyId || null;
    if (newTaxonomyId === scene.selected_taxonomy_id) return;

    // Check if the new taxonomy is a segmentation_3d taxonomy
    const newTaxonomy = linkedTaxonomies?.find(t => t.id === newTaxonomyId);
    if (newTaxonomy?.annotation_mode === 'segmentation_3d' && task?.id) {
      // Redirect to segmentation editor with the new taxonomy
      navigate(`/tasks/${task.id}/segmentation?taxonomy=${newTaxonomyId}`, { replace: true });
      return;
    }

    setIsChangingTaxonomy(true);
    updateSceneTaxonomyMutation.mutate({ sceneId: scene.id, taxonomyId: newTaxonomyId });
  };
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [showBackTimerWarning, setShowBackTimerWarning] = React.useState(false);

  const handleBackClick = () => {
    if (isTimerRunning) {
      setShowBackTimerWarning(true);
    } else {
      navigate(-1);
    }
  };

  React.useEffect(() => {
    if (!showBackTimerWarning) return;

    const handleWarningEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowBackTimerWarning(false);
      }
    };

    window.addEventListener('keydown', handleWarningEscape);
    return () => window.removeEventListener('keydown', handleWarningEscape);
  }, [showBackTimerWarning]);

  // Notify the editor so overlapping overlays (e.g. the cuboid hint bar) can hide
  // while this dialog is open — it lives in a blurred, z-trapped stacking context.
  React.useEffect(() => {
    window.dispatchEvent(new CustomEvent('editorLeaveDialogChange', { detail: { open: showBackTimerWarning } }));
  }, [showBackTimerWarning]);

  // Close menu when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isMenuOpen]);

  const handleDeleteAllAnnotations = async () => {
    console.log('[DeleteAll] handleDeleteAllAnnotations called, task:', task?.id);
    try {
      if (!task?.id) {
        console.log('[DeleteAll] No task ID, returning early');
        return;
      }

      console.log('[DeleteAll] Starting deletion for task:', task.id);
      // Delete all annotations from the task
      await Promise.all([
        // Delete all 2D annotations in one call
        annotation2DApi.deleteByTask(task.id).catch(() => null),
        // Delete all 3D annotations using bulk delete
        (async () => {
          const ann3d = await annotation3DApi.list(task.id).catch(() => []);
          // Only call bulk delete if there are annotations to delete
          if (ann3d.length > 0) {
            await annotation3DApi.deleteBulk(ann3d.map(a => a.id)).catch(() => null);
          }
        })(),
        // Delete all 4D annotations using bulk delete
        (async () => {
          const ann4d = await annotation4DApi.list(task.id).catch(() => []);
          console.log('[DeleteAll] Found', ann4d.length, '4D annotations to delete');
          if (ann4d.length > 0) {
            await annotation4DApi.deleteBulk(ann4d.map(a => a.id)).catch((e) => {
              console.error('[DeleteAll] Failed to delete 4D annotations:', e);
              return null;
            });
            console.log('[DeleteAll] 4D annotations deleted from server');
          }
        })(),
        // Delete legacy annotations with pagination
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
          // Only delete if there are annotations
          if (allLegacy.length > 0) {
            // Delete in batches of 50 to avoid overwhelming backend
            for (let i = 0; i < allLegacy.length; i += 50) {
              const batch = allLegacy.slice(i, i + 50);
              await Promise.all(batch.map(a => annotationApi.delete(a.id).catch(() => null)));
              if (i + 50 < allLegacy.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
              }
            }
          }
        })()
      ]);

      console.log('[DeleteAll] Annotation deletion complete, clearing frontend state');
      // Clear all in-memory state immediately so the UI updates without a refresh.

      // 1. Clear editor (3D) annotations and tracks
      setAnnotations([]);
      useTrackStore.setState({ tracks: new Map() });

      // 2. Clear 2D annotations
      useAnnotation2DStore.getState().clearAnnotations();

      // 3. Clear 4D annotations
      useAnnotation4DStore.getState().clearAnnotations4D();

      // 4. Remove React Query caches that feed mergeAnnotationsFromServer so stale
      //    data isn't rehydrated when the component re-renders or frames change.
      queryClient.removeQueries({ queryKey: ['annotations', task.id] });
      queryClient.removeQueries({ queryKey: ['all-3d-annotations', task.id] });

      // Always reset task back to annotation stage and clear all revision/QA data.
      console.log('[DeleteAll] About to reset task:', task.id);
      try {
        // Get current taxonomy ID for per-taxonomy reset
        const currentTaxonomyId = scene?.selected_taxonomy_id;

        // Reset per-taxonomy workflow if a taxonomy is selected
        if (currentTaxonomyId) {
          console.log('[DeleteAll] Resetting per-taxonomy workflow for taxonomy:', currentTaxonomyId);
          await workflowApi.setStage(task.id, 'annotation', currentTaxonomyId, true);
        }

        console.log('[DeleteAll] Calling taskApi.update with stage: annotation, revision_count: 0');
        const updatedTask = await taskApi.update(task.id, { stage: 'annotation', revision_count: 0 } as any);
        console.log('[DeleteAll] API response:', updatedTask);
        console.log('[DeleteAll] Response revision_count:', updatedTask.revision_count, 'stage:', updatedTask.stage);
        useEditorStore.getState().setTask(updatedTask);
        console.log('[DeleteAll] After setTask, store task:', useEditorStore.getState().task?.revision_count);
        queryClient.invalidateQueries({ queryKey: ['task', task.id] });
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
        queryClient.invalidateQueries({ queryKey: ['dataset-tasks'] });
        // Invalidate per-taxonomy workflow info cache
        queryClient.invalidateQueries({ queryKey: ['workflow-info', task.id] });
        queryClient.invalidateQueries({ queryKey: ['workflow-info-2d', task.id] });
        // Optimistically patch the task in the dataset-detail cache so the R badge
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
        if (scene?.dataset_id) {
          queryClient.setQueryData(['dataset-detail', scene.dataset_id], patchTaskInDetail);
        } else {
          // Fallback: patch all dataset-detail caches
          queryClient.getQueriesData<any>({ predicate: (q) => q.queryKey[0] === 'dataset-detail' })
            .forEach(([key]) => queryClient.setQueryData(key, patchTaskInDetail));
        }
        queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'dataset-detail' });
      } catch (resetErr) {
        console.error('Failed to reset task stage after delete all:', resetErr);
      }

      setShowDeleteConfirm(false);
      setIsMenuOpen(false);
    } catch (err) {
      console.error('Failed to delete all annotations:', err);
      setShowDeleteConfirm(false);
      setIsMenuOpen(false);
    }
  };

  // Reset revision mode without deleting annotations
  const handleResetRevisionMode = async () => {
    console.log('[ResetRevisionMode] Called, task:', task?.id, 'stage:', task?.stage, 'revision_count:', task?.revision_count);
    if (!task?.id) return;
    try {
      console.log('[ResetRevisionMode] Calling API with stage: annotation, revision_count: 0');
      const updatedTask = await taskApi.update(task.id, { stage: 'annotation', revision_count: 0 } as any);
      console.log('[ResetRevisionMode] API response:', updatedTask);
      useEditorStore.getState().setTask(updatedTask);
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['dataset-tasks'] });
      // Optimistically patch dataset-detail caches
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
      if (scene?.dataset_id) {
        queryClient.setQueryData(['dataset-detail', scene.dataset_id], patchTaskInDetail);
      } else {
        queryClient.getQueriesData<any>({ predicate: (q) => q.queryKey[0] === 'dataset-detail' })
          .forEach(([key]) => queryClient.setQueryData(key, patchTaskInDetail));
      }
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === 'dataset-detail' });
      setIsMenuOpen(false);
    } catch (err) {
      console.error('Failed to reset revision mode:', err);
    }
  };

  // 4D annotation store
  const saveAnnotations4D = useAnnotation4DStore((s) => s.saveAnnotations4D);
  const migrateToAnnotations = useAnnotation4DStore((s) => s.migrateToAnnotations);
  const updateFrameDataWithLidarCoords = useAnnotation4DStore((s) => s.updateFrameDataWithLidarCoords);

  // Check if there are 4D annotations
  const has4DAnnotations = React.useMemo(() => {
    return Array.from(annotations4D.values()).some(a => !a.is_deleted);
  }, [annotations4D]);

  // Check if there are unsaved 4D annotations
  const hasUnsaved4DChanges = React.useMemo(() => {
    return Array.from(annotations4D.values()).some(a => a.is_new || a.is_dirty || a.is_deleted);
  }, [annotations4D]);

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
      // Step 0: Compute LiDAR coordinates for each frame from world coordinates
      // This is required for migration - the backend expects per-frame LiDAR coords
      if (has4DAnnotations && frames.length > 0) {
        // Computing LiDAR coordinates for migration (logging removed for performance)

        // Convert frames to the format expected by the transform function
        const frameData = frames.map(f => ({
          id: f.id,
          ego_pose: f.ego_pose ? {
            position: f.ego_pose.position,
            rotation: f.ego_pose.rotation,
          } : undefined,
        }));

        // Get calibration data (ego_to_lidar)
        const egoToLidar = scene?.calibration?.ego_to_lidar;

        // Update frame_data with computed LiDAR coordinates
        updateFrameDataWithLidarCoords(frameData, egoToLidar);
      }

      // Step 1: Save any pending 4D annotation changes (now with correct LiDAR coords)
      if (hasUnsaved4DChanges || has4DAnnotations) {
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
        const taxonomyIdForReload = scene?.selected_taxonomy_id;
        const freshAnnotations = await annotation3DApi.list(task.id, undefined, undefined, taxonomyIdForReload || undefined);
        // Convert to the format expected by setAnnotations
        const formattedAnnotations = freshAnnotations.map((ann: any) => ({
          ...ann,
          id: ann.id.toString(),
          task_id: ann.task_id.toString(),
          frame_id: ann.frame_id.toString(),
          track_id: ann.track_id?.toString() || null,
        }));
        setAnnotations(formattedAnnotations);

        // Invalidate React Query caches
        queryClient.invalidateQueries({ queryKey: ['annotations-3d'] });
        queryClient.invalidateQueries({ queryKey: ['all-3d-annotations'] });

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
    if (!task) return;

    // In 4D mode, migrate first
    if (viewMode === '4d' && has4DAnnotations) {
      await handleSave4D();
    }

    // Sync current elapsed time to backend before submitting
    syncTimerToBackend(elapsedSeconds);

    // Save annotations first
    const saveResult = await saveAnnotations();
    if (!saveResult.success) {
      setSaveError(saveResult.error || 'Failed to save before submit');
      return;
    }

    try {
      // Handle different stages - use effective stage/status which is per-taxonomy if taxonomy is selected
      // Get current taxonomy_id from scene's selected_taxonomy_id
      const currentTaxonomyId = scene?.selected_taxonomy_id;
      const currentStage = effectiveStage ?? task.stage;
      const currentStatus = effectiveStatus ?? task.status;
      const currentRevisionCount = effectiveRevisionCount ?? task.revision_count ?? 0;

      if (currentStage === 'annotation') {
        // Check if this is revision mode (revision_count > 0)
        if (currentRevisionCount > 0) {
          // Revision mode: submit fixes for QA re-review
          await workflowApi.submitFixes(task.id, currentTaxonomyId);
        } else {
          // Normal annotation stage: submit for QA review
          // Try to start work if pending/assigned - ignore errors if already in progress
          if (currentStatus === 'pending' || currentStatus === 'assigned') {
            try {
              await workflowApi.startWork(task.id, currentTaxonomyId);
            } catch (startErr) {
              // Ignore error - task might already be in progress (e.g., another tab, race condition)
              console.log('[FusionEditorV2] startWork failed (may already be in progress):', startErr);
            }
          }
          await workflowApi.submitAnnotation(task.id, currentTaxonomyId);
        }

        // Invalidate task cache so reopening this task gets fresh data with updated stage
        queryClient.invalidateQueries({ queryKey: ['task', task.id] });
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
        // Invalidate per-taxonomy workflow info
        queryClient.invalidateQueries({ queryKey: ['workflow-info', task.id, currentTaxonomyId] });

        // Show submission modal and fetch next task (use parent's state)
        onSetLoadingNextTask(true);
        onShowSubmissionModal(true);

        try {
          const next = await taskApi.getNextAssignedTask(task.id);
          onSetNextTask(next);
        } catch (err) {
          console.error('Failed to fetch next task:', err);
          onSetNextTask(null);
        } finally {
          onSetLoadingNextTask(false);
        }
      } else if (currentStage === 'qa') {
        // QA stage: open modal for accept/reject
        onOpenQACompleteModal();
        return; // Don't continue, wait for modal action
      } else if (currentStage === 'customer_qa') {
        // Customer QA stage: open modal for accept/reject
        onOpenQACompleteModal();
        return; // Don't continue, wait for modal action
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to submit');
    }
  };

  const hasDirtyChanges = hasUnsavedChanges();

  return (
    <div className="absolute top-0 left-0 right-0 h-12 z-[60] bg-dark-panel/95 backdrop-blur-sm border-b border-gray-700">
      {/* Back-button timer warning dialog */}
      {showBackTimerWarning && (
        <div className="fixed inset-0 z-[200]">
          <button
            type="button"
            aria-label="Dismiss timer warning"
            onClick={() => setShowBackTimerWarning(false)}
            className="absolute inset-0 bg-black/45 backdrop-blur-[2px]"
          />
          <div className="absolute top-16 left-6 w-80 rounded-xl border border-orange-500/45 bg-slate-950 shadow-[0_24px_60px_rgba(0,0,0,0.6)] overflow-hidden">
            <div className="h-0.5 w-full bg-gradient-to-r from-orange-600/0 via-orange-500/90 to-orange-600/0" />
            <div className="p-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-orange-500/35 bg-orange-500/12">
                  <svg className="w-4 h-4 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <circle cx="12" cy="12" r="9" />
                    <path strokeLinecap="round" d="M12 7v5l3 3" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white leading-tight">Timer is running</p>
                  <p className="mt-1 text-xs leading-snug text-slate-300">Pause the timer before leaving so your work time is saved accurately.</p>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-1 gap-2">
                <button
                  onClick={() => { handleToggleTimer(); setShowBackTimerWarning(false); navigate(-1); }}
                  className="w-full rounded-lg bg-orange-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-orange-500"
                >
                  Pause &amp; Leave
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowBackTimerWarning(false); navigate(-1); }}
                    className="flex-1 rounded-lg border border-slate-600 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 transition-colors hover:border-slate-500 hover:bg-slate-800 hover:text-white"
                  >
                    Leave anyway
                  </button>
                  <button
                    onClick={() => setShowBackTimerWarning(false)}
                    className="flex-1 rounded-lg border border-slate-700 bg-transparent px-3 py-2 text-xs font-medium text-slate-400 transition-colors hover:border-slate-500 hover:text-white"
                  >
                    Stay
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="h-full flex items-center px-4">
        {/* Logo - Left */}
        <Link to="/" className="flex items-center mr-3">
          {BRAND.showLogo ? (
            <img src="/logo.svg?v=2" alt={BRAND.name} className="h-7 w-auto" />
          ) : (
            <span className="text-sm font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-500 bg-clip-text text-transparent whitespace-nowrap">
              {BRAND.name}
            </span>
          )}
        </Link>

        <button
          onClick={handleBackClick}
          className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-dark-hover mr-2"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>

        {/* Centered: Title + View Mode */}
        <div className="flex-1 flex items-center justify-center gap-4 overflow-x-auto min-w-0">
          <div className="flex flex-col items-center">
            <span className="text-sm font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-500 bg-clip-text text-transparent">
              {BRAND.name}
            </span>
            <span className="text-[10px] text-gray-500">Sensor Fusion Annotation Platform</span>
          </div>

          <div className="h-6 w-px bg-gray-700" />

          {/* View Mode Selector */}
          <div className="flex items-center bg-dark rounded-lg p-0.5">
            {(['3d', '4d', '2d'] as ViewMode[]).map((mode) => {
              // Determine if this view tab should be enabled based on currently selected annotation mode tab
              // 3D/Fusion mode enables: 3D, Fusion, 4D tabs
              // 2D Only mode enables: only 2D tab
              const is3DView = mode === '3d' || mode === 'fusion' || mode === '4d';
              const is2DView = mode === '2d';
              const isEnabledByModeTab = (is3DView && annotationModeTab === 'fusion_3d') || (is2DView && annotationModeTab === '2d_only');
              // Also check if the mode is available at all (has taxonomy linked)
              const isModeAvailable = (is3DView && availableModes.fusion_3d) || (is2DView && availableModes['2d_only']);
              const isEnabled = isEnabledByModeTab && isModeAvailable;

              return (
                <button
                  key={mode}
                  onClick={() => isEnabled && setViewMode(mode)}
                  disabled={!isEnabled}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    !isEnabled
                      ? 'text-gray-600 cursor-not-allowed opacity-50'
                      : viewMode === mode
                        ? mode === '4d' ? 'bg-purple-600 text-white' : 'bg-primary text-white'
                        : 'text-gray-400 hover:text-white'
                  }`}
                  title={
                    !isModeAvailable
                      ? `No ${is3DView ? '3D/Fusion' : '2D'} taxonomy linked to this dataset`
                      : !isEnabledByModeTab
                        ? `Switch to ${is3DView ? '3D/Fusion' : '2D Only'} mode to use this view`
                        : mode === '4d'
                          ? 'Stack multiple LiDAR scans for static object labeling'
                          : undefined
                  }
                >
                  {mode === 'fusion' ? 'FUSION' : mode.toUpperCase()}
                </button>
              );
            })}
          </div>

          <div className="h-6 w-px bg-gray-700" />

          {/* Annotation Mode Tab Selector */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-500 mr-1">Mode:</span>
            <div className="flex items-center bg-dark rounded-lg p-0.5">
              <button
                onClick={() => availableModes.fusion_3d && setAnnotationModeTab('fusion_3d')}
                disabled={!availableModes.fusion_3d}
                className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                  !availableModes.fusion_3d
                    ? 'text-gray-600 cursor-not-allowed opacity-50'
                    : annotationModeTab === 'fusion_3d'
                      ? 'bg-cyan-600 text-white'
                      : 'text-gray-400 hover:text-white'
                }`}
                title={!availableModes.fusion_3d ? 'No 3D/Fusion taxonomy linked to this dataset' : '3D/Fusion/4D annotations - cuboids, tracking objects'}
              >
                3D/Fusion
              </button>
              <button
                onClick={() => availableModes['2d_only'] && setAnnotationModeTab('2d_only')}
                disabled={!availableModes['2d_only']}
                className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                  !availableModes['2d_only']
                    ? 'text-gray-600 cursor-not-allowed opacity-50'
                    : annotationModeTab === '2d_only'
                      ? 'bg-orange-500 text-white'
                      : 'text-gray-400 hover:text-white'
                }`}
                title={!availableModes['2d_only'] ? 'No 2D-only taxonomy linked to this dataset' : '2D-only annotations - lanes, traffic signs, traffic lights'}
              >
                2D Only
              </button>
            </div>
          </div>

          <ColorModeSelector />
          {viewMode !== '2d' && <PointSizeSlider />}
          {viewMode !== '2d' && <PointCloudColorSelector />}

          {/* Taxonomy Selector - show when multiple taxonomies are linked */}
          {linkedTaxonomies && linkedTaxonomies.length > 1 && (
            <>
              <div className="h-6 w-px bg-gray-700" />
              <div className="flex items-center gap-1 bg-dark rounded-lg p-0.5 border border-gray-700">
                <span className="text-[10px] text-gray-400 px-1">Taxonomy:</span>
                <select
                  value={urlTaxonomyId || scene?.selected_taxonomy_id || ''}
                  onChange={(e) => handleTaxonomyChange(e.target.value)}
                  disabled={isChangingTaxonomy || !taxonomyReady}
                  className="bg-transparent text-[10px] font-medium text-gray-200 focus:outline-none cursor-pointer max-w-[260px] disabled:opacity-50"
                  title={(linkedTaxonomies.find(t => t.id === (urlTaxonomyId || scene?.selected_taxonomy_id))?.name ?? 'Switch taxonomy to view/edit different annotation sets')}
                >
                  {linkedTaxonomies.map((tax) => (
                    <option key={tax.id} value={tax.id} className="bg-dark text-gray-200">
                      {tax.name}
                    </option>
                  ))}
                </select>
                {(isChangingTaxonomy || !taxonomyReady) && (
                  <svg className="w-3 h-3 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
                  </svg>
                )}
              </div>
            </>
          )}

          {/* Single taxonomy display - show when only one taxonomy is linked */}
          {linkedTaxonomies && linkedTaxonomies.length === 1 && (
            <>
              <div className="h-6 w-px bg-gray-700" />
              <div className="flex items-center gap-1 bg-dark rounded-lg p-0.5 border border-gray-700">
                <span className="text-[10px] text-gray-400 px-1">Taxonomy:</span>
                <span className="text-[10px] font-medium text-gray-200 px-1 max-w-[260px] truncate" title={linkedTaxonomies[0].name}>
                  {linkedTaxonomies[0].name}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Right - Task info & Save buttons */}
        <div className="flex items-center gap-2">
          {/* Session Timer */}
          <div
            data-tour="timer-control"
            className={`flex items-center gap-1.5 px-2 py-1 rounded hidden sm:flex transition-all duration-200 ${
              showTimerHint && !isTimerRunning
                ? 'bg-gray-800/88 border border-amber-400/55 animate-timerControlHint'
                : 'bg-gray-800/60 border border-gray-700/60'
            }`}
            title={task?.total_time_seconds ? `Session: ${formatSessionTime(elapsedSeconds)} · Total: ${formatSessionTime(task.total_time_seconds + elapsedSeconds)}` : `Time in this session`}
          >
            <svg className="w-3 h-3 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <circle cx="12" cy="12" r="9" />
              <path strokeLinecap="round" d="M12 7v5l3 3" />
            </svg>
            <span className={`text-xs font-mono tabular-nums ${isTimerRunning ? 'text-gray-300' : 'text-gray-500'}`}>
              {formatSessionTime(elapsedSeconds)}
            </span>
            <button
              data-tour="timer-toggle"
              onClick={handleToggleTimer}
              className={`ml-0.5 transition-colors ${showTimerHint && !isTimerRunning ? 'text-amber-300 hover:text-amber-200' : 'text-gray-400 hover:text-white'}`}
              title={isTimerRunning ? 'Pause timer' : 'Resume timer'}
            >
              {isTimerRunning ? (
                /* Pause icon */
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="5" y="4" width="4" height="16" rx="1" />
                  <rect x="15" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                /* Play icon */
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4l14 8-14 8V4z" />
                </svg>
              )}
            </button>
          </div>

          <div className="text-right mr-2 hidden sm:block">
            {/* Show only the concise scene name; the full task name (scene + dataset +
                taxonomy) is available on hover. max-width + truncate keeps a long name
                from compressing the logo, especially when side panels claim width. */}
            <h1
              className="text-white font-medium text-xs truncate max-w-[260px] ml-auto"
              title={task?.name || undefined}
            >
              {scene?.name ?? task?.name ?? 'Loading...'}
            </h1>
            {task && (
              <div className="flex items-center gap-1.5">
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                  (effectiveStage ?? task.stage) === 'annotation' ? 'bg-blue-500/20 text-blue-400' :
                  (effectiveStage ?? task.stage) === 'qa' ? 'bg-purple-500/20 text-purple-400' :
                  (effectiveStage ?? task.stage) === 'customer_qa' ? 'bg-orange-500/20 text-orange-400' :
                  (effectiveStage ?? task.stage) === 'accepted' ? 'bg-green-500/20 text-green-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {(effectiveStage ?? task.stage) === 'qa' ? 'QA' : (effectiveStage ?? task.stage) === 'customer_qa' ? 'CUSTOMER QA' : (effectiveStage ?? task.stage).toUpperCase()}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                  (effectiveStatus ?? task.status) === 'assigned' ? 'bg-blue-500/20 text-blue-400' :
                  (effectiveStatus ?? task.status) === 'in_progress' ? 'bg-yellow-500/20 text-yellow-400' :
                  (effectiveStatus ?? task.status) === 'submitted' ? 'bg-purple-500/20 text-purple-400' :
                  (effectiveStatus ?? task.status) === 'accepted' ? 'bg-green-500/20 text-green-400' :
                  (effectiveStatus ?? task.status) === 'rejected' ? 'bg-red-500/20 text-red-400' :
                  'bg-gray-500/20 text-gray-400'
                }`}>
                  {(effectiveStatus ?? task.status).replace('_', ' ')}
                </span>
                {(effectiveRevisionCount ?? task.revision_count) > 0 && (effectiveStage ?? task.stage) !== 'customer_qa' && (effectiveStage ?? task.stage) !== 'accepted' && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">
                    ⚠ Revision #{effectiveRevisionCount ?? task.revision_count}
                  </span>
                )}
              </div>
            )}
          </div>

          {saveSuccess && (
            <span className="text-xs text-green-400">✓</span>
          )}
          {saveError && (
            <span className="text-xs text-red-400" title={saveError}>!</span>
          )}

          {/* Auto-save status indicator */}
          <div className="flex flex-col items-end text-xs" title={lastSavedAt ? `Last saved: ${lastSavedAt.toLocaleTimeString()}` : 'Not saved yet'}>
            {isAutoSaving ? (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span className="text-amber-400 hidden sm:inline">Saving...</span>
              </div>
            ) : autoSaveError ? (
              <div className="flex items-center gap-1">
                <div className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-red-400 hidden sm:inline" title={autoSaveError}>Error</span>
              </div>
            ) : lastSavedAt ? (
              <div className="flex flex-col items-end">
                <div className="flex items-center gap-1">
                  <div className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-green-400 hidden sm:inline">Auto-saved</span>
                </div>
                <span className="text-[10px] text-gray-500 hidden sm:inline">{lastSavedAt.toLocaleTimeString()}</span>
              </div>
            ) : null}
          </div>

          {/* 4D Mode: Show Save & Migrate button */}
          {viewMode === '4d' ? (
            <>
              <button
                onClick={handleSave4D}
                disabled={isMigrating || (!hasUnsaved4DChanges && !has4DAnnotations)}
                className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
                  (hasUnsaved4DChanges || has4DAnnotations)
                    ? 'bg-purple-600 text-white hover:bg-purple-500'
                    : 'text-gray-300 hover:bg-dark-hover'
                } disabled:opacity-50`}
                title="Save 4D annotations and migrate to 3D annotations for each frame"
              >
                {isMigrating ? 'Migrating...' : hasUnsaved4DChanges ? 'Save*' : 'Migrate'}
              </button>
            </>
          ) : (
            /* Regular mode: Standard Save button */
            <button
              onClick={handleSave}
              disabled={isSaving || !hasDirtyChanges}
              className={`px-3 py-1.5 rounded-lg text-xs transition-colors ${
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
            className="px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 text-xs disabled:opacity-50"
            disabled={!task || isSaving || isMigrating || ((effectiveStage ?? task?.stage) === 'annotation' && annotations.size === 0)}
            title={
              (effectiveStage ?? task?.stage) === 'annotation' && annotations.size === 0
                ? 'No annotations to submit - draw at least one annotation first'
                : (effectiveStage ?? task?.stage) === 'annotation'
                  ? 'Submit for QA review'
                  : (effectiveStage ?? task?.stage) === 'qa'
                    ? 'Complete QA review'
                    : 'Submit task'
            }
          >
            {(effectiveStage ?? task?.stage) === 'qa' || (effectiveStage ?? task?.stage) === 'customer_qa' ? 'Complete QA' : 'Submit'}
          </button>

          {/* Menu Button */}
          <div ref={menuRef} className="relative">
            <button
              onClick={() => setIsMenuOpen(!isMenuOpen)}
              className="p-2 rounded border border-gray-600 text-gray-300 hover:text-white hover:border-gray-500 hover:bg-dark-hover transition-colors flex items-center justify-center"
              title="More options"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                <circle cx="12" cy="5" r="1.5" fill="currentColor" />
                <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                <circle cx="12" cy="19" r="1.5" fill="currentColor" />
              </svg>
            </button>

            {/* Dropdown Menu */}
            {isMenuOpen && (
              <div className="absolute right-0 mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl z-[100] min-w-[220px]">
                {/* Reset Revision Mode - only show when in revision mode */}
                {task && effectiveStage === 'annotation' && (effectiveRevisionCount ?? task.revision_count ?? 0) > 0 && (
                  <button
                    onClick={handleResetRevisionMode}
                    className="w-full px-4 py-3 text-left text-sm text-yellow-400 hover:bg-gray-700 hover:text-yellow-300 transition-colors flex items-center gap-2 border-b border-gray-700"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Reset Revision Mode
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowDeleteConfirm(true);
                    setIsMenuOpen(false);
                  }}
                  className="w-full px-4 py-3 text-left text-sm text-red-400 hover:bg-gray-700 hover:text-red-300 transition-colors flex items-center gap-2 rounded-lg"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Delete All Annotations
                </button>
              </div>
            )}
          </div>

          {/* Delete Confirmation Dialog — portal to escape CSS transform stacking context */}
          {showDeleteConfirm && createPortal(
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999]">
              <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
                <h3 className="text-lg font-bold text-white mb-2 flex items-center gap-2">
                  <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  Delete All Annotations?
                </h3>
                <p className="text-sm text-gray-300 mb-6">
                  This will permanently delete all{' '}
                  <span className="text-white font-semibold">{totalAnnotationCount}</span>{' '}
                  annotation{totalAnnotationCount !== 1 ? 's' : ''} from this task. This action cannot be undone.
                </p>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="px-4 py-2 rounded-lg text-sm text-gray-300 bg-gray-700/50 hover:bg-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDeleteAllAnnotations}
                    className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 transition-colors font-medium"
                  >
                    Delete All
                  </button>
                </div>
              </div>
            </div>
          , document.body)}

        </div>
      </div>
    </div>
  );
};

// =============================================================================
// MAIN EDITOR
// =============================================================================

export const FusionEditorV2: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [viewMode, setViewModeInternal] = useState<ViewMode>('3d');
  const [annotationModeTab, setAnnotationModeTab] = useState<AnnotationModeTab>('fusion_3d');
  // Ref to bypass the auto-switch effect when user explicitly opens camera image view
  const cameraImageViewRef = useRef(false);
  const [showOrthoViews, setShowOrthoViews] = useState(false); // Ortho views hidden by default
  const [orthoViewsWidth, setOrthoViewsWidth] = useState(480); // Track ortho panel width for fusion view
  const [activeOrthoView, setActiveOrthoView] = useState<OrthoViewType | null>(null);
  const [visibleCamerasForSelection, setVisibleCamerasForSelection] = useState<string[]>([]);
  const [clickedLidarPoint, setClickedLidarPoint] = useState<{ x: number; y: number; z: number } | null>(null);
  const [focusCamerasPanelHeight, setFocusCamerasPanelHeight] = useState(window.innerHeight * 0.35); // Resizable panel height - start at 35% of window
  const [showAnnotationList, setShowAnnotationList] = useState(true); // Annotation list panel visibility
  const [annotationPanelWidth, setAnnotationPanelWidth] = useState(280); // Track annotation list panel width

  // Placement hint for the Cuboid/Track tool (Shift = steer → slide → drop).
  // Shown on EVERY task entry — regardless of new/old user or task — and stays up
  // until 5 boxes are dropped in this visit, or the user closes it. State is in-memory
  // only (no persistence) and resets per task, so it always greets the user afresh.
  const CUBOID_HINT_BOX_LIMIT = 5; // keep the hint visible until N boxes are dropped this visit
  const activeTool = useEditorStore((s) => s.activeTool);
  const isBoxPlacementActive = useEditorStore((s) => s.isBoxPlacementActive);
  const [cuboidHintCount, setCuboidHintCount] = useState(0);
  const [cuboidHintDismissed, setCuboidHintDismissed] = useState(false);
  // Mirror the timer-running signal (same source the ToolPalette uses to lock tools)
  // so the hint only appears once the user has actually started working — not on entry
  // when the tool may be restored to track/cuboid but the timer (and tools) are locked.
  const [hintTimerRunning, setHintTimerRunning] = useState(false);
  useEffect(() => {
    if (!taskId) return;
    try {
      const raw = localStorage.getItem(`task_timer_${taskId}`);
      if (raw !== null) setHintTimerRunning(JSON.parse(raw).running === true);
    } catch { /* ignore */ }
  }, [taskId]);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ running: boolean; taskId: string }>).detail;
      if (detail?.taskId !== taskId) return;
      setHintTimerRunning(detail.running);
      // Pausing deactivates the work tools. Mirror the ESC reset so the active tool,
      // class picker, and hint bar all disappear together — not just the hint bar.
      if (!detail.running) {
        const st = useEditorStore.getState();
        if (st.activeTool === 'cuboid' || st.activeTool === 'track') {
          st.setBoxPlacementActive(false);
          st.setActiveTool('select');
        }
      }
    };
    window.addEventListener('timerStateChange', handler);
    return () => window.removeEventListener('timerStateChange', handler);
  }, [taskId]);
  // Hide the hint while the back-button "Timer is running" dialog is open — the
  // Header sits in a blurred (z-trapped) stacking context, so the hint would
  // otherwise render on top of the dialog and cover its buttons.
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ open: boolean }>).detail;
      setLeaveDialogOpen(Boolean(detail?.open));
    };
    window.addEventListener('editorLeaveDialogChange', handler);
    return () => window.removeEventListener('editorLeaveDialogChange', handler);
  }, []);
  const showCuboidHint = hintTimerRunning && !leaveDialogOpen && !cuboidHintDismissed && cuboidHintCount < CUBOID_HINT_BOX_LIMIT;
  const dismissCuboidHint = useCallback(() => setCuboidHintDismissed(true), []);
  // Reset the hint whenever the user enters a different task.
  const placementStartSizeRef = useRef(0);
  const wasPlacingRef = useRef(false);
  useEffect(() => {
    setCuboidHintCount(0);
    setCuboidHintDismissed(false);
    wasPlacingRef.current = false;
  }, [taskId]);
  // Count completed box placements: a placement drag ends (isBoxPlacementActive
  // true→false) with the annotation count higher than when it began. The box is
  // created before the placement flag clears, so the new annotation is already in
  // the store here. This ignores frame navigation, loads, and cancelled drags.
  useEffect(() => {
    if (isBoxPlacementActive && !wasPlacingRef.current) {
      wasPlacingRef.current = true;
      placementStartSizeRef.current = useEditorStore.getState().annotations.size;
    } else if (!isBoxPlacementActive && wasPlacingRef.current) {
      wasPlacingRef.current = false;
      const endSize = useEditorStore.getState().annotations.size;
      if (endSize > placementStartSizeRef.current && showCuboidHint) {
        setCuboidHintCount((c) => c + 1);
      }
    }
  }, [isBoxPlacementActive, showCuboidHint]);


  // Read taxonomy from URL params (passed from DatasetDetail)
  const urlTaxonomyId = searchParams.get('taxonomy');

  // QA Complete Modal
  const [showQACompleteModal, setShowQACompleteModal] = useState(false);
  // 4D Stacked point cloud data (for ortho views sync)
  const [stackedPointCloud4D, setStackedPointCloud4D] = useState<{ positions: Float32Array; pointCount: number; origin?: [number, number, number] } | null>(null);

  // Submission modal state (moved here so it persists across Header re-renders)
  const [showSubmissionModal, setShowSubmissionModal] = useState(false);
  const [nextTask, setNextTask] = useState<Task | null>(null);
  const [isLoadingNextTask, setIsLoadingNextTask] = useState(false);

  // Keyboard shortcuts help modal
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Submission modal navigation handlers
  const handleOpenNextTask = useCallback(() => {
    if (nextTask) {
      setShowSubmissionModal(false);
      // Use window.location to force full page reload - necessary because
      // React Router doesn't remount the component when only taskId changes
      window.location.href = `/tasks/${nextTask.id}`;
    }
  }, [nextTask]);

  const handleGoToTaskList = useCallback(() => {
    setShowSubmissionModal(false);
    navigate('/my-tasks');
  }, [navigate]);

  // QA Mode state
  const isQAMode = useIsQAMode();
  const { showRejectionModal, rejectionAnnotationId, setFrameNavigationCallbacks, flagMissingObject } = useQAStore();

  // Check if user has QA review permissions (not annotators)
  const { canReviewQA } = useAuthStore();
  const userCanReviewQA = canReviewQA();

  // Effective QA mode: only true if both isQAMode AND user has permission
  const effectiveQAMode = isQAMode && userCanReviewQA;

  // False negative flagging state
  const [falseNegativeLocation, setFalseNegativeLocation] = useState<{ x: number; y: number; z: number } | null>(null);
  const [showFalseNegativeModal, setShowFalseNegativeModal] = useState(false);

  // Auto-save annotations every 2 seconds with auto-refresh
  const { isSaving: isAutoSaving, lastSavedAt, lastError: autoSaveError } = useAutoSave({
    interval: 2000, // 2 seconds
    enabled: true,
    autoRefresh: true,
    taskId: taskId,
    onSaveError: (error) => console.error('[AutoSave] Auto-save failed:', error),
  });

  const {
    setTask,
    setScene,
    setTaxonomy,
    setFrames,
    setAnnotations,
    mergeAnnotationsFromServer,
    lidarView,
    selection,
    taxonomy,
    nextFrame,
    selectAnnotation,
    frames,
    goToFrame,
    deselectAll,
  } = useEditorStore();

  // Wrapper for setViewMode that clears 3D selection when switching to 2D tab
  const setViewMode = useCallback((mode: ViewMode) => {
    if (mode === '2d') {
      // Clear 3D annotation selection when switching to 2D mode
      // This closes the 3D properties panel
      deselectAll();
    }
    setViewModeInternal(mode);
  }, [deselectAll]);

  // Opens the camera image view (no projected lidar points) in the same inline 3D canvas
  const openCameraImageView = useCallback((cameraId: string) => {
    useEditorStore.getState().activateCameraView(cameraId);
    // After activating, switch to imageOnlyMode (no projected points)
    useEditorStore.getState().setLidarView({
      cameraView: {
        ...useEditorStore.getState().lidarView.cameraView,
        imageOnlyMode: true,
      },
    });
  }, []);

  // Get selected annotations for visibility computation
  const selectedAnnotations = useSelectedAnnotations();

  // Get selected cuboid data for projection
  const selectedCuboid = useMemo<CuboidData | null>(() => {
    if (selectedAnnotations.length === 0) return null;
    const ann = selectedAnnotations[0];
    if (ann.type !== 'cuboid') return null;
    const data = ann.data as CuboidData;
    if (!data?.center || !data?.dimensions) return null;
    return data;
  }, [selectedAnnotations]);

  // Get class color for selected annotation (memoized to avoid re-renders)
  const selectedClassColor = useMemo(() => {
    if (selectedAnnotations.length === 0) return '#00ff00';
    const ann = selectedAnnotations[0];
    const classDef = taxonomy?.classes.find((c) => c.id === ann.class_id);
    return classDef?.color || '#00ff00';
  }, [selectedAnnotations, taxonomy]);

  // Auto-show/hide ortho views based on selection
  useEffect(() => {
    setShowOrthoViews(selection.selectedAnnotationIds.length > 0);
  }, [selection.selectedAnnotationIds]);

  useEffect(() => {
    if (!showOrthoViews || selection.selectedAnnotationIds.length === 0 || viewMode === '2d') {
      setActiveOrthoView(null);
    }
  }, [showOrthoViews, selection.selectedAnnotationIds.length, viewMode]);

  // Set QA navigation callbacks for auto-advance feature
  useEffect(() => {
    if (effectiveQAMode) {
      setFrameNavigationCallbacks(nextFrame, selectAnnotation);
    }
  }, [effectiveQAMode, nextFrame, selectAnnotation, setFrameNavigationCallbacks]);

  // Handler to jump to a specific annotation (used by QASidebar for AI suggestions)
  // Enhanced to support zoom level for the new Track QA Panel
  const focusOnAnnotation = useEditorStore(s => s.focusOnAnnotation);
  const handleJumpToAnnotation = useCallback((annotationId: string, frameId?: string, _zoomLevel?: number) => {

    // If frame is specified, navigate to it first
    if (frameId && frames.length > 0) {
      const frameIndex = frames.findIndex(f => f.id === frameId);
      if (frameIndex !== -1) {
        goToFrame(frameIndex);
        // Poll for the annotation to appear in the store (annotations load async per-frame)
        // Check every 100ms up to 3 seconds
        let attempts = 0;
        const maxAttempts = 30;
        const pollInterval = setInterval(() => {
          attempts++;
          const storeAnnotations = useEditorStore.getState().annotations;
          if (storeAnnotations.has(annotationId)) {
            clearInterval(pollInterval);
            selectAnnotation(annotationId);
            focusOnAnnotation(annotationId);
          } else if (attempts >= maxAttempts) {
            clearInterval(pollInterval);
            // Fallback: try to select anyway (annotation might exist under different ID)
            selectAnnotation(annotationId);
            focusOnAnnotation(annotationId);
            console.warn('[QA] Annotation not found after polling:', annotationId.slice(0, 8));
          }
        }, 100);
        return;
      } else {
        console.warn('[QA] Frame not found in frames list:', frameId);
      }
    }
    // Select and focus annotation immediately if no frame change needed
    selectAnnotation(annotationId);
    focusOnAnnotation(annotationId);
  }, [frames, goToFrame, selectAnnotation, focusOnAnnotation]);

  // Handler to select a track (used by Track QA Panel)
  // Note: This uses store directly to avoid block-scoped variable issues
  const handleSelectTrack = useCallback((trackId: string) => {
    // Get annotations from store (it's a Map)
    const storeAnnotations = useEditorStore.getState().annotations;
    // Find first annotation with this track ID
    let trackAnnotation: Annotation | undefined;
    for (const ann of storeAnnotations.values()) {
      if (ann.track_id === trackId || ann.id === trackId) {
        trackAnnotation = ann;
        break;
      }
    }
    if (trackAnnotation) {
      // Navigate to its frame and select it
      handleJumpToAnnotation(trackAnnotation.id, trackAnnotation.frame_id);
    }
  }, [handleJumpToAnnotation]);

  // Handler for when user clicks on point cloud to flag missing annotation
  const handleFlagMissingLocation = useCallback((location: { x: number; y: number; z: number }) => {
    setFalseNegativeLocation(location);
    setShowFalseNegativeModal(true);
  }, []);

  // Handler for when user confirms flagging a false negative
  const handleFlagFalseNegative = useCallback(async (classId?: string, message?: string) => {
    if (!falseNegativeLocation) return;

    const { currentFrameIndex, frames } = useEditorStore.getState();
    const currentFrame = frames[currentFrameIndex];
    if (!currentFrame) return;

    try {
      await flagMissingObject({
        frameId: currentFrame.id,
        location: falseNegativeLocation,
        suggestedClass: classId,
        message,
      });
      setShowFalseNegativeModal(false);
      setFalseNegativeLocation(null);
    } catch (error) {
      console.error('[QA] Failed to flag false negative:', error);
    }
  }, [falseNegativeLocation, flagMissingObject]);

  // Handler for creating an annotation directly from the modal
  const handleCreateAnnotationDirectly = useCallback(async (classId: string) => {
    if (!falseNegativeLocation) return;

    const { createAnnotation, activeClassId, taxonomy } = useEditorStore.getState();
    const finalClassId = classId || activeClassId || taxonomy?.classes[0]?.id;

    if (!finalClassId) {
      console.error('[QA] No class selected for new annotation');
      return;
    }

    const [length, width, height] = getDefaultCuboidDimensions(finalClassId, taxonomy);

    // Create a default cuboid at the clicked location
    const defaultCuboid: CuboidData = {
      center: { x: falseNegativeLocation.x, y: falseNegativeLocation.y, z: falseNegativeLocation.z },
      dimensions: { length, width, height },
      rotation: { yaw: 0, pitch: 0, roll: 0 },
    };

    // Create the annotation with the correct API
    createAnnotation({
      type: 'cuboid',
      data: defaultCuboid,
      class_id: finalClassId,
      source: 'qa_correction',
    });

    setShowFalseNegativeModal(false);
    setFalseNegativeLocation(null);
  }, [falseNegativeLocation]);

  // Data fetching
  const { data: task, isLoading: loadingTask } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => taskApi.get(taskId!),
    enabled: !!taskId,
    staleTime: 0, // Always refetch to get latest stage (important after submission)
    refetchOnMount: 'always', // Ensure fresh data when component mounts
  });

  // === Revision mode: fetch QA review data for locked annotations ===
  const isRevisionTask = !!(task && task.revision_count > 0 && task.stage === 'annotation');

  const { data: revisionReviews } = useQuery({
    queryKey: ['qa-reviews-for-revision', task?.id],
    queryFn: () => qaApi.getTaskReviews(task!.id),
    enabled: isRevisionTask,
    staleTime: 5 * 60 * 1000,
  });

  const latestRevisionReviewId = useMemo(() => {
    if (!revisionReviews?.length) return null;
    const sorted = [...revisionReviews].sort((a, b) =>
      new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime()
    );
    return sorted[0]?.id || null;
  }, [revisionReviews]);

  const { data: revisionAnnotationReviews } = useQuery({
    queryKey: ['qa-annotation-reviews-revision', latestRevisionReviewId],
    queryFn: () => qaApi.getAnnotationReviews(latestRevisionReviewId!),
    enabled: !!latestRevisionReviewId,
    staleTime: 5 * 60 * 1000,
  });

  // Get QA store annotation reviews (for current QA session approved annotations)
  const qaAnnotationReviews = useQAStore(s => s.annotationReviews);

  // Set of locked (QA-approved) annotation IDs — used by keyboard handler
  // Includes both: revision mode approved annotations AND QA mode approved annotations
  const lockedAnnotationIds = useMemo(() => {
    const set = new Set<string>();
    // Add revision mode approved annotations
    if (revisionAnnotationReviews) {
      for (const review of revisionAnnotationReviews) {
        if (review.verdict === 'approved') {
          set.add(review.annotation_id);
        }
      }
    }
    // Add QA mode approved annotations (from current QA session)
    if (effectiveQAMode && qaAnnotationReviews.size > 0) {
      qaAnnotationReviews.forEach((review, annotationId) => {
        if (review.verdict === 'approved') {
          set.add(annotationId);
        }
      });
    }
    return set;
  }, [revisionAnnotationReviews, effectiveQAMode, qaAnnotationReviews]);

  // Ref so keyboard handler always has current locked IDs
  const lockedAnnotationIdsRef = useRef(lockedAnnotationIds);
  lockedAnnotationIdsRef.current = lockedAnnotationIds;

  // Multi-digit class hotkey selection: accumulate digits across keystrokes so
  // e.g. pressing '1' then '2' within 600ms selects class 12 (matches 2D editor).
  const pendingDigitRef = useRef<string>('');
  const pendingDigitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync locked annotation IDs to the store so ALL components (including store-level
  // updateAnnotation/deleteAnnotation) enforce the lock — not just keyboard handlers
  const setLockedAnnotationIds = useEditorStore(s => s.setLockedAnnotationIds);
  useEffect(() => {
    setLockedAnnotationIds(lockedAnnotationIds);
  }, [lockedAnnotationIds, setLockedAnnotationIds]);

  // Auto-set annotation color mode to show QA verdicts for revision tasks
  const setAnnotationColorMode = useEditorStore(s => s.setAnnotationColorMode);
  useEffect(() => {
    if (isRevisionTask && revisionAnnotationReviews && revisionAnnotationReviews.length > 0) {
      // Force QA status color mode so annotations are colored by verdict
      setAnnotationColorMode('qa_status');
      console.log('[Revision] Auto-set color mode to qa_status, reviews:', revisionAnnotationReviews.length);
    }
  }, [isRevisionTask, revisionAnnotationReviews, setAnnotationColorMode]);

  const { data: scene } = useQuery({
    queryKey: ['scene', task?.scene_id],
    queryFn: () => sceneApi.get(task!.scene_id),
    enabled: !!task?.scene_id,
    staleTime: 0, // Always refetch to get latest selected_taxonomy_id
  });

  const { data: dataset } = useQuery({
    queryKey: ['dataset', scene?.dataset_id],
    queryFn: () => datasetApi.get(scene!.dataset_id),
    enabled: !!scene?.dataset_id,
  });

  // Fetch linked taxonomies (fallback if embedded taxonomy is empty)
  const { data: linkedTaxonomies } = useQuery({
    queryKey: ['dataset-taxonomies', scene?.dataset_id],
    queryFn: () => datasetApi.getTaxonomies(scene!.dataset_id),
    enabled: !!scene?.dataset_id,
  });

  // Get primary taxonomy for current annotation mode tab
  const { data: primaryTaxonomyForMode } = useQuery({
    queryKey: ['dataset-primary-taxonomy', scene?.dataset_id, annotationModeTab],
    queryFn: () => taxonomyApi.getForDataset(scene!.dataset_id, annotationModeTab, true).then(arr => arr[0] || null),
    enabled: !!scene?.dataset_id,
  });

  // Get the selected taxonomy for this scene (if set)
  const { data: selectedTaxonomy } = useQuery({
    queryKey: ['taxonomy', scene?.selected_taxonomy_id],
    queryFn: () => taxonomyApi.get(scene!.selected_taxonomy_id!),
    enabled: !!scene?.selected_taxonomy_id,
  });

  // Mutation to update scene's selected taxonomy (for auto-setting from URL param)
  const autoSetTaxonomyMutation = useMutation({
    mutationFn: ({ sceneId, taxonomyId }: { sceneId: string; taxonomyId: string | null }) =>
      sceneApi.updateSelectedTaxonomy(sceneId, taxonomyId),
    onSuccess: (updatedScene: any) => {
      // Update scene in editor store
      setScene(updatedScene);
      // Invalidate scene query to refresh
      queryClient.invalidateQueries({ queryKey: ['scene', scene?.id] });
      // Also invalidate annotation queries so they reload with new taxonomy filter
      queryClient.invalidateQueries({ queryKey: ['annotations'] });
      queryClient.invalidateQueries({ queryKey: ['all-3d-annotations'] });
      // Clear annotations from store so fresh ones are loaded
      setAnnotations([]);
      // NOTE: We intentionally do NOT clear the URL param here
      // because that would affect browser history and break the back button
    },
  });

  // Auto-set taxonomy from URL param when scene loads
  useEffect(() => {
    if (!scene?.id || !urlTaxonomyId) return;
    // Only auto-set if different from current selection
    if (scene.selected_taxonomy_id === urlTaxonomyId) {
      // Already matches, nothing to do
      return;
    }
    // Wait for linkedTaxonomies to load before checking
    // If linkedTaxonomies is undefined, we're still loading - wait
    if (linkedTaxonomies === undefined) {
      return;
    }
    // Verify the taxonomy is linked to this dataset
    if (linkedTaxonomies.length > 0 && !linkedTaxonomies.some(t => t.id === urlTaxonomyId)) {
      console.warn('[FusionEditorV2] URL taxonomy not linked to dataset:', urlTaxonomyId);
      return;
    }
    autoSetTaxonomyMutation.mutate({ sceneId: scene.id, taxonomyId: urlTaxonomyId });
  }, [scene?.id, scene?.selected_taxonomy_id, urlTaxonomyId, linkedTaxonomies]);

  // Redirect to segmentation editor if active taxonomy is segmentation_3d
  useEffect(() => {
    if (!taskId || !linkedTaxonomies || linkedTaxonomies.length === 0) return;

    // Determine which taxonomy to check: URL param > scene selected > first
    const activeTaxonomyId = urlTaxonomyId || scene?.selected_taxonomy_id;
    if (!activeTaxonomyId) return;

    const activeTaxonomy = linkedTaxonomies.find(t => t.id === activeTaxonomyId);
    if (activeTaxonomy?.annotation_mode === 'segmentation_3d') {
      console.log('[FusionEditorV2] Active taxonomy is segmentation_3d, redirecting to segmentation editor');
      navigate(`/tasks/${taskId}/segmentation?taxonomy=${activeTaxonomyId}`, { replace: true });
    }
  }, [taskId, urlTaxonomyId, scene?.selected_taxonomy_id, linkedTaxonomies, navigate]);

  // Get per-taxonomy workflow status when a taxonomy is selected
  const { data: taxonomyWorkflowInfo } = useQuery({
    queryKey: ['workflow-info', taskId, scene?.selected_taxonomy_id],
    queryFn: () => workflowApi.getInfo(taskId!, scene!.selected_taxonomy_id!),
    enabled: !!taskId && !!scene?.selected_taxonomy_id,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Effective stage/status: use per-taxonomy status if available, otherwise global task status
  const effectiveStage = taxonomyWorkflowInfo?.stage ?? task?.stage ?? 'annotation';
  const effectiveStatus = taxonomyWorkflowInfo?.status ?? task?.status ?? 'pending';
  const effectiveRevisionCount = taxonomyWorkflowInfo?.revision_count ?? task?.revision_count ?? 0;

  // Detect if scene has LiDAR data (video-only scenes won't have it)
  const hasLidarData = useMemo(() => {
    const hasLidarBase = Boolean(scene?.storage_paths?.lidar_base);
    const isVideoScene = (scene?.metadata as Record<string, unknown>)?.source === 'video_upload';
    console.log('[HasLidarData]', { hasLidarBase, isVideoScene, storagePaths: scene?.storage_paths });
    return hasLidarBase && !isVideoScene;
  }, [scene]);

  // Compute available annotation modes based on linked taxonomies
  // Each taxonomy has an annotation_mode property ('fusion_3d' or '2d_only')
  // Also considers whether scene has LiDAR data
  const availableModes = useMemo(() => {
    const modes = { fusion_3d: false, '2d_only': false };

    console.log('[AvailableModes] Computing modes', {
      linkedTaxonomies: linkedTaxonomies?.length || 0,
      hasDatasetTaxonomy: !!dataset?.taxonomy?.classes?.length,
      hasLidarData,
    });

    // If scene has no LiDAR data (e.g., video import), only allow 2D mode
    if (!hasLidarData && scene) {
      console.log('[AvailableModes] No LiDAR data (video/2D scene), forcing 2d_only mode');
      modes['2d_only'] = true;
      return modes;
    }

    // Check linked taxonomies for their annotation modes
    if (linkedTaxonomies && linkedTaxonomies.length > 0) {
      for (const taxonomy of linkedTaxonomies) {
        console.log('[AvailableModes] Taxonomy mode:', taxonomy.annotation_mode, taxonomy.name);
        if (taxonomy.annotation_mode === 'fusion_3d') {
          modes.fusion_3d = true;
        } else if (taxonomy.annotation_mode === '2d_only') {
          modes['2d_only'] = true;
        }
      }
    }

    // Fallback: if no linked taxonomies, check embedded taxonomy (legacy support)
    // Assume embedded taxonomy is fusion_3d mode by default
    if (!modes.fusion_3d && !modes['2d_only'] && dataset?.taxonomy?.classes && dataset.taxonomy.classes.length > 0) {
      console.log('[AvailableModes] Using embedded taxonomy, defaulting to fusion_3d');
      modes.fusion_3d = true;
    }

    // Default: if still nothing, enable fusion_3d to allow creating annotations
    // Only use this default if taxonomies have actually loaded (not null/undefined)
    if (!modes.fusion_3d && !modes['2d_only'] && linkedTaxonomies !== undefined) {
      console.log('[AvailableModes] No taxonomies found, defaulting to fusion_3d');
      modes.fusion_3d = true;
    }

    console.log('[AvailableModes] Final modes:', modes);
    return modes;
  }, [linkedTaxonomies, dataset, hasLidarData, scene]);

  // Auto-start the appropriate editor tour based on available modes
  const { completedTours, isTourRunning, startTour } = useOnboardingStore();
  const tourStartedRef = useRef(false);

  useEffect(() => {
    // Only trigger once per session, when available modes are determined
    if (tourStartedRef.current || isTourRunning) return;
    if (!availableModes.fusion_3d && !availableModes['2d_only']) return;

    // Determine which tour to show based on available modes
    const is2DOnly = availableModes['2d_only'] && !availableModes.fusion_3d;
    const tourId = is2DOnly ? 'editor_2d' : 'editor_3d';

    // Check if this tour hasn't been completed yet
    if (!completedTours.includes(tourId)) {
      tourStartedRef.current = true;
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        startTour(tourId);
      }, 1000);
    }
  }, [availableModes, completedTours, isTourRunning, startTour]);

  const { data: framesData } = useQuery({
    queryKey: ['task-frames', taskId],
    queryFn: () => taskApi.getFrames(taskId!),
    enabled: !!taskId,
  });

  // Load ALL 3D annotations for the task — shared cache key with PropertiesPanel's query.
  // Used here to pre-populate track.frame_annotations so backward interpolation works correctly.
  // When a scene has selected_taxonomy_id, only load annotations for that taxonomy.
  const selectedTaxonomyId = scene?.selected_taxonomy_id;

  // IMPORTANT: Don't load annotations until taxonomy from URL is properly set
  // This prevents loading all annotations and then filtering later
  const taxonomyReady = !urlTaxonomyId || (scene?.selected_taxonomy_id === urlTaxonomyId);

  const { data: annotationSummary } = useQuery({
    queryKey: ['annotations-3d-summary', taskId, selectedTaxonomyId],
    queryFn: async () => {
      if (!taskId) return [];
      return annotation3DApi.summary(taskId, selectedTaxonomyId || undefined);
    },
    enabled: !!taskId && !!scene && taxonomyReady,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  const { data: allTaskAnnotations } = useQuery({
    queryKey: ['all-3d-annotations', taskId, selectedTaxonomyId],
    queryFn: async () => {
      if (!taskId) return [];
      return annotation3DApi.list(taskId, undefined, undefined, selectedTaxonomyId || undefined);
    },
    // Deferred until summary loads so the editor is interactive first
    enabled: !!taskId && !!scene && taxonomyReady && !!annotationSummary,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: false,
  });

  // Get current frame from store
  const currentFrame = useEditorStore((s) => s.currentFrame);

  const { data: annotations } = useQuery({
    queryKey: ['annotations', taskId, currentFrame?.id, selectedTaxonomyId],
    queryFn: async (): Promise<any[]> => {
      if (!taskId || !currentFrame?.id) return [];
      try {
        // Load annotations only for the current frame
        // Filter by taxonomy if scene has selected_taxonomy_id
        const [legacy, ann2d, ann3d] = await Promise.all([
          annotationApi.list({ taskId, frameId: currentFrame.id, taxonomyId: selectedTaxonomyId || undefined }).catch(() => []),
          annotation2DApi.list(taskId, currentFrame.id, undefined, undefined, selectedTaxonomyId || undefined).catch(() => []),
          annotation3DApi.list(taskId, currentFrame.id, undefined, selectedTaxonomyId || undefined).catch(() => [])
        ]);

        // Combine all annotations - they have different schemas but editor handles both
        return [...legacy, ...ann2d, ...ann3d] as any[];
      } catch (e) {
        console.error('Failed to load annotations:', e);
        return [];
      }
    },
    // Wait for scene to load AND taxonomy to be ready
    enabled: !!taskId && !!currentFrame?.id && !!scene && taxonomyReady,
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
    gcTime: 10 * 60 * 1000,   // Keep in memory for 10 minutes
    refetchOnMount: false,    // Don't refetch when component mounts
    refetchOnWindowFocus: false, // Don't refetch on window focus
  });

  // Build full lidar path from scene storage_paths and frame file_paths
  const lidarFilePath = useMemo(() => {
    if (!scene?.storage_paths?.lidar_base || !currentFrame?.file_paths?.lidar) {
      return null;
    }
    // Combine base path with filename (e.g., "scenes/scene_001/lidar" + "000000.pcd")
    const base = scene.storage_paths.lidar_base.replace(/\/$/, ''); // Remove trailing slash
    const filename = currentFrame.file_paths.lidar;
    return `${base}/${filename}`;
  }, [scene?.storage_paths?.lidar_base, currentFrame?.file_paths?.lidar]);

  // Track the currently displayed frame index (the frame whose data is actually loaded)
  const [displayedFrameIndex, setDisplayedFrameIndex] = useState(0);
  const currentFrameIndex = useEditorStore((s) => s.currentFrameIndex);

  // Load LiDAR data for the current frame (check cache first)
  // Skip LiDAR loading for 2D-only tasks (only fetch if fusion_3d mode is available)
  const getCached = useLidarCacheStore((s) => s.getCached);

  const { data: lidarData, isLoading: loadingLidar, isFetching: fetchingLidar } = useQuery({
    queryKey: ['lidar', lidarFilePath],
    queryFn: async () => {
      if (!lidarFilePath) return null;

      // Check cache first for instant load
      const cached = getCached(lidarFilePath);
      if (cached) {
        return cached;
      }

      // Fall back to API
      const response = await dataApi.getLidarData(lidarFilePath);
      return response;
    },
    enabled: !!lidarFilePath && availableModes.fusion_3d, // Only fetch if 3D mode is available
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes (prefetch handles the data)
    gcTime: 10 * 60 * 1000,   // Keep in memory for 10 minutes
    placeholderData: (previousData: PointCloudResponse | null | undefined) => previousData, // Keep previous data while loading new
  });

  // Update displayed frame when LiDAR loads (for 3D) or immediately (for 2D)
  // Camera images load asynchronously from cache and will update independently
  useEffect(() => {
    if (availableModes.fusion_3d) {
      // 3D mode: wait for LiDAR data to load (images load from cache asynchronously)
      if (lidarData && !fetchingLidar) {
        setDisplayedFrameIndex(currentFrameIndex);
      }
    } else {
      // 2D-only mode: update immediately
      setDisplayedFrameIndex(currentFrameIndex);
    }
  }, [lidarData, fetchingLidar, currentFrameIndex, availableModes.fusion_3d]);

  // Buffer to hold the last valid point cloud for seamless transitions
  const lastValidPointCloudRef = useRef<PointCloudData | null>(null);

  // Convert API response to PointCloudData format
  // MEMORY OPTIMIZATION: Avoid copying if data is already Float32Array
  const pointCloudData = useMemo<PointCloudData | undefined>(() => {
    if (!lidarData) {
      // Return the last valid point cloud during loading to prevent flicker
      return lastValidPointCloudRef.current ?? undefined;
    }
    // Check if data is already Float32Array (from cache) to avoid copying
    const positions = lidarData.positions instanceof Float32Array
      ? lidarData.positions
      : new Float32Array(lidarData.positions);
    const intensities = lidarData.intensities instanceof Float32Array
      ? lidarData.intensities
      : new Float32Array(lidarData.intensities);
    const newPointCloud = {
      positions,
      intensities,
      pointCount: lidarData.pointCount,
    };
    // Store as the last valid point cloud for seamless transitions
    lastValidPointCloudRef.current = newPointCloud;
    return newPointCloud;
  }, [lidarData]);

  // Sync to store
  useEffect(() => { if (task) setTask(task); }, [task, setTask]);
  useEffect(() => { if (scene) setScene(scene); }, [scene, setScene]);

  // Clear selection when loading a new task (prevents auto-selected state from previous QA session)
  const previousTaskIdRef = useRef<string | null>(null);
  const previousTaxonomyIdRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (taskId && taskId !== previousTaskIdRef.current) {
      deselectAll();
      previousTaskIdRef.current = taskId;
    }
  }, [taskId, deselectAll]);

  // Set taxonomy based on annotation mode tab:
  // Priority: 1) Scene's selected taxonomy, 2) Mode-specific primary taxonomy, 3) Embedded taxonomy, 4) First linked taxonomy
  useEffect(() => {
    // Debug log the incoming taxonomy data
    console.log('[FusionEditorV2] Setting taxonomy from:', {
      hasSelectedTaxonomy: !!selectedTaxonomy,
      selectedTaxonomyId: scene?.selected_taxonomy_id,
      hasPrimaryTaxonomy: !!primaryTaxonomyForMode,
      primarySharedAttrs: primaryTaxonomyForMode?.shared_attributes,
      hasDatasetTaxonomy: !!dataset?.taxonomy,
      datasetSharedAttrs: dataset?.taxonomy?.shared_attributes,
      linkedCount: linkedTaxonomies?.length,
    });

    // 1. TOP PRIORITY: Use scene's selected taxonomy if set
    if (selectedTaxonomy?.classes && selectedTaxonomy.classes.length > 0) {
      const taxonomyConfig = {
        classes: selectedTaxonomy.classes || [],
        skeletons: selectedTaxonomy.skeletons || {},
        annotation_rules: selectedTaxonomy.annotation_rules || {
          min_points_polyline: 2,
          min_points_polygon: 3,
          allow_overlapping_boxes: false,
          require_track_id: false,
        },
        shared_attributes: selectedTaxonomy.shared_attributes || [],
      };
      console.log('[FusionEditorV2] Using SELECTED taxonomy:', selectedTaxonomy.name, taxonomyConfig.shared_attributes);
      setTaxonomy(taxonomyConfig);
      return;
    }

    // 2. Try to use mode-specific primary taxonomy
    if (primaryTaxonomyForMode?.classes && primaryTaxonomyForMode.classes.length > 0) {
      const taxonomyConfig = {
        classes: primaryTaxonomyForMode.classes || [],
        skeletons: primaryTaxonomyForMode.skeletons || {},
        annotation_rules: primaryTaxonomyForMode.annotation_rules || {
          min_points_polyline: 2,
          min_points_polygon: 3,
          allow_overlapping_boxes: false,
          require_track_id: false,
        },
        shared_attributes: primaryTaxonomyForMode.shared_attributes || [],
      };
      console.log('[FusionEditorV2] Using primary taxonomy with shared_attributes:', taxonomyConfig.shared_attributes);
      setTaxonomy(taxonomyConfig);
      return;
    }

    // 2. Fall back to embedded taxonomy if it has classes (for legacy/unassigned mode datasets).
    //    The embedded snapshot on dataset.taxonomy often serializes shared_attributes
    //    as an empty array (not undefined) — so check length, not just nullishness,
    //    before falling back to the linked taxonomy's shared_attributes.
    if (dataset?.taxonomy?.classes && dataset.taxonomy.classes.length > 0) {
      const embeddedShared = dataset.taxonomy.shared_attributes ?? [];
      const linkedShared = linkedTaxonomies?.[0]?.shared_attributes ?? [];
      const effectiveShared = embeddedShared.length > 0 ? embeddedShared : linkedShared;
      setTaxonomy({
        ...dataset.taxonomy,
        shared_attributes: effectiveShared,
      });
      return;
    }

    // 3. Fall back to first linked taxonomy's classes
    if (linkedTaxonomies && linkedTaxonomies.length > 0) {
      const firstLinkedTaxonomy = linkedTaxonomies[0];
      setTaxonomy({
        classes: firstLinkedTaxonomy.classes || [],
        skeletons: firstLinkedTaxonomy.skeletons || {},
        annotation_rules: firstLinkedTaxonomy.annotation_rules || {
          min_points_polyline: 2,
          min_points_polygon: 3,
          allow_overlapping_boxes: false,
          require_track_id: false,
        },
        shared_attributes: firstLinkedTaxonomy.shared_attributes || [],
      });
    }
  }, [dataset, linkedTaxonomies, primaryTaxonomyForMode, selectedTaxonomy, scene?.selected_taxonomy_id, annotationModeTab, setTaxonomy]);

  // Auto-switch annotation mode tab and view mode when available modes change or annotation mode tab changes
  useEffect(() => {
    // Skip auto-switch when user explicitly opened the camera image view
    if (cameraImageViewRef.current) {
      cameraImageViewRef.current = false;
      return;
    }
    // Auto-switch annotation mode tab if current mode is not available
    if (annotationModeTab === 'fusion_3d' && !availableModes.fusion_3d && availableModes['2d_only']) {
      setAnnotationModeTab('2d_only');
    } else if (annotationModeTab === '2d_only' && !availableModes['2d_only'] && availableModes.fusion_3d) {
      setAnnotationModeTab('fusion_3d');
    }

    // Auto-switch view mode based on current annotation mode tab
    // 3D/Fusion mode: only 3D, Fusion, 4D views allowed
    // 2D Only mode: only 2D view allowed
    const is3DView = viewMode === '3d' || viewMode === 'fusion' || viewMode === '4d';
    const is2DView = viewMode === '2d';

    // If in 3D/Fusion mode but viewing 2D, switch to 3D
    if (annotationModeTab === 'fusion_3d' && is2DView) {
      setViewModeInternal('3d');
    }
    // If in 2D Only mode but viewing 3D/Fusion/4D, switch to 2D
    else if (annotationModeTab === '2d_only' && is3DView) {
      setViewModeInternal('2d');
    }
    // Fallback: if mode not available, switch view accordingly
    else if (is3DView && !availableModes.fusion_3d && availableModes['2d_only']) {
      setViewModeInternal('2d');
    } else if (is2DView && !availableModes['2d_only'] && availableModes.fusion_3d) {
      setViewModeInternal('3d');
    }
  }, [availableModes, annotationModeTab, viewMode]);

  useEffect(() => { if (framesData?.frames) setFrames(framesData.frames); }, [framesData, setFrames]);

  // Pre-populate editorStore with ALL task annotations when they first load.
  // This ensures track.frame_annotations has entries for ALL frames (not just visited ones),
  // so that backward interpolation (Segment 0: trackStartIdx < firstKf.frameIdx) works correctly.
  useEffect(() => {
    if (!allTaskAnnotations?.length) return;
    // Skip if we already processed this taxonomy (prevents re-merging stale data)
    if (lastSyncedTaxonomyIdRef.current === selectedTaxonomyId && lastSyncedFrameIdRef.current !== null) return;

    // CRITICAL: Filter annotations to only include those matching current taxonomy
    // When a specific taxonomy is selected, ONLY show annotations with that taxonomy_id
    // When no taxonomy is selected (null), show all annotations (including those with null taxonomy_id)
    const filteredAnnotations = selectedTaxonomyId
      ? (allTaskAnnotations as any[]).filter((ann: any) => ann.taxonomy_id === selectedTaxonomyId)
      : (allTaskAnnotations as any[]);

    console.log('[FusionEditorV2] Merging allTaskAnnotations:', {
      total: allTaskAnnotations.length,
      filtered: filteredAnnotations.length,
      taxonomyId: selectedTaxonomyId
    });

    mergeAnnotationsFromServer(filteredAnnotations, '');
    lastSyncedTaxonomyIdRef.current = selectedTaxonomyId;
  }, [allTaskAnnotations, mergeAnnotationsFromServer, selectedTaxonomyId]);

  // Sync annotations from React Query to Zustand when frame changes
  // ALWAYS use mergeAnnotationsFromServer to preserve annotations from other frames
  useEffect(() => {
    if (!annotations || !currentFrame?.id) {
      return;
    }

    // Skip if already synced for this frame AND same taxonomy (prevents duplicate syncs)
    if (lastSyncedFrameIdRef.current === currentFrame.id && lastSyncedTaxonomyIdRef.current === selectedTaxonomyId) {
      return;
    }

    // CRITICAL: Filter annotations to only include those matching current taxonomy
    // When a specific taxonomy is selected, ONLY show annotations with that taxonomy_id
    // When no taxonomy is selected (null), show all annotations (including those with null taxonomy_id)
    const filteredAnnotations = selectedTaxonomyId
      ? (annotations as any[]).filter((ann: any) => ann.taxonomy_id === selectedTaxonomyId)
      : (annotations as any[]);

    console.log('[FusionEditorV2] Merging frame annotations:', {
      frameId: currentFrame.id,
      total: annotations.length,
      filtered: filteredAnnotations.length,
      taxonomyId: selectedTaxonomyId
    });

    // Always merge to preserve annotations from other frames
    // This is essential for track/interpolation to work across frames
    mergeAnnotationsFromServer(filteredAnnotations, currentFrame.id);

    lastSyncedFrameIdRef.current = currentFrame.id;
    lastSyncedTaxonomyIdRef.current = selectedTaxonomyId;
  }, [annotations, currentFrame?.id, mergeAnnotationsFromServer, selectedTaxonomyId]);

  // Prefetch all LiDAR frames and camera images when scene and frames are loaded
  // Skip LiDAR prefetch for 2D-only tasks (only prefetch if fusion_3d mode is available)
  // IMPORTANT: Wait for linkedTaxonomies to load to avoid race condition
  const startLidarPrefetch = useLidarCacheStore((s) => s.startPrefetch);
  const prefetchAroundFrame = useLidarCacheStore((s) => s.prefetchAround);
  const startImagePrefetch = useImageCacheStore((s) => s.startPrefetch);
  const prefetchCurrentFrameIndex = useEditorStore((s) => s.currentFrameIndex);

  // Initial prefetch: only load frames around the starting position (±10).
  // This makes the editor usable in seconds instead of waiting for the whole scene.
  useEffect(() => {
    if (!scene || !framesData?.frames || framesData.frames.length === 0 || linkedTaxonomies === undefined) return;

    if (availableModes.fusion_3d) {
      const INITIAL_WINDOW = 10;
      const lo = Math.max(0, prefetchCurrentFrameIndex - INITIAL_WINDOW);
      const hi = Math.min(framesData.frames.length, prefetchCurrentFrameIndex + INITIAL_WINDOW + 1);
      const initialFrames = framesData.frames.slice(lo, hi);
      startLidarPrefetch(scene, initialFrames);
    }

    startImagePrefetch(scene, framesData.frames, prefetchCurrentFrameIndex);
  }, [scene, framesData?.frames, linkedTaxonomies, startLidarPrefetch, startImagePrefetch, availableModes.fusion_3d]);

  // Rolling prefetch: as the user navigates, quietly load ±10 frames around the new position.
  useEffect(() => {
    if (!scene || !framesData?.frames || !availableModes.fusion_3d) return;
    prefetchAroundFrame(scene, framesData.frames, prefetchCurrentFrameIndex, 10);
  }, [prefetchCurrentFrameIndex, scene, framesData?.frames, availableModes.fusion_3d, prefetchAroundFrame]);

  // Load 4D annotations when task is available
  const loadAnnotations4D = useAnnotation4DStore((s) => s.loadAnnotations4D);
  useEffect(() => {
    if (taskId) {

      loadAnnotations4D(taskId);
    }
  }, [taskId, loadAnnotations4D]);

  // Notify backend that editor was opened (triggers auto-transitions like assigned -> in_progress)

  // Clear annotations when selected taxonomy changes
  // This ensures old annotations from a different taxonomy are cleared
  const lastSyncedFrameIdRef = useRef<string | null>(null);
  const lastSyncedTaxonomyIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const prevTaxId = previousTaxonomyIdRef.current;
    const newTaxId = scene?.selected_taxonomy_id;

    // Only clear if taxonomy actually changed (not on initial load)
    if (prevTaxId !== undefined && prevTaxId !== newTaxId) {
      console.log('[FusionEditorV2] Taxonomy changed from', prevTaxId, 'to', newTaxId, '- clearing annotations');
      // Clear all 3D annotations from the store
      setAnnotations([]);
      // Clear all 2D annotations from the store
      useAnnotation2DStore.getState().clearAnnotations();
      // Reset synced frame refs so new annotations get merged
      lastSyncedFrameIdRef.current = null;
      lastSyncedTaxonomyIdRef.current = newTaxId;
      // Invalidate annotation queries so they refetch with new taxonomy filter
      queryClient.invalidateQueries({ queryKey: ['annotations', taskId] });
      queryClient.invalidateQueries({ queryKey: ['all-3d-annotations', taskId] });
      queryClient.invalidateQueries({ queryKey: ['annotations-2d', taskId] });
    }

    previousTaxonomyIdRef.current = newTaxId;
  }, [scene?.selected_taxonomy_id, taskId, setAnnotations, queryClient]);

  // Handler for accepting QA review
  const handleAcceptQA = useCallback(async () => {
    if (!task) return;

    // Get current taxonomy ID
    const currentTaxonomyId = scene?.selected_taxonomy_id;

    // Use effective stage/status for per-taxonomy workflow
    const stageToCheck = effectiveStage ?? task.stage;
    const statusToCheck = effectiveStatus ?? task.status;

    // Don't allow if task is already accepted or not in QA stage
    if (statusToCheck === 'accepted' || (stageToCheck !== 'qa' && stageToCheck !== 'customer_qa')) {
      console.warn('Task is already processed or not in QA stage', { stage: stageToCheck, status: statusToCheck });
      setShowQACompleteModal(false);
      navigate('/');
      return;
    }

    try {
      if (stageToCheck === 'qa') {
        // QA stage: Move to customer_qa
        await workflowApi.completeQAReview(task.id, true, undefined, currentTaxonomyId);
      } else if (stageToCheck === 'customer_qa') {
        // Customer QA stage: Mark as complete
        await workflowApi.completeCustomerReview(task.id, true, undefined, currentTaxonomyId);
      }

      // Close modal after success
      setShowQACompleteModal(false);

      // Refetch task to get updated stage/status
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['taxonomy-workflow', task.id] });
      // Navigate back to dashboard
      setTimeout(() => navigate('/'), 1000);
    } catch (err) {
      console.error('Failed to accept QA:', err);
      setShowQACompleteModal(false);
      // Show error to user
      alert('Failed to complete QA review. The task may have already been processed.');
      navigate('/');
    }
  }, [task, scene, queryClient, navigate, effectiveStage, effectiveStatus]);

  // Handler for rejecting QA review
  const handleRejectQA = useCallback(async (reason: string) => {
    if (!task) return;

    // Get current taxonomy ID
    const currentTaxonomyId = scene?.selected_taxonomy_id;

    // Use effective stage/status for per-taxonomy workflow
    const stageToCheck = effectiveStage ?? task.stage;
    const statusToCheck = effectiveStatus ?? task.status;

    // Don't allow if task is already processed or not in QA stage
    if (statusToCheck === 'accepted' || statusToCheck === 'rejected' || (stageToCheck !== 'qa' && stageToCheck !== 'customer_qa')) {
      console.warn('Task is already processed or not in QA stage', { stage: stageToCheck, status: statusToCheck });
      setShowQACompleteModal(false);
      navigate('/');
      return;
    }

    try {
      if (stageToCheck === 'qa') {
        // QA stage: Send back to annotator
        await workflowApi.completeQAReview(task.id, false, reason, currentTaxonomyId);
      } else if (stageToCheck === 'customer_qa') {
        // Customer QA stage: Send back to internal QA
        await workflowApi.completeCustomerReview(task.id, false, reason, currentTaxonomyId);
      }

      // Close modal after success
      setShowQACompleteModal(false);

      // Refetch task to get updated stage/status
      queryClient.invalidateQueries({ queryKey: ['task', task.id] });
      queryClient.invalidateQueries({ queryKey: ['taxonomy-workflow', task.id] });
      // Navigate back to dashboard
      setTimeout(() => navigate('/'), 1000);
    } catch (err) {
      console.error('Failed to reject QA:', err);
      setShowQACompleteModal(false);
      // Show error to user
      alert('Failed to reject QA review. The task may have already been processed.');
      navigate('/');
    }
  }, [task, scene, queryClient, navigate, effectiveStage, effectiveStatus]);

  useEffect(() => {
    if (task?.id) {
      workflowApi.onEditorOpen(task.id)
        .then((updatedWorkflow) => {
          // If status changed, invalidate task query to refresh UI
          if (updatedWorkflow.status !== task.status || updatedWorkflow.stage !== task.stage) {
            queryClient.invalidateQueries({ queryKey: ['task', task.id] });
          }
        })
        .catch((error) => {
          console.warn('[FusionEditorV2] Failed to notify editor open:', error);
        });
    }
  }, [task?.id, task?.status, task?.stage, queryClient]);

  // Auto-resume QA session if task is in QA stage, user has permission, and not already in QA mode
  // IMPORTANT: Use effectiveStage (per-taxonomy) not task.stage (global) for taxonomy-aware workflow
  const startQASession = useQAStore((s) => s.startQASession);
  const exitQAMode = useQAStore((s) => s.exitQAMode);

  useEffect(() => {
    // Use effectiveStage which respects per-taxonomy workflow status
    const stageToCheck = effectiveStage;

    if (task && (stageToCheck === 'qa' || stageToCheck === 'customer_qa') && !isQAMode && userCanReviewQA) {
      // Clear any existing selection before starting QA session to ensure clean state
      deselectAll();
      // Hide annotation list panel in QA mode (TabbedQAPanel replaces it)
      setShowAnnotationList(false);

      // Pass the effective stage so sessions are separated between QA and Customer QA
      console.log('[FusionEditorV2] Starting QA session for stage:', stageToCheck);
      startQASession(task.id, 'suggest', stageToCheck)
        .then(() => {
          console.log('[FusionEditorV2] QA session started successfully');
        })
        .catch((error) => {
          console.error('[FusionEditorV2] Failed to auto-resume QA session:', error);
        });
    } else if (task && stageToCheck === 'annotation' && isQAMode) {
      // If we're in annotation stage but QA mode is still enabled, disable it
      console.log('[FusionEditorV2] Disabling QA mode for annotation stage');
      exitQAMode();
      // Re-show annotation list panel when returning to annotation mode
      setShowAnnotationList(true);
    }
  }, [effectiveStage, task?.id, isQAMode, startQASession, userCanReviewQA, exitQAMode, deselectAll]);

  // Get all available cameras from scene
  const allCameras = useMemo(() => {
    if (!scene?.storage_paths?.cameras) {
      return ['front_camera', 'front_left_camera', 'front_right_camera', 'rear_camera'];
    }
    return Object.keys(scene.storage_paths.cameras);
  }, [scene?.storage_paths?.cameras]);

  // Determine which cameras to show and if we're in full-width mode
  const hasSelection = selection.selectedAnnotationIds.length > 0 && selectedCuboid !== null;
  const hasPointCameras = !hasSelection && visibleCamerasForSelection.length > 0;
  const camerasToShow = (hasSelection || hasPointCameras) ? visibleCamerasForSelection : allCameras;
  const isFullWidthCameraPanel = !hasSelection && !hasPointCameras;

  // Use larger height when showing all cameras
  const defaultCameraPanelHeight = isFullWidthCameraPanel ? 280 : 200;

  // Build image URL for a camera (check cache first, then fallback to API)
  const getCachedImage = useImageCacheStore((s) => s.getCached);
  const getImageUrl = useCallback((cameraId: string): string | undefined => {
    if (!scene?.storage_paths?.cameras?.[cameraId] || !currentFrame?.file_paths?.cameras?.[cameraId]) {
      return undefined;
    }
    const basePath = scene.storage_paths.cameras[cameraId].replace(/\/$/, '');
    const filename = currentFrame.file_paths.cameras[cameraId];
    const fullPath = `${basePath}/${filename}`;

    // Check cache first for instant load
    const cached = getCachedImage(fullPath);
    if (cached) {
      return cached; // Return blob URL
    }

    // Fallback to API endpoint
    const token = useAuthStore.getState().accessToken;
    const baseUrl = `/api/v1/data/image/${basePath}/${filename}`;
    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
  }, [scene?.storage_paths?.cameras, currentFrame?.file_paths?.cameras, getCachedImage]);

  // Get original API URL for an image (not cached) - used for SAM2 segmentation
  const getOriginalImageUrl = useCallback((cameraId: string): string | undefined => {
    if (!scene?.storage_paths?.cameras?.[cameraId] || !currentFrame?.file_paths?.cameras?.[cameraId]) {
      return undefined;
    }
    const basePath = scene.storage_paths.cameras[cameraId].replace(/\/$/, '');
    const filename = currentFrame.file_paths.cameras[cameraId];

    // Always return API endpoint (not cached blob)
    const token = useAuthStore.getState().accessToken;
    const baseUrl = `/api/v1/data/image/${basePath}/${filename}`;
    return token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
  }, [scene?.storage_paths?.cameras, currentFrame?.file_paths?.cameras]);

  // Preload images for current and nearby frames to ensure instant display
  // This forces browser to decode images ahead of time
  useEffect(() => {
    if (!scene?.storage_paths?.cameras || !currentFrame) return;

    const preloadRange = 2; // Preload ±2 frames
    const cameras = Object.keys(scene.storage_paths.cameras);

    // Get frames to preload (current + nearby)
    const framesToPreload = frames.slice(
      Math.max(0, currentFrameIndex - preloadRange),
      Math.min(frames.length, currentFrameIndex + preloadRange + 1)
    );

    // Preload all camera images for these frames
    framesToPreload.forEach(frame => {
      cameras.forEach(cameraId => {
        const filename = frame.file_paths?.cameras?.[cameraId];
        if (!filename) return;

        const basePath = scene.storage_paths.cameras[cameraId].replace(/\/$/, '');
        const fullPath = `${basePath}/${filename}`;
        const cached = getCachedImage(fullPath);

        if (cached) {
          // Preload blob URL to force browser decoding
          const img = new Image();
          img.src = cached;
        }
      });
    });
  }, [scene, currentFrame, currentFrameIndex, frames, getCachedImage]);

  // Compute which cameras can see the selected cuboid
  // Recompute when cuboid position changes to update visible cameras in real-time
  useEffect(() => {
    // Only compute if we have a selected 3D cuboid
    if (!selectedCuboid || !scene?.calibration?.lidar_to_cameras) {
      setVisibleCamerasForSelection([]);
      return;
    }
    // Clear any clicked point when a cuboid selection takes over
    setClickedLidarPoint(null);

    try {
      // Get available cameras from scene
      const lidarToCameras = scene.calibration.lidar_to_cameras;

      // Default image size (will be refined when actual images are loaded)
      const defaultImageSize = { width: 1920, height: 1080 };

      // Find cameras where the cuboid is visible
      const visibleCameras = findVisibleCamerasForCuboid(
        selectedCuboid,
        lidarToCameras,
        defaultImageSize,
        2 // At least 2 corners visible
      );

      setVisibleCamerasForSelection(visibleCameras);
    } catch (error) {
      console.warn('[FusionEditorV2] Error computing visible cameras:', error);
      setVisibleCamerasForSelection([]);
    }
  }, [selectedCuboid, scene?.calibration?.lidar_to_cameras]);

  // When user clicks on a point cloud point (not a cuboid), show the best camera that sees that point
  const handlePointCloudClick = useCallback((point: { x: number; y: number; z: number }) => {
    // If a cuboid is already selected, let the cuboid effect handle cameras
    if (selection.selectedAnnotationIds.length > 0) return;

    if (!scene?.calibration?.lidar_to_cameras) return;

    try {
      const defaultImageSize = { width: 1920, height: 1080 };
      const bestCamera = findBestCameraForPoint(
        point,
        scene.calibration.lidar_to_cameras,
        defaultImageSize,
      );
      if (bestCamera) {
        setVisibleCamerasForSelection([bestCamera]);
        setClickedLidarPoint(point);
      } else {
        setClickedLidarPoint(null);
      }
    } catch (error) {
      console.warn('[FusionEditorV2] Error computing visible cameras for point:', error);
    }
  }, [scene?.calibration?.lidar_to_cameras, selection.selectedAnnotationIds]);

  // Mirror the work-timer running state so tool activation can be gated the same
  // way the tool-palette buttons are (timerLocked). The ref keeps the value fresh
  // inside the keydown closure without re-registering the listener; the state
  // drives the reset-on-pause effect below.
  // Note: `activeTool` is already declared above in this component; reuse it.
  const setActiveTool = useEditorStore(s => s.setActiveTool);
  const [timerRunning, setTimerRunning] = useState(false);
  const timerRunningRef = useRef(false);
  const timerHintTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const apply = (running: boolean) => {
      timerRunningRef.current = running;
      setTimerRunning(running);
    };
    // Best-effort initial read; the Header broadcasts authoritative updates below.
    try {
      const raw = localStorage.getItem(`task_timer_${taskId}`);
      if (raw !== null) apply(JSON.parse(raw).running === true);
    } catch { /* ignore malformed timer state */ }
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ running: boolean; taskId: string }>).detail;
      if (detail?.taskId === taskId) apply(detail.running === true);
    };
    window.addEventListener('timerStateChange', handler);
    return () => window.removeEventListener('timerStateChange', handler);
  }, [taskId]);

  // When the timer is paused, drop any annotation tool back to select so a tool
  // that was already active can't keep being used while paused. Mirrors the 2D
  // view's behaviour. 'flag_missing' is a QA tool and is never timer-locked.
  useEffect(() => {
    if (!timerRunning && activeTool !== 'select' && activeTool !== 'flag_missing') {
      setActiveTool('select');
    }
  }, [timerRunning, activeTool, setActiveTool]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;

      const store = useEditorStore.getState();
      const qaStore = useQAStore.getState();

      // Tool activation is gated by the work timer: when the timer is paused,
      // annotation tools must stay locked even via keyboard shortcuts — mirroring
      // the tool-palette button guard (timerLocked). Returns true if blocked.
      const blockedByTimer = (): boolean => {
        if (timerRunningRef.current) return false;
        // Draw attention to the timer control so the user knows to start it.
        window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: true } }));
        if (timerHintTimeoutRef.current) clearTimeout(timerHintTimeoutRef.current);
        timerHintTimeoutRef.current = setTimeout(
          () => window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: false } })),
          4000,
        );
        return true;
      };

      // Ctrl+S to save
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        // Call save directly from store
        store.saveAnnotations();
        return;
      }

      // Ctrl+Z to undo
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        store.undo();
        return;
      }

      // Ctrl+Shift+Z or Ctrl+Y to redo
      if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        store.redo();
        return;
      }

      // Helper to get selected cuboid annotation
      const getSelectedCuboid = () => {
        const selectedIds = store.selection.selectedAnnotationIds;
        if (selectedIds.length !== 1) return null;
        const annotation = store.annotations.get(selectedIds[0]);
        if (!annotation || annotation.type !== 'cuboid') return null;
        // Block if annotation is locked (QA-approved in revision mode)
        if (lockedAnnotationIdsRef.current.has(annotation.id)) return null;
        return annotation;
      };

      // Helper to update cuboid data
      const updateCuboidData = (annotation: typeof store.annotations extends Map<string, infer T> ? T : never, dataUpdates: Partial<{ center: { x: number; y: number; z: number }; dimensions: { length: number; width: number; height: number }; rotation: { yaw: number; pitch: number; roll: number } }>) => {
        const currentData = annotation.data as { center: { x: number; y: number; z: number }; dimensions: { length: number; width: number; height: number }; rotation: { yaw: number; pitch: number; roll: number } };
        store.updateAnnotation(annotation.id, {
          data: {
            ...currentData,
            ...dataUpdates,
            center: dataUpdates.center ? { ...currentData.center, ...dataUpdates.center } : currentData.center,
            dimensions: dataUpdates.dimensions ? { ...currentData.dimensions, ...dataUpdates.dimensions } : currentData.dimensions,
            rotation: dataUpdates.rotation ? { ...currentData.rotation, ...dataUpdates.rotation } : currentData.rotation,
          }
        });
      };

      // Rotation and dimension adjustment increments
      const rotationStep = e.shiftKey ? 1 : 5; // 1° fine, 5° normal (in degrees)
      const dimensionStep = e.shiftKey ? 0.01 : 0.1; // 0.01m fine, 0.1m normal

      const key = e.key.toLowerCase();

      // QA Mode shortcuts (1, 2, 3 for approve/reject/flag) - only for users with QA permission
      if (effectiveQAMode && qaStore.qaSession) {
        const selectedId = store.selection.selectedAnnotationIds[0];
        if (selectedId) {
          // Get current frame_id and class_id for the annotation
          const annotation = store.annotations.get(selectedId);
          const currentFrameId = store.frames[store.currentFrameIndex]?.id;
          const classId = annotation?.class_id;

          switch (key) {
            case '1':
              e.preventDefault();
              qaStore.approveAnnotation(selectedId, currentFrameId, classId);
              return;
            case '2':
              e.preventDefault();
              qaStore.openRejectionModal(selectedId, currentFrameId, classId);
              return;
            case '3':
              e.preventDefault();
              qaStore.flagAnnotation(selectedId, undefined, currentFrameId, classId);
              return;
          }
        }
      }

      // Number keys for quick class selection (not in QA mode, no modifiers).
      // Multi-digit: press '1' then '2' within 600ms → select class 12.
      // Single digit: 1-9 selects classes 1-9; '0' alone selects class 10.
      if (!effectiveQAMode && !e.ctrlKey && !e.metaKey && /^[0-9]$/.test(e.key)) {
        e.preventDefault();
        const accumulated = pendingDigitRef.current + e.key;
        if (pendingDigitTimerRef.current) clearTimeout(pendingDigitTimerRef.current);

        const trySelectClass = (digits: string) => {
          const editor = useEditorStore.getState();
          const classes = editor.taxonomy?.classes ?? [];
          const idx = parseInt(digits, 10) - 1; // '1' → 0, '10' → 9, '12' → 11
          if (idx >= 0 && idx < classes.length) {
            editor.setActiveClass(classes[idx].id);
          }
          pendingDigitRef.current = '';
          editor.setPendingClassDigits('');
        };

        if (accumulated.length >= 2) {
          // Two digits typed — commit immediately.
          trySelectClass(accumulated);
        } else {
          // One digit so far — wait briefly for a possible second digit.
          pendingDigitRef.current = accumulated;
          store.setPendingClassDigits(accumulated);
          pendingDigitTimerRef.current = setTimeout(() => {
            // Special case: '0' alone → class 10.
            const digits = pendingDigitRef.current === '0' ? '10' : pendingDigitRef.current;
            trySelectClass(digits);
          }, 600);
        }
        return;
      }

      // Rotation shortcuts (Q/E for yaw)
      if (key === 'q' || key === 'e') {
        const annotation = getSelectedCuboid();
        if (annotation) {
          e.preventDefault();
          const currentData = annotation.data as { rotation: { yaw: number; pitch: number; roll: number } };
          const direction = key === 'q' ? 1 : -1; // Q = rotate left (positive), E = rotate right (negative)
          const deltaRadians = (rotationStep * Math.PI) / 180;
          let newYaw = currentData.rotation.yaw + (direction * deltaRadians);
          // Normalize to -π to π
          while (newYaw > Math.PI) newYaw -= 2 * Math.PI;
          while (newYaw < -Math.PI) newYaw += 2 * Math.PI;
          updateCuboidData(annotation, { rotation: { ...currentData.rotation, yaw: newYaw } });
        }
        return;
      }

      // Reset rotation (R)
      if (key === 'r' && !e.ctrlKey && !e.metaKey) {
        const annotation = getSelectedCuboid();
        if (annotation) {
          e.preventDefault();
          updateCuboidData(annotation, { rotation: { yaw: 0, pitch: 0, roll: 0 } });
        }
        return;
      }

      // Dimension shortcuts - grow/shrink in POSITIVE direction only (shift center accordingly)
      // W/S = length (X axis) - grow towards +X
      if (key === 'w') {
        const annotation = getSelectedCuboid();
        if (annotation) {
          e.preventDefault();
          const currentData = annotation.data as { center: { x: number; y: number; z: number }; dimensions: { length: number; width: number; height: number }; rotation: { yaw: number; pitch: number; roll: number } };
          const newLength = Math.max(0.1, currentData.dimensions.length + dimensionStep);
          // Shift center in +X direction by half the delta to grow towards +X only
          const centerShift = dimensionStep / 2;
          // Account for rotation: shift in local X direction
          const yaw = currentData.rotation.yaw;
          const shiftX = centerShift * Math.cos(yaw);
          const shiftY = centerShift * Math.sin(yaw);
          updateCuboidData(annotation, {
            dimensions: { ...currentData.dimensions, length: newLength },
            center: { ...currentData.center, x: currentData.center.x + shiftX, y: currentData.center.y + shiftY }
          });
        }
        return;
      }
      if (key === 's' && !e.ctrlKey && !e.metaKey) {
        // S without modifier = decrease length (shrink from +X side)
        const annotation = getSelectedCuboid();
        if (annotation) {
          e.preventDefault();
          const currentData = annotation.data as { center: { x: number; y: number; z: number }; dimensions: { length: number; width: number; height: number }; rotation: { yaw: number; pitch: number; roll: number } };
          const newLength = Math.max(0.1, currentData.dimensions.length - dimensionStep);
          // Shift center in -X direction by half the delta to shrink from +X side
          const centerShift = -dimensionStep / 2;
          const yaw = currentData.rotation.yaw;
          const shiftX = centerShift * Math.cos(yaw);
          const shiftY = centerShift * Math.sin(yaw);
          updateCuboidData(annotation, {
            dimensions: { ...currentData.dimensions, length: newLength },
            center: { ...currentData.center, x: currentData.center.x + shiftX, y: currentData.center.y + shiftY }
          });
          return;
        }
        // No annotation selected - fall through to tool switch
        if (blockedByTimer()) return;
        store.setActiveTool('brush3d');
        return;
      }

      // A/D = width (Y axis) - grow towards +Y
      if (key === 'a') {
        const annotation = getSelectedCuboid();
        if (annotation) {
          e.preventDefault();
          const currentData = annotation.data as { center: { x: number; y: number; z: number }; dimensions: { length: number; width: number; height: number }; rotation: { yaw: number; pitch: number; roll: number } };
          const newWidth = Math.max(0.1, currentData.dimensions.width + dimensionStep);
          // Shift center in +Y direction (local) by half the delta
          const centerShift = dimensionStep / 2;
          const yaw = currentData.rotation.yaw;
          // Local +Y is perpendicular to local +X: rotate 90 degrees
          const shiftX = -centerShift * Math.sin(yaw);
          const shiftY = centerShift * Math.cos(yaw);
          updateCuboidData(annotation, {
            dimensions: { ...currentData.dimensions, width: newWidth },
            center: { ...currentData.center, x: currentData.center.x + shiftX, y: currentData.center.y + shiftY }
          });
        }
        return;
      }
      if (key === 'd') {
        const annotation = getSelectedCuboid();
        if (annotation) {
          e.preventDefault();
          const currentData = annotation.data as { center: { x: number; y: number; z: number }; dimensions: { length: number; width: number; height: number }; rotation: { yaw: number; pitch: number; roll: number } };
          const newWidth = Math.max(0.1, currentData.dimensions.width - dimensionStep);
          // Shift center in -Y direction (local) by half the delta
          const centerShift = -dimensionStep / 2;
          const yaw = currentData.rotation.yaw;
          const shiftX = -centerShift * Math.sin(yaw);
          const shiftY = centerShift * Math.cos(yaw);
          updateCuboidData(annotation, {
            dimensions: { ...currentData.dimensions, width: newWidth },
            center: { ...currentData.center, x: currentData.center.x + shiftX, y: currentData.center.y + shiftY }
          });
        }
        return;
      }

      // Z/X = height (Z axis) - grow towards +Z
      if (key === 'z' && !e.ctrlKey && !e.metaKey) {
        const annotation = getSelectedCuboid();
        if (annotation) {
          e.preventDefault();
          const currentData = annotation.data as { center: { x: number; y: number; z: number }; dimensions: { length: number; width: number; height: number } };
          const newHeight = Math.max(0.1, currentData.dimensions.height + dimensionStep);
          // Shift center up by half the delta to grow upwards only
          const centerShift = dimensionStep / 2;
          updateCuboidData(annotation, {
            dimensions: { ...currentData.dimensions, height: newHeight },
            center: { ...currentData.center, z: currentData.center.z + centerShift }
          });
        }
        return;
      }
      if (key === 'x') {
        const annotation = getSelectedCuboid();
        if (annotation) {
          e.preventDefault();
          const currentData = annotation.data as { center: { x: number; y: number; z: number }; dimensions: { length: number; width: number; height: number } };
          const newHeight = Math.max(0.1, currentData.dimensions.height - dimensionStep);
          // Shift center down by half the delta to shrink from top
          const centerShift = -dimensionStep / 2;
          updateCuboidData(annotation, {
            dimensions: { ...currentData.dimensions, height: newHeight },
            center: { ...currentData.center, z: currentData.center.z + centerShift }
          });
        }
        return;
      }

      // Ctrl+D = Duplicate annotation
      if ((e.ctrlKey || e.metaKey) && key === 'd') {
        const annotation = getSelectedCuboid();
        if (annotation) {
          e.preventDefault();
          const currentData = annotation.data as { center: { x: number; y: number; z: number } };
          // Create duplicate offset by 1m in X
          const newAnnotation = store.createAnnotation({
            type: annotation.type,
            class_id: annotation.class_id,
            data: {
              ...annotation.data,
              center: {
                ...currentData.center,
                x: currentData.center.x + 1,
              },
            },
            attributes: { ...annotation.attributes },
          });
          store.selectAnnotation(newAnnotation.id);
        }
        return;
      }

      switch (key) {
        case 'h':
          // H = Help - toggle keyboard shortcuts dialog
          e.preventDefault();
          setShowShortcutsHelp(prev => !prev);
          break;
        case 'c':
          // C = Cuboid tool (disabled in QA mode)
          if (!effectiveQAMode && !blockedByTimer()) {
            store.setActiveTool('cuboid');
          }
          break;
        case 'l': if (!blockedByTimer()) store.setActiveTool('polyline'); break;
        case 'p': if (!blockedByTimer()) store.setActiveTool('polygon'); break;
        case 'f':
          if (e.shiftKey && effectiveQAMode) {
            // Shift+F for Flag Missing tool (QA mode only)
            store.setActiveTool('flag_missing');
          } else {
            // F = Forward frame
            e.preventDefault();
            store.nextFrame();
          }
          break;
        case 'b':
          // B = Backward frame
          e.preventDefault();
          store.prevFrame();
          break;
        case 't':
          // T = Track tool (matches the tool palette's advertised shortcut).
          // Shift+T = Toggle top view (kept on a T-based key for the "Top" mnemonic).
          e.preventDefault();
          if (e.shiftKey) {
            store.toggleTopView();
          } else if (!effectiveQAMode) {
            store.setActiveTool('track');
          }
          break;
        case 'f':
          // F = Fisheye projection toggle
          e.preventDefault();
          store.toggleFisheyeProjection();
          break;
        case 'g':
          // G = Go back to 3D perspective view (reset camera)
          e.preventDefault();
          store.resetCameraView();
          break;
        case 'arrowright':
        case 'arrowleft': {
          // Left/Right arrows ALWAYS navigate frames
          e.preventDefault();
          if (key === 'arrowright') {
            store.nextFrame();
          } else {
            store.prevFrame();
          }
          break;
        }
        case 'arrowup':
        case 'arrowdown': {
          const annotation = getSelectedCuboid();
          if (annotation) {
            // Keep Shift+Arrow behavior in active ortho views for local rotation controls.
            if (showOrthoViews && activeOrthoView && e.shiftKey) {
              break;
            }

            e.preventDefault();
            // Move box when selected (up/down only)
            const moveStep = e.shiftKey ? 0.01 : 0.1; // 0.01m fine, 0.1m normal
            const currentData = annotation.data as { center: { x: number; y: number; z: number } };
            let dy = 0, dz = 0;

            const useViewAwareMapping = showOrthoViews && activeOrthoView !== null;

            if (useViewAwareMapping) {
              if (activeOrthoView === 'top') {
                if (key === 'arrowup') dy = moveStep;
                else if (key === 'arrowdown') dy = -moveStep;
              } else if (activeOrthoView === 'front') {
                if (key === 'arrowup') dz = moveStep;
                else if (key === 'arrowdown') dz = -moveStep;
              } else if (activeOrthoView === 'side') {
                if (key === 'arrowup') dz = moveStep;
                else if (key === 'arrowdown') dz = -moveStep;
              }
            } else {
              if (key === 'arrowup') dz = moveStep; // Up = move up in Z
              else if (key === 'arrowdown') dz = -moveStep; // Down = move down in Z
            }

            updateCuboidData(annotation, {
              center: {
                x: currentData.center.x,
                y: currentData.center.y + dy,
                z: currentData.center.z + dz,
              }
            });
          }
          break;
        }
        case 'home':
          // Home = Go to first frame
          e.preventDefault();
          store.goToFrame(0);
          break;
        case 'end':
          // End = Go to last frame
          e.preventDefault();
          store.goToFrame(store.frames.length - 1);
          break;
        case 'delete':
        case 'backspace':
          e.preventDefault();
          // Filter out locked (QA-approved) annotations from deletion
          store.selection.selectedAnnotationIds
            .filter(id => !lockedAnnotationIdsRef.current.has(id))
            .forEach(id => store.deleteAnnotation(id));
          break;
        case 'escape':
          e.preventDefault();
          if (showShortcutsHelp) {
            setShowShortcutsHelp(false);
          } else if (store.isBoxPlacementActive) {
            // User is mid-drag placing a box — CuboidCreator's own Escape handler
            // cancels the drag and resets isBoxPlacementActive. Don't exit the
            // track tool so the annotator can immediately pick the next class.
            store.setBoxPlacementActive(false);
          } else {
            store.deselectAll();
            useTrackStore.getState().setActiveTrack(null); // Clear active track
            store.deactivateCameraView(); // Exit camera view mode
            store.setActiveTool('select'); // Reset to select tool
            setClickedLidarPoint(null); // Clear clicked point highlight
            setVisibleCamerasForSelection([]); // Restore default camera panel
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [effectiveQAMode, showShortcutsHelp, showOrthoViews, activeOrthoView]);

  const availableCapabilities: AnnotationCapability[] = [
    'bounding_box_3d', 'bounding_box_2d', 'semantic_segmentation', 'tracking', 'polygon', 'polyline'
  ];

  if (loadingTask) {
    return (
      <div className="h-screen bg-dark flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin w-12 h-12 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4" />
          <div className="text-white">Loading annotation task...</div>
        </div>
      </div>
    );
  }

  // Whether the QA feedback panel (annotator revision) is visible
  const isRevisionPanelVisible = !effectiveQAMode && task && (effectiveRevisionCount ?? task.revision_count) > 0 && effectiveStage === 'annotation' && viewMode !== '2d';

  // Calculate right offset based on visible panels
  const getRightOffset = () => {
    if (viewMode === 'fusion') return 'right-1/2';
    if (showOrthoViews) return 'right-96'; // 384px for ortho panel
    if (isRevisionPanelVisible) return 'right-80'; // 320px for QA feedback panel
    return 'right-0';
  };

  // Calculate bottom offset - camera panel is always visible in 3D mode
  const camerasPanelVisible = viewMode !== '2d' && camerasToShow.length > 0;
  const bottomOffsetPx = camerasPanelVisible ? (focusCamerasPanelHeight || defaultCameraPanelHeight) : 0;

  return (
    <div className="h-screen bg-dark overflow-hidden relative">
      {/* Header */}
      <Header
        viewMode={viewMode}
        setViewMode={setViewMode}
        annotationModeTab={annotationModeTab}
        setAnnotationModeTab={setAnnotationModeTab}
        availableModes={availableModes}
        onOpenQACompleteModal={() => setShowQACompleteModal(true)}
        isAutoSaving={isAutoSaving}
        lastSavedAt={lastSavedAt}
        autoSaveError={autoSaveError}
        onShowSubmissionModal={setShowSubmissionModal}
        onSetNextTask={setNextTask}
        onSetLoadingNextTask={setIsLoadingNextTask}
        linkedTaxonomies={linkedTaxonomies}
        urlTaxonomyId={urlTaxonomyId}
        taxonomyReady={taxonomyReady}
        effectiveStage={effectiveStage}
        effectiveStatus={effectiveStatus}
        effectiveRevisionCount={effectiveRevisionCount}
      />

      {/* BEV/3D Toggle Button - overlaid on canvas (not in 2d mode) */}
      {viewMode !== '2d' && (
        <div className="absolute top-16 left-4 z-30 flex items-center gap-2">
          {/* Top View Toggle Button */}
          <button
            onClick={() => useEditorStore.getState().toggleTopView()}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors font-medium text-sm ${
              lidarView.isTopView
                ? 'bg-blue-500 text-white hover:bg-blue-600'
                : 'bg-dark-panel/90 text-gray-300 hover:bg-gray-700 border border-gray-600'
            }`}
            title={lidarView.isTopView ? 'Switch to Perspective View [Shift+T]' : 'Switch to Top/Bird\'s Eye View [Shift+T]'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {lidarView.isTopView ? (
                // Perspective icon (3D cube)
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              ) : (
                // Top view icon (grid/BEV)
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM9 4v16M15 4v16M4 9h16M4 15h16" />
              )}
            </svg>
            {lidarView.isTopView ? '3D' : 'Top'}
          </button>

          {/* Fisheye Projection Toggle Button */}
          <button
            onClick={() => useEditorStore.getState().toggleFisheyeProjection()}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors font-medium text-sm ${
              lidarView.useFisheyeProjection
                ? 'bg-purple-500 text-white hover:bg-purple-600'
                : 'bg-dark-panel/90 text-gray-300 hover:bg-gray-700 border border-gray-600'
            }`}
            title={lidarView.useFisheyeProjection ? 'Switch to Pinhole Projection [F]' : 'Switch to Fisheye Projection [F]'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {lidarView.useFisheyeProjection ? (
                // Fisheye lens icon (curved lens)
                <>
                  <circle cx="12" cy="12" r="9" strokeWidth={2} />
                  <ellipse cx="12" cy="12" rx="5" ry="9" strokeWidth={1.5} />
                  <ellipse cx="12" cy="12" rx="9" ry="5" strokeWidth={1.5} />
                </>
              ) : (
                // Standard camera/pinhole icon
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
              )}
            </svg>
            {lidarView.useFisheyeProjection ? 'Fisheye' : 'Pinhole'}
          </button>

          {/* Ground Plane Detection Toggle Button */}
          <button
            onClick={() => useEditorStore.getState().setLidarView({
              groundPlane: {
                ...lidarView.groundPlane,
                enabled: !(lidarView.groundPlane?.enabled ?? true)
              }
            })}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-colors font-medium text-sm ${
              (lidarView.groundPlane?.enabled ?? true)
                ? 'bg-emerald-500 text-white hover:bg-emerald-600'
                : 'bg-dark-panel/90 text-gray-300 hover:bg-gray-700 border border-gray-600'
            }`}
            title={(lidarView.groundPlane?.enabled ?? true) ? 'Disable Ground Plane Detection' : 'Enable Ground Plane Detection'}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17h18M3 17l3-5M21 17l-3-5M9 12l3-5 3 5" />
            </svg>
            Ground
          </button>

          {/* Keyboard Shortcuts Help Button */}
          <button
            onClick={() => setShowShortcutsHelp(true)}
            className="flex items-center justify-center w-7 h-7 rounded-lg bg-dark-panel/90 text-gray-400 hover:text-white hover:bg-gray-700 border border-gray-600 transition-colors text-sm font-bold"
            title="Keyboard Shortcuts [H]"
          >
            ?
          </button>

          {/* Camera View Mode Indicator - Only show in non-4D mode */}
          {viewMode !== '4d' && lidarView.cameraView?.isActive && lidarView.cameraView?.cameraId && (
            <div className="flex items-center gap-2 ml-2 bg-primary/20 border border-primary/50 rounded-lg px-3 py-1.5">
              <svg className="w-4 h-4 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
              <span className="text-sm text-primary font-medium">
                {lidarView.cameraView.cameraId.replace(/_/g, ' ')}
              </span>

              {/* 2D Image — camera image only, no projected lidar points */}
              <button
                onClick={() => {
                  const camId = lidarView.cameraView?.cameraId;
                  if (camId != null) openCameraImageView(camId as string);
                }}
                className={`ml-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  lidarView.cameraView.imageOnlyMode
                    ? 'bg-green-500/60 text-green-100'
                    : 'bg-green-500/20 text-green-400 hover:bg-green-500/40'
                }`}
                title="Show camera image only (no lidar points)"
              >
                2D Image
              </button>

              {/* 2D Overlay — camera image with projected lidar points */}
              {!lidarView.cameraView.frustumOnlyMode && (
                <button
                  onClick={() => {
                    useEditorStore.getState().setLidarView({
                      cameraView: {
                        ...lidarView.cameraView,
                        imageOnlyMode: false,
                      },
                    });
                  }}
                  className={`ml-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                    !lidarView.cameraView.imageOnlyMode
                      ? 'bg-blue-500/60 text-blue-100'
                      : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/40'
                  }`}
                  title="Show camera image with projected lidar points"
                >
                  2D Overlay
                </button>
              )}

              {/* Toggle to Frustum 3D view */}
              <button
                onClick={() => useEditorStore.getState().toggleFrustumOnlyMode()}
                className={`ml-1 px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                  lidarView.cameraView.frustumOnlyMode
                    ? 'bg-green-500/60 text-green-100'
                    : 'bg-gray-500/20 text-gray-400 hover:bg-gray-500/40'
                }`}
                title={lidarView.cameraView.frustumOnlyMode ? 'Exit frustum view' : 'Switch to Frustum 3D View'}
              >
                3D Frustum
              </button>

              <button
                onClick={() => useEditorStore.getState().deactivateCameraView()}
                className="ml-1 p-0.5 rounded hover:bg-primary/30 text-primary/70 hover:text-primary transition-colors"
                title="Exit camera view (Esc)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Tour anchors - always present for onboarding, positioned in visible area */}
      <div
        data-tour="lidar-canvas"
        className="absolute pointer-events-none"
        style={{
          top: '80px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: '200px',
          height: '100px',
          background: 'transparent',
        }}
      />
      <div
        data-tour="2d-canvas"
        className="absolute pointer-events-none"
        style={{
          top: '80px',
          right: '20%',
          width: '200px',
          height: '100px',
          background: 'transparent',
        }}
      />

      {/* Main 3D Canvas - adjusts width and height based on visible panels */}
      {viewMode !== '4d' && (
        <div
          className={`absolute top-12 left-0 transition-all duration-300 ${getRightOffset()} ${viewMode === '2d' ? 'hidden' : ''}`}
          style={{ bottom: bottomOffsetPx }}
        >
          <LidarCanvas
            pointCloudData={pointCloudData}
            egoPose={currentFrame?.ego_pose ? {
              position: currentFrame.ego_pose.position,
              rotation: currentFrame.ego_pose.rotation,
            } : undefined}
            egoToLidarCalibration={scene?.calibration?.ego_to_lidar}
            cameraCalibrations={scene?.calibration?.lidar_to_cameras}
            getImageUrl={getImageUrl}
            getOriginalImageUrl={getOriginalImageUrl}
            isQAMode={effectiveQAMode}
            onFlagMissingLocation={handleFlagMissingLocation}
            onPointCloudClick={handlePointCloudClick}
            rightInset={showAnnotationList ? annotationPanelWidth : 0}
          />
          {/* Coordinate Display - overlaid on LiDAR canvas */}
          <CoordinateDisplay />
          {/* Loading indicator for lidar data */}
          {loadingLidar && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 bg-dark-panel/90 px-4 py-2 rounded-lg text-white text-sm">
              Loading point cloud...
            </div>
          )}
        </div>
      )}

      {/* 4D LiDAR Canvas - Stacked scans for static object labeling */}
      {viewMode === '4d' && (
        <div
          className="absolute top-12 left-0 right-0 transition-all duration-300"
          style={{ bottom: 0 }}
        >
          <LidarCanvas4DNew
            onStackedDataReady={setStackedPointCloud4D}
          />
        </div>
      )}

      {/* Orthographic Views Panel (Top/Side/Front) - when box selected in 3D or 4D mode */}
      {viewMode === '4d' ? (
        <OrthographicViews4D
          isVisible={showOrthoViews}
          pointCloud={stackedPointCloud4D
            ? { positions: stackedPointCloud4D.positions, intensities: new Float32Array(stackedPointCloud4D.pointCount), pointCount: stackedPointCloud4D.pointCount }
            : pointCloudData}
          worldOrigin={stackedPointCloud4D?.origin}
          rightOffset={(effectiveQAMode && effectiveStage !== 'annotation' ? 384 : isRevisionPanelVisible ? 320 : (!effectiveQAMode && showAnnotationList ? annotationPanelWidth : 0))}
          onWidthChange={setOrthoViewsWidth}
          onActiveViewChange={setActiveOrthoView}
          onCollapse={() => setShowOrthoViews(false)}
        />
      ) : (
        <OrthographicViews
          isVisible={showOrthoViews && viewMode !== '2d'}
          pointCloud={pointCloudData}
          onWidthChange={setOrthoViewsWidth}
          rightOffset={(effectiveQAMode && effectiveStage !== 'annotation' ? 384 : isRevisionPanelVisible ? 320 : (!effectiveQAMode && showAnnotationList ? annotationPanelWidth : 0))}
          onActiveViewChange={setActiveOrthoView}
          onCollapse={() => setShowOrthoViews(false)}
        />
      )}

      {/* Reopen tab for the ortho views - shown only when a box is selected but the
          user has collapsed the panel (auto-open already covers the unselected case). */}
      {viewMode !== '2d' && !showOrthoViews && selection.selectedAnnotationIds.length > 0 && (
        <button
          onClick={() => setShowOrthoViews(true)}
          title="Show orthographic views"
          aria-label="Show orthographic views"
          className="fixed top-1/2 -translate-y-1/2 z-30 flex flex-col items-center gap-1 px-1 py-3 rounded-l-lg bg-gray-800/90 border border-r-0 border-gray-700 text-gray-300 hover:text-white hover:bg-gray-700 shadow-lg transition-colors"
          style={{ right: (effectiveQAMode && effectiveStage !== 'annotation' ? 384 : isRevisionPanelVisible ? 320 : (!effectiveQAMode && showAnnotationList ? annotationPanelWidth : 0)) }}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7M19 19l-7-7 7-7" />
          </svg>
          <span className="text-[10px] font-medium tracking-wide" style={{ writingMode: 'vertical-rl' }}>Views</span>
        </button>
      )}

      {/* Camera Views Panel - always visible in 3D mode */}
      {/* Shows all cameras when no selection, visible cameras when box selected */}
      {viewMode !== '2d' && viewMode !== '4d' && camerasToShow.length > 0 && (
        <FocusedCameraViews
          visibleCameras={camerasToShow}
          selectedCuboid={selectedCuboid}
          classColor={selectedClassColor}
          panelHeight={focusCamerasPanelHeight || defaultCameraPanelHeight}
          onHeightChange={setFocusCamerasPanelHeight}
          isFullWidth={isFullWidthCameraPanel}
          orthoViewsWidth={orthoViewsWidth}
          qaPanelOffset={(effectiveQAMode && effectiveStage !== 'annotation' ? 384 : isRevisionPanelVisible ? 320 : (!effectiveQAMode && showAnnotationList ? annotationPanelWidth : 0))}
          clickedPoint={clickedLidarPoint}
          onCameraClick={openCameraImageView}
        />
      )}

      {/* 2D View (for 2d mode only) - wait for taxonomy to be ready before loading */}
      {viewMode === '2d' && taxonomyReady && (
        <CameraPanel viewMode={viewMode} taskId={taskId} />
      )}

      {/* 2D View loading state - show while waiting for taxonomy */}
      {viewMode === '2d' && !taxonomyReady && (
        <div className="absolute inset-0 top-12 bg-black z-10 flex items-center justify-center">
          <div className="text-gray-400 flex items-center gap-2">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/>
            </svg>
            Setting taxonomy...
          </div>
        </div>
      )}

      {/* Fusion Labeling View */}
      {viewMode === 'fusion' && (
        <FusionLabelingView
          showOrthoViews={showOrthoViews}
          orthoViewsWidth={orthoViewsWidth}
          cameraPanelHeight={camerasToShow.length > 0 ? (focusCamerasPanelHeight || defaultCameraPanelHeight) : 0}
          qaPanelOffset={(effectiveQAMode && effectiveStage !== 'annotation' ? 384 : isRevisionPanelVisible ? 320 : (!effectiveQAMode && showAnnotationList ? annotationPanelWidth : 0))}
        />
      )}

      {/* Tool Palette - visible in 3D, fusion, and 4D modes */}
      {viewMode !== '2d' && (
        <ToolPalette availableCapabilities={availableCapabilities} isQAMode={effectiveQAMode} />
      )}

      {/* First-run placement hint for the Cuboid/Track tool — concise, dismissible,
          and self-retiring once the user has learnt the Shift-steer/slide/drop flow. */}
      {viewMode !== '2d' && (activeTool === 'cuboid' || activeTool === 'track') && showCuboidHint && (
        <div className="absolute top-28 left-4 z-[100] animate-fadeInDown">
          <div className="flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 rounded-xl bg-gray-950/95 border border-amber-500/50 shadow-[0_0_0_1px_rgba(245,158,11,0.15),0_4px_16px_rgba(0,0,0,0.6)]">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500/15 border border-amber-500/40 flex items-center justify-center">
              <svg className="w-3 h-3 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-300 whitespace-nowrap">
                <span className="text-white font-semibold">Shift+drag</span> to start
              </span>
              <span className="text-gray-600">→</span>
              <span className="text-[10px] text-gray-300 whitespace-nowrap">
                hold Shift to <span className="text-orange-400 font-semibold">steer</span>
              </span>
              <span className="text-gray-400 font-semibold" title="Toggle Shift to switch back and forth">⇄</span>
              <span className="text-[10px] text-gray-300 whitespace-nowrap">
                release to <span className="text-green-400 font-semibold">slide</span>
              </span>
              <span className="text-gray-600">→</span>
              <span className="text-[10px] text-gray-300 whitespace-nowrap">
                <span className="text-white font-semibold">mouse-up</span> to drop
              </span>
            </div>
            <button
              onClick={dismissCuboidHint}
              title="Got it — don't show again"
              aria-label="Dismiss hint"
              className="flex-shrink-0 ml-0.5 w-5 h-5 rounded flex items-center justify-center text-gray-500 hover:text-white hover:bg-white/10 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Clip Box Controls - fixed, at top-right of the 3D workspace (accounts for ortho views + annotation panel) */}
      {viewMode !== '2d' && (
        <div
          className="fixed z-30 top-14 flex flex-col items-end gap-2"
          style={{ right: (showAnnotationList ? annotationPanelWidth : 48) + (showOrthoViews ? orthoViewsWidth : 0) }}
        >
          <ClipBoxControls />
          <ClassPickerPanel />
        </div>
      )}

      {/* Annotation List Panel - Right sidebar with filtering */}
      {/* Hidden in QA mode (TabbedQAPanel takes precedence) and 2D mode */}
      {(!effectiveQAMode || effectiveStage === 'annotation') && viewMode !== '2d' && (
        <AnnotationListPanel
          isVisible={showAnnotationList}
          onToggle={() => setShowAnnotationList(!showAnnotationList)}
          onWidthChange={setAnnotationPanelWidth}

        />
      )}

      {/* Tabbed QA Panel - Frame Annotations + Track Review (replaces PropertiesPanel in QA mode) */}
      {/* Hidden in 2D mode - Image2DAnnotationView has its own QAPanel2D */}
      {effectiveQAMode && effectiveStage !== 'annotation' && viewMode !== '2d' && (
        <div
          className="fixed top-12 right-0 z-50 w-96 shadow-2xl pointer-events-auto"
          style={{ height: 'calc(100vh - 48px)', maxHeight: 'calc(100vh - 48px)' }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <TabbedQAPanel
            onJumpToAnnotation={handleJumpToAnnotation}
            onSelectTrack={handleSelectTrack}
          />
        </div>
      )}

      {/* QA Feedback Panel - shown to annotators when task is a revision (rejected by QA) */}
      {isRevisionPanelVisible && task && (
        <div
          className="fixed top-12 right-0 z-50 w-80 shadow-2xl pointer-events-auto border-l border-gray-700"
          style={{ height: 'calc(100vh - 48px)', maxHeight: 'calc(100vh - 48px)' }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <QAFeedbackPanel
            taskId={task.id}
            task={{
              ...task,
              revision_count: effectiveRevisionCount ?? task.revision_count,
              stage: effectiveStage ?? task.stage,
              status: effectiveStatus ?? task.status,
            }}
            onJumpToAnnotation={handleJumpToAnnotation}
          />
        </div>
      )}

      {/* QA Rejection Modal */}
      {showRejectionModal && rejectionAnnotationId && <RejectionModal />}

      {/* QA False Negative Modal */}
      {showFalseNegativeModal && falseNegativeLocation && (
        <FalseNegativeModal
          location={falseNegativeLocation}
          onFlag={handleFlagFalseNegative}
          onCreateAnnotation={handleCreateAnnotationDirectly}
          onClose={() => {
            setShowFalseNegativeModal(false);
            setFalseNegativeLocation(null);
          }}
        />
      )}

      {/* QA Complete Modal - Accept or Reject */}
      {showQACompleteModal && task && (
        <QACompleteModal
          stage={task.stage}
          onAccept={handleAcceptQA}
          onReject={handleRejectQA}
          onClose={() => setShowQACompleteModal(false)}
        />
      )}

      {/* Submission Success Modal */}
      {showSubmissionModal && (
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
                    onClick={handleGoToTaskList}
                    className="flex-1 px-4 py-2.5 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 font-medium transition-colors"
                  >
                    Go to Task List
                  </button>
                  <button
                    onClick={handleOpenNextTask}
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
                  onClick={handleGoToTaskList}
                  className="flex-1 px-4 py-2.5 rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 font-medium transition-colors"
                >
                  Go to Task List
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Help Modal */}
      {showShortcutsHelp && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowShortcutsHelp(false)}>
          <div className="bg-dark-panel border border-gray-600 rounded-xl shadow-2xl max-w-4xl w-full mx-4 overflow-hidden max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="bg-gradient-to-r from-blue-600/20 to-purple-600/20 border-b border-gray-600 px-6 py-4 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-white">Keyboard Shortcuts</h2>
              </div>
              <button onClick={() => setShowShortcutsHelp(false)} className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
            </div>

            {/* Content */}
            <div className="px-6 py-5 overflow-y-auto">
              <div className="grid grid-cols-2 gap-6">

                {/* Common Shortcuts */}
                <div>
                  <h3 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-blue-500/20 flex items-center justify-center">⌨️</span>
                    Common
                  </h3>
                  <div className="space-y-1.5">
                    {[
                      ['Ctrl+S', 'Save annotations'],
                      ['Ctrl+Z', 'Undo'],
                      ['Ctrl+Y', 'Redo'],
                      ['Del / ⌫', 'Delete selected'],
                      ['Esc', 'Cancel / Deselect'],
                      ['1-9, 0, 10+', 'Quick class select'],
                      ['H', 'Toggle this help'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center justify-between py-1 px-2 rounded hover:bg-dark/40">
                        <span className="text-xs text-gray-400">{desc}</span>
                        <kbd className="px-1.5 py-0.5 bg-dark border border-gray-600 rounded text-[10px] font-mono text-blue-300">{key}</kbd>
                      </div>
                    ))}
                  </div>
                </div>

                {/* 2D Annotation Shortcuts — only relevant in 2D mode */}
                {viewMode === '2d' && (
                <div>
                  <h3 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-green-500/20 flex items-center justify-center">🖼️</span>
                    2D Tools
                  </h3>
                  <div className="space-y-1.5">
                    {[
                      ['V', 'Select tool'],
                      ['Space', 'Pan (hold + drag)'],
                      ['R', 'Rectangle'],
                      // ['O', 'Rotated box'],  // Hidden for now
                      ['E', 'Ellipse'],
                      ['P', 'Polygon'],
                      ['L', 'Polyline'],
                      ['K', 'Points'],
                      ['W', 'AI Segmentation'],
                      ['M', 'AI Polygon'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center justify-between py-1 px-2 rounded hover:bg-dark/40">
                        <span className="text-xs text-gray-400">{desc}</span>
                        <kbd className="px-1.5 py-0.5 bg-dark border border-gray-600 rounded text-[10px] font-mono text-green-300">{key}</kbd>
                      </div>
                    ))}
                  </div>

                  <h4 className="text-xs font-medium text-gray-500 mt-3 mb-1.5">Drawing</h4>
                  <div className="space-y-1.5">
                    {[
                      ['Enter', 'Complete shape'],
                      ['Backspace', 'Undo last point'],
                      ['Dbl-Click', 'Fit to window'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center justify-between py-1 px-2 rounded hover:bg-dark/40">
                        <span className="text-xs text-gray-400">{desc}</span>
                        <kbd className="px-1.5 py-0.5 bg-dark border border-gray-600 rounded text-[10px] font-mono text-green-300">{key}</kbd>
                      </div>
                    ))}
                  </div>

                  <h4 className="text-xs font-medium text-gray-500 mt-3 mb-1.5">Segment Editing</h4>
                  <div className="space-y-1.5">
                    {[
                      ['Shift + Left Click', 'Add point to segment'],
                      ['Shift + Right Click', 'Delete point from segment'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center justify-between py-1 px-2 rounded hover:bg-dark/40">
                        <span className="text-xs text-gray-400">{desc}</span>
                        <kbd className="px-1.5 py-0.5 bg-dark border border-gray-600 rounded text-[10px] font-mono text-green-300">{key}</kbd>
                      </div>
                    ))}
                  </div>
                </div>

                )}

                {/* 3D Annotation Shortcuts — only relevant in 3D / fusion / 4D modes */}
                {viewMode !== '2d' && (
                <div>
                  <h3 className="text-sm font-semibold text-purple-400 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-purple-500/20 flex items-center justify-center">📦</span>
                    3D Tools
                  </h3>
                  <div className="space-y-1.5">
                    {[
                      ['C', 'Cuboid tool'],
                      ['T', 'Track tool'],
                      ['Shift+Click', 'Draw box (select mode)'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center justify-between py-1 px-2 rounded hover:bg-dark/40">
                        <span className="text-xs text-gray-400">{desc}</span>
                        <kbd className="px-1.5 py-0.5 bg-dark border border-gray-600 rounded text-[10px] font-mono text-purple-300">{key}</kbd>
                      </div>
                    ))}
                  </div>

                  <h4 className="text-xs font-medium text-gray-500 mt-3 mb-1.5">Box Editing</h4>
                  <div className="space-y-1.5">
                    {[
                      ['Q / E', 'Rotate left / right'],
                      ['R', 'Reset rotation'],
                      ['W / S', 'Grow / Shrink length'],
                      ['A / D', 'Grow / Shrink width'],
                      ['Z / X', 'Grow / Shrink height'],
                      ['← → ↑ ↓', 'Move box (view-aware in active ortho panel)'],
                      ['Shift + Arrows', 'Fine move (3D view) / Rotate (ortho panel)'],
                      ['Ctrl+D', 'Duplicate'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center justify-between py-1 px-2 rounded hover:bg-dark/40">
                        <span className="text-xs text-gray-400">{desc}</span>
                        <kbd className="px-1.5 py-0.5 bg-dark border border-gray-600 rounded text-[10px] font-mono text-purple-300">{key}</kbd>
                      </div>
                    ))}
                  </div>
                  <p className="text-[10px] text-gray-500 mt-1.5 px-2">
                    Ortho mapping: Top (X/Y), Front (X/Z), Side (Y/Z). Click or hover a panel to make it active for arrow movement.
                  </p>

                  <h4 className="text-xs font-medium text-gray-500 mt-3 mb-1.5">Navigation</h4>
                  <div className="space-y-1.5">
                    {[
                      ['F / B', 'Next / Prev frame'],
                      ['← →', 'Prev / Next frame'],
                      ['Shift+T', 'Toggle top view'],
                      ['G', 'Back to 3D view'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center justify-between py-1 px-2 rounded hover:bg-dark/40">
                        <span className="text-xs text-gray-400">{desc}</span>
                        <kbd className="px-1.5 py-0.5 bg-dark border border-gray-600 rounded text-[10px] font-mono text-purple-300">{key}</kbd>
                      </div>
                    ))}
                  </div>
                </div>
                )}

              </div>

              {/* Mouse Controls Row */}
              <div className="mt-5 pt-4 border-t border-gray-700">
                <h3 className="text-sm font-semibold text-gray-400 mb-3">Mouse Controls</h3>
                <div className="grid grid-cols-4 gap-3">
                  <div className="text-center p-2 rounded bg-dark/30">
                    <div className="text-xs font-medium text-gray-300 mb-1">Left Drag</div>
                    <div className="text-[10px] text-gray-500">Rotate 3D / Select 2D</div>
                  </div>
                  <div className="text-center p-2 rounded bg-dark/30">
                    <div className="text-xs font-medium text-gray-300 mb-1">Right Drag</div>
                    <div className="text-[10px] text-gray-500">Pan view</div>
                  </div>
                  <div className="text-center p-2 rounded bg-dark/30">
                    <div className="text-xs font-medium text-gray-300 mb-1">Middle Drag</div>
                    <div className="text-[10px] text-gray-500">Pan view</div>
                  </div>
                  <div className="text-center p-2 rounded bg-dark/30">
                    <div className="text-xs font-medium text-gray-300 mb-1">Scroll</div>
                    <div className="text-[10px] text-gray-500">Zoom in / out</div>
                  </div>
                </div>
              </div>

              {/* QA Mode */}
              {effectiveQAMode && (
                <div className="mt-5 pt-4 border-t border-gray-700">
                  <h3 className="text-sm font-semibold text-yellow-400 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-yellow-500/20 flex items-center justify-center">🔍</span>
                    QA Review
                  </h3>
                  <div className="grid grid-cols-4 gap-3">
                    {[
                      ['1', 'Approve'],
                      ['2', 'Reject'],
                      ['3', 'Flag'],
                      ['Shift+F', 'Flag missing'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center justify-between py-1.5 px-3 rounded bg-yellow-500/10 border border-yellow-600/30">
                        <span className="text-xs text-gray-300">{desc}</span>
                        <kbd className="px-1.5 py-0.5 bg-dark border border-yellow-700 rounded text-[10px] font-mono text-yellow-300">{key}</kbd>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-6 py-3 bg-dark/50 border-t border-gray-700 shrink-0">
              <p className="text-xs text-gray-500 text-center">Press <kbd className="px-1.5 py-0.5 bg-dark border border-gray-600 rounded text-xs font-mono text-gray-400">H</kbd> or <kbd className="px-1.5 py-0.5 bg-dark border border-gray-600 rounded text-xs font-mono text-gray-400">Esc</kbd> to close</p>
            </div>
          </div>
        </div>
      )}

      {/* QA Annotation Comments */}
      <AnnotationComments />

      {/* Track Timeline Panel - appears when a tracked annotation/track is selected */}
      {viewMode !== '2d' && (
        <TrackTimelinePanel
          displayedFrameIndex={displayedFrameIndex}
          viewerBottomOffsetPx={bottomOffsetPx}
        />
      )}

      {/* Timeline - synchronized with actual displayed frame */}
      <Timeline
        isLoadingFrame={fetchingLidar}
        displayedFrameIndex={displayedFrameIndex}
      />

    </div>
  );
};

// Suppress unused variable warning for TrackManagement (reserved for full panel mode)
void _TrackManagement;
void _PropertiesPanel;
void _LabelListPanel;

export default FusionEditorV2;

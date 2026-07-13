import React, { useEffect, useState, useRef, useMemo, useCallback } from 'react';
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom';
import { BRAND } from '@/config/branding';
import { useQuery, useQueries, useQueryClient } from '@tanstack/react-query';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { MOUSE, Vector2 } from 'three';

import { taskApi, sceneApi, datasetApi, dataApi, taxonomyApi, segmentationApi, workflowApi, qaApi } from '@/api/client';

import { QACompleteModal } from '@/components/qa';
import { SpatialIssueModal } from '@/components/qa/SpatialIssueModal';
import { SpatialIssueMarkers, extractSpatialIssues } from '@/components/canvas/SegmentationCanvas/SpatialIssueMarkers';

import { transformToWorld, transformFromWorld, getLidarToEgoTransform, EgoPose, EgoToLidarCalibration } from '@/utils/worldTransforms';

import { useSegmentationStore } from '@/store/segmentationStore';
import { useLidarCacheStore } from '@/store/lidarCacheStore';
import { useQAStore, useIsQAMode } from '@/store/qaStore';
import { useAuthStore } from '@/store/authStore';
import { useOnboardingStore } from '@/store/onboardingStore';

import {
  SegmentablePointCloud,
  BrushTool,
  LassoTool,
  LassoOverlay,
  RegionGrowTool,
  EraserTool,
  SegmentationToolPalette,
  FloatingClassSelector,
  SegmentsPanel,
  InstanceLabels,
  BrushZoomInset,
} from '@/components/canvas/SegmentationCanvas';

import { CameraProjectionPanel } from '@/components/segmentation/CameraProjectionPanel';

import { SegmentationCameraOverlay } from '@/components/segmentation/SegmentationCameraOverlay';

import { ransacGroundPlane } from '@/utils/ransacGroundPlane';

import { GroundGrid, AxesIndicator } from '@/components/canvas/LidarCanvas/SceneHelpers';
import { ClipBoxControls } from '@/components/canvas/LidarCanvas';

import type { PointCloudData, Frame, Task, CameraCalibration, Taxonomy, TaskStage, AnnotationReview } from '@/types';


const CanvasCleanup: React.FC = () => {
  const { gl } = useThree();

  useEffect(() => {
    return () => {
      if (gl) {
        try {
          gl.dispose();
        } catch (error) {
          console.debug('WebGL context cleanup error:', error);
        }
      }
    };
  }, [gl]);

  return null;
};


interface CameraControllerProps {
  isTopView: boolean;
  isToolActive: boolean;
  navigateTarget?: { x: number; y: number; z: number } | null;
  onNavigationComplete?: () => void;
}

const CameraController: React.FC<CameraControllerProps> = ({ isTopView, isToolActive, navigateTarget, onNavigationComplete }) => {
  const { camera } = useThree();
  const controlsRef = useRef<any>(null);
  const lastTopViewRef = useRef(isTopView);

  useEffect(() => {
    if (navigateTarget && controlsRef.current) {
      const { x, y, z } = navigateTarget;

      controlsRef.current.target.set(x, y, z);

      const zoomHeight = 8;
      camera.position.set(x, y, z + zoomHeight);
      camera.up.set(0, 1, 0);
      camera.lookAt(x, y, z);

      controlsRef.current.enableRotate = false;

      controlsRef.current.update();

      onNavigationComplete?.();
    }
  }, [navigateTarget, camera, onNavigationComplete]);

  useEffect(() => {
    if (isTopView !== lastTopViewRef.current) {
      lastTopViewRef.current = isTopView;

      if (isTopView) {
        camera.position.set(0, 0, 100);
        camera.up.set(0, 1, 0);
        camera.lookAt(0, 0, 0);

        if (controlsRef.current) {
          controlsRef.current.target.set(0, 0, 0);
          controlsRef.current.enableRotate = false;
        }
      } else {
        camera.position.set(0, -50, 40);
        camera.up.set(0, 0, 1);
        camera.lookAt(0, 0, 0);

        if (controlsRef.current) {
          controlsRef.current.target.set(0, 0, 0);
          controlsRef.current.enableRotate = true;
        }
      }
    }
  }, [isTopView, camera]);

  const mouseButtons = isToolActive
    ? { LEFT: null as any, MIDDLE: MOUSE.ROTATE, RIGHT: MOUSE.PAN }
    : { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: MOUSE.PAN };

  useEffect(() => {
    if (controlsRef.current) {
      controlsRef.current.mouseButtons = mouseButtons;
    }
  }, [isToolActive, mouseButtons]);

  return (
    <OrbitControls
      ref={controlsRef}
      enableDamping
      dampingFactor={0.1}
      rotateSpeed={0.5}
      zoomSpeed={1.5}
      panSpeed={1.0}
      enablePan={true}
      screenSpacePanning={true}
      enableRotate={!isTopView}
      mouseButtons={mouseButtons}
    />
  );
};


interface SpatialIssue {
  id: string;
  frame_id?: string;
  x: number;
  y: number;
  z: number;
  issueTypes: string[];
  notes?: string;
  reviewedAt?: string;
  annotator_resolved?: boolean;
}

interface SegmentationCanvasProps {
  pointCloud: PointCloudData;
  classColors: Map<number, string>;
  taxonomy: Taxonomy | null;
  isTopView: boolean;
  onPointClick?: (position: { x: number; y: number; z: number }) => void;
  spatialIssues?: SpatialIssue[];
  showSpatialIssues?: boolean;
  cameraNavigateTarget?: { x: number; y: number; z: number } | null;
  onNavigationComplete?: () => void;
  showGrid?: boolean;
}

const SegmentationCanvas: React.FC<SegmentationCanvasProps> = ({
  pointCloud,
  classColors,
  taxonomy,
  isTopView,
  onPointClick,
  spatialIssues = [],
  showSpatialIssues = false,
  cameraNavigateTarget = null,
  onNavigationComplete,
  showGrid = true,
}) => {
  const activeTool = useSegmentationStore((s) => s.activeTool);
  const activeClassId = useSegmentationStore((s) => s.activeClassId);
  const brushSettings = useSegmentationStore((s) => s.brushSettings);

  const [lassoPoints, setLassoPoints] = useState<Vector2[]>([]);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeTool !== 'lasso') setLassoPoints([]);
  }, [activeTool]);
  const addToSelection = useSegmentationStore((s) => s.addToSelection);
  const labelPoints = useSegmentationStore((s) => s.labelPoints);
  const paintBrushPoints = useSegmentationStore((s) => s.paintBrushPoints);
  const erasePoints = useSegmentationStore((s) => s.erasePoints);
  const setHoveredPoint = useSegmentationStore((s) => s.setHoveredPoint);
  const splitSourceInstanceId = useSegmentationStore((s) => s.splitSourceInstanceId);
  const addSplitSelection = useSegmentationStore((s) => s.addSplitSelection);
  const segmentationMode = useSegmentationStore((s) => s.segmentationMode);
  const selectInstanceByPoint = useSegmentationStore((s) => s.selectInstanceByPoint);

  const handleBrushSelect = useCallback((indices: number[]) => {
    if (splitSourceInstanceId !== null) {
      addSplitSelection(indices);
      return;
    }
    if (brushSettings.mode === 'paint' && activeClassId) {
      paintBrushPoints(indices, activeClassId);
    } else if (brushSettings.mode === 'erase') {
      erasePoints(indices);
    }
  }, [splitSourceInstanceId, addSplitSelection, brushSettings.mode, activeClassId, paintBrushPoints, erasePoints]);

  const handleSelect = useCallback((indices: number[]) => {
    if (activeClassId) {
      labelPoints(indices, activeClassId, `Selected ${indices.length} points`);
    } else {
      addToSelection(indices);
    }
  }, [activeClassId, labelPoints, addToSelection]);

  // Handle eraser
  const handleErase = useCallback((indices: number[]) => {
    erasePoints(indices);
  }, [erasePoints]);

  // Handle point hover
  const handlePointHover = useCallback((index: number | null) => {
    setHoveredPoint(index);
  }, [setHoveredPoint]);

  // Handle point click: select an instance (Select tool, instance mode) and/or
  // forward the position for spatial-issue marking.
  const handlePointClickInCanvas = useCallback((index: number, event: any) => {
    if (!pointCloud) return;

    // Click-to-select the instance under the cursor (mirrors panel → viewer).
    // Shift+click adds it to the merge pick set instead of focusing it.
    if (segmentationMode === 'instance' && activeTool === 'select') {
      const additive = !!(event?.shiftKey || event?.nativeEvent?.shiftKey);
      selectInstanceByPoint(index, additive);
    }

    if (onPointClick) {
      onPointClick({
        x: pointCloud.positions[index * 3],
        y: pointCloud.positions[index * 3 + 1],
        z: pointCloud.positions[index * 3 + 2],
      });
    }
  }, [pointCloud, onPointClick, segmentationMode, activeTool, selectInstanceByPoint]);

  return (
    <div ref={canvasContainerRef} style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        camera={{
          position: [0, -50, 40],
          fov: 60,
          near: 0.1,
          far: 1000,
          up: [0, 0, 1],
        }}
        gl={{
          antialias: true,
          powerPreference: 'high-performance',
          failIfMajorPerformanceCaveat: false,
        }}
        onContextMenu={(e) => e.preventDefault()}
        onCreated={({ gl }) => {
          // Handle WebGL context loss gracefully
          const canvas = gl.domElement;
          // Prevent context menu on right-click (allow pan with right-click)
          canvas.addEventListener('contextmenu', (e) => e.preventDefault());
          canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            console.warn('[WebGL] Context lost - will attempt recovery');
          });
          canvas.addEventListener('webglcontextrestored', () => {
            console.log('[WebGL] Context restored');
          });
        }}
        style={{ background: '#0a0a0a' }}
      >
        <CanvasCleanup />
        <CameraController
          isTopView={isTopView}
          isToolActive={activeTool !== 'select'}
          navigateTarget={cameraNavigateTarget}
          onNavigationComplete={onNavigationComplete}
        />

        {/* Scene helpers */}
        {showGrid && <GroundGrid />}
        <AxesIndicator />

        {/* Point cloud */}
        <SegmentablePointCloud
          data={pointCloud}
          classColors={classColors}
          onPointHover={handlePointHover}
          onPointClick={handlePointClickInCanvas}
        />

        {/* Floating instance display-ID labels (instance mode) */}
        <InstanceLabels data={pointCloud} taxonomy={taxonomy} />

        {/* Tools */}
        <BrushTool
          pointCloud={pointCloud}
          onSelect={handleBrushSelect}
          enabled={activeTool === 'brush'}
        />
        <LassoTool
          pointCloud={pointCloud}
          onSelect={handleSelect}
          enabled={activeTool === 'lasso'}
          onLassoPointsChange={setLassoPoints}
        />
        <RegionGrowTool
          pointCloud={pointCloud}
          onSelect={handleSelect}
          enabled={activeTool === 'region_grow'}
        />
        <EraserTool
          pointCloud={pointCloud}
          onErase={handleErase}
          enabled={activeTool === 'eraser'}
        />

        {/* Spatial issue markers */}
        <SpatialIssueMarkers
          issues={spatialIssues}
          visible={showSpatialIssues}
        />
      </Canvas>

      {/* Lasso polygon overlay — rendered as HTML SVG over the canvas */}
      {activeTool === 'lasso' && (
        <LassoOverlay points={lassoPoints} containerRef={canvasContainerRef} />
      )}

      {/* Middle-drag rotate hint — compact single-row, always top-left */}
      {activeTool !== 'select' && (
        <div className="absolute top-3 left-3 z-[100] pointer-events-none animate-fadeInDown">
          <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-gray-950 border border-white/70 shadow-[0_0_0_1px_rgba(255,255,255,0.15),0_4px_16px_rgba(0,0,0,0.6)]">
            <span className="flex-shrink-0 w-5 h-5 rounded-full bg-white/10 border border-white/30 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="7" y="2" width="10" height="16" rx="5" />
                <line x1="12" y1="6" x2="12" y2="10" />
              </svg>
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-300 whitespace-nowrap">
                <span className="text-white font-medium">Mid-drag</span> rotate
              </span>
              <span className="text-gray-600">·</span>
              <span className="text-[10px] text-gray-300 whitespace-nowrap">
                <span className="text-white font-medium">Scroll</span> zoom
              </span>
              <span className="text-gray-600">·</span>
              <span className="text-[10px] text-gray-300 whitespace-nowrap">
                <span className="text-white font-medium">R-drag</span> pan
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// HEADER
// =============================================================================

interface HeaderProps {
  task: Task | null;
  sceneName: string;
  currentFrameIndex: number;
  totalFrames: number;
  onSave: () => void;
  onSubmit: () => void;
  isSaving: boolean;
  isTopView: boolean;
  onToggleView: () => void;
  dirtyFrameCount: number;
  showCameraPanel: boolean;
  onToggleCameraPanel: () => void;
  onShowHelp: () => void;
  taxonomies: Taxonomy[];
  selectedTaxonomyId: string;
  onTaxonomyChange: (taxonomyId: string) => void;
  isQAMode?: boolean;
  effectiveStage?: string;
  effectiveStatus?: string;
  effectiveRevisionCount?: number;
  isRevisionMode?: boolean;
  // Spatial issue mode for QA
  isAddingSpatialIssue?: boolean;
  onToggleSpatialIssue?: () => void;
  // Delete all annotations
  onDeleteAll?: () => void;
  /** When set, Submit is disabled and the reason is shown as the title.
   *  Used in revision rounds to block submit until every spatial issue
   *  on the task has been marked fixed by the annotator. */
  submitBlockedReason?: string | null;
}

// Mode type for the view mode tabs
type ViewMode = '3D' | 'FUSION' | '4D';
type ColorMode = 'Class' | 'Instance' | 'Height';

const Header: React.FC<HeaderProps> = ({
  task,
  sceneName,
  currentFrameIndex: _currentFrameIndex,
  totalFrames: _totalFrames,
  onSave,
  onSubmit,
  isSaving,
  isTopView,
  onToggleView,
  dirtyFrameCount,
  showCameraPanel,
  onToggleCameraPanel,
  onShowHelp,
  taxonomies,
  selectedTaxonomyId,
  onTaxonomyChange,
  isQAMode = false,
  effectiveStage,
  effectiveStatus,
  effectiveRevisionCount = 0,
  isRevisionMode = false,
  isAddingSpatialIssue = false,
  onToggleSpatialIssue,
  onDeleteAll,
  submitBlockedReason = null,
}) => {
  const navigate = useNavigate();
  const [viewMode, setViewMode] = useState<ViewMode>('3D');
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteAllModal, setShowDeleteAllModal] = useState(false);
  const [colorMode, setColorMode] = useState<ColorMode>('Class');

  const activeTool = useSegmentationStore((s) => s.activeTool);
  const segmentationMode = useSegmentationStore((s) => s.segmentationMode);
  const setSegmentationMode = useSegmentationStore((s) => s.setSegmentationMode);
  const brushSettings = useSegmentationStore((s) => s.brushSettings);
  const setBrushSettings = useSegmentationStore((s) => s.setBrushSettings);
  const pointSize = useSegmentationStore((s) => s.pointSize);
  const setPointSize = useSegmentationStore((s) => s.setPointSize);
  const undo = useSegmentationStore((s) => s.undo);
  const redo = useSegmentationStore((s) => s.redo);
  const undoStack = useSegmentationStore((s) => s.undoStack);
  const redoStack = useSegmentationStore((s) => s.redoStack);
  const canUndo = undoStack.length > 0;
  const canRedo = redoStack.length > 0;

  // Session timer with pause/resume — state persisted per task+taxonomy in localStorage
  const [isTimerRunning, setIsTimerRunning] = useState(false);
  const [showTimerHint, setShowTimerHint] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [timerStartedAt, setTimerStartedAt] = useState<string | null>(null);
  const timerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Refs so the save-on-switch effect reads current values without stale closures
  const isTimerRunningRef = useRef(false);
  const elapsedSecondsRef = useRef(0);
  isTimerRunningRef.current = isTimerRunning;
  elapsedSecondsRef.current = elapsedSeconds;
  const prevTaxonomyIdRef = useRef<string>('');

  const timerStorageKey = task?.id && selectedTaxonomyId
    ? `task_timer_${task.id}_${selectedTaxonomyId}`
    : task?.id
      ? `task_timer_${task.id}`
      : null;

  const clearTimerInterval = useCallback(() => {
    if (timerIntervalRef.current) {
      clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
  }, []);

  const startTimerInterval = useCallback(() => {
    clearTimerInterval();
    timerIntervalRef.current = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
  }, [clearTimerInterval]);

  // Save previous taxonomy's timer and restore the new one whenever task or taxonomy changes
  useEffect(() => {
    if (!task?.id) return;
    const prevTaxId = prevTaxonomyIdRef.current;

    // If taxonomy changed, save the outgoing timer state first
    if (prevTaxId && prevTaxId !== selectedTaxonomyId) {
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
          // Best-effort backend sync for previous taxonomy
          if (task?.id && currentElapsed > 0) {
            taskApi.update(task.id, { total_time_seconds: currentElapsed } as any).catch(() => {});
          }
        } else {
          localStorage.setItem(prevKey, JSON.stringify({ ...existing, elapsed: currentElapsed, running: false }));
        }
      } catch {}
    }

    prevTaxonomyIdRef.current = selectedTaxonomyId;

    // Restore new taxonomy's timer state
    clearTimerInterval();
    const newKey = selectedTaxonomyId
      ? `task_timer_${task.id}_${selectedTaxonomyId}`
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
  }, [task?.id, selectedTaxonomyId]);

  // Persist on every tick and on pause/resume
  useEffect(() => {
    if (!timerStorageKey) return;
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

  // Broadcast timer state so SegmentationToolPalette can react
  useEffect(() => {
    if (!task?.id) return;
    window.dispatchEvent(new CustomEvent('timerStateChange', { detail: { running: isTimerRunning, taskId: task.id } }));
  }, [isTimerRunning, task?.id]);

  // Listen for locked-tool hover to hint the timer
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ active?: boolean }>).detail;
      setShowTimerHint(Boolean(detail?.active));
    };
    window.addEventListener('timerControlAttention', handler);
    return () => window.removeEventListener('timerControlAttention', handler);
  }, []);

  useEffect(() => {
    if (isTimerRunning) setShowTimerHint(false);
  }, [isTimerRunning]);

  // Sync elapsed time to backend (fire-and-forget)
  const syncTimerToBackend = useCallback((seconds: number) => {
    if (!task?.id || seconds <= 0) return;
    taskApi.update(task.id, { total_time_seconds: seconds } as any).catch(() => {});
  }, [task?.id]);

  // Sync on unmount so navigating away saves the time
  useEffect(() => {
    return () => {
      if (task?.id) {
        const key = selectedTaxonomyId
          ? `task_timer_${task.id}_${selectedTaxonomyId}`
          : `task_timer_${task.id}`;
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
  }, [task?.id, selectedTaxonomyId]);

  const handleToggleTimer = () => {
    if (isTimerRunning) {
      clearTimerInterval();
      setIsTimerRunning(false);
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
      if (!timerStartedAt) setTimerStartedAt(new Date().toISOString());
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

  const [showBackTimerWarning, setShowBackTimerWarning] = useState(false);

  const handleBackClick = () => {
    if (isTimerRunning) {
      setShowBackTimerWarning(true);
    } else {
      navigate(-1);
    }
  };

  useEffect(() => {
    if (!showBackTimerWarning) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setShowBackTimerWarning(false);
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [showBackTimerWarning]);

  // Stage configuration matching workflow components
  const STAGE_LABELS: Record<string, string> = {
    annotation: 'ANNOTATION',
    qa: 'QA',
    customer_qa: 'CUSTOMER QA',
    accepted: 'COMPLETED',
    done: 'COMPLETED',
  };

  // Status display text (human readable)
  const STATUS_LABELS: Record<string, string> = {
    pending: 'Pending',
    assigned: 'Assigned',
    in_progress: 'In Progress',
    submitted: 'Submitted',
    accepted: 'Accepted',
    rejected: 'Rejected',
  };

  // Status colors based on actual task status
  const STATUS_COLORS: Record<string, string> = {
    pending: 'bg-gray-500',
    assigned: 'bg-blue-500',
    in_progress: 'bg-green-500',
    submitted: 'bg-purple-500',
    accepted: 'bg-emerald-500',
    rejected: 'bg-red-500',
  };

  // Get status label and color from actual task data
  // Use effective values (per-taxonomy) if available
  const getStatusInfo = () => {
    if (!task) return { label: 'Loading', status: '', color: 'bg-gray-500' };

    const stage = (effectiveStage ?? task.stage)?.toLowerCase() || '';
    const status = (effectiveStatus ?? task.status)?.toLowerCase() || '';

    const stageLabel = STAGE_LABELS[stage] || stage.toUpperCase().replace('_', ' ') || 'Unknown';
    const statusLabel = STATUS_LABELS[status] || status.replace('_', ' ') || '';
    const statusColor = STATUS_COLORS[status] || 'bg-gray-500';

    return { label: stageLabel, status: statusLabel, color: statusColor };
  };

  const statusInfo = getStatusInfo();

  return (
    <>
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
      <div className="bg-dark-panel border-b border-gray-700">
      {/* Main Header Row */}
      <div className="h-12 flex items-center justify-between px-4">
        {/* Left: Logo + Navigation */}
        <div className="flex items-center gap-4">
          {/* Logo */}
          <Link to="/" className="flex items-center">
            {BRAND.showLogo ? (
              <img src="/logo.svg?v=2" alt={BRAND.name} className="h-7 w-auto" />
            ) : (
              <span className="text-sm font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-500 bg-clip-text text-transparent whitespace-nowrap">
                {BRAND.name}
              </span>
            )}
          </Link>

          {/* Back Button */}
          <button
            onClick={handleBackClick}
            className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-dark-hover"
            aria-label="Go back"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
          </button>

          <div className="h-6 w-px bg-gray-700" />

          {/* Brand Title */}
          <div className="flex flex-col">
            <span className="text-sm font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-500 bg-clip-text text-transparent">{BRAND.name}</span>
            <span className="text-[10px] text-gray-500 hidden lg:inline">Sensor Fusion Annotation Platform</span>
          </div>
        </div>

        {/* Center: Mode Tabs + Controls */}
        <div className="flex items-center gap-4">
          {/* View Mode Tabs - 3D is active, others disabled for segmentation */}
          <div className="flex items-center bg-dark rounded-lg p-0.5">
            {(['3D', 'FUSION', '4D'] as ViewMode[]).map((mode) => {
              const isEnabled = mode === '3D'; // Only 3D is enabled for segmentation
              return (
                <button
                  key={mode}
                  onClick={() => isEnabled && setViewMode(mode)}
                  disabled={!isEnabled}
                  className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                    !isEnabled
                      ? 'text-gray-600 cursor-not-allowed opacity-50'
                      : viewMode === mode
                        ? 'bg-primary text-white'
                        : 'text-gray-400 hover:text-white'
                  }`}
                  title={!isEnabled ? 'Only 3D view is available for semantic segmentation' : undefined}
                >
                  {mode}
                </button>
              );
            })}
          </div>

          <div className="h-6 w-px bg-gray-700" />

          {/* Annotation Mode Tab Selector - 3D/Fusion active, 2D Only disabled */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-500 mr-1">Mode:</span>
            <div className="flex items-center bg-dark rounded-lg p-0.5">
              <button
                className="px-2.5 py-1 rounded text-xs font-medium bg-cyan-600 text-white"
                title="3D/Fusion/4D annotations - semantic segmentation"
              >
                3D/Fusion
              </button>
              <button
                disabled
                className="px-2.5 py-1 rounded text-xs font-medium text-gray-600 cursor-not-allowed opacity-50"
                title="2D Only mode is not available for semantic segmentation"
              >
                2D Only
              </button>
            </div>
          </div>

          {/* Color Mode - match fusion editor style */}
          <div className="flex items-center gap-2 bg-dark rounded-lg p-0.5 border border-gray-700 mx-2">
            <div className="flex items-center gap-1 px-1">
              <span className="text-[10px] text-gray-400">Color:</span>
              <select
                value={colorMode}
                onChange={(e) => setColorMode(e.target.value as ColorMode)}
                className="bg-transparent text-[10px] font-medium text-gray-200 focus:outline-none cursor-pointer"
              >
                <option value="Class" className="bg-dark text-gray-200">Class</option>
                <option value="Instance" className="bg-dark text-gray-200">Instance</option>
                <option value="Height" className="bg-dark text-gray-200">Height</option>
              </select>
            </div>
          </div>

          {/* Taxonomy Selector - match fusion editor style */}
          {taxonomies.length > 1 ? (
            <>
              <div className="h-6 w-px bg-gray-700" />
              <div className="flex items-center gap-1 bg-dark rounded-lg p-0.5 border border-gray-700">
                <span className="text-[10px] text-gray-400 px-1">Taxonomy:</span>
                <select
                  value={selectedTaxonomyId}
                  onChange={(e) => onTaxonomyChange(e.target.value)}
                  className="bg-transparent text-[10px] font-medium text-gray-200 focus:outline-none cursor-pointer max-w-[120px]"
                >
                  {taxonomies.map((tax) => (
                    <option key={tax.id} value={tax.id} className="bg-dark text-gray-200">
                      {tax.name}
                    </option>
                  ))}
                </select>
              </div>
            </>
          ) : taxonomies.length === 1 ? (
            <>
              <div className="h-6 w-px bg-gray-700" />
              <div className="flex items-center gap-1 bg-dark rounded-lg p-0.5 border border-gray-700">
                <span className="text-[10px] text-gray-400 px-1">Taxonomy:</span>
                <span className="text-[10px] font-medium text-gray-200 px-1 max-w-[120px] truncate">
                  {taxonomies[0].name}
                </span>
              </div>
            </>
          ) : null}
        </div>

        {/* Right: Scene Info + Actions */}
        <div className="flex items-center gap-3">
          {/* Session Timer */}
          <div
            data-tour="timer-control"
            className={`flex items-center gap-1.5 px-2 py-1 rounded hidden sm:flex transition-all duration-200 ${
              showTimerHint && !isTimerRunning
                ? 'bg-gray-900/95 border timer-attention'
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
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <rect x="5" y="4" width="4" height="16" rx="1" />
                  <rect x="15" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M6 4l14 8-14 8V4z" />
                </svg>
              )}
            </button>
          </div>

          <div className="w-px h-6 bg-gray-700" />

          {/* Scene Name + Status */}
          <div className="flex flex-col items-end">
            <span className="text-xs text-white font-medium">{sceneName}</span>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-gray-400">{statusInfo.label}</span>
              <span className={`px-1.5 py-0.5 rounded text-[9px] ${statusInfo.color} text-white`}>
                {statusInfo.status}
              </span>
              {/* Revision Badge */}
              {effectiveRevisionCount > 0 && effectiveStage === 'annotation' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-red-500/20 text-red-400 border border-red-500/30 animate-pulse">
                  ⚠ Revision #{effectiveRevisionCount}
                </span>
              )}
            </div>
          </div>

          <div className="w-px h-6 bg-gray-700" />

          {/* Save Button */}
          <button
            onClick={onSave}
            disabled={isSaving || dirtyFrameCount === 0}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              isSaving
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : dirtyFrameCount > 0
                  ? 'bg-gray-600 hover:bg-gray-500 text-white'
                  : 'bg-gray-700 text-gray-500'
            }`}
          >
            {isSaving ? 'Saving...' : 'Save'}
          </button>

          {/* Submit Button - shows "Complete QA" when in QA mode.
              Disabled in revision rounds when there are still issues the
              annotator hasn't marked fixed. */}
          <button
            onClick={onSubmit}
            disabled={!!submitBlockedReason}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              submitBlockedReason
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : isQAMode
                  ? 'bg-purple-600 hover:bg-purple-700 text-white'
                  : 'bg-primary hover:bg-primary-dark text-white'
            }`}
            title={
              submitBlockedReason
                ?? ((effectiveStage ?? task?.stage) === 'annotation'
                  ? 'Submit for QA review'
                  : (effectiveStage ?? task?.stage) === 'qa'
                    ? 'Complete QA review'
                    : 'Submit task')
            }
          >
            {isQAMode ? 'Complete QA' : 'Submit'}
          </button>

          {/* More Options (kebab menu) */}
          <div className="relative">
            <button
              onClick={() => setShowMenu((v) => !v)}
              className={`p-1 rounded hover:bg-dark-hover text-gray-400 hover:text-white ${showMenu ? 'bg-dark-hover text-white' : ''}`}
              title="More options"
            >
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="12" cy="5" r="2" />
                <circle cx="12" cy="12" r="2" />
                <circle cx="12" cy="19" r="2" />
              </svg>
            </button>
            {showMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
                <div className="absolute right-0 top-full mt-1 w-52 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50 py-1">
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
              </>
            )}
          </div>

          {/* Delete All Confirmation Modal */}
          {showDeleteAllModal && (
            <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[9999]">
              <div className="bg-gray-800 border border-gray-600 rounded-xl p-6 max-w-sm w-full mx-4 shadow-2xl">
                <h3 className="text-lg font-bold text-white mb-2">Delete All Annotations?</h3>
                <p className="text-sm text-gray-300 mb-6">
                  This will permanently delete all segmentation labels for this task and reset it to the annotation stage. This action cannot be undone.
                </p>
                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => setShowDeleteAllModal(false)}
                    className="px-4 py-2 rounded-lg text-sm text-gray-300 bg-gray-700/50 hover:bg-gray-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => { setShowDeleteAllModal(false); onDeleteAll?.(); }}
                    className="px-4 py-2 rounded-lg text-sm bg-red-600 text-white hover:bg-red-700 transition-colors font-medium"
                  >
                    Yes, Delete All
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* QA Mode Banner */}
      {isQAMode && (
        <div className="flex items-center justify-center gap-3 px-4 py-2 bg-gradient-to-r from-purple-900/50 via-purple-800/40 to-purple-900/50 border-t border-purple-500/30">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
            <span className="text-sm font-medium text-purple-300">
              QA Review Mode
            </span>
          </div>
          <span className="text-xs text-purple-400/80">
            {(effectiveStage ?? task?.stage) === 'customer_qa' ? 'Customer QA Review' : 'Internal QA Review'} •
            Review segments and approve/reject as needed
          </span>
          {/* Add Point Issue Button */}
          <button
            onClick={() => onToggleSpatialIssue?.()}
            className={`ml-4 px-3 py-1 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5 ${
              isAddingSpatialIssue
                ? 'bg-red-500 text-white animate-pulse'
                : 'bg-red-500/20 text-red-300 hover:bg-red-500/30 border border-red-500/30'
            }`}
            title="Click on a point in the 3D view to add an issue at that location"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 22s-8-4.5-8-11.8A8 8 0 0 1 12 2a8 8 0 0 1 8 8.2c0 7.3-8 11.8-8 11.8z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {isAddingSpatialIssue ? 'Click on point...' : 'Add Point Issue'}
          </button>
        </div>
      )}

      {/* Revision Mode Banner */}
      {isRevisionMode && !isQAMode && (
        <div className="flex items-center justify-center gap-3 px-4 py-2 bg-gradient-to-r from-amber-900/50 via-red-900/40 to-amber-900/50 border-t border-red-500/30">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <span className="text-sm font-medium text-red-300">
              Revision Mode - Round #{effectiveRevisionCount}
            </span>
          </div>
          <span className="text-xs text-amber-400/80">
            Rejected segments are highlighted below • Fix issues and resubmit
          </span>
        </div>
      )}

      {/* Secondary Toolbar Row */}
      <div className="h-8 flex items-center justify-between px-4 border-t border-gray-800 bg-dark-panel/80">
        {/* Left: View Controls */}
        <div className="flex items-center gap-2">
          {/* Top View Toggle */}
          <button
            onClick={onToggleView}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs ${
              isTopView ? 'bg-primary text-white' : 'text-gray-400 hover:text-white hover:bg-dark-hover'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <line x1="3" y1="9" x2="21" y2="9" />
              <line x1="9" y1="21" x2="9" y2="9" />
            </svg>
            Top
          </button>

          {/* Help */}
          <button
            onClick={onShowHelp}
            className="p-1 rounded text-gray-400 hover:text-white hover:bg-dark-hover"
            title="Keyboard shortcuts (H)"
          >
            <span className="text-xs">?</span>
          </button>

          <div className="w-px h-4 bg-gray-700" />

          {/* Segmentation mode: Semantic (one segment per class) vs Instance
              (each drawn object numbered separately, e.g. tree 1, tree 2). */}
          <div className="flex items-center gap-0.5 bg-dark rounded-lg p-0.5 border border-gray-700" title="Semantic groups all points of a class into one segment. Instance numbers each object separately (tree 1, tree 2, …).">
            <button
              onClick={() => setSegmentationMode('semantic')}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                segmentationMode === 'semantic' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Semantic
            </button>
            <button
              onClick={() => setSegmentationMode('instance')}
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                segmentationMode === 'instance' ? 'bg-primary text-white' : 'text-gray-400 hover:text-white'
              }`}
            >
              Instance
            </button>
          </div>

          <div className="w-px h-4 bg-gray-700" />

          {/* 2D Overlay Toggle */}
          <button
            onClick={onToggleCameraPanel}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-xs ${
              showCameraPanel ? 'bg-primary text-white' : 'text-gray-400 hover:text-white hover:bg-dark-hover'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <circle cx="8" cy="21" r="1" />
              <circle cx="16" cy="21" r="1" />
              <line x1="8" y1="17" x2="8" y2="20" />
              <line x1="16" y1="17" x2="16" y2="20" />
            </svg>
            2D Overlay
          </button>
        </div>

        {/* Center: Brush Size + Point Size */}
        <div className="flex items-center gap-2">
          {/* Brush Size - visible when brush/eraser tool active */}
          {(activeTool === 'brush' || activeTool === 'eraser') && (
            <div className="flex items-center gap-2 bg-dark rounded-lg p-0.5 border border-gray-700 mx-1">
              <span className="text-[10px] text-gray-400 px-1">Brush:</span>
              <input
                type="range"
                min="0.1"
                max="5"
                step="0.1"
                value={brushSettings.radius}
                onChange={(e) => setBrushSettings({ radius: parseFloat(e.target.value) })}
                className="w-16 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                title={`Brush Size: ${brushSettings.radius.toFixed(1)}m`}
              />
            </div>
          )}

          {/* Point Size - always visible */}
          <div className="flex items-center gap-2 bg-dark rounded-lg p-0.5 border border-gray-700 mx-1">
            <span className="text-[10px] text-gray-400 px-1">Size:</span>
            <input
              type="range"
              min="0.3"
              max="3.0"
              step="0.1"
              value={pointSize}
              onChange={(e) => setPointSize(parseFloat(e.target.value))}
              className="w-16 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
              title={`Point Size: ${pointSize.toFixed(1)}`}
            />
          </div>
        </div>

        {/* Right: Undo/Redo */}
        <div className="flex items-center gap-1">
          <button
            onClick={undo}
            disabled={!canUndo}
            className={`p-1 rounded transition-colors ${
              canUndo ? 'text-gray-400 hover:text-white hover:bg-dark-hover' : 'text-gray-600 cursor-not-allowed'
            }`}
            title="Undo (Ctrl+Z)"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 14L4 9l5-5" />
              <path d="M4 9h10.5a5.5 5.5 0 015.5 5.5v0a5.5 5.5 0 01-5.5 5.5H11" />
            </svg>
          </button>

          <button
            onClick={redo}
            disabled={!canRedo}
            className={`p-1 rounded transition-colors ${
              canRedo ? 'text-gray-400 hover:text-white hover:bg-dark-hover' : 'text-gray-600 cursor-not-allowed'
            }`}
            title="Redo (Ctrl+Shift+Z)"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 14l5-5-5-5" />
              <path d="M20 9H9.5A5.5 5.5 0 004 14.5v0A5.5 5.5 0 009.5 20H13" />
            </svg>
          </button>
        </div>
      </div>
    </div>
    </>
  );
};

// =============================================================================
// TIMELINE
// =============================================================================

interface TimelineProps {
  frames: Frame[];
  currentFrameIndex: number;
  onFrameChange: (index: number) => void;
}

const Timeline: React.FC<TimelineProps> = ({ frames, currentFrameIndex, onFrameChange }) => {
  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1);
  const [isEditingFrame, setIsEditingFrame] = useState(false);
  const [frameInputValue, setFrameInputValue] = useState('');
  const playIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const frameInputRef = useRef<HTMLInputElement>(null);

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  // Track current frame for interval
  const currentFrameRef = useRef(currentFrameIndex);
  currentFrameRef.current = currentFrameIndex;

  // Playback effect
  useEffect(() => {
    if (isPlaying) {
      const intervalMs = 200 / playbackSpeed;
      playIntervalRef.current = setInterval(() => {
        const next = currentFrameRef.current + 1;
        if (next >= frames.length) {
          setIsPlaying(false);
        } else {
          onFrameChange(next);
        }
      }, intervalMs);
    } else {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
        playIntervalRef.current = null;
      }
    }
    return () => {
      if (playIntervalRef.current) {
        clearInterval(playIntervalRef.current);
      }
    };
  }, [isPlaying, playbackSpeed, frames.length, onFrameChange]);

  // Stop playback when reaching end
  useEffect(() => {
    if (currentFrameIndex >= frames.length - 1 && isPlaying) {
      setIsPlaying(false);
    }
  }, [currentFrameIndex, frames.length, isPlaying]);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' ||
        (e.target as HTMLElement).tagName === 'BUTTON') return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const dx = e.clientX - dragStartRef.current.x;
      const dy = e.clientY - dragStartRef.current.y;
      setPosition({
        x: dragStartRef.current.posX + dx,
        y: dragStartRef.current.posY + dy,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  const handleFrameInputStart = () => {
    setIsEditingFrame(true);
    setFrameInputValue(String(currentFrameIndex + 1));
    setTimeout(() => frameInputRef.current?.select(), 0);
  };

  const handleFrameInputSubmit = () => {
    const frameNum = parseInt(frameInputValue);
    if (!isNaN(frameNum) && frameNum >= 1 && frameNum <= frames.length) {
      onFrameChange(frameNum - 1);
    }
    setIsEditingFrame(false);
  };

  const handleFrameInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleFrameInputSubmit();
    else if (e.key === 'Escape') setIsEditingFrame(false);
  };

  const cyclePlaybackSpeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    const speeds = [0.25, 0.5, 1, 2, 4];
    const currentIndex = speeds.indexOf(playbackSpeed);
    const nextIndex = (currentIndex + 1) % speeds.length;
    setPlaybackSpeed(speeds[nextIndex]);
  };

  const progress = frames.length > 1 ? (currentFrameIndex / (frames.length - 1)) * 100 : 0;

  const iconBtn = (disabled = false) =>
    `p-1 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors ${disabled ? 'opacity-25 pointer-events-none' : ''}`;

  return (
    <div
      className="absolute bottom-5 left-1/2 z-40 select-none"
      style={{
        transform: `translate(calc(-50% + ${position.x}px), ${position.y}px)`,
        cursor: isDragging ? 'grabbing' : 'grab',
      }}
      onMouseDown={handleMouseDown}
    >
      <div className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-950/85 backdrop-blur-xl border border-white/8 rounded-full shadow-2xl shadow-black/50">

        {/* First Frame */}
        <button
          onClick={() => onFrameChange(0)}
          disabled={currentFrameIndex === 0}
          className={iconBtn(currentFrameIndex === 0)}
          title="First Frame"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z"/>
          </svg>
        </button>

        {/* Previous Frame */}
        <button
          onClick={() => onFrameChange(Math.max(0, currentFrameIndex - 1))}
          disabled={currentFrameIndex === 0}
          className={iconBtn(currentFrameIndex === 0)}
          title="Previous Frame"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
          </svg>
        </button>

        {/* Play / Pause */}
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors duration-150 ${
            isPlaying
              ? 'bg-white text-gray-900 shadow-md shadow-white/20'
              : 'bg-white/12 text-white hover:bg-white/20'
          }`}
          title={isPlaying ? 'Pause' : 'Play'}
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

        {/* Next Frame */}
        <button
          onClick={() => onFrameChange(Math.min(frames.length - 1, currentFrameIndex + 1))}
          disabled={currentFrameIndex >= frames.length - 1}
          className={iconBtn(currentFrameIndex >= frames.length - 1)}
          title="Next Frame"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
          </svg>
        </button>

        {/* Last Frame */}
        <button
          onClick={() => onFrameChange(frames.length - 1)}
          disabled={currentFrameIndex >= frames.length - 1}
          className={iconBtn(currentFrameIndex >= frames.length - 1)}
          title="Last Frame"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7L8 5zM18 5v14h2V5h-2z"/>
          </svg>
        </button>

        {/* Divider */}
        <div className="mx-1 w-px h-4 bg-white/10" />

        {/* Progress Scrubber */}
        <div className="relative group flex items-center">
          <div className="relative w-36 h-1.5 bg-white/10 rounded-full overflow-visible cursor-pointer">
            {/* Fill */}
            <div
              className="absolute inset-y-0 left-0 bg-gradient-to-r from-blue-400 to-cyan-400 rounded-full pointer-events-none"
              style={{ width: `${progress}%` }}
            />
            {/* Thumb */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 bg-white rounded-full shadow pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ left: `calc(${progress}% - 5px)` }}
            />
            {/* Range Input */}
            <input
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              value={currentFrameIndex}
              onChange={(e) => onFrameChange(parseInt(e.target.value))}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
            />
          </div>
        </div>

        {/* Divider */}
        <div className="mx-1 w-px h-4 bg-white/10" />

        {/* Frame Counter */}
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
            <span className="font-semibold text-white/90">{currentFrameIndex + 1}</span>
            <span className="text-white/35">/{frames.length}</span>
          </button>
        )}

        {/* Divider */}
        <div className="mx-1 w-px h-4 bg-white/10" />

        {/* Speed Control */}
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

      </div>
    </div>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const SemanticSegmentationEditor: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();

  // Read taxonomy from URL params (passed from DatasetDetail or task list)
  const urlTaxonomyId = searchParams.get('taxonomy');

  // View state
  const [isTopView, setIsTopView] = useState(false);
  const [showSlicePanel, setShowSlicePanel] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDetectingGround, setIsDetectingGround] = useState(false);
  const [showBrushZoom, setShowBrushZoom] = useState(true);
  const [showClassPanel, setShowClassPanel] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);
  const [selectedTaxonomyId, setSelectedTaxonomyId] = useState<string>('');

  // Guided tour auto-start
  const { completedTours, isTourRunning, startTour } = useOnboardingStore();
  const tourStartedRef = useRef(false);
  useEffect(() => {
    if (tourStartedRef.current || isTourRunning) return;
    if (!completedTours.includes('segmentation_3d_editor')) {
      tourStartedRef.current = true;
      setTimeout(() => startTour('segmentation_3d_editor'), 1200);
    }
  }, [completedTours, isTourRunning, startTour]);

  // Camera navigation state for navigating to issues
  const [cameraNavigateTarget, setCameraNavigateTarget] = useState<{ x: number; y: number; z: number } | null>(null);

  // Submission workflow state
  const [showSubmissionModal, setShowSubmissionModal] = useState(false);
  const [nextTask, setNextTask] = useState<Task | null>(null);
  const [isLoadingNextTask, setIsLoadingNextTask] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showQACompleteModal, setShowQACompleteModal] = useState(false);

  // Spatial issue state (for QA reviewers to point at specific locations)
  const [showSpatialIssueModal, setShowSpatialIssueModal] = useState(false);
  const [spatialIssueLocation, setSpatialIssueLocation] = useState<{ x: number; y: number; z: number } | null>(null);
  const [isAddingSpatialIssue, setIsAddingSpatialIssue] = useState(false);

  // QA Mode detection
  const isQAMode = useIsQAMode();
  const { canReviewQA } = useAuthStore();
  const userCanReviewQA = canReviewQA();
  // Effective QA mode: only true if both isQAMode AND user has permission
  const effectiveQAMode = isQAMode && userCanReviewQA;

  // QA session management
  const startQASession = useQAStore((s) => s.startQASession);
  const exitQAMode = useQAStore((s) => s.exitQAMode);
  const approveAnnotation = useQAStore((s) => s.approveAnnotation);
  const rejectAnnotation = useQAStore((s) => s.rejectAnnotation);
  const createSpatialIssue = useQAStore((s) => s.createSpatialIssue);
  const currentQAAnnotationReviews = useQAStore((s) => s.annotationReviews);

  // Camera view overlay state
  const [activeCameraView, setActiveCameraView] = useState<{
    name: string;
    imageUrl: string;
    calibration: CameraCalibration;
  } | null>(null);

  // Segmentation store
  const {
    currentFrameIndex,
    setCurrentFrame,
    initializeFrame,
    setSceneContext,
    reset: resetSegmentation,
  } = useSegmentationStore();

  const activeClassId = useSegmentationStore((s) => s.activeClassId);
  const labelPoints = useSegmentationStore((s) => s.labelPoints);
  const getLabelsForFrame = useSegmentationStore((s) => s.getLabelsForFrame);
  const getInstanceIdsForFrame = useSegmentationStore((s) => s.getInstanceIdsForFrame);
  const getSemanticLabelsForFrame = useSegmentationStore((s) => s.getSemanticLabelsForFrame);
  const segmentationMode = useSegmentationStore((s) => s.segmentationMode);
  const getInstancesForFrame = useSegmentationStore((s) => s.getInstancesForFrame);
  const splitSourceInstanceId = useSegmentationStore((s) => s.splitSourceInstanceId);
  const confirmSplit = useSegmentationStore((s) => s.confirmSplit);
  const cancelSplit = useSegmentationStore((s) => s.cancelSplit);
  const splitSelectionCount = useSegmentationStore((s) => s.selectedPointIndices.size);
  const pickedInstanceCount = useSegmentationStore((s) => s.pickedInstanceIds.size);
  const mergePickedInstances = useSegmentationStore((s) => s.mergePickedInstances);
  const clearPickedInstances = useSegmentationStore((s) => s.clearPickedInstances);
  const getDirtyFrames = useSegmentationStore((s) => s.getDirtyFrames);
  const markFrameSaved = useSegmentationStore((s) => s.markFrameSaved);
  const completeSegment = useSegmentationStore((s) => s.completeSegment);
  const undo = useSegmentationStore((s) => s.undo);
  const redo = useSegmentationStore((s) => s.redo);
  const clearSelection = useSegmentationStore((s) => s.clearSelection);
  const selectedPointIndices = useSegmentationStore((s) => s.selectedPointIndices);
  const activeTool = useSegmentationStore((s) => s.activeTool);
  const setActiveTool = useSegmentationStore((s) => s.setActiveTool);
  const setBrushSettings = useSegmentationStore((s) => s.setBrushSettings);

  // 4D mode settings from store
  const is4DMode = useSegmentationStore((s) => s.is4DMode);
  const scanCount = useSegmentationStore((s) => s.scanCount);

  // Data fetching
  const { data: task, isLoading: loadingTask } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => taskApi.get(taskId!),
    enabled: !!taskId,
    staleTime: 0, // Always fetch fresh task data (important for stage/status updates)
    refetchOnMount: true,
  });

  const { data: scene } = useQuery({
    queryKey: ['scene', task?.scene_id],
    queryFn: () => sceneApi.get(task!.scene_id),
    enabled: !!task?.scene_id,
  });

  const { data: _dataset } = useQuery({
    queryKey: ['dataset', scene?.dataset_id],
    queryFn: () => datasetApi.get(scene!.dataset_id),
    enabled: !!scene?.dataset_id,
  });

  // Note: framesData contains { frames: Frame[], ... }
  const { data: framesData } = useQuery({
    queryKey: ['task-frames', taskId],
    queryFn: () => taskApi.getFrames(taskId!),
    enabled: !!taskId,
  });

  // Extract frames array from response
  const frames = framesData?.frames ?? [];

  // Fetch taxonomy for segmentation
  const { data: taxonomies = [] } = useQuery({
    queryKey: ['dataset-segmentation-taxonomies', scene?.dataset_id],
    queryFn: async () => {
      // Try segmentation_3d primary → segmentation_3d any → fusion_3d → any taxonomy
      let taxonomies = await taxonomyApi.getForDataset(scene!.dataset_id, 'segmentation_3d', true);
      if (taxonomies.length === 0) {
        taxonomies = await taxonomyApi.getForDataset(scene!.dataset_id, 'segmentation_3d', false);
      }
      if (taxonomies.length === 0) {
        taxonomies = await taxonomyApi.getForDataset(scene!.dataset_id, 'fusion_3d', false);
      }
      if (taxonomies.length === 0) {
        taxonomies = await taxonomyApi.getForDataset(scene!.dataset_id, undefined, false);
      }
      console.log('[SegmentationEditor] Loaded', taxonomies.length, 'taxonomies');
      return taxonomies;
    },
    enabled: !!scene?.dataset_id,
  });

  // Select taxonomy: URL param > scene.selected_taxonomy_id > first taxonomy
  useEffect(() => {
    if (taxonomies.length === 0) return;

    // Priority 1: URL taxonomy
    if (urlTaxonomyId && taxonomies.some(t => t.id === urlTaxonomyId)) {
      if (selectedTaxonomyId !== urlTaxonomyId) {
        console.log('[SegmentationEditor] Using URL taxonomy:', urlTaxonomyId);
        setSelectedTaxonomyId(urlTaxonomyId);
      }
      return;
    }

    // Priority 2: Scene's selected taxonomy
    if (scene?.selected_taxonomy_id && taxonomies.some(t => t.id === scene.selected_taxonomy_id)) {
      if (selectedTaxonomyId !== scene.selected_taxonomy_id) {
        console.log('[SegmentationEditor] Using scene taxonomy:', scene.selected_taxonomy_id);
        setSelectedTaxonomyId(scene.selected_taxonomy_id);
      }
      return;
    }

    // Priority 3: First taxonomy (fallback)
    if (!selectedTaxonomyId) {
      console.log('[SegmentationEditor] Using first taxonomy:', taxonomies[0].id);
      setSelectedTaxonomyId(taxonomies[0].id);
    }
  }, [taxonomies, urlTaxonomyId, scene?.selected_taxonomy_id, selectedTaxonomyId]);

  // Get currently selected taxonomy
  const taxonomy = useMemo(() => {
    return taxonomies.find(t => t.id === selectedTaxonomyId) || taxonomies[0] || null;
  }, [taxonomies, selectedTaxonomyId]);

  // Get per-taxonomy workflow status when a taxonomy is selected
  // This is needed for proper workflow transitions in per-taxonomy workflow mode
  const { data: taxonomyWorkflowInfo } = useQuery({
    queryKey: ['workflow-info', taskId, selectedTaxonomyId],
    queryFn: () => workflowApi.getInfo(taskId!, selectedTaxonomyId!),
    enabled: !!taskId && !!selectedTaxonomyId,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Effective stage/status: use task directly since post-migration 034, each task is per-taxonomy
  // (taxonomyWorkflowInfo.stage === task.stage always; using taxonomyWorkflowInfo caused stale-cache
  // race conditions where briefly-cached 'annotation' stage would fire exitQAMode incorrectly)
  const effectiveStage = task?.stage ?? 'annotation';
  const effectiveStatus = task?.status ?? 'pending';
  const effectiveRevisionCount = task?.revision_count ?? 0;

  // === Revision Mode: Detect and fetch QA reviews for rejected segments ===
  const isRevisionMode = effectiveRevisionCount > 0 && effectiveStage === 'annotation';

  // Fetch QA task reviews to find the latest review
  const { data: revisionReviews } = useQuery({
    queryKey: ['qa-reviews-for-revision', task?.id],
    queryFn: () => qaApi.getTaskReviews(task!.id),
    enabled: isRevisionMode && !!task?.id,
    staleTime: 5 * 60 * 1000,
  });

  // Get the latest review ID
  const latestRevisionReviewId = useMemo(() => {
    if (!revisionReviews?.length) return null;
    const sorted = [...revisionReviews].sort((a, b) =>
      new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime()
    );
    return sorted[0]?.id || null;
  }, [revisionReviews]);

  // Fetch annotation reviews for the latest QA review
  const { data: revisionAnnotationReviews } = useQuery({
    queryKey: ['qa-annotation-reviews-revision', latestRevisionReviewId],
    queryFn: () => qaApi.getAnnotationReviews(latestRevisionReviewId!),
    enabled: !!latestRevisionReviewId && isRevisionMode,
    staleTime: 5 * 60 * 1000,
  });

  // Map segment reviews by annotation_id (format: "{frameId}-{instanceId}")
  const segmentReviewsMap = useMemo(() => {
    const map = new Map<string, AnnotationReview>();
    const sourceReviews = isRevisionMode
      ? (revisionAnnotationReviews ?? [])
      : Array.from(currentQAAnnotationReviews.values());

    for (const review of sourceReviews) {
      // Only process segmentation reviews
      if (review.annotation_table === 'segmentation_labels') {
        map.set(review.annotation_id, review);
      }
    }
    console.log('[SegmentationEditor] Segment reviews map:', map.size, 'entries');
    return map;
  }, [isRevisionMode, revisionAnnotationReviews, currentQAAnnotationReviews]);

  // Spatial-issues memos are declared after `currentFrame` further below —
  // they need it to filter by frame_id, and React's TDZ would break otherwise.

  // Debug log for workflow status (remove after debugging)
  useEffect(() => {
    console.log('[SegmentationEditor] Workflow status:', {
      taskId,
      selectedTaxonomyId,
      taxonomyWorkflowInfo,
      taskStage: task?.stage,
      taskStatus: task?.status,
      effectiveStage,
      effectiveStatus,
      isQAMode,
      userCanReviewQA,
    });
  }, [taskId, selectedTaxonomyId, taxonomyWorkflowInfo, task?.stage, task?.status, effectiveStage, effectiveStatus, isQAMode, userCanReviewQA]);


  // Auto-start QA session when task is in QA or customer_qa stage
  // This mirrors FusionEditorV2's behavior for consistent QA workflow
  useEffect(() => {
    if (task && (effectiveStage === 'qa' || effectiveStage === 'customer_qa') && !isQAMode && userCanReviewQA) {
      // Start QA session with the appropriate stage
      console.log('[SegmentationEditor] Starting QA session for stage:', effectiveStage);
      startQASession(task.id, 'suggest', effectiveStage)
        .then(() => {
          console.log('[SegmentationEditor] QA session started successfully');
        })
        .catch((error) => {
          console.error('[SegmentationEditor] Failed to auto-start QA session:', error);
        });
    } else if (task && effectiveStage === 'annotation' && isQAMode) {
      // If we're in annotation stage but QA mode is still enabled, disable it
      console.log('[SegmentationEditor] Disabling QA mode for annotation stage');
      exitQAMode();
    }
  }, [effectiveStage, task?.id, isQAMode, startQASession, userCanReviewQA, exitQAMode]);

  // Current frame
  const currentFrame = useMemo(() => {
    return frames[currentFrameIndex] || null;
  }, [frames, currentFrameIndex]);

  // ── Spatial issues for the current frame ────────────────────────────────
  // Declared down here (rather than near other QA state above) because the
  // filter depends on `currentFrame` and React's TDZ would otherwise reject
  // a forward reference. createSpatialIssue stamps frame_id on each new issue,
  // and we drop ones that don't belong to the frame currently in view.

  const revisionSpatialIssues = useMemo(() => {
    return extractSpatialIssues(revisionAnnotationReviews);
  }, [revisionAnnotationReviews]);

  const currentQASpatialIssues = useMemo(() => {
    return extractSpatialIssues(Array.from(currentQAAnnotationReviews.values()));
  }, [currentQAAnnotationReviews]);

  const allSpatialIssues = useMemo(() => {
    const currentFrameId = currentFrame?.id;
    // Legacy issues stored without frame_id are shown everywhere — only seen
    // in pre-fix data; new issues always carry frame_id.
    const matchesCurrentFrame = (issue: SpatialIssue) =>
      !issue.frame_id || issue.frame_id === currentFrameId;

    if (isRevisionMode) {
      return revisionSpatialIssues.filter(matchesCurrentFrame);
    }
    if (effectiveQAMode) {
      // currentQASpatialIssues already reflects what's in the QA store after
      // createSpatialIssue resolves — no separate local-session list needed
      // (it used to double-render with a temp-${Date.now()} id).
      return currentQASpatialIssues.filter(matchesCurrentFrame);
    }
    return [];
  }, [isRevisionMode, effectiveQAMode, revisionSpatialIssues, currentQASpatialIssues, currentFrame?.id]);

  const showSpatialIssueMarkers = allSpatialIssues.length > 0;

  const taskUnresolvedIssueCount = useMemo(() => {
    if (!isRevisionMode) return 0;
    return revisionSpatialIssues.filter(i => !i.annotator_resolved).length;
  }, [isRevisionMode, revisionSpatialIssues]);

  const submitBlockedReason = useMemo(() => {
    if (taskUnresolvedIssueCount === 0) return null;
    const n = taskUnresolvedIssueCount;
    return n === 1
      ? '1 issue still needs to be marked as fixed before you can submit'
      : `${n} issues still need to be marked as fixed before you can submit`;
  }, [taskUnresolvedIssueCount]);

  const resolveSpatialIssueAction = useQAStore((s) => s.resolveSpatialIssue);
  const handleResolveIssue = useCallback(async (issue: SpatialIssue) => {
    // In revision mode the issues panel reads from a React Query cache
    // (queryKey ['qa-annotation-reviews-revision', latestRevisionReviewId]),
    // NOT from the QA store. Optimistically patch the cache so the UI flips
    // instantly, then fire the API, then invalidate to reconcile with the
    // server. On error, the invalidate restores the truth.
    const queryKey = ['qa-annotation-reviews-revision', latestRevisionReviewId];
    const previous = queryClient.getQueryData<AnnotationReview[]>(queryKey);
    if (previous) {
      queryClient.setQueryData<AnnotationReview[]>(
        queryKey,
        previous.map(r => r.id === issue.id ? { ...r, annotator_resolved: true } : r),
      );
    }
    try {
      await resolveSpatialIssueAction(issue.id);
    } catch {
      // Roll back the optimistic flip so the UI matches reality.
      if (previous) queryClient.setQueryData(queryKey, previous);
    } finally {
      // Always reconcile with the server — handles concurrent edits too.
      queryClient.invalidateQueries({ queryKey });
    }
  }, [resolveSpatialIssueAction, queryClient, latestRevisionReviewId]);

  // ── Per-frame time tracking (keyed per task + taxonomy) ──────────────────
  const frameEnterTimeRef = useRef<number | null>(null);
  const prevFrameIndexRef = useRef<number>(-1);
  // Mirror timer running state from Header's timerStateChange event
  const [editorTimerRunning, setEditorTimerRunning] = useState(false);

  // Seed from localStorage so we don't miss the initial dispatch if Header fired before us
  useEffect(() => {
    if (!task?.id) return;
    try {
      const key = selectedTaxonomyId
        ? `task_timer_${task.id}_${selectedTaxonomyId}`
        : `task_timer_${task.id}`;
      const raw = localStorage.getItem(key);
      if (raw) setEditorTimerRunning(JSON.parse(raw).running === true);
    } catch {}
  }, [task?.id, selectedTaxonomyId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ running: boolean; taskId: string }>).detail;
      if (detail?.taskId === task?.id) setEditorTimerRunning(detail.running);
    };
    window.addEventListener('timerStateChange', handler);
    return () => window.removeEventListener('timerStateChange', handler);
  }, [task?.id]);

  // Read timer running state directly from localStorage — avoids race conditions with state
  const isTimerRunningFromStorage = (): boolean => {
    if (!task?.id) return false;
    try {
      const key = selectedTaxonomyId
        ? `task_timer_${task.id}_${selectedTaxonomyId}`
        : `task_timer_${task.id}`;
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as { running?: boolean }).running === true : false;
    } catch { return false; }
  };

  // Track per-frame time: fires on frame nav, timer toggle, or taxonomy change
  useEffect(() => {
    if (!task?.id) return;

    const now = Date.now();
    const prevIndex = prevFrameIndexRef.current;
    const timerRunning = isTimerRunningFromStorage();

    // Frame changed while timer was running — record time on previous frame
    if (
      prevIndex >= 0 &&
      prevIndex !== currentFrameIndex &&
      frameEnterTimeRef.current !== null
    ) {
      const spent = Math.round((now - frameEnterTimeRef.current) / 1000);
      if (spent > 0 && spent < 3600) {
        try {
          const key = selectedTaxonomyId
            ? `task_frame_times_${task.id}_${selectedTaxonomyId}`
            : `task_frame_times_${task.id}`;
          const raw = localStorage.getItem(key);
          const data: Record<number, { totalSeconds: number; visits: number }> = raw ? JSON.parse(raw) : {};
          const entry = data[prevIndex] ?? { totalSeconds: 0, visits: 0 };
          entry.totalSeconds += spent;
          entry.visits += 1;
          data[prevIndex] = entry;
          localStorage.setItem(key, JSON.stringify(data));
        } catch {}
      }
    }

    // Update refs — start tracking from now if timer is running
    frameEnterTimeRef.current = timerRunning ? now : null;
    prevFrameIndexRef.current = currentFrameIndex;
  }, [currentFrameIndex, task?.id, editorTimerRunning, selectedTaxonomyId]);

  // On timer pause: record time for current frame immediately
  useEffect(() => {
    if (editorTimerRunning || !task?.id || frameEnterTimeRef.current === null) return;
    const spent = Math.round((Date.now() - frameEnterTimeRef.current) / 1000);
    if (spent > 0 && spent < 3600) {
      try {
        const key = selectedTaxonomyId
          ? `task_frame_times_${task.id}_${selectedTaxonomyId}`
          : `task_frame_times_${task.id}`;
        const raw = localStorage.getItem(key);
        const data: Record<number, { totalSeconds: number; visits: number }> = raw ? JSON.parse(raw) : {};
        const entry = data[prevFrameIndexRef.current] ?? { totalSeconds: 0, visits: 0 };
        entry.totalSeconds += spent;
        entry.visits += 1;
        data[prevFrameIndexRef.current] = entry;
        localStorage.setItem(key, JSON.stringify(data));
      } catch {}
    }
    frameEnterTimeRef.current = null;
  }, [editorTimerRunning, task?.id, selectedTaxonomyId]);

  // Segment review handlers - persist to backend via QA store
  // Review keys are scoped to the active layer so semantic and instance QA are
  // kept fully separate (e.g. "{frameId}-semantic-{classId}" vs
  // "{frameId}-instance-{instanceId}").
  const handleApproveSegment = useCallback(async (instanceId: number) => {
    if (!currentFrame?.id) return;
    const annotationId = `${currentFrame.id}-${segmentationMode}-${instanceId}`;
    console.log('[QA] Approving segment:', { instanceId, annotationId, frameId: currentFrame.id });
    try {
      await approveAnnotation(annotationId, currentFrame.id, undefined, 'segmentation_labels');
    } catch (error) {
      console.error('[QA] Failed to approve segment:', error);
    }
  }, [currentFrame?.id, approveAnnotation, segmentationMode]);

  const handleRejectSegment = useCallback(async (instanceId: number, issueTypes: string[], notes: string) => {
    if (!currentFrame?.id) return;
    const annotationId = `${currentFrame.id}-${segmentationMode}-${instanceId}`;
    console.log('[QA] Rejecting segment:', { instanceId, annotationId, frameId: currentFrame.id, issueTypes, notes });
    try {
      await rejectAnnotation(annotationId, issueTypes, notes, currentFrame.id, undefined, 'segmentation_labels');
    } catch (error) {
      console.error('[QA] Failed to reject segment:', error);
    }
  }, [currentFrame?.id, rejectAnnotation, segmentationMode]);

  // Approve All handler - approves all pending segments in current frame
  const [isApprovingAll, setIsApprovingAll] = useState(false);
  const handleApproveAll = useCallback(async () => {
    if (!currentFrame?.id) return;

    const instances = getInstancesForFrame(currentFrameIndex);
    const instanceIds = Array.from(instances.keys());

    if (instanceIds.length === 0) {
      console.log('[QA] No segments to approve');
      return;
    }

    setIsApprovingAll(true);
    console.log('[QA] Approving all segments:', instanceIds.length);

    try {
      // Approve each segment sequentially (active layer only).
      for (const instanceId of instanceIds) {
        const annotationId = `${currentFrame.id}-${segmentationMode}-${instanceId}`;
        await approveAnnotation(annotationId, currentFrame.id, undefined, 'segmentation_labels');
      }
      console.log('[QA] All segments approved successfully');
    } catch (error) {
      console.error('[QA] Failed to approve all segments:', error);
    } finally {
      setIsApprovingAll(false);
    }
  }, [currentFrame?.id, currentFrameIndex, getInstancesForFrame, approveAnnotation, segmentationMode]);

  // Handler for clicking on the point cloud to add a spatial issue
  const handlePointCloudClick = useCallback((position: { x: number; y: number; z: number }) => {
    if (isAddingSpatialIssue && effectiveQAMode) {
      setSpatialIssueLocation(position);
      setShowSpatialIssueModal(true);
      setIsAddingSpatialIssue(false);
    }
  }, [isAddingSpatialIssue, effectiveQAMode]);

  // Handler for submitting a spatial issue
  const handleSubmitSpatialIssue = useCallback(async (issueTypes: string[], notes: string) => {
    if (!currentFrame?.id || !spatialIssueLocation) return;

    try {
      await createSpatialIssue(
        currentFrame.id,
        spatialIssueLocation,
        issueTypes,
        notes
      );
      // createSpatialIssue already updates the QA store, which feeds
      // currentQASpatialIssues — no local push needed, and pushing one
      // with a temp id used to render a duplicate marker.

      console.log('[QA] Spatial issue created at:', spatialIssueLocation);
      setShowSpatialIssueModal(false);
      setSpatialIssueLocation(null);
    } catch (error) {
      console.error('[QA] Failed to create spatial issue:', error);
    }
  }, [currentFrame?.id, spatialIssueLocation, createSpatialIssue]);

  // Handler for navigating to a spatial issue in the point cloud
  const handleNavigateToIssue = useCallback((issue: SpatialIssue) => {
    console.log('[Navigation] Navigating to issue:', issue.id, 'at', issue.x, issue.y, issue.z);
    // Navigate to the issue with top-down zoomed view
    setCameraNavigateTarget({ x: issue.x, y: issue.y, z: issue.z });
  }, []);

  // Handler for taxonomy change - redirects to fusion editor if non-segmentation taxonomy
  const handleTaxonomyChange = useCallback((taxonomyId: string) => {
    const newTaxonomy = taxonomies.find(t => t.id === taxonomyId);
    if (newTaxonomy && newTaxonomy.annotation_mode !== 'segmentation_3d' && task?.id) {
      // Redirect to fusion editor with the new taxonomy
      navigate(`/tasks/${task.id}/editor?taxonomy=${taxonomyId}`, { replace: true });
      return;
    }
    // Stay on segmentation editor — Header's effect handles timer save/restore on prop change
    setSelectedTaxonomyId(taxonomyId);
  }, [taxonomies, task?.id, navigate]);

  // Handler for clearing all labels, issues, comments and resetting task to annotation stage
  const handleClearAllAndReset = useCallback(async () => {
    if (!task?.id || !selectedTaxonomyId || !taskId) {
      console.error('[Clear All] No task or taxonomy selected');
      return;
    }

    try {
      console.log('[Clear All] Starting full reset for task:', task.id);

      // 1. Clear segmentation labels from backend
      await segmentationApi.clearAllLabels(task.id);
      console.log('[Clear All] Backend segmentation labels cleared');

      // 2. Reset the task to annotation stage (this also deletes QA reviews and resets revision_count)
      await workflowApi.setStage(task.id, 'annotation', selectedTaxonomyId, true);
      console.log('[Clear All] Task reset to annotation stage');

      // 3. Clear local segmentation store, preserving the chosen granularity
      //    (semantic vs instance) so the user can keep annotating in the same
      //    mode after a fresh reset.
      const prevMode = useSegmentationStore.getState().segmentationMode;
      resetSegmentation();
      useSegmentationStore.getState().setSegmentationMode(prevMode);
      console.log('[Clear All] Local store cleared');

      // 5. Invalidate and refetch queries to refresh data immediately
      // Use taskId (URL param string) for consistency with query keys
      await queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      await queryClient.invalidateQueries({ queryKey: ['workflow-info', taskId, selectedTaxonomyId] });
      await queryClient.invalidateQueries({ queryKey: ['tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      await queryClient.invalidateQueries({ queryKey: ['qa-annotation-reviews-revision'] });
      await queryClient.invalidateQueries({ queryKey: ['segmentation-labels'] });
      await queryClient.invalidateQueries({ queryKey: ['qa-reviews'] });
      await queryClient.invalidateQueries({ queryKey: ['revision-reviews'] });

      // Force immediate refetch of critical data
      await queryClient.refetchQueries({ queryKey: ['task', taskId] });
      await queryClient.refetchQueries({ queryKey: ['workflow-info', taskId, selectedTaxonomyId] });

      console.log('[Clear All] Reset complete - revision badge should now be cleared');
    } catch (error) {
      console.error('[Clear All] Failed to reset:', error);
      throw error;
    }
  }, [task?.id, taskId, selectedTaxonomyId, resetSegmentation, queryClient]);

  // Build lidar file path from scene storage paths and frame file paths
  const lidarFilePath = useMemo(() => {
    if (!scene?.storage_paths?.lidar_base || !currentFrame?.file_paths?.lidar) {
      return null;
    }
    const base = scene.storage_paths.lidar_base.replace(/\/$/, '');
    const filename = currentFrame.file_paths.lidar;
    return `${base}/${filename}`;
  }, [scene?.storage_paths?.lidar_base, currentFrame?.file_paths?.lidar]);

  // Fetch point cloud for current frame
  const getCached = useLidarCacheStore((s) => s.getCached);
  const { data: pointCloudData, isLoading: loadingPointCloud } = useQuery({
    queryKey: ['pointcloud', lidarFilePath],
    queryFn: async () => {
      if (!lidarFilePath) return null;

      // Check cache first
      const cached = getCached(lidarFilePath);
      if (cached) return cached;

      // Fetch from API using getLidarData
      const data = await dataApi.getLidarData(lidarFilePath);
      return {
        positions: data.positions instanceof Float32Array ? data.positions : new Float32Array(data.positions),
        intensities: data.intensities ? (data.intensities instanceof Float32Array ? data.intensities : new Float32Array(data.intensities)) : undefined,
        pointCount: data.pointCount,
      } as PointCloudData;
    },
    enabled: !!lidarFilePath,
    staleTime: 60000, // Cache for 1 minute
  });

  // ==========================================================================
  // 4D MODE: Multi-frame loading and stacking
  // ==========================================================================

  // Compute adjacent frame indices for 4D mode
  const adjacentFrameInfos = useMemo(() => {
    if (!is4DMode || scanCount <= 1 || !scene?.storage_paths?.lidar_base) return [];

    const infos: Array<{
      frameIndex: number;
      frame: typeof frames[0];
      lidarPath: string;
    }> = [];

    // Get frames before and after current
    const halfScan = Math.floor((scanCount - 1) / 2);
    for (let offset = -halfScan; offset <= halfScan; offset++) {
      if (offset === 0) continue; // Skip current frame

      const idx = currentFrameIndex + offset;
      if (idx >= 0 && idx < frames.length) {
        const frame = frames[idx];
        if (frame?.file_paths?.lidar) {
          const base = scene.storage_paths.lidar_base.replace(/\/$/, '');
          infos.push({
            frameIndex: idx,
            frame,
            lidarPath: `${base}/${frame.file_paths.lidar}`,
          });
        }
      }
    }

    return infos;
  }, [is4DMode, scanCount, currentFrameIndex, frames, scene?.storage_paths?.lidar_base]);

  // Load adjacent frames' point clouds
  const adjacentPointClouds = useQueries({
    queries: adjacentFrameInfos.map((info) => ({
      queryKey: ['pointcloud', info.lidarPath],
      queryFn: async () => {
        const cached = getCached(info.lidarPath);
        if (cached) return { ...cached, frameIndex: info.frameIndex, egoPose: info.frame.ego_pose };

        const data = await dataApi.getLidarData(info.lidarPath);
        return {
          positions: data.positions instanceof Float32Array ? data.positions : new Float32Array(data.positions),
          intensities: data.intensities ? (data.intensities instanceof Float32Array ? data.intensities : new Float32Array(data.intensities)) : undefined,
          pointCount: data.pointCount,
          frameIndex: info.frameIndex,
          egoPose: info.frame.ego_pose,
        };
      },
      enabled: is4DMode && adjacentFrameInfos.length > 0,
      staleTime: 60000,
    })),
  });

  // Merge point clouds for 4D mode
  const mergedPointCloud = useMemo(() => {
    if (!pointCloudData) return null;
    if (!is4DMode || adjacentFrameInfos.length === 0) return pointCloudData;

    // Gather all loaded adjacent point clouds
    const loadedAdjacent = adjacentPointClouds
      .filter((q) => q.isSuccess && q.data)
      .map((q) => q.data!);

    if (loadedAdjacent.length === 0) return pointCloudData;

    // Current frame ego pose (reference)
    const currentEgoPose = currentFrame?.ego_pose;

    // Get calibration for LiDAR to Ego transform
    const egoToLidarCalib = scene?.calibration?.ego_to_lidar as EgoToLidarCalibration | undefined;
    const lidarToEgo = getLidarToEgoTransform(egoToLidarCalib);

    // Calculate total point count
    let totalPoints = pointCloudData.pointCount;
    for (const adj of loadedAdjacent) {
      totalPoints += adj.pointCount;
    }

    // Create merged arrays
    const mergedPositions = new Float32Array(totalPoints * 3);
    const mergedIntensities = pointCloudData.intensities ? new Float32Array(totalPoints) : undefined;

    let offset = 0;

    // Copy current frame points (unchanged)
    mergedPositions.set(pointCloudData.positions);
    if (mergedIntensities && pointCloudData.intensities) {
      mergedIntensities.set(pointCloudData.intensities);
    }
    offset = pointCloudData.pointCount;

    // Transform and add adjacent frame points
    for (const adj of loadedAdjacent) {
      const adjEgoPose = adj.egoPose;

      for (let i = 0; i < adj.pointCount; i++) {
        const x = adj.positions[i * 3];
        const y = adj.positions[i * 3 + 1];
        const z = adj.positions[i * 3 + 2];

        let outX = x, outY = y, outZ = z;

        // Transform: adj LiDAR -> World -> current LiDAR
        if (adjEgoPose && currentEgoPose) {
          // Step 1: Adjacent LiDAR to World
          const worldPoint = transformToWorld(
            { x, y, z },
            adjEgoPose as EgoPose,
            lidarToEgo
          );

          // Step 2: World to Current LiDAR
          const localPoint = transformFromWorld(
            worldPoint,
            currentEgoPose as EgoPose,
            egoToLidarCalib
          );

          outX = localPoint.x;
          outY = localPoint.y;
          outZ = localPoint.z;
        }

        mergedPositions[(offset + i) * 3] = outX;
        mergedPositions[(offset + i) * 3 + 1] = outY;
        mergedPositions[(offset + i) * 3 + 2] = outZ;

        if (mergedIntensities && adj.intensities) {
          mergedIntensities[offset + i] = adj.intensities[i];
        }
      }

      offset += adj.pointCount;
    }

    return {
      positions: mergedPositions,
      intensities: mergedIntensities,
      pointCount: totalPoints,
    } as PointCloudData;
  }, [
    pointCloudData,
    is4DMode,
    adjacentFrameInfos.length,
    adjacentPointClouds,
    currentFrame?.ego_pose,
    scene?.calibration?.ego_to_lidar,
  ]);

  // Load existing labels from backend when frame changes
  const loadedFramesRef = useRef<Set<number>>(new Set());

  // True when the current frame's segmentation exists in the store. Flips to
  // false after a full reset (Clear All), which re-triggers the loader below so
  // the frame is rebuilt — otherwise paint/label ops no-op on a missing frame.
  const currentFrameLoaded = useSegmentationStore((s) => s.frameSegmentations.has(currentFrameIndex));

  useEffect(() => {
    const loadLabels = async () => {
      if (!taskId || !currentFrame || !pointCloudData) {
        console.log(`[Labels] Skipping load: taskId=${!!taskId}, currentFrame=${!!currentFrame}, pointCloudData=${!!pointCloudData}`);
        return;
      }

      // Skip if already loaded AND still present in the store. After a Clear
      // All reset the store is wiped but the ref still marks it loaded — in
      // that case fall through and rebuild the frame so drawing works again.
      if (
        loadedFramesRef.current.has(currentFrameIndex) &&
        useSegmentationStore.getState().frameSegmentations.has(currentFrameIndex)
      ) {
        console.log(`[Labels] Frame ${currentFrameIndex} already loaded, skipping`);
        return;
      }

      try {
        const pc = pointCloudData.pointCount;
        console.log(`[Labels] Loading both layers for frame ${currentFrameIndex}, pointCount=${pc}...`);
        // Load the instance and semantic layers independently.
        const [instResp, semResp] = await Promise.all([
          segmentationApi.getLabels(taskId, currentFrame.id, 'instance'),
          segmentationApi.getLabels(taskId, currentFrame.id, 'semantic').catch(() => null),
        ]);

        const labelsArray = instResp.labels && instResp.labels.length === pc
          ? new Int32Array(instResp.labels) : undefined;
        const instanceIdsArray = instResp.instance_ids && instResp.instance_ids.length === pc
          ? new Int32Array(instResp.instance_ids) : undefined;
        const semanticArray = semResp?.labels && semResp.labels.length === pc
          ? new Int32Array(semResp.labels) : undefined;

        console.log(`[Labels] instance=${!!labelsArray} instanceIds=${!!instanceIdsArray} semantic=${!!semanticArray}`);
        initializeFrame(currentFrameIndex, pc, labelsArray, instanceIdsArray, semanticArray);
        loadedFramesRef.current.add(currentFrameIndex);
      } catch (err: unknown) {
        // 404 means no labels saved yet - this is normal for new frames
        if (err && typeof err === 'object' && 'response' in err) {
          const axiosErr = err as { response?: { status?: number } };
          if (axiosErr.response?.status === 404) {
            console.log(`[Labels] No saved labels for frame ${currentFrameIndex}, initializing empty`);
            initializeFrame(currentFrameIndex, pointCloudData.pointCount, undefined);
            loadedFramesRef.current.add(currentFrameIndex);
            return;
          }
        }
        console.error(`[Labels] Error loading labels for frame ${currentFrameIndex}:`, err);
        // Initialize empty on error
        initializeFrame(currentFrameIndex, pointCloudData.pointCount, undefined);
        loadedFramesRef.current.add(currentFrameIndex);
      }
    };

    loadLabels();
  }, [taskId, currentFrame, currentFrameIndex, pointCloudData, initializeFrame, currentFrameLoaded]);

  // Set scene context
  useEffect(() => {
    if (scene?.id && taskId) {
      setSceneContext(scene.id, taskId);
    }
  }, [scene?.id, taskId, setSceneContext]);

  // Reset on unmount
  useEffect(() => {
    return () => resetSegmentation();
  }, [resetSegmentation]);

  // Auto-save ref for debouncing
  const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const handleSaveRef = useRef<(() => Promise<void>) | null>(null);

  // Stable refs so keyboard handlers never capture stale values
  const framesRef = useRef(frames);
  framesRef.current = frames;
  const frameIndexRef = useRef(currentFrameIndex);
  frameIndexRef.current = currentFrameIndex;
  // Track whether Shift is currently holding us in erase mode
  const shiftErasingRef = useRef(false);
  // Keep activeTool stable inside the keyboard handler closure
  const activeToolRef = useRef(activeTool);
  activeToolRef.current = activeTool;

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input field
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      // Shift held + Brush active → temporary erase mode
      if (e.key === 'Shift' && !e.repeat && activeToolRef.current === 'brush' && !shiftErasingRef.current) {
        shiftErasingRef.current = true;
        setBrushSettings({ mode: 'erase' });
        return;
      }

      // H - Toggle keyboard shortcuts help
      if (e.key === 'h' || e.key === 'H') {
        if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
          e.preventDefault();
          setShowShortcutsHelp(prev => !prev);
          return;
        }
      }

      // Escape - Close help modal, camera view, or cancel current selection
      if (e.key === 'Escape') {
        // Cancel an in-progress instance split first
        if (useSegmentationStore.getState().splitSourceInstanceId !== null) {
          e.preventDefault();
          useSegmentationStore.getState().cancelSplit();
          return;
        }
        if (showShortcutsHelp) {
          e.preventDefault();
          setShowShortcutsHelp(false);
          return;
        }
        if (activeCameraView) {
          e.preventDefault();
          setActiveCameraView(null);
          return;
        }
        // Cancel current segmentation selection
        if (selectedPointIndices.size > 0) {
          e.preventDefault();
          clearSelection();
          return;
        }
        // Exit active tool and return to Select mode
        if (activeToolRef.current !== 'select') {
          e.preventDefault();
          setActiveTool('select');
          if (shiftErasingRef.current) {
            shiftErasingRef.current = false;
            setBrushSettings({ mode: 'paint' });
          }
          return;
        }
      }

      // Enter - Confirm a split if one is in progress, else complete the segment
      if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
        e.preventDefault();
        if (useSegmentationStore.getState().splitSourceInstanceId !== null) {
          useSegmentationStore.getState().confirmSplit();
          return;
        }
        completeSegment();
        // Trigger auto-save after a short delay
        if (autoSaveTimerRef.current) {
          clearTimeout(autoSaveTimerRef.current);
        }
        autoSaveTimerRef.current = setTimeout(() => {
          if (handleSaveRef.current) {
            handleSaveRef.current();
          }
        }, 500);
      }

      // Ctrl+Z - Undo
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undo();
      }

      // Ctrl+Shift+Z or Ctrl+Y - Redo
      if ((e.ctrlKey || e.metaKey) && (e.key === 'Z' || e.key === 'y')) {
        e.preventDefault();
        redo();
      }

      // C — Toggle top view / 3D view
      if ((e.key === 'c' || e.key === 'C') && !e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        setIsTopView(prev => !prev);
        return;
      }

      // Frame navigation — only when no modifier keys held
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey && !e.altKey) {
        const totalFrames = framesRef.current.length;
        if (totalFrames === 0) return;
        const idx = frameIndexRef.current;

        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          if (idx > 0) setCurrentFrame(idx - 1);
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          if (idx < totalFrames - 1) setCurrentFrame(idx + 1);
        } else if (e.key === 'Home') {
          e.preventDefault();
          setCurrentFrame(0);
        } else if (e.key === 'End') {
          e.preventDefault();
          setCurrentFrame(totalFrames - 1);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Releasing Shift while we injected erase mode → restore paint
      if (e.key === 'Shift' && shiftErasingRef.current) {
        shiftErasingRef.current = false;
        setBrushSettings({ mode: 'paint' });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [completeSegment, undo, redo, activeCameraView, showShortcutsHelp, clearSelection, selectedPointIndices, setActiveTool, setBrushSettings, setCurrentFrame, setIsTopView]);

  // Build class colors map from taxonomy
  const classColors = useMemo(() => {
    const colors = new Map<number, string>();
    if (taxonomy?.classes) {
      taxonomy.classes.forEach((cls, index) => {
        colors.set(index, cls.color);
      });
    }
    return colors;
  }, [taxonomy]);

  // Handle frame change
  const handleFrameChange = useCallback((index: number) => {
    setCurrentFrame(index);
  }, [setCurrentFrame]);

  // Handle save
  const handleSave = useCallback(async () => {
    if (!taskId || frames.length === 0) {
      console.warn('[Save] No task or frames to save');
      return;
    }

    setIsSaving(true);
    try {
      // Get all dirty frames that need saving
      const dirtyFrameIndices = getDirtyFrames();

      if (dirtyFrameIndices.length === 0) {
        console.log('[Save] No changes to save');
        return;
      }

      console.log(`[Save] Saving ${dirtyFrameIndices.length} frames...`);

      // Save each dirty frame
      const savePromises = dirtyFrameIndices.map(async (frameIndex) => {
        const frame = frames[frameIndex];
        if (!frame) {
          console.warn(`[Save] Frame at index ${frameIndex} not found`);
          return;
        }

        const labels = getLabelsForFrame(frameIndex);
        if (!labels) {
          console.warn(`[Save] No labels for frame ${frameIndex}`);
          return;
        }

        // Instance layer (class + instance IDs) and the independent semantic layer.
        const instanceIds = getInstanceIdsForFrame(frameIndex);
        const semanticLabels = getSemanticLabelsForFrame(frameIndex);
        const labelsArray = Array.from(labels);
        const instanceIdsArray = instanceIds ? Array.from(instanceIds) : undefined;

        try {
          await Promise.all([
            segmentationApi.saveLabels(taskId, frame.id, labelsArray, instanceIdsArray, 'instance'),
            semanticLabels
              ? segmentationApi.saveLabels(taskId, frame.id, Array.from(semanticLabels), undefined, 'semantic')
              : Promise.resolve(),
          ]);
          markFrameSaved(frameIndex);
          console.log(`[Save] Saved frame ${frameIndex} (${frame.id}) — both layers`);
        } catch (err) {
          console.error(`[Save] Failed to save frame ${frameIndex}:`, err);
          throw err;
        }
      });

      await Promise.all(savePromises);
      console.log('[Save] All frames saved successfully');

    } catch (error) {
      console.error('[Save] Error saving segmentation:', error);
      // Could show a toast notification here
    } finally {
      setIsSaving(false);
    }
  }, [taskId, frames, getDirtyFrames, getLabelsForFrame, getInstanceIdsForFrame, markFrameSaved]);

  // Keep handleSaveRef updated for auto-save
  useEffect(() => {
    handleSaveRef.current = handleSave;
  }, [handleSave]);

  // Cleanup auto-save timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  // Periodic auto-save every 10 seconds if there are dirty frames
  useEffect(() => {
    const intervalId = setInterval(() => {
      const dirtyFrames = getDirtyFrames();
      if (dirtyFrames.length > 0 && handleSaveRef.current && !isSaving) {
        console.log(`[AutoSave] ${dirtyFrames.length} dirty frame(s), saving...`);
        handleSaveRef.current();
      }
    }, 10000);

    return () => clearInterval(intervalId);
  }, [getDirtyFrames, isSaving]);

  // Handle submit - workflow transition for annotation review
  const handleSubmit = useCallback(async () => {
    if (!task || !taskId) return;

    // Save annotations first
    setIsSaving(true);
    try {
      const dirtyFrameIndices = getDirtyFrames();

      if (dirtyFrameIndices.length > 0) {
        console.log(`[Submit] Saving ${dirtyFrameIndices.length} frames before submit...`);

        const savePromises = dirtyFrameIndices.map(async (frameIndex) => {
          const frame = frames[frameIndex];
          if (!frame) return;

          const labels = getLabelsForFrame(frameIndex);
          if (!labels) return;

          const instanceIds = getInstanceIdsForFrame(frameIndex);
          const semanticLabels = getSemanticLabelsForFrame(frameIndex);
          const labelsArray = Array.from(labels);
          const instanceIdsArray = instanceIds ? Array.from(instanceIds) : undefined;

          await Promise.all([
            segmentationApi.saveLabels(taskId, frame.id, labelsArray, instanceIdsArray, 'instance'),
            semanticLabels
              ? segmentationApi.saveLabels(taskId, frame.id, Array.from(semanticLabels), undefined, 'semantic')
              : Promise.resolve(),
          ]);
          markFrameSaved(frameIndex);
        });

        await Promise.all(savePromises);
        console.log('[Submit] All frames saved');
      }
    } catch (error) {
      console.error('[Submit] Save failed:', error);
      setSubmitError(error instanceof Error ? error.message : 'Failed to save before submit');
      setIsSaving(false);
      return;
    }
    setIsSaving(false);

    // Now handle workflow transition
    try {
      const currentTaxonomyId = selectedTaxonomyId || undefined;
      // Use effective values (per-taxonomy status if available) for proper workflow transitions
      const currentStage = effectiveStage;
      const currentStatus = effectiveStatus;
      const currentRevisionCount = effectiveRevisionCount;

      if (currentStage === 'annotation') {
        // Check if this is revision mode (revision_count > 0)
        if (currentRevisionCount > 0) {
          // Revision mode: submit fixes for QA re-review
          await workflowApi.submitFixes(task.id, currentTaxonomyId);
        } else {
          // Normal annotation stage: submit for QA review
          if (currentStatus === 'pending' || currentStatus === 'assigned') {
            try {
              await workflowApi.startWork(task.id, currentTaxonomyId);
            } catch (startErr) {
              console.log('[Submit] startWork failed (may already be in progress):', startErr);
            }
          }
          await workflowApi.submitAnnotation(task.id, currentTaxonomyId);
        }

        // Invalidate task cache
        queryClient.invalidateQueries({ queryKey: ['task', taskId] });
        queryClient.invalidateQueries({ queryKey: ['tasks'] });
        queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
        queryClient.invalidateQueries({ queryKey: ['workflow-info', taskId, currentTaxonomyId] });

        // Show submission modal and fetch next task
        setIsLoadingNextTask(true);
        setShowSubmissionModal(true);

        try {
          const next = await taskApi.getNextAssignedTask(task.id);
          setNextTask(next);
        } catch (err) {
          console.error('[Submit] Failed to fetch next task:', err);
          setNextTask(null);
        } finally {
          setIsLoadingNextTask(false);
        }
      } else if (currentStage === 'qa' || currentStage === 'customer_qa') {
        // QA stage: open modal for accept/reject
        setShowQACompleteModal(true);
        return;
      }
    } catch (err) {
      console.error('[Submit] Workflow transition failed:', err);
      setSubmitError(err instanceof Error ? err.message : 'Failed to submit');
    }
  }, [task, taskId, frames, selectedTaxonomyId, getDirtyFrames, getLabelsForFrame, getInstanceIdsForFrame, markFrameSaved, queryClient, effectiveStage, effectiveStatus, effectiveRevisionCount]);

  // Submission modal navigation handlers
  const handleOpenNextTask = useCallback(() => {
    if (nextTask) {
      setShowSubmissionModal(false);
      window.location.href = `/tasks/${nextTask.id}`;
    }
  }, [nextTask]);

  const handleGoToTaskList = useCallback(() => {
    setShowSubmissionModal(false);
    navigate('/my-tasks');
  }, [navigate]);

  // QA Modal handlers
  const handleApproveQA = useCallback(async () => {
    if (!task) return;
    try {
      const currentTaxonomyId = selectedTaxonomyId || undefined;
      if (effectiveStage === 'qa') {
        await workflowApi.completeQAReview(task.id, true, undefined, currentTaxonomyId);
      } else if (effectiveStage === 'customer_qa') {
        await workflowApi.completeCustomerReview(task.id, true, undefined, currentTaxonomyId);
      }
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-info', taskId, currentTaxonomyId] });
      setShowQACompleteModal(false);
      navigate('/my-tasks');
    } catch (err) {
      console.error('[QA] Approve failed:', err);
      setSubmitError(err instanceof Error ? err.message : 'Failed to approve');
    }
  }, [task, selectedTaxonomyId, queryClient, navigate, effectiveStage, taskId]);

  const handleRejectQA = useCallback(async (notes: string) => {
    if (!task) return;
    try {
      const currentTaxonomyId = selectedTaxonomyId || undefined;
      if (effectiveStage === 'qa') {
        await workflowApi.completeQAReview(task.id, false, notes, currentTaxonomyId);
      } else if (effectiveStage === 'customer_qa') {
        await workflowApi.completeCustomerReview(task.id, false, notes, currentTaxonomyId);
      }
      queryClient.invalidateQueries({ queryKey: ['task', taskId] });
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      queryClient.invalidateQueries({ queryKey: ['my-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['workflow-info', taskId, currentTaxonomyId] });
      setShowQACompleteModal(false);
      navigate('/my-tasks');
    } catch (err) {
      console.error('[QA] Reject failed:', err);
      setSubmitError(err instanceof Error ? err.message : 'Failed to reject');
    }
  }, [task, selectedTaxonomyId, queryClient, navigate, effectiveStage, taskId]);

  // Handle RANSAC ground plane detection
  const handleDetectGround = useCallback(async () => {
    const pc = mergedPointCloud || pointCloudData;
    if (!pc) {
      console.warn('[RANSAC] No point cloud loaded yet');
      return;
    }
    // Use active class, or fall back to the first class (index "0")
    const targetClassId = activeClassId ?? '0';
    setIsDetectingGround(true);
    try {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          console.log('[RANSAC] Running on', pc.pointCount, 'points with class', targetClassId);
          const result = ransacGroundPlane(pc.positions, pc.pointCount);
          if (result) {
            console.log('[RANSAC] Found ground:', result.inlierIndices.length, 'pts, fraction:', result.inlierFraction.toFixed(3));
            if (result.inlierIndices.length > 0) {
              labelPoints(result.inlierIndices, targetClassId, `Ground plane (${result.inlierIndices.length} pts)`);
            }
          } else {
            console.warn('[RANSAC] No ground plane found');
          }
          resolve();
        });
      });
    } finally {
      setIsDetectingGround(false);
    }
  }, [mergedPointCloud, pointCloudData, activeClassId, labelPoints]);

  // Loading state
  if (loadingTask || !scene || frames.length === 0) {
    return (
      <div className="h-screen flex items-center justify-center bg-dark">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
          <span className="text-gray-400">Loading segmentation editor...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-dark relative">
      {/* Header */}
      <Header
        task={task ?? null}
        sceneName={scene.name}
        currentFrameIndex={currentFrameIndex}
        totalFrames={frames.length}
        onSave={handleSave}
        onSubmit={handleSubmit}
        isSaving={isSaving}
        isTopView={isTopView}
        onToggleView={() => setIsTopView(!isTopView)}
        dirtyFrameCount={getDirtyFrames().length}
        showCameraPanel={showSlicePanel}
        onToggleCameraPanel={() => setShowSlicePanel(!showSlicePanel)}
        onShowHelp={() => setShowShortcutsHelp(true)}
        taxonomies={taxonomies}
        selectedTaxonomyId={selectedTaxonomyId}
        onTaxonomyChange={handleTaxonomyChange}
        isQAMode={effectiveQAMode}
        effectiveStage={effectiveStage}
        effectiveStatus={effectiveStatus}
        effectiveRevisionCount={effectiveRevisionCount}
        isRevisionMode={isRevisionMode}
        isAddingSpatialIssue={isAddingSpatialIssue}
        onToggleSpatialIssue={() => setIsAddingSpatialIssue(!isAddingSpatialIssue)}
        onDeleteAll={handleClearAllAndReset}
        submitBlockedReason={submitBlockedReason}
      />

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Tool palette */}
        <SegmentationToolPalette
          onDetectGround={handleDetectGround}
          isDetectingGround={isDetectingGround}
          isQAMode={effectiveQAMode}
          taskId={taskId}
        />

        {/* Main 3D view */}
        <div className="flex-1 relative">
          {loadingPointCloud || !pointCloudData ? (
            <div className="absolute inset-0 flex items-center justify-center bg-dark">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <SegmentationCanvas
              pointCloud={mergedPointCloud || pointCloudData}
              classColors={classColors}
              taxonomy={taxonomy ?? null}
              isTopView={isTopView}
              onPointClick={handlePointCloudClick}
              spatialIssues={allSpatialIssues}
              showSpatialIssues={showSpatialIssueMarkers}
              cameraNavigateTarget={cameraNavigateTarget}
              onNavigationComplete={() => setCameraNavigateTarget(null)}
              showGrid={showGrid}
            />
          )}

          {/* Camera View Overlay (covers 3D canvas when camera selected) */}
          {activeCameraView && pointCloudData && (
            <SegmentationCameraOverlay
              imageUrl={activeCameraView.imageUrl}
              cameraName={activeCameraView.name}
              calibration={activeCameraView.calibration}
              pointCloud={mergedPointCloud || pointCloudData}
              classColors={classColors}
              onClose={() => setActiveCameraView(null)}
            />
          )}

          {/* Floating Class Selector (left side) — only while a class-selecting
              tool is active (brush/lasso/region-grow), hidden by default and when
              a camera overlay is open. Esc exits the tool and thus hides it. */}
          {showClassPanel && !activeCameraView &&
            (activeTool === 'brush' || activeTool === 'lasso' || activeTool === 'region_grow') &&
            <FloatingClassSelector taxonomy={taxonomy ?? null} />}

          {/* Split-mode banner — brush to select the points to peel off */}
          {splitSourceInstanceId !== null && (
            <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2 bg-dark-panel/95 border border-primary/60 rounded-lg shadow-xl">
              <div className="flex flex-col">
                <span className="text-xs text-white font-medium">
                  Splitting instance — brush the points to separate
                </span>
                <span className="text-[10px] text-gray-400">
                  {splitSelectionCount.toLocaleString()} points selected
                </span>
              </div>
              <button
                onClick={() => cancelSplit()}
                className="px-2.5 py-1 text-xs rounded bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => confirmSplit()}
                disabled={splitSelectionCount === 0}
                className="px-2.5 py-1 text-xs rounded bg-primary text-white hover:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Confirm split
              </button>
            </div>
          )}

          {/* Merge banner — Shift+click instances in the viewer to pick them */}
          {splitSourceInstanceId === null && pickedInstanceCount >= 1 && (
            <div className="absolute top-14 left-1/2 -translate-x-1/2 z-20 flex items-center gap-3 px-4 py-2 bg-dark-panel/95 border border-primary/60 rounded-lg shadow-xl">
              <div className="flex flex-col">
                <span className="text-xs text-white font-medium">
                  {pickedInstanceCount} instance{pickedInstanceCount === 1 ? '' : 's'} picked to merge
                </span>
                <span className="text-[10px] text-gray-400">
                  Shift+click more instances, then Merge{pickedInstanceCount < 2 ? ' (pick at least 2)' : ''}
                </span>
              </div>
              <button
                onClick={() => clearPickedInstances()}
                className="px-2.5 py-1 text-xs rounded bg-gray-700 text-gray-200 hover:bg-gray-600 transition-colors"
              >
                Clear
              </button>
              <button
                onClick={() => mergePickedInstances()}
                disabled={pickedInstanceCount < 2}
                className="px-2.5 py-1 text-xs rounded bg-primary text-white hover:bg-primary/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Merge
              </button>
            </div>
          )}

          {/* View mode indicator + 4D status */}
          <div className="absolute top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/60 rounded-full flex items-center gap-2">
            <span className="text-xs text-gray-300">
              {isTopView ? 'Top View (BEV)' : '3D View'}
            </span>
            {is4DMode && (
              <span className="text-xs text-primary-light bg-primary/20 px-2 py-0.5 rounded">
                4D ({scanCount} frames)
              </span>
            )}
          </div>

          {/* Panel toggle buttons (top-right) */}
          <div className="absolute top-3 right-3 flex items-center gap-1">
            {/* Clip Box Controls */}
            <ClipBoxControls />

            {/* Grid toggle */}
            <button
              onClick={() => setShowGrid(!showGrid)}
              className={`p-1.5 rounded text-xs transition-colors ${
                showGrid ? 'bg-primary text-white' : 'bg-black/60 text-gray-400 hover:text-white hover:bg-black/80'
              }`}
              title={showGrid ? 'Hide ground grid' : 'Show ground grid'}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="1" />
                <path d="M3 9h18" />
                <path d="M3 15h18" />
                <path d="M9 3v18" />
                <path d="M15 3v18" />
              </svg>
            </button>

            {/* Brush Zoom toggle */}
            <button
              onClick={() => setShowBrushZoom(!showBrushZoom)}
              className={`p-1.5 rounded text-xs transition-colors ${
                showBrushZoom ? 'bg-primary text-white' : 'bg-black/60 text-gray-400 hover:text-white hover:bg-black/80'
              }`}
              title={showBrushZoom ? 'Hide zoom inset' : 'Show zoom inset'}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <path d="M21 21l-4.35-4.35" />
                <path d="M11 8v6" />
                <path d="M8 11h6" />
              </svg>
            </button>

            {/* Class Panel toggle */}
            <button
              onClick={() => setShowClassPanel(!showClassPanel)}
              className={`p-1.5 rounded text-xs transition-colors ${
                showClassPanel ? 'bg-primary text-white' : 'bg-black/60 text-gray-400 hover:text-white hover:bg-black/80'
              }`}
              title={showClassPanel ? 'Hide class panel' : 'Show class panel'}
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M7 7h4v4H7z" />
                <path d="M7 13h10" />
                <path d="M7 17h10" />
              </svg>
            </button>
          </div>

          {/* Brush zoom inset - hidden when camera overlay is open */}
          {showBrushZoom && !activeCameraView && (mergedPointCloud || pointCloudData) && (
            <BrushZoomInset
              pointCloud={mergedPointCloud || pointCloudData!}
              classColors={classColors}
            />
          )}

          {/* Floating Timeline */}
          <Timeline
            frames={frames}
            currentFrameIndex={currentFrameIndex}
            onFrameChange={handleFrameChange}
          />
        </div>

        {/* Right panel: Segments */}
        <SegmentsPanel
          taxonomy={taxonomy ?? null}
          isQAMode={effectiveQAMode}
          taskStage={effectiveStage as TaskStage}
          isRevisionMode={isRevisionMode}
          currentFrameId={currentFrame?.id}
          segmentReviewsMap={segmentReviewsMap}
          onApproveSegment={handleApproveSegment}
          onRejectSegment={handleRejectSegment}
          onApproveAll={handleApproveAll}
          isApprovingAll={isApprovingAll}
          spatialIssues={allSpatialIssues}
          onNavigateToIssue={handleNavigateToIssue}
          onResolveIssue={handleResolveIssue}
          // Only the annotator (not the QA reviewer) marks issues fixed,
          // and only when the task has come back for revision.
          canResolveIssues={isRevisionMode && !effectiveQAMode}
          onClearAllAndReset={handleClearAllAndReset}
        />
      </div>

      {/* Bottom Camera Strip Panel */}
      {showSlicePanel && (
        <CameraProjectionPanel
          pointCloud={pointCloudData}
          classColors={classColors}
          scene={scene}
          currentFrame={currentFrame}
          onClose={() => setShowSlicePanel(false)}
          rightOffset={288} // w-72 = 288px for Segments panel
          onCameraSelect={(name, imageUrl, calibration) => {
            if (name && imageUrl && calibration) {
              setActiveCameraView({ name, imageUrl, calibration });
            } else {
              setActiveCameraView(null);
            }
          }}
        />
      )}

      {/* Show camera panel toggle when hidden */}
      {!showSlicePanel && (
        <button
          onClick={() => setShowSlicePanel(true)}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-dark-panel border border-gray-700 rounded-lg flex items-center gap-2 text-gray-400 hover:text-white hover:bg-dark-hover transition-colors"
          title="Show camera views"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="2" y="3" width="20" height="14" rx="2" />
            <circle cx="12" cy="10" r="3" />
          </svg>
          <span className="text-xs">Show Cameras</span>
        </button>
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
              <div className="grid grid-cols-3 gap-6">

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
                      ['Ctrl+Y / Ctrl+Shift+Z', 'Redo'],
                      ['Enter', 'Complete segment'],
                      ['Esc', 'Exit tool / clear selection'],
                      ['H', 'Toggle this help'],
                      ['1–9', 'Quick class select'],
                      ['10+', 'Type 2 digits within 600ms'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center justify-between py-1 px-2 rounded hover:bg-dark/40">
                        <span className="text-xs text-gray-400">{desc}</span>
                        <kbd className="px-1.5 py-0.5 bg-dark border border-gray-600 rounded text-[10px] font-mono text-blue-300">{key}</kbd>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Segmentation Tools */}
                <div>
                  <h3 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-green-500/20 flex items-center justify-center">🎨</span>
                    Segmentation Tools
                  </h3>
                  <div className="space-y-1.5">
                    {[
                      ['V', 'Select tool'],
                      ['B', 'Brush tool'],
                      ['L', 'Lasso tool'],
                      ['G', 'Region Grow tool'],
                      ['E', 'Eraser tool'],
                      ['[ / ]', 'Decrease / Increase brush size'],
                      ['Shift (hold)', 'Temporary erase while brushing'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center justify-between py-1 px-2 rounded hover:bg-dark/40">
                        <span className="text-xs text-gray-400">{desc}</span>
                        <kbd className="px-1.5 py-0.5 bg-dark border border-gray-600 rounded text-[10px] font-mono text-green-300">{key}</kbd>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Navigation */}
                <div>
                  <h3 className="text-sm font-semibold text-purple-400 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-purple-500/20 flex items-center justify-center">🧭</span>
                    Navigation
                  </h3>
                  <div className="space-y-1.5">
                    {[
                      ['← / →', 'Prev / Next frame'],
                      ['Home / End', 'First / Last frame'],
                      ['C', 'Toggle Top / 3D view'],
                      ['Scroll', 'Zoom in / out'],
                      ['Right Drag', 'Pan view'],
                      ['Left Drag', 'Rotate (no tool active)'],
                      ['Middle Drag', 'Rotate (tool active)'],
                    ].map(([key, desc]) => (
                      <div key={key} className="flex items-center justify-between py-1 px-2 rounded hover:bg-dark/40">
                        <span className="text-xs text-gray-400">{desc}</span>
                        <kbd className="px-1.5 py-0.5 bg-dark border border-gray-600 rounded text-[10px] font-mono text-purple-300">{key}</kbd>
                      </div>
                    ))}
                  </div>
                </div>

              </div>

              {/* Mouse Controls Row */}
              <div className="mt-5 pt-4 border-t border-gray-700">
                <h3 className="text-sm font-semibold text-gray-400 mb-3">Mouse Controls</h3>
                <div className="grid grid-cols-4 gap-3">
                  <div className="text-center p-2 rounded bg-dark/30">
                    <div className="text-xs font-medium text-gray-300 mb-1">Left Drag</div>
                    <div className="text-[10px] text-gray-500">Rotate 3D / Paint</div>
                  </div>
                  <div className="text-center p-2 rounded bg-dark/30">
                    <div className="text-xs font-medium text-gray-300 mb-1">Right Drag</div>
                    <div className="text-[10px] text-gray-500">Pan view</div>
                  </div>
                  <div className="text-center p-2 rounded bg-dark/30">
                    <div className="text-xs font-medium text-gray-300 mb-1">Middle Drag</div>
                    <div className="text-[10px] text-gray-500">Rotate (tool active)</div>
                  </div>
                  <div className="text-center p-2 rounded bg-dark/30">
                    <div className="text-xs font-medium text-gray-300 mb-1">Scroll</div>
                    <div className="text-[10px] text-gray-500">Zoom in / out</div>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-6 py-3 bg-dark/50 border-t border-gray-700 shrink-0">
              <p className="text-xs text-gray-500 text-center">Press <kbd className="px-1.5 py-0.5 bg-dark border border-gray-600 rounded text-xs font-mono text-gray-400">H</kbd> or <kbd className="px-1.5 py-0.5 bg-dark border border-gray-600 rounded text-xs font-mono text-gray-400">Esc</kbd> to close</p>
            </div>
          </div>
        </div>
      )}

      {/* QA Complete Modal */}
      {showQACompleteModal && task && (effectiveStage === 'qa' || effectiveStage === 'customer_qa') && (
        <QACompleteModal
          stage={effectiveStage as 'qa' | 'customer_qa'}
          onAccept={handleApproveQA}
          onReject={handleRejectQA}
          onClose={() => setShowQACompleteModal(false)}
        />
      )}

      {/* Spatial Issue Modal */}
      <SpatialIssueModal
        isOpen={showSpatialIssueModal}
        location={spatialIssueLocation}
        onClose={() => {
          setShowSpatialIssueModal(false);
          setSpatialIssueLocation(null);
        }}
        onSubmit={handleSubmitSpatialIssue}
      />

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
                  className="w-full px-4 py-2.5 rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 font-medium transition-colors"
                >
                  Go to Task List
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Submit Error Toast */}
      {submitError && (
        <div className="fixed bottom-4 right-4 z-[100] bg-red-900/90 border border-red-600 text-red-200 px-4 py-3 rounded-lg shadow-lg flex items-center gap-3 max-w-md">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-sm">{submitError}</span>
          <button
            onClick={() => setSubmitError(null)}
            className="ml-2 text-red-300 hover:text-white"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
};

export default SemanticSegmentationEditor;

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Stage, Layer, Image, Rect, Group, Text, Circle, Line, Ellipse } from 'react-konva';
import Konva from 'konva';
import { useQuery } from '@tanstack/react-query';
import {
  useAnnotation2DStore,
  Tool2D,
  Annotation2D,
  AnnotationData2D,
  BoxData,
  RotatedBoxData,
  EllipseData,
  PolygonData as PolygonData2D,
  PolylineData as PolylineData2D,
  PointsData,
  SemanticSegmentData
} from '@/store/annotation2DStore';
import { annotation2DApi, track2DApi, Annotation2DCreate, Track2DData, aiSegmentApi, AISegmentPointPrompt, AISegmentResult, qaApi, workflowApi } from '@/api/client';
import { QAPanel2D, RevisionPanel2D } from '@/components/qa';
import { useEditorStore } from '@/store/editorStore';
import { useQAStore } from '@/store/qaStore';
import type { QASuggestion } from '@/types';
import {
  smoothLanePCHIP,
  simplifyLaneDouglasPeucker,
  snapLaneToVanishingLine,
  cleanupLane,
  ensureMinLanePoints,
  Point2D as LanePoint2D,
} from '@/utils/laneSmoothing';
import { clipAgainstExisting } from '@/utils/polygonClip';
import { getEffectiveAttributesForClass } from '@/utils/taxonomyUtils';


interface FrameInfo {
  id: string;
  frame_index: number;
}

interface Image2DAnnotationViewProps {
  cameras: string[];
  getImageUrl: (cameraId: string) => string | undefined;
  getOriginalImageUrl?: (cameraId: string) => string | undefined;
  getFrameImageUrl?: (frameId: string, cameraId: string) => string | undefined;
  getOriginalFrameImageUrl?: (frameId: string, cameraId: string) => string | undefined;
  frameId: string;
  frameIndex?: number;
  frames?: FrameInfo[];
  taskId?: string;
  taxonomy?: {
    classes: Array<{
      id: string;
      name: string;
      color: string;
      attributes?: Record<string, {
        type: 'boolean' | 'string' | 'enum' | 'number';
        default?: unknown;
        options?: string[];
        required?: boolean;
        description?: string | null;
      }>;
    }>;
    shared_attributes?: Array<{
      name: string;
      type: 'boolean' | 'string' | 'enum' | 'number';
      default?: unknown;
      options?: string[];
      required?: boolean;
      description?: string;
      mutable?: boolean;
      applies_to: string[];
    }>;
  };
}

interface ToolButton {
  tool: Tool2D;
  name: string;
  icon: React.ReactNode;
  shortcut: string;
}


const SelectIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
  </svg>
);

const PanIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
  </svg>
);

const BoxIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 18h16M4 6v12M20 6v12" />
  </svg>
);


const EllipseIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <ellipse cx="12" cy="12" rx="9" ry="6" strokeWidth={2} />
  </svg>
);

const PolygonIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l8 6-3 10H7L4 8l8-6z" />
  </svg>
);

const PolylineIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17l6-6 4 4 8-8" />
  </svg>
);

const PointsIcon = () => (
  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <circle cx="6" cy="6" r="2" fill="currentColor" />
    <circle cx="18" cy="6" r="2" fill="currentColor" />
    <circle cx="12" cy="12" r="2" fill="currentColor" />
    <circle cx="6" cy="18" r="2" fill="currentColor" />
    <circle cx="18" cy="18" r="2" fill="currentColor" />
  </svg>
);

const AISegmentIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
    {/* Magic sparkle effect for AI segmentation */}
    <path d="M12 2L13.5 7.5L19 9L13.5 10.5L12 16L10.5 10.5L5 9L10.5 7.5L12 2Z" fill="url(#grad1)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
    <circle cx="7" cy="17" r="1.5" fill="currentColor" opacity="0.6"/>
    <circle cx="17" cy="17" r="1" fill="currentColor" opacity="0.5"/>
    <circle cx="19" cy="6" r="1" fill="currentColor" opacity="0.5"/>
    <path d="M8 20L9 22L10 20L9 18L8 20Z" fill="currentColor" opacity="0.4"/>
    <defs>
      <linearGradient id="grad1" x1="12" y1="2" x2="12" y2="16" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#3b82f6"/>
        <stop offset="100%" stopColor="#8b5cf6"/>
      </linearGradient>
    </defs>
  </svg>
);

const AIPolygonIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
    {/* Smart polygon with AI circuit pattern */}
    <path d="M12 3L19 7L17 15H7L5 7L12 3Z" stroke="url(#grad2)" strokeWidth="2" strokeLinejoin="round" fill="none"/>
    {/* AI nodes at vertices */}
    <circle cx="12" cy="3" r="2" fill="#9333ea" stroke="white" strokeWidth="1"/>
    <circle cx="19" cy="7" r="1.5" fill="#9333ea" stroke="white" strokeWidth="0.5"/>
    <circle cx="17" cy="15" r="1.5" fill="#9333ea" stroke="white" strokeWidth="0.5"/>
    <circle cx="7" cy="15" r="1.5" fill="#9333ea" stroke="white" strokeWidth="0.5"/>
    <circle cx="5" cy="7" r="1.5" fill="#9333ea" stroke="white" strokeWidth="0.5"/>
    {/* Circuit lines */}
    <path d="M12 5L12 7M10 6L14 6" stroke="#a78bfa" strokeWidth="1" opacity="0.6"/>
    <defs>
      <linearGradient id="grad2" x1="12" y1="3" x2="12" y2="15" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#9333ea"/>
        <stop offset="100%" stopColor="#c084fc"/>
      </linearGradient>
    </defs>
  </svg>
);

const AITrackIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none">
    {/* Tracking crosshair with motion trail */}
    <rect x="4" y="6" width="16" height="12" rx="1" stroke="url(#grad3)" strokeWidth="2" fill="none"/>
    {/* Tracking crosshair */}
    <circle cx="12" cy="12" r="3" stroke="#10b981" strokeWidth="1.5" fill="none"/>
    <path d="M12 8V10M12 14V16M8 12H10M14 12H16" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/>
    {/* Motion arrows indicating tracking */}
    <path d="M20 9L22 12L20 15" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8"/>
    <path d="M2 12H4" stroke="#34d399" strokeWidth="1" strokeLinecap="round" opacity="0.5"/>
    {/* AI sparkle */}
    <circle cx="18" cy="5" r="1" fill="#fbbf24"/>
    <defs>
      <linearGradient id="grad3" x1="4" y1="6" x2="20" y2="18" gradientUnits="userSpaceOnUse">
        <stop offset="0%" stopColor="#10b981"/>
        <stop offset="100%" stopColor="#059669"/>
      </linearGradient>
    </defs>
  </svg>
);


const TOOLS: ToolButton[] = [
  { tool: 'select', name: 'Select', icon: <SelectIcon />, shortcut: 'V' },
  { tool: 'pan', name: 'Pan', icon: <PanIcon />, shortcut: 'H' },
  { tool: 'ai_track', name: 'AI Track', icon: <AITrackIcon />, shortcut: 'T' },
  { tool: 'semantic_segment', name: 'Semantic Segmentation (AI)', icon: <AISegmentIcon />, shortcut: 'W' },
  { tool: 'ai_polygon', name: 'AI Polygon', icon: <AIPolygonIcon />, shortcut: 'M' },
  { tool: 'box', name: 'Rectangle', icon: <BoxIcon />, shortcut: 'R' },
  { tool: 'ellipse', name: 'Ellipse', icon: <EllipseIcon />, shortcut: 'E' },
  { tool: 'polygon', name: 'Polygon (Manual)', icon: <PolygonIcon />, shortcut: 'P' },
  { tool: 'polyline', name: 'Polyline', icon: <PolylineIcon />, shortcut: 'L' },
  { tool: 'points', name: 'Points', icon: <PointsIcon />, shortcut: 'K' },
];


function getCatmullRomSpline(
  points: Array<{ x: number; y: number }>,
  tension: number = 0.5,
  isClosed: boolean = false,
  numSegments: number = 20
): number[] {
  if (points.length < 2) return points.flatMap(p => [p.x, p.y]);
  if (points.length === 2) return points.flatMap(p => [p.x, p.y]);

  const result: number[] = [];
  const pts = isClosed
    ? [...points, points[0], points[1], points[2] || points[0]]
    : [points[0], ...points, points[points.length - 1]];

  const n = isClosed ? points.length : points.length - 1;

  for (let i = 0; i < n; i++) {
    const p0 = pts[i];
    const p1 = pts[i + 1];
    const p2 = pts[i + 2];
    const p3 = pts[i + 3] || p2;

    for (let t = 0; t < numSegments; t++) {
      const s = t / numSegments;
      const s2 = s * s;
      const s3 = s2 * s;

      const t1 = tension;
      const x = 0.5 * (
        (2 * p1.x) +
        (-p0.x + p2.x) * t1 * s +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t1 * s2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t1 * s3
      );
      const y = 0.5 * (
        (2 * p1.y) +
        (-p0.y + p2.y) * t1 * s +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t1 * s2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t1 * s3
      );

      result.push(x, y);
    }
  }

  if (!isClosed) {
    result.push(points[points.length - 1].x, points[points.length - 1].y);
  }

  return result;
}

function douglasPeucker(
  points: Array<{ x: number; y: number }>,
  epsilon: number = 2.0
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points;

  let maxDist = 0;
  let maxIndex = 0;
  const first = points[0];
  const last = points[points.length - 1];

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }

  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, maxIndex + 1), epsilon);
    const right = douglasPeucker(points.slice(maxIndex), epsilon);
    return [...left.slice(0, -1), ...right];
  } else {
    return [first, last];
  }
}

function perpendicularDistance(
  point: { x: number; y: number },
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number }
): number {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;

  if (dx === 0 && dy === 0) {
    return Math.sqrt(
      Math.pow(point.x - lineStart.x, 2) +
      Math.pow(point.y - lineStart.y, 2)
    );
  }

  const numerator = Math.abs(
    dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x
  );
  const denominator = Math.sqrt(dx * dx + dy * dy);

  return numerator / denominator;
}


export const Image2DAnnotationView: React.FC<Image2DAnnotationViewProps> = ({
  cameras,
  getImageUrl,
  getOriginalImageUrl,
  getFrameImageUrl,
  getOriginalFrameImageUrl,
  frameId,
  frameIndex: _frameIndex = 0,
  frames = [],
  taxonomy,
  taskId,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  const getFrameUrlForBackend = useCallback((fId: string, camId: string): string | undefined => {
    if (getOriginalFrameImageUrl) {
      return getOriginalFrameImageUrl(fId, camId);
    }
    return getFrameImageUrl?.(fId, camId);
  }, [getOriginalFrameImageUrl, getFrameImageUrl]);

  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [selectedCameraId, setSelectedCameraId] = useState(cameras[0] || '');
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [interpolateStatus, setInterpolateStatus] = useState<'idle' | 'interpolating' | 'done' | 'error'>('idle');

  const [propagateStatus, setPropagateStatus] = useState<'idle' | 'propagating' | 'done' | 'error'>('idle');
  const [propagateError, setPropagateError] = useState<string | null>(null);
  const [showPropagateDialog, setShowPropagateDialog] = useState(false);
  const [propagateTrackId, setPropagateTrackId] = useState<string | null>(null);
  const [propagateFrameCount, setPropagateFrameCount] = useState(10);

  const [selectedTrackIds, setSelectedTrackIds] = useState<Set<string>>(new Set());
  const [propagatingTracks, setPropagatingTracks] = useState<Set<string>>(new Set());

  const [aiTrackDirection, setAiTrackDirection] = useState<'forward' | 'forward_backward'>('forward');
  const [aiTrackPending, setAiTrackPending] = useState<{ annotationId: string; trackId: string; boxData: BoxData } | null>(null);
  const [pendingAiTrackIds, setPendingAiTrackIds] = useState<Set<string>>(new Set());

  const [tracks, setTracks] = useState<Track2DData[]>([]);
  const [showTrackHelp, setShowTrackHelp] = useState(false);
  const [activeTrackId, setActiveTrackId] = useState<string | null>(null);
  const [pendingNewTrack, setPendingNewTrack] = useState(false);

  const [showTimerToast, setShowTimerToast] = useState(false);
  const timerToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [laneActionToast, setLaneActionToast] = useState<{ kind: 'info' | 'success'; msg: string } | null>(null);
  const laneToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLaneToast = useCallback((kind: 'info' | 'success', msg: string) => {
    setLaneActionToast({ kind, msg });
    if (laneToastTimeoutRef.current) clearTimeout(laneToastTimeoutRef.current);
    laneToastTimeoutRef.current = setTimeout(() => setLaneActionToast(null), 4000);
  }, []);


  const [timerRunning, setTimerRunning] = useState<boolean>(() => {
    if (!taskId) return true;
    try {
      const raw = localStorage.getItem(`task_timer_${taskId}`);
      return raw ? (JSON.parse(raw).running === true) : false;
    } catch { return false; }
  });
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ running: boolean; taskId: string }>).detail;
      if (detail?.taskId === taskId) {
        setTimerRunning(detail.running);
        // Auto-dismiss toast when timer is started
        if (detail.running) {
          setShowTimerToast(false);
          if (timerToastTimeoutRef.current) clearTimeout(timerToastTimeoutRef.current);
        }
      }
    };
    window.addEventListener('timerStateChange', handler);
    return () => window.removeEventListener('timerStateChange', handler);
  }, [taskId]);

  // Cursor position for displaying coordinates
  const [cursorPosition, setCursorPosition] = useState<{ x: number; y: number } | null>(null);

  // Task stage from editor store
  const task = useEditorStore((s) => s.task);
  const scene = useEditorStore((s) => s.scene);
  const goToFrameStore = useEditorStore((s) => s.goToFrame);
  const annotationColorMode = useEditorStore((s) => s.annotationColorMode);
  const activeAttributeForColor = useEditorStore((s) => s.activeAttributeForColor);

  // Fetch per-taxonomy workflow info to get the correct stage
  const { data: taxonomyWorkflowInfo } = useQuery({
    queryKey: ['workflow-info-2d', taskId, scene?.selected_taxonomy_id],
    queryFn: () => workflowApi.getInfo(taskId!, scene?.selected_taxonomy_id || undefined),
    enabled: !!taskId && !!scene?.selected_taxonomy_id,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Use per-taxonomy stage if available, otherwise fall back to global task stage
  const effectiveStage = taxonomyWorkflowInfo?.stage ?? task?.stage ?? 'annotation';
  const effectiveRevisionCount = taxonomyWorkflowInfo?.revision_count ?? task?.revision_count ?? 0;

  const isAnnotationStage = effectiveStage === 'annotation';
  const isQaStage = effectiveStage === 'qa' || effectiveStage === 'customer_qa';

  // Get selected taxonomy ID from scene for saving with annotations
  const selectedTaxonomyId = scene?.selected_taxonomy_id;

  // Revision mode - when annotation stage has been through QA before
  const isRevisionMode = isAnnotationStage && effectiveRevisionCount > 0;

  // QA Store for color mode
  const qaStoreReviews = useQAStore((s) => s.annotationReviews);

  // QA Mode state - auto-enable for QA stages
  const [qaMode, setQaMode] = useState(false);
  const [qaSuggestions, setQaSuggestions] = useState<QASuggestion[]>([]);

  // Track loading state for current frame's annotations to prevent rendering stale annotations
  const [loadingFrameId, setLoadingFrameId] = useState<string | null>(null);

  // Right panel tab state - now includes "fixes" tab for revision mode
  type RightPanelTab = 'objects' | 'tracks' | 'fixes';
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('objects');

  // Resizable right panel - default 20% of a typical 1920px screen for QA
  const [rightPanelWidth, setRightPanelWidth] = useState(384);
  const isResizingPanelRef = useRef(false);
  const rightPanelRef = useRef<HTMLDivElement>(null);

  // Pending zoom - for zooming after frame navigation
  const [pendingZoom, setPendingZoom] = useState<{ annotationId: string; zoomLevel: number } | null>(null);

  // Track if user/QA has manually zoomed - prevents auto-fit from overriding
  // Use ref for synchronous checks to prevent race conditions
  const hasManualZoomRef = useRef(false);

  // Track-link dropdown state (for on-box track assignment)
  const [expandedPanelId, setExpandedPanelId] = useState<string | null>(null);

  // Merge tracks modal state
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeTargetTrackId, setMergeTargetTrackId] = useState<string>('');
  const [mergeMode, setMergeMode] = useState<'existing' | 'new'>('existing');

  // Auto-enable QA mode when in QA stage, auto-disable when in annotation stage
  useEffect(() => {
    if (isQaStage && !qaMode) {
      setQaMode(true);
      setActiveTool('select');
    } else if (isAnnotationStage && qaMode) {
      // In annotation stage (including revision mode), turn off QA mode
      // so user sees Objects/Tracks/Fixes tabs instead of QAPanel
      setQaMode(false);
    }
  }, [isQaStage, isAnnotationStage]);

  // Auto-switch to Fixes tab when entering revision mode
  useEffect(() => {
    if (isRevisionMode && rightPanelTab === 'objects') {
      setRightPanelTab('fixes');
    }
  }, [isRevisionMode]);

  // Camera fix indicators - counts of rejected/flagged per camera in revision mode
  const [cameraFixCounts, setCameraFixCounts] = useState<Record<string, { rejected: number; flagged: number }>>({});

  // Note: loadCameraFixCounts effect is placed after annotations store hook is declared

  // Panel resize handlers - use cached right edge position
  const [isResizingPanel, setIsResizingPanel] = useState(false);
  const panelRightEdgeRef = useRef<number>(0); // Cache the right edge when starting to drag

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizingPanelRef.current) return;

      // New width = distance from mouse to the cached right edge
      const newWidth = panelRightEdgeRef.current - e.clientX;

      // Clamp between min and max (wider range for QA panel)
      setRightPanelWidth(Math.max(280, Math.min(800, newWidth)));
    };

    const handleMouseUp = () => {
      if (isResizingPanelRef.current) {
        isResizingPanelRef.current = false;
        setIsResizingPanel(false);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);
  const [qaLoading, setQaLoading] = useState(false);
  const [fnMode, setFnMode] = useState(false); // False negative flagging mode
  const [fnModalOpen, setFnModalOpen] = useState(false);
  const [fnLocation, setFnLocation] = useState<{ x: number; y: number } | null>(null);
  const [fnMarkers, setFnMarkers] = useState<Array<{ id: string; x: number; y: number; frameId: string; classId: string; description: string }>>([]);

  // Default classes when taxonomy is not provided
  const defaultClasses = useMemo(() => [
    { id: 'car', name: 'Car', color: '#ef4444' },
    { id: 'truck', name: 'Truck', color: '#f97316' },
    { id: 'bus', name: 'Bus', color: '#eab308' },
    { id: 'pedestrian', name: 'Pedestrian', color: '#22c55e' },
    { id: 'cyclist', name: 'Cyclist', color: '#3b82f6' },
    { id: 'motorcycle', name: 'Motorcycle', color: '#8b5cf6' },
    { id: 'traffic_sign', name: 'Traffic Sign', color: '#ec4899' },
    { id: 'traffic_light', name: 'Traffic Light', color: '#14b8a6' },
    { id: 'other', name: 'Other', color: '#6b7280' },
  ], []);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawCurrent, setDrawCurrent] = useState<{ x: number; y: number } | null>(null);
  const [drawingPoints, setDrawingPoints] = useState<{ x: number; y: number }[]>([]);

  // Enhanced polygon UX state
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);
  const [isNearFirstPoint, setIsNearFirstPoint] = useState(false);
  const [hoveredPointIndex, setHoveredPointIndex] = useState<number | null>(null);
  const SNAP_THRESHOLD = 25; // Pixels - magnetic snap distance to first point (larger = easier to close)
  const POINT_HOVER_THRESHOLD = 12; // Pixels - for highlighting points

  // Refs for improved click handling
  const lastClickPosRef = useRef<{ x: number; y: number; time: number } | null>(null);
  const isFinishingRef = useRef(false); // Prevent adding points during finish animation

  // Smooth polygon settings
  const [smoothPolygon, setSmoothPolygon] = useState(true); // Default to smooth mode
  const [splineTension, setSplineTension] = useState(0.5); // 0 = straight, 1 = very curved

  // Panning state - for spacebar + drag and middle mouse button
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);

  // Help modal state
  const [showHelp, setShowHelp] = useState(false);

  // AI Segment state
  const [aiSegmentPoints, setAiSegmentPoints] = useState<AISegmentPointPrompt[]>([]);
  const [aiSegmentPreview, setAiSegmentPreview] = useState<AISegmentResult | null>(null);
  // Raw (unclipped) SAM2 result kept so we can re-clip when existing
  // annotations change without re-running inference.
  const [aiSegmentRawMask, setAiSegmentRawMask] = useState<AISegmentResult | null>(null);
  const [aiSegmentLoading, setAiSegmentLoading] = useState(false);
  const [aiSegmentEmbeddingKey, setAiSegmentEmbeddingKey] = useState<string | null>(null);
  const [aiSegmentLastInferenceMs, setAiSegmentLastInferenceMs] = useState<number>(0);
  const [aiSegmentSimplifyTolerance, setAiSegmentSimplifyTolerance] = useState<number>(() => {
    // Load from localStorage or default to 0.001 (pixel-perfect)
    const stored = localStorage.getItem('ai_segment_simplify_tolerance');
    return stored ? parseFloat(stored) : 0.001;
  });

  // Track if lanes have unsaved edits (manual edits to tracked polylines)
  const [, setHasUnsavedLaneEdits] = useState(false);

  // Store hooks
  const {
    annotations,
    selectedIds,
    hoveredId,
    activeTool,
    activeClassId,
    setActiveTool,
    setActiveClass,
    select,
    deselectAll,
    setHovered,
    createAnnotation,
    addAnnotation,
    updateAnnotation,
    undo,
    redo,
    toggleVisibility,
    toggleLock,
    setCurrentFrame,
    setCurrentCamera,
    history,
    historyIndex,
    clearAnnotations,
    reloadTrigger,
  } = useAnnotation2DStore();

  // When the timer is paused, drop back to the select tool so any open
  // tool panel (AI Track, polygon/polyline settings, etc.) closes — picking
  // a drawing tool is soft-locked while paused, so leaving one mounted is stale.
  useEffect(() => {
    if (!timerRunning && activeTool !== 'select' && activeTool !== 'pan') {
      setActiveTool('select');
    }
  }, [timerRunning, activeTool, setActiveTool]);

  // Propagate a lane edit across the whole track as an OFFSET against each frame's
  // stable AI baseline (`attributes.ai_points`):
  //   final(frame) = ai_points(frame) + offset(frame)
  // where offset is interpolated between the frames the user has corrected (an
  // anchor's offset = its corrected points − its own ai_points). One corrected
  // frame ⇒ its offset is applied to every frame (single edit reaches the whole
  // track); 2+ corrections ⇒ the offset is blended between them (precise on
  // curves). Because everything is relative to the baseline, re-editing never
  // accumulates drift (idempotent). Corrected frames are never overwritten.
  // Applied in ONE batch so the whole correction is a single undo step.
  const autoPropagateLaneEdit = useCallback((trackId: string) => {
    if (!taskId) return;
    const store = useAnnotation2DStore.getState();
    const members = (Array.from(store.annotations.values())
      .filter(a => a.trackId === trackId && a.type === 'polyline')
      .map(a => ({ a, idx: frames.find(f => f.id === a.frameId)?.frame_index }))
      .filter(m => m.idx !== undefined) as Array<{ a: Annotation2D; idx: number }>)
      .sort((x, y) => x.idx - y.idx);
    const isEdited = (a: Annotation2D) => (a.attributes as Record<string, unknown> | undefined)?.userEdited === true;
    const editedKfs = members.filter(m => isEdited(m.a));
    if (editedKfs.length === 0) return;

    const sampleXAtY = (pts: Array<{ x: number; y: number }>, y: number): number => {
      const s = [...pts].sort((p, q) => p.y - q.y);
      if (y <= s[0].y) return s[0].x;
      if (y >= s[s.length - 1].y) return s[s.length - 1].x;
      for (let i = 0; i < s.length - 1; i++) {
        const a = s[i], b = s[i + 1];
        if (y >= a.y && y <= b.y) return a.x + (y - a.y) / ((b.y - a.y) || 1e-9) * (b.x - a.x);
      }
      return s[s.length - 1].x;
    };
    const baselineOf = (a: Annotation2D): Array<{ x: number; y: number }> => {
      const ai = (a.attributes as Record<string, unknown> | undefined)?.ai_points as Array<{ x: number; y: number }> | undefined;
      return ai && ai.length >= 2 ? ai : ((a.data as PolylineData2D | undefined)?.points || []);
    };

    // Each corrected frame's offset = corrected geometry − its own baseline, sampled by y.
    const anchors = editedKfs.map(m => {
      const pts = (m.a.data as PolylineData2D).points;
      const base = baselineOf(m.a);
      return { idx: m.idx, offsetAtY: (y: number) => sampleXAtY(pts, y) - sampleXAtY(base, y) };
    }).sort((a, b) => a.idx - b.idx);

    const offsetForFrame = (idx: number, y: number): number => {
      let lo: typeof anchors[number] | null = null;
      let hi: typeof anchors[number] | null = null;
      for (const ao of anchors) if (ao.idx <= idx) lo = ao;
      for (const ao of anchors) if (ao.idx >= idx) { hi = ao; break; }
      if (lo && hi && lo.idx < hi.idx) {
        const t = (idx - lo.idx) / (hi.idx - lo.idx);
        return lo.offsetAtY(y) * (1 - t) + hi.offsetAtY(y) * t;
      }
      return (lo || hi)!.offsetAtY(y); // one-sided or single anchor
    };

    const updates: Array<{ id: string; changes: Partial<Annotation2D> }> = [];
    const bulk: Array<{ id: string; data: Record<string, unknown>; attributes: Record<string, unknown> }> = [];
    for (const m of members) {
      if (isEdited(m.a)) continue; // never overwrite a corrected frame
      const base = baselineOf(m.a);
      if (base.length < 2) continue;
      let pts = base.map(p => ({ x: p.x + offsetForFrame(m.idx, p.y), y: p.y }));
      const simplified = simplifyLaneDouglasPeucker(pts as LanePoint2D[], 2.0);
      if (simplified.length >= 2) pts = simplified;
      const hadBaseline = !!(m.a.attributes as Record<string, unknown> | undefined)?.ai_points;
      const newAttrs: Record<string, unknown> = {
        ...(m.a.attributes || {}),
        ...(hadBaseline ? {} : { ai_points: base.map(p => ({ x: p.x, y: p.y })) }),
        interpolated: true,
      };
      const newData = { ...(m.a.data as PolylineData2D), points: pts };
      updates.push({ id: m.a.id, changes: { data: newData as unknown as AnnotationData2D, attributes: newAttrs } });
      bulk.push({ id: m.a.id, data: newData as unknown as Record<string, unknown>, attributes: newAttrs });
    }

    if (updates.length) {
      // One store change + one history entry, merged with the originating edit so
      // edit + propagation undo together as a single step.
      store.batchUpdateAnnotations(updates, 'Propagate lane edit', true);
      annotation2DApi.updateBulk(bulk)
        .catch(err => console.error('[LaneAutoProp] Failed to persist propagated frames:', err));
      console.log(`[LaneAutoProp] Applied edit to ${updates.length} frame(s) on track ${trackId} (${editedKfs.length} corrected keyframe(s))`);
      showLaneToast('success', `Applied your edit to ${updates.length} other frame(s) on this lane.`);
    }
  }, [frames, taskId, showLaneToast]);

  // Debounce so a flurry of point drags triggers a single propagation pass.
  const autoInterpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Wrapper around updateAnnotation to track modifications and update source status
  // IMPORTANT: This also persists data changes to the backend to prevent data loss
  const updateAnnotationWithSourceTracking = useCallback((id: string, updates: any) => {
    const currentAnnotation = annotations.get(id);

    if (currentAnnotation) {
      // Check if updates contain data or position changes (not just metadata like classId)
      const hasDataChange = 'data' in updates && JSON.stringify(updates.data) !== JSON.stringify(currentAnnotation.data);
      const hasPositionChange = Object.keys(updates).some(key =>
        key.startsWith('x') || key.startsWith('y') || key === 'width' || key === 'height' || key === 'rotation' || key === 'scale'
      );

      // If data or position changed, update source from 'auto' to 'auto_manual' (if it was 'auto')
      if ((hasDataChange || hasPositionChange) && currentAnnotation.source === 'auto') {
        updates.source = 'auto_manual';
      }

      // If this is a lane/polyline being edited, mark as having unsaved edits
      if ((hasDataChange || hasPositionChange) && currentAnnotation.type === 'polyline') {
        setHasUnsavedLaneEdits(true);
      }

      // If there's a data change, also persist to the backend
      // This ensures manual edits are saved and not lost on task reopen
      if (hasDataChange) {
        const isTrackedLaneEdit = currentAnnotation.type === 'polyline' && !!currentAnnotation.trackId;

        // Tag the edited frame as a correction anchor, and capture the AI/original
        // geometry as a stable baseline (`ai_points`) the FIRST time it's edited.
        // Propagation computes corrections relative to this baseline, so re-edits
        // never accumulate drift (idempotent).
        if (isTrackedLaneEdit) {
          const existingAttrs = (currentAnnotation.attributes || {}) as Record<string, unknown>;
          const baseline = existingAttrs.ai_points
            ?? (currentAnnotation.data as PolylineData2D | undefined)?.points?.map(p => ({ x: p.x, y: p.y }));
          updates.attributes = {
            ...existingAttrs,
            ...(updates.attributes || {}),
            userEdited: true,
            ...(baseline ? { ai_points: baseline } : {}),
          };
        }

        annotation2DApi.update(id, {
          data: updates.data as unknown as Record<string, unknown>,
          ...(updates.source ? { source: updates.source } : {}),
          ...(isTrackedLaneEdit ? { attributes: updates.attributes as Record<string, unknown> } : {}),
        }).catch(error => {
          console.error('Failed to persist annotation change to database:', error);
        });

        // After the edit is saved, propagate the change across the whole track
        // (offset against each frame's ai_points baseline; interpolated between
        // your corrected frames). Debounced so a burst of point drags triggers one
        // pass; runs after the store commit below so it reads the new geometry +
        // the ai_points baseline captured above.
        if (isTrackedLaneEdit) {
          const laneTrackId = currentAnnotation.trackId!;
          if (autoInterpTimerRef.current) clearTimeout(autoInterpTimerRef.current);
          autoInterpTimerRef.current = setTimeout(() => autoPropagateLaneEdit(laneTrackId), 300);
        }
      }
    }

    updateAnnotation(id, updates);
  }, [annotations, updateAnnotation, autoPropagateLaneEdit]);

  // Persist attribute changes to both local store and backend
  const handleAnnotationAttributeChange = useCallback((annId: string, mergedAttributes: Record<string, unknown>) => {
    updateAnnotationWithSourceTracking(annId, { attributes: mergedAttributes });
    if (taskId) {
      annotation2DApi.update(annId, { attributes: mergedAttributes }).catch((err) => {
        console.error('[AttrUpdate] Failed to save attribute:', err);
      });
    }
  }, [updateAnnotationWithSourceTracking, taskId]);

  // Extract classes from taxonomy + merge with any extra classes from annotations
  const availableClasses = useMemo(() => {
    const taxonomyClasses = taxonomy?.classes || [];
    const taxonomyIds = new Set(taxonomyClasses.map(c => c.id));

    // Extract unique class IDs from annotations that aren't in taxonomy
    // (filter out empty/undefined classIds and 'unknown')
    const extraClassIds = new Set<string>();
    annotations.forEach(ann => {
      if (ann.classId && ann.classId.trim() !== '' && ann.classId !== 'unknown' && !taxonomyIds.has(ann.classId)) {
        extraClassIds.add(ann.classId);
      }
    });

    // If taxonomy has classes, use them as base and add any extras
    if (taxonomyClasses.length > 0) {
      const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#06b6d4'];
      const extraClasses = Array.from(extraClassIds).map((classId, idx) => ({
        id: classId,
        name: classId.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
        color: colors[idx % colors.length]
      }));
      return [...taxonomyClasses, ...extraClasses];
    }

    // No taxonomy - use defaults or annotation classes
    const allClassIds = new Set<string>();
    annotations.forEach(ann => {
      if (ann.classId && ann.classId.trim() !== '' && ann.classId !== 'unknown') {
        allClassIds.add(ann.classId);
      }
    });

    if (allClassIds.size === 0) {
      return defaultClasses;
    }

    const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b', '#06b6d4'];
    return Array.from(allClassIds).map((classId, idx) => ({
      id: classId,
      name: classId.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
      color: colors[idx % colors.length]
    }));
  }, [taxonomy?.classes, annotations, defaultClasses]);

  // Get current frame/camera annotations (visible ones for rendering on canvas)
  // Selected annotation renders LAST so its controls sit on top,
  // while other lanes' strokes remain clickable for selection-switching.
  const currentAnnotations = useMemo(() => {
    const result: Annotation2D[] = [];

    // If still loading annotations for this frame, don't render stale annotations
    // This prevents the UI from showing old annotations while waiting for new frame data
    if (loadingFrameId === frameId) {
      return [];
    }

    // Helper: match camera_id - 'default' matches any camera (for semantic segmentation imports)
    const matchesCamera = (annCameraId: string) =>
      annCameraId === selectedCameraId || annCameraId === 'default';

    annotations.forEach((ann) => {
      if (ann.frameId === frameId && matchesCamera(ann.cameraId) && !ann.isHidden) {
        result.push(ann);
      }
    });
    result.sort((a, b) => a.zIndex - b.zIndex);
    // Push selected annotation(s) to end so they render on top
    if (selectedIds.length > 0) {
      const selSet = new Set(selectedIds);
      const notSel = result.filter(a => !selSet.has(a.id));
      const sel = result.filter(a => selSet.has(a.id));
      return [...notSel, ...sel];
    }
    return result;
  }, [annotations, frameId, selectedCameraId, selectedIds, cameras, loadingFrameId]);

  // Get ALL annotations for panel (including hidden ones)
  // 'default' camera_id matches any camera (for semantic segmentation imports)
  const panelAnnotations = useMemo(() => {
    const result: Annotation2D[] = [];
    const matchesCamera = (annCameraId: string) =>
      annCameraId === selectedCameraId || annCameraId === 'default';
    annotations.forEach((ann) => {
      if (ann.frameId === frameId && matchesCamera(ann.cameraId)) {
        result.push(ann);
      }
    });
    return result.sort((a, b) => a.zIndex - b.zIndex);
  }, [annotations, frameId, selectedCameraId]);

  // Objects tab shows EVERY annotation on the frame — both untracked objects and
  // tracked ones (tracked also appear in the Tracks tab). Tracked rows render the
  // class name plus a track-id badge so lanes are visible/manageable here too.
  const objectsPanelAnnotations = useMemo(
    () => panelAnnotations,
    [panelAnnotations]
  );

  // Count annotations per class on the current frame/camera for quick class awareness.
  const classAnnotationCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    panelAnnotations.forEach((ann) => {
      if (!ann.classId || ann.classId.trim() === '' || ann.classId === 'unknown') return;
      counts[ann.classId] = (counts[ann.classId] || 0) + 1;
    });
    return counts;
  }, [panelAnnotations]);

  // Load camera fix counts when in revision mode (needs annotations to be loaded first)
  useEffect(() => {
    if (!isRevisionMode || !taskId) {
      setCameraFixCounts({});
      return;
    }

    const loadCameraFixCounts = async () => {
      try {
        // Get all completed QA reviews for this task
        const taskReviews = await qaApi.getTaskReviews(taskId, 'completed');
        if (taskReviews.length === 0) return;

        // Get annotation reviews from the most recent completed review
        const annotationReviews = await qaApi.getAnnotationReviews(taskReviews[0].id);

        // Only consider 2D annotation reviews
        const reviews2D = annotationReviews.filter(r => r.annotation_table === 'annotations_2d');

        // Build counts per camera by matching annotation IDs
        const counts: Record<string, { rejected: number; flagged: number }> = {};

        // Initialize counts for all cameras
        cameras.forEach(cam => {
          counts[cam] = { rejected: 0, flagged: 0 };
        });

        // For each review, find the annotation and its camera
        reviews2D.forEach(review => {
          const annotation = annotations.get(review.annotation_id);
          if (annotation && annotation.cameraId) {
            if (!counts[annotation.cameraId]) {
              counts[annotation.cameraId] = { rejected: 0, flagged: 0 };
            }
            if (review.verdict === 'rejected') {
              counts[annotation.cameraId].rejected++;
            } else if (review.verdict === 'flagged') {
              counts[annotation.cameraId].flagged++;
            }
          }
        });

        setCameraFixCounts(counts);
      } catch (error) {
        console.error('[CameraFixCounts] Failed to load:', error);
      }
    };

    loadCameraFixCounts();
  }, [isRevisionMode, taskId, cameras, annotations]);

  // Image size
  const imageSize = useMemo(() => {
    if (image && image.width > 0 && image.height > 0) {
      return { width: image.width, height: image.height };
    }
    return { width: 1920, height: 1080 };
  }, [image]);

  // Get class color
  const getClassColor = useCallback((classId: string) => {
    const cls = availableClasses.find((c) => c.id === classId);
    return cls?.color ?? '#3b82f6';
  }, [availableClasses]);

  // String to color hash for attribute coloring
  const stringToColor = useCallback((str: string): string => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00FFFFFF).toString(16);
    return '#' + '00000'.substring(0, 6 - c.length) + c;
  }, []);

  // Get annotation color based on color mode (class, attribute, qa_status)
  const getAnnotationColor = useCallback((ann: Annotation2D): string => {
    // 1. Attribute Mode
    if (annotationColorMode === 'attribute' && activeAttributeForColor) {
      const val = ann.attributes?.[activeAttributeForColor];
      if (val !== undefined && val !== null) {
        return stringToColor(String(val));
      }
    }

    // 2. QA Status Mode
    if (annotationColorMode === 'qa_status') {
      const review = qaStoreReviews.get(ann.id);
      if (review?.verdict === 'approved') return '#00ff00';
      if (review?.verdict === 'rejected') return '#ff0000';
      if (review?.verdict === 'flagged') return '#ffff00';
      return '#888888'; // No review yet - gray
    }

    // 3. Class Mode (Default)
    return getClassColor(ann.classId);
  }, [annotationColorMode, activeAttributeForColor, qaStoreReviews, getClassColor, stringToColor]);

  // Format annotation type for display
  const formatAnnotationType = useCallback((type: string) => {
    const typeLabels: Record<string, string> = {
      'box': 'Box',
      'rotated_box': 'Rotated Box',
      'ellipse': 'Ellipse',
      'polygon': 'Polygon',
      'polyline': 'Polyline',
      'points': 'Points',
      'mask': 'Mask',
      'semantic_segment': 'Semantic Segment',
    };
    return typeLabels[type] || type;
  }, []);

  // Initialize active class if not set or invalid
  useEffect(() => {
    if (availableClasses.length > 0) {
      const validClass = availableClasses.find(c => c.id === activeClassId);
      if (!validClass) {
        setActiveClass(availableClasses[0].id);
      }
    }
  }, [availableClasses, activeClassId, setActiveClass]);

  // Update frame/camera context when they change
  useEffect(() => {
    setCurrentFrame(frameId);
  }, [frameId, setCurrentFrame]);

  useEffect(() => {
    setCurrentCamera(selectedCameraId);
  }, [selectedCameraId, setCurrentCamera]);

  // Track previous taxonomy to detect changes
  const prevTaxonomyRef = useRef<string | undefined>(selectedTaxonomyId);
  const prevTaskRef = useRef<string | undefined>(taskId);
  const prevReloadTriggerRef = useRef<number>(reloadTrigger);
  const hasInitializedRef = useRef(false);

  // Load existing annotations from database - clears first when task/taxonomy changes
  useEffect(() => {
    if (!taskId) return;

    // Skip if frameId looks like a placeholder (not a valid UUID)
    // Valid UUIDs have format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
    const isValidFrameId = frameId && frameId.includes('-') && !frameId.startsWith('frame-');
    if (!isValidFrameId && !qaMode && !isRevisionMode) {
      console.log('[Image2DAnnotationView] Skipping annotation load - invalid frameId:', frameId);
      return;
    }

    // Determine whether this run actually needs to (re)load from the server.
    // The initial load pulls EVERY annotation for the task into the store, so
    // plain frame-to-frame navigation already has all frames' data in memory.
    // Re-fetching the current frame on each step only blanks the canvas (via
    // loadingFrameId) and adds a redundant round-trip — that was the source of
    // the lag when stepping through propagated/tracked lanes.
    const taskChanged = prevTaskRef.current !== taskId;
    const taxonomyChanged = prevTaxonomyRef.current !== selectedTaxonomyId;
    const reloadTriggered = prevReloadTriggerRef.current !== reloadTrigger;
    const isFreshMount = !hasInitializedRef.current;
    const needsReload =
      qaMode || isRevisionMode || isFreshMount || taskChanged || taxonomyChanged || reloadTriggered;

    // Plain frame navigation: render straight from the store, no fetch, no blank.
    if (!needsReload) return;

    // Mark that we're loading annotations for this frame
    const currentLoadingFrameId = frameId;
    setLoadingFrameId(frameId);

    const loadAnnotations = async () => {
      try {
        // Clear existing annotations on (a) fresh mount (flush stale Zustand store
        // data), (b) task/taxonomy change, or (c) an import-triggered reload.
        if (isFreshMount || taskChanged || taxonomyChanged || reloadTriggered) {
          clearAnnotations();
          prevTaskRef.current = taskId;
          prevTaxonomyRef.current = selectedTaxonomyId;
          prevReloadTriggerRef.current = reloadTrigger;
          hasInitializedRef.current = true;
        }

        // We only reach here on mount / task / taxonomy / reload / QA, so always
        // load ALL annotations across every frame (no frame filter). This restores
        // cross-frame tracking data — keyframes, interpolated, and AI-propagated
        // annotations — into the store so subsequent navigation is instant.
        const dbAnnotations = await annotation2DApi.list(taskId, undefined, undefined, undefined, selectedTaxonomyId || undefined);

        console.log('[Image2DAnnotationView] Loaded annotations:', dbAnnotations.length, 'for taxonomy:', selectedTaxonomyId);

        // Convert API format to store format and add/update in store.
        // Always use the DB version as the source of truth — this ensures
        // revisions made during the annotation stage are reflected when the
        // task re-enters QA (the old in-memory copy would otherwise be stale).
        dbAnnotations.forEach((dbAnn) => {
          const existing = annotations.get(dbAnn.id);
          const dbUpdatedAt = new Date(dbAnn.updated_at);

          if (!existing) {
            // New annotation — add it
            const storeAnn: Annotation2D = {
              id: dbAnn.id,
              type: dbAnn.type as Annotation2D['type'],
              classId: dbAnn.class_id,
              trackId: dbAnn.track_id,
              frameId: dbAnn.frame_id,
              cameraId: dbAnn.camera_id,
              data: dbAnn.data as unknown as AnnotationData2D,
              attributes: dbAnn.attributes,
              isLocked: false,
              isHidden: false,
              zIndex: annotations.size,
              source: dbAnn.source,
              createdAt: new Date(dbAnn.created_at),
              updatedAt: dbUpdatedAt,
            };
            addAnnotation(storeAnn);
          } else if (dbUpdatedAt > existing.updatedAt) {
            // Existing annotation was modified on the server (e.g. after a revision) — update it
            updateAnnotation(dbAnn.id, {
              type: dbAnn.type as Annotation2D['type'],
              classId: dbAnn.class_id,
              trackId: dbAnn.track_id,
              data: dbAnn.data as unknown as AnnotationData2D,
              attributes: dbAnn.attributes,
              source: dbAnn.source,
              updatedAt: dbUpdatedAt,
            });
          }
        });
      } catch (error) {
        console.error('Failed to load annotations:', error);
      } finally {
        // Only clear loading state if we're still loading the same frame
        // (prevents older requests from clearing the state for newer frames)
        setLoadingFrameId(prevLoading => prevLoading === currentLoadingFrameId ? null : prevLoading);
      }
    };

    loadAnnotations();
  }, [taskId, frameId, qaMode, isRevisionMode, selectedTaxonomyId, reloadTrigger, clearAnnotations]); // Re-load when taxonomy, revision mode, or reload is triggered

  // Load tracks from database
  // trackId values we've already tried to resolve via a DB refetch, so the
  // sync effect below never loops on a track that legitimately isn't in this
  // task/camera's track list. Reset whenever the task or camera changes.
  const syncedTrackIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!taskId) return;

    const loadTracks = async () => {
      try {
        const dbTracks = await track2DApi.list(taskId, selectedCameraId);
        setTracks(dbTracks);
      } catch (error) {
        console.error('Failed to load tracks:', error);
      }
    };

    syncedTrackIdsRef.current = new Set();
    loadTracks();
  }, [taskId, selectedCameraId]);

  // Keep the local `tracks` list in sync with what annotations reference. Some
  // save paths persist an annotation's track_id to the DB without adding the new
  // Track2D to local state, which left the Tracks tab empty until a page reload.
  // If any loaded annotation points at a track we don't have, refetch once.
  useEffect(() => {
    if (!taskId) return;
    const known = new Set(tracks.map(t => t.id));
    const missing = new Set<string>();
    annotations.forEach(a => {
      if (a.trackId && !known.has(a.trackId) && !syncedTrackIdsRef.current.has(a.trackId)) {
        missing.add(a.trackId);
      }
    });
    if (missing.size === 0) return;
    // Mark as attempted up-front so a track that genuinely belongs to another
    // camera can't trigger an infinite refetch loop.
    missing.forEach(id => syncedTrackIdsRef.current.add(id));

    let cancelled = false;
    (async () => {
      try {
        const dbTracks = await track2DApi.list(taskId, selectedCameraId);
        if (!cancelled) setTracks(dbTracks);
      } catch (error) {
        console.error('Failed to sync tracks for Tracks tab:', error);
      }
    })();
    return () => { cancelled = true; };
  }, [annotations, tracks, taskId, selectedCameraId]);


  // Load QA suggestions when entering QA mode or in revision mode
  useEffect(() => {
    if ((!qaMode && !isRevisionMode) || !taskId) return;

    const loadQaSuggestions = async () => {
      console.log('[Image2DAnnotationView] Loading QA suggestions for task:', taskId);
      setQaLoading(true);
      try {
        // Generate 2D-specific suggestions first
        await qaApi.generate2DSuggestions(taskId, false);
        // Then fetch the actual suggestions
        const suggestions = await qaApi.getTaskSuggestions(taskId);
        console.log('[Image2DAnnotationView] Loaded', suggestions.length, 'suggestions');
        setQaSuggestions(suggestions);
      } catch (error) {
        console.error('Failed to load QA suggestions:', error);
        setQaSuggestions([]);
      } finally {
        setQaLoading(false);
      }
    };

    loadQaSuggestions();
  }, [qaMode, isRevisionMode, taskId]);

  // Callback to refresh QA suggestions
  const refreshQaSuggestions = useCallback(async () => {
    if (!taskId) return;
    setQaLoading(true);
    try {
      // Regenerate 2D suggestions
      await qaApi.generate2DSuggestions(taskId, true);
      // Fetch updated suggestions
      const suggestions = await qaApi.getTaskSuggestions(taskId);
      setQaSuggestions(suggestions);
    } catch (error) {
      console.error('Failed to regenerate QA suggestions:', error);
    } finally {
      setQaLoading(false);
    }
  }, [taskId]);

  // Toggle false negative flagging mode
  const handleToggleFnMode = useCallback(() => {
    setFnMode(prev => !prev);
    // Clear any active drawing or selection when entering FN mode
    if (!fnMode) {
      setActiveTool('select');
      setDrawingPoints([]);
    }
  }, [fnMode]);

  // Clear activeTrackId when switching to a drawing tool (unless explicitly creating a track)
  useEffect(() => {
    const drawingTools = ['box', 'rotated_box', 'ellipse', 'polygon', 'polyline', 'points', 'brush'];
    if (drawingTools.includes(activeTool) && !pendingNewTrack && activeTrackId) {
      setActiveTrackId(null);
    }
  }, [activeTool, pendingNewTrack, activeTrackId]);

  // Set up for creating a new track - the track will be created when user draws first annotation
  const startNewTrack = useCallback(() => {
    if (!taskId) {
      console.warn('No taskId, cannot create track');
      return;
    }
    setPendingNewTrack(true);
    setActiveTrackId(null); // Clear active track so we know to create new one
  }, [taskId]);

  // Actually create the track in the database (called when first annotation is drawn)
  const createTrackWithAnnotation = useCallback(async (classIdOverride?: string): Promise<Track2DData | null> => {
    if (!taskId) {
      console.warn('No taskId, cannot create track');
      return null;
    }

    const classId = classIdOverride || activeClassId;
    const activeClass = availableClasses.find(c => c.id === classId);

    try {
      const newTrack = await track2DApi.create({
        task_id: taskId,
        camera_id: selectedCameraId,
        class_id: classId,
        // name omitted — backend defaults to "<class>_<track-id>"
        color: activeClass?.color || '#3b82f6',
      });

      setTracks(prev => [...prev, newTrack]);
      setActiveTrackId(newTrack.id);
      setPendingNewTrack(false);
      return newTrack;
    } catch (error) {
      console.error('Failed to create track:', error);
      setPendingNewTrack(false);
      return null;
    }
  }, [taskId, selectedCameraId, activeClassId, availableClasses, tracks]);

  // Assign annotation to track
  const assignAnnotationToTrack = useCallback(async (annotationId: string, trackId: string) => {
    if (!taskId) return;

    try {
      // Update annotation in database
      await annotation2DApi.update(annotationId, { track_id: trackId });

      // Update local store
      updateAnnotationWithSourceTracking(annotationId, { trackId });

    } catch (error) {
      console.error('Failed to assign annotation to track:', error);
    }
  }, [taskId, updateAnnotationWithSourceTracking]);

  // Merge selected annotations into a track
  // This assigns all selected annotations to a single track
  const mergeAnnotationsToTrack = useCallback(async (targetTrackId: string | 'new') => {
    if (!taskId || selectedIds.length === 0) return;

    try {
      let finalTrackId = targetTrackId;

      // If creating a new track, create it first
      if (targetTrackId === 'new') {
        // Use the class of the first selected annotation
        const firstAnn = annotations.get(selectedIds[0]);
        const classId = firstAnn?.classId || activeClassId;
        const newTrack = await createTrackWithAnnotation(classId);
        if (!newTrack) {
          console.error('Failed to create new track for merge');
          return;
        }
        finalTrackId = newTrack.id;
      }

      // Assign all selected annotations to the target track
      const updatePromises = selectedIds.map(async (annotationId) => {
        await annotation2DApi.update(annotationId, { track_id: finalTrackId });
        updateAnnotationWithSourceTracking(annotationId, { trackId: finalTrackId });
      });

      await Promise.all(updatePromises);

      setShowMergeDialog(false);
      setMergeTargetTrackId('');

      console.log(`Merged ${selectedIds.length} annotations into track ${finalTrackId}`);
    } catch (error) {
      console.error('Failed to merge annotations:', error);
    }
  }, [taskId, selectedIds, annotations, activeClassId, createTrackWithAnnotation, updateAnnotationWithSourceTracking]);

  // =========================================================================
  // ANNOTATION EDIT HANDLERS
  // =========================================================================

  // Delete single annotation with DB sync
  const handleDeleteAnnotation = useCallback(async (annotationId: string) => {
    const annotation = annotations.get(annotationId);

    // Always delete from local store first
    useAnnotation2DStore.getState().deleteAnnotation(annotationId);

    // Clean up pending AI track IDs (remove the track ID, not annotation ID)
    if (annotation?.trackId) {
      setPendingAiTrackIds(prev => {
        const next = new Set(prev);
        next.delete(annotation.trackId!);
        return next;
      });
    }

    // If we have a taskId, also try to delete from database (but don't fail if not found)
    if (taskId && annotation) {
      try {
        await annotation2DApi.delete(annotationId);
      } catch (error: any) {
        // 404 is expected if the annotation was only local (not yet saved to DB)
        if (error?.response?.status !== 404) {
          console.error('Failed to delete annotation from database:', error);
        }
      }
    }

    // Force Konva stage redraw
    if (stageRef.current) {
      stageRef.current.batchDraw();
    }
  }, [taskId, annotations, selectedCameraId]);

  // Delete all annotations for current frame (current camera only or all cameras)
  const handleDeleteAllFrameAnnotations = useCallback(async (allCameras: boolean = false) => {
    if (!taskId || !frameId) return;

    const targetCameraId = allCameras ? undefined : selectedCameraId;
    const frameAnnotations = Array.from(annotations.values()).filter(ann =>
      ann.frameId === frameId && (allCameras || ann.cameraId === selectedCameraId)
    );

    if (frameAnnotations.length === 0) {
      alert('No annotations to delete on this frame.');
      return;
    }

    const confirmMsg = allCameras
      ? `Delete ALL ${frameAnnotations.length} annotations on this frame (all cameras)?`
      : `Delete all ${frameAnnotations.length} annotations on this frame for ${selectedCameraId}?`;

    if (!confirm(confirmMsg + '\n\nThis action cannot be undone.')) return;

    try {
      // Delete from database
      await annotation2DApi.deleteByFrame(frameId, taskId, targetCameraId);

      // Delete from local store
      frameAnnotations.forEach(ann => {
        useAnnotation2DStore.getState().deleteAnnotation(ann.id);
      });

      // Clean up pending AI track IDs (remove track IDs, not annotation IDs)
      setPendingAiTrackIds(prev => {
        const next = new Set(prev);
        frameAnnotations.forEach(ann => {
          if (ann.trackId) next.delete(ann.trackId);
        });
        return next;
      });
    } catch (error) {
      console.error('Failed to delete frame annotations:', error);
      alert('Failed to delete annotations. Please try again.');
    }
  }, [taskId, frameId, selectedCameraId, annotations]);

  // Update annotation class with DB sync
  const handleUpdateAnnotationClass = useCallback(async (annotationId: string, classId: string) => {
    try {
      await annotation2DApi.update(annotationId, { class_id: classId });
      updateAnnotationWithSourceTracking(annotationId, { classId });
    } catch (error) {
      console.error('Failed to update annotation class:', error);
    }
  }, [updateAnnotationWithSourceTracking]);

  // Duplicate annotation
  const handleDuplicateAnnotation = useCallback((annotationId: string) => {
    const ann = annotations.get(annotationId);
    if (!ann) return;

    // Create offset data based on annotation type
    let offsetData = ann.data;
    if ('x' in ann.data && 'y' in ann.data) {
      offsetData = { ...ann.data, x: (ann.data as any).x + 20, y: (ann.data as any).y + 20 };
    } else if ('cx' in ann.data && 'cy' in ann.data) {
      offsetData = { ...ann.data, cx: (ann.data as any).cx + 20, cy: (ann.data as any).cy + 20 };
    } else if ('polygon' in ann.data) {
      // Handle semantic_segment with polygon field
      offsetData = {
        ...ann.data,
        polygon: (ann.data as any).polygon.map((p: { x: number; y: number }) => ({ x: p.x + 20, y: p.y + 20 }))
      };
    } else if ('points' in ann.data) {
      // Handle polygon/polyline/semantic_segment with legacy points field
      offsetData = {
        ...ann.data,
        points: (ann.data as any).points.map((p: { x: number; y: number }) => ({ x: p.x + 20, y: p.y + 20 }))
      };
    }

    createAnnotation({
      type: ann.type,
      classId: ann.classId,
      frameId: ann.frameId,
      cameraId: ann.cameraId,
      data: offsetData,
      attributes: { ...ann.attributes },
      isLocked: false,
      isHidden: false,
    });
  }, [annotations, createAnnotation]);

  // Z-order controls
  const handleBringToFront = useCallback((annotationId: string) => {
    useAnnotation2DStore.getState().bringToFront(annotationId);
  }, []);

  const handleSendToBack = useCallback((annotationId: string) => {
    useAnnotation2DStore.getState().sendToBack(annotationId);
  }, []);

  // Convert polygon to semantic segment
  const handleConvertToSemanticSegment = useCallback(async (annotationId: string) => {
    const ann = annotations.get(annotationId);
    if (!ann || ann.type !== 'polygon') {
      console.warn('Can only convert polygon annotations to semantic segments');
      return;
    }

    const polygonData = ann.data as PolygonData2D;

    // Create the semantic segment data from the polygon
    // Semantic segments fill all pixels inside the polygon boundary
    const segmentData: SemanticSegmentData = {
      polygon: polygonData.points,
      isClosed: true,
      fillColor: getClassColor(ann.classId),
      opacity: 0.6, // Higher opacity for better visibility of filled region
      isSmooth: false, // Use straight edges for precise pixel coverage
      tension: 0,
      sourcePolygonId: ann.id,
    };

    try {
      // Create new semantic segment annotation in DB
      if (taskId) {
        const createData: Annotation2DCreate = {
          task_id: taskId,
          frame_id: ann.frameId,
          camera_id: ann.cameraId,
          type: 'semantic_segment',
          class_id: ann.classId,
          track_id: ann.trackId,
          taxonomy_id: selectedTaxonomyId,
          data: segmentData as unknown as Record<string, unknown>,
          attributes: { ...ann.attributes, converted_from: 'polygon' },
          source: 'manual_2d',
        };

        const response = await annotation2DApi.create(createData);

        // Add to local store
        addAnnotation({
          id: response.id,
          type: 'semantic_segment',
          classId: ann.classId,
          trackId: ann.trackId,
          frameId: ann.frameId,
          cameraId: ann.cameraId,
          data: segmentData,
          attributes: { ...ann.attributes, converted_from: 'polygon' },
          isLocked: false,
          isHidden: false,
          zIndex: ann.zIndex + 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        // Optionally delete the original polygon
        // await handleDeleteAnnotation(annotationId);

      } else {
        // Local only mode - just create locally
        createAnnotation({
          type: 'semantic_segment',
          classId: ann.classId,
          trackId: ann.trackId,
          frameId: ann.frameId,
          cameraId: ann.cameraId,
          data: segmentData,
          attributes: { ...ann.attributes, converted_from: 'polygon' },
          isLocked: false,
          isHidden: false,
        });
      }
    } catch (error) {
      console.error('Failed to convert polygon to semantic segment:', error);
    }
  }, [annotations, taskId, addAnnotation, createAnnotation, getClassColor]);

  // =========================================================================
  // AI SEGMENT HANDLERS
  // =========================================================================

  // Get original API URL for SAM2 (not cached blob which backend can't fetch)
  const originalImageUrl = useMemo(() => {
    if (getOriginalImageUrl) {
      return getOriginalImageUrl(selectedCameraId);
    }
    // Fallback to regular URL if getOriginalImageUrl not provided
    return getImageUrl(selectedCameraId);
  }, [getOriginalImageUrl, getImageUrl, selectedCameraId, frameId]);

  // Set to true on first 500/network failure so we stop hitting a downed SAM2 service
  const aiSegmentServiceDownRef = useRef(false);

  // Precompute AI Segment embedding when image loads (for low latency)
  const precomputeAiSegmentEmbedding = useCallback(async () => {
    // Use original API URL, not cached blob URL (backend can't fetch blob URLs)
    if (!originalImageUrl || aiSegmentServiceDownRef.current) return;

    try {
      const response = await aiSegmentApi.computeEmbedding(originalImageUrl);
      setAiSegmentEmbeddingKey(response.embedding_key);
    } catch (error) {
      aiSegmentServiceDownRef.current = true;
    }
  }, [originalImageUrl]);

  // Precompute embedding when image URL changes
  useEffect(() => {
    if (originalImageUrl) {
      // Clear previous AI Segment state when image changes
      setAiSegmentPoints([]);
      setAiSegmentPreview(null);
      setAiSegmentRawMask(null);
      setAiSegmentEmbeddingKey(null);
      setAiSegmentLoading(false);

      // Precompute embedding for new image
      precomputeAiSegmentEmbedding();
    }
  }, [originalImageUrl, precomputeAiSegmentEmbedding]);

  // Also clear AI Segment state when frame changes (safety net)
  useEffect(() => {
    setAiSegmentPoints([]);
    setAiSegmentPreview(null);
    setAiSegmentRawMask(null);
    setAiSegmentEmbeddingKey(null);
    setAiSegmentLoading(false);
  }, [frameId]);

  // Run AI Segment inference with current points
  const runAiSegmentInference = useCallback(async (points: AISegmentPointPrompt[]) => {

    if (points.length === 0) {
      setAiSegmentRawMask(null);
      setAiSegmentPreview(null);
      return;
    }

    // Use original API URL, not cached blob URL (backend can't fetch blob URLs)
    if (!originalImageUrl) {
      console.warn('[AI Segment] No image URL available, originalImageUrl:', originalImageUrl);
      return;
    }

    // Convert relative URL to absolute URL for backend to fetch
    let absoluteImageUrl = originalImageUrl;
    if (originalImageUrl.startsWith('/')) {
      absoluteImageUrl = `${window.location.origin}${originalImageUrl}`;
    }

    setAiSegmentLoading(true);

    try {
      const response = await aiSegmentApi.segment({
        image_url: absoluteImageUrl,
        points,
        embedding_key: aiSegmentEmbeddingKey || undefined,
        simplify_tolerance: aiSegmentSimplifyTolerance,
      });

      setAiSegmentLastInferenceMs(response.inference_time_ms);

      // Update embedding key if returned
      if (response.embedding_key) {
        setAiSegmentEmbeddingKey(response.embedding_key);
      }

      // Store the raw mask; the re-clip effect below produces the clipped
      // preview shown to the user. Keeping the raw result lets us re-clip
      // when existing annotations change without re-running inference.
      if (response.masks.length > 0) {
        setAiSegmentRawMask(response.masks[0]);
      } else {
        setAiSegmentRawMask(null);
        setAiSegmentPreview(null);
      }
    } catch (error) {
      console.error('[AI Segment] Inference failed:', error);
      setAiSegmentRawMask(null);
      setAiSegmentPreview(null);
    } finally {
      setAiSegmentLoading(false);
    }
  }, [originalImageUrl, aiSegmentEmbeddingKey, aiSegmentSimplifyTolerance]);

  // Re-clip the raw SAM2 mask whenever existing annotations or image bounds
  // change, so the preview always reflects the current accepted segments.
  useEffect(() => {
    if (!aiSegmentRawMask) {
      setAiSegmentPreview(null);
      return;
    }
    const existing = Array.from(annotations.values()).filter(
      (a) => a.frameId === frameId && a.cameraId === selectedCameraId,
    );
    const clip = clipAgainstExisting(aiSegmentRawMask.polygon, imageSize, existing);
    if (clip.polygon && clip.polygon.length >= 3) {
      setAiSegmentPreview({
        polygon: clip.polygon,
        score: aiSegmentRawMask.score,
        area: Math.round(clip.clippedArea),
      });
    } else {
      setAiSegmentPreview(null);
    }
  }, [aiSegmentRawMask, annotations, frameId, selectedCameraId, imageSize]);

  // Handle AI Segment click - add positive or negative point
  const handleAiSegmentClick = useCallback((x: number, y: number, isNegative: boolean) => {

    const newPoint: AISegmentPointPrompt = {
      x,
      y,
      label: isNegative ? 0 : 1,
    };

    const newPoints = [...aiSegmentPoints, newPoint];
    setAiSegmentPoints(newPoints);

    // Run inference immediately
    runAiSegmentInference(newPoints);
  }, [aiSegmentPoints, runAiSegmentInference]);

  // Accept AI Segment result and create semantic segment annotation
  const acceptSemanticSegment = useCallback(async () => {
    if (!aiSegmentPreview || aiSegmentPreview.polygon.length < 3) {
      console.warn('[AI Segment] No valid preview to accept');
      return;
    }

    // Defensive re-clip against current state (annotations may have changed
    // between preview and accept).
    const existing = Array.from(annotations.values()).filter(
      (a) => a.frameId === frameId && a.cameraId === selectedCameraId,
    );
    const clip = clipAgainstExisting(aiSegmentPreview.polygon, imageSize, existing);
    if (!clip.polygon || clip.polygon.length < 3) {
      console.warn('[AI Segment] Region already covered by existing segments');
      return;
    }

    // Convert AI Segment polygon to semantic segment with smooth splines
    const segmentData: SemanticSegmentData = {
      polygon: clip.polygon.map(p => ({ x: p.x, y: p.y })),
      isClosed: true,
      fillColor: getClassColor(activeClassId),
      opacity: 0.35,
      isSmooth: true,  // Enable smooth splines for reduced points and better performance
      tension: 1.0,    // Higher tension for smoother curves, prevents sharp craters
    };

    try {
      if (taskId && frameId) {
        // Save to database
        const createData: Annotation2DCreate = {
          task_id: taskId,
          frame_id: frameId,
          camera_id: selectedCameraId,
          type: 'semantic_segment',
          class_id: activeClassId,
          taxonomy_id: selectedTaxonomyId,
          data: segmentData as unknown as Record<string, unknown>,
          attributes: { source: 'ai_segment', score: aiSegmentPreview.score },
          source: 'ai_segment',
        };

        const response = await annotation2DApi.create(createData);

        addAnnotation({
          id: response.id,
          type: 'semantic_segment',
          classId: activeClassId,
          frameId: frameId,
          cameraId: selectedCameraId,
          data: segmentData,
          attributes: { source: 'ai_segment', score: aiSegmentPreview.score },
          isLocked: false,
          isHidden: false,
          zIndex: annotations.size + 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } else {
        // Local only
        createAnnotation({
          type: 'semantic_segment',
          classId: activeClassId,
          frameId: frameId || 'local',
          cameraId: selectedCameraId,
          data: segmentData,
          attributes: { source: 'ai_segment', score: aiSegmentPreview.score },
          isLocked: false,
          isHidden: false,
        });
      }


      // Clear AI Segment state
      setAiSegmentPoints([]);
      setAiSegmentPreview(null);
      setAiSegmentRawMask(null);
    } catch (error) {
      console.error('[AI Segment] Failed to create annotation:', error);
    }
  }, [aiSegmentPreview, taskId, frameId, selectedCameraId, activeClassId, getClassColor, addAnnotation, createAnnotation, annotations, imageSize]);

  // Accept AI Segment result and create AI-assisted polygon annotation
  const acceptAIPolygon = useCallback(async () => {
    if (!aiSegmentPreview || aiSegmentPreview.polygon.length < 3) {
      console.warn('[AI Segment] No valid preview to accept');
      return;
    }

    // Defensive re-clip against current state.
    const existing = Array.from(annotations.values()).filter(
      (a) => a.frameId === frameId && a.cameraId === selectedCameraId,
    );
    const clip = clipAgainstExisting(aiSegmentPreview.polygon, imageSize, existing);
    if (!clip.polygon || clip.polygon.length < 3) {
      console.warn('[AI Segment] Region already covered by existing segments');
      return;
    }

    // Convert AI Segment polygon to regular polygon annotation
    const polygonData: PolygonData2D = {
      points: clip.polygon.map(p => ({ x: p.x, y: p.y })),
      isClosed: true,
      isSmooth: smoothPolygon,
      tension: splineTension,
    };

    try {
      if (taskId && frameId) {
        // Save to database as polygon type
        const createData: Annotation2DCreate = {
          task_id: taskId,
          frame_id: frameId,
          camera_id: selectedCameraId,
          type: 'polygon',
          class_id: activeClassId,
          taxonomy_id: selectedTaxonomyId,
          data: polygonData as unknown as Record<string, unknown>,
          attributes: { source: 'ai_segment_polygon', score: aiSegmentPreview.score },
          source: 'ai_segment',
        };

        const response = await annotation2DApi.create(createData);

        addAnnotation({
          id: response.id,
          type: 'polygon',
          classId: activeClassId,
          frameId: frameId,
          cameraId: selectedCameraId,
          data: polygonData,
          attributes: { source: 'ai_segment_polygon', score: aiSegmentPreview.score },
          isLocked: false,
          isHidden: false,
          zIndex: annotations.size + 1,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      } else {
        // Local only
        createAnnotation({
          type: 'polygon',
          classId: activeClassId,
          frameId: frameId || 'local',
          cameraId: selectedCameraId,
          data: polygonData,
          attributes: { source: 'ai_segment_polygon', score: aiSegmentPreview.score },
          isLocked: false,
          isHidden: false,
        });
      }

      // Clear AI Segment state
      setAiSegmentPoints([]);
      setAiSegmentPreview(null);
      setAiSegmentRawMask(null);
    } catch (error) {
      console.error('[AI Segment] Failed to create AI polygon:', error);
    }
  }, [aiSegmentPreview, taskId, frameId, selectedCameraId, activeClassId, getClassColor, addAnnotation, createAnnotation, annotations, smoothPolygon, splineTension, imageSize]);

  // Unified accept handler that dispatches to correct function based on tool
  const acceptAiSegmentResult = useCallback(() => {
    if (activeTool === 'semantic_segment') {
      return acceptSemanticSegment();
    } else if (activeTool === 'ai_polygon') {
      return acceptAIPolygon();
    }
  }, [activeTool, acceptSemanticSegment, acceptAIPolygon]);

  // Clear AI Segment state
  const clearAiSegment = useCallback(() => {
    setAiSegmentPoints([]);
    setAiSegmentPreview(null);
    setAiSegmentRawMask(null);
  }, []);

  // Clear AI Segment state when switching away from AI Segment tools
  useEffect(() => {
    if (activeTool !== 'semantic_segment' && activeTool !== 'ai_polygon' && (aiSegmentPoints.length > 0 || aiSegmentPreview)) {
      clearAiSegment();
    }
  }, [activeTool, aiSegmentPoints.length, aiSegmentPreview, clearAiSegment]);


  // Delete track with DB sync - also deletes ALL annotations in the track
  const handleDeleteTrack = useCallback(async (trackId: string, deleteAnnotations: boolean = true) => {
    if (!taskId) return;

    try {
      // Get all annotations belonging to this track
      const trackAnnotations = Array.from(annotations.values()).filter(ann => ann.trackId === trackId);

      if (deleteAnnotations) {
        // Delete all annotations in the track from database
        for (const ann of trackAnnotations) {
          try {
            await annotation2DApi.delete(ann.id);
          } catch (error: any) {
            // 404 is expected if not in DB
            if (error?.response?.status !== 404) {
              console.error('Failed to delete annotation:', error);
            }
          }
          // Remove from local store
          useAnnotation2DStore.getState().deleteAnnotation(ann.id);
        }

        // Clean up pending AI track IDs (remove the track ID directly)
        setPendingAiTrackIds(prev => {
          const next = new Set(prev);
          next.delete(trackId);
          return next;
        });
      } else {
        // Just unassign annotations from track
        for (const ann of trackAnnotations) {
          try {
            await annotation2DApi.update(ann.id, { track_id: undefined });
          } catch (error) {
            console.error('Failed to unassign annotation:', error);
          }
          updateAnnotationWithSourceTracking(ann.id, { trackId: undefined });
        }
      }

      // Delete track from database
      await track2DApi.delete(trackId);

      // Remove from local state
      setTracks(prev => prev.filter(t => t.id !== trackId));

      // Clear active track if it was the deleted one
      if (activeTrackId === trackId) {
        setActiveTrackId(null);
      }
    } catch (error) {
      console.error('Failed to delete track:', error);
    }
  }, [taskId, activeTrackId, annotations, updateAnnotationWithSourceTracking]);

  // Update track name
  const handleUpdateTrackName = useCallback(async (trackId: string, name: string) => {
    if (!taskId) return;

    try {
      await track2DApi.update(trackId, { name });
      setTracks(prev => prev.map(t => t.id === trackId ? { ...t, name } : t));
    } catch (error) {
      console.error('Failed to update track name:', error);
    }
  }, [taskId]);

  // Update track class
  const handleUpdateTrackClass = useCallback(async (trackId: string, classId: string) => {
    if (!taskId) return;

    const classInfo = availableClasses.find(c => c.id === classId);

    try {
      await track2DApi.update(trackId, { class_id: classId, color: classInfo?.color });
      setTracks(prev => prev.map(t => t.id === trackId ? { ...t, class_id: classId, color: classInfo?.color } : t));
    } catch (error) {
      console.error('Failed to update track class:', error);
    }
  }, [taskId, availableClasses]);

  // Toggle track complete status
  const handleToggleTrackComplete = useCallback(async (trackId: string) => {
    if (!taskId) return;

    const track = tracks.find(t => t.id === trackId);
    if (!track) return;

    const newStatus = !track.is_complete;

    try {
      await track2DApi.update(trackId, { is_complete: newStatus });
      setTracks(prev => prev.map(t => t.id === trackId ? { ...t, is_complete: newStatus } : t));
    } catch (error) {
      console.error('Failed to update track status:', error);
    }
  }, [taskId, tracks]);

  // Merge selected tracks into one
  const handleMergeTracks = useCallback(async () => {
    if (!taskId || selectedTrackIds.size < 2) return;

    const ids = Array.from(selectedTrackIds);
    // Pick the track with the most annotations as the target (keeps its name/class)
    let targetId = ids[0];
    let maxAnns = 0;
    for (const tid of ids) {
      const count = Array.from(annotations.values()).filter(a => a.trackId === tid).length;
      if (count > maxAnns) { maxAnns = count; targetId = tid; }
    }
    const targetTrack = tracks.find(t => t.id === targetId);
    const sourceIds = ids.filter(id => id !== targetId);
    const sourceNames = sourceIds.map(id => tracks.find(t => t.id === id)?.name || 'Unnamed').join(', ');

    const confirmed = window.confirm(
      `Merge ${sourceIds.length} track(s) (${sourceNames}) into "${targetTrack?.name || 'Unnamed'}"?\n\nAll annotations will be moved to the target track. Source tracks will be deleted.`
    );
    if (!confirmed) return;

    try {
      // Call backend merge
      const updatedTarget = await track2DApi.merge(targetId, sourceIds);

      // Update local annotations to mirror the backend merge: reassign source
      // annotations to the target, but on a frame the target already occupies
      // keep the target's and drop the source's (one lane per frame).
      const store = useAnnotation2DStore.getState();
      const occupied = new Set(
        Array.from(annotations.values()).filter(a => a.trackId === targetId).map(a => a.frameId)
      );
      for (const srcId of sourceIds) {
        const srcAnnotations = Array.from(annotations.values()).filter(a => a.trackId === srcId);
        for (const ann of srcAnnotations) {
          if (occupied.has(ann.frameId)) {
            store.deleteAnnotation(ann.id);
          } else {
            occupied.add(ann.frameId);
            updateAnnotationWithSourceTracking(ann.id, { trackId: targetId });
          }
        }
      }

      // Remove source tracks from state, update target
      setTracks(prev => prev.filter(t => !sourceIds.includes(t.id)).map(t => t.id === targetId ? { ...t, ...updatedTarget } : t));
      setSelectedTrackIds(new Set());
      setActiveTrackId(targetId);
    } catch (error) {
      console.error('Failed to merge tracks:', error);
      alert('Failed to merge tracks. Please try again.');
    }
  }, [taskId, selectedTrackIds, tracks, annotations, updateAnnotationWithSourceTracking]);

  // Copy ID to clipboard
  const handleCopyId = useCallback((id: string) => {
    navigator.clipboard.writeText(id).then(() => {
    }).catch(err => {
      console.error('Failed to copy ID:', err);
    });
  }, []);

  // Pan to annotation - centers the canvas on a specific annotation
  const panToAnnotation = useCallback((annotationId: string) => {
    const ann = annotations.get(annotationId);
    if (!ann || !containerSize.width || !containerSize.height) return;

    let centerX = 0;
    let centerY = 0;

    // Calculate center based on annotation type
    if (ann.type === 'box' || ann.type === 'box2d') {
      const data = (ann.data as any).bbox || ann.data;
      centerX = data.x + data.width / 2;
      centerY = data.y + data.height / 2;
    } else if (ann.type === 'polygon' || ann.type === 'polyline' || ann.type === 'semantic_segment') {
      const points = (ann.data as any).polygon || (ann.data as any).points || [];
      if (points.length > 0) {
        const sumX = points.reduce((sum: number, p: any) => sum + p.x, 0);
        const sumY = points.reduce((sum: number, p: any) => sum + p.y, 0);
        centerX = sumX / points.length;
        centerY = sumY / points.length;
      }
    } else if (ann.type === 'ellipse') {
      const data = ann.data as any;
      centerX = data.cx;
      centerY = data.cy;
    }

    // Pan to center the annotation in the viewport
    setPosition({
      x: containerSize.width / 2 - centerX * scale,
      y: containerSize.height / 2 - centerY * scale,
    });
  }, [annotations, containerSize, scale]);

  // Smart zoom to annotation based on bounding box area
  // Calculates optimal zoom so the object appears at a comfortable review size
  const zoomToAnnotation = useCallback((annotationId: string, _minZoom?: number) => {
    const ann = annotations.get(annotationId);
    if (!ann || !containerSize.width || !containerSize.height) return;

    let bounds: { x: number; y: number; width: number; height: number } | null = null;

    // Calculate bounding box based on annotation type
    if (ann.type === 'box' || ann.type === 'box2d') {
      const data = (ann.data as any).bbox || ann.data;
      bounds = { x: data.x, y: data.y, width: data.width, height: data.height };
    } else if (ann.type === 'polygon' || ann.type === 'polyline') {
      const points = (ann.data as any).polygon || (ann.data as any).points || [];
      if (points.length > 0) {
        const xs = points.map((p: any) => p.x);
        const ys = points.map((p: any) => p.y);
        const minX = Math.min(...xs);
        const maxX = Math.max(...xs);
        const minY = Math.min(...ys);
        const maxY = Math.max(...ys);
        bounds = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      }
    } else if (ann.type === 'ellipse') {
      const data = ann.data as any;
      bounds = {
        x: data.cx - data.rx,
        y: data.cy - data.ry,
        width: data.rx * 2,
        height: data.ry * 2,
      };
    }

    if (!bounds || bounds.width === 0 || bounds.height === 0) {
      panToAnnotation(annotationId);
      return;
    }

    // Smart zoom based on box area for optimal QA review
    // Goal: Make boxes appear at a comfortable, consistent size on screen
    const boxArea = bounds.width * bounds.height;
    const boxDiagonal = Math.sqrt(bounds.width * bounds.width + bounds.height * bounds.height);

    // Target: box diagonal should appear as ~300-400px on screen for comfortable review
    // This is independent of actual box size - small boxes zoom more, large boxes zoom less
    const targetScreenDiagonal = 350; // pixels on screen

    // Calculate zoom to achieve target screen size
    let idealZoom = targetScreenDiagonal / boxDiagonal;

    // Apply area-based adjustments for edge cases:
    // - Very tiny boxes (< 1000 px² area): cap zoom to prevent pixelation
    // - Very large boxes (> 100000 px² area): ensure we don't zoom out too much
    if (boxArea < 1000) {
      // Tiny object - cap at 6x to avoid excessive pixelation
      idealZoom = Math.min(idealZoom, 6);
    } else if (boxArea > 100000) {
      // Large object - ensure at least 1.2x zoom for some detail
      idealZoom = Math.max(idealZoom, 1.2);
    }

    // Final clamp: between 1x and 8x
    const newScale = Math.max(1, Math.min(idealZoom, 8));

    // Calculate center
    const centerX = bounds.x + bounds.width / 2;
    const centerY = bounds.y + bounds.height / 2;

    // Set scale and position
    // Mark as manually zoomed to prevent auto-fit from overriding
    hasManualZoomRef.current = true;
    setScale(newScale);
    setPosition({
      x: containerSize.width / 2 - centerX * newScale,
      y: containerSize.height / 2 - centerY * newScale,
    });
  }, [annotations, containerSize, panToAnnotation]);

  // Handle pending zoom after frame navigation
  // Use a small delay to ensure the frame has fully loaded
  useEffect(() => {
    if (!pendingZoom) return;

    // Pre-emptively set manual zoom flag to prevent auto-fit from interfering
    hasManualZoomRef.current = true;

    // Small delay to allow frame navigation to complete and image to load
    const timer = setTimeout(() => {
      const ann = annotations.get(pendingZoom.annotationId);

      if (ann) {
        // Annotation exists - select and zoom to it
        select(pendingZoom.annotationId);
        zoomToAnnotation(pendingZoom.annotationId, pendingZoom.zoomLevel);
        setPendingZoom(null);
      } else {
        // Annotation not found yet - might still be loading
        // Keep pendingZoom so it will retry on next render
        console.log('[pendingZoom] Annotation not found yet, will retry:', pendingZoom.annotationId);
      }
    }, 150); // Slightly longer delay to ensure image has loaded

    return () => clearTimeout(timer);
  }, [pendingZoom, annotations, frameId, select, zoomToAnnotation]);

  // Interpolate track - creates annotations between keyframes
  // If re-interpolating, it will delete old interpolated annotations and create new ones
  const interpolateTrack = useCallback(async (trackId: string, forceReinterpolate: boolean = true, opts: { silent?: boolean } = {}) => {
    if (!taskId || frames.length === 0) {
      console.warn('Cannot interpolate: no taskId or frames');
      return;
    }

    const silent = opts.silent === true;
    if (!silent) setInterpolateStatus('interpolating');

    try {
      // Read FRESH store state, not the closured `annotations` snapshot — when
      // interpolation is auto-triggered right after an edit, the closure is stale
      // and would miss the keyframe the user just edited.
      const allTrackAnnotations = Array.from(useAnnotation2DStore.getState().annotations.values())
        .filter(ann => ann.trackId === trackId && ann.cameraId === selectedCameraId);

      // ── Lane (polyline) tracks: "smart" interpolation ──────────────────────
      // The box path below only handles boxes. For lane tracks we (A) re-interpolate
      // the polyline between frames the user has edited (overwriting the AI/old
      // geometry in between) and (B) fill any frames that have no lane at all,
      // anchored by the nearest frames that do. Edited frames are never modified.
      const laneMembers = allTrackAnnotations
        .filter(a => a.type === 'polyline')
        .map(a => ({ a, idx: frames.find(f => f.id === a.frameId)?.frame_index ?? -1 }))
        .filter(m => m.idx >= 0);
      if (laneMembers.length > 0) {
        const RES_N = 24;
        const sampleXAtY = (pts: Array<{ x: number; y: number }>, y: number): number => {
          const s = [...pts].sort((p, q) => p.y - q.y);
          if (y <= s[0].y) return s[0].x;
          if (y >= s[s.length - 1].y) return s[s.length - 1].x;
          for (let i = 0; i < s.length - 1; i++) {
            const a = s[i], b = s[i + 1];
            if (y >= a.y && y <= b.y) {
              const t = (y - a.y) / ((b.y - a.y) || 1e-9);
              return a.x + t * (b.x - a.x);
            }
          }
          return s[s.length - 1].x;
        };
        const resample = (pts: Array<{ x: number; y: number }>) => {
          const s = [...pts].sort((p, q) => p.y - q.y);
          const y0 = s[0].y, y1 = s[s.length - 1].y;
          return Array.from({ length: RES_N }, (_, k) => {
            const y = y0 + (y1 - y0) * (k / (RES_N - 1));
            return { x: sampleXAtY(s, y), y };
          });
        };
        const lerpLane = (aPts: Array<{ x: number; y: number }>, bPts: Array<{ x: number; y: number }>, t: number) => {
          const A = resample(aPts), B = resample(bPts);
          return A.map((p, i) => ({ x: p.x + (B[i].x - p.x) * t, y: p.y + (B[i].y - p.y) * t }));
        };
        const ptsOf = (a: Annotation2D) => (a.data as PolylineData2D | undefined)?.points || [];

        const laneByIdx = new Map<number, Annotation2D>();
        laneMembers.forEach(m => laneByIdx.set(m.idx, m.a));
        const isEdited = (a: Annotation2D) => (a.attributes as Record<string, unknown> | undefined)?.userEdited === true;
        const editedSorted = laneMembers.filter(m => isEdited(m.a)).sort((x, y) => x.idx - y.idx);

        const targets = new Map<number, Array<{ x: number; y: number }>>();
        const frameExists = (f: number) => frames.some(fr => fr.frame_index === f);

        // Pass A — smooth between edited keyframes (overwrites in-between frames).
        for (let i = 0; i < editedSorted.length - 1; i++) {
          const e1 = editedSorted[i], e2 = editedSorted[i + 1];
          const p1 = ptsOf(e1.a), p2 = ptsOf(e2.a);
          if (p1.length < 2 || p2.length < 2) continue;
          for (let f = e1.idx + 1; f < e2.idx; f++) {
            if (!frameExists(f)) continue;
            targets.set(f, lerpLane(p1, p2, (f - e1.idx) / (e2.idx - e1.idx)));
          }
        }

        // Pass B — gap fill: any frame still without a lane, anchored by nearest
        // frames that have one (original lanes or Pass-A results).
        const hasLane = (f: number) => laneByIdx.has(f) || targets.has(f);
        const getPts = (f: number) => targets.get(f) || ptsOf(laneByIdx.get(f) as Annotation2D);
        const anchors = Array.from(new Set<number>([...laneByIdx.keys(), ...targets.keys()])).sort((a, b) => a - b);
        for (let i = 0; i < anchors.length - 1; i++) {
          const a = anchors[i], b = anchors[i + 1];
          if (b - a <= 1) continue;
          const pa = getPts(a), pb = getPts(b);
          if (pa.length < 2 || pb.length < 2) continue;
          for (let f = a + 1; f < b; f++) {
            if (hasLane(f) || !frameExists(f)) continue;
            targets.set(f, lerpLane(pa, pb, (f - a) / (b - a)));
          }
        }

        if (targets.size === 0) {
          const editedCount = editedSorted.length;
          console.warn(`[LaneInterp] Nothing to interpolate: ${laneMembers.length} frames, ${editedCount} edited, no gaps.`);
          if (!silent) {
            showLaneToast('info', editedCount < 2
              ? 'Nothing to interpolate — this lane is on every frame. Edit the lane on 2+ frames first, then Interpolate fills between them. (A single edit already auto-adjusts neighboring frames.)'
              : 'Nothing to interpolate — no gaps between your edited frames.');
            setInterpolateStatus('done');
            setTimeout(() => setInterpolateStatus('idle'), 2000);
          }
          return;
        }

        const store = useAnnotation2DStore.getState();
        const base = (editedSorted[0]?.a) || laneMembers[0].a;
        const toCreate: Annotation2DCreate[] = [];
        // Batch all existing-frame updates into ONE request (avoid nginx 503s).
        const toUpdate: Array<{ id: string; data: Record<string, unknown>; attributes: Record<string, unknown> }> = [];
        for (const [f, pts] of targets) {
          const frame = frames.find(fr => fr.frame_index === f);
          if (!frame) continue;
          const existing = laneByIdx.get(f);
          if (existing && isEdited(existing)) continue; // never clobber an edited keyframe
          if (existing) {
            const newData = { ...(existing.data as PolylineData2D), points: pts };
            const newAttrs = { ...(existing.attributes || {}), interpolated: true };
            store.updateAnnotation(existing.id, { data: newData as unknown as AnnotationData2D, attributes: newAttrs, updatedAt: new Date() });
            toUpdate.push({ id: existing.id, data: newData as unknown as Record<string, unknown>, attributes: newAttrs });
          } else {
            toCreate.push({
              task_id: taskId,
              frame_id: frame.id,
              camera_id: selectedCameraId,
              track_id: trackId,
              type: 'polyline',
              class_id: base.classId,
              taxonomy_id: selectedTaxonomyId,
              data: { ...(base.data as PolylineData2D), points: pts } as unknown as Record<string, unknown>,
              attributes: { interpolated: true },
              source: 'interpolated',
            });
          }
        }

        if (toUpdate.length > 0) {
          await annotation2DApi.updateBulk(toUpdate)
            .catch(err => console.error('[LaneInterp] Failed to persist updated lanes:', err));
        }
        if (toCreate.length > 0) {
          const saved = await annotation2DApi.createBulk(toCreate);
          saved.forEach(dbAnn => addAnnotation({
            id: dbAnn.id,
            type: dbAnn.type as Annotation2D['type'],
            classId: dbAnn.class_id,
            trackId: dbAnn.track_id,
            frameId: dbAnn.frame_id,
            cameraId: dbAnn.camera_id,
            data: dbAnn.data as unknown as AnnotationData2D,
            attributes: dbAnn.attributes,
            isLocked: false,
            isHidden: false,
            zIndex: annotations.size,
            createdAt: new Date(dbAnn.created_at),
            updatedAt: new Date(dbAnn.updated_at),
          }));
        }

        const laneTrack = tracks.find(t => t.id === trackId);
        if (laneTrack) {
          await track2DApi.update(trackId, { is_interpolated: true }).catch(() => {});
          setTracks(prev => prev.map(t => t.id === trackId ? { ...t, is_interpolated: true } : t));
        }
        console.log(`[LaneInterp] Interpolated ${targets.size} lane frame(s) on track ${trackId}${silent ? ' (auto)' : ''}`);
        if (!silent) {
          showLaneToast('success', `Interpolated ${targets.size} frame(s) on this lane.`);
          setInterpolateStatus('done');
          setTimeout(() => setInterpolateStatus('idle'), 2000);
        }
        return;
      }

      // Separate keyframes from interpolated/propagated annotations
      // Keyframes are human-edited boxes only (not interpolated, not propagated)
      const keyframeAnnotations = allTrackAnnotations
        .filter(ann => !ann.attributes?.interpolated && !ann.attributes?.propagated)
        .map(ann => {
          const frame = frames.find(f => f.id === ann.frameId);
          return { annotation: ann, frameIndex: frame?.frame_index ?? -1 };
        })
        .filter(item => item.frameIndex >= 0)
        .sort((a, b) => a.frameIndex - b.frameIndex);

      const interpolatedAnnotations = allTrackAnnotations
        .filter(ann => ann.attributes?.interpolated);

      if (keyframeAnnotations.length < 2) {
        console.warn('Need at least 2 keyframes to interpolate');
        setInterpolateStatus('error');
        setTimeout(() => setInterpolateStatus('idle'), 2000);
        return;
      }

      // If re-interpolating, delete existing interpolated annotations first
      if (forceReinterpolate && interpolatedAnnotations.length > 0) {
        console.log(`Deleting ${interpolatedAnnotations.length} old interpolated annotations...`);
        for (const ann of interpolatedAnnotations) {
          try {
            await annotation2DApi.delete(ann.id);
            useAnnotation2DStore.getState().deleteAnnotation(ann.id);
          } catch (error: any) {
            if (error?.response?.status !== 404) {
              console.error('Failed to delete interpolated annotation:', error);
            }
          }
        }
      }

      const track = tracks.find(t => t.id === trackId);
      const newInterpolatedAnnotations: Annotation2DCreate[] = [];

      // Interpolate between consecutive keyframes
      for (let i = 0; i < keyframeAnnotations.length - 1; i++) {
        const startKf = keyframeAnnotations[i];
        const endKf = keyframeAnnotations[i + 1];
        const startIdx = startKf.frameIndex;
        const endIdx = endKf.frameIndex;

        // Only interpolate box types for now
        if (startKf.annotation.type !== 'box' || endKf.annotation.type !== 'box') {
          continue;
        }

        const startData = startKf.annotation.data as BoxData;
        const endData = endKf.annotation.data as BoxData;

        // Create interpolated annotations for frames in between
        for (let frameIdx = startIdx + 1; frameIdx < endIdx; frameIdx++) {
          const frame = frames.find(f => f.frame_index === frameIdx);
          if (!frame) continue;

          // Linear interpolation factor
          const t = (frameIdx - startIdx) / (endIdx - startIdx);

          // Interpolate box properties
          const interpolatedData: BoxData = {
            x: startData.x + (endData.x - startData.x) * t,
            y: startData.y + (endData.y - startData.y) * t,
            width: startData.width + (endData.width - startData.width) * t,
            height: startData.height + (endData.height - startData.height) * t,
          };

          const newAnnotation: Annotation2DCreate = {
            task_id: taskId,
            frame_id: frame.id,
            camera_id: selectedCameraId,
            track_id: trackId,
            type: 'box',
            class_id: startKf.annotation.classId,
            taxonomy_id: selectedTaxonomyId,
            data: interpolatedData as unknown as Record<string, unknown>,
            attributes: { interpolated: true },
            source: 'interpolated',
          };

          newInterpolatedAnnotations.push(newAnnotation);
        }
      }

      if (newInterpolatedAnnotations.length === 0) {
        setInterpolateStatus('done');
        setTimeout(() => setInterpolateStatus('idle'), 2000);
        return;
      }

      // Save interpolated annotations to database
      const savedAnnotations = await annotation2DApi.createBulk(newInterpolatedAnnotations);

      // Add to local store
      savedAnnotations.forEach(dbAnn => {
        const storeAnn: Annotation2D = {
          id: dbAnn.id,
          type: dbAnn.type as Annotation2D['type'],
          classId: dbAnn.class_id,
          trackId: dbAnn.track_id,
          frameId: dbAnn.frame_id,
          cameraId: dbAnn.camera_id,
          data: dbAnn.data as unknown as AnnotationData2D,
          attributes: dbAnn.attributes,
          isLocked: false,
          isHidden: false,
          zIndex: annotations.size,
          createdAt: new Date(dbAnn.created_at),
          updatedAt: new Date(dbAnn.updated_at),
        };
        addAnnotation(storeAnn);
      });

      // Update track as interpolated
      if (track) {
        await track2DApi.update(trackId, { is_interpolated: true });
        setTracks(prev => prev.map(t => t.id === trackId ? { ...t, is_interpolated: true } : t));
      }

      console.log(`Created ${savedAnnotations.length} interpolated annotations`);
      setInterpolateStatus('done');
      setTimeout(() => setInterpolateStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to interpolate track:', error);
      setInterpolateStatus('error');
      setTimeout(() => setInterpolateStatus('idle'), 3000);
    }
  }, [taskId, frames, annotations, selectedCameraId, tracks, addAnnotation, selectedTaxonomyId, showLaneToast]);

  // Helper function to update annotation and trigger re-interpolation
  // When an annotation is modified, it becomes a keyframe and triggers re-interpolation
  // Data changes are persisted via updateAnnotationWithSourceTracking
  const updateAnnotationWithReinterpolate = useCallback(async (
    annotationId: string,
    updates: Partial<Annotation2D>
  ) => {
    const annotation = annotations.get(annotationId);
    if (!annotation) return;

    // If this annotation belongs to a track and was interpolated, it becomes a keyframe now
    const wasInterpolated = annotation.attributes?.interpolated;

    // Prepare attributes - remove interpolated flag if it was interpolated
    const newAttributes = wasInterpolated
      ? { ...annotation.attributes, interpolated: undefined }
      : undefined;

    // Update local state and persist to database via updateAnnotationWithSourceTracking
    updateAnnotationWithSourceTracking(annotationId, {
      ...updates,
      ...(newAttributes ? { attributes: newAttributes } : {}),
    });

    // If attributes changed for interpolated annotation, also update attributes in DB
    if (wasInterpolated && newAttributes) {
      try {
        await annotation2DApi.update(annotationId, { attributes: newAttributes });
      } catch (error) {
        console.error('Failed to update attributes in database:', error);
      }
    }

    // If this annotation belongs to a track, re-interpolate
    if (annotation.trackId) {
      // Small delay to let the state update propagate
      setTimeout(() => {
        interpolateTrack(annotation.trackId!, true);
      }, 150);
    }
  }, [annotations, updateAnnotationWithSourceTracking, interpolateTrack]);

  // Propagate track using AI video propagation
  // direction: 'forward' (default) or 'forward_backward' for bidirectional tracking
  const propagateTrack = useCallback(async (
    trackId: string,
    numFrames: number,
    _direction: 'forward' | 'forward_backward' = 'forward',
    _boxDataOverride?: BoxData // Optional: use this box data instead of reading from annotation
  ): Promise<{ firstTrackedFrameId?: string; lastTrackedFrameId?: string }> => {
    if (!taskId || frames.length === 0) {
      console.warn('Cannot propagate: no taskId or frames');
      return {};
    }

    setPropagateStatus('propagating');
    setPropagateError(null);

    try {
      // Get the current annotation for this track on the current frame
      const currentAnnotation = Array.from(annotations.values()).find(
        ann => ann.trackId === trackId && ann.frameId === frameId && ann.cameraId === selectedCameraId
      );

      if (!currentAnnotation) {
        setPropagateError('No annotation found for this track on the current frame');
        setPropagateStatus('error');
        setTimeout(() => setPropagateStatus('idle'), 3000);
        return {};
      }

      // Validate annotation type for propagation
      type SupportedPropagationType = 'box' | 'semantic_segment' | 'polygon' | 'ai_polygon';
      const supportedTypes: SupportedPropagationType[] = ['box', 'semantic_segment', 'polygon', 'ai_polygon'];
      if (!supportedTypes.includes(currentAnnotation.type as any)) {
        setPropagateError('Propagation currently only supports box, polygon, ai_polygon, and semantic_segment annotations');
        setPropagateStatus('error');
        setTimeout(() => setPropagateStatus('idle'), 3000);
        return {};
      }

      // Type assertion - we've validated the type above
      const annotationType = currentAnnotation.type as SupportedPropagationType;

      // Find current frame index
      const currentFrame = frames.find(f => f.id === frameId);
      if (!currentFrame) {
        setPropagateError('Current frame not found');
        setPropagateStatus('error');
        setTimeout(() => setPropagateStatus('idle'), 3000);
        return {};
      }

      const currentFrameIndex = currentFrame.frame_index;

      // Extract bounding box from annotation data
      let boxData: BoxData;
      let originalPolygonPoints: Array<{ x: number; y: number }> = []; // For precise mask propagation
      if (annotationType === 'box') {
        boxData = currentAnnotation.data as BoxData;
      } else if (annotationType === 'semantic_segment' || annotationType === 'polygon' || annotationType === 'ai_polygon') {
        // Extract bounding box from polygon
        // semantic_segment uses 'polygon' property, polygon/ai_polygon use 'points' property
        let polygonPoints: Array<{ x: number; y: number }> = [];

        if (annotationType === 'semantic_segment') {
          const segmentData = currentAnnotation.data as SemanticSegmentData;
          polygonPoints = segmentData.polygon || [];
        } else {
          // polygon or ai_polygon
          const polyData = currentAnnotation.data as PolygonData2D;
          polygonPoints = polyData.points || [];
        }

        if (polygonPoints.length === 0) {
          setPropagateError(`${annotationType} has no polygon points`);
          setPropagateStatus('error');
          setTimeout(() => setPropagateStatus('idle'), 3000);
          return {};
        }

        // Store original polygon for precise mask propagation (preserves details like mirrors)
        originalPolygonPoints = polygonPoints;

        // Calculate bounding box from polygon
        const xs = polygonPoints.map((p: any) => p.x);
        const ys = polygonPoints.map((p: any) => p.y);
        const minX = Math.min(...xs);
        const minY = Math.min(...ys);
        const maxX = Math.max(...xs);
        const maxY = Math.max(...ys);

        boxData = {
          x: minX,
          y: minY,
          width: maxX - minX,
          height: maxY - minY,
        };

        console.log(`[Propagate] Extracted bounding box from ${currentAnnotation.type}: [${minX.toFixed(1)}, ${minY.toFixed(1)}, ${maxX.toFixed(1)}, ${maxY.toFixed(1)}], polygon has ${polygonPoints.length} points`);
      } else {
        setPropagateError('Unsupported annotation type for propagation');
        setPropagateStatus('error');
        setTimeout(() => setPropagateStatus('idle'), 3000);
        return {};
      }

      // Collect frames to propagate to (forward from current frame)
      const framesToPropagate = frames
        .filter(f => f.frame_index > currentFrameIndex && f.frame_index <= currentFrameIndex + numFrames)
        .sort((a, b) => a.frame_index - b.frame_index);

      if (framesToPropagate.length === 0) {
        setPropagateError('No frames available for propagation');
        setPropagateStatus('error');
        setTimeout(() => setPropagateStatus('idle'), 3000);
        return {};
      }

      console.log(`[Propagate] Starting propagation from frame ${currentFrameIndex} for ${framesToPropagate.length} frames`);

      // Check if we have the getFrameImageUrl function
      if (!getFrameImageUrl) {
        setPropagateError('Video propagation not supported: getFrameImageUrl not provided');
        setPropagateStatus('error');
        setTimeout(() => setPropagateStatus('idle'), 3000);
        return {};
      }

      // Prepare video frames for AI Segment
      const videoFrames: { frame_index: number; image_url: string }[] = [];

      // Add current frame first
      const currentImageUrl = getFrameUrlForBackend(frameId, selectedCameraId);
      if (!currentImageUrl) {
        setPropagateError('Cannot get image URL for current frame');
        setPropagateStatus('error');
        setTimeout(() => setPropagateStatus('idle'), 3000);
        return {};
      }

      // Make URL absolute for backend to fetch
      const makeAbsoluteUrl = (url: string) => {
        if (url.startsWith('http://') || url.startsWith('https://')) {
          return url;
        }
        return `${window.location.origin}${url}`;
      };

      videoFrames.push({
        frame_index: 0, // AI expects 0-indexed
        image_url: makeAbsoluteUrl(currentImageUrl),
      });

      // Get image URLs for subsequent frames
      for (let i = 0; i < framesToPropagate.length; i++) {
        const frame = framesToPropagate[i];
        const frameImageUrl = getFrameUrlForBackend(frame.id, selectedCameraId);

        if (!frameImageUrl) {
          console.warn(`[Propagate] Cannot get image URL for frame ${frame.frame_index}, skipping`);
          continue;
        }

        videoFrames.push({
          frame_index: i + 1, // AI expects sequential indices
          image_url: makeAbsoluteUrl(frameImageUrl),
        });
      }

      if (videoFrames.length < 2) {
        setPropagateError('Not enough frames with valid image URLs');
        setPropagateStatus('error');
        setTimeout(() => setPropagateStatus('idle'), 3000);
        return {};
      }

      // Prepare initial object (include polygon for precise mask initialization if available)
      const objectInit: any = {
        object_id: 1,
        box: {
          x1: boxData.x,
          y1: boxData.y,
          x2: boxData.x + boxData.width,
          y2: boxData.y + boxData.height,
        },
        frame_index: 0,
      };

      // Include polygon for precise mask propagation (preserves shape details like car mirrors)
      if (originalPolygonPoints.length >= 3) {
        objectInit.polygon = originalPolygonPoints.map(p => ({ x: p.x, y: p.y }));
        console.log(`[Propagate] Including polygon with ${originalPolygonPoints.length} points for precise mask initialization`);
      }

      const objects = [objectInit];

      console.log(`[Propagate] Calling AI video propagation API for ${videoFrames.length} frames...`);
      const videoStartTime = performance.now();

      // Call AI video propagation
      const result = await aiSegmentApi.propagateVideo({
        frames: videoFrames,
        objects,
        min_confidence: 0.1,
      });

      const videoElapsedMs = performance.now() - videoStartTime;
      console.log(`[Propagate] ⏱️ Video tracking completed in ${videoElapsedMs.toFixed(0)}ms - Got ${result.boxes.length} tracked boxes (${(videoElapsedMs / videoFrames.length).toFixed(0)}ms per frame)`);

      // Check if tracking was lost
      if (result.lost_at_frame !== null) {
        const lostFrame = framesToPropagate[result.lost_at_frame - 1]; // -1 because frame 0 is the keyframe
        setPropagateError(`Tracking lost at frame ${(lostFrame?.frame_index ?? result.lost_at_frame - 1) + 1}. Created ${result.tracked_frames - 1} annotations.`);
        // Continue to save what we got
      }

      // Filter out keyframe (frame_index 0) and get tracked boxes
      const trackedBoxes = result.boxes.filter(box => box.status === 'tracked' && box.frame_index > 0);

      if (trackedBoxes.length === 0) {
        setPropagateError('No frames were successfully tracked');
        setPropagateStatus('error');
        setTimeout(() => setPropagateStatus('idle'), 3000);
        return {};
      }

      // For semantic_segment, polygon, and ai_polygon, run AI Segment segmentation on each tracked box
      const useAISegmentation = annotationType === 'semantic_segment' || annotationType === 'polygon' || annotationType === 'ai_polygon';
      const outputType = annotationType; // Preserve the original annotation type

      console.log(`[Propagate] Processing ${trackedBoxes.length} tracked boxes, outputType: ${outputType}, useAISegmentation: ${useAISegmentation}`);

      // Create annotations for tracked frames
      const newAnnotations: Annotation2DCreate[] = [];

      if (useAISegmentation) {
        // OPTIMIZATION: If SAM2 returned polygon directly, use it without re-segmentation
        // This preserves fine shape details like car mirrors
        const boxesWithPolygon = trackedBoxes.filter(box => box.polygon && box.polygon.length >= 3);
        const boxesNeedingSegmentation = trackedBoxes.filter(box => !box.polygon || box.polygon.length < 3);

        console.log(`[Propagate] ${boxesWithPolygon.length} boxes have polygon, ${boxesNeedingSegmentation.length} need segmentation`);

        // Process boxes that already have polygons (much faster)
        for (const trackedBox of boxesWithPolygon) {
          const targetFrame = framesToPropagate[trackedBox.frame_index - 1];
          if (!targetFrame) continue;

          const existingAnn = Array.from(annotations.values()).find(
            ann => ann.trackId === trackId && ann.frameId === targetFrame.id && ann.cameraId === selectedCameraId
          );

          // Use the polygon returned by SAM2 directly
          let polygonData: SemanticSegmentData | PolygonData2D;
          if (outputType === 'semantic_segment') {
            polygonData = {
              polygon: trackedBox.polygon!.map(p => ({ x: p.x, y: p.y })),
              isClosed: true,
              fillColor: getClassColor(currentAnnotation.classId),
              opacity: 0.6,
              isSmooth: false,
              tension: 0,
            } as SemanticSegmentData;
          } else {
            // PolygonData2D only has points, isClosed, isSmooth, and tension
            polygonData = {
              points: trackedBox.polygon!,
              isClosed: true,
              isSmooth: false,
              tension: 0,
            } as PolygonData2D;
          }

          if (existingAnn) {
            await annotation2DApi.update(existingAnn.id, {
              type: outputType,
              data: polygonData as unknown as Record<string, unknown>,
              attributes: { ...existingAnn.attributes, propagated: true, confidence: trackedBox.confidence },
            });
            updateAnnotationWithSourceTracking(existingAnn.id, {
              type: outputType,
              data: polygonData,
              attributes: { ...existingAnn.attributes, propagated: true, confidence: trackedBox.confidence },
            });
          } else {
            newAnnotations.push({
              task_id: taskId,
              frame_id: targetFrame.id,
              camera_id: selectedCameraId,
              track_id: trackId,
              type: outputType,
              class_id: currentAnnotation.classId,
              taxonomy_id: selectedTaxonomyId,
              data: polygonData as unknown as Record<string, unknown>,
              attributes: { propagated: true, confidence: trackedBox.confidence },
              source: 'auto',
            });
          }
          console.log(`[Propagate] Used SAM2 polygon directly for frame ${trackedBox.frame_index} (${trackedBox.polygon!.length} points)`);
        }

        // Save annotations from SAM2 polygons immediately
        if (newAnnotations.length > 0) {
          console.log(`[Propagate] Saving ${newAnnotations.length} annotations from SAM2 polygons...`);
          const savedAnnotations = await annotation2DApi.createBulk(newAnnotations);
          savedAnnotations.forEach(dbAnn => {
            let reconstructedData: AnnotationData2D;
            if (dbAnn.type === 'semantic_segment') {
              reconstructedData = {
                polygon: Array.isArray((dbAnn.data as any).polygon) ? (dbAnn.data as any).polygon : [],
                isClosed: true,
                fillColor: (dbAnn.data as any).fillColor,
                opacity: (dbAnn.data as any).opacity || 0.6,
                isSmooth: false,
                tension: 0,
              } as SemanticSegmentData;
            } else {
              reconstructedData = {
                points: Array.isArray((dbAnn.data as any).points) ? (dbAnn.data as any).points : [],
                isClosed: true,
                isSmooth: false,
                tension: 0,
              } as PolygonData2D;
            }
            const storeAnn: Annotation2D = {
              id: dbAnn.id,
              type: dbAnn.type as Annotation2D['type'],
              classId: dbAnn.class_id,
              trackId: dbAnn.track_id,
              frameId: dbAnn.frame_id,
              cameraId: dbAnn.camera_id,
              data: reconstructedData,
              attributes: dbAnn.attributes,
              isLocked: false,
              isHidden: false,
              zIndex: annotations.size,
              createdAt: new Date(dbAnn.created_at),
              updatedAt: new Date(dbAnn.updated_at),
              source: 'auto',
            };
            addAnnotation(storeAnn);
          });
          console.log(`[Propagate] Saved ${savedAnnotations.length} SAM2 polygon annotations`);
          // Clear for any remaining processing
          newAnnotations.length = 0;
        }

        // Only process boxes needing segmentation if there are any
        if (boxesNeedingSegmentation.length === 0) {
          console.log('[Propagate] All frames used SAM2 polygons directly, no re-segmentation needed');
        } else {
        // PROGRESSIVE LOADING: Split into batches for immediate UI feedback
        const FIRST_BATCH_SIZE = 5; // Show first 5 frames immediately
        const BATCH_SIZE = 10; // Process remaining frames in batches of 10

        console.log('[Propagate] Preparing batch AI Segment segmentation requests...');

        const aiSegmentRequests: { targetFrame: any; trackedBox: any; request: any }[] = [];

        for (const trackedBox of boxesNeedingSegmentation) {
          const targetFrame = framesToPropagate[trackedBox.frame_index - 1];
          if (!targetFrame) continue;

          const frameImageUrl = getFrameUrlForBackend(targetFrame.id, selectedCameraId);
          if (!frameImageUrl) {
            console.warn(`[Propagate] Cannot get image URL for frame ${targetFrame.frame_index}, skipping`);
            continue;
          }

          const absoluteUrl = frameImageUrl.startsWith('http://') || frameImageUrl.startsWith('https://')
            ? frameImageUrl
            : `${window.location.origin}${frameImageUrl}`;

          aiSegmentRequests.push({
            targetFrame,
            trackedBox,
            request: {
              image_url: absoluteUrl,
              points: [],
              box: {
                x1: trackedBox.box.x1,
                y1: trackedBox.box.y1,
                x2: trackedBox.box.x2,
                y2: trackedBox.box.y2,
              },
              simplify_tolerance: aiSegmentSimplifyTolerance,
            }
          });
        }

        if (aiSegmentRequests.length > 0) {
          // Helper function to process a batch of SAM2 requests
          const processBatch = async (batchRequests: typeof aiSegmentRequests, batchLabel: string) => {
            try {
              console.log(`[Propagate] ${batchLabel}: Processing ${batchRequests.length} frames...`);
              const startTime = performance.now();

              const aiSegmentResponses = await aiSegmentApi.segmentBatch(batchRequests.map(r => r.request));

              const elapsedMs = performance.now() - startTime;
              console.log(`[Propagate] ${batchLabel}: Completed in ${elapsedMs.toFixed(0)}ms (${(elapsedMs / batchRequests.length).toFixed(0)}ms per frame)`);

              // Process results and save immediately
              const batchAnnotations: Annotation2DCreate[] = [];
              const updatePromises: Promise<void>[] = [];

              for (let i = 0; i < batchRequests.length; i++) {
                const { targetFrame, trackedBox } = batchRequests[i];
                const aiSegmentResponse = aiSegmentResponses[i];

                if (!aiSegmentResponse || aiSegmentResponse.masks.length === 0) {
                  console.warn(`[Propagate] No mask returned for frame ${targetFrame.frame_index}, falling back to box`);
                  // Fall back to box annotation
                  const existingAnn = Array.from(annotations.values()).find(
                    ann => ann.trackId === trackId && ann.frameId === targetFrame.id && ann.cameraId === selectedCameraId
                  );

                  const boxData: BoxData = {
                    x: trackedBox.box.x1,
                    y: trackedBox.box.y1,
                    width: trackedBox.box.x2 - trackedBox.box.x1,
                    height: trackedBox.box.y2 - trackedBox.box.y1,
                  };

                  if (existingAnn) {
                    // Queue update without awaiting
                    updatePromises.push(
                      annotation2DApi.update(existingAnn.id, {
                        type: 'box',
                        data: boxData as unknown as Record<string, unknown>,
                        attributes: { ...existingAnn.attributes, propagated: true, confidence: trackedBox.confidence },
                      }).then(() => {
                        updateAnnotationWithSourceTracking(existingAnn.id, {
                          type: 'box',
                          data: boxData,
                          attributes: { ...existingAnn.attributes, propagated: true, confidence: trackedBox.confidence },
                        });
                      })
                    );
                  } else {
                    batchAnnotations.push({
                      task_id: taskId,
                      frame_id: targetFrame.id,
                      camera_id: selectedCameraId,
                      track_id: trackId,
                      type: 'box',
                      class_id: currentAnnotation.classId,
                      data: boxData as unknown as Record<string, unknown>,
                      attributes: { propagated: true, confidence: trackedBox.confidence },
                      source: 'auto',
                    });
                  }
                  continue;
                }

                // Use the best mask
                const mask = aiSegmentResponse.masks[0];

                // Create polygon data structure based on output type
                let polygonData: SemanticSegmentData | PolygonData2D;
                if (outputType === 'semantic_segment') {
                  polygonData = {
                    polygon: mask.polygon.map(p => ({ x: p.x, y: p.y })),
                    isClosed: true,
                    fillColor: getClassColor(currentAnnotation.classId),
                    opacity: 0.6,
                    isSmooth: false,
                    tension: 0,
                  } as SemanticSegmentData;
                } else {
                  // polygon or ai_polygon - use 'points' property
                  polygonData = {
                    points: mask.polygon.map(p => ({ x: p.x, y: p.y })),
                    isClosed: true,
                    isSmooth: false,
                    tension: 0,
                  } as PolygonData2D;
                }

                console.log(`[Propagate] ${batchLabel}: Frame ${targetFrame.frame_index} - ${mask.polygon.length} points, score: ${mask.score.toFixed(3)}`);

                const existingAnn = Array.from(annotations.values()).find(
                  ann => ann.trackId === trackId && ann.frameId === targetFrame.id && ann.cameraId === selectedCameraId
                );

                if (existingAnn) {
                  // Queue update without awaiting
                  updatePromises.push(
                    annotation2DApi.update(existingAnn.id, {
                      type: outputType,
                      data: polygonData as unknown as Record<string, unknown>,
                      attributes: { ...existingAnn.attributes, propagated: true, confidence: trackedBox.confidence },
                    }).then(() => {
                      updateAnnotationWithSourceTracking(existingAnn.id, {
                        type: outputType,
                        data: polygonData,
                        attributes: { ...existingAnn.attributes, propagated: true, confidence: trackedBox.confidence },
                      });
                    })
                  );
                } else {
                  batchAnnotations.push({
                    task_id: taskId,
                    frame_id: targetFrame.id,
                    camera_id: selectedCameraId,
                    track_id: trackId,
                    type: outputType,
                    class_id: currentAnnotation.classId,
                    taxonomy_id: selectedTaxonomyId,
                    data: polygonData as unknown as Record<string, unknown>,
                    attributes: { propagated: true, confidence: trackedBox.confidence },
                    source: 'auto',
                  });
                }
              }

              // Wait for all updates to complete in parallel
              if (updatePromises.length > 0) {
                await Promise.all(updatePromises);
                console.log(`[Propagate] ${batchLabel}: Updated ${updatePromises.length} existing annotations in parallel`);
              }

              // Save batch annotations immediately
              if (batchAnnotations.length > 0) {
                const created = await annotation2DApi.createBulk(batchAnnotations);
                created.forEach(ann => {
                  // Properly reconstruct the data based on type
                  let reconstructedData: AnnotationData2D;
                  if (ann.type === 'semantic_segment') {
                    reconstructedData = {
                      polygon: Array.isArray((ann.data as any).polygon)
                        ? (ann.data as any).polygon
                        : [],
                      isClosed: true,
                      fillColor: (ann.data as any).fillColor,
                      opacity: (ann.data as any).opacity || 0.6,
                      isSmooth: (ann.data as any).isSmooth || false,
                      tension: (ann.data as any).tension || 0,
                    } as SemanticSegmentData;
                  } else if (ann.type === 'polygon' || ann.type === 'ai_polygon') {
                    reconstructedData = {
                      points: Array.isArray((ann.data as any).points)
                        ? (ann.data as any).points
                        : [],
                      isClosed: true,
                      isSmooth: (ann.data as any).isSmooth || false,
                      tension: (ann.data as any).tension || 0,
                    } as PolygonData2D;
                  } else {
                    reconstructedData = ann.data as unknown as AnnotationData2D;
                  }

                  const annotation2D: Annotation2D = {
                    id: ann.id,
                    type: ann.type as Annotation2D['type'],
                    classId: ann.class_id,
                    trackId: ann.track_id,
                    frameId: ann.frame_id,
                    cameraId: ann.camera_id,
                    data: reconstructedData,
                    attributes: ann.attributes,
                    isLocked: false,
                    isHidden: false,
                    zIndex: annotations.size,
                    createdAt: new Date(ann.created_at),
                    updatedAt: new Date(ann.updated_at),
                    source: 'auto',
                  };
                  addAnnotation(annotation2D);
                });
                console.log(`[Propagate] ${batchLabel}: Saved ${batchAnnotations.length} annotations to database`);
              }

              return batchAnnotations.length;
            } catch (error) {
              console.error(`[Propagate] ${batchLabel}: Failed:`, error);
              return 0;
            }
          };

          try {
            // PHASE 1: Process first batch immediately (quick feedback)
            const firstBatch = aiSegmentRequests.slice(0, FIRST_BATCH_SIZE);
            const firstBatchCount = await processBatch(firstBatch, 'First batch');

            console.log(`[Propagate] ✅ First ${firstBatchCount} frames ready! Continuing with remaining ${aiSegmentRequests.length - FIRST_BATCH_SIZE} frames in background...`);

            // PHASE 2: Process remaining frames in batches (background)
            const remainingRequests = aiSegmentRequests.slice(FIRST_BATCH_SIZE);
            let totalProcessed = firstBatchCount;

            for (let i = 0; i < remainingRequests.length; i += BATCH_SIZE) {
              const batch = remainingRequests.slice(i, i + BATCH_SIZE);
              const batchNum = Math.floor(i / BATCH_SIZE) + 2; // +2 because first batch was #1
              const batchCount = await processBatch(batch, `Batch ${batchNum}`);
              totalProcessed += batchCount;

              // Small delay between batches to prevent overwhelming the server
              if (i + BATCH_SIZE < remainingRequests.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
              }
            }

            console.log(`[Propagate] ✅ All done! Processed ${totalProcessed} total frames`);
          } catch (error) {
            console.error(`[Propagate] Progressive loading failed:`, error);
            // Fall back to box annotations
            for (const { targetFrame, trackedBox } of aiSegmentRequests) {
              const boxData: BoxData = {
                x: trackedBox.box.x1,
                y: trackedBox.box.y1,
                width: trackedBox.box.x2 - trackedBox.box.x1,
                height: trackedBox.box.y2 - trackedBox.box.y1,
              };

              const existingAnn = Array.from(annotations.values()).find(
                ann => ann.trackId === trackId && ann.frameId === targetFrame.id && ann.cameraId === selectedCameraId
              );

              if (!existingAnn) {
                newAnnotations.push({
                  task_id: taskId,
                  frame_id: targetFrame.id,
                  camera_id: selectedCameraId,
                  track_id: trackId,
                  type: 'box',
                  class_id: currentAnnotation.classId,
                  data: boxData as unknown as Record<string, unknown>,
                  attributes: { propagated: true, confidence: trackedBox.confidence, ai_segment_error: true },
                  source: 'auto',
                });
              }
            }
          }
        }
        } // End of else block for boxesNeedingSegmentation length check
      } else {
        // Box annotations - use tracked boxes directly (no AI Segment needed)
        for (const trackedBox of trackedBoxes) {
          const targetFrame = framesToPropagate[trackedBox.frame_index - 1];
          if (!targetFrame) continue;

          const existingAnn = Array.from(annotations.values()).find(
            ann => ann.trackId === trackId && ann.frameId === targetFrame.id && ann.cameraId === selectedCameraId
          );

          const annotationData: BoxData = {
            x: trackedBox.box.x1,
            y: trackedBox.box.y1,
            width: trackedBox.box.x2 - trackedBox.box.x1,
            height: trackedBox.box.y2 - trackedBox.box.y1,
          };

          if (existingAnn) {
            try {
              await annotation2DApi.update(existingAnn.id, {
                type: 'box',
                data: annotationData as unknown as Record<string, unknown>,
                attributes: { ...existingAnn.attributes, propagated: true, confidence: trackedBox.confidence },
              });
              updateAnnotationWithSourceTracking(existingAnn.id, {
                type: 'box',
                data: annotationData,
                attributes: { ...existingAnn.attributes, propagated: true, confidence: trackedBox.confidence },
              });
            } catch (error) {
              console.error('Failed to update propagated annotation:', error);
            }
          } else {
            newAnnotations.push({
              task_id: taskId,
              frame_id: targetFrame.id,
              camera_id: selectedCameraId,
              track_id: trackId,
              type: 'box',
              class_id: currentAnnotation.classId,
              taxonomy_id: selectedTaxonomyId,
              data: annotationData as unknown as Record<string, unknown>,
              attributes: { propagated: true, confidence: trackedBox.confidence },
              source: 'auto',
            });
          }
        }
      }

      // Note: For AI segmentation (semantic_segment, polygon, ai_polygon) with progressive loading, annotations are saved in batches
      // Only save newAnnotations if there are any (fallback box annotations)
      if (newAnnotations.length > 0 && !useAISegmentation) {
        const savedAnnotations = await annotation2DApi.createBulk(newAnnotations);

        // Add to local store
        savedAnnotations.forEach(dbAnn => {
          const storeAnn: Annotation2D = {
            id: dbAnn.id,
            type: dbAnn.type as Annotation2D['type'],
            classId: dbAnn.class_id,
            trackId: dbAnn.track_id,
            frameId: dbAnn.frame_id,
            cameraId: dbAnn.camera_id,
            data: dbAnn.data as unknown as AnnotationData2D,
            attributes: dbAnn.attributes,
            isLocked: false,
            isHidden: false,
            zIndex: annotations.size,
            createdAt: new Date(dbAnn.created_at),
            updatedAt: new Date(dbAnn.updated_at),
            source: 'auto',
          };
          addAnnotation(storeAnn);
        });

        console.log(`[Propagate] Created ${savedAnnotations.length} new annotations`);

        // Return the first tracked frame ID for navigation
        if (savedAnnotations.length > 0) {
          return { firstTrackedFrameId: savedAnnotations[0].frame_id };
        }
      }

      setPropagateStatus('done');
      setTimeout(() => {
        setPropagateStatus('idle');
        setShowPropagateDialog(false);
      }, 2000);

      return {};

    } catch (error: any) {
      console.error('Failed to propagate track:', error);
      setPropagateError(error?.message || 'Propagation failed');
      setPropagateStatus('error');
      setTimeout(() => {
        setPropagateStatus('idle');
      }, 5000);
      return {};
    }
  }, [taskId, frames, frameId, annotations, selectedCameraId, getFrameImageUrl, addAnnotation, updateAnnotationWithSourceTracking]);

  // Batch propagate multiple tracks
  const propagateBatch = useCallback(async (trackIds: string[], numFrames: number) => {
    console.log(`[PropagateBatch] Starting batch propagation for ${trackIds.length} tracks`);

    const successfulTracks: string[] = [];
    const failedTracks: { trackId: string; error: string }[] = [];

    setPropagatingTracks(new Set());

    for (const trackId of trackIds) {
      try {
        setPropagatingTracks(prev => new Set([...prev, trackId]));
        await propagateTrack(trackId, numFrames);
        successfulTracks.push(trackId);
        setPropagatingTracks(prev => {
          const next = new Set(prev);
          next.delete(trackId);
          return next;
        });
      } catch (error: any) {
        console.error(`Failed to propagate track ${trackId}:`, error);
        failedTracks.push({ trackId, error: error?.message || 'Unknown error' });
        setPropagatingTracks(prev => {
          const next = new Set(prev);
          next.delete(trackId);
          return next;
        });
      }
    }

    console.log(`[PropagateBatch] Complete: ${successfulTracks.length} successful, ${failedTracks.length} failed`);

    if (failedTracks.length > 0) {
      setPropagateError(`${successfulTracks.length}/${trackIds.length} tracks propagated successfully. ${failedTracks.length} failed.`);
      setPropagateStatus('error');
    } else {
      setPropagateStatus('done');
    }

    // Clear selection after successful batch
    if (successfulTracks.length > 0) {
      setSelectedTrackIds(new Set());
    }

    setTimeout(() => {
      setPropagateStatus('idle');
      setShowPropagateDialog(false);
      setPropagatingTracks(new Set());
    }, 3000);
  }, [propagateTrack]);

  // Run AI tracking for selected boxes (deferred AI track workflow)
  // OPTIMIZED: Bundles ALL tracks into a single AI Segment propagateVideo call
  // instead of making N sequential calls (which each re-download frames and reload models)
  const runAiTrackForSelected = useCallback(async () => {
    // Get track IDs from:
    // 1. Pending AI tracks (newly drawn boxes)
    // 2. Selected annotations that have tracks
    const trackIdsToRun = new Set<string>();

    // Add pending AI track IDs
    pendingAiTrackIds.forEach(id => trackIdsToRun.add(id));

    // Add track IDs from selected annotations
    selectedIds.forEach(annId => {
      const ann = annotations.get(annId);
      if (ann?.trackId) {
        trackIdsToRun.add(ann.trackId);
      }
    });

    if (trackIdsToRun.size === 0) {
      console.warn('[AI Track] No tracks to run - draw boxes with AI Track tool first');
      return;
    }

    console.log(`[AI Track] Running AI tracking for ${trackIdsToRun.size} track(s) in a single batch:`, Array.from(trackIdsToRun));

    // Clear pending tracks - they're about to be processed
    setPendingAiTrackIds(new Set());

    // Calculate max frames available from current frame
    const currentFrame = frames.find(f => f.id === frameId);
    if (!currentFrame) {
      console.warn('[AI Track] No current frame');
      return;
    }

    if (!getFrameImageUrl) {
      console.warn('[AI Track] getFrameImageUrl not available');
      return;
    }

    const makeAbsoluteUrl = (url: string) => {
      if (url.startsWith('http://') || url.startsWith('https://')) return url;
      return `${window.location.origin}${url}`;
    };

    // Collect all valid track annotations & build objectId mapping
    // objectId is a 1-based integer for AI Segment, mapped back to trackId after
    const trackIdToObjectId = new Map<string, number>();
    const objectIdToTrackId = new Map<number, string>();
    const trackAnnotations = new Map<string, { ann: Annotation2D; boxData: BoxData }>();
    let objectCounter = 1;

    for (const trackId of trackIdsToRun) {
      const trackAnn = Array.from(annotations.values()).find(
        ann => ann.trackId === trackId && ann.frameId === frameId && ann.cameraId === selectedCameraId
      );
      if (!trackAnn || trackAnn.type !== 'box') {
        console.warn(`[AI Track] No box annotation found for track ${trackId} on current frame, skipping`);
        continue;
      }
      const objId = objectCounter++;
      trackIdToObjectId.set(trackId, objId);
      objectIdToTrackId.set(objId, trackId);
      trackAnnotations.set(trackId, { ann: trackAnn, boxData: trackAnn.data as BoxData });
    }

    if (trackAnnotations.size === 0) {
      console.warn('[AI Track] No valid box annotations found on current frame');
      return;
    }

    setPropagateStatus('propagating');

    // Helper: save tracked results as annotations
    const saveTrackedResults = async (
      trackedBoxes: Array<{ object_id: number; frame_index: number; box: { x1: number; y1: number; x2: number; y2: number }; confidence: number; status: string }>,
      framesList: typeof frames,
      direction: 'forward' | 'backward',
    ) => {
      const newAnnotations: Annotation2DCreate[] = [];

      for (const trackedBox of trackedBoxes) {
        if (trackedBox.status !== 'tracked' || trackedBox.frame_index === 0) continue;

        const trackId = objectIdToTrackId.get(trackedBox.object_id);
        if (!trackId) continue;

        const trackInfo = trackAnnotations.get(trackId);
        if (!trackInfo) continue;

        const targetFrame = framesList[trackedBox.frame_index - 1]; // -1 because index 0 is keyframe
        if (!targetFrame) continue;

        const existingAnn = Array.from(annotations.values()).find(
          ann => ann.trackId === trackId && ann.frameId === targetFrame.id && ann.cameraId === selectedCameraId
        );

        if (!existingAnn && taskId) {
          newAnnotations.push({
            task_id: taskId,
            frame_id: targetFrame.id,
            camera_id: selectedCameraId,
            track_id: trackId,
            type: 'box',
            class_id: trackInfo.ann.classId,
            taxonomy_id: selectedTaxonomyId,
            data: {
              x: trackedBox.box.x1,
              y: trackedBox.box.y1,
              width: trackedBox.box.x2 - trackedBox.box.x1,
              height: trackedBox.box.y2 - trackedBox.box.y1,
            } as unknown as Record<string, unknown>,
            attributes: { propagated: true, confidence: trackedBox.confidence, direction },
            source: 'auto',
          });
        }
      }

      if (newAnnotations.length > 0) {
        const savedAnnotations = await annotation2DApi.createBulk(newAnnotations);
        savedAnnotations.forEach(dbAnn => {
          addAnnotation({
            id: dbAnn.id,
            type: dbAnn.type as Annotation2D['type'],
            classId: dbAnn.class_id,
            trackId: dbAnn.track_id,
            frameId: dbAnn.frame_id,
            cameraId: dbAnn.camera_id,
            data: dbAnn.data as unknown as AnnotationData2D,
            attributes: dbAnn.attributes,
            isLocked: false,
            isHidden: false,
            zIndex: annotations.size,
            createdAt: new Date(dbAnn.created_at),
            updatedAt: new Date(dbAnn.updated_at),
            source: 'auto',
          });
        });
        console.log(`[AI Track] Created ${savedAnnotations.length} ${direction} annotations across ${trackAnnotations.size} tracks`);
      }

      return newAnnotations.length;
    };

    try {
      // Build SAM2 objects array - all tracks in one call
      const objects = Array.from(trackAnnotations.entries()).map(([trackId, { boxData }]) => ({
        object_id: trackIdToObjectId.get(trackId)!,
        box: {
          x1: boxData.x,
          y1: boxData.y,
          x2: boxData.x + boxData.width,
          y2: boxData.y + boxData.height,
        },
        frame_index: 0,
      }));

      // === FORWARD TRACKING ===
      const forwardFramesList = frames
        .filter(f => f.frame_index > currentFrame.frame_index)
        .sort((a, b) => a.frame_index - b.frame_index);

      if (forwardFramesList.length > 0) {
        const videoFrames: { frame_index: number; image_url: string }[] = [];
        const currentImageUrl = getFrameUrlForBackend(frameId, selectedCameraId);
        if (currentImageUrl) {
          videoFrames.push({ frame_index: 0, image_url: makeAbsoluteUrl(currentImageUrl) });
          for (let i = 0; i < forwardFramesList.length; i++) {
            const frameUrl = getFrameUrlForBackend(forwardFramesList[i].id, selectedCameraId);
            if (frameUrl) {
              videoFrames.push({ frame_index: i + 1, image_url: makeAbsoluteUrl(frameUrl) });
            }
          }
        }

        if (videoFrames.length >= 2) {
          console.log(`[AI Track] Forward: ${objects.length} objects × ${videoFrames.length} frames in 1 API call`);
          const startTime = performance.now();

          const result = await aiSegmentApi.propagateVideo({
            frames: videoFrames,
            objects,
            min_confidence: 0.1,
          });

          console.log(`[AI Track] Forward done in ${(performance.now() - startTime).toFixed(0)}ms`);
          await saveTrackedResults(result.boxes, forwardFramesList, 'forward');
        }
      }

      // === BACKWARD TRACKING ===
      if (aiTrackDirection === 'forward_backward') {
        const backwardFramesList = frames
          .filter(f => f.frame_index < currentFrame.frame_index)
          .sort((a, b) => b.frame_index - a.frame_index);

        if (backwardFramesList.length > 0) {
          const videoFrames: { frame_index: number; image_url: string }[] = [];
          const currentImageUrl = getFrameUrlForBackend(frameId, selectedCameraId);
          if (currentImageUrl) {
            videoFrames.push({ frame_index: 0, image_url: makeAbsoluteUrl(currentImageUrl) });
            for (let i = 0; i < backwardFramesList.length; i++) {
              const frameUrl = getFrameUrlForBackend(backwardFramesList[i].id, selectedCameraId);
              if (frameUrl) {
                videoFrames.push({ frame_index: i + 1, image_url: makeAbsoluteUrl(frameUrl) });
              }
            }
          }

          if (videoFrames.length >= 2) {
            console.log(`[AI Track] Backward: ${objects.length} objects × ${videoFrames.length} frames in 1 API call`);
            const startTime = performance.now();

            const result = await aiSegmentApi.propagateVideo({
              frames: videoFrames,
              objects,
              min_confidence: 0.1,
            });

            console.log(`[AI Track] Backward done in ${(performance.now() - startTime).toFixed(0)}ms`);
            await saveTrackedResults(result.boxes, backwardFramesList, 'backward');
          }
        }
      }

    } catch (error) {
      console.error(`[AI Track] Batch tracking failed:`, error);
    }

    setPropagateStatus('done');
    setTimeout(() => setPropagateStatus('idle'), 3000);

    // Deselect all after tracking
    deselectAll();
  }, [pendingAiTrackIds, selectedIds, annotations, frames, frameId, selectedCameraId, aiTrackDirection, getFrameImageUrl, taskId, addAnnotation, deselectAll]);

  // Load image with decode() for smooth display
  useEffect(() => {
    if (!selectedCameraId) return;

    const url = getImageUrl(selectedCameraId);
    if (!url) return;

    let cancelled = false;

    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = url;

    // Use decode() to ensure image is fully decoded before displaying
    img.onload = async () => {
      if (cancelled) return;

      try {
        // decode() ensures the image is fully decoded into GPU memory
        await img.decode();
      } catch (e) {
        // decode() can fail on some browsers/images, ignore
        console.warn('[Image2D] decode() failed:', e);
      }

      if (!cancelled) {
        setImage(img);
      }
    };

    img.onerror = () => {
      if (cancelled) return;
      console.error('Failed to load image:', url);
    };

    return () => {
      cancelled = true;
    };
  }, [selectedCameraId, frameId, getImageUrl]);

  // Preload adjacent frames for smooth playback (no state updates - just browser cache warming)
  useEffect(() => {
    if (!selectedCameraId || !getFrameImageUrl || frames.length === 0) return;

    const currentIdx = frames.findIndex(f => f.id === frameId);
    if (currentIdx === -1) return;

    // Preload next 5 frames in the background
    const preloadImages: HTMLImageElement[] = [];
    for (let offset = 1; offset <= 5; offset++) {
      const nextIdx = currentIdx + offset;
      if (nextIdx < frames.length) {
        const nextFrame = frames[nextIdx];
        const url = getFrameImageUrl(nextFrame.id, selectedCameraId);
        if (url) {
          const img = new window.Image();
          img.crossOrigin = 'anonymous';
          img.src = url;
          // Use decode() to pre-decode into GPU memory
          img.onload = () => {
            img.decode().catch(() => {}); // Ignore errors
          };
          preloadImages.push(img);
        }
      }
    }

    // Cleanup function - images will stay in browser cache
    return () => {
      preloadImages.length = 0;
    };
  }, [selectedCameraId, frameId, frames, getFrameImageUrl]);

  // Container resize
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Auto-fit image - only when not manually zoomed and not in pending zoom state
  useEffect(() => {
    if (containerSize.width === 0 || containerSize.height === 0) return;

    // Skip auto-fit if:
    // 1. User/QA has manually zoomed
    // 2. There's a pending zoom waiting to be applied
    if (hasManualZoomRef.current || pendingZoom) return;

    const scaleX = containerSize.width / imageSize.width;
    const scaleY = containerSize.height / imageSize.height;
    const fitScale = Math.min(scaleX, scaleY) * 0.95;

    setScale(fitScale);
    setPosition({
      x: (containerSize.width - imageSize.width * fitScale) / 2,
      y: (containerSize.height - imageSize.height * fitScale) / 2,
    });
  }, [imageSize, containerSize, pendingZoom]);

  // AI Track: Trigger propagation when a new box is drawn
  useEffect(() => {
    if (!aiTrackPending || !taskId) return;

    const runAiTrackPropagation = async () => {
      const { trackId, boxData } = aiTrackPending;
      setAiTrackPending(null); // Clear immediately to prevent re-runs

      console.log(`[AI Track] Starting ${aiTrackDirection} propagation for track ${trackId}`);

      // Calculate max frames available
      const currentFrame = frames.find(f => f.id === frameId);
      if (!currentFrame) return;

      const forwardFrames = frames.filter(f => f.frame_index > currentFrame.frame_index).length;
      const backwardFrames = currentFrame.frame_index; // frames before current

      // Track forward
      let firstTrackedFrameId: string | undefined;
      if (forwardFrames > 0) {
        try {
          const result = await propagateTrack(trackId, forwardFrames, 'forward', boxData);
          firstTrackedFrameId = result.firstTrackedFrameId;
        } catch (error) {
          console.error('[AI Track] Forward propagation failed:', error);
        }
      }

      // Track backward if direction is forward_backward and there are frames behind
      if (aiTrackDirection === 'forward_backward' && backwardFrames > 0) {
        console.log(`[AI Track] Now tracking backward for ${backwardFrames} frames`);

        // For backward tracking, we need to create a reversed frame sequence
        // and call the propagation API with those frames
        try {
          // Get backward frames (from current frame going backwards)
          const backwardFramesList = frames
            .filter(f => f.frame_index < currentFrame.frame_index)
            .sort((a, b) => b.frame_index - a.frame_index); // Descending order (closest first)

          if (backwardFramesList.length > 0 && getFrameImageUrl) {
            // Make URL absolute for backend to fetch
            const makeAbsoluteUrl = (url: string) => {
              if (url.startsWith('http://') || url.startsWith('https://')) {
                return url;
              }
              return `${window.location.origin}${url}`;
            };

            // Prepare video frames for backward propagation (current frame + frames going backward)
            const videoFrames: { frame_index: number; image_url: string }[] = [];

            // Add current frame first (as frame_index 0)
            const currentImageUrl = getFrameUrlForBackend(frameId, selectedCameraId);
            if (currentImageUrl) {
              videoFrames.push({
                frame_index: 0,
                image_url: makeAbsoluteUrl(currentImageUrl),
              });

              // Add backward frames in order (closest to farthest from current)
              for (let i = 0; i < backwardFramesList.length; i++) {
                const frame = backwardFramesList[i];
                const frameImageUrl = getFrameUrlForBackend(frame.id, selectedCameraId);
                if (frameImageUrl) {
                  videoFrames.push({
                    frame_index: i + 1, // AI expects sequential indices
                    image_url: makeAbsoluteUrl(frameImageUrl),
                  });
                }
              }

              if (videoFrames.length >= 2) {
                // Prepare initial object with the box
                const objects = [{
                  object_id: 1,
                  box: {
                    x1: boxData.x,
                    y1: boxData.y,
                    x2: boxData.x + boxData.width,
                    y2: boxData.y + boxData.height,
                  },
                  frame_index: 0,
                }];

                console.log(`[AI Track] Calling SAM2 for backward propagation with ${videoFrames.length} frames...`);

                const result = await aiSegmentApi.propagateVideo({
                  frames: videoFrames,
                  objects,
                  min_confidence: 0.1,
                });

                console.log(`[AI Track] Backward tracking: Got ${result.boxes.length} boxes, lost_at_frame: ${result.lost_at_frame}`);

                // Filter out keyframe (frame_index 0) and get tracked boxes
                const trackedBoxes = result.boxes.filter(box => box.status === 'tracked' && box.frame_index > 0);

                // Create annotations for backward tracked frames
                const newBackwardAnnotations: Annotation2DCreate[] = [];

                for (const trackedBox of trackedBoxes) {
                  const targetFrame = backwardFramesList[trackedBox.frame_index - 1];
                  if (!targetFrame) continue;

                  // Don't overwrite existing annotations
                  const existingAnn = Array.from(annotations.values()).find(
                    ann => ann.trackId === trackId && ann.frameId === targetFrame.id && ann.cameraId === selectedCameraId
                  );

                  if (!existingAnn) {
                    const newBoxData: BoxData = {
                      x: trackedBox.box.x1,
                      y: trackedBox.box.y1,
                      width: trackedBox.box.x2 - trackedBox.box.x1,
                      height: trackedBox.box.y2 - trackedBox.box.y1,
                    };

                    newBackwardAnnotations.push({
                      task_id: taskId,
                      frame_id: targetFrame.id,
                      camera_id: selectedCameraId,
                      track_id: trackId,
                      type: 'box',
                      class_id: activeClassId,
                      taxonomy_id: selectedTaxonomyId,
                      data: newBoxData as unknown as Record<string, unknown>,
                      attributes: { propagated: true, confidence: trackedBox.confidence, direction: 'backward' },
                      source: 'auto',
                    });
                  }
                }

                // Save backward annotations
                if (newBackwardAnnotations.length > 0) {
                  const savedAnnotations = await annotation2DApi.createBulk(newBackwardAnnotations);

                  // Add to local store
                  savedAnnotations.forEach(dbAnn => {
                    const storeAnn: Annotation2D = {
                      id: dbAnn.id,
                      type: dbAnn.type as Annotation2D['type'],
                      classId: dbAnn.class_id,
                      trackId: dbAnn.track_id,
                      frameId: dbAnn.frame_id,
                      cameraId: dbAnn.camera_id,
                      data: dbAnn.data as unknown as AnnotationData2D,
                      attributes: dbAnn.attributes,
                      isLocked: false,
                      isHidden: false,
                      zIndex: annotations.size,
                      createdAt: new Date(dbAnn.created_at),
                      updatedAt: new Date(dbAnn.updated_at),
                      source: 'auto',
                    };
                    addAnnotation(storeAnn);
                  });

                  console.log(`[AI Track] Created ${savedAnnotations.length} backward annotations`);

                  // Set first tracked frame for navigation (farthest backward frame)
                  if (savedAnnotations.length > 0 && backwardFramesList.length > 0) {
                    // Find the farthest backward frame that was tracked
                    const farthestBackwardIndex = Math.max(...trackedBoxes.map(b => b.frame_index));
                    firstTrackedFrameId = backwardFramesList[farthestBackwardIndex - 1]?.id;
                  }
                }
              }
            }
          }
        } catch (error) {
          console.error('[AI Track] Backward propagation failed:', error);
        }
      }

      // Navigation: go to first frame where tracking was found
      if (firstTrackedFrameId) {
        // Find the frame with the earliest frame_index that has a tracked annotation
        const allTrackAnnotations = Array.from(annotations.values()).filter(
          ann => ann.trackId === trackId
        );

        if (allTrackAnnotations.length > 0) {
          // Find the frame with smallest frame_index
          let earliestFrameId = frameId;
          let earliestIndex = currentFrame.frame_index;

          for (const ann of allTrackAnnotations) {
            const annFrame = frames.find(f => f.id === ann.frameId);
            if (annFrame && annFrame.frame_index < earliestIndex) {
              earliestIndex = annFrame.frame_index;
              earliestFrameId = ann.frameId;
            }
          }

          // Navigate to earliest frame
          if (earliestFrameId !== frameId) {
            console.log(`[AI Track] Navigating to first tracked frame: ${earliestIndex}`);
            // Trigger frame navigation via URL update or callback
            // The navigation will be handled by finding the right frame index
            const targetFrameIndex = frames.findIndex(f => f.id === earliestFrameId);
            if (targetFrameIndex >= 0) {
              // Update URL to navigate
              const newUrl = new URL(window.location.href);
              newUrl.searchParams.set('frame', targetFrameIndex.toString());
              window.history.pushState({}, '', newUrl.toString());
              window.dispatchEvent(new PopStateEvent('popstate'));
            }
          }
        }
      }

      setPropagateStatus('done');
      setTimeout(() => {
        setPropagateStatus('idle');
      }, 2000);
    };

    runAiTrackPropagation();
  }, [aiTrackPending, taskId, frames, frameId, selectedCameraId, aiTrackDirection, propagateTrack, getFrameImageUrl, annotations, addAnnotation, activeClassId]);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!taskId) {
      console.warn('No taskId provided, cannot save to database');
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
      return;
    }

    setSaveStatus('saving');
    try {
      // Get all annotations for this frame across all cameras
      const annotationsToSave: Annotation2DCreate[] = [];

      annotations.forEach((ann) => {
        if (ann.frameId === frameId) {
          // Convert store annotation to API format
          const apiAnnotation: Annotation2DCreate = {
            id: ann.id, // Keep the UUID from the store
            task_id: taskId,
            frame_id: ann.frameId,
            camera_id: ann.cameraId,
            track_id: ann.trackId, // Include track ID if assigned
            type: ann.type,
            class_id: ann.classId,
            taxonomy_id: selectedTaxonomyId,
            data: ann.data as unknown as Record<string, unknown>,
            attributes: ann.attributes || {},
            source: ann.source || 'manual',
          };
          annotationsToSave.push(apiAnnotation);
        }
      });

      if (annotationsToSave.length === 0) {
        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
        return;
      }

      // Save all annotations to the database
      await annotation2DApi.createBulk(annotationsToSave);

      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (error) {
      console.error('Failed to save:', error);
      setSaveStatus('error');
      setTimeout(() => setSaveStatus('idle'), 3000);
    }
  }, [annotations, frameId, taskId]);

  // Ref to track finishPolygon function for keyboard handler
  const finishPolygonRef = useRef<(() => void) | null>(null);

  // Ref to track last click time for double-click detection
  const lastClickTimeRef = useRef<number>(0);
  const DOUBLE_CLICK_THRESHOLD = 350; // ms - slightly longer for better detection
  const SAME_POINT_THRESHOLD = 5; // Pixels - clicks within this distance are considered same point

  // Refs for state access in keyboard handler (to avoid re-registering)
  const activeToolRef = useRef(activeTool);
  const isDrawingRef = useRef(isDrawing);
  const drawingPointsRef = useRef(drawingPoints);
  const aiSegmentPreviewRef = useRef(aiSegmentPreview);
  const aiSegmentPointsRef = useRef(aiSegmentPoints);
  const taskIdRef = useRef(taskId);
  const handleSaveRef = useRef(handleSave);
  const acceptAiSegmentResultRef = useRef(acceptAiSegmentResult);
  const qaModeRef = useRef(qaMode);
  const runAiTrackForSelectedRef = useRef(runAiTrackForSelected);
  const pendingAiTrackIdsRef = useRef(pendingAiTrackIds);
  const selectedIdsRef = useRef(selectedIds);
  const setShowMergeDialogRef = useRef(setShowMergeDialog);
  // Lane editing refs
  const annotationsRef = useRef(annotations);
  const imageSizeRef = useRef(imageSize);
  // Class selection ref for stable keyboard handler
  const availableClassesRef = useRef(availableClasses);
  // Multi-digit class selection state
  const pendingDigitRef = useRef<string>('');  // accumulated digit string
  const pendingDigitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [pendingDigitDisplay, setPendingDigitDisplay] = useState<string>('');
  const classPickerScrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll class picker to selected class
  useEffect(() => {
    if (!activeClassId || !classPickerScrollRef.current) return;
    const el = classPickerScrollRef.current.querySelector(`[data-classpicker-id="${activeClassId}"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [activeClassId]);

  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  useEffect(() => { availableClassesRef.current = availableClasses; }, [availableClasses]);
  useEffect(() => { isDrawingRef.current = isDrawing; }, [isDrawing]);
  useEffect(() => { drawingPointsRef.current = drawingPoints; }, [drawingPoints]);
  useEffect(() => { aiSegmentPreviewRef.current = aiSegmentPreview; }, [aiSegmentPreview]);
  useEffect(() => { aiSegmentPointsRef.current = aiSegmentPoints; }, [aiSegmentPoints]);
  useEffect(() => { taskIdRef.current = taskId; }, [taskId]);
  useEffect(() => { handleSaveRef.current = handleSave; }, [handleSave]);
  useEffect(() => { acceptAiSegmentResultRef.current = acceptAiSegmentResult; }, [acceptAiSegmentResult]);
  useEffect(() => { qaModeRef.current = qaMode; }, [qaMode]);
  useEffect(() => { runAiTrackForSelectedRef.current = runAiTrackForSelected; }, [runAiTrackForSelected]);
  useEffect(() => { pendingAiTrackIdsRef.current = pendingAiTrackIds; }, [pendingAiTrackIds]);
  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);
  useEffect(() => { setShowMergeDialogRef.current = setShowMergeDialog; }, [setShowMergeDialog]);
  // Lane editing ref updates
  useEffect(() => { annotationsRef.current = annotations; }, [annotations]);
  useEffect(() => { imageSizeRef.current = imageSize; }, [imageSize]);

  // Keyboard shortcuts - stable handler that doesn't re-register
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const tagName = target.tagName.toLowerCase();

      // Ignore if typing in input, select, or textarea
      if (tagName === 'input' || tagName === 'select' || tagName === 'textarea') {
        return;
      }

      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const shift = e.shiftKey;

      // Lane editing shortcuts (only when a polyline is selected)
      if (!ctrl && selectedIdsRef.current.length === 1) {
        const selectedId = selectedIdsRef.current[0];
        const selectedAnn = annotationsRef.current.get(selectedId);
        if (selectedAnn?.type === 'polyline' && !selectedAnn.isLocked) {
          const data = selectedAnn.data as PolylineData2D;
          const vpLineY: number | undefined = undefined;
          const imgWidth = imageSizeRef.current?.width || 1920;

          // S - Smooth lane (PCHIP + Laplacian: monotone x=f(y), visibly smooths jagged corners)
          if (key === 's' && !shift && data.points.length >= 2) {
            e.preventDefault();
            console.log('[SMOOTH-v5] S key pressed. Points:', data.points.length);
            const smoothed = smoothLanePCHIP(data.points as LanePoint2D[], 60, true, 0, 10);
            console.log('[SMOOTH-v5] Result:', smoothed.length, 'pts from', data.points.length);
            useAnnotation2DStore.getState().updateAnnotation(selectedId, { data: { ...data, points: smoothed } });
            return;
          }

          // D - Simplify lane (when not Ctrl for duplicate)
          if (key === 'd' && !shift && data.points.length >= 3) {
            e.preventDefault();
            const simplified = simplifyLaneDouglasPeucker(data.points as LanePoint2D[], 3.0);
            useAnnotation2DStore.getState().updateAnnotation(selectedId, { data: { ...data, points: simplified } });
            return;
          }

          // Shift+V - Snap to VP (V alone is select tool)
          if (key === 'v' && shift && vpLineY !== undefined && data.points.length >= 2) {
            e.preventDefault();
            const snapped = snapLaneToVanishingLine(data.points as LanePoint2D[], vpLineY, imgWidth);
            useAnnotation2DStore.getState().updateAnnotation(selectedId, { data: { ...data, points: snapped } });
            return;
          }

          // Shift+C - Full cleanup (Simplify + Smooth + Snap)
          if (key === 'c' && shift && data.points.length >= 3) {
            e.preventDefault();
            let cleaned = cleanupLane(data.points as LanePoint2D[], 2.0, 0.5);
            if (vpLineY !== undefined) {
              cleaned = snapLaneToVanishingLine(cleaned, vpLineY, imgWidth);
            }
            useAnnotation2DStore.getState().updateAnnotation(selectedId, { data: { ...data, points: cleaned } });
            return;
          }
        }
      }

      // Tab - cycle selection through overlapping lanes (polylines)
      if (key === 'tab' && !ctrl && !shift) {
        const polylines = Array.from(annotationsRef.current.values()).filter(
          a => a.type === 'polyline' && !a.isHidden
        );
        if (polylines.length > 1) {
          e.preventDefault();
          const curId = selectedIdsRef.current[0];
          const ids = polylines.map(a => a.id);
          const curIdx = ids.indexOf(curId);
          const nextIdx = (curIdx + 1) % ids.length;
          useAnnotation2DStore.getState().select(ids[nextIdx]);
          return;
        }
      }

      // F1 to toggle help
      if (e.key === 'F1') {
        e.preventDefault();
        setShowHelp(prev => !prev);
        return;
      }

      // Ctrl+S to save
      if (ctrl && key === 's') {
        e.preventDefault();
        handleSaveRef.current();
        return;
      }

      // Tool shortcuts
      // Tool shortcuts - skip in QA mode to allow QA panel to handle keys
      if (!ctrl && !qaModeRef.current) {
        const toolByKey: Record<string, Tool2D> = {
          'v': 'select',
          'h': 'pan',
          'r': 'box',
          't': 'ai_track',
          // 'o': 'rotated_box',  // Hidden for now
          'e': 'ellipse',
          'p': 'polygon',
          'l': 'polyline',
          'k': 'points',
          'w': 'semantic_segment',
          'm': 'ai_polygon',
        };
        if (toolByKey[key]) {
          setActiveTool(toolByKey[key]);
          return;
        }

        // G key for merge/group - works when 2+ annotations are selected
        if (key === 'g' && selectedIdsRef.current.length >= 2) {
          e.preventDefault();
          setShowMergeDialogRef.current(true);
          return;
        }

        // Number keys for quick class selection (not in QA mode)
        // Multi-digit: press '1' then '1' within 600ms → select class 11
        // Single digit: 1-9 selects classes 1-9, 0 alone selects class 10
        if (/^[0-9]$/.test(key)) {
          e.preventDefault();
          const accumulated = pendingDigitRef.current + key;
          // Clear any existing timer
          if (pendingDigitTimerRef.current) clearTimeout(pendingDigitTimerRef.current);

          const trySelectClass = (digits: string) => {
            const idx = parseInt(digits) - 1; // '1' → 0, '10' → 9, '11' → 10
            const classes = availableClassesRef.current;
            if (idx >= 0 && idx < classes.length) {
              setActiveClass(classes[idx].id);
            }
            pendingDigitRef.current = '';
            setPendingDigitDisplay('');
          };

          // If accumulated is >= 2 digits, commit immediately
          if (accumulated.length >= 2) {
            trySelectClass(accumulated);
          } else {
            // 1 digit so far — wait 600ms to see if another digit follows
            pendingDigitRef.current = accumulated;
            setPendingDigitDisplay(accumulated);
            pendingDigitTimerRef.current = setTimeout(() => {
              // Special case: '0' alone → class 10
              const digits = pendingDigitRef.current === '0' ? '10' : pendingDigitRef.current;
              trySelectClass(digits);
            }, 600);
          }
          return;
        }
      }

      // Ctrl shortcuts
      if (ctrl) {
        switch (key) {
          case 'z':
            e.preventDefault();
            console.log('[2D] Undo triggered, shift:', e.shiftKey);
            if (e.shiftKey) {
              useAnnotation2DStore.getState().redo();
            } else {
              useAnnotation2DStore.getState().undo();
            }
            break;
          case 'y':
            e.preventDefault();
            console.log('[2D] Redo triggered');
            useAnnotation2DStore.getState().redo();
            break;
          case 'c':
            e.preventDefault();
            useAnnotation2DStore.getState().copy();
            break;
          case 'v':
            e.preventDefault();
            useAnnotation2DStore.getState().paste();
            break;
          case 'x':
            e.preventDefault();
            useAnnotation2DStore.getState().cut();
            break;
          case 'd':
            e.preventDefault();
            useAnnotation2DStore.getState().duplicate();
            break;
          case 'a':
            e.preventDefault();
            // Select all visible annotations for this camera
            break;
          case 'f':
            // Ctrl+F: Auto-fit selected polygon (simplify + smooth)
            if (selectedIdsRef.current.length === 1) {
              e.preventDefault();
              const ann = useAnnotation2DStore.getState().annotations.get(selectedIdsRef.current[0]);
              if (ann && ['polygon', 'polyline', 'semantic_segment'].includes(ann.type) && !ann.isLocked) {
                const data = ann.data as any;
                const points = data.polygon || data.points || [];
                if (points.length >= 3) {
                  const simplified = douglasPeucker(points, 1.5);
                  const updateField = data.polygon ? 'polygon' : 'points';
                  useAnnotation2DStore.getState().updateAnnotation(ann.id, {
                    data: { ...data, [updateField]: simplified, isSmooth: true, tension: 0.5 },
                  });
                }
              }
            }
            break;
        }
      }

      // Delete/Backspace - context sensitive
      if (key === 'delete' || key === 'backspace') {
        // While drawing polygon/polyline, backspace undoes last point
        if ((activeToolRef.current === 'polygon' || activeToolRef.current === 'polyline' || activeToolRef.current === 'points') && drawingPointsRef.current.length > 0) {
          e.preventDefault();
          setDrawingPoints(prev => prev.slice(0, -1));
          return;
        }
        // Otherwise delete selected annotations (with DB sync)
        e.preventDefault();

        // Get current state from store
        const store = useAnnotation2DStore.getState();
        const selectedAnnotations = Array.from(store.annotations.values()).filter(ann => store.selectedIds.includes(ann.id));

        if (selectedAnnotations.length === 0) return;

        console.log('[2D] Delete key - deleting', selectedAnnotations.length, 'annotations');

        // Delete from local store (this also updates history)
        store.deleteSelected();

        // Clean up pending AI track IDs (remove track IDs, not annotation IDs)
        setPendingAiTrackIds(prev => {
          const next = new Set(prev);
          selectedAnnotations.forEach(ann => {
            if (ann.trackId) next.delete(ann.trackId);
          });
          return next;
        });

        // Delete from database if we have a taskId (get it from ref)
        const currentTaskId = taskIdRef.current;
        if (currentTaskId) {
          selectedAnnotations.forEach(async (ann) => {
            try {
              await annotation2DApi.delete(ann.id);
            } catch (error: any) {
              if (error?.response?.status !== 404) {
                console.error('Failed to delete annotation from database:', error);
              }
            }
          });
        }
      }

      // Enter - finish polygon/polyline drawing OR accept SAM2 result OR run AI track
      if (key === 'enter') {
        // SAM2 accept has priority if there's a preview
        if ((activeToolRef.current === 'semantic_segment' || activeToolRef.current === 'ai_polygon') && aiSegmentPreviewRef.current) {
          e.preventDefault();
          acceptAiSegmentResultRef.current();
          return;
        }
        // AI Track: Run tracking for pending/selected boxes
        if (activeToolRef.current === 'ai_track' && pendingAiTrackIdsRef.current.size > 0) {
          e.preventDefault();
          runAiTrackForSelectedRef.current();
          return;
        }
        if (drawingPointsRef.current.length >= 2 && finishPolygonRef.current) {
          e.preventDefault();
          finishPolygonRef.current();
        }
      }

      // Escape - cancel drawing or deselect OR clear SAM2, ALWAYS switch to select tool
      if (key === 'escape') {
        e.preventDefault();
        console.log('[2D] Escape triggered, activeTool:', activeToolRef.current);

        // SAM2 clear has priority
        if ((activeToolRef.current === 'semantic_segment' || activeToolRef.current === 'ai_polygon') && (aiSegmentPointsRef.current.length > 0 || aiSegmentPreviewRef.current)) {
          clearAiSegment();
        }

        if (isDrawingRef.current || drawingPointsRef.current.length > 0) {
          // Cancel any ongoing drawing
          setIsDrawing(false);
          setDrawStart(null);
          setDrawCurrent(null);
          setDrawingPoints([]);
        } else {
          deselectAll();
        }

        setActiveTool('select');
      }
    };

    console.log('[2D] Registering keyboard handler');
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      console.log('[2D] Unregistering keyboard handler');
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []); // Empty deps - handler is stable

  // Handle spacebar for temporary panning mode
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept space when typing in input fields or textareas
      const target = e.target as HTMLElement;
      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable) return;

      if (e.code === 'Space' && !e.repeat) {
        // Prevent scrolling when spacebar is pressed
        e.preventDefault();
        setIsSpacePressed(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        setIsSpacePressed(false);
        setIsPanning(false);
      }
    };

    // Global mouseup to catch middle mouse release even outside canvas
    const handleGlobalMouseUp = (e: MouseEvent) => {
      if (e.button === 1) {
        setIsPanning(false);
        setPanStart(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mouseup', handleGlobalMouseUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mouseup', handleGlobalMouseUp);
    };
  }, []);

  // Handle wheel zoom
  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    const scaleBy = 1.1;
    const stage = e.target.getStage();
    if (!stage) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - position.x) / scale,
      y: (pointer.y - position.y) / scale,
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newScale = direction > 0 ? scale * scaleBy : scale / scaleBy;
    const clampedScale = Math.min(Math.max(newScale, 0.1), 10);

    setScale(clampedScale);
    setPosition({
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    });
  }, [scale, position]);

  // Get pointer position in image coordinates
  const getPointerPos = useCallback((e: Konva.KonvaEventObject<MouseEvent>): { x: number; y: number } | null => {
    const stage = e.target.getStage();
    if (!stage) return null;

    const pointer = stage.getPointerPosition();
    if (!pointer) return null;

    return {
      x: (pointer.x - position.x) / scale,
      y: (pointer.y - position.y) / scale,
    };
  }, [position, scale]);

  // Helper: calculate distance between two points
  const distanceBetween = useCallback((p1: { x: number; y: number }, p2: { x: number; y: number }) => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }, []);

  // Mouse down handler
  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = getPointerPos(e);
    if (!pos) return;



    // Middle mouse button starts panning
    if (e.evt.button === 1) {
      e.evt.preventDefault();
      setIsPanning(true);
      setPanStart({ x: e.evt.clientX - position.x, y: e.evt.clientY - position.y });
      return;
    }

    // If spacebar is pressed, let the stage handle dragging
    if (isSpacePressed) {
      return;
    }

    // Check if clicked on background (stage or image element)
    const isBackgroundClick = e.target === e.target.getStage() ||
      (e.target.getClassName && e.target.getClassName() === 'Image');

    // False negative flagging mode - capture click location on image
    if (fnMode && isBackgroundClick) {
      // Only capture clicks on the background image, not on annotations
      setFnLocation({ x: pos.x, y: pos.y });
      setFnModalOpen(true);
      return;
    }

    // Click on stage background - just deselect, no panning (use Space+drag or middle mouse for panning)
    if (e.target === e.target.getStage()) {
      if (activeTool === 'select') {
        deselectAll();
        return;
      }
    }

    // Block all drawing in QA mode
    if (qaMode && activeTool !== 'select' && activeTool !== 'pan') {
      return;
    }

    // AI Segment tools - handle positive/negative clicks
    if (activeTool === 'semantic_segment' || activeTool === 'ai_polygon') {
      e.evt.preventDefault();
      e.evt.stopPropagation();
      const isNegative = e.evt.button === 2 || e.evt.shiftKey; // Right click or shift+click for negative
      handleAiSegmentClick(pos.x, pos.y, isNegative);
      return;
    }

    // Drawing tools
    if (['box', 'rotated_box', 'ellipse', 'ai_track'].includes(activeTool)) {
      setIsDrawing(true);
      setDrawStart(pos);
      setDrawCurrent(pos);
    } else if (['polygon', 'polyline', 'points'].includes(activeTool)) {
      // If we're in the process of finishing, ignore clicks
      if (isFinishingRef.current) {
        return;
      }

      // Right-click to finish drawing (when we have enough points)
      if (e.evt.button === 2) {
        e.evt.preventDefault();
        if ((activeTool === 'polygon' && drawingPoints.length >= 3) ||
            (activeTool === 'polyline' && drawingPoints.length >= 2) ||
            (activeTool === 'points' && drawingPoints.length >= 1)) {
          finishPolygonRef.current?.();
        }
        return;
      }

      const now = Date.now();
      const timeSinceLastClick = now - lastClickTimeRef.current;
      const lastPos = lastClickPosRef.current;

      // Check if this is a repeated click at the same position (double-click second click)
      const isSamePosition = lastPos &&
        Math.abs(pos.x - lastPos.x) < SAME_POINT_THRESHOLD / scale &&
        Math.abs(pos.y - lastPos.y) < SAME_POINT_THRESHOLD / scale;

      // Skip if this looks like a double-click (same position, short time)
      if (timeSinceLastClick < DOUBLE_CLICK_THRESHOLD && isSamePosition && drawingPoints.length > 0) {
        return;
      }

      // Update click tracking
      lastClickTimeRef.current = now;
      lastClickPosRef.current = { x: pos.x, y: pos.y, time: now };

      // For polygon: Check if clicking near the first point to close the shape (magnetic snap)
      if (activeTool === 'polygon' && drawingPoints.length >= 3) {
        const firstPoint = drawingPoints[0];
        // Use screen-space distance for consistent snap behavior regardless of zoom
        const screenDist = distanceBetween(pos, firstPoint) * scale;

        if (screenDist < SNAP_THRESHOLD) {
          // Close the polygon - don't add new point, just finish
          isFinishingRef.current = true;
          finishPolygonRef.current?.();
          // Reset after a short delay to allow finish to complete
          setTimeout(() => { isFinishingRef.current = false; }, 100);
          return;
        }
      }

      // Add the new point
      setDrawingPoints([...drawingPoints, pos]);
    }
  }, [activeTool, getPointerPos, deselectAll, drawingPoints, handleAiSegmentClick, distanceBetween, scale, SNAP_THRESHOLD, qaMode]);

  // Mouse move handler - enhanced with polygon preview and snap detection
  const handleMouseMove = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = getPointerPos(e);
    if (!pos) {
      setCursorPosition(null);
      return;
    }

    // Update cursor position for display
    setCursorPosition(pos);

    // Handle middle mouse button panning
    if (isPanning && panStart) {
      const newX = e.evt.clientX - panStart.x;
      const newY = e.evt.clientY - panStart.y;
      setPosition({ x: newX, y: newY });
      return;
    }

    // Track mouse position for polygon preview line
    setMousePos(pos);

    if (isDrawing) {
      setDrawCurrent(pos);
    }

    // Check if near first point for polygon close snap (use screen-space distance)
    if (activeTool === 'polygon' && drawingPoints.length >= 3) {
      const firstPoint = drawingPoints[0];
      const screenDist = distanceBetween(pos, firstPoint) * scale;
      setIsNearFirstPoint(screenDist < SNAP_THRESHOLD);
    } else {
      setIsNearFirstPoint(false);
    }

    // Check if hovering over any existing point (screen-space)
    if ((activeTool === 'polygon' || activeTool === 'polyline') && drawingPoints.length > 0) {
      let foundHover: number | null = null;
      for (let i = 0; i < drawingPoints.length; i++) {
        const screenDist = distanceBetween(pos, drawingPoints[i]) * scale;
        if (screenDist < POINT_HOVER_THRESHOLD) {
          foundHover = i;
          break;
        }
      }
      setHoveredPointIndex(foundHover);
    }
  }, [getPointerPos, isDrawing, activeTool, drawingPoints, distanceBetween, scale, SNAP_THRESHOLD, POINT_HOVER_THRESHOLD, isPanning, panStart]);

  // Helper to create annotation, optionally creating track first if pending
  // Also saves to database if taskId is available
  const createAnnotationWithTrack = useCallback(async (
    type: Annotation2D['type'],
    data: AnnotationData2D,
    opts?: { source?: string; attributes?: Record<string, unknown> }
  ) => {
    const source = opts?.source ?? 'manual';
    const attributes = opts?.attributes ?? {};
    let trackId: string | undefined = undefined;
    let wasAutoTrackCreated = false;

    // Only use a track if:
    // 1. User explicitly clicked "New Track" (pendingNewTrack is true), OR
    // 2. User explicitly selected/activated an existing track (activeTrackId is set)

    // If we're in "pending new track" mode, create the track first
    if (pendingNewTrack) {
      const newTrack = await createTrackWithAnnotation();
      if (newTrack) {
        trackId = newTrack.id;
        wasAutoTrackCreated = true;
      }
    } else if (activeTrackId) {
      // User has explicitly selected an existing track
      trackId = activeTrackId;
    }
    // Otherwise trackId stays undefined - annotation created without track

    // If we have a taskId, save to database AND add to store
    if (taskId) {
      try {
        const createData: Annotation2DCreate = {
          task_id: taskId,
          frame_id: frameId,
          camera_id: selectedCameraId,
          track_id: trackId,
          type,
          class_id: activeClassId,
          taxonomy_id: selectedTaxonomyId,
          data: data as unknown as Record<string, unknown>,
          attributes,
          source,
        };

        const response = await annotation2DApi.create(createData);

        // Add database response to store (use the DB-generated ID)
        addAnnotation({
          id: response.id,
          type: response.type as Annotation2D['type'],
          classId: response.class_id,
          trackId: response.track_id,
          frameId: response.frame_id,
          cameraId: response.camera_id,
          data: response.data as unknown as AnnotationData2D,
          attributes: response.attributes,
          isLocked: false,
          isHidden: false,
          zIndex: annotations.size + 1,
          createdAt: new Date(response.created_at),
          updatedAt: new Date(response.updated_at),
        });

        // Clear activeTrackId after creating annotation from "New Track" mode
        // This ensures each new annotation gets its own track
        if (wasAutoTrackCreated) {
          setActiveTrackId(null);
        }
      } catch (error) {
        console.error('Failed to save annotation to database:', error);
        // Fall back to local-only creation
        createAnnotation({
          type,
          classId: activeClassId,
          trackId,
          frameId,
          cameraId: selectedCameraId,
          data,
          attributes,
          isLocked: false,
          isHidden: false,
          source,
        });

        // Clear activeTrackId even on error
        if (wasAutoTrackCreated) {
          setActiveTrackId(null);
        }
      }
    } else {
      // No taskId - create locally only
      createAnnotation({
        type,
        classId: activeClassId,
        trackId,
        frameId,
        cameraId: selectedCameraId,
        data,
        attributes,
        isLocked: false,
        isHidden: false,
        source,
      });

      // Clear activeTrackId after local creation too
      if (wasAutoTrackCreated) {
        setActiveTrackId(null);
      }
    }
  }, [taskId, pendingNewTrack, activeTrackId, activeClassId, frameId, selectedCameraId, createAnnotation, addAnnotation, annotations.size, createTrackWithAnnotation]);

  // Mouse up handler
  const handleMouseUp = useCallback(async (_e?: Konva.KonvaEventObject<MouseEvent>) => {
    // Handle middle mouse button panning release
    if (isPanning && panStart) {
      setIsPanning(false);
      setPanStart(null);
      return;
    }

    if (!isDrawing || !drawStart || !drawCurrent) return;

    const width = Math.abs(drawCurrent.x - drawStart.x);
    const height = Math.abs(drawCurrent.y - drawStart.y);

    if (width < 5 || height < 5) {
      setIsDrawing(false);
      setDrawStart(null);
      setDrawCurrent(null);
      return;
    }

    // Clear drawing state immediately for responsive UI
    setIsDrawing(false);
    setDrawStart(null);
    setDrawCurrent(null);

    if (activeTool === 'box') {
      const data: BoxData = {
        x: Math.min(drawStart.x, drawCurrent.x),
        y: Math.min(drawStart.y, drawCurrent.y),
        width,
        height,
      };
      // Don't await - let it run in background
      createAnnotationWithTrack('box', data);
    } else if (activeTool === 'ai_track') {
      // AI Track: Create box with new track and auto-propagate
      const data: BoxData = {
        x: Math.min(drawStart.x, drawCurrent.x),
        y: Math.min(drawStart.y, drawCurrent.y),
        width,
        height,
      };

      // Create track and annotation
      if (taskId) {
        try {
          // Create a new track
          const trackData = await track2DApi.create({
            task_id: taskId,
            camera_id: selectedCameraId,
            class_id: activeClassId,
            // name omitted — backend defaults to "<class>_<track-id>"
          });

          // Create the annotation with the track
          const createData: Annotation2DCreate = {
            task_id: taskId,
            frame_id: frameId,
            camera_id: selectedCameraId,
            track_id: trackData.id,
            type: 'box',
            class_id: activeClassId,
            taxonomy_id: selectedTaxonomyId,
            data: data as unknown as Record<string, unknown>,
            attributes: {},
            source: 'manual',
          };

          const response = await annotation2DApi.create(createData);

          // Add to local store
          addAnnotation({
            id: response.id,
            type: 'box',
            classId: response.class_id,
            trackId: response.track_id,
            frameId: response.frame_id,
            cameraId: response.camera_id,
            data: response.data as unknown as AnnotationData2D,
            attributes: response.attributes,
            isLocked: false,
            isHidden: false,
            zIndex: annotations.size + 1,
            createdAt: new Date(response.created_at),
            updatedAt: new Date(response.updated_at),
          });

          // Refresh tracks list
          const updatedTracks = await track2DApi.list(taskId, selectedCameraId);
          setTracks(updatedTracks);

          // Add to pending AI tracks - user can adjust the box and then run tracking
          setPendingAiTrackIds(prev => new Set([...prev, trackData.id]));

          // Select the annotation so user can adjust it
          deselectAll();
          select(response.id);

        } catch (error) {
          console.error('Failed to create AI Track annotation:', error);
        }
      }
    } else if (activeTool === 'rotated_box') {
      const data: RotatedBoxData = {
        cx: (drawStart.x + drawCurrent.x) / 2,
        cy: (drawStart.y + drawCurrent.y) / 2,
        width,
        height,
        rotation: 0,
      };
      createAnnotationWithTrack('rotated_box', data);
    } else if (activeTool === 'ellipse') {
      const data: EllipseData = {
        cx: (drawStart.x + drawCurrent.x) / 2,
        cy: (drawStart.y + drawCurrent.y) / 2,
        rx: width / 2,
        ry: height / 2,
      };
      createAnnotationWithTrack('ellipse', data);
    }
  }, [isDrawing, drawStart, drawCurrent, activeTool, createAnnotationWithTrack, isPanning, panStart]);

  // Finish polygon/polyline drawing
  const finishPolygon = useCallback(async () => {
    // Prevent multiple finish calls
    if (isFinishingRef.current) {
      return;
    }

    if (drawingPoints.length < 2) {
      setDrawingPoints([]);
      isFinishingRef.current = false;
      return;
    }

    isFinishingRef.current = true;

    try {
      if (activeTool === 'polygon' && drawingPoints.length >= 3) {
        const data: PolygonData2D = {
          points: drawingPoints,
          isClosed: true,
          isSmooth: smoothPolygon,
          tension: splineTension,
        };
        await createAnnotationWithTrack('polygon', data);
      } else if (activeTool === 'polyline' && drawingPoints.length >= 2) {
        // Ensure at least 4 control points for meaningful editing & smoothing
        const expandedPts = ensureMinLanePoints(drawingPoints as LanePoint2D[], 4);
        const data: PolylineData2D = {
          points: expandedPts,
          isBezier: smoothPolygon,
        };
        await createAnnotationWithTrack('polyline', data);
      } else if (activeTool === 'points' && drawingPoints.length >= 1) {
        const data: PointsData = {
          points: drawingPoints.map((p) => ({ x: p.x, y: p.y })),
        };
        await createAnnotationWithTrack('points', data);
      }
    } finally {
      // Always cleanup drawing state
      setDrawingPoints([]);
      setMousePos(null);
      setIsNearFirstPoint(false);
      setHoveredPointIndex(null);
      lastClickPosRef.current = null;
      // Small delay before allowing new drawings
      setTimeout(() => { isFinishingRef.current = false; }, 50);
    }
  }, [drawingPoints, activeTool, createAnnotationWithTrack, smoothPolygon, splineTension,
      taskId, frames, selectedCameraId, activeClassId, selectedTaxonomyId, addAnnotation]);

  // Update ref for keyboard handler
  useEffect(() => {
    finishPolygonRef.current = finishPolygon;
  }, [finishPolygon]);

  // Fit image to window - also resets manual zoom flag
  const fitToWindow = useCallback(() => {
    if (!imageSize.width || !imageSize.height || !containerSize.width || !containerSize.height) {
      return;
    }

    const scaleX = containerSize.width / imageSize.width;
    const scaleY = containerSize.height / imageSize.height;
    const fitScale = Math.min(scaleX, scaleY) * 0.95; // 95% to leave some padding

    // Reset manual zoom flag so auto-fit can work again if needed
    hasManualZoomRef.current = false;

    setScale(fitScale);
    setPosition({
      x: (containerSize.width - imageSize.width * fitScale) / 2,
      y: (containerSize.height - imageSize.height * fitScale) / 2,
    });
  }, [imageSize, containerSize]);

  // Double-click handler - fit to window or finish drawing
  const handleDoubleClick = useCallback(() => {
    // If actively drawing, finish the drawing
    if (['polygon', 'polyline', 'points'].includes(activeTool) && drawingPoints.length > 0) {
      // Check minimum point requirements
      if (activeTool === 'polygon' && drawingPoints.length < 3) {
        return;
      }
      if (activeTool === 'polyline' && drawingPoints.length < 2) {
        return;
      }
      if (activeTool === 'points' && drawingPoints.length < 1) {
        return;
      }

      finishPolygon();
    } else {
      // Otherwise, fit image to window
      fitToWindow();
    }
  }, [activeTool, drawingPoints.length, finishPolygon, fitToWindow]);

  // Keep lane/polyline editing focused: prevent accidental selection switch
  // to a NON-polyline annotation while a single polyline is currently selected.
  // Switching between polylines (lanes) is always allowed.
  const canSwitchSelection = useCallback((targetAnnotationId: string) => {
    if (activeTool !== 'select') return true;
    if (selectedIds.length !== 1) return true;

    const selectedId = selectedIds[0];
    if (selectedId === targetAnnotationId) return true;

    const selectedAnnotation = annotations.get(selectedId);
    if (!selectedAnnotation || selectedAnnotation.isLocked) return true;

    // If the selected annotation is NOT a polyline, always allow switching
    if (selectedAnnotation.type !== 'polyline') return true;

    // If the selected annotation IS a polyline, allow switching to other polylines
    const targetAnnotation = annotations.get(targetAnnotationId);
    if (targetAnnotation?.type === 'polyline') return true;

    // Block switching from a polyline to a non-polyline
    return false;
  }, [activeTool, selectedIds, annotations]);

  // DOM refs for each track row in the Tracks panel, so a canvas click can
  // scroll the matching row into view.
  const trackRowRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  // When a tracked annotation (e.g. a tracked lane) is clicked on the canvas,
  // surface and highlight its track in the right-hand panel: switch to the
  // Tracks tab, mark the track active, and scroll its row into view.
  const highlightTrackForAnnotation = useCallback((ann: Annotation2D) => {
    if (!ann.trackId) return;
    const trackId = ann.trackId;
    setActiveTrackId(trackId);
    // Don't yank the user out of the QA "Fixes" workflow in revision mode.
    if (!(isRevisionMode && rightPanelTab === 'fixes')) {
      setRightPanelTab('tracks');
    }
    requestAnimationFrame(() => {
      trackRowRefs.current.get(trackId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  }, [isRevisionMode, rightPanelTab]);

  // Render annotation shape
  const renderAnnotation = useCallback((ann: Annotation2D) => {

    const isSelected = selectedIds.includes(ann.id);
    const isHovered = hoveredId === ann.id;
    const color = getAnnotationColor(ann);
    const isTracked = !!ann.trackId;
    const isLaneCreationMode = activeTool === 'polyline';
    // Tracked annotations get dashed border, cyan accent for track identification
    const strokeWidth = isSelected ? 2.25 : isHovered ? 1.875 : 1.5;
    const strokeDash = isTracked ? [8, 4] : undefined; // Dashed line for tracked annotations
    const opacity = ann.isLocked ? 0.5 : 1;

    const commonProps = {
      onClick: () => {
        if (isLaneCreationMode) return;
        if (!ann.isLocked) {
          if (!canSwitchSelection(ann.id)) return;
          select(ann.id);
          // Expand properties for the clicked annotation (not in QA mode)
          if (!qaMode) {
            setExpandedPanelId(ann.id);
          }
          // Highlight the matching track in the Tracks panel for tracked annotations.
          highlightTrackForAnnotation(ann);
        }
      },
      onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
        if (isLaneCreationMode) return;
        // Prevent event from bubbling to stage
        e.cancelBubble = true;
        // Select on mousedown so dragging works immediately
        if (!ann.isLocked) {
          if (!canSwitchSelection(ann.id)) return;
          select(ann.id);
          // Expand properties for the clicked annotation (not in QA mode)
          if (!qaMode) {
            setExpandedPanelId(ann.id);
          }
          // Highlight the matching track in the Tracks panel for tracked annotations.
          highlightTrackForAnnotation(ann);
        }
      },
      onMouseEnter: () => setHovered(ann.id),
      onMouseLeave: () => setHovered(null),
      opacity,
      listening: !isLaneCreationMode,
    };

    switch (ann.type) {
      case 'box':
      case 'box2d': {
        // Handle both flat structure {x, y, width, height} and nested {bbox: {x, y, width, height}}
        const rawData = ann.data as any;
        const data: BoxData = rawData.bbox ? rawData.bbox : rawData;

        // Keep handles/labels a constant on-screen size regardless of zoom.
        // Shapes are drawn inside a Stage scaled by `scale`, so dividing a
        // desired pixel size by `scale` yields a constant screen size.
        const px = (screenPx: number) => screenPx / scale;
        const handleSize = px(8);
        const handleStroke = px(1);
        // Track-name label sizing
        const labelFont = px(11);
        const labelHeight = px(15);
        const labelPad = px(2);
        const labelOffsetY = px(17);
        // Keyframe/interpolated/propagated badge sizing
        const badgeSize = px(16);
        const badgeFont = px(11);
        const badgeStroke = px(1);
        const badgeMargin = px(4);

        // Resize handle positions
        const handles = isSelected && !ann.isLocked ? [
          { cursor: 'nw-resize', x: data.x, y: data.y, anchor: 'nw' },
          { cursor: 'ne-resize', x: data.x + data.width, y: data.y, anchor: 'ne' },
          { cursor: 'sw-resize', x: data.x, y: data.y + data.height, anchor: 'sw' },
          { cursor: 'se-resize', x: data.x + data.width, y: data.y + data.height, anchor: 'se' },
          { cursor: 'n-resize', x: data.x + data.width / 2, y: data.y, anchor: 'n' },
          { cursor: 's-resize', x: data.x + data.width / 2, y: data.y + data.height, anchor: 's' },
          { cursor: 'w-resize', x: data.x, y: data.y + data.height / 2, anchor: 'w' },
          { cursor: 'e-resize', x: data.x + data.width, y: data.y + data.height / 2, anchor: 'e' },
        ] : [];

        return (
          <Group key={ann.id} {...commonProps}>
            <Rect
              x={data.x}
              y={data.y}
              width={data.width}
              height={data.height}
              stroke={isTracked ? '#22d3ee' : color}
              strokeWidth={strokeWidth}
              dash={strokeDash}
              fill={isSelected ? `${color}20` : isTracked ? `${color}10` : undefined}
              draggable={!ann.isLocked}
              onDragEnd={(e) => {
                const node = e.target;
                const newX = node.x();
                const newY = node.y();
                // Reset node position to 0,0 since we store absolute coords in data
                node.position({ x: data.x, y: data.y });
                updateAnnotationWithReinterpolate(ann.id, {
                  data: {
                    ...data,
                    x: newX,
                    y: newY,
                  },
                });
              }}
            />
            {/* Track Name Label - compact name with class-colored background */}
            {ann.trackId && (() => {
              const track = tracks.find(t => t.id === ann.trackId);
              const trackName = track?.name || '';

              return trackName ? (
                <Group x={data.x} y={data.y - labelOffsetY}>
                  <Rect
                    width={Math.max(labelFont * 4, trackName.length * labelFont * 0.62 + labelFont)}
                    height={labelHeight}
                    fill={color}
                    opacity={0.85}
                    cornerRadius={px(2)}
                  />
                  <Text
                    text={trackName}
                    fontSize={labelFont}
                    fill="white"
                    padding={labelPad}
                    fontStyle="bold"
                  />
                </Group>
              ) : null;
            })()}
            {/* Keyframe indicator - shows K for keyframe, I for interpolated, P for propagated */}
            {isTracked && (
              <Group x={data.x + data.width - badgeSize - badgeMargin} y={data.y + badgeMargin}>
                <Rect
                  width={badgeSize}
                  height={badgeSize}
                  fill={ann.attributes?.interpolated ? 'rgba(249, 115, 22, 0.9)' : ann.attributes?.propagated ? 'rgba(6, 182, 212, 0.9)' : 'rgba(34, 197, 94, 0.9)'}
                  cornerRadius={px(3)}
                  stroke="white"
                  strokeWidth={badgeStroke}
                />
                <Text
                  width={badgeSize}
                  height={badgeSize}
                  text={ann.attributes?.interpolated ? 'I' : ann.attributes?.propagated ? 'P' : 'K'}
                  fill="white"
                  fontSize={badgeFont}
                  fontStyle="bold"
                  align="center"
                  verticalAlign="middle"
                />
              </Group>
            )}

            {/* Resize handles */}
            {handles.map((handle) => (
              <Rect
                key={handle.anchor}
                x={handle.x - handleSize / 2}
                y={handle.y - handleSize / 2}
                width={handleSize}
                height={handleSize}
                fill="white"
                stroke={color}
                strokeWidth={handleStroke}
                hitStrokeWidth={px(12)}
                draggable
                onDragEnd={(e) => {
                  const node = e.target;
                  const newHandleX = node.x() + handleSize / 2;
                  const newHandleY = node.y() + handleSize / 2;

                  let newData = { ...data };

                  // Calculate new box dimensions based on which handle was dragged
                  switch (handle.anchor) {
                    case 'nw':
                      newData = {
                        x: newHandleX,
                        y: newHandleY,
                        width: data.x + data.width - newHandleX,
                        height: data.y + data.height - newHandleY,
                      };
                      break;
                    case 'ne':
                      newData = {
                        x: data.x,
                        y: newHandleY,
                        width: newHandleX - data.x,
                        height: data.y + data.height - newHandleY,
                      };
                      break;
                    case 'sw':
                      newData = {
                        x: newHandleX,
                        y: data.y,
                        width: data.x + data.width - newHandleX,
                        height: newHandleY - data.y,
                      };
                      break;
                    case 'se':
                      newData = {
                        x: data.x,
                        y: data.y,
                        width: newHandleX - data.x,
                        height: newHandleY - data.y,
                      };
                      break;
                    case 'n':
                      newData = {
                        ...data,
                        y: newHandleY,
                        height: data.y + data.height - newHandleY,
                      };
                      break;
                    case 's':
                      newData = {
                        ...data,
                        height: newHandleY - data.y,
                      };
                      break;
                    case 'w':
                      newData = {
                        ...data,
                        x: newHandleX,
                        width: data.x + data.width - newHandleX,
                      };
                      break;
                    case 'e':
                      newData = {
                        ...data,
                        width: newHandleX - data.x,
                      };
                      break;
                  }

                  // Ensure positive dimensions
                  if (newData.width > 0 && newData.height > 0) {
                    updateAnnotationWithReinterpolate(ann.id, { data: newData });
                  }
                }}
              />
            ))}
          </Group>
        );
      }

      case 'ellipse': {
        const data = ann.data as EllipseData;
        const px = (screenPx: number) => screenPx / scale;
        const handleSize = px(8);
        const handleStroke = px(1);

        // Resize handles for ellipse (4 cardinal points)
        const ellipseHandles = isSelected && !ann.isLocked ? [
          { x: data.cx, y: data.cy - data.ry, dir: 'n' },
          { x: data.cx, y: data.cy + data.ry, dir: 's' },
          { x: data.cx - data.rx, y: data.cy, dir: 'w' },
          { x: data.cx + data.rx, y: data.cy, dir: 'e' },
        ] : [];

        return (
          <Group key={ann.id} {...commonProps}>
            <Ellipse
              x={data.cx}
              y={data.cy}
              radiusX={data.rx}
              radiusY={data.ry}
              rotation={data.rotation || 0}
              stroke={isTracked ? '#22d3ee' : color}
              strokeWidth={strokeWidth}
              dash={strokeDash}
              fill={isSelected ? `${color}20` : isTracked ? `${color}10` : undefined}
              draggable={!ann.isLocked}
              onDragEnd={(e) => {
                const node = e.target;
                const newCx = node.x();
                const newCy = node.y();
                node.position({ x: data.cx, y: data.cy });
                updateAnnotationWithSourceTracking(ann.id, {
                  data: {
                    ...data,
                    cx: newCx,
                    cy: newCy,
                  },
                });
              }}
            />
            {/* Annotation labels removed - shown in properties panel instead */}
            {/* Resize handles for ellipse */}
            {ellipseHandles.map((handle) => (
              <Circle
                key={handle.dir}
                x={handle.x}
                y={handle.y}
                radius={handleSize / 2}
                fill="white"
                stroke={color}
                strokeWidth={handleStroke}
                hitStrokeWidth={px(12)}
                draggable
                onDragEnd={(e) => {
                  const node = e.target;
                  const newX = node.x();
                  const newY = node.y();

                  let newRx = data.rx;
                  let newRy = data.ry;

                  if (handle.dir === 'n' || handle.dir === 's') {
                    newRy = Math.abs(newY - data.cy);
                  } else {
                    newRx = Math.abs(newX - data.cx);
                  }

                  if (newRx > 5 && newRy > 5) {
                    updateAnnotationWithSourceTracking(ann.id, {
                      data: { ...data, rx: newRx, ry: newRy },
                    });
                  }
                }}
              />
            ))}
          </Group>
        );
      }

      case 'polygon': {
        const data = ann.data as PolygonData2D;
        const px = (screenPx: number) => screenPx / scale;
        const cpRadius = px(3);
        const cpHoverRadius = px(5);
        const cpHitStroke = px(14);
        const midRadius = px(4);
        const midHoverRadius = px(6);
        const midStroke = px(1);

        // Safety check for polygon data
        if (!data || !data.points || !Array.isArray(data.points) || data.points.length < 3) {
          console.warn('[renderAnnotation] Invalid polygon data:', { id: ann.id, data });
          return null;
        }

        // Check point format - points could be {x, y} objects or [x, y] arrays
        const firstPoint = data.points[0];
        const isArrayFormat = Array.isArray(firstPoint);

        // Apply Douglas-Peucker simplification when selected and has many points for better performance
        const displayPoints = isSelected && data.points.length > 50
          ? douglasPeucker(data.points, 2.5)  // Simplify to ~20-50 editable points
          : data.points;

        // Use spline interpolation if smooth mode is enabled (only for viewing, not editing)
        // Handle both {x, y} and [x, y] formats
        let linePoints: number[];
        if (!isSelected && data.isSmooth && data.points.length >= 3) {
          linePoints = getCatmullRomSpline(data.points, data.tension || 0.5, true);
        } else if (isArrayFormat) {
          // Handle [x, y] array format
          linePoints = (data.points as any[]).flatMap(p => [p[0], p[1]]);
        } else {
          // Handle {x, y} object format
          linePoints = (data.points as {x: number, y: number}[]).flatMap(p => [p.x, p.y]);
        }

        return (
          <Group key={ann.id} {...commonProps}>
            <Line
              points={linePoints}
              stroke={isTracked ? '#22d3ee' : (color || '#ff0000')}
              strokeWidth={strokeWidth || 2}
              dash={strokeDash}
              fill={`${color || '#ff0000'}40`}
              closed={true}
              lineCap="round"
              lineJoin="round"
              hitStrokeWidth={10}
              perfectDrawEnabled={false}
              shadowForStrokeEnabled={false}
              listening={true}
            />
            {/* Show simplified control points when selected */}
            {isSelected && displayPoints.map((p, i) => {
              return (
                <React.Fragment key={`polygon-point-${ann.id}-${i}`}>
                  {/* Main control point */}
                  <Circle
                    x={p.x}
                    y={p.y}
                    radius={cpRadius}
                    fill="#fff"
                    stroke="transparent"
                    strokeWidth={0}
                    hitStrokeWidth={cpHitStroke}
                    draggable={!ann.isLocked}
                    perfectDrawEnabled={false}
                    onDragEnd={(e) => {
                      const draggedX = e.target.x();
                      const draggedY = e.target.y();

                      // Find nearest point in original array
                      let minDist = Infinity;
                      let nearestIdx = 0;
                      for (let idx = 0; idx < data.points.length; idx++) {
                        const pt = data.points[idx];
                        const dist = Math.pow(pt.x - p.x, 2) + Math.pow(pt.y - p.y, 2);
                        if (dist < minDist) {
                          minDist = dist;
                          nearestIdx = idx;
                        }
                      }

                      const newPoints = [...data.points];
                      newPoints[nearestIdx] = { x: draggedX, y: draggedY };
                      updateAnnotationWithSourceTracking(ann.id, {
                        data: { ...data, points: newPoints },
                      });
                    }}
                    onContextMenu={(e) => {
                      e.evt.preventDefault();
                      // Delete point if more than 3 points remain
                      if (data.points.length > 3 && !ann.isLocked) {
                        // Find and remove nearest point in original array
                        let minDist = Infinity;
                        let nearestIdx = 0;
                        for (let idx = 0; idx < data.points.length; idx++) {
                          const pt = data.points[idx];
                          const dist = Math.pow(pt.x - p.x, 2) + Math.pow(pt.y - p.y, 2);
                          if (dist < minDist) {
                            minDist = dist;
                            nearestIdx = idx;
                          }
                        }

                        const newPoints = data.points.filter((_, idx) => idx !== nearestIdx);
                        updateAnnotationWithSourceTracking(ann.id, {
                          data: { ...data, points: newPoints },
                        });
                      }
                    }}
                    onMouseEnter={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = 'pointer';
                      // Enlarge on hover for easier grabbing
                      (e.target as any).radius(cpHoverRadius);
                    }}
                    onMouseLeave={(e) => {
                      const container = e.target.getStage()?.container();
                      if (container) container.style.cursor = 'default';
                      (e.target as any).radius(cpRadius);
                    }}
                  />
                  {/* Midpoint for adding new points - only show when not too many points */}
                  {!ann.isLocked && displayPoints.length < 30 && (() => {
                    const nextIdx = (i + 1) % displayPoints.length;
                    const nextPoint = displayPoints[nextIdx];
                    const midX = (p.x + nextPoint.x) / 2;
                    const midY = (p.y + nextPoint.y) / 2;
                    return (
                      <Circle
                        x={midX}
                        y={midY}
                        radius={midRadius}
                        fill="transparent"
                        stroke={color}
                        strokeWidth={midStroke}
                        dash={[2, 2]}
                        opacity={0.5}
                        listening={true}
                        hitStrokeWidth={cpHitStroke}
                        perfectDrawEnabled={false}
                        onClick={(e) => {
                          e.cancelBubble = true;
                          // Find the segment in original points and add midpoint there
                          let insertIdx = 0;
                          for (let idx = 0; idx < data.points.length; idx++) {
                            const pt = data.points[idx];
                            if (pt.x === p.x && pt.y === p.y) {
                              insertIdx = idx + 1;
                              break;
                            }
                          }
                          const newPoints = [...data.points];
                          newPoints.splice(insertIdx, 0, { x: midX, y: midY });
                          updateAnnotationWithSourceTracking(ann.id, {
                            data: { ...data, points: newPoints },
                          });
                        }}
                        onMouseEnter={(e) => {
                          const target = e.target as any;
                          target.fill('#22c55e');
                          target.opacity(0.8);
                          target.radius(midHoverRadius);
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = 'copy';
                        }}
                        onMouseLeave={(e) => {
                          const target = e.target as any;
                          target.fill('transparent');
                          target.opacity(0.5);
                          target.radius(midRadius);
                          const container = e.target.getStage()?.container();
                          if (container) container.style.cursor = 'default';
                        }}
                      />
                    );
                  })()}
                </React.Fragment>
              );
            })}
          </Group>
        );
      }

      case 'polyline': {
        const data = ann.data as PolylineData2D;
        // Constant on-screen sizing: shapes live in a Stage scaled by `scale`.
        const zoomFactor = scale;
        const px = (screenPx: number) => screenPx / scale;

        // ── Sizing ──────────────────────────────────────────────────
        const cpRadius       = px(4.5);
        const cpHoverRadius  = px(6.5);
        const cpStroke       = px(1.5);
        const cpHitStroke    = px(18);
        const midRadius      = px(3.5);
        const midHitStroke   = px(14);
        const epSize         = px(6.5);
        const epStrokeW      = px(1.5);
        const epHit          = px(16);

        // Use spline interpolation if bezier mode is enabled
        const points = data.isBezier && data.points.length >= 3
          ? getCatmullRomSpline(data.points, 0.5, false)
          : data.points.flatMap(p => [p.x, p.y]);

        return (
          <Group key={ann.id} {...commonProps}>
            {/* ── Main lane stroke ─────────────────────────────────── */}
            {/* Width/dash use px() so they're a CONSTANT on-screen size at any
                zoom — a raw image-space width vanishes when zoomed out. Tracked
                lanes are drawn thicker so they stand out. */}
            <Line
              points={points}
              stroke={isTracked ? '#22d3ee' : color}
              strokeWidth={px(isTracked ? (isSelected ? 4.5 : 3.5) : (isSelected ? 3 : 2))}
              dash={isTracked ? [px(10), px(6)] : (strokeDash ? [px(8), px(4)] : undefined)}
              lineCap="round"
              lineJoin="round"
              hitStrokeWidth={px(20)}
              listening={true}
              // Konva perf: skip the offscreen "perfect draw" pass (only matters for
              // semi-transparent fill+stroke overlap, which a lane polyline has not)
              // and skip stroke-shadow bookkeeping. Cuts per-frame redraw cost during
              // scene playback, where every lane is re-rendered each frame.
              perfectDrawEnabled={false}
              shadowForStrokeEnabled={false}
            />

            {/* ── Click-to-add-point (only when selected) ─────────── */}
            {isSelected && !ann.isLocked && !isLaneCreationMode && (
              <Line
                points={points}
                stroke="transparent"
                strokeWidth={0}
                hitStrokeWidth={px(24)}
                listening={true}
                onClick={(e) => {
                  e.cancelBubble = true;
                  const stage = e.target.getStage();
                  if (!stage) return;
                  const pointerPos = stage.getPointerPosition();
                  if (!pointerPos) return;
                  const transform = stage.getAbsoluteTransform().copy();
                  transform.invert();
                  const localPos = transform.point(pointerPos);

                  let minDist = Infinity;
                  let insertIdx = 0;
                  for (let i = 0; i < data.points.length - 1; i++) {
                    const p1 = data.points[i];
                    const p2 = data.points[i + 1];
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const len2 = dx * dx + dy * dy;
                    if (len2 === 0) continue;
                    const t = Math.max(0, Math.min(1,
                      ((localPos.x - p1.x) * dx + (localPos.y - p1.y) * dy) / len2
                    ));
                    const projX = p1.x + t * dx;
                    const projY = p1.y + t * dy;
                    const dist = (localPos.x - projX) ** 2 + (localPos.y - projY) ** 2;
                    if (dist < minDist) {
                      minDist = dist;
                      insertIdx = i + 1;
                    }
                  }

                  const newPoints = [...data.points];
                  newPoints.splice(insertIdx, 0, { x: localPos.x, y: localPos.y });
                  updateAnnotationWithSourceTracking(ann.id, {
                    data: { ...data, points: newPoints },
                  });
                }}
              />
            )}

            {/* ── Midpoint insertion handles (green) ──────────────── */}
            {isSelected && !ann.isLocked && !isLaneCreationMode &&
              data.points.length >= 2 && data.points.length < 40 &&
              data.points.slice(0, -1).map((p, i) => {
                const next = data.points[i + 1];
                const mx = (p.x + next.x) / 2;
                const my = (p.y + next.y) / 2;
                return (
                  <Circle
                    key={`mid-${ann.id}-${i}`}
                    x={mx}
                    y={my}
                    radius={midRadius}
                    fill="transparent"
                    stroke="#22c55e"
                    strokeWidth={cpStroke}
                    dash={[2 / zoomFactor, 2 / zoomFactor]}
                    opacity={0.5}
                    hitStrokeWidth={midHitStroke}
                    listening={true}
                    perfectDrawEnabled={false}
                    onClick={(e) => {
                      e.cancelBubble = true;
                      const newPoints = [...data.points];
                      newPoints.splice(i + 1, 0, { x: mx, y: my });
                      updateAnnotationWithSourceTracking(ann.id, {
                        data: { ...data, points: newPoints },
                      });
                    }}
                    onMouseEnter={(e) => {
                      const t2 = e.target as any;
                      t2.fill('#22c55e'); t2.opacity(0.85); t2.radius(cpHoverRadius);
                      const c = e.target.getStage()?.container();
                      if (c) c.style.cursor = 'copy';
                    }}
                    onMouseLeave={(e) => {
                      const t2 = e.target as any;
                      t2.fill('transparent'); t2.opacity(0.5); t2.radius(midRadius);
                      const c = e.target.getStage()?.container();
                      if (c) c.style.cursor = 'default';
                    }}
                  />
                );
              })
            }

            {/* ── Interior control points ─────────────────────────── */}
            {isSelected && !isLaneCreationMode && data.points.map((p, i) => {
              if (i === 0 || i === data.points.length - 1) return null;
              return (
                <Circle
                  key={`cp-${ann.id}-${i}`}
                  x={p.x}
                  y={p.y}
                  radius={cpRadius}
                  fill="white"
                  stroke={color}
                  strokeWidth={cpStroke}
                  hitStrokeWidth={cpHitStroke}
                  draggable={!ann.isLocked}
                  perfectDrawEnabled={false}
                  onDragEnd={(e) => {
                    const newPoints = [...data.points];
                    newPoints[i] = { x: e.target.x(), y: e.target.y() };
                    updateAnnotationWithSourceTracking(ann.id, {
                      data: { ...data, points: newPoints },
                    });
                  }}
                  onContextMenu={(e) => {
                    e.evt.preventDefault();
                    if (data.points.length > 2 && !ann.isLocked) {
                      const newPoints = data.points.filter((_, idx) => idx !== i);
                      updateAnnotationWithSourceTracking(ann.id, {
                        data: { ...data, points: newPoints },
                      });
                    }
                  }}
                  onMouseEnter={(e) => {
                    const c = e.target.getStage()?.container();
                    if (c) c.style.cursor = 'pointer';
                    (e.target as any).radius(cpHoverRadius);
                    (e.target as any).fill('#e0e0e0');
                  }}
                  onMouseLeave={(e) => {
                    const c = e.target.getStage()?.container();
                    if (c) c.style.cursor = 'default';
                    (e.target as any).radius(cpRadius);
                    (e.target as any).fill('white');
                  }}
                />
              );
            })}

            {/* ── Red diamond endpoint handles (Start / End) ──────
                Only rendered on selected lane.
                Small hit area — won't block clicking other lanes.
            ──────────────────────────────────────────────────── */}
            {isSelected && !isLaneCreationMode && data.points.length >= 2 && (
              [
                { ptIdx: 0,                      label: 'S' },
                { ptIdx: data.points.length - 1, label: 'E' },
              ].map(({ ptIdx, label }) => {
                const ep = data.points[ptIdx];
                const diamond = [
                  0, -epSize, epSize * 0.6, 0, 0, epSize, -epSize * 0.6, 0,
                ];
                return (
                  <React.Fragment key={`ep-${ann.id}-${ptIdx}`}>
                    <Circle
                      x={ep.x}
                      y={ep.y}
                      radius={epSize + 3 / zoomFactor}
                      fill="rgba(239,68,68,0.15)"
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                    <Line
                      x={ep.x}
                      y={ep.y}
                      points={diamond}
                      closed={true}
                      fill="#ef4444"
                      stroke="white"
                      strokeWidth={epStrokeW}
                      hitStrokeWidth={epHit}
                      listening={true}
                      draggable={!ann.isLocked}
                      onDragEnd={(e) => {
                        const newPoints = [...data.points];
                        newPoints[ptIdx] = { x: e.target.x(), y: e.target.y() };
                        updateAnnotationWithSourceTracking(ann.id, {
                          data: { ...data, points: newPoints },
                        });
                      }}
                      onMouseEnter={(e) => {
                        const c = e.target.getStage()?.container();
                        if (c) c.style.cursor = 'grab';
                        (e.target as any).scaleX(1.3);
                        (e.target as any).scaleY(1.3);
                      }}
                      onMouseLeave={(e) => {
                        const c = e.target.getStage()?.container();
                        if (c) c.style.cursor = 'default';
                        (e.target as any).scaleX(1);
                        (e.target as any).scaleY(1);
                      }}
                      onDragStart={(e) => {
                        const c = e.target.getStage()?.container();
                        if (c) c.style.cursor = 'grabbing';
                      }}
                    />
                    <Text
                      x={ep.x}
                      y={ep.y}
                      text={label}
                      fontSize={px(7)}
                      fontStyle="bold"
                      fill="white"
                      align="center"
                      verticalAlign="middle"
                      offsetX={px(3.5)}
                      offsetY={px(3.5)}
                      listening={false}
                      perfectDrawEnabled={false}
                    />
                  </React.Fragment>
                );
              })
            )}
          </Group>
        );
      }

      case 'points': {
        const data = ann.data as PointsData;
        return (
          <Group key={ann.id} {...commonProps}>
            {/* Annotation labels removed - shown in properties panel instead */}
            {data.points.map((p, i) => (
              <Circle
                key={i}
                x={p.x}
                y={p.y}
                radius={isSelected ? 8 : 6}
                fill={isTracked ? '#22d3ee' : color}
                stroke="white"
                strokeWidth={2}
                draggable={!ann.isLocked}
                onDragEnd={(e) => {
                  const newPoints = [...data.points];
                  newPoints[i] = { ...newPoints[i], x: e.target.x(), y: e.target.y() };
                  updateAnnotationWithSourceTracking(ann.id, {
                    data: { ...data, points: newPoints },
                  });
                }}
                onContextMenu={(e) => {
                  e.evt.preventDefault();
                  // Delete point if more than 1 point remains
                  if (data.points.length > 1 && !ann.isLocked) {
                    const newPoints = data.points.filter((_, idx) => idx !== i);
                    updateAnnotationWithSourceTracking(ann.id, {
                      data: { ...data, points: newPoints },
                    });
                  }
                }}
                onMouseEnter={(e) => {
                  const container = e.target.getStage()?.container();
                  if (container) container.style.cursor = 'pointer';
                  (e.target as any).radius(isSelected ? 10 : 8);
                }}
                onMouseLeave={(e) => {
                  const container = e.target.getStage()?.container();
                  if (container) container.style.cursor = 'default';
                  (e.target as any).radius(isSelected ? 8 : 6);
                }}
              />
            ))}
          </Group>
        );
      }

      case 'semantic_segment': {
        const data = ann.data as SemanticSegmentData;
        // Backward compatibility: support both 'polygon' (new) and 'points' (legacy)
        const polygonPoints = (data as any).polygon || (data as any).points || [];

        // Apply Douglas-Peucker simplification when selected to get ~20-50 editable points
        const simplifiedPoints = isSelected && polygonPoints.length > 50
          ? douglasPeucker(polygonPoints, 2.5)  // Increased epsilon for fewer points
          : polygonPoints;

        // Use straight lines when editing (selected), smooth splines when viewing (not selected)
        const points = !isSelected && data.isSmooth && polygonPoints.length >= 3
          ? getCatmullRomSpline(polygonPoints, data.tension || 1.0, true, 30)
          : polygonPoints.flatMap((p: any) => [p.x, p.y]);

        const fillOpacity = data.opacity ?? 0.35;
        const segmentFillColor = data.fillColor || color;

        return (
          <Group key={ann.id} {...commonProps}>
            {/* Semi-transparent fill - always listening for selection */}
            <Line
              points={points}
              stroke="transparent"
              strokeWidth={0}
              fill={segmentFillColor}
              opacity={fillOpacity}
              closed={true}
              perfectDrawEnabled={false}
              shadowForStrokeEnabled={false}
              listening={true}
            />

            {/* Invisible clickable area for adding points - only when selected */}
            {isSelected && !ann.isLocked && (
              <Line
                points={points}
                stroke="transparent"
                strokeWidth={0}
                fill="transparent"
                closed={true}
                hitStrokeWidth={10}
                perfectDrawEnabled={false}
                listening={true}
                onClick={(e) => {
                  e.cancelBubble = true;
                  const stage = e.target.getStage();
                  if (!stage) return;

                  const pointerPos = stage.getPointerPosition();
                  if (!pointerPos) return;

                  // Transform to canvas coordinates
                  const transform = stage.getAbsoluteTransform().copy();
                  transform.invert();
                  const localPos = transform.point(pointerPos);

                  // Find the closest edge segment and insert point there
                  let minDist = Infinity;
                  let insertIdx = 0;

                  for (let i = 0; i < polygonPoints.length; i++) {
                    const p1 = polygonPoints[i];
                    const p2 = polygonPoints[(i + 1) % polygonPoints.length];

                    // Distance from click to line segment
                    const dx = p2.x - p1.x;
                    const dy = p2.y - p1.y;
                    const len2 = dx * dx + dy * dy;

                    if (len2 === 0) continue;

                    const t = Math.max(0, Math.min(1,
                      ((localPos.x - p1.x) * dx + (localPos.y - p1.y) * dy) / len2
                    ));

                    const projX = p1.x + t * dx;
                    const projY = p1.y + t * dy;
                    const dist = Math.pow(localPos.x - projX, 2) + Math.pow(localPos.y - projY, 2);

                    if (dist < minDist) {
                      minDist = dist;
                      insertIdx = i + 1;
                    }
                  }

                  // Insert new point
                  const newPoints = [...polygonPoints];
                  newPoints.splice(insertIdx, 0, { x: localPos.x, y: localPos.y });
                  const updateField = (data as any).polygon ? 'polygon' : 'points';
                  updateAnnotationWithSourceTracking(ann.id, {
                    data: { ...data, [updateField]: newPoints },
                  });
                }}
              />
            )}

            {/* Tiny 1.5px dot control points - only when selected, rendered above clickable area */}
            {isSelected && !ann.isLocked && simplifiedPoints.map((p: any, i: number) => (
              <Circle
                key={`semantic-point-${ann.id}-${i}`}
                x={p.x}
                y={p.y}
                radius={1.5}
                fill={isSelected ? '#fff' : color}
                stroke="transparent"
                strokeWidth={0}
                draggable={true}
                onDragEnd={(e) => {
                  // Only update on drag end, not during drag (much faster)
                  const draggedX = e.target.x();
                  const draggedY = e.target.y();

                  // Find nearest point in original array (cached calculation)
                  let minDist = Infinity;
                  let nearestIdx = 0;
                  for (let idx = 0; idx < polygonPoints.length; idx++) {
                    const pt = polygonPoints[idx];
                    const dist = Math.pow(pt.x - p.x, 2) + Math.pow(pt.y - p.y, 2); // No sqrt for speed
                    if (dist < minDist) {
                      minDist = dist;
                      nearestIdx = idx;
                    }
                  }

                  // Update the original point
                  const newPoints = [...polygonPoints];
                  newPoints[nearestIdx] = { x: draggedX, y: draggedY };
                  const updateField = (data as any).polygon ? 'polygon' : 'points';
                  updateAnnotationWithSourceTracking(ann.id, {
                    data: { ...data, [updateField]: newPoints },
                  });
                }}
                onContextMenu={(e) => {
                  e.evt.preventDefault();
                  if (polygonPoints.length > 3) {
                    // Find and remove nearest point
                    let minDist = Infinity;
                    let nearestIdx = 0;
                    for (let idx = 0; idx < polygonPoints.length; idx++) {
                      const pt = polygonPoints[idx];
                      const dist = Math.pow(pt.x - p.x, 2) + Math.pow(pt.y - p.y, 2);
                      if (dist < minDist) {
                        minDist = dist;
                        nearestIdx = idx;
                      }
                    }

                    const newPoints = polygonPoints.filter((_: any, idx: number) => idx !== nearestIdx);
                    const updateField = (data as any).polygon ? 'polygon' : 'points';
                    updateAnnotationWithSourceTracking(ann.id, {
                      data: { ...data, [updateField]: newPoints },
                    });
                  }
                }}
                onMouseEnter={(e) => {
                  const container = e.target.getStage()?.container();
                  if (container) container.style.cursor = 'pointer';
                  // Enlarge on hover for easier grabbing
                  (e.target as any).radius(3);
                }}
                onMouseLeave={(e) => {
                  const container = e.target.getStage()?.container();
                  if (container) container.style.cursor = 'default';
                  (e.target as any).radius(1.5);
                }}
              />
            ))}

            {/* Simple label badge */}
            {isSelected && (
              <Group x={polygonPoints[0]?.x || 0} y={(polygonPoints[0]?.y || 0) - 25}>
                <Rect
                  width={130}
                  height={20}
                  fill="rgba(139, 92, 246, 0.95)"
                  cornerRadius={4}
                  shadowColor="black"
                  shadowBlur={4}
                  shadowOpacity={0.3}
                />
                <Text
                  text={`Semantic (${simplifiedPoints.length} pts)`}
                  fontSize={11}
                  fill="white"
                  padding={5}
                  width={130}
                  align="center"
                  fontStyle="bold"
                />
              </Group>
            )}
          </Group>
        );
      }

      default:
        return null;
    }
  }, [selectedIds, hoveredId, getAnnotationColor, getClassColor, availableClasses, select, setHovered, updateAnnotation, tracks, qaMode, canSwitchSelection, activeTool, scale, highlightTrackForAnnotation]);

  // Preview shapes while drawing
  const previewBox = drawStart && drawCurrent ? {
    x: Math.min(drawStart.x, drawCurrent.x),
    y: Math.min(drawStart.y, drawCurrent.y),
    width: Math.abs(drawCurrent.x - drawStart.x),
    height: Math.abs(drawCurrent.y - drawStart.y),
  } : null;

  const previewCenter = drawStart && drawCurrent ? {
    cx: (drawStart.x + drawCurrent.x) / 2,
    cy: (drawStart.y + drawCurrent.y) / 2,
    rx: Math.abs(drawCurrent.x - drawStart.x) / 2,
    ry: Math.abs(drawCurrent.y - drawCurrent.y) / 2,
  } : null;

  return (
    <div className="absolute inset-0 flex flex-col bg-dark">
      {/* Timer nudge toast */}
      {showTimerToast && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[300] pointer-events-none flex justify-center">
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
        </div>
      )}
      {/* Lane action feedback toast (interpolate, etc.) */}
      {laneActionToast && (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 z-[300] pointer-events-none flex justify-center max-w-md">
          <div className={`flex items-start gap-3 px-4 py-2.5 rounded-xl bg-gray-900 border animate-fadeInDown pointer-events-auto ${laneActionToast.kind === 'success' ? 'border-emerald-500/45' : 'border-sky-500/45'}`}>
            <span className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center border ${laneActionToast.kind === 'success' ? 'bg-emerald-500/15 border-emerald-500/30' : 'bg-sky-500/15 border-sky-500/30'}`}>
              <svg className={`w-3.5 h-3.5 ${laneActionToast.kind === 'success' ? 'text-emerald-400' : 'text-sky-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                {laneActionToast.kind === 'success'
                  ? <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  : <><circle cx="12" cy="12" r="9" /><path strokeLinecap="round" d="M12 8h.01M11 12h1v4h1" /></>}
              </svg>
            </span>
            <span className="text-[11px] text-gray-300 leading-snug pt-0.5">{laneActionToast.msg}</span>
            <button
              className="ml-1 flex-shrink-0 text-gray-500 hover:text-gray-300 transition-colors"
              onClick={() => { setLaneActionToast(null); if (laneToastTimeoutRef.current) clearTimeout(laneToastTimeoutRef.current); }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}
      {/* Camera Tabs */}
      <div className="h-10 bg-dark-panel border-b border-gray-700 flex items-center px-2 gap-1 overflow-x-auto flex-shrink-0">
        {cameras.map((camera) => {
          const fixCount = cameraFixCounts[camera];
          const hasRejected = (fixCount?.rejected ?? 0) > 0;
          const hasFlagged = (fixCount?.flagged ?? 0) > 0;
          const totalFixes = (fixCount?.rejected ?? 0) + (fixCount?.flagged ?? 0);

          return (
            <button
              key={camera}
              onClick={() => setSelectedCameraId(camera)}
              className={`px-3 py-1.5 rounded text-xs whitespace-nowrap transition-colors flex items-center gap-1.5 ${
                selectedCameraId === camera
                  ? 'bg-primary text-white'
                  : 'text-gray-400 hover:bg-dark-hover hover:text-white'
              }`}
              title={totalFixes > 0 ? `${fixCount?.rejected ?? 0} rejected, ${fixCount?.flagged ?? 0} flagged` : undefined}
            >
              {camera.replace(/_/g, ' ')}
              {/* Fix indicator badges */}
              {isRevisionMode && totalFixes > 0 && (
                <span className="flex items-center gap-0.5">
                  {hasRejected && (
                    <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-medium rounded bg-red-600 text-white">
                      {fixCount?.rejected}
                    </span>
                  )}
                  {hasFlagged && (
                    <span className="inline-flex items-center justify-center min-w-[16px] h-4 px-1 text-[10px] font-medium rounded bg-yellow-600 text-white">
                      {fixCount?.flagged}
                    </span>
                  )}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Main Content */}
      <div ref={mainContentRef} className="flex-1 flex overflow-hidden">
        {/* Left Toolbar */}
        <div data-tour="2d-tool-palette" className="w-12 bg-dark-panel border-r border-gray-700 flex flex-col items-center py-2 gap-1 flex-shrink-0">
          {TOOLS.map((tool, idx) => {
            const isDrawingTool = !['select', 'pan'].includes(tool.tool);
            const qaDisabled = qaMode && isDrawingTool;
            // Soft-lock: drawing tools blocked until timer is running
            const timerLocked = isDrawingTool && !timerRunning;
            const getGroup = (t: string) =>
              t === 'select' || t === 'pan' ? 'nav'
              : t === 'ai_track' || t === 'semantic_segment' || t === 'ai_polygon' ? 'ai'
              : 'shape';
            const currentGroup = getGroup(tool.tool);
            const prevTool = idx > 0 ? TOOLS[idx - 1] : null;
            const prevGroup = prevTool ? getGroup(prevTool.tool) : null;
            const showGroupDivider = idx > 0 && currentGroup !== prevGroup;

            return (
              <React.Fragment key={tool.tool}>
                {showGroupDivider && (
                  <div className="w-8 h-px my-1 bg-gradient-to-r from-transparent via-slate-500/80 to-transparent" />
                )}
                <button
                  data-tour={`${tool.tool}-tool-2d`}
                  onMouseEnter={() => {
                    if (timerLocked) {
                      window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: true } }));
                    }
                  }}
                  onMouseLeave={() => {
                    if (timerLocked) {
                      window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: false } }));
                    }
                  }}
                  onFocus={() => {
                    if (timerLocked) {
                      window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: true } }));
                    }
                  }}
                  onBlur={() => {
                    if (timerLocked) {
                      window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: false } }));
                    }
                  }}
                  onClick={() => {
                    if (qaDisabled) return;
                    if (timerLocked) {
                      // Show timer nudge toast on every click attempt
                      if (timerToastTimeoutRef.current) clearTimeout(timerToastTimeoutRef.current);
                      setShowTimerToast(true);
                      timerToastTimeoutRef.current = setTimeout(() => setShowTimerToast(false), 8000);
                      return;
                    }
                    setActiveTool(tool.tool);
                  }}
                  disabled={qaDisabled}
                  className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
                    qaDisabled
                      ? 'text-gray-600 cursor-not-allowed opacity-40'
                      : timerLocked
                      ? 'text-amber-600/50 cursor-not-allowed opacity-60'
                      : activeTool === tool.tool
                      ? 'bg-primary text-white'
                      : 'text-gray-400 hover:bg-dark-hover hover:text-white'
                  }`}
                  title={
                    qaDisabled
                      ? `${tool.name} — disabled in QA mode`
                      : timerLocked
                      ? `${tool.name} — start the timer first`
                      : `${tool.name} (${tool.shortcut})`
                  }
                >
                  {tool.icon}
                  {/* Lock badge overlay for timer-locked tools */}
                  {timerLocked && (
                    <span className="absolute bottom-0.5 right-0.5 w-3 h-3 flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-amber-500/70" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                      </svg>
                    </span>
                  )}
                </button>
              </React.Fragment>
            );
          })}

          <div className="flex-1" />

          {/* Undo/Redo */}
          <button
            onClick={undo}
            disabled={historyIndex <= 0}
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              historyIndex <= 0
                ? 'text-gray-600 cursor-not-allowed'
                : 'text-gray-400 hover:bg-dark-hover hover:text-white'
            }`}
            title={`Undo (Ctrl+Z)${historyIndex > 0 ? ` - ${history[historyIndex]?.description || ''}` : ''}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
            </svg>
          </button>
          <button
            onClick={redo}
            disabled={historyIndex >= history.length - 1}
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-colors ${
              historyIndex >= history.length - 1
                ? 'text-gray-600 cursor-not-allowed'
                : 'text-gray-400 hover:bg-dark-hover hover:text-white'
            }`}
            title={`Redo (Ctrl+Y)${historyIndex < history.length - 1 ? ` - ${history[historyIndex + 1]?.description || ''}` : ''}`}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
            </svg>
          </button>

          {/* Help Button */}
          <button
            onClick={() => setShowHelp(true)}
            className="w-10 h-10 rounded-lg flex items-center justify-center text-gray-400 hover:bg-dark-hover hover:text-white transition-colors"
            title="Keyboard Shortcuts (F1)"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          {/* Polygon smooth options - show when polygon/polyline is active */}
          {(activeTool === 'polygon' || activeTool === 'polyline') && (
            <div className="mt-2 pt-2 border-t border-gray-700 w-full px-1">
              <button
                onClick={() => setSmoothPolygon(!smoothPolygon)}
                className={`w-full px-1 py-1 rounded text-xs flex items-center justify-center gap-1 transition-colors ${
                  smoothPolygon
                    ? 'bg-purple-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600'
                }`}
                title={smoothPolygon ? 'Smooth curves ON' : 'Smooth curves OFF'}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16c0-4 4-6 8-6s8 2 8 6M4 8c2-4 6-4 8-4s6 0 8 4" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* AI Track Panel - shows when AI Track tool is active */}
        {activeTool === 'ai_track' && (
          <div className="absolute top-[140px] left-16 z-10 bg-gray-900 border border-gray-600 rounded-xl p-3 shadow-2xl min-w-[180px]">
            {/* Header */}
            <div className="flex items-center gap-2 mb-3">
              <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center">
                <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>
                  <path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
                </svg>
              </div>
              <span className="text-sm font-medium text-white">AI Track</span>
            </div>

            {/* Direction Toggle */}
            <div className="mb-3">
              <div className="text-xs text-gray-400 mb-1.5">Direction</div>
              <div className="flex gap-1">
                <button
                  onClick={() => setAiTrackDirection('forward')}
                  className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                    aiTrackDirection === 'forward'
                      ? 'bg-emerald-600 text-white shadow-lg'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  → Forward
                </button>
                <button
                  onClick={() => setAiTrackDirection('forward_backward')}
                  className={`flex-1 px-2 py-1.5 rounded-md text-xs font-medium transition-all ${
                    aiTrackDirection === 'forward_backward'
                      ? 'bg-emerald-600 text-white shadow-lg'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  ↔ Both
                </button>
              </div>
            </div>

            {/* Run Button */}
            {(() => {
              const tracksToRun = new Set<string>();
              pendingAiTrackIds.forEach(id => tracksToRun.add(id));
              selectedIds.forEach(annId => {
                const ann = annotations.get(annId);
                if (ann?.trackId) tracksToRun.add(ann.trackId);
              });
              const count = tracksToRun.size;

              return (
                <button
                  onClick={runAiTrackForSelected}
                  disabled={propagateStatus === 'propagating' || count === 0}
                  className={`w-full px-3 py-2.5 rounded-lg text-sm font-medium flex items-center justify-center gap-2 transition-all ${
                    propagateStatus === 'propagating'
                      ? 'bg-cyan-700/50 text-cyan-300 cursor-wait'
                      : count > 0
                        ? 'bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-400 hover:to-cyan-400 shadow-lg shadow-emerald-500/20'
                        : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  }`}
                  title={count > 0 ? `Run AI tracking for ${count} box(es) - Press Enter` : 'Draw boxes first to track'}
                >
                  {propagateStatus === 'propagating' ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      <span>Running...</span>
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M5 3l14 9-14 9V3z"/>
                      </svg>
                      <span>{count > 0 ? `Run (${count})` : 'Draw boxes to track'}</span>
                    </>
                  )}
                </button>
              );
            })()}

          </div>
        )}

        {/* Enhanced Polygon/Polyline Settings Panel - only show when tool is active */}
        {(activeTool === 'polygon' || activeTool === 'polyline') && (
          <div className="absolute top-14 left-16 z-10 bg-gray-900 border border-gray-600 rounded-xl p-4 shadow-2xl min-w-[220px]">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    {activeTool === 'polygon' ? (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l8 6-3 10H7L4 8l8-6z" />
                    ) : (
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17l6-6 4 4 8-8" />
                    )}
                  </svg>
                </div>
                <span className="text-sm font-medium text-white">
                  {activeTool === 'polygon' ? 'Polygon' : 'Polyline'} Tool
                </span>
              </div>
            </div>

            {/* Drawing Mode Toggle */}
            <div className="bg-gray-800/50 rounded-lg p-2 mb-3">
              <div className="flex gap-1">
                <button
                  onClick={() => setSmoothPolygon(false)}
                  className={`flex-1 px-3 py-2 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                    !smoothPolygon
                      ? 'bg-blue-600 text-white shadow-lg'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 18h16" />
                  </svg>
                  Sharp
                </button>
                <button
                  onClick={() => setSmoothPolygon(true)}
                  className={`flex-1 px-3 py-2 rounded-md text-xs font-medium flex items-center justify-center gap-1.5 transition-all ${
                    smoothPolygon
                      ? 'bg-purple-600 text-white shadow-lg'
                      : 'text-gray-400 hover:text-white hover:bg-gray-700'
                  }`}
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16c0-4 4-6 8-6s8 2 8 6" />
                  </svg>
                  Smooth
                </button>
              </div>
            </div>

            {/* Tension slider - only show when smooth is enabled */}
            {smoothPolygon && (
              <div className="space-y-2 mb-3">
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">Curve Tension</span>
                  <span className="text-xs font-mono text-purple-400 bg-purple-900/30 px-2 py-0.5 rounded">
                    {Math.round(splineTension * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={splineTension}
                  onChange={(e) => setSplineTension(parseFloat(e.target.value))}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #8b5cf6 0%, #8b5cf6 ${splineTension * 100}%, #374151 ${splineTension * 100}%, #374151 100%)`
                  }}
                />
                <div className="flex justify-between text-[10px] text-gray-500">
                  <span>Tight</span>
                  <span>Loose</span>
                </div>
              </div>
            )}

          </div>
        )}

        {/* AI Tool Settings Panel - shows when AI tools are active */}
        {(activeTool === 'semantic_segment' || activeTool === 'ai_polygon') && (
          <div className="absolute top-14 left-16 z-10 bg-gray-900 border border-gray-600 rounded-xl p-4 shadow-2xl min-w-[240px]">
            {/* Header */}
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-purple-500 to-pink-600 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                  </svg>
                </div>
                <span className="text-sm font-medium text-white">
                  {activeTool === 'semantic_segment' ? 'AI Segmentation' : 'Smart Polygon'}
                </span>
              </div>
            </div>

            {/* Polygon Detail Control - only for ai_polygon */}
            {activeTool === 'ai_polygon' && (
              <div className="mb-3">
                <label className="text-xs text-gray-400 mb-2 block">Polygon Detail</label>
                <div className="grid grid-cols-2 gap-1 bg-gray-800/50 rounded-lg p-1">
                  <button
                    onClick={() => {
                      setAiSegmentSimplifyTolerance(0.001);
                      localStorage.setItem('ai_segment_simplify_tolerance', '0.001');
                    }}
                    className={`px-2 py-1.5 rounded text-xs font-medium transition-all ${
                      aiSegmentSimplifyTolerance <= 0.0015
                        ? 'bg-gradient-to-r from-purple-600 to-pink-600 text-white shadow-lg'
                        : 'text-gray-400 hover:text-white hover:bg-gray-700'
                    }`}
                    title="Maximum precision, most polygon points"
                  >
                    Super Fine ✨
                  </button>
                  <button
                    onClick={() => {
                      setAiSegmentSimplifyTolerance(0.003);
                      localStorage.setItem('ai_segment_simplify_tolerance', '0.003');
                    }}
                    className={`px-2 py-1.5 rounded text-xs font-medium transition-all ${
                      aiSegmentSimplifyTolerance > 0.0015 && aiSegmentSimplifyTolerance <= 0.004
                        ? 'bg-purple-600 text-white shadow-lg'
                        : 'text-gray-400 hover:text-white hover:bg-gray-700'
                    }`}
                    title="More polygon points, closer to mask edge"
                  >
                    Fine
                  </button>
                  <button
                    onClick={() => {
                      setAiSegmentSimplifyTolerance(0.006);
                      localStorage.setItem('ai_segment_simplify_tolerance', '0.006');
                    }}
                    className={`px-2 py-1.5 rounded text-xs font-medium transition-all ${
                      aiSegmentSimplifyTolerance > 0.004 && aiSegmentSimplifyTolerance <= 0.008
                        ? 'bg-purple-600 text-white shadow-lg'
                        : 'text-gray-400 hover:text-white hover:bg-gray-700'
                    }`}
                    title="Balanced polygon detail"
                  >
                    Medium
                  </button>
                  <button
                    onClick={() => {
                      setAiSegmentSimplifyTolerance(0.01);
                      localStorage.setItem('ai_segment_simplify_tolerance', '0.01');
                    }}
                    className={`px-2 py-1.5 rounded text-xs font-medium transition-all ${
                      aiSegmentSimplifyTolerance > 0.008
                        ? 'bg-purple-600 text-white shadow-lg'
                        : 'text-gray-400 hover:text-white hover:bg-gray-700'
                    }`}
                    title="Fewer polygon points, smoother shape"
                  >
                    Coarse
                  </button>
                </div>
                <div className="mt-2 text-[10px] text-gray-500 text-center">
                  {aiSegmentSimplifyTolerance <= 0.0015 ? '🎯 Ultra-precise, max points' :
                   aiSegmentSimplifyTolerance <= 0.004 ? 'More points, precise edges' :
                   aiSegmentSimplifyTolerance <= 0.008 ? 'Balanced detail' :
                   'Fewer points, easier to edit'}
                </div>
              </div>
            )}

            {/* Semantic Segmentation Info - pixel-perfect by default */}
            {activeTool === 'semantic_segment' && (
              <div className="bg-gradient-to-br from-purple-900/50 to-pink-900/40 rounded-lg px-3 py-2 border border-purple-500/40 flex items-center gap-2">
                <span className="text-lg">🎯</span>
                <span className="text-xs font-semibold text-purple-200">Pixel-Perfect Mode</span>
              </div>
            )}
          </div>
        )}

        {/* Canvas */}
        <div
          data-tour="2d-canvas"
          ref={containerRef}
          className="flex-1 relative bg-black min-w-0"
          style={{
            cursor: fnMode
              ? 'crosshair'
              : isPanning
              ? 'grabbing'
              : activeTool === 'pan' || isSpacePressed
              ? 'grab'
              : activeTool === 'select'
              ? 'default'
              : activeTool === 'polygon' || activeTool === 'polyline' || activeTool === 'points'
              ? isNearFirstPoint
                ? 'pointer'
                : 'crosshair'
              : activeTool === 'semantic_segment' || activeTool === 'ai_polygon'
              ? 'cell'
              : activeTool === 'ai_track'
              ? 'crosshair'
              : 'crosshair'
          }}
        >
          {/* AI Track Progress Indicator */}
          {propagateStatus === 'propagating' && activeTool === 'ai_track' && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-dark-panel/95 border border-emerald-500/50 rounded-lg px-4 py-3 shadow-xl backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <svg className="w-5 h-5 animate-spin text-emerald-400" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span className="text-sm font-medium text-white">
                  AI Tracking {aiTrackDirection === 'forward_backward' ? '(↔ Both directions)' : '(→ Forward)'}...
                </span>
              </div>
            </div>
          )}

          {/* AI Track Complete Indicator */}
          {propagateStatus === 'done' && activeTool === 'ai_track' && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-emerald-600/95 rounded-lg px-4 py-2 shadow-xl">
              <div className="flex items-center gap-2 text-white">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                <span className="text-sm font-medium">Tracking complete!</span>
              </div>
            </div>
          )}

          <Stage
            ref={stageRef}
            width={containerSize.width}
            height={containerSize.height}
            scaleX={scale}
            scaleY={scale}
            x={position.x}
            y={position.y}
            draggable={activeTool === 'pan' || isSpacePressed}
            onDragStart={(e) => {
              // Only set panning if the stage itself is being dragged
              if (e.target === e.target.getStage()) {
                setIsPanning(true);
              }
            }}
            onDragEnd={(e) => {
              // Only update position if the stage itself was dragged
              if (e.target === e.target.getStage()) {
                setIsPanning(false);
                const stage = e.target;
                setPosition({ x: stage.x(), y: stage.y() });
              }
            }}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => {
              setMousePos(null);
              setIsNearFirstPoint(false);
              setHoveredPointIndex(null);
              setCursorPosition(null);
            }}
            onDblClick={handleDoubleClick}
            onContextMenu={(e) => {
              // Prevent context menu for AI Segment right-click and polygon/polyline tools
              if (activeTool === 'semantic_segment' || activeTool === 'ai_polygon' || activeTool === 'polygon' || activeTool === 'polyline' || activeTool === 'points') {
                e.evt.preventDefault();
              }
            }}
          >
            {/* Image Layer */}
            <Layer>
              {image ? (
                <Image
                  image={image}
                  width={imageSize.width}
                  height={imageSize.height}
                />
              ) : (
                <Rect
                  width={imageSize.width}
                  height={imageSize.height}
                  fill="#1e293b"
                />
              )}
            </Layer>

            {/* Annotations Layer */}
            <Layer>
              {currentAnnotations.map(renderAnnotation)}
            </Layer>

            {/* Drawing Preview Layer */}
            <Layer>
              {/* Box/Rotated Box/AI Track preview */}
              {previewBox && (activeTool === 'box' || activeTool === 'rotated_box' || activeTool === 'ai_track') && (
                <Rect
                  x={previewBox.x}
                  y={previewBox.y}
                  width={previewBox.width}
                  height={previewBox.height}
                  stroke={activeTool === 'ai_track' ? '#10b981' : '#3b82f6'}
                  strokeWidth={2}
                  dash={[5, 5]}
                  listening={false}
                />
              )}

              {/* Ellipse preview */}
              {previewCenter && activeTool === 'ellipse' && (
                <Ellipse
                  x={previewCenter.cx}
                  y={previewCenter.cy}
                  radiusX={previewCenter.rx}
                  radiusY={previewCenter.ry}
                  stroke="#3b82f6"
                  strokeWidth={2}
                  dash={[5, 5]}
                  listening={false}
                />
              )}

              {/* Polygon/Polyline preview - optimized for performance */}
              {drawingPoints.length > 0 && (activeTool === 'polygon' || activeTool === 'polyline') && (
                <>
                  {/* Main drawn line through placed points */}
                  <Line
                    points={
                      smoothPolygon && drawingPoints.length >= 4 && activeTool === 'polygon'
                        ? getCatmullRomSpline(drawingPoints, splineTension, false, 15)
                        : drawingPoints.flatMap(p => [p.x, p.y])
                    }
                    stroke="#3b82f6"
                    strokeWidth={2.5}
                    lineCap="round"
                    lineJoin="round"
                    closed={false}
                    listening={false}
                  />

                  {/* Closing preview line for polygon (from last point to first point) - ALWAYS SHOW */}
                  {activeTool === 'polygon' && drawingPoints.length >= 3 && (
                    <Line
                      points={[
                        drawingPoints[drawingPoints.length - 1].x,
                        drawingPoints[drawingPoints.length - 1].y,
                        drawingPoints[0].x,
                        drawingPoints[0].y
                      ]}
                      stroke="#3b82f6"
                      strokeWidth={1.5}
                      dash={[4, 4]}
                      opacity={0.3}
                      listening={false}
                    />
                  )}

                  {/* Live preview line from last point to cursor */}
                  {mousePos && drawingPoints.length > 0 && (
                    <Line
                      points={[
                        drawingPoints[drawingPoints.length - 1].x,
                        drawingPoints[drawingPoints.length - 1].y,
                        isNearFirstPoint && activeTool === 'polygon' ? drawingPoints[0].x : mousePos.x,
                        isNearFirstPoint && activeTool === 'polygon' ? drawingPoints[0].y : mousePos.y,
                      ]}
                      stroke={isNearFirstPoint ? '#22c55e' : '#60a5fa'}
                      strokeWidth={2}
                      dash={[8, 4]}
                      opacity={0.8}
                      lineCap="round"
                      listening={false}
                    />
                  )}

                  {/* Control points with enhanced hover states */}
                  {drawingPoints.map((p, i) => {
                    const isFirst = i === 0;
                    const isLast = i === drawingPoints.length - 1;
                    const isHovered = hoveredPointIndex === i;
                    const isSnapTarget = isFirst && isNearFirstPoint && drawingPoints.length >= 3;
                    const canClose = isFirst && drawingPoints.length >= 3 && activeTool === 'polygon';
                    const zoomFactor = Math.max(scale, 1); // opacity floors only
                    // Radii/strokes: constant on-screen size = value / scale.
                    const scaledRadius = (value: number, _min?: number) => value / scale;
                    const scaledAlpha = (value: number, min: number) => Math.max(min, value / zoomFactor);

                    return (
                      <React.Fragment key={i}>
                        {/* Invisible larger hitbox for first point (easier to click to close) */}
                        {canClose && (
                          <Circle
                            x={p.x}
                            y={p.y}
                            radius={SNAP_THRESHOLD / scale}
                            fill="transparent"
                            onClick={() => {
                              if (canClose) {
                                finishPolygon();
                              }
                            }}
                            onMouseEnter={() => setIsNearFirstPoint(true)}
                            onMouseLeave={() => setIsNearFirstPoint(false)}
                            style={{ cursor: 'pointer' }}
                          />
                        )}

                        {/* Snap target ring - simplified for performance */}
                        {isSnapTarget && (
                          <>
                            {/* Outer ring */}
                            <Circle
                              x={p.x}
                              y={p.y}
                              radius={SNAP_THRESHOLD / scale}
                              fill="rgba(34, 197, 94, 0.15)"
                              stroke="#22c55e"
                              strokeWidth={2}
                              dash={[6, 3]}
                              listening={false}
                            />
                            {/* Inner target circle */}
                            <Circle
                              x={p.x}
                              y={p.y}
                              radius={scaledRadius(9, 4)}
                              fill="#22c55e"
                              stroke="white"
                              strokeWidth={2.5 / scale}
                              listening={false}
                            />
                            {/* Center dot */}
                            <Circle
                              x={p.x}
                              y={p.y}
                              radius={scaledRadius(3, 1.3)}
                              fill="white"
                              listening={false}
                            />
                          </>
                        )}
                        {/* Regular control point */}
                        {!isSnapTarget && (
                          <>
                            {/* Outer ring for last point - simplified, no expensive animation */}
                            {isLast && activeTool === 'polyline' && (
                              <Circle
                                x={p.x}
                                y={p.y}
                                radius={scaledRadius(10, 2.8)}
                                stroke="#f59e0b"
                                strokeWidth={1.5 / scale}
                                opacity={scaledAlpha(0.5, 0.16)}
                                listening={false}
                              />
                            )}
                            <Circle
                              x={p.x}
                              y={p.y}
                              radius={
                                activeTool === 'polyline'
                                  ? (isFirst ? scaledRadius(4, 1.7) : isLast ? scaledRadius(3.5, 1.5) : isHovered ? scaledRadius(3.5, 1.5) : scaledRadius(3, 1.3))
                                  : (isFirst ? scaledRadius(7, 3) : isLast ? scaledRadius(6, 2.6) : isHovered ? scaledRadius(5, 2.2) : scaledRadius(4, 1.8))
                              }
                              fill={
                                activeTool === 'polyline'
                                  ? (isFirst
                                      ? `rgba(34,197,94,${scaledAlpha(0.35, 0.12)})`
                                      : isLast
                                      ? `rgba(245,158,11,${scaledAlpha(0.35, 0.12)})`
                                      : isHovered
                                      ? `rgba(96,165,250,${scaledAlpha(0.35, 0.12)})`
                                      : `rgba(59,130,246,${scaledAlpha(0.28, 0.1)})`)
                                  : (isFirst ? '#22c55e' : isLast ? '#f59e0b' : isHovered ? '#60a5fa' : '#3b82f6')
                              }
                              stroke="white"
                              strokeWidth={
                                activeTool === 'polyline'
                                  ? (isFirst || isLast || isHovered
                                      ? 1.2 / scale
                                      : 1 / scale)
                                  : (isFirst || isLast || isHovered
                                      ? 2 / scale
                                      : 1.5 / scale)
                              }
                              listening={false}
                            />
                          </>
                        )}
                        {/* Point number label - improved positioning */}
                        {(isFirst || isLast || isHovered) && (
                          <Text
                            x={p.x + 10 / scale}
                            y={p.y - 8 / scale}
                            text={
                              isFirst && drawingPoints.length >= 3 && activeTool === 'polygon'
                                ? '⭕ Close'
                                : isFirst
                                ? '1 (start)'
                                : isLast
                                ? `${i + 1} (last)`
                                : `${i + 1}`
                            }
                            fontSize={11 / scale}
                            fontStyle={isFirst || isLast ? 'bold' : 'normal'}
                            fill={isFirst ? '#86efac' : isLast ? '#fcd34d' : 'white'}
                            shadowColor="black"
                            shadowBlur={3 / scale}
                            shadowOpacity={1}
                          />
                        )}
                      </React.Fragment>
                    );
                  })}

                  {/* Minimal cursor feedback - point count only, no expensive shadows */}
                  {mousePos && drawingPoints.length > 0 && (() => {
                    const outer = 8 / scale;
                    const inner = 3 / scale;
                    const cw = 1 / scale;
                    return (
                    <Group>
                      {/* Simple crosshair - no shadows */}
                      <Line
                        points={[mousePos.x - outer, mousePos.y, mousePos.x - inner, mousePos.y]}
                        stroke="white"
                        strokeWidth={cw}
                        opacity={0.6}
                        listening={false}
                      />
                      <Line
                        points={[mousePos.x + inner, mousePos.y, mousePos.x + outer, mousePos.y]}
                        stroke="white"
                        strokeWidth={cw}
                        opacity={0.6}
                        listening={false}
                      />
                      <Line
                        points={[mousePos.x, mousePos.y - outer, mousePos.x, mousePos.y - inner]}
                        stroke="white"
                        strokeWidth={cw}
                        opacity={0.6}
                        listening={false}
                      />
                      <Line
                        points={[mousePos.x, mousePos.y + inner, mousePos.x, mousePos.y + outer]}
                        stroke="white"
                        strokeWidth={cw}
                        opacity={0.6}
                        listening={false}
                      />
                    </Group>
                    );
                  })()}
                </>
              )}

              {/* Points preview */}
              {drawingPoints.length > 0 && activeTool === 'points' && (
                drawingPoints.map((p, i) => (
                  <Circle
                    key={i}
                    x={p.x}
                    y={p.y}
                    radius={6 / scale}
                    fill="#3b82f6"
                    stroke="white"
                    strokeWidth={2 / scale}
                  />
                ))
              )}

              {/* SAM2 Preview - shown for both semantic_segment and ai_polygon */}
              {(activeTool === 'semantic_segment' || activeTool === 'ai_polygon') && (
                <>
                  {/* Preview mask polygon */}
                  {aiSegmentPreview && aiSegmentPreview.polygon.length >= 3 && (
                    <>
                      {/* Fill */}
                      <Line
                        points={aiSegmentPreview.polygon.flatMap(p => [p.x, p.y])}
                        fill={activeTool === 'semantic_segment' ? 'rgba(59, 130, 246, 0.4)' : 'rgba(147, 51, 234, 0.4)'}
                        closed={true}
                        listening={false}
                      />
                      {/* Outline */}
                      <Line
                        points={aiSegmentPreview.polygon.flatMap(p => [p.x, p.y])}
                        stroke={activeTool === 'semantic_segment' ? '#3b82f6' : '#9333ea'}
                        strokeWidth={2}
                        closed={true}
                        lineCap="round"
                        lineJoin="round"
                        dash={[5, 5]}
                        listening={false}
                      />
                    </>
                  )}

                  {/* Click points - positive (green) and negative (red) */}
                  {aiSegmentPoints.map((point, i) => (
                    <Circle
                      key={`sam2-point-${i}`}
                      x={point.x}
                      y={point.y}
                      radius={6 / scale}
                      fill={point.label === 1 ? '#22c55e' : '#ef4444'}
                      stroke="white"
                      strokeWidth={2 / scale}
                    />
                  ))}

                  {/* Loading indicator */}
                  {aiSegmentLoading && (
                    <Group>
                      <Circle
                        x={50}
                        y={50}
                        radius={20}
                        fill="rgba(0, 0, 0, 0.7)"
                      />
                      <Text
                        x={35}
                        y={42}
                        text="..."
                        fontSize={18}
                        fill="white"
                      />
                    </Group>
                  )}
                </>
              )}

            </Layer>

            {/* FN Markers Layer */}
            <Layer>
              {/* Render temporary FN markers from current session */}
              {fnMarkers.filter(m => m.frameId === frameId).map(marker => (
                <Group key={marker.id}>
                  {/* Red circle marker */}
                  <Circle
                    x={marker.x}
                    y={marker.y}
                    radius={8}
                    fill="rgba(239, 68, 68, 0.3)"
                    stroke="#ef4444"
                    strokeWidth={2}
                    listening={false}
                  />
                  {/* Center dot */}
                  <Circle
                    x={marker.x}
                    y={marker.y}
                    radius={2}
                    fill="#ef4444"
                    listening={false}
                  />
                  {/* Flag icon - simple triangle */}
                  <Line
                    points={[
                      marker.x - 1, marker.y - 8,
                      marker.x - 1, marker.y + 8
                    ]}
                    stroke="#ef4444"
                    strokeWidth={2}
                    listening={false}
                  />
                  <Line
                    points={[
                      marker.x - 1, marker.y - 8,
                      marker.x + 8, marker.y - 3,
                      marker.x - 1, marker.y + 2
                    ]}
                    fill="#ef4444"
                    closed
                    listening={false}
                  />
                </Group>
              ))}

              {/* Render saved FN suggestions from QA reviews (in revision mode) */}
              {isRevisionMode && (() => {
                const fnSuggestions = qaSuggestions.filter(s =>
                  s.suggestion_type === 'false_negative' &&
                  !s.is_dismissed &&
                  s.frame_id === frameId &&
                  s.details?.camera_id === selectedCameraId
                );

                console.log('[FN Markers] isRevisionMode:', isRevisionMode);
                console.log('[FN Markers] Total qaSuggestions:', qaSuggestions.length);
                console.log('[FN Markers] Filtered FN suggestions:', fnSuggestions.length);
                console.log('[FN Markers] Sample suggestion:', fnSuggestions[0]);

                return fnSuggestions.map(suggestion => {
                  // Extract location from suggestion details
                  const location = (suggestion.details as any)?.location;
                  console.log('[FN Markers] Processing suggestion:', suggestion.id, 'location:', location);

                  if (!location || typeof location.x !== 'number' || typeof location.y !== 'number') {
                    console.log('[FN Markers] Skipping - invalid location');
                    return null;
                  }

                  return (
                    <Group key={suggestion.id}>
                      {/* Yellow/orange circle marker for saved FNs */}
                      <Circle
                        x={location.x}
                        y={location.y}
                        radius={10}
                        fill="rgba(251, 191, 36, 0.3)"
                        stroke="#fbbf24"
                        strokeWidth={2}
                        listening={false}
                      />
                      {/* Center dot */}
                      <Circle
                        x={location.x}
                        y={location.y}
                        radius={2}
                        fill="#fbbf24"
                        listening={false}
                      />
                      {/* Question mark or exclamation - using a simple X for visibility */}
                      <Line
                        points={[
                          location.x - 4, location.y - 4,
                          location.x + 4, location.y + 4
                        ]}
                        stroke="#fbbf24"
                        strokeWidth={2}
                        listening={false}
                      />
                      <Line
                        points={[
                          location.x + 4, location.y - 4,
                          location.x - 4, location.y + 4
                        ]}
                        stroke="#fbbf24"
                        strokeWidth={2}
                        listening={false}
                      />
                    </Group>
                  );
                })
                .filter(Boolean);
              })()
              }
            </Layer>

          </Stage>


          {/* FN Mode Indicator */}
          {fnMode && (
            <div className="absolute top-4 left-1/2 transform -translate-x-1/2 px-4 py-2 bg-orange-600 text-white text-sm font-medium rounded-lg shadow-lg flex items-center gap-2 z-10">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" />
              </svg>
              FN Flagging Mode Active - Click image to mark missed objects
            </div>
          )}

          {/* Cursor position indicator */}
          {cursorPosition && (
            <div className="absolute top-4 right-4 px-3 py-1 bg-dark-panel/90 rounded text-xs text-white font-mono">
              x: {Math.round(cursorPosition.x)}, y: {Math.round(cursorPosition.y)}
            </div>
          )}

          {/* Zoom indicator */}
          <div className="absolute bottom-4 right-4 px-3 py-1 bg-dark-panel/80 rounded text-sm text-white">
            {Math.round(scale * 100)}%
          </div>


          {/* Floating Class Selector removed - class picker is in the right panel */}

          {/* Tool hint - Enhanced with more context */}
          <div className="absolute bottom-4 left-4 px-3 py-2 bg-dark-panel/90 rounded-lg text-xs text-gray-300 max-w-lg shadow-lg border border-gray-700/50">
            {activeTool === 'semantic_segment' || activeTool === 'ai_polygon'
              ? `${activeTool === 'semantic_segment' ? '🎨 Semantic Seg' : '🔷 AI Polygon'}: Click (+) or Right-click/Shift+click (−) to add prompts • Enter to accept • Esc to clear${aiSegmentLastInferenceMs > 0 ? ` • ${aiSegmentLastInferenceMs.toFixed(0)}ms` : ''}`
              : activeTool === 'polygon'
              ? drawingPoints.length === 0
                ? '🎯 Click to place first point'
                : drawingPoints.length < 3
                ? `📍 ${drawingPoints.length}/3 points • Keep clicking to add more`
                : `✅ ${drawingPoints.length} points • Click green point, Enter, or Right-click to close • Backspace to undo`
              : activeTool === 'polyline'
              ? drawingPoints.length === 0
                ? '🎯 Click to place first point'
                : drawingPoints.length < 2
                ? `📍 ${drawingPoints.length}/2 points • Keep clicking to add more`
                : `✅ ${drawingPoints.length} points • Press ENTER, Right-click, Double-click anywhere, or click green "Finish" button • Backspace to undo`
              : activeTool === 'points'
              ? drawingPoints.length === 0
                ? 'Click to add points'
                : `📍 ${drawingPoints.length} points • Enter, Double-click, or Right-click to finish • Backspace to undo`
              : activeTool === 'box' || activeTool === 'ellipse'
              ? 'Click and drag to draw'
              : activeTool === 'select'
              ? 'Click to select, drag to move'
              : 'Drag to pan'
            }
          </div>

          {/* SAM2 control buttons - shows when AI Segment tools have preview */}
          {(activeTool === 'semantic_segment' || activeTool === 'ai_polygon') && aiSegmentPreview && (
            <div className="absolute bottom-14 left-4 flex gap-2">
              <button
                onClick={acceptAiSegmentResult}
                className={`px-4 py-2 ${activeTool === 'semantic_segment' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-purple-600 hover:bg-purple-700'} text-white text-sm font-medium rounded-lg shadow-lg flex items-center gap-2 transition-colors`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                Accept (Score: {(aiSegmentPreview.score * 100).toFixed(0)}%)
              </button>
              <button
                onClick={clearAiSegment}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg shadow-lg transition-colors"
              >
                Clear
              </button>
            </div>
          )}


          {/* Polygon/Polyline drawing controls - Enhanced floating toolbar */}
          {drawingPoints.length > 0 && (activeTool === 'polygon' || activeTool === 'polyline') && (
            <div className="absolute bottom-16 left-4 flex items-center gap-2 bg-dark-panel/95 px-3 py-2 rounded-xl shadow-xl border border-gray-700">
              {/* Point counter badge */}
              <div className="flex items-center gap-2 pr-3 border-r border-gray-600">
                <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white font-bold text-sm">
                  {drawingPoints.length}
                </div>
                <span className="text-xs text-gray-400">points</span>
              </div>

              {/* Undo last point button */}
              <button
                onClick={() => setDrawingPoints(prev => prev.slice(0, -1))}
                className="px-3 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm rounded-lg flex items-center gap-1.5 transition-colors"
                title="Undo last point (Backspace)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                Undo
              </button>

              {/* Finish button - only show when enough points */}
              {((activeTool === 'polygon' && drawingPoints.length >= 3) ||
                (activeTool === 'polyline' && drawingPoints.length >= 2)) && (
                <button
                  onClick={finishPolygon}
                  className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-lg flex items-center gap-2 transition-colors shadow-md"
                  title={activeTool === 'polyline' ? 'Finish drawing (Enter, Right-click, or Double-click)' : 'Finish drawing (Enter)'}
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  {activeTool === 'polygon' ? 'Close Polygon' : '✓ Finish Line'}
                </button>
              )}

              {/* Cancel button */}
              <button
                onClick={() => setDrawingPoints([])}
                className="px-3 py-2 bg-red-900/50 hover:bg-red-800/50 text-red-300 text-sm rounded-lg flex items-center gap-1.5 transition-colors"
                title="Cancel (Escape)"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {/* Snap hint for polygon */}
              {activeTool === 'polygon' && drawingPoints.length >= 3 && (
                <div className="ml-2 text-xs text-green-400 flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Click near first point to close
                </div>
              )}
            </div>
          )}

          {/* Polygon/Segment Editing Controls - only for polygon and semantic_segment types */}
          {(() => {
            if (selectedIds.length !== 1) return null;
            const selectedAnn = annotations.get(selectedIds[0]);
            if (!selectedAnn) return null;
            if (!['polygon', 'semantic_segment'].includes(selectedAnn.type)) return null;
            if (selectedAnn.isLocked) return null;

            const data = selectedAnn.data as any;
            const points = data.polygon || data.points || [];
            const pointCount = points.length;
            const isSmooth = data.isSmooth || false;

            return (
              <div className="absolute bottom-16 right-4 flex items-center gap-2 bg-dark-panel/95 px-3 py-2 rounded-xl shadow-xl border border-gray-700">
                {/* Point counter */}
                <div className="flex items-center gap-2 pr-3 border-r border-gray-600">
                  <div className="w-7 h-7 rounded-full bg-violet-600 flex items-center justify-center text-white font-bold text-xs">
                    {pointCount}
                  </div>
                  <span className="text-xs text-gray-400">pts</span>
                </div>

                {/* Simplify button */}
                <button
                  onClick={() => {
                    if (pointCount > 10) {
                      const simplified = douglasPeucker(points, 3.0);
                      const updateField = data.polygon ? 'polygon' : 'points';
                      updateAnnotationWithSourceTracking(selectedAnn.id, {
                        data: { ...data, [updateField]: simplified },
                      });
                    }
                  }}
                  disabled={pointCount <= 10}
                  className={`px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition-colors ${
                    pointCount > 10
                      ? 'bg-orange-600 hover:bg-orange-700 text-white'
                      : 'bg-gray-700 text-gray-500 cursor-not-allowed'
                  }`}
                  title="Reduce points while preserving shape (Douglas-Peucker algorithm)"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                  Simplify
                </button>

                {/* Smooth toggle */}
                <button
                  onClick={() => {
                    updateAnnotationWithSourceTracking(selectedAnn.id, {
                      data: { ...data, isSmooth: !isSmooth, tension: 0.5 },
                    });
                  }}
                  className={`px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition-colors ${
                    isSmooth
                      ? 'bg-cyan-600 hover:bg-cyan-700 text-white'
                      : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                  }`}
                  title="Toggle smooth curves (Catmull-Rom spline)"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  {isSmooth ? 'Smooth' : 'Sharp'}
                </button>

                {/* Auto-fit button - closes gaps and optimizes */}
                <button
                  onClick={() => {
                    // Auto-fit: Apply Douglas-Peucker with lower tolerance, then re-distribute points
                    const simplified = douglasPeucker(points, 1.5);

                    // Ensure minimum points for a valid polygon
                    if (simplified.length >= 3) {
                      const updateField = data.polygon ? 'polygon' : 'points';
                      updateAnnotationWithSourceTracking(selectedAnn.id, {
                        data: { ...data, [updateField]: simplified, isSmooth: true, tension: 0.5 },
                      });
                    }
                  }}
                  className="px-3 py-1.5 bg-green-600 hover:bg-green-700 text-white text-xs rounded-lg flex items-center gap-1.5 transition-colors"
                  title="Auto-fit: Simplify and smooth the polygon automatically"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Auto-fit
                </button>

                {/* Help hint */}
                <div className="ml-1 text-[10px] text-gray-500 max-w-[120px]">
                  Click edge to add • Right-click point to delete
                </div>
              </div>
            );
          })()}
        </div>

        {/* Right Panel - Object List - resizable */}
        <div
          ref={rightPanelRef}
          className="bg-dark-panel border-l border-gray-700 flex flex-col flex-shrink-0 relative overflow-hidden"
          style={{ width: rightPanelWidth, minWidth: 280, maxWidth: 800 }}
        >
          {/* Resize handle - positioned at the left edge of the panel */}
          <div
            className={`absolute top-0 bottom-0 cursor-ew-resize z-30 transition-colors ${isResizingPanel ? 'bg-blue-500/60' : 'hover:bg-blue-500/40'}`}
            style={{ left: 0, width: 6 }}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              // Cache the right edge of the panel at the start of drag
              if (rightPanelRef.current) {
                panelRightEdgeRef.current = rightPanelRef.current.getBoundingClientRect().right;
              }
              isResizingPanelRef.current = true;
              setIsResizingPanel(true);
              document.body.style.cursor = 'ew-resize';
              document.body.style.userSelect = 'none';
            }}
          />
          {/* Class Picker - shows when a drawing/AI tool is active, hides during drag placement */}
          {(() => {
            const classPickerTools = ['box', 'rotated_box', 'ellipse', 'polygon', 'polyline', 'points', 'brush', 'ai_track', 'semantic_segment', 'ai_polygon'];
            const showPicker = classPickerTools.includes(activeTool) && !qaMode;
            if (!showPicker || !availableClasses.length) return null;
            return (
              <div className="flex-shrink-0 border-b-2 border-primary/60" style={{ borderLeft: '3px solid #3b82f6' }}>
                <div className="px-3 py-2 border-b border-primary/20 bg-primary/10 flex items-center justify-between">
                  <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Class</span>
                  {pendingDigitDisplay ? (
                    <span className="text-[10px] font-mono bg-primary/30 text-primary px-1.5 py-0.5 rounded border border-primary/50 animate-pulse">
                      #{pendingDigitDisplay}…
                    </span>
                  ) : (
                    <span className="text-[10px] text-primary/60 font-mono">1-9, 0, 10+</span>
                  )}
                </div>
                <div className="max-h-52 overflow-y-auto" ref={classPickerScrollRef}>
                  {availableClasses.map((cls, idx) => {
                    const isSelected = activeClassId === cls.id;
                    const classCount = classAnnotationCounts[cls.id] || 0;
                    return (
                    <button
                      key={cls.id}
                      data-classpicker-id={cls.id}
                      onClick={() => setActiveClass(cls.id)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 text-left transition-all ${
                        isSelected
                          ? 'bg-primary/20 text-white'
                          : 'text-gray-400 hover:bg-dark-hover hover:text-white'
                      }`}
                    >
                      <span className="w-2.5 h-2.5 rounded flex-shrink-0" style={{ backgroundColor: cls.color }} />
                      <span className="text-xs truncate flex-1 flex items-center gap-1.5">
                        {cls.name}
                        {classCount > 0 && (
                          <span className="text-[10px] text-gray-400 font-normal">×{classCount}</span>
                        )}
                      </span>
                      {isSelected && (
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
                    );
                  })}
                </div>
                <div className="px-3 py-1.5 border-t border-primary/20 bg-primary/5 text-[10px] text-primary/50">
                  Type number to select (e.g. 11, 15)
                </div>
              </div>
            );
          })()}

          {/* QA Mode Toggle - hidden during annotation stage */}
          {!isAnnotationStage && (
            <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700 bg-gray-800/50">
              <span className="text-xs font-medium text-gray-400">QA Mode</span>
              <button
                onClick={() => {
                  const newQaMode = !qaMode;
                  setQaMode(newQaMode);
                  if (newQaMode) setActiveTool('select');
                }}
                className={`relative w-9 h-5 rounded-full transition-colors flex-shrink-0 ${
                  qaMode ? 'bg-green-600' : 'bg-gray-600'
                }`}
                title={qaMode ? 'Exit QA Mode' : 'Enter QA Mode - Review annotations systematically'}
              >
                <span
                  className={`absolute left-0.5 top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    qaMode ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
          )}

          {/* QA Panel */}
          {qaMode ? (
            <QAPanel2D
              annotations={Array.from(annotations.values()).filter(a => a.cameraId === selectedCameraId)}
              frameId={frameId}
              frameIds={frames.map(f => f.id)}
              suggestions={qaSuggestions}
              taxonomy={taxonomy}
              isLoading={qaLoading}
              currentFrameIndex={frames.findIndex(f => f.id === frameId)}
              onRefreshSuggestions={refreshQaSuggestions}
              fnMode={fnMode}
              onToggleFnMode={handleToggleFnMode}
              taskId={taskId}
              revisionCount={effectiveRevisionCount}
              taskStage={effectiveStage}
              onZoomToAnnotation={(annotationId, zoomLevel) => {
                // Always set pending zoom - this ensures zoom works even after frame navigation
                // The pending zoom effect will handle selecting and zooming
                setPendingZoom({ annotationId, zoomLevel: zoomLevel || 5 });
              }}
              onSelectAnnotation={(annotationId) => {
                const ann = annotations.get(annotationId);
                if (ann) {
                  select(annotationId);
                }
              }}
              onGoToFrame={(targetFrameIndex) => {
                // Navigate to the specified frame using editorStore
                if (typeof targetFrameIndex === 'number' && targetFrameIndex >= 0 && targetFrameIndex < frames.length) {
                  goToFrameStore(targetFrameIndex);
                }
              }}
              onUpdateAnnotationClass={handleUpdateAnnotationClass}
              onUpdateAnnotationAttributes={(annotationId, attributes) => {
                updateAnnotationWithSourceTracking(annotationId, { attributes });
              }}
              selectedAnnotationId={selectedIds.length > 0 ? selectedIds[0] : null}
            />
          ) : (
            <>
              {/* Tabs - with Fixes tab when in revision mode */}
              <div className="flex border-b border-gray-700/50 bg-gray-900/30">
                <button
                  onClick={() => setRightPanelTab('objects')}
                  className={`flex-1 px-2 py-2 text-xs font-semibold tracking-wide transition-all ${rightPanelTab === 'objects' ? 'text-white border-b-2 border-primary bg-gray-800/40' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/20'}`}
                >
                  Objects <span className={`ml-0.5 text-[10px] ${rightPanelTab === 'objects' ? 'text-primary' : 'text-gray-600'}`}>({objectsPanelAnnotations.length})</span>
                </button>
                <button
                  onClick={() => setRightPanelTab('tracks')}
                  className={`flex-1 px-2 py-2 text-xs font-semibold tracking-wide transition-all ${rightPanelTab === 'tracks' ? 'text-white border-b-2 border-primary bg-gray-800/40' : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/20'}`}
                >
                  Tracks <span className={`ml-0.5 text-[10px] ${rightPanelTab === 'tracks' ? 'text-primary' : 'text-gray-600'}`}>({tracks.filter(t => panelAnnotations.some(a => a.trackId === t.id)).length})</span>
                </button>
                {isRevisionMode && (
                  <button
                    onClick={() => setRightPanelTab('fixes')}
                    className={`flex-1 px-2 py-2 text-xs font-semibold tracking-wide transition-all ${rightPanelTab === 'fixes' ? 'text-white border-b-2 border-red-500 bg-red-900/20' : 'text-red-400 hover:text-red-300 hover:bg-red-900/10'}`}
                  >
                    Fixes <span className={`ml-0.5 text-[10px] ${rightPanelTab === 'fixes' ? 'text-red-400' : 'text-red-600'}`}>⚑</span>
                  </button>
                )}
              </div>

              {/* Fixes Panel (Revision Mode) */}
              {rightPanelTab === 'fixes' && isRevisionMode && taskId && (
                <RevisionPanel2D
                  taskId={taskId}
                  taxonomyId={selectedTaxonomyId}
                  cameraId={selectedCameraId}
                  annotations={Array.from(annotations.values()).filter(a => a.cameraId === selectedCameraId)}
                  frameId={frameId}
                  frameIds={frames.map(f => f.id)}
                  taxonomy={taxonomy}
                  currentFrameIndex={frames.findIndex(f => f.id === frameId)}
                  onZoomToAnnotation={(annotationId, zoomLevel) => {
                    setPendingZoom({ annotationId, zoomLevel: zoomLevel || 5 });
                  }}
                  onSelectAnnotation={(annotationId) => {
                    const ann = annotations.get(annotationId);
                    if (ann) {
                      select(annotationId);
                    }
                  }}
                  onGoToFrame={(targetFrameIndex) => {
                    if (typeof targetFrameIndex === 'number' && targetFrameIndex >= 0 && targetFrameIndex < frames.length) {
                      goToFrameStore(targetFrameIndex);
                    }
                  }}
                  onSubmitFixes={() => {
                    // Refresh the page to reload task state (now in QA stage)
                    window.location.reload();
                  }}
                />
              )}

              {/* Objects List */}
              {rightPanelTab === 'objects' && (
            <div className="flex-1 overflow-y-auto p-2">
              {objectsPanelAnnotations.length === 0 ? (
                <div className="text-center py-6">
                  <svg className="w-7 h-7 mx-auto text-gray-600 mb-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
                  </svg>
                  <p className="text-[10px] text-gray-500">No annotations yet</p>
                  <p className="text-[9px] text-gray-600">Draw a box or shape to create one</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {objectsPanelAnnotations.map((ann) => {
                    const isSelected = selectedIds.includes(ann.id);
                    const classInfo = availableClasses.find(c => c.id === ann.classId);
                    // If classId is empty/undefined/'unknown' or not found, show a formatted version or "Unclassified"
                    const isUnknownOrEmpty = !ann.classId || ann.classId.trim() === '' || ann.classId === 'unknown';
                    const className = classInfo?.name || (isUnknownOrEmpty
                      ? 'Unclassified'
                      : ann.classId.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
                    const color = isUnknownOrEmpty ? '#6b7280' : getAnnotationColor(ann);
                    const track = ann.trackId ? tracks.find(t => t.id === ann.trackId) : null;

                    const isExpanded = expandedPanelId === ann.id;

                    return (
                      <div
                        key={ann.id}
                        ref={(el) => {
                          if (el && isSelected) {
                            el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                          }
                        }}
                        className={`group rounded-md transition-all duration-150 ${
                          isSelected
                            ? 'bg-primary/15 ring-1 ring-primary/60 shadow-sm shadow-primary/10'
                            : 'bg-gray-800/40 hover:bg-gray-800/70 ring-1 ring-gray-700/50 hover:ring-gray-600/50'
                        } ${ann.isHidden ? 'opacity-50' : ''} ${ann.isLocked ? 'ring-l-2 ring-l-yellow-500' : ''}`}
                      >
                        {/* Header row - click to select & pan, chevron to expand */}
                        <div className="flex items-center gap-1 px-2 py-1.5 cursor-pointer"
                          onClick={() => {
                            select(ann.id);
                            panToAnnotation(ann.id);
                            if (!isExpanded) setExpandedPanelId(ann.id);
                          }}
                        >
                          {/* Expand chevron */}
                          <button
                            onClick={(e) => { e.stopPropagation(); setExpandedPanelId(isExpanded ? null : ann.id); }}
                            className="p-0 text-gray-500 hover:text-white flex-shrink-0"
                          >
                            <svg className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                          <div
                            className={`w-2.5 h-2.5 rounded flex-shrink-0 ring-1 ring-white/20 ${ann.isHidden ? 'opacity-50' : ''}`}
                            style={{ backgroundColor: color }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1">
                              <span className={`text-[11px] font-medium truncate ${ann.isHidden ? 'text-gray-500 line-through' : 'text-white'}`}>{className}</span>
                              <span className={`text-[8px] px-1 py-0 rounded ${ann.type === 'semantic_segment' ? 'bg-purple-500/20 text-purple-400' : 'bg-gray-700/60 text-gray-500'}`}>
                                {formatAnnotationType(ann.type)}
                              </span>
                              {track ? (
                                <span className="text-[8px] px-1 py-0 rounded bg-cyan-500/15 text-cyan-400 truncate max-w-[90px]" title={`${track.name ? track.name + ' · ' : ''}id: ${track.id}`}>
                                  {track.name ? `${track.name} · ` : ''}#{track.id.substring(0, 6)}
                                </span>
                              ) : ann.trackId ? (
                                <span className="text-[8px] px-1 py-0 rounded bg-cyan-500/15 text-cyan-400 truncate max-w-[90px]" title={`id: ${ann.trackId}`}>
                                  #{ann.trackId.substring(0, 6)}
                                </span>
                              ) : null}
                              {ann.source === 'auto' && <span className="text-[8px] text-amber-400" title="Auto">A</span>}
                            </div>
                          </div>
                          {/* Create track button - show for any untracked annotation */}
                          {!ann.trackId && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                const newTrack = await createTrackWithAnnotation(ann.classId);
                                if (newTrack) {
                                  await assignAnnotationToTrack(ann.id, newTrack.id);
                                }
                              }}
                              className="p-0.5 rounded hover:bg-cyan-500/30 text-cyan-400 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all"
                              title="Create new track for this annotation"
                            >
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                              </svg>
                            </button>
                          )}
                          {/* Compact action buttons */}
                          <div className="flex items-center gap-0.5 flex-shrink-0">
                            <button onClick={(e) => { e.stopPropagation(); toggleVisibility(ann.id); }}
                              className={`p-0.5 rounded transition-colors ${ann.isHidden ? 'text-yellow-400' : 'text-gray-500 hover:text-white'}`}
                              title={ann.isHidden ? 'Show' : 'Hide'}>
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                {ann.isHidden
                                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M3 3l18 18" />
                                  : <><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></>
                                }
                              </svg>
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); toggleLock(ann.id); }}
                              className={`p-0.5 rounded transition-colors ${ann.isLocked ? 'text-yellow-400' : 'text-gray-500 hover:text-white'}`}
                              title={ann.isLocked ? 'Unlock' : 'Lock'}>
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                {ann.isLocked
                                  ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                                  : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                                }
                              </svg>
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); if (confirm('Delete this annotation?')) handleDeleteAnnotation(ann.id); }}
                              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-500/30 text-red-400 transition-all"
                              title="Delete">
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Expanded panel - collapsible */}
                        {isExpanded && (
                          <div className="px-2 pb-2 pt-1 border-t border-gray-700/40 space-y-1.5">
                            {/* Row 1: Class + Track assignment */}
                            <div className="flex gap-1.5">
                              <div className="flex-1 min-w-0">
                                <label className="text-[8px] uppercase tracking-wider text-gray-500">Class</label>
                                <select
                                  onClick={(e) => e.stopPropagation()}
                                  value={ann.classId}
                                  onChange={(e) => handleUpdateAnnotationClass(ann.id, e.target.value)}
                                  className="w-full text-[10px] bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-white cursor-pointer mt-0.5"
                                >
                                  {availableClasses.map((cls) => (
                                    <option key={cls.id} value={cls.id}>{cls.name}</option>
                                  ))}
                                </select>
                              </div>
                              {/* Track section - available for all annotation types */}
                              <div className="flex-1 min-w-0">
                                <label className="text-[8px] uppercase tracking-wider text-gray-500">Track</label>
                                {track ? (
                                  <div className="flex items-center gap-1 mt-0.5 bg-gray-800 border border-gray-600 rounded px-1 py-0.5">
                                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: track.color || '#3b82f6' }} />
                                    <span className="text-[10px] text-cyan-400 flex-1 truncate">{track.name || track.id.substring(0, 6)}</span>
                                    <button onClick={(e) => { e.stopPropagation(); assignAnnotationToTrack(ann.id, ''); updateAnnotationWithSourceTracking(ann.id, { trackId: undefined }); }}
                                      className="text-[9px] text-red-400 hover:text-red-300 flex-shrink-0" title="Unlink">✕</button>
                                  </div>
                                ) : (
                                  <select onClick={(e) => e.stopPropagation()}
                                    onChange={(e) => { if (e.target.value === '__new__') { createTrackWithAnnotation(ann.classId).then(t => { if (t) assignAnnotationToTrack(ann.id, t.id); }); } else if (e.target.value) { assignAnnotationToTrack(ann.id, e.target.value); } }}
                                    value=""
                                    className="w-full text-[10px] bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-gray-400 cursor-pointer mt-0.5"
                                  >
                                    <option value="">None</option>
                                    {tracks.filter(t => Array.from(annotations.values()).some(a => a.trackId === t.id)).map((t) => (
                                      <option key={t.id} value={t.id}>{t.name || t.id.substring(0, 8)}</option>
                                    ))}
                                    <option value="__new__">+ New Track</option>
                                  </select>
                                )}
                              </div>
                            </div>

                            {/* Attributes — merges class-specific with shared
                                attributes (applies_to) so taxonomy-level attrs
                                like `difficulty` show up on every applicable
                                annotation, matching the 3D PropertiesPanel. */}
                            {taxonomy && ((): React.ReactNode => {
                              // Helper expects full Taxonomy/TaxonomyConfig but only reads
                              // `classes` and `shared_attributes` — both present in our slim
                              // prop. Cast through unknown to satisfy the structural check.
                              const effectiveAttrs = getEffectiveAttributesForClass(
                                ann.classId,
                                taxonomy as unknown as Parameters<typeof getEffectiveAttributesForClass>[1],
                              );
                              return Object.keys(effectiveAttrs).length > 0 ? (
                                <div>
                                  <label className="text-[8px] uppercase tracking-wider text-gray-500 block mb-0.5">Attributes</label>
                                  <div className="space-y-1">
                                    {Object.entries(effectiveAttrs).map(([key, def]) => (
                                      <div key={key} className="flex items-center gap-1.5">
                                        <label className="text-[9px] text-gray-400 w-16 truncate flex-shrink-0" title={key}>{key}</label>
                                        {def.type === 'boolean' ? (
                                          <button
                                            onClick={(e) => { e.stopPropagation(); handleAnnotationAttributeChange(ann.id, { ...(ann.attributes || {}), [key]: !(ann.attributes?.[key]) }); }}
                                            className={`px-1.5 py-0 text-[9px] rounded ${ann.attributes?.[key] ? 'bg-primary/30 text-primary' : 'bg-gray-700 text-gray-400'}`}
                                          >{ann.attributes?.[key] ? 'Yes' : 'No'}</button>
                                        ) : def.type === 'enum' && def.options ? (
                                          <select value={(ann.attributes?.[key] as string) ?? (def.default as string) ?? ''}
                                            onChange={(e) => { e.stopPropagation(); handleAnnotationAttributeChange(ann.id, { ...(ann.attributes || {}), [key]: e.target.value }); }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="flex-1 bg-gray-800 border border-gray-600 rounded px-1 py-0 text-[9px] text-white"
                                          >
                                            {def.options.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                                          </select>
                                        ) : def.type === 'number' ? (
                                          <input type="number" value={(ann.attributes?.[key] as number) ?? ''}
                                            onChange={(e) => { e.stopPropagation(); handleAnnotationAttributeChange(ann.id, { ...(ann.attributes || {}), [key]: parseFloat(e.target.value) || 0 }); }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="flex-1 bg-gray-800 border border-gray-600 rounded px-1 py-0 text-[9px] text-white" placeholder="0"
                                          />
                                        ) : (
                                          <input type="text" value={(ann.attributes?.[key] as string) ?? ''}
                                            onChange={(e) => { e.stopPropagation(); handleAnnotationAttributeChange(ann.id, { ...(ann.attributes || {}), [key]: e.target.value }); }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="flex-1 bg-gray-800 border border-gray-600 rounded px-1 py-0 text-[9px] text-white" placeholder="..."
                                          />
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null;
                            })()}

                            {/* Quick actions row */}
                            <div className="flex items-center gap-1">
                              <button onClick={(e) => { e.stopPropagation(); handleDuplicateAnnotation(ann.id); }}
                                className="flex-1 px-1 py-0.5 text-[8px] bg-gray-700 hover:bg-gray-600 text-white rounded text-center" title="Duplicate (Ctrl+D)">Dup</button>
                              <button onClick={(e) => { e.stopPropagation(); handleBringToFront(ann.id); }}
                                className="px-1.5 py-0.5 text-[8px] bg-gray-700 hover:bg-gray-600 text-white rounded" title="Bring to front">
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" /></svg>
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); handleSendToBack(ann.id); }}
                                className="px-1.5 py-0.5 text-[8px] bg-gray-700 hover:bg-gray-600 text-white rounded" title="Send to back">
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                              </button>
                              {ann.type === 'polygon' && (
                                <button onClick={(e) => { e.stopPropagation(); handleConvertToSemanticSegment(ann.id); }}
                                  className="px-1.5 py-0.5 text-[8px] bg-purple-600/20 hover:bg-purple-600/40 text-purple-300 rounded border border-purple-600/30" title="Convert to Segment">Seg</button>
                              )}
                              <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete this ${className}?`)) handleDeleteAnnotation(ann.id); }}
                                className="px-1.5 py-0.5 text-[8px] bg-red-600/20 hover:bg-red-600/40 text-red-400 rounded border border-red-600/30" title="Delete">
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                              </button>
                            </div>

                            {/* IDs row - compact inline */}
                            <div className="flex gap-1 pt-1 border-t border-gray-700/30">
                              <div className="flex-1 min-w-0">
                                <label className="text-[7px] uppercase text-gray-600">Ann ID</label>
                                <div className="flex items-center gap-0.5">
                                  <input type="text" value={ann.id} readOnly
                                    onClick={(e) => { e.stopPropagation(); (e.target as HTMLInputElement).select(); }}
                                    className="flex-1 min-w-0 text-[8px] bg-gray-900/60 border border-gray-700 rounded px-1 py-0 text-gray-400 font-mono select-all"
                                  />
                                  <button onClick={(e) => { e.stopPropagation(); handleCopyId(ann.id); }}
                                    className="p-0 text-gray-500 hover:text-white flex-shrink-0" title="Copy">
                                    <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                  </button>
                                </div>
                              </div>
                              {ann.trackId && (
                                <div className="flex-1 min-w-0">
                                  <label className="text-[7px] uppercase text-gray-600">Track ID</label>
                                  <div className="flex items-center gap-0.5">
                                    <input type="text" value={ann.trackId} readOnly
                                      onClick={(e) => { e.stopPropagation(); (e.target as HTMLInputElement).select(); }}
                                      className="flex-1 min-w-0 text-[8px] bg-gray-900/60 border border-gray-700 rounded px-1 py-0 text-cyan-400/70 font-mono select-all"
                                    />
                                    <button onClick={(e) => { e.stopPropagation(); handleCopyId(ann.trackId!); }}
                                      className="p-0 text-gray-500 hover:text-white flex-shrink-0" title="Copy">
                                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tracks List */}
          {rightPanelTab === 'tracks' && (
            <div className="flex-1 overflow-y-auto p-2">
              {/* Help section - collapsible */}
              <div className="mb-1.5">
                <button
                  onClick={() => setShowTrackHelp(!showTrackHelp)}
                  className="w-full flex items-center justify-between px-2 py-1 bg-gray-800/30 hover:bg-gray-800/50 rounded text-[10px] text-gray-400 transition-colors"
                >
                  <span className="flex items-center gap-1">
                    <span>📌</span>
                    <span>How Tracking Works</span>
                  </span>
                  <svg className={`w-3 h-3 transition-transform ${showTrackHelp ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showTrackHelp && (
                  <div className="mt-1 p-1.5 bg-gray-800/50 rounded text-[10px] text-gray-400 border border-gray-700/50">
                    <ol className="list-decimal list-inside space-y-0.5">
                      <li>Click "New Track" then draw an annotation</li>
                      <li>Track is created with your first keyframe</li>
                      <li>Click a track to make it <span className="text-cyan-400">active</span></li>
                      <li>Navigate frames & draw more keyframes</li>
                    </ol>
                    <div className="mt-1.5 pt-1 border-t border-gray-700/50">
                      <div className="flex items-center gap-2 text-[9px]">
                        <span className="inline-flex items-center gap-1">
                          <span className="w-3 h-0.5 bg-cyan-400" style={{ borderTop: '2px dashed #22d3ee' }}></span>
                          <span className="text-cyan-400">Tracked</span>
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <span className="w-3 h-0.5 bg-blue-400"></span>
                          <span className="text-gray-400">Untracked</span>
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={startNewTrack}
                disabled={pendingNewTrack}
                className={`w-full mb-1.5 px-2 py-1.5 rounded text-xs font-medium flex items-center justify-center gap-1.5 ${
                  pendingNewTrack
                    ? 'bg-green-500/20 border border-green-500/50 text-green-400'
                    : 'bg-primary/20 hover:bg-primary/30 border border-primary/30 text-primary'
                }`}
              >
                {pendingNewTrack ? (
                  <>
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    Draw to Create Track
                  </>
                ) : (
                  <>
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    New Track
                  </>
                )}
              </button>

              {/* Pending track indicator */}
              {pendingNewTrack && (
                <div className="mb-1.5 p-1.5 bg-green-500/10 border border-green-500/30 rounded flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                    <span className="text-[10px] text-green-300">
                      Draw an annotation to create the track
                    </span>
                  </div>
                  <button
                    onClick={() => setPendingNewTrack(false)}
                    className="text-[8px] text-gray-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              )}

              {/* Active track indicator */}
              {activeTrackId && !pendingNewTrack && (
                <div className="mb-1.5 p-1.5 bg-cyan-500/10 border border-cyan-500/30 rounded flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    <span className="text-[10px] text-cyan-300">
                      Active: {tracks.find(t => t.id === activeTrackId)?.name || 'Track'}
                    </span>
                  </div>
                  <button
                    onClick={() => setActiveTrackId(null)}
                    className="text-[8px] text-gray-400 hover:text-white"
                  >
                    ✕
                  </button>
                </div>
              )}

              {tracks.length === 0 && !pendingNewTrack ? (
                <div className="text-center py-6">
                  <svg className="w-7 h-7 mx-auto text-gray-600 mb-1.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <p className="text-[10px] text-gray-500">No tracks yet</p>
                  <p className="text-[9px] text-gray-600">Click "New Track" then draw an annotation</p>
                </div>
              ) : tracks.length === 0 ? null : (
                <>
                  {/* Batch Propagate Button */}
                  {selectedTrackIds.size > 0 && (
                    <div className="mb-1.5 p-1.5 bg-cyan-500/10 border border-cyan-500/30 rounded space-y-1">
                      <button
                        onClick={() => {
                          setShowPropagateDialog(true);
                          setPropagateTrackId('__batch__'); // Special ID for batch mode
                        }}
                        disabled={propagateStatus === 'propagating' || !getFrameImageUrl}
                        className={`w-full px-2 py-1.5 rounded text-[10px] font-medium transition-colors flex items-center justify-center gap-1.5 ${
                          propagateStatus === 'propagating'
                            ? 'bg-cyan-600/50 text-cyan-300 cursor-wait'
                            : !getFrameImageUrl
                            ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                            : 'bg-cyan-600 text-white hover:bg-cyan-700'
                        }`}
                        title={!getFrameImageUrl ? 'Video propagation not available' : 'Propagate all selected tracks'}
                      >
                        {propagateStatus === 'propagating' ? (
                          <>
                            <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            Propagating {propagatingTracks.size}/{selectedTrackIds.size}...
                          </>
                        ) : (
                          <>
                            <span>🎯</span>
                            Propagate Selected ({selectedTrackIds.size})
                          </>
                        )}
                      </button>
                      {selectedTrackIds.size >= 2 && (
                        <button
                          onClick={handleMergeTracks}
                          className="w-full px-2 py-1.5 rounded text-[10px] font-medium transition-colors flex items-center justify-center gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
                          title={`Merge ${selectedTrackIds.size} tracks into one`}
                        >
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                          </svg>
                          Merge Selected ({selectedTrackIds.size})
                        </button>
                      )}
                      <button
                        onClick={() => setSelectedTrackIds(new Set())}
                        className="w-full mt-0.5 px-1.5 py-0.5 text-[8px] text-gray-400 hover:text-white"
                      >
                        Clear Selection
                      </button>
                    </div>
                  )}

                <div className="space-y-1.5">
                  {tracks.filter(track => {
                    // Only show tracks that have annotations in the current frame
                    return panelAnnotations.some(a => a.trackId === track.id);
                  }).map((track) => {
                    const isActive = activeTrackId === track.id;
                    const trackClassInfo = availableClasses.find(c => c.id === track.class_id);
                    // Count all annotations for this track (across all frames, not just current)
                    const allTrackAnnotations = Array.from(annotations.values()).filter(
                      a => a.trackId === track.id && a.cameraId === selectedCameraId
                    );
                    // Keyframes are human-edited only (not interpolated AND not propagated)
                    const keyframeCount = allTrackAnnotations.filter(a => !a.attributes?.interpolated && !a.attributes?.propagated).length;
                    const interpolatedCount = allTrackAnnotations.filter(a => a.attributes?.interpolated).length;
                    const propagatedCount = allTrackAnnotations.filter(a => a.attributes?.propagated).length;

                    return (
                      <div
                        key={track.id}
                        ref={(el) => {
                          if (el) trackRowRefs.current.set(track.id, el);
                          else trackRowRefs.current.delete(track.id);
                        }}
                        className={`group rounded-md transition-all duration-150 ${
                          isActive
                            ? 'bg-cyan-500/15 ring-1 ring-cyan-500/60 shadow-sm shadow-cyan-500/10'
                            : 'bg-gray-800/40 hover:bg-gray-800/70 ring-1 ring-gray-700/50 hover:ring-gray-600/50'
                        }`}
                      >
                        {/* Track header */}
                        <div
                          className="flex items-center gap-1.5 cursor-pointer px-2 py-1.5"
                          onClick={() => {
                            const wasActive = isActive;
                            setActiveTrackId(isActive ? null : track.id);

                            // If activating the track, find and pan to its annotation in current frame
                            if (!wasActive) {
                              const trackAnnotation = panelAnnotations.find(a => a.trackId === track.id);
                              if (trackAnnotation) {
                                select(trackAnnotation.id);
                                panToAnnotation(trackAnnotation.id);
                              }
                            }
                          }}
                        >
                          {/* Checkbox for multi-select */}
                          <input
                            type="checkbox"
                            checked={selectedTrackIds.has(track.id)}
                            onChange={(e) => {
                              e.stopPropagation();
                              const newSelected = new Set(selectedTrackIds);
                              if (e.target.checked) {
                                newSelected.add(track.id);
                              } else {
                                newSelected.delete(track.id);
                              }
                              setSelectedTrackIds(newSelected);
                            }}
                            className="w-3 h-3 rounded border-gray-600 bg-gray-800 text-cyan-500 focus:ring-2 focus:ring-cyan-500 focus:ring-offset-0 cursor-pointer"
                            title="Select for batch propagation"
                          />

                          <div
                            className="w-2.5 h-2.5 rounded flex-shrink-0 ring-1 ring-white/20"
                            style={{ backgroundColor: track.color || '#3b82f6' }}
                          />
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-[11px] font-medium text-white truncate leading-tight">{track.name || track.id.substring(0, 8)}</p>
                              {track.is_complete && (
                                <span className="text-[9px] bg-green-500/20 text-green-400 px-1 py-0.5 rounded">✓</span>
                              )}
                            </div>
                            <p className="text-[9px] text-gray-500 leading-tight">
                              {trackClassInfo?.name || 'Unknown'} · {keyframeCount} kf{keyframeCount !== 1 ? 's' : ''}
                              {interpolatedCount > 0 && (
                                <span className="text-purple-400"> +{interpolatedCount}i</span>
                              )}
                              {propagatedCount > 0 && (
                                <span className="text-cyan-400"> +{propagatedCount}p</span>
                              )}
                            </p>
                          </div>
                          {/* Action buttons - visible on hover */}
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            {/* Edit button */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setActiveTrackId(track.id);
                              }}
                              className="p-0.5 rounded hover:bg-blue-500/30 text-blue-400"
                              title="Edit track"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                              </svg>
                            </button>
                            {/* Delete button - opens dropdown */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const choice = window.confirm(
                                  `Delete track "${track.name || 'Unnamed'}" and ALL ${keyframeCount + interpolatedCount} annotations?\n\nClick OK to delete everything.\nClick Cancel to keep annotations (only removes track).`
                                );
                                handleDeleteTrack(track.id, choice);
                              }}
                              className="p-0.5 rounded hover:bg-red-500/30 text-red-400"
                              title="Delete track and annotations"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                          {isActive && (
                            <span className="text-[8px] bg-cyan-500/30 text-cyan-300 px-1 py-0 rounded flex-shrink-0">Active</span>
                          )}
                        </div>

                        {/* Expanded edit options when active */}
                        {isActive && (
                          <div className="mx-2 mb-2 mt-1 pt-1.5 border-t border-gray-700/50 space-y-1.5">
                            {/* Name + Class row */}
                            <div className="flex gap-1.5">
                              <div className="flex-1 min-w-0">
                                <label className="text-[8px] uppercase tracking-wider text-gray-500">Name</label>
                                <input type="text" value={track.name || ''} onChange={(e) => handleUpdateTrackName(track.id, e.target.value)}
                                  onClick={(e) => e.stopPropagation()} placeholder="Track name..."
                                  className="w-full text-[10px] bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-white placeholder-gray-500 mt-0.5" />
                              </div>
                              <div className="flex-1 min-w-0">
                                <label className="text-[8px] uppercase tracking-wider text-gray-500">Class</label>
                                <select value={track.class_id} onChange={(e) => handleUpdateTrackClass(track.id, e.target.value)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="w-full text-[10px] bg-gray-800 border border-gray-600 rounded px-1 py-0.5 text-white cursor-pointer mt-0.5">
                                  {availableClasses.map((cls) => <option key={cls.id} value={cls.id}>{cls.name}</option>)}
                                </select>
                              </div>
                            </div>

                            {/* Interpolate + AI Propagate row */}
                            <div className="flex gap-1">
                            <button onClick={(e) => { e.stopPropagation(); interpolateTrack(track.id); }}
                              disabled={keyframeCount < 2 || interpolateStatus === 'interpolating'}
                              className={`flex-1 px-1 py-0.5 rounded text-[9px] font-medium transition-colors flex items-center justify-center gap-0.5 ${
                                keyframeCount < 2 ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                : interpolateStatus === 'interpolating' ? 'bg-purple-600/50 text-purple-300 cursor-wait'
                                : track.is_interpolated ? 'bg-purple-600/30 text-purple-300 hover:bg-purple-600/50'
                                : 'bg-purple-600 text-white hover:bg-purple-700'
                              }`} title={keyframeCount < 2 ? 'Need 2+ keyframes' : 'Interpolate'}>
                              {interpolateStatus === 'interpolating' ? '...' : <><span>⚡</span>{track.is_interpolated ? 'Re-int.' : 'Interp.'}</>}
                            </button>
                            <button onClick={(e) => {
                                e.stopPropagation();
                                const hasCurrentFrameAnnotation = Array.from(annotations.values()).some(
                                  ann => ann.trackId === track.id && ann.frameId === frameId && ann.cameraId === selectedCameraId
                                );
                                if (!hasCurrentFrameAnnotation) { alert('Draw a box on the current frame first.'); return; }
                                setPropagateTrackId(track.id); setShowPropagateDialog(true);
                              }}
                              disabled={propagateStatus === 'propagating' || !getFrameImageUrl}
                              className={`flex-1 px-1 py-0.5 rounded text-[9px] font-medium transition-colors flex items-center justify-center gap-0.5 ${
                                propagateStatus === 'propagating' && propagateTrackId === track.id ? 'bg-cyan-600/50 text-cyan-300 cursor-wait'
                                : !getFrameImageUrl ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                                : 'bg-cyan-600 text-white hover:bg-cyan-700'
                              }`} title="AI Propagate">
                              {propagateStatus === 'propagating' && propagateTrackId === track.id ? '...' : <><span>🎯</span>AI Prop.</>}
                            </button>
                            </div>

                            {/* Mark done + actions */}
                            <div className="flex items-center gap-1">
                              <button onClick={(e) => { e.stopPropagation(); handleToggleTrackComplete(track.id); }}
                                className={`flex-1 px-1 py-0.5 text-[8px] rounded flex items-center justify-center gap-0.5 ${
                                  track.is_complete ? 'bg-green-600/20 text-green-400 hover:bg-green-600/30' : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                                }`} title={track.is_complete ? 'Mark incomplete' : 'Mark complete'}>
                                <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                                {track.is_complete ? 'Done' : 'Mark Done'}
                              </button>
                            </div>

                            {/* Merge into this track */}
                            {tracks.filter(t => t.id !== track.id && Array.from(annotations.values()).some(a => a.trackId === t.id)).length > 0 && (
                              <div className="flex items-center gap-1">
                                <select
                                  onClick={(e) => e.stopPropagation()}
                                  onChange={async (e) => {
                                    e.stopPropagation();
                                    const sourceId = e.target.value;
                                    if (!sourceId) return;
                                    const sourceTrack = tracks.find(t => t.id === sourceId);
                                    const sourceAnnCount = Array.from(annotations.values()).filter(a => a.trackId === sourceId).length;
                                    const confirmed = window.confirm(
                                      `Merge "${sourceTrack?.name || 'Unnamed'}" (${sourceAnnCount} annotations) into "${track.name || 'Unnamed'}"?\n\nSource track will be deleted.`
                                    );
                                    if (!confirmed) { e.target.value = ''; return; }
                                    try {
                                      const updated = await track2DApi.merge(track.id, [sourceId]);
                                      // Reassign local annotations, keeping the target's
                                      // lane on any frame both tracks occupy (one lane/frame).
                                      const mergeStore = useAnnotation2DStore.getState();
                                      const occupiedFrames = new Set(
                                        Array.from(annotations.values()).filter(a => a.trackId === track.id).map(a => a.frameId)
                                      );
                                      const srcAnns = Array.from(annotations.values()).filter(a => a.trackId === sourceId);
                                      for (const ann of srcAnns) {
                                        if (occupiedFrames.has(ann.frameId)) {
                                          mergeStore.deleteAnnotation(ann.id);
                                        } else {
                                          occupiedFrames.add(ann.frameId);
                                          updateAnnotationWithSourceTracking(ann.id, { trackId: track.id });
                                        }
                                      }
                                      setTracks(prev => prev.filter(t => t.id !== sourceId).map(t => t.id === track.id ? { ...t, ...updated } : t));
                                      setSelectedTrackIds(prev => { const n = new Set(prev); n.delete(sourceId); return n; });
                                    } catch (err) {
                                      console.error('Merge failed:', err);
                                      alert('Merge failed. Please try again.');
                                    }
                                    e.target.value = '';
                                  }}
                                  className="flex-1 text-[9px] bg-amber-900/30 border border-amber-600/40 rounded px-1 py-0.5 text-amber-300 cursor-pointer"
                                  defaultValue=""
                                >
                                  <option value="" disabled>⤵ Merge another track into this…</option>
                                  {tracks.filter(t => t.id !== track.id && Array.from(annotations.values()).some(a => a.trackId === t.id)).map(t => (
                                    <option key={t.id} value={t.id}>
                                      {t.name || 'Unnamed'} ({Array.from(annotations.values()).filter(a => a.trackId === t.id).length} ann.)
                                    </option>
                                  ))}
                                </select>
                              </div>
                            )}

                            {/* Track ID - compact */}
                            <div className="pt-1 border-t border-gray-700/30">
                              <label className="text-[7px] uppercase text-gray-600">Track ID</label>
                              <div className="flex items-center gap-0.5">
                                <input type="text" value={track.id} readOnly
                                  onClick={(e) => { e.stopPropagation(); (e.target as HTMLInputElement).select(); }}
                                  className="flex-1 min-w-0 text-[8px] bg-gray-900/60 border border-gray-700 rounded px-1 py-0 text-cyan-400/70 font-mono select-all" />
                                <button onClick={(e) => { e.stopPropagation(); handleCopyId(track.id); }}
                                  className="p-0 text-gray-500 hover:text-white flex-shrink-0" title="Copy">
                                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
                                </button>
                              </div>
                            </div>

                            {/* Delete Track buttons */}
                          </div>
                        )}

                        {/* Collapsed state - quick actions */}
                        {!isActive && (
                          <div className="px-2 pb-1.5 flex items-center gap-1.5">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                interpolateTrack(track.id);
                              }}
                              disabled={keyframeCount < 2 || interpolateStatus === 'interpolating'}
                              className={`flex-1 px-1.5 py-0.5 rounded text-[8px] font-medium transition-colors ${
                                keyframeCount < 2
                                  ? 'bg-gray-700/50 text-gray-500 cursor-not-allowed'
                                  : interpolateStatus === 'interpolating'
                                  ? 'bg-purple-600/50 text-purple-300 cursor-wait'
                                  : track.is_interpolated
                                  ? 'bg-purple-600/20 text-purple-300 hover:bg-purple-600/40'
                                  : 'bg-purple-600/80 text-white hover:bg-purple-600'
                              }`}
                              title={keyframeCount < 2 ? 'Need at least 2 keyframes' : 'Interpolate between keyframes'}
                            >
                              {interpolateStatus === 'interpolating' ? '…' : (
                                <>⚡ {track.is_interpolated ? 'Re-int.' : 'Interpolate'}</>
                              )}
                            </button>
                            {track.is_complete && (
                              <span className="text-[8px] text-green-400">✓</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                </>
              )}
            </div>
          )}


          {/* Bulk Delete Options - hidden in QA mode and only shown in Objects tab */}
          {!qaMode && rightPanelTab === 'objects' && (
            <div className="p-3 border-t border-gray-700">
              <p className="text-xs text-gray-500 mb-2 font-medium">Bulk Delete</p>
              <div className="space-y-2">
              {/* Delete frame annotations */}
              <button
                onClick={() => handleDeleteAllFrameAnnotations(false)}
                disabled={panelAnnotations.length === 0}
                className="w-full py-1.5 px-3 rounded text-xs transition-colors flex items-center justify-center gap-2 bg-orange-600/20 hover:bg-orange-600/40 text-orange-400 border border-orange-600/30 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Delete all annotations on current frame for this camera"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
                Clear Frame ({panelAnnotations.length})
              </button>


            </div>
            </div>
          )}
            </>
          )}
        </div>
      </div>

      {/* SAM2 Propagation Dialog */}
      {showPropagateDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-dark-card border border-gray-700 rounded-lg shadow-xl w-96 max-w-[90vw]">
            <div className="p-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <span>🎯</span>
                {propagateTrackId === '__batch__'
                  ? `AI Batch Propagation (${selectedTrackIds.size} tracks)`
                  : 'AI Propagation (SAM2)'
                }
              </h3>
              <p className="text-sm text-gray-400 mt-1">
                {propagateTrackId === '__batch__'
                  ? `Track ${selectedTrackIds.size} objects forward from current frame using AI`
                  : 'Track object forward from current frame using AI'
                }
              </p>
            </div>

            <div className="p-4 space-y-4">
              {/* Frame count selector */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Number of frames to propagate
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min={1}
                    max={Math.min(50, frames.length - (frames.find(f => f.id === frameId)?.frame_index ?? 0) - 1)}
                    value={propagateFrameCount}
                    onChange={(e) => setPropagateFrameCount(parseInt(e.target.value))}
                    className="flex-1"
                    disabled={propagateStatus === 'propagating'}
                  />
                  <span className="text-white font-medium w-12 text-center">{propagateFrameCount}</span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  Current frame: {(frames.find(f => f.id === frameId)?.frame_index ?? 0) + 1} →
                  Target: {(frames.find(f => f.id === frameId)?.frame_index ?? 0) + propagateFrameCount + 1}
                </p>
              </div>

              {/* Progress indicator */}
              {propagateStatus === 'propagating' && (
                <div className="flex items-center gap-2 text-cyan-400">
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="text-sm">Processing...</span>
                </div>
              )}

              {/* Error message */}
              {propagateError && (
                <div className="p-3 bg-red-500/20 border border-red-500/40 rounded text-sm text-red-300">
                  ⚠️ {propagateError}
                </div>
              )}

              {/* Success message */}
              {propagateStatus === 'done' && !propagateError && (
                <div className="p-3 bg-green-500/20 border border-green-500/40 rounded text-sm text-green-300">
                  ✓ Propagation complete! Navigate frames to review.
                </div>
              )}

              {/* Info */}
              <div className="p-3 bg-gray-800 rounded text-xs text-gray-400">
                <p className="font-medium text-gray-300 mb-1">How it works:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>AI tracks the object from current frame</li>
                  <li>Creates annotations on subsequent frames</li>
                  <li>Stops if confidence drops below threshold</li>
                  <li>You can adjust any frame to correct tracking</li>
                </ul>
              </div>
            </div>

            <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowPropagateDialog(false);
                  setPropagateError(null);
                }}
                className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded"
                disabled={propagateStatus === 'propagating'}
              >
                {propagateStatus === 'done' ? 'Close' : 'Cancel'}
              </button>
              {propagateStatus !== 'done' && (
                <button
                  onClick={() => {
                    if (propagateTrackId === '__batch__') {
                      // Batch mode - propagate all selected tracks
                      const trackIdsArray = Array.from(selectedTrackIds);
                      propagateBatch(trackIdsArray, propagateFrameCount);
                    } else if (propagateTrackId) {
                      // Single track mode
                      propagateTrack(propagateTrackId, propagateFrameCount);
                    }
                  }}
                  disabled={propagateStatus === 'propagating'}
                  className={`px-4 py-2 text-sm rounded font-medium flex items-center gap-2 ${
                    propagateStatus === 'propagating'
                      ? 'bg-cyan-700 text-cyan-200 cursor-wait'
                      : 'bg-cyan-600 hover:bg-cyan-700 text-white'
                  }`}
                >
                  {propagateStatus === 'propagating' ? (
                    <>
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Processing...
                    </>
                  ) : (
                    <>
                      <span>🎯</span>
                      Start Propagation
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Merge Tracks Dialog */}
      {showMergeDialog && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-dark-card border border-gray-700 rounded-lg shadow-xl w-96 max-w-[90vw]">
            <div className="p-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                Merge to Track
              </h3>
              <p className="text-sm text-gray-400 mt-1">
                Assign {selectedIds.length} selected annotation{selectedIds.length > 1 ? 's' : ''} to a track
              </p>
            </div>

            <div className="p-4 space-y-4">
              {/* Mode selection */}
              <div className="flex gap-2">
                <button
                  onClick={() => setMergeMode('existing')}
                  className={`flex-1 px-3 py-2 text-sm rounded font-medium transition-colors ${
                    mergeMode === 'existing'
                      ? 'bg-cyan-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  Existing Track
                </button>
                <button
                  onClick={() => setMergeMode('new')}
                  className={`flex-1 px-3 py-2 text-sm rounded font-medium transition-colors ${
                    mergeMode === 'new'
                      ? 'bg-cyan-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  New Track
                </button>
              </div>

              {/* Track selector (only for existing mode) */}
              {mergeMode === 'existing' && (
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Select target track
                  </label>
                  <select
                    value={mergeTargetTrackId}
                    onChange={(e) => setMergeTargetTrackId(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded text-white text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  >
                    <option value="">-- Select a track --</option>
                    {tracks.map((track) => {
                      const classInfo = availableClasses.find(c => c.id === track.class_id);
                      return (
                        <option key={track.id} value={track.id}>
                          {track.name || `Track ${track.id.substring(0, 6)}`} ({classInfo?.name || track.class_id})
                        </option>
                      );
                    })}
                  </select>
                  {tracks.length === 0 && (
                    <p className="text-xs text-gray-500 mt-1">No existing tracks. Create a new track instead.</p>
                  )}
                </div>
              )}

              {/* New track info */}
              {mergeMode === 'new' && (
                <div className="p-3 bg-gray-800 rounded text-sm text-gray-300">
                  <p>A new track will be created using the class of the first selected annotation.</p>
                </div>
              )}

              {/* Selected annotations preview */}
              <div className="p-3 bg-gray-800/50 rounded">
                <p className="text-xs font-medium text-gray-400 mb-2">Selected annotations:</p>
                <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                  {selectedIds.slice(0, 10).map((id) => {
                    const ann = annotations.get(id);
                    const classInfo = ann ? availableClasses.find(c => c.id === ann.classId) : null;
                    return (
                      <span
                        key={id}
                        className="px-2 py-0.5 text-xs rounded bg-gray-700 text-gray-300"
                        style={{ borderLeft: `3px solid ${classInfo?.color || '#6b7280'}` }}
                      >
                        {classInfo?.name || ann?.classId || 'Unknown'}
                      </span>
                    );
                  })}
                  {selectedIds.length > 10 && (
                    <span className="px-2 py-0.5 text-xs text-gray-500">+{selectedIds.length - 10} more</span>
                  )}
                </div>
              </div>

              {/* Tips */}
              <div className="p-3 bg-gray-800 rounded text-xs text-gray-400">
                <p className="font-medium text-gray-300 mb-1">💡 Tips:</p>
                <ul className="list-disc list-inside space-y-0.5">
                  <li>Use Shift+Click to select multiple annotations</li>
                  <li>Press G to open this dialog with selected items</li>
                  <li>Tracks group annotations across frames</li>
                </ul>
              </div>
            </div>

            <div className="p-4 border-t border-gray-700 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowMergeDialog(false);
                  setMergeTargetTrackId('');
                }}
                className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (mergeMode === 'new') {
                    mergeAnnotationsToTrack('new');
                  } else if (mergeTargetTrackId) {
                    mergeAnnotationsToTrack(mergeTargetTrackId);
                  }
                }}
                disabled={mergeMode === 'existing' && !mergeTargetTrackId}
                className={`px-4 py-2 text-sm rounded font-medium flex items-center gap-2 ${
                  (mergeMode === 'existing' && !mergeTargetTrackId)
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-cyan-600 hover:bg-cyan-700 text-white'
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                </svg>
                {mergeMode === 'new' ? 'Create & Merge' : 'Merge to Track'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard Shortcuts Help Modal */}
      {showHelp && (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowHelp(false)}>
          <div
            className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-[720px] max-h-[80vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 bg-gray-800/50">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                  <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-white">Keyboard Shortcuts</h2>
              </div>
              <button
                onClick={() => setShowHelp(false)}
                className="text-gray-400 hover:text-white transition-colors"
              >
                <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="p-6 overflow-y-auto max-h-[calc(80vh-80px)]">
              <div className="grid grid-cols-2 gap-6">

                {/* Common Shortcuts */}
                <div className="col-span-2">
                  <h3 className="text-sm font-semibold text-blue-400 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-blue-500/20 flex items-center justify-center">⌨️</span>
                    Common
                  </h3>
                  <div className="grid grid-cols-2 gap-x-6 gap-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Save</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">Ctrl+S</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Undo</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">Ctrl+Z</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Redo</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">Ctrl+Y</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Delete Selected</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">Delete</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Cancel / Deselect</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">Esc</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Quick Class Select</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">1-9, 0</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Merge to Track</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">G</kbd>
                    </div>
                  </div>
                </div>

                {/* 2D Annotation Shortcuts */}
                <div>
                  <h3 className="text-sm font-semibold text-green-400 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-green-500/20 flex items-center justify-center">🖼️</span>
                    2D Tools
                  </h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Select Tool</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">V</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Pan Tool</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">H</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Rectangle</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">R</kbd>
                    </div>
                    {/* Rotated Box - Hidden for now
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Rotated Box</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">O</kbd>
                    </div>
                    */}
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Ellipse</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">E</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Polygon</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">P</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Polyline</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">L</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Points</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">K</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">AI Segmentation</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">W</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">AI Polygon</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">M</kbd>
                    </div>
                  </div>

                  <h4 className="text-xs font-medium text-gray-500 mt-4 mb-2">Drawing</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Complete Shape</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">Enter</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Undo Last Point</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">Backspace</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Close Polygon</span>
                      <span className="text-xs text-gray-500">Click first point</span>
                    </div>
                  </div>

                  <h4 className="text-xs font-medium text-gray-500 mt-4 mb-2">Navigation</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Pan (temporary)</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">Space + Drag</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Pan (middle mouse)</span>
                      <span className="text-xs text-gray-500">Middle click + Drag</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Pan (select tool)</span>
                      <span className="text-xs text-gray-500">Left click + Drag</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Zoom</span>
                      <span className="text-xs text-gray-500">Scroll wheel</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Fit to Window</span>
                      <span className="text-xs text-gray-500">Double-click canvas</span>
                    </div>
                  </div>
                </div>

                {/* 3D Annotation Shortcuts */}
                <div>
                  <h3 className="text-sm font-semibold text-purple-400 mb-3 flex items-center gap-2">
                    <span className="w-5 h-5 rounded bg-purple-500/20 flex items-center justify-center">📦</span>
                    3D Tools (Point Cloud)
                  </h3>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Select Tool</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">V</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">3D Box Tool</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">B</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Track Mode</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">T</kbd>
                    </div>
                  </div>

                  <h4 className="text-xs font-medium text-gray-500 mt-4 mb-2">Box Editing</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Move Box</span>
                      <span className="text-xs text-gray-500">Drag center</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Resize Box</span>
                      <span className="text-xs text-gray-500">Drag edges/corners</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Rotate Box</span>
                      <span className="text-xs text-gray-500">Drag rotation handle</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Copy Box</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">Ctrl+C</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Paste Box</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">Ctrl+V</kbd>
                    </div>
                  </div>

                  <h4 className="text-xs font-medium text-gray-500 mt-4 mb-2">Camera Views</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Orbit Camera</span>
                      <span className="text-xs text-gray-500">Left click + Drag</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Pan Camera</span>
                      <span className="text-xs text-gray-500">Right click + Drag</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Zoom</span>
                      <span className="text-xs text-gray-500">Scroll wheel</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Top View</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">Numpad 7</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Front View</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">Numpad 1</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Side View</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">Numpad 3</kbd>
                    </div>
                  </div>

                  <h4 className="text-xs font-medium text-gray-500 mt-4 mb-2">Frame Navigation</h4>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Previous Frame</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">←</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Next Frame</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">→</kbd>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Play/Pause</span>
                      <kbd className="px-2 py-0.5 bg-gray-800 rounded text-xs text-gray-300 font-mono">Space</kbd>
                    </div>
                  </div>
                </div>

              </div>

              {/* Footer tip */}
              <div className="mt-6 pt-4 border-t border-gray-700">
                <p className="text-xs text-gray-500 text-center">
                  💡 Tip: Press <kbd className="px-1.5 py-0.5 bg-gray-800 rounded text-gray-400 font-mono">Esc</kbd> to close this dialog
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* False Negative Flagging Modal */}
      {fnModalOpen && fnLocation && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-dark-card border border-gray-700 rounded-lg shadow-xl w-96 max-w-[90vw]">
            <div className="p-4 border-b border-gray-700">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <span>🚩</span>
                Flag False Negative
              </h3>
              <p className="text-sm text-gray-400 mt-1">
                Mark a missed object at ({Math.round(fnLocation.x)}, {Math.round(fnLocation.y)})
              </p>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const formData = new FormData(e.currentTarget);
                const classId = formData.get('classId') as string;
                const description = formData.get('description') as string;

                // Add marker to the list for visual feedback
                const marker = {
                  id: `fn-${Date.now()}`,
                  x: fnLocation.x,
                  y: fnLocation.y,
                  frameId,
                  classId,
                  description
                };
                setFnMarkers(prev => [...prev, marker]);

                // Submit to backend
                if (taskId) {
                  try {
                    await qaApi.createManualSuggestion({
                      taskId,
                      frameId,
                      message: description || `Missing object: ${availableClasses.find(c => c.id === classId)?.name || classId}`,
                      suggestionType: 'false_negative',
                      severity: 'high',
                      location: { x: fnLocation.x, y: fnLocation.y, z: 0 },
                      suggestedClass: classId,
                      details: {
                        camera_id: selectedCameraId,
                        cameraId: selectedCameraId,
                        location: { x: fnLocation.x, y: fnLocation.y },
                        suggested_class: classId,
                      },
                    });
                    console.log('FN saved to backend:', marker);
                  } catch (error) {
                    console.error('Failed to save FN:', error);
                  }
                }

                // Close modal
                setFnModalOpen(false);
                setFnLocation(null);
              }}
              className="p-4 space-y-4"
            >
              {/* Class selector */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Object Class
                </label>
                <select
                  name="classId"
                  required
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                  defaultValue=""
                >
                  <option value="" disabled>Select a class...</option>
                  {availableClasses.map(cls => (
                    <option key={cls.id} value={cls.id}>
                      {cls.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Description (optional)
                </label>
                <textarea
                  name="description"
                  placeholder="Additional notes about this missed object..."
                  className="w-full bg-gray-700 border border-gray-600 rounded px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                  rows={3}
                />
              </div>

              {/* Buttons */}
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setFnModalOpen(false);
                    setFnLocation(null);
                  }}
                  className="px-4 py-2 text-sm rounded font-medium bg-gray-700 hover:bg-gray-600 text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm rounded font-medium bg-orange-600 hover:bg-orange-700 text-white flex items-center gap-2"
                >
                  <span>🚩</span>
                  Flag FN
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Image2DAnnotationView;

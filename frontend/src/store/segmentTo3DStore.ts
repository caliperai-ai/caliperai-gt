import { create } from 'zustand';
import type { Point2D } from '@/utils/pointInPolygon';


export interface PolygonVertex {
  x: number;
  y: number;
  id: string;
}

export interface SegmentPolygon {
  id: string;
  vertices: PolygonVertex[];
  score: number;
  area: number;
  isSelected: boolean;
  isEditing: boolean;
}

export interface PromptPoint {
  x: number;
  y: number;
  label: 1 | 0;
}

export type SegmentModeStep =
  | 'idle'
  | 'clicking'
  | 'segmenting'
  | 'editing'
  | 'heading_arrow'
  | 'creating_box'
  | 'done';

export interface HeadingArrow {
  startImageX: number;
  startImageY: number;
  endImageX: number;
  endImageY: number;
  yaw: number;
  anchorX?: number;
  anchorY?: number;
}

export interface FilteredLidarPoints {
  indices: number[];
  positions: Float32Array;
  count: number;
}

export interface ProjectedLidarPoint {
  index: number;
  x: number;
  y: number;
  x3d: number;
  y3d: number;
  z3d: number;
  depth: number;
  isInside: boolean;
  isExcluded: boolean;
}

interface SegmentTo3DState {
  isActive: boolean;
  currentStep: SegmentModeStep;

  activeCameraId: string | null;
  imageSize: { width: number; height: number } | null;

  promptPoints: PromptPoint[];

  polygons: SegmentPolygon[];
  activePolygonId: string | null;

  editingVertexId: string | null;
  hoveredVertexId: string | null;

  filteredPoints: FilteredLidarPoints | null;

  projectedPoints: ProjectedLidarPoint[];

  excludedPointIndices: Set<number>;

  headingArrow: HeadingArrow | null;

  showSplitView: boolean;

  error: string | null;

  isSegmenting: boolean;
  isCreatingBox: boolean;

  pendingBoxCreation: boolean;

  autoCreateAfterSegment: boolean;

  lastCreatedAnnotationId: string | null;


  activate: (cameraId: string, imageSize: { width: number; height: number }) => void;
  deactivate: () => void;
  reset: () => void;

  addPromptPoint: (point: PromptPoint) => void;
  removePromptPoint: (index: number) => void;
  clearPromptPoints: () => void;
  togglePromptPointLabel: (index: number) => void;

  setSegmentationResults: (polygons: Array<{
    polygon: Point2D[];
    score: number;
    area: number;
  }>) => void;
  selectPolygon: (id: string) => void;
  clearPolygons: () => void;

  startEditing: (polygonId: string) => void;
  stopEditing: () => void;
  updateVertex: (polygonId: string, vertexId: string, position: Point2D) => void;
  addVertex: (polygonId: string, afterVertexId: string, position: Point2D) => void;
  removeVertex: (polygonId: string, vertexId: string) => void;
  setHoveredVertex: (vertexId: string | null) => void;
  setEditingVertex: (vertexId: string | null) => void;

  setFilteredPoints: (points: FilteredLidarPoints | null) => void;

  setProjectedPoints: (points: ProjectedLidarPoint[]) => void;

  togglePointExclusion: (index: number) => void;
  clearExcludedPoints: () => void;

  setHeadingArrow: (arrow: HeadingArrow | null) => void;
  clearHeadingArrow: () => void;

  toggleSplitView: () => void;
  setSplitView: (show: boolean) => void;

  setStep: (step: SegmentModeStep) => void;
  setError: (error: string | null) => void;
  setSegmenting: (isSegmenting: boolean) => void;
  setCreatingBox: (isCreatingBox: boolean) => void;

  getActivePolygon: () => SegmentPolygon | null;

  requestBoxCreation: (heading: HeadingArrow | null) => void;
  clearPendingBoxCreation: () => void;

  setAutoCreateAfterSegment: (auto: boolean) => void;

  setLastCreatedAnnotationId: (id: string | null) => void;
}

function generateVertexId(): string {
  return `v_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function generatePolygonId(): string {
  return `poly_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

export const useSegmentTo3DStore = create<SegmentTo3DState>((set, get) => ({
  // Initial state
  isActive: false,
  currentStep: 'idle',
  activeCameraId: null,
  imageSize: null,
  promptPoints: [],
  polygons: [],
  activePolygonId: null,
  editingVertexId: null,
  hoveredVertexId: null,
  filteredPoints: null,
  projectedPoints: [],
  excludedPointIndices: new Set<number>(),
  headingArrow: null,
  showSplitView: false,
  error: null,
  isSegmenting: false,
  isCreatingBox: false,
  pendingBoxCreation: false,
  autoCreateAfterSegment: false,
  lastCreatedAnnotationId: null,

  // ===========================================================================
  // Activation
  // ===========================================================================

  activate: (cameraId, imageSize) => {
    console.log('[SegmentTo3DStore] Activating for camera:', cameraId, 'imageSize:', imageSize);
    set({
      isActive: true,
      currentStep: 'clicking',
      activeCameraId: cameraId,
      imageSize,
      promptPoints: [],
      polygons: [],
      activePolygonId: null,
      headingArrow: null,
      error: null,
    });
  },

  deactivate: () => set({
    isActive: false,
    currentStep: 'idle',
    activeCameraId: null,
    promptPoints: [],
    polygons: [],
    activePolygonId: null,
    filteredPoints: null,
    projectedPoints: [],
    excludedPointIndices: new Set<number>(),
    headingArrow: null,
    pendingBoxCreation: false,
    autoCreateAfterSegment: false,
    error: null,
    isSegmenting: false,
    isCreatingBox: false,
  }),

  reset: () => set({
    currentStep: 'clicking',
    promptPoints: [],
    polygons: [],
    activePolygonId: null,
    editingVertexId: null,
    hoveredVertexId: null,
    filteredPoints: null,
    projectedPoints: [],
    excludedPointIndices: new Set<number>(),
    headingArrow: null,
    pendingBoxCreation: false,
    autoCreateAfterSegment: false,
    lastCreatedAnnotationId: null,
    error: null,
    isSegmenting: false,
    isCreatingBox: false,
  }),

  // ===========================================================================
  // Prompt Points
  // ===========================================================================

  addPromptPoint: (point) => set((state) => ({
    promptPoints: [...state.promptPoints, point],
  })),

  removePromptPoint: (index) => set((state) => ({
    promptPoints: state.promptPoints.filter((_, i) => i !== index),
  })),

  clearPromptPoints: () => set({ promptPoints: [] }),

  togglePromptPointLabel: (index) => set((state) => ({
    promptPoints: state.promptPoints.map((p, i) =>
      i === index ? { ...p, label: p.label === 1 ? 0 : 1 } : p
    ),
  })),

  // ===========================================================================
  // Segmentation Results
  // ===========================================================================

  setSegmentationResults: (results) => {
    const state = get();
    const polygons: SegmentPolygon[] = results.map((r, index) => ({
      id: generatePolygonId(),
      vertices: r.polygon.map(p => ({
        x: p.x,
        y: p.y,
        id: generateVertexId(),
      })),
      score: r.score,
      area: r.area,
      isSelected: index === 0, // Select the best one by default
      isEditing: false,
    }));

    // Check if we should auto-create box (Shift+click flow)
    const shouldAutoCreate = state.autoCreateAfterSegment && polygons.length > 0;

    set({
      polygons,
      activePolygonId: polygons[0]?.id || null,
      currentStep: 'editing',
      isSegmenting: false,
      // Trigger box creation with auto heading if auto-create flag was set
      pendingBoxCreation: shouldAutoCreate,
      headingArrow: shouldAutoCreate ? null : state.headingArrow,
      autoCreateAfterSegment: false, // Reset the flag
    });

    if (shouldAutoCreate) {
      console.log('[SegmentTo3DStore] Auto-creating box after segmentation (Shift+click)');
    }
  },

  selectPolygon: (id) => set((state) => ({
    polygons: state.polygons.map(p => ({
      ...p,
      isSelected: p.id === id,
      isEditing: p.id === id ? p.isEditing : false,
    })),
    activePolygonId: id,
  })),

  clearPolygons: () => set({
    polygons: [],
    activePolygonId: null,
    filteredPoints: null,
  }),

  // ===========================================================================
  // Polygon Editing
  // ===========================================================================

  startEditing: (polygonId) => set((state) => ({
    polygons: state.polygons.map(p => ({
      ...p,
      isEditing: p.id === polygonId,
    })),
    activePolygonId: polygonId,
  })),

  stopEditing: () => set((state) => ({
    polygons: state.polygons.map(p => ({
      ...p,
      isEditing: false,
    })),
    editingVertexId: null,
  })),

  updateVertex: (polygonId, vertexId, position) => set((state) => ({
    polygons: state.polygons.map(p =>
      p.id === polygonId
        ? {
            ...p,
            vertices: p.vertices.map(v =>
              v.id === vertexId ? { ...v, x: position.x, y: position.y } : v
            ),
          }
        : p
    ),
  })),

  addVertex: (polygonId, afterVertexId, position) => set((state) => ({
    polygons: state.polygons.map(p => {
      if (p.id !== polygonId) return p;

      const index = p.vertices.findIndex(v => v.id === afterVertexId);
      if (index === -1) return p;

      const newVertex: PolygonVertex = {
        x: position.x,
        y: position.y,
        id: generateVertexId(),
      };

      const newVertices = [...p.vertices];
      newVertices.splice(index + 1, 0, newVertex);

      return { ...p, vertices: newVertices };
    }),
  })),

  removeVertex: (polygonId, vertexId) => set((state) => ({
    polygons: state.polygons.map(p => {
      if (p.id !== polygonId) return p;
      if (p.vertices.length <= 3) return p; // Minimum 3 vertices

      return {
        ...p,
        vertices: p.vertices.filter(v => v.id !== vertexId),
      };
    }),
  })),

  setHoveredVertex: (vertexId) => set({ hoveredVertexId: vertexId }),

  setEditingVertex: (vertexId) => set({ editingVertexId: vertexId }),

  // ===========================================================================
  // Filtered Points
  // ===========================================================================

  setFilteredPoints: (points) => set({ filteredPoints: points }),

  // ===========================================================================
  // Projected Points (for visualization)
  // ===========================================================================

  setProjectedPoints: (points) => set({ projectedPoints: points }),

  // ===========================================================================
  // Point Exclusion (point-by-point removal)
  // ===========================================================================

  togglePointExclusion: (index) => set((state) => {
    const newExcluded = new Set(state.excludedPointIndices);
    if (newExcluded.has(index)) {
      newExcluded.delete(index);
    } else {
      newExcluded.add(index);
    }
    return { excludedPointIndices: newExcluded };
  }),

  clearExcludedPoints: () => set({ excludedPointIndices: new Set<number>() }),

  // ===========================================================================
  // Heading Arrow
  // ===========================================================================

  setHeadingArrow: (arrow) => set({ headingArrow: arrow }),

  clearHeadingArrow: () => set({ headingArrow: null }),

  // ===========================================================================
  // Split View
  // ===========================================================================

  toggleSplitView: () => set((state) => ({ showSplitView: !state.showSplitView })),

  setSplitView: (show) => set({ showSplitView: show }),

  // ===========================================================================
  // State Transitions
  // ===========================================================================

  setStep: (step) => set({ currentStep: step }),

  setError: (error) => set({ error, isSegmenting: false, isCreatingBox: false }),

  setSegmenting: (isSegmenting) => set({
    isSegmenting,
    currentStep: isSegmenting ? 'segmenting' : get().currentStep
  }),

  setCreatingBox: (isCreatingBox) => set({
    isCreatingBox,
    currentStep: isCreatingBox ? 'creating_box' : get().currentStep
  }),

  // ===========================================================================
  // Getters
  // ===========================================================================

  getActivePolygon: () => {
    const state = get();
    return state.polygons.find(p => p.id === state.activePolygonId) || null;
  },

  // ===========================================================================
  // Box Creation Request (for HeadingPickerOverlay integration)
  // ===========================================================================

  requestBoxCreation: (heading) => set({
    headingArrow: heading,
    pendingBoxCreation: true,
  }),

  clearPendingBoxCreation: () => set({ pendingBoxCreation: false }),

  // ===========================================================================
  // Auto-Create on Segment (for Shift+click bypass)
  // ===========================================================================

  setAutoCreateAfterSegment: (auto) => set({ autoCreateAfterSegment: auto }),

  // ===========================================================================
  // Track Last Created Annotation (for ESC to select and exit)
  // ===========================================================================

  setLastCreatedAnnotationId: (id) => set({ lastCreatedAnnotationId: id }),
}));

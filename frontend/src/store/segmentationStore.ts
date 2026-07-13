import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';


export type SegmentationTool = 'select' | 'brush' | 'lasso' | 'region_grow' | 'eraser';

export type SegmentationMode = 'semantic' | 'instance';

export const INSTANCE_ID_BASE = 1000;

export type ColorMode = 'height' | 'intensity' | 'none' | 'rgb';

export interface BrushSettings {
  radius: number;
  mode: 'paint' | 'erase';
}

export interface RegionGrowSettings {
  seedThreshold: number;
  normalThreshold: number;
  maxPoints: number;
}

export interface LassoSettings {
  includePartial: boolean;
}

export interface SegmentationHistoryEntry {
  frameIndex: number;
  mode: SegmentationMode;
  labels: Int32Array;
  instanceIds: Int32Array;
  timestamp: number;
  description: string;
}

export interface FrameSegmentation {
  frameIndex: number;
  pointCount: number;

  labels: Int32Array;
  instanceIds: Int32Array;
  nextInstanceId: number;

  semanticLabels: Int32Array;

  isDirty: boolean;
  semanticDirty: boolean;

  baselineLabels: Int32Array | null;
  baselineInstanceIds: Int32Array | null;
  baselineSemanticLabels: Int32Array | null;
}

export interface SegmentationState {
  activeTool: SegmentationTool;

  segmentationMode: SegmentationMode;

  activeClassId: string | null;

  brushSettings: BrushSettings;
  regionGrowSettings: RegionGrowSettings;
  lassoSettings: LassoSettings;

  frameSegmentations: Map<number, FrameSegmentation>;

  currentFrameIndex: number;

  selectedPointIndices: Set<number>;
  isSelecting: boolean;

  hoveredPointIndex: number | null;

  undoStack: SegmentationHistoryEntry[];
  redoStack: SegmentationHistoryEntry[];
  maxHistorySize: number;

  isLoading: boolean;
  isSaving: boolean;
  lastSaveTime: number | null;

  sceneId: string | null;
  taskId: string | null;

  showOnlyLabeled: boolean;
  labelOpacity: number;
  pointSize: number;
  colorMode: ColorMode;

  is4DMode: boolean;
  scanCount: number;
  show4DControls: boolean;

  brushWorldPosition: [number, number, number] | null;
  brushIsPainting: boolean;

  currentInstanceId: number;

  hiddenInstances: Set<number>;

  splitSourceInstanceId: number | null;

  selectedInstanceId: number | null;

  pickedInstanceIds: Set<number>;

  // Bumped on each in-place brush paint tick so the renderer can apply only the
  // touched indices to the GPU label buffer instead of re-uploading the whole
  // cloud. `lastPaintedIndices` holds the indices changed by the latest tick.
  labelEditVersion: number;
  lastPaintedIndices: number[] | null;
}

export interface SegmentationActions {
  setActiveTool: (tool: SegmentationTool) => void;
  setSegmentationMode: (mode: SegmentationMode) => void;
  setActiveClass: (classId: string | null) => void;

  setBrushSettings: (settings: Partial<BrushSettings>) => void;
  setRegionGrowSettings: (settings: Partial<RegionGrowSettings>) => void;
  setLassoSettings: (settings: Partial<LassoSettings>) => void;

  setCurrentFrame: (frameIndex: number) => void;
  initializeFrame: (frameIndex: number, pointCount: number, existingLabels?: Int32Array, existingInstanceIds?: Int32Array, existingSemanticLabels?: Int32Array) => void;
  getInstanceIdsForFrame: (frameIndex: number) => Int32Array | null;

  selectPoints: (indices: number[]) => void;
  addToSelection: (indices: number[]) => void;
  removeFromSelection: (indices: number[]) => void;
  clearSelection: () => void;
  setIsSelecting: (isSelecting: boolean) => void;

  labelSelectedPoints: (classId: string) => void;
  labelPoints: (indices: number[], classId: string, description?: string) => void;
  erasePoints: (indices: number[]) => void;
  clearAllLabels: () => void;
  clearClassLabels: (classId: string) => void;

  startBrushSession: () => void;
  paintBrushPoints: (indices: number[], classId: string) => void;
  endBrushSession: (description?: string) => void;

  completeSegment: () => void;
  getCurrentInstanceId: () => number;
  getInstancesForFrame: (frameIndex: number) => Map<number, { classId: number; pointCount: number }>;
  deleteInstance: (instanceId: number) => void;
  highlightInstance: (instanceId: number) => void;
  selectInstanceByPoint: (pointIndex: number, additive?: boolean) => void;
  togglePickedInstance: (instanceId: number) => void;
  clearPickedInstances: () => void;
  mergePickedInstances: () => void;
  mergeInstances: (instanceIds: number[], targetInstanceId: number) => void;
  splitInstanceGroups: (sourceInstanceId: number, groups: number[][]) => number[];
  beginSplit: (instanceId: number) => void;
  addSplitSelection: (indices: number[]) => void;
  confirmSplit: () => number | null;
  cancelSplit: () => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  setSceneContext: (sceneId: string, taskId: string) => void;
  markFrameDirty: (frameIndex: number) => void;
  markFrameSaved: (frameIndex: number) => void;
  getLabelsForFrame: (frameIndex: number) => Int32Array | null;
  getSemanticLabelsForFrame: (frameIndex: number) => Int32Array | null;
  getDirtyFrames: () => number[];

  getFrameDelta: (frameIndex: number) => {
    indices: number[];
    labels: number[];
    instanceIds: number[] | undefined;
  } | null;
  applyServerMerge: (
    frameIndex: number,
    serverLabels: Int32Array,
    serverInstanceIds: Int32Array | null,
  ) => void;

  setShowOnlyLabeled: (show: boolean) => void;
  setLabelOpacity: (opacity: number) => void;
  setPointSize: (size: number) => void;
  setColorMode: (mode: ColorMode) => void;

  setIs4DMode: (is4D: boolean) => void;
  setScanCount: (count: number) => void;
  setShow4DControls: (show: boolean) => void;

  setHoveredPoint: (index: number | null) => void;

  setBrushWorldPosition: (pos: [number, number, number] | null) => void;
  setBrushIsPainting: (painting: boolean) => void;

  toggleInstanceVisibility: (instanceId: number) => void;
  setInstanceHidden: (instanceId: number, hidden: boolean) => void;
  isInstanceHidden: (instanceId: number) => boolean;
  clearHiddenInstances: () => void;

  reset: () => void;
}


const initialState: SegmentationState = {
  activeTool: 'select',
  segmentationMode: 'semantic',
  activeClassId: null,

  brushSettings: {
    radius: 0.5,
    mode: 'paint',
  },

  regionGrowSettings: {
    seedThreshold: 0.3,
    normalThreshold: 0.8,
    maxPoints: 10000,
  },

  lassoSettings: {
    includePartial: false,
  },

  frameSegmentations: new Map(),
  currentFrameIndex: 0,

  selectedPointIndices: new Set(),
  isSelecting: false,

  hoveredPointIndex: null,

  undoStack: [],
  redoStack: [],
  maxHistorySize: 50,

  isLoading: false,
  isSaving: false,
  lastSaveTime: null,

  sceneId: null,
  taskId: null,

  showOnlyLabeled: false,
  labelOpacity: 1.0,
  pointSize: 1.0,
  colorMode: 'height' as ColorMode,

  is4DMode: false,
  scanCount: 5,
  show4DControls: false,

  brushWorldPosition: null,
  brushIsPainting: false,

  currentInstanceId: -1,

  hiddenInstances: new Set(),

  splitSourceInstanceId: null,

  selectedInstanceId: null,

  pickedInstanceIds: new Set(),

  labelEditVersion: 0,
  lastPaintedIndices: null,
};


function resolveTargetInstance(
  state: SegmentationState,
  frameSeg: FrameSegmentation,
  classIndex: number,
): { targetInstanceId: number; nextInstanceId: number; currentInstanceId: number } {
  if (state.segmentationMode !== 'instance') {
    return {
      targetInstanceId: classIndex,
      nextInstanceId: frameSeg.nextInstanceId,
      currentInstanceId: -1,
    };
  }
  if (state.currentInstanceId >= 0) {
    return {
      targetInstanceId: state.currentInstanceId,
      nextInstanceId: frameSeg.nextInstanceId,
      currentInstanceId: state.currentInstanceId,
    };
  }
  const allocated = Math.max(frameSeg.nextInstanceId, INSTANCE_ID_BASE);
  return {
    targetInstanceId: allocated,
    nextInstanceId: allocated + 1,
    currentInstanceId: allocated,
  };
}

function activeLabelsOf(frameSeg: FrameSegmentation, mode: SegmentationMode): Int32Array {
  return mode === 'semantic' ? frameSeg.semanticLabels : frameSeg.labels;
}

function makeHistoryEntry(
  frameSeg: FrameSegmentation,
  mode: SegmentationMode,
  frameIndex: number,
  description: string,
): SegmentationHistoryEntry {
  return {
    frameIndex,
    mode,
    labels: new Int32Array(activeLabelsOf(frameSeg, mode)),
    instanceIds: new Int32Array(frameSeg.instanceIds),
    timestamp: Date.now(),
    description,
  };
}


export const useSegmentationStore = create<SegmentationState & SegmentationActions>()(
  subscribeWithSelector((set, get) => ({
    ...initialState,


    setActiveTool: (tool) => set({ activeTool: tool }),

    setSegmentationMode: (mode) => {
      set({
        segmentationMode: mode,
        currentInstanceId: -1,
        splitSourceInstanceId: null,
        selectedPointIndices: new Set(),
        selectedInstanceId: null,
        pickedInstanceIds: new Set(),
      });
      console.log(`[Segmentation] Mode set to '${mode}'`);
    },

    setActiveClass: (classId) => {
      const { activeClassId, currentInstanceId } = get();

      if (classId !== activeClassId && currentInstanceId >= 0) {
        console.log(`[Segmentation] Class changed from ${activeClassId} to ${classId}, completing current segment`);
        set({ activeClassId: classId, currentInstanceId: -1 });
      } else {
        set({ activeClassId: classId });
      }
    },

    // =========================================================================
    // SETTINGS ACTIONS
    // =========================================================================

    setBrushSettings: (settings) => set((state) => ({
      brushSettings: { ...state.brushSettings, ...settings },
    })),

    setRegionGrowSettings: (settings) => set((state) => ({
      regionGrowSettings: { ...state.regionGrowSettings, ...settings },
    })),

    setLassoSettings: (settings) => set((state) => ({
      lassoSettings: { ...state.lassoSettings, ...settings },
    })),

    // =========================================================================
    // FRAME MANAGEMENT
    // =========================================================================

    setCurrentFrame: (frameIndex) => set({ currentFrameIndex: frameIndex }),

    initializeFrame: (frameIndex, pointCount, existingLabels, existingInstanceIds, existingSemanticLabels) => {
      const frameSegmentations = new Map(get().frameSegmentations);

      // Initialize instance-layer labels: -1 means unlabeled
      let labels: Int32Array;
      if (existingLabels && existingLabels.length === pointCount) {
        labels = new Int32Array(existingLabels);
      } else {
        labels = new Int32Array(pointCount).fill(-1);
      }

      // Initialize the independent semantic layer.
      const semanticLabels: Int32Array =
        existingSemanticLabels && existingSemanticLabels.length === pointCount
          ? new Int32Array(existingSemanticLabels)
          : new Int32Array(pointCount).fill(-1);

      // Initialize instance IDs.
      const instanceIds: Int32Array = new Int32Array(pointCount).fill(-1);
      const haveSavedInstances =
        existingInstanceIds != null && existingInstanceIds.length === pointCount;

      for (let i = 0; i < pointCount; i++) {
        const label = labels[i];
        if (label < 0) continue;
        if (haveSavedInstances && existingInstanceIds![i] >= 0) {
          // Restore the persisted instance grouping (instance-mode data, or
          // any prior semantic data — both round-trip correctly).
          instanceIds[i] = existingInstanceIds![i];
        } else {
          // No saved instance for this labeled point → fall back to the
          // semantic convention (instance ID = class ID).
          instanceIds[i] = label;
        }
      }

      // Next free instance ID for this frame: one past the largest existing
      // instance-mode ID (>= INSTANCE_ID_BASE), so newly drawn objects keep
      // getting unique IDs after a reload.
      let maxInstanceId = INSTANCE_ID_BASE - 1;
      for (let i = 0; i < pointCount; i++) {
        if (instanceIds[i] > maxInstanceId) maxInstanceId = instanceIds[i];
      }

      frameSegmentations.set(frameIndex, {
        frameIndex,
        pointCount,
        labels,
        instanceIds,
        nextInstanceId: maxInstanceId + 1,
        semanticLabels,
        isDirty: false,
        semanticDirty: false,
        // Baseline = exact copy of what came from the server.
        baselineLabels: new Int32Array(labels),
        baselineInstanceIds: new Int32Array(instanceIds),
        baselineSemanticLabels: new Int32Array(semanticLabels),
      });

      // Reset current instance — next paint starts a fresh segment.
      set({ frameSegmentations, currentInstanceId: -1 });
    },

    getInstanceIdsForFrame: (frameIndex) => {
      const frame = get().frameSegmentations.get(frameIndex);
      return frame?.instanceIds || null;
    },

    // =========================================================================
    // SELECTION ACTIONS
    // =========================================================================

    selectPoints: (indices) => set({
      selectedPointIndices: new Set(indices),
    }),

    addToSelection: (indices) => set((state) => {
      const newSelection = new Set(state.selectedPointIndices);
      indices.forEach(i => newSelection.add(i));
      return { selectedPointIndices: newSelection };
    }),

    removeFromSelection: (indices) => set((state) => {
      const newSelection = new Set(state.selectedPointIndices);
      indices.forEach(i => newSelection.delete(i));
      return { selectedPointIndices: newSelection };
    }),

    clearSelection: () => set({ selectedPointIndices: new Set(), selectedInstanceId: null, pickedInstanceIds: new Set() }),

    setIsSelecting: (isSelecting) => set({ isSelecting }),

    // =========================================================================
    // LABEL ACTIONS
    // =========================================================================

    labelSelectedPoints: (classId) => {
      const { selectedPointIndices } = get();
      if (selectedPointIndices.size === 0) return;

      get().labelPoints(Array.from(selectedPointIndices), classId, `Labeled ${selectedPointIndices.size} points`);
      get().clearSelection();
    },

    labelPoints: (indices, classId, description = 'Label points') => {
      const { currentFrameIndex, frameSegmentations, undoStack, maxHistorySize, hiddenInstances, segmentationMode } = get();
      const frameSeg = frameSegmentations.get(currentFrameIndex);
      if (!frameSeg) return;

      const newUndoStack = [...undoStack, makeHistoryEntry(frameSeg, segmentationMode, currentFrameIndex, description)].slice(-maxHistorySize);
      const classIndex = parseInt(classId, 10) || 0;
      const newFrameSegmentations = new Map(frameSegmentations);

      if (segmentationMode === 'semantic') {
        // Semantic layer: class-only, no instances.
        const newSemantic = new Int32Array(frameSeg.semanticLabels);
        indices.forEach(idx => {
          if (idx >= 0 && idx < newSemantic.length) newSemantic[idx] = classIndex;
        });
        newFrameSegmentations.set(currentFrameIndex, { ...frameSeg, semanticLabels: newSemantic, semanticDirty: true });
        set({ frameSegmentations: newFrameSegmentations, undoStack: newUndoStack, redoStack: [] });
        return;
      }

      // Instance layer: assign class + instance id.
      const newLabels = new Int32Array(frameSeg.labels);
      const newInstanceIds = new Int32Array(frameSeg.instanceIds);
      const { targetInstanceId, nextInstanceId, currentInstanceId } =
        resolveTargetInstance(get(), frameSeg, classIndex);

      indices.forEach(idx => {
        if (idx >= 0 && idx < newLabels.length) {
          const existingInstanceId = frameSeg.instanceIds[idx];
          if (existingInstanceId >= 0 && hiddenInstances.has(existingInstanceId)) {
            return; // Skip hidden-instance points
          }
          newLabels[idx] = classIndex;
          newInstanceIds[idx] = targetInstanceId;
        }
      });

      newFrameSegmentations.set(currentFrameIndex, {
        ...frameSeg,
        labels: newLabels,
        instanceIds: newInstanceIds,
        isDirty: true,
        nextInstanceId,
      });

      set({
        frameSegmentations: newFrameSegmentations,
        undoStack: newUndoStack,
        redoStack: [],
        currentInstanceId,
      });
    },

    startBrushSession: () => {
      const { currentFrameIndex, frameSegmentations, segmentationMode } = get();
      const frameSeg = frameSegmentations.get(currentFrameIndex);
      if (!frameSeg) return;
      // Snapshot the active layer (not reactive state, avoids re-render).
      (get() as any)._brushSnapshot = {
        mode: segmentationMode,
        labels: new Int32Array(activeLabelsOf(frameSeg, segmentationMode)),
        instanceIds: new Int32Array(frameSeg.instanceIds),
      };
    },

    paintBrushPoints: (indices, classId) => {
      // Hot path: called once per animation frame (~60/s) while dragging the
      // brush. To avoid O(N) allocation + copy per tick, mutate the existing
      // typed arrays IN PLACE and only publish a lightweight `labelEditVersion`
      // bump plus the list of touched indices. The renderer subscribes to the
      // version and applies just those indices to the GPU buffer. Fresh array
      // references are re-published once per stroke in `endBrushSession` so
      // referential consumers (stats, save, minimap) re-sync. The pre-stroke
      // snapshot for undo is captured in `startBrushSession`.
      const { currentFrameIndex, frameSegmentations, hiddenInstances, segmentationMode } = get();
      const frameSeg = frameSegmentations.get(currentFrameIndex);
      if (!frameSeg) return;

      const classIndex = parseInt(classId, 10);
      const changed: number[] = [];

      if (segmentationMode === 'semantic') {
        const semantic = frameSeg.semanticLabels;
        for (let j = 0; j < indices.length; j++) {
          const idx = indices[j];
          if (idx >= 0 && idx < semantic.length) {
            semantic[idx] = classIndex;
            changed.push(idx);
          }
        }
        frameSeg.semanticDirty = true;
        set({ labelEditVersion: get().labelEditVersion + 1, lastPaintedIndices: changed });
        return;
      }

      // Instance layer: mutate labels + instance IDs in place.
      const labels = frameSeg.labels;
      const instanceIds = frameSeg.instanceIds;
      const { targetInstanceId, nextInstanceId, currentInstanceId } =
        resolveTargetInstance(get(), frameSeg, classIndex);

      for (let j = 0; j < indices.length; j++) {
        const idx = indices[j];
        if (idx >= 0 && idx < labels.length) {
          const existingInstanceId = instanceIds[idx];
          if (existingInstanceId >= 0 && hiddenInstances.has(existingInstanceId)) {
            continue;
          }
          labels[idx] = classIndex;
          instanceIds[idx] = targetInstanceId;
          changed.push(idx);
        }
      }

      frameSeg.isDirty = true;
      frameSeg.nextInstanceId = nextInstanceId;
      set({
        labelEditVersion: get().labelEditVersion + 1,
        lastPaintedIndices: changed,
        currentInstanceId,
      });
    },

    endBrushSession: (description = 'Brush paint') => {
      const { currentFrameIndex, frameSegmentations, undoStack, maxHistorySize } = get();
      const snapshot: { mode: SegmentationMode; labels: Int32Array; instanceIds: Int32Array } | undefined = (get() as any)._brushSnapshot;
      if (!snapshot) return;

      const historyEntry: SegmentationHistoryEntry = {
        frameIndex: currentFrameIndex,
        mode: snapshot.mode,
        labels: snapshot.labels,
        instanceIds: snapshot.instanceIds,
        timestamp: Date.now(),
        description,
      };
      const newUndoStack = [...undoStack, historyEntry].slice(-maxHistorySize);

      // Re-publish fresh array references so referential consumers (label stats,
      // save/dirty tracking, minimaps) re-sync exactly once per stroke after the
      // in-place paint mutations in `paintBrushPoints`.
      const frameSeg = frameSegmentations.get(currentFrameIndex);
      const newFrameSegmentations = new Map(frameSegmentations);
      if (frameSeg) {
        newFrameSegmentations.set(currentFrameIndex, {
          ...frameSeg,
          labels: new Int32Array(frameSeg.labels),
          instanceIds: new Int32Array(frameSeg.instanceIds),
          semanticLabels: new Int32Array(frameSeg.semanticLabels),
        });
      }

      set({ frameSegmentations: newFrameSegmentations, undoStack: newUndoStack, redoStack: [] });
      (get() as any)._brushSnapshot = undefined;
    },

    erasePoints: (indices) => {
      const { currentFrameIndex, frameSegmentations, undoStack, maxHistorySize, hiddenInstances, segmentationMode } = get();
      const frameSeg = frameSegmentations.get(currentFrameIndex);
      if (!frameSeg) return;

      const newUndoStack = [...undoStack, makeHistoryEntry(frameSeg, segmentationMode, currentFrameIndex, `Erased ${indices.length} points`)].slice(-maxHistorySize);
      const newFrameSegmentations = new Map(frameSegmentations);

      if (segmentationMode === 'semantic') {
        const newSemantic = new Int32Array(frameSeg.semanticLabels);
        indices.forEach(idx => {
          if (idx >= 0 && idx < newSemantic.length) newSemantic[idx] = -1;
        });
        newFrameSegmentations.set(currentFrameIndex, { ...frameSeg, semanticLabels: newSemantic, semanticDirty: true });
        set({ frameSegmentations: newFrameSegmentations, undoStack: newUndoStack, redoStack: [] });
        return;
      }

      // Erase from the instance layer (labels + instance IDs).
      const newLabels = new Int32Array(frameSeg.labels);
      const newInstanceIds = new Int32Array(frameSeg.instanceIds);
      indices.forEach(idx => {
        if (idx >= 0 && idx < newLabels.length) {
          const existingInstanceId = frameSeg.instanceIds[idx];
          if (existingInstanceId >= 0 && hiddenInstances.has(existingInstanceId)) {
            return; // Skip hidden-instance points
          }
          newLabels[idx] = -1;
          newInstanceIds[idx] = -1;
        }
      });

      newFrameSegmentations.set(currentFrameIndex, {
        ...frameSeg,
        labels: newLabels,
        instanceIds: newInstanceIds,
        isDirty: true,
      });

      set({
        frameSegmentations: newFrameSegmentations,
        undoStack: newUndoStack,
        redoStack: [],
      });
    },

    clearAllLabels: () => {
      const { currentFrameIndex, frameSegmentations, undoStack, maxHistorySize } = get();
      const frameSeg = frameSegmentations.get(currentFrameIndex);
      if (!frameSeg) return;

      const mode = get().segmentationMode;
      const newUndoStack = [...undoStack, makeHistoryEntry(frameSeg, mode, currentFrameIndex, 'Cleared all labels')].slice(-maxHistorySize);
      const newFrameSegmentations = new Map(frameSegmentations);

      if (mode === 'semantic') {
        newFrameSegmentations.set(currentFrameIndex, {
          ...frameSeg,
          semanticLabels: new Int32Array(frameSeg.pointCount).fill(-1),
          semanticDirty: true,
        });
        set({ frameSegmentations: newFrameSegmentations, undoStack: newUndoStack, redoStack: [] });
        return;
      }

      newFrameSegmentations.set(currentFrameIndex, {
        ...frameSeg,
        labels: new Int32Array(frameSeg.pointCount).fill(-1),
        instanceIds: new Int32Array(frameSeg.pointCount).fill(-1),
        isDirty: true,
        nextInstanceId: INSTANCE_ID_BASE, // Reset instance counter
      });

      set({
        frameSegmentations: newFrameSegmentations,
        undoStack: newUndoStack,
        redoStack: [],
        currentInstanceId: -1, // Reset current instance
      });
    },

    clearClassLabels: (classId: string) => {
      const { currentFrameIndex, frameSegmentations, undoStack, maxHistorySize } = get();
      const frameSeg = frameSegmentations.get(currentFrameIndex);
      if (!frameSeg) return;

      const classIndex = parseInt(classId);
      if (isNaN(classIndex)) return;

      const mode = get().segmentationMode;
      const newUndoStack = [...undoStack, makeHistoryEntry(frameSeg, mode, currentFrameIndex, `Cleared class ${classId} labels`)].slice(-maxHistorySize);
      const newFrameSegmentations = new Map(frameSegmentations);

      if (mode === 'semantic') {
        const newSemantic = new Int32Array(frameSeg.semanticLabels);
        for (let i = 0; i < newSemantic.length; i++) {
          if (newSemantic[i] === classIndex) newSemantic[i] = -1;
        }
        newFrameSegmentations.set(currentFrameIndex, { ...frameSeg, semanticLabels: newSemantic, semanticDirty: true });
        set({ frameSegmentations: newFrameSegmentations, undoStack: newUndoStack, redoStack: [] });
        return;
      }

      // Clear instance-layer points of this class.
      const newLabels = new Int32Array(frameSeg.labels);
      const newInstanceIds = new Int32Array(frameSeg.instanceIds);
      for (let i = 0; i < newLabels.length; i++) {
        if (newLabels[i] === classIndex) {
          newLabels[i] = -1;
          newInstanceIds[i] = -1;
        }
      }

      newFrameSegmentations.set(currentFrameIndex, {
        ...frameSeg,
        labels: newLabels,
        instanceIds: newInstanceIds,
        isDirty: true,
      });

      set({
        frameSegmentations: newFrameSegmentations,
        undoStack: newUndoStack,
        redoStack: [],
      });
    },

    deleteInstance: (instanceId: number) => {
      const { currentFrameIndex, frameSegmentations, undoStack, maxHistorySize } = get();
      const frameSeg = frameSegmentations.get(currentFrameIndex);
      if (!frameSeg) return;

      // Save current state to undo stack
      const historyEntry: SegmentationHistoryEntry = {
        frameIndex: currentFrameIndex,
        mode: 'instance',
        labels: new Int32Array(frameSeg.labels),
        instanceIds: new Int32Array(frameSeg.instanceIds),
        timestamp: Date.now(),
        description: `Deleted instance ${instanceId}`,
      };

      const newUndoStack = [...undoStack, historyEntry].slice(-maxHistorySize);

      // Clear only points with matching instance ID
      const newLabels = new Int32Array(frameSeg.labels);
      const newInstanceIds = new Int32Array(frameSeg.instanceIds);
      for (let i = 0; i < newLabels.length; i++) {
        if (newInstanceIds[i] === instanceId) {
          newLabels[i] = -1;
          newInstanceIds[i] = -1;
        }
      }

      // Update frame segmentation
      const newFrameSegmentations = new Map(frameSegmentations);
      newFrameSegmentations.set(currentFrameIndex, {
        ...frameSeg,
        labels: newLabels,
        instanceIds: newInstanceIds,
        isDirty: true,
      });

      set({
        frameSegmentations: newFrameSegmentations,
        undoStack: newUndoStack,
        redoStack: [],
      });
    },

    mergeInstances: (instanceIds, targetInstanceId) => {
      const { currentFrameIndex, frameSegmentations, undoStack, maxHistorySize } = get();
      const frameSeg = frameSegmentations.get(currentFrameIndex);
      if (!frameSeg) return;

      // Points belonging to any of these (except the target) get retagged.
      const sourceIds = new Set(instanceIds.filter((id) => id !== targetInstanceId));
      if (sourceIds.size === 0) return;

      const historyEntry: SegmentationHistoryEntry = {
        frameIndex: currentFrameIndex,
        mode: 'instance',
        labels: new Int32Array(frameSeg.labels),
        instanceIds: new Int32Array(frameSeg.instanceIds),
        timestamp: Date.now(),
        description: `Merged ${sourceIds.size + 1} instances into ${targetInstanceId}`,
      };
      const newUndoStack = [...undoStack, historyEntry].slice(-maxHistorySize);

      // Reassign instance IDs only — each point keeps its own class label.
      const newInstanceIds = new Int32Array(frameSeg.instanceIds);
      let changed = false;
      for (let i = 0; i < newInstanceIds.length; i++) {
        if (sourceIds.has(newInstanceIds[i])) {
          newInstanceIds[i] = targetInstanceId;
          changed = true;
        }
      }
      if (!changed) return;

      const newFrameSegmentations = new Map(frameSegmentations);
      newFrameSegmentations.set(currentFrameIndex, {
        ...frameSeg,
        instanceIds: newInstanceIds,
        isDirty: true,
      });
      set({
        frameSegmentations: newFrameSegmentations,
        undoStack: newUndoStack,
        redoStack: [],
        currentInstanceId: -1, // any in-progress segment is now ambiguous
      });
    },

    splitInstanceGroups: (sourceInstanceId, groups) => {
      const { currentFrameIndex, frameSegmentations, undoStack, maxHistorySize } = get();
      const frameSeg = frameSegmentations.get(currentFrameIndex);
      if (!frameSeg) return [];

      const nonEmpty = groups.filter((g) => g.length > 0);
      if (nonEmpty.length === 0) return [];

      const historyEntry: SegmentationHistoryEntry = {
        frameIndex: currentFrameIndex,
        mode: 'instance',
        labels: new Int32Array(frameSeg.labels),
        instanceIds: new Int32Array(frameSeg.instanceIds),
        timestamp: Date.now(),
        description: `Split instance ${sourceInstanceId} into ${nonEmpty.length + 1}`,
      };
      const newUndoStack = [...undoStack, historyEntry].slice(-maxHistorySize);

      const newInstanceIds = new Int32Array(frameSeg.instanceIds);
      let nextId = Math.max(frameSeg.nextInstanceId, INSTANCE_ID_BASE);
      const newIds: number[] = [];
      let moved = false;

      for (const group of nonEmpty) {
        const newId = nextId++;
        let groupMoved = false;
        for (const idx of group) {
          // Only reassign points that actually still belong to the source.
          if (idx >= 0 && idx < newInstanceIds.length && newInstanceIds[idx] === sourceInstanceId) {
            newInstanceIds[idx] = newId;
            groupMoved = true;
            moved = true;
          }
        }
        if (groupMoved) newIds.push(newId);
        else nextId--; // reclaim the unused ID so numbering stays gap-free
      }

      if (!moved) return [];

      const newFrameSegmentations = new Map(frameSegmentations);
      newFrameSegmentations.set(currentFrameIndex, {
        ...frameSeg,
        instanceIds: newInstanceIds,
        isDirty: true,
        nextInstanceId: nextId,
      });
      set({
        frameSegmentations: newFrameSegmentations,
        undoStack: newUndoStack,
        redoStack: [],
        currentInstanceId: -1,
      });
      return newIds;
    },

    highlightInstance: (instanceId) => {
      const { currentFrameIndex, frameSegmentations } = get();
      const frameSeg = frameSegmentations.get(currentFrameIndex);
      if (!frameSeg) return;
      const selected = new Set<number>();
      for (let i = 0; i < frameSeg.instanceIds.length; i++) {
        if (frameSeg.instanceIds[i] === instanceId) selected.add(i);
      }
      set({ selectedPointIndices: selected, selectedInstanceId: instanceId });
    },

    selectInstanceByPoint: (pointIndex, additive = false) => {
      const { currentFrameIndex, frameSegmentations, segmentationMode } = get();
      if (segmentationMode !== 'instance') return;
      const frameSeg = frameSegmentations.get(currentFrameIndex);
      if (!frameSeg || pointIndex < 0 || pointIndex >= frameSeg.instanceIds.length) return;
      const instanceId = frameSeg.instanceIds[pointIndex];
      if (instanceId < 0) {
        // Clicked an unlabeled point → clear focus (and pick set on a plain click).
        if (additive) return;
        set({ selectedPointIndices: new Set(), selectedInstanceId: null, pickedInstanceIds: new Set() });
        return;
      }
      if (additive) {
        // Shift+click → toggle into the merge pick set.
        get().togglePickedInstance(instanceId);
        return;
      }
      // Plain click → focus this instance and reset any merge pick.
      set({ pickedInstanceIds: new Set() });
      get().highlightInstance(instanceId);
    },

    togglePickedInstance: (instanceId) => {
      const { currentFrameIndex, frameSegmentations, pickedInstanceIds } = get();
      const frameSeg = frameSegmentations.get(currentFrameIndex);
      if (!frameSeg) return;
      const picked = new Set(pickedInstanceIds);
      if (picked.has(instanceId)) picked.delete(instanceId);
      else picked.add(instanceId);
      // Highlight every point of every picked instance so the selection is visible.
      const selected = new Set<number>();
      for (let i = 0; i < frameSeg.instanceIds.length; i++) {
        if (picked.has(frameSeg.instanceIds[i])) selected.add(i);
      }
      set({ pickedInstanceIds: picked, selectedPointIndices: selected, selectedInstanceId: null });
    },

    clearPickedInstances: () => set({ pickedInstanceIds: new Set(), selectedPointIndices: new Set() }),

    mergePickedInstances: () => {
      const ids = Array.from(get().pickedInstanceIds);
      if (ids.length < 2) return;
      // Merge into the earliest-created instance (lowest ID) to keep its number.
      const target = Math.min(...ids);
      get().mergeInstances(ids, target);
      set({ pickedInstanceIds: new Set() });
    },

    beginSplit: (instanceId) => {
      // Activate the brush as a selector and start a fresh selection.
      set({
        splitSourceInstanceId: instanceId,
        activeTool: 'brush',
        selectedPointIndices: new Set(),
      });
    },

    addSplitSelection: (indices) => {
      const { currentFrameIndex, frameSegmentations, splitSourceInstanceId, selectedPointIndices } = get();
      if (splitSourceInstanceId == null) return;
      const frameSeg = frameSegmentations.get(currentFrameIndex);
      if (!frameSeg) return;
      // Only points that currently belong to the source instance are selectable.
      const next = new Set(selectedPointIndices);
      for (const idx of indices) {
        if (idx >= 0 && idx < frameSeg.instanceIds.length && frameSeg.instanceIds[idx] === splitSourceInstanceId) {
          next.add(idx);
        }
      }
      set({ selectedPointIndices: next });
    },

    confirmSplit: () => {
      const { splitSourceInstanceId, selectedPointIndices } = get();
      if (splitSourceInstanceId == null) return null;
      const selected = Array.from(selectedPointIndices);
      // splitInstanceGroups filters to points still owned by the source.
      const newIds = selected.length > 0
        ? get().splitInstanceGroups(splitSourceInstanceId, [selected])
        : [];
      // Keep the split-off points highlighted so the new instance is visibly
      // separated from the original right after the split.
      set({ splitSourceInstanceId: null, activeTool: 'select' });
      return newIds.length > 0 ? newIds[0] : null;
    },

    cancelSplit: () => {
      set({ splitSourceInstanceId: null, selectedPointIndices: new Set(), activeTool: 'select' });
    },

    // =========================================================================
    // INSTANCE MANAGEMENT
    // =========================================================================

    completeSegment: () => {
      // Mark the current segment as complete - next paint starts a new instance
      set({ currentInstanceId: -1 });
      console.log('[Segmentation] Segment completed. Next paint will start a new instance.');
    },

    getCurrentInstanceId: () => {
      return get().currentInstanceId;
    },

    getInstancesForFrame: (frameIndex) => {
      const frameSeg = get().frameSegmentations.get(frameIndex);
      if (!frameSeg) return new Map();

      // In semantic mode the "segments" are classes: group the semantic layer
      // by class (instanceId == classId). In instance mode, group the instance
      // layer by instance ID.
      const semantic = get().segmentationMode === 'semantic';
      const labelsArr = semantic ? frameSeg.semanticLabels : frameSeg.labels;
      const instanceArr = semantic ? frameSeg.semanticLabels : frameSeg.instanceIds;

      // First pass: count points per (instanceId, classId) pair
      const instanceClassCounts = new Map<number, Map<number, number>>();

      for (let i = 0; i < frameSeg.pointCount; i++) {
        const instanceId = instanceArr[i];
        const classId = labelsArr[i];

        if (instanceId >= 0 && classId >= 0) {
          if (!instanceClassCounts.has(instanceId)) {
            instanceClassCounts.set(instanceId, new Map());
          }
          const classCounts = instanceClassCounts.get(instanceId)!;
          classCounts.set(classId, (classCounts.get(classId) || 0) + 1);
        }
      }

      // Second pass: for each instance, find the dominant class
      const instances = new Map<number, { classId: number; pointCount: number }>();

      instanceClassCounts.forEach((classCounts, instanceId) => {
        let dominantClassId = -1;
        let maxCount = 0;
        let totalCount = 0;

        classCounts.forEach((count, classId) => {
          totalCount += count;
          if (count > maxCount) {
            maxCount = count;
            dominantClassId = classId;
          }
        });

        if (dominantClassId >= 0) {
          instances.set(instanceId, { classId: dominantClassId, pointCount: totalCount });
        }
      });

      return instances;
    },

    // =========================================================================
    // UNDO/REDO
    // =========================================================================

    undo: () => {
      const { undoStack, redoStack, frameSegmentations, maxHistorySize } = get();
      if (undoStack.length === 0) return;

      const lastEntry = undoStack[undoStack.length - 1];
      const newUndoStack = undoStack.slice(0, -1);

      const frameSeg = frameSegmentations.get(lastEntry.frameIndex);
      if (!frameSeg) return;

      // Snapshot the affected layer's current state onto the redo stack.
      const redoEntry = makeHistoryEntry(frameSeg, lastEntry.mode, lastEntry.frameIndex, `Redo: ${lastEntry.description}`);
      const newRedoStack = [...redoStack, redoEntry].slice(-maxHistorySize);

      // Restore just the layer this entry belongs to.
      const restored: FrameSegmentation = lastEntry.mode === 'semantic'
        ? { ...frameSeg, semanticLabels: new Int32Array(lastEntry.labels), semanticDirty: true }
        : { ...frameSeg, labels: new Int32Array(lastEntry.labels), instanceIds: new Int32Array(lastEntry.instanceIds), isDirty: true };
      const newFrameSegmentations = new Map(frameSegmentations);
      newFrameSegmentations.set(lastEntry.frameIndex, restored);

      set({ frameSegmentations: newFrameSegmentations, undoStack: newUndoStack, redoStack: newRedoStack });
    },

    redo: () => {
      const { undoStack, redoStack, frameSegmentations, maxHistorySize } = get();
      if (redoStack.length === 0) return;

      const lastEntry = redoStack[redoStack.length - 1];
      const newRedoStack = redoStack.slice(0, -1);

      const frameSeg = frameSegmentations.get(lastEntry.frameIndex);
      if (!frameSeg) return;

      const undoEntry = makeHistoryEntry(frameSeg, lastEntry.mode, lastEntry.frameIndex, lastEntry.description.replace('Redo: ', ''));
      const newUndoStack = [...undoStack, undoEntry].slice(-maxHistorySize);

      const restored: FrameSegmentation = lastEntry.mode === 'semantic'
        ? { ...frameSeg, semanticLabels: new Int32Array(lastEntry.labels), semanticDirty: true }
        : { ...frameSeg, labels: new Int32Array(lastEntry.labels), instanceIds: new Int32Array(lastEntry.instanceIds), isDirty: true };
      const newFrameSegmentations = new Map(frameSegmentations);
      newFrameSegmentations.set(lastEntry.frameIndex, restored);

      set({ frameSegmentations: newFrameSegmentations, undoStack: newUndoStack, redoStack: newRedoStack });
    },

    canUndo: () => get().undoStack.length > 0,

    canRedo: () => get().redoStack.length > 0,

    // =========================================================================
    // PERSISTENCE
    // =========================================================================

    setSceneContext: (sceneId, taskId) => set({ sceneId, taskId }),

    markFrameDirty: (frameIndex) => {
      const frameSegmentations = new Map(get().frameSegmentations);
      const frameSeg = frameSegmentations.get(frameIndex);
      if (frameSeg) {
        frameSegmentations.set(frameIndex, { ...frameSeg, isDirty: true });
        set({ frameSegmentations });
      }
    },

    markFrameSaved: (frameIndex) => {
      const frameSegmentations = new Map(get().frameSegmentations);
      const frameSeg = frameSegmentations.get(frameIndex);
      if (frameSeg) {
        frameSegmentations.set(frameIndex, {
          ...frameSeg,
          isDirty: false,
          semanticDirty: false,
          // New baselines = what we just persisted.
          baselineLabels: new Int32Array(frameSeg.labels),
          baselineInstanceIds: new Int32Array(frameSeg.instanceIds),
          baselineSemanticLabels: new Int32Array(frameSeg.semanticLabels),
        });
        set({ frameSegmentations, lastSaveTime: Date.now() });
      }
    },

    getLabelsForFrame: (frameIndex) => {
      const frameSeg = get().frameSegmentations.get(frameIndex);
      return frameSeg ? frameSeg.labels : null;
    },

    getSemanticLabelsForFrame: (frameIndex) => {
      const frameSeg = get().frameSegmentations.get(frameIndex);
      return frameSeg ? frameSeg.semanticLabels : null;
    },

    getDirtyFrames: () => {
      const dirtyFrames: number[] = [];
      get().frameSegmentations.forEach((seg, frameIndex) => {
        if (seg.isDirty || seg.semanticDirty) dirtyFrames.push(frameIndex);
      });
      return dirtyFrames;
    },

    getFrameDelta: (frameIndex) => {
      // Walk the labels in tandem with the baseline. Any index where the
      // current label/instance differs is something this client changed
      // since the last load/save and needs to be sent to the server.
      // Returning null when there's no baseline (frame still loading) or no
      // changes lets the caller fall back to a full-snapshot save.
      const frameSeg = get().frameSegmentations.get(frameIndex);
      if (!frameSeg || !frameSeg.baselineLabels) return null;
      const { labels, instanceIds, baselineLabels, baselineInstanceIds } = frameSeg;
      if (labels.length !== baselineLabels.length) return null;

      const indices: number[] = [];
      const newLabels: number[] = [];
      const newInstanceIds: number[] = [];
      const hasInstanceBaseline =
        baselineInstanceIds !== null && baselineInstanceIds.length === instanceIds.length;
      for (let i = 0; i < labels.length; i++) {
        const labelChanged = labels[i] !== baselineLabels[i];
        const instanceChanged =
          hasInstanceBaseline && instanceIds[i] !== baselineInstanceIds![i];
        if (labelChanged || instanceChanged) {
          indices.push(i);
          newLabels.push(labels[i]);
          newInstanceIds.push(instanceIds[i]);
        }
      }
      if (indices.length === 0) return null;
      return {
        indices,
        labels: newLabels,
        instanceIds: hasInstanceBaseline ? newInstanceIds : undefined,
      };
    },

    applyServerMerge: (frameIndex, serverLabels, serverInstanceIds) => {
      // Three-way merge: server response is the truth at save-time (and
      // includes any concurrent annotator's writes that landed before
      // ours). For each point, if THIS client didn't change it since the
      // baseline we sent up, adopt the server's value — that's how the
      // other annotator's edits arrive without a page reload. If we did
      // change it, keep ours (we just sent it; the server already has it).
      const { frameSegmentations } = get();
      const frameSeg = frameSegmentations.get(frameIndex);
      if (!frameSeg) return;
      const { labels, instanceIds, baselineLabels, baselineInstanceIds, pointCount } = frameSeg;
      if (serverLabels.length !== pointCount) return; // defensive

      const newLabels = new Int32Array(labels);
      const newInstanceIds = new Int32Array(instanceIds);
      let stillDirty = false;

      for (let i = 0; i < pointCount; i++) {
        const baseL = baselineLabels ? baselineLabels[i] : -1;
        if (labels[i] === baseL) {
          newLabels[i] = serverLabels[i];
        } else if (labels[i] !== serverLabels[i]) {
          // We have a local change that the server doesn't reflect yet
          // (probably painted while the request was in flight). Keep ours.
          stillDirty = true;
        }
      }
      if (serverInstanceIds && serverInstanceIds.length === pointCount) {
        for (let i = 0; i < pointCount; i++) {
          const baseI = baselineInstanceIds ? baselineInstanceIds[i] : -1;
          if (instanceIds[i] === baseI) {
            newInstanceIds[i] = serverInstanceIds[i];
          }
        }
      }

      const newFrameSegmentations = new Map(frameSegmentations);
      newFrameSegmentations.set(frameIndex, {
        ...frameSeg,
        labels: newLabels,
        instanceIds: newInstanceIds,
        // New baseline = server's snapshot. Any future delta is measured
        // from here (covers both our writes and the other annotator's).
        baselineLabels: new Int32Array(serverLabels),
        baselineInstanceIds: serverInstanceIds
          ? new Int32Array(serverInstanceIds)
          : new Int32Array(newInstanceIds),
        isDirty: stillDirty,
      });
      set({ frameSegmentations: newFrameSegmentations, lastSaveTime: Date.now() });
    },

    // =========================================================================
    // VIEW SETTINGS
    // =========================================================================

    setShowOnlyLabeled: (show) => set({ showOnlyLabeled: show }),

    setLabelOpacity: (opacity) => set({ labelOpacity: opacity }),

    setPointSize: (size) => set({ pointSize: Math.max(0.3, Math.min(3.0, size)) }),

    setColorMode: (mode) => set({ colorMode: mode }),

    // =========================================================================
    // 4D SETTINGS
    // =========================================================================

    setIs4DMode: (is4D) => set({ is4DMode: is4D }),

    setScanCount: (count) => set({ scanCount: Math.max(1, Math.min(20, count)) }),

    setShow4DControls: (show) => set({ show4DControls: show }),

    // =========================================================================
    // HOVER STATE
    // =========================================================================

    setHoveredPoint: (index) => set({ hoveredPointIndex: index }),

    setBrushWorldPosition: (pos) => set({ brushWorldPosition: pos }),
    setBrushIsPainting: (painting) => set({ brushIsPainting: painting }),

    // =========================================================================
    // INSTANCE VISIBILITY
    // =========================================================================

    toggleInstanceVisibility: (instanceId) => set((state) => {
      const newHidden = new Set(state.hiddenInstances);
      if (newHidden.has(instanceId)) {
        newHidden.delete(instanceId);
      } else {
        newHidden.add(instanceId);
      }
      return { hiddenInstances: newHidden };
    }),

    setInstanceHidden: (instanceId, hidden) => set((state) => {
      const newHidden = new Set(state.hiddenInstances);
      if (hidden) {
        newHidden.add(instanceId);
      } else {
        newHidden.delete(instanceId);
      }
      return { hiddenInstances: newHidden };
    }),

    isInstanceHidden: (instanceId) => get().hiddenInstances.has(instanceId),

    clearHiddenInstances: () => set({ hiddenInstances: new Set() }),

    // =========================================================================
    // RESET
    // =========================================================================

    reset: () => set(initialState),
  }))
);

// =============================================================================
// SELECTORS
// =============================================================================

export const useCurrentFrameLabels = () => {
  const currentFrameIndex = useSegmentationStore((s) => s.currentFrameIndex);
  const frameSegmentations = useSegmentationStore((s) => s.frameSegmentations);
  const mode = useSegmentationStore((s) => s.segmentationMode);
  const frameSeg = frameSegmentations.get(currentFrameIndex);
  if (!frameSeg) return null;
  // Render the active layer's class labels.
  return mode === 'semantic' ? frameSeg.semanticLabels : frameSeg.labels;
};

export const useCurrentFrameInstanceIds = () => {
  const currentFrameIndex = useSegmentationStore((s) => s.currentFrameIndex);
  const frameSegmentations = useSegmentationStore((s) => s.frameSegmentations);
  const mode = useSegmentationStore((s) => s.segmentationMode);
  const frameSeg = frameSegmentations.get(currentFrameIndex);
  if (!frameSeg) return null;
  // Semantic layer has no instances; use the class labels so per-class grouping
  // and hidden-instance masking degrade gracefully.
  return mode === 'semantic' ? frameSeg.semanticLabels : frameSeg.instanceIds;
};

export const useSelectedPointCount = () => {
  return useSegmentationStore((s) => s.selectedPointIndices.size);
};

export const useCanUndo = () => {
  return useSegmentationStore((s) => s.undoStack.length > 0);
};

export const useCanRedo = () => {
  return useSegmentationStore((s) => s.redoStack.length > 0);
};

export const useLabelStats = () => {
  const currentFrameIndex = useSegmentationStore((s) => s.currentFrameIndex);
  const frameSegmentations = useSegmentationStore((s) => s.frameSegmentations);

  const mode = useSegmentationStore((s) => s.segmentationMode);
  const frameSeg = frameSegmentations.get(currentFrameIndex);
  if (!frameSeg) return { total: 0, labeled: 0, unlabeled: 0, byClass: {} as Record<number, number> };

  const labels = mode === 'semantic' ? frameSeg.semanticLabels : frameSeg.labels;
  let labeled = 0;
  const byClass: Record<number, number> = {};

  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (label >= 0) {
      labeled++;
      byClass[label] = (byClass[label] || 0) + 1;
    }
  }

  return {
    total: labels.length,
    labeled,
    unlabeled: labels.length - labeled,
    byClass,
  };
};

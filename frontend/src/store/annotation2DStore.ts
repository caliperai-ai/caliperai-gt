import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';


export type Tool2D =
  | 'select'
  | 'pan'
  | 'box'
  | 'rotated_box'
  | 'ellipse'
  | 'polygon'
  | 'polyline'
  | 'points'
  | 'brush'
  | 'eraser'
  | 'semantic_segment'
  | 'ai_polygon'
  | 'scissors'
  | 'ai_track';

export type DrawingMode = 'idle' | 'drawing' | 'editing';

export interface Annotation2D {
  id: string;
  type: 'box' | 'box2d' | 'rotated_box' | 'ellipse' | 'polygon' | 'polyline' | 'points' | 'mask' | 'semantic_segment';
  classId: string;
  trackId?: string;
  frameId: string;
  cameraId: string;
  data: AnnotationData2D;
  attributes: Record<string, any>;
  isLocked: boolean;
  isHidden: boolean;
  zIndex: number;
  source?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface BoxData {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RotatedBoxData {
  cx: number;
  cy: number;
  width: number;
  height: number;
  rotation: number;
}

export interface EllipseData {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  rotation?: number;
}

export interface PolygonData {
  points: Array<{ x: number; y: number }>;
  isClosed: boolean;
  isSmooth?: boolean;
  tension?: number;
}

export interface PolylineData {
  points: Array<{ x: number; y: number }>;
  isBezier: boolean;
}

export interface PointsData {
  points: Array<{ x: number; y: number; label?: string; visibility?: number }>;
}

export interface MaskData {
  rle?: number[];
  imageData?: string;
  bounds: BoxData;
}

export interface SemanticSegmentData {
  polygon: Array<{ x: number; y: number }>;
  isClosed: true;
  fillColor?: string;
  opacity?: number;
  isSmooth?: boolean;
  tension?: number;
  sourcePolygonId?: string;
}

export type AnnotationData2D = BoxData | RotatedBoxData | EllipseData | PolygonData | PolylineData | PointsData | MaskData | SemanticSegmentData;

export interface Track2D {
  id: string;
  classId: string;
  name?: string;
  attributes: Record<string, unknown>;
  annotationIds: Set<string>;
  createdAt: Date;
  updatedAt: Date;
}

export interface HistoryEntry {
  annotations: Map<string, Annotation2D>;
  selectedIds: string[];
  description: string;
}

export interface Annotation2DState {
  annotations: Map<string, Annotation2D>;
  selectedIds: string[];
  hoveredId: string | null;

  activeTool: Tool2D;
  drawingMode: DrawingMode;
  activeClassId: string;

  currentDrawing: Partial<Annotation2D> | null;
  drawingPoints: Array<{ x: number; y: number }>;

  brushSize: number;
  brushHardness: number;
  eraserSize: number;

  zoom: number;
  panOffset: { x: number; y: number };
  gridEnabled: boolean;
  snapToGrid: boolean;
  gridSize: number;

  clipboard: Annotation2D[];

  history: HistoryEntry[];
  historyIndex: number;
  maxHistorySize: number;

  currentFrameId: string | null;
  currentCameraId: string;

  showLabels: boolean;
  showConfidence: boolean;
  fillOpacity: number;

  tracks: Map<string, Track2D>;
  activeTrackId: string | null;

  setActiveTool: (tool: Tool2D) => void;
  setActiveClass: (classId: string) => void;
  setBrushSize: (size: number) => void;
  setEraserSize: (size: number) => void;

  select: (id: string, additive?: boolean) => void;
  selectAll: () => void;
  deselectAll: () => void;
  setHovered: (id: string | null) => void;

  createAnnotation: (annotation: Omit<Annotation2D, 'id' | 'createdAt' | 'updatedAt' | 'zIndex'>) => string;
  addAnnotation: (annotation: Annotation2D) => void;
  updateAnnotation: (id: string, updates: Partial<Annotation2D>) => void;
  batchUpdateAnnotations: (
    updates: Array<{ id: string; changes: Partial<Annotation2D> }>,
    description: string,
    replaceLast?: boolean,
  ) => void;
  deleteAnnotation: (id: string) => void;
  deleteSelected: () => void;

  createTrack: (classId: string, name?: string, attributes?: Record<string, unknown>) => string;
  updateTrack: (id: string, updates: Partial<Pick<Track2D, 'classId' | 'name' | 'attributes'>>) => void;
  deleteTrack: (id: string, deleteAnnotations?: boolean) => void;
  addAnnotationToTrack: (trackId: string, annotationId: string) => void;
  removeAnnotationFromTrack: (trackId: string, annotationId: string) => void;
  setActiveTrack: (trackId: string | null) => void;
  getTrack: (trackId: string) => Track2D | undefined;
  getAllAnnotations: () => Annotation2D[];
  getAllTracks: () => Track2D[];
  getAnnotationsByTrack: (trackId: string) => Annotation2D[];

  startDrawing: (point: { x: number; y: number }) => void;
  continueDrawing: (point: { x: number; y: number }) => void;
  finishDrawing: () => void;
  cancelDrawing: () => void;

  copy: () => void;
  paste: (offset?: { x: number; y: number }) => void;
  cut: () => void;
  duplicate: () => void;

  undo: () => void;
  redo: () => void;
  pushHistory: (description: string) => void;

  toggleVisibility: (id: string) => void;
  toggleLock: (id: string) => void;
  hideAll: () => void;
  showAll: () => void;
  lockAll: () => void;
  unlockAll: () => void;

  bringToFront: (id: string) => void;
  sendToBack: (id: string) => void;
  bringForward: (id: string) => void;
  sendBackward: (id: string) => void;

  setZoom: (zoom: number) => void;
  setPanOffset: (offset: { x: number; y: number }) => void;
  fitToView: (imageSize: { width: number; height: number }, containerSize: { width: number; height: number }) => void;
  toggleGrid: () => void;
  toggleSnapToGrid: () => void;

  setCurrentFrame: (frameId: string) => void;
  setCurrentCamera: (cameraId: string) => void;

  setAnnotations: (annotations: Annotation2D[]) => void;
  clearAnnotations: () => void;

  reloadTrigger: number;
  triggerAnnotationReload: () => void;

  getSelectedAnnotations: () => Annotation2D[];
  getAnnotationsForFrame: (frameId: string, cameraId?: string) => Annotation2D[];
  canUndo: () => boolean;
  canRedo: () => boolean;
}


export const useAnnotation2DStore = create<Annotation2DState>((set, get) => ({
  annotations: new Map(),
  selectedIds: [],
  hoveredId: null,

  activeTool: 'select',
  drawingMode: 'idle',
  activeClassId: 'default',

  currentDrawing: null,
  drawingPoints: [],

  brushSize: 20,
  brushHardness: 1,
  eraserSize: 20,

  zoom: 1,
  panOffset: { x: 0, y: 0 },
  gridEnabled: false,
  snapToGrid: false,
  gridSize: 10,

  clipboard: [],

  history: [],
  historyIndex: -1,
  maxHistorySize: 50,

  currentFrameId: null,
  currentCameraId: 'front_camera',

  showLabels: true,
  showConfidence: false,
  fillOpacity: 0.3,

  tracks: new Map(),
  activeTrackId: null,

  setActiveTool: (tool) => {
    set({ activeTool: tool, drawingMode: 'idle', currentDrawing: null, drawingPoints: [] });
  },

  setActiveClass: (classId) => set({ activeClassId: classId }),
  setBrushSize: (size) => set({ brushSize: Math.max(1, Math.min(200, size)) }),
  setEraserSize: (size) => set({ eraserSize: Math.max(1, Math.min(200, size)) }),

  select: (id, additive = false) => {
    const { selectedIds } = get();
    if (additive) {
      if (selectedIds.includes(id)) {
        set({ selectedIds: selectedIds.filter(sid => sid !== id) });
      } else {
        set({ selectedIds: [...selectedIds, id] });
      }
    } else {
      set({ selectedIds: [id] });
    }
  },

  selectAll: () => {
    const { annotations, currentFrameId, currentCameraId } = get();
    const ids = Array.from(annotations.values())
      .filter(ann => ann.frameId === currentFrameId && ann.cameraId === currentCameraId && !ann.isHidden)
      .map(ann => ann.id);
    set({ selectedIds: ids });
  },

  deselectAll: () => set({ selectedIds: [] }),
  setHovered: (id) => set({ hoveredId: id }),

  createAnnotation: (annotation) => {
    const { annotations, pushHistory } = get();
    const id = uuidv4();
    const now = new Date();
    const maxZIndex = Math.max(0, ...Array.from(annotations.values()).map(a => a.zIndex));

    const newAnnotation: Annotation2D = {
      ...annotation,
      id,
      zIndex: maxZIndex + 1,
      createdAt: now,
      updatedAt: now,
    };

    const newAnnotations = new Map(annotations);
    newAnnotations.set(id, newAnnotation);

    set({ annotations: newAnnotations, selectedIds: [id] });
    pushHistory(`Create ${annotation.type}`);

    return id;
  },

  addAnnotation: (annotation) => {
    const { annotations, pushHistory } = get();
    // Don't add if already exists
    if (annotations.has(annotation.id)) return;

    const newAnnotations = new Map(annotations);
    newAnnotations.set(annotation.id, annotation);
    set({ annotations: newAnnotations });
    pushHistory(`Create ${annotation.type}`);
  },

  updateAnnotation: (id, updates) => {
    const { annotations, pushHistory } = get();
    const annotation = annotations.get(id);
    if (!annotation) return;

    // If updating an AUTO annotation, change source to 'manual'
    const updatedSource = annotation.source === 'auto' ? 'manual' : annotation.source;

    const newAnnotations = new Map(annotations);
    newAnnotations.set(id, {
      ...annotation,
      ...updates,
      source: updates.source !== undefined ? updates.source : updatedSource,
      updatedAt: new Date(),
    });

    set({ annotations: newAnnotations });
    pushHistory(`Update ${annotation.type}`);
  },

  batchUpdateAnnotations: (updates, description, replaceLast = false) => {
    const { annotations, selectedIds, history, historyIndex, maxHistorySize } = get();
    if (updates.length === 0) return;

    const newAnnotations = new Map(annotations);
    for (const u of updates) {
      const ann = newAnnotations.get(u.id);
      if (!ann) continue;
      newAnnotations.set(u.id, { ...ann, ...u.changes, updatedAt: new Date() });
    }

    const snapshot = {
      annotations: new Map(newAnnotations),
      selectedIds: [...selectedIds],
      description,
    };

    let newHistory: typeof history;
    let newIndex: number;
    if (replaceLast && historyIndex >= 0) {
      // Fold this batch into the previous entry (the originating edit), so the
      // whole correction is a single undo step.
      newHistory = history.slice(0, historyIndex + 1);
      newHistory[historyIndex] = snapshot;
      newIndex = historyIndex;
    } else {
      newHistory = history.slice(0, historyIndex + 1);
      newHistory.push(snapshot);
      if (newHistory.length > maxHistorySize) newHistory.shift();
      newIndex = newHistory.length - 1;
    }

    set({ annotations: newAnnotations, history: newHistory, historyIndex: newIndex });
  },

  deleteAnnotation: (id) => {
    const { annotations, selectedIds, pushHistory, tracks } = get();
    console.log('[Store deleteAnnotation] Deleting:', id, 'exists:', annotations.has(id));
    const annotation = annotations.get(id);
    const newAnnotations = new Map(annotations);
    newAnnotations.delete(id);

    // Also remove from any track
    if (annotation?.trackId) {
      const track = tracks.get(annotation.trackId);
      if (track) {
        const newTracks = new Map(tracks);
        const newAnnotationIds = new Set(track.annotationIds);
        newAnnotationIds.delete(id);
        newTracks.set(annotation.trackId, { ...track, annotationIds: newAnnotationIds, updatedAt: new Date() });
        set({ tracks: newTracks });
      }
    }

    set({
      annotations: newAnnotations,
      selectedIds: selectedIds.filter(sid => sid !== id),
    });
    console.log('[Store deleteAnnotation] Deleted, new size:', newAnnotations.size);
    pushHistory('Delete annotation');
  },

  deleteSelected: () => {
    const { annotations, selectedIds, pushHistory, tracks } = get();
    if (selectedIds.length === 0) return;

    const newAnnotations = new Map(annotations);
    const newTracks = new Map(tracks);

    selectedIds.forEach(id => {
      const annotation = annotations.get(id);
      if (annotation?.trackId) {
        const track = newTracks.get(annotation.trackId);
        if (track) {
          const newAnnotationIds = new Set(track.annotationIds);
          newAnnotationIds.delete(id);
          newTracks.set(annotation.trackId, { ...track, annotationIds: newAnnotationIds, updatedAt: new Date() });
        }
      }
      newAnnotations.delete(id);
    });

    set({ annotations: newAnnotations, selectedIds: [], tracks: newTracks });
    pushHistory(`Delete ${selectedIds.length} annotation(s)`);
  },

  // Track CRUD
  createTrack: (classId, name, attributes = {}) => {
    const { tracks } = get();
    const id = uuidv4();
    const now = new Date();

    const track: Track2D = {
      id,
      classId,
      name: name || `Track ${tracks.size + 1}`,
      attributes,
      annotationIds: new Set(),
      createdAt: now,
      updatedAt: now,
    };

    const newTracks = new Map(tracks);
    newTracks.set(id, track);
    set({ tracks: newTracks, activeTrackId: id });

    return id;
  },

  updateTrack: (id, updates) => {
    const { tracks } = get();
    const track = tracks.get(id);
    if (!track) return;

    const newTracks = new Map(tracks);
    newTracks.set(id, {
      ...track,
      ...updates,
      updatedAt: new Date(),
    });

    // If classId changed, update all annotations in this track
    if (updates.classId && updates.classId !== track.classId) {
      const { annotations } = get();
      const newAnnotations = new Map(annotations);
      track.annotationIds.forEach(annId => {
        const ann = newAnnotations.get(annId);
        if (ann) {
          newAnnotations.set(annId, { ...ann, classId: updates.classId!, updatedAt: new Date() });
        }
      });
      set({ annotations: newAnnotations });
    }

    set({ tracks: newTracks });
  },

  deleteTrack: (id, deleteAnnotations = false) => {
    const { tracks, annotations, activeTrackId, selectedIds, pushHistory } = get();
    const track = tracks.get(id);
    if (!track) return;

    const newAnnotations = new Map(annotations);
    let newSelectedIds = [...selectedIds];

    if (deleteAnnotations) {
      // Delete all annotations belonging to this track
      track.annotationIds.forEach(annId => {
        newAnnotations.delete(annId);
        newSelectedIds = newSelectedIds.filter(sid => sid !== annId);
      });
    } else {
      // Just remove track ID from all annotations (but don't delete them)
      track.annotationIds.forEach(annId => {
        const ann = newAnnotations.get(annId);
        if (ann) {
          const { trackId, ...rest } = ann;
          newAnnotations.set(annId, { ...rest, trackId: undefined, updatedAt: new Date() } as Annotation2D);
        }
      });
    }

    const newTracks = new Map(tracks);
    newTracks.delete(id);

    set({
      tracks: newTracks,
      annotations: newAnnotations,
      selectedIds: newSelectedIds,
      activeTrackId: activeTrackId === id ? null : activeTrackId,
    });

    pushHistory(deleteAnnotations ? 'Delete track with annotations' : 'Delete track');
  },

  addAnnotationToTrack: (trackId, annotationId) => {
    const { tracks, annotations } = get();
    const track = tracks.get(trackId);
    const annotation = annotations.get(annotationId);
    if (!track || !annotation) return;

    // Remove from old track if any
    if (annotation.trackId && annotation.trackId !== trackId) {
      const oldTrack = tracks.get(annotation.trackId);
      if (oldTrack) {
        const newOldAnnotationIds = new Set(oldTrack.annotationIds);
        newOldAnnotationIds.delete(annotationId);
        const newTracks = new Map(tracks);
        newTracks.set(annotation.trackId, { ...oldTrack, annotationIds: newOldAnnotationIds, updatedAt: new Date() });
        set({ tracks: newTracks });
      }
    }

    // Add to new track
    const newAnnotationIds = new Set(track.annotationIds);
    newAnnotationIds.add(annotationId);

    const newTracks = new Map(get().tracks);
    newTracks.set(trackId, { ...track, annotationIds: newAnnotationIds, updatedAt: new Date() });

    // Update annotation with track reference
    const newAnnotations = new Map(get().annotations);
    newAnnotations.set(annotationId, { ...annotation, trackId, classId: track.classId, updatedAt: new Date() });

    set({ tracks: newTracks, annotations: newAnnotations });
  },

  removeAnnotationFromTrack: (trackId, annotationId) => {
    const { tracks, annotations } = get();
    const track = tracks.get(trackId);
    const annotation = annotations.get(annotationId);
    if (!track || !annotation) return;

    const newAnnotationIds = new Set(track.annotationIds);
    newAnnotationIds.delete(annotationId);

    const newTracks = new Map(tracks);
    newTracks.set(trackId, { ...track, annotationIds: newAnnotationIds, updatedAt: new Date() });

    // Remove track reference from annotation
    const newAnnotations = new Map(annotations);
    const { trackId: _, ...annWithoutTrack } = annotation;
    newAnnotations.set(annotationId, { ...annWithoutTrack, trackId: undefined, updatedAt: new Date() } as Annotation2D);

    set({ tracks: newTracks, annotations: newAnnotations });
  },

  setActiveTrack: (trackId) => set({ activeTrackId: trackId }),

  getTrack: (trackId) => get().tracks.get(trackId),

  getAllAnnotations: () => Array.from(get().annotations.values()),

  getAllTracks: () => Array.from(get().tracks.values()),

  getAnnotationsByTrack: (trackId) => {
    const { annotations, tracks } = get();
    const track = tracks.get(trackId);
    if (!track) return [];
    return Array.from(track.annotationIds)
      .map(id => annotations.get(id))
      .filter(Boolean) as Annotation2D[];
  },

  // Drawing
  startDrawing: (point) => {
    const { activeTool, activeClassId, currentFrameId, currentCameraId } = get();
    if (!currentFrameId) return;

    set({
      drawingMode: 'drawing',
      drawingPoints: [point],
      currentDrawing: {
        type: activeTool === 'box' ? 'box' :
              activeTool === 'rotated_box' ? 'rotated_box' :
              activeTool === 'ellipse' ? 'ellipse' :
              activeTool === 'polygon' ? 'polygon' :
              activeTool === 'polyline' ? 'polyline' :
              activeTool === 'points' ? 'points' : 'box',
        classId: activeClassId,
        frameId: currentFrameId,
        cameraId: currentCameraId,
        attributes: {},
        isLocked: false,
        isHidden: false,
      },
    });
  },

  continueDrawing: (point) => {
    const { drawingMode, drawingPoints, activeTool } = get();
    if (drawingMode !== 'drawing') return;

    if (activeTool === 'box' || activeTool === 'ellipse') {
      // For box/ellipse, update the second point
      set({ drawingPoints: [drawingPoints[0], point] });
    } else {
      // For polygon/polyline, add new point
      set({ drawingPoints: [...drawingPoints, point] });
    }
  },

  finishDrawing: () => {
    const { drawingMode, drawingPoints, currentDrawing, activeTool, createAnnotation } = get();
    if (drawingMode !== 'drawing' || !currentDrawing || drawingPoints.length < 2) {
      set({ drawingMode: 'idle', currentDrawing: null, drawingPoints: [] });
      return;
    }

    let data: AnnotationData2D;

    if (activeTool === 'box') {
      const [p1, p2] = drawingPoints;
      data = {
        x: Math.min(p1.x, p2.x),
        y: Math.min(p1.y, p2.y),
        width: Math.abs(p2.x - p1.x),
        height: Math.abs(p2.y - p1.y),
      } as BoxData;
    } else if (activeTool === 'ellipse') {
      const [p1, p2] = drawingPoints;
      data = {
        cx: (p1.x + p2.x) / 2,
        cy: (p1.y + p2.y) / 2,
        rx: Math.abs(p2.x - p1.x) / 2,
        ry: Math.abs(p2.y - p1.y) / 2,
      } as EllipseData;
    } else if (activeTool === 'polygon') {
      data = {
        points: drawingPoints,
        isClosed: true,
      } as PolygonData;
    } else if (activeTool === 'polyline') {
      data = {
        points: drawingPoints,
        isBezier: false,
      } as PolylineData;
    } else if (activeTool === 'points') {
      data = {
        points: drawingPoints.map((p, i) => ({ ...p, label: `P${i + 1}`, visibility: 2 })),
      } as PointsData;
    } else {
      set({ drawingMode: 'idle', currentDrawing: null, drawingPoints: [] });
      return;
    }

    createAnnotation({
      ...currentDrawing as Omit<Annotation2D, 'id' | 'createdAt' | 'updatedAt' | 'zIndex' | 'data'>,
      data,
    });

    set({ drawingMode: 'idle', currentDrawing: null, drawingPoints: [] });
  },

  cancelDrawing: () => {
    set({ drawingMode: 'idle', currentDrawing: null, drawingPoints: [] });
  },

  // Clipboard
  copy: () => {
    const { annotations, selectedIds } = get();
    const copied = selectedIds.map(id => annotations.get(id)).filter(Boolean) as Annotation2D[];
    if (copied.length === 0) {
      return;
    }
    set({ clipboard: copied });
  },

  paste: (offset = { x: 20, y: 20 }) => {
    const { clipboard, createAnnotation, currentFrameId, currentCameraId } = get();
    if (clipboard.length === 0) {
      return;
    }
    if (!currentFrameId) {
      return;
    }

    const newIds: string[] = [];
    clipboard.forEach(ann => {
      // Offset the annotation data
      let newData = { ...ann.data };
      if ('x' in newData) {
        newData = { ...newData, x: (newData as BoxData).x + offset.x, y: (newData as BoxData).y + offset.y };
      } else if ('cx' in newData) {
        newData = { ...newData, cx: (newData as EllipseData).cx + offset.x, cy: (newData as EllipseData).cy + offset.y };
      } else if ('points' in newData) {
        const pointsData = newData as PolygonData | PolylineData | PointsData;
        newData = {
          ...newData,
          points: pointsData.points.map((p: { x: number; y: number }) => ({ ...p, x: p.x + offset.x, y: p.y + offset.y })),
        };
      }

      const id = createAnnotation({
        type: ann.type,
        classId: ann.classId,
        frameId: currentFrameId,
        cameraId: currentCameraId,
        data: newData,
        attributes: { ...ann.attributes },
        isLocked: false,
        isHidden: false,
      });
      newIds.push(id);
    });

    set({ selectedIds: newIds });
  },

  cut: () => {
    get().copy();
    get().deleteSelected();
  },

  duplicate: () => {
    get().copy();
    get().paste({ x: 10, y: 10 });
  },

  // History
  undo: () => {
    const { history, historyIndex } = get();
    console.log('[Store] Undo called, historyIndex:', historyIndex, 'history.length:', history.length);
    if (historyIndex <= 0) {
      console.log('[Store] Cannot undo, at beginning of history');
      return;
    }

    const prevEntry = history[historyIndex - 1];
    console.log('[Store] Undoing to:', prevEntry.description);
    set({
      annotations: new Map(prevEntry.annotations),
      selectedIds: prevEntry.selectedIds,
      historyIndex: historyIndex - 1,
    });
  },

  redo: () => {
    const { history, historyIndex } = get();
    console.log('[Store] Redo called, historyIndex:', historyIndex, 'history.length:', history.length);
    if (historyIndex >= history.length - 1) {
      console.log('[Store] Cannot redo, at end of history');
      return;
    }

    const nextEntry = history[historyIndex + 1];
    console.log('[Store] Redoing to:', nextEntry.description);
    set({
      annotations: new Map(nextEntry.annotations),
      selectedIds: nextEntry.selectedIds,
      historyIndex: historyIndex + 1,
    });
  },

  pushHistory: (description) => {
    const { annotations, selectedIds, history, historyIndex, maxHistorySize } = get();

    // Truncate future history if we're not at the end
    const newHistory = history.slice(0, historyIndex + 1);

    // Add new entry
    newHistory.push({
      annotations: new Map(annotations),
      selectedIds: [...selectedIds],
      description,
    });

    // Limit history size
    if (newHistory.length > maxHistorySize) {
      newHistory.shift();
    }

    console.log('[Store] pushHistory:', description, 'new length:', newHistory.length);
    set({
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  // Visibility/Lock
  toggleVisibility: (id) => {
    const { annotations } = get();
    const ann = annotations.get(id);
    if (!ann) return;

    const newAnnotations = new Map(annotations);
    newAnnotations.set(id, { ...ann, isHidden: !ann.isHidden });
    set({ annotations: newAnnotations });
  },

  toggleLock: (id) => {
    const { annotations } = get();
    const ann = annotations.get(id);
    if (!ann) return;

    const newAnnotations = new Map(annotations);
    newAnnotations.set(id, { ...ann, isLocked: !ann.isLocked });
    set({ annotations: newAnnotations });
  },

  hideAll: () => {
    const { annotations } = get();
    const newAnnotations = new Map(annotations);
    newAnnotations.forEach((ann, id) => {
      newAnnotations.set(id, { ...ann, isHidden: true });
    });
    set({ annotations: newAnnotations });
  },

  showAll: () => {
    const { annotations } = get();
    const newAnnotations = new Map(annotations);
    newAnnotations.forEach((ann, id) => {
      newAnnotations.set(id, { ...ann, isHidden: false });
    });
    set({ annotations: newAnnotations });
  },

  lockAll: () => {
    const { annotations } = get();
    const newAnnotations = new Map(annotations);
    newAnnotations.forEach((ann, id) => {
      newAnnotations.set(id, { ...ann, isLocked: true });
    });
    set({ annotations: newAnnotations });
  },

  unlockAll: () => {
    const { annotations } = get();
    const newAnnotations = new Map(annotations);
    newAnnotations.forEach((ann, id) => {
      newAnnotations.set(id, { ...ann, isLocked: false });
    });
    set({ annotations: newAnnotations });
  },

  // Z-order
  bringToFront: (id) => {
    const { annotations } = get();
    const ann = annotations.get(id);
    if (!ann) return;

    const maxZIndex = Math.max(...Array.from(annotations.values()).map(a => a.zIndex));
    const newAnnotations = new Map(annotations);
    newAnnotations.set(id, { ...ann, zIndex: maxZIndex + 1 });
    set({ annotations: newAnnotations });
  },

  sendToBack: (id) => {
    const { annotations } = get();
    const ann = annotations.get(id);
    if (!ann) return;

    const minZIndex = Math.min(...Array.from(annotations.values()).map(a => a.zIndex));
    const newAnnotations = new Map(annotations);
    newAnnotations.set(id, { ...ann, zIndex: minZIndex - 1 });
    set({ annotations: newAnnotations });
  },

  bringForward: (id) => {
    const { annotations } = get();
    const ann = annotations.get(id);
    if (!ann) return;

    const newAnnotations = new Map(annotations);
    newAnnotations.set(id, { ...ann, zIndex: ann.zIndex + 1 });
    set({ annotations: newAnnotations });
  },

  sendBackward: (id) => {
    const { annotations } = get();
    const ann = annotations.get(id);
    if (!ann) return;

    const newAnnotations = new Map(annotations);
    newAnnotations.set(id, { ...ann, zIndex: ann.zIndex - 1 });
    set({ annotations: newAnnotations });
  },

  // View
  setZoom: (zoom) => set({ zoom: Math.max(0.1, Math.min(10, zoom)) }),
  setPanOffset: (offset) => set({ panOffset: offset }),

  fitToView: (imageSize, containerSize) => {
    const scaleX = containerSize.width / imageSize.width;
    const scaleY = containerSize.height / imageSize.height;
    const zoom = Math.min(scaleX, scaleY) * 0.95;

    const x = (containerSize.width - imageSize.width * zoom) / 2;
    const y = (containerSize.height - imageSize.height * zoom) / 2;

    set({ zoom, panOffset: { x, y } });
  },

  toggleGrid: () => set(state => ({ gridEnabled: !state.gridEnabled })),
  toggleSnapToGrid: () => set(state => ({ snapToGrid: !state.snapToGrid })),

  // Frame/Camera
  setCurrentFrame: (frameId) => set({ currentFrameId: frameId }),
  setCurrentCamera: (cameraId) => set({ currentCameraId: cameraId }),

  // Bulk operations
  setAnnotations: (annotations) => {
    const map = new Map<string, Annotation2D>();
    annotations.forEach(ann => map.set(ann.id, ann));
    set({ annotations: map, history: [], historyIndex: -1 });
    get().pushHistory('Load annotations');
  },

  clearAnnotations: () => {
    set({ annotations: new Map(), selectedIds: [], history: [], historyIndex: -1 });
  },

  reloadTrigger: 0,
  triggerAnnotationReload: () => set((state) => ({ reloadTrigger: state.reloadTrigger + 1 })),

  // Helpers
  getSelectedAnnotations: () => {
    const { annotations, selectedIds } = get();
    return selectedIds.map(id => annotations.get(id)).filter(Boolean) as Annotation2D[];
  },

  getAnnotationsForFrame: (frameId, cameraId) => {
    const { annotations, currentCameraId } = get();
    return Array.from(annotations.values())
      .filter(ann => ann.frameId === frameId && (cameraId ? ann.cameraId === cameraId : ann.cameraId === currentCameraId))
      .sort((a, b) => a.zIndex - b.zIndex);
  },

  canUndo: () => get().historyIndex > 0,
  canRedo: () => get().historyIndex < get().history.length - 1,
}));

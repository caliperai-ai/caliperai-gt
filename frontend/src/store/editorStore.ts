import React from 'react';
import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { annotationApi, annotation3DApi, Annotation3DCreate } from '@/api/client';
import type {
  Task,
  Scene,
  Frame,
  Annotation,
  CuboidData,
  TaxonomyConfig,
  ClassDefinition,
  EditorTool,
  LidarViewState,
  SelectionState,
  AnnotationType,
  AnnotationSource,
} from '@/types';

export type AnnotationColorMode = 'class' | 'attribute' | 'qa_status';


type DirtyState = 'new' | 'modified' | 'deleted';

interface HistoryEntry3D {
  annotations: Map<string, Annotation>;
  dirtyAnnotations: Map<string, DirtyState>;
  selectedIds: string[];
  description: string;
}

interface EditorState {
  task: Task | null;
  scene: Scene | null;
  taxonomy: TaxonomyConfig | null;
  frames: Frame[];
  annotations: Map<string, Annotation>;
  dirtyAnnotations: Map<string, DirtyState>;
  persistedAnnotationIds: Set<string>;

  history: HistoryEntry3D[];
  historyIndex: number;
  maxHistorySize: number;

  currentFrameIndex: number;
  currentFrame: Frame | null;

  activeTool: EditorTool['type'];
  activeClassId: string | null;
  isBoxPlacementActive: boolean;
  pendingClassDigits: string;

  lidarView: LidarViewState;
  selectedCameraId: string;
  cursorPosition: { x: number; y: number; z: number } | null;
  annotationColorMode: AnnotationColorMode;
  activeAttributeForColor: string | null;

  selection: SelectionState;

  isLoading: boolean;
  isSaving: boolean;
  suppressPropertiesPanel: boolean;

  setTask: (task: Task) => void;
  setScene: (scene: Scene) => void;
  setTaxonomy: (taxonomy: TaxonomyConfig) => void;
  setFrames: (frames: Frame[]) => void;
  setAnnotations: (annotations: Annotation[]) => void;
  mergeAnnotationsFromServer: (annotations: Annotation[], frameId: string) => void;

  goToFrame: (index: number) => void;
  nextFrame: () => void;
  prevFrame: () => void;

  setActiveTool: (tool: EditorTool['type']) => void;
  setActiveClass: (classId: string) => void;
  setPendingClassDigits: (digits: string) => void;
  setBoxPlacementActive: (active: boolean) => void;

  selectAnnotation: (id: string, additive?: boolean) => void;
  deselectAll: () => void;
  hoverAnnotation: (id: string | undefined) => void;

  createAnnotation: (annotation: Partial<Annotation>) => Annotation;
  createAnnotationsBatch: (partials: Partial<Annotation>[]) => Annotation[];
  updateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  updateAnnotationsBatch: (updates: Array<{ id: string; updates: Partial<Annotation> }>) => void;
  deleteAnnotation: (id: string) => void;
  deleteAllAnnotations: () => void;
  verifyAnnotation: (id: string) => void;
  saveAnnotations: () => Promise<{ success: boolean; error?: string }>;
  hasUnsavedChanges: () => boolean;

  undo: () => void;
  redo: () => void;
  pushHistory: (description: string) => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  setLidarView: (view: Partial<LidarViewState>) => void;
  setSelectedCamera: (cameraId: string) => void;
  setCursorPosition: (pos: { x: number; y: number; z: number } | null) => void;
  setSuppressPropertiesPanel: (suppress: boolean) => void;

  activateCameraView: (cameraId: string) => void;
  activateFrustumView: (cameraId: string) => void;
  deactivateCameraView: () => void;
  toggleImagePlane: () => void;
  toggleFrustumOnlyMode: () => void;

  toggleTopView: () => void;
  toggleFisheyeProjection: () => void;
  resetCameraView: () => void;
  focusOnAnnotation: (annotationId: string | undefined) => void;
  focusOnPosition: (position: { x: number; y: number; z: number } | undefined) => void;
  focusedAnnotationId?: string;

  setAnnotationColorMode: (mode: AnnotationColorMode) => void;
  setActiveAttributeForColor: (attributeId: string | null) => void;

  lockedAnnotationIds: Set<string>;
  setLockedAnnotationIds: (ids: Set<string>) => void;

  hiddenAnnotationIds: Set<string>;
  toggleAnnotationVisibility: (id: string) => void;
  setHiddenAnnotationIds: (ids: Set<string>) => void;
}

const defaultLidarView: LidarViewState = {
  camera: {
    position: { x: 0, y: -8, z: 5 },
    target: { x: 0, y: 30, z: 0 },
    up: { x: 0, y: 0, z: 1 },
  },
  pointSize: 0.01,
  colorMode: 'height',
  centerOnEgo: true,
  coordinateFrame: 'lidar',
  cameraView: {
    isActive: false,
    cameraId: null,
    showImagePlane: true,
    frustumOnlyMode: false,
    imageOnlyMode: false,
  },
  groundPlane: {
    enabled: true,
    distanceThreshold: 0.15,
    samplePercent: 30,
  },
  isTopView: false,
  showGrid: true,
  useFisheyeProjection: false,
  focusedAnnotationId: undefined,
  cameraResetCounter: 0,
  clipBox: {
    enabled: false,
    xMin: -50,
    xMax: 50,
    yMin: -50,
    yMax: 50,
    zMin: -5,
    zMax: 10,
  },
};

export const useEditorStore = create<EditorState>((set, get) => ({
  task: null,
  scene: null,
  taxonomy: null,
  frames: [],
  annotations: new Map(),
  dirtyAnnotations: new Map(),
  persistedAnnotationIds: new Set(),

  history: [],
  historyIndex: -1,
  maxHistorySize: 50,

  currentFrameIndex: 0,
  currentFrame: null,
  activeTool: 'select',
  activeClassId: null,
  isBoxPlacementActive: false,
  pendingClassDigits: '',
  lidarView: defaultLidarView,
  selectedCameraId: 'front_camera',
  cursorPosition: null,
  annotationColorMode: 'class',
  activeAttributeForColor: null,
  selection: {
    selectedAnnotationIds: [],
    hoveredAnnotationId: undefined,
    selectedPoints: undefined,
  },
  isLoading: false,
  isSaving: false,
  suppressPropertiesPanel: false,
  lockedAnnotationIds: new Set<string>(),
  hiddenAnnotationIds: new Set<string>(),

  setTask: (task) => set({ task }),

  setScene: (scene) => set({ scene }),

  setTaxonomy: (taxonomy) => set({
    taxonomy,
    activeClassId: taxonomy.classes[0]?.id ?? null,
  }),

  setFrames: (frames) => {
    const sorted = [...frames].sort((a, b) => a.frame_index - b.frame_index);
    set({
      frames: sorted,
      currentFrame: sorted[0] ?? null,
      currentFrameIndex: 0,
    });
  },

  setAnnotations: (annotations) => {
    const map = new Map<string, Annotation>();
    const persistedIds = new Set<string>();
    annotations.forEach((ann) => {
      map.set(ann.id, ann);
      persistedIds.add(ann.id);
    });
    set({
      annotations: map,
      dirtyAnnotations: new Map(),
      persistedAnnotationIds: persistedIds,
      history: [{
        annotations: new Map(map),
        dirtyAnnotations: new Map(),
        selectedIds: [],
        description: 'Initial state',
      }],
      historyIndex: 0,
    });

    import('./trackStore').then(({ useTrackStore }) => {
      useTrackStore.getState().initializeTracksFromAnnotations(map);
    });
  },

  mergeAnnotationsFromServer: (serverAnnotations, _frameId) => {
    const { annotations: currentAnnotations, dirtyAnnotations, persistedAnnotationIds } = get();

    const newAnnotations = new Map(currentAnnotations);
    const newPersistedIds = new Set(persistedAnnotationIds);

    for (const serverAnn of serverAnnotations) {
      const dirtyStatus = dirtyAnnotations.get(serverAnn.id);
      if (!dirtyStatus) {
        const dataObj = serverAnn.data as unknown as Record<string, unknown>;
        const isKeyframe = serverAnn.is_keyframe ?? (dataObj?.is_keyframe as boolean) ?? false;
        const annWithKeyframe = {
          ...serverAnn,
          is_keyframe: isKeyframe,
        };
        newAnnotations.set(serverAnn.id, annWithKeyframe);
        newPersistedIds.add(serverAnn.id);
      }
    }


    set({ annotations: newAnnotations, persistedAnnotationIds: newPersistedIds });

    import('./trackStore').then(({ useTrackStore }) => {
      useTrackStore.getState().initializeTracksFromAnnotations(newAnnotations);
    });
  },

  goToFrame: (index) => {
    const { frames, selection, annotations } = get();
    if (index >= 0 && index < frames.length) {
      const newFrame = frames[index];

      let newSelectedIds: string[] = [];

      if (selection.selectedAnnotationIds.length > 0) {
        const selectedAnnotation = annotations.get(selection.selectedAnnotationIds[0]);

        if (selectedAnnotation?.track_id) {
          const trackId = selectedAnnotation.track_id;

          for (const [annId, ann] of annotations) {
            if (ann.track_id === trackId && ann.frame_id === newFrame.id) {
              newSelectedIds = [annId];
              break;
            }
          }
        }
      }

      set({
        currentFrameIndex: index,
        currentFrame: newFrame,
        selection: {
          selectedAnnotationIds: newSelectedIds,
          hoveredAnnotationId: undefined,
          selectedPoints: undefined,
        },
      });
    }
  },

  nextFrame: () => {
    const { currentFrameIndex, frames } = get();
    if (currentFrameIndex < frames.length - 1) {
      get().goToFrame(currentFrameIndex + 1);
    }
  },

  prevFrame: () => {
    const { currentFrameIndex } = get();
    if (currentFrameIndex > 0) {
      get().goToFrame(currentFrameIndex - 1);
    }
  },

  setActiveTool: (tool) => set({ activeTool: tool }),

  setActiveClass: (classId) => set({ activeClassId: classId }),

  setPendingClassDigits: (digits) => set({ pendingClassDigits: digits }),

  setBoxPlacementActive: (active) => set({ isBoxPlacementActive: active }),

  selectAnnotation: (id, additive = false) => {
    const { selection } = get();
    if (additive) {
      const ids = selection.selectedAnnotationIds.includes(id)
        ? selection.selectedAnnotationIds.filter((i) => i !== id)
        : [...selection.selectedAnnotationIds, id];
      set({ selection: { ...selection, selectedAnnotationIds: ids } });
    } else {
      set({ selection: { ...selection, selectedAnnotationIds: [id] } });
    }
  },

  deselectAll: () => {
    set({
      selection: {
        selectedAnnotationIds: [],
        hoveredAnnotationId: undefined,
        selectedPoints: undefined,
      },
    });
  },

  hoverAnnotation: (id) => {
    const { selection } = get();
    set({ selection: { ...selection, hoveredAnnotationId: id } });
  },

  createAnnotation: (partial) => {
    const { task, currentFrame, activeClassId, annotations, dirtyAnnotations, scene } = get();

    if (!task || !currentFrame || !activeClassId) {
      throw new Error('Cannot create annotation: missing context');
    }

    get().pushHistory('Create annotation');

    const annotation: Annotation = {
      id: uuidv4(),
      task_id: task.id,
      frame_id: partial.frame_id ?? currentFrame.id,
      track_id: partial.track_id,
      type: partial.type as AnnotationType,
      class_id: partial.class_id ?? activeClassId,
      taxonomy_id: partial.taxonomy_id ?? scene?.selected_taxonomy_id,
      data: partial.data!,
      attributes: partial.attributes ?? {},
      source: partial.source ?? ('manual' as AnnotationSource),
      is_verified: true,
      is_keyframe: partial.is_keyframe ?? false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const newAnnotations = new Map(annotations);
    newAnnotations.set(annotation.id, annotation);

    const newDirty = new Map(dirtyAnnotations);
    newDirty.set(annotation.id, 'new');

    set({ annotations: newAnnotations, dirtyAnnotations: newDirty });

    return annotation;
  },

  createAnnotationsBatch: (partials) => {
    const { task, currentFrame, activeClassId, annotations, dirtyAnnotations, scene } = get();

    if (!task || !currentFrame || !activeClassId) {
      throw new Error('Cannot create annotations: missing context');
    }

    const newAnnotations = new Map(annotations);
    const newDirty = new Map(dirtyAnnotations);
    const createdAnnotations: Annotation[] = [];

    for (const partial of partials) {
      const annotation: Annotation = {
        id: uuidv4(),
        task_id: task.id,
        frame_id: partial.frame_id ?? currentFrame.id,
        track_id: partial.track_id,
        type: partial.type as AnnotationType,
        class_id: partial.class_id ?? activeClassId,
        taxonomy_id: partial.taxonomy_id ?? scene?.selected_taxonomy_id,
        data: partial.data!,
        attributes: partial.attributes ?? {},
        source: partial.source ?? ('manual' as AnnotationSource),
        is_verified: true,
        is_keyframe: partial.is_keyframe ?? false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      newAnnotations.set(annotation.id, annotation);
      newDirty.set(annotation.id, 'new');
      createdAnnotations.push(annotation);
    }

    set({ annotations: newAnnotations, dirtyAnnotations: newDirty });

    return createdAnnotations;
  },

  updateAnnotationsBatch: (updates) => {
    const { annotations, dirtyAnnotations, lockedAnnotationIds } = get();
    const newAnnotations = new Map(annotations);
    const newDirty = new Map(dirtyAnnotations);

    for (const { id, updates: updateData } of updates) {
      if (lockedAnnotationIds.has(id)) {
        console.warn('[EditorStore] Skipping batch update for locked annotation:', id);
        continue;
      }
      const annotation = newAnnotations.get(id);
      if (!annotation) continue;

      const updated = {
        ...annotation,
        ...updateData,
        updated_at: new Date().toISOString(),
      };

      newAnnotations.set(id, updated);

      if (!newDirty.has(id) || newDirty.get(id) !== 'new') {
        newDirty.set(id, 'modified');
      }
    }

    set({ annotations: newAnnotations, dirtyAnnotations: newDirty });
  },

  updateAnnotation: (id, updates) => {
    const { annotations, dirtyAnnotations, lockedAnnotationIds } = get();
    if (lockedAnnotationIds.has(id)) {
      console.warn('[EditorStore] Cannot update QA-approved locked annotation:', id);
      return;
    }
    const annotation = annotations.get(id);

    if (annotation) {
      const EPSILON = 1e-6;
      const currentCuboid = annotation.type === 'cuboid' ? annotation.data as CuboidData : null;
      const nextCuboid = updates.data ? updates.data as CuboidData : null;

      const centerChanged = !!(
        currentCuboid?.center &&
        nextCuboid?.center &&
        (
          Math.abs(nextCuboid.center.x - currentCuboid.center.x) > EPSILON ||
          Math.abs(nextCuboid.center.y - currentCuboid.center.y) > EPSILON ||
          Math.abs(nextCuboid.center.z - currentCuboid.center.z) > EPSILON
        )
      );

      const currentRotation = currentCuboid?.rotation;
      const nextRotation = nextCuboid?.rotation;
      const rotationChanged = !!(
        currentRotation &&
        nextRotation &&
        (
          Math.abs((nextRotation.yaw ?? 0) - (currentRotation.yaw ?? 0)) > EPSILON ||
          Math.abs((nextRotation.pitch ?? 0) - (currentRotation.pitch ?? 0)) > EPSILON ||
          Math.abs((nextRotation.roll ?? 0) - (currentRotation.roll ?? 0)) > EPSILON
        )
      );

      const currentDims = currentCuboid?.dimensions;
      const nextDims = nextCuboid?.dimensions;
      const dimensionsChanged = !!(
        currentDims &&
        nextDims &&
        (
          Math.abs(nextDims.length - currentDims.length) > EPSILON ||
          Math.abs(nextDims.width - currentDims.width) > EPSILON ||
          Math.abs(nextDims.height - currentDims.height) > EPSILON
        )
      );

      const isManualPoseEdit = (centerChanged || rotationChanged) && updates.source !== 'auto_interpolated';

      const willBecomeKeyframe = isManualPoseEdit && annotation.track_id && !annotation.is_keyframe;

      const isEditingExistingKeyframe = isManualPoseEdit && annotation.track_id && annotation.is_keyframe;

      const nowIso = new Date().toISOString();

      const updated = {
        ...annotation,
        ...updates,
        updated_at: nowIso,
        source: updates.data && annotation.source !== 'manual' && updates.source !== 'auto_interpolated'
          ? 'manual' as AnnotationSource
          : (updates.source ?? annotation.source),
        is_verified: updates.data && annotation.source !== 'manual'
          ? true
          : annotation.is_verified,
        is_keyframe: isManualPoseEdit && annotation.track_id
          ? true
          : (updates.is_keyframe ?? annotation.is_keyframe),
      };

      const newAnnotations = new Map(annotations);
      newAnnotations.set(id, updated);

      const newDirty = new Map(dirtyAnnotations);
      if (!newDirty.has(id) || newDirty.get(id) !== 'new') {
        newDirty.set(id, 'modified');
      }

      if (dimensionsChanged && annotation.track_id && nextDims) {
        newAnnotations.forEach((trackAnn, trackAnnId) => {
          if (trackAnnId === id || trackAnn.track_id !== annotation.track_id || trackAnn.type !== 'cuboid') return;

          const trackData = trackAnn.data as CuboidData;
          const trackDims = trackData.dimensions;
          const needsDimensionSync =
            Math.abs(trackDims.length - nextDims.length) > EPSILON ||
            Math.abs(trackDims.width - nextDims.width) > EPSILON ||
            Math.abs(trackDims.height - nextDims.height) > EPSILON;

          if (!needsDimensionSync) return;

          newAnnotations.set(trackAnnId, {
            ...trackAnn,
            data: {
              ...trackData,
              dimensions: { ...nextDims },
            },
            updated_at: nowIso,
          });

          if (!newDirty.has(trackAnnId) || newDirty.get(trackAnnId) !== 'new') {
            newDirty.set(trackAnnId, 'modified');
          }
        });
      }

      set({ annotations: newAnnotations, dirtyAnnotations: newDirty });

      if (willBecomeKeyframe && annotation.track_id && annotation.frame_id) {
        console.log('[EditorStore] Annotation became keyframe, triggering smart re-interpolation:', {
          annotationId: id,
          trackId: annotation.track_id,
          frameId: annotation.frame_id
        });
        import('./trackStore').then(({ useTrackStore }) => {
          const trackStore = useTrackStore.getState();
          const track = trackStore.tracks.get(annotation.track_id!);
          if (track && !track.keyframe_ids.has(annotation.frame_id)) {
            const newKeyframes = new Set(track.keyframe_ids);
            newKeyframes.add(annotation.frame_id);
            const updatedTrack = {
              ...track,
              keyframe_ids: newKeyframes,
              updated_at: new Date().toISOString(),
            };
            const newTracks = new Map(trackStore.tracks);
            newTracks.set(annotation.track_id!, updatedTrack);
            useTrackStore.setState({ tracks: newTracks });

            console.log('[EditorStore] Added keyframe, now calling interpolateAroundKeyframe. Keyframes:',
              Array.from(newKeyframes).length);

            setTimeout(() => {
              useTrackStore.getState().interpolateAroundKeyframe(annotation.track_id!, annotation.frame_id);
            }, 50);
          }
        });
      }

      if (isEditingExistingKeyframe && annotation.track_id && annotation.frame_id) {
        console.log('[EditorStore] Existing keyframe edited, triggering smart re-interpolation:', {
          annotationId: id,
          trackId: annotation.track_id,
          frameId: annotation.frame_id
        });
        import('./trackStore').then(({ useTrackStore }) => {
          setTimeout(() => {
            useTrackStore.getState().interpolateAroundKeyframe(annotation.track_id!, annotation.frame_id);
          }, 50);
        });
      }
    }
  },

  deleteAnnotation: (id) => {
    const { annotations, selection, dirtyAnnotations, lockedAnnotationIds } = get();
    if (lockedAnnotationIds.has(id)) {
      console.warn('[EditorStore] Cannot delete QA-approved locked annotation:', id);
      return;
    }
    const annotation = annotations.get(id);
    if (!annotation) return;

    get().pushHistory('Delete annotation');

    const newAnnotations = new Map(annotations);
    newAnnotations.delete(id);

    const newDirty = new Map(dirtyAnnotations);
    if (newDirty.get(id) === 'new') {
      newDirty.delete(id);
    } else if (annotation) {
      newDirty.set(id, 'deleted');
    }

    set({
      annotations: newAnnotations,
      dirtyAnnotations: newDirty,
      selection: {
        ...selection,
        selectedAnnotationIds: selection.selectedAnnotationIds.filter((i) => i !== id),
      },
    });
  },

  deleteAllAnnotations: () => {
    const { annotations, dirtyAnnotations, lockedAnnotationIds } = get();

    get().pushHistory('Delete all annotations');

    const newDirty = new Map(dirtyAnnotations);
    const remainingAnnotations = new Map<string, Annotation>();

    for (const [id, ann] of annotations) {
      if (lockedAnnotationIds.has(id)) {
        remainingAnnotations.set(id, ann);
        continue;
      }
      if (newDirty.get(id) === 'new') {
        newDirty.delete(id);
      } else {
        newDirty.set(id, 'deleted');
      }
    }

    set({
      annotations: remainingAnnotations,
      dirtyAnnotations: newDirty,
      selection: {
        selectedAnnotationIds: [],
        hoveredAnnotationId: undefined,
        selectedPoints: undefined,
      },
    });
  },

  verifyAnnotation: (id) => {
    const { annotations, dirtyAnnotations } = get();
    const annotation = annotations.get(id);

    if (annotation && annotation.source !== 'manual') {
      const newAnnotations = new Map(annotations);
      newAnnotations.set(id, {
        ...annotation,
        is_verified: true,
        verified_at: new Date().toISOString(),
      });

      const newDirty = new Map(dirtyAnnotations);
      if (!newDirty.has(id) || newDirty.get(id) !== 'new') {
        newDirty.set(id, 'modified');
      }

      set({ annotations: newAnnotations, dirtyAnnotations: newDirty });
    }
  },

  undo: () => {
    const { history, historyIndex } = get();
    console.log('[EditorStore] Undo called, historyIndex:', historyIndex, 'history.length:', history.length);
    if (historyIndex <= 0) {
      console.log('[EditorStore] Cannot undo, at beginning of history');
      return;
    }

    const prevEntry = history[historyIndex - 1];
    console.log('[EditorStore] Undoing to:', prevEntry.description);
    set({
      annotations: new Map(prevEntry.annotations),
      dirtyAnnotations: new Map(prevEntry.dirtyAnnotations),
      selection: {
        selectedAnnotationIds: [...prevEntry.selectedIds],
        hoveredAnnotationId: undefined,
        selectedPoints: undefined,
      },
      historyIndex: historyIndex - 1,
    });
  },

  redo: () => {
    const { history, historyIndex } = get();
    console.log('[EditorStore] Redo called, historyIndex:', historyIndex, 'history.length:', history.length);
    if (historyIndex >= history.length - 1) {
      console.log('[EditorStore] Cannot redo, at end of history');
      return;
    }

    const nextEntry = history[historyIndex + 1];
    console.log('[EditorStore] Redoing to:', nextEntry.description);
    set({
      annotations: new Map(nextEntry.annotations),
      dirtyAnnotations: new Map(nextEntry.dirtyAnnotations),
      selection: {
        selectedAnnotationIds: [...nextEntry.selectedIds],
        hoveredAnnotationId: undefined,
        selectedPoints: undefined,
      },
      historyIndex: historyIndex + 1,
    });
  },

  pushHistory: (description) => {
    const { annotations, dirtyAnnotations, selection, history, historyIndex, maxHistorySize } = get();

    const newHistory = history.slice(0, historyIndex + 1);

    newHistory.push({
      annotations: new Map(annotations),
      dirtyAnnotations: new Map(dirtyAnnotations),
      selectedIds: [...selection.selectedAnnotationIds],
      description,
    });

    if (newHistory.length > maxHistorySize) {
      newHistory.shift();
    }

    console.log('[EditorStore] pushHistory:', description, 'new length:', newHistory.length);
    set({
      history: newHistory,
      historyIndex: newHistory.length - 1,
    });
  },

  canUndo: () => {
    const { historyIndex } = get();
    return historyIndex > 0;
  },

  canRedo: () => {
    const { history, historyIndex } = get();
    return historyIndex < history.length - 1;
  },

  hasUnsavedChanges: () => {
    const { dirtyAnnotations } = get();
    return dirtyAnnotations.size > 0;
  },

  saveAnnotations: async () => {
    const { annotations, dirtyAnnotations, persistedAnnotationIds, scene } = get();

    const currentTaxonomyId = scene?.selected_taxonomy_id;

    if (dirtyAnnotations.size === 0) {
      return { success: true };
    }

    set({ isSaving: true });

    try {
      const toCreate: Annotation[] = [];
      const toUpdate: Annotation[] = [];
      const toDelete: string[] = [];

      for (const [id, state] of dirtyAnnotations) {
        if (state === 'new') {
          const ann = annotations.get(id);
          if (ann) {
            if (!ann.id) {
              throw new Error(`Cannot create annotation: missing id for annotation at key ${id}`);
            }
            // Guard against stale dirty-state: if already known on server, treat as update.
            if (persistedAnnotationIds.has(id)) {
              toUpdate.push(ann);
            } else {
              toCreate.push(ann);
            }
          }
        } else if (state === 'modified') {
          const ann = annotations.get(id);
          if (ann) {
            if (!ann.id) {
              throw new Error(`Cannot update annotation: missing id for annotation at key ${id}`);
            }
            // Modified annotations should be updated, not created.
            toUpdate.push(ann);
          }
        } else if (state === 'deleted') {
          if (!id) {
            throw new Error('Cannot delete annotation: missing id');
          }
          // Only try to delete if it exists on server
          if (persistedAnnotationIds.has(id)) {
            toDelete.push(id);
          }
        }
      }

      // Helper to check if annotation is 3D (cuboid)
      const is3DAnnotation = (ann: Annotation) => ann.type === 'cuboid';

      // Separate 2D and 3D annotations
      const toCreate2D = toCreate.filter(ann => !is3DAnnotation(ann));
      const toCreate3D = toCreate.filter(ann => is3DAnnotation(ann));
      const toUpdate2D = toUpdate.filter(ann => !is3DAnnotation(ann));
      const toUpdate3D = toUpdate.filter(ann => is3DAnnotation(ann));

      // Execute all operations
      const promises: Promise<any>[] = [];
      const fallbackCreates2D: Annotation[] = [];
      const fallbackCreates3D: Annotation[] = [];

      // Create new 2D annotations
      if (toCreate2D.length > 0) {
        promises.push(annotationApi.createBulk(toCreate2D));
      }

      // Create new 3D annotations
      if (toCreate3D.length > 0) {
        // Cast to the expected 3D format - we know these are cuboid annotations
        // is_keyframe is now a proper field in the schema
        const payload3D = toCreate3D.map(ann => ({
          id: ann.id,
          task_id: ann.task_id,
          frame_id: ann.frame_id,
          track_id: ann.track_id,
          type: ann.type,
          class_id: ann.class_id,
          taxonomy_id: ann.taxonomy_id || currentTaxonomyId,  // Include taxonomy_id
          data: ann.data as unknown as Annotation3DCreate['data'],
          attributes: ann.attributes,
          source: ann.source,
          is_keyframe: ann.is_keyframe ?? false,
          is_static: ann.is_static ?? false,
        })) as Annotation3DCreate[];
        promises.push(annotation3DApi.createBulk(payload3D));
      }

      // Update modified 2D annotations in bulk
      if (toUpdate2D.length > 0) {
        promises.push(
          annotationApi.updateBulk(toUpdate2D).catch((error: any) => {
            console.error(`Failed to bulk update 2D annotations:`, error);
            // On error, mark all for fallback create
            fallbackCreates2D.push(...toUpdate2D);
          })
        );
      }

      // Update modified 3D annotations in bulk
      if (toUpdate3D.length > 0) {
        // is_keyframe is now a proper field in the schema
        const payload3D = toUpdate3D.map(ann => ({
          id: ann.id,
          track_id: ann.track_id,
          class_id: ann.class_id,
          data: ann.data as unknown as Annotation3DCreate['data'],
          attributes: ann.attributes,
          is_keyframe: ann.is_keyframe ?? false,
          is_static: ann.is_static ?? false,
        }));
        promises.push(
          annotation3DApi.updateBulk(payload3D).then((updated3D: any[]) => {
            // Backend bulk-update skips missing IDs instead of erroring.
            // Recreate only those missing IDs to preserve Track propagation behavior.
            const updatedIdSet = new Set((updated3D || []).map((item: any) => item.id));
            for (const ann of toUpdate3D) {
              if (!updatedIdSet.has(ann.id)) {
                fallbackCreates3D.push(ann);
              }
            }
          }).catch((error: any) => {
            console.error(`Failed to bulk update 3D annotations:`, error);
            throw error;
          })
        );
      }

      // Delete removed annotations in bulk
      // Separate by type: try 3D first, then 2D for remaining
      if (toDelete.length > 0) {
        // Try deleting all as 3D first
        promises.push(
          annotation3DApi.deleteBulk([...toDelete]).catch(() => {
            // If 3D bulk delete fails, try 2D bulk delete
            return annotationApi.deleteBulk([...toDelete]).catch((error2D: any) => {
              console.error(`Failed to bulk delete annotations:`, error2D);
            });
          })
        );
      }

      await Promise.all(promises);

      // Handle fallback creates (updates that failed with 404)
      if (fallbackCreates2D.length > 0) {
        await annotationApi.createBulk(fallbackCreates2D);
        toCreate.push(...fallbackCreates2D);
      }

      if (fallbackCreates3D.length > 0) {
        const payload3D = fallbackCreates3D.map(ann => ({
          id: ann.id,
          task_id: ann.task_id,
          frame_id: ann.frame_id,
          track_id: ann.track_id,
          type: ann.type,
          class_id: ann.class_id,
          taxonomy_id: ann.taxonomy_id || currentTaxonomyId,
          data: ann.data as unknown as Annotation3DCreate['data'],
          attributes: ann.attributes,
          source: ann.source,
          is_keyframe: ann.is_keyframe ?? false,
          is_static: ann.is_static ?? false,
        })) as Annotation3DCreate[];

        await annotation3DApi.createBulk(payload3D);
        toCreate.push(...fallbackCreates3D);
      }

      // Update persisted IDs - created annotations are now on server, deleted ones are removed
      const newPersistedIds = new Set(persistedAnnotationIds);
      toCreate.forEach(ann => newPersistedIds.add(ann.id));
      toDelete.forEach(id => newPersistedIds.delete(id));

      // Clear dirty state on success
      set({ dirtyAnnotations: new Map(), persistedAnnotationIds: newPersistedIds, isSaving: false });

      return { success: true };
    } catch (error) {
      console.error('[EditorStore] Save failed:', error);
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      set({ isSaving: false });
      return {
        success: false,
        error: errorMsg
      };
    }
  },

  setLidarView: (view) => {
    const { lidarView } = get();
    set({ lidarView: { ...lidarView, ...view } });
  },

  setSelectedCamera: (cameraId) => set({ selectedCameraId: cameraId }),

  setCursorPosition: (pos) => set({ cursorPosition: pos }),

  setSuppressPropertiesPanel: (suppress) => set({ suppressPropertiesPanel: suppress }),

  // Camera view mode - view 3D scene from camera perspective with image overlay
  activateCameraView: (cameraId) => {
    const { lidarView } = get();
    set({
      selectedCameraId: cameraId,
      lidarView: {
        ...lidarView,
        cameraView: {
          isActive: true,
          cameraId,
          showImagePlane: true,
          frustumOnlyMode: false,
          imageOnlyMode: false,
        },
      },
    });
  },

  deactivateCameraView: () => {
    const { lidarView } = get();
    set({
      lidarView: {
        ...lidarView,
        cameraView: {
          isActive: false,
          cameraId: null,
          showImagePlane: false,
          frustumOnlyMode: false,
          imageOnlyMode: false,
        },
      },
    });
  },

  toggleImagePlane: () => {
    const { lidarView } = get();
    set({
      lidarView: {
        ...lidarView,
        cameraView: {
          ...lidarView.cameraView,
          showImagePlane: !lidarView.cameraView.showImagePlane,
        },
      },
    });
  },

  // Activate frustum-only 3D view (no image overlay, just filtered point cloud)
  activateFrustumView: (cameraId) => {
    const { lidarView, selection } = get();
    set({
      selectedCameraId: cameraId,
      lidarView: {
        ...lidarView,
        cameraView: {
          isActive: true,
          cameraId,
          showImagePlane: false,
          frustumOnlyMode: true,
          imageOnlyMode: false,
        },
      },
    });

    // If there's a selected annotation, automatically focus on it in 3D frustum view
    if (selection.selectedAnnotationIds.length > 0) {
      const selectedId = selection.selectedAnnotationIds[0];
      console.log('[activateFrustumView] Activating frustum view with selected box, focusing on:', selectedId);
      // Use setTimeout to ensure the camera mode changes first
      setTimeout(() => {
        get().focusOnAnnotation(selectedId);
      }, 100);
    }
  },

  // Toggle between frustum-only mode and image overlay mode
  toggleFrustumOnlyMode: () => {
    const { lidarView, selection } = get();
    const wasInOverlayMode = !lidarView.cameraView.frustumOnlyMode;
    const willBeInFrustumMode = !lidarView.cameraView.frustumOnlyMode;

    set({
      lidarView: {
        ...lidarView,
        cameraView: {
          ...lidarView.cameraView,
          frustumOnlyMode: !lidarView.cameraView.frustumOnlyMode,
          showImagePlane: lidarView.cameraView.frustumOnlyMode, // Toggle opposite
        },
      },
    });

    // If switching from 2D overlay to 3D frustum view with a selected box,
    // automatically focus (zoom in) on the selected box
    if (wasInOverlayMode && willBeInFrustumMode && selection.selectedAnnotationIds.length > 0) {
      const selectedId = selection.selectedAnnotationIds[0];
      console.log('[toggleFrustumOnlyMode] Switching to 3D frustum with selected box, focusing on:', selectedId);
      // Use setTimeout to ensure the camera mode changes first
      setTimeout(() => {
        get().focusOnAnnotation(selectedId);
      }, 100);
    }
  },

  // Toggle top/bird's eye view
  toggleTopView: () => {
    const { lidarView } = get();
    set({
      lidarView: {
        ...lidarView,
        isTopView: !lidarView.isTopView,
      },
    });
  },

  // Toggle fisheye camera projection mode
  toggleFisheyeProjection: () => {
    const { lidarView } = get();
    set({
      lidarView: {
        ...lidarView,
        useFisheyeProjection: !lidarView.useFisheyeProjection,
      },
    });
  },

  // Reset camera to default perspective view
  resetCameraView: () => {
    const { lidarView } = get();
    set({
      lidarView: {
        ...lidarView,
        isTopView: false,
        focusedAnnotationId: undefined,
        cameraResetCounter: lidarView.cameraResetCounter + 1,  // Trigger camera update
        camera: {
          position: { x: 0, y: -50, z: 30 },
          target: { x: 0, y: 0, z: 0 },
          up: { x: 0, y: 0, z: 1 },
        },
      },
    });
  },

  // Focus camera on a specific annotation
  focusOnAnnotation: (annotationId: string | undefined) => {
    const { lidarView } = get();
    set({
      lidarView: {
        ...lidarView,
        focusedAnnotationId: annotationId,
        focusedPosition: undefined,  // Clear position focus when focusing on annotation
      },
    });
  },

  // Focus camera on a specific 3D position (for segment-to-3D cluster)
  focusOnPosition: (position: { x: number; y: number; z: number } | undefined) => {
    const { lidarView } = get();
    set({
      lidarView: {
        ...lidarView,
        focusedPosition: position,
        focusedAnnotationId: undefined,  // Clear annotation focus when focusing on position
      },
    });
  },

  setAnnotationColorMode: (mode) => set({ annotationColorMode: mode }),
  setActiveAttributeForColor: (attributeId) => set({ activeAttributeForColor: attributeId }),

  setLockedAnnotationIds: (ids) => set({ lockedAnnotationIds: ids }),

  toggleAnnotationVisibility: (id) => {
    const { hiddenAnnotationIds } = get();
    const newHidden = new Set(hiddenAnnotationIds);
    if (newHidden.has(id)) {
      newHidden.delete(id);
    } else {
      newHidden.add(id);
    }
    set({ hiddenAnnotationIds: newHidden });
  },

  setHiddenAnnotationIds: (ids) => set({ hiddenAnnotationIds: ids }),
}));

// =============================================================================
// SELECTORS
// =============================================================================

export const useCurrentFrameAnnotations = () => {
  const currentFrame = useEditorStore((s) => s.currentFrame);
  const annotations = useEditorStore((s) => s.annotations);

  if (!currentFrame) return [];

  return Array.from(annotations.values()).filter(
    (ann) => ann.frame_id === currentFrame.id
  );
};

export const useSelectedAnnotations = () => {
  const selectedIds = useEditorStore((s) => s.selection.selectedAnnotationIds);
  const annotations = useEditorStore((s) => s.annotations);

  // Use useMemo to prevent creating new array references on every render
  return React.useMemo(() => {
    return selectedIds
      .map((id) => annotations.get(id))
      .filter(Boolean) as Annotation[];
  }, [selectedIds, annotations]);
};

export const useClassById = (classId: string): ClassDefinition | undefined => {
  const taxonomy = useEditorStore((s) => s.taxonomy);
  return taxonomy?.classes.find((c) => c.id === classId);
};

export const useAnnotationsByTrack = (trackId: string): Annotation[] => {
  const annotations = useEditorStore((s) => s.annotations);
  return Array.from(annotations.values()).filter((ann) => ann.track_id === trackId);
};

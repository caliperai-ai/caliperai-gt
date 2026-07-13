import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import { annotation4DApi, Annotation4DCreate, CuboidWorldData, FrameCuboidData } from '@/api/client';
import { computeLidarCoordsForFrames, EgoToLidarCalibration, EgoPose } from '@/utils/worldTransforms';


export interface LocalAnnotation4D {
  id: string;
  task_id: string;
  track_id: string;
  type: string;
  class_id: string;
  world_data: CuboidWorldData;
  frame_data: Record<string, FrameCuboidData>;
  frame_ids: string[];
  is_static: boolean;
  attributes: Record<string, unknown>;
  source: string;
  is_dirty: boolean;
  is_new: boolean;
  is_deleted: boolean;
}

interface Annotation4DStore {
  annotations4D: Map<string, LocalAnnotation4D>;
  isSaving: boolean;
  isLoading: boolean;
  lastError: string | null;

  loadAnnotations4D: (taskId: string) => Promise<void>;
  createAnnotation4D: (params: {
    task_id: string;
    track_id: string;
    class_id: string;
    world_data: CuboidWorldData;
    frame_data: Record<string, FrameCuboidData>;
    frame_ids: string[];
    attributes?: Record<string, unknown>;
  }) => LocalAnnotation4D;
  updateAnnotation4D: (id: string, updates: Partial<LocalAnnotation4D>) => void;
  deleteAnnotation4D: (id: string) => void;

  saveAnnotations4D: () => Promise<{ success: boolean; error?: string }>;
  migrateToAnnotations: (taskId: string) => Promise<{ success: boolean; created: number; error?: string }>;

  updateFrameDataWithLidarCoords: (
    frames: Array<{ id: string; ego_pose?: EgoPose }>,
    egoToLidar?: EgoToLidarCalibration
  ) => void;

  clearAnnotations4D: () => void;

  getAnnotation4DByTrack: (trackId: string) => LocalAnnotation4D | undefined;
  getAnnotations4DForFrame: (frameId: string) => LocalAnnotation4D[];
  hasDirtyAnnotations4D: () => boolean;
}


export const useAnnotation4DStore = create<Annotation4DStore>((set, get) => ({
  annotations4D: new Map(),
  isSaving: false,
  isLoading: false,
  lastError: null,

  loadAnnotations4D: async (taskId: string) => {
    set({ isLoading: true, lastError: null });

    try {
      const serverAnnotations = await annotation4DApi.list(taskId, false);

      const annotationsMap = new Map<string, LocalAnnotation4D>();
      serverAnnotations.forEach(ann => {
        annotationsMap.set(ann.id, {
          id: ann.id,
          task_id: ann.task_id,
          track_id: ann.track_id,
          type: ann.type,
          class_id: ann.class_id,
          world_data: ann.world_data,
          frame_data: ann.frame_data,
          frame_ids: ann.frame_ids,
          is_static: ann.is_static,
          attributes: ann.attributes,
          source: ann.source,
          is_dirty: false,
          is_new: false,
          is_deleted: false,
        });
      });

      set({ annotations4D: annotationsMap, isLoading: false });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to load 4D annotations';
      set({ isLoading: false, lastError: errorMsg });
      console.error('[Annotation4DStore] Load failed:', error);
    }
  },

  createAnnotation4D: (params) => {
    const id = uuidv4();

    const newAnnotation: LocalAnnotation4D = {
      id,
      task_id: params.task_id,
      track_id: params.track_id,
      type: 'cuboid',
      class_id: params.class_id,
      world_data: params.world_data,
      frame_data: params.frame_data,
      frame_ids: params.frame_ids,
      is_static: true,
      attributes: params.attributes ?? {},
      source: 'manual_4d',
      is_dirty: true,
      is_new: true,
      is_deleted: false,
    };

    const newMap = new Map(get().annotations4D);
    newMap.set(id, newAnnotation);
    set({ annotations4D: newMap });

    return newAnnotation;
  },

  updateAnnotation4D: (id, updates) => {
    const { annotations4D } = get();
    const existing = annotations4D.get(id);
    if (!existing) {
      console.warn(`[Annotation4DStore] Cannot update: annotation ${id} not found`);
      return;
    }

    const updated: LocalAnnotation4D = {
      ...existing,
      ...updates,
      is_dirty: true,
    };

    const newMap = new Map(annotations4D);
    newMap.set(id, updated);
    set({ annotations4D: newMap });
  },

  // Delete a 4D annotation - immediately persists to server
  deleteAnnotation4D: (id) => {
    const { annotations4D } = get();
    const existing = annotations4D.get(id);
    if (!existing) {
      console.warn('[annotation4DStore] Cannot delete - annotation not found:', id.slice(0, 8));
      return;
    }

    console.log('[annotation4DStore] Delete requested for:', id.slice(0, 8), 'is_new:', existing.is_new);

    // Check if annotation is locked (approved in QA)
    const lockedIds = useEditorStore.getState().lockedAnnotationIds;
    if (lockedIds.has(id)) {
      console.warn('[annotation4DStore] Cannot delete locked annotation:', id.slice(0, 8));
      return;
    }

    // Remove from local state immediately
    const newMap = new Map(annotations4D);
    newMap.delete(id);
    set({ annotations4D: newMap });
    console.log('[annotation4DStore] Removed from local state:', id.slice(0, 8));

    // If it was already saved on server, delete immediately (don't wait for batch save)
    if (!existing.is_new) {
      console.log('[annotation4DStore] Annotation was saved on server, calling deleteBulk...');
      annotation4DApi.deleteBulk([id])
        .then(() => {
          console.log('[annotation4DStore] ✓ Successfully deleted annotation from server:', id.slice(0, 8));
        })
        .catch(error => {
          console.error('[annotation4DStore] ✗ Failed to delete annotation from server:', id.slice(0, 8), error);
          // Re-add to local state if server delete failed
          const currentMap = new Map(get().annotations4D);
          currentMap.set(id, { ...existing, is_deleted: true, is_dirty: true });
          set({ annotations4D: currentMap });
          set({ lastError: `Failed to delete annotation: ${error.message}` });
        });
    } else {
      console.log('[annotation4DStore] Annotation was new (not saved), skipping server delete');
    }
  },

  // Save all dirty 4D annotations to server
  saveAnnotations4D: async () => {
    const { annotations4D } = get();

    const toCreate: LocalAnnotation4D[] = [];
    const toUpdate: LocalAnnotation4D[] = [];
    const toDelete: string[] = [];

    annotations4D.forEach(ann => {
      if (ann.is_deleted && !ann.is_new) {
        toDelete.push(ann.id);
      } else if (ann.is_new && !ann.is_deleted) {
        toCreate.push(ann);
      } else if (ann.is_dirty && !ann.is_new && !ann.is_deleted) {
        toUpdate.push(ann);
      }
    });

    if (toCreate.length === 0 && toUpdate.length === 0 && toDelete.length === 0) {
      return { success: true };
    }

    set({ isSaving: true, lastError: null });

    try {
      // Map from local temp UUID → server-assigned UUID (populated after create)
      const localToServerIdMap = new Map<string, string>();

      // Create new annotations
      if (toCreate.length > 0) {
        const createPayloads: Annotation4DCreate[] = toCreate.map(ann => ({
          id: ann.id,  // Send client UUID; backend will use it if supported, else assigns its own
          task_id: ann.task_id,
          track_id: ann.track_id,
          type: ann.type,
          class_id: ann.class_id,
          world_data: ann.world_data,
          frame_data: ann.frame_data,
          frame_ids: ann.frame_ids,
          is_static: ann.is_static,
          attributes: ann.attributes,
          source: ann.source,
        }));
        const serverCreated = await annotation4DApi.createBulk(createPayloads);
        // Map local temp IDs → server-assigned IDs (positional: toCreate[i] ↔ serverCreated[i])
        serverCreated.forEach((serverAnn, idx) => {
          const localAnn = toCreate[idx];
          if (localAnn && serverAnn.id !== localAnn.id) {
            localToServerIdMap.set(localAnn.id, serverAnn.id);
            console.log(`[annotation4DStore] ID remapped: ${localAnn.id.slice(0, 8)} → ${serverAnn.id.slice(0, 8)}`);
          }
        });
      }

      // Update modified annotations in bulk
      if (toUpdate.length > 0) {
        const updatePayload = toUpdate.map(ann => ({
          id: ann.id,
          world_data: ann.world_data,
          frame_data: ann.frame_data,
          frame_ids: ann.frame_ids,
          attributes: ann.attributes,
          class_id: ann.class_id,
        }));
        await annotation4DApi.updateBulk(updatePayload);
      }

      // Delete removed annotations in bulk
      if (toDelete.length > 0) {
        await annotation4DApi.deleteBulk(toDelete);
      }

      // Update local state - replace local temp IDs with server-assigned IDs if remapped
      const newMap = new Map<string, LocalAnnotation4D>();
      annotations4D.forEach(ann => {
        if (ann.is_deleted) return; // Remove deleted
        const serverId = localToServerIdMap.get(ann.id);
        const finalId = serverId ?? ann.id;
        newMap.set(finalId, { ...ann, id: finalId, is_dirty: false, is_new: false });
      });
      set({ annotations4D: newMap, isSaving: false });

      return { success: true };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Save failed';
      set({ isSaving: false, lastError: errorMsg });
      console.error('[Annotation4DStore] Save failed:', error);
      return { success: false, error: errorMsg };
    }
  },

  // Migrate 4D annotations to regular 3D annotations
  migrateToAnnotations: async (taskId: string) => {
    const { annotations4D, saveAnnotations4D } = get();

    // First save any pending changes
    const saveResult = await saveAnnotations4D();
    if (!saveResult.success) {
      return { success: false, created: 0, error: saveResult.error };
    }

    // Get IDs of annotations to migrate
    const idsToMigrate = Array.from(annotations4D.values())
      .filter(ann => !ann.is_deleted)
      .map(ann => ann.id);

    if (idsToMigrate.length === 0) {
      return { success: true, created: 0 };
    }

    set({ isSaving: true, lastError: null });

    try {
      const result = await annotation4DApi.migrate(taskId, idsToMigrate);

      if (result.errors.length > 0) {
        console.warn('[Annotation4DStore] Migration had errors:', result.errors);
      }

      // Clear the 4D annotation store after successful migration
      // The annotations are now visible as regular 3D annotations (via Annotation3D table)
      set({ annotations4D: new Map(), isSaving: false });

      return {
        success: true,
        created: result.created_annotation_ids.length,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Migration failed';
      set({ isSaving: false, lastError: errorMsg });
      console.error('[Annotation4DStore] Migration failed:', error);
      return { success: false, created: 0, error: errorMsg };
    }
  },

  // Update frame_data with computed LiDAR coordinates before migration
  // This transforms world_data coordinates to per-frame LiDAR coordinates
  updateFrameDataWithLidarCoords: (
    frames: Array<{ id: string; ego_pose?: EgoPose }>,
    egoToLidar?: EgoToLidarCalibration
  ) => {
    const { annotations4D } = get();
    const newMap = new Map<string, LocalAnnotation4D>();

    // Build a frame lookup map for fast access
    const frameMap = new Map(frames.map(f => [f.id, f]));

    annotations4D.forEach((ann, id) => {
      if (ann.is_deleted) {
        newMap.set(id, ann);
        return;
      }

      // Get world coordinates
      const worldCenter = ann.world_data.center;
      const worldYaw = ann.world_data.rotation?.yaw ?? 0;

      // Get frames that this annotation covers
      const relevantFrames = ann.frame_ids
        .map(fid => frameMap.get(fid))
        .filter((f): f is { id: string; ego_pose?: EgoPose } => f !== undefined);

      if (relevantFrames.length === 0) {
        console.warn(`[Annotation4DStore] No frames found for annotation ${id}`);
        newMap.set(id, ann);
        return;
      }

      // Compute LiDAR coordinates for each frame
      const lidarCoords = computeLidarCoordsForFrames(
        worldCenter,
        worldYaw,
        relevantFrames,
        egoToLidar
      );

      // Update frame_data with computed LiDAR coordinates
      const newFrameData: Record<string, FrameCuboidData> = {};
      for (const frameId of ann.frame_ids) {
        const lidarData = lidarCoords[frameId];
        const existingFrameData = ann.frame_data[frameId];

        if (lidarData) {
          newFrameData[frameId] = {
            center: lidarData.center,
            rotation: lidarData.rotation,
            is_keyframe: existingFrameData?.is_keyframe ?? false,
          };
        } else if (existingFrameData) {
          // Keep existing if no computed data
          newFrameData[frameId] = existingFrameData;
        }
      }

      // Mark as dirty so it gets saved before migration
      newMap.set(id, {
        ...ann,
        frame_data: newFrameData,
        is_dirty: true,
      });
    });

    set({ annotations4D: newMap });
    // LiDAR coordinates computed for all annotations (logging removed for performance)
  },

  // Clear all 4D annotations
  clearAnnotations4D: () => {
    set({ annotations4D: new Map(), lastError: null });
  },

  // Get annotation by track ID
  getAnnotation4DByTrack: (trackId: string) => {
    const { annotations4D } = get();
    for (const ann of annotations4D.values()) {
      if (ann.track_id === trackId && !ann.is_deleted) {
        return ann;
      }
    }
    return undefined;
  },

  // Get annotations that include a specific frame
  getAnnotations4DForFrame: (frameId: string) => {
    const { annotations4D } = get();
    const result: LocalAnnotation4D[] = [];
    annotations4D.forEach(ann => {
      if (!ann.is_deleted && ann.frame_ids.includes(frameId)) {
        result.push(ann);
      }
    });
    return result;
  },

  // Check if there are unsaved changes
  hasDirtyAnnotations4D: () => {
    const { annotations4D } = get();
    for (const ann of annotations4D.values()) {
      if (ann.is_dirty) return true;
    }
    return false;
  },
}));

// =============================================================================
// HELPER HOOK: Get selected 4D annotation as regular Annotation format
// =============================================================================

import { useEditorStore } from '@/store/editorStore';
import type { Annotation, CuboidData } from '@/types';

/**
 * Hook to get selected 4D annotation in a format compatible with regular annotations.
 * Used by components like OrthographicViews and PropertiesPanel.
 */
export const useSelected4DAnnotation = (): Annotation | null => {
  const selectedIds = useEditorStore((s) => s.selection.selectedAnnotationIds);
  const annotations4D = useAnnotation4DStore((s) => s.annotations4D);

  if (selectedIds.length === 0) return null;
  const selectedId = selectedIds[0];

  const ann4D = annotations4D.get(selectedId);
  if (!ann4D || ann4D.is_deleted) return null;

  // Convert 4D annotation to regular Annotation format
  const worldData = ann4D.world_data;
  return {
    id: ann4D.id,
    task_id: ann4D.task_id,
    frame_id: ann4D.frame_ids[0] || '',
    track_id: ann4D.track_id,
    type: ann4D.type as Annotation['type'],
    class_id: ann4D.class_id,
    data: {
      center: worldData.center,
      dimensions: worldData.dimensions,
      rotation: worldData.rotation,
      confidence: 1,
    } as CuboidData,
    attributes: ann4D.attributes,
    source: ann4D.source as Annotation['source'],
    is_verified: false,
    is_keyframe: true,
    created_at: '',
    updated_at: '',
  };
};

/**
 * Hook that returns the selected annotation from either store (regular or 4D).
 * Prefers 4D annotation if found, otherwise falls back to regular annotation.
 */
export const useSelectedAnnotationAny = (): Annotation | null => {
  const selectedIds = useEditorStore((s) => s.selection.selectedAnnotationIds);
  const regularAnnotations = useEditorStore((s) => s.annotations);
  const annotations4D = useAnnotation4DStore((s) => s.annotations4D);

  if (selectedIds.length === 0) return null;
  const selectedId = selectedIds[0];

  // Check 4D store first
  const ann4D = annotations4D.get(selectedId);
  if (ann4D && !ann4D.is_deleted) {
    const worldData = ann4D.world_data;
    return {
      id: ann4D.id,
      task_id: ann4D.task_id,
      frame_id: ann4D.frame_ids[0] || '',
      track_id: ann4D.track_id,
      type: ann4D.type as Annotation['type'],
      class_id: ann4D.class_id,
      data: {
        center: worldData.center,
        dimensions: worldData.dimensions,
        rotation: worldData.rotation,
        confidence: 1,
      } as CuboidData,
      attributes: ann4D.attributes,
      source: ann4D.source as Annotation['source'],
      is_verified: false,
      is_keyframe: true,
      created_at: '',
      updated_at: '',
    };
  }

  // Fall back to regular annotations
  const regularAnn = regularAnnotations.get(selectedId);
  return regularAnn ?? null;
};

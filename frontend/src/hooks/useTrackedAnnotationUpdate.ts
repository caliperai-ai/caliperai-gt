
import { useCallback, useState } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useAnnotation4DStore } from '@/store/annotation4DStore';
import { useTrackStore } from '@/store/trackStore';
import type { Annotation, CuboidData } from '@/types';

export type TrackChangeScope = 'current_frame' | 'entire_track' | 'cancel';

export interface PendingTrackChange {
  annotationId: string;
  trackId: string;
  updates: Partial<Annotation>;
  is4D: boolean;
  changeDescription: string;
}

export interface UseTrackedAnnotationUpdateReturn {
  updateAnnotationWithConfirmation: (
    annotation: Annotation,
    updates: Partial<Annotation>,
    is4D?: boolean
  ) => void;

  pendingChange: PendingTrackChange | null;

  confirmChange: (scope: TrackChangeScope) => void;
  cancelChange: () => void;
}

function describeChanges(updates: Partial<Annotation>): string {
  const changes: string[] = [];

  if (updates.class_id) changes.push('Class');
  if (updates.attributes && Object.keys(updates.attributes).length > 0) {
    const attrNames = Object.keys(updates.attributes);
    changes.push(attrNames.length <= 3 ? `Attributes (${attrNames.join(', ')})` : `Attributes (${attrNames.length} properties)`);
  }
  if (updates.data) {
    const data = updates.data as CuboidData;
    if (data.dimensions) changes.push('Dimensions');
  }
  return changes.length > 0 ? changes.join(', ') : 'properties';
}

export function useTrackedAnnotationUpdate(): UseTrackedAnnotationUpdateReturn {
  const [pendingChange, setPendingChange] = useState<PendingTrackChange | null>(null);

  const updateAnnotationWithConfirmation = useCallback((
    annotation: Annotation,
    updates: Partial<Annotation>,
    is4D: boolean = false
  ) => {
    // is_static is a track-level property — apply immediately without confirmation
    if (typeof updates.is_static === 'boolean' && annotation.track_id) {
      useTrackStore.getState().updateTrackIsStatic(annotation.track_id, updates.is_static);
      // Strip is_static so the rest of the update can proceed normally if needed
      const { is_static: _ignored, ...rest } = updates;
      updates = rest;
      if (Object.keys(updates).length === 0) return;
    }

    // Check if this is a tracked annotation with significant changes
    if (annotation.track_id) {
      const isSignificantChange =
        updates.class_id !== undefined ||
        (updates.attributes && Object.keys(updates.attributes).length > 0) ||
        (updates.data && (updates.data as CuboidData).dimensions);

      if (isSignificantChange) {
        // Show confirmation modal
        setPendingChange({
          annotationId: annotation.id,
          trackId: annotation.track_id,
          updates,
          is4D,
          changeDescription: describeChanges(updates),
        });
        return; // Don't apply yet
      }
    }

    // Apply directly for non-tracked or non-significant changes
    applyUpdate(annotation.id, updates, is4D);
  }, []);

  const applyUpdate = useCallback((id: string, updates: Partial<Annotation>, is4D: boolean) => {
    if (is4D) {
      const { updateAnnotation4D, annotations4D } = useAnnotation4DStore.getState();
      const ann4D = annotations4D.get(id);
      if (ann4D) {
        const data = updates.data as CuboidData | undefined;
        if (data) {
          const newWorldData = {
            center: data.center ?? ann4D.world_data.center,
            dimensions: data.dimensions ?? ann4D.world_data.dimensions,
            rotation: data.rotation ?? ann4D.world_data.rotation,
          };
          updateAnnotation4D(id, { world_data: newWorldData });
        }
        if (updates.attributes) updateAnnotation4D(id, { attributes: updates.attributes as Record<string, unknown> });
        if (updates.class_id) updateAnnotation4D(id, { class_id: updates.class_id });
        if (typeof updates.is_static === 'boolean') updateAnnotation4D(id, { is_static: updates.is_static });
      }
    } else {
      const { updateAnnotation } = useEditorStore.getState();
      updateAnnotation(id, updates);
    }
  }, []);

  const confirmChange = useCallback((scope: TrackChangeScope) => {
    if (!pendingChange || scope === 'cancel') {
      setPendingChange(null);
      return;
    }

    const { annotationId, trackId, updates, is4D } = pendingChange;

    if (scope === 'current_frame') {
      applyUpdate(annotationId, updates, is4D);
    } else if (scope === 'entire_track') {
      // Apply to all annotations in the track
      if (is4D) {
        const { annotations4D, updateAnnotation4D } = useAnnotation4DStore.getState();
        annotations4D.forEach((ann) => {
          if (ann.track_id === trackId && !ann.is_deleted) {
            const data = updates.data as CuboidData | undefined;
            if (data?.dimensions) {
              const newWorldData = { ...ann.world_data, dimensions: data.dimensions };
              updateAnnotation4D(ann.id, { world_data: newWorldData });
            }
            if (updates.attributes) updateAnnotation4D(ann.id, { attributes: updates.attributes as Record<string, unknown> });
            if (updates.class_id) updateAnnotation4D(ann.id, { class_id: updates.class_id });
          }
        });
      } else {
        const { annotations, updateAnnotation } = useEditorStore.getState();
        annotations.forEach((ann) => {
          if (ann.track_id === trackId) {
            const trackUpdates: Partial<Annotation> = {};
            const data = updates.data as CuboidData | undefined;
            if (data?.dimensions) {
              const existingData = ann.data as CuboidData;
              trackUpdates.data = { ...existingData, dimensions: data.dimensions };
            }
            if (updates.attributes) trackUpdates.attributes = { ...(ann.attributes || {}), ...updates.attributes };
            if (updates.class_id) trackUpdates.class_id = updates.class_id;
            if (Object.keys(trackUpdates).length > 0) updateAnnotation(ann.id, trackUpdates);
          }
        });
      }
      // is_static is a track-level flag — update track + all annotations together
      if (typeof updates.is_static === 'boolean') {
        useTrackStore.getState().updateTrackIsStatic(trackId, updates.is_static);
      }
    }

    setPendingChange(null);
  }, [pendingChange, applyUpdate]);

  const cancelChange = useCallback(() => {
    setPendingChange(null);
  }, []);

  return {
    updateAnnotationWithConfirmation,
    pendingChange,
    confirmChange,
    cancelChange,
  };
}

export default useTrackedAnnotationUpdate;

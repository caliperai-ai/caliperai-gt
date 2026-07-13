
import { useCallback, useState } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useAnnotation4DStore } from '@/store/annotation4DStore';
import { useTrackStore } from '@/store/trackStore';
import type { Annotation, CuboidData } from '@/types';

export type TrackChangeScope = 'current_frame' | 'entire_track' | 'cancel';

export interface TrackChangeConfirmation {
  isOpen: boolean;
  annotationId: string | null;
  trackId: string | null;
  changeDescription: string;
  pendingUpdates: Partial<Annotation> | null;
  is4D: boolean;
}

export interface UseTrackChangeConfirmationReturn {
  confirmation: TrackChangeConfirmation;
  requestChange: (
    annotationId: string,
    trackId: string,
    updates: Partial<Annotation>,
    is4D: boolean
  ) => boolean;
  confirmChange: (scope: TrackChangeScope) => void;
  cancelChange: () => void;
}

function describeChanges(updates: Partial<Annotation>): string {
  const changes: string[] = [];

  if (updates.class_id) {
    changes.push('Class');
  }

  if (updates.attributes && Object.keys(updates.attributes).length > 0) {
    const attrNames = Object.keys(updates.attributes);
    if (attrNames.length <= 3) {
      changes.push(`Attributes (${attrNames.join(', ')})`);
    } else {
      changes.push(`Attributes (${attrNames.length} properties)`);
    }
  }

  if (updates.data) {
    const data = updates.data as CuboidData;
    const dimChanges: string[] = [];

    if (data.dimensions) {
      const dims = data.dimensions;
      if (dims.length !== undefined) dimChanges.push('Length');
      if (dims.width !== undefined) dimChanges.push('Width');
      if (dims.height !== undefined) dimChanges.push('Height');
    }

    if (data.center) {
      dimChanges.push('Position');
    }

    if (data.rotation !== undefined) {
      dimChanges.push('Rotation');
    }

    if (dimChanges.length > 0) {
      changes.push(`Dimensions (${dimChanges.join(', ')})`);
    }
  }

  if (typeof updates.is_static === 'boolean') {
    changes.push('Static/Dynamic status');
  }

  if (changes.length === 0) {
    return 'properties';
  }

  return changes.join(', ');
}

export function useTrackChangeConfirmation(): UseTrackChangeConfirmationReturn {
  const [confirmation, setConfirmation] = useState<TrackChangeConfirmation>({
    isOpen: false,
    annotationId: null,
    trackId: null,
    changeDescription: '',
    pendingUpdates: null,
    is4D: false,
  });

  const requestChange = useCallback((
    annotationId: string,
    trackId: string,
    updates: Partial<Annotation>,
    is4D: boolean
  ): boolean => {
    // If no track, no confirmation needed
    if (!trackId) {
      return false;
    }

    // Check if this is a "significant" change that warrants confirmation
    // Skip confirmation for minor updates like position tweaks during dragging
    const isSignificantChange =
      updates.class_id !== undefined ||
      (updates.attributes && Object.keys(updates.attributes).length > 0) ||
      (updates.data && (updates.data as CuboidData).dimensions);

    if (!isSignificantChange) {
      return false;
    }

    const changeDescription = describeChanges(updates);

    setConfirmation({
      isOpen: true,
      annotationId,
      trackId,
      changeDescription,
      pendingUpdates: updates,
      is4D,
    });

    return true; // Confirmation is required
  }, []);

  const confirmChange = useCallback((scope: TrackChangeScope) => {
    const { annotationId, trackId, pendingUpdates, is4D } = confirmation;

    if (!annotationId || !pendingUpdates || scope === 'cancel') {
      setConfirmation(prev => ({ ...prev, isOpen: false, pendingUpdates: null }));
      return;
    }

    if (scope === 'current_frame') {
      // Apply only to current annotation
      if (is4D) {
        const { updateAnnotation4D } = useAnnotation4DStore.getState();
        const data = pendingUpdates.data as CuboidData | undefined;

        if (data) {
          const ann4D = useAnnotation4DStore.getState().annotations4D.get(annotationId);
          if (ann4D) {
            const newWorldData = {
              center: data.center ?? ann4D.world_data.center,
              dimensions: data.dimensions ?? ann4D.world_data.dimensions,
              rotation: data.rotation ?? ann4D.world_data.rotation,
            };
            updateAnnotation4D(annotationId, { world_data: newWorldData });
          }
        }
        if (pendingUpdates.attributes) {
          updateAnnotation4D(annotationId, { attributes: pendingUpdates.attributes as Record<string, unknown> });
        }
        if (pendingUpdates.class_id) {
          updateAnnotation4D(annotationId, { class_id: pendingUpdates.class_id });
        }
        if (typeof pendingUpdates.is_static === 'boolean') {
          updateAnnotation4D(annotationId, { is_static: pendingUpdates.is_static });
        }
      } else {
        const { updateAnnotation } = useEditorStore.getState();
        updateAnnotation(annotationId, pendingUpdates);
      }
    } else if (scope === 'entire_track') {
      // Apply to all annotations in the track
      if (is4D) {
        const { annotations4D, updateAnnotation4D } = useAnnotation4DStore.getState();
        const data = pendingUpdates.data as CuboidData | undefined;

        annotations4D.forEach((ann) => {
          if (ann.track_id === trackId && !ann.is_deleted) {
            if (data?.dimensions) {
              // For dimensions, apply to all - keep position/rotation per-frame
              const newWorldData = {
                center: ann.world_data.center, // Keep original position
                dimensions: data.dimensions,
                rotation: ann.world_data.rotation, // Keep original rotation
              };
              updateAnnotation4D(ann.id, { world_data: newWorldData });
            }
            if (pendingUpdates.attributes) {
              updateAnnotation4D(ann.id, { attributes: pendingUpdates.attributes as Record<string, unknown> });
            }
            if (pendingUpdates.class_id) {
              updateAnnotation4D(ann.id, { class_id: pendingUpdates.class_id });
            }
          }
        });
        // is_static is a track-level flag — update track + all annotations together
        if (typeof pendingUpdates.is_static === 'boolean' && trackId) {
          useTrackStore.getState().updateTrackIsStatic(trackId, pendingUpdates.is_static);
        }
      } else {
        const { annotations, updateAnnotation } = useEditorStore.getState();
        const data = pendingUpdates.data as CuboidData | undefined;

        annotations.forEach((ann) => {
          if (ann.track_id === trackId) {
            const trackUpdates: Partial<Annotation> = {};

            if (data?.dimensions) {
              // Apply dimensions to all, keep position/rotation
              const existingData = ann.data as CuboidData;
              trackUpdates.data = {
                ...existingData,
                dimensions: data.dimensions,
              };
            }
            if (pendingUpdates.attributes) {
              trackUpdates.attributes = { ...(ann.attributes || {}), ...pendingUpdates.attributes };
            }
            if (pendingUpdates.class_id) {
              trackUpdates.class_id = pendingUpdates.class_id;
            }

            if (Object.keys(trackUpdates).length > 0) {
              updateAnnotation(ann.id, trackUpdates);
            }
          }
        });
        // is_static is a track-level flag — update track + all annotations together
        if (typeof pendingUpdates.is_static === 'boolean' && trackId) {
          useTrackStore.getState().updateTrackIsStatic(trackId, pendingUpdates.is_static);
        }
      }
    }

    setConfirmation({
      isOpen: false,
      annotationId: null,
      trackId: null,
      changeDescription: '',
      pendingUpdates: null,
      is4D: false,
    });
  }, [confirmation]);

  const cancelChange = useCallback(() => {
    setConfirmation({
      isOpen: false,
      annotationId: null,
      trackId: null,
      changeDescription: '',
      pendingUpdates: null,
      is4D: false,
    });
  }, []);

  return {
    confirmation,
    requestChange,
    confirmChange,
    cancelChange,
  };
}

export default useTrackChangeConfirmation;

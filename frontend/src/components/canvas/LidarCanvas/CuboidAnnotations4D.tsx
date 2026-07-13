import React, { useCallback, useMemo } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useAnnotation4DStore, LocalAnnotation4D } from '@/store/annotation4DStore';
import { useQAStore, useIsQAMode } from '@/store/qaStore';
import type { CuboidData, Frame, Annotation, AnnotationSource } from '@/types';
import { CuboidMesh } from './CuboidMesh';
import { setBoxDoubleClickedFlag } from './LidarCanvas4DNew';

interface CuboidAnnotations4DProps {
  stackedFrames: Frame[];
  originPosition?: number[];
}

export const CuboidAnnotations4D: React.FC<CuboidAnnotations4DProps> = ({
  stackedFrames,
  originPosition,
}) => {
  const selection = useEditorStore((s) => s.selection);
  const taxonomy = useEditorStore((s) => s.taxonomy);
  const annotationColorMode = useEditorStore((s) => s.annotationColorMode);
  const activeAttributeForColor = useEditorStore((s) => s.activeAttributeForColor);
  const selectAnnotation = useEditorStore((s) => s.selectAnnotation);
  const hoverAnnotation = useEditorStore((s) => s.hoverAnnotation);
  const focusOnAnnotation = useEditorStore((s) => s.focusOnAnnotation);
  const hiddenAnnotationIds = useEditorStore((s) => s.hiddenAnnotationIds);

  const annotationReviews = useQAStore(s => s.annotationReviews);
  const isQAMode = useIsQAMode();

  const annotations4D = useAnnotation4DStore((s) => s.annotations4D);
  const updateAnnotation4D = useAnnotation4DStore((s) => s.updateAnnotation4D);

  const origin = originPosition || [0, 0, 0];

  console.log('[CuboidAnnotations4D] RENDER - originPosition:', originPosition, 'origin:', origin, 'stackedFrames count:', stackedFrames.length);

  const stackedFrameIds = useMemo(() => {
    const ids = new Set(stackedFrames.map(f => f.id));
    console.log('[CuboidAnnotations4D] stackedFrameIds:', Array.from(ids).slice(0, 3), 'total:', ids.size);
    return ids;
  }, [stackedFrames]);

  const cuboids4D = useMemo(() => {
    const result: LocalAnnotation4D[] = [];

    console.log('[CuboidAnnotations4D] Total annotations4D:', annotations4D.size);

    annotations4D.forEach((ann) => {
      console.log('[CuboidAnnotations4D] Checking annotation:', ann.id.slice(0, 8),
        'is_deleted:', ann.is_deleted,
        'type:', ann.type,
        'frame_ids:', (ann.frame_ids || []).slice(0, 3),
        'frame_ids_count:', (ann.frame_ids || []).length);

      if (ann.is_deleted) return;
      if (ann.type !== 'cuboid') return;
      if (hiddenAnnotationIds.has(ann.id)) return;

      const annFrameIds = ann.frame_ids || [];
      const hasOverlap = annFrameIds.some(fid => stackedFrameIds.has(fid));

      console.log('[CuboidAnnotations4D] hasOverlap:', hasOverlap, 'stackedFrameIds.size:', stackedFrameIds.size);

      if (!hasOverlap && stackedFrameIds.size > 0) {
        console.log('[CuboidAnnotations4D] Skipping - no overlap with stacked frames');
        return;
      }

      console.log('[CuboidAnnotations4D] Including annotation:', ann.id.slice(0, 8));
      result.push(ann);
    });

    console.log('[CuboidAnnotations4D] Result count:', result.length);
    return result;
  }, [annotations4D, stackedFrameIds, hiddenAnnotationIds]);

  const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00ffffff).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
  };

  const getAnnotationColor = useCallback((annotation: { id: string; class_id: string; attributes?: Record<string, unknown> }) => {
    if (annotationColorMode === 'attribute' && activeAttributeForColor) {
        const val = annotation.attributes?.[activeAttributeForColor];
        if (val !== undefined && val !== null) {
             return stringToColor(String(val));
        }
    }
    if (annotationColorMode === 'qa_status') {
         const review = annotationReviews.get(annotation.id);
         console.log('[QA Color 4D] annotationId:', annotation.id, 'review:', review, 'reviewsSize:', annotationReviews.size);
         if (review?.verdict === 'approved') return '#00ff00';
         if (review?.verdict === 'rejected') return '#ff0000';
         if (review?.verdict === 'flagged') return '#ffff00';
         return '#888888';
    }
    const cls = taxonomy?.classes.find((c) => c.id === annotation.class_id);
    return cls?.color ?? '#888888';
  }, [taxonomy, annotationColorMode, activeAttributeForColor, annotationReviews]);

  const getClassName = useCallback((classId: string) => {
    const cls = taxonomy?.classes.find((c) => c.id === classId);
    return cls?.name ?? classId;
  }, [taxonomy]);

  const handleAnnotationUpdate = useCallback((annotationId: string, updates: Partial<CuboidData>) => {
    const currentAnnotations = useAnnotation4DStore.getState().annotations4D;
    const annotation = currentAnnotations.get(annotationId);
    if (!annotation) {
      return;
    }

    const currentWorldData = annotation.world_data;

    let newCenter = currentWorldData.center;
    if (updates.center) {
      newCenter = {
        x: updates.center.x + origin[0],
        y: updates.center.y + origin[1],
        z: updates.center.z + origin[2],
      };
    }

    const newWorldData = {
      ...currentWorldData,
      center: newCenter,
      dimensions: updates.dimensions ?? currentWorldData.dimensions,
      rotation: updates.rotation ?? currentWorldData.rotation,
    };

    updateAnnotation4D(annotationId, {
      world_data: newWorldData,
    });

  }, [updateAnnotation4D, origin]);

  return (
    <group key={`cuboids4d-${annotationColorMode}-${activeAttributeForColor || 'none'}`}>
      {cuboids4D.map((ann) => {
        const worldData = ann.world_data;

        console.log('[CuboidAnnotations4D] Rendering annotation:', ann.id.slice(0, 8),
          'worldData:', worldData,
          'origin:', origin);

        if (!worldData || !worldData.center) {
          console.error('[CuboidAnnotations4D] Missing worldData or center for:', ann.id.slice(0, 8));
          return null;
        }

        // Convert from true world coordinates to view coordinates
        // by subtracting the current origin offset
        // This keeps static objects fixed in the world even as the ego vehicle moves
        const position: [number, number, number] = [
          worldData.center.x - origin[0],
          worldData.center.y - origin[1],
          worldData.center.z - origin[2],
        ];
        const yaw = worldData.rotation?.yaw ?? 0;

        console.log('[CuboidAnnotations4D] Computed position:', position, 'yaw:', yaw);

        // Build a minimal annotation-like object for CuboidMesh
        const mockAnnotation: Annotation = {
          id: ann.id,
          task_id: ann.task_id,
          frame_id: ann.frame_ids[0] || '',
          track_id: ann.track_id,
          type: 'cuboid',
          class_id: ann.class_id,
          data: {
            center: worldData.center,
            dimensions: worldData.dimensions,
            rotation: worldData.rotation,
            confidence: 1,
          },
          attributes: ann.attributes,
          source: ann.source as AnnotationSource,
          is_verified: false,
          is_keyframe: true,
          created_at: '',
          updated_at: '',
        };

        // Calculate color for this annotation
        const computedColor = getAnnotationColor(ann);

        // In QA mode, lock all non-false-negative annotations from editing
        const isQAModeEditLocked = isQAMode && ann.source !== 'qa_correction';

        return (
          <CuboidMesh
            key={`${ann.id}-${computedColor}`}
            annotation={mockAnnotation}
            transformedPosition={position}
            transformedYaw={yaw}
            isSelected={selection.selectedAnnotationIds.includes(ann.id)}
            isHovered={selection.hoveredAnnotationId === ann.id}
            classColor={computedColor}
            className={getClassName(ann.class_id)}
            trackId={ann.track_id}
            isAutoAnnotation={false}
            isTracked={true}  // Always tracked in 4D
            isKeyframe={true}
            onClick={() => {
              selectAnnotation(ann.id);
            }}
            onDoubleClick={() => {
              console.log('[CuboidAnnotations4D] onDoubleClick triggered for annotation:', ann.id);
              // Set flag to prevent camera reset by DoubleClickResetHandler4D
              setBoxDoubleClickedFlag();
              // Center camera on this annotation (zoom to box)
              console.log('[CuboidAnnotations4D] Calling focusOnAnnotation with id:', ann.id);
              focusOnAnnotation(ann.id);
            }}
            onHover={(hover) => hoverAnnotation(hover ? ann.id : undefined)}
            onUpdate={isQAModeEditLocked ? undefined : (updates) => handleAnnotationUpdate(ann.id, updates)}
            egoTransform={undefined}
          />
        );
      })}
    </group>
  );
};

export default CuboidAnnotations4D;

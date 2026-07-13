import React, { useCallback, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useEditorStore, useCurrentFrameAnnotations } from '@/store/editorStore';
import { useSuggestionsByAnnotation, useIsQAMode, useQAStore } from '@/store/qaStore';
import { qaApi } from '@/api/client';
import type { CuboidData, Annotation, AnnotationReview } from '@/types';
import { CuboidMesh } from './CuboidMesh';
import { setBoxDoubleClickedFlag3D } from './doubleClickFlags';

export interface CuboidAnnotationsProps {
  egoTransform?: never;
  shiftPressed?: boolean;
}

export const CuboidAnnotations: React.FC<CuboidAnnotationsProps> = ({ shiftPressed = false }) => {
  const annotations = useCurrentFrameAnnotations();
  const selection = useEditorStore((s) => s.selection);
  const taxonomy = useEditorStore((s) => s.taxonomy);
  const task = useEditorStore((s) => s.task);
  const annotationColorMode = useEditorStore((s) => s.annotationColorMode);
  const activeAttributeForColor = useEditorStore((s) => s.activeAttributeForColor);
  const selectAnnotation = useEditorStore((s) => s.selectAnnotation);
  const hoverAnnotation = useEditorStore((s) => s.hoverAnnotation);
  const updateAnnotation = useEditorStore((s) => s.updateAnnotation);
  const focusOnAnnotation = useEditorStore((s) => s.focusOnAnnotation);
  const focusedAnnotationId = useEditorStore((s) => s.focusedAnnotationId);
  const resetCameraView = useEditorStore((s) => s.resetCameraView);
  const hiddenAnnotationIds = useEditorStore((s) => s.hiddenAnnotationIds);

  const annotationReviews = useQAStore(s => s.annotationReviews);

  const isQAMode = useIsQAMode();
  const suggestionsByAnnotation = useSuggestionsByAnnotation();
  const showSuggestions = isQAMode && task?.stage !== 'annotation';

  const isRevisionTask = !!(task && task.revision_count > 0 && task.stage === 'annotation');

  const { data: qaReviewsList } = useQuery({
    queryKey: ['qa-reviews-for-revision', task?.id],
    queryFn: () => qaApi.getTaskReviews(task!.id),
    enabled: isRevisionTask,
    staleTime: 5 * 60 * 1000,
  });

  const latestReviewId = useMemo(() => {
    if (!qaReviewsList?.length) return null;
    const sorted = [...qaReviewsList].sort((a, b) =>
      new Date(b.completed_at || b.created_at).getTime() - new Date(a.completed_at || a.created_at).getTime()
    );
    return sorted[0]?.id || null;
  }, [qaReviewsList]);

  const { data: revisionAnnotationReviews } = useQuery({
    queryKey: ['qa-annotation-reviews-revision', latestReviewId],
    queryFn: () => qaApi.getAnnotationReviews(latestReviewId!),
    enabled: !!latestReviewId,
    staleTime: 5 * 60 * 1000,
  });

  const revisionVerdicts = useMemo(() => {
    const map = new Map<string, AnnotationReview>();
    if (!revisionAnnotationReviews) return map;
    for (const review of revisionAnnotationReviews) {
      map.set(review.annotation_id, review);
    }
    return map;
  }, [revisionAnnotationReviews]);

  React.useEffect(() => {
    if (isQAMode) {
      console.log('[QA CuboidAnnotations] isQAMode:', isQAMode, 'task.stage:', task?.stage, 'showSuggestions:', showSuggestions);
    }
    if (isRevisionTask) {
      console.log('[Revision CuboidAnnotations] revision_count:', task?.revision_count, 'verdicts loaded:', revisionVerdicts.size);
    }
  }, [isQAMode, task?.stage, showSuggestions, isRevisionTask, task?.revision_count, revisionVerdicts]);

  const cuboids = annotations.filter((a) => a.type === 'cuboid' && !hiddenAnnotationIds.has(a.id));

  const stringToColor = (str: string) => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    const c = (hash & 0x00ffffff).toString(16).toUpperCase();
    return '#' + '00000'.substring(0, 6 - c.length) + c;
  };

  const getAnnotationColor = useCallback((annotation: Annotation) => {
    if (annotationColorMode === 'attribute' && activeAttributeForColor) {
        const val = annotation.attributes?.[activeAttributeForColor];
        if (val !== undefined && val !== null) {
             return stringToColor(String(val));
        }
    }
    if (annotationColorMode === 'qa_status') {
         if (isRevisionTask && revisionVerdicts.size > 0) {
             const review = revisionVerdicts.get(annotation.id);
             if (review?.verdict === 'approved') return '#00cc44';
             if (review?.verdict === 'rejected') return '#ff3333';
             if (review?.verdict === 'flagged') return '#ffaa00';
             return '#888888';
         }
         const review = annotationReviews.get(annotation.id);
         if (review?.verdict === 'approved') return '#00ff00';
         if (review?.verdict === 'rejected') return '#ff0000';
         if (review?.verdict === 'flagged') return '#ffff00';
         return '#888888';
    }
    if (isRevisionTask && revisionVerdicts.size > 0) {
         const review = revisionVerdicts.get(annotation.id);
         if (review?.verdict === 'approved') return '#00cc44';
         if (review?.verdict === 'rejected') return '#ff3333';
         if (review?.verdict === 'flagged') return '#ffaa00';
    }
    const cls = taxonomy?.classes.find((c) => c.id === annotation.class_id);
    return cls?.color ?? '#888888';
  }, [taxonomy, annotationColorMode, activeAttributeForColor, annotationReviews, isRevisionTask, revisionVerdicts]);

  React.useEffect(() => {
    console.log('[CuboidAnnotations] Color mode:', annotationColorMode, 'activeAttribute:', activeAttributeForColor);
    console.log('[CuboidAnnotations] Taxonomy classes:', taxonomy?.classes?.length, 'Cuboids:', cuboids.length);
    if (cuboids.length > 0) {
      const firstColor = getAnnotationColor(cuboids[0]);
      console.log('[CuboidAnnotations] First cuboid color:', firstColor, 'class_id:', cuboids[0].class_id);
    }
  }, [annotationColorMode, activeAttributeForColor, taxonomy, cuboids, getAnnotationColor]);

  const getClassName = useCallback((classId: string) => {
    const cls = taxonomy?.classes.find((c) => c.id === classId);
    return cls?.name ?? classId;
  }, [taxonomy]);

  const handleAnnotationUpdate = useCallback((annotationId: string, updates: Partial<CuboidData>) => {
    const annotation = annotations.find(a => a.id === annotationId);
    if (!annotation) return;

    const currentData = annotation.data as CuboidData;

    updateAnnotation(annotationId, {
      data: { ...currentData, ...updates }
    });
  }, [annotations, updateAnnotation]);

  return (
    <group key={`cuboids-${annotationColorMode}-${activeAttributeForColor || 'none'}`}>
      {cuboids.map((ann) => {
        const data = ann.data as CuboidData;
        const isTracked = !!ann.track_id;
        const isKeyframe = ann.is_keyframe === true;

        // Get suggestion info for this annotation (only show in QA mode and not during annotation stage)
        const suggestionInfo = showSuggestions ? suggestionsByAnnotation.get(ann.id) : undefined;

        // Calculate color for this annotation
        const computedColor = getAnnotationColor(ann);

        // In revision mode, check if this annotation is approved (locked)
        const revisionReview = isRevisionTask ? revisionVerdicts.get(ann.id) : undefined;
        const isRevisionLocked = isRevisionTask && revisionReview?.verdict === 'approved';

        // In QA mode, check if this annotation is approved in the current QA session
        const qaReview = isQAMode ? annotationReviews.get(ann.id) : undefined;
        const isQALocked = isQAMode && qaReview?.verdict === 'approved';

        // Annotation shows "QA Approved" badge ONLY if actually reviewed and approved
        // (not just because we're in QA mode)
        const isLockedApproved = isRevisionLocked || isQALocked;

        // In QA mode, check if this annotation should be editable
        // (only false negatives added by QA are editable in QA mode)
        const isQAModeEditable = isQAMode && ann.source === 'qa_correction';

        return (
          <CuboidMesh
            key={`${ann.id}-${computedColor}-${isLockedApproved ? 'locked' : 'editable'}`}
            annotation={ann}
            transformedPosition={[data.center.x, data.center.y, data.center.z]}
            transformedYaw={data.rotation?.yaw || 0}
            isSelected={selection.selectedAnnotationIds.includes(ann.id)}
            isHovered={selection.hoveredAnnotationId === ann.id}
            classColor={computedColor}
            className={getClassName(ann.class_id)}
            trackId={ann.track_id}
            isAutoAnnotation={ann.source !== 'manual'}
            isTracked={isTracked}
            isKeyframe={isKeyframe}
            isPending={false}
            isLocked={isLockedApproved}
            hasSuggestion={!!suggestionInfo}
            suggestionSeverity={suggestionInfo?.maxSeverity}
            onClick={() => {
              selectAnnotation(ann.id);
            }}
            onDoubleClick={() => {
              // Set flag to prevent camera reset by DoubleClickResetHandler
              setBoxDoubleClickedFlag3D();

              // Toggle behavior: if already focused on this box, reset view
              // Otherwise, zoom to this box
              if (focusedAnnotationId === ann.id) {
                console.log('[CuboidAnnotations] Double-click on focused box, resetting view');
                resetCameraView();
              } else {
                console.log('[CuboidAnnotations] Double-click on box:', ann.id);
                focusOnAnnotation(ann.id);
              }
            }}
            onHover={(hover) => hoverAnnotation(hover ? ann.id : undefined)}
            onUpdate={(isLockedApproved || (isQAMode && !isQAModeEditable)) ? undefined : (updates) => handleAnnotationUpdate(ann.id, updates)}
            egoTransform={undefined}
            shiftPressed={(isLockedApproved || (isQAMode && !isQAModeEditable)) ? false : shiftPressed}
          />
        );
      })}
    </group>
  );
};

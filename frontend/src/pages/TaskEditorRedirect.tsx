import React, { useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { taskApi, sceneApi, datasetApi, taxonomyApi } from '@/api/client';

export const TaskEditorRedirect: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const taxonomyIdFromUrl = searchParams.get('taxonomy');

  const { data: task, isLoading: taskLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => taskApi.get(taskId!),
    enabled: !!taskId,
  });

  const { data: scene, isLoading: sceneLoading } = useQuery({
    queryKey: ['scene', task?.scene_id],
    queryFn: () => sceneApi.get(task!.scene_id),
    enabled: !!task?.scene_id,
  });

  const { data: taxonomies, isLoading: taxonomiesLoading } = useQuery({
    queryKey: ['dataset-taxonomies', scene?.dataset_id],
    queryFn: () => datasetApi.getTaxonomies(scene!.dataset_id),
    enabled: !!scene?.dataset_id,
  });

  // The task's OWN taxonomy is the authoritative signal for which editor to use.
  const { data: taskTaxonomy, isLoading: taskTaxonomyLoading } = useQuery({
    queryKey: ['taxonomy', task?.taxonomy_id],
    queryFn: () => taxonomyApi.get(task!.taxonomy_id!),
    enabled: !!task?.taxonomy_id,
  });

  useEffect(() => {
    console.log('[TaskEditorRedirect] State:', {
      taskId,
      taxonomyIdFromUrl,
      taskLoading,
      sceneLoading,
      taxonomiesLoading,
      task: task?.id,
      sceneId: task?.scene_id,
      scene: scene?.id,
      datasetId: scene?.dataset_id,
      selectedTaxonomyId: scene?.selected_taxonomy_id,
      taxonomies: taxonomies?.map(t => ({ id: t.id, name: t.name, mode: t.annotation_mode })),
      taxonomiesLength: taxonomies?.length,
    });

    if (!taskId) return;
    if (taskLoading || !task) return;
    if (sceneLoading || !scene) return;

    // Prefer the task's own bound taxonomy — it authoritatively determines the
    // editor. The dataset's taxonomy list (used below) is unreliable: it can be
    // empty or list a non-segmentation mode first, which would wrongly route a
    // segmentation task to the cuboid editor (and then no per-point labels show).
    if (task.taxonomy_id) {
      if (taskTaxonomyLoading) return;
      const taskMode = taskTaxonomy?.annotation_mode;
      if (taskMode) {
        const param = taxonomyIdFromUrl ? `?taxonomy=${taxonomyIdFromUrl}` : `?taxonomy=${task.taxonomy_id}`;
        if (taskMode === 'segmentation_3d') {
          navigate(`/tasks/${taskId}/segmentation${param}`, { replace: true });
        } else {
          navigate(`/tasks/${taskId}/editor${param}`, { replace: true });
        }
        return;
      }
    }

    if (taxonomiesLoading) return;

    if (taxonomies === undefined) return;

    let targetTaxonomy = taxonomies?.[0];

    if (taxonomyIdFromUrl && taxonomies) {
      const urlTaxonomy = taxonomies.find(t => t.id === taxonomyIdFromUrl);
      if (urlTaxonomy) {
        targetTaxonomy = urlTaxonomy;
      }
    }
    else if (scene.selected_taxonomy_id && taxonomies) {
      const selected = taxonomies.find(t => t.id === scene.selected_taxonomy_id);
      if (selected) {
        targetTaxonomy = selected;
      }
    }


    const isSegmentationMode = targetTaxonomy?.annotation_mode === 'segmentation_3d';
    const allAreSegmentation = taxonomies && taxonomies.length > 0 &&
      taxonomies.every(t => t.annotation_mode === 'segmentation_3d');

    const shouldUseSegmentationEditor = isSegmentationMode || allAreSegmentation;

    console.log('[TaskEditorRedirect] Routing decision:', {
      taxonomyIdFromUrl,
      selectedTaxonomyId: scene.selected_taxonomy_id,
      targetTaxonomy: targetTaxonomy ? { id: targetTaxonomy.id, name: targetTaxonomy.name, mode: targetTaxonomy.annotation_mode } : null,
      isSegmentationMode,
      allAreSegmentation,
      shouldUseSegmentationEditor,
      willNavigateTo: shouldUseSegmentationEditor ? 'segmentation' : 'editor',
    });

    const taxonomyParam = taxonomyIdFromUrl ? `?taxonomy=${taxonomyIdFromUrl}` : '';

    if (shouldUseSegmentationEditor) {
      // Navigate to segmentation editor
      console.log('[TaskEditorRedirect] Navigating to segmentation editor');
      navigate(`/tasks/${taskId}/segmentation${taxonomyParam}`, { replace: true });
    } else {
      // Navigate to fusion editor (default)
      console.log('[TaskEditorRedirect] Navigating to fusion editor');
      navigate(`/tasks/${taskId}/editor${taxonomyParam}`, { replace: true });
    }
  }, [taskId, taxonomyIdFromUrl, task, scene, taxonomies, taskLoading, sceneLoading, taxonomiesLoading, taskTaxonomy, taskTaxonomyLoading, navigate]);

  // Loading state
  return (
    <div className="fixed inset-0 bg-dark flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="text-gray-400 text-sm">Loading editor...</span>
      </div>
    </div>
  );
};

export default TaskEditorRedirect;

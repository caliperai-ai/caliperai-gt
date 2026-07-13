import { useMemo } from 'react';
import { useEditorStore, useCurrentFrameAnnotations } from '@/store/editorStore';
import { projectCuboidToAllCameras } from '@/utils/projection';
import type { CuboidData } from '@/types';
import type { FusionLabel } from './types';

export const useFusionLabels = () => {
  const { scene } = useEditorStore();
  const currentFrameAnnotations = useCurrentFrameAnnotations();

  const cuboidAnnotations = useMemo(() =>
    currentFrameAnnotations.filter(ann => ann.type === 'cuboid'),
    [currentFrameAnnotations]
  );

  const lidarToCameras = useMemo(() => {
    if (!scene?.calibration?.lidar_to_cameras) return {};
    return scene.calibration.lidar_to_cameras;
  }, [scene?.calibration]);

  const cameras = useMemo(() =>
    scene?.storage_paths?.cameras ? Object.keys(scene.storage_paths.cameras) : [],
    [scene?.storage_paths?.cameras]
  );

  const imageSize = useMemo(() => ({ width: 1600, height: 900 }), []);

  const fusionLabels = useMemo(() => {
    if (!cuboidAnnotations.length || !Object.keys(lidarToCameras).length) {
      return new Map<string, FusionLabel[]>();
    }

    const labels = new Map<string, FusionLabel[]>();

    for (const ann of cuboidAnnotations) {
      const cuboidData = ann.data as CuboidData;
      const projections = projectCuboidToAllCameras(cuboidData, lidarToCameras, imageSize);

      for (const [cameraId, bbox] of Object.entries(projections)) {
        const fusionLabel: FusionLabel = {
          annotationId: ann.id,
          cameraId,
          bbox,
          classId: ann.class_id,
          trackId: ann.track_id,
          isManuallyAdjusted: false,
        };

        if (!labels.has(ann.id)) {
          labels.set(ann.id, []);
        }
        labels.get(ann.id)!.push(fusionLabel);
      }
    }

    return labels;
  }, [cuboidAnnotations, lidarToCameras]);

  const camerasWithLabels = useMemo(() => {
    const cameraSet = new Set<string>();
    fusionLabels.forEach((annLabels) => {
      annLabels.forEach(l => cameraSet.add(l.cameraId));
    });
    return Array.from(cameraSet);
  }, [fusionLabels]);

  const labelsByCamera = useMemo(() => {
    const grouped: Record<string, FusionLabel[]> = {};
    fusionLabels.forEach((annLabels) => {
      annLabels.forEach(label => {
        if (!grouped[label.cameraId]) {
          grouped[label.cameraId] = [];
        }
        grouped[label.cameraId].push(label);
      });
    });
    return grouped;
  }, [fusionLabels]);

  return {
    fusionLabels,
    camerasWithLabels,
    labelsByCamera,
    cameras,
    lidarToCameras,
    cuboidAnnotations,
  };
};

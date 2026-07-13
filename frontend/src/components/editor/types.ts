import type { BBox2D } from '@/types';

export type ToolType = 'select' | 'cuboid' | 'box2d' | 'polygon' | 'polyline' | 'brush3d' | 'track';
export type AnnotationCapability = 'bounding_box_3d' | 'bounding_box_2d' | 'semantic_segmentation' | 'instance_segmentation' | 'tracking' | 'polygon' | 'polyline';
export type ViewMode = '3d' | 'fusion' | '2d' | '4d' | 'focus';

export interface Tool {
  id: ToolType;
  name: string;
  icon: JSX.Element;
  shortcut: string;
  capability?: AnnotationCapability;
}

export interface FusionLabel {
  annotationId: string;
  cameraId: string;
  bbox: BBox2D;
  classId: string;
  trackId?: string;
  isManuallyAdjusted: boolean;
}

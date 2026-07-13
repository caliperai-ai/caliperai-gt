
export * from './auth';

export * from './chat';

import type { UserRole } from './auth';


export type TaskStatus =
  | 'pending'
  | 'assigned'
  | 'in_progress'
  | 'submitted'
  | 'accepted'
  | 'rejected';

export type TaskStage =
  | 'annotation'
  | 'qa'
  | 'customer_qa'
  | 'accepted';

export type AnnotationType =
  | 'cuboid'
  | 'box2d'
  | 'fusion_box2d'
  | 'polyline'
  | 'polygon'
  | 'keypoints'
  | 'segmentation_3d'
  | 'segmentation_2d';

export type AnnotationSource =
  | 'manual'
  | 'auto'
  | 'auto_manual'
  | 'auto_interpolated'
  | 'airflow_model_v1'
  | 'airflow_model_v2'
  | 'imported'
  | 'qa_correction';


export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface BBox2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Dimensions3D {
  length: number;
  width: number;
  height: number;
}

export interface Rotation3D {
  yaw: number;
  pitch: number;
  roll: number;
}


export type CameraModel = 'pinhole' | 'kannala_brandt';

export interface ExtrinsicCalibration {
  rotation: number[][];
  translation: number[];
}

export interface IntrinsicCalibration {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
  distortion?: number[];
  resolution?: [number, number];
  camera_model?: CameraModel;
}

export interface CameraCalibration {
  extrinsic: ExtrinsicCalibration;
  intrinsic: IntrinsicCalibration;
}

export interface SceneCalibration {
  lidar_to_cameras: Record<string, CameraCalibration>;
  ego_to_lidar?: ExtrinsicCalibration;
}


export interface CuboidData {
  center: Point3D;
  dimensions: Dimensions3D;
  rotation: Rotation3D;
  confidence?: number;
}

export interface Box2DData {
  camera_id: string;
  bbox: BBox2D;
}

export interface FusionBox2DData {
  camera_id: string;
  bbox: BBox2D;
  parent_annotation_id: string;
  is_manually_adjusted: boolean;
}

export interface PolylineData {
  camera_id: string;
  points: number[][];
  is_closed: boolean;
  bezier: boolean;
}

export interface PolygonData {
  camera_id: string;
  points: number[][];
}

export interface Keypoint {
  x: number;
  y: number;
  visibility: 0 | 1 | 2;
}

export interface KeypointsData {
  camera_id: string;
  skeleton_id: string;
  keypoints: Record<string, Keypoint>;
}

export interface Segmentation3DData {
  blob_url?: string;
  compression: string;
  point_count: number;
  class_mapping: Record<string, string>;
}

export interface Segmentation2DData {
  camera_id: string;
  mask_url?: string;
  polygons?: number[][][];
}

export type AnnotationData =
  | CuboidData
  | Box2DData
  | FusionBox2DData
  | PolylineData
  | PolygonData
  | KeypointsData
  | Segmentation3DData
  | Segmentation2DData;


export interface AttributeDefinition {
  type: 'boolean' | 'string' | 'number' | 'enum';
  default?: unknown;
  options?: string[];
  required?: boolean;
  description?: string;
  mutable?: boolean;
}

export interface SharedAttributeDefinition {
  name: string;
  type: 'boolean' | 'string' | 'number' | 'enum';
  default?: unknown;
  options?: string[];
  required?: boolean;
  description?: string;
  mutable?: boolean;
  applies_to: string[];
}

export interface KeypointDefinition {
  id: string;
  name: string;
  color?: string;
}

export interface SkeletonDefinition {
  keypoints: KeypointDefinition[];
  bones: [string, string][];
}

export interface ClassDefinition {
  id: string;
  name: string;
  color: string;
  type: AnnotationType[];
  attributes: Record<string, AttributeDefinition>;
  skeleton?: string;
  description?: string;
  default_dimensions?: [number, number, number];
  single_click_placement?: boolean;
  instance_prefix?: string;
}

export interface TaxonomyConfig {
  classes: ClassDefinition[];
  skeletons: Record<string, SkeletonDefinition>;
  annotation_rules: {
    min_points_polyline: number;
    min_points_polygon: number;
    allow_overlapping_boxes: boolean;
    require_track_id: boolean;
  };
  shared_attributes?: SharedAttributeDefinition[];
}

export type TaxonomyAnnotationMode = 'fusion_3d' | '2d_only' | 'segmentation_3d';

export interface Taxonomy {
  id: string;
  organization_id?: string;
  name: string;
  description?: string;
  version: string;
  annotation_mode: TaxonomyAnnotationMode;
  classes: ClassDefinition[];
  skeletons: Record<string, SkeletonDefinition>;
  annotation_rules: {
    min_points_polyline: number;
    min_points_polygon: number;
    allow_overlapping_boxes: boolean;
    require_track_id: boolean;
  };
  shared_attributes?: SharedAttributeDefinition[];
  created_at: string;
  updated_at: string;
}

export interface DatasetTaxonomiesByMode {
  fusion_3d: Taxonomy | null;
  '2d_only': Taxonomy | null;
}


export interface Campaign {
  id: string;
  name: string;
  description?: string;
  config: Record<string, unknown>;
  custom_metadata: Record<string, unknown>;
  stats: {
    total_datasets: number;
    total_scenes: number;
    total_tasks: number;
    completed_tasks: number;
    total_annotations: number;
    annotator_hours: number;
  };
  deadline?: string;
  created_at: string;
  updated_at: string;
}

export interface Dataset {
  id: string;
  campaign_id: string;
  name: string;
  description?: string;
  taxonomy: TaxonomyConfig;
  sensor_config: {
    lidar?: Record<string, unknown>;
    cameras: Record<string, unknown>[];
  };
  custom_metadata: Record<string, unknown>;
  deadline?: string;
  created_at: string;
  updated_at: string;
}

export interface DatasetStats {
  scene_count: number;
  total_frames: number;
  total_tasks: number;
  pending_tasks: number;
  in_progress_tasks: number;
  completed_tasks: number;
}

export interface DatasetDetailResponse extends Dataset {
  taxonomies: Taxonomy[];
  scenes: Scene[];
  stats: DatasetStats;
}

export interface Scene {
  id: string;
  dataset_id: string;
  name: string;
  description?: string;
  metadata: Record<string, unknown>;
  frame_count: number;
  fps: number;
  calibration: SceneCalibration;
  storage_paths: {
    lidar_base: string;
    cameras: Record<string, string>;
    ego_poses?: string;
  };
  tasks?: Task[];
  deadline?: string;
  selected_taxonomy_id?: string;
  created_at: string;
  updated_at: string;
}

export interface Frame {
  id: string;
  scene_id: string;
  frame_index: number;
  timestamp: number;
  ego_pose?: {
    position: number[];
    rotation: number[];
    velocity?: number[];
  };
  file_paths: {
    lidar: string;
    cameras: Record<string, string>;
  };
  is_context?: boolean;
  is_readonly?: boolean;
}

export interface TaskTaxonomyStatus {
  taxonomy_id: string;
  taxonomy_name: string;
  annotation_mode?: string;
  stage: TaskStage;
  status: TaskStatus;
  revision_count: number;
  started_at?: string;
  submitted_at?: string;
  assignee_id?: string;
  reviewer_id?: string;
  customer_reviewer_id?: string;
}

export interface Task {
  id: string;
  scene_id: string;
  name: string;
  description?: string;
  status: TaskStatus;
  stage: TaskStage;
  frame_range: {
    start: number;
    end: number;
  };
  context_buffer_before: number;
  context_buffer_after: number;
  priority: number;
  deadline?: string;
  config: {
    required_annotation_types: AnnotationType[];
    required_classes: string[];
    auto_annotation_enabled: boolean;
    quality_checks: string[];
  };
  assignee_id?: string;
  assigned_at?: string;
  reviewer_id?: string;
  reviewed_at?: string;
  review_notes?: string;
  customer_reviewer_id?: string;
  customer_reviewed_at?: string;
  customer_review_notes?: string;
  skip_customer_qa: boolean;
  revision_count: number;
  started_at?: string;
  submitted_at?: string;
  total_time_seconds: number;
  taxonomy_id?: string;
  taxonomy_name?: string;
  taxonomy_annotation_mode?: string;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: string;
  email: string;
  username: string;
  full_name?: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Annotation {
  id: string;
  task_id: string;
  frame_id: string;
  track_id?: string;
  camera_id?: string;
  type: AnnotationType;
  class_id: string;
  data: AnnotationData;
  attributes: Record<string, unknown>;
  source: AnnotationSource;
  taxonomy_id?: string;
  is_verified: boolean;
  verified_by?: string;
  verified_at?: string;
  created_at: string;
  updated_at: string;
  is_keyframe?: boolean;
  is_static?: boolean;
}


export interface Track {
  id: string;
  class_id: string;
  attributes: Record<string, unknown>;
  frame_annotations: Map<string, string>;
  keyframe_ids: Set<string>;
  created_at: string;
  updated_at: string;

  start_frame_index: number | null;
  end_frame_index: number | null;
  is_static: boolean;
}

export interface TrackKeyframe {
  frame_id: string;
  frame_index: number;
  annotation_id: string;
  data: CuboidData;
}

export interface InterpolatedFrame {
  frame_id: string;
  frame_index: number;
  data: CuboidData;
  is_keyframe: boolean;
}


export interface EditorTool {
  id: string;
  name: string;
  icon: string;
  type: 'select' | 'cuboid' | 'box2d' | 'polyline' | 'polygon' | 'keypoints' | 'brush3d' | 'lasso3d' | 'track' | 'flag_missing';
  shortcut?: string;
}

export interface ViewState {
  zoom: number;
  pan: Point2D;
  rotation?: number;
}

export type CoordinateFrame = 'world' | 'ego' | 'lidar';

export interface CameraViewState {
  isActive: boolean;
  cameraId: string | null;
  showImagePlane: boolean;
  frustumOnlyMode: boolean;
  imageOnlyMode: boolean;
}

export interface GroundPlaneSettings {
  enabled: boolean;
  distanceThreshold: number;
  samplePercent: number;
}

export interface DetectedGroundPlane {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface ClipBoxSettings {
  enabled: boolean;
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  zMin: number;
  zMax: number;
}

export interface LidarViewState {
  camera: {
    position: Point3D;
    target: Point3D;
    up: Point3D;
  };
  pointSize: number;
  colorMode: 'intensity' | 'height' | 'height_above_ground' | 'class';
  centerOnEgo: boolean;
  coordinateFrame: CoordinateFrame;
  cameraView: CameraViewState;
  groundPlane: GroundPlaneSettings;
  detectedGroundPlane?: DetectedGroundPlane;
  isTopView: boolean;
  showGrid: boolean;
  useFisheyeProjection: boolean;
  focusedAnnotationId?: string;
  focusedPosition?: Point3D;
  cameraResetCounter: number;
  clipBox: ClipBoxSettings;
}

export interface SelectionState {
  selectedAnnotationIds: string[];
  hoveredAnnotationId?: string;
  selectedPoints?: number[];
}


export interface PointCloudData {
  positions: Float32Array;
  intensities?: Float32Array;
  colors?: Float32Array;
  labels?: Uint8Array;
  pointCount: number;
}


export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface BulkOperationResponse {
  success_count: number;
  error_count: number;
  errors: Array<{ index: number; error: string }>;
}

export interface PredictionInjectionResponse {
  task_id: string;
  injected_count: number;
  source: string;
  created_annotations: string[];
}


export type QAReviewMode = 'view_only' | 'edit' | 'suggest';
export type QAReviewStatus = 'in_progress' | 'completed' | 'paused';
export type ReviewVerdict = 'approved' | 'rejected' | 'flagged' | 'pending';
export type SuggestionSeverity = 'low' | 'medium' | 'high' | 'critical';
export type SuggestionType =
  | 'size_anomaly'
  | 'position_jump'
  | 'orientation_flip'
  | 'track_discontinuity'
  | 'low_confidence'
  | 'class_mismatch'
  | 'missing_attributes'
  | 'auto_interpolated'
  | 'imported_unchecked'
  | 'occlusion_issue'
  | 'ground_plane_misalignment'
  | 'track_dimension_inconsistency'
  | 'velocity_outlier'
  | 'heading_motion_mismatch'
  | 'overlapping_cuboids'
  | 'short_track'
  | 'aspect_ratio_anomaly'
  | 'stationary_with_motion_class'
  | 'track_gap'
  | 'track_boundary_issue'
  | 'false_negative';

export interface QAReviewSummary {
  approved: number;
  rejected: number;
  flagged: number;
  pending: number;
  total_annotations: number;
  suggestions_addressed?: number;
  suggestions_dismissed?: number;
  outcome?: 'accepted' | 'rejected' | 'no_change';
  next_stage?: 'annotation' | 'qa' | 'customer_qa' | 'accepted';
}

export interface QAReview {
  id: string;
  task_id: string;
  reviewer_id?: string;
  reviewer_name?: string;
  status: QAReviewStatus;
  mode: QAReviewMode;
  review_stage?: string;
  started_at: string;
  completed_at?: string;
  summary?: QAReviewSummary;
  created_at: string;
  updated_at: string;
}

export interface AnnotationReview {
  id: string;
  qa_review_id: string;
  annotation_id: string;
  annotation_table: string;
  verdict?: ReviewVerdict;
  issue_types?: string[];
  notes?: string;
  reviewed_at?: string;
  created_at: string;
  updated_at: string;
  frame_id?: string;
  class_id?: string;
  location_x?: number;
  location_y?: number;
  location_z?: number;
  annotator_resolved?: boolean;
}

export interface AnnotationComment {
  id: string;
  annotation_id: string;
  annotation_table: string;
  user_id?: string;
  user_name?: string;
  parent_id?: string;
  content: string;
  is_resolved: boolean;
  resolved_by?: string;
  resolved_at?: string;
  replies: AnnotationComment[];
  created_at: string;
  updated_at: string;
}

export interface QASuggestion {
  id: string;
  task_id: string;
  annotation_id?: string;
  annotation_table?: string;
  frame_id?: string;
  suggestion_type: SuggestionType;
  severity: SuggestionSeverity;
  message: string;
  details?: Record<string, unknown>;
  is_dismissed: boolean;
  dismissed_by?: string;
  dismissed_at?: string;
  created_at: string;
}

export interface QATaskStats {
  task_id: string;
  total_annotations: number;
  reviewed_count: number;
  pending_count: number;
  approved_count: number;
  rejected_count: number;
  flagged_count: number;
  suggestions_count: number;
  suggestions_dismissed: number;
  comment_count: number;
  unresolved_comments: number;
  review_progress_percent: number;
  has_active_review: boolean;
  active_review_id?: string;
}

export interface GenerateSuggestionsResponse {
  task_id: string;
  suggestions_count: number;
  by_severity: Record<string, number>;
  by_type: Record<string, number>;
}


export interface AnnotatorStats {
  id: string;
  alias: string;
  tasks_completed: number;
  tasks_in_progress: number;
  tasks_assigned: number;
  total_time_seconds: number;
  avg_time_per_task_seconds: number;
  revision_rate: number;
  frames_annotated: number;
}

export interface TaskBreakdown {
  pending: number;
  assigned: number;
  in_progress: number;
  submitted: number;
  accepted: number;
  rejected: number;
  total: number;
}

export interface StageBreakdown {
  annotation: number;
  qa: number;
  customer_qa: number;
  accepted: number;
}

export interface MostTimeConsumingTask {
  task_id: string;
  task_name: string;
  scene_name: string;
  dataset_name: string;
  total_time_seconds: number;
  total_time_formatted: string;
  frame_count: number;
  annotator_alias?: string;
}

export interface RecentActivity {
  task_id: string;
  task_name: string;
  action: string;
  annotator_alias?: string;
  timestamp: string;
}

export interface EfficiencyMetrics {
  avg_time_per_task_seconds: number;
  avg_time_per_frame_seconds: number;
  avg_revisions_per_task: number;
  first_time_accept_rate: number;
  tasks_completed_last_7_days: number;
  tasks_completed_last_30_days: number;
  velocity_trend: 'increasing' | 'decreasing' | 'stable';
}

export interface PMDashboardStats {
  task_breakdown: TaskBreakdown;
  stage_breakdown: StageBreakdown;
  completion_rate: number;
  efficiency: EfficiencyMetrics;
  top_annotators: AnnotatorStats[];
  most_time_consuming_task?: MostTimeConsumingTask;
  recent_activity: RecentActivity[];
  overdue_tasks: number;
  tasks_due_this_week: number;
  generated_at: string;
}

                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import type {
  Campaign,
  Dataset,
  DatasetDetailResponse,
  Scene,
  Task,
  Frame,
  Annotation,
  Taxonomy,
  TaxonomyAnnotationMode,
  DatasetTaxonomiesByMode,
  User,
  PaginatedResponse,
  PredictionInjectionResponse,
} from '@/types';
import { useAuthStore } from '@/store/authStore';
import { refreshAccessToken } from '@/api/auth';

const api = axios.create({
  baseURL: '/api/v1',
  headers: {
    'Content-Type': 'application/json',
  },
});


api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = useAuthStore.getState().accessToken;
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// =============================================================================
// RESPONSE INTERCEPTOR - Handle auth errors and token refresh
// =============================================================================

let isRefreshing = false;
let failedQueue: Array<{
  resolve: (token: string) => void;
  reject: (error: unknown) => void;
}> = [];

const processQueue = (error: unknown, token: string | null = null) => {
  failedQueue.forEach((prom) => {
    if (error) {
      prom.reject(error);
    } else if (token) {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
      skipAuthRefresh?: boolean;
    };

    if (originalRequest.skipAuthRefresh) {
      return Promise.reject(error);
    }

    // If 401 and we haven't tried to refresh yet
    if (error.response?.status === 401 && !originalRequest._retry) {
      if (isRefreshing) {
        // Wait for refresh to complete
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        })
          .then((token) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return api(originalRequest);
          })
          .catch((err) => Promise.reject(err));
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const newToken = await refreshAccessToken();
        if (newToken) {
          processQueue(null, newToken);
          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${newToken}`;
          }
          return api(originalRequest);
        } else {
          // Refresh failed, redirect to login
          processQueue(error, null);
          window.location.href = '/login';
          return Promise.reject(error);
        }
      } catch (refreshError) {
        processQueue(refreshError, null);
        window.location.href = '/login';
        return Promise.reject(refreshError);
      } finally {
        isRefreshing = false;
      }
    }

    // Handle 403 Forbidden (permission denied)
    if (error.response?.status === 403) {
      console.error('Permission denied:', error.response.data);
      // Could dispatch an event or show a toast here
    }

    return Promise.reject(error);
  }
);

// =============================================================================
// CAMPAIGNS
// =============================================================================

export const campaignApi = {
  list: async (filters?: {
    page?: number;
    pageSize?: number;
    search?: string;
    organization_id?: string;
  }) => {
    const params = new URLSearchParams({
      page: (filters?.page ?? 1).toString(),
      page_size: (filters?.pageSize ?? 20).toString(),
    });
    if (filters?.search) params.append('search', filters.search);
    if (filters?.organization_id) params.append('organization_id', filters.organization_id);
    const { data } = await api.get<PaginatedResponse<Campaign>>(`/campaigns?${params}`);
    return data;
  },

  get: async (id: string) => {
    const { data } = await api.get<Campaign>(`/campaigns/${id}`);
    return data;
  },

  create: async (campaign: Partial<Campaign>) => {
    const { data } = await api.post<Campaign>('/campaigns', campaign);
    return data;
  },

  update: async (id: string, campaign: Partial<Campaign>) => {
    const { data } = await api.patch<Campaign>(`/campaigns/${id}`, campaign);
    return data;
  },

  delete: async (id: string) => {
    await api.delete(`/campaigns/${id}`);
  },

  getStats: async (id: string) => {
    const { data } = await api.get(`/campaigns/${id}/stats`);
    return data;
  },
};

// =============================================================================
// DATASETS
// =============================================================================

export const datasetApi = {
  list: async (campaignId?: string, page = 1, pageSize = 20) => {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
    });
    if (campaignId) params.append('campaign_id', campaignId);
    const { data } = await api.get<Dataset[]>(`/datasets?${params}`);
    return data;
  },

  get: async (id: string) => {
    const { data } = await api.get<Dataset>(`/datasets/${id}`);
    return data;
  },

  // Optimized endpoint that returns dataset with scenes, taxonomies, and stats in one call
  getDetail: async (id: string) => {
    const { data } = await api.get<DatasetDetailResponse>(`/datasets/${id}/detail`);
    return data;
  },

  create: async (dataset: Partial<Dataset>) => {
    const { data } = await api.post<Dataset>('/datasets', dataset);
    return data;
  },

  update: async (id: string, dataset: Partial<Dataset>) => {
    const { data } = await api.patch<Dataset>(`/datasets/${id}`, dataset);
    return data;
  },

  delete: async (id: string) => {
    await api.delete(`/datasets/${id}`);
  },

  getTaxonomy: async (id: string) => {
    const { data } = await api.get(`/datasets/${id}/taxonomy`);
    return data;
  },

  getTaxonomies: async (id: string) => {
    const { data } = await api.get<Taxonomy[]>(`/datasets/${id}/taxonomies`);
    return data;
  },

  linkTaxonomy: async (datasetId: string, taxonomyId: string) => {
    const { data } = await api.post(`/datasets/${datasetId}/taxonomies/${taxonomyId}`);
    return data;
  },

  unlinkTaxonomy: async (datasetId: string, taxonomyId: string) => {
    await api.delete(`/datasets/${datasetId}/taxonomies/${taxonomyId}`);
  },

  createTasksForTaxonomy: async (datasetId: string, taxonomyId: string) => {
    const { data } = await api.post(`/datasets/${datasetId}/taxonomies/${taxonomyId}/create-tasks`);
    return data;
  },

  clearDefaultTaxonomy: async (datasetId: string) => {
    const { data } = await api.delete(`/datasets/${datasetId}/default-taxonomy`);
    return data;
  },

  createVariantsFromTaxonomies: async (datasetId: string) => {
    const { data } = await api.post<{
      message: string;
      original_dataset_id: string;
      created_datasets: Array<{
        id: string;
        name: string;
        taxonomy_id: string;
        taxonomy_name: string;
      }>;
    }>(`/datasets/${datasetId}/create-variants`);
    return data;
  },

  importAnnotations: async (
    datasetId: string,
    file: File,
    deriveTaxonomy = true,
    overwrite = false
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('derive_taxonomy', deriveTaxonomy.toString());
    formData.append('overwrite', overwrite.toString());

    const { data } = await api.post<{
      success: boolean;
      message: string;
      imported_count: number;
      scenes_processed: number;
      sensors_processed: Record<string, number>;
      derived_taxonomy_id?: string;
      derived_classes: string[];
      errors: string[];
    }>(`/import/datasets/${datasetId}/import-annotations`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return data;
  },
};

// =============================================================================
// TAXONOMIES
// =============================================================================

export const taxonomyApi = {
  list: async (page = 1, pageSize = 20, search?: string, annotationMode?: TaxonomyAnnotationMode, organizationId?: string) => {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
    });
    if (search) params.append('search', search);
    if (annotationMode) params.append('annotation_mode', annotationMode);
    // Scope to the selected organization — taxonomies are org-specific.
    if (organizationId) params.append('organization_id', organizationId);
    const { data } = await api.get<PaginatedResponse<Taxonomy>>(`/taxonomies?${params}`);
    return data;
  },

  get: async (id: string) => {
    const { data } = await api.get<Taxonomy>(`/taxonomies/${id}`);
    return data;
  },

  create: async (taxonomy: Partial<Taxonomy>) => {
    const { data } = await api.post<Taxonomy>('/taxonomies', taxonomy);
    return data;
  },

  update: async (id: string, taxonomy: Partial<Taxonomy>) => {
    const { data } = await api.patch<Taxonomy>(`/taxonomies/${id}`, taxonomy);
    return data;
  },

  delete: async (id: string) => {
    await api.delete(`/taxonomies/${id}`);
  },

  getDatasets: async (id: string) => {
    const { data } = await api.get<{ id: string; name: string; campaign_id: string; mode: string; is_primary: boolean }[]>(`/taxonomies/${id}/datasets`);
    return data;
  },

  associateWithDataset: async (
    taxonomyId: string,
    datasetId: string,
    mode?: TaxonomyAnnotationMode,
    isPrimary?: boolean
  ) => {
    const params = new URLSearchParams();
    if (mode) params.append('mode', mode);
    if (isPrimary !== undefined) params.append('is_primary', isPrimary.toString());
    await api.post(`/taxonomies/${taxonomyId}/datasets/${datasetId}?${params}`);
  },

  removeFromDataset: async (taxonomyId: string, datasetId: string) => {
    await api.delete(`/taxonomies/${taxonomyId}/datasets/${datasetId}`);
  },

  // Get taxonomies for a dataset, optionally filtered by mode
  getForDataset: async (datasetId: string, annotationMode?: TaxonomyAnnotationMode, primaryOnly?: boolean) => {
    const params = new URLSearchParams();
    if (annotationMode) params.append('annotation_mode', annotationMode);
    if (primaryOnly) params.append('primary_only', 'true');
    const { data } = await api.get<Taxonomy[]>(`/taxonomies/by-dataset/${datasetId}?${params}`);
    return data;
  },

  // Get primary taxonomies for both modes
  getPrimaryForDataset: async (datasetId: string) => {
    const { data } = await api.get<DatasetTaxonomiesByMode>(`/taxonomies/by-dataset/${datasetId}/primary`);
    return data;
  },
};

// =============================================================================
// SCENES
// =============================================================================

export const sceneApi = {
  list: async (datasetId?: string, page = 1, pageSize = 20) => {
    const params = new URLSearchParams({
      page: page.toString(),
      page_size: pageSize.toString(),
    });
    if (datasetId) params.append('dataset_id', datasetId);
    const { data } = await api.get<Scene[]>(`/scenes/?${params}`);
    return data;
  },

  get: async (id: string) => {
    const { data } = await api.get<Scene>(`/scenes/${id}`);
    return data;
  },

  create: async (scene: Partial<Scene>) => {
    const { data } = await api.post<Scene>('/scenes', scene);
    return data;
  },

  update: async (id: string, scene: Partial<Scene>) => {
    const { data } = await api.patch<Scene>(`/scenes/${id}`, scene);
    return data;
  },

  updateSelectedTaxonomy: async (sceneId: string, taxonomyId: string | null) => {
    const { data } = await api.patch<Scene>(`/scenes/${sceneId}`, {
      selected_taxonomy_id: taxonomyId,
    });
    return data;
  },

  delete: async (id: string) => {
    await api.delete(`/scenes/${id}`);
  },

  getCalibration: async (id: string) => {
    const { data } = await api.get(`/scenes/${id}/calibration`);
    return data;
  },

  importAnnotations: async (
    sceneId: string,
    file: File,
    overwrite = false,
    syncTaxonomy = true,
    taskId?: string
  ) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('overwrite', overwrite.toString());
    formData.append('sync_taxonomy', syncTaxonomy.toString());
    if (taskId) formData.append('task_id', taskId);

    const { data } = await api.post<{
      success: boolean;
      imported_count: number;
      task_id: string;
      errors: string[];
      sensors_processed?: Record<string, number>;
      derived_classes?: string[];
    }>(`/import/scenes/${sceneId}/import-annotations`, formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    return data;
  },
};

// =============================================================================
// TASKS
// =============================================================================

export const taskApi = {
  list: async (filters?: {
    sceneId?: string;
    status?: string;
    assigneeId?: string;
    reviewerId?: string;
    myTasks?: boolean;
    organizationId?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams();
    if (filters?.sceneId) params.append('scene_id', filters.sceneId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.assigneeId) params.append('assignee_id', filters.assigneeId);
    if (filters?.reviewerId) params.append('reviewer_id', filters.reviewerId);
    if (filters?.myTasks) params.append('my_tasks', 'true');
    if (filters?.organizationId) params.append('organization_id', filters.organizationId);
    params.append('page', (filters?.page ?? 1).toString());
    params.append('page_size', (filters?.pageSize ?? 20).toString());

    const { data } = await api.get<Task[]>(`/tasks?${params}`);
    return data;
  },

  get: async (id: string) => {
    const { data } = await api.get<Task>(`/tasks/${id}`);
    return data;
  },

  stats: async (taskIds: string[], taxonomyId?: string): Promise<{ task_id: string; label_count: number; frames_visited: number; total_frames: number }[]> => {
    if (!taskIds.length) return [];
    const params = new URLSearchParams({ task_ids: taskIds.join(',') });
    if (taxonomyId) params.set('taxonomy_id', taxonomyId);
    const { data } = await api.get(`/tasks/stats?${params}`);
    return data;
  },

  create: async (task: Partial<Task> & { scene_id: string }) => {
    const { data } = await api.post<Task>('/tasks', task);
    return data;
  },

  update: async (id: string, task: Partial<Task>) => {
    const { data } = await api.patch<Task>(`/tasks/${id}`, task);
    return data;
  },

  delete: async (id: string) => {
    await api.delete(`/tasks/${id}`);
  },

  split: async (taskId: string, subTasks: { name: string; frame_start: number; frame_end: number }[]) => {
    const { data } = await api.post<Task[]>(`/tasks/${taskId}/split`, { sub_tasks: subTasks });
    return data;
  },

  assign: async (id: string, assigneeId: string) => {
    const { data } = await api.post<Task>(`/tasks/${id}/assign`, {
      assignee_id: assigneeId,
    });
    return data;
  },

  updateStatus: async (id: string, status: string, reviewNotes?: string) => {
    const { data } = await api.post<Task>(`/tasks/${id}/status`, {
      status,
      review_notes: reviewNotes,
    });
    return data;
  },

  updateStage: async (id: string, stage: string) => {
    const { data } = await api.patch<Task>(`/tasks/${id}`, {
      stage,
    });
    return data;
  },

  getFrames: async (id: string, includeContext = true) => {
    const { data } = await api.get<{
      task_id: string;
      frame_range: { start: number; end: number };
      context_buffer: { before: number; after: number };
      frames: Frame[];
    }>(`/tasks/${id}/frames?include_context=${includeContext}`);
    return data;
  },

  injectPredictions: async (
    id: string,
    predictions: {
      source: string;
      model_version: string;
      predictions: Array<{
        frame_index: number;
        track_id?: string;
        type: string;
        class_id: string;
        data: unknown;
        attributes?: Record<string, unknown>;
        confidence?: number;
      }>;
    }
  ) => {
    const { data } = await api.post<PredictionInjectionResponse>(
      `/tasks/${id}/inject-predictions`,
      predictions
    );
    return data;
  },

  /**
   * Get the next assigned task for the current user (for annotation workflow).
   * Returns the next task with status 'assigned' or 'in_progress', excluding the given taskId.
   */
  getNextAssignedTask: async (excludeTaskId?: string): Promise<Task | null> => {
    const params = new URLSearchParams();
    params.append('page', '1');
    params.append('page_size', '50');

    const { data } = await api.get<Task[]>(`/tasks?${params}`);

    // Filter for tasks that are available for annotation (assigned or in_progress)
    const availableTasks = data.filter(t =>
      t.id !== excludeTaskId &&
      (t.status === 'assigned' || t.status === 'in_progress') &&
      t.stage === 'annotation'
    );

    // Return the first available task (sorted by priority and creation date by backend)
    return availableTasks.length > 0 ? availableTasks[0] : null;
  },
};

// =============================================================================
// ANNOTATIONS
// =============================================================================

export const annotationApi = {
  list: async (filters?: {
    taskId?: string;
    frameId?: string;
    type?: string;
    classId?: string;
    source?: string;
    isVerified?: boolean;
    trackId?: string;
    taxonomyId?: string;
    page?: number;
    pageSize?: number;
  }) => {
    const params = new URLSearchParams();
    if (filters?.taskId) params.append('task_id', filters.taskId);
    if (filters?.frameId) params.append('frame_id', filters.frameId);
    if (filters?.type) params.append('type', filters.type);
    if (filters?.classId) params.append('class_id', filters.classId);
    if (filters?.source) params.append('source', filters.source);
    if (filters?.isVerified !== undefined) {
      params.append('is_verified', filters.isVerified.toString());
    }
    if (filters?.trackId) params.append('track_id', filters.trackId);
    if (filters?.taxonomyId) params.append('taxonomy_id', filters.taxonomyId);
    params.append('page', (filters?.page ?? 1).toString());
    params.append('page_size', (filters?.pageSize ?? 100).toString());

    const { data } = await api.get<Annotation[]>(`/annotations?${params}`);
    return data;
  },

  get: async (id: string) => {
    const { data } = await api.get<Annotation>(`/annotations/${id}`);
    return data;
  },

  create: async (annotation: Partial<Annotation>) => {
    const { data } = await api.post<Annotation>('/annotations', annotation);
    return data;
  },

  createBulk: async (annotations: Partial<Annotation>[]) => {
    // Group annotations by type to route to correct endpoint
    const cuboidAnnotations: typeof annotations = [];
    const box2DAnnotations: typeof annotations = [];
    const legacyAnnotations: typeof annotations = [];

    for (const ann of annotations) {
      if (ann.type === 'cuboid') {
        cuboidAnnotations.push(ann);
      } else if (ann.type === 'box2d' || ann.type === 'polygon' || ann.type === 'polyline' || ann.type === 'fusion_box2d' || ann.type === 'keypoints' || ann.type === 'segmentation_2d') {
        box2DAnnotations.push(ann);
      } else {
        legacyAnnotations.push(ann);
      }
    }

    const promises: Promise<any>[] = [];

    // Create 3D cuboid annotations via /annotations-3d/bulk
    if (cuboidAnnotations.length > 0) {
      const payload3D = cuboidAnnotations.map(ann => ({
        id: ann.id, // Preserve client-generated ID
        task_id: ann.task_id,
        frame_id: ann.frame_id,
        track_id: ann.track_id,
        type: ann.type,
        class_id: ann.class_id,
        taxonomy_id: ann.taxonomy_id,  // Include taxonomy_id for filtering
        data: ann.data,
        attributes: ann.attributes ?? {},
        source: ann.source ?? 'manual_3d',
      }));
      promises.push(api.post('/annotations-3d/bulk', { annotations: payload3D }));
    }

    // Create 2D annotations via /annotations-2d/bulk
    if (box2DAnnotations.length > 0) {
      const payload2D = box2DAnnotations.map(ann => ({
        id: ann.id,
        task_id: ann.task_id,
        frame_id: ann.frame_id,
        camera_id: (ann.data as any)?.camera_id || 'unknown', // Extract camera_id from data
        track_id: ann.track_id,
        type: ann.type,
        class_id: ann.class_id,
        taxonomy_id: ann.taxonomy_id,  // Include taxonomy_id for filtering
        data: ann.data,
        attributes: ann.attributes ?? {},
        source: ann.source ?? 'manual',
      }));
      promises.push(api.post('/annotations-2d/bulk', { annotations: payload2D }));
    }

    // Legacy annotations via /annotations/bulk (fallback for unknown types)
    if (legacyAnnotations.length > 0) {
      const payloadLegacy = legacyAnnotations.map(ann => ({
        task_id: ann.task_id,
        frame_id: ann.frame_id,
        track_id: ann.track_id,
        type: ann.type,
        class_id: ann.class_id,
        data: ann.data,
        attributes: ann.attributes ?? {},
        source: ann.source ?? 'manual',
      }));
      promises.push(api.post('/annotations/bulk', { annotations: payloadLegacy }));
    }

    // Execute all requests in parallel
    await Promise.all(promises);

    // Return a combined response
    return { success: true, created: annotations.length, updated: 0, deleted: 0, errors: [] };
  },

  update: async (id: string, annotation: Partial<Annotation>) => {
    // Only send fields that the AnnotationUpdate schema accepts
    const updatePayload = {
      track_id: annotation.track_id,
      class_id: annotation.class_id,
      data: annotation.data,
      attributes: annotation.attributes,
    };
    const { data } = await api.patch<Annotation>(`/annotations/${id}`, updatePayload);
    return data;
  },

  updateBulk: async (annotations: Array<{ id: string } & Partial<Annotation>>) => {
    // Group by type: box2d goes to /annotations-2d/bulk-update, others to legacy
    const box2DUpdates: Array<{ id: string } & Partial<Annotation>> = [];
    const legacyUpdates: Array<{ id: string } & Partial<Annotation>> = [];

    annotations.forEach(ann => {
      if (ann.type === 'box2d') {
        box2DUpdates.push(ann);
      } else {
        legacyUpdates.push(ann);
      }
    });

    const promises: Promise<any>[] = [];

    if (box2DUpdates.length > 0) {
      const payload = {
        annotations: box2DUpdates.map(ann => ({
          id: ann.id,
          track_id: ann.track_id,
          class_id: ann.class_id,
          data: ann.data,
          attributes: ann.attributes,
        }))
      };
      promises.push(api.post('/annotations-2d/bulk-update', payload));
    }

    if (legacyUpdates.length > 0) {
      // Legacy annotations don't have bulk update, fall back to individual updates
      promises.push(...legacyUpdates.map(ann => annotationApi.update(ann.id, ann)));
    }

    await Promise.all(promises);
  },

  delete: async (id: string) => {
    await api.delete(`/annotations/${id}`);
  },

  deleteBulk: async (annotation_ids: string[]) => {
    // For 2D annotations, use the bulk-delete endpoint
    if (annotation_ids.length > 0) {
      await api.post('/annotations-2d/bulk-delete', { annotation_ids });
    }
  },

  verify: async (id: string, isVerified = true, modifications?: Record<string, unknown>) => {
    const { data } = await api.post<Annotation>(`/annotations/${id}/verify`, {
      is_verified: isVerified,
      modifications,
    });
    return data;
  },

  getTrack: async (trackId: string) => {
    const { data } = await api.get<Annotation[]>(`/annotations/track/${trackId}`);
    return data;
  },
};

// =============================================================================
// FRAMES
// =============================================================================

export const frameApi = {
  list: async (sceneId: string, startIndex?: number, endIndex?: number) => {
    const params = new URLSearchParams({ scene_id: sceneId });
    if (startIndex !== undefined) params.append('start_index', startIndex.toString());
    if (endIndex !== undefined) params.append('end_index', endIndex.toString());

    const { data } = await api.get<Frame[]>(`/frames?${params}`);
    return data;
  },

  get: async (id: string) => {
    const { data } = await api.get<Frame>(`/frames/${id}`);
    return data;
  },
};

// =============================================================================
// IMPORT
// =============================================================================

export interface ImportRequest {
  dataset_id: string;
  root_path: string;
}

export interface RenamedScene {
  original_name: string;
  new_name: string;
  scene_id: string;
}

export interface ImportResponse {
  success: boolean;
  message: string;
  scenes_imported: number;
  frames_imported: number;
  errors: string[];
  renamed_scenes: RenamedScene[];
}

export interface ValidateResponse {
  valid: boolean;
  metadata_found: boolean;
  calibration_found: boolean;
  scenes: Array<{
    name: string;
    has_metadata: boolean;
    has_lidar: boolean;
    has_cameras: boolean;
    has_ego_poses: boolean;
    has_timestamps: boolean;
    frame_count: number;
    cameras: string[];
  }>;
  total_frames: number;
  sensors_detected: string[];
  warnings: string[];
  errors: string[];
}

export interface FolderItem {
  name: string;
  path: string;
  is_directory: boolean;
  size?: number;
}

export interface BrowseFolderResponse {
  current_path: string;
  parent_path?: string;
  items: FolderItem[];
}

export const importApi = {
  import: async (request: ImportRequest) => {
    const { data } = await api.post<ImportResponse>('/import/import', request);
    return data;
  },

  validate: async (rootPath: string) => {
    const { data } = await api.post<ValidateResponse>(`/import/validate?root_path=${encodeURIComponent(rootPath)}`);
    return data;
  },

  browse: async (path: string = '/') => {
    const { data } = await api.get<BrowseFolderResponse>(`/import/browse?path=${encodeURIComponent(path)}`);
    return data;
  },

  /**
   * Upload a video file and extract frames to create a scene.
   * @param datasetId Dataset ID to import into
   * @param file Video file (MP4, AVI, MOV, etc.)
   * @param options Optional extraction parameters
   * @param onProgress Progress callback (0-100)
   */
  uploadVideo: async (
    datasetId: string,
    file: File,
    options?: {
      extractionFps?: number;
      maxFrames?: number;
      imageFormat?: 'jpg' | 'png' | 'webp';
      preserveFolderNames?: boolean;
    },
    onProgress?: (progress: number, speed?: string) => void
  ): Promise<ImportResponse> => {
    return new Promise((resolve, reject) => {
      const formData = new FormData();
      formData.append('dataset_id', datasetId);
      formData.append('file', file);

      if (options?.extractionFps) {
        formData.append('extraction_fps', options.extractionFps.toString());
      }
      if (options?.maxFrames) {
        formData.append('max_frames', options.maxFrames.toString());
      }
      if (options?.imageFormat) {
        formData.append('image_format', options.imageFormat);
      }
      formData.append('preserve_folder_names', (options?.preserveFolderNames ?? true).toString());

      const xhr = new XMLHttpRequest();
      const startTime = Date.now();
      let lastLoaded = 0;
      let lastTime = startTime;

      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable && onProgress) {
          const percentComplete = (e.loaded / e.total) * 100;

          // Calculate upload speed
          const now = Date.now();
          const timeDiff = (now - lastTime) / 1000;
          const loadedDiff = e.loaded - lastLoaded;

          if (timeDiff > 0.5) {
            const speedMBps = (loadedDiff / (1024 * 1024)) / timeDiff;
            onProgress(percentComplete, `${speedMBps.toFixed(1)} MB/s`);
            lastLoaded = e.loaded;
            lastTime = now;
          } else {
            onProgress(percentComplete);
          }
        }
      });

      const token = localStorage.getItem('auth-storage')
        ? JSON.parse(localStorage.getItem('auth-storage') || '{}').state?.accessToken
        : '';

      xhr.open('POST', '/api/v1/import/upload-video');
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);

      xhr.onload = () => {
        if (xhr.status === 200) {
          try {
            const result = JSON.parse(xhr.responseText);
            resolve(result);
          } catch {
            reject(new Error('Failed to parse response'));
          }
        } else {
          try {
            const errorData = JSON.parse(xhr.responseText);
            reject(new Error(errorData.detail || `Upload failed with status ${xhr.status}`));
          } catch {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        }
      };

      xhr.onerror = () => {
        reject(new Error('Network error during upload'));
      };

      xhr.ontimeout = () => {
        reject(new Error('Upload timed out'));
      };

      // 1 hour timeout for large videos
      xhr.timeout = 3600000;
      xhr.send(formData);
    });
  },
};

// =============================================================================
// DATA (Sensor data files - LiDAR, images)
// =============================================================================

export interface PointCloudResponse {
  pointCount: number;
  positions: Float32Array;  // Flat array [x1, y1, z1, x2, y2, z2, ...]
  intensities: Float32Array;
  // Per-point RGB in [0,1], flat [r1,g1,b1,...]. Present only when the source
  // PCD carries an `rgb`/`rgba` packed field or separate r/g/b channels.
  colors?: Float32Array;
}

// Legacy interface for backward compatibility
export interface PointCloudResponseJSON {
  pointCount: number;
  positions: number[];
  intensities: number[];
}

export const dataApi = {
  /**
   * Get LiDAR point cloud data in optimized binary format.
   * Binary format is 3-4x smaller and faster to parse than JSON.
   * @param filePath Path relative to sample_data root (e.g., "scenes/scene_001/lidar/000000.pcd")
   */
  getLidarData: async (filePath: string): Promise<PointCloudResponse> => {
    const startTime = performance.now();
    const token = useAuthStore.getState().accessToken;
    const headers: Record<string, string> = {};
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    // Fetch binary format for better performance
    const fetchStart = performance.now();
    const response = await fetch(`/api/v1/data/lidar/${filePath}?format=binary`, {
      headers,
    });
    const fetchTime = performance.now() - fetchStart;

    if (!response.ok) {
      throw new Error(`Failed to fetch LiDAR data: ${response.statusText}`);
    }

    // Parse binary format (v3):
    //   [count u32][has_colors u32][positions f32*N*3][intensities f32*N]
    //   [colors f32*N*3 (if has_colors)]
    // has_colors is stored as uint32 (not uint8) so the following Float32
    // reads stay 4-byte aligned — Float32Array requires byteOffset % 4 === 0.
    const bufferStart = performance.now();
    const buffer = await response.arrayBuffer();
    const bufferTime = performance.now() - bufferStart;
    const dataView = new DataView(buffer);

    const parseStart = performance.now();
    const pointCount = dataView.getUint32(0, true); // little-endian
    const hasColors = dataView.getUint32(4, true) === 1;
    const positionsStart = 8;
    const positionsLength = pointCount * 3 * 4;
    const intensitiesStart = positionsStart + positionsLength;
    const intensitiesLength = pointCount * 4;
    const colorsStart = intensitiesStart + intensitiesLength;

    const positions = new Float32Array(buffer, positionsStart, pointCount * 3);
    const intensities = new Float32Array(buffer, intensitiesStart, pointCount);
    const colors = hasColors
      ? new Float32Array(buffer, colorsStart, pointCount * 3)
      : undefined;
    const parseTime = performance.now() - parseStart;

    const totalTime = performance.now() - startTime;
    const fileName = filePath.split('/').pop();
    console.log(`[LiDAR] ${fileName}: fetch=${fetchTime.toFixed(0)}ms, buffer=${bufferTime.toFixed(0)}ms, parse=${parseTime.toFixed(1)}ms, total=${totalTime.toFixed(0)}ms, size=${(buffer.byteLength/1024).toFixed(0)}KB, colors=${hasColors ? 'yes' : 'no'}`);

    return {
      pointCount,
      positions,
      intensities,
      colors,
    };
  },

  /**
   * Get LiDAR point cloud data as JSON (legacy, slower).
   * Use getLidarData() for better performance.
   */
  getLidarDataJSON: async (filePath: string): Promise<PointCloudResponseJSON> => {
    const { data } = await api.get<PointCloudResponseJSON>(`/data/lidar/${filePath}?format=json`);
    return data;
  },

  /**
   * Get image URL for a camera frame.
   * @param filePath Path relative to sample_data root
   * Includes auth token as query parameter for browser image loading.
   */
  getImageUrl: (filePath: string): string => {
    const token = useAuthStore.getState().accessToken;
    if (token) {
      return `/api/v1/data/image/${filePath}?token=${encodeURIComponent(token)}`;
    }
    return `/api/v1/data/image/${filePath}`;
  },
};

// =============================================================================
// USERS
// =============================================================================

export const userApi = {
  list: async () => {
    const { data } = await api.get<User[]>('/users?page_size=100');
    return data;
  },

  get: async (id: string) => {
    const { data } = await api.get<User>(`/users/${id}`);
    return data;
  },
};

// =============================================================================
// ORGANIZATIONS
// =============================================================================

export interface Organization {
  id: string;
  name: string;
  slug: string;
  description?: string;
  settings?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
}

export interface OrganizationMembership {
  id: string;
  organization_id: string;
  user_id: string;
  role: string;
  is_default: boolean;
  joined_at?: string;
}

export interface OrganizationWithMembership extends Organization {
  membership: OrganizationMembership;
}

export interface OrganizationCreateInput {
  name: string;
  slug: string;
  description?: string;
  settings?: Record<string, unknown>;
}

export const organizationApi = {
  getMyOrganizations: async (): Promise<OrganizationWithMembership[]> => {
    const { data } = await api.get<{ organizations: OrganizationWithMembership[] }>('/organizations/my');
    return data.organizations || [];
  },
  create: async (input: OrganizationCreateInput): Promise<Organization> => {
    const { data } = await api.post<Organization>('/organizations', input);
    return data;
  },
};

// =============================================================================
// 3D ANNOTATIONS
// =============================================================================

export interface Annotation3DData {
  id: string;
  task_id: string;
  frame_id: string;
  track_id?: string;
  type: string;
  class_id: string;
  data: {
    center: { x: number; y: number; z: number };
    dimensions: { length: number; width: number; height: number };
    rotation: { yaw: number; pitch: number; roll: number };
    confidence?: number;
  };
  attributes?: Record<string, unknown>;
  source?: string;
  is_migrated_to_fusion: boolean;
  is_keyframe?: boolean;  // True if user edited, false if auto-interpolated
  created_at: string;
  updated_at: string;
}

export interface Annotation3DCreate {
  task_id: string;
  frame_id: string;
  track_id?: string;
  type?: string;
  class_id: string;
  taxonomy_id?: string;  // Taxonomy this annotation belongs to
  data: {
    center: { x: number; y: number; z: number };
    dimensions: { length: number; width: number; height: number };
    rotation: { yaw: number; pitch: number; roll: number };
    confidence?: number;
  };
  attributes?: Record<string, unknown>;
  source?: string;
  is_keyframe?: boolean;  // True if user edited, false if auto-interpolated
}

export const annotation3DApi = {
  list: async (taskId: string, frameId?: string, trackId?: string, taxonomyId?: string) => {
    const params = new URLSearchParams({ task_id: taskId });
    if (frameId) params.append('frame_id', frameId);
    if (trackId) params.append('track_id', trackId);
    if (taxonomyId) params.append('taxonomy_id', taxonomyId);
    const { data } = await api.get<Annotation3DData[]>(`/annotations-3d?${params}`);
    return data;
  },

  summary: async (taskId: string, taxonomyId?: string) => {
    const params = new URLSearchParams({ task_id: taskId });
    if (taxonomyId) params.append('taxonomy_id', taxonomyId);
    const { data } = await api.get<{ id: string; track_id: string | null; frame_id: string; taxonomy_id: string | null }[]>(`/annotations-3d/summary?${params}`);
    return data;
  },

  get: async (id: string) => {
    const { data } = await api.get<Annotation3DData>(`/annotations-3d/${id}`);
    return data;
  },

  create: async (annotation: Annotation3DCreate) => {
    const { data } = await api.post<Annotation3DData>('/annotations-3d/', annotation);
    return data;
  },

  createBulk: async (annotations: Annotation3DCreate[]) => {
    const { data } = await api.post<Annotation3DData[]>('/annotations-3d/bulk', { annotations });
    return data;
  },

  update: async (id: string, updates: Partial<Annotation3DCreate>) => {
    const { data } = await api.put<Annotation3DData>(`/annotations-3d/${id}`, updates);
    return data;
  },

  updateBulk: async (annotations: Array<{ id: string } & Partial<Annotation3DCreate>>) => {
    const { data } = await api.post<Annotation3DData[]>('/annotations-3d/bulk-update', { annotations });
    return data;
  },

  delete: async (id: string) => {
    await api.delete(`/annotations-3d/${id}`);
  },

  deleteBulk: async (annotation_ids: string[]) => {
    const { data } = await api.post('/annotations-3d/bulk-delete', { annotation_ids });
    return data;
  },

  deleteByFrame: async (frameId: string, taskId: string) => {
    const params = new URLSearchParams({ task_id: taskId });
    const { data } = await api.delete<{ success_count: number; error_count: number; errors: any[] }>(`/annotations-3d/by-frame/${frameId}?${params}`);
    return data;
  },

  deleteByTrack: async (trackId: string) => {
    const { data } = await api.delete(`/annotations-3d/by-track/${trackId}`);
    return data;
  },

  updateByTrack: async (trackId: string, updates: {
    class_id?: string;
    attributes?: Record<string, unknown>;
    dimensions?: { length: number; width: number; height: number };
    is_static?: boolean;
  }) => {
    const { data } = await api.put(`/annotations-3d/by-track/${trackId}`, updates);
    return data as { success_count: number; error_count: number; errors: Array<{ error: string }> };
  },
};

// =============================================================================
// 4D ANNOTATIONS
// =============================================================================

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface Rotation3D {
  yaw: number;
  pitch: number;
  roll: number;
}

export interface Dimensions3D {
  length: number;
  width: number;
  height: number;
}

export interface CuboidWorldData {
  center: Point3D;
  dimensions: Dimensions3D;
  rotation: Rotation3D;
  origin_frame_id?: string;
  origin_ego_pose?: Record<string, unknown>;
}

export interface FrameCuboidData {
  center: Point3D;
  rotation: Rotation3D;
  is_keyframe: boolean;
}

export interface Annotation4D {
  id: string;
  task_id: string;
  track_id: string;
  type: string;
  class_id: string;
  world_data: CuboidWorldData;
  frame_data: Record<string, FrameCuboidData>;  // frame_id -> lidar coords
  frame_ids: string[];
  is_static: boolean;
  attributes: Record<string, unknown>;
  source: string;
  is_migrated: boolean;
  migrated_at?: string;
  created_at: string;
  updated_at: string;
}

export interface Annotation4DCreate {
  id?: string;  // Client-generated UUID; backend will use it as-is
  task_id: string;
  track_id: string;
  type?: string;
  class_id: string;
  world_data: CuboidWorldData;
  frame_data: Record<string, FrameCuboidData>;
  frame_ids: string[];
  is_static?: boolean;
  attributes?: Record<string, unknown>;
  source?: string;
}

export interface Annotation4DMigrateResponse {
  migrated_count: number;
  created_annotations: string[];
  errors: Array<{ annotation_4d_id?: string; frame_id?: string; error: string }>;
}

export interface Migrate4DTo3DResponse {
  migrated_count: number;
  created_annotation_ids: string[];
  track_id_mapping: Record<string, string>;
  errors: Array<{ annotation_4d_id?: string; frame_id?: string; error: string }>;
}

export const annotation4DApi = {
  list: async (taskId: string, isMigrated?: boolean) => {
    const params = new URLSearchParams({ task_id: taskId });
    if (isMigrated !== undefined) {
      params.append('is_migrated', isMigrated.toString());
    }
    // Add cache-busting parameter to ensure fresh data is fetched
    params.append('_t', Date.now().toString());
    const { data } = await api.get<Annotation4D[]>(`/annotations-4d?${params}`, {
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
      }
    });
    return data;
  },

  get: async (id: string) => {
    const { data } = await api.get<Annotation4D>(`/annotations-4d/${id}`);
    return data;
  },

  create: async (annotation: Annotation4DCreate) => {
    const { data } = await api.post<Annotation4D>('/annotations-4d/', annotation);
    return data;
  },

  createBulk: async (annotations: Annotation4DCreate[]) => {
    const { data } = await api.post<Annotation4D[]>('/annotations-4d/bulk', annotations);
    return data;
  },

  update: async (id: string, updates: Partial<Annotation4DCreate>) => {
    const { data } = await api.put<Annotation4D>(`/annotations-4d/${id}`, updates);
    return data;
  },

  updateBulk: async (annotations: Array<{ id: string } & Partial<Annotation4DCreate>>) => {
    const payload = {
      annotations: annotations.map(ann => ({
        id: ann.id,
        world_data: ann.world_data,
        frame_data: ann.frame_data,
        frame_ids: ann.frame_ids,
        attributes: ann.attributes,
        class_id: ann.class_id,
      }))
    };
    const { data } = await api.post<Annotation4D[]>('/annotations-4d/bulk-update', payload);
    return data;
  },

  delete: async (id: string) => {
    await api.delete(`/annotations-4d/${id}`);
  },

  deleteBulk: async (annotation_ids: string[]) => {
    if (annotation_ids.length > 0) {
      console.log(`[annotation4DApi] Sending bulk delete request for ${annotation_ids.length} annotations:`, annotation_ids.slice(0, 3));
      try {
        const response = await api.post('/annotations-4d/bulk-delete', { annotation_ids });
        console.log('[annotation4DApi] Bulk delete response:', response.data);
        return response.data;
      } catch (error) {
        console.error('[annotation4DApi] Bulk delete failed:', error);
        throw error;
      }
    }
  },

  /**
   * Migrate 4D annotations to the Annotation3D table.
   * Creates one Annotation3D per frame using the lidar coordinates from frame_data.
   */
  migrate: async (taskId: string, annotation4dIds?: string[]) => {
    const { data } = await api.post<Migrate4DTo3DResponse>(
      `/annotations-4d/migrate-to-3d?task_id=${taskId}`,
      { annotation_4d_ids: annotation4dIds }
    );
    return data;
  },

  /**
   * [LEGACY] Migrate 4D annotations to legacy Annotation table.
   * @deprecated Use migrate() instead which writes to Annotation3D table.
   */
  migrateLegacy: async (taskId: string, annotation4dIds?: string[]) => {
    const { data } = await api.post<Annotation4DMigrateResponse>(
      `/annotations-4d/migrate?task_id=${taskId}`,
      { annotation_4d_ids: annotation4dIds }
    );
    return data;
  },

  getByTrack: async (trackId: string) => {
    const { data } = await api.get<Annotation4D[]>(`/annotations-4d/by-track/${trackId}`);
    return data;
  },
};

// =============================================================================
// 2D ANNOTATIONS
// =============================================================================

export interface Annotation2DData {
  id: string;
  task_id: string;
  frame_id: string;
  camera_id: string;
  track_id?: string;
  type: string;
  class_id: string;
  data: Record<string, unknown>;
  attributes: Record<string, unknown>;
  source: string;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface Annotation2DCreate {
  id?: string;
  task_id: string;
  frame_id: string;
  camera_id: string;
  track_id?: string;
  taxonomy_id?: string;
  type: string;
  class_id: string;
  data: Record<string, unknown>;
  attributes?: Record<string, unknown>;
  source?: string;
}

export const annotation2DApi = {
  list: async (taskId: string, frameId?: string, cameraId?: string, trackId?: string, taxonomyId?: string) => {
    const params = new URLSearchParams({ task_id: taskId });
    if (frameId) params.append('frame_id', frameId);
    if (cameraId) params.append('camera_id', cameraId);
    if (trackId) params.append('track_id', trackId);
    if (taxonomyId) params.append('taxonomy_id', taxonomyId);
    const { data } = await api.get<Annotation2DData[]>(`/annotations-2d?${params}`);
    return data;
  },

  get: async (id: string) => {
    const { data } = await api.get<Annotation2DData>(`/annotations-2d/${id}`);
    return data;
  },

  create: async (annotation: Annotation2DCreate) => {
    const { data } = await api.post<Annotation2DData>('/annotations-2d/', annotation);
    return data;
  },

  createBulk: async (annotations: Annotation2DCreate[]) => {
    const { data } = await api.post<Annotation2DData[]>('/annotations-2d/bulk', { annotations });
    return data;
  },

  update: async (id: string, updates: Partial<Annotation2DCreate>) => {
    const { data } = await api.put<Annotation2DData>(`/annotations-2d/${id}`, updates);
    return data;
  },

  // Update many 2D annotations in ONE request. Use this instead of looping
  // `update()` — a burst of per-annotation requests trips the nginx rate limit
  // (30 r/s, burst 50) and returns 503, silently dropping the writes.
  updateBulk: async (annotations: Array<{ id: string } & Partial<Annotation2DCreate>>) => {
    if (annotations.length === 0) return [];
    const { data } = await api.post<Annotation2DData[]>('/annotations-2d/bulk-update', { annotations });
    return data;
  },

  delete: async (id: string) => {
    await api.delete(`/annotations-2d/${id}`);
  },

  deleteByTask: async (taskId: string) => {
    const { data } = await api.delete<{ deleted_count: number; task_id: string }>(`/annotations-2d/by-task/${taskId}`);
    return data;
  },

  deleteByFrame: async (frameId: string, taskId: string, cameraId?: string) => {
    const params = new URLSearchParams({ task_id: taskId });
    if (cameraId) params.append('camera_id', cameraId);
    const { data } = await api.delete<{ deleted_count: number; frame_id: string; camera_id?: string }>(`/annotations-2d/by-frame/${frameId}?${params}`);
    return data;
  },

  getByTrack: async (trackId: string) => {
    const { data } = await api.get<Annotation2DData[]>(`/annotations-2d/by-track/${trackId}`);
    return data;
  },

  updateByTrack: async (trackId: string, updates: {
    class_id?: string;
    attributes?: Record<string, unknown>;
  }) => {
    const { data } = await api.put(`/annotations-2d/by-track/${trackId}`, updates);
    return data as { success_count: number; error_count: number; errors: Array<{ error: string }> };
  },
};

// =============================================================================
// 2D TRACKS
// =============================================================================

export interface Track2DData {
  id: string;
  task_id: string;
  camera_id: string;
  class_id: string;
  name?: string;
  color?: string;
  start_frame_index?: number;
  end_frame_index?: number;
  is_interpolated: boolean;
  is_complete: boolean;
  attributes: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Track2DCreate {
  id?: string;
  task_id: string;
  camera_id: string;
  class_id: string;
  name?: string;
  color?: string;
  start_frame_index?: number;
  end_frame_index?: number;
  is_interpolated?: boolean;
  is_complete?: boolean;
  attributes?: Record<string, unknown>;
}

export const track2DApi = {
  list: async (taskId: string, cameraId?: string, classId?: string) => {
    const params = new URLSearchParams({ task_id: taskId });
    if (cameraId) params.append('camera_id', cameraId);
    if (classId) params.append('class_id', classId);
    const { data } = await api.get<Track2DData[]>(`/tracks-2d?${params}`);
    return data;
  },

  get: async (id: string) => {
    const { data } = await api.get<Track2DData>(`/tracks-2d/${id}`);
    return data;
  },

  create: async (track: Track2DCreate) => {
    const { data } = await api.post<Track2DData>('/tracks-2d', track);
    return data;
  },

  createBulk: async (tracks: Track2DCreate[]) => {
    const { data } = await api.post<Track2DData[]>('/tracks-2d/bulk', { tracks });
    return data;
  },

  update: async (id: string, updates: Partial<Track2DCreate>) => {
    const { data } = await api.put<Track2DData>(`/tracks-2d/${id}`, updates);
    return data;
  },

  delete: async (id: string) => {
    await api.delete(`/tracks-2d/${id}`);
  },

  getAnnotations: async (trackId: string) => {
    const { data } = await api.get<Annotation2DData[]>(`/tracks-2d/${trackId}/annotations`);
    return data;
  },

  assignAnnotations: async (trackId: string, annotationIds: string[]) => {
    const { data } = await api.post(`/tracks-2d/${trackId}/assign-annotations`, annotationIds);
    return data;
  },

  merge: async (targetTrackId: string, sourceTrackIds: string[]) => {
    const { data } = await api.post<Track2DData>(`/tracks-2d/${targetTrackId}/merge`, sourceTrackIds);
    return data;
  },
};

// =============================================================================
// AI Segment API
// =============================================================================

export interface AISegmentPointPrompt {
  x: number;
  y: number;
  label: 0 | 1;  // 0 = negative (background), 1 = positive (foreground)
}

export interface AISegmentBoxPrompt {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface AISegmentRequest {
  image_url?: string;
  image_base64?: string;
  points: AISegmentPointPrompt[];
  box?: AISegmentBoxPrompt;
  embedding_key?: string;
  /** Polygon simplification tolerance (0.001=fine/many points, 0.1=coarse/few points). Default: 0.01 */
  simplify_tolerance?: number;
}

export interface AISegmentPolygonPoint {
  x: number;
  y: number;
}

export interface AISegmentResult {
  polygon: AISegmentPolygonPoint[];
  score: number;
  area: number;
}

export interface AISegmentResponse {
  masks: AISegmentResult[];
  embedding_key: string | null;
  inference_time_ms: number;
}

export interface AISegmentEmbeddingResponse {
  embedding_key: string;
  compute_time_ms: number;
}

export interface AISegmentStatus {
  mode: string;
  service_type: string;
  model_size: string;
  device: string;
  ready: boolean;
}

export const aiSegmentApi = {
  /**
   * Run AI segmentation with point/box prompts.
   * Returns polygon masks for the segmented regions.
   */
  segment: async (request: AISegmentRequest): Promise<AISegmentResponse> => {
    const { data } = await api.post<AISegmentResponse>('/sam2/segment', request);
    return data;
  },

  /**
   * Batch AI segmentation for multiple images/prompts in parallel.
   * Much faster than calling segment() multiple times sequentially.
   * Reduces overhead from N requests to 1 request.
   */
  segmentBatch: async (requests: AISegmentRequest[]): Promise<AISegmentResponse[]> => {
    const { data } = await api.post<AISegmentResponse[]>('/sam2/segment/batch', requests, {
      timeout: 60000, // 1 minute timeout for batch processing
    });
    return data;
  },

  /**
   * Precompute image embedding for faster follow-up requests.
   * Call this when user opens an image for annotation.
   */
  computeEmbedding: async (imageUrl?: string, imageBase64?: string): Promise<AISegmentEmbeddingResponse> => {
    const { data } = await api.post<AISegmentEmbeddingResponse>('/sam2/embedding', {
      image_url: imageUrl,
      image_base64: imageBase64,
    });
    return data;
  },

  /**
   * Get AI Segment service status.
   */
  getStatus: async (): Promise<AISegmentStatus> => {
    const { data } = await api.get<AISegmentStatus>('/sam2/status');
    return data;
  },

  /**
   * Propagate object tracking across video frames using AI.
   * Takes initial bounding boxes and propagates them to subsequent frames.
   */
  propagateVideo: async (request: AISegmentVideoPropagateRequest): Promise<AISegmentVideoPropagateResponse> => {
    const { data } = await api.post<AISegmentVideoPropagateResponse>('/sam2/video/propagate', request, {
      timeout: 300000, // 5 minute timeout for video processing
    });
    return data;
  },
};

// AI Segment Video Propagation Types
export interface AISegmentObjectInit {
  object_id: number;
  box: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  frame_index: number;
  /** Optional polygon for precise mask initialization (preserves shape details like mirrors) */
  polygon?: Array<{ x: number; y: number }>;
}

export interface AISegmentVideoFrame {
  frame_index: number;
  image_base64?: string;
  image_url?: string;
}

export interface AISegmentVideoPropagateRequest {
  frames: AISegmentVideoFrame[];
  objects: AISegmentObjectInit[];
  min_confidence?: number;
}

export interface AISegmentPropagatedBox {
  object_id: number;
  frame_index: number;
  box: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  confidence: number;
  status: 'tracked' | 'lost' | 'keyframe';
  polygon?: { x: number; y: number }[];  // Precise polygon shape from SAM2
}

export interface AISegmentVideoPropagateResponse {
  boxes: AISegmentPropagatedBox[];
  total_frames: number;
  tracked_frames: number;
  lost_at_frame: number | null;
  processing_time_ms: number;
}

// Legacy aliases for backward compatibility
export type SAM2PointPrompt = AISegmentPointPrompt;
export type SAM2BoxPrompt = AISegmentBoxPrompt;
export type SAM2SegmentRequest = AISegmentRequest;
export type SAM2PolygonPoint = AISegmentPolygonPoint;
export type SAM2SegmentResult = AISegmentResult;
export type SAM2SegmentResponse = AISegmentResponse;
export type SAM2EmbeddingResponse = AISegmentEmbeddingResponse;
export type SAM2Status = AISegmentStatus;
export type SAM2ObjectInit = AISegmentObjectInit;
export type SAM2VideoFrame = AISegmentVideoFrame;
export type SAM2VideoPropagateRequest = AISegmentVideoPropagateRequest;
export type SAM2PropagatedBox = AISegmentPropagatedBox;
export type SAM2VideoPropagateResponse = AISegmentVideoPropagateResponse;
export const sam2Api = aiSegmentApi;

// =============================================================================
// QA REVIEW API
// =============================================================================

import type {
  QAReview,
  AnnotationReview,
  AnnotationComment,
  QASuggestion,
  QATaskStats,
  QAReviewMode,
  ReviewVerdict,
  GenerateSuggestionsResponse,
  SuggestionType,
} from '@/types';

export const qaApi = {
  // QA Review Sessions
  startReview: async (taskId: string, mode: QAReviewMode = 'view_only', reviewStage?: string) => {
    const { data } = await api.post<QAReview>('/qa/reviews', {
      task_id: taskId,
      mode,
      review_stage: reviewStage,
    });
    return data;
  },

  getReview: async (reviewId: string) => {
    const { data } = await api.get<QAReview>(`/qa/reviews/${reviewId}`);
    return data;
  },

  getTaskReviews: async (taskId: string, status?: string) => {
    const params = status ? `?status=${status}` : '';
    const { data } = await api.get<QAReview[]>(`/qa/tasks/${taskId}/reviews${params}`);
    return data;
  },

  getActiveReview: async (taskId: string, reviewStage?: string) => {
    const params = reviewStage ? `?review_stage=${reviewStage}` : '';
    const { data } = await api.get<QAReview | null>(`/qa/tasks/${taskId}/active-review${params}`);
    return data;
  },

  updateReview: async (reviewId: string, updates: { status?: string; mode?: QAReviewMode }) => {
    const { data } = await api.patch<QAReview>(`/qa/reviews/${reviewId}`, updates);
    return data;
  },

  completeReview: async (reviewId: string, notes?: string) => {
    const { data } = await api.post<QAReview>(`/qa/reviews/${reviewId}/complete`, {
      final_verdict: 'completed',
      notes,
    });
    return data;
  },

  pauseReview: async (reviewId: string) => {
    const { data } = await api.post<QAReview>(`/qa/reviews/${reviewId}/pause`);
    return data;
  },

  resumeReview: async (reviewId: string) => {
    const { data } = await api.post<QAReview>(`/qa/reviews/${reviewId}/resume`);
    return data;
  },

  // Annotation Reviews
  reviewAnnotation: async (
    reviewId: string,
    annotationId: string,
    verdict: ReviewVerdict,
    issueTypes?: string[],
    notes?: string,
    annotationTable: string = 'annotations',
    frameId?: string,
    classId?: string,
    location?: { x: number; y: number; z: number }
  ) => {
    const { data } = await api.post<AnnotationReview>(`/qa/reviews/${reviewId}/annotations`, {
      annotation_id: annotationId,
      annotation_table: annotationTable,
      verdict,
      issue_types: issueTypes,
      notes,
      frame_id: frameId,
      class_id: classId,
      location_x: location?.x,
      location_y: location?.y,
      location_z: location?.z,
    });
    return data;
  },

  bulkReviewAnnotations: async (
    reviewId: string,
    reviews: Array<{
      annotation_id: string;
      annotation_table?: string;
      verdict: ReviewVerdict;
      issue_types?: string[];
      notes?: string;
    }>
  ) => {
    const { data } = await api.post(`/qa/reviews/${reviewId}/annotations/bulk`, {
      reviews,
    });
    return data;
  },

  getAnnotationReviews: async (reviewId: string, verdict?: ReviewVerdict) => {
    const params = verdict ? `?verdict=${verdict}` : '';
    const { data } = await api.get<AnnotationReview[]>(`/qa/reviews/${reviewId}/annotations${params}`);
    return data;
  },

  getAnnotationReviewStatus: async (annotationId: string, qaReviewId: string) => {
    const { data } = await api.get<AnnotationReview | null>(
      `/qa/annotations/${annotationId}/review?qa_review_id=${qaReviewId}`
    );
    return data;
  },

  /**
   * Annotator marks a spatial issue as fixed during a revision round.
   * One-way: cannot be unmarked via this endpoint. Returns the updated
   * review with annotator_resolved=true so the caller can patch local state.
   */
  resolveAnnotationReview: async (reviewId: string) => {
    const { data } = await api.post<AnnotationReview>(
      `/qa/annotation-reviews/${reviewId}/resolve`,
    );
    return data;
  },

  // Comments
  createComment: async (
    annotationId: string,
    content: string,
    parentId?: string,
    annotationTable: string = 'annotations'
  ) => {
    const { data } = await api.post<AnnotationComment>('/qa/comments', {
      annotation_id: annotationId,
      annotation_table: annotationTable,
      content,
      parent_id: parentId,
    });
    return data;
  },

  getAnnotationComments: async (annotationId: string, includeResolved: boolean = false) => {
    const { data } = await api.get<AnnotationComment[]>(
      `/qa/annotations/${annotationId}/comments?include_resolved=${includeResolved}`
    );
    return data;
  },

  updateComment: async (commentId: string, content: string) => {
    const { data } = await api.patch<AnnotationComment>(`/qa/comments/${commentId}`, {
      content,
    });
    return data;
  },

  deleteComment: async (commentId: string) => {
    await api.delete(`/qa/comments/${commentId}`);
  },

  resolveComment: async (commentId: string, isResolved: boolean = true) => {
    const { data } = await api.post<AnnotationComment>(`/qa/comments/${commentId}/resolve`, {
      is_resolved: isResolved,
    });
    return data;
  },

  // Suggestions
  getTaskSuggestions: async (
    taskId: string,
    options?: {
      includeDismissed?: boolean;
      severity?: string;
      suggestionType?: string;
    }
  ) => {
    const params = new URLSearchParams();
    if (options?.includeDismissed) params.append('include_dismissed', 'true');
    if (options?.severity) params.append('severity', options.severity);
    if (options?.suggestionType) params.append('suggestion_type', options.suggestionType);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const { data } = await api.get<QASuggestion[]>(`/qa/tasks/${taskId}/suggestions${queryString}`);
    return data;
  },

  generateSuggestions: async (taskId: string, regenerate: boolean = false, checkTypes?: SuggestionType[]) => {
    const { data } = await api.post<GenerateSuggestionsResponse>('/qa/suggestions/generate', {
      task_id: taskId,
      regenerate,
      check_types: checkTypes,
    });
    return data;
  },

  generate2DSuggestions: async (taskId: string, regenerate: boolean = false) => {
    const { data } = await api.post<GenerateSuggestionsResponse>('/qa/suggestions/generate-2d', {
      task_id: taskId,
      regenerate,
    });
    return data;
  },

  createManualSuggestion: async (params: {
    taskId: string;
    frameId: string;
    message: string;
    suggestionType?: SuggestionType;
    severity?: 'low' | 'medium' | 'high' | 'critical';
    location?: { x: number; y: number; z: number };
    suggestedClass?: string;
    details?: Record<string, unknown>;
  }) => {
    const { data } = await api.post<QASuggestion>('/qa/suggestions/manual', {
      task_id: params.taskId,
      frame_id: params.frameId,
      suggestion_type: params.suggestionType || 'false_negative',
      severity: params.severity || 'high',
      message: params.message,
      location: params.location,
      suggested_class: params.suggestedClass,
      details: params.details,
    });
    return data;
  },

  dismissSuggestion: async (suggestionId: string, reason?: string) => {
    const { data } = await api.post<QASuggestion>(`/qa/suggestions/${suggestionId}/dismiss`, {
      reason,
    });
    return data;
  },

  deleteSuggestion: async (suggestionId: string) => {
    await api.delete(`/qa/suggestions/${suggestionId}`);
  },

  // Statistics
  getTaskStats: async (taskId: string) => {
    const { data } = await api.get<QATaskStats>(`/qa/tasks/${taskId}/stats`);
    return data;
  },
};

// =============================================================================
// WORKFLOW API
// =============================================================================

export interface TaskWorkflowInfo {
  task_id: string;
  taxonomy_id?: string;  // Present when returning per-taxonomy status
  stage: string;
  status: string;
  assignee_id: string | null;
  reviewer_id: string | null;
  customer_reviewer_id: string | null;
  skip_customer_qa: boolean;
  revision_count: number;
  available_transitions: string[];
}

export interface TaxonomyStatusInfo {
  taxonomy_id: string;
  taxonomy_name: string;
  stage: string;
  status: string;
  revision_count: number;
}

export interface TaskWorkflowInfoWithTaxonomies extends TaskWorkflowInfo {
  taxonomy_statuses: TaxonomyStatusInfo[];
}

export interface TaskStageHistoryItem {
  id: string;
  from_stage: string;
  from_status: string;
  to_stage: string;
  to_status: string;
  changed_by_id: string | null;
  reason: string | null;
  created_at: string;
}

export interface TaskAssignmentHistoryItem {
  id: string;
  action: string;
  user_id: string | null;
  user_name: string | null;
  role: string;
  stage: string;
  changed_by_id: string | null;
  changed_by_name: string | null;
  reason: string | null;
  created_at: string;
}

export const workflowApi = {
  /**
   * Get current workflow state and available transitions for a task
   * If taxonomyId provided, returns per-taxonomy status
   */
  getInfo: async (taskId: string, taxonomyId?: string): Promise<TaskWorkflowInfo> => {
    const params = taxonomyId ? `?taxonomy_id=${taxonomyId}` : '';
    const { data } = await api.get<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/info${params}`);
    return data;
  },

  /**
   * Sync a taxonomy's workflow status to match the global task status.
   * Useful when a taxonomy's status is out of sync with the task.
   */
  syncTaxonomyStatus: async (taskId: string, taxonomyId: string): Promise<TaskWorkflowInfo> => {
    const { data } = await api.post<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/sync-taxonomy-status?taxonomy_id=${taxonomyId}`);
    return data;
  },

  /**
   * Get workflow state for all taxonomies for a task
   */
  getTaxonomyStatuses: async (taskId: string): Promise<TaskWorkflowInfoWithTaxonomies> => {
    const { data } = await api.get<TaskWorkflowInfoWithTaxonomies>(`/workflow/tasks/${taskId}/taxonomy-statuses`);
    return data;
  },

  /**
   * Get stage transition history for a task
   */
  getHistory: async (taskId: string): Promise<TaskStageHistoryItem[]> => {
    const { data } = await api.get<TaskStageHistoryItem[]>(`/workflow/tasks/${taskId}/history`);
    return data;
  },

  /**
   * Get assignment change history for a task
   */
  getAssignmentHistory: async (taskId: string): Promise<TaskAssignmentHistoryItem[]> => {
    const { data } = await api.get<TaskAssignmentHistoryItem[]>(`/workflow/tasks/${taskId}/assignment-history`);
    return data;
  },

  /**
   * Transition task to a new status
   */
  transitionStatus: async (taskId: string, status: string, reason?: string): Promise<TaskWorkflowInfo> => {
    const { data } = await api.post<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/transition`, {
      status,
      reason,
    });
    return data;
  },

  /**
   * Assign task to an annotator
   */
  assignTask: async (taskId: string, userId: string, taxonomyId?: string): Promise<TaskWorkflowInfo> => {
    const { data } = await api.post<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/assign`, {
      user_id: userId,
      ...(taxonomyId ? { taxonomy_id: taxonomyId } : {}),
    });
    return data;
  },

  /**
   * Assign a QA reviewer
   */
  assignReviewer: async (taskId: string, userId: string): Promise<TaskWorkflowInfo> => {
    const { data } = await api.post<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/assign-reviewer`, {
      user_id: userId,
    });
    return data;
  },

  /**
   * Assign a customer reviewer
   */
  assignCustomerReviewer: async (taskId: string, userId: string): Promise<TaskWorkflowInfo> => {
    const { data } = await api.post<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/assign-customer-reviewer`, {
      user_id: userId,
    });
    return data;
  },

  /**
   * Start working on a task (pending → in_progress)
   * If taxonomyId provided, only starts that taxonomy's status
   */
  startWork: async (taskId: string, taxonomyId?: string): Promise<TaskWorkflowInfo> => {
    const params = taxonomyId ? `?taxonomy_id=${taxonomyId}` : '';
    const { data } = await api.post<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/start${params}`);
    return data;
  },

  /**
   * Submit annotation work for QA (annotation in_progress → submitted → QA pending)
   * If taxonomyId provided, only submits that taxonomy's status
   */
  submitAnnotation: async (taskId: string, taxonomyId?: string): Promise<TaskWorkflowInfo> => {
    const params = taxonomyId ? `?taxonomy_id=${taxonomyId}` : '';
    const { data } = await api.post<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/submit${params}`);
    return data;
  },

  /**
   * Submit fixes for QA re-review (annotation in_progress → submitted → QA pending)
   * Only allowed for tasks in revision mode (revision_count > 0)
   * If taxonomyId provided, only submits that taxonomy's status
   */
  submitFixes: async (taskId: string, taxonomyId?: string): Promise<TaskWorkflowInfo> => {
    const params = taxonomyId ? `?taxonomy_id=${taxonomyId}` : '';
    const { data } = await api.post<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/submit-fixes${params}`);
    return data;
  },

  /**
   * Complete QA review (accept or reject)
   * If taxonomyId provided, only reviews that taxonomy's status
   */
  completeQAReview: async (taskId: string, accepted: boolean, reason?: string, taxonomyId?: string): Promise<TaskWorkflowInfo> => {
    const params = taxonomyId ? `?taxonomy_id=${taxonomyId}` : '';
    const { data } = await api.post<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/complete-qa${params}`, {
      accepted,
      reason,
    });
    return data;
  },

  /**
   * Complete Customer QA review (accept or reject)
   * If taxonomyId provided, only reviews that taxonomy's status
   */
  completeCustomerReview: async (taskId: string, accepted: boolean, reason?: string, taxonomyId?: string): Promise<TaskWorkflowInfo> => {
    const params = taxonomyId ? `?taxonomy_id=${taxonomyId}` : '';
    const { data } = await api.post<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/complete-customer-qa${params}`, {
      accepted,
      reason,
    });
    return data;
  },

  /**
   * Toggle skip_customer_qa flag
   */
  setSkipCustomerQA: async (taskId: string, skip: boolean): Promise<TaskWorkflowInfo> => {
    const { data } = await api.patch<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/skip-customer-qa`, {
      skip,
    });
    return data;
  },

  /**
   * Unassign task (remove annotator, revert to pending)
   */
  unassignTask: async (taskId: string, taxonomyId?: string): Promise<TaskWorkflowInfo> => {
    const { data } = await api.post<TaskWorkflowInfo>(
      `/workflow/tasks/${taskId}/unassign`,
      taxonomyId ? { taxonomy_id: taxonomyId } : undefined
    );
    return data;
  },

  /**
   * Unassign QA reviewer
   */
  unassignReviewer: async (taskId: string): Promise<TaskWorkflowInfo> => {
    const { data } = await api.post<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/unassign-reviewer`);
    return data;
  },

  /**
   * Notify backend that editor was opened (triggers auto-transitions)
   */
  onEditorOpen: async (taskId: string): Promise<TaskWorkflowInfo> => {
    const { data } = await api.post<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/editor-open`);
    return data;
  },

  /**
   * Skip QA stage and move directly to Customer QA or Accepted
   */
  skipQAStage: async (taskId: string): Promise<TaskWorkflowInfo> => {
    const { data } = await api.post<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/skip-qa`);
    return data;
  },

  /**
   * Bulk assign multiple tasks to a user
   */
  bulkAssignTasks: async (taskIds: string[], userId: string): Promise<BulkOperationResult> => {
    const { data } = await api.post<BulkOperationResult>(`/workflow/tasks/bulk-assign`, {
      task_ids: taskIds,
      user_id: userId,
    });
    return data;
  },

  /**
   * Bulk submit multiple tasks for QA
   */
  bulkSubmitTasks: async (taskIds: string[]): Promise<BulkOperationResult> => {
    const { data } = await api.post<BulkOperationResult>(`/workflow/tasks/bulk-submit`, {
      task_ids: taskIds,
    });
    return data;
  },

  /**
   * Bulk assign QA reviewer to multiple tasks
   */
  bulkAssignReviewer: async (taskIds: string[], userId: string): Promise<BulkOperationResult> => {
    const { data } = await api.post<BulkOperationResult>(`/workflow/tasks/bulk-assign-reviewer`, {
      task_ids: taskIds,
      user_id: userId,
    });
    return data;
  },

  /**
   * Set stage for a task (admin override)
   * If taxonomyId is provided, sets stage for that specific taxonomy.
   * Otherwise, sets the global task stage.
   * If resetRevisionCount is true, also resets revision_count to 0.
   */
  setStage: async (taskId: string, stage: string, taxonomyId?: string, resetRevisionCount?: boolean): Promise<TaskWorkflowInfo> => {
    const params = taxonomyId ? `?taxonomy_id=${taxonomyId}` : '';
    const { data } = await api.post<TaskWorkflowInfo>(`/workflow/tasks/${taskId}/set-stage${params}`, {
      stage,
      reset_revision_count: resetRevisionCount ?? false,
    });
    return data;
  },
};

// Bulk operation result type
export interface BulkOperationResult {
  success_count: number;
  failed_count: number;
  tasks: TaskWorkflowInfo[];
}

// =============================================================================
// DATAOPS API - Version History and Stage Snapshots
// =============================================================================

export interface AnnotationHistoryItem {
  id: string;
  annotation_id: string;
  task_id: string;
  frame_id: string;
  change_type: 'created' | 'updated' | 'deleted';
  annotation_data: Record<string, unknown>;
  previous_data?: Record<string, unknown>;
  task_stage: string;
  task_status: string;
  changed_by_id?: string;
  version: number;
  created_at: string;
}

export interface AnnotationHistoryListResponse {
  items: AnnotationHistoryItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface SnapshotSummary {
  id: string;
  task_id: string;
  from_stage: string;
  to_stage: string;
  from_status: string;
  to_status: string;
  snapshot_name: string;
  total_annotations: number;
  annotations_by_class: Record<string, number>;
  annotations_by_type: Record<string, number>;
  triggered_by_id?: string;
  notes?: string;
  created_at: string;
}

export interface SnapshotListResponse {
  items: SnapshotSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface DatasetDataOpsStats {
  total_changes: number;
  changes_by_type: Record<string, number>;
  total_snapshots: number;
  tasks_with_history: number;
  total_tasks: number;
}

export interface TaskDataOpsStats {
  total_changes: number;
  changes_by_type: Record<string, number>;
  created_count: number;
  updated_count: number;
  deleted_count: number;
  snapshot_count: number;
  latest_snapshot?: {
    id: string;
    name: string;
    created_at: string;
    total_annotations: number;
  };
}

export const dataopsApi = {
  /**
   * Get DataOps stats for a dataset
   */
  getDatasetStats: async (datasetId: string): Promise<DatasetDataOpsStats> => {
    const { data } = await api.get<DatasetDataOpsStats>(`/dataops/datasets/${datasetId}/stats`);
    return data;
  },

  /**
   * Get annotation history for a dataset
   */
  getDatasetHistory: async (
    datasetId: string,
    params?: { change_type?: string; limit?: number; offset?: number }
  ): Promise<AnnotationHistoryListResponse> => {
    const { data } = await api.get<AnnotationHistoryListResponse>(
      `/dataops/datasets/${datasetId}/history`,
      { params }
    );
    return data;
  },

  /**
   * Get stage snapshots for a dataset
   */
  getDatasetSnapshots: async (
    datasetId: string,
    params?: { limit?: number; offset?: number }
  ): Promise<SnapshotListResponse> => {
    const { data } = await api.get<SnapshotListResponse>(
      `/dataops/datasets/${datasetId}/snapshots`,
      { params }
    );
    return data;
  },

  /**
   * Get DataOps stats for a task
   */
  getTaskStats: async (taskId: string): Promise<TaskDataOpsStats> => {
    const { data } = await api.get<TaskDataOpsStats>(`/dataops/tasks/${taskId}/stats`);
    return data;
  },

  /**
   * Get annotation history for a task
   */
  getTaskHistory: async (
    taskId: string,
    params?: { change_type?: string; limit?: number; offset?: number }
  ): Promise<AnnotationHistoryListResponse> => {
    const { data } = await api.get<AnnotationHistoryListResponse>(
      `/dataops/tasks/${taskId}/history`,
      { params }
    );
    return data;
  },

  /**
   * Get stage snapshots for a task
   */
  getTaskSnapshots: async (
    taskId: string,
    params?: { limit?: number; offset?: number }
  ): Promise<SnapshotListResponse> => {
    const { data } = await api.get<SnapshotListResponse>(
      `/dataops/tasks/${taskId}/snapshots`,
      { params }
    );
    return data;
  },

  /**
   * Get full snapshot details
   */
  getSnapshotDetail: async (snapshotId: string): Promise<SnapshotSummary & {
    annotations_by_frame: Record<string, number>;
    annotations_snapshot: { annotations: unknown[] };
  }> => {
    const { data } = await api.get(`/dataops/snapshots/${snapshotId}`);
    return data;
  },

  /**
   * Compare two snapshots
   */
  compareSnapshots: async (snapshotId1: string, snapshotId2: string): Promise<{
    snapshot_1: { id: string; name: string; created_at: string };
    snapshot_2: { id: string; name: string; created_at: string };
    added: unknown[];
    removed: unknown[];
    modified: unknown[];
    summary: { added_count: number; removed_count: number; modified_count: number };
  }> => {
    const { data } = await api.get('/dataops/snapshots/compare', {
      params: { snapshot_id_1: snapshotId1, snapshot_id_2: snapshotId2 }
    });
    return data;
  },
};

// =============================================================================
// EXPORT API
// =============================================================================

export interface ExportOptions {
  includeData: boolean;
  includeSegmentation?: boolean;
  format?: 'json' | 'coco';
  acceptedOnly?: boolean;
  taxonomyId?: string;
}

export const exportApi = {
  /**
   * Export a task's annotations
   */
  exportTask: async (taskId: string, options: ExportOptions = { includeData: false }): Promise<Blob> => {
    const params = new URLSearchParams();
    params.append('include_data', options.includeData.toString());
    if (options.includeSegmentation) params.append('include_segmentation', 'true');
    if (options.format) params.append('format', options.format);
    if (options.taxonomyId) params.append('taxonomy_id', options.taxonomyId);

    const response = await api.get(`/export/tasks/${taskId}/export?${params}`, {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Export a scene's annotations (all tasks)
   */
  exportScene: async (sceneId: string, options: ExportOptions = { includeData: false }): Promise<Blob> => {
    const params = new URLSearchParams();
    params.append('include_data', options.includeData.toString());
    if (options.includeSegmentation) params.append('include_segmentation', 'true');
    params.append('format', options.format || 'coco');
    if (options.taxonomyId) params.append('taxonomy_id', options.taxonomyId);

    const response = await api.get(`/export/scenes/${sceneId}/export?${params}`, {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Export a dataset's annotations (all scenes and tasks)
   */
  exportDataset: async (datasetId: string, options: ExportOptions = { includeData: false }): Promise<Blob> => {
    const params = new URLSearchParams();
    params.append('include_data', options.includeData.toString());
    if (options.includeSegmentation) params.append('include_segmentation', 'true');
    params.append('format', options.format || 'coco');
    if (options.acceptedOnly) params.append('accepted_only', 'true');
    if (options.taxonomyId) params.append('taxonomy_id', options.taxonomyId);

    const response = await api.get(`/export/datasets/${datasetId}/export?${params}`, {
      responseType: 'blob',
    });
    return response.data;
  },

  /**
   * Helper to trigger download from blob
   */
  downloadBlob: (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  },
};

// =============================================================================
// ANALYTICS / PM DASHBOARD
// =============================================================================

import type { PMDashboardStats, AnnotatorStats } from '@/types';

export const analyticsApi = {
  /**
   * Get PM Dashboard statistics
   */
  getDashboard: async (filters?: {
    campaignId?: string;
    datasetId?: string;
    organizationId?: string;
    days?: number;
  }): Promise<PMDashboardStats> => {
    const params = new URLSearchParams();
    if (filters?.campaignId) params.append('campaign_id', filters.campaignId);
    if (filters?.datasetId) params.append('dataset_id', filters.datasetId);
    if (filters?.organizationId) params.append('organization_id', filters.organizationId);
    if (filters?.days) params.append('days', filters.days.toString());

    const { data } = await api.get<PMDashboardStats>(`/analytics/dashboard?${params}`);
    return data;
  },

  /**
   * Get annotator leaderboard
   */
  getLeaderboard: async (filters?: {
    campaignId?: string;
    sortBy?: 'completed' | 'speed' | 'quality';
    limit?: number;
  }): Promise<AnnotatorStats[]> => {
    const params = new URLSearchParams();
    if (filters?.campaignId) params.append('campaign_id', filters.campaignId);
    if (filters?.sortBy) params.append('sort_by', filters.sortBy);
    if (filters?.limit) params.append('limit', filters.limit.toString());

    const { data } = await api.get<AnnotatorStats[]>(`/analytics/annotator-leaderboard?${params}`);
    return data;
  },

  getAnnotationDailyStats: async (days: number = 30, organizationId?: string) => {
    const params = new URLSearchParams();
    params.append('days', days.toString());
    if (organizationId) params.append('organization_id', organizationId);
    const { data } = await api.get<any[]>(`/analytics/annotations/daily?${params}`);
    return data;
  },

  getMyDashboard: async (days: number = 30, organizationId?: string) => {
    const params = new URLSearchParams();
    params.append('days', days.toString());
    if (organizationId) params.append('organization_id', organizationId);
    const { data } = await api.get<any>(`/analytics/my-dashboard?${params}`);
    return data;
  },
};

// =============================================================================
// EFFICIENCY MONITORING API
// =============================================================================

export interface SessionStartResponse {
  session_id: string;
  started_at: string;
  message: string;
}

export interface HeartbeatResponse {
  session_id: string;
  active_duration_seconds: number;
  idle_duration_seconds: number;
  is_idle: boolean;
}

export interface SessionEndResponse {
  session_id: string;
  total_active_seconds: number;
  total_idle_seconds: number;
  action_count: number;
}

export interface ActivityEventResponse {
  event_id: string;
  timestamp: string;
}

export interface UserGoal {
  id: string;
  goal_type: string;
  target_value: number;
  current_value: number;
  period_start: string;
  period_end: string;
  is_achieved: boolean;
  achieved_at?: string;
  progress_percentage: number;
  is_self_assigned: boolean;
}

export interface Achievement {
  id: string;
  achievement_type: string;
  earned_at: string;
  metadata: Record<string, unknown>;
  is_seen: boolean;
  title: string;
  description: string;
  icon: string;
}

export interface EfficiencyStats {
  today_labels: number;
  today_active_time_seconds: number;
  today_sessions: number;
  week_labels: number;
  week_active_time_seconds: number;
  labels_per_hour: number;
  acceptance_rate: number | null;  // null when no reviewed tasks
  current_streak_days: number;
  rank_in_team?: number;
  vs_team_avg_percentage: number;
}

export interface LiveUserStatus {
  user_id: string;
  display_name: string;
  current_task_id?: string;
  current_task_name?: string;
  is_active: boolean;
  last_activity?: string;
  session_duration_seconds: number;
  labels_today: number;
}

export interface AnnotationBreakdown {
  cuboids_3d: number;
  boxes_2d: number;
  fusion: number;
  total: number;
}

export interface WorkflowMetrics {
  tasks_assigned: number;
  tasks_in_progress: number;
  tasks_submitted: number;
  tasks_accepted: number;
  tasks_rejected: number;
  revision_count: number;
}

export interface QualityMetrics {
  first_time_acceptance_rate: number;
  rejection_rate: number;
  revision_turnaround_hours: number;
  quality_score: number;
}

export interface TeamMemberStats {
  user_id: string;
  display_name: string;
  email?: string;
  role?: string;

  // Online/Activity status
  is_online: boolean;
  is_active: boolean;
  current_task_id?: string;
  current_task_name?: string;
  last_activity?: string;
  session_duration_seconds: number;

  // Annotation breakdown
  annotations: AnnotationBreakdown;

  // Workflow metrics
  workflow: WorkflowMetrics;

  // Quality metrics
  quality: QualityMetrics;

  // Productivity metrics
  active_time_seconds: number;
  labels_per_hour: number;
  avg_time_per_label_seconds: number;

  // Period info
  period_start?: string;
  period_end?: string;
}

export interface LeaderboardEntry {
  rank: number;
  user_id: string;
  display_name: string;
  labels_count: number;
  acceptance_rate: number;
  avg_time_per_label_seconds: number;
  streak_days: number;
}

export interface TeamChallenge {
  id: string;
  title: string;
  description?: string;
  goal_type: string;
  target_value: number;
  current_value: number;
  progress_percentage: number;
  start_date: string;
  end_date: string;
  is_active: boolean;
  is_completed: boolean;
  participant_count: number;
  top_contributors: LeaderboardEntry[];
}

export interface CreateChallengeRequest {
  title: string;
  description?: string;
  goal_type: string;
  target_value: number;
  start_date: string;
  end_date: string;
  organization_id?: string;
}

export interface PerformanceAlert {
  id: string;
  user_id: string;
  display_name: string;
  alert_type: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  metrics: Record<string, unknown>;
  is_acknowledged: boolean;
  created_at: string;
}

export const efficiencyApi = {
  // Session Management
  startSession: async (taskId: string, clientInfo?: {
    browser?: string;
    os?: string;
    screen_resolution?: string;
    timezone?: string;
  }): Promise<SessionStartResponse> => {
    const { data } = await api.post<SessionStartResponse>('/efficiency/sessions/start', {
      task_id: taskId,
      client_info: clientInfo,
    });
    return data;
  },

  sendHeartbeat: async (sessionId: string, isActive: boolean = true, currentFrame?: number): Promise<HeartbeatResponse> => {
    const { data } = await api.post<HeartbeatResponse>('/efficiency/sessions/heartbeat', {
      session_id: sessionId,
      is_active: isActive,
      current_frame: currentFrame,
    });
    return data;
  },

  endSession: async (sessionId: string): Promise<SessionEndResponse> => {
    const { data } = await api.post<SessionEndResponse>('/efficiency/sessions/end', {
      session_id: sessionId,
    });
    return data;
  },

  // Activity Logging
  logActivity: async (params: {
    sessionId?: string;
    taskId?: string;
    eventType: string;
    metadata?: Record<string, unknown>;
  }): Promise<ActivityEventResponse> => {
    const { data } = await api.post<ActivityEventResponse>('/efficiency/activity/log', {
      session_id: params.sessionId,
      task_id: params.taskId,
      event_type: params.eventType,
      metadata: params.metadata,
    });
    return data;
  },

  logActivityBatch: async (params: {
    sessionId?: string;
    taskId?: string;
    events: Array<{
      eventType: string;
      metadata?: Record<string, unknown>;
    }>;
  }): Promise<{ events_logged: number }> => {
    const { data } = await api.post('/efficiency/activity/batch', {
      session_id: params.sessionId,
      task_id: params.taskId,
      events: params.events.map(e => ({
        event_type: e.eventType,
        metadata: e.metadata,
      })),
    });
    return data;
  },

  // Goals
  getMyGoals: async (includeCompleted: boolean = false): Promise<UserGoal[]> => {
    const params = new URLSearchParams();
    params.append('include_completed', String(includeCompleted));
    const { data } = await api.get<UserGoal[]>(`/efficiency/goals/my?${params}`);
    return data;
  },

  createGoal: async (goal: {
    goal_type: string;
    target_value: number;
    period_start: string;
    period_end: string;
  }): Promise<UserGoal> => {
    const { data } = await api.post<UserGoal>('/efficiency/goals', goal);
    return data;
  },

  updateGoal: async (goalId: string, goal: {
    goal_type: string;
    target_value: number;
    period_start: string;
    period_end: string;
  }): Promise<UserGoal> => {
    const { data } = await api.put<UserGoal>(`/efficiency/goals/${goalId}`, goal);
    return data;
  },

  deleteGoal: async (goalId: string): Promise<void> => {
    await api.delete(`/efficiency/goals/${goalId}`);
  },

  // Achievements
  getMyAchievements: async (): Promise<Achievement[]> => {
    const { data } = await api.get<Achievement[]>('/efficiency/achievements/my');
    return data;
  },

  markAchievementSeen: async (achievementId: string): Promise<void> => {
    await api.post(`/efficiency/achievements/${achievementId}/mark-seen`);
  },

  // Stats
  getMyEfficiencyStats: async (organizationId?: string, days?: number): Promise<EfficiencyStats> => {
    const params = new URLSearchParams();
    if (organizationId) params.append('organization_id', organizationId);
    if (days) params.append('days', String(days));
    const { data } = await api.get<EfficiencyStats>(`/efficiency/stats/my?${params}`);
    return data;
  },

  // Live Activity (Manager)
  getLiveTeamStatus: async (organizationId?: string): Promise<LiveUserStatus[]> => {
    const params = new URLSearchParams();
    if (organizationId) params.append('organization_id', organizationId);
    const { data } = await api.get<LiveUserStatus[]>(`/efficiency/live/team?${params}`);
    return data;
  },

  // Team Stats (Manager) - All team members with period stats
  getTeamStats: async (params?: {
    organizationId?: string;
    period?: 'today' | 'week' | 'month';
    datasetId?: string;
    campaignId?: string;
  }): Promise<TeamMemberStats[]> => {
    const searchParams = new URLSearchParams();
    if (params?.organizationId) searchParams.append('organization_id', params.organizationId);
    if (params?.period) searchParams.append('period', params.period);
    if (params?.datasetId) searchParams.append('dataset_id', params.datasetId);
    if (params?.campaignId) searchParams.append('campaign_id', params.campaignId);
    const { data } = await api.get<TeamMemberStats[]>(`/efficiency/team-stats?${searchParams}`);
    return data;
  },

  // Leaderboard
  getLeaderboard: async (params?: {
    organizationId?: string;
    period?: 'today' | 'week' | 'month' | 'all_time';
    limit?: number;
  }): Promise<LeaderboardEntry[]> => {
    const searchParams = new URLSearchParams();
    if (params?.organizationId) searchParams.append('organization_id', params.organizationId);
    if (params?.period) searchParams.append('period', params.period);
    if (params?.limit) searchParams.append('limit', String(params.limit));
    const { data } = await api.get<LeaderboardEntry[]>(`/efficiency/leaderboard?${searchParams}`);
    return data;
  },

  getTeamMemberReport: async (userId: string, params?: { organizationId?: string; days?: number }): Promise<Record<string, unknown>> => {
    const searchParams = new URLSearchParams();
    if (params?.organizationId) searchParams.append('organization_id', params.organizationId);
    if (params?.days) searchParams.append('days', String(params.days));
    const { data } = await api.get<Record<string, unknown>>(`/efficiency/team-member-report/${userId}?${searchParams}`);
    return data;
  },

  // Alerts (Manager)
  getAlerts: async (params?: {
    organizationId?: string;
    includeAcknowledged?: boolean;
    limit?: number;
  }): Promise<PerformanceAlert[]> => {
    const searchParams = new URLSearchParams();
    if (params?.organizationId) searchParams.append('organization_id', params.organizationId);
    if (params?.includeAcknowledged) searchParams.append('include_acknowledged', 'true');
    if (params?.limit) searchParams.append('limit', String(params.limit));
    const { data } = await api.get<PerformanceAlert[]>(`/efficiency/alerts?${searchParams}`);
    return data;
  },

  acknowledgeAlert: async (alertId: string): Promise<void> => {
    await api.post(`/efficiency/alerts/${alertId}/acknowledge`);
  },

  // Challenges
  getChallenges: async (params?: {
    organizationId?: string;
    includeCompleted?: boolean;
  }): Promise<TeamChallenge[]> => {
    const searchParams = new URLSearchParams();
    if (params?.organizationId) searchParams.append('organization_id', params.organizationId);
    if (params?.includeCompleted) searchParams.append('include_completed', 'true');
    const { data } = await api.get<TeamChallenge[]>(`/efficiency/challenges?${searchParams}`);
    return data;
  },

  createChallenge: async (request: CreateChallengeRequest): Promise<TeamChallenge> => {
    const { data } = await api.post<TeamChallenge>('/efficiency/challenges', request);
    return data;
  },

  updateChallenge: async (challengeId: string, request: CreateChallengeRequest): Promise<TeamChallenge> => {
    const { data } = await api.put<TeamChallenge>(`/efficiency/challenges/${challengeId}`, request);
    return data;
  },

  deleteChallenge: async (challengeId: string): Promise<void> => {
    await api.delete(`/efficiency/challenges/${challengeId}`);
  },

  // ==========================================================================
  // Login Session (Global Activity Tracking)
  // ==========================================================================

  startLoginSession: async (params?: {
    organizationId?: string;
    clientInfo?: {
      browser?: string;
      os?: string;
      screen_resolution?: string;
      timezone?: string;
    };
  }): Promise<LoginSessionStartResponse> => {
    const { data } = await api.post<LoginSessionStartResponse>('/efficiency/login-sessions/start', {
      organization_id: params?.organizationId,
      client_info: params?.clientInfo,
    }, { skipAuthRefresh: true } as any);
    return data;
  },

  loginSessionHeartbeat: async (params: {
    sessionId: string;
    isWindowFocused: boolean;
    isMouseInWindow: boolean;
    isActive: boolean;
  }): Promise<LoginSessionHeartbeatResponse> => {
    const { data } = await api.post<LoginSessionHeartbeatResponse>('/efficiency/login-sessions/heartbeat', {
      session_id: params.sessionId,
      is_window_focused: params.isWindowFocused,
      is_mouse_in_window: params.isMouseInWindow,
      is_active: params.isActive,
    }, { skipAuthRefresh: true } as any);
    return data;
  },

  endLoginSession: async (sessionId: string): Promise<LoginSessionEndResponse> => {
    const { data } = await api.post<LoginSessionEndResponse>('/efficiency/login-sessions/end', {
      session_id: sessionId,
    }, { skipAuthRefresh: true } as any);
    return data;
  },

  getCurrentLoginSession: async (): Promise<CurrentLoginSession | null> => {
    const { data } = await api.get<CurrentLoginSession | { session: null }>('/efficiency/login-sessions/current');
    if ('session' in data && data.session === null) {
      return null;
    }
    return data as CurrentLoginSession;
  },
};

// Login Session Types
export interface LoginSessionStartResponse {
  session_id: string;
  started_at: string;
  message: string;
}

export interface LoginSessionHeartbeatResponse {
  session_id: string;
  active_duration_seconds: number;
  idle_duration_seconds: number;
  total_session_seconds: number;
  today_active_seconds: number;
}

export interface LoginSessionEndResponse {
  session_id: string;
  total_active_seconds: number;
  total_idle_seconds: number;
  total_session_seconds: number;
}

export interface CurrentLoginSession {
  session_id: string;
  started_at: string;
  active_duration_seconds: number;
  idle_duration_seconds: number;
  total_session_seconds: number;
  is_window_focused: boolean;
  is_mouse_in_window: boolean;
}

// =============================================================================
// SEGMENTATION API
// =============================================================================

export interface SegmentationLabelsCreate {
  frame_id: string;
  labels: number[];
  point_count: number;
  instance_ids?: number[];
}

export interface SegmentationLabelsResponse {
  frame_id: string;
  labels: number[];
  point_count: number;
  labeled_count: number;
  class_distribution: Record<number, number>;
  instance_ids?: number[];
  instance_count: number;
}

export interface SegmentationStats {
  total_frames: number;
  labeled_frames: number;
  total_points: number;
  labeled_points: number;
  total_instances: number;
  class_distribution: Record<number, number>;
}

export interface SegmentationExportRequest {
  frame_ids: string[];
  format: 'npy' | 'bin';
  include_unlabeled: boolean;
}

export const segmentationApi = {
  // Save segmentation labels for a frame as a full snapshot (legacy / fallback)
  saveLabels: async (
    taskId: string,
    frameId: string,
    labels: number[],
    instanceIds?: number[],
    layer: 'instance' | 'semantic' = 'instance'
  ): Promise<SegmentationLabelsResponse> => {
    const { data } = await api.post<SegmentationLabelsResponse>(
      `/segmentation/tasks/${taskId}/segmentation/${frameId}?layer=${layer}`,
      {
        frame_id: frameId,
        labels,
        point_count: labels.length,
        instance_ids: instanceIds,
      }
    );
    return data;
  },

  // Save only the points THIS client changed since baseline. Server merges
  // into the on-disk file under a per-frame lock so a second annotator
  // working on the same task doesn't get clobbered. Response includes the
  // post-merge full snapshot — feed it into store.applyServerMerge to pick
  // up the other annotator's writes.
  saveLabelsDelta: async (
    taskId: string,
    frameId: string,
    pointCount: number,
    indices: number[],
    labels: number[],
    instanceIds?: number[],
  ): Promise<SegmentationLabelsResponse> => {
    const { data } = await api.post<SegmentationLabelsResponse>(
      `/segmentation/tasks/${taskId}/segmentation/${frameId}`,
      {
        frame_id: frameId,
        point_count: pointCount,
        delta_indices: indices,
        delta_labels: labels,
        delta_instance_ids: instanceIds,
      },
    );
    return data;
  },

  // Get segmentation labels for a frame. `layer` selects the semantic or
  // instance annotation layer (they are stored independently).
  getLabels: async (
    taskId: string,
    frameId: string,
    layer: 'instance' | 'semantic' = 'instance'
  ): Promise<SegmentationLabelsResponse> => {
    const { data } = await api.get<SegmentationLabelsResponse>(
      `/segmentation/tasks/${taskId}/segmentation/${frameId}?layer=${layer}`
    );
    return data;
  },

  // Get segmentation statistics for a task
  getStats: async (taskId: string): Promise<SegmentationStats> => {
    const { data } = await api.get<SegmentationStats>(
      `/segmentation/tasks/${taskId}/segmentation/stats`
    );
    return data;
  },

  // Export segmentation labels
  exportLabels: async (
    taskId: string,
    frameIds: string[],
    format: 'npy' | 'bin' = 'npy',
    includeUnlabeled: boolean = true
  ): Promise<Blob> => {
    const { data } = await api.post(
      `/segmentation/tasks/${taskId}/segmentation/export`,
      {
        frame_ids: frameIds,
        format,
        include_unlabeled: includeUnlabeled,
      },
      { responseType: 'blob' }
    );
    return data;
  },

  // Propagate labels from source frame to target frames
  propagateLabels: async (
    taskId: string,
    sourceFrameId: string,
    targetFrameIds: string[]
  ): Promise<{ success: boolean; propagated_frames: string[]; message: string }> => {
    const { data } = await api.post(
      `/segmentation/tasks/${taskId}/segmentation/propagate`,
      null,
      {
        params: {
          source_frame_id: sourceFrameId,
          target_frame_ids: targetFrameIds,
        },
      }
    );
    return data;
  },

  // Clear all segmentation labels for a task
  clearAllLabels: async (
    taskId: string
  ): Promise<{ success: boolean; deleted_files: number; message: string }> => {
    const { data } = await api.delete(
      `/segmentation/tasks/${taskId}/segmentation/clear`
    );
    return data;
  },
};

export default api;

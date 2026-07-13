import { create } from 'zustand';
import { useAuthStore } from '@/store/authStore';
import type { Frame, Scene } from '@/types';

interface ImageCacheEntry {
  blob: Blob;
  objectUrl: string;
  loadedAt: number;
  size: number;
}

type PrefetchStatus = 'idle' | 'prefetching' | 'complete' | 'error';

interface ImageCacheState {
  cache: Map<string, ImageCacheEntry>;

  prefetchStatus: PrefetchStatus;
  prefetchProgress: number;
  prefetchTotal: number;
  prefetchLoaded: number;
  prefetchErrors: string[];

  currentSceneId: string | null;
  abortController: AbortController | null;

  startPrefetch: (scene: Scene, frames: Frame[], currentFrameIndex?: number) => void;
  cancelPrefetch: () => void;
  getCached: (filePath: string) => string | null;
  areFrameImagesCached: (scene: Scene, frame: Frame) => boolean;
  clearCache: () => void;

  getCacheStats: () => { entries: number; totalSize: number; hitRate: number };
}

let cacheHits = 0;
let cacheMisses = 0;

const MAX_CONCURRENT = 30;

const MAX_CACHE_SIZE = 1024 * 1024 * 1024;

export const useImageCacheStore = create<ImageCacheState>((set, get) => ({
  cache: new Map(),
  prefetchStatus: 'idle',
  prefetchProgress: 0,
  prefetchTotal: 0,
  prefetchLoaded: 0,
  prefetchErrors: [],
  currentSceneId: null,
  abortController: null,

  startPrefetch: (scene: Scene, frames: Frame[], currentFrameIndex: number = 0) => {
    const state = get();

    console.log('[ImageCache] startPrefetch called', { sceneId: scene.id, frameCount: frames.length, currentFrameIndex, cameras: scene.storage_paths?.cameras });

    if (state.currentSceneId === scene.id && (state.prefetchStatus === 'prefetching' || state.prefetchStatus === 'complete')) {
      console.log('[ImageCache] Already prefetching/complete for this scene, skipping');
      return;
    }

    if (state.abortController) {
      state.abortController.abort();
    }

    const abortController = new AbortController();
    const cameras = scene.storage_paths?.cameras;

    if (!cameras || Object.keys(cameras).length === 0) {
      console.warn('[ImageCache] No cameras found in scene.storage_paths', scene.storage_paths);
      return;
    }

    const imagePaths: Array<{ path: string; cameraId: string; frameIndex: number }> = [];
    frames.forEach(frame => {
      Object.entries(cameras).forEach(([cameraId, basePath]) => {
        const filename = frame.file_paths?.cameras?.[cameraId];
        if (filename) {
          const cleanBasePath = basePath.replace(/\/$/, '');
          const fullPath = `${cleanBasePath}/${filename}`;
          imagePaths.push({ path: fullPath, cameraId, frameIndex: frame.frame_index });
        }
      });
    });

    // Filter out already cached paths
    const cache = state.cache;
    const pathsToLoad = imagePaths.filter(({ path }) => !cache.has(path));

    // Sort to prioritize current frame, then nearby frames
    // This ensures the user sees the current frame images first
    pathsToLoad.sort((a, b) => {
      const distA = Math.abs(a.frameIndex - currentFrameIndex);
      const distB = Math.abs(b.frameIndex - currentFrameIndex);
      return distA - distB;
    });

    console.log('[ImageCache] Image paths analysis', {
      totalPaths: imagePaths.length,
      alreadyCached: imagePaths.length - pathsToLoad.length,
      toLoad: pathsToLoad.length
    });

    if (pathsToLoad.length === 0) {
      console.log('[ImageCache] All images already cached');
      set({
        prefetchStatus: 'complete',
        prefetchProgress: 100,
        prefetchTotal: imagePaths.length,
        prefetchLoaded: imagePaths.length,
        currentSceneId: scene.id,
        abortController: null,
      });
      return;
    }

    console.log('[ImageCache] Starting prefetch of', pathsToLoad.length, 'images');
    set({
      prefetchStatus: 'prefetching',
      prefetchProgress: 0,
      prefetchTotal: pathsToLoad.length,
      prefetchLoaded: 0,
      prefetchErrors: [],
      currentSceneId: scene.id,
      abortController,
    });

    // Start prefetching in batches
    prefetchBatch(pathsToLoad, abortController.signal, set, get);
  },

  cancelPrefetch: () => {
    const state = get();
    if (state.abortController) {
      state.abortController.abort();
    }

    // Clean up object URLs
    state.cache.forEach(entry => {
      URL.revokeObjectURL(entry.objectUrl);
    });

    set({
      prefetchStatus: 'idle',
      abortController: null,
      cache: new Map(),
    });
  },

  getCached: (filePath: string): string | null => {
    const entry = get().cache.get(filePath);
    if (entry) {
      cacheHits++;
      return entry.objectUrl;
    }
    cacheMisses++;
    return null;
  },

  // Check if all images for a specific frame are cached
  areFrameImagesCached: (scene: Scene, frame: Frame): boolean => {
    const cameras = scene.storage_paths?.cameras;
    if (!cameras || Object.keys(cameras).length === 0) {
      return true; // No cameras to check
    }

    const cache = get().cache;
    return Object.entries(cameras).every(([cameraId, basePath]) => {
      const filename = frame.file_paths?.cameras?.[cameraId];
      if (!filename) return true; // Skip missing camera files
      const cleanBasePath = basePath.replace(/\/$/, '');
      const fullPath = `${cleanBasePath}/${filename}`;
      return cache.has(fullPath);
    });
  },

  clearCache: () => {
    const state = get();
    if (state.abortController) {
      state.abortController.abort();
    }

    // Clean up all object URLs
    state.cache.forEach(entry => {
      URL.revokeObjectURL(entry.objectUrl);
    });

    cacheHits = 0;
    cacheMisses = 0;
    set({
      cache: new Map(),
      prefetchStatus: 'idle',
      prefetchProgress: 0,
      prefetchTotal: 0,
      prefetchLoaded: 0,
      prefetchErrors: [],
      currentSceneId: null,
      abortController: null,
    });
  },

  getCacheStats: () => {
    const cache = get().cache;
    let totalSize = 0;
    cache.forEach(entry => {
      totalSize += entry.size;
    });
    const total = cacheHits + cacheMisses;
    return {
      entries: cache.size,
      totalSize,
      hitRate: total > 0 ? (cacheHits / total) * 100 : 0,
    };
  },
}));

// Prefetch images in batches with concurrency control
async function prefetchBatch(
  paths: Array<{ path: string; cameraId: string; frameIndex: number }>,
  signal: AbortSignal,
  set: (partial: Partial<ImageCacheState> | ((state: ImageCacheState) => Partial<ImageCacheState>)) => void,
  _get: () => ImageCacheState  // Prefixed with _ to indicate intentionally unused
) {
  let loaded = 0;
  let errors: string[] = [];

  // Process in batches of MAX_CONCURRENT
  for (let i = 0; i < paths.length; i += MAX_CONCURRENT) {
    if (signal.aborted) {
      return;
    }

    const batch = paths.slice(i, i + MAX_CONCURRENT);
    const promises = batch.map(async ({ path, cameraId, frameIndex }) => {
      try {
        const token = useAuthStore.getState().accessToken;
        if (!token) {
          throw new Error('No auth token available');
        }

        const url = `/api/v1/data/image/${path}?token=${encodeURIComponent(token)}`;

        // Use cache: 'no-store' to prevent browser disk cache write failures
        // We use our own blob URL cache instead
        const response = await fetch(url, {
          signal,
          cache: 'no-store',
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} for ${cameraId}/${frameIndex}`);
        }

        const blob = await response.blob();

        // Check if still valid (not aborted, cache not cleared)
        if (signal.aborted) return;

        // Create object URL for the blob
        const objectUrl = URL.createObjectURL(blob);

        // Add to cache
        const entry: ImageCacheEntry = {
          blob,
          objectUrl,
          loadedAt: Date.now(),
          size: blob.size,
        };

        // Update cache with eviction if needed
        set((state) => {
          const newCache = new Map(state.cache);

          // Check cache size and evict oldest if needed
          let currentSize = 0;
          newCache.forEach(e => currentSize += e.size);

          if (currentSize + blob.size > MAX_CACHE_SIZE) {
            // Evict oldest entries
            const sortedEntries = Array.from(newCache.entries())
              .sort((a, b) => a[1].loadedAt - b[1].loadedAt);

            while (currentSize + blob.size > MAX_CACHE_SIZE && sortedEntries.length > 0) {
              const [oldPath, oldEntry] = sortedEntries.shift()!;
              currentSize -= oldEntry.size;
              URL.revokeObjectURL(oldEntry.objectUrl); // Clean up
              newCache.delete(oldPath);
            }
          }

          newCache.set(path, entry);
          return { cache: newCache };
        });

        loaded++;
      } catch (err) {
        if (!signal.aborted) {
          const errMsg = `${cameraId}/${frameIndex}`;
          errors.push(errMsg);
        }
      }
    });

    await Promise.all(promises);

    // Update progress
    if (!signal.aborted) {
      const progress = Math.round(((i + batch.length) / paths.length) * 100);
      set({
        prefetchProgress: progress,
        prefetchLoaded: loaded,
        prefetchErrors: errors,
      });
    }
  }

  set({
    prefetchStatus: errors.length > 0 && loaded === 0 ? 'error' : 'complete',
    prefetchProgress: 100,
    prefetchLoaded: loaded,
    prefetchErrors: errors,
    abortController: null,
  });
}

// Export for external use
export type { PrefetchStatus };

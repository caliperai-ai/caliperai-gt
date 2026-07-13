import { create } from 'zustand';
import { dataApi } from '@/api/client';
import type { Frame, Scene } from '@/types';

interface PointCloudData {
  positions: Float32Array;
  intensities: Float32Array;
  pointCount: number;
}

interface CacheEntry {
  data: PointCloudData;
  loadedAt: number;
  size: number;
}

type PrefetchStatus = 'idle' | 'prefetching' | 'complete' | 'error';

interface LidarCacheState {
  cache: Map<string, CacheEntry>;

  prefetchStatus: PrefetchStatus;
  prefetchProgress: number;
  prefetchTotal: number;
  prefetchLoaded: number;
  prefetchErrors: string[];

  currentSceneId: string | null;
  abortController: AbortController | null;

  startPrefetch: (scene: Scene, frames: Frame[]) => void;
  prefetchAround: (scene: Scene, frames: Frame[], centerIndex: number, windowSize?: number) => void;
  cancelPrefetch: () => void;
  getCached: (filePath: string) => PointCloudData | null;
  clearCache: () => void;

  getCacheStats: () => { entries: number; totalSize: number; hitRate: number };
}

let cacheHits = 0;
let cacheMisses = 0;

const MAX_CONCURRENT = 6;

const MAX_CACHE_SIZE = 500 * 1024 * 1024;

export const useLidarCacheStore = create<LidarCacheState>((set, get) => ({
  cache: new Map(),
  prefetchStatus: 'idle',
  prefetchProgress: 0,
  prefetchTotal: 0,
  prefetchLoaded: 0,
  prefetchErrors: [],
  currentSceneId: null,
  abortController: null,

  startPrefetch: (scene: Scene, frames: Frame[]) => {
    const state = get();

    if (state.currentSceneId === scene.id && (state.prefetchStatus === 'prefetching' || state.prefetchStatus === 'complete')) {
      return;
    }

    if (state.abortController) {
      state.abortController.abort();
    }

    const abortController = new AbortController();
    const lidarBase = scene.storage_paths?.lidar_base?.replace(/\/$/, '') || '';

    if (!lidarBase) {
      return;
    }

    const filePaths = frames
      .filter(f => f.file_paths?.lidar)
      .map(f => `${lidarBase}/${f.file_paths.lidar}`);

    // Filter out already cached paths
    const cache = state.cache;
    const pathsToLoad = filePaths.filter(path => !cache.has(path));

    if (pathsToLoad.length === 0) {
      set({
        prefetchStatus: 'complete',
        prefetchProgress: 100,
        prefetchTotal: filePaths.length,
        prefetchLoaded: filePaths.length,
        currentSceneId: scene.id,
        abortController: null,
      });
      return;
    }

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

  prefetchAround: (scene: Scene, frames: Frame[], centerIndex: number, windowSize = 10) => {
    const lidarBase = scene.storage_paths?.lidar_base?.replace(/\/$/, '') || '';
    if (!lidarBase) return;

    const lo = Math.max(0, centerIndex - windowSize);
    const hi = Math.min(frames.length - 1, centerIndex + windowSize);
    const window = frames.slice(lo, hi + 1);

    const cache = get().cache;
    const pathsToLoad = window
      .filter(f => f.file_paths?.lidar)
      .map(f => `${lidarBase}/${f.file_paths.lidar}`)
      .filter(path => !cache.has(path));

    if (pathsToLoad.length === 0) return;

    // Download quietly — don't touch prefetchStatus so the UI progress bar isn't reset
    const signal = get().abortController?.signal ?? new AbortController().signal;
    prefetchQuiet(pathsToLoad, signal, set);
  },

  cancelPrefetch: () => {
    const state = get();
    if (state.abortController) {
      state.abortController.abort();
    }
    set({
      prefetchStatus: 'idle',
      abortController: null,
    });
  },

  getCached: (filePath: string): PointCloudData | null => {
    const entry = get().cache.get(filePath);
    if (entry) {
      cacheHits++;
      return entry.data;
    }
    cacheMisses++;
    return null;
  },

  clearCache: () => {
    const state = get();
    if (state.abortController) {
      state.abortController.abort();
    }
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
    console.log('[LiDAR Cache] Cache cleared');
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

// Quietly download a set of paths into the cache without updating prefetchStatus
async function prefetchQuiet(
  paths: string[],
  signal: AbortSignal,
  set: (partial: Partial<LidarCacheState> | ((state: LidarCacheState) => Partial<LidarCacheState>)) => void,
) {
  for (let i = 0; i < paths.length; i += MAX_CONCURRENT) {
    if (signal.aborted) return;
    const batch = paths.slice(i, i + MAX_CONCURRENT);
    await Promise.all(batch.map(async (path) => {
      try {
        const response = await dataApi.getLidarData(path);
        if (signal.aborted) return;
        const size = response.positions.byteLength + response.intensities.byteLength + 4;
        set((state) => {
          const newCache = new Map(state.cache);
          let currentSize = 0;
          newCache.forEach(e => currentSize += e.size);
          if (currentSize + size > MAX_CACHE_SIZE) {
            const sorted = Array.from(newCache.entries()).sort((a, b) => a[1].loadedAt - b[1].loadedAt);
            while (currentSize + size > MAX_CACHE_SIZE && sorted.length > 0) {
              const [p, e] = sorted.shift()!;
              currentSize -= e.size;
              newCache.delete(p);
            }
          }
          newCache.set(path, { data: { positions: response.positions, intensities: response.intensities, pointCount: response.pointCount }, loadedAt: Date.now(), size });
          return { cache: newCache };
        });
      } catch { /* silent — rolling prefetch is best-effort */ }
    }));
  }
}

// Prefetch frames in batches with concurrency control
async function prefetchBatch(
  paths: string[],
  signal: AbortSignal,
  set: (partial: Partial<LidarCacheState> | ((state: LidarCacheState) => Partial<LidarCacheState>)) => void,
  _get: () => LidarCacheState  // Prefixed with _ to indicate intentionally unused
) {
  const startTime = performance.now();
  let loaded = 0;
  let errors: string[] = [];

  // Process in batches of MAX_CONCURRENT
  for (let i = 0; i < paths.length; i += MAX_CONCURRENT) {
    if (signal.aborted) {
      console.log('[LiDAR Cache] Prefetch aborted');
      return;
    }

    const batch = paths.slice(i, i + MAX_CONCURRENT);
    const promises = batch.map(async (path) => {
      try {
        const response = await dataApi.getLidarData(path);

        // Check if still valid (not aborted, cache not cleared)
        if (signal.aborted) return;

        // Calculate size (positions + intensities)
        const size = response.positions.byteLength + response.intensities.byteLength + 4;

        // Add to cache
        const entry: CacheEntry = {
          data: {
            positions: response.positions,
            intensities: response.intensities,
            pointCount: response.pointCount,
          },
          loadedAt: Date.now(),
          size,
        };

        // Update cache with eviction if needed
        set((state) => {
          const newCache = new Map(state.cache);

          // Check cache size and evict oldest if needed
          let currentSize = 0;
          newCache.forEach(e => currentSize += e.size);

          if (currentSize + size > MAX_CACHE_SIZE) {
            // Evict oldest entries
            const sortedEntries = Array.from(newCache.entries())
              .sort((a, b) => a[1].loadedAt - b[1].loadedAt);

            while (currentSize + size > MAX_CACHE_SIZE && sortedEntries.length > 0) {
              const [oldPath, oldEntry] = sortedEntries.shift()!;
              currentSize -= oldEntry.size;
              newCache.delete(oldPath);
            }
          }

          newCache.set(path, entry);
          return { cache: newCache };
        });

        loaded++;
      } catch (err) {
        if (!signal.aborted) {
          const errMsg = path.split('/').pop() || path;
          errors.push(errMsg);
          console.warn(`[LiDAR Cache] Failed to prefetch ${errMsg}:`, err);
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

  const elapsed = performance.now() - startTime;
  console.log(`[LiDAR Cache] Prefetch complete: ${loaded}/${paths.length} frames in ${(elapsed / 1000).toFixed(1)}s`);

  set({
    prefetchStatus: errors.length > 0 && loaded === 0 ? 'error' : 'complete',
    prefetchProgress: 100,
    prefetchLoaded: loaded,
    prefetchErrors: errors,
    abortController: null,
  });
}

// Hook to use cached data with fallback to API
export function useCachedLidarData(filePath: string | null) {
  const getCached = useLidarCacheStore(s => s.getCached);

  // Check cache first
  if (filePath) {
    const cached = getCached(filePath);
    if (cached) {
      return { data: cached, isFromCache: true };
    }
  }

  return { data: null, isFromCache: false };
}

// Export for external use
export type { PointCloudData, PrefetchStatus };

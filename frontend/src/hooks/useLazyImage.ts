
import { useState, useEffect, useRef, useCallback } from 'react';

interface UseLazyImageOptions {
  rootMargin?: string;
  unloadDistance?: number;
  thumbnailWidth?: number;
  thumbnailHeight?: number;
  quality?: number;
  enabled?: boolean;
}

interface LazyImageReturn {
  src: string | undefined;
  isLoading: boolean;
  isLoaded: boolean;
  error: Error | null;
  ref: (node: HTMLElement | null) => void;
}

class ImageCache {
  private cache = new Map<string, string>();
  private maxSize: number;

  constructor(maxSize: number = 50) {
    this.maxSize = maxSize;
  }

  get(key: string): string | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: string, value: string): void {
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    this.cache.set(key, value);

    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }
}

const imageCache = new ImageCache(100);

function buildImageUrl(
  baseUrl: string,
  width?: number,
  height?: number,
  quality: number = 85
): string {
  if (!width && !height) return baseUrl;

  const url = new URL(baseUrl, window.location.origin);
  if (width) url.searchParams.set('width', width.toString());
  if (height) url.searchParams.set('height', height.toString());
  url.searchParams.set('quality', quality.toString());

  return url.toString();
}

export function useLazyImage(
  imageUrl: string | undefined,
  options: UseLazyImageOptions = {}
): LazyImageReturn {
  const {
    rootMargin = '500px',
    thumbnailWidth,
    thumbnailHeight,
    quality = 85,
    enabled = true,
  } = options;

  const [src, setSrc] = useState<string | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);

  const fullUrl = imageUrl
    ? buildImageUrl(imageUrl, thumbnailWidth, thumbnailHeight, quality)
    : undefined;

  const cacheKey = fullUrl || '';

  useEffect(() => {
    if (!fullUrl) {
      setSrc(undefined);
      setIsLoaded(false);
      setIsLoading(false);
      setError(null);
      return;
    }

    if (imageCache.has(cacheKey)) {
      setSrc(imageCache.get(cacheKey));
      setIsLoaded(true);
      setIsLoading(false);
      setError(null);
    } else {
      setSrc(undefined);
      setIsLoaded(false);
      setError(null);
    }
  }, [fullUrl, cacheKey]);

  const loadImage = useCallback(() => {
    if (!fullUrl) return;

    if (imageCache.has(cacheKey)) {
      setSrc(imageCache.get(cacheKey));
      setIsLoaded(true);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const img = new Image();
    img.onload = () => {
      imageCache.set(cacheKey, fullUrl);
      setSrc(fullUrl);
      setIsLoaded(true);
      setIsLoading(false);
    };
    img.onerror = () => {
      setError(new Error(`Failed to load image: ${fullUrl}`));
      setIsLoading(false);
    };
    img.src = fullUrl;
  }, [fullUrl, cacheKey]);

  // Set up Intersection Observer
  useEffect(() => {
    if (!enabled || !fullUrl) {
      // If not enabled or no URL, load immediately
      if (fullUrl) {
        loadImage();
      }
      return;
    }

    // Create observer if it doesn't exist
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              loadImage();
            } else {
              // Optionally unload when far from viewport
              // Disabled by default to prevent flickering
              // unloadImage();
            }
          });
        },
        { rootMargin }
      );
    }

    // Observe the element
    if (elementRef.current) {
      observerRef.current.observe(elementRef.current);
    }

    return () => {
      if (observerRef.current && elementRef.current) {
        observerRef.current.unobserve(elementRef.current);
      }
    };
  }, [enabled, fullUrl, loadImage, rootMargin]);

  // Ref callback to attach to element
  const ref = useCallback((node: HTMLElement | null) => {
    if (elementRef.current && observerRef.current) {
      observerRef.current.unobserve(elementRef.current);
    }

    elementRef.current = node;

    if (node && observerRef.current) {
      observerRef.current.observe(node);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, []);

  return {
    src,
    isLoading,
    isLoaded,
    error,
    ref,
  };
}

/**
 * Clear the image cache (useful when navigating away from a scene)
 */
export function clearImageCache(): void {
  imageCache.clear();
}

/**
 * Get cache statistics
 */
export function getImageCacheStats() {
  return {
    size: imageCache.size(),
    maxSize: 100,
  };
}

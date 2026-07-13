import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { PointCloudData, CameraCalibration } from '@/types';
import { projectPointsToCamera } from '@/utils/cameraProjection';
import { useSegmentationStore } from '@/store/segmentationStore';

interface SegmentationCameraOverlayProps {
  imageUrl: string;
  cameraName: string;
  calibration: CameraCalibration;
  pointCloud: PointCloudData;
  classColors: Map<number, string>;
  onClose: () => void;
}

export const SegmentationCameraOverlay: React.FC<SegmentationCameraOverlayProps> = ({
  imageUrl,
  cameraName,
  calibration,
  pointCloud,
  classColors,
  onClose,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  const [showAllPoints, setShowAllPoints] = useState(true);
  const [showPoints, setShowPoints] = useState(true);
  const [overlayPointSize, setOverlayPointSize] = useState(4);

  const currentFrameIndex = useSegmentationStore((s) => s.currentFrameIndex);
  const getLabelsForFrame = useSegmentationStore((s) => s.getLabelsForFrame);

  const labels = useMemo(() => {
    return getLabelsForFrame(currentFrameIndex);
  }, [currentFrameIndex, getLabelsForFrame]);

  useEffect(() => {
    if (!imageUrl) return;

    let cancelled = false;
    let localBlobUrl: string | null = null;

    const loadImage = async () => {
      try {
        const response = await fetch(imageUrl);
        if (cancelled) return;

        const blob = await response.blob();
        if (cancelled) return;

        localBlobUrl = URL.createObjectURL(blob);
        setBlobUrl(localBlobUrl);

        const img = new Image();
        imageRef.current = img;

        img.onload = () => {
          if (cancelled) return;
          setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
          setImageLoaded(true);
        };

        img.onerror = () => {
          if (cancelled) return;
          setImageLoaded(false);
        };

        img.src = localBlobUrl;
      } catch (err) {
        console.error('[SegmentationCameraOverlay] Failed to load image:', err);
      }
    };

    loadImage();

    return () => {
      cancelled = true;
      if (localBlobUrl) {
        URL.revokeObjectURL(localBlobUrl);
      }
    };
  }, [imageUrl]);

  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const img = imageRef.current;
    const container = containerRef.current;

    if (!canvas || !ctx || !img || !imageLoaded || !container) return;

    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    const imgAspect = imageDimensions.width / imageDimensions.height;
    const containerAspect = containerWidth / containerHeight;

    let drawWidth, drawHeight, offsetX = 0, offsetY = 0;

    if (imgAspect > containerAspect) {
      drawWidth = containerWidth;
      drawHeight = containerWidth / imgAspect;
      offsetY = (containerHeight - drawHeight) / 2;
    } else {
      drawHeight = containerHeight;
      drawWidth = containerHeight * imgAspect;
      offsetX = (containerWidth - drawWidth) / 2;
    }

    canvas.width = containerWidth;
    canvas.height = containerHeight;

    ctx.fillStyle = '#0a0a0a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    const centerX = containerWidth / 2;
    const centerY = containerHeight / 2;
    ctx.translate(centerX + pan.x, centerY + pan.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-centerX, -centerY);

    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

    const scale = drawWidth / imageDimensions.width;

    if (showPoints && pointCloud && calibration) {
      const projected = projectPointsToCamera(
        pointCloud.positions,
        pointCloud.pointCount,
        labels,
        calibration,
        imageDimensions.width,
        imageDimensions.height
      );

      const pointsToDraw = showAllPoints ? projected : projected.filter(p => p.label >= 0);

      if (pointsToDraw.length > 0) {
        const labeledPointSize = overlayPointSize;
        const unlabeledPointSize = Math.max(1, overlayPointSize - 2);

        ctx.globalAlpha = 0.4;
        for (const point of pointsToDraw) {
          if (point.label < 0) {
            const depth = point.depth;
            const normalizedDepth = Math.max(0, Math.min(1, 1 - depth / 80.0));
            const r = Math.round(255 * normalizedDepth);
            const b = Math.round(255 * (1 - normalizedDepth));

            ctx.beginPath();
            ctx.arc(
              point.x * scale + offsetX,
              point.y * scale + offsetY,
              unlabeledPointSize,
              0,
              2 * Math.PI
            );
            ctx.fillStyle = `rgb(${r}, 0, ${b})`;
            ctx.fill();
          }
        }

        // Draw labeled points on top (dark/dense)
        ctx.globalAlpha = 1.0;
        for (const point of pointsToDraw) {
          if (point.label >= 0) {
            const color = classColors.get(point.label) || '#808080';

            ctx.beginPath();
            ctx.arc(
              point.x * scale + offsetX,
              point.y * scale + offsetY,
              labeledPointSize,
              0,
              2 * Math.PI
            );
            ctx.fillStyle = color;
            ctx.fill();
          }
        }

        // Reset opacity
        ctx.globalAlpha = 1.0;
      }
    }

    // Restore transform
    ctx.restore();
  }, [imageLoaded, imageDimensions, showPoints, showAllPoints, pointCloud, calibration, labels, classColors, overlayPointSize, zoom, pan]);

  // Handle mouse wheel for zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.min(5, Math.max(0.5, z * delta)));
  }, []);

  // Handle mouse events for panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoom > 1) {
      isPanning.current = true;
      lastMouse.current = { x: e.clientX, y: e.clientY };
    }
  }, [zoom]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isPanning.current && zoom > 1) {
      const dx = e.clientX - lastMouse.current.x;
      const dy = e.clientY - lastMouse.current.y;
      setPan(p => ({ x: p.x + dx, y: p.y + dy }));
      lastMouse.current = { x: e.clientX, y: e.clientY };
    }
  }, [zoom]);

  const handleMouseUp = useCallback(() => {
    isPanning.current = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    isPanning.current = false;
  }, []);

  // Reset zoom/pan
  const resetView = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  // Format camera name for display
  const displayName = useMemo(() => {
    return cameraName
      .replace(/_/g, ' ')
      .toLowerCase()
      .replace(/\b\w/g, l => l.toUpperCase());
  }, [cameraName]);

  return (
    <div className="absolute inset-0 z-20 bg-dark flex flex-col">
      {/* Header controls */}
      <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between px-4 py-3 bg-gradient-to-b from-black/80 via-black/40 to-transparent">
        {/* Left: Camera name */}
        <div className="flex items-center gap-3">
          <div className="px-3 py-1.5 rounded-lg bg-black/60 border border-gray-600 text-white text-sm flex items-center gap-2">
            <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            {displayName}
          </div>

          <span className="px-2 py-0.5 rounded text-xs bg-primary/20 text-primary-light border border-primary/30">
            2D Projection
          </span>
        </div>

        {/* Center: View controls */}
        <div className="flex items-center gap-2">
          {/* Toggle points */}
          <button
            onClick={() => setShowPoints(!showPoints)}
            className={`px-3 py-1.5 rounded text-xs flex items-center gap-1.5 transition-colors ${
              showPoints
                ? 'bg-primary/20 text-primary-light border border-primary/30'
                : 'bg-gray-800 text-gray-400 border border-gray-700 hover:bg-gray-700'
            }`}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="4" />
            </svg>
            Points
          </button>

          {/* Toggle all vs labeled points */}
          {showPoints && (
            <button
              onClick={() => setShowAllPoints(!showAllPoints)}
              className={`px-3 py-1.5 rounded text-xs flex items-center gap-1.5 transition-colors ${
                showAllPoints
                  ? 'bg-gray-800 text-gray-300 border border-gray-700'
                  : 'bg-primary/20 text-primary-light border border-primary/30'
              }`}
            >
              {showAllPoints ? 'All Points' : 'Labeled Only'}
            </button>
          )}

          {/* Point size slider */}
          {showPoints && (
            <div className="flex items-center gap-2 px-2 py-1 rounded bg-black/60 border border-gray-700">
              <span className="text-xs text-gray-400">Size</span>
              <input
                type="range"
                min="2"
                max="10"
                step="1"
                value={overlayPointSize}
                onChange={(e) => setOverlayPointSize(Number(e.target.value))}
                className="w-16 h-1 accent-primary"
              />
              <span className="text-xs text-gray-300 w-4">{overlayPointSize}</span>
            </div>
          )}

          {/* Zoom indicator */}
          {zoom !== 1 && (
            <div className="px-2 py-1 rounded bg-black/60 text-xs text-gray-300 flex items-center gap-1">
              <span>{(zoom * 100).toFixed(0)}%</span>
              <button
                onClick={resetView}
                className="ml-1 p-0.5 rounded hover:bg-gray-700 text-gray-400 hover:text-white"
                title="Reset zoom"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
                  <path d="M3 3v5h5" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Right: Close button */}
        <button
          onClick={onClose}
          className="p-2 rounded-lg bg-black/60 hover:bg-black/80 border border-gray-600 text-white transition-colors"
          title="Close camera view (Esc)"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Canvas container */}
      <div
        ref={containerRef}
        className="flex-1 relative cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {!imageLoaded ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="absolute inset-0 w-full h-full"
          />
        )}
      </div>

      {/* Bottom info bar */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-30 px-4 py-2 rounded-lg bg-black/60 border border-gray-700 text-xs text-gray-400 flex items-center gap-4">
        <span>Scroll to zoom</span>
        <span className="text-gray-600">•</span>
        <span>Drag to pan</span>
        <span className="text-gray-600">•</span>
        <span>Press <kbd className="px-1.5 py-0.5 rounded bg-gray-800 text-gray-300 text-[10px]">Esc</kbd> to close</span>
      </div>
    </div>
  );
};

export default SegmentationCameraOverlay;

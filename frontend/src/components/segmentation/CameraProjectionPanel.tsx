import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import type { PointCloudData, Scene, Frame, CameraCalibration } from '@/types';
import { useSegmentationStore } from '@/store/segmentationStore';
import { projectPointsToCamera } from '@/utils/cameraProjection';

interface CameraProjectionPanelProps {
  pointCloud: PointCloudData | null | undefined;
  classColors: Map<number, string>;
  scene: Scene | null | undefined;
  currentFrame: Frame | null | undefined;
  onClose: () => void;
  rightOffset?: number;
  onCameraSelect?: (cameraName: string | null, imageUrl: string | null, calibration: CameraCalibration | null) => void;
}

interface CameraViewProps {
  cameraName: string;
  imageUrl: string | null;
  calibration: CameraCalibration | null;
  pointCloud: PointCloudData | null | undefined;
  classColors: Map<number, string>;
  labels: Int32Array | null;
  showPoints: boolean;
  pointSize: number;
  showAllPoints?: boolean;
}

const CameraView: React.FC<CameraViewProps> = ({
  cameraName,
  imageUrl,
  calibration,
  pointCloud,
  classColors,
  labels,
  showPoints,
  pointSize,
  showAllPoints = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isPanning = useRef(false);
  const lastMouse = useRef({ x: 0, y: 0 });

  useEffect(() => {
    if (!imageUrl) {
      setImageLoaded(false);
      setImageError(false);
      setBlobUrl(null);
      return;
    }

    let cancelled = false;

    const loadImage = async () => {
      try {
        const authStorage = localStorage.getItem('auth-storage');
        const token = authStorage
          ? JSON.parse(authStorage).state?.accessToken
          : null;

        const response = await fetch(imageUrl, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        if (cancelled) return;

        const url = URL.createObjectURL(blob);
        setBlobUrl(url);

        // Load into Image element for canvas drawing
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          imageRef.current = img;
          setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
          setImageLoaded(true);
          setImageError(false);
        };
        img.onerror = () => {
          if (cancelled) return;
          setImageError(true);
          setImageLoaded(false);
        };
        img.src = url;
      } catch (err) {
        if (cancelled) return;
        console.error('[CameraView] Failed to load image:', err);
        setImageError(true);
        setImageLoaded(false);
      }
    };

    loadImage();

    return () => {
      cancelled = true;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [imageUrl]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  // Draw image and projected points
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const img = imageRef.current;
    const container = containerRef.current;

    if (!canvas || !ctx || !img || !imageLoaded || !container) return;

    // Get container dimensions
    const containerWidth = container.clientWidth;
    const containerHeight = container.clientHeight;

    // Calculate scale to fit image in container while maintaining aspect ratio
    const imgAspect = imageDimensions.width / imageDimensions.height;
    const containerAspect = containerWidth / containerHeight;

    let drawWidth, drawHeight, offsetX = 0, offsetY = 0;

    if (imgAspect > containerAspect) {
      // Image is wider - fit to width
      drawWidth = containerWidth;
      drawHeight = containerWidth / imgAspect;
      offsetY = (containerHeight - drawHeight) / 2;
    } else {
      // Image is taller - fit to height
      drawHeight = containerHeight;
      drawWidth = containerHeight * imgAspect;
      offsetX = (containerWidth - drawWidth) / 2;
    }

    canvas.width = containerWidth;
    canvas.height = containerHeight;

    // Clear canvas
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Apply zoom and pan transform
    ctx.save();
    const centerX = containerWidth / 2;
    const centerY = containerHeight / 2;
    ctx.translate(centerX + pan.x, centerY + pan.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-centerX, -centerY);

    // Draw image
    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

    // Calculate scale for point projection
    const scale = drawWidth / imageDimensions.width;

    // Project and draw points if enabled
    if (showPoints && pointCloud && calibration && pointCloud.positions) {
      const projected = projectPointsToCamera(
        pointCloud.positions,
        pointCloud.pointCount,
        labels,
        calibration,
        imageDimensions.width,
        imageDimensions.height
      );

      // Filter points based on showAllPoints setting
      const pointsToDraw = showAllPoints ? projected : projected.filter(p => p.label >= 0);

      if (pointsToDraw.length > 0) {
        // Draw points - unlabeled colored by depth, labeled by class color
        ctx.globalAlpha = 0.6;

        for (const point of pointsToDraw) {
          let color: string;

          if (point.label >= 0) {
            // Labeled point - use class color
            color = classColors.get(point.label) || '#808080';
          } else {
            // Unlabeled point - color by depth (blue to red gradient)
            const depth = point.depth;
            const normalizedDepth = Math.max(0, Math.min(1, 1 - depth / 80.0));
            const r = Math.round(255 * normalizedDepth);
            const b = Math.round(255 * (1 - normalizedDepth));
            color = `rgb(${r}, 0, ${b})`;
          }

          ctx.beginPath();
          ctx.arc(
            point.x * scale + offsetX,
            point.y * scale + offsetY,
            point.label >= 0 ? pointSize : Math.max(1, pointSize - 1),
            0,
            2 * Math.PI
          );
          ctx.fillStyle = color;
          ctx.fill();
        }

        // Reset opacity
        ctx.globalAlpha = 1.0;
      }
    }

    // Restore transform
    ctx.restore();
  }, [imageLoaded, imageDimensions, showPoints, showAllPoints, pointCloud, calibration, labels, classColors, pointSize, cameraName, zoom, pan]);

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
      .replace(/CAM_/i, '')
      .replace(/FRONT/i, 'Front')
      .replace(/REAR/i, 'Rear')
      .replace(/LEFT/i, 'Left')
      .replace(/RIGHT/i, 'Right')
      .toLowerCase()
      .replace(/\b\w/g, l => l.toUpperCase());
  }, [cameraName]);

  return (
    <div className="flex-shrink-0 flex flex-col bg-gray-900 rounded overflow-hidden border border-gray-700 h-full">
      {/* Camera content */}
      <div
        ref={containerRef}
        className="relative flex-1 min-h-0 bg-black cursor-grab active:cursor-grabbing"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
      >
        {!imageUrl ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-xs">
            No image
          </div>
        ) : imageError ? (
          <div className="absolute inset-0 flex items-center justify-center text-red-400 text-xs">
            Failed to load
          </div>
        ) : !imageLoaded ? (
          <div className="absolute inset-0 flex items-center justify-center text-gray-500 text-xs">
            <div className="w-4 h-4 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : null}

        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ display: imageLoaded ? 'block' : 'none' }}
        />

        {/* Camera label overlay - top left */}
        <div className="absolute top-0 left-0 px-2 py-1 bg-black/60 rounded-br">
          <span className="text-xs text-white font-semibold">{displayName}</span>
        </div>

        {/* Zoom controls */}
        <div className="absolute bottom-1 right-1 flex items-center gap-1 bg-black/60 rounded px-1">
          <button
            onClick={() => setZoom(z => Math.min(5, z * 1.2))}
            className="text-white/80 hover:text-white px-1 py-0.5 text-xs font-bold"
            title="Zoom in"
          >
            +
          </button>
          <span className="text-white/60 text-[10px] min-w-[32px] text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            onClick={() => setZoom(z => Math.max(0.5, z / 1.2))}
            className="text-white/80 hover:text-white px-1 py-0.5 text-xs font-bold"
            title="Zoom out"
          >
            −
          </button>
          {zoom !== 1 && (
            <button
              onClick={resetView}
              className="text-white/60 hover:text-white px-1 py-0.5 text-[10px]"
              title="Reset view"
            >
              ⟲
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

// Simplified thumbnail view component for the grid
const CameraThumbnailView: React.FC<CameraViewProps> = ({
  cameraName,
  imageUrl,
  calibration,
  pointCloud,
  classColors,
  labels,
  showPoints,
  pointSize,
  showAllPoints = true,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [imageDimensions, setImageDimensions] = useState({ width: 0, height: 0 });
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  // Load image with authentication
  useEffect(() => {
    if (!imageUrl) {
      setImageLoaded(false);
      setImageError(false);
      setBlobUrl(null);
      return;
    }

    let cancelled = false;

    const loadImage = async () => {
      try {
        const authStorage = localStorage.getItem('auth-storage');
        const token = authStorage
          ? JSON.parse(authStorage).state?.accessToken
          : null;

        const response = await fetch(imageUrl, {
          headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const blob = await response.blob();
        if (cancelled) return;

        const url = URL.createObjectURL(blob);
        setBlobUrl(url);

        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          imageRef.current = img;
          setImageDimensions({ width: img.naturalWidth, height: img.naturalHeight });
          setImageLoaded(true);
          setImageError(false);
        };
        img.onerror = () => {
          if (cancelled) return;
          setImageError(true);
          setImageLoaded(false);
        };
        img.src = url;
      } catch (err) {
        if (cancelled) return;
        setImageError(true);
        setImageLoaded(false);
      }
    };

    loadImage();

    return () => {
      cancelled = true;
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [imageUrl]);

  // Cleanup blob URL on unmount
  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  // Draw image and projected points
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

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);

    // Calculate scale for point projection
    const scale = drawWidth / imageDimensions.width;

    // Project and draw points if enabled
    if (showPoints && pointCloud && calibration && pointCloud.positions) {
      const projected = projectPointsToCamera(
        pointCloud.positions,
        pointCloud.pointCount,
        labels,
        calibration,
        imageDimensions.width,
        imageDimensions.height
      );

      // Filter points based on showAllPoints setting
      const pointsToDraw = showAllPoints ? projected : projected.filter(p => p.label >= 0);

      if (pointsToDraw.length > 0) {
        ctx.globalAlpha = 0.5;

        for (const point of pointsToDraw) {
          let color: string;

          if (point.label >= 0) {
            color = classColors.get(point.label) || '#808080';
          } else {
            // Color by depth for unlabeled points
            const normalizedDepth = Math.max(0, Math.min(1, 1 - point.depth / 80.0));
            const r = Math.round(255 * normalizedDepth);
            const b = Math.round(255 * (1 - normalizedDepth));
            color = `rgb(${r}, 0, ${b})`;
          }

          ctx.beginPath();
          ctx.arc(
            point.x * scale + offsetX,
            point.y * scale + offsetY,
            pointSize,
            0,
            2 * Math.PI
          );
          ctx.fillStyle = color;
          ctx.fill();
        }

        ctx.globalAlpha = 1.0;
      }
    }
  }, [imageLoaded, imageDimensions, showPoints, showAllPoints, pointCloud, calibration, labels, classColors, pointSize, cameraName]);

  return (
    <div ref={containerRef} className="relative w-full h-full bg-black">
      {!imageUrl ? (
        <div className="absolute inset-0 flex items-center justify-center text-gray-600 text-[10px]">
          No image
        </div>
      ) : imageError ? (
        <div className="absolute inset-0 flex items-center justify-center text-red-400 text-[10px]">
          Failed
        </div>
      ) : !imageLoaded ? (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-3 h-3 border-2 border-gray-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : null}

      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ display: imageLoaded ? 'block' : 'none' }}
      />
    </div>
  );
};

export const CameraProjectionPanel: React.FC<CameraProjectionPanelProps> = ({
  pointCloud,
  classColors,
  scene,
  currentFrame,
  onClose,
  rightOffset = 0,
  onCameraSelect,
}) => {
  const [panelHeight, setPanelHeight] = useState(280);
  const [isResizing, setIsResizing] = useState(false);
  const [showPoints, setShowPoints] = useState(true);
  const [pointSize, setPointSize] = useState(2);
  const [selectedCamera, setSelectedCamera] = useState<string | null>(null);
  const [showAllPoints, setShowAllPoints] = useState(true); // Show all points or only labeled
  const resizeRef = useRef<HTMLDivElement>(null);

  const getLabelsForFrame = useSegmentationStore((s) => s.getLabelsForFrame);
  const currentFrameIndex = useSegmentationStore((s) => s.currentFrameIndex);
  // Subscribe to frameSegmentations to trigger re-render when labels change
  const frameSegmentations = useSegmentationStore((s) => s.frameSegmentations);

  // Get labels for current frame - depends on frameSegmentations for reactivity
  const labels = useMemo(() => {
    // This dependency on frameSegmentations triggers re-computation when labels update
    void frameSegmentations;
    return getLabelsForFrame(currentFrameIndex);
  }, [getLabelsForFrame, currentFrameIndex, frameSegmentations]);

  // Get camera names and calibrations
  const cameras = useMemo(() => {
    const cameraList: Array<{
      name: string;
      imageUrl: string | null;
      calibration: CameraCalibration | null;
    }> = [];

    // Get cameras from calibration if available
    const calibrations = scene?.calibration?.lidar_to_cameras;
    const cameraBasePaths = scene?.storage_paths?.cameras;

    if (calibrations) {
      Object.keys(calibrations).forEach(camName => {
        // Build image URL from scene's camera base path + frame's camera filename
        let imageUrl: string | null = null;
        const cameraFilename = currentFrame?.file_paths?.cameras?.[camName];
        const cameraBase = cameraBasePaths?.[camName];

        if (cameraFilename && cameraBase) {
          const base = cameraBase.replace(/\/$/, '');
          // Route through API endpoint for proper file serving
          imageUrl = `/api/v1/data/image/${base}/${cameraFilename}`;
        }

        cameraList.push({
          name: camName,
          imageUrl,
          calibration: calibrations[camName],
        });
      });
    } else if (currentFrame?.file_paths?.cameras) {
      // Fall back to frame's camera paths without calibration
      Object.keys(currentFrame.file_paths.cameras).forEach(camName => {
        let imageUrl: string | null = null;
        const cameraFilename = currentFrame.file_paths.cameras[camName];
        const cameraBase = cameraBasePaths?.[camName];

        if (cameraFilename && cameraBase) {
          const base = cameraBase.replace(/\/$/, '');
          // Route through API endpoint for proper file serving
          imageUrl = `/api/v1/data/image/${base}/${cameraFilename}`;
        }

        cameraList.push({
          name: camName,
          imageUrl,
          calibration: null,
        });
      });
    }

    // Sort cameras in logical order: front, front_left, front_right, rear, rear_left, rear_right
    const order = ['front', 'front_left', 'front_right', 'rear', 'rear_left', 'rear_right'];
    cameraList.sort((a, b) => {
      const aLower = a.name.toLowerCase();
      const bLower = b.name.toLowerCase();
      const aIdx = order.findIndex(o => aLower.includes(o.replace('_', ''))) || order.findIndex(o => aLower.includes(o));
      const bIdx = order.findIndex(o => bLower.includes(o.replace('_', ''))) || order.findIndex(o => bLower.includes(o));
      if (aIdx === -1 && bIdx === -1) return a.name.localeCompare(b.name);
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });

    // Debug: log camera URLs
    console.log('[CameraProjectionPanel] Cameras:', cameraList.map(c => ({ name: c.name, imageUrl: c.imageUrl })));
    console.log('[CameraProjectionPanel] Scene storage_paths.cameras:', scene?.storage_paths?.cameras);
    console.log('[CameraProjectionPanel] Frame file_paths.cameras:', currentFrame?.file_paths?.cameras);

    return cameraList;
  }, [scene, currentFrame]);

  // Handle resize drag
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startY = e.clientY;
    const startHeight = panelHeight;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaY = startY - e.clientY;
      const newHeight = Math.max(120, Math.min(400, startHeight + deltaY));
      setPanelHeight(newHeight);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [panelHeight]);

  if (cameras.length === 0) {
    return (
      <div
        className="absolute bottom-0 left-0 border-t border-gray-700 bg-dark-panel z-10 flex flex-col"
        style={{ height: panelHeight, right: rightOffset }}
      >
        {/* Header with close button — always visible even with no images */}
        <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700 shrink-0">
          <span className="text-xs text-gray-400 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5 text-gray-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            Camera Views
          </span>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
            title="Hide camera panel"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 flex items-center justify-center text-gray-500 text-sm">
          <div className="text-center">
            <svg className="w-8 h-8 mx-auto mb-2 text-gray-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            <p>No camera images available</p>
          </div>
        </div>
      </div>
    );
  }

  // Get selected camera data
  const selectedCameraData = selectedCamera ? cameras.find(c => c.name === selectedCamera) : null;

  // Calculate heights for expanded view - only show when no parent handler is provided
  const showExpandedView = !onCameraSelect && selectedCamera && selectedCameraData;
  const expandedViewHeight = showExpandedView ? 500 : 0;
  const totalPanelHeight = panelHeight + expandedViewHeight;

  return (
    <div
      className="absolute bottom-0 left-0 border-t border-gray-700 bg-dark-panel flex flex-col z-10"
      style={{ height: totalPanelHeight, right: rightOffset }}
    >
      {/* Expanded Camera View (when camera selected and no parent handler) */}
      {showExpandedView && (
        <div className="flex-shrink-0 border-b border-gray-700" style={{ height: expandedViewHeight }}>
          <div className="h-full flex flex-col">
            {/* Expanded view header */}
            <div className="flex items-center justify-between px-3 py-2 bg-dark-panel border-b border-gray-700/50 flex-shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setSelectedCamera(null)}
                  className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
                  title="Close expanded view"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 19l-7-7 7-7" />
                  </svg>
                </button>
                <span className="text-sm text-white font-medium flex items-center gap-2">
                  <svg className="w-4 h-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="2" y="3" width="20" height="14" rx="2" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  {selectedCameraData.name.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                </span>
                <span className="px-2 py-0.5 rounded text-xs bg-primary/20 text-primary-light border border-primary/30">
                  2D Overlay
                </span>
              </div>

              <div className="flex items-center gap-3">
                {/* Toggle All Points vs Labeled Only */}
                <button
                  onClick={() => setShowAllPoints(!showAllPoints)}
                  className={`px-2 py-0.5 rounded text-xs font-medium transition-colors ${
                    showAllPoints
                      ? 'bg-blue-500/30 text-blue-300 hover:bg-blue-500/40'
                      : 'bg-purple-500/30 text-purple-300 hover:bg-purple-500/40'
                  }`}
                  title={showAllPoints ? 'Show only labeled points' : 'Show all points'}
                >
                  {showAllPoints ? 'All Points' : 'Labeled Only'}
                </button>

                {/* LiDAR Frame indicator */}
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <svg className="w-3.5 h-3.5 text-primary" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="2" />
                  </svg>
                  <span>LiDAR Frame</span>
                  <span className="text-red-400">X</span>
                  <span className="mx-1">—</span>
                  <span className="text-green-400">Y</span>
                  <span className="mx-1">—</span>
                  <span className="text-blue-400">Z</span>
                </div>
              </div>
            </div>

            {/* Expanded camera view */}
            <div className="flex-1 min-h-0 relative">
              <CameraView
                cameraName={selectedCameraData.name}
                imageUrl={selectedCameraData.imageUrl}
                calibration={selectedCameraData.calibration}
                pointCloud={pointCloud}
                classColors={classColors}
                labels={labels}
                showPoints={showPoints}
                pointSize={pointSize}
                showAllPoints={showAllPoints}
              />
            </div>
          </div>
        </div>
      )}

      {/* Resize handle */}
      <div
        ref={resizeRef}
        onMouseDown={handleResizeStart}
        className={`h-1 cursor-row-resize flex-shrink-0 flex items-center justify-center group ${
          isResizing ? 'bg-primary/30' : 'hover:bg-gray-600/50'
        }`}
      >
        <div className="w-12 h-0.5 bg-gray-600 rounded group-hover:bg-gray-500" />
      </div>

      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-700/50 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-300 font-medium flex items-center gap-2">
            <svg className="w-3.5 h-3.5 text-gray-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="2" y="3" width="20" height="14" rx="2" />
              <circle cx="12" cy="10" r="3" />
            </svg>
            All Cameras ({cameras.length})
          </span>
          <span className="text-[10px] text-gray-500">Click on a camera to expand</span>
        </div>

        <div className="flex items-center gap-3">
          {/* Point overlay toggle */}
          <button
            onClick={() => setShowPoints(!showPoints)}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] transition-colors ${
              showPoints
                ? 'bg-primary/20 text-primary-light border border-primary/30'
                : 'text-gray-500 hover:text-gray-300 border border-transparent'
            }`}
            title={showPoints ? 'Hide projected points' : 'Show projected points'}
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
              <circle cx="12" cy="12" r="3" />
              <circle cx="6" cy="6" r="2" />
              <circle cx="18" cy="6" r="2" />
              <circle cx="6" cy="18" r="2" />
              <circle cx="18" cy="18" r="2" />
            </svg>
            Points
          </button>

          {/* Point size controls */}
          {showPoints && (
            <div className="flex items-center gap-1 text-gray-400">
              <span className="text-[10px] text-gray-500 mr-1">Size:</span>
              <button
                onClick={() => setPointSize(Math.max(1, pointSize - 1))}
                className="p-0.5 hover:text-white rounded hover:bg-gray-700"
                title="Decrease point size"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
              <span className="text-[10px] w-4 text-center">{pointSize}</span>
              <button
                onClick={() => setPointSize(Math.min(8, pointSize + 1))}
                className="p-0.5 hover:text-white rounded hover:bg-gray-700"
                title="Increase point size"
              >
                <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
          )}

          <span className="text-[10px] text-gray-500 border-l border-gray-700 pl-3">Drag to resize</span>

          {/* Close button */}
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors"
            title="Hide camera panel"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Camera thumbnail grid */}
      <div className="flex-1 min-h-0 overflow-auto p-2" style={{ height: panelHeight - 40 }}>
        <div className="grid grid-cols-4 gap-2 h-full">
          {cameras.map(cam => {
            const isSelected = selectedCamera === cam.name;
            return (
              <div
                key={cam.name}
                className={`relative cursor-pointer rounded overflow-hidden border-2 transition-all ${
                  isSelected
                    ? 'border-primary ring-1 ring-primary/30'
                    : 'border-gray-700 hover:border-gray-500'
                }`}
                onClick={() => {
                  // Call parent handler to open full-viewport camera view
                  if (onCameraSelect) {
                    onCameraSelect(cam.name, cam.imageUrl, cam.calibration);
                  } else {
                    // Fallback to local expanded view if no parent handler
                    setSelectedCamera(isSelected ? null : cam.name);
                  }
                }}
              >
                {/* Thumbnail image - no points overlay, only show image */}
                <CameraThumbnailView
                  cameraName={cam.name}
                  imageUrl={cam.imageUrl}
                  calibration={cam.calibration}
                  pointCloud={pointCloud}
                  classColors={classColors}
                  labels={labels}
                  showPoints={false}
                  pointSize={Math.max(1, pointSize - 1)}
                  showAllPoints={showAllPoints}
                />

                {/* Camera name overlay */}
                <div className="absolute bottom-0 left-0 right-0 px-2 py-1 bg-gradient-to-t from-black/80 to-transparent">
                  <span className="text-[10px] text-white font-medium">
                    {cam.name.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}
                  </span>
                </div>

                {/* Selected indicator */}
                {isSelected && (
                  <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-primary" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default CameraProjectionPanel;

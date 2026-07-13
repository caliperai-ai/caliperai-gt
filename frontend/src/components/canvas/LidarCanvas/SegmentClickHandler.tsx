import React, { useCallback, useRef, useEffect } from 'react';
import { useSegmentTo3DStore } from '@/store/segmentTo3DStore';
import { aiSegmentApi } from '@/api/client';

interface SegmentClickHandlerProps {
  displayWidth: number;
  displayHeight: number;
  imageWidth: number;
  imageHeight: number;
  offsetX: number;
  offsetY: number;
  zoom?: number;
  pan?: { x: number; y: number };
  imageUrl?: string;
  onZoomChange?: (zoom: number) => void;
}

export const SegmentClickHandler: React.FC<SegmentClickHandlerProps> = ({
  displayWidth,
  displayHeight,
  imageWidth,
  imageHeight,
  offsetX,
  offsetY,
  zoom = 1,
  pan = { x: 0, y: 0 },
  imageUrl,
  onZoomChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const segmentTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const {
    isActive,
    currentStep,
    promptPoints,
    addPromptPoint,
    setSegmenting,
    setSegmentationResults,
    setError,
    setAutoCreateAfterSegment,
  } = useSegmentTo3DStore();

  useEffect(() => {
    if (!isActive || currentStep !== 'clicking' || promptPoints.length === 0 || !imageUrl) {
      return;
    }

    if (segmentTimeoutRef.current) {
      clearTimeout(segmentTimeoutRef.current);
    }

    segmentTimeoutRef.current = setTimeout(async () => {
      console.log('[SegmentClickHandler] Auto-triggering segmentation...');
      setSegmenting(true);
      setError(null);

      try {
        const response = await aiSegmentApi.segment({
          image_url: imageUrl,
          points: promptPoints.map(p => ({
            x: p.x,
            y: p.y,
            label: p.label,
          })),
          simplify_tolerance: 0.005,
        });

        if (response.masks && response.masks.length > 0) {
          setSegmentationResults(
            response.masks.map(m => ({
              polygon: m.polygon.map(p => ({ x: p.x, y: p.y })),
              score: m.score,
              area: m.area,
            }))
          );
          console.log('[SegmentClickHandler] Auto-segment complete:', response.masks.length, 'masks');
        } else {
          setError('No segments found. Try clicking on a different part of the object.');
        }
      } catch (err) {
        console.error('[SegmentClickHandler] Auto-segment failed:', err);
        setError(`Segmentation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
      }
    }, 500);

    return () => {
      if (segmentTimeoutRef.current) {
        clearTimeout(segmentTimeoutRef.current);
      }
    };
  }, [isActive, currentStep, promptPoints, imageUrl, setSegmenting, setSegmentationResults, setError]);

  // Convert canvas coordinates to image coordinates
  const canvasToImage = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
    const container = containerRef.current;
    if (!container) return null;

    const rect = container.getBoundingClientRect();
    const canvasX = clientX - rect.left;
    const canvasY = clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    // Reverse zoom and pan
    const x = (canvasX - pan.x - centerX) / zoom + centerX;
    const y = (canvasY - pan.y - centerY) / zoom + centerY;

    // Convert to image coordinates
    const scaleX = displayWidth / imageWidth;
    const scaleY = displayHeight / imageHeight;

    const imgX = (x - offsetX) / scaleX;
    const imgY = (y - offsetY) / scaleY;

    // Check if within image bounds
    if (imgX < 0 || imgX >= imageWidth || imgY < 0 || imgY >= imageHeight) {
      return null;
    }

    return { x: imgX, y: imgY };
  }, [displayWidth, displayHeight, imageWidth, imageHeight, offsetX, offsetY, zoom, pan]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Allow clicking in 'clicking' state or 'done' state (for continuous annotation)
    if (!isActive || (currentStep !== 'clicking' && currentStep !== 'done')) return;

    e.preventDefault();
    e.stopPropagation();

    const imageCoords = canvasToImage(e.clientX, e.clientY);
    if (!imageCoords) return;

    // If we're in 'done' state, reset first to start fresh
    if (currentStep === 'done') {
      useSegmentTo3DStore.getState().reset();
    }

    // Shift+click = auto-create box with auto heading (skip heading picker)
    // This is a power-user shortcut for faster annotation
    if (e.shiftKey && promptPoints.length === 0) {
      setAutoCreateAfterSegment(true);
      console.log('[SegmentClickHandler] Shift+click: will auto-create box after segmentation');
    }

    // Always add as positive prompt (label=1)
    // Right-click still adds negative prompts
    addPromptPoint({
      x: imageCoords.x,
      y: imageCoords.y,
      label: 1,
    });

    console.log('[SegmentClickHandler] Added prompt point:', {
      x: imageCoords.x.toFixed(1),
      y: imageCoords.y.toFixed(1),
      label: 'positive',
      autoCreate: e.shiftKey && promptPoints.length === 0,
    });
  }, [isActive, currentStep, canvasToImage, addPromptPoint, promptPoints.length, setAutoCreateAfterSegment]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    if (!isActive || currentStep !== 'clicking') return;

    e.preventDefault();
    e.stopPropagation();

    const imageCoords = canvasToImage(e.clientX, e.clientY);
    if (!imageCoords) return;

    // Right click = negative (exclude)
    addPromptPoint({
      x: imageCoords.x,
      y: imageCoords.y,
      label: 0,
    });

    console.log('[SegmentClickHandler] Added negative prompt point:', {
      x: imageCoords.x.toFixed(1),
      y: imageCoords.y.toFixed(1),
    });
  }, [isActive, currentStep, canvasToImage, addPromptPoint]);

  // Wheel handler - forward zoom events
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!onZoomChange) return;
    e.preventDefault();

    const zoomFactor = 1.1;
    const delta = e.deltaY > 0 ? -1 : 1;
    const newZoom = delta > 0
      ? Math.min(zoom * zoomFactor, 10)
      : Math.max(zoom / zoomFactor, 0.5);

    onZoomChange(newZoom);
  }, [zoom, onZoomChange]);

  // Only show when in clicking mode
  if (!isActive || currentStep !== 'clicking') {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="absolute inset-0"
      style={{
        zIndex: 50,
        cursor: 'crosshair',
        pointerEvents: 'auto',
        // Visual indicator that segment mode is active
        boxShadow: 'inset 0 0 0 3px rgba(59, 130, 246, 0.6)',
      }}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onWheel={handleWheel}
      onPointerDown={(e) => {
        // Prevent CameraViewOverlay from capturing pointer
        e.stopPropagation();
      }}
    />
  );
};

export default SegmentClickHandler;

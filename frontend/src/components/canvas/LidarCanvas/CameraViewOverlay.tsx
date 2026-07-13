import React, { useRef, useEffect, useCallback } from 'react';

interface CameraViewOverlayProps {
  imageUrl: string;
  cameraId: string;
  opacity?: number;
  onExit?: () => void;
  onImageLoad?: (dimensions: { width: number; height: number; offsetX: number; offsetY: number; naturalWidth: number; naturalHeight: number }) => void;
  zoom?: number;
  pan?: { x: number; y: number };
  onZoomChange?: (zoom: number) => void;
  onPanChange?: (pan: { x: number; y: number }) => void;
}

export const CameraViewOverlay: React.FC<CameraViewOverlayProps> = ({
  imageUrl,
  cameraId,
  opacity = 1.0,
  onImageLoad,
  zoom = 1,
  pan = { x: 0, y: 0 },
  onZoomChange,
  onPanChange,
}) => {
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const lastPointer = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const img = imgRef.current;
    const container = containerRef.current;
    if (!img || !container) return;

    const updateDimensions = () => {
      const containerRect = container.getBoundingClientRect();
      const imgNaturalWidth = img.naturalWidth;
      const imgNaturalHeight = img.naturalHeight;

      if (!imgNaturalWidth || !imgNaturalHeight) return;

      const containerAspect = containerRect.width / containerRect.height;
      const imgAspect = imgNaturalWidth / imgNaturalHeight;

      let displayWidth: number, displayHeight: number;
      if (containerAspect > imgAspect) {
        displayHeight = containerRect.height;
        displayWidth = displayHeight * imgAspect;
      } else {
        displayWidth = containerRect.width;
        displayHeight = displayWidth / imgAspect;
      }

      const offsetX = (containerRect.width - displayWidth) / 2;
      const offsetY = (containerRect.height - displayHeight) / 2;

      console.log('[CameraViewOverlay] Dimensions:', {
        container: { width: containerRect.width, height: containerRect.height },
        display: { width: displayWidth, height: displayHeight },
        offset: { x: offsetX, y: offsetY },
        natural: { width: imgNaturalWidth, height: imgNaturalHeight },
        scaleFromNatural: { x: displayWidth / imgNaturalWidth, y: displayHeight / imgNaturalHeight },
      });

      if (onImageLoad && displayWidth > 0 && displayHeight > 0) {
        onImageLoad({
          width: displayWidth,
          height: displayHeight,
          offsetX,
          offsetY,
          naturalWidth: imgNaturalWidth,
          naturalHeight: imgNaturalHeight
        });
      }
    };

    img.addEventListener('load', updateDimensions);

    const resizeObserver = new ResizeObserver(() => {
      updateDimensions();
    });
    resizeObserver.observe(container);

    if (img.complete) {
      updateDimensions();
    }

    return () => {
      img.removeEventListener('load', updateDimensions);
      resizeObserver.disconnect();
    };
  }, [imageUrl, onImageLoad]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!onZoomChange) return;
    e.preventDefault();
    e.stopPropagation();

    const zoomFactor = 1.1;
    const delta = e.deltaY > 0 ? -1 : 1;
    const newZoom = delta > 0
      ? Math.min(zoom * zoomFactor, 10)
      : Math.max(zoom / zoomFactor, 0.5);

    onZoomChange(newZoom);
  }, [zoom, onZoomChange]);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (!onPanChange) return;
    isDragging.current = true;
    lastPointer.current = { x: e.clientX, y: e.clientY };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [onPanChange]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging.current || !onPanChange) return;

    const dx = e.clientX - lastPointer.current.x;
    const dy = e.clientY - lastPointer.current.y;
    lastPointer.current = { x: e.clientX, y: e.clientY };

    onPanChange({ x: pan.x + dx, y: pan.y + dy });
  }, [pan, onPanChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    isDragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (onZoomChange) onZoomChange(1);
    if (onPanChange) onPanChange({ x: 0, y: 0 });
  }, [onZoomChange, onPanChange]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 z-0 flex items-center justify-center bg-black"
      style={{
        cursor: zoom > 1 ? 'grab' : 'default',
        pointerEvents: 'auto',
      }}
      onWheel={handleWheel}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    >
      {/* Camera image - centered with zoom/pan transforms */}
      <img
        ref={imgRef}
        src={imageUrl}
        alt={cameraId}
        className="max-w-full max-h-full object-contain"
        style={{
          opacity,
          transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
          transformOrigin: 'center center',
          pointerEvents: 'none',
        }}
        draggable={false}
      />

      {/* Zoom indicator */}
      {zoom !== 1 && (
        <div className="absolute bottom-4 right-4 px-2 py-1 bg-black/70 rounded text-white text-xs pointer-events-none">
          {Math.round(zoom * 100)}%
        </div>
      )}
    </div>
  );
};

export default CameraViewOverlay;

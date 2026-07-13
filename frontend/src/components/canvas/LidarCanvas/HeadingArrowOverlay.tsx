import React, { useRef, useEffect, useCallback } from 'react';
import { useSegmentTo3DStore } from '@/store/segmentTo3DStore';

interface HeadingArrowOverlayProps {
  displayWidth: number;
  displayHeight: number;
  imageWidth: number;
  imageHeight: number;
  offsetX: number;
  offsetY: number;
  zoom?: number;
  pan?: { x: number; y: number };
}

export const HeadingArrowOverlay: React.FC<HeadingArrowOverlayProps> = ({
  displayWidth,
  displayHeight,
  imageWidth,
  imageHeight,
  offsetX,
  offsetY,
  zoom = 1,
  pan = { x: 0, y: 0 },
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { isActive, headingArrow } = useSegmentTo3DStore();

  const imageToCanvas = useCallback((x: number, y: number) => {
    const scaleX = displayWidth / imageWidth;
    const scaleY = displayHeight / imageHeight;
    const canvasX = x * scaleX + offsetX;
    const canvasY = y * scaleY + offsetY;
    const parent = canvasRef.current?.parentElement;
    if (!parent) return { x: canvasX, y: canvasY };
    const centerX = parent.clientWidth / 2;
    const centerY = parent.clientHeight / 2;
    return {
      x: (canvasX - centerX) * zoom + centerX + pan.x,
      y: (canvasY - centerY) * zoom + centerY + pan.y,
    };
  }, [displayWidth, displayHeight, imageWidth, imageHeight, offsetX, offsetY, zoom, pan]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!isActive || !headingArrow) return;
    if (headingArrow.startImageX === 0 && headingArrow.endImageX === 0) return;

    const s = imageToCanvas(headingArrow.startImageX, headingArrow.startImageY);
    const e = imageToCanvas(headingArrow.endImageX, headingArrow.endImageY);

    const dx = e.x - s.x;
    const dy = e.y - s.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 2) return;

    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(e.x, e.y);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 3;
    ctx.stroke();

    const headLen = Math.min(20, len * 0.3);
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(e.x - headLen * Math.cos(angle - Math.PI / 6), e.y - headLen * Math.sin(angle - Math.PI / 6));
    ctx.moveTo(e.x, e.y);
    ctx.lineTo(e.x - headLen * Math.cos(angle + Math.PI / 6), e.y - headLen * Math.sin(angle + Math.PI / 6));
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(s.x, s.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fbbf24';
    ctx.fill();

    const deg = ((headingArrow.yaw * 180) / Math.PI).toFixed(1);
    const midX = (s.x + e.x) / 2;
    const midY = (s.y + e.y) / 2 - 14;
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.fillRect(midX - 40, midY - 12, 80, 20);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`Heading ${deg}°`, midX, midY + 2);
  }, [isActive, headingArrow, imageToCanvas]);

  if (!isActive || !headingArrow) return null;

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      style={{ zIndex: 15, pointerEvents: 'none' }}
    />
  );
};

export default HeadingArrowOverlay;

import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { useEditorStore } from '@/store/editorStore';
import type { CameraCalibration, CuboidData } from '@/types';

interface HeadingRotationWidgetProps {
  displayWidth: number;
  displayHeight: number;
  imageWidth: number;
  imageHeight: number;
  offsetX: number;
  offsetY: number;
  zoom?: number;
  pan?: { x: number; y: number };
  calibration?: CameraCalibration | null;
}

const RING_RADIUS = 40;
const RING_LINE_WIDTH = 4;
const HANDLE_RADIUS = 8;

function projectToImage(
  x: number, y: number, z: number,
  calibration: CameraCalibration,
  imageWidth: number, imageHeight: number,
): { u: number; v: number; behind: boolean } {
  const { extrinsic, intrinsic } = calibration;
  const R = extrinsic.rotation;
  const t = extrinsic.translation;
  const { fx, fy, cx, cy } = intrinsic;

  const camX = R[0][0] * x + R[0][1] * y + R[0][2] * z + t[0];
  const camY = R[1][0] * x + R[1][1] * y + R[1][2] * z + t[1];
  const camZ = R[2][0] * x + R[2][1] * y + R[2][2] * z + t[2];

  if (camZ <= 0.1) return { u: 0, v: 0, behind: true };

  const u_calib = (fx * camX) / camZ + cx;
  const v_calib = (fy * camY) / camZ + cy;

  const calibRes = intrinsic.resolution || [imageWidth, imageHeight];
  return {
    u: u_calib * (imageWidth / calibRes[0]),
    v: v_calib * (imageHeight / calibRes[1]),
    behind: false,
  };
}

function screenAngleToWorldYaw(
  screenAngle: number,
  calibration: CameraCalibration,
): number {

  const R = calibration.extrinsic.rotation;


  let bestYaw = 0;
  let bestDist = Infinity;

  for (let i = 0; i < 360; i++) {
    const candidateYaw = ((i - 180) * Math.PI) / 180;
    const hx = Math.cos(candidateYaw);
    const hy = Math.sin(candidateYaw);

    const camDx = R[0][0] * hx + R[0][1] * hy;
    const camDy = R[1][0] * hx + R[1][1] * hy;
    const camDz = R[2][0] * hx + R[2][1] * hy;

    if (camDz < -0.9) continue;

    const screenAng = Math.atan2(camDy, camDx);
    let diff = screenAng - screenAngle;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;

    if (Math.abs(diff) < bestDist) {
      bestDist = Math.abs(diff);
      bestYaw = candidateYaw;
    }
  }

  return bestYaw;
}

export const HeadingRotationWidget: React.FC<HeadingRotationWidgetProps> = ({
  displayWidth,
  displayHeight,
  imageWidth,
  imageHeight,
  offsetX,
  offsetY,
  zoom = 1,
  pan = { x: 0, y: 0 },
  calibration,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const {
    selection,
    annotations,
    updateAnnotation,
  } = useEditorStore();

  const selectedId = selection.selectedAnnotationIds[0] ?? null;
  const selectedAnnotation = selectedId ? annotations.get(selectedId) : null;

  const cuboidData: CuboidData | null = useMemo(() => {
    if (!selectedAnnotation || selectedAnnotation.type !== 'cuboid') return null;
    return selectedAnnotation.data as CuboidData;
  }, [selectedAnnotation]);

  const projected2D = useMemo(() => {
    if (!cuboidData || !calibration) return null;
    const { x, y, z } = cuboidData.center;
    const p = projectToImage(x, y, z, calibration, imageWidth, imageHeight);
    if (p.behind) return null;
    if (p.u < -50 || p.u > imageWidth + 50 || p.v < -50 || p.v > imageHeight + 50) return null;
    return p;
  }, [cuboidData, calibration, imageWidth, imageHeight]);

  const headingScreenAngle = useMemo(() => {
    if (!cuboidData || !calibration) return 0;
    const yaw = cuboidData.rotation.yaw;
    const R = calibration.extrinsic.rotation;
    const hx = Math.cos(yaw);
    const hy = Math.sin(yaw);
    const camDx = R[0][0] * hx + R[0][1] * hy;
    const camDy = R[1][0] * hx + R[1][1] * hy;
    return Math.atan2(camDy, camDx);
  }, [cuboidData, calibration]);

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

    if (!projected2D || !cuboidData) return;

    const center = imageToCanvas(projected2D.u, projected2D.v);
    const angle = headingScreenAngle;

    ctx.beginPath();
    ctx.arc(center.x, center.y, RING_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = RING_LINE_WIDTH;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(center.x, center.y, RING_RADIUS, angle - 0.4, angle + 0.4);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = RING_LINE_WIDTH + 2;
    ctx.stroke();

    const arrowEndX = center.x + Math.cos(angle) * (RING_RADIUS + 8);
    const arrowEndY = center.y + Math.sin(angle) * (RING_RADIUS + 8);

    ctx.beginPath();
    ctx.moveTo(center.x, center.y);
    ctx.lineTo(arrowEndX, arrowEndY);
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([]);
    ctx.stroke();

    const headLen = 12;
    ctx.beginPath();
    ctx.moveTo(arrowEndX, arrowEndY);
    ctx.lineTo(
      arrowEndX - headLen * Math.cos(angle - Math.PI / 6),
      arrowEndY - headLen * Math.sin(angle - Math.PI / 6),
    );
    ctx.moveTo(arrowEndX, arrowEndY);
    ctx.lineTo(
      arrowEndX - headLen * Math.cos(angle + Math.PI / 6),
      arrowEndY - headLen * Math.sin(angle + Math.PI / 6),
    );
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const handleX = center.x + Math.cos(angle) * RING_RADIUS;
    const handleY = center.y + Math.sin(angle) * RING_RADIUS;

    ctx.beginPath();
    ctx.arc(handleX, handleY, HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = isDragging ? '#f59e0b' : '#fbbf24';
    ctx.fill();
    ctx.strokeStyle = 'white';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(center.x, center.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fill();

    const degStr = ((cuboidData.rotation.yaw * 180) / Math.PI).toFixed(1) + '°';
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.fillRect(center.x - 30, center.y + RING_RADIUS + 16, 60, 20);
    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(degStr, center.x, center.y + RING_RADIUS + 30);

  }, [projected2D, cuboidData, headingScreenAngle, imageToCanvas, isDragging]);

  if (!cuboidData || !calibration || !projected2D) return null;

  const widgetCenter = imageToCanvas(projected2D.u, projected2D.v);
  const interactionSize = (RING_RADIUS + 24) * 2;

  return (
    <>
      {/* Render-only canvas (no pointer events) */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        style={{
          zIndex: 22,
          pointerEvents: 'none',
        }}
      />
      {/* Interaction area - small positioned div around the ring */}
      <div
        className="absolute"
        style={{
          left: widgetCenter.x - interactionSize / 2,
          top: widgetCenter.y - interactionSize / 2,
          width: interactionSize,
          height: interactionSize,
          zIndex: 23,
          cursor: isDragging ? 'grabbing' : 'grab',
          borderRadius: '50%',
        }}
        onMouseDown={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const mx = e.clientX - rect.left - interactionSize / 2;
          const my = e.clientY - rect.top - interactionSize / 2;
          const dist = Math.sqrt(mx * mx + my * my);
          if (dist > RING_RADIUS - 20 && dist < RING_RADIUS + 20) {
            setIsDragging(true);
            e.stopPropagation();
            e.preventDefault();
          }
        }}
        onMouseMove={(e) => {
          if (!isDragging || !selectedId || !cuboidData || !calibration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const mx = e.clientX - rect.left - interactionSize / 2;
          const my = e.clientY - rect.top - interactionSize / 2;
          const screenAngle = Math.atan2(my, mx);
          const newYaw = screenAngleToWorldYaw(screenAngle, calibration);
          updateAnnotation(selectedId, {
            data: {
              ...cuboidData,
              rotation: { ...cuboidData.rotation, yaw: newYaw },
            },
          });
          e.stopPropagation();
        }}
        onMouseUp={() => isDragging && setIsDragging(false)}
        onMouseLeave={() => isDragging && setIsDragging(false)}
      />
    </>
  );
};

export default HeadingRotationWidget;

import React, { useCallback, useMemo, useEffect } from 'react';
import { useSegmentTo3DStore } from '@/store/segmentTo3DStore';
import type { CameraCalibration } from '@/types';

interface HeadingPickerOverlayProps {
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

const ARROW_ICONS: Record<string, string> = {
  up: 'M12 4l-6 8h4v8h4v-8h4z',
  upRight: 'M17 7l-10 0 3.5 3.5-6 6 3 3 6-6 3.5 3.5z',
  right: 'M20 12l-8-6v4h-8v4h8v4z',
  downRight: 'M17 17l0-10-3.5 3.5-6-6-3 3 6 6-3.5 3.5z',
  down: 'M12 20l6-8h-4v-8h-4v8h-4z',
  downLeft: 'M7 17l10 0-3.5-3.5 6-6-3-3-6 6-3.5-3.5z',
  left: 'M4 12l8 6v-4h8v-4h-8v-4z',
  upLeft: 'M7 7l0 10 3.5-3.5 6 6 3-3-6-6 3.5-3.5z',
};

const DIRECTION_ORDER = ['up', 'upRight', 'right', 'downRight', 'down', 'downLeft', 'left', 'upLeft'];

export const HeadingPickerOverlay: React.FC<HeadingPickerOverlayProps> = ({
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
  const {
    isActive,
    currentStep,
    polygons,
    activePolygonId,
    isCreatingBox,
    requestBoxCreation,
  } = useSegmentTo3DStore();

  const headingDirections = useMemo(() => {
    let fwdX = 0, fwdY = 1;
    let rgtX = 1, rgtY = 0;

    if (calibration) {
      const R = calibration.extrinsic.rotation;
      fwdX = R[2][0];
      fwdY = R[2][1];
      rgtX = R[0][0];
      rgtY = R[0][1];
    }

    const dirs: Array<{
      key: string;
      label: string;
      dx: number;
      dy: number;
      anchorX: number;
      anchorY: number;
      yaw: number;
    }> = [
      { key: 'up',        label: 'Away',         dx:  fwdX,          dy:  fwdY,          anchorX:  0, anchorY: -1, yaw: 0 },
      { key: 'upRight',   label: 'Away-Right',   dx:  fwdX + rgtX,   dy:  fwdY + rgtY,   anchorX: -1, anchorY: -1, yaw: 0 },
      { key: 'right',     label: 'Right',        dx:  rgtX,          dy:  rgtY,          anchorX: -1, anchorY:  0, yaw: 0 },
      { key: 'downRight', label: 'Toward-Right', dx: -fwdX + rgtX,   dy: -fwdY + rgtY,   anchorX: -1, anchorY: +1, yaw: 0 },
      { key: 'down',      label: 'Toward',       dx: -fwdX,          dy: -fwdY,          anchorX:  0, anchorY: +1, yaw: 0 },
      { key: 'downLeft',  label: 'Toward-Left',  dx: -fwdX - rgtX,   dy: -fwdY - rgtY,   anchorX: +1, anchorY: +1, yaw: 0 },
      { key: 'left',      label: 'Left',         dx: -rgtX,          dy: -rgtY,          anchorX: +1, anchorY:  0, yaw: 0 },
      { key: 'upLeft',    label: 'Away-Left',    dx:  fwdX - rgtX,   dy:  fwdY - rgtY,   anchorX: +1, anchorY: -1, yaw: 0 },
    ];

    return dirs.map(d => ({
      ...d,
      yaw: Math.atan2(d.dy, d.dx),
    }));
  }, [calibration]);

  const imageToCanvas = useCallback((x: number, y: number): { x: number; y: number } => {
    const scaleX = displayWidth / imageWidth;
    const scaleY = displayHeight / imageHeight;

    const canvasX = x * scaleX + offsetX;
    const canvasY = y * scaleY + offsetY;

    const centerX = displayWidth / 2;
    const centerY = displayHeight / 2;

    return {
      x: (canvasX - centerX) * zoom + centerX + pan.x,
      y: (canvasY - centerY) * zoom + centerY + pan.y,
    };
  }, [displayWidth, displayHeight, imageWidth, imageHeight, offsetX, offsetY, zoom, pan]);

  const centroid = useMemo(() => {
    const activePolygon = polygons.find(p => p.id === activePolygonId);
    if (!activePolygon || activePolygon.vertices.length < 3) return null;

    let cx = 0, cy = 0;
    for (const v of activePolygon.vertices) {
      cx += v.x;
      cy += v.y;
    }
    cx /= activePolygon.vertices.length;
    cy /= activePolygon.vertices.length;

    return imageToCanvas(cx, cy);
  }, [polygons, activePolygonId, imageToCanvas]);

  const handleDirectionClick = useCallback((direction: typeof headingDirections extends (infer T)[] | null ? T : never) => {
    if (isCreatingBox || !direction) return;

    console.log('[HeadingPickerOverlay] Direction selected:', direction.label, 'yaw:', (direction.yaw * 180 / Math.PI).toFixed(1) + '°');

    requestBoxCreation({
      startImageX: 0,
      startImageY: 0,
      endImageX: 0,
      endImageY: 0,
      yaw: direction.yaw,
      anchorX: direction.anchorX,
      anchorY: direction.anchorY,
    });
  }, [isCreatingBox, requestBoxCreation]);

  const handleAutoClick = useCallback(() => {
    if (isCreatingBox) return;

    console.log('[HeadingPickerOverlay] Auto heading selected');
    requestBoxCreation(null);
  }, [isCreatingBox, requestBoxCreation]);

  useEffect(() => {
    if (!isActive || currentStep !== 'editing' || !activePolygonId || isCreatingBox) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key;

      if (key >= '1' && key <= '8') {
        e.preventDefault();
        e.stopPropagation();
        const dirIndex = parseInt(key) - 1;
        const dir = headingDirections[dirIndex];
        if (dir) {
          handleDirectionClick(dir);
        }
        return;
      }

      if (key === 'a' || key === 'A' || key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleAutoClick();
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isActive, currentStep, activePolygonId, isCreatingBox, headingDirections, handleDirectionClick, handleAutoClick]);

  if (!isActive || currentStep !== 'editing' || !activePolygonId || !centroid) {
    return null;
  }

  const radius = 55;
  const buttonSize = 32;

  const pickerSize = (radius + buttonSize / 2) * 2;
  const padding = 10;

  let pickerLeft = centroid.x - pickerSize / 2;
  let pickerTop = centroid.y - pickerSize / 2;

  if (pickerLeft < padding) {
    pickerLeft = padding;
  } else if (pickerLeft + pickerSize > displayWidth - padding) {
    pickerLeft = displayWidth - padding - pickerSize;
  }

  if (pickerTop < padding + 30) {
    pickerTop = padding + 30;
  } else if (pickerTop + pickerSize > displayHeight - padding) {
    pickerTop = displayHeight - padding - pickerSize;
  }

  const positionAngles = [
    -Math.PI / 2,
    -Math.PI / 4,
    0,
    Math.PI / 4,
    Math.PI / 2,
    3 * Math.PI / 4,
    Math.PI,
    -3 * Math.PI / 4,
  ];

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ zIndex: 30 }}
    >
      {/* Heading picker container */}
      <div
        className="absolute pointer-events-auto"
        style={{
          left: pickerLeft,
          top: pickerTop,
          width: pickerSize,
          height: pickerSize,
        }}
      >
        {/* Center auto button */}
        <button
          onClick={handleAutoClick}
          disabled={isCreatingBox}
          className="absolute flex flex-col items-center justify-center bg-green-600/80 hover:bg-green-500
                     text-white text-xs font-bold rounded-full border-2 border-white/70
                     shadow-xl transition-all duration-150 hover:scale-110 disabled:opacity-50
                     cursor-pointer backdrop-blur-sm"
          style={{
            width: buttonSize + 10,
            height: buttonSize + 10,
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
          title="Auto heading - press A or Enter"
        >
          Auto
          <span className="text-[8px] opacity-70">A</span>
        </button>

        {/* 8 directional arrows */}
        {DIRECTION_ORDER.map((key, idx) => {
          const dir = headingDirections.find(d => d.key === key);
          if (!dir) return null;

          const angle = positionAngles[idx];
          const x = radius * Math.cos(angle) + pickerSize / 2;
          const y = radius * Math.sin(angle) + pickerSize / 2;
          const keyNum = idx + 1;

          return (
            <button
              key={key}
              onClick={() => handleDirectionClick(dir)}
              disabled={isCreatingBox}
              className="absolute flex flex-col items-center justify-center bg-gray-800/70 hover:bg-purple-600
                         text-white rounded-full border border-white/30 shadow-lg backdrop-blur-sm
                         transition-all duration-150 hover:scale-125 hover:border-purple-400
                         disabled:opacity-50 cursor-pointer"
              style={{
                width: buttonSize,
                height: buttonSize,
                left: x - buttonSize / 2,
                top: y - buttonSize / 2,
              }}
              title={`${dir.label} - press ${keyNum}`}
            >
              <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                <path d={ARROW_ICONS[key]} />
              </svg>
              <span className="text-[8px] opacity-60 -mt-0.5">{keyNum}</span>
            </button>
          );
        })}

        {/* Helper text - positioned above picker */}
        <div
          className="absolute text-center text-[10px] text-white/80 bg-gray-900/60 px-2 py-0.5 rounded whitespace-nowrap backdrop-blur-sm"
          style={{
            left: '50%',
            top: -20,
            transform: 'translateX(-50%)',
          }}
        >
          Heading: 1-8 or A
        </div>
      </div>
    </div>
  );
};

export default HeadingPickerOverlay;

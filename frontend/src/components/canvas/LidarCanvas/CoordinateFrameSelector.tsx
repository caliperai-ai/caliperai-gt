import React, { useMemo } from 'react';
import type { CoordinateFrame } from '@/types';
import { getAvailableFrames } from '@/utils/coordinateFrames';

interface CoordinateFrameSelectorProps {
  value: CoordinateFrame;
  onChange: (frame: CoordinateFrame) => void;
  hasEgoPose?: boolean;
  hasCalibration?: boolean;
  compact?: boolean;
  disabled?: boolean;
  disabledLabel?: string;
}

const FRAME_LABELS: Record<CoordinateFrame, string> = {
  lidar: 'LiDAR',
  ego: 'Ego',
  world: 'World',
};

const FRAME_TOOLTIPS: Record<CoordinateFrame, string> = {
  lidar: 'Sensor-centered: Points as captured by LiDAR',
  ego: 'Vehicle-centered: Points relative to ego vehicle',
  world: 'Global coordinates: Points in world reference frame',
};

export const CoordinateFrameSelector: React.FC<CoordinateFrameSelectorProps> = ({
  value,
  onChange,
  hasEgoPose = true,
  hasCalibration = true,
  compact = false,
  disabled = false,
  disabledLabel,
}) => {
  const availableFrames = useMemo(() => {
    return getAvailableFrames(hasEgoPose, hasCalibration);
  }, [hasEgoPose, hasCalibration]);

  const frames: CoordinateFrame[] = ['lidar', 'ego', 'world'];

  if (disabled && disabledLabel) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-dark-panel/80 rounded-lg backdrop-blur-sm border border-white/10">
        <span className="text-xs text-gray-400">Frame:</span>
        <span className="text-xs font-medium text-accent">{disabledLabel}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400">Frame:</span>
      <div className="flex bg-dark-panel/80 rounded-lg backdrop-blur-sm border border-white/10 overflow-hidden">
        {frames.map((frame) => {
          const isAvailable = availableFrames.includes(frame);
          const isActive = value === frame;

          return (
            <button
              key={frame}
              onClick={() => isAvailable && onChange(frame)}
              disabled={!isAvailable}
              title={isAvailable ? FRAME_TOOLTIPS[frame] : getDisabledTooltip(frame, hasEgoPose, hasCalibration)}
              className={`
                ${compact ? 'px-2 py-1 text-xs' : 'px-3 py-1.5 text-sm'}
                font-medium transition-all duration-150
                ${isActive
                  ? 'bg-accent text-black'
                  : isAvailable
                    ? 'text-gray-300 hover:bg-white/10 hover:text-white'
                    : 'text-gray-600 cursor-not-allowed'
                }
                ${frame !== 'lidar' ? 'border-l border-white/10' : ''}
              `}
            >
              {FRAME_LABELS[frame]}
            </button>
          );
        })}
      </div>
    </div>
  );
};

function getDisabledTooltip(frame: CoordinateFrame, hasEgoPose: boolean, hasCalibration: boolean): string {
  if (frame === 'ego') {
    if (!hasCalibration) return 'Ego frame unavailable: Missing LiDAR-to-Ego calibration';
    return 'Ego frame unavailable';
  }
  if (frame === 'world') {
    if (!hasCalibration) return 'World frame unavailable: Missing calibration data';
    if (!hasEgoPose) return 'World frame unavailable: Missing ego pose for current frame';
    return 'World frame unavailable';
  }
  return 'Frame unavailable';
}

export default CoordinateFrameSelector;

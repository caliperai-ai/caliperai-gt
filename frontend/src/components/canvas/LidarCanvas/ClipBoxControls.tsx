import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useEditorStore } from '@/store/editorStore';
import type { ClipBoxSettings } from '@/types';


const DEFAULT_CLIP: ClipBoxSettings = {
  enabled: false,
  xMin: -50,
  xMax: 50,
  yMin: -50,
  yMax: 50,
  zMin: -5,
  zMax: 10,
};

const BOUNDS = {
  x: { min: -150, max: 150, step: 1 },
  y: { min: -150, max: 150, step: 1 },
  z: { min: -20,  max: 50,  step: 0.5 },
};


interface DualRangeSliderProps {
  axis: 'X' | 'Y' | 'Z';
  color: string;
  accentHex: string;
  absMin: number;
  absMax: number;
  step: number;
  valueMin: number;
  valueMax: number;
  onChangeMin: (v: number) => void;
  onChangeMax: (v: number) => void;
}

const DualRangeSlider: React.FC<DualRangeSliderProps> = ({
  axis, color, accentHex,
  absMin, absMax, step,
  valueMin, valueMax,
  onChangeMin, onChangeMax,
}) => {
  const span = absMax - absMin;
  const leftPct  = ((valueMin - absMin) / span) * 100;
  const rightPct = ((valueMax - absMin) / span) * 100;

  const minZ = valueMin > absMin + span * 0.5 ? 5 : 3;
  const maxZ = valueMax < absMin + span * 0.5 ? 5 : 4;

  const fmt = (v: number) => Number.isInteger(v) ? `${v}` : v.toFixed(1);

  return (
    <div className="flex flex-col gap-0.5">
      {/* Label + current values */}
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-bold ${color}`}>{axis}</span>
        <div className="flex items-center gap-1 text-[10px] text-gray-300 tabular-nums">
          <span>{fmt(valueMin)}</span>
          <span className="text-gray-600">–</span>
          <span>{fmt(valueMax)}</span>
          <span className="text-[9px] text-gray-500 ml-0.5">m</span>
        </div>
      </div>

      {/* Slider track + thumbs */}
      <div className="relative h-5 flex items-center select-none">
        {/* Grey full-width track */}
        <div className="absolute inset-x-0 h-[3px] rounded-full bg-gray-700 pointer-events-none">
          {/* Coloured active range segment */}
          <div
            className="absolute h-full rounded-full pointer-events-none"
            style={{ left: `${leftPct}%`, right: `${100 - rightPct}%`, background: accentHex }}
          />
        </div>

        {/* Min thumb */}
        <input
          type="range"
          min={absMin} max={absMax} step={step}
          value={valueMin}
          onChange={(e) => onChangeMin(Math.min(Number(e.target.value), valueMax - step))}
          className="clip-dual-range absolute inset-x-0 w-full"
          style={{ zIndex: minZ, '--thumb-color': accentHex } as React.CSSProperties}
        />

        {/* Max thumb */}
        <input
          type="range"
          min={absMin} max={absMax} step={step}
          value={valueMax}
          onChange={(e) => onChangeMax(Math.max(Number(e.target.value), valueMin + step))}
          className="clip-dual-range absolute inset-x-0 w-full"
          style={{ zIndex: maxZ, '--thumb-color': accentHex } as React.CSSProperties}
        />
      </div>

      {/* Absolute bound labels */}
      <div className="flex items-center justify-between">
        <span className="text-[8px] text-gray-600">{absMin}m</span>
        <span className="text-[8px] text-gray-600">{absMax}m</span>
      </div>
    </div>
  );
};

// ─── main component ──────────────────────────────────────────────────────────

export const ClipBoxControls: React.FC = () => {
  const clipBox      = useEditorStore((s) => s.lidarView.clipBox ?? DEFAULT_CLIP);
  const setLidarView = useEditorStore((s) => s.setLidarView);

  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const update = useCallback(
    (patch: Partial<ClipBoxSettings>) =>
      setLidarView({ clipBox: { ...clipBox, ...patch } }),
    [clipBox, setLidarView],
  );

  const toggleEnabled = useCallback(
    () => update({ enabled: !clipBox.enabled }),
    [clipBox.enabled, update],
  );

  const reset = useCallback(
    () => setLidarView({ clipBox: { ...DEFAULT_CLIP, enabled: clipBox.enabled } }),
    [clipBox.enabled, setLidarView],
  );

  return (
    <>
      {/* Thumb styles – injected once, scoped to .clip-dual-range */}
      <style>{`
        .clip-dual-range {
          -webkit-appearance: none;
          appearance: none;
          height: 0;
          background: transparent;
          pointer-events: none;
          outline: none;
          position: absolute;
          left: 0; right: 0;
          width: 100%;
        }
        .clip-dual-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          pointer-events: all;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #fff;
          border: 2px solid var(--thumb-color, #7c3aed);
          box-shadow: 0 1px 4px rgba(0,0,0,0.6);
          cursor: grab;
          transition: transform 0.1s;
        }
        .clip-dual-range::-webkit-slider-thumb:active { cursor: grabbing; transform: scale(1.2); }
        .clip-dual-range::-moz-range-thumb {
          pointer-events: all;
          width: 14px; height: 14px;
          border-radius: 50%;
          background: #fff;
          border: 2px solid var(--thumb-color, #7c3aed);
          box-shadow: 0 1px 4px rgba(0,0,0,0.6);
          cursor: grab;
        }
        .clip-dual-range::-moz-range-track { background: transparent; }
      `}</style>

      <div ref={panelRef} className="relative flex items-center">
        {/* Toggle button – icon only, tooltip on hover */}
        <button
          onClick={() => setOpen((o) => !o)}
          title="XYZ Range Filter"
          className={`relative flex items-center justify-center w-7 h-7 rounded border transition-colors
            ${open
              ? 'bg-purple-700 border-purple-500 text-white'
              : clipBox.enabled
                ? 'bg-purple-900/70 border-purple-600 text-purple-300 hover:bg-purple-800/70'
                : 'bg-black/40 border-gray-600 text-gray-300 hover:text-white hover:border-gray-400 hover:bg-black/60'
            }`}
        >
          {/* 3-D coordinate axes icon */}
          <svg className="w-4 h-4" viewBox="0 0 16 16" fill="none" strokeWidth="1.5" strokeLinecap="round">
            {/* origin */}
            {/* Z axis – up */}
            <line x1="8" y1="8" x2="8" y2="2" stroke="#60a5fa" />
            <polyline points="6.5,3.5 8,2 9.5,3.5" stroke="#60a5fa" fill="none" strokeWidth="1.2" />
            {/* X axis – right */}
            <line x1="8" y1="8" x2="14" y2="8" stroke="#f87171" />
            <polyline points="12.5,6.5 14,8 12.5,9.5" stroke="#f87171" fill="none" strokeWidth="1.2" />
            {/* Y axis – lower-left (isometric) */}
            <line x1="8" y1="8" x2="3" y2="13" stroke="#4ade80" />
            <polyline points="4.5,14 3,13 4,11.5" stroke="#4ade80" fill="none" strokeWidth="1.2" />
          </svg>
          {clipBox.enabled && (
            <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-purple-400" />
          )}
        </button>

        {/* Dropdown panel */}
        {open && (
          <div
            className="absolute top-full right-0 mt-1 z-[200] bg-gray-900 border border-gray-600 rounded-lg shadow-xl p-3 w-72"
            style={{ boxShadow: '0 4px 24px rgba(0,0,0,0.7)' }}
          >
            {/* Header + toggle */}
            <div className="flex items-center justify-between mb-3">
              <span className="text-[10px] font-semibold text-gray-200">XYZ Range Filter</span>
              <div onClick={toggleEnabled} className="flex items-center gap-1.5 cursor-pointer select-none">
                <span className="text-[9px] text-gray-400">{clipBox.enabled ? 'ON' : 'OFF'}</span>
                <div className={`relative w-7 h-3.5 rounded-full transition-colors ${clipBox.enabled ? 'bg-purple-600' : 'bg-gray-600'}`}>
                  <div className={`absolute top-0.5 w-2.5 h-2.5 rounded-full bg-white shadow transition-transform ${clipBox.enabled ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </div>
              </div>
            </div>

            {/* Axis sliders */}
            <div className={`flex flex-col gap-4 transition-opacity ${clipBox.enabled ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
              <DualRangeSlider
                axis="X" color="text-red-400" accentHex="#ef4444"
                absMin={BOUNDS.x.min} absMax={BOUNDS.x.max} step={BOUNDS.x.step}
                valueMin={clipBox.xMin} valueMax={clipBox.xMax}
                onChangeMin={(v) => update({ xMin: v })}
                onChangeMax={(v) => update({ xMax: v })}
              />
              <DualRangeSlider
                axis="Y" color="text-green-400" accentHex="#22c55e"
                absMin={BOUNDS.y.min} absMax={BOUNDS.y.max} step={BOUNDS.y.step}
                valueMin={clipBox.yMin} valueMax={clipBox.yMax}
                onChangeMin={(v) => update({ yMin: v })}
                onChangeMax={(v) => update({ yMax: v })}
              />
              <DualRangeSlider
                axis="Z" color="text-blue-400" accentHex="#3b82f6"
                absMin={BOUNDS.z.min} absMax={BOUNDS.z.max} step={BOUNDS.z.step}
                valueMin={clipBox.zMin} valueMax={clipBox.zMax}
                onChangeMin={(v) => update({ zMin: v })}
                onChangeMax={(v) => update({ zMax: v })}
              />

              <p className="text-[8px] text-gray-500 -mt-1">
                Drag handles · left = min, right = max · metres from LiDAR origin
              </p>
            </div>

            {/* Reset */}
            <button
              onClick={reset}
              className="mt-3 w-full text-[9px] text-gray-400 hover:text-white border border-gray-700 hover:border-gray-500 rounded px-2 py-1 transition-colors"
            >
              Reset to defaults
            </button>
          </div>
        )}
      </div>
    </>
  );
};

export default ClipBoxControls;

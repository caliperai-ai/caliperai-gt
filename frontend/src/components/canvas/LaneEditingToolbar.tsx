import React, { useCallback, useEffect, useState } from 'react';
import {
  smoothLaneOverall,
  simplifyLaneDouglasPeucker,
  snapLaneToVanishingLine,
  cleanupLane,
  convertToEditableBezier,
  Point2D,
} from '@/utils/laneSmoothing';

export interface LaneEditingToolbarProps {
  points: Point2D[];
  onUpdate: (newPoints: Point2D[]) => void;
  vanishingLineY?: number;
  imageSize: { width: number; height: number };
  isVisible?: boolean;
  enableBezierMode?: boolean;
  onSwitchToBezier?: (handles: [Point2D, Point2D, Point2D]) => void;
}

export const LaneEditingToolbar: React.FC<LaneEditingToolbarProps> = ({
  points,
  onUpdate,
  vanishingLineY,
  imageSize,
  isVisible = true,
  enableBezierMode = true,
  onSwitchToBezier,
}) => {
  const [smoothStrength, setSmoothStrength] = useState(3);


  const handleSmooth = useCallback(() => {
    if (points.length < 3) return;
    const smoothed = smoothLaneOverall(points, smoothStrength, true, 0);
    onUpdate(smoothed);
  }, [points, onUpdate, smoothStrength]);

  const handleSmoothMax = useCallback(() => {
    if (points.length < 3) return;
    const smoothed = smoothLaneOverall(points, 5, true, 0);
    onUpdate(smoothed);
  }, [points, onUpdate]);

  const handleSmoothWithStrength = useCallback((strength: number) => {
    if (points.length < 3) return;
    setSmoothStrength(strength);
    const smoothed = smoothLaneOverall(points, strength, true, 0);
    onUpdate(smoothed);
  }, [points, onUpdate]);

  const handleSimplify = useCallback(() => {
    if (points.length < 3) return;
    const simplified = simplifyLaneDouglasPeucker(points, 3.0);
    onUpdate(simplified);
  }, [points, onUpdate]);

  const handleSnapToVP = useCallback(() => {
    if (!vanishingLineY || points.length < 2) return;
    const snapped = snapLaneToVanishingLine(points, vanishingLineY, imageSize.width);
    onUpdate(snapped);
  }, [points, vanishingLineY, imageSize.width, onUpdate]);

  const handleCleanup = useCallback(() => {
    if (points.length < 3) return;
    let cleaned = cleanupLane(points, 2.0, 0.5);
    if (vanishingLineY) {
      cleaned = snapLaneToVanishingLine(cleaned, vanishingLineY, imageSize.width);
    }
    onUpdate(cleaned);
  }, [points, vanishingLineY, imageSize.width, onUpdate]);

  const handleConvertToBezier = useCallback(() => {
    if (!onSwitchToBezier || points.length < 2) return;
    const { handles } = convertToEditableBezier(points, vanishingLineY, imageSize.width);
    onSwitchToBezier(handles);
  }, [points, vanishingLineY, imageSize.width, onSwitchToBezier]);


  useEffect(() => {
    if (!isVisible) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key.toLowerCase()) {
        case 's':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            if (e.shiftKey) {
              handleSmoothMax();
            } else {
              handleSmooth();
            }
          }
          break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
          if (!e.ctrlKey && !e.metaKey && !e.shiftKey) {
            e.preventDefault();
            handleSmoothWithStrength(parseInt(e.key, 10));
          }
          break;
        case 'd':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            handleSimplify();
          }
          break;
        case 'v':
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            handleSnapToVP();
          }
          break;
        case 'c':
          if (!e.ctrlKey && !e.metaKey && e.shiftKey) {
            e.preventDefault();
            handleCleanup();
          }
          break;
        case 'b':
          if (!e.ctrlKey && !e.metaKey && enableBezierMode) {
            e.preventDefault();
            handleConvertToBezier();
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, handleSmooth, handleSmoothMax, handleSmoothWithStrength, handleSimplify, handleSnapToVP, handleCleanup, handleConvertToBezier, enableBezierMode]);


  if (!isVisible) return null;

  return (
    <div className="flex items-center gap-1 bg-gray-900/95 border border-gray-700 rounded-lg px-2 py-1.5 shadow-xl backdrop-blur-sm">
      {/* Title */}
      <span className="text-xs text-gray-400 font-medium mr-2 whitespace-nowrap">
        🛣️ Lane
      </span>

      {/* Smooth Button with strength indicator */}
      <div className="flex items-center gap-0.5">
        <button
          onClick={handleSmooth}
          disabled={points.length < 3}
          className="flex items-center gap-1 px-2 py-1 text-xs rounded-l bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white transition-colors"
          title={`Smooth (strength ${smoothStrength}) - Press S or 1-5 for strength`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8c4-4 8 4 12 0s4 4 4 4" />
          </svg>
          <span className="hidden sm:inline">Smooth</span>
        </button>
        {/* Strength selector buttons 1-5 */}
        <div className="flex">
          {[1, 2, 3, 4, 5].map(s => (
            <button
              key={s}
              onClick={() => handleSmoothWithStrength(s)}
              disabled={points.length < 3}
              className={`w-5 h-6 text-[10px] font-bold transition-colors ${
                s === smoothStrength
                  ? 'bg-blue-400 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              } ${s === 5 ? 'rounded-r' : ''} disabled:opacity-50`}
              title={`Smooth strength ${s} (press ${s})`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Simplify Button */}
      <button
        onClick={handleSimplify}
        disabled={points.length < 3}
        className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 disabled:text-gray-500 text-white transition-colors"
        title="Simplify/reduce points (D)"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7M9 20l6-3M9 20V7m6 10l5.447 2.724A1 1 0 0021 18.882V8.118a1 1 0 00-1.447-.894L15 10m0 7V10m0 0L9 7" />
        </svg>
        <span className="hidden sm:inline">Simplify</span>
        <kbd className="text-[10px] bg-gray-800 px-1 rounded">D</kbd>
      </button>

      {/* Snap to VP Button */}
      <button
        onClick={handleSnapToVP}
        disabled={!vanishingLineY || points.length < 2}
        className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white transition-colors"
        title="Snap to vanishing point line (V)"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
        <span className="hidden sm:inline">Snap VP</span>
        <kbd className="text-[10px] bg-gray-800 px-1 rounded">V</kbd>
      </button>

      {/* Divider */}
      <div className="w-px h-5 bg-gray-700 mx-1" />

      {/* One-Click Cleanup (Smooth + Simplify + Snap) */}
      <button
        onClick={handleCleanup}
        disabled={points.length < 3}
        className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-amber-600 hover:bg-amber-500 disabled:bg-gray-700 disabled:text-gray-500 text-white transition-colors"
        title="One-click cleanup: Simplify + Smooth + Snap (Shift+C)"
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
        </svg>
        <span className="hidden sm:inline">Cleanup</span>
        <kbd className="text-[10px] bg-gray-800 px-1 rounded">⇧C</kbd>
      </button>

      {/* Convert to Bezier Mode */}
      {enableBezierMode && onSwitchToBezier && (
        <>
          <div className="w-px h-5 bg-gray-700 mx-1" />
          <button
            onClick={handleConvertToBezier}
            disabled={points.length < 2}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-cyan-600 hover:bg-cyan-500 disabled:bg-gray-700 disabled:text-gray-500 text-white transition-colors"
            title="Convert to 3-handle Bezier mode (B)"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="hidden sm:inline">Bezier</span>
            <kbd className="text-[10px] bg-gray-800 px-1 rounded">B</kbd>
          </button>
        </>
      )}

      {/* Point Count Indicator */}
      <div className="ml-2 text-[10px] text-gray-500">
        {points.length} pts
      </div>
    </div>
  );
};

export default LaneEditingToolbar;

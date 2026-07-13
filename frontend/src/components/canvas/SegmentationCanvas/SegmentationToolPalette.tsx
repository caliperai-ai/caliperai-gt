import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useSegmentationStore, type SegmentationTool } from '@/store/segmentationStore';


const SelectIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z" />
    <path d="M13 13l6 6" />
  </svg>
);

const BrushIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M9.06 11.9l8.07-8.06a2.85 2.85 0 114.03 4.03l-8.06 8.08" />
    <path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 00-3-3.02z" />
  </svg>
);

const LassoIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M7 22a5 5 0 01-2-4" />
    <path d="M3.3 14A6.8 6.8 0 012 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 01-5-1" />
    <path d="M5 18a2 2 0 100-4 2 2 0 000 4z" />
  </svg>
);

const RegionGrowIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
    <path d="M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
  </svg>
);

const EraserIcon = () => (
  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 20H7L3 16c-.6-.6-.6-1.5 0-2.1l10-10c.6-.6 1.5-.6 2.1 0l7 7c.6.6.6 1.5 0 2.1L15 20" />
    <path d="M6 11l8 8" />
  </svg>
);


interface ToolDefinition {
  id: SegmentationTool;
  name: string;
  icon: React.ReactNode;
  shortcut: string;
  description: string;
}

const tools: ToolDefinition[] = [
  {
    id: 'select',
    name: 'Select',
    icon: <SelectIcon />,
    shortcut: 'V',
    description: 'Click to select points',
  },
  {
    id: 'brush',
    name: 'Brush',
    icon: <BrushIcon />,
    shortcut: 'B',
    description: 'Paint labels with 3D brush',
  },
  {
    id: 'lasso',
    name: 'Lasso',
    icon: <LassoIcon />,
    shortcut: 'L',
    description: 'Draw to select points',
  },
  {
    id: 'region_grow',
    name: 'Region Grow',
    icon: <RegionGrowIcon />,
    shortcut: 'G',
    description: 'Click seed, auto-grow region',
  },
  {
    id: 'eraser',
    name: 'Eraser',
    icon: <EraserIcon />,
    shortcut: 'E',
    description: 'Remove labels',
  },
];


interface SegmentationToolPaletteProps {
  onDetectGround?: () => void;
  isDetectingGround?: boolean;
  isQAMode?: boolean;
  taskId?: string;
}

export const SegmentationToolPalette: React.FC<SegmentationToolPaletteProps> = ({
  onDetectGround,
  isDetectingGround = false,
  isQAMode = false,
  taskId,
}) => {
  const activeTool = useSegmentationStore((s) => s.activeTool);
  const setActiveTool = useSegmentationStore((s) => s.setActiveTool);
  const brushSettings = useSegmentationStore((s) => s.brushSettings);
  const setBrushSettings = useSegmentationStore((s) => s.setBrushSettings);
  const undo = useSegmentationStore((s) => s.undo);
  const redo = useSegmentationStore((s) => s.redo);

  const [showTimerToast, setShowTimerToast] = useState(false);
  const timerToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [timerRunning, setTimerRunning] = useState<boolean>(() => {
    if (!taskId) return true;
    try {
      const raw = localStorage.getItem(`task_timer_${taskId}`);
      return raw ? (JSON.parse(raw).running === true) : false;
    } catch { return false; }
  });
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ running: boolean; taskId: string }>).detail;
      if (detail?.taskId === taskId) {
        setTimerRunning(detail.running);
        if (detail.running) {
          setShowTimerToast(false);
          if (timerToastTimeoutRef.current) clearTimeout(timerToastTimeoutRef.current);
        }
      }
    };
    window.addEventListener('timerStateChange', handler);
    return () => window.removeEventListener('timerStateChange', handler);
  }, [taskId]);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key.toUpperCase();

      // Annotation tools are gated by the work timer: when paused, they must
      // stay locked even via keyboard — mirroring the tool-button guard. Only
      // 'select' is always available. Returns true if the action is blocked.
      const blockedByTimer = (toolId: string): boolean => {
        const isAnnotationTool = toolId !== 'select';
        if (!isAnnotationTool || timerRunning || isQAMode) return false;
        if (timerToastTimeoutRef.current) clearTimeout(timerToastTimeoutRef.current);
        setShowTimerToast(true);
        timerToastTimeoutRef.current = setTimeout(() => setShowTimerToast(false), 8000);
        window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: true } }));
        return true;
      };

      // Tool shortcuts
      const tool = tools.find(t => t.shortcut === key);
      if (tool) {
        e.preventDefault();
        // In QA mode only 'select' is usable (matches the button's isDisabled).
        if (isQAMode && tool.id !== 'select') return;
        if (blockedByTimer(tool.id)) return;
        setActiveTool(tool.id);
        return;
      }

      // Undo/Redo
      if ((e.ctrlKey || e.metaKey) && key === 'Z') {
        e.preventDefault();
        if (e.shiftKey) {
          redo();
        } else {
          undo();
        }
        return;
      }

      // Brush size adjustment (only while an annotation tool is active, which
      // is itself timer-gated; guard anyway in case the timer paused mid-tool).
      if ((activeTool === 'brush' || activeTool === 'eraser') && timerRunning) {
        if (key === '[' || key === '{') {
          e.preventDefault();
          setBrushSettings({ radius: Math.max(0.1, brushSettings.radius - 0.1) });
        } else if (key === ']' || key === '}') {
          e.preventDefault();
          setBrushSettings({ radius: Math.min(5, brushSettings.radius + 0.1) });
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTool, brushSettings.radius, setActiveTool, setBrushSettings, undo, redo, timerRunning, isQAMode]);

  // When the timer pauses, drop any annotation tool back to select so a tool
  // that was already active can't keep painting (via pointer) while paused.
  useEffect(() => {
    if (!timerRunning && !isQAMode && activeTool !== 'select') {
      setActiveTool('select');
    }
  }, [timerRunning, isQAMode, activeTool, setActiveTool]);

  return (
    <>
      {/* Timer nudge toast */}
      {showTimerToast && createPortal(
        <div className="fixed top-14 left-1/2 -translate-x-1/2 z-[300] pointer-events-none flex justify-center">
          <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-gray-900 border border-amber-500/45 animate-fadeInDown animate-timerToastGlow pointer-events-auto">
            <span className="flex-shrink-0 w-7 h-7 rounded-full bg-amber-500/15 border border-amber-500/30 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <circle cx="12" cy="12" r="9" />
                <path strokeLinecap="round" d="M12 7v5l3 3" />
              </svg>
            </span>
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-amber-300 leading-tight">Start the timer</span>
              <span className="text-[11px] text-gray-400 leading-tight mt-0.5">Press play on the timer (top-right) to log your work time</span>
            </div>
            <button
              className="ml-1 flex-shrink-0 text-gray-500 hover:text-gray-300 transition-colors"
              onClick={() => { setShowTimerToast(false); if (timerToastTimeoutRef.current) clearTimeout(timerToastTimeoutRef.current); }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>,
        document.body
      )}
      <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-2">
      {/* Tool buttons */}
      <div className="bg-dark-panel/95 backdrop-blur-sm rounded-xl border border-gray-700 p-2 shadow-xl">
        {/* QA Mode indicator */}
        {isQAMode && (
          <div className="px-2 py-1 mb-2 text-[10px] text-purple-400 text-center bg-purple-500/10 rounded border border-purple-500/30">
            View Only
          </div>
        )}
        <div className="flex flex-col gap-1">
          {tools.map((tool) => {
            // In QA mode, only allow select tool
            const isDisabled = isQAMode && tool.id !== 'select';
            // Annotation tools (not select) are locked when timer is not running
            const isAnnotationTool = tool.id !== 'select';
            const timerLocked = isAnnotationTool && !timerRunning && !isQAMode;
            return (
            <button
              key={tool.id}
              onMouseEnter={() => {
                if (timerLocked) window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: true } }));
              }}
              onMouseLeave={() => {
                if (timerLocked) window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: false } }));
              }}
              onFocus={() => {
                if (timerLocked) window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: true } }));
              }}
              onBlur={() => {
                if (timerLocked) window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: false } }));
              }}
              onClick={() => {
                if (timerLocked) {
                  if (timerToastTimeoutRef.current) clearTimeout(timerToastTimeoutRef.current);
                  setShowTimerToast(true);
                  timerToastTimeoutRef.current = setTimeout(() => setShowTimerToast(false), 8000);
                  return;
                }
                if (!isDisabled) setActiveTool(tool.id);
              }}
              disabled={isDisabled}
              className={`group relative p-3 rounded-lg transition-all ${
                isDisabled
                  ? 'text-gray-600 cursor-not-allowed opacity-40'
                  : timerLocked
                    ? 'text-amber-700/40 cursor-not-allowed'
                    : activeTool === tool.id
                      ? 'bg-primary text-white shadow-lg shadow-primary/30'
                      : 'text-gray-400 hover:bg-dark-hover hover:text-white'
              }`}
              aria-label={`${tool.name} (${tool.shortcut})${isDisabled ? ' - Disabled in QA mode' : timerLocked ? ' - Start timer first' : ''}`}
            >
              {tool.icon}
              {timerLocked ? (
                <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 whitespace-nowrap px-3 py-2 rounded-lg bg-white border border-amber-400 text-sm font-medium text-amber-700 shadow-xl z-50 invisible scale-95 group-hover:visible group-hover:scale-100 group-focus-visible:visible group-focus-visible:scale-100 transition-transform duration-150">
                  {tool.name} — start the timer first
                </span>
              ) : (
                <span className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap px-2 py-1 rounded bg-black/90 border border-white/20 text-[10px] text-gray-100 shadow-lg z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                  {tool.name} ({tool.shortcut}){isDisabled && ' - Disabled in QA mode'}
                </span>
              )}
              {/* Lock badge overlay for timer-locked tools */}
              {timerLocked && (
                <span className="absolute bottom-0.5 right-0.5 w-3 h-3 flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                  </svg>
                </span>
              )}
            </button>
          )})}
        </div>

        {/* RANSAC ground detection — merged into same panel with a divider */}
        {onDetectGround && (
          <>
            <div className="my-1.5 h-px bg-gray-700/60" />
            {(() => {
              const groundTimerLocked = !timerRunning && !isQAMode;
              return (
                <button
                  onClick={() => {
                    if (groundTimerLocked) {
                      if (timerToastTimeoutRef.current) clearTimeout(timerToastTimeoutRef.current);
                      setShowTimerToast(true);
                      timerToastTimeoutRef.current = setTimeout(() => setShowTimerToast(false), 8000);
                      return;
                    }
                    onDetectGround();
                  }}
                  onMouseEnter={() => {
                    if (groundTimerLocked) window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: true } }));
                  }}
                  onMouseLeave={() => {
                    if (groundTimerLocked) window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: false } }));
                  }}
                  onFocus={() => {
                    if (groundTimerLocked) window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: true } }));
                  }}
                  onBlur={() => {
                    if (groundTimerLocked) window.dispatchEvent(new CustomEvent('timerControlAttention', { detail: { active: false } }));
                  }}
                  disabled={isDetectingGround}
                  className={`group relative p-3 rounded-lg transition-all w-full flex items-center justify-center ${
                    isDetectingGround
                      ? 'text-gray-600 cursor-not-allowed'
                      : groundTimerLocked
                        ? 'text-amber-700/40 cursor-not-allowed'
                        : 'text-gray-400 hover:bg-dark-hover hover:text-emerald-400'
                  }`}
                  aria-label={`Detect Ground (RANSAC)${groundTimerLocked ? ' - Start timer first' : ''}`}
                >
                  {isDetectingGround ? (
                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                    </svg>
                  ) : (
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 17l4-8 4 4 4-6 4 10" />
                      <line x1="3" y1="21" x2="21" y2="21" />
                    </svg>
                  )}
                  {groundTimerLocked ? (
                    <span className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-3 whitespace-nowrap px-3 py-2 rounded-lg bg-white border border-amber-400 text-sm font-medium text-amber-700 shadow-xl z-50 invisible scale-95 group-hover:visible group-hover:scale-100 transition-transform duration-150">
                      Detect Ground — start the timer first
                    </span>
                  ) : (
                    <span className="pointer-events-none absolute left-full ml-2 top-1/2 -translate-y-1/2 whitespace-nowrap px-2 py-1 rounded bg-black/90 border border-white/20 text-[10px] text-gray-100 shadow-lg z-50 opacity-0 group-hover:opacity-100 transition-opacity duration-150">
                      Detect Ground (RANSAC)
                    </span>
                  )}
                  {groundTimerLocked && (
                    <span className="absolute bottom-0.5 right-0.5 w-3 h-3 flex items-center justify-center">
                      <svg className="w-2.5 h-2.5 text-amber-500" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M10 1a4.5 4.5 0 00-4.5 4.5V9H5a2 2 0 00-2 2v6a2 2 0 002 2h10a2 2 0 002-2v-6a2 2 0 00-2-2h-.5V5.5A4.5 4.5 0 0010 1zm3 8V5.5a3 3 0 10-6 0V9h6z" clipRule="evenodd" />
                      </svg>
                    </span>
                  )}
                </button>
              );
            })()}
          </>
        )}
      </div>
    </div>
    </>
  );
};

export default SegmentationToolPalette;

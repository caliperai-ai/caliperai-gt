import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/store/editorStore';

type PlaybackSpeed = 0.25 | 0.5 | 1 | 2 | 4;
const PLAYBACK_SPEEDS: PlaybackSpeed[] = [0.25, 0.5, 1, 2, 4];
const BASE_INTERVAL = 200;

interface TimelineProps {
  isLoadingFrame?: boolean;
  displayedFrameIndex?: number;
}

export const Timeline: React.FC<TimelineProps> = ({ isLoadingFrame = false, displayedFrameIndex }) => {
  const { frames, scene, task, currentFrameIndex, goToFrame, nextFrame, prevFrame } = useEditorStore();
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<PlaybackSpeed>(1);
  const [isEditingFrame, setIsEditingFrame] = useState(false);
  const [frameInputValue, setFrameInputValue] = useState('');
  const playIntervalRef = useRef<number | null>(null);
  const frameInputRef = useRef<HTMLInputElement>(null);

  const [isDragging, setIsDragging] = useState(false);
  const [dragValue, setDragValue] = useState(0);
  const scrubberRef = useRef<HTMLDivElement>(null);

  const shownFrameIndex = displayedFrameIndex ?? currentFrameIndex;

  useEffect(() => {
    if (isPlaying) {
      const interval = BASE_INTERVAL / playbackSpeed;
      playIntervalRef.current = window.setInterval(() => {
        if (isLoadingFrame) return;
        const store = useEditorStore.getState();
        if (store.currentFrameIndex < store.frames.length - 1) {
          store.nextFrame();
        } else {
          setIsPlaying(false);
        }
      }, interval);
    } else {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    }
    return () => {
      if (playIntervalRef.current) clearInterval(playIntervalRef.current);
    };
  }, [isPlaying, isLoadingFrame, playbackSpeed]);

  const goToFirstFrame = useCallback(() => {
    goToFrame(0);
    setIsPlaying(false);
  }, [goToFrame]);

  const goToLastFrame = useCallback(() => {
    goToFrame(frames.length - 1);
    setIsPlaying(false);
  }, [goToFrame, frames.length]);

  const handleFrameInputStart = () => {
    setIsEditingFrame(true);
    setFrameInputValue(String(shownFrameIndex + 1));
    setTimeout(() => frameInputRef.current?.select(), 0);
  };

  const handleFrameInputSubmit = () => {
    const frameNum = parseInt(frameInputValue);
    if (!isNaN(frameNum) && frameNum >= 1 && frameNum <= frames.length) {
      goToFrame(frameNum - 1);
    }
    setIsEditingFrame(false);
  };

  const handleFrameInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleFrameInputSubmit();
    else if (e.key === 'Escape') setIsEditingFrame(false);
  };

  const cyclePlaybackSpeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentIndex = PLAYBACK_SPEEDS.indexOf(playbackSpeed);
    const nextIndex = (currentIndex + 1) % PLAYBACK_SPEEDS.length;
    setPlaybackSpeed(PLAYBACK_SPEEDS[nextIndex]);
  };

  const getFrameFromPosition = useCallback((clientX: number): number => {
    if (!scrubberRef.current) return currentFrameIndex;
    const rect = scrubberRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, x / rect.width));
    return Math.round(ratio * (frames.length - 1));
  }, [frames.length, currentFrameIndex]);

  const handleScrubStart = useCallback((clientX: number) => {
    setIsDragging(true);
    const frame = getFrameFromPosition(clientX);
    setDragValue(frame);
  }, [getFrameFromPosition]);

  const handleScrubMove = useCallback((clientX: number) => {
    if (!isDragging) return;
    const frame = getFrameFromPosition(clientX);
    setDragValue(frame);
  }, [isDragging, getFrameFromPosition]);

  const handleScrubEnd = useCallback(() => {
    if (isDragging) {
      goToFrame(dragValue);
      setIsDragging(false);
    }
  }, [isDragging, dragValue, goToFrame]);

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    handleScrubStart(e.clientX);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      handleScrubMove(e.clientX);
    };

    const handleMouseUp = () => {
      handleScrubEnd();
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleScrubMove(e.touches[0].clientX);
      }
    };

    const handleTouchEnd = () => {
      handleScrubEnd();
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('touchmove', handleTouchMove);
    document.addEventListener('touchend', handleTouchEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleTouchEnd);
    };
  }, [isDragging, handleScrubMove, handleScrubEnd]);

  const displayedIndex = isDragging ? dragValue : shownFrameIndex;
  const progress = frames.length > 1 ? (displayedIndex / (frames.length - 1)) * 100 : 0;

  const iconBtn = (disabled = false) =>
    `p-1 rounded-full hover:bg-white/10 text-white/50 hover:text-white transition-colors ${disabled ? 'opacity-25 pointer-events-none' : ''}`;

  return (
    <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-40">
      <div className="flex items-center gap-1 px-2.5 py-1.5 bg-gray-950/85 backdrop-blur-xl border border-white/8 rounded-full shadow-2xl shadow-black/50 select-none">

        {/* ── First Frame ── */}
        <button
          onClick={goToFirstFrame}
          disabled={currentFrameIndex === 0}
          className={iconBtn(currentFrameIndex === 0)}
          title="First Frame (Home)"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M6 6h2v12H6V6zm3.5 6 8.5 6V6l-8.5 6z"/>
          </svg>
        </button>

        {/* ── Prev Frame ── */}
        <button
          onClick={prevFrame}
          disabled={currentFrameIndex === 0}
          className={iconBtn(currentFrameIndex === 0)}
          title="Previous (←)"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
          </svg>
        </button>

        {/* ── Play / Pause ── */}
        <button
          onClick={() => setIsPlaying(!isPlaying)}
          className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors duration-150 ${
            isPlaying
              ? 'bg-white text-gray-900 shadow-md shadow-white/20'
              : 'bg-white/12 text-white hover:bg-white/20'
          }`}
          title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
        >
          {isPlaying ? (
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
              <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
            </svg>
          ) : (
            <svg className="w-3 h-3 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z"/>
            </svg>
          )}
        </button>

        {/* ── Next Frame ── */}
        <button
          onClick={nextFrame}
          disabled={currentFrameIndex >= frames.length - 1}
          className={iconBtn(currentFrameIndex >= frames.length - 1)}
          title="Next (→)"
        >
          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24">
            <path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
          </svg>
        </button>

        {/* ── Last Frame ── */}
        <button
          onClick={goToLastFrame}
          disabled={currentFrameIndex >= frames.length - 1}
          className={iconBtn(currentFrameIndex >= frames.length - 1)}
          title="Last Frame (End)"
        >
          <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24">
            <path d="M8 5v14l11-7L8 5zM18 5v14h2V5h-2z"/>
          </svg>
        </button>

        {/* ── Divider ── */}
        <div className="mx-1 w-px h-4 bg-white/10" />

        {/* ── Progress Scrubber ── */}
        <div className="relative group flex items-center">
          <div
            ref={scrubberRef}
            className={`relative w-36 h-2 bg-white/10 rounded-full overflow-visible cursor-pointer transition-all ${
              isDragging ? 'h-2.5 bg-white/15' : 'hover:h-2'
            }`}
            onMouseDown={handleMouseDown}
            onTouchStart={(e) => {
              if (e.touches.length > 0) {
                e.preventDefault();
                handleScrubStart(e.touches[0].clientX);
              }
            }}
          >
            {/* Fill */}
            <div
              className={`absolute inset-y-0 left-0 bg-gradient-to-r from-blue-400 to-cyan-400 rounded-full pointer-events-none transition-all ${
                isDragging ? 'from-blue-300 to-cyan-300' : ''
              }`}
              style={{ width: `${progress}%` }}
            />
            {/* Thumb - always visible when dragging */}
            <div
              className={`absolute top-1/2 -translate-y-1/2 rounded-full shadow-lg pointer-events-none transition-all ${
                isDragging
                  ? 'w-3.5 h-3.5 bg-white opacity-100 scale-110'
                  : 'w-2.5 h-2.5 bg-white opacity-0 group-hover:opacity-100'
              }`}
              style={{ left: `calc(${progress}% - ${isDragging ? 7 : 5}px)` }}
            />
            {/* Frame preview tooltip while dragging */}
            {isDragging && (
              <div
                className="absolute -top-8 transform -translate-x-1/2 px-2 py-0.5 bg-gray-900 text-white text-[10px] font-mono rounded shadow-lg whitespace-nowrap"
                style={{ left: `${progress}%` }}
              >
                Frame {dragValue + 1}
              </div>
            )}
          </div>
        </div>

        {/* ── Divider ── */}
        <div className="mx-1 w-px h-4 bg-white/10" />

        {/* ── Frame Counter ── */}
        {isEditingFrame ? (
          <input
            ref={frameInputRef}
            type="text"
            value={frameInputValue}
            onChange={(e) => setFrameInputValue(e.target.value.replace(/\D/g, ''))}
            onBlur={handleFrameInputSubmit}
            onKeyDown={handleFrameInputKeyDown}
            className="w-12 px-1 py-0.5 text-[10px] font-mono bg-white/10 border border-blue-400/50 rounded text-white text-center focus:outline-none"
            autoFocus
          />
        ) : (
          <button
            onClick={handleFrameInputStart}
            className="flex items-center gap-px text-[10px] font-mono hover:text-white transition-colors whitespace-nowrap"
            title="Click to jump to frame"
          >
            <span className={`font-semibold ${isDragging ? 'text-blue-300' : 'text-white/90'}`}>
              {isDragging ? dragValue + 1 : (frames[shownFrameIndex]?.frame_index ?? shownFrameIndex) + 1}
            </span>
            <span className="text-white/35">/{task?.frame_range ? task.frame_range.end + 1 : (scene?.frame_count ?? frames.length)}</span>
            {isLoadingFrame && (
              <span className="ml-0.5 w-1.5 h-1.5 bg-amber-400 rounded-full animate-pulse" />
            )}
          </button>
        )}

        {/* ── Divider ── */}
        <div className="mx-1 w-px h-4 bg-white/10" />

        {/* ── Speed Control ── */}
        <button
          onClick={cyclePlaybackSpeed}
          className={`px-1.5 py-0.5 text-[10px] font-semibold rounded transition-colors ${
            playbackSpeed !== 1
              ? 'bg-blue-500/20 text-blue-300 border border-blue-400/30'
              : 'text-white/45 hover:text-white hover:bg-white/10'
          }`}
          title="Click to cycle speed"
        >
          {playbackSpeed}×
        </button>

      </div>
    </div>
  );
};

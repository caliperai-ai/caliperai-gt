import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSegmentationStore } from '@/store/segmentationStore';
import type { Taxonomy } from '@/types';

interface FloatingClassSelectorProps {
  taxonomy: Taxonomy | null;
}

export const FloatingClassSelector: React.FC<FloatingClassSelectorProps> = ({ taxonomy }) => {
  const activeClassId = useSegmentationStore((s) => s.activeClassId);
  const setActiveClass = useSegmentationStore((s) => s.setActiveClass);
  const selectedPointCount = useSegmentationStore((s) => s.selectedPointIndices.size);
  const labelSelectedPoints = useSegmentationStore((s) => s.labelSelectedPoints);

  const [position, setPosition] = useState({ x: -1, y: 56 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const pendingShortcutRef = useRef<string>('');
  const shortcutTimeoutRef = useRef<number | null>(null);

  const classes = useMemo(() => {
    if (!taxonomy?.classes) return [];
    return taxonomy.classes;
  }, [taxonomy?.classes]);

  const handleClassClick = useCallback((classIndex: number) => {
    const classId = String(classIndex);
    setActiveClass(classId);

    if (selectedPointCount > 0) {
      labelSelectedPoints(classId);
    }
  }, [setActiveClass, selectedPointCount, labelSelectedPoints]);

  useEffect(() => {
    const clearPendingShortcut = () => {
      pendingShortcutRef.current = '';
      if (shortcutTimeoutRef.current !== null) {
        window.clearTimeout(shortcutTimeoutRef.current);
        shortcutTimeoutRef.current = null;
      }
    };

    const selectClassByShortcut = (classNumber: number) => {
      if (classNumber >= 1 && classNumber <= classes.length) {
        handleClassClick(classNumber - 1);
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      if (!/^\d$/.test(e.key)) {
        const pending = pendingShortcutRef.current;
        if (pending) {
          selectClassByShortcut(Number(pending));
          clearPendingShortcut();
        }
        return;
      }

      const digit = e.key;
      const pending = pendingShortcutRef.current;
      const timeoutMs = 600;

      if (!pending && digit === '0') return;

      if (!pending) {
        const firstDigit = Number(digit);
        const canFormTwoDigit = classes.length >= firstDigit * 10;

        if (!canFormTwoDigit) {
          e.preventDefault();
          selectClassByShortcut(firstDigit);
          return;
        }

        e.preventDefault();
        pendingShortcutRef.current = digit;
        if (shortcutTimeoutRef.current !== null) {
          window.clearTimeout(shortcutTimeoutRef.current);
        }
        shortcutTimeoutRef.current = window.setTimeout(() => {
          const value = pendingShortcutRef.current;
          if (value) {
            selectClassByShortcut(Number(value));
          }
          clearPendingShortcut();
        }, timeoutMs);
        return;
      }

      e.preventDefault();
      const shortcut = Number(`${pending}${digit}`);
      selectClassByShortcut(shortcut);
      clearPendingShortcut();
    };

    const handleWindowBlur = () => {
      clearPendingShortcut();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('blur', handleWindowBlur);
      clearPendingShortcut();
    };
  }, [classes.length, handleClassClick]);

  // Clear pending shortcut state when taxonomy/class list changes
  useEffect(() => {
    pendingShortcutRef.current = '';
    if (shortcutTimeoutRef.current !== null) {
      window.clearTimeout(shortcutTimeoutRef.current);
      shortcutTimeoutRef.current = null;
    }
  }, [taxonomy?.id, classes.length]);

  // Drag handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return; // Don't drag when clicking buttons
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x,
      startPosY: position.y,
    };
  }, [position]);

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.startPosX + dx,
        y: dragRef.current.startPosY + dy,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  if (!taxonomy || classes.length === 0) return null;

  return (
    <div
      ref={panelRef}
      className="absolute z-20"
      style={{
        left: position.x === -1 ? 'auto' : position.x,
        right: position.x === -1 ? 8 : 'auto',
        top: position.y,
        cursor: isDragging ? 'grabbing' : 'default',
      }}
    >
      <div className="bg-dark-panel/95 backdrop-blur-sm rounded-lg border border-gray-700 shadow-xl overflow-hidden min-w-[180px]">
        {/* Header - draggable */}
        <div
          className="px-3 py-2 border-b border-gray-700 bg-dark-surface/50 cursor-grab active:cursor-grabbing flex items-center justify-between"
          onMouseDown={handleMouseDown}
        >
          <span className="text-sm font-medium text-white">Class{classes.length > 0 ? ` • ${classes.length} total` : ''}</span>
          <svg className="w-3 h-3 text-gray-500" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="5" cy="5" r="2" />
            <circle cx="12" cy="5" r="2" />
            <circle cx="19" cy="5" r="2" />
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </div>

        {/* Class list - scrollable */}
        <div className="p-2 space-y-0.5 max-h-[400px] overflow-y-auto">
          {classes.map((cls, index) => {
            const classId = String(index);
            const isActive = activeClassId === classId;

            return (
              <button
                key={cls.id}
                onClick={() => handleClassClick(index)}
                className={`w-full flex items-center gap-2 px-2 py-1.5 rounded transition-all ${
                  isActive
                    ? 'bg-primary/20 border border-primary/50'
                    : 'hover:bg-dark-hover border border-transparent'
                }`}
              >
                {/* Color swatch */}
                <div
                  className="w-3 h-3 rounded-sm flex-shrink-0 border border-white/20"
                  style={{ backgroundColor: cls.color }}
                />

                {/* Class name */}
                <span className={`flex-1 text-sm text-left truncate ${
                  isActive ? 'text-white font-medium' : 'text-gray-300'
                }`}>
                  {cls.name}
                </span>

                {/* Class number */}
                <span className={`text-xs px-1.5 py-0.5 rounded ${
                  isActive
                    ? 'bg-primary/30 text-primary-light'
                    : 'bg-gray-700/50 text-gray-500'
                }`}>
                  {index + 1}
                </span>
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="px-3 py-2 border-t border-gray-700 bg-dark-surface/30">
          <p className="text-[10px] text-gray-500 text-center">
            Press numbers for quick select{classes.length > 9 ? ' • Type 2 digits within 600ms for 10+' : ''}
          </p>
        </div>
      </div>
    </div>
  );
};

export default FloatingClassSelector;

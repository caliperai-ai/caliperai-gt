import React from 'react';
import { useEditorStore } from '@/store/editorStore';

export const CoordinateDisplay: React.FC = () => {
  const cursorPosition = useEditorStore((s) => s.cursorPosition);
  const coordinateFrame = useEditorStore((s) => s.lidarView.coordinateFrame);

  const frameLabel = coordinateFrame === 'world' ? 'World' :
                     coordinateFrame === 'ego' ? 'Ego' : 'LiDAR';

  return (
    <div className="absolute bottom-8 left-48 z-20">
      <div className="flex items-center gap-4 px-4 py-2 bg-gray-900/40 backdrop-blur-xl border border-white/10 rounded-full shadow-2xl">
        <div className="flex items-center gap-1 text-xs text-white/60">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
          <span className="font-medium">{frameLabel} Frame</span>
        </div>

        <div className="w-px h-4 bg-white/10" />

        <div className="flex items-center gap-3 font-mono text-xs">
          <div className="flex items-center gap-1">
            <span className="text-red-400 font-bold">X</span>
            <span className="text-white/90 min-w-[40px] text-right">
              {cursorPosition ? cursorPosition.x.toFixed(2) : '—'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-green-400 font-bold">Y</span>
            <span className="text-white/90 min-w-[40px] text-right">
              {cursorPosition ? cursorPosition.y.toFixed(2) : '—'}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-blue-400 font-bold">Z</span>
            <span className="text-white/90 min-w-[40px] text-right">
              {cursorPosition ? cursorPosition.z.toFixed(2) : '—'}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

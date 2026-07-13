import React from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useTrackStore } from '@/store/trackStore';
import type { Tool, AnnotationCapability } from './types';

const allTools: Tool[] = [
  {
    id: 'select',
    name: 'Select',
    icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 3l7.07 16.97 2.51-7.39 7.39-2.51L3 3z"/></svg>,
    shortcut: 'V'
  },
  {
    id: 'cuboid',
    name: '3D Box',
    icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>,
    shortcut: 'C',
    capability: 'bounding_box_3d'
  },
  {
    id: 'box2d',
    name: '2D Box',
    icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>,
    shortcut: 'B',
    capability: 'bounding_box_2d'
  },
  {
    id: 'polygon',
    name: 'Polygon',
    icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/></svg>,
    shortcut: 'P',
    capability: 'polygon'
  },
  {
    id: 'polyline',
    name: 'Polyline',
    icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 17 9 11 13 15 21 7"/></svg>,
    shortcut: 'L',
    capability: 'polyline'
  },
  {
    id: 'brush3d',
    name: 'Segment',
    icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>,
    shortcut: 'S',
    capability: 'semantic_segmentation'
  },
  {
    id: 'track',
    name: 'Track',
    icon: <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>,
    shortcut: 'T',
    capability: 'tracking'
  },
];

export { allTools };

interface ToolPaletteProps {
  availableCapabilities: AnnotationCapability[];
}

export const ToolPalette: React.FC<ToolPaletteProps> = ({ availableCapabilities }) => {
  const { activeTool, setActiveTool } = useEditorStore();
  const { activeTrackId, setActiveTrack, tracks } = useTrackStore();

  const availableTools = allTools.filter(tool => {
    if (!tool.capability) return true;
    return availableCapabilities.includes(tool.capability);
  });

  const activeTrack = activeTrackId ? tracks.get(activeTrackId) : null;

  return (
    <div className="absolute left-4 top-1/2 -translate-y-1/2 z-20">
      <div className="bg-dark-panel/95 backdrop-blur-sm rounded-xl border border-gray-700 p-2 shadow-xl">
        <div className="flex flex-col gap-1">
          {availableTools.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              className={`p-3 rounded-lg transition-all ${
                activeTool === tool.id
                  ? 'bg-primary text-white shadow-lg shadow-primary/30'
                  : 'text-gray-400 hover:bg-dark-hover hover:text-white'
              }`}
              title={`${tool.name} (${tool.shortcut})`}
            >
              {tool.icon}
            </button>
          ))}
        </div>

        {/* Active Track Indicator */}
        {activeTool === 'track' && (
          <div className="mt-2 pt-2 border-t border-gray-700">
            {activeTrack ? (
              <div className="px-2 py-1.5 bg-purple-500/20 rounded-lg">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 bg-purple-400 rounded-full animate-pulse" />
                    <span className="text-xs text-purple-300 font-medium">Active Track</span>
                  </div>
                  <button
                    onClick={() => setActiveTrack(null)}
                    className="text-xs text-gray-400 hover:text-red-400 p-0.5"
                    title="End track (ESC)"
                  >
                    <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
                <div className="text-[10px] text-gray-500 mt-0.5 font-mono">
                  {activeTrackId?.slice(0, 8)}...
                </div>
              </div>
            ) : (
              <div className="px-2 py-1.5 text-xs text-gray-500 text-center">
                Draw box to start new track
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

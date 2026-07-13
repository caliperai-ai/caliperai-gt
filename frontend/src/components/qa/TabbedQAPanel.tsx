import React, { useState, useCallback } from 'react';
import { FrameAnnotationsTab } from './FrameAnnotationsTab';
import { TrackReviewTab } from './TrackReviewTab';

const FrameIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z" />
  </svg>
);

const TrackIcon = () => (
  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
  </svg>
);

type TabType = 'frame' | 'track';

interface TabbedQAPanelProps {
  onJumpToAnnotation: (annotationId: string, frameId: string, zoomLevel?: number) => void;
  onSelectTrack: (trackId: string) => void;
}

export const TabbedQAPanel: React.FC<TabbedQAPanelProps> = ({
  onJumpToAnnotation,
  onSelectTrack,
}) => {
  const [activeTab, setActiveTab] = useState<TabType>('frame');

  const handlePanelClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  return (
    <div
      className="flex flex-col h-full bg-gray-900"
      onClick={handlePanelClick}
      onMouseDown={handlePanelClick}
    >
      {/* Tab Header */}
      <div className="flex-shrink-0 flex border-b border-gray-700">
        <button
          onClick={() => setActiveTab('frame')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium transition-colors ${
            activeTab === 'frame'
              ? 'bg-blue-600/20 text-blue-400 border-b-2 border-blue-500'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          <FrameIcon />
          Frame
        </button>
        <button
          onClick={() => setActiveTab('track')}
          className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium transition-colors ${
            activeTab === 'track'
              ? 'bg-purple-600/20 text-purple-400 border-b-2 border-purple-500'
              : 'text-gray-400 hover:text-white hover:bg-gray-800'
          }`}
        >
          <TrackIcon />
          Tracks
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'frame' ? (
          <FrameAnnotationsTab
            onJumpToAnnotation={onJumpToAnnotation}
          />
        ) : (
          <TrackReviewTab
            onJumpToAnnotation={onJumpToAnnotation}
            onSelectTrack={onSelectTrack}
          />
        )}
      </div>
    </div>
  );
};

export default TabbedQAPanel;

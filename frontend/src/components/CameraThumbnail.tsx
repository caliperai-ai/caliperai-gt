
import React from 'react';

interface CameraThumbnailProps {
  camera: string;
  imageUrl: string | undefined;
  isSelected: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}

export const CameraThumbnail: React.FC<CameraThumbnailProps> = ({
  camera,
  imageUrl,
  isSelected,
  onClick,
  onDoubleClick,
}) => {
  const isCached = imageUrl?.startsWith('blob:');
  const [imageError, setImageError] = React.useState(false);

  return (
    <button
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`flex-shrink-0 h-full aspect-video rounded-lg overflow-hidden border-2 transition-all relative group ${
        isSelected
          ? 'border-primary shadow-lg shadow-primary/30'
          : 'border-gray-600 hover:border-gray-400'
      }`}
      title="Click to view from this camera. Double-click to reset view."
    >
      {imageUrl && !imageError ? (
        <>
          <img
            key={imageUrl}
            src={imageUrl}
            alt={camera}
            className="w-full h-full object-cover"
            onError={() => setImageError(true)}
            // No lazy loading for cached blobs - instant display
            loading={isCached ? 'eager' : 'lazy'}
          />
          <div className="absolute inset-0 bg-black/20 group-hover:bg-transparent transition-colors" />
          <div className="absolute bottom-0 left-0 right-0 bg-black/60 backdrop-blur-sm text-white text-[10px] px-2 py-1">
            {camera.replace(/_/g, ' ')}
          </div>
        </>
      ) : (
        <div className="w-full h-full bg-dark flex flex-col items-center justify-center min-w-[160px]">
          <svg className="w-10 h-10 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          </svg>
          <span className="text-xs text-gray-400 mt-2 px-2 text-center">
            {camera.replace(/_/g, ' ')}
          </span>
        </div>
      )}
    </button>
  );
};

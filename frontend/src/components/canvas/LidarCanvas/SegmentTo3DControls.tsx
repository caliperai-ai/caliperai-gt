import React, { useCallback, useEffect } from 'react';
import { useSegmentTo3DStore } from '@/store/segmentTo3DStore';
import { useEditorStore } from '@/store/editorStore';
import { fitOrientedBoundingBox } from '@/utils/orientedBoundingBox';
import { getDefaultCuboidDimensions } from '@/utils/cuboidDimensions';
import type { CuboidData, CameraCalibration } from '@/types';

interface SegmentTo3DControlsProps {
  imageWidth?: number;
  imageHeight?: number;
  cameraId?: string;
  calibration?: CameraCalibration | null;
  onCuboidComplete?: (cuboid: CuboidData, isTrackMode: boolean, classId: string) => void;
  onBoxCreated?: (boxData: {
    center: { x: number; y: number; z: number };
    dimensions: { length: number; width: number; height: number };
    rotation: { yaw: number; pitch: number; roll: number };
  }) => void;
}

export const SegmentTo3DControls: React.FC<SegmentTo3DControlsProps> = ({
  imageWidth,
  imageHeight,
  cameraId,
  calibration: _calibration,
  onCuboidComplete,
  onBoxCreated,
}) => {
  const {
    isActive,
    currentStep,
    promptPoints,
    polygons,
    activePolygonId,
    isSegmenting,
    isCreatingBox,
    error,
    imageSize,
    projectedPoints,
    excludedPointIndices,
    activate,
    deactivate,
    reset,
    setError,
    setCreatingBox,
    setFilteredPoints,
    setStep,
    clearExcludedPoints,
    clearHeadingArrow,
    pendingBoxCreation,
    clearPendingBoxCreation,
    lastCreatedAnnotationId,
  } = useSegmentTo3DStore();

  const { createAnnotation, setActiveTool, selectAnnotation, taxonomy, activeClassId, lidarView } = useEditorStore();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isActive) {
        e.preventDefault();
        e.stopPropagation();

        if (lastCreatedAnnotationId) {
          selectAnnotation(lastCreatedAnnotationId);
          setActiveTool('select');
        }

        deactivate();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isActive, lastCreatedAnnotationId, selectAnnotation, setActiveTool, deactivate]);

  const detectedGroundPlane = lidarView.detectedGroundPlane;

  const getGroundZAtPosition = useCallback((x: number, y: number): number => {
    if (detectedGroundPlane && Math.abs(detectedGroundPlane.c) > 0.001) {
      return -(detectedGroundPlane.a * x + detectedGroundPlane.b * y + detectedGroundPlane.d) / detectedGroundPlane.c;
    }
    return -1.8;
  }, [detectedGroundPlane]);

  const handleCreate3DBox = useCallback(async () => {
    if (!activeClassId) {
      setError('Please select a class before creating the box');
      return;
    }

    const validPoints = projectedPoints.filter(p => p.isInside && !p.isExcluded);

    if (validPoints.length < 1) {
      setError('No LiDAR points selected. Need at least 1 point to create a box.');
      return;
    }

    setCreatingBox(true);
    setError(null);

    try {
      const points3D: { x: number; y: number; z: number }[] = validPoints.map(p => ({
        x: p.x3d,
        y: p.y3d,
        z: p.z3d,
      }));

      const filteredPositions = new Float32Array(validPoints.length * 3);
      for (let i = 0; i < validPoints.length; i++) {
        filteredPositions[i * 3] = validPoints[i].x3d;
        filteredPositions[i * 3 + 1] = validPoints[i].y3d;
        filteredPositions[i * 3 + 2] = validPoints[i].z3d;
      }

      setFilteredPoints({
        indices: validPoints.map(p => p.index),
        positions: filteredPositions,
        count: validPoints.length,
      });

      const currentHeadingArrow = useSegmentTo3DStore.getState().headingArrow;
      let yaw: number;
      let headingMethod: string;

      if (currentHeadingArrow) {
        yaw = currentHeadingArrow.yaw;
        headingMethod = 'user-heading-picker';
        console.log('[SegmentTo3D] Using user heading picker:', {
          yawDeg: (yaw * 180 / Math.PI).toFixed(1) + '°',
        });
      } else {
        const box = fitOrientedBoundingBox(points3D);
        yaw = box.rotation.yaw;
        headingMethod = box.method;
      }

      let sumX = 0, sumY = 0;
      for (const p of points3D) {
        sumX += p.x;
        sumY += p.y;
      }
      const rawCentroidX = sumX / points3D.length;
      const rawCentroidY = sumY / points3D.length;

      const groundZ = getGroundZAtPosition(rawCentroidX, rawCentroidY);

      const dimensions = getDefaultCuboidDimensions(activeClassId, taxonomy);
      const [length, width, height] = dimensions;

      let centroidX = rawCentroidX;
      let centroidY = rawCentroidY;

      if (currentHeadingArrow) {
        const anchorX = currentHeadingArrow.anchorX ?? 0;
        const anchorY = currentHeadingArrow.anchorY ?? 0;

        if (anchorX !== 0 || anchorY !== 0) {
          const cosY = Math.cos(-yaw);
          const sinY = Math.sin(-yaw);

          let minLX = Infinity, maxLX = -Infinity;
          let minLY = Infinity, maxLY = -Infinity;
          for (const p of points3D) {
            const dx = p.x - rawCentroidX;
            const dy = p.y - rawCentroidY;
            const lx = dx * cosY - dy * sinY;
            const ly = dx * sinY + dy * cosY;
            if (lx < minLX) minLX = lx;
            if (lx > maxLX) maxLX = lx;
            if (ly < minLY) minLY = ly;
            if (ly > maxLY) maxLY = ly;
          }

          const halfLen = length / 2;
          const halfWid = width / 2;
          let shiftLX = 0;
          let shiftLY = 0;
          const spreadX = maxLX - minLX;
          const spreadY = maxLY - minLY;

          if (anchorY !== 0 && spreadX < length * 0.85) {
            if (anchorY < 0) {
              shiftLX = minLX + halfLen;
            } else {
              shiftLX = maxLX - halfLen;
            }
          }

          if (anchorX !== 0 && spreadY < width * 0.85) {
            if (anchorX < 0) {
              shiftLY = maxLY - halfWid;
            } else {
              shiftLY = minLY + halfWid;
            }
          }

          const cosYInv = Math.cos(yaw);
          const sinYInv = Math.sin(yaw);
          const worldShiftX = shiftLX * cosYInv - shiftLY * sinYInv;
          const worldShiftY = shiftLX * sinYInv + shiftLY * cosYInv;

          centroidX += worldShiftX;
          centroidY += worldShiftY;

          console.log('[SegmentTo3D] Heading-aware alignment:', {
            rawCentroid: { x: rawCentroidX.toFixed(2), y: rawCentroidY.toFixed(2) },
            adjustedCenter: { x: centroidX.toFixed(2), y: centroidY.toFixed(2) },
            shiftLocal: { x: shiftLX.toFixed(2), y: shiftLY.toFixed(2) },
            shiftWorld: { x: worldShiftX.toFixed(2), y: worldShiftY.toFixed(2) },
            spread: { x: spreadX.toFixed(2), y: spreadY.toFixed(2) },
            anchor: { x: anchorX, y: anchorY },
            dims: { length, width },
          });
        }
      }

      console.log('[SegmentTo3D] Computed box position:', {
        pointCount: points3D.length,
        centroid: { x: centroidX.toFixed(2), y: centroidY.toFixed(2) },
        groundZ: groundZ.toFixed(2),
        yaw: (yaw * 180 / Math.PI).toFixed(1) + '°',
        method: headingMethod,
      });

      const cuboidData: CuboidData = {
        center: {
          x: centroidX,
          y: centroidY,
          z: groundZ + height / 2,
        },
        dimensions: { length, width, height },
        rotation: { yaw, pitch: 0, roll: 0 },
        confidence: 1.0,
      };

      if (onCuboidComplete) {
        onCuboidComplete(cuboidData, false, activeClassId);
      } else {
        const annotation = createAnnotation({
          type: 'cuboid',
          class_id: activeClassId,
          source: 'manual' as const,
          data: cuboidData,
        });

        selectAnnotation(annotation.id);
        setActiveTool('select');
      }

      onBoxCreated?.({
        center: cuboidData.center,
        dimensions: cuboidData.dimensions,
        rotation: cuboidData.rotation,
      });

      setStep('done');
      setCreatingBox(false);

    } catch (err) {
      console.error('[SegmentTo3D] Box creation failed:', err);
      setError(`Failed to create 3D box: ${err instanceof Error ? err.message : 'Unknown error'}`);
      setCreatingBox(false);
    }
  }, [
    projectedPoints, activeClassId, taxonomy,
    setCreatingBox, setError, setFilteredPoints, setStep, getGroundZAtPosition,
    onCuboidComplete, createAnnotation, selectAnnotation, setActiveTool, onBoxCreated,
  ]);

  // Watch for pendingBoxCreation from HeadingPickerOverlay
  // This allows the on-image arrow picker to trigger box creation
  useEffect(() => {
    if (pendingBoxCreation && !isCreatingBox && activePolygonId) {
      console.log('[SegmentTo3DControls] pendingBoxCreation detected, creating box...');
      clearPendingBoxCreation();
      handleCreate3DBox();
    }
  }, [pendingBoxCreation, isCreatingBox, activePolygonId, clearPendingBoxCreation, handleCreate3DBox]);

  // Get status text - simplified for cleaner UX
  const getStatusText = (): string => {
    const insidePoints = projectedPoints.filter(p => p.isInside && !p.isExcluded);

    switch (currentStep) {
      case 'idle':
      case 'clicking':
        return promptPoints.length === 0
          ? 'Click on object'
          : 'Processing...';
      case 'segmenting':
        return 'Segmenting...';
      case 'editing':
        if (polygons.length === 0) return 'No segments. Try again.';
        return insidePoints.length > 0
          ? `${insidePoints.length} points • Pick heading`
          : 'No LiDAR points found';
      case 'creating_box':
        return 'Creating box...';
      case 'done':
        return '✓ Box created';
      default:
        return '';
    }
  };

  // Use prop dimensions or fallback to store
  const activateWithDimensions = useCallback(() => {
    const dims = {
      width: imageWidth || imageSize?.width || 1920,
      height: imageHeight || imageSize?.height || 1080
    };
    activate(cameraId || 'current', dims);
  }, [imageWidth, imageHeight, imageSize, cameraId, activate]);

  if (!isActive) {
    return (
      <button
        onClick={activateWithDimensions}
        className="flex items-center gap-2 px-3 py-1.5 bg-gradient-to-r from-blue-500 to-purple-500
                   hover:from-blue-600 hover:to-purple-600 text-white text-sm font-medium rounded-lg
                   shadow-lg transition-all duration-200"
        title="Click on object to instantly create 3D box (Shift+click = auto heading)"
      >
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
        </svg>
        Smart Box
      </button>
    );
  }

  return (
    <div className="bg-gray-900/95 backdrop-blur-sm border border-gray-700 rounded-lg p-3 shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-white flex items-center gap-2">
          <svg className="w-4 h-4 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
          </svg>
          Smart Box
        </h3>
        <button
          onClick={deactivate}
          className="text-gray-400 hover:text-white p-1 rounded"
          title="Close (ESC)"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Class Selector - always visible */}
      {(() => {
        const currentClass = taxonomy?.classes.find(c => c.id === activeClassId);
        return (
          <div className="mb-3">
            <select
              value={activeClassId || ''}
              onChange={(e) => {
                useEditorStore.getState().setActiveClass(e.target.value);
              }}
              className="w-full bg-gray-800 text-white text-sm rounded px-2 py-1.5 border border-gray-600
                        focus:border-purple-500 focus:ring-1 focus:ring-purple-500 cursor-pointer"
              style={{
                borderLeft: `4px solid ${currentClass?.color || '#3b82f6'}`,
              }}
            >
              {taxonomy?.classes.map(cls => (
                <option key={cls.id} value={cls.id}>
                  {cls.name}
                </option>
              ))}
            </select>
          </div>
        );
      })()}

      {/* Status */}
      <div className="text-xs text-gray-300 mb-3 p-2 bg-gray-800 rounded">
        {isSegmenting && (
          <span className="inline-block w-3 h-3 border-2 border-blue-400 border-t-transparent rounded-full animate-spin mr-2" />
        )}
        {isCreatingBox && (
          <span className="inline-block w-3 h-3 border-2 border-green-400 border-t-transparent rounded-full animate-spin mr-2" />
        )}
        {getStatusText()}
      </div>

      {/* Error */}
      {error && (
        <div className="text-xs text-red-400 mb-3 p-2 bg-red-900/30 rounded border border-red-800">
          {error}
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-2">
        {/* Clear Excluded Points - Show when there are excluded points */}
        {excludedPointIndices.size > 0 && (
          <button
            onClick={clearExcludedPoints}
            className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 hover:bg-orange-500 text-white text-sm rounded transition-colors"
            title="Reset all excluded points"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Reset Points ({excludedPointIndices.size})
          </button>
        )}

        {/* Set Heading Direction - simplified: heading arrows now appear on image */}
        {/* The on-image HeadingPickerOverlay handles direction selection */}

        {/* Quick Box Button - creates box with auto heading */}
        {currentStep === 'editing' && activePolygonId && (
          <button
            onClick={() => {
              // Skip heading step - create with auto heading
              clearHeadingArrow();
              handleCreate3DBox();
            }}
            disabled={isCreatingBox}
            className="flex items-center gap-1 px-3 py-1.5 bg-green-600 hover:bg-green-500
                     disabled:opacity-50 disabled:cursor-not-allowed
                     text-white text-sm font-medium rounded transition-colors"
            title="Create box with auto-estimated heading"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            Quick Box
          </button>
        )}

        {/* Cancel - only show when segmenting or editing (not when done) */}
        {(currentStep === 'segmenting' || currentStep === 'editing') && (
          <button
            onClick={reset}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded transition-colors"
            title="Cancel and start over"
          >
            ✕ Cancel
          </button>
        )}
      </div>

      {/* Success indicator - shown after box creation */}
      {currentStep === 'done' && lastCreatedAnnotationId && (
        <div className="mt-2 p-2 bg-green-900/30 rounded border border-green-700 text-center">
          <div className="text-xs text-green-300 flex items-center justify-center gap-1">
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Created • Click for next
          </div>
        </div>
      )}


      {/* Instructions */}
      <div className="mt-3 pt-3 border-t border-gray-700 text-xs text-gray-500">
        <ul className="space-y-0.5">
          <li className={currentStep === 'clicking' || currentStep === 'segmenting' ? 'text-blue-400' : ''}>• Click on object</li>
          <li className={currentStep === 'editing' ? 'text-blue-400' : ''}>• Pick heading (1-8 or A)</li>
          <li className={currentStep === 'creating_box' || currentStep === 'done' ? 'text-green-400' : ''}>• Done!</li>
        </ul>
        <div className="mt-1 text-gray-600 text-[10px]">
          Shift+click = instant box • ESC to exit
        </div>
      </div>
    </div>
  );
};

export default SegmentTo3DControls;

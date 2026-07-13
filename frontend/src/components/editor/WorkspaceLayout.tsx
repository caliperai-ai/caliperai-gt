import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useEditorStore, useSelectedAnnotations } from '@/store/editorStore';
import { useAuthStore } from '@/store/authStore';
import type { CuboidData, Annotation } from '@/types';
import {
  findVisibleCamerasForCuboid,
  getCuboidCorners,
  projectLidarPointsToImage,
  CUBOID_EDGES
} from '@/utils/projection';


type RightPanelTab = 'cameras' | 'ortho' | 'properties';
type BottomPanelTab = 'annotations' | 'timeline';

interface WorkspaceLayoutProps {
  children: React.ReactNode;
  cameraViews?: React.ReactNode;
  orthographicViews?: React.ReactNode;
  propertiesPanel?: React.ReactNode;
  annotationsList?: React.ReactNode;
  timeline?: React.ReactNode;
  onSelectedCuboidChange?: (cuboid: CuboidData | null) => void;
}


interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  badge?: number;
  highlight?: boolean;
}

const TabButton: React.FC<TabButtonProps> = ({ active, onClick, icon, label, badge, highlight }) => (
  <button
    onClick={onClick}
    className={`flex items-center gap-2 px-3 py-2 rounded-t-lg transition-all text-sm font-medium border-b-2 ${
      active
        ? 'bg-dark-panel text-white border-primary'
        : highlight
          ? 'bg-primary/20 text-primary-light border-transparent hover:bg-primary/30'
          : 'text-gray-400 border-transparent hover:text-white hover:bg-dark-hover'
    }`}
  >
    {icon}
    <span>{label}</span>
    {badge !== undefined && badge > 0 && (
      <span className={`ml-1 px-1.5 py-0.5 text-xs rounded-full ${
        active ? 'bg-primary text-white' : 'bg-gray-700 text-gray-300'
      }`}>
        {badge}
      </span>
    )}
  </button>
);

// =============================================================================
// CAMERA GRID COMPONENT (for right panel)
// =============================================================================

interface CameraGridProps {
  selectedCuboid: CuboidData | null;
  classColor: string;
}

const CameraGrid: React.FC<CameraGridProps> = ({ selectedCuboid, classColor }) => {
  const { scene, currentFrame, selection } = useEditorStore();
  const [viewMode, setViewMode] = useState<'all' | 'visible'>('all');

  // Get all cameras
  const allCameras = useMemo(() => {
    if (!scene?.storage_paths?.cameras) {
      return ['front_camera', 'front_left_camera', 'front_right_camera', 'rear_camera'];
    }
    return Object.keys(scene.storage_paths.cameras);
  }, [scene?.storage_paths?.cameras]);

  // Compute visible cameras for selected cuboid
  const visibleCameras = useMemo(() => {
    if (!selectedCuboid || !scene?.calibration?.lidar_to_cameras) {
      return [];
    }
    try {
      const defaultImageSize = { width: 1920, height: 1080 };
      return findVisibleCamerasForCuboid(
        selectedCuboid,
        scene.calibration.lidar_to_cameras,
        defaultImageSize,
        2
      );
    } catch {
      return [];
    }
  }, [selectedCuboid, scene?.calibration?.lidar_to_cameras]);

  const camerasToShow = viewMode === 'visible' && visibleCameras.length > 0
    ? visibleCameras
    : allCameras;

  // Build image URL - use smaller images for grid thumbnails
  const getImageUrl = useCallback((cameraId: string, isThumb: boolean = true): string | undefined => {
    if (!scene?.storage_paths?.cameras?.[cameraId] || !currentFrame?.file_paths?.cameras?.[cameraId]) {
      return undefined;
    }
    const basePath = scene.storage_paths.cameras[cameraId].replace(/\/$/, '');
    const filename = currentFrame.file_paths.cameras[cameraId];
    const token = useAuthStore.getState().accessToken;
    const baseUrl = `/api/v1/data/image/${basePath}/${filename}`;
    const params = new URLSearchParams();
    if (token) params.append('token', token);
    if (isThumb) params.append('width', '600'); // Smaller image for grid view
    return `${baseUrl}?${params.toString()}`;
  }, [scene?.storage_paths?.cameras, currentFrame?.file_paths?.cameras]);

  return (
    <div className="h-full flex flex-col">
      {/* View mode toggle */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700/50">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('all')}
            className={`px-2 py-1 rounded text-xs ${
              viewMode === 'all' ? 'bg-primary/20 text-primary' : 'text-gray-400 hover:text-white'
            }`}
          >
            All ({allCameras.length})
          </button>
          <button
            onClick={() => setViewMode('visible')}
            disabled={visibleCameras.length === 0}
            className={`px-2 py-1 rounded text-xs ${
              viewMode === 'visible' ? 'bg-green-500/20 text-green-400' : 'text-gray-400 hover:text-white disabled:opacity-50'
            }`}
          >
            Visible ({visibleCameras.length})
          </button>
        </div>
        {selection.selectedAnnotationIds.length > 0 && (
          <span className="text-xs text-green-400">
            {visibleCameras.length} cameras see selected box
          </span>
        )}
      </div>

      {/* Camera grid */}
      <div className="flex-1 overflow-auto p-2">
        <div className={`grid gap-2 ${
          camerasToShow.length <= 2 ? 'grid-cols-1' :
          camerasToShow.length <= 4 ? 'grid-cols-2' : 'grid-cols-3'
        }`}>
          {camerasToShow.map((cameraId) => (
            <CameraCard
              key={cameraId}
              cameraId={cameraId}
              imageUrl={getImageUrl(cameraId)}
              selectedCuboid={selectedCuboid}
              classColor={classColor}
              isVisible={visibleCameras.includes(cameraId)}
              scene={scene}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

// Single camera card with projection overlay
const CameraCard: React.FC<{
  cameraId: string;
  imageUrl: string | undefined;
  selectedCuboid: CuboidData | null;
  classColor: string;
  isVisible: boolean;
  scene: any;
}> = ({ cameraId, imageUrl, selectedCuboid, classColor, isVisible, scene }) => {
  const [imageSize, setImageSize] = useState<{ width: number; height: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const cameraCalib = scene?.calibration?.lidar_to_cameras?.[cameraId];

  // Track container size
  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Project cuboid corners to 2D
  const projectedEdges = useMemo(() => {
    if (!selectedCuboid || !cameraCalib || !imageSize) return [];

    try {
      const lidarCorners = getCuboidCorners(selectedCuboid);
      const corners2D = projectLidarPointsToImage(
        lidarCorners,
        cameraCalib.extrinsic,
        cameraCalib.intrinsic,
        imageSize
      );

      const edges: { x1: number; y1: number; x2: number; y2: number }[] = [];
      for (const [i, j] of CUBOID_EDGES) {
        const start = corners2D[i];
        const end = corners2D[j];
        if (start && end) {
          edges.push({ x1: start.x, y1: start.y, x2: end.x, y2: end.y });
        }
      }
      return edges;
    } catch {
      return [];
    }
  }, [selectedCuboid, cameraCalib, imageSize]);

  // Scale factor
  const scale = useMemo(() => {
    if (!imageSize || containerSize.width === 0) return { x: 1, y: 1, displayWidth: 0, displayHeight: 0, offsetX: 0, offsetY: 0 };

    const imageAspect = imageSize.width / imageSize.height;
    const containerAspect = containerSize.width / containerSize.height;

    let displayWidth: number, displayHeight: number;
    if (containerAspect > imageAspect) {
      displayHeight = containerSize.height;
      displayWidth = displayHeight * imageAspect;
    } else {
      displayWidth = containerSize.width;
      displayHeight = displayWidth / imageAspect;
    }

    return {
      x: displayWidth / imageSize.width,
      y: displayHeight / imageSize.height,
      displayWidth,
      displayHeight,
      offsetX: (containerSize.width - displayWidth) / 2,
      offsetY: (containerSize.height - displayHeight) / 2,
    };
  }, [imageSize, containerSize]);

  const handleImageLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
  };

  return (
    <div
      ref={containerRef}
      className={`relative aspect-video rounded-lg overflow-hidden border-2 transition-all bg-black flex items-center justify-center ${
        isVisible ? 'border-green-500/50' : 'border-gray-700'
      }`}
      onClick={() => useEditorStore.getState().activateCameraView(cameraId)}
    >
      {imageUrl ? (
        <>
          <img
            src={imageUrl}
            alt={cameraId}
            onLoad={handleImageLoad}
            className="max-w-full max-h-full object-contain"
          />

          {/* Projected cuboid overlay */}
          {imageSize && projectedEdges.length > 0 && (
            <svg
              className="absolute pointer-events-none"
              style={{
                left: scale.offsetX,
                top: scale.offsetY,
                width: scale.displayWidth,
                height: scale.displayHeight,
              }}
              viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
              preserveAspectRatio="xMidYMid meet"
            >
              {projectedEdges.map((edge, idx) => (
                <line
                  key={idx}
                  x1={edge.x1}
                  y1={edge.y1}
                  x2={edge.x2}
                  y2={edge.y2}
                  stroke={classColor}
                  strokeWidth={3}
                  strokeLinecap="round"
                />
              ))}
            </svg>
          )}

          {/* Visibility indicator */}
          {isVisible && (
            <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-green-500 shadow" />
          )}
        </>
      ) : (
        <div className="flex flex-col items-center justify-center text-gray-500">
          <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
          </svg>
          <span className="text-xs mt-1">No image</span>
        </div>
      )}

      {/* Camera label */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-2 py-1.5">
        <span className="text-white text-xs">{cameraId.replace(/_/g, ' ')}</span>
      </div>
    </div>
  );
};

// =============================================================================
// ANNOTATIONS LIST PANEL (for bottom panel)
// =============================================================================

const CompactAnnotationsList: React.FC = () => {
  const { annotations, selection, selectAnnotation, taxonomy, deleteAnnotation } = useEditorStore();

  // Group annotations by class
  const groupedAnnotations = useMemo(() => {
    const groups: Record<string, Annotation[]> = {};
    annotations.forEach(ann => {
      const key = ann.class_id;
      if (!groups[key]) groups[key] = [];
      groups[key].push(ann);
    });
    return groups;
  }, [annotations]);

  const getClassColor = (classId: string) => {
    return taxonomy?.classes.find(c => c.id === classId)?.color || '#888';
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-2">
        {Object.entries(groupedAnnotations).map(([classId, items]) => (
          <div key={classId} className="mb-3">
            <div className="flex items-center gap-2 px-2 py-1 text-xs font-medium text-gray-400 uppercase">
              <div className="w-2 h-2 rounded" style={{ backgroundColor: getClassColor(classId) }} />
              {taxonomy?.classes.find(c => c.id === classId)?.name || classId}
              <span className="ml-auto bg-gray-700 px-1.5 py-0.5 rounded text-xs">{items.length}</span>
            </div>

            <div className="space-y-0.5">
              {items.map(ann => {
                const isSelected = selection.selectedAnnotationIds.includes(ann.id);
                return (
                  <div
                    key={ann.id}
                    onClick={(e) => selectAnnotation(ann.id, e.metaKey || e.ctrlKey)}
                    className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-primary/20 border border-primary/30'
                        : 'hover:bg-white/5 border border-transparent'
                    }`}
                  >
                    <div className="w-2 h-2 rounded" style={{ backgroundColor: getClassColor(ann.class_id) }} />

                    <span className="text-xs font-mono text-gray-300 flex-1 truncate">
                      {ann.id.slice(0, 8)}...
                    </span>

                    {ann.track_id && (
                      <span className="text-[10px] text-purple-400 bg-purple-500/20 px-1 rounded">
                        T
                      </span>
                    )}

                    {ann.is_static && (
                      <span className="text-[10px] text-blue-400 bg-blue-500/20 px-1 rounded">
                        S
                      </span>
                    )}

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteAnnotation(ann.id);
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-500/30 text-red-400"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {annotations.size === 0 && (
          <div className="text-center text-gray-500 text-sm py-8">
            No annotations yet
          </div>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// MAIN WORKSPACE LAYOUT
// =============================================================================

export const WorkspaceLayout: React.FC<WorkspaceLayoutProps> = ({
  children,
  orthographicViews,
  propertiesPanel,
  annotationsList,
  timeline,
}) => {
  // Panel state
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>('cameras');
  const [bottomPanelTab, setBottomPanelTab] = useState<BottomPanelTab>('annotations');
  const [rightPanelWidth, setRightPanelWidth] = useState(400);
  const [bottomPanelHeight, setBottomPanelHeight] = useState(200);
  const [isRightPanelCollapsed, setIsRightPanelCollapsed] = useState(false);
  const [isBottomPanelCollapsed, setIsBottomPanelCollapsed] = useState(false);

  // Resizing state
  const [isResizingRight, setIsResizingRight] = useState(false);
  const [isResizingBottom, setIsResizingBottom] = useState(false);

  // Selection state
  const selectedAnnotations = useSelectedAnnotations();
  const { taxonomy, annotations, scene } = useEditorStore();

  // Compute selected cuboid
  const selectedCuboid = useMemo<CuboidData | null>(() => {
    if (selectedAnnotations.length === 0) return null;
    const ann = selectedAnnotations[0];
    if (ann.type !== 'cuboid') return null;
    const data = ann.data as CuboidData;
    if (!data?.center || !data?.dimensions) return null;
    return data;
  }, [selectedAnnotations]);

  // Get class color for selected annotation
  const selectedClassColor = useMemo(() => {
    if (selectedAnnotations.length === 0) return '#00ff00';
    const ann = selectedAnnotations[0];
    const classDef = taxonomy?.classes.find((c) => c.id === ann.class_id);
    return classDef?.color || '#00ff00';
  }, [selectedAnnotations, taxonomy]);

  // Compute visible cameras for smart tab highlighting
  const visibleCameraCount = useMemo(() => {
    if (!selectedCuboid || !scene?.calibration?.lidar_to_cameras) return 0;
    try {
      const defaultImageSize = { width: 1920, height: 1080 };
      return findVisibleCamerasForCuboid(
        selectedCuboid,
        scene.calibration.lidar_to_cameras,
        defaultImageSize,
        2
      ).length;
    } catch {
      return 0;
    }
  }, [selectedCuboid, scene?.calibration?.lidar_to_cameras]);

  // Auto-switch to properties when annotation selected
  // Disabled - users can manually switch to properties tab if needed
  // The LabelListPanel now has inline editing capabilities

  // Resize handlers
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isResizingRight) {
        const newWidth = window.innerWidth - e.clientX;
        setRightPanelWidth(Math.max(300, Math.min(600, newWidth)));
      }
      if (isResizingBottom) {
        const newHeight = window.innerHeight - e.clientY - 48; // 48px header
        setBottomPanelHeight(Math.max(100, Math.min(400, newHeight)));
      }
    };

    const handleMouseUp = () => {
      setIsResizingRight(false);
      setIsResizingBottom(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    if (isResizingRight || isResizingBottom) {
      document.body.style.cursor = isResizingRight ? 'col-resize' : 'row-resize';
      document.body.style.userSelect = 'none';
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizingRight, isResizingBottom]);

  return (
    <div className="h-full flex flex-col">
      {/* Main content area */}
      <div className="flex-1 flex min-h-0">
        {/* Main 3D canvas area */}
        <div
          className="flex-1 relative"
          style={{
            marginRight: isRightPanelCollapsed ? 0 : rightPanelWidth,
            marginBottom: isBottomPanelCollapsed ? 0 : bottomPanelHeight,
          }}
        >
          {children}
        </div>

        {/* Right Panel - Tabbed (Cameras / Ortho / Properties) */}
        <div
          className={`fixed right-0 top-12 bg-dark-panel border-l border-gray-700 transition-all duration-300 flex flex-col ${
            isRightPanelCollapsed ? 'translate-x-full' : ''
          }`}
          style={{
            width: rightPanelWidth,
            bottom: isBottomPanelCollapsed ? 0 : bottomPanelHeight,
          }}
        >
          {/* Resize handle */}
          <div
            className="absolute top-0 bottom-0 left-0 w-1 hover:w-2 cursor-col-resize hover:bg-primary/50 transition-all z-10"
            onMouseDown={() => setIsResizingRight(true)}
          />

          {/* Tab bar */}
          <div className="flex items-center gap-1 px-2 pt-2 border-b border-gray-700 bg-dark">
            <TabButton
              active={rightPanelTab === 'cameras'}
              onClick={() => setRightPanelTab('cameras')}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                </svg>
              }
              label="Cameras"
              badge={visibleCameraCount > 0 ? visibleCameraCount : undefined}
              highlight={visibleCameraCount > 0 && rightPanelTab !== 'cameras'}
            />
            <TabButton
              active={rightPanelTab === 'ortho'}
              onClick={() => setRightPanelTab('ortho')}
              icon={
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                </svg>
              }
              label="Ortho"
              highlight={selectedAnnotations.length > 0 && rightPanelTab !== 'ortho'}
            />
            <TabButton
              active={rightPanelTab === 'properties'}
              onClick={() => setRightPanelTab('properties')}
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                </svg>
              }
              label="Properties"
              highlight={selectedAnnotations.length > 0 && rightPanelTab !== 'properties'}
            />

            {/* Collapse button */}
            <button
              onClick={() => setIsRightPanelCollapsed(true)}
              className="ml-auto p-1.5 rounded text-gray-400 hover:text-white hover:bg-dark-hover"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {rightPanelTab === 'cameras' && (
              <CameraGrid
                selectedCuboid={selectedCuboid}
                classColor={selectedClassColor}
              />
            )}
            {rightPanelTab === 'ortho' && orthographicViews}
            {rightPanelTab === 'properties' && propertiesPanel}
          </div>
        </div>

        {/* Right panel collapse toggle */}
        {isRightPanelCollapsed && (
          <button
            onClick={() => setIsRightPanelCollapsed(false)}
            className="fixed right-2 top-1/2 -translate-y-1/2 p-2 bg-dark-panel border border-gray-700 rounded-l-lg text-gray-400 hover:text-white hover:bg-dark-hover z-30"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}
      </div>

      {/* Bottom Panel - Annotations list + Timeline */}
      <div
        className={`fixed left-0 right-0 bg-dark-panel border-t border-gray-700 transition-all duration-300 ${
          isBottomPanelCollapsed ? 'translate-y-full' : ''
        }`}
        style={{
          height: bottomPanelHeight,
          bottom: 0,
          right: isRightPanelCollapsed ? 0 : rightPanelWidth,
        }}
      >
        {/* Resize handle */}
        <div
          className="absolute top-0 left-0 right-0 h-1 hover:h-2 cursor-row-resize hover:bg-primary/50 transition-all z-10"
          onMouseDown={() => setIsResizingBottom(true)}
        />

        {/* Tab bar */}
        <div className="flex items-center gap-1 px-2 pt-1 border-b border-gray-700 bg-dark">
          <TabButton
            active={bottomPanelTab === 'annotations'}
            onClick={() => setBottomPanelTab('annotations')}
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            }
            label="Annotations"
            badge={annotations.size}
          />
          <TabButton
            active={bottomPanelTab === 'timeline'}
            onClick={() => setBottomPanelTab('timeline')}
            icon={
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            }
            label="Timeline"
          />

          {/* Collapse button */}
          <button
            onClick={() => setIsBottomPanelCollapsed(true)}
            className="ml-auto p-1.5 rounded text-gray-400 hover:text-white hover:bg-dark-hover"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
        </div>

        {/* Tab content */}
        <div className="h-[calc(100%-36px)] overflow-hidden">
          {bottomPanelTab === 'annotations' && (annotationsList || <CompactAnnotationsList />)}
          {bottomPanelTab === 'timeline' && timeline}
        </div>
      </div>

      {/* Bottom panel collapse toggle */}
      {isBottomPanelCollapsed && (
        <button
          onClick={() => setIsBottomPanelCollapsed(false)}
          className="fixed bottom-2 left-1/2 -translate-x-1/2 p-2 bg-dark-panel border border-gray-700 rounded-t-lg text-gray-400 hover:text-white hover:bg-dark-hover z-30"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default WorkspaceLayout;

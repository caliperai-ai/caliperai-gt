import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Stage, Layer, Image, Rect, Line, Circle, Ellipse, Group, Text, Transformer } from 'react-konva';
import Konva from 'konva';
import { useQuery } from '@tanstack/react-query';
import { taskApi, sceneApi, datasetApi, taxonomyApi } from '@/api/client';
import { useAnnotation2DStore, Tool2D, Annotation2D, BoxData, EllipseData, PolygonData, PolylineData, PointsData } from '@/store/annotation2DStore';
import { useEditorStore } from '@/store/editorStore';
import ObjectsAndTracksPanel from '@/components/ObjectsAndTracksPanel';



const icons = {
  select: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
    </svg>
  ),
  pan: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11.5V14m0-2.5v-6a1.5 1.5 0 113 0m-3 6a1.5 1.5 0 00-3 0v2a7.5 7.5 0 0015 0v-5a1.5 1.5 0 00-3 0m-6-3V11m0-5.5v-1a1.5 1.5 0 013 0v1m0 0V11m0-5.5a1.5 1.5 0 013 0v3m0 0V11" />
    </svg>
  ),
  box: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      <rect x="5" y="5" width="14" height="14" strokeWidth={2} fill="none" />
    </svg>
  ),
  ellipse: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <ellipse cx="12" cy="12" rx="9" ry="6" strokeWidth={2} />
    </svg>
  ),
  polygon: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l8 6-3 9H7l-3-9z" />
    </svg>
  ),
  polyline: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 20l6-10 4 6 6-12" />
    </svg>
  ),
  points: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <circle cx="6" cy="6" r="2" fill="currentColor" />
      <circle cx="18" cy="6" r="2" fill="currentColor" />
      <circle cx="6" cy="18" r="2" fill="currentColor" />
      <circle cx="18" cy="18" r="2" fill="currentColor" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
    </svg>
  ),
  brush: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  ),
  undo: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
    </svg>
  ),
  redo: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 10h-10a8 8 0 00-8 8v2M21 10l-6 6m6-6l-6-6" />
    </svg>
  ),
  zoomIn: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM10 7v6m3-3H7" />
    </svg>
  ),
  zoomOut: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0zM13 10H7" />
    </svg>
  ),
  fitView: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
    </svg>
  ),
  eye: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
    </svg>
  ),
  eyeOff: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
    </svg>
  ),
  lock: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  ),
  unlock: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
    </svg>
  ),
  trash: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  ),
  copy: (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  ),
  save: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
    </svg>
  ),
  grid: (
    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 5a1 1 0 011-1h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 9h16M4 15h16M9 4v16M15 4v16" />
    </svg>
  ),
};


interface ToolDefinition {
  id: Tool2D;
  name: string;
  shortcut: string;
  icon: React.ReactNode;
}

const tools: ToolDefinition[] = [
  { id: 'select', name: 'Select (V)', shortcut: 'v', icon: icons.select },
  { id: 'pan', name: 'Pan (H)', shortcut: 'h', icon: icons.pan },
  { id: 'box', name: 'Rectangle (R)', shortcut: 'r', icon: icons.box },
  { id: 'ellipse', name: 'Ellipse (E)', shortcut: 'e', icon: icons.ellipse },
  { id: 'polygon', name: 'Polygon (P)', shortcut: 'p', icon: icons.polygon },
  { id: 'polyline', name: 'Polyline (L)', shortcut: 'l', icon: icons.polyline },
  { id: 'points', name: 'Points (K)', shortcut: 'k', icon: icons.points },
  { id: 'brush', name: 'Brush (B)', shortcut: 'b', icon: icons.brush },
];


interface ClassDef {
  id: string;
  name: string;
  color: string;
}

const defaultClasses: ClassDef[] = [
  { id: 'car', name: 'Car', color: '#3b82f6' },
  { id: 'truck', name: 'Truck', color: '#ef4444' },
  { id: 'bus', name: 'Bus', color: '#f59e0b' },
  { id: 'motorcycle', name: 'Motorcycle', color: '#10b981' },
  { id: 'bicycle', name: 'Bicycle', color: '#8b5cf6' },
  { id: 'pedestrian', name: 'Pedestrian', color: '#ec4899' },
  { id: 'traffic_sign', name: 'Traffic Sign', color: '#06b6d4' },
  { id: 'traffic_light', name: 'Traffic Light', color: '#84cc16' },
];


interface AnnotationShapeProps {
  annotation: Annotation2D;
  isSelected: boolean;
  isHovered: boolean;
  classColor: string;
  showLabel: boolean;
  fillOpacity: number;
  onSelect: () => void;
  onHover: (hover: boolean) => void;
  onUpdate: (data: Annotation2D['data']) => void;
}

const AnnotationShape: React.FC<AnnotationShapeProps> = ({
  annotation,
  isSelected,
  isHovered,
  classColor,
  showLabel,
  fillOpacity,
  onSelect,
  onHover,
  onUpdate,
}) => {
  const shapeRef = useRef<Konva.Rect | Konva.Ellipse | Konva.Line | Konva.Group>(null);
  const trRef = useRef<Konva.Transformer>(null);

  useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const strokeWidth = isSelected ? 3 : isHovered ? 2.5 : 2;
  const strokeColor = isSelected ? '#fff' : classColor;
  const fillColor = classColor;

  if (annotation.isHidden) return null;

  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    const data = annotation.data;

    if ('x' in data) {
      onUpdate({ ...data, x: node.x(), y: node.y() });
    } else if ('cx' in data) {
      onUpdate({ ...data, cx: node.x(), cy: node.y() });
    }
  };

  const handleTransformEnd = () => {
    const node = shapeRef.current;
    if (!node) return;

    const data = annotation.data;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();

    node.scaleX(1);
    node.scaleY(1);

    if (annotation.type === 'box' && 'x' in data) {
      onUpdate({
        x: node.x(),
        y: node.y(),
        width: Math.max(5, (data as BoxData).width * scaleX),
        height: Math.max(5, (data as BoxData).height * scaleY),
      });
    } else if (annotation.type === 'ellipse' && 'cx' in data) {
      onUpdate({
        cx: node.x(),
        cy: node.y(),
        rx: Math.max(5, (data as EllipseData).rx * scaleX),
        ry: Math.max(5, (data as EllipseData).ry * scaleY),
      });
    }
  };

  if (annotation.type === 'box') {
    const data = annotation.data as BoxData;
    return (
      <>
        <Rect
          ref={shapeRef as React.RefObject<Konva.Rect>}
          x={data.x}
          y={data.y}
          width={data.width}
          height={data.height}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fill={fillColor}
          opacity={fillOpacity}
          draggable={isSelected && !annotation.isLocked}
          onClick={onSelect}
          onTap={onSelect}
          onMouseEnter={() => onHover(true)}
          onMouseLeave={() => onHover(false)}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
        {showLabel && (
          <Text
            x={data.x}
            y={data.y - 18}
            text={annotation.classId}
            fontSize={12}
            fill={classColor}
            fontStyle="bold"
          />
        )}
        {isSelected && !annotation.isLocked && (
          <Transformer
            ref={trRef}
            boundBoxFunc={(oldBox, newBox) => {
              if (newBox.width < 5 || newBox.height < 5) {
                return oldBox;
              }
              return newBox;
            }}
          />
        )}
      </>
    );
  }

  if (annotation.type === 'ellipse') {
    const data = annotation.data as EllipseData;
    return (
      <>
        <Ellipse
          ref={shapeRef as React.RefObject<Konva.Ellipse>}
          x={data.cx}
          y={data.cy}
          radiusX={data.rx}
          radiusY={data.ry}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fill={fillColor}
          opacity={fillOpacity}
          draggable={isSelected && !annotation.isLocked}
          onClick={onSelect}
          onTap={onSelect}
          onMouseEnter={() => onHover(true)}
          onMouseLeave={() => onHover(false)}
          onDragEnd={handleDragEnd}
          onTransformEnd={handleTransformEnd}
        />
        {showLabel && (
          <Text
            x={data.cx - data.rx}
            y={data.cy - data.ry - 18}
            text={annotation.classId}
            fontSize={12}
            fill={classColor}
            fontStyle="bold"
          />
        )}
        {isSelected && !annotation.isLocked && (
          <Transformer ref={trRef} />
        )}
      </>
    );
  }

  if (annotation.type === 'polygon' || annotation.type === 'polyline') {
    const data = annotation.data as PolygonData | PolylineData;
    const points = data.points.flatMap(p => [p.x, p.y]);
    const isClosed = annotation.type === 'polygon' || ('isClosed' in data && data.isClosed);

    return (
      <Group>
        <Line
          points={points}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          fill={isClosed ? fillColor : undefined}
          opacity={isClosed ? fillOpacity : 1}
          closed={isClosed}
          onClick={onSelect}
          onTap={onSelect}
          onMouseEnter={() => onHover(true)}
          onMouseLeave={() => onHover(false)}
        />
        {/* Vertex handles for selected polygons */}
        {isSelected && data.points.map((p, i) => (
          <Circle
            key={i}
            x={p.x}
            y={p.y}
            radius={5}
            fill="#fff"
            stroke={classColor}
            strokeWidth={2}
            draggable={!annotation.isLocked}
            onDragEnd={(e) => {
              const newPoints = [...data.points];
              newPoints[i] = { x: e.target.x(), y: e.target.y() };
              onUpdate({ ...data, points: newPoints });
            }}
          />
        ))}
        {showLabel && data.points.length > 0 && (
          <Text
            x={data.points[0].x}
            y={data.points[0].y - 18}
            text={annotation.classId}
            fontSize={12}
            fill={classColor}
            fontStyle="bold"
          />
        )}
      </Group>
    );
  }

  if (annotation.type === 'points') {
    const data = annotation.data as PointsData;

    return (
      <Group>
        {data.points.map((p, i) => (
          <React.Fragment key={i}>
            <Circle
              x={p.x}
              y={p.y}
              radius={isSelected ? 8 : 6}
              fill={classColor}
              stroke={isSelected ? '#fff' : classColor}
              strokeWidth={isSelected ? 2 : 1}
              draggable={isSelected && !annotation.isLocked}
              onClick={onSelect}
              onTap={onSelect}
              onMouseEnter={() => onHover(true)}
              onMouseLeave={() => onHover(false)}
              onDragEnd={(e) => {
                const newPoints = [...data.points];
                newPoints[i] = { ...newPoints[i], x: e.target.x(), y: e.target.y() };
                onUpdate({ ...data, points: newPoints });
              }}
            />
            {showLabel && (
              <Text
                x={p.x + 8}
                y={p.y - 6}
                text={p.label || `P${i + 1}`}
                fontSize={10}
                fill={classColor}
              />
            )}
          </React.Fragment>
        ))}
      </Group>
    );
  }

  return null;
};

// =============================================================================
// DRAWING PREVIEW
// =============================================================================

interface DrawingPreviewProps {
  tool: Tool2D;
  points: Array<{ x: number; y: number }>;
  classColor: string;
}

const DrawingPreview: React.FC<DrawingPreviewProps> = ({ tool, points, classColor }) => {
  if (points.length === 0) return null;

  if ((tool === 'box' || tool === 'ellipse') && points.length === 2) {
    const [p1, p2] = points;
    const x = Math.min(p1.x, p2.x);
    const y = Math.min(p1.y, p2.y);
    const width = Math.abs(p2.x - p1.x);
    const height = Math.abs(p2.y - p1.y);

    if (tool === 'box') {
      return (
        <Rect
          x={x}
          y={y}
          width={width}
          height={height}
          stroke={classColor}
          strokeWidth={2}
          dash={[5, 5]}
          fill={classColor}
          opacity={0.2}
        />
      );
    } else {
      return (
        <Ellipse
          x={(p1.x + p2.x) / 2}
          y={(p1.y + p2.y) / 2}
          radiusX={width / 2}
          radiusY={height / 2}
          stroke={classColor}
          strokeWidth={2}
          dash={[5, 5]}
          fill={classColor}
          opacity={0.2}
        />
      );
    }
  }

  if ((tool === 'polygon' || tool === 'polyline') && points.length > 0) {
    const flatPoints = points.flatMap(p => [p.x, p.y]);

    return (
      <>
        <Line
          points={flatPoints}
          stroke={classColor}
          strokeWidth={2}
          dash={[5, 5]}
          closed={false}
        />
        {points.map((p, i) => (
          <Circle
            key={i}
            x={p.x}
            y={p.y}
            radius={4}
            fill={classColor}
          />
        ))}
      </>
    );
  }

  if (tool === 'points' && points.length > 0) {
    return (
      <>
        {points.map((p, i) => (
          <Circle
            key={i}
            x={p.x}
            y={p.y}
            radius={6}
            fill={classColor}
            stroke="#fff"
            strokeWidth={2}
          />
        ))}
      </>
    );
  }

  return null;
};

// =============================================================================
// MAIN IMAGE EDITOR PAGE
// =============================================================================

const ImageEditor: React.FC = () => {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  const classSelectableTools: Tool2D[] = ['box', 'ellipse', 'polygon', 'polyline', 'points', 'brush'];

  // Refs
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);

  // Local state
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [imageSize, setImageSize] = useState({ width: 1920, height: 1080 });
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [frames, setFrames] = useState<any[]>([]);
  const [cameras] = useState<string[]>(['front_camera']);
  const [isClassPickerOpen, setIsClassPickerOpen] = useState(false);
  const [hasSelectedClassForCurrentTool, setHasSelectedClassForCurrentTool] = useState(false);

  // Fetch task
  const { data: task } = useQuery({
    queryKey: ['task', taskId],
    queryFn: () => taskApi.get(taskId!),
    enabled: !!taskId,
  });

  // Fetch scene
  const { data: scene } = useQuery({
    queryKey: ['scene', task?.scene_id],
    queryFn: () => sceneApi.get(task!.scene_id),
    enabled: !!task?.scene_id,
  });

  // Fetch dataset
  const { data: dataset } = useQuery({
    queryKey: ['dataset', scene?.dataset_id],
    queryFn: () => datasetApi.get(scene!.dataset_id),
    enabled: !!scene?.dataset_id,
  });

  console.log('[ImageEditor] Dataset loaded:', dataset?.name); // Debug

  // Fetch taxonomy for 2D annotation mode
  const { data: taxonomy } = useQuery({
    queryKey: ['dataset-primary-taxonomy', scene?.dataset_id, '2d_only'],
    queryFn: () => taxonomyApi.getForDataset(scene!.dataset_id, '2d_only', true).then(arr => arr[0] || null),
    enabled: !!scene?.dataset_id,
  });

  // Use taxonomy classes or fallback to defaultClasses
  const classes = useMemo(() => {
    if (taxonomy?.classes && taxonomy.classes.length > 0) {
      return taxonomy.classes;
    }
    return defaultClasses;
  }, [taxonomy]);

  // Store taxonomy in editorStore for ObjectsAndTracksPanel
  const { setTaxonomy } = useEditorStore();
  useEffect(() => {
    if (taxonomy) {
      setTaxonomy(taxonomy);
    }
  }, [taxonomy, setTaxonomy]);

  // Store
  const {
    annotations,
    selectedIds,
    hoveredId,
    activeTool,
    drawingMode,
    activeClassId,
    drawingPoints,
    zoom,
    panOffset,
    gridEnabled,
    showLabels,
    fillOpacity,
    currentCameraId,
    setActiveTool,
    setActiveClass,
    select,
    deselectAll,
    setHovered,
    updateAnnotation,
    startDrawing,
    continueDrawing,
    finishDrawing,
    cancelDrawing,
    copy,
    paste,
    cut,
    duplicate,
    undo,
    redo,
    canUndo,
    canRedo,
    setZoom,
    setPanOffset,
    fitToView,
    toggleGrid,
    setCurrentFrame,
    setCurrentCamera,
    getAnnotationsForFrame,
    deleteSelected,
  } = useAnnotation2DStore();

  // Get current frame annotations
  const frameAnnotations = useMemo(() => {
    if (!frames[currentFrameIndex]) return [];
    return getAnnotationsForFrame(frames[currentFrameIndex]?.id || '', currentCameraId);
  }, [frames, currentFrameIndex, currentCameraId, getAnnotationsForFrame, annotations]);

  const getClassColor = useCallback((classId: string) => {
    return classes.find(c => c.id === classId)?.color || '#888888';
  }, [classes]);

  const handleToolSelection = useCallback((tool: Tool2D) => {
    setActiveTool(tool);

    if (classSelectableTools.includes(tool)) {
      setIsClassPickerOpen(true);
      setHasSelectedClassForCurrentTool(false);
    } else {
      setIsClassPickerOpen(false);
    }
  }, [classSelectableTools, setActiveTool]);

  const handleClassSelection = useCallback((classId: string) => {
    setActiveClass(classId);
    setHasSelectedClassForCurrentTool(true);
  }, [setActiveClass]);

  // Load task and frames (demo data)
  useEffect(() => {
    // Demo: create fake frames
    const demoFrames = Array.from({ length: 10 }, (_, i) => ({
      id: `frame-${i}`,
      index: i,
      timestamp: i * 0.1,
    }));
    setFrames(demoFrames);
    setCurrentFrame(demoFrames[0]?.id || '');
  }, [taskId, setCurrentFrame]);

  // Load image (demo)
  useEffect(() => {
    // In real app, load from API based on frame and camera
    const demoImageUrl = '/placeholder-image.jpg'; // Replace with actual image
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = demoImageUrl;
    img.onload = () => {
      setImage(img);
      setImageSize({ width: img.width, height: img.height });
    };
    img.onerror = () => {
      // Create a gray placeholder
      const canvas = document.createElement('canvas');
      canvas.width = 1920;
      canvas.height = 1080;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(0, 0, 1920, 1080);
        ctx.fillStyle = '#475569';
        ctx.font = '48px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('Demo Image - Frame ' + currentFrameIndex, 960, 540);
      }
      const placeholderImg = new window.Image();
      placeholderImg.src = canvas.toDataURL();
      placeholderImg.onload = () => {
        setImage(placeholderImg);
        setImageSize({ width: 1920, height: 1080 });
      };
    };
  }, [currentFrameIndex, currentCameraId]);

  // Handle container resize
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        const newSize = {
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        };
        setContainerSize(newSize);
        fitToView(imageSize, newSize);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [imageSize, fitToView]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if typing in input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      const key = e.key.toLowerCase();

      // Tool shortcuts
      if (key === 'v') handleToolSelection('select');
      if (key === 'h') handleToolSelection('pan');
      if (key === 'r') handleToolSelection('box');
      if (key === 'e') handleToolSelection('ellipse');
      if (key === 'p') handleToolSelection('polygon');
      if (key === 'l') handleToolSelection('polyline');
      if (key === 'k') handleToolSelection('points');
      if (key === 'b') handleToolSelection('brush');

      // Actions
      if (key === 'escape') {
        if (drawingMode === 'drawing') {
          cancelDrawing();
        } else {
          deselectAll();
        }

        if (classSelectableTools.includes(activeTool)) {
          setIsClassPickerOpen(true);
        }
      }

      if (key === 'delete' || key === 'backspace') {
        e.preventDefault();
        deleteSelected();
      }

      // Ctrl/Cmd shortcuts
      if (e.metaKey || e.ctrlKey) {
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) {
            redo();
          } else {
            undo();
          }
        }
        if (key === 'y') {
          e.preventDefault();
          redo();
        }
        if (key === 'c') {
          e.preventDefault();
          copy();
        }
        if (key === 'v') {
          e.preventDefault();
          paste();
        }
        if (key === 'x') {
          e.preventDefault();
          cut();
        }
        if (key === 'd') {
          e.preventDefault();
          duplicate();
        }
        if (key === 'a') {
          e.preventDefault();
          useAnnotation2DStore.getState().selectAll();
        }
      }

      // Frame navigation
      if (key === 'arrowleft' || key === 'arrowdown') {
        e.preventDefault();
        setCurrentFrameIndex(Math.max(0, currentFrameIndex - 1));
      }
      if (key === 'arrowright' || key === 'arrowup') {
        e.preventDefault();
        setCurrentFrameIndex(Math.min(frames.length - 1, currentFrameIndex + 1));
      }
      // First/Last frame navigation
      if (key === 'home') {
        e.preventDefault();
        setCurrentFrameIndex(0);
      }
      if (key === 'end') {
        e.preventDefault();
        setCurrentFrameIndex(frames.length - 1);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    activeTool, classSelectableTools, handleToolSelection,
    deselectAll, deleteSelected, undo, redo, copy, paste, cut, duplicate,
    drawingMode, cancelDrawing, currentFrameIndex, frames.length,
  ]);

  // Mouse handlers
  const getPointerPosition = useCallback(() => {
    const stage = stageRef.current;
    if (!stage) return null;
    const pos = stage.getPointerPosition();
    if (!pos) return null;

    // Convert to image coordinates
    return {
      x: (pos.x - panOffset.x) / zoom,
      y: (pos.y - panOffset.y) / zoom,
    };
  }, [panOffset, zoom]);

  const handleMouseDown = useCallback((e: Konva.KonvaEventObject<MouseEvent>) => {
    const pos = getPointerPosition();
    if (!pos) return;

    // Check if clicked on stage background
    if (e.target === e.target.getStage()) {
      if (['box', 'ellipse', 'polygon', 'polyline', 'points'].includes(activeTool)) {
        startDrawing(pos);
      } else if (activeTool === 'select') {
        deselectAll();
      }
    }
  }, [activeTool, startDrawing, deselectAll, getPointerPosition]);

  const handleMouseMove = useCallback(() => {
    const pos = getPointerPosition();
    if (!pos) return;

    if (drawingMode === 'drawing') {
      if (activeTool === 'box' || activeTool === 'ellipse') {
        continueDrawing(pos);
      }
    }
  }, [drawingMode, activeTool, continueDrawing, getPointerPosition]);

  const handleMouseUp = useCallback(() => {
    if (drawingMode === 'drawing' && (activeTool === 'box' || activeTool === 'ellipse')) {
      finishDrawing();
    }
  }, [drawingMode, activeTool, finishDrawing]);

  const handleClick = useCallback(() => {
    const pos = getPointerPosition();
    if (!pos) return;

    // For polygon/polyline/points, add point on click
    if (drawingMode === 'drawing' && ['polygon', 'polyline', 'points'].includes(activeTool)) {
      continueDrawing(pos);
    }
  }, [drawingMode, activeTool, continueDrawing, getPointerPosition]);

  const handleDoubleClick = useCallback(() => {
    // Finish polygon/polyline on double-click
    if (drawingMode === 'drawing' && ['polygon', 'polyline', 'points'].includes(activeTool)) {
      finishDrawing();
    }
  }, [drawingMode, activeTool, finishDrawing]);

  const handleWheel = useCallback((e: Konva.KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();

    const scaleBy = 1.1;
    const stage = stageRef.current;
    if (!stage) return;

    const pointer = stage.getPointerPosition();
    if (!pointer) return;

    const mousePointTo = {
      x: (pointer.x - panOffset.x) / zoom,
      y: (pointer.y - panOffset.y) / zoom,
    };

    const direction = e.evt.deltaY > 0 ? -1 : 1;
    const newZoom = direction > 0 ? zoom * scaleBy : zoom / scaleBy;
    const clampedZoom = Math.min(Math.max(newZoom, 0.1), 10);

    setZoom(clampedZoom);
    setPanOffset({
      x: pointer.x - mousePointTo.x * clampedZoom,
      y: pointer.y - mousePointTo.y * clampedZoom,
    });
  }, [zoom, panOffset, setZoom, setPanOffset]);

  const isDrawingTool = ['box', 'ellipse', 'polygon', 'polyline', 'points', 'brush'].includes(activeTool);
  const isPanTool = activeTool === 'pan';
  const hidePickerForBoxPlacement = hasSelectedClassForCurrentTool
    && drawingMode === 'drawing'
    && (activeTool === 'box' || activeTool === 'ellipse');
  const showClassPicker = isClassPickerOpen && !hidePickerForBoxPlacement;

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-white">
      {/* Top Toolbar */}
      <div className="h-12 bg-gray-900 border-b border-gray-700 flex items-center px-4 gap-4">
        {/* Back button */}
        <button
          className="p-2 hover:bg-gray-800 rounded"
          onClick={() => navigate(-1)}
          title="Back"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>

        <div className="h-6 w-px bg-gray-700" />

        {/* Undo/Redo */}
        <button
          className={`p-2 rounded ${canUndo() ? 'hover:bg-gray-800' : 'opacity-50 cursor-not-allowed'}`}
          onClick={undo}
          disabled={!canUndo()}
          title="Undo (Ctrl+Z)"
        >
          {icons.undo}
        </button>
        <button
          className={`p-2 rounded ${canRedo() ? 'hover:bg-gray-800' : 'opacity-50 cursor-not-allowed'}`}
          onClick={redo}
          disabled={!canRedo()}
          title="Redo (Ctrl+Y)"
        >
          {icons.redo}
        </button>

        <div className="h-6 w-px bg-gray-700" />

        {/* Tools */}
        <div className="flex items-center gap-1">
          {tools.map((tool) => (
            <button
              key={tool.id}
              className={`p-2 rounded transition-colors ${
                activeTool === tool.id
                  ? 'bg-blue-600 text-white'
                  : 'hover:bg-gray-800 text-gray-400'
              }`}
              onClick={() => handleToolSelection(tool.id)}
              title={tool.name}
            >
              {tool.icon}
            </button>
          ))}
        </div>

        <div className="h-6 w-px bg-gray-700" />

        {/* Zoom controls */}
        <div className="flex items-center gap-2">
          <button
            className="p-2 hover:bg-gray-800 rounded"
            onClick={() => setZoom(zoom / 1.2)}
            title="Zoom Out"
          >
            {icons.zoomOut}
          </button>
          <span className="text-sm text-gray-400 w-16 text-center">
            {Math.round(zoom * 100)}%
          </span>
          <button
            className="p-2 hover:bg-gray-800 rounded"
            onClick={() => setZoom(zoom * 1.2)}
            title="Zoom In"
          >
            {icons.zoomIn}
          </button>
          <button
            className="p-2 hover:bg-gray-800 rounded"
            onClick={() => fitToView(imageSize, containerSize)}
            title="Fit to View"
          >
            {icons.fitView}
          </button>
        </div>

        <div className="h-6 w-px bg-gray-700" />

        {/* Grid toggle */}
        <button
          className={`p-2 rounded ${gridEnabled ? 'bg-blue-600' : 'hover:bg-gray-800'}`}
          onClick={toggleGrid}
          title="Toggle Grid"
        >
          {icons.grid}
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Save button */}
        <button
          className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 rounded flex items-center gap-2"
          title="Save (Ctrl+S)"
        >
          {icons.save}
          <span>Save</span>
        </button>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Canvas */}
        <div ref={containerRef} className="flex-1 relative bg-gray-950 overflow-hidden">
          <Stage
            ref={stageRef}
            width={containerSize.width}
            height={containerSize.height}
            scaleX={zoom}
            scaleY={zoom}
            x={panOffset.x}
            y={panOffset.y}
            draggable={isPanTool}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onClick={handleClick}
            onDblClick={handleDoubleClick}
            style={{ cursor: isDrawingTool ? 'crosshair' : isPanTool ? 'grab' : 'default' }}
          >
            {/* Image layer */}
            <Layer>
              {image ? (
                <Image
                  image={image}
                  width={imageSize.width}
                  height={imageSize.height}
                />
              ) : (
                <Rect
                  width={imageSize.width}
                  height={imageSize.height}
                  fill="#1e293b"
                />
              )}
            </Layer>

            {/* Grid layer */}
            {gridEnabled && (
              <Layer>
                {Array.from({ length: Math.ceil(imageSize.width / 100) }).map((_, i) => (
                  <Line
                    key={`v-${i}`}
                    points={[i * 100, 0, i * 100, imageSize.height]}
                    stroke="#374151"
                    strokeWidth={0.5}
                  />
                ))}
                {Array.from({ length: Math.ceil(imageSize.height / 100) }).map((_, i) => (
                  <Line
                    key={`h-${i}`}
                    points={[0, i * 100, imageSize.width, i * 100]}
                    stroke="#374151"
                    strokeWidth={0.5}
                  />
                ))}
              </Layer>
            )}

            {/* Annotations layer */}
            <Layer>
              {frameAnnotations.map((ann) => (
                <AnnotationShape
                  key={ann.id}
                  annotation={ann}
                  isSelected={selectedIds.includes(ann.id)}
                  isHovered={hoveredId === ann.id}
                  classColor={getClassColor(ann.classId)}
                  showLabel={showLabels}
                  fillOpacity={fillOpacity}
                  onSelect={() => select(ann.id)}
                  onHover={(hover) => setHovered(hover ? ann.id : null)}
                  onUpdate={(data) => updateAnnotation(ann.id, { data })}
                />
              ))}
            </Layer>

            {/* Drawing preview layer */}
            <Layer>
              <DrawingPreview
                tool={activeTool}
                points={drawingPoints}
                classColor={getClassColor(activeClassId)}
              />
            </Layer>
          </Stage>

          {/* Frame indicator */}
          <div className="absolute bottom-4 left-4 px-3 py-1.5 bg-gray-900/90 rounded text-sm">
            Frame {currentFrameIndex + 1} / {frames.length}
          </div>

          {/* Camera selector */}
          <div className="absolute top-4 left-4">
            <select
              className="px-3 py-1.5 bg-gray-900/90 rounded text-sm border border-gray-700"
              value={currentCameraId}
              onChange={(e) => setCurrentCamera(e.target.value)}
            >
              {cameras.map((cam) => (
                <option key={cam} value={cam}>{cam}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Right Panel - Objects and Tracks */}
        <div className="w-80 border-l border-gray-700 flex-shrink-0 flex flex-col bg-gray-900">
          {showClassPicker && (
            <div className="border-b border-gray-700">
              <div className="px-3 py-2 border-b border-gray-700">
                <h3 className="text-sm font-medium">Class Picker</h3>
              </div>
              <div className="max-h-64 overflow-y-auto p-2">
                {classes.map((cls) => (
                  <button
                    key={cls.id}
                    className={`w-full px-3 py-2 rounded flex items-center gap-2 mb-1 ${
                      activeClassId === cls.id
                        ? 'bg-blue-600'
                        : 'hover:bg-gray-800'
                    }`}
                    onClick={() => handleClassSelection(cls.id)}
                  >
                    <div
                      className="w-4 h-4 rounded"
                      style={{ backgroundColor: cls.color }}
                    />
                    <span className="text-sm truncate">{cls.name}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <ObjectsAndTracksPanel
            classes={classes}
            frames={frames.map((f, i) => ({ id: f.id, index: i }))}
            currentFrameIndex={currentFrameIndex}
            onFrameChange={setCurrentFrameIndex}
          />
        </div>
      </div>

      {/* Bottom Timeline */}
      <div className="h-16 bg-gray-900 border-t border-gray-700 flex items-center px-4 gap-4">
        {/* Play controls */}
        <div className="flex items-center gap-2">
          <button
            className="p-2 hover:bg-gray-800 rounded"
            onClick={() => setCurrentFrameIndex(Math.max(0, currentFrameIndex - 1))}
            disabled={currentFrameIndex === 0}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            className="p-2 hover:bg-gray-800 rounded"
            onClick={() => setCurrentFrameIndex(Math.min(frames.length - 1, currentFrameIndex + 1))}
            disabled={currentFrameIndex >= frames.length - 1}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>

        {/* Timeline scrubber */}
        <div className="flex-1 h-8 bg-gray-800 rounded relative cursor-pointer"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            setCurrentFrameIndex(Math.floor(percent * frames.length));
          }}
        >
          {/* Frame markers */}
          {frames.map((_, i) => (
            <div
              key={i}
              className={`absolute top-0 bottom-0 w-px ${
                i === currentFrameIndex ? 'bg-blue-500' : 'bg-gray-700'
              }`}
              style={{ left: `${(i / frames.length) * 100}%` }}
            />
          ))}

          {/* Current position indicator */}
          <div
            className="absolute top-0 bottom-0 w-1 bg-blue-500 rounded"
            style={{ left: `${(currentFrameIndex / Math.max(1, frames.length - 1)) * 100}%` }}
          />
        </div>

        {/* Frame input */}
        <div className="flex items-center gap-2">
          <input
            type="number"
            className="w-16 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-sm text-center"
            value={currentFrameIndex + 1}
            min={1}
            max={frames.length}
            onChange={(e) => {
              const val = parseInt(e.target.value);
              if (!isNaN(val) && val >= 1 && val <= frames.length) {
                setCurrentFrameIndex(val - 1);
              }
            }}
          />
          <span className="text-sm text-gray-500">/ {frames.length}</span>
        </div>
      </div>

      {/* Help tooltip */}
      <div className="absolute bottom-20 right-4 text-xs text-gray-500 bg-gray-900/90 p-2 rounded">
        <div><kbd className="px-1 bg-gray-800 rounded">V</kbd> Select</div>
        <div><kbd className="px-1 bg-gray-800 rounded">R</kbd> Rectangle</div>
        <div><kbd className="px-1 bg-gray-800 rounded">E</kbd> Ellipse</div>
        <div><kbd className="px-1 bg-gray-800 rounded">P</kbd> Polygon</div>
        <div><kbd className="px-1 bg-gray-800 rounded">Del</kbd> Delete</div>
        <div><kbd className="px-1 bg-gray-800 rounded">Ctrl+Z</kbd> Undo</div>
      </div>
    </div>
  );
};

export default ImageEditor;

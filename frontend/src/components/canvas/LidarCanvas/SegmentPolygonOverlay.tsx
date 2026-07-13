import React, { useRef, useEffect, useCallback } from 'react';
import { useSegmentTo3DStore, ProjectedLidarPoint } from '@/store/segmentTo3DStore';
import { useEditorStore } from '@/store/editorStore';
import { pointInPolygon, Point2D } from '@/utils/pointInPolygon';
import type { PointCloudData, CameraCalibration } from '@/types';

function shrinkPolygon(polygon: Point2D[], shrinkFactor: number = 0.1): Point2D[] {
  if (polygon.length < 3) return polygon;

  let cx = 0, cy = 0;
  for (const p of polygon) {
    cx += p.x;
    cy += p.y;
  }
  cx /= polygon.length;
  cy /= polygon.length;

  const scale = 1 - shrinkFactor;
  return polygon.map(p => ({
    x: cx + (p.x - cx) * scale,
    y: cy + (p.y - cy) * scale,
  }));
}

function getDepthFilterParams(classId?: string | null, taxonomy?: { classes: Array<{ id: string; name: string }> } | null): {
  percentile: number;
  expectedDepthSpan: number;
  minPointsRequired: number;
} {
  if (!classId) {
    return { percentile: 85, expectedDepthSpan: 5.0, minPointsRequired: 2 };
  }

  const classDef = taxonomy?.classes?.find(c => c.id === classId);
  const classKey = (classId + (classDef?.name || '')).toLowerCase();

  if (/pedestrian|person|human|adult|child/.test(classKey)) {
    return { percentile: 70, expectedDepthSpan: 0.8, minPointsRequired: 2 };
  }

  if (/bicycle|bike|cyclist|motorcycle|motorbike/.test(classKey)) {
    return { percentile: 75, expectedDepthSpan: 2.0, minPointsRequired: 2 };
  }

  if (/cone|barrier|animal/.test(classKey)) {
    return { percentile: 65, expectedDepthSpan: 1.0, minPointsRequired: 2 };
  }

  if (/truck|bus|trailer|construction/.test(classKey)) {
    return { percentile: 90, expectedDepthSpan: 12.0, minPointsRequired: 2 };
  }

  if (/car|vehicle/.test(classKey)) {
    return { percentile: 80, expectedDepthSpan: 5.0, minPointsRequired: 2 };
  }

  return { percentile: 85, expectedDepthSpan: 5.0, minPointsRequired: 2 };
}

function applyDepthFilter(
  points: ProjectedLidarPoint[],
  percentile: number,
  expectedDepthSpan: number,
  minPoints: number
): ProjectedLidarPoint[] {
  const insidePoints = points.filter(p => p.isInside);

  if (insidePoints.length < minPoints) {
    return points;
  }

  const depths = insidePoints.map(p => p.depth).sort((a, b) => a - b);
  const minDepth = depths[0];
  const maxDepth = depths[depths.length - 1];
  const depthRange = maxDepth - minDepth;

  if (depthRange <= expectedDepthSpan * 1.5) {
    console.log('[DepthFilter] Depth range within expected span, no filtering needed:', {
      depthRange: depthRange.toFixed(2),
      expectedSpan: expectedDepthSpan.toFixed(2),
    });
    return points;
  }

  const numBins = Math.min(20, Math.max(5, Math.floor(insidePoints.length / 3)));
  const binWidth = depthRange / numBins;
  const histogram = new Array(numBins).fill(0);

  for (const depth of depths) {
    const binIdx = Math.min(numBins - 1, Math.floor((depth - minDepth) / binWidth));
    histogram[binIdx]++;
  }

  let peakBin = 0;
  let peakCount = 0;
  for (let i = 0; i < numBins; i++) {
    if (histogram[i] > peakCount) {
      peakCount = histogram[i];
      peakBin = i;
    }
  }

  const peakDepthCenter = minDepth + (peakBin + 0.5) * binWidth;

  const percentileIdx = Math.floor(depths.length * percentile / 100);
  const depthThreshold = depths[Math.min(percentileIdx, depths.length - 1)];

  const adaptiveThreshold = Math.min(
    depthThreshold,
    peakDepthCenter + expectedDepthSpan
  );

  console.log('[DepthFilter] Applied filtering:', {
    totalInside: insidePoints.length,
    depthRange: depthRange.toFixed(2),
    percentile,
    peakDepthCenter: peakDepthCenter.toFixed(2),
    depthThreshold: depthThreshold.toFixed(2),
    adaptiveThreshold: adaptiveThreshold.toFixed(2),
  });

  return points.map(p => {
    if (p.isInside && p.depth > adaptiveThreshold) {
      return { ...p, isInside: false };
    }
    return p;
  });
}

interface SegmentPolygonOverlayProps {
  displayWidth: number;
  displayHeight: number;
  imageWidth: number;
  imageHeight: number;
  offsetX: number;
  offsetY: number;
  zoom?: number;
  pan?: { x: number; y: number };
  pointCloud?: PointCloudData | null;
  calibration?: CameraCalibration | null;
  onZoomChange?: (zoom: number) => void;
}

export const SegmentPolygonOverlay: React.FC<SegmentPolygonOverlayProps> = ({
  displayWidth,
  displayHeight,
  imageWidth,
  imageHeight,
  offsetX,
  offsetY,
  zoom = 1,
  pan = { x: 0, y: 0 },
  pointCloud,
  calibration,
  onZoomChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const {
    isActive,
    polygons,
    activePolygonId,
    promptPoints,
    hoveredVertexId,
    editingVertexId,
    currentStep,
    projectedPoints,
    excludedPointIndices,
    setHoveredVertex,
    setEditingVertex,
    updateVertex,
    addVertex,
    removeVertex,
    startEditing,
    setProjectedPoints,
    togglePointExclusion,
  } = useSegmentTo3DStore();

  const { activeClassId, taxonomy, focusOnPosition } = useEditorStore();

  const imageToCanvas = useCallback((x: number, y: number, debug?: boolean): { x: number; y: number } => {
    const scaleX = displayWidth / imageWidth;
    const scaleY = displayHeight / imageHeight;

    const canvasX = x * scaleX + offsetX;
    const canvasY = y * scaleY + offsetY;

    const parent = canvasRef.current?.parentElement;
    if (!parent) return { x: canvasX, y: canvasY };

    const centerX = parent.clientWidth / 2;
    const centerY = parent.clientHeight / 2;

    const result = {
      x: (canvasX - centerX) * zoom + centerX + pan.x,
      y: (canvasY - centerY) * zoom + centerY + pan.y,
    };

    if (debug) {
      console.log('[SegmentPolygonOverlay] imageToCanvas debug:', {
        input: { x, y },
        scale: { x: scaleX, y: scaleY },
        prePan: { x: canvasX, y: canvasY },
        center: { x: centerX, y: centerY },
        zoom,
        pan,
        output: result,
        parent: { width: parent.clientWidth, height: parent.clientHeight },
      });
    }

    return result;
  }, [displayWidth, displayHeight, imageWidth, imageHeight, offsetX, offsetY, zoom, pan]);

  const canvasToImage = useCallback((canvasX: number, canvasY: number): { x: number; y: number } => {
    const parent = canvasRef.current?.parentElement;
    if (!parent) return { x: 0, y: 0 };

    const centerX = parent.clientWidth / 2;
    const centerY = parent.clientHeight / 2;

    const x = (canvasX - pan.x - centerX) / zoom + centerX;
    const y = (canvasY - pan.y - centerY) / zoom + centerY;

    const scaleX = displayWidth / imageWidth;
    const scaleY = displayHeight / imageHeight;

    return {
      x: (x - offsetX) / scaleX,
      y: (y - offsetY) / scaleY,
    };
  }, [displayWidth, displayHeight, imageWidth, imageHeight, offsetX, offsetY, zoom, pan]);

  useEffect(() => {
    const activePolygon = polygons.find(p => p.id === activePolygonId);

    if (!activePolygon || !pointCloud || !calibration || !imageWidth || !imageHeight) {
      setProjectedPoints([]);
      return;
    }

    const { extrinsic, intrinsic } = calibration;
    const R = extrinsic.rotation;
    const t = extrinsic.translation;
    const { fx, fy, cx, cy } = intrinsic;

    const positions = pointCloud.positions;
    const polygon: Point2D[] = activePolygon.vertices.map(v => ({ x: v.x, y: v.y }));

    const shrunkPolygon = shrinkPolygon(polygon, 0.10);

    const projected: ProjectedLidarPoint[] = [];

    for (let i = 0; i < pointCloud.pointCount; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];

      const camX = R[0][0] * px + R[0][1] * py + R[0][2] * pz + t[0];
      const camY = R[1][0] * px + R[1][1] * py + R[1][2] * pz + t[1];
      const camZ = R[2][0] * px + R[2][1] * py + R[2][2] * pz + t[2];

      if (camZ <= 0.1) continue;

      const u = (fx * camX / camZ) + cx;
      const v = (fy * camY / camZ) + cy;

      if (u >= 0 && u < imageWidth && v >= 0 && v < imageHeight) {
        const isInside = pointInPolygon({ x: u, y: v }, shrunkPolygon);
        const isExcluded = excludedPointIndices.has(i);

        projected.push({
          index: i,
          x: u,
          y: v,
          x3d: px,
          y3d: py,
          z3d: pz,
          depth: camZ,
          isInside,
          isExcluded,
        });
      }
    }

    const depthParams = getDepthFilterParams(activeClassId, taxonomy);
    const filteredProjected = applyDepthFilter(
      projected,
      depthParams.percentile,
      depthParams.expectedDepthSpan,
      depthParams.minPointsRequired
    );

    setProjectedPoints(filteredProjected);

    const insidePoints = filteredProjected.filter(p => p.isInside && !p.isExcluded);
    if (insidePoints.length >= 2) {
      let sumX = 0, sumY = 0, sumZ = 0;
      for (const p of insidePoints) {
        sumX += p.x3d;
        sumY += p.y3d;
        sumZ += p.z3d;
      }
      const centroid = {
        x: sumX / insidePoints.length,
        y: sumY / insidePoints.length,
        z: sumZ / insidePoints.length,
      };

      focusOnPosition(centroid);
      console.log('[SegmentPolygonOverlay] Focusing camera on cluster centroid:', centroid);
    }

    console.log('[SegmentPolygonOverlay] Projected points (shrunk polygon + depth filter):', {
      total: filteredProjected.length,
      inside: filteredProjected.filter(p => p.isInside && !p.isExcluded).length,
      excluded: filteredProjected.filter(p => p.isExcluded).length,
      classId: activeClassId,
      depthParams,
    });
  }, [polygons, activePolygonId, pointCloud, calibration, imageWidth, imageHeight, excludedPointIndices, setProjectedPoints, activeClassId, taxonomy, focusOnPosition]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    canvas.width = parent.clientWidth;
    canvas.height = parent.clientHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (!isActive) return;

    for (const point of promptPoints) {
      const pos = imageToCanvas(point.x, point.y);

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
      ctx.fillStyle = point.label === 1 ? 'rgba(34, 197, 94, 0.8)' : 'rgba(239, 68, 68, 0.8)';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = 'white';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = 'white';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(point.label === 1 ? '+' : '−', pos.x, pos.y);
    }

    if (projectedPoints.length > 0) {
      for (const point of projectedPoints) {
        const pos = imageToCanvas(point.x, point.y);

        let color: string;
        let radius: number;

        if (point.isExcluded) {
          color = 'rgba(239, 68, 68, 0.7)';
          radius = 3;
        } else if (point.isInside) {
          color = 'rgba(34, 197, 94, 0.9)';
          radius = 5;
        } else {
          color = 'rgba(156, 163, 175, 0.15)';
          radius = 2;
        }

        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();

        if (point.isInside && !point.isExcluded) {
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      const insideCount = projectedPoints.filter(p => p.isInside && !p.isExcluded).length;
      const excludedCount = projectedPoints.filter(p => p.isExcluded).length;

      ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
      ctx.fillRect(10, 10, 140, excludedCount > 0 ? 50 : 30);

      ctx.fillStyle = '#22c55e';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'left';
      ctx.fillText(`${insideCount} points selected`, 18, 28);

      if (excludedCount > 0) {
        ctx.fillStyle = '#ef4444';
        ctx.fillText(`${excludedCount} excluded`, 18, 46);
      }
    }

    // HIDDEN: Polygon outline - user requested only green points visible
    // Polygons are still tracked internally for point filtering but not drawn
    // Keep vertices visible only when editing (for point manipulation)
    for (let polyIdx = 0; polyIdx < polygons.length; polyIdx++) {
      const polygon = polygons[polyIdx];
      if (polygon.vertices.length < 3) continue;

      const isActivePolygon = polygon.id === activePolygonId;
      const isEditing = polygon.isEditing;

      // Skip polygon outline drawing - points are the only visual
      // Only draw vertices when editing for manipulation

      // Draw vertices if editing
      if (isEditing && isActivePolygon) {
        for (const vertex of polygon.vertices) {
          const pos = imageToCanvas(vertex.x, vertex.y);
          const isHovered = vertex.id === hoveredVertexId;
          const isEditingVertex = vertex.id === editingVertexId;

          // Vertex circle
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, isHovered || isEditingVertex ? 8 : 6, 0, Math.PI * 2);
          ctx.fillStyle = isEditingVertex ? '#f59e0b' : (isHovered ? '#3b82f6' : 'white');
          ctx.fill();
          ctx.strokeStyle = '#1e40af';
          ctx.lineWidth = 2;
          ctx.stroke();
        }

        // Draw midpoint handles (for adding vertices)
        for (let i = 0; i < polygon.vertices.length; i++) {
          const v1 = polygon.vertices[i];
          const v2 = polygon.vertices[(i + 1) % polygon.vertices.length];

          const p1 = imageToCanvas(v1.x, v1.y);
          const p2 = imageToCanvas(v2.x, v2.y);

          const midX = (p1.x + p2.x) / 2;
          const midY = (p1.y + p2.y) / 2;

          ctx.beginPath();
          ctx.arc(midX, midY, 4, 0, Math.PI * 2);
          ctx.fillStyle = 'rgba(59, 130, 246, 0.5)';
          ctx.fill();
          ctx.strokeStyle = 'white';
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }

      // Draw score badge (smaller, less prominent)
      if (polygon.score > 0 && isActivePolygon) {
        const bounds = polygon.vertices.reduce(
          (acc, v) => {
            const pos = imageToCanvas(v.x, v.y);
            return {
              minX: Math.min(acc.minX, pos.x),
              maxX: Math.max(acc.maxX, pos.x),
              minY: Math.min(acc.minY, pos.y),
            };
          },
          { minX: Infinity, maxX: -Infinity, minY: Infinity }
        );

        const badgeX = (bounds.minX + bounds.maxX) / 2;
        const badgeY = bounds.minY - 15;

        ctx.fillStyle = 'rgba(59, 130, 246, 0.8)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(polygon.score * 100)}%`, badgeX, badgeY);
      }
    }

  }, [
    isActive, polygons, activePolygonId, promptPoints, hoveredVertexId,
    editingVertexId, imageToCanvas, currentStep, projectedPoints
  ]);

  // Handle mouse events
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !isActive) return;

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Check if hovering over a vertex
    const activePolygon = polygons.find(p => p.id === activePolygonId);
    if (!activePolygon?.isEditing) return;

    let foundVertex: string | null = null;

    for (const vertex of activePolygon.vertices) {
      const pos = imageToCanvas(vertex.x, vertex.y);
      const dist = Math.sqrt(Math.pow(pos.x - canvasX, 2) + Math.pow(pos.y - canvasY, 2));

      if (dist < 10) {
        foundVertex = vertex.id;
        break;
      }
    }

    setHoveredVertex(foundVertex);

    // Handle dragging
    if (editingVertexId && activePolygonId) {
      const imagePos = canvasToImage(canvasX, canvasY);
      updateVertex(activePolygonId, editingVertexId, imagePos);
    }
  }, [isActive, polygons, activePolygonId, imageToCanvas, canvasToImage, editingVertexId, setHoveredVertex, updateVertex]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isActive) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    const activePolygon = polygons.find(p => p.id === activePolygonId);

    // Left click
    if (e.button === 0) {
      // Check if clicking on a LiDAR point (for exclusion toggle)
      // Only when we have projected points and are in editing mode
      if (projectedPoints.length > 0 && (currentStep === 'editing' || activePolygon)) {
        // Find nearest point within click radius
        let nearestPoint: typeof projectedPoints[0] | null = null;
        let nearestDist = Infinity;

        for (const point of projectedPoints) {
          // Only consider points inside the polygon (can be excluded/re-included)
          if (!point.isInside) continue;

          const pos = imageToCanvas(point.x, point.y);
          const dist = Math.sqrt(Math.pow(pos.x - canvasX, 2) + Math.pow(pos.y - canvasY, 2));

          if (dist < 12 && dist < nearestDist) {
            nearestPoint = point;
            nearestDist = dist;
          }
        }

        if (nearestPoint) {
          togglePointExclusion(nearestPoint.index);
          console.log('[SegmentPolygonOverlay] Toggled point exclusion:', nearestPoint.index);
          return; // Don't process other click actions
        }
      }

      // Handle vertex editing
      if (hoveredVertexId && activePolygon?.isEditing) {
        setEditingVertex(hoveredVertexId);
      } else if (!activePolygon?.isEditing && activePolygonId) {
        // Start editing on click
        startEditing(activePolygonId);
      }
    }
  }, [isActive, polygons, activePolygonId, hoveredVertexId, setEditingVertex, startEditing, projectedPoints, currentStep, imageToCanvas, togglePointExclusion]);

  const handleMouseUp = useCallback(() => {
    if (editingVertexId) {
      setEditingVertex(null);
    }
  }, [editingVertexId, setEditingVertex]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();

    const activePolygon = polygons.find(p => p.id === activePolygonId);
    if (!activePolygon?.isEditing || !hoveredVertexId) return;

    // Delete vertex on right-click
    removeVertex(activePolygonId!, hoveredVertexId);
  }, [polygons, activePolygonId, hoveredVertexId, removeVertex]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas || !isActive) return;

    const activePolygon = polygons.find(p => p.id === activePolygonId);
    if (!activePolygon?.isEditing) return;

    const rect = canvas.getBoundingClientRect();
    const canvasX = e.clientX - rect.left;
    const canvasY = e.clientY - rect.top;

    // Check if clicking on an edge midpoint
    for (let i = 0; i < activePolygon.vertices.length; i++) {
      const v1 = activePolygon.vertices[i];
      const v2 = activePolygon.vertices[(i + 1) % activePolygon.vertices.length];

      const p1 = imageToCanvas(v1.x, v1.y);
      const p2 = imageToCanvas(v2.x, v2.y);

      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2;

      const dist = Math.sqrt(Math.pow(midX - canvasX, 2) + Math.pow(midY - canvasY, 2));

      if (dist < 10) {
        const imagePos = canvasToImage(canvasX, canvasY);
        addVertex(activePolygonId!, v1.id, imagePos);
        return;
      }
    }
  }, [isActive, polygons, activePolygonId, imageToCanvas, canvasToImage, addVertex]);

  // Wheel handler - forward zoom events
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (!onZoomChange) return;
    e.preventDefault();

    const zoomFactor = 1.1;
    const delta = e.deltaY > 0 ? -1 : 1;
    const newZoom = delta > 0
      ? Math.min(zoom * zoomFactor, 10)
      : Math.max(zoom / zoomFactor, 0.5);

    onZoomChange(newZoom);
  }, [zoom, onZoomChange]);

  if (!isActive) return null;

  // During heading_arrow or editing step, this overlay should not block the
  // HeadingPickerOverlay buttons. We only need pointer events for:
  // - Clicking on LiDAR points to exclude them
  // - Dragging polygon vertices
  // The HeadingPickerOverlay has a higher zIndex (25) and its own pointer-events:auto
  const passThrough = currentStep === 'heading_arrow' || currentStep === 'editing';

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 ${passThrough ? '' : 'cursor-crosshair'}`}
      style={{ zIndex: 20, pointerEvents: passThrough ? 'none' : 'auto' }}
      onMouseMove={handleMouseMove}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
      onWheel={handleWheel}
    />
  );
};

export default SegmentPolygonOverlay;

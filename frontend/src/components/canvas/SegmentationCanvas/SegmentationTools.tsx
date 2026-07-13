import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { useThree } from '@react-three/fiber';
import { useSegmentationStore } from '@/store/segmentationStore';
import type { PointCloudData } from '@/types';


interface BrushToolProps {
  pointCloud: PointCloudData;
  onSelect: (indices: number[]) => void;
  enabled: boolean;
}

export const BrushTool: React.FC<BrushToolProps> = ({ pointCloud, onSelect, enabled }) => {
  const { raycaster, camera, gl } = useThree();
  const [brushPosition, setBrushPosition] = useState<THREE.Vector3 | null>(null);
  const [isPainting, setIsPainting] = useState(false);


  const brushSettings = useSegmentationStore((s) => s.brushSettings);
  void useSegmentationStore((s) => s.activeClassId);
  const setIsSelecting = useSegmentationStore((s) => s.setIsSelecting);
  const startBrushSession = useSegmentationStore((s) => s.startBrushSession);
  const endBrushSession = useSegmentationStore((s) => s.endBrushSession);
  const setBrushWorldPosition = useSegmentationStore((s) => s.setBrushWorldPosition);
  const setBrushIsPainting = useSegmentationStore((s) => s.setBrushIsPainting);

  const rafRef = useRef<number | null>(null);
  const pendingEventRef = useRef<PointerEvent | null>(null);
  const isPaintingRef = useRef(false);

  const spatialGrid = useMemo(() => {
    if (!pointCloud.positions || pointCloud.pointCount === 0) return null;

    const cellSize = 0.5;
    const grid = new Map<string, number[]>();

    for (let i = 0; i < pointCloud.pointCount; i++) {
      const px = pointCloud.positions[i * 3];
      const py = pointCloud.positions[i * 3 + 1];
      const pz = pointCloud.positions[i * 3 + 2];

      const cx = Math.floor(px / cellSize);
      const cy = Math.floor(py / cellSize);
      const cz = Math.floor(pz / cellSize);
      const key = `${cx},${cy},${cz}`;

      if (!grid.has(key)) grid.set(key, []);
      grid.get(key)!.push(i);
    }

    return { grid, cellSize };
  }, [pointCloud.positions, pointCloud.pointCount]);

  // Fast point lookup using spatial grid
  const getIntersectionPoint = useCallback((event: PointerEvent): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    if (!pointCloud.positions || pointCloud.pointCount === 0) {
      return raycaster.ray.at(20, new THREE.Vector3());
    }

    // Sample points along ray at regular intervals.
    // Threshold is capped so the perpendicular-distance test stays tight even
    // at large brush radii (avoids accepting distant points as "under cursor").
    const rayOrigin = raycaster.ray.origin;
    const rayDir = raycaster.ray.direction;
    const threshold = Math.min(brushSettings.radius, 1.0);
    const thresholdSq = threshold * threshold;

    let closestPoint: THREE.Vector3 | null = null;
    let closestDistSq = Infinity;

    // Check points at intervals along ray (faster than checking all points)
    for (let t = 1; t < 150; t += 2) { // Sample every 2m along ray up to 150m
      const sampleX = rayOrigin.x + rayDir.x * t;
      const sampleY = rayOrigin.y + rayDir.y * t;
      const sampleZ = rayOrigin.z + rayDir.z * t;

      // Check nearby points using spatial grid if available
      if (spatialGrid) {
        const { grid, cellSize } = spatialGrid;
        const cx = Math.floor(sampleX / cellSize);
        const cy = Math.floor(sampleY / cellSize);
        const cz = Math.floor(sampleZ / cellSize);

        // Check 3x3x3 neighborhood
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            for (let dz = -1; dz <= 1; dz++) {
              const key = `${cx + dx},${cy + dy},${cz + dz}`;
              const indices = grid.get(key);
              if (!indices) continue;

              for (const i of indices) {
                const px = pointCloud.positions[i * 3];
                const py = pointCloud.positions[i * 3 + 1];
                const pz = pointCloud.positions[i * 3 + 2];

                // Perpendicular distance to ray
                const vx = px - rayOrigin.x;
                const vy = py - rayOrigin.y;
                const vz = pz - rayOrigin.z;
                const proj = vx * rayDir.x + vy * rayDir.y + vz * rayDir.z;
                if (proj < 0) continue;

                const perpX = vx - proj * rayDir.x;
                const perpY = vy - proj * rayDir.y;
                const perpZ = vz - proj * rayDir.z;
                const perpDistSq = perpX * perpX + perpY * perpY + perpZ * perpZ;

                if (perpDistSq < thresholdSq && perpDistSq < closestDistSq) {
                  closestDistSq = perpDistSq;
                  closestPoint = new THREE.Vector3(px, py, pz);
                }
              }
            }
          }
        }

        if (closestPoint) return closestPoint;
      }
    }

    // Fallback: brute force but only check every 4th point for speed
    if (!closestPoint) {
      for (let i = 0; i < pointCloud.pointCount; i += 4) {
        const px = pointCloud.positions[i * 3];
        const py = pointCloud.positions[i * 3 + 1];
        const pz = pointCloud.positions[i * 3 + 2];

        const vx = px - rayOrigin.x;
        const vy = py - rayOrigin.y;
        const vz = pz - rayOrigin.z;
        const proj = vx * rayDir.x + vy * rayDir.y + vz * rayDir.z;
        if (proj < 0) continue;

        const perpX = vx - proj * rayDir.x;
        const perpY = vy - proj * rayDir.y;
        const perpZ = vz - proj * rayDir.z;
        const perpDistSq = perpX * perpX + perpY * perpY + perpZ * perpZ;

        if (perpDistSq < thresholdSq && perpDistSq < closestDistSq) {
          closestDistSq = perpDistSq;
          closestPoint = new THREE.Vector3(px, py, pz);
        }
      }
    }

    if (closestPoint) return closestPoint;

    // Fallback to plane intersection at z=0
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const intersection = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, intersection)) {
      return intersection;
    }

    return raycaster.ray.at(20, new THREE.Vector3());
  }, [raycaster, camera, gl, pointCloud, brushSettings.radius, spatialGrid]); // spatialGrid no longer depends on radius

  // Find points within brush radius using spatial grid
  const selectPointsInBrush = useCallback((center: THREE.Vector3) => {
    if (!pointCloud.positions) return;

    const selectedIndices: number[] = [];
    const radiusSq = brushSettings.radius * brushSettings.radius;

    if (spatialGrid) {
      const { grid, cellSize } = spatialGrid;
      const cx = Math.floor(center.x / cellSize);
      const cy = Math.floor(center.y / cellSize);
      const cz = Math.floor(center.z / cellSize);
      const r = Math.ceil(brushSettings.radius / cellSize);

      // Check cells within radius
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dz = -r; dz <= r; dz++) {
            const key = `${cx + dx},${cy + dy},${cz + dz}`;
            const indices = grid.get(key);
            if (!indices) continue;

            for (const i of indices) {
              const px = pointCloud.positions[i * 3];
              const py = pointCloud.positions[i * 3 + 1];
              const pz = pointCloud.positions[i * 3 + 2];

              const distX = px - center.x;
              const distY = py - center.y;
              const distZ = pz - center.z;
              const distSq = distX * distX + distY * distY + distZ * distZ;

              if (distSq <= radiusSq) {
                selectedIndices.push(i);
              }
            }
          }
        }
      }
    } else {
      // Fallback brute force
      for (let i = 0; i < pointCloud.pointCount; i++) {
        const px = pointCloud.positions[i * 3];
        const py = pointCloud.positions[i * 3 + 1];
        const pz = pointCloud.positions[i * 3 + 2];

        const dx = px - center.x;
        const dy = py - center.y;
        const dz = pz - center.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq <= radiusSq) {
          selectedIndices.push(i);
        }
      }
    }

    if (selectedIndices.length > 0) {
      onSelect(selectedIndices);
    }
  }, [pointCloud, brushSettings.radius, onSelect, spatialGrid]);

  // Process pending pointer event in animation frame
  const processMove = useCallback(() => {
    const event = pendingEventRef.current;
    if (!event || !enabled) {
      rafRef.current = null;
      return;
    }

    const point = getIntersectionPoint(event);
    if (point) {
      setBrushPosition(point);
      setBrushWorldPosition([point.x, point.y, point.z]);

      // Use ref instead of captured state so we always see the current value
      // even if the React render cycle hasn't completed yet.
      if (isPaintingRef.current) {
        selectPointsInBrush(point);
      }
    }

    pendingEventRef.current = null;
    rafRef.current = null;
  }, [enabled, getIntersectionPoint, selectPointsInBrush, setBrushWorldPosition]);

  // Pointer event handlers - only respond to left click (button 0)
  const handlePointerDown = useCallback((event: PointerEvent) => {
    if (!enabled || event.button !== 0) return;

    const point = getIntersectionPoint(event);
    if (point) {
      setBrushPosition(point);
      setBrushWorldPosition([point.x, point.y, point.z]);
      isPaintingRef.current = true;
      setIsPainting(true);
      setBrushIsPainting(true);
      setIsSelecting(true);
      startBrushSession(); // snapshot pre-paint state for undo
      selectPointsInBrush(point);
    }
  }, [enabled, getIntersectionPoint, selectPointsInBrush, setIsSelecting, startBrushSession, setBrushWorldPosition, setBrushIsPainting]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (!enabled) return;

    // Queue event and process in next animation frame
    pendingEventRef.current = event;
    if (!rafRef.current) {
      rafRef.current = requestAnimationFrame(processMove);
    }
  }, [enabled, processMove]);

  const handlePointerUp = useCallback(() => {
    if (isPaintingRef.current) {
      endBrushSession('Brush paint'); // commit undo entry once per stroke
    }
    isPaintingRef.current = false;
    setIsPainting(false);
    setBrushIsPainting(false);
    setIsSelecting(false);
  }, [setIsSelecting, endBrushSession, setBrushIsPainting]);

  // Attach event listeners
  useEffect(() => {
    if (!enabled) {
      setBrushPosition(null);
      setBrushWorldPosition(null);
      setBrushIsPainting(false);
      // Cancel any pending RAF when disabled
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      return;
    }

    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerUp);

    // Escape key to cancel brush painting
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isPaintingRef.current) {
        e.preventDefault();
        isPaintingRef.current = false;
        setIsPainting(false);
        setBrushIsPainting(false);
        setIsSelecting(false);
        // Note: Already painted points remain - user can use Undo (Ctrl+Z) to revert
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointerleave', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
      // Cancel any pending RAF on cleanup
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [enabled, gl, handlePointerDown, handlePointerMove, handlePointerUp, setIsSelecting, setBrushIsPainting]);

  // Memoize the source sphere geometry used for the wireframe so we don't
  // allocate a new THREE.SphereGeometry on every render (only when radius changes).
  const wireframeSphereGeo = useMemo(
    () => new THREE.SphereGeometry(brushSettings.radius, 20, 14),
    [brushSettings.radius]
  );

  if (!enabled || !brushPosition) return null;

  // Brush color: white when actively painting, red for erase, blue for hover
  const brushColor = brushSettings.mode === 'erase'
    ? '#ef4444'
    : isPainting
      ? '#ffffff'
      : '#3b82f6';

  return (
    <group position={brushPosition}>
      {/* Outer wireframe sphere */}
      <lineSegments renderOrder={999}>
        <wireframeGeometry args={[wireframeSphereGeo]} />
        <lineBasicMaterial
          color={brushColor}
          transparent
          opacity={isPainting ? 0.95 : 0.75}
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
      {/* Inner translucent fill when painting */}
      {isPainting && (
        <mesh renderOrder={998}>
          <sphereGeometry args={[brushSettings.radius * 0.98, 16, 12]} />
          <meshBasicMaterial
            color={brushColor}
            transparent
            opacity={0.08}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      )}
      {/* Center crosshair dot */}
      <mesh renderOrder={1000}>
        <sphereGeometry args={[brushSettings.radius * 0.04, 6, 6]} />
        <meshBasicMaterial
          color={brushColor}
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};

// =============================================================================
// LASSO TOOL
// =============================================================================

interface LassoToolProps {
  pointCloud: PointCloudData;
  onSelect: (indices: number[]) => void;
  enabled: boolean;
  /** Called every time the in-progress polygon changes so a parent can render an overlay */
  onLassoPointsChange?: (points: THREE.Vector2[]) => void;
}

/**
 * 2D Lasso Selection Tool
 * Draw a polygon on screen, select all points inside when projected
 */
export const LassoTool: React.FC<LassoToolProps> = ({ pointCloud, onSelect, enabled, onLassoPointsChange }) => {
  const { camera, gl } = useThree();
  const [lassoPoints, setLassoPoints] = useState<THREE.Vector2[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const setIsSelecting = useSegmentationStore((s) => s.setIsSelecting);

  // Bubble current polygon points to parent for overlay rendering
  useEffect(() => {
    onLassoPointsChange?.(lassoPoints);
  }, [lassoPoints, onLassoPointsChange]);

  // Convert world point to screen coordinates
  const worldToScreen = useCallback((x: number, y: number, z: number): THREE.Vector2 => {
    const point = new THREE.Vector3(x, y, z);
    point.project(camera);
    return new THREE.Vector2(point.x, point.y);
  }, [camera]);

  // Point-in-polygon test (ray casting algorithm)
  const isPointInPolygon = useCallback((point: THREE.Vector2, polygon: THREE.Vector2[]): boolean => {
    if (polygon.length < 3) return false;

    let inside = false;
    const x = point.x;
    const y = point.y;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;

      if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
        inside = !inside;
      }
    }

    return inside;
  }, []);

  // Select points inside lasso
  const selectPointsInLasso = useCallback(() => {
    if (lassoPoints.length < 3 || !pointCloud.positions) return;

    // Get latest state directly from store
    const state = useSegmentationStore.getState();
    const currentFrameIndex = state.currentFrameIndex;
    const frameSeg = state.frameSegmentations.get(currentFrameIndex);
    const currentInstanceIds = frameSeg?.instanceIds;
    const currentHiddenInstances = state.hiddenInstances;

    const selectedIndices: number[] = [];

    for (let i = 0; i < pointCloud.pointCount; i++) {
      // Skip hidden points - don't allow selecting over them
      if (currentInstanceIds && currentInstanceIds[i] >= 0 && currentHiddenInstances.has(currentInstanceIds[i])) {
        continue;
      }

      const px = pointCloud.positions[i * 3];
      const py = pointCloud.positions[i * 3 + 1];
      const pz = pointCloud.positions[i * 3 + 2];

      const screenPos = worldToScreen(px, py, pz);

      // Check if point is within camera frustum (z > 0 after projection means behind camera)
      const point3D = new THREE.Vector3(px, py, pz);
      point3D.project(camera);
      if (point3D.z > 1) continue; // Point is behind camera

      if (isPointInPolygon(screenPos, lassoPoints)) {
        selectedIndices.push(i);
      }
    }

    if (selectedIndices.length > 0) {
      onSelect(selectedIndices);
    }

    // Clear lasso
    setLassoPoints([]);
  }, [lassoPoints, pointCloud, worldToScreen, isPointInPolygon, onSelect, camera]);

  // Mouse event handlers
  const handleMouseDown = useCallback((event: MouseEvent) => {
    if (!enabled || event.button !== 0) return;

    const rect = gl.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    setLassoPoints([new THREE.Vector2(x, y)]);
    setIsDrawing(true);
    setIsSelecting(true);
  }, [enabled, gl, setIsSelecting]);

  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!enabled || !isDrawing) return;

    const rect = gl.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    setLassoPoints(prev => [...prev, new THREE.Vector2(x, y)]);
  }, [enabled, isDrawing, gl]);

  const handleMouseUp = useCallback(() => {
    if (!enabled || !isDrawing) return;

    setIsDrawing(false);
    setIsSelecting(false);
    selectPointsInLasso();
  }, [enabled, isDrawing, selectPointsInLasso, setIsSelecting]);

  // Attach event listeners
  useEffect(() => {
    if (!enabled) {
      setLassoPoints([]);
      return;
    }

    const canvas = gl.domElement;
    canvas.addEventListener('mousedown', handleMouseDown);
    canvas.addEventListener('mousemove', handleMouseMove);
    canvas.addEventListener('mouseup', handleMouseUp);

    // Escape key to cancel lasso drawing
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDrawing) {
        e.preventDefault();
        setIsDrawing(false);
        setIsSelecting(false);
        setLassoPoints([]);
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      canvas.removeEventListener('mousedown', handleMouseDown);
      canvas.removeEventListener('mousemove', handleMouseMove);
      canvas.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [enabled, gl, handleMouseDown, handleMouseMove, handleMouseUp, isDrawing, setIsSelecting]);

  return null; // Lasso is rendered as HTML overlay, not in Three.js
};

// =============================================================================
// LASSO OVERLAY (HTML)
// =============================================================================

interface LassoOverlayProps {
  points: THREE.Vector2[];
  containerRef: React.RefObject<HTMLDivElement | null>;
}

export const LassoOverlay: React.FC<LassoOverlayProps> = ({ points, containerRef }) => {
  if (points.length < 2 || !containerRef.current) return null;

  const container = containerRef.current;
  const rect = container.getBoundingClientRect();

  // Convert normalized device coordinates to pixel coordinates
  const screenPoints = points.map(p => ({
    x: ((p.x + 1) / 2) * rect.width,
    y: ((-p.y + 1) / 2) * rect.height,
  }));

  // Create SVG path
  const pathData = screenPoints
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`)
    .join(' ') + ' Z';

  return (
    <svg
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 100,
      }}
    >
      <path
        d={pathData}
        fill="rgba(59, 130, 246, 0.2)"
        stroke="#3b82f6"
        strokeWidth={2}
        strokeDasharray="5,5"
      />
    </svg>
  );
};

// =============================================================================
// REGION GROW TOOL
// =============================================================================

interface RegionGrowToolProps {
  pointCloud: PointCloudData;
  onSelect: (indices: number[]) => void;
  enabled: boolean;
}

/**
 * Region Growing Tool
 * Click a seed point, automatically select connected points with similar properties
 */
export const RegionGrowTool: React.FC<RegionGrowToolProps> = ({ pointCloud, onSelect, enabled }) => {
  const { raycaster, camera, gl } = useThree();
  const regionGrowSettings = useSegmentationStore((s) => s.regionGrowSettings);
  const setIsSelecting = useSegmentationStore((s) => s.setIsSelecting);

  // Helper to check if a point is hidden (uses getState for fresh data)
  const isPointHidden = useCallback((idx: number): boolean => {
    const state = useSegmentationStore.getState();
    const currentFrameIndex = state.currentFrameIndex;
    const frameSeg = state.frameSegmentations.get(currentFrameIndex);
    const currentInstanceIds = frameSeg?.instanceIds;
    const currentHiddenInstances = state.hiddenInstances;

    return currentInstanceIds !== undefined && currentInstanceIds !== null &&
           currentInstanceIds[idx] >= 0 && currentHiddenInstances.has(currentInstanceIds[idx]);
  }, []);

  // Build KD-tree like neighbor lookup (simplified version using grid)
  const buildNeighborIndex = useCallback((positions: Float32Array, pointCount: number, cellSize: number) => {
    const grid: Map<string, number[]> = new Map();

    for (let i = 0; i < pointCount; i++) {
      const x = positions[i * 3];
      const y = positions[i * 3 + 1];
      const z = positions[i * 3 + 2];

      const cellX = Math.floor(x / cellSize);
      const cellY = Math.floor(y / cellSize);
      const cellZ = Math.floor(z / cellSize);
      const key = `${cellX},${cellY},${cellZ}`;

      if (!grid.has(key)) {
        grid.set(key, []);
      }
      grid.get(key)!.push(i);
    }

    return grid;
  }, []);

  // Get neighbors within threshold distance
  const getNeighbors = useCallback((
    seedIdx: number,
    positions: Float32Array,
    grid: Map<string, number[]>,
    cellSize: number,
    threshold: number
  ): number[] => {
    const neighbors: number[] = [];
    const thresholdSq = threshold * threshold;

    const sx = positions[seedIdx * 3];
    const sy = positions[seedIdx * 3 + 1];
    const sz = positions[seedIdx * 3 + 2];

    const cellX = Math.floor(sx / cellSize);
    const cellY = Math.floor(sy / cellSize);
    const cellZ = Math.floor(sz / cellSize);

    // Check 3x3x3 neighborhood of cells
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = `${cellX + dx},${cellY + dy},${cellZ + dz}`;
          const cell = grid.get(key);
          if (!cell) continue;

          for (const idx of cell) {
            if (idx === seedIdx) continue;

            const px = positions[idx * 3];
            const py = positions[idx * 3 + 1];
            const pz = positions[idx * 3 + 2];

            const distSq = (px - sx) ** 2 + (py - sy) ** 2 + (pz - sz) ** 2;
            if (distSq <= thresholdSq) {
              neighbors.push(idx);
            }
          }
        }
      }
    }

    return neighbors;
  }, []);

  // Region growing algorithm
  const growRegion = useCallback((seedIdx: number) => {
    if (!pointCloud.positions) return [];

    const { seedThreshold, maxPoints } = regionGrowSettings;
    const cellSize = seedThreshold * 2;

    // Build spatial index
    const grid = buildNeighborIndex(pointCloud.positions, pointCloud.pointCount, cellSize);

    // BFS region growing
    const visited = new Set<number>();
    const queue: number[] = [seedIdx];
    const region: number[] = [];

    while (queue.length > 0 && region.length < maxPoints) {
      const current = queue.shift()!;
      if (visited.has(current)) continue;

      // Skip hidden points
      if (isPointHidden(current)) {
        visited.add(current);
        continue;
      }

      visited.add(current);
      region.push(current);

      // Get neighbors
      const neighbors = getNeighbors(current, pointCloud.positions, grid, cellSize, seedThreshold);

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor) && !isPointHidden(neighbor)) {
          queue.push(neighbor);
        }
      }
    }

    return region;
  }, [pointCloud, regionGrowSettings, buildNeighborIndex, getNeighbors, isPointHidden]);

  // Handle click to start region growing
  const handleClick = useCallback((event: MouseEvent) => {
    if (!enabled || event.button !== 0) return;

    const rect = gl.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    // Find closest point to ray (skip hidden points)
    let closestIdx = -1;
    let closestDist = Infinity;

    for (let i = 0; i < pointCloud.pointCount; i++) {
      // Skip hidden points - cannot use as seed
      if (isPointHidden(i)) continue;

      const px = pointCloud.positions[i * 3];
      const py = pointCloud.positions[i * 3 + 1];
      const pz = pointCloud.positions[i * 3 + 2];

      const point = new THREE.Vector3(px, py, pz);
      const dist = raycaster.ray.distanceToPoint(point);

      if (dist < 0.5 && dist < closestDist) {
        closestDist = dist;
        closestIdx = i;
      }
    }

    if (closestIdx >= 0) {
      setIsSelecting(true);
      const region = growRegion(closestIdx);
      onSelect(region);
      setIsSelecting(false);
    }
  }, [enabled, gl, raycaster, camera, pointCloud, growRegion, onSelect, setIsSelecting, isPointHidden]);

  // Attach event listener
  useEffect(() => {
    if (!enabled) return;

    const canvas = gl.domElement;
    canvas.addEventListener('click', handleClick);

    return () => {
      canvas.removeEventListener('click', handleClick);
    };
  }, [enabled, gl, handleClick]);

  return null;
};

// =============================================================================
// ERASER TOOL
// =============================================================================

interface EraserToolProps {
  pointCloud: PointCloudData;
  onErase: (indices: number[]) => void;
  enabled: boolean;
}

/**
 * Eraser Tool
 * Same as brush but removes labels instead of adding them
 */
export const EraserTool: React.FC<EraserToolProps> = ({ pointCloud, onErase, enabled }) => {
  // Reuse brush logic with eraser visualization
  const { raycaster, camera, gl } = useThree();
  const [brushPosition, setBrushPosition] = useState<THREE.Vector3 | null>(null);
  const [isErasing, setIsErasing] = useState(false);

  const brushSettings = useSegmentationStore((s) => s.brushSettings);
  const setBrushWorldPosition = useSegmentationStore((s) => s.setBrushWorldPosition);
  const setBrushIsPainting   = useSegmentationStore((s) => s.setBrushIsPainting);

  // Helper to check if a point is hidden (uses getState for fresh data)
  const isPointHidden = useCallback((idx: number): boolean => {
    const state = useSegmentationStore.getState();
    const currentFrameIndex = state.currentFrameIndex;
    const frameSeg = state.frameSegmentations.get(currentFrameIndex);
    const currentInstanceIds = frameSeg?.instanceIds;
    const currentHiddenInstances = state.hiddenInstances;

    return currentInstanceIds !== undefined && currentInstanceIds !== null &&
           currentInstanceIds[idx] >= 0 && currentHiddenInstances.has(currentInstanceIds[idx]);
  }, []);

  // Throttle pointer move handler
  const lastMoveRef = useRef(0);
  const MOVE_THROTTLE_MS = 25; // ~40fps pointer updates

  // Find nearest point cloud point for brush position (same as BrushTool)
  const getIntersectionPoint = useCallback((event: PointerEvent): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(new THREE.Vector2(x, y), camera);

    // Find the nearest point in the point cloud using a spatial search
    if (!pointCloud.positions || pointCloud.pointCount === 0) {
      return raycaster.ray.at(20, new THREE.Vector3());
    }

    let closestPoint: THREE.Vector3 | null = null;
    let closestDistSq = Infinity;
    const rayOrigin = raycaster.ray.origin;
    const rayDir = raycaster.ray.direction.clone().normalize();
    const threshold = brushSettings.radius * 2; // Search within 2x brush radius

    // Find point with smallest perpendicular distance to ray
    for (let i = 0; i < pointCloud.pointCount; i++) {
      const px = pointCloud.positions[i * 3];
      const py = pointCloud.positions[i * 3 + 1];
      const pz = pointCloud.positions[i * 3 + 2];

      // Vector from ray origin to point
      const dx = px - rayOrigin.x;
      const dy = py - rayOrigin.y;
      const dz = pz - rayOrigin.z;

      // Project onto ray direction
      const t = dx * rayDir.x + dy * rayDir.y + dz * rayDir.z;
      if (t < 0) continue; // Behind camera

      // Perpendicular distance squared
      const perp_x = dx - t * rayDir.x;
      const perp_y = dy - t * rayDir.y;
      const perp_z = dz - t * rayDir.z;
      const perpDistSq = perp_x * perp_x + perp_y * perp_y + perp_z * perp_z;

      if (perpDistSq < threshold * threshold && perpDistSq < closestDistSq) {
        closestDistSq = perpDistSq;
        closestPoint = new THREE.Vector3(px, py, pz);
      }
    }

    if (closestPoint) {
      return closestPoint;
    }

    // Fallback to plane intersection at z=0
    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    const intersection = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(plane, intersection)) {
      return intersection;
    }

    return raycaster.ray.at(20, new THREE.Vector3());
  }, [raycaster, camera, gl, pointCloud, brushSettings.radius]);

  // Find points to erase
  const erasePointsInBrush = useCallback((center: THREE.Vector3) => {
    if (!pointCloud.positions) return;

    const indicesToErase: number[] = [];
    const radiusSq = brushSettings.radius * brushSettings.radius;

    for (let i = 0; i < pointCloud.pointCount; i++) {
      // Skip hidden points - don't allow erasing them
      if (isPointHidden(i)) continue;

      const px = pointCloud.positions[i * 3];
      const py = pointCloud.positions[i * 3 + 1];
      const pz = pointCloud.positions[i * 3 + 2];

      const dx = px - center.x;
      const dy = py - center.y;
      const dz = pz - center.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq <= radiusSq) {
        indicesToErase.push(i);
      }
    }

    if (indicesToErase.length > 0) {
      onErase(indicesToErase);
    }
  }, [pointCloud, brushSettings.radius, onErase, isPointHidden]);

  // Event handlers - only respond to left click (button 0)
  const handlePointerDown = useCallback((event: PointerEvent) => {
    if (!enabled || event.button !== 0) return; // Left click only

    const point = getIntersectionPoint(event);
    if (point) {
      setBrushPosition(point);
      setBrushWorldPosition([point.x, point.y, point.z]);
      setIsErasing(true);
      setBrushIsPainting(true);
      erasePointsInBrush(point);
    }
  }, [enabled, getIntersectionPoint, erasePointsInBrush, setBrushWorldPosition, setBrushIsPainting]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    if (!enabled) return;

    const now = performance.now();
    if (now - lastMoveRef.current < MOVE_THROTTLE_MS) return;
    lastMoveRef.current = now;

    const point = getIntersectionPoint(event);
    if (point) {
      setBrushPosition(point);
      setBrushWorldPosition([point.x, point.y, point.z]);

      if (isErasing) {
        erasePointsInBrush(point);
      }
    }
  }, [enabled, isErasing, getIntersectionPoint, erasePointsInBrush, setBrushWorldPosition]);

  const handlePointerUp = useCallback(() => {
    setIsErasing(false);
    setBrushIsPainting(false);
  }, [setBrushIsPainting]);

  useEffect(() => {
    if (!enabled) {
      setBrushPosition(null);
      setBrushWorldPosition(null);
      setBrushIsPainting(false);
      return;
    }

    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointerleave', handlePointerUp);

    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointerleave', handlePointerUp);
    };
  }, [enabled, gl, handlePointerDown, handlePointerMove, handlePointerUp, setBrushWorldPosition, setBrushIsPainting]);

  if (!enabled || !brushPosition) return null;

  return (
    <group position={brushPosition}>
      {/* Outer wireframe sphere */}
      <lineSegments renderOrder={999}>
        <wireframeGeometry args={[new THREE.SphereGeometry(brushSettings.radius, 20, 14)]} />
        <lineBasicMaterial
          color="#ef4444"
          transparent
          opacity={isErasing ? 0.95 : 0.75}
          depthTest={false}
          depthWrite={false}
        />
      </lineSegments>
      {/* Inner translucent fill when erasing */}
      {isErasing && (
        <mesh renderOrder={998}>
          <sphereGeometry args={[brushSettings.radius * 0.98, 16, 12]} />
          <meshBasicMaterial
            color="#ef4444"
            transparent
            opacity={0.15}
            depthTest={false}
            depthWrite={false}
          />
        </mesh>
      )}
      {/* Center crosshair dot */}
      <mesh renderOrder={1000}>
        <sphereGeometry args={[brushSettings.radius * 0.04, 6, 6]} />
        <meshBasicMaterial
          color="#ef4444"
          depthTest={false}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
};

export default {
  BrushTool,
  LassoTool,
  LassoOverlay,
  RegionGrowTool,
  EraserTool,
};

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import { Canvas, useThree, ThreeEvent } from '@react-three/fiber';
import { OrthographicCamera, Line } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore, useSelectedAnnotations } from '@/store/editorStore';
import type { Annotation, CuboidData, DetectedGroundPlane, PointCloudData, ClipBoxSettings } from '@/types';
import { detectLocalGroundPlane, type PlaneEquation } from '@/utils/groundPlaneDetection';


type ViewType = 'top' | 'side' | 'front';
const FILTER_RADIUS = 12;
const BOX_COLOR = '#f59e0b';
const MIN_SLICE_THICKNESS = 0.3;
const MAX_SLICE_THICKNESS = 4.0;

interface OrthoPointVisibilitySettings {
  focusSlice: boolean;
  sliceThickness: number;
  showContextPoints: boolean;
  showGroundLine: boolean;
}

interface DisplayCenter2D {
  x: number;
  y: number;
}

const DEFAULT_ORTHO_POINT_VISIBILITY: OrthoPointVisibilitySettings = {
  focusSlice: true,
  sliceThickness: 1.5,
  showContextPoints: true,
  showGroundLine: true,
};


const ROTATION_ORDER = 'ZYX';

const VIRIDIS_TURBO_COLORSCALE: [number, number, number][] = [
  [0.267, 0.004, 0.329],
  [0.282, 0.140, 0.458],
  [0.253, 0.265, 0.530],
  [0.191, 0.407, 0.556],
  [0.127, 0.566, 0.550],
  [0.134, 0.658, 0.518],
  [0.267, 0.749, 0.440],
  [0.477, 0.821, 0.318],
  [0.741, 0.873, 0.150],
  [0.993, 0.906, 0.144],
  [0.988, 0.652, 0.118],
];

function getHeightColor(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));

  const scaledIndex = clamped * (VIRIDIS_TURBO_COLORSCALE.length - 1);
  const lowerIndex = Math.floor(scaledIndex);
  const upperIndex = Math.min(lowerIndex + 1, VIRIDIS_TURBO_COLORSCALE.length - 1);
  const fraction = scaledIndex - lowerIndex;

  const lowerColor = VIRIDIS_TURBO_COLORSCALE[lowerIndex];
  const upperColor = VIRIDIS_TURBO_COLORSCALE[upperIndex];

  return [
    lowerColor[0] + (upperColor[0] - lowerColor[0]) * fraction,
    lowerColor[1] + (upperColor[1] - lowerColor[1]) * fraction,
    lowerColor[2] + (upperColor[2] - lowerColor[2]) * fraction,
  ];
}


const CanvasCleanup: React.FC = () => {
  const { gl } = useThree();

  useEffect(() => {
    return () => {
      if (gl) {
        try {
          gl.dispose();
        } catch (error) {
          console.debug('WebGL context cleanup error:', error);
        }
      }
    };
  }, [gl]);

  return null;
};

const BackgroundOrbitHandler: React.FC<{
  onOrbitDelta: (dx: number, dy: number) => void;
}> = ({ onOrbitDelta }) => {
  const isOrbiting = useRef(false);
  const lastPos = useRef({ x: 0, y: 0 });

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    isOrbiting.current = true;
    lastPos.current = { x: e.clientX, y: e.clientY };
    document.body.style.cursor = 'grabbing';
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isOrbiting.current) return;
    e.stopPropagation();
    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;
    lastPos.current = { x: e.clientX, y: e.clientY };
    onOrbitDelta(dx, dy);
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!isOrbiting.current) return;
    e.stopPropagation();
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    isOrbiting.current = false;
    document.body.style.cursor = 'auto';
  };

  return (
    <mesh
      position={[0, 0, -1]}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerOver={() => { document.body.style.cursor = 'grab'; }}
      onPointerOut={() => { if (!isOrbiting.current) document.body.style.cursor = 'auto'; }}
    >
      <planeGeometry args={[10000, 10000]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
    </mesh>
  );
};

const RotationDial: React.FC<{
  radius: number;
  color: string;
  value: number;
  onChange: (angle: number) => void;
  onEnd: () => void;
}> = ({ radius, color, value, onChange, onEnd }) => {
  const { gl, viewport } = useThree();
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const startAngleRef = useRef(0);
  const startValueRef = useRef(0);

  const getAngle = (clientX: number, clientY: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 2 - 1;
    const y = -((clientY - rect.top) / rect.height) * 2 + 1;

    const wx = x * (viewport.width / 2);
    const wy = y * (viewport.height / 2);

    return Math.atan2(wy, wx);
  };

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);

    startAngleRef.current = getAngle(e.clientX, e.clientY);
    startValueRef.current = value;
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging) return;
    e.stopPropagation();

    const currentAngle = getAngle(e.clientX, e.clientY);
    const deltaAngle = currentAngle - startAngleRef.current;

    onChange(startValueRef.current + deltaAngle);
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging) return;
    e.stopPropagation();
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setIsDragging(false);
    onEnd();
  };

  useEffect(() => {
    document.body.style.cursor = isDragging ? 'grabbing' : 'auto';
    return () => { document.body.style.cursor = 'auto'; };
  }, [isDragging]);

  const segments = 32;
  const points = useMemo(() => {
    const pts = [];
    for (let i = 0; i <= segments; i++) {
      const theta = (i / segments) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(theta) * radius, Math.sin(theta) * radius, 0));
    }
    return pts;
  }, [radius]);

  const knobPos = new THREE.Vector3(Math.cos(0) * radius, Math.sin(0) * radius, 0);

  return (
    <group>
      {/* The Ring */}
      <Line points={points} color={color} lineWidth={1} transparent opacity={0.5} />

      {/* The Knob (Invisible hit area + Visible dot) */}
      <group rotation={[0, 0, 0]}>
        {/* We rotate the knob group to match the handle position visually if we wanted,
            but here we keep the handle at 0 degrees (Right) relative to the box,
            and the box rotates. Wait, the box is fixed in view.
            So the handle is fixed in view.
            The user rotates the "World" around the box.
            So the handle stays at 3 o'clock. */}
        <mesh
          position={knobPos}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerOver={() => { setIsHovered(true); document.body.style.cursor = 'grab'; }}
          onPointerOut={() => { setIsHovered(false); if (!isDragging) document.body.style.cursor = 'auto'; }}
        >
          <circleGeometry args={[0.6, 16]} />
          <meshBasicMaterial color={isHovered || isDragging ? '#ffffff' : color} transparent opacity={isHovered || isDragging ? 1.0 : 0.8} />
        </mesh>
        {/* Connector */}
        <Line points={[[0,0,0], knobPos]} color={color} lineWidth={1} dashed />
      </group>
    </group>
  );
};

const DraggableHandle: React.FC<{
  position: [number, number, number];
  onDrag: (delta: THREE.Vector3) => void;
  onEnd: () => void;
  cursor?: string;
  color?: string;
  scale?: number;
  children?: React.ReactNode;
}> = ({ position, onDrag, onEnd, cursor = 'pointer', color = BOX_COLOR, scale = 1, children }) => {
  const { gl, viewport } = useThree();
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const lastPos = useRef<{ x: number, y: number } | null>(null);

  const visibleSize = 0.5 * scale;
  const hitAreaMultiplier = 3.0;
  const hitAreaSize = visibleSize * hitAreaMultiplier;

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging || !lastPos.current) return;
    e.stopPropagation();

    const dx = e.clientX - lastPos.current.x;
    const dy = e.clientY - lastPos.current.y;

    const factorX = viewport.width / gl.domElement.clientWidth;
    const factorY = viewport.height / gl.domElement.clientHeight;

    const delta = new THREE.Vector3(dx * factorX, -dy * factorY, 0);
    onDrag(delta);

    lastPos.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging) return;
    e.stopPropagation();
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setIsDragging(false);
    lastPos.current = null;
    onEnd();
  };

  const handlePointerOver = () => {
    setIsHovered(true);
    document.body.style.cursor = cursor;
  };

  const handlePointerOut = () => {
    setIsHovered(false);
    if (!isDragging) document.body.style.cursor = 'auto';
  };

  useEffect(() => {
    if (isDragging) document.body.style.cursor = cursor;
    return () => { if (isDragging) document.body.style.cursor = 'auto'; };
  }, [isDragging, cursor]);

  if (children) {
    return (
      <group position={position}>
        <mesh
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerOver={handlePointerOver}
          onPointerOut={handlePointerOut}
        >
          {children}
        </mesh>
      </group>
    );
  }

  return (
    <group position={position}>
      {/* Invisible hit area - much larger for easier clicking */}
      <mesh
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
      >
        <planeGeometry args={[hitAreaSize, hitAreaSize]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {/* Visible handle - smaller but with hover effect */}
      <mesh>
        <planeGeometry args={[visibleSize, visibleSize]} />
        <meshBasicMaterial
          color={isHovered || isDragging ? '#ffffff' : color}
          transparent
          opacity={isHovered || isDragging ? 1 : 0.85}
        />
      </mesh>
      {/* Border ring on hover for extra visibility */}
      {(isHovered || isDragging) && (
        <mesh>
          <ringGeometry args={[visibleSize * 0.6, visibleSize * 0.8, 16]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )}
    </group>
  );
};

const AxisResizeHandle: React.FC<{
  position: [number, number, number];
  direction: 'x' | 'y';
  sign: 1 | -1;
  onDrag: (delta: number) => void;
  onEnd: () => void;
  color?: string;
}> = ({ position, direction, sign, onDrag, onEnd, color = '#3b82f6' }) => {
  const { gl, viewport } = useThree();
  const [isDragging, setIsDragging] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const lastPos = useRef<number | null>(null);

  const cursor = direction === 'x' ? 'ew-resize' : 'ns-resize';

  const handlePointerDown = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    e.nativeEvent.stopImmediatePropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsDragging(true);
    lastPos.current = direction === 'x' ? e.clientX : e.clientY;
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging || lastPos.current === null) return;
    e.stopPropagation();

    const currentPos = direction === 'x' ? e.clientX : e.clientY;
    const pixelDelta = currentPos - lastPos.current;

    const factor = direction === 'x'
      ? viewport.width / gl.domElement.clientWidth
      : viewport.height / gl.domElement.clientHeight;

    const worldDelta = direction === 'x' ? pixelDelta * factor : -pixelDelta * factor;

    onDrag(worldDelta);
    lastPos.current = currentPos;
  };

  const handlePointerUp = (e: ThreeEvent<PointerEvent>) => {
    if (!isDragging) return;
    e.stopPropagation();
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    setIsDragging(false);
    lastPos.current = null;
    onEnd();
  };

  useEffect(() => {
    if (isDragging) document.body.style.cursor = cursor;
    return () => { if (isDragging) document.body.style.cursor = 'auto'; };
  }, [isDragging, cursor]);

  const arrowLength = 0.8;
  const arrowWidth = 0.4;
  const hitAreaSize = 1.5;

  const arrowPoints = useMemo(() => {
    if (direction === 'x') {
      return [
        new THREE.Vector3(0, -arrowWidth/2, 0),
        new THREE.Vector3(sign * arrowLength, 0, 0),
        new THREE.Vector3(0, arrowWidth/2, 0),
        new THREE.Vector3(0, -arrowWidth/2, 0),
      ];
    } else {
      return [
        new THREE.Vector3(-arrowWidth/2, 0, 0),
        new THREE.Vector3(0, sign * arrowLength, 0),
        new THREE.Vector3(arrowWidth/2, 0, 0),
        new THREE.Vector3(-arrowWidth/2, 0, 0),
      ];
    }
  }, [direction, sign]);

  const activeColor = isHovered || isDragging ? '#ffffff' : color;

  return (
    <group position={position}>
      {/* Invisible hit area */}
      <mesh
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerOver={() => { setIsHovered(true); document.body.style.cursor = cursor; }}
        onPointerOut={() => { setIsHovered(false); if (!isDragging) document.body.style.cursor = 'auto'; }}
      >
        <planeGeometry args={[hitAreaSize, hitAreaSize]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      {/* Arrow shape */}
      <Line points={arrowPoints} color={activeColor} lineWidth={3} />

      {/* Filled arrow head */}
      <mesh>
        <shapeGeometry args={[(() => {
          const shape = new THREE.Shape();
          if (direction === 'x') {
            shape.moveTo(0, -arrowWidth/2);
            shape.lineTo(sign * arrowLength, 0);
            shape.lineTo(0, arrowWidth/2);
            shape.lineTo(0, -arrowWidth/2);
          } else {
            shape.moveTo(-arrowWidth/2, 0);
            shape.lineTo(0, sign * arrowLength);
            shape.lineTo(arrowWidth/2, 0);
            shape.lineTo(-arrowWidth/2, 0);
          }
          return shape;
        })()]} />
        <meshBasicMaterial color={activeColor} transparent opacity={isHovered || isDragging ? 0.9 : 0.7} />
      </mesh>

      {/* Axis line back to box */}
      <Line
        points={direction === 'x'
          ? [[0, 0, 0], [-sign * 0.5, 0, 0]]
          : [[0, 0, 0], [0, -sign * 0.5, 0]]}
        color={color}
        lineWidth={1}
        dashed
        dashSize={0.1}
        gapSize={0.05}
      />
    </group>
  );
};

const ProjectedPointCloud: React.FC<{
  pointCloud: PointCloudData,
  viewOrigin: { x: number, y: number, z: number },
  boxCenter: { x: number, y: number, z: number },
  boxDimensions: { length: number, width: number, height: number },
  boxRotation: { yaw: number, pitch: number, roll: number },
  viewType: ViewType,
  visibility: OrthoPointVisibilitySettings,
  clipBox?: ClipBoxSettings,
}> = ({ pointCloud, viewOrigin, boxCenter, boxDimensions, boxRotation, viewType, visibility, clipBox }) => {
  const { positions } = pointCloud;

  const inverseRotation = useMemo(() => {
    const euler = new THREE.Euler(boxRotation.roll, boxRotation.pitch, boxRotation.yaw, ROTATION_ORDER);
    return new THREE.Quaternion().setFromEuler(euler).invert();
  }, [boxRotation]);

  const geometries = useMemo(() => {
    const radiusSq = FILTER_RADIUS * FILTER_RADIUS;
    const halfSlice = Math.max(MIN_SLICE_THICKNESS, visibility.sliceThickness) / 2;
    const shouldSlice = visibility.focusSlice && viewType !== 'top';
    const local = new THREE.Vector3();
    const insidePadding = 0.2;
    const halfLength = boxDimensions.length / 2 + insidePadding;
    const halfWidth = boxDimensions.width / 2 + insidePadding;
    const halfHeight = boxDimensions.height / 2 + insidePadding;

    const ox = viewOrigin.x;
    const oy = viewOrigin.y;
    const oz = viewOrigin.z;
    const cx = boxCenter.x;
    const cy = boxCenter.y;
    const cz = boxCenter.z;

    interface PointData {
      vx: number;
      vy: number;
      vz: number;
      inFocus: boolean;
    }
    const visiblePoints: PointData[] = [];
    let zMin = Infinity;
    let zMax = -Infinity;

    for (let i = 0; i < pointCloud.pointCount; i++) {
      const px = positions[i * 3];
      const py = positions[i * 3 + 1];
      const pz = positions[i * 3 + 2];

      if (clipBox?.enabled) {
        if (px < clipBox.xMin || px > clipBox.xMax ||
            py < clipBox.yMin || py > clipBox.yMax ||
            pz < clipBox.zMin || pz > clipBox.zMax) {
          continue;
        }
      }

      const dx = px - cx;
      const dy = py - cy;
      if (dx*dx + dy*dy > radiusSq) continue;

      local.set(dx, dy, pz - cz).applyQuaternion(inverseRotation);

      const insideBox =
        Math.abs(local.x) <= halfLength &&
        Math.abs(local.y) <= halfWidth &&
        Math.abs(local.z) <= halfHeight;

      let inFocusSlice = true;
      if (shouldSlice) {
        const depthAxis = viewType === 'side' ? local.y : local.x;
        inFocusSlice = Math.abs(depthAxis) <= halfSlice;
      }

      const inFocus = inFocusSlice || insideBox;

      if (!inFocus && !visibility.showContextPoints) continue;

      const vx = px - ox;
      const vy = py - oy;
      const vz = pz - oz;

      zMin = Math.min(zMin, vz);
      zMax = Math.max(zMax, vz);

      visiblePoints.push({ vx, vy, vz, inFocus });
    }

    const focusedPositions: number[] = [];
    const focusedColors: number[] = [];
    const contextPositions: number[] = [];
    const contextColors: number[] = [];

    const zRange = zMax - zMin;
    const hasValidRange = zRange > 0.01;

    for (const point of visiblePoints) {
      const { vx, vy, vz, inFocus } = point;

      const normalizedZ = hasValidRange
        ? (vz - zMin) / zRange
        : 0.5;

      const [r, g, b] = getHeightColor(normalizedZ);

      const targetPositions = inFocus ? focusedPositions : contextPositions;
      const targetColors = inFocus ? focusedColors : contextColors;
      const brightness = inFocus ? 1 : 0.35;

      targetPositions.push(vx, vy, vz);
      targetColors.push(r * brightness, g * brightness, b * brightness);
    }

    const focusGeometry = new THREE.BufferGeometry();
    focusGeometry.setAttribute('position', new THREE.Float32BufferAttribute(focusedPositions, 3));
    focusGeometry.setAttribute('color', new THREE.Float32BufferAttribute(focusedColors, 3));

    const contextGeometry = new THREE.BufferGeometry();
    contextGeometry.setAttribute('position', new THREE.Float32BufferAttribute(contextPositions, 3));
    contextGeometry.setAttribute('color', new THREE.Float32BufferAttribute(contextColors, 3));

    return { focusGeometry, contextGeometry };
  }, [
    pointCloud,
    viewOrigin.x,
    viewOrigin.y,
    viewOrigin.z,
    boxCenter.x,
    boxCenter.y,
    boxCenter.z,
    inverseRotation,
    boxDimensions.length,
    boxDimensions.width,
    boxDimensions.height,
    viewType,
    visibility.focusSlice,
    visibility.sliceThickness,
    visibility.showContextPoints,
    clipBox?.enabled,
    clipBox?.xMin,
    clipBox?.xMax,
    clipBox?.yMin,
    clipBox?.yMax,
    clipBox?.zMin,
    clipBox?.zMax,
  ]);



  const rotationEuler = useMemo(() => {
    return new THREE.Euler().setFromQuaternion(inverseRotation);
  }, [inverseRotation]);



  const viewRotation = useMemo(() => {
    switch (viewType) {
      case 'top': return [0, 0, 0];
      case 'side': return [-Math.PI/2, 0, 0];
      case 'front': return [-Math.PI/2, 0, Math.PI/2];
    }
  }, [viewType]);

  return (
    <group rotation={viewRotation as any}>
      <points geometry={geometries.contextGeometry} rotation={rotationEuler}>
        <pointsMaterial
          size={1.5}
          vertexColors
          sizeAttenuation={false}
          transparent
          opacity={0.12}
          depthWrite={false}
          depthTest={false}
        />
      </points>
      <points geometry={geometries.focusGeometry} rotation={rotationEuler}>
        <pointsMaterial
          size={2.8}
          vertexColors
          sizeAttenuation={false}
          transparent={false}
          opacity={1}
          depthWrite
        />
      </points>
    </group>
  );
};

const Box2D: React.FC<{
  data: CuboidData,
  viewType: ViewType,
  displayCenter: DisplayCenter2D,
  onUpdate: (u: Partial<CuboidData>) => void,
  onCommit: () => void
}> = ({ data, viewType, displayCenter, onUpdate, onCommit }) => {
  const { length, width, height } = data.dimensions;

  let dimX = 0, dimY = 0;
  if (viewType === 'top') { dimX = length; dimY = width; }
  else if (viewType === 'side') { dimX = length; dimY = height; }
  else { dimX = width; dimY = height; }

  const halfX = dimX / 2;
  const halfY = dimY / 2;

  const vertices = useMemo(() => [
    [-halfX, -halfY, 0],
    [halfX, -halfY, 0],
    [halfX, halfY, 0],
    [-halfX, halfY, 0],
    [-halfX, -halfY, 0]
  ].map(p => new THREE.Vector3(...p)), [dimX, dimY]);


  const handleTranslate = (delta: THREE.Vector3) => {

    let localDx = 0, localDy = 0, localDz = 0;
    if (viewType === 'top') { localDx = delta.x; localDy = delta.y; }
    else if (viewType === 'side') { localDx = delta.x; localDz = delta.y; }
    else { localDy = -delta.x; localDz = delta.y; }

    const yaw = data.rotation?.yaw ?? 0;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);

    const worldDx = localDx * cos - localDy * sin;
    const worldDy = localDx * sin + localDy * cos;
    const worldDz = localDz;

    onUpdate({
      center: {
        x: data.center.x + worldDx,
        y: data.center.y + worldDy,
        z: data.center.z + worldDz
      }
    });
  };

  const handleRotate = (newAngle: number, axis: 'yaw' | 'pitch' | 'roll') => {


    const rot = { ...(data.rotation ?? { yaw: 0, pitch: 0, roll: 0 }) };
    rot[axis] = newAngle;
    onUpdate({ rotation: rot });
  };

  return (
    <group position={[displayCenter.x, displayCenter.y, 0]}>
      {/* Box Outline */}
      <Line points={vertices} color={BOX_COLOR} lineWidth={2} />

      {/* Transparent Fill for Move */}
      <DraggableHandle
        position={[0, 0, 0]}
        onDrag={handleTranslate}
        onEnd={onCommit}
        cursor="move"
        color={BOX_COLOR}
      >
        <planeGeometry args={[dimX, dimY]} />
        <meshBasicMaterial color={BOX_COLOR} transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </DraggableHandle>

      {/* Direction Arrow (Top) */}
      {viewType === 'top' && (
        <Line points={[[0, 0, 0], [halfX, 0, 0]]} color="red" lineWidth={2} />
      )}

      {/* Axis Resize Handles - positioned outside the box but inside rotation dial */}
      {/* These arrow handles allow single-axis resizing in one direction */}

      {/* +X axis (right side - extends length in top/side, width in front) */}
      <AxisResizeHandle
        position={[halfX + 1.0, 0, 0]}
        direction="x"
        sign={1}
        onDrag={(delta) => {
          if (viewType === 'top' || viewType === 'side') {
            const newLength = Math.max(0.1, length + delta);
            const yaw = data.rotation?.yaw ?? 0;
            const cos = Math.cos(yaw);
            const sin = Math.sin(yaw);
            const shiftX = delta / 2;
            onUpdate({
              dimensions: { length: newLength, width, height },
              center: { x: data.center.x + shiftX * cos, y: data.center.y + shiftX * sin, z: data.center.z }
            });
          } else {
            const newWidth = Math.max(0.1, width + delta);
            const yaw = data.rotation?.yaw ?? 0;
            const cos = Math.cos(yaw);
            const sin = Math.sin(yaw);
            const shiftY = -delta / 2;
            onUpdate({
              dimensions: { length, width: newWidth, height },
              center: { x: data.center.x - shiftY * sin, y: data.center.y + shiftY * cos, z: data.center.z }
            });
          }
        }}
        onEnd={onCommit}
        color="#ef4444"
      />

      {/* -X axis (left side) */}
      <AxisResizeHandle
        position={[-halfX - 1.0, 0, 0]}
        direction="x"
        sign={-1}
        onDrag={(delta) => {
          if (viewType === 'top' || viewType === 'side') {
            const newLength = Math.max(0.1, length - delta);
            const yaw = data.rotation?.yaw ?? 0;
            const cos = Math.cos(yaw);
            const sin = Math.sin(yaw);
            const shiftX = delta / 2;
            onUpdate({
              dimensions: { length: newLength, width, height },
              center: { x: data.center.x + shiftX * cos, y: data.center.y + shiftX * sin, z: data.center.z }
            });
          } else {
            const newWidth = Math.max(0.1, width - delta);
            const yaw = data.rotation?.yaw ?? 0;
            const cos = Math.cos(yaw);
            const sin = Math.sin(yaw);
            const shiftY = -delta / 2;
            onUpdate({
              dimensions: { length, width: newWidth, height },
              center: { x: data.center.x - shiftY * sin, y: data.center.y + shiftY * cos, z: data.center.z }
            });
          }
        }}
        onEnd={onCommit}
        color="#ef4444"
      />

      {/* +Y axis (top side) */}
      <AxisResizeHandle
        position={[0, halfY + 1.0, 0]}
        direction="y"
        sign={1}
        onDrag={(delta) => {
          if (viewType === 'top') {
            const newWidth = Math.max(0.1, width + delta);
            const yaw = data.rotation?.yaw ?? 0;
            const cos = Math.cos(yaw);
            const sin = Math.sin(yaw);
            const shiftY = delta / 2;
            onUpdate({
              dimensions: { length, width: newWidth, height },
              center: { x: data.center.x - shiftY * sin, y: data.center.y + shiftY * cos, z: data.center.z }
            });
          } else {
            const newHeight = Math.max(0.1, height + delta);
            onUpdate({
              dimensions: { length, width, height: newHeight },
              center: { x: data.center.x, y: data.center.y, z: data.center.z + delta / 2 }
            });
          }
        }}
        onEnd={onCommit}
        color="#22c55e"
      />

      {/* -Y axis (bottom side) */}
      <AxisResizeHandle
        position={[0, -halfY - 1.0, 0]}
        direction="y"
        sign={-1}
        onDrag={(delta) => {
          if (viewType === 'top') {
            const newWidth = Math.max(0.1, width - delta);
            const yaw = data.rotation?.yaw ?? 0;
            const cos = Math.cos(yaw);
            const sin = Math.sin(yaw);
            const shiftY = delta / 2;
            onUpdate({
              dimensions: { length, width: newWidth, height },
              center: { x: data.center.x - shiftY * sin, y: data.center.y + shiftY * cos, z: data.center.z }
            });
          } else {
            const newHeight = Math.max(0.1, height - delta);
            onUpdate({
              dimensions: { length, width, height: newHeight },
              center: { x: data.center.x, y: data.center.y, z: data.center.z + delta / 2 }
            });
          }
        }}
        onEnd={onCommit}
        color="#22c55e"
      />

      {/* Rotation Dials */}
      {viewType === 'top' && (
        <RotationDial
          radius={halfX + 2.5}
          color="#ef4444"
          value={data.rotation?.yaw ?? 0}
          onChange={(a) => handleRotate(a, 'yaw')}
          onEnd={onCommit}
        />
      )}
      {viewType === 'side' && (
        <RotationDial
          radius={halfX + 2}
          color="#10b981"
          value={data.rotation?.pitch ?? 0}
          onChange={(a) => handleRotate(a, 'pitch')}
          onEnd={onCommit}
        />
      )}
      {viewType === 'front' && (
        <RotationDial
          radius={Math.max(halfX, halfY) + 2}
          color="#3b82f6"
          value={data.rotation?.roll ?? 0}
          onChange={(a) => handleRotate(-a, 'roll')}
          onEnd={onCommit}
        />
      )}
    </group>
  );
};


interface BoxBottomReferenceLineProps {
  viewType: ViewType;
  boxHeight: number;
  displayCenter: DisplayCenter2D;
  viewExtent?: number;
}

const BoxBottomReferenceLine: React.FC<BoxBottomReferenceLineProps> = ({
  viewType,
  boxHeight,
  displayCenter,
  viewExtent = 10
}) => {
  if (viewType === 'top') return null;

  const bottomZ = -boxHeight / 2;

  const points: [number, number, number][] = [
    [displayCenter.x - viewExtent, displayCenter.y + bottomZ, 0],
    [displayCenter.x + viewExtent, displayCenter.y + bottomZ, 0],
  ];

  return (
    <Line
      points={points}
      color="#f59e0b"
      lineWidth={2}
      dashed
      dashSize={0.2}
      gapSize={0.1}
    />
  );
};

interface GroundPlaneReferenceLineProps {
  viewType: ViewType;
  boxCenter: { x: number; y: number; z: number };
  boxRotation: { yaw: number; pitch: number; roll: number };
  viewOrigin: { x: number; y: number; z: number };
  displayCenter: DisplayCenter2D;
  pointCloud?: PointCloudData;
  detectedGroundPlane?: DetectedGroundPlane;
  isVisible: boolean;
  viewExtent?: number;
}

const GroundPlaneReferenceLine: React.FC<GroundPlaneReferenceLineProps> = ({
  viewType,
  boxCenter,
  boxRotation,
  viewOrigin,
  displayCenter,
  pointCloud,
  detectedGroundPlane,
  isVisible,
  viewExtent = 15,
}) => {
  const localPlane = useMemo(() => {
    if (!pointCloud) return null;
    return detectLocalGroundPlane(pointCloud.positions, viewOrigin.x, viewOrigin.y, 7, {
      distanceThreshold: 0.2,
      maxIterations: 80,
    });
  }, [pointCloud, viewOrigin.x, viewOrigin.y]);

  if (!isVisible || viewType === 'top') return null;

  const plane: PlaneEquation | DetectedGroundPlane | null = localPlane ?? detectedGroundPlane ?? null;
  if (!plane || Math.abs(plane.c) < 1e-6) return null;

  const inverseRotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(boxRotation.roll, boxRotation.pitch, boxRotation.yaw, ROTATION_ORDER)
  ).invert();

  const computeGroundScreenYAtCenter = (): number => {
    const groundZ = -(plane.a * boxCenter.x + plane.b * boxCenter.y + plane.d) / plane.c;
    const groundInBoxLocal = new THREE.Vector3(
      boxCenter.x - viewOrigin.x,
      boxCenter.y - viewOrigin.y,
      groundZ - viewOrigin.z
    ).applyQuaternion(inverseRotation);
    return groundInBoxLocal.z;
  };

  const groundScreenY = computeGroundScreenYAtCenter();

  const points: [number, number, number][] = [
    [displayCenter.x - viewExtent, groundScreenY, 0],
    [displayCenter.x + viewExtent, groundScreenY, 0],
  ];

  return <Line points={points} color="#38bdf8" lineWidth={2} />;
};


const OrthoViewPanel: React.FC<{
  viewType: ViewType,
  pointCloud?: PointCloudData,
  selectedAnnotation: Annotation | null,
  updateAnnotation: (id: string, data: any) => void,
  onActivate?: (view: ViewType) => void,
  isActive?: boolean,
}> = ({ viewType, pointCloud, selectedAnnotation, updateAnnotation, onActivate, isActive = false }) => {

  const [localData, setLocalData] = useState<CuboidData | null>(null);
  const [zoom, setZoom] = useState(40);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [autoFitEnabled, setAutoFitEnabled] = useState(true);
  const [pointVisibility, setPointVisibility] = useState<OrthoPointVisibilitySettings>(DEFAULT_ORTHO_POINT_VISIBILITY);
  const [viewOrigin, setViewOrigin] = useState<{ x: number; y: number; z: number } | null>(null);
  const [orbitQuat, setOrbitQuat] = useState<[number, number, number, number]>([0, 0, 0, 1]);
  const orbitQuaternion = useMemo(
    () => new THREE.Quaternion(orbitQuat[0], orbitQuat[1], orbitQuat[2], orbitQuat[3]),
    [orbitQuat],
  );

  const handleOrbitDelta = useCallback((dx: number, dy: number) => {
    const sensitivity = 0.005;
    setOrbitQuat(prev => {
      const q = new THREE.Quaternion(prev[0], prev[1], prev[2], prev[3]);
      const qH = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), dx * sensitivity);
      const qV = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), dy * sensitivity);
      q.premultiply(qH).premultiply(qV);
      return [q.x, q.y, q.z, q.w];
    });
  }, []);

  const containerRef = useRef<HTMLDivElement>(null);
  const lastAnnotationIdRef = useRef<string | null>(null);
  const isPanning = useRef(false);
  const lastPanPos = useRef({ x: 0, y: 0 });
  const detectedGroundPlane = useEditorStore(state => state.lidarView.detectedGroundPlane);
  const clipBox = useEditorStore(state => state.lidarView.clipBox);

  const calculateFitZoom = useCallback((dims: { length: number; width: number; height: number }, containerWidth: number, containerHeight: number): number => {
    let boxWidth: number, boxHeight: number;
    switch (viewType) {
      case 'top':
        boxWidth = dims.length;
        boxHeight = dims.width;
        break;
      case 'side':
        boxWidth = dims.length;
        boxHeight = dims.height;
        break;
      case 'front':
        boxWidth = dims.width;
        boxHeight = dims.height;
        break;
    }

    const paddedWidth = boxWidth + 8;
    const paddedHeight = boxHeight + 8;

    const zoomX = containerWidth / paddedWidth;
    const zoomY = containerHeight / paddedHeight;

    const fitZoom = Math.min(zoomX, zoomY);

    return Math.max(5, Math.min(fitZoom, 200));
  }, [viewType]);

  useEffect(() => {
    if (selectedAnnotation?.type === 'cuboid') {
      const data = selectedAnnotation.data as CuboidData;
      setLocalData(data);

      const annotationId = selectedAnnotation.id;
      const selectionChanged = annotationId !== lastAnnotationIdRef.current;
      if (selectionChanged) {
        lastAnnotationIdRef.current = annotationId;
        setViewOrigin({ ...data.center });
        setPan({ x: 0, y: 0 });
      }
      if (autoFitEnabled && selectionChanged && data.dimensions) {

        setTimeout(() => {
          if (!containerRef.current) return;
          const rect = containerRef.current.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            const fitZoom = calculateFitZoom(data.dimensions, rect.width, rect.height);
            setZoom(fitZoom);
          }
        }, 50);
      }
    } else {
      setLocalData(null);
      setViewOrigin(null);
      lastAnnotationIdRef.current = null;
    }
  }, [selectedAnnotation, autoFitEnabled, calculateFitZoom]);

  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      if (!autoFitEnabled || !localData?.dimensions) return;

      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          const fitZoom = calculateFitZoom(localData.dimensions, width, height);
          setZoom(fitZoom);
        }
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [autoFitEnabled, localData?.dimensions, calculateFitZoom]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    setAutoFitEnabled(false);
    const zoomFactor = 1.1;
    if (e.deltaY < 0) {
      setZoom(z => Math.min(z * zoomFactor, 200));
    } else {
      setZoom(z => Math.max(z / zoomFactor, 5));
    }
  }, []);

  const handleDoubleClick = useCallback(() => {
    if (!localData?.dimensions || !containerRef.current) return;

    setAutoFitEnabled(true);
    setPan({ x: 0, y: 0 });
    setOrbitQuat([0, 0, 0, 1]);
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      const fitZoom = calculateFitZoom(localData.dimensions, rect.width, rect.height);
      setZoom(fitZoom);
    }
  }, [localData?.dimensions, calculateFitZoom]);

  const handlePanStart = useCallback((e: React.PointerEvent) => {
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      isPanning.current = true;
      lastPanPos.current = { x: e.clientX, y: e.clientY };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    }
  }, []);

  const handlePanMove = useCallback((e: React.PointerEvent) => {
    if (!isPanning.current) return;

    const dx = e.clientX - lastPanPos.current.x;
    const dy = e.clientY - lastPanPos.current.y;
    lastPanPos.current = { x: e.clientX, y: e.clientY };

    setPan(p => ({
      x: p.x - dx / zoom,
      y: p.y + dy / zoom,
    }));
  }, [zoom]);

  const handlePanEnd = useCallback((e: React.PointerEvent) => {
    if (isPanning.current) {
      isPanning.current = false;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  const handleLocalUpdate = (updates: Partial<CuboidData>) => {
    setLocalData(prev => prev ? { ...prev, ...updates } : null);
  };

  const handleCommit = () => {
    if (!localData || !selectedAnnotation) return;
    updateAnnotation(selectedAnnotation.id, { data: localData });
  };

  const fallbackCenter = useMemo(() => ({ x: 0, y: 0, z: 0 }), []);
  const fallbackRotation = useMemo(() => ({ yaw: 0, pitch: 0, roll: 0 }), []);
  const currentCenter = localData?.center ?? fallbackCenter;
  const currentRotation = localData?.rotation ?? fallbackRotation;
  const effectiveViewOrigin = viewOrigin ?? currentCenter;
  const displayCenter = useMemo<DisplayCenter2D>(() => {
    const inverseRotation = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(currentRotation.roll, currentRotation.pitch, currentRotation.yaw, ROTATION_ORDER)
    ).invert();
    const local = new THREE.Vector3(
      currentCenter.x - effectiveViewOrigin.x,
      currentCenter.y - effectiveViewOrigin.y,
      currentCenter.z - effectiveViewOrigin.z
    ).applyQuaternion(inverseRotation);

    switch (viewType) {
      case 'top':
        return { x: local.x, y: local.y };
      case 'side':
        return { x: local.x, y: local.z };
      case 'front':
        return { x: -local.y, y: local.z };
    }
  }, [currentCenter, currentRotation, effectiveViewOrigin.x, effectiveViewOrigin.y, effectiveViewOrigin.z, viewType]);

  if (!localData || !selectedAnnotation) {
    return (
      <div className="w-full h-full bg-black flex items-center justify-center text-gray-500 text-xs border border-gray-800">
        No Selection
      </div>
    );
  }

  const isDepthView = viewType !== 'top';

  return (
    <div
      ref={containerRef}
      className={`w-full h-full bg-black border relative overflow-hidden ${
        isActive ? 'border-blue-500/80' : 'border-gray-800'
      }`}
      style={{ cursor: isPanning.current ? 'grabbing' : 'default' }}
      onWheel={handleWheel}
      onDoubleClick={handleDoubleClick}
      onPointerDown={handlePanStart}
      onPointerMove={handlePanMove}
      onPointerUp={handlePanEnd}
      onPointerLeave={handlePanEnd}
      onContextMenu={handleContextMenu}
      onPointerDownCapture={() => onActivate?.(viewType)}
      onPointerEnter={() => onActivate?.(viewType)}
      onPointerMoveCapture={() => onActivate?.(viewType)}
      onMouseEnter={() => onActivate?.(viewType)}
    >
      <div className="absolute top-1 left-1 text-white text-[10px] font-bold z-10 bg-black/50 px-1 rounded uppercase pointer-events-none">
        {viewType}
      </div>

      {/* Auto-fit indicator */}
      {!autoFitEnabled && (
        <div
          className="absolute top-1 right-1 text-gray-400 text-[9px] z-10 bg-black/50 px-1 rounded cursor-pointer hover:text-white"
          onClick={handleDoubleClick}
          title="Double-click to auto-fit"
        >
          Manual
        </div>
      )}

      {isDepthView && (
        <div
          className="absolute bottom-1 left-1 z-10 rounded bg-black/60 px-2 py-1 text-[9px] text-gray-200"
          onDoubleClick={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
        >
          <div className="mb-1 flex items-center gap-2">
            <span className="text-gray-300">Slice</span>
            <input
              type="range"
              min={MIN_SLICE_THICKNESS}
              max={MAX_SLICE_THICKNESS}
              step={0.1}
              value={pointVisibility.sliceThickness}
              onChange={(e) =>
                setPointVisibility((prev) => ({
                  ...prev,
                  sliceThickness: Number(e.target.value),
                }))
              }
              className="w-20"
            />
            <span className="font-mono text-gray-100">{pointVisibility.sliceThickness.toFixed(1)}m</span>
          </div>
          <label className="mr-2 inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={pointVisibility.focusSlice}
              onChange={(e) =>
                setPointVisibility((prev) => ({
                  ...prev,
                  focusSlice: e.target.checked,
                }))
              }
            />
            Focus
          </label>
          <label className="mr-2 inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={pointVisibility.showContextPoints}
              onChange={(e) =>
                setPointVisibility((prev) => ({
                  ...prev,
                  showContextPoints: e.target.checked,
                }))
              }
            />
            Context
          </label>
          <label className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={pointVisibility.showGroundLine}
              onChange={(e) =>
                setPointVisibility((prev) => ({
                  ...prev,
                  showGroundLine: e.target.checked,
                }))
              }
            />
            Ground
          </label>
        </div>
      )}

      <Canvas>
        <CanvasCleanup />
        {/* Camera position includes pan offset */}
        <OrthographicCamera makeDefault position={[pan.x, pan.y, 10]} zoom={zoom} />

        <GroundPlaneReferenceLine
          viewType={viewType}
          boxCenter={localData.center}
          boxRotation={localData.rotation ?? { yaw: 0, pitch: 0, roll: 0 }}
          viewOrigin={effectiveViewOrigin}
          displayCenter={displayCenter}
          pointCloud={pointCloud}
          detectedGroundPlane={detectedGroundPlane}
          isVisible={pointVisibility.showGroundLine}
          viewExtent={15}
        />

        {/* Box bottom reference line (only in side/front views) */}
        <BoxBottomReferenceLine
          viewType={viewType}
          boxHeight={localData.dimensions.height}
          displayCenter={displayCenter}
          viewExtent={15}
        />

        {pointCloud && (
          <group quaternion={orbitQuaternion}>
            <ProjectedPointCloud
              pointCloud={pointCloud}
              viewOrigin={effectiveViewOrigin}
              boxCenter={localData.center}
              boxDimensions={localData.dimensions}
              boxRotation={localData.rotation ?? { yaw: 0, pitch: 0, roll: 0 }}
              viewType={viewType}
              visibility={pointVisibility}
              clipBox={clipBox}
            />
          </group>
        )}

        <Box2D
          data={localData}
          viewType={viewType}
          displayCenter={displayCenter}
          onUpdate={handleLocalUpdate}
          onCommit={handleCommit}
        />

        {/* Background plane — handles left-click drag orbit (behind all interactive meshes) */}
        <BackgroundOrbitHandler onOrbitDelta={handleOrbitDelta} />
      </Canvas>
    </div>
  );
};

export const OrthographicViews: React.FC<{
  isVisible: boolean,
  pointCloud?: PointCloudData,
  onWidthChange?: (width: number) => void,
  rightOffset?: number,
  onActiveViewChange?: (view: ViewType | null) => void,
  onCollapse?: () => void,
}> = ({ isVisible, pointCloud, onWidthChange, rightOffset = 0, onActiveViewChange, onCollapse }) => {
  const selectedAnnotations = useSelectedAnnotations();
  const updateAnnotation = useEditorStore(state => state.updateAnnotation);
  const selectedAnnotation = selectedAnnotations[0] || null;
  const [activeView, setActiveView] = useState<ViewType | null>(null);

  // Resize logic - start with larger default width (480px for better visibility)
  const [width, setWidth] = useState(480);
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  const stopResizing = useCallback(() => {
    setIsResizing(false);
  }, []);

  const resize = useCallback((e: MouseEvent) => {
    if (isResizing) {
      const newWidth = window.innerWidth - e.clientX;
      // Min width 200px, Max width 50% of screen
      if (newWidth > 200 && newWidth < window.innerWidth * 0.8) {
        setWidth(newWidth);
        onWidthChange?.(newWidth);
      }
    }
  }, [isResizing, onWidthChange]);

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing, resize, stopResizing]);

  useEffect(() => {
    if (!isVisible || !selectedAnnotation || selectedAnnotation.type !== 'cuboid') {
      setActiveView(null);
      onActiveViewChange?.(null);
    }
  }, [isVisible, selectedAnnotation, onActiveViewChange]);

  const handleActivateView = useCallback((view: ViewType) => {
    setActiveView((prev) => {
      if (prev === view) return prev;
      // Defer parent callback to avoid setState during render
      queueMicrotask(() => onActiveViewChange?.(view));
      return view;
    });
  }, [onActiveViewChange]);

  // Keyboard Shortcuts
  useEffect(() => {
    if (!selectedAnnotation || selectedAnnotation.type !== 'cuboid') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only trigger if no input is focused
      if (document.activeElement?.tagName === 'INPUT') return;

      const data = selectedAnnotation.data as CuboidData;
      const rot = data.rotation ?? { yaw: 0, pitch: 0, roll: 0 };
      const dims = data.dimensions;

      const ROT_STEP = (e.shiftKey ? 5 : 1) * (Math.PI / 180); // 1 deg or 5 deg
      const SIZE_STEP = e.shiftKey ? 0.5 : 0.1;

      let handled = false;
      const updates: any = {};

      // Rotation: Shift + Arrows
      if (e.shiftKey) {
        if (e.key === 'ArrowLeft') {
          updates.rotation = { ...rot, yaw: rot.yaw + ROT_STEP };
          handled = true;
        } else if (e.key === 'ArrowRight') {
          updates.rotation = { ...rot, yaw: rot.yaw - ROT_STEP };
          handled = true;
        } else if (e.key === 'ArrowUp') {
          updates.rotation = { ...rot, pitch: rot.pitch + ROT_STEP };
          handled = true;
        } else if (e.key === 'ArrowDown') {
          updates.rotation = { ...rot, pitch: rot.pitch - ROT_STEP };
          handled = true;
        }
      }

      // Resize: Alt + +/-
      if (e.altKey) {
        if (e.key === '=' || e.key === '+') {
          updates.dimensions = {
            length: dims.length + SIZE_STEP,
            width: dims.width + SIZE_STEP,
            height: dims.height + SIZE_STEP
          };
          handled = true;
        } else if (e.key === '-' || e.key === '_') {
          updates.dimensions = {
            length: Math.max(0.1, dims.length - SIZE_STEP),
            width: Math.max(0.1, dims.width - SIZE_STEP),
            height: Math.max(0.1, dims.height - SIZE_STEP)
          };
          handled = true;
        }
      }

      if (handled) {
        e.preventDefault();
        updateAnnotation(selectedAnnotation.id, { data: { ...data, ...updates } });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAnnotation, updateAnnotation]);

  if (!isVisible) return null;

  return (
    <div
      data-tour="ortho-views"
      className="fixed top-12 bottom-0 bg-gray-900 flex flex-col z-20 border-l border-gray-700 shadow-xl"
      style={{ width, right: rightOffset }}
    >
      {/* Resize Handle */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1.5 -ml-0.5 cursor-ew-resize hover:bg-blue-500 transition-colors z-50"
        onMouseDown={startResizing}
      />

      {/* Collapse button - hides the ortho panel without deselecting the box.
          Auto-open still reopens it when another box is selected. */}
      {onCollapse && (
        <button
          onClick={onCollapse}
          title="Hide views (keeps box selected)"
          aria-label="Hide orthographic views"
          className="absolute top-1.5 right-2.5 z-[60] flex items-center gap-1 px-1.5 py-1 rounded-md bg-gray-900/90 border-2 border-amber-500 text-amber-400 hover:text-amber-200 hover:bg-amber-500/20 shadow-lg shadow-amber-500/20 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
          <span className="text-[10px] font-medium leading-none">Hide</span>
        </button>
      )}

      <div className="flex-1 p-1 min-h-0">
        <OrthoViewPanel
          viewType="top"
          pointCloud={pointCloud}
          selectedAnnotation={selectedAnnotation}
          updateAnnotation={updateAnnotation}
          onActivate={handleActivateView}
          isActive={activeView === 'top'}
        />
      </div>
      <div className="flex-1 p-1 min-h-0">
        <OrthoViewPanel
          viewType="side"
          pointCloud={pointCloud}
          selectedAnnotation={selectedAnnotation}
          updateAnnotation={updateAnnotation}
          onActivate={handleActivateView}
          isActive={activeView === 'side'}
        />
      </div>
      <div className="flex-1 p-1 min-h-0">
        <OrthoViewPanel
          viewType="front"
          pointCloud={pointCloud}
          selectedAnnotation={selectedAnnotation}
          updateAnnotation={updateAnnotation}
          onActivate={handleActivateView}
          isActive={activeView === 'front'}
        />
      </div>
    </div>
  );
};

export default OrthographicViews;

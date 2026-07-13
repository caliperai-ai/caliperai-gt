import React, { useRef, useState, useCallback, useMemo } from 'react';
import { useThree, ThreeEvent } from '@react-three/fiber';
import { Html, Edges } from '@react-three/drei';
import * as THREE from 'three';
import type { Annotation, CuboidData } from '@/types';

export interface CuboidMeshProps {
  annotation: Annotation;
  transformedPosition?: [number, number, number];
  transformedYaw?: number;
  isSelected: boolean;
  isHovered: boolean;
  classColor: string;
  className: string;
  trackId?: string;
  isAutoAnnotation: boolean;
  isKeyframe?: boolean;
  isTracked?: boolean;
  isPending?: boolean;
  isLocked?: boolean;
  opacity?: number;
  hasSuggestion?: boolean;
  suggestionSeverity?: 'low' | 'medium' | 'high' | 'critical';
  shiftPressed?: boolean;
  onClick: () => void;
  onDoubleClick?: () => void;
  onHover: (hover: boolean) => void;
  onUpdate?: (updates: Partial<CuboidData>) => void;
  egoTransform?: {
    position: [number, number, number];
    rotation: number;
  };
}

export const CuboidMesh: React.FC<CuboidMeshProps> = ({
  annotation,
  transformedPosition,
  transformedYaw,
  isSelected,
  isHovered,
  classColor,
  className: _className,
  trackId: _trackId,
  isAutoAnnotation: _isAutoAnnotation,
  isKeyframe = false,
  isTracked = false,
  isPending = false,
  isLocked = false,
  opacity: _opacity = 1.0,
  hasSuggestion: _hasSuggestion = false,
  suggestionSeverity: _suggestionSeverity,
  shiftPressed = false,
  onClick,
  onDoubleClick,
  onHover,
  onUpdate,
  egoTransform,
}) => {
  const meshRef = useRef<THREE.Mesh>(null);
  const groupRef = useRef<THREE.Group>(null);
  const { camera, gl, raycaster } = useThree();
  const rawData = annotation.data as CuboidData;

  const storeData = useMemo(() => ({
    center: rawData?.center || { x: 0, y: 0, z: 0 },
    dimensions: rawData?.dimensions || { length: 1, width: 1, height: 1 },
    rotation: rawData?.rotation || { yaw: 0, pitch: 0, roll: 0 },
    confidence: rawData?.confidence ?? 1,
  }), [rawData]);

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ worldPos: THREE.Vector3; annotationCenter: { x: number; y: number; z: number } } | null>(null);

  const arrowGroupRef = useRef<THREE.Group>(null);

  const [localCenter, setLocalCenter] = useState<{ x: number; y: number; z: number } | null>(null);

  const data = useMemo(() => ({
    ...storeData,
    center: localCenter ?? storeData.center,
  }), [storeData, localCenter]);

  const lastStoreCenterRef = useRef(storeData.center);
  if (!isDragging && storeData.center !== lastStoreCenterRef.current) {
    lastStoreCenterRef.current = storeData.center;
    if (localCenter !== null) {
      setLocalCenter(null);
    }
  }

  const [_showDetails, _setShowDetails] = useState(false);

  const position = transformedPosition || [data.center.x, data.center.y, data.center.z];
  const yaw = transformedYaw !== undefined ? transformedYaw : (data.rotation?.yaw || 0);

  const rotationData = data.rotation || { yaw: 0, pitch: 0, roll: 0 };
  const rotation = useMemo(() => {
    return new THREE.Euler(
      rotationData.pitch || 0,
      rotationData.roll || 0,
      yaw,
      'ZYX'
    );
  }, [rotationData.pitch, rotationData.roll, yaw]);

  const color = isSelected ? '#ffffff' : isHovered ? '#60a5fa' : classColor;

  const trackColor = '#a855f7';
  const fillColor = classColor;
  const keyframeColor = '#eab308';

  const screenToWorld = useCallback((clientX: number, clientY: number, z: number): THREE.Vector3 | null => {
    const rect = gl.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );

    raycaster.setFromCamera(mouse, camera);

    const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -z);
    const intersection = new THREE.Vector3();

    if (raycaster.ray.intersectPlane(plane, intersection)) {
      return intersection;
    }
    return null;
  }, [camera, gl, raycaster]);

  const handlePointerDown = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (e.button === 2) return;
    if (!onUpdate) return;

    e.stopPropagation();

    if (!isSelected) {
      onClick();
    }

    setIsDragging(true);

    const worldPos = screenToWorld(e.clientX, e.clientY, data.center.z);
    if (worldPos) {
      dragStartRef.current = {
        worldPos: worldPos.clone(),
        annotationCenter: { ...data.center }
      };
    }

    (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
  }, [isSelected, onUpdate, onClick, screenToWorld, data.center]);

  const handlePointerMove = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (!isDragging || !dragStartRef.current || !onUpdate) return;

    e.stopPropagation();

    const currentWorldPos = screenToWorld(e.clientX, e.clientY, storeData.center.z);
    if (!currentWorldPos) return;

    const { worldPos: startWorldPos, annotationCenter: startCenter } = dragStartRef.current;

    const deltaX = currentWorldPos.x - startWorldPos.x;
    const deltaY = currentWorldPos.y - startWorldPos.y;

    let worldDeltaX = deltaX;
    let worldDeltaY = deltaY;

    if (egoTransform) {
      const egoYaw = egoTransform.rotation;
      const cosYaw = Math.cos(egoYaw);
      const sinYaw = Math.sin(egoYaw);

      worldDeltaX = deltaX * cosYaw - deltaY * sinYaw;
      worldDeltaY = deltaX * sinYaw + deltaY * cosYaw;
    }

    setLocalCenter({
      x: startCenter.x + worldDeltaX,
      y: startCenter.y + worldDeltaY,
      z: startCenter.z,
    });
  }, [isDragging, onUpdate, screenToWorld, storeData.center.z, egoTransform]);

  const handlePointerUp = useCallback((e: ThreeEvent<PointerEvent>) => {
    if (isDragging) {
      e.stopPropagation();

      if (localCenter && onUpdate) {
        onUpdate({ center: localCenter });
      }

      setIsDragging(false);
      setLocalCenter(null);
      dragStartRef.current = null;
      (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId);
    }
  }, [isDragging, localCenter, onUpdate]);

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={rotation}
    >
      {/* Visual box with edges */}
      <mesh ref={meshRef}>
        <boxGeometry args={[
          data.dimensions.length,
          data.dimensions.width,
          data.dimensions.height,
        ]} />
        <meshBasicMaterial
          color={fillColor}
          transparent
          opacity={isLocked ? 0.08 : isSelected ? 0.3 : (isTracked ? 0.15 : 0.1)}
          depthWrite={false}
        />
        <Edges
          scale={1}
          threshold={15}
          color={isLocked ? '#00cc44' : isPending ? '#facc15' : color}
          lineWidth={isPending ? 2 : isKeyframe ? 2 : 1}
        />
      </mesh>

      {/* Invisible interaction layer - only intercepts pointer events when shift is pressed for dragging */}
      <mesh
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        onDoubleClick={(e) => {
          e.stopPropagation();
          console.log('[CuboidMesh] Double-click detected on box!');
          onDoubleClick?.();
        }}
        onContextMenu={(e) => {
          e.stopPropagation();
        }}
        onPointerOver={() => onHover(true)}
        onPointerOut={() => { if (!isDragging) onHover(false); }}
        onPointerDown={shiftPressed ? handlePointerDown : undefined}
        onPointerMove={isDragging ? handlePointerMove : undefined}
        onPointerUp={isDragging ? handlePointerUp : undefined}
        onPointerCancel={isDragging ? handlePointerUp : undefined}
      >
        <boxGeometry args={[
          data.dimensions.length,
          data.dimensions.width,
          data.dimensions.height,
        ]} />
        <meshBasicMaterial visible={false} />
      </mesh>

      {/* Pending indicator - yellow badge */}
      {isPending && (
        <Html
          position={[0, 0, data.dimensions.height / 2 + 0.3]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div
            className="px-2 py-0.5 rounded text-[9px] font-bold whitespace-nowrap animate-pulse"
            style={{
              backgroundColor: '#facc15',
              color: '#1a1a2e',
              border: '1px dashed #fff',
            }}
          >
            PENDING - Click Save
          </div>
        </Html>
      )}

      {/* Locked indicator - green lock badge for QA-approved annotations */}
      {isLocked && isSelected && (
        <Html
          position={[0, 0, data.dimensions.height / 2 + 0.3]}
          center
          style={{ pointerEvents: 'none' }}
        >
          <div
            className="px-2 py-0.5 rounded text-[9px] font-medium whitespace-nowrap"
            style={{
              backgroundColor: 'rgba(0, 204, 68, 0.9)',
              color: '#fff',
            }}
          >
            🔒 QA Approved
          </div>
        </Html>
      )}

      {/* Track ID label removed - was obstructing point cloud view */}

      {/* AUTO tag removed - was distracting */}

      {/* Track icon - link symbol on top of tracked objects */}
      {isTracked && !isPending && (
        <group position={[0, 0, data.dimensions.height / 2 + 0.3]}>
          {/* Link chain icon made from two interlocking loops */}
          <mesh>
            <torusGeometry args={[0.2, 0.05, 8, 16]} />
            <meshBasicMaterial color={trackColor} />
          </mesh>
          <mesh position={[0.25, 0, 0]}>
            <torusGeometry args={[0.2, 0.05, 8, 16]} />
            <meshBasicMaterial color={trackColor} />
          </mesh>
        </group>
      )}

      {/* Keyframe indicator - diamond shape on top corner */}
      {isKeyframe && (
        <group position={[data.dimensions.length / 2, data.dimensions.width / 2, data.dimensions.height / 2 + 0.2]}>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <boxGeometry args={[0.25, 0.25, 0.08]} />
            <meshBasicMaterial color={keyframeColor} />
          </mesh>
        </group>
      )}

      {/* Direction indicator - prominent arrow starting inside box and extending outward */}
      <group ref={arrowGroupRef}>
        {/* Arrow shaft - starts from center and extends beyond front edge */}
        <mesh position={[data.dimensions.length / 3, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.06, 0.06, data.dimensions.length * 0.66, 8]} />
          <meshBasicMaterial color={isSelected ? '#ffffff' : '#ff0000'} />
        </mesh>
        {/* Arrow head - larger cone beyond front edge */}
        <mesh position={[data.dimensions.length * 0.66 + 0.15, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
          <coneGeometry args={[0.18, 0.4, 8]} />
          <meshBasicMaterial color={isSelected ? '#ffffff' : '#ff0000'} />
        </mesh>
      </group>

      {/* Selection highlight ring - pulsing glow when selected */}
      {isSelected && (
        <mesh scale={[1.08, 1.08, 1.08]}>
          <boxGeometry args={[data.dimensions.length, data.dimensions.width, data.dimensions.height]} />
          <meshBasicMaterial
            color="#3b82f6"
            transparent
            opacity={0.4}
            wireframe
          />
        </mesh>
      )}

      {/* Details Popup removed - use Properties Panel instead */}
    </group>
  );
};

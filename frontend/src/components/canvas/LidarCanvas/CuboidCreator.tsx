import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useThree, ThreeEvent } from '@react-three/fiber';
import { Edges, Html } from '@react-three/drei';
import * as THREE from 'three';
import { useEditorStore } from '@/store/editorStore';
import { useIsQAMode } from '@/store/qaStore';
import type { CuboidData, Point3D } from '@/types';
import { getDefaultCuboidDimensions } from '@/utils/cuboidDimensions';

export interface CuboidCreatorProps {
  onComplete: (cuboid: CuboidData, isTrackMode: boolean, classId: string) => void;
  onDrawingChange?: (isDrawing: boolean) => void;
}

export const CuboidCreator: React.FC<CuboidCreatorProps> = ({ onComplete, onDrawingChange }) => {
  const [isDrawing, setIsDrawing] = useState(false);
  const [currentPoint, setCurrentPoint] = useState<Point3D | null>(null);
  const [isSteerMode, setIsSteerMode] = useState(false);

  const lockedYawRef    = useRef<number>(0);
  const steerAnchorRef  = useRef<Point3D | null>(null);
  const isSteerModeRef  = useRef<boolean>(false);

  const { activeTool, taxonomy, activeClassId, setActiveClass, lidarView, setBoxPlacementActive } = useEditorStore();
  const isQAMode = useIsQAMode();
  const { raycaster } = useThree();

  const detectedGroundPlane = lidarView.detectedGroundPlane;

  const isTrackTool = activeTool === 'track';
  const creatorColor = isTrackTool ? '#a855f7' : '#3b82f6';

  const setDrawingState = useCallback((drawing: boolean) => {
    setIsDrawing(drawing);
    onDrawingChange?.(drawing);
    if (activeTool === 'track' || activeTool === 'cuboid') {
      setBoxPlacementActive(drawing);
    }
    if (!drawing) {
      isSteerModeRef.current = false;
      setIsSteerMode(false);
      steerAnchorRef.current = null;
    }
  }, [onDrawingChange, activeTool, setBoxPlacementActive]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isDrawing) {
        setDrawingState(false);
        setCurrentPoint(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isDrawing, setDrawingState]);

  const getGroundZAtPosition = useCallback((x: number, y: number): number => {
    if (detectedGroundPlane && Math.abs(detectedGroundPlane.c) > 0.001) {
      return -(detectedGroundPlane.a * x + detectedGroundPlane.b * y + detectedGroundPlane.d) / detectedGroundPlane.c;
    }
    return -1.8;
  }, [detectedGroundPlane]);

  const groundZ = detectedGroundPlane
    ? -(detectedGroundPlane.d / detectedGroundPlane.c)
    : -1.8;
  const groundPlane = useMemo(() => new THREE.Plane(new THREE.Vector3(0, 0, 1), -groundZ), [groundZ]);

  const getGroundPoint = useCallback((): Point3D | null => {
    const intersection = new THREE.Vector3();
    const result = raycaster.ray.intersectPlane(groundPlane, intersection);
    if (result) {
      const accurateZ = getGroundZAtPosition(intersection.x, intersection.y);
      return { x: intersection.x, y: intersection.y, z: accurateZ };
    }
    return null;
  }, [raycaster, groundPlane, getGroundZAtPosition]);

  const createCuboidWithClass = useCallback((classId: string, center: Point3D, yaw: number) => {
    const classDef = taxonomy?.classes?.find(c => c.id === classId);
    const [length, width, height] = getDefaultCuboidDimensions(classId, taxonomy, classDef);

    const cuboid: CuboidData = {
      center: {
        x: center.x,
        y: center.y,
        z: center.z + height / 2,
      },
      dimensions: { length, width, height },
      rotation: { yaw, pitch: 0, roll: 0 },
      confidence: 1.0,
    };

    if (activeClassId !== classId) {
      setActiveClass(classId);
    }

    onComplete(cuboid, isTrackTool, classId);
  }, [taxonomy, activeClassId, setActiveClass, onComplete, isTrackTool]);

  const isSingleClickClass = useMemo(() => {
    if (!activeClassId) return false;
    const classDef = taxonomy?.classes?.find(c => c.id === activeClassId);
    return classDef?.single_click_placement === true;
  }, [activeClassId, taxonomy]);

  const handlePointerDown = (event: ThreeEvent<PointerEvent>) => {
    if (isQAMode) return;

    if (activeTool !== 'cuboid' && activeTool !== 'track') return;

    if (!event.shiftKey) return;

    if (!activeClassId) {
      console.warn('[CuboidCreator] Please select a class before drawing');
      return;
    }

    const point = getGroundPoint();
    if (point) {
      event.stopPropagation();

      if (isSingleClickClass) {
        createCuboidWithClass(activeClassId, point, 0);
        return;
      }

      lockedYawRef.current   = 0;
      steerAnchorRef.current = point;
      isSteerModeRef.current = true;
      setIsSteerMode(true);
      setDrawingState(true);
      setCurrentPoint(point);
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    }
  };

  const handlePointerMove = (event: ThreeEvent<PointerEvent>) => {
    if (!isDrawing) return;
    event.stopPropagation();
    const point = getGroundPoint();
    if (!point) return;

    const shiftHeld = event.shiftKey;

    if (shiftHeld) {
      if (!isSteerModeRef.current) {
        steerAnchorRef.current = point;
        isSteerModeRef.current = true;
        setIsSteerMode(true);
      }
      if (steerAnchorRef.current) {
        const dx = point.x - steerAnchorRef.current.x;
        const dy = point.y - steerAnchorRef.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > 0.08) {
          lockedYawRef.current = Math.atan2(dy, dx);
        }
      }
    } else {
      if (isSteerModeRef.current) {
        isSteerModeRef.current = false;
        setIsSteerMode(false);
      }
    }

    setCurrentPoint(point);
  };

  const handlePointerUp = (event: ThreeEvent<PointerEvent>) => {
    if (isDrawing && currentPoint && activeClassId) {
      event.stopPropagation();
      (event.target as HTMLElement).releasePointerCapture(event.pointerId);

      createCuboidWithClass(activeClassId, currentPoint, lockedYawRef.current);
    }
    setDrawingState(false);
    setCurrentPoint(null);
  };

  const previewDims = useMemo(() => {
    if (activeClassId) {
      const classDef = taxonomy?.classes?.find(c => c.id === activeClassId);
      return getDefaultCuboidDimensions(activeClassId, taxonomy, classDef);
    }
    return getDefaultCuboidDimensions();
  }, [activeClassId, taxonomy]);

  return (
    <group>
      {/* Large invisible plane at ground level for interaction */}
      <mesh
        visible={true}
        position={[0, 0, groundZ]}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        raycast={THREE.Mesh.prototype.raycast}
      >
        <planeGeometry args={[500, 500]} />
        <meshBasicMaterial
          transparent
          opacity={isDrawing ? 0.1 : 0}
          color="#3b82f6"
          depthWrite={false}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Visual Feedback during drawing - show preview with class dimensions */}
      {isDrawing && currentPoint && (() => {
        const groundZVal = currentPoint.z;
        const edgeColor = isSteerMode ? '#f59e0b' : '#22c55e';

        return (
          <group>
            {/* Box preview + direction arrow — centered on cursor */}
            <group
              position={[currentPoint.x, currentPoint.y, groundZVal + previewDims[2] / 2]}
              rotation={[0, 0, lockedYawRef.current]}
            >
              {/* Box */}
              <mesh>
                <boxGeometry args={[previewDims[0], previewDims[1], previewDims[2]]} />
                <meshBasicMaterial color={creatorColor} transparent opacity={0.5} />
                <Edges color={edgeColor} lineWidth={isTrackTool ? 2 : 1.5} />
              </mesh>

              {/* Direction arrow — points in local +X (front) */}
              <mesh position={[previewDims[0] / 3, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.06, 0.06, previewDims[0] * 0.66, 8]} />
                <meshBasicMaterial color="#ffffff" />
              </mesh>
              <mesh position={[previewDims[0] * 0.66 + 0.15, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
                <coneGeometry args={[0.18, 0.4, 8]} />
                <meshBasicMaterial color="#ffffff" />
              </mesh>
            </group>

            {/* Dimension label — front-right top corner */}
            <Html
              position={[
                currentPoint.x + previewDims[0] / 2,
                currentPoint.y + previewDims[1] / 2,
                groundZVal + previewDims[2] + 0.3,
              ]}
            >
              <div className="bg-black/80 text-white text-xs px-2 py-1 rounded whitespace-nowrap">
                {previewDims[0].toFixed(1)} × {previewDims[1].toFixed(1)} × {previewDims[2].toFixed(1)}m
              </div>
            </Html>

            {/* Mode hint */}
            <Html position={[currentPoint.x, currentPoint.y, groundZVal + previewDims[2] + 0.9]}>
              <div className={`text-[10px] px-1.5 py-0.5 rounded font-medium whitespace-nowrap ${isSteerMode ? 'bg-amber-500/80 text-white' : 'bg-green-600/80 text-white'}`}>
                {isSteerMode ? '⟳ STEERING' : '↔ SLIDING'}
              </div>
            </Html>

            {/* Track mode indicator */}
            {isTrackTool && (
              <group position={[currentPoint.x, currentPoint.y, groundZVal + previewDims[2] + 0.3]}>
                <mesh>
                  <torusGeometry args={[0.3, 0.08, 8, 16]} />
                  <meshBasicMaterial color="#a855f7" />
                </mesh>
                <mesh position={[0.4, 0, 0]}>
                  <torusGeometry args={[0.3, 0.08, 8, 16]} />
                  <meshBasicMaterial color="#a855f7" />
                </mesh>
              </group>
            )}
          </group>
        );
      })()}
    </group>
  );
};

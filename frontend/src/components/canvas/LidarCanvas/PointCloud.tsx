import React, { useRef, useMemo, useEffect, useState } from 'react';
import * as THREE from 'three';
import { useEditorStore } from '@/store/editorStore';
import type { PointCloudData, CameraCalibration } from '@/types';
import { pointCloudVertexShader, pointCloudFragmentShader } from './shaders';
import { generateFrustumMask } from './frustumFilter';
import { detectGroundPlane } from '@/utils/groundPlaneDetection';
import { computeHeightAboveGround } from '@/utils/localGroundEstimation';

export interface PointCloudProps {
  data: PointCloudData;
  classColors: Record<number, string>;
  activeCameraCalib?: CameraCalibration;
  imageWidth?: number;
  imageHeight?: number;
  selectedIndices?: Set<number>;
}

const getResolutionScale = (): number => {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  const referencePixels = 1920 * 1080;
  const currentPixels = width * height;

  const resolutionRatio = Math.sqrt(currentPixels / referencePixels);

  const dprFactor = 1 / Math.sqrt(dpr);

  return Math.max(0.5, Math.min(1.5, resolutionRatio * dprFactor));
};

export const PointCloud: React.FC<PointCloudProps> = ({
  data,
  classColors,
  activeCameraCalib,
  imageWidth,
  imageHeight,
  selectedIndices,
}) => {
  const pointsRef = useRef<THREE.Points>(null);
  const { lidarView } = useEditorStore();

  const [resolutionScale, setResolutionScale] = useState(getResolutionScale);

  useEffect(() => {
    const handleResize = () => {
      setResolutionScale(getResolutionScale());
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isCameraView = lidarView.cameraView.isActive;
  const basePointSize = isCameraView
    ? lidarView.pointSize * 40
    : lidarView.pointSize * 150;

  const effectivePointSize = basePointSize * resolutionScale;

  const frustumMask = useMemo(() => {
    if (!activeCameraCalib || !isCameraView) {
      return new Float32Array(data.pointCount);
    }
    return generateFrustumMask(data, activeCameraCalib, imageWidth, imageHeight);
  }, [data, activeCameraCalib, imageWidth, imageHeight, isCameraView]);

  const selectionMask = useMemo(() => {
    const mask = new Float32Array(data.pointCount);
    if (selectedIndices && selectedIndices.size > 0) {
      selectedIndices.forEach(idx => {
        if (idx >= 0 && idx < data.pointCount) {
          mask[idx] = 1.0;
        }
      });
    }
    return mask;
  }, [data.pointCount, selectedIndices]);

  const showGround = lidarView.groundPlane?.enabled ?? true;
  const groundDistanceThreshold = lidarView.groundPlane?.distanceThreshold ?? 0.15;
  const groundSamplePercent = lidarView.groundPlane?.samplePercent ?? 30;
  const [groundMask, setGroundMask] = useState<Float32Array>(
    () => new Float32Array(data.pointCount)
  );

  useEffect(() => {
    if (!showGround) {
      setGroundMask(new Float32Array(data.pointCount));
      return;
    }

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const result = detectGroundPlane(data.positions, {
        maxIterations: 100,
        distanceThreshold: groundDistanceThreshold,
        sampleFromLowestPercent: groundSamplePercent,
      });
      if (cancelled) return;

      if (result?.plane) {
        useEditorStore.getState().setLidarView({
          detectedGroundPlane: {
            a: result.plane.a,
            b: result.plane.b,
            c: result.plane.c,
            d: result.plane.d,
          },
        });
      }
      setGroundMask(result?.groundMask ?? new Float32Array(data.pointCount));
    };

    setGroundMask(new Float32Array(data.pointCount));

    const idle = (window as any).requestIdleCallback;
    const cancelIdle = (window as any).cancelIdleCallback;
    let handle: number;
    if (typeof idle === 'function') {
      handle = idle(run, { timeout: 1000 });
      return () => {
        cancelled = true;
        if (typeof cancelIdle === 'function') cancelIdle(handle);
      };
    }
    handle = window.setTimeout(run, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [data.positions, data.pointCount, showGround, groundDistanceThreshold, groundSamplePercent]);

  const [heightAboveGround, setHeightAboveGround] = useState<Float32Array>(
    () => new Float32Array(data.pointCount)
  );

  useEffect(() => {
    if (lidarView.colorMode !== 'height_above_ground') {
      setHeightAboveGround(new Float32Array(data.pointCount));
      return;
    }

    let cancelled = false;
    const run = () => {
      if (cancelled) return;
      const result = computeHeightAboveGround(data.positions, {
        cellSize: 2.0,
        groundPercentile: 10,
        maxGroundHeight: 5.0,
      });
      if (!cancelled) setHeightAboveGround(result);
    };

    setHeightAboveGround(new Float32Array(data.pointCount));

    const idle = (window as any).requestIdleCallback;
    const cancelIdle = (window as any).cancelIdleCallback;
    let handle: number;
    if (typeof idle === 'function') {
      handle = idle(run, { timeout: 1000 });
      return () => {
        cancelled = true;
        if (typeof cancelIdle === 'function') cancelIdle(handle);
      };
    }
    handle = window.setTimeout(run, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [data.positions, data.pointCount, lidarView.colorMode]);

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));

    if (data.intensities) {
      geom.setAttribute('intensity', new THREE.BufferAttribute(data.intensities, 1));
    } else {
      geom.setAttribute('intensity', new THREE.BufferAttribute(
        new Float32Array(data.pointCount).fill(0.5), 1
      ));
    }

    if (data.labels) {
      geom.setAttribute('label', new THREE.BufferAttribute(
        new Float32Array(data.labels), 1
      ));
    } else {
      geom.setAttribute('label', new THREE.BufferAttribute(
        new Float32Array(data.pointCount).fill(-1), 1
      ));
    }

    geom.setAttribute('inFrustum', new THREE.BufferAttribute(frustumMask, 1));

    geom.setAttribute('isGround', new THREE.BufferAttribute(groundMask, 1));

    geom.setAttribute('isSelected', new THREE.BufferAttribute(selectionMask, 1));

    geom.setAttribute('heightAboveGround', new THREE.BufferAttribute(heightAboveGround, 1));

    geom.computeBoundingBox();
    return geom;
  }, [data, frustumMask, groundMask, selectionMask, heightAboveGround]);

  const material = useMemo(() => {
    const colorArray: THREE.Vector3[] = [];
    for (let i = 0; i < 32; i++) {
      const hex = classColors[i] || '#808080';
      const color = new THREE.Color(hex);
      colorArray.push(new THREE.Vector3(color.r, color.g, color.b));
    }

    const colorModeMap: Record<string, number> = {
      'intensity': 0,
      'height': 1,
      'class': 2,
      'height_above_ground': 3,
    };

    const frustumBoost = isCameraView && activeCameraCalib ? 2.5 : 1.0;

    const groundColor = new THREE.Vector3(0.92, 0.92, 0.90);
    const showGroundPlane = lidarView.groundPlane?.enabled ?? true;

    const selectedColor = new THREE.Vector3(0.0, 1.0, 1.0);

    const cb = lidarView.clipBox;
    const useClipBox = cb?.enabled ?? false;

    return new THREE.ShaderMaterial({
      vertexShader: pointCloudVertexShader,
      fragmentShader: pointCloudFragmentShader,
      uniforms: {
        pointSize: { value: effectivePointSize },
        frustumSizeBoost: { value: frustumBoost },
        colorMode: { value: colorModeMap[lidarView.colorMode] },
        classColors: { value: colorArray },
        minHeight: { value: cb?.zMin ?? -5 },
        maxHeight: { value: cb?.zMax ?? 10 },
        maxAboveGround: { value: 5.0 },
        focusBand: { value: 3.0 },
        groundColor: { value: groundColor },
        showGroundPlane: { value: showGroundPlane },
        selectedColor: { value: selectedColor },
        useClipBox: { value: useClipBox },
        clipXMin: { value: cb?.xMin ?? -50 },
        clipXMax: { value: cb?.xMax ?? 50 },
        clipYMin: { value: cb?.yMin ?? -50 },
        clipYMax: { value: cb?.yMax ?? 50 },
        clipZMin: { value: cb?.zMin ?? -5 },
        clipZMax: { value: cb?.zMax ?? 10 },
      },
      transparent: false,
    });
  }, [classColors, lidarView.pointSize, lidarView.colorMode, lidarView.groundPlane?.enabled, lidarView.clipBox, effectivePointSize, isCameraView, activeCameraCalib, resolutionScale]);

  const selectedGeometry = useMemo(() => {
    if (!selectedIndices || selectedIndices.size === 0) return null;

    const selectedPositions: number[] = [];
    const selectedIntens: number[] = [];

    selectedIndices.forEach(idx => {
      if (idx >= 0 && idx < data.pointCount) {
        const i3 = idx * 3;
        selectedPositions.push(data.positions[i3], data.positions[i3 + 1], data.positions[i3 + 2]);
        selectedIntens.push(data.intensities ? data.intensities[idx] : 0.5);
      }
    });

    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(selectedPositions), 3));
    geom.setAttribute('intensity', new THREE.BufferAttribute(new Float32Array(selectedIntens), 1));
    geom.setAttribute('label', new THREE.BufferAttribute(new Float32Array(selectedPositions.length / 3).fill(-1), 1));
    geom.setAttribute('inFrustum', new THREE.BufferAttribute(new Float32Array(selectedPositions.length / 3).fill(0), 1));
    geom.setAttribute('isGround', new THREE.BufferAttribute(new Float32Array(selectedPositions.length / 3).fill(0), 1));
    geom.setAttribute('isSelected', new THREE.BufferAttribute(new Float32Array(selectedPositions.length / 3).fill(1), 1));
    geom.setAttribute('heightAboveGround', new THREE.BufferAttribute(new Float32Array(selectedPositions.length / 3).fill(0), 1));
    return geom;
  }, [selectedIndices, data.positions, data.intensities, data.pointCount]);

  const selectedMaterial = useMemo(() => {
    const selectedColor = new THREE.Vector3(0.0, 1.0, 1.0);
    const colorArray: THREE.Vector3[] = [];
    for (let i = 0; i < 32; i++) {
      colorArray.push(new THREE.Vector3(0.5, 0.5, 0.5));
    }

    return new THREE.ShaderMaterial({
      vertexShader: pointCloudVertexShader,
      fragmentShader: pointCloudFragmentShader,
      uniforms: {
        pointSize: { value: effectivePointSize },
        frustumSizeBoost: { value: 1.0 },
        colorMode: { value: 0 },
        classColors: { value: colorArray },
        minHeight: { value: -3 },
        maxHeight: { value: 5 },
        maxAboveGround: { value: 5.0 },
        focusBand: { value: 3.0 },
        groundColor: { value: new THREE.Vector3(1, 1, 1) },
        showGroundPlane: { value: false },
        selectedColor: { value: selectedColor },
        useClipBox: { value: false },
        clipXMin: { value: -50 },
        clipXMax: { value: 50 },
        clipYMin: { value: -50 },
        clipYMax: { value: 50 },
        clipZMin: { value: -5 },
        clipZMax: { value: 10 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
  }, [effectivePointSize]);

  return (
    <>
      <points ref={pointsRef} geometry={geometry} material={material} />
      {selectedGeometry && (
        <points geometry={selectedGeometry} material={selectedMaterial} renderOrder={999} />
      )}
    </>
  );
};

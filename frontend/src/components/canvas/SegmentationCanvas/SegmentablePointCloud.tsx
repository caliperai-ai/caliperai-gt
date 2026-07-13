import React, { useRef, useMemo, useEffect, useCallback } from 'react';
import * as THREE from 'three';
import { useThree, useFrame, ThreeEvent } from '@react-three/fiber';
import { useSegmentationStore, useCurrentFrameLabels, useCurrentFrameInstanceIds } from '@/store/segmentationStore';
import { useEditorStore } from '@/store/editorStore';
import type { PointCloudData } from '@/types';


const segmentationVertexShader = `
  attribute float label;
  attribute float isSelected;
  attribute float isHovered;
  attribute float isHidden;
  attribute float intensity;
  attribute vec3  pointColor;        // Per-point RGB in [0,1] (file color), or fallback gray

  varying float vLabel;
  varying float vHeight;
  varying float vIsSelected;
  varying float vIsHovered;
  varying float vIsHidden;
  varying float vIntensity;
  varying vec3  vPointColor;

  uniform float pointSize;         // Base size in pixels (already DPI-adjusted)
  uniform float selectionSizeBoost;

  // Clip box uniforms
  uniform bool  useClipBox;
  uniform float clipXMin;
  uniform float clipXMax;
  uniform float clipYMin;
  uniform float clipYMax;
  uniform float clipZMin;
  uniform float clipZMax;

  varying float vClipped;

  void main() {
    // Clip box test
    if (useClipBox) {
      vClipped = (position.x < clipXMin || position.x > clipXMax ||
                  position.y < clipYMin || position.y > clipYMax ||
                  position.z < clipZMin || position.z > clipZMax) ? 1.0 : 0.0;
    } else {
      vClipped = 0.0;
    }
    vLabel = label;
    vHeight = position.z;
    vIsSelected = isSelected;
    vIsHovered = isHovered;
    vIsHidden = isHidden;
    vIntensity = intensity;
    vPointColor = pointColor;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);

    // Simple perspective attenuation: closer = bigger
    float dist = max(-mvPosition.z, 1.0);
    float size = pointSize * (80.0 / dist);

    float sizeMultiplier = 1.0;
    if (isSelected > 0.5) sizeMultiplier = selectionSizeBoost;
    if (isHovered > 0.5) sizeMultiplier = max(sizeMultiplier, 1.8);

    // Hidden points get size 0
    if (isHidden > 0.5) {
      gl_PointSize = 0.0;
    } else {
      gl_PointSize = clamp(size * sizeMultiplier, 1.0, 64.0);
    }
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const segmentationFragmentShader = `
  varying float vLabel;
  varying float vHeight;
  varying float vIsSelected;
  varying float vIsHovered;
  varying float vIsHidden;
  varying float vIntensity;
  varying vec3  vPointColor;
  varying float vClipped;

  uniform vec3 classColors[64];       // Support up to 64 classes
  uniform int classCount;
  uniform vec3 selectionColor;        // Color for selected points
  uniform vec3 hoverColor;            // Color for hovered points
  uniform vec3 unlabeledColor;        // Color for unlabeled points
  uniform float labelOpacity;         // Opacity for labeled points
  uniform float unlabeledOpacity;     // Opacity for unlabeled points
  uniform bool dimUnlabeled;          // Whether to dim unlabeled points
  uniform float minHeight;
  uniform float maxHeight;
  uniform int colorMode;              // 0: none (gray), 1: height, 2: intensity, 3: rgb (file)

  // Height-based color gradient with log scale for better discrimination
  // Log scale gives more color range at lower heights (ground, veg, vehicles)
  vec3 getHeightColor(float height) {
    float linear = clamp((height - minHeight) / max(maxHeight - minHeight, 0.001), 0.0, 1.0);
    // Invert: ground (low height) = warm colors, sky = cool
    // Log scale: log(1 + t*9)/log(10) – compresses top, expands bottom
    float t = log(1.0 + linear * 9.0) / log(10.0);

    vec3 color;
    if (t < 0.25) {
      color = mix(vec3(0.05, 0.05, 0.5), vec3(0.1, 0.5, 1.0), t * 4.0);      // deep blue → sky blue
    } else if (t < 0.5) {
      color = mix(vec3(0.1, 0.5, 1.0), vec3(0.1, 0.85, 0.4), (t - 0.25) * 4.0); // sky blue → green
    } else if (t < 0.75) {
      color = mix(vec3(0.1, 0.85, 0.4), vec3(1.0, 0.85, 0.0), (t - 0.5) * 4.0);  // green → yellow
    } else {
      color = mix(vec3(1.0, 0.85, 0.0), vec3(1.0, 0.1, 0.1), (t - 0.75) * 4.0);  // yellow → red
    }
    return color;
  }

  // Intensity-based color with log scale (more detail in low-reflectivity range)
  // Low = dark purple (asphalt), high = bright yellow (road markings, reflectors)
  vec3 getIntensityColor(float intensity) {
    float lin = clamp(intensity, 0.0, 1.0);
    // Log scale: pulls dim points apart, compresses bright cluster
    float t = log(1.0 + lin * 9.0) / log(10.0);

    vec3 color;
    if (t < 0.2) {
      color = mix(vec3(0.05, 0.0, 0.15), vec3(0.25, 0.0, 0.5), t * 5.0);
    } else if (t < 0.4) {
      color = mix(vec3(0.25, 0.0, 0.5), vec3(0.05, 0.3, 0.75), (t - 0.2) * 5.0);
    } else if (t < 0.6) {
      color = mix(vec3(0.05, 0.3, 0.75), vec3(0.0, 0.75, 0.65), (t - 0.4) * 5.0);
    } else if (t < 0.8) {
      color = mix(vec3(0.0, 0.75, 0.65), vec3(0.55, 0.95, 0.1), (t - 0.6) * 5.0);
    } else {
      color = mix(vec3(0.55, 0.95, 0.1), vec3(1.0, 1.0, 0.0), (t - 0.8) * 5.0);
    }
    return color;
  }

  void main() {
    // Discard clipped points
    if (vClipped > 0.5) discard;

    // Discard hidden points
    if (vIsHidden > 0.5) discard;

    // Circular point shape
    vec2 center = gl_PointCoord - vec2(0.5);
    if (dot(center, center) > 0.25) discard;

    vec3 color;
    float alpha = 1.0;

    // Priority: hovered > selected > labeled > unlabeled
    if (vIsHovered > 0.5) {
      color = hoverColor;
      alpha = 1.0;
    } else if (vIsSelected > 0.5) {
      color = selectionColor;
      alpha = 1.0;
    } else {
      int labelIdx = int(vLabel);

      if (labelIdx < 0) {
        // Unlabeled point - use color mode
        if (colorMode == 1) {
          color = getHeightColor(vHeight);
        } else if (colorMode == 2) {
          color = getIntensityColor(vIntensity);
        } else if (colorMode == 3) {
          // File RGB. The CPU-side fills pointColor with mid-gray
          // (0.5, 0.5, 0.5) when the source file carries no color, so
          // selecting this mode on a non-RGB file degrades to flat gray
          // rather than black.
          color = vPointColor;
        } else {
          color = unlabeledColor;
        }
        alpha = dimUnlabeled ? unlabeledOpacity : 1.0;
      } else {
        // Labeled point - use class color (every instance of a class shares it)
        if (labelIdx < classCount) {
          color = classColors[labelIdx];
        } else {
          color = vec3(0.5, 0.5, 0.5); // Fallback gray
        }
        alpha = labelOpacity;
      }
    }

    gl_FragColor = vec4(color, alpha);
  }
`;


export interface SegmentablePointCloudProps {
  data: PointCloudData;
  classColors: Map<number, string>;
  onPointClick?: (index: number, event: ThreeEvent<MouseEvent>) => void;
  onPointHover?: (index: number | null) => void;
  onBrushSelect?: (indices: number[]) => void;
  brushPosition?: THREE.Vector3 | null;
  brushRadius?: number;
  pointSize?: number;
}


export const SegmentablePointCloud: React.FC<SegmentablePointCloudProps> = ({
  data,
  classColors,
  onPointClick,
  onPointHover,
  onBrushSelect,
  brushPosition,
  brushRadius = 0.5,
  pointSize = 2.0,
}) => {
  const pointsRef = useRef<THREE.Points>(null);
  const { raycaster } = useThree();
  void useRef<THREE.ShaderMaterial>(null);

  // Indices currently marked selected in the GPU buffer, so selection changes
  // can be applied as a diff (clear only the removed points) instead of an O(N)
  // fill on every selection change.
  const prevSelectionRef = useRef<{ geom: THREE.BufferGeometry | null; indices: number[] }>({ geom: null, indices: [] });

  const labels = useCurrentFrameLabels();
  const instanceIds = useCurrentFrameInstanceIds();
  const selectedPointIndices = useSegmentationStore((s) => s.selectedPointIndices);
  const hoveredPointIndex = useSegmentationStore((s) => s.hoveredPointIndex);
  const labelOpacity = useSegmentationStore((s) => s.labelOpacity);
  const showOnlyLabeled = useSegmentationStore((s) => s.showOnlyLabeled);
  const storePointSize = useSegmentationStore((s) => s.pointSize);
  const colorMode = useSegmentationStore((s) => s.colorMode);
  const hiddenInstances = useSegmentationStore((s) => s.hiddenInstances);
  const labelEditVersion = useSegmentationStore((s) => s.labelEditVersion);
  const clipBox = useEditorStore((s) => s.lidarView.clipBox);

  const resolutionScale = useMemo(() => {
    const dpr = window.devicePixelRatio || 1;
    return 1.0 / Math.sqrt(dpr);
  }, []);

  const classColorsArray = useMemo(() => {
    const colors: THREE.Vector3[] = [];
    for (let i = 0; i < 64; i++) {
      const hexColor = classColors.get(i) || '#808080';
      const color = new THREE.Color(hexColor);
      colors.push(new THREE.Vector3(color.r, color.g, color.b));
    }
    return colors;
  }, [classColors]);

  const heightRange = useMemo(() => {
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < data.pointCount; i++) {
      const z = data.positions[i * 3 + 2];
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    return { min: minZ, max: maxZ };
  }, [data]);

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));

    geom.setAttribute('label', new THREE.BufferAttribute(new Float32Array(data.pointCount).fill(-1), 1));

    geom.setAttribute('isSelected', new THREE.BufferAttribute(new Float32Array(data.pointCount).fill(0), 1));

    geom.setAttribute('isHovered', new THREE.BufferAttribute(new Float32Array(data.pointCount).fill(0), 1));

    geom.setAttribute('isHidden', new THREE.BufferAttribute(new Float32Array(data.pointCount).fill(0), 1));

    let intensityArray: Float32Array;
    if (data.intensities && data.intensities.length === data.pointCount) {
      let minI = Infinity, maxI = -Infinity;
      for (let i = 0; i < data.pointCount; i++) {
        const val = data.intensities[i];
        if (val < minI) minI = val;
        if (val > maxI) maxI = val;
      }
      const range = maxI - minI || 1;
      intensityArray = new Float32Array(data.pointCount);
      for (let i = 0; i < data.pointCount; i++) {
        intensityArray[i] = (data.intensities[i] - minI) / range;
      }
    } else {
      intensityArray = new Float32Array(data.pointCount).fill(0.5);
    }
    geom.setAttribute('intensity', new THREE.BufferAttribute(intensityArray, 1));

    let colorArray: Float32Array;
    if (data.colors && data.colors.length === data.pointCount * 3) {
      colorArray = data.colors;
    } else {
      colorArray = new Float32Array(data.pointCount * 3).fill(0.5);
    }
    geom.setAttribute('pointColor', new THREE.BufferAttribute(colorArray, 3));

    return geom;
  }, [data]);

  useEffect(() => {
    if (!geometry) return;

    const selectionAttr = geometry.getAttribute('isSelected') as THREE.BufferAttribute;
    const selectionArray = selectionAttr.array as Float32Array;

    const prev = prevSelectionRef.current;
    let lo = Infinity;
    let hi = -Infinity;
    const mark = (idx: number) => {
      if (idx < lo) lo = idx;
      if (idx > hi) hi = idx;
    };

    let fullReset = false;
    if (prev.geom !== geometry) {
      // New geometry: the freshly created buffer is already all-zero.
      fullReset = true;
    } else {
      // Clear only the points that were selected but no longer are.
      for (let k = 0; k < prev.indices.length; k++) {
        const idx = prev.indices[k];
        if (idx >= 0 && idx < selectionArray.length) {
          selectionArray[idx] = 0;
          mark(idx);
        }
      }
    }

    const nextIndices: number[] = [];
    selectedPointIndices.forEach(idx => {
      if (idx >= 0 && idx < selectionArray.length) {
        selectionArray[idx] = 1.0;
        mark(idx);
        nextIndices.push(idx);
      }
    });

    prevSelectionRef.current = { geom: geometry, indices: nextIndices };

    // Upload the touched span only; a geometry swap uploads the whole buffer
    // (leave update-ranges empty) to guarantee a clean reset.
    selectionAttr.clearUpdateRanges();
    if (fullReset) {
      selectionAttr.needsUpdate = true;
    } else if (hi >= lo) {
      selectionAttr.addUpdateRange(lo, hi - lo + 1);
      selectionAttr.needsUpdate = true;
    }
  }, [geometry, selectedPointIndices]);

  useEffect(() => {
    if (!geometry) return;

    const hoverAttr = geometry.getAttribute('isHovered') as THREE.BufferAttribute;
    const hoverArray = hoverAttr.array as Float32Array;

    hoverArray.fill(0);

    if (hoveredPointIndex !== null && hoveredPointIndex >= 0 && hoveredPointIndex < hoverArray.length) {
      hoverArray[hoveredPointIndex] = 1.0;
    }

    hoverAttr.needsUpdate = true;
  }, [geometry, hoveredPointIndex]);

  useEffect(() => {
    if (!geometry || !instanceIds) return;

    const hiddenAttr = geometry.getAttribute('isHidden') as THREE.BufferAttribute;
    const hiddenArray = hiddenAttr.array as Float32Array;

    hiddenArray.fill(0);

    for (let i = 0; i < instanceIds.length && i < hiddenArray.length; i++) {
      const instanceId = instanceIds[i];
      if (instanceId >= 0 && hiddenInstances.has(instanceId)) {
        hiddenArray[i] = 1.0;
      }
    }

    hiddenAttr.needsUpdate = true;
  }, [geometry, instanceIds, hiddenInstances]);

  // Full re-sync of the label buffer. Fires when the label array reference
  // changes: frame switch, load, undo/redo, and once per brush stroke (see
  // `endBrushSession`). In-place paint ticks do NOT change the reference — they
  // are handled incrementally by the version-driven effect below.
  useEffect(() => {
    if (!geometry) return;
    const labelAttr = geometry.getAttribute('label') as THREE.BufferAttribute;
    const labelArray = labelAttr.array as Float32Array;
    if (labels) {
      for (let i = 0; i < labels.length && i < labelArray.length; i++) {
        labelArray[i] = labels[i];
      }
    } else {
      labelArray.fill(-1);
    }
    labelAttr.clearUpdateRanges();
    labelAttr.needsUpdate = true;
  }, [geometry, labels]);

  // Incremental label update during a brush stroke. `paintBrushPoints` mutates
  // the label array in place and bumps `labelEditVersion`; here we copy only the
  // touched indices into the GPU attribute and upload just that index span,
  // instead of re-copying/re-uploading all N points every tick.
  useEffect(() => {
    if (!geometry || labelEditVersion === 0) return;
    const state = useSegmentationStore.getState();
    const changed = state.lastPaintedIndices;
    if (!changed || changed.length === 0) return;
    const frameSeg = state.frameSegmentations.get(state.currentFrameIndex);
    if (!frameSeg) return;
    const currentLabels = state.segmentationMode === 'semantic'
      ? frameSeg.semanticLabels
      : frameSeg.labels;

    const labelAttr = geometry.getAttribute('label') as THREE.BufferAttribute;
    const labelArray = labelAttr.array as Float32Array;

    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < changed.length; k++) {
      const idx = changed[k];
      if (idx < 0 || idx >= labelArray.length) continue;
      labelArray[idx] = currentLabels[idx];
      if (idx < lo) lo = idx;
      if (idx > hi) hi = idx;
    }
    if (hi < lo) return;

    // Upload only the touched index span (three r159+ update-range API).
    labelAttr.clearUpdateRanges();
    labelAttr.addUpdateRange(lo, hi - lo + 1);
    labelAttr.needsUpdate = true;
  }, [geometry, labelEditVersion]);

  const colorModeInt = useMemo(() => {
    switch (colorMode) {
      case 'height': return 1;
      case 'intensity': return 2;
      case 'rgb': return 3;
      default: return 0;
    }
  }, [colorMode]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: segmentationVertexShader,
      fragmentShader: segmentationFragmentShader,
      transparent: true,
      depthWrite: true,
      uniforms: {
        pointSize: { value: pointSize * storePointSize * resolutionScale },
        selectionSizeBoost: { value: 2.0 },
        classColors: { value: classColorsArray },
        classCount: { value: classColors.size },
        selectionColor: { value: new THREE.Vector3(0.0, 0.8, 1.0) },
        hoverColor: { value: new THREE.Vector3(1.0, 1.0, 0.0) },
        unlabeledColor: { value: new THREE.Vector3(0.4, 0.4, 0.4) },
        labelOpacity: { value: labelOpacity },
        unlabeledOpacity: { value: 0.3 },
        dimUnlabeled: { value: showOnlyLabeled },
        minHeight: { value: heightRange.min },
        maxHeight: { value: heightRange.max },
        colorMode: { value: colorModeInt },
        useClipBox: { value: false },
        clipXMin:   { value: -150 },
        clipXMax:   { value:  150 },
        clipYMin:   { value: -150 },
        clipYMax:   { value:  150 },
        clipZMin:   { value:  -20 },
        clipZMax:   { value:   50 },
      },
    });
  }, [classColorsArray, classColors.size, heightRange, resolutionScale]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!material) return;
    material.uniforms.pointSize.value = pointSize * storePointSize * resolutionScale;
  }, [material, pointSize, storePointSize, resolutionScale]);

  useEffect(() => {
    if (!material) return;
    material.uniforms.labelOpacity.value = labelOpacity;
    material.uniforms.dimUnlabeled.value = showOnlyLabeled;
    material.uniforms.colorMode.value = colorModeInt;
  }, [material, labelOpacity, showOnlyLabeled, colorModeInt]);

  useEffect(() => {
    if (!material) return;
    material.uniforms.useClipBox.value = clipBox.enabled;
    material.uniforms.clipXMin.value   = clipBox.xMin;
    material.uniforms.clipXMax.value   = clipBox.xMax;
    material.uniforms.clipYMin.value   = clipBox.yMin;
    material.uniforms.clipYMax.value   = clipBox.yMax;
    material.uniforms.clipZMin.value   = clipBox.zMin;
    material.uniforms.clipZMax.value   = clipBox.zMax;
  }, [material, clipBox]);

  const lastBrushFireRef = useRef(0);
  const BRUSH_INTERVAL_MS = 80;

  useFrame(() => {
    if (!brushPosition || !onBrushSelect || !data.positions) return;

    const now = performance.now();
    if (now - lastBrushFireRef.current < BRUSH_INTERVAL_MS) return;
    lastBrushFireRef.current = now;

    const selectedIndices: number[] = [];
    const radiusSq = brushRadius * brushRadius;

    const state = useSegmentationStore.getState();
    const currentFrameIndex = state.currentFrameIndex;
    const frameSeg = state.frameSegmentations.get(currentFrameIndex);
    const currentInstanceIds = frameSeg?.instanceIds;
    const currentHiddenInstances = state.hiddenInstances;

    for (let i = 0; i < data.pointCount; i++) {
      if (currentInstanceIds && currentInstanceIds[i] >= 0 && currentHiddenInstances.has(currentInstanceIds[i])) {
        continue;
      }

      const px = data.positions[i * 3];
      const py = data.positions[i * 3 + 1];
      const pz = data.positions[i * 3 + 2];

      const dx = px - brushPosition.x;
      const dy = py - brushPosition.y;
      const dz = pz - brushPosition.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq <= radiusSq) {
        selectedIndices.push(i);
      }
    }

    if (selectedIndices.length > 0) {
      onBrushSelect(selectedIndices);
    }
  });

  const handlePointerMove = useCallback((_event: ThreeEvent<PointerEvent>) => {
    if (!onPointHover) return;

    const threshold = 0.1;
    raycaster.params.Points = { threshold };

    if (pointsRef.current) {
      const intersects = raycaster.intersectObject(pointsRef.current);
      if (intersects.length > 0) {
        const index = intersects[0].index;
        if (index !== undefined) {
          onPointHover(index);
        }
      } else {
        onPointHover(null);
      }
    }
  }, [onPointHover, raycaster]);

  const handleClick = useCallback((event: ThreeEvent<MouseEvent>) => {
    if (!onPointClick) return;

    const threshold = 0.1;
    raycaster.params.Points = { threshold };

    if (pointsRef.current) {
      const intersects = raycaster.intersectObject(pointsRef.current);
      if (intersects.length > 0) {
        const index = intersects[0].index;
        if (index !== undefined) {
          onPointClick(index, event);
        }
      }
    }
  }, [onPointClick, raycaster]);

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      onPointerMove={handlePointerMove}
      onClick={handleClick}
    />
  );
};

export default SegmentablePointCloud;

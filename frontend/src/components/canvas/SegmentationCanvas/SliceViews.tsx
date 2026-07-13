import React, { useMemo, useCallback, useState, useRef, useEffect } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { useSegmentationStore, useCurrentFrameLabels } from '@/store/segmentationStore';
import type { PointCloudData } from '@/types';


export type SliceAxis = 'xy' | 'xz' | 'yz';

export interface SliceViewSettings {
  axis: SliceAxis;
  position: number;
  thickness: number;
  pointSize: number;
}

interface SliceViewProps {
  pointCloud: PointCloudData;
  settings: SliceViewSettings;
  classColors: Map<number, string>;
  onSettingsChange: (settings: Partial<SliceViewSettings>) => void;
  onPointSelect?: (indices: number[]) => void;
  width?: number;
  height?: number;
}


const sliceVertexShader = `
  attribute float label;
  attribute float isSelected;
  attribute float isVisible;   // 1.0 if point is within slice

  varying float vLabel;
  varying float vIsSelected;
  varying float vIsVisible;

  uniform float pointSize;

  void main() {
    vLabel = label;
    vIsSelected = isSelected;
    vIsVisible = isVisible;

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = pointSize;
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const sliceFragmentShader = `
  varying float vLabel;
  varying float vIsSelected;
  varying float vIsVisible;

  uniform vec3 classColors[64];
  uniform int classCount;
  uniform vec3 selectionColor;
  uniform vec3 unlabeledColor;

  void main() {
    // Hide points outside slice
    if (vIsVisible < 0.5) discard;

    // Circular point shape
    vec2 center = gl_PointCoord - vec2(0.5);
    if (dot(center, center) > 0.25) discard;

    vec3 color;

    if (vIsSelected > 0.5) {
      color = selectionColor;
    } else {
      int labelIdx = int(vLabel);
      if (labelIdx < 0) {
        color = unlabeledColor;
      } else if (labelIdx < classCount) {
        color = classColors[labelIdx];
      } else {
        color = vec3(0.5, 0.5, 0.5);
      }
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;


interface SlicePointCloudProps {
  pointCloud: PointCloudData;
  settings: SliceViewSettings;
  classColors: Map<number, string>;
  onPointSelect?: (indices: number[]) => void;
}

const SlicePointCloud: React.FC<SlicePointCloudProps> = ({
  pointCloud,
  settings,
  classColors,
  onPointSelect,
}) => {
  const pointsRef = useRef<THREE.Points>(null);
  const { raycaster } = useThree();

  const labels = useCurrentFrameLabels();
  const selectedPointIndices = useSegmentationStore((s) => s.selectedPointIndices);

  const classColorsArray = useMemo(() => {
    const colors: THREE.Vector3[] = [];
    for (let i = 0; i < 64; i++) {
      const hexColor = classColors.get(i) || '#808080';
      const color = new THREE.Color(hexColor);
      colors.push(new THREE.Vector3(color.r, color.g, color.b));
    }
    return colors;
  }, [classColors]);

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();

    const positions = new Float32Array(pointCloud.pointCount * 3);
    const visibleMask = new Float32Array(pointCloud.pointCount);

    const halfThickness = settings.thickness / 2;

    for (let i = 0; i < pointCloud.pointCount; i++) {
      const x = pointCloud.positions[i * 3];
      const y = pointCloud.positions[i * 3 + 1];
      const z = pointCloud.positions[i * 3 + 2];

      const sliceCoord = settings.axis === 'xy' ? z : (settings.axis === 'xz' ? y : x);
      const isInSlice = Math.abs(sliceCoord - settings.position) <= halfThickness;
      visibleMask[i] = isInSlice ? 1.0 : 0.0;

      switch (settings.axis) {
        case 'xy':
          positions[i * 3] = x;
          positions[i * 3 + 1] = y;
          positions[i * 3 + 2] = 0;
          break;
        case 'xz':
          positions[i * 3] = x;
          positions[i * 3 + 1] = z;
          positions[i * 3 + 2] = 0;
          break;
        case 'yz':
          positions[i * 3] = y;
          positions[i * 3 + 1] = z;
          positions[i * 3 + 2] = 0;
          break;
      }
    }

    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('isVisible', new THREE.BufferAttribute(visibleMask, 1));

    const labelArray = labels ? new Float32Array(labels) : new Float32Array(pointCloud.pointCount).fill(-1);
    geom.setAttribute('label', new THREE.BufferAttribute(labelArray, 1));

    const selectionArray = new Float32Array(pointCloud.pointCount).fill(0);
    geom.setAttribute('isSelected', new THREE.BufferAttribute(selectionArray, 1));

    return geom;
  }, [pointCloud, settings, labels]);

  useEffect(() => {
    if (!geometry) return;

    const visibleAttr = geometry.getAttribute('isVisible') as THREE.BufferAttribute;
    const visibleArray = visibleAttr.array as Float32Array;
    const halfThickness = settings.thickness / 2;

    for (let i = 0; i < pointCloud.pointCount; i++) {
      const x = pointCloud.positions[i * 3];
      const y = pointCloud.positions[i * 3 + 1];
      const z = pointCloud.positions[i * 3 + 2];

      const sliceCoord = settings.axis === 'xy' ? z : (settings.axis === 'xz' ? y : x);
      visibleArray[i] = Math.abs(sliceCoord - settings.position) <= halfThickness ? 1.0 : 0.0;
    }

    visibleAttr.needsUpdate = true;
  }, [geometry, pointCloud, settings.position, settings.thickness, settings.axis]);

  useEffect(() => {
    if (!geometry) return;

    const selectionAttr = geometry.getAttribute('isSelected') as THREE.BufferAttribute;
    const selectionArray = selectionAttr.array as Float32Array;

    selectionArray.fill(0);
    selectedPointIndices.forEach(idx => {
      if (idx >= 0 && idx < selectionArray.length) {
        selectionArray[idx] = 1.0;
      }
    });

    selectionAttr.needsUpdate = true;
  }, [geometry, selectedPointIndices]);

  useEffect(() => {
    if (!geometry || !labels) return;

    const labelAttr = geometry.getAttribute('label') as THREE.BufferAttribute;
    const labelArray = labelAttr.array as Float32Array;

    for (let i = 0; i < labels.length && i < labelArray.length; i++) {
      labelArray[i] = labels[i];
    }

    labelAttr.needsUpdate = true;
  }, [geometry, labels]);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      vertexShader: sliceVertexShader,
      fragmentShader: sliceFragmentShader,
      transparent: false,
      uniforms: {
        pointSize: { value: settings.pointSize * 5 },
        classColors: { value: classColorsArray },
        classCount: { value: classColors.size },
        selectionColor: { value: new THREE.Vector3(0.0, 0.8, 1.0) },
        unlabeledColor: { value: new THREE.Vector3(0.5, 0.5, 0.5) },
      },
    });
  }, [classColorsArray, classColors.size, settings.pointSize]);

  const handleClick = useCallback((_event: THREE.Event) => {
    if (!onPointSelect) return;

    const threshold = 0.5;
    raycaster.params.Points = { threshold };

    if (pointsRef.current) {
      const intersects = raycaster.intersectObject(pointsRef.current);

      const visibleAttr = geometry.getAttribute('isVisible') as THREE.BufferAttribute;
      const valid = intersects.filter(i => {
        const idx = i.index;
        return idx !== undefined && (visibleAttr.array as Float32Array)[idx] > 0.5;
      });

      if (valid.length > 0 && valid[0].index !== undefined) {
        onPointSelect([valid[0].index]);
      }
    }
  }, [onPointSelect, raycaster, geometry]);

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      onClick={handleClick}
    />
  );
};


export const SliceView: React.FC<SliceViewProps> = ({
  pointCloud,
  settings,
  classColors,
  onSettingsChange,
  onPointSelect,
  width = 300,
  height = 300,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const sliceRange = useMemo(() => {
    let min = Infinity, max = -Infinity;

    for (let i = 0; i < pointCloud.pointCount; i++) {
      const x = pointCloud.positions[i * 3];
      const y = pointCloud.positions[i * 3 + 1];
      const z = pointCloud.positions[i * 3 + 2];

      const coord = settings.axis === 'xy' ? z : (settings.axis === 'xz' ? y : x);
      if (coord < min) min = coord;
      if (coord > max) max = coord;
    }

    return { min, max };
  }, [pointCloud, settings.axis]);

  const axisLabel = useMemo(() => {
    switch (settings.axis) {
      case 'xy': return 'Z';
      case 'xz': return 'Y';
      case 'yz': return 'X';
    }
  }, [settings.axis]);

  const viewTitle = useMemo(() => {
    switch (settings.axis) {
      case 'xy': return 'Top View (XY)';
      case 'xz': return 'Side View (XZ)';
      case 'yz': return 'Front View (YZ)';
    }
  }, [settings.axis]);

  return (
    <div
      ref={containerRef}
      className="relative bg-dark-surface rounded-lg overflow-hidden border border-gray-700"
      style={{ width, height }}
    >
      {/* Header */}
      <div className="absolute top-0 left-0 right-0 z-10 bg-gradient-to-b from-black/60 to-transparent p-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-white">{viewTitle}</span>
          <span className="text-xs text-gray-400">
            {axisLabel} = {settings.position.toFixed(2)}m
          </span>
        </div>
      </div>

      {/* Canvas */}
      <Canvas
        orthographic
        camera={{
          position: [0, 0, 10],
          zoom: 10,
          near: 0.1,
          far: 1000,
        }}
        style={{ background: '#1a1a1a' }}
      >
        <SlicePointCloud
          pointCloud={pointCloud}
          settings={settings}
          classColors={classColors}
          onPointSelect={onPointSelect}
        />
        <OrbitControls
          enableRotate={false}
          enablePan={true}
          enableZoom={true}
          mouseButtons={{
            LEFT: THREE.MOUSE.PAN,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.PAN,
          }}
        />
      </Canvas>

      {/* Slice position slider */}
      <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/80 to-transparent p-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-6">{axisLabel}</span>
          <input
            type="range"
            min={sliceRange.min}
            max={sliceRange.max}
            step={0.1}
            value={settings.position}
            onChange={(e) => onSettingsChange({ position: parseFloat(e.target.value) })}
            className="flex-1 h-1 bg-gray-700 rounded-lg appearance-none cursor-pointer"
          />
          <input
            type="number"
            value={settings.position.toFixed(2)}
            onChange={(e) => onSettingsChange({ position: parseFloat(e.target.value) || 0 })}
            className="w-16 px-1 py-0.5 bg-gray-800 border border-gray-600 rounded text-xs text-white text-right"
            step={0.1}
          />
        </div>

        {/* Thickness control */}
        <div className="flex items-center gap-2 mt-1">
          <span className="text-xs text-gray-500 w-6">±</span>
          <input
            type="range"
            min={0.1}
            max={5}
            step={0.1}
            value={settings.thickness}
            onChange={(e) => onSettingsChange({ thickness: parseFloat(e.target.value) })}
            className="flex-1 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
          />
          <span className="text-xs text-gray-500 w-16 text-right">
            {settings.thickness.toFixed(1)}m
          </span>
        </div>
      </div>
    </div>
  );
};


interface MultiSlicePanelProps {
  pointCloud: PointCloudData;
  classColors: Map<number, string>;
  onPointSelect?: (indices: number[]) => void;
}

export const MultiSlicePanel: React.FC<MultiSlicePanelProps> = ({
  pointCloud,
  classColors,
  onPointSelect,
}) => {
  const [xySettings, setXYSettings] = useState<SliceViewSettings>({
    axis: 'xy',
    position: 0,
    thickness: 0.5,
    pointSize: 2,
  });

  const [xzSettings, setXZSettings] = useState<SliceViewSettings>({
    axis: 'xz',
    position: 0,
    thickness: 1,
    pointSize: 2,
  });

  const [yzSettings, setYZSettings] = useState<SliceViewSettings>({
    axis: 'yz',
    position: 0,
    thickness: 1,
    pointSize: 2,
  });

  return (
    <div className="flex flex-col gap-2 p-2 bg-dark-panel rounded-xl">
      <h3 className="text-sm font-medium text-white px-1">Slice Views</h3>

      <div className="grid grid-cols-1 gap-2">
        <SliceView
          pointCloud={pointCloud}
          settings={xySettings}
          classColors={classColors}
          onSettingsChange={(s) => setXYSettings(prev => ({ ...prev, ...s }))}
          onPointSelect={onPointSelect}
          width={280}
          height={200}
        />

        <SliceView
          pointCloud={pointCloud}
          settings={xzSettings}
          classColors={classColors}
          onSettingsChange={(s) => setXZSettings(prev => ({ ...prev, ...s }))}
          onPointSelect={onPointSelect}
          width={280}
          height={150}
        />

        <SliceView
          pointCloud={pointCloud}
          settings={yzSettings}
          classColors={classColors}
          onSettingsChange={(s) => setYZSettings(prev => ({ ...prev, ...s }))}
          onPointSelect={onPointSelect}
          width={280}
          height={150}
        />
      </div>
    </div>
  );
};

export default {
  SliceView,
  MultiSlicePanel,
};

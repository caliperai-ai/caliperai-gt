import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';
import * as THREE from 'three';
import { useSegmentationStore, useCurrentFrameLabels } from '@/store/segmentationStore';
import type { PointCloudData } from '@/types';

const W        = 300;
const CANVAS_H = 260;
const POINT_R  = 2;


function logScale(x: number) {
  return Math.log(1 + x * 9) / Math.log(10);
}

function heightColor(h: number, minH: number, maxH: number): [number, number, number] {
  const t = logScale(Math.max(0, Math.min(1, (h - minH) / Math.max(maxH - minH, 0.001))));
  const stops: [number, number, number][] = [[13,13,128],[26,128,255],[26,217,102],[255,217,0],[255,26,26]];
  const s = Math.min(Math.floor(t * 4), 3), f = t * 4 - s;
  const [r0,g0,b0] = stops[s], [r1,g1,b1] = stops[s+1];
  return [Math.round(r0+(r1-r0)*f), Math.round(g0+(g1-g0)*f), Math.round(b0+(b1-b0)*f)];
}

function intensityColor(i: number): [number, number, number] {
  const t = logScale(Math.max(0, Math.min(1, i)));
  const stops: [number, number, number][] = [[13,0,38],[64,0,128],[13,77,191],[0,191,166],[140,242,26]];
  const s = Math.min(Math.floor(t * 4), 3), f = t * 4 - s;
  const [r0,g0,b0] = stops[s], [r1,g1,b1] = stops[s+1];
  return [Math.round(r0+(r1-r0)*f), Math.round(g0+(g1-g0)*f), Math.round(b0+(b1-b0)*f)];
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}


export interface BrushZoomInsetProps {
  pointCloud: PointCloudData;
  classColors: Map<number, string>;
}


export const BrushZoomInset: React.FC<BrushZoomInsetProps> = ({ pointCloud, classColors }) => {
  const canvas2dRef = useRef<HTMLCanvasElement>(null);
  const canvas3dRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [mode, setMode]   = useState<'2d' | '3d'>('2d');
  const [viewR, setViewR] = useState(3.5);

  const [position, setPosition] = useState({ x: 60, y: 48 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; startPosX: number; startPosY: number } | null>(null);

  const brushPos        = useSegmentationStore((s) => s.brushWorldPosition);
  const brushIsPainting = useSegmentationStore((s) => s.brushIsPainting);
  const activeTool      = useSegmentationStore((s) => s.activeTool);
  const brushRadius     = useSegmentationStore((s) => s.brushSettings.radius);
  const colorMode       = useSegmentationStore((s) => s.colorMode ?? 'height');
  const labels          = useCurrentFrameLabels();

  const classRgbCache = useMemo(() => {
    const m = new Map<number, [number, number, number]>();
    classColors.forEach((hex, id) => m.set(id, hexToRgb(hex)));
    return m;
  }, [classColors]);

  useEffect(() => {
    const canvas = canvas3dRef.current;
    if (!canvas) return;

    const handleContextLost = (e: Event) => {
      e.preventDefault();
      console.warn('[BrushZoomInset] WebGL context lost');
    };
    const handleContextRestored = () => {
      console.log('[BrushZoomInset] WebGL context restored');
    };
    canvas.addEventListener('webglcontextlost', handleContextLost);
    canvas.addEventListener('webglcontextrestored', handleContextRestored);

    const r = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    });
    r.setPixelRatio(1);
    r.setSize(W, CANVAS_H);
    r.setClearColor(0x0d1117, 1);
    rendererRef.current = r;
    return () => {
      canvas.removeEventListener('webglcontextlost', handleContextLost);
      canvas.removeEventListener('webglcontextrestored', handleContextRestored);
      r.dispose();
      rendererRef.current = null;
    };
  }, []);

  const collectPoints = useCallback((cx: number, cy: number) => {
    const { positions, intensities, colors, pointCount } = pointCloud;
    let minH = Infinity, maxH = -Infinity;
    for (let i = 0; i < pointCount; i++) {
      if (Math.abs(positions[i*3]-cx) > viewR || Math.abs(positions[i*3+1]-cy) > viewR) continue;
      const z = positions[i*3+2];
      if (z < minH) minH = z;
      if (z > maxH) maxH = z;
    }
    if (!isFinite(minH)) { minH = -2; maxH = 5; }

    const pxyz: number[] = [];
    const prgb: number[] = [];

    for (let i = 0; i < pointCount; i++) {
      const x = positions[i*3], y = positions[i*3+1], z = positions[i*3+2];
      if (Math.abs(x-cx) > viewR || Math.abs(y-cy) > viewR) continue;
      pxyz.push(x, y, z);

      const lbl = labels ? labels[i] : -1;
      let r = 100, g = 100, b = 100;
      if (lbl >= 0 && classRgbCache.has(lbl)) {
        [r, g, b] = classRgbCache.get(lbl)!;
      } else if (colorMode === 'height') {
        [r, g, b] = heightColor(z, minH, maxH);
      } else if (colorMode === 'intensity' && intensities) {
        [r, g, b] = intensityColor(intensities[i]);
      } else if (colorMode === 'rgb' && colors) {
        r = Math.round(colors[i*3]     * 255);
        g = Math.round(colors[i*3 + 1] * 255);
        b = Math.round(colors[i*3 + 2] * 255);
      }
      prgb.push(r, g, b);
    }
    return { pxyz, prgb, minH, maxH };
  }, [pointCloud, viewR, labels, classRgbCache, colorMode]);

  const draw2D = useCallback(() => {
    const canvas = canvas2dRef.current;
    if (!canvas || !brushPos) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const [cx, cy] = brushPos;
    const { pxyz, prgb, minH, maxH } = collectPoints(cx, cy);
    const scale = (W / 2) / viewR;

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, CANVAS_H);

    const half = W / 2, halfH = CANVAS_H / 2;
    for (let i = 0; i < pxyz.length / 3; i++) {
      const sx = half + (pxyz[i*3] - cx) * scale;
      const sy = halfH - (pxyz[i*3+1] - cy) * scale;
      ctx.fillStyle = `rgb(${prgb[i*3]},${prgb[i*3+1]},${prgb[i*3+2]})`;
      ctx.beginPath();
      ctx.arc(sx, sy, POINT_R, 0, Math.PI * 2);
      ctx.fill();
    }

    // Crosshair
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(half, 0); ctx.lineTo(half, CANVAS_H);
    ctx.moveTo(0, halfH); ctx.lineTo(W, halfH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Brush ring
    const ringPx = brushRadius * scale;
    const isEraserTool = activeTool === 'eraser';
    ctx.strokeStyle = brushIsPainting
      ? (isEraserTool ? 'rgba(239,68,68,0.9)' : 'rgba(255,255,255,0.9)')
      : (isEraserTool ? 'rgba(239,68,68,0.55)' : 'rgba(80,160,255,0.65)');
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(half, halfH, ringPx, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // Scale bar: 1 m
    const barLen = scale;
    const barX = W - 14 - barLen, barY = CANVAS_H - 12;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(barX, barY); ctx.lineTo(barX + barLen, barY);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '9px monospace';
    ctx.fillText('1m', barX, barY - 3);

    void minH; void maxH;
  }, [brushPos, viewR, brushRadius, brushIsPainting, collectPoints]);

  // ─────────────────────────────────────────────────────────────────────────
  // 3D perspective renderer (imperative THREE.js)
  // ─────────────────────────────────────────────────────────────────────────
  const draw3D = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer || !brushPos) return;

    const [cx, cy, cz] = brushPos;
    const { pxyz, prgb } = collectPoints(cx, cy);

    // Build geometry
    const posArr = new Float32Array(pxyz);
    const colArr = new Float32Array(prgb.length);
    for (let i = 0; i < prgb.length; i++) colArr[i] = prgb[i] / 255;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArr, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(colArr, 3));

    const mat  = new THREE.PointsMaterial({ vertexColors: true, size: 0.05, sizeAttenuation: true });
    const pts  = new THREE.Points(geo, mat);

    // Brush sphere
    const bGeo  = new THREE.SphereGeometry(brushRadius, 14, 10);
    const bMat  = new THREE.MeshBasicMaterial({
      color: brushIsPainting ? 0xffffff : 0x3b82f6,
      wireframe: true, transparent: true,
      opacity: brushIsPainting ? 0.85 : 0.5,
    });
    const bMesh = new THREE.Mesh(bGeo, bMat);
    bMesh.position.set(cx, cy, cz);

    // Grid at brush Z level
    const gridGeo = new THREE.BufferGeometry();
    const gLines: number[] = [];
    const step = viewR / 3;
    for (let v = -viewR; v <= viewR + 0.001; v += step) {
      gLines.push(cx - viewR, cy + v, cz, cx + viewR, cy + v, cz);
      gLines.push(cx + v, cy - viewR, cz, cx + v, cy + viewR, cz);
    }
    gridGeo.setAttribute('position', new THREE.Float32BufferAttribute(gLines, 3));
    const gridMat  = new THREE.LineBasicMaterial({ color: 0x334455, transparent: true, opacity: 0.5 });
    const gridMesh = new THREE.LineSegments(gridGeo, gridMat);

    const scene = new THREE.Scene();
    scene.add(pts, bMesh, gridMesh);

    // Camera: elevated 45° front-angled view
    const elev = viewR * 0.95;
    const back = viewR * 0.8;
    const camera = new THREE.PerspectiveCamera(52, W / CANVAS_H, 0.01, 500);
    camera.position.set(cx, cy - back, cz + elev);
    camera.up.set(0, 0, 1);
    camera.lookAt(cx, cy, cz);

    renderer.render(scene, camera);

    // Dispose to free GPU memory
    geo.dispose();
    mat.dispose();
    bGeo.dispose();
    bMat.dispose();
    gridGeo.dispose();
    gridMat.dispose();
  }, [brushPos, viewR, brushRadius, brushIsPainting, collectPoints]);

  // ─────────────────────────────────────────────────────────────────────────
  // Trigger re-draw when anything relevant changes
  // ─────────────────────────────────────────────────────────────────────────
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if ((activeTool !== 'brush' && activeTool !== 'eraser') || !brushPos) return;
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      if (mode === '2d') draw2D();
      else               draw3D();
    });
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [draw2D, draw3D, mode, activeTool, brushPos, labels]);

  // ─────────────────────────────────────────────────────────────────────────
  // Radius controls
  // ─────────────────────────────────────────────────────────────────────────
  const changeRadius = (delta: number) =>
    setViewR(prev => Math.max(1, Math.min(20, Math.round((prev + delta) * 2) / 2)));

  // ─────────────────────────────────────────────────────────────────────────
  // Dragging handlers
  // ─────────────────────────────────────────────────────────────────────────
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPosX: position.x === -1 ? (panelRef.current ? window.innerWidth - 8 - panelRef.current.offsetWidth : 0) : position.x,
      startPosY: position.y,
    };
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const deltaX = e.clientX - dragRef.current.startX;
      const deltaY = e.clientY - dragRef.current.startY;
      setPosition({
        x: dragRef.current.startPosX + deltaX,
        y: dragRef.current.startPosY + deltaY,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  // ─────────────────────────────────────────────────────────────────────────
  // Show for brush and eraser tools
  // ─────────────────────────────────────────────────────────────────────────
  if ((activeTool !== 'brush' && activeTool !== 'eraser') || !brushPos) return null;

  const isEraser = activeTool === 'eraser';
  const borderColor = brushIsPainting
    ? (isEraser ? 'rgba(239,68,68,0.85)' : 'rgba(255,255,255,0.7)')
    : (isEraser ? 'rgba(239,68,68,0.35)' : 'rgba(80,140,255,0.4)');

  return (
    <div
      ref={panelRef}
      className="absolute z-30 rounded-xl overflow-hidden shadow-2xl flex flex-col"
      style={{
        width: W,
        left: position.x === -1 ? 'auto' : position.x,
        right: position.x === -1 ? 8 : 'auto',
        top: position.y,
        border: `1.5px solid ${borderColor}`,
        background: '#0d1117',
        boxShadow: '0 4px 32px rgba(0,0,0,0.75)',
        cursor: isDragging ? 'grabbing' : 'default',
      }}
    >
      {/* ── header - draggable ── */}
      <div
        className="flex items-center justify-between px-2 py-1.5 border-b border-gray-800 select-none cursor-grab active:cursor-grabbing"
        onMouseDown={handleMouseDown}
      >
        {/* Tabs */}
        <div className="flex gap-1">
          {(['2d', '3d'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold transition-colors ${
                mode === m ? 'bg-blue-600 text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {m.toUpperCase()}
            </button>
          ))}
        </div>

        {/* Radius control */}
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-gray-500 font-mono">r=</span>
          <button
            onClick={() => changeRadius(-0.5)}
            className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-700 text-xs leading-none"
          >−</button>
          <span className="text-[10px] text-gray-300 font-mono w-8 text-center">{viewR}m</span>
          <button
            onClick={() => changeRadius(+0.5)}
            className="w-5 h-5 flex items-center justify-center rounded text-gray-400 hover:text-white hover:bg-gray-700 text-xs leading-none"
          >+</button>
        </div>
      </div>

      {/* ── canvases – only one visible at a time ── */}
      <div style={{ position: 'relative', width: W, height: CANVAS_H }}>
        <canvas
          ref={canvas2dRef}
          width={W}
          height={CANVAS_H}
          style={{ display: mode === '2d' ? 'block' : 'none' }}
        />
        <canvas
          ref={canvas3dRef}
          width={W}
          height={CANVAS_H}
          style={{ display: mode === '3d' ? 'block' : 'none' }}
        />
        {/* mode label */}
        <div className="absolute top-1.5 left-2 text-[9px] text-gray-600 font-mono select-none pointer-events-none">
          {mode === '2d' ? 'Top-down' : '3D view'} ·{' '}
          {brushIsPainting ? (
            <span className="text-white">Painting</span>
          ) : (
            <span>±{viewR}m</span>
          )}
        </div>
      </div>
    </div>
  );
};

export default BrushZoomInset;

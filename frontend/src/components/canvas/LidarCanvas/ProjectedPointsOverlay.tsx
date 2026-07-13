import React, { useRef, useEffect, useCallback } from 'react';
import { useEditorStore } from '@/store/editorStore';
import type { PointCloudData, CameraCalibration, Annotation, CuboidData, TaxonomyConfig } from '@/types';

interface ProjectedCuboid {
  annotationId: string;
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  corners: { x: number; y: number }[];
}

interface ProjectedPointsOverlayProps {
  pointCloud: PointCloudData;
  calibration: CameraCalibration;
  imageWidth: number;
  imageHeight: number;
  displayWidth: number;
  displayHeight: number;
  offsetX: number;
  offsetY: number;
  annotations?: Annotation[];
  taxonomy?: TaxonomyConfig | null;
  zoom?: number;
  pan?: { x: number; y: number };
  onZoomChange?: (zoom: number) => void;
}

export const ProjectedPointsOverlay: React.FC<ProjectedPointsOverlayProps> = ({
  pointCloud,
  calibration,
  imageWidth,
  imageHeight,
  displayWidth,
  displayHeight,
  offsetX,
  offsetY,
  annotations = [],
  taxonomy,
  zoom = 1,
  pan = { x: 0, y: 0 },
  onZoomChange,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const projectedCuboidsRef = useRef<ProjectedCuboid[]>([]);

  const { selectAnnotation, selection, lidarView } = useEditorStore();
  const selectedAnnotationIds = selection.selectedAnnotationIds;

  const clipBox = lidarView.clipBox;

  const useFisheyeProjection = lidarView.useFisheyeProjection;
  const cameraModel = calibration?.intrinsic?.camera_model;
  const distortion = calibration?.intrinsic?.distortion;

  const isAutoFisheye = !cameraModel && distortion?.length === 4 && calibration.intrinsic.fx < imageWidth / 2;

  const shouldUseFisheye = useFisheyeProjection || cameraModel === 'kannala_brandt' || isAutoFisheye;

  console.log('[ProjectedPointsOverlay] Component rendered with:', {
    pointCount: pointCloud.pointCount,
    annotationCount: annotations.length,
    displaySize: { displayWidth, displayHeight },
    imageSize: { imageWidth, imageHeight },
    useFisheye: shouldUseFisheye,
    cameraModel,
    isAutoFisheye,
    intrinsic: { fx: calibration?.intrinsic?.fx, fy: calibration?.intrinsic?.fy, cx: calibration?.intrinsic?.cx, cy: calibration?.intrinsic?.cy },
    distortion: calibration?.intrinsic?.distortion,
  });

  useEffect(() => {
    console.log('[ProjectedPointsOverlay] useEffect running');
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const parent = canvas.parentElement;
    if (!parent) return;

    const canvasWidth = parent.clientWidth;
    const canvasHeight = parent.clientHeight;

    canvas.width = canvasWidth;
    canvas.height = canvasHeight;

    const containerAspect = canvasWidth / canvasHeight;
    const imgAspect = imageWidth / imageHeight;
    let derivedDisplayWidth: number, derivedDisplayHeight: number;
    if (containerAspect > imgAspect) {
      derivedDisplayHeight = canvasHeight;
      derivedDisplayWidth = derivedDisplayHeight * imgAspect;
    } else {
      derivedDisplayWidth = canvasWidth;
      derivedDisplayHeight = derivedDisplayWidth / imgAspect;
    }
    const derivedOffsetX = (canvasWidth - derivedDisplayWidth) / 2;
    const derivedOffsetY = (canvasHeight - derivedDisplayHeight) / 2;

    console.log('[ProjectedPointsOverlay] Canvas/Image dimensions:', {
      canvasWidth, canvasHeight,
      derivedDisplayWidth, derivedDisplayHeight,
      derivedOffsetX, derivedOffsetY,
      imageWidth, imageHeight,
      propsOffsetX: offsetX, propsOffsetY: offsetY,
      propsDisplayWidth: displayWidth, propsDisplayHeight: displayHeight,
    });

    const dW = derivedDisplayWidth;
    const dH = derivedDisplayHeight;
    const oX = derivedOffsetX;
    const oY = derivedOffsetY;

    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    ctx.beginPath();
    ctx.rect(oX, oY, dW, dH);
    ctx.clip();

    const centerX = canvasWidth / 2;
    const centerY = canvasHeight / 2;

    ctx.save();
    ctx.translate(centerX + pan.x, centerY + pan.y);
    ctx.scale(zoom, zoom);
    ctx.translate(-centerX, -centerY);

    const scaleX = dW / imageWidth;
    const scaleY = dH / imageHeight;

    const { extrinsic, intrinsic } = calibration;
    const R_stored = extrinsic.rotation;
    const t_stored = extrinsic.translation;

    const positions = pointCloud.positions;

    const { fx, fy, cx, cy } = intrinsic;

    const needsInversion = false;

    let R: number[][];
    let t: number[];

    if (needsInversion) {
      R = [
        [R_stored[0][0], R_stored[1][0], R_stored[2][0]],
        [R_stored[0][1], R_stored[1][1], R_stored[2][1]],
        [R_stored[0][2], R_stored[1][2], R_stored[2][2]],
      ];
      t = [
        -(R[0][0]*t_stored[0] + R[0][1]*t_stored[1] + R[0][2]*t_stored[2]),
        -(R[1][0]*t_stored[0] + R[1][1]*t_stored[1] + R[1][2]*t_stored[2]),
        -(R[2][0]*t_stored[0] + R[2][1]*t_stored[1] + R[2][2]*t_stored[2]),
      ];
    } else {
      R = R_stored;
      t = t_stored;
    }

    let pointsProjected = 0;
    let minCamY = Infinity, maxCamY = -Infinity;

    const projectFisheye = (camX: number, camY: number, camZ: number): { u: number; v: number } | null => {
      const r = Math.sqrt(camX * camX + camY * camY);
      const theta = Math.atan2(r, camZ);

      if (theta > Math.PI * 0.9) return null;

      const k2 = distortion?.[0] ?? 0;
      const k3 = distortion?.[1] ?? 0;
      const k4 = distortion?.[2] ?? 0;
      const k5 = distortion?.[3] ?? 0;

      const theta2 = theta * theta;
      const theta4 = theta2 * theta2;
      const theta6 = theta4 * theta2;
      const theta8 = theta4 * theta4;
      const theta_d = theta * (1 + k2 * theta2 + k3 * theta4 + k4 * theta6 + k5 * theta8);

      let u: number, v: number;
      if (r < 1e-8) {
        u = cx;
        v = cy;
      } else {
        const scale = theta_d / r;
        u = fx * scale * camX + cx;
        v = fy * scale * camY + cy;
      }

      return { u, v };
    };

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

      const camX = R[0][0] * px + R[0][1] * py + R[0][2] * pz + t[0];
      const camY = R[1][0] * px + R[1][1] * py + R[1][2] * pz + t[1];
      const camZ = R[2][0] * px + R[2][1] * py + R[2][2] * pz + t[2];

      if (camZ <= 0.1) continue;

      if (camY < minCamY) minCamY = camY;
      if (camY > maxCamY) maxCamY = camY;

      let u: number, v: number;

      if (shouldUseFisheye) {
        const result = projectFisheye(camX, camY, camZ);
        if (!result) continue;
        u = result.u;
        v = result.v;
      } else {
        u = (fx * camX / camZ) + cx;
        v = (fy * camY / camZ) + cy;
      }

      if (u < 0 || u >= imageWidth || v < 0 || v >= imageHeight) continue;

      const canvasX = u * scaleX + oX;
      const canvasY = v * scaleY + oY;

      const depth = camZ;
      const c = Math.max(0, Math.min(255, 255 * (1 - depth / 50.0)));
      const color = `rgb(${255 - c}, 0, ${c})`;

      // Draw point (smaller size to avoid obscuring image features)
      ctx.fillStyle = color;
      ctx.fillRect(canvasX - 1, canvasY - 1, 2, 2);
      pointsProjected++;
    }

    // Debug: pointsProjected = ${pointsProjected}, CamY range: ${minCamY} to ${maxCamY}


    const projectPoint = (px: number, py: number, pz: number): { x: number; y: number; visible: boolean } => {
      const camX = R[0][0] * px + R[0][1] * py + R[0][2] * pz + t[0];
      const camY = R[1][0] * px + R[1][1] * py + R[1][2] * pz + t[1];
      const camZ = R[2][0] * px + R[2][1] * py + R[2][2] * pz + t[2];

      if (camZ <= 0.1) {
        return { x: 0, y: 0, visible: false };
      }

      let u: number, v: number;

      if (shouldUseFisheye) {
        const result = projectFisheye(camX, camY, camZ);
        if (!result) {
          return { x: 0, y: 0, visible: false };
        }
        u = result.u;
        v = result.v;
      } else {
        u = (fx * camX / camZ) + cx;
        v = (fy * camY / camZ) + cy;
      }

      const margin = 0.3;
      const marginX = imageWidth * margin;
      const marginY = imageHeight * margin;
      if (u < -marginX || u > imageWidth + marginX || v < -marginY || v > imageHeight + marginY) {
        return { x: 0, y: 0, visible: false };
      }

      const canvasX = u * scaleX + oX;
      const canvasY = v * scaleY + oY;

      return { x: canvasX, y: canvasY, visible: true };
    };

    const getCuboidCorners = (
      centerX: number, centerY: number, centerZ: number,
      length: number, width: number, height: number,
      yaw: number
    ): [number, number, number][] => {
      const cos = Math.cos(yaw);
      const sin = Math.sin(yaw);

      const hl = length / 2;
      const hw = width / 2;
      const hh = height / 2;

      const localCorners: [number, number, number][] = [
        [ hl,  hw, -hh],
        [ hl, -hw, -hh],
        [-hl, -hw, -hh],
        [-hl,  hw, -hh],
        [ hl,  hw,  hh],
        [ hl, -hw,  hh],
        [-hl, -hw,  hh],
        [-hl,  hw,  hh],
      ];

      return localCorners.map(([lx, ly, lz]) => {
        const rx = cos * lx - sin * ly;
        const ry = sin * lx + cos * ly;
        return [
          centerX + rx,
          centerY + ry,
          centerZ + lz,
        ] as [number, number, number];
      });
    };

    const cuboidEdges: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];

    const cuboids = annotations.filter((a) => a.type === 'cuboid');

    const newProjectedCuboids: ProjectedCuboid[] = [];

    for (const annotation of cuboids) {
      const data = annotation.data as CuboidData;
      const { center, dimensions, rotation } = data;
      const yaw = rotation.yaw;

      if (clipBox?.enabled) {
        if (center.x < clipBox.xMin || center.x > clipBox.xMax ||
            center.y < clipBox.yMin || center.y > clipBox.yMax ||
            center.z < clipBox.zMin || center.z > clipBox.zMax) {
          continue;
        }
      }

      const centerProjection = projectPoint(center.x, center.y, center.z);
      if (!centerProjection.visible) {
        continue;
      }

      let color = '#00ff00';
      if (taxonomy && annotation.class_id) {
        const cls = taxonomy.classes.find((c) => c.id === annotation.class_id);
        if (cls) {
          color = cls.color;
        }
      }

      const corners3D = getCuboidCorners(
        center.x, center.y, center.z,
        dimensions.length, dimensions.width, dimensions.height,
        yaw
      );

      const corners2D = corners3D.map(([x, y, z]) => projectPoint(x, y, z));

      const anyVisible = corners2D.some((c) => c.visible);
      if (!anyVisible) continue;

      const visibleCorners = corners2D.filter(c => c.visible);
      if (visibleCorners.length > 0) {
        const xs = visibleCorners.map(c => c.x);
        const ys = visibleCorners.map(c => c.y);
        newProjectedCuboids.push({
          annotationId: annotation.id,
          bounds: {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys),
          },
          corners: visibleCorners.map(c => ({ x: c.x, y: c.y })),
        });
      }

      const isSelected = selectedAnnotationIds.includes(annotation.id);

      ctx.strokeStyle = isSelected ? '#ff0000' : color;
      ctx.lineWidth = isSelected ? 3 : 0.5;
      ctx.globalAlpha = isSelected ? 1.0 : 0.4;

      for (const [i, j] of cuboidEdges) {
        const c1 = corners2D[i];
        const c2 = corners2D[j];

        if (!c1.visible && !c2.visible) continue;

        ctx.beginPath();
        ctx.moveTo(c1.x, c1.y);
        ctx.lineTo(c2.x, c2.y);
        ctx.stroke();
      }

      if (isSelected) {
        const frontCorners = [corners2D[0], corners2D[1], corners2D[5], corners2D[4]];
        if (frontCorners.some((c) => c.visible)) {
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.moveTo(frontCorners[0].x, frontCorners[0].y);
          ctx.lineTo(frontCorners[1].x, frontCorners[1].y);
          ctx.lineTo(frontCorners[2].x, frontCorners[2].y);
          ctx.lineTo(frontCorners[3].x, frontCorners[3].y);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      }

      ctx.globalAlpha = 1.0;

    }

    projectedCuboidsRef.current = newProjectedCuboids;

    ctx.restore();

  }, [pointCloud, calibration, imageWidth, imageHeight, displayWidth, displayHeight, offsetX, offsetY, annotations, taxonomy, zoom, pan, selectedAnnotationIds, clipBox, shouldUseFisheye]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const rawClickX = e.clientX - rect.left;
    const rawClickY = e.clientY - rect.top;

    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const clickX = (rawClickX - centerX - pan.x) / zoom + centerX;
    const clickY = (rawClickY - centerY - pan.y) / zoom + centerY;

    for (let i = projectedCuboidsRef.current.length - 1; i >= 0; i--) {
      const cuboid = projectedCuboidsRef.current[i];
      const { bounds } = cuboid;

      if (clickX >= bounds.minX && clickX <= bounds.maxX &&
          clickY >= bounds.minY && clickY <= bounds.maxY) {
        console.log('[ProjectedPointsOverlay] Clicked on cuboid:', cuboid.annotationId);

        selectAnnotation(cuboid.annotationId, e.shiftKey);
        return;
      }
    }

    useEditorStore.getState().deselectAll();
  }, [selectAnnotation, zoom, pan]);

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

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      style={{ zIndex: 10, cursor: 'pointer' }}
      onClick={handleClick}
      onWheel={handleWheel}
    />
  );
};

export default ProjectedPointsOverlay;

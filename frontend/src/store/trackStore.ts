
import { create } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type {
  Annotation,
  CuboidData,
  Track,
  AnnotationType,
  AnnotationSource,
  Frame,
  ExtrinsicCalibration
} from '@/types';

import { useEditorStore } from './editorStore';
import {
  transformToWorld,
  transformFromWorld,
  getLidarToEgoTransform,
  quaternionToRotationMatrix,
  type EgoPose,
  type Point3D,
  type EgoToLidarCalibration,
  type LidarToEgoTransform
} from '@/utils/worldTransforms';


const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const lerpAngle = (a: number, b: number, t: number): number => {
  let delta = ((b - a + Math.PI) % (2 * Math.PI)) - Math.PI;
  if (delta < -Math.PI) delta += 2 * Math.PI;
  return a + delta * t;
};

const catmullRom = (
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
  tension: number = 0.5
): number => {
  const t2 = t * t;
  const t3 = t2 * t;

  const m0 = tension * (p2 - p0);
  const m1 = tension * (p3 - p1);

  return (2 * t3 - 3 * t2 + 1) * p1 +
         (t3 - 2 * t2 + t) * m0 +
         (-2 * t3 + 3 * t2) * p2 +
         (t3 - t2) * m1;
};

interface Point3DSimple {
  x: number;
  y: number;
  z: number;
}

const catmullRom3D = (
  p0: Point3DSimple,
  p1: Point3DSimple,
  p2: Point3DSimple,
  p3: Point3DSimple,
  t: number,
  tension: number = 0.5
): Point3DSimple => ({
  x: catmullRom(p0.x, p1.x, p2.x, p3.x, t, tension),
  y: catmullRom(p0.y, p1.y, p2.y, p3.y, t, tension),
  z: catmullRom(p0.z, p1.z, p2.z, p3.z, t, tension),
});

const getSplineTangentYaw = (
  p0: Point3DSimple,
  p1: Point3DSimple,
  p2: Point3DSimple,
  p3: Point3DSimple,
  t: number
): number | null => {
  const dt = 0.02;
  const t0 = Math.max(0, t - dt);
  const t1 = Math.min(1, t + dt);
  if (t1 <= t0) return null;

  const c0 = catmullRom3D(p0, p1, p2, p3, t0);
  const c1 = catmullRom3D(p0, p1, p2, p3, t1);
  const dx = c1.x - c0.x;
  const dy = c1.y - c0.y;
  if (Math.hypot(dx, dy) < 1e-4) return null;

  return Math.atan2(dy, dx);
};

const blendYawWithTangent = (
  startYaw: number,
  endYaw: number,
  t: number,
  tangentYaw: number | null
): number => {
  const keyframeYaw = normalizeAngle(lerpAngle(startYaw, endYaw, t));
  if (tangentYaw === null) return keyframeYaw;

  const tangentOptionA = normalizeAngle(tangentYaw);
  const tangentOptionB = normalizeAngle(tangentYaw + Math.PI);
  const diffA = Math.abs(normalizeAngle(tangentOptionA - keyframeYaw));
  const diffB = Math.abs(normalizeAngle(tangentOptionB - keyframeYaw));
  const alignedTangentYaw = diffA <= diffB ? tangentOptionA : tangentOptionB;

  const tangentDelta = Math.abs(normalizeAngle(alignedTangentYaw - keyframeYaw));
  const MAX_TANGENT_DEVIATION = Math.PI / 4;
  if (tangentDelta > MAX_TANGENT_DEVIATION) return keyframeYaw;

  const tangentBlend = tangentDelta < (Math.PI / 36) ? 0 : 0.35;
  return tangentBlend > 0
    ? normalizeAngle(lerpAngle(keyframeYaw, alignedTangentYaw, tangentBlend))
    : keyframeYaw;
};

const isPathCurved = (
  startWorld: { center: Point3DSimple; rotation: { yaw: number } },
  endWorld: { center: Point3DSimple; rotation: { yaw: number } }
): boolean => {
  let yawDiff = Math.abs(normalizeAngle(endWorld.rotation.yaw - startWorld.rotation.yaw));

  const TURN_THRESHOLD = Math.PI / 12;
  return yawDiff > TURN_THRESHOLD;
};


const DEFAULT_EGO_POSE: EgoPose = {
  position: [0, 0, 0],
  rotation: [1, 0, 0, 0],
};

const getEgoPose = (frame: Frame): EgoPose => {
  if (frame.ego_pose && frame.ego_pose.position && frame.ego_pose.rotation) {
    return {
      position: frame.ego_pose.position,
      rotation: frame.ego_pose.rotation,
    };
  }
  return DEFAULT_EGO_POSE;
};

const transformGroundPlane = (
  plane: { a: number; b: number; c: number; d: number },
  sourceFrame: Frame,
  targetFrame: Frame,
  egoToLidar?: ExtrinsicCalibration
): { a: number; b: number; c: number; d: number } | null => {
  if (Math.abs(plane.c) < 0.001) return null;

  const sourceEgoPose = getEgoPose(sourceFrame);
  const targetEgoPose = getEgoPose(targetFrame);
  const lidarToEgo = egoToLidar ? getLidarToEgoTransform(egoToLidar) : undefined;

  const gz = (x: number, y: number) =>
    -(plane.a * x + plane.b * y + plane.d) / plane.c;

  const p0: Point3D = { x: 0, y: 0, z: gz(0, 0) };
  const p1: Point3D = { x: 10, y: 0, z: gz(10, 0) };
  const p2: Point3D = { x: 0, y: 10, z: gz(0, 10) };

  const p0t = transformFromWorld(transformToWorld(p0, sourceEgoPose, lidarToEgo), targetEgoPose, egoToLidar);
  const p1t = transformFromWorld(transformToWorld(p1, sourceEgoPose, lidarToEgo), targetEgoPose, egoToLidar);
  const p2t = transformFromWorld(transformToWorld(p2, sourceEgoPose, lidarToEgo), targetEgoPose, egoToLidar);

  const v1 = { x: p1t.x - p0t.x, y: p1t.y - p0t.y, z: p1t.z - p0t.z };
  const v2 = { x: p2t.x - p0t.x, y: p2t.y - p0t.y, z: p2t.z - p0t.z };

  let a = v1.y * v2.z - v1.z * v2.y;
  let b = v1.z * v2.x - v1.x * v2.z;
  let c = v1.x * v2.y - v1.y * v2.x;

  const len = Math.sqrt(a * a + b * b + c * c);
  if (len < 1e-10) return null;
  a /= len; b /= len; c /= len;

  if (c < 0) { a = -a; b = -b; c = -c; }

  const d = -(a * p0t.x + b * p0t.y + c * p0t.z);
  return { a, b, c, d };
};

const snapCuboidToGround = (
  cuboid: CuboidData,
  targetFrame: Frame,
  groundPlaneSourceFrame: Frame,
  detectedGroundPlane: { a: number; b: number; c: number; d: number } | null | undefined,
  nearestKfCuboid: CuboidData,
  nearestKfFrame: Frame,
  egoToLidar?: ExtrinsicCalibration
): CuboidData => {
  const lidarToEgo = egoToLidar ? getLidarToEgoTransform(egoToLidar) : undefined;
  let groundZ: number | null = null;

  if (detectedGroundPlane && Math.abs(detectedGroundPlane.c) > 0.001) {
    const targetPlane = transformGroundPlane(detectedGroundPlane, groundPlaneSourceFrame, targetFrame, egoToLidar);
    if (targetPlane && Math.abs(targetPlane.c) > 0.001) {
      const { x, y } = cuboid.center;
      groundZ = -(targetPlane.a * x + targetPlane.b * y + targetPlane.d) / targetPlane.c;
    }
  }

  if (groundZ === null) {
    const kfGroundPoint: Point3D = {
      x: nearestKfCuboid.center.x,
      y: nearestKfCuboid.center.y,
      z: nearestKfCuboid.center.z - nearestKfCuboid.dimensions.height / 2,
    };
    const worldGround = transformToWorld(kfGroundPoint, getEgoPose(nearestKfFrame), lidarToEgo);
    const targetGround = transformFromWorld(worldGround, getEgoPose(targetFrame), egoToLidar);
    groundZ = targetGround.z;
  }

  return {
    ...cuboid,
    center: { ...cuboid.center, z: groundZ + cuboid.dimensions.height / 2 },
  };
};

const normalizeAngle = (angle: number): number => {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  return angle;
};


const eulerToRotationMatrix = (yaw: number, pitch: number, roll: number): number[][] => {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);

  return [
    [cy*cp, cy*sp*sr - sy*cr, cy*sp*cr + sy*sr],
    [sy*cp, sy*sp*sr + cy*cr, sy*sp*cr - cy*sr],
    [-sp,   cp*sr,            cp*cr           ],
  ];
};

const rotationMatrixToEuler = (R: number[][]): { yaw: number; pitch: number; roll: number } => {
  const pitch = Math.asin(-R[2][0]);

  let yaw: number, roll: number;

  if (Math.abs(R[2][0]) < 0.9999) {
    yaw = Math.atan2(R[1][0], R[0][0]);
    roll = Math.atan2(R[2][1], R[2][2]);
  } else {
    yaw = Math.atan2(-R[0][1], R[1][1]);
    roll = 0;
  }

  return {
    yaw: normalizeAngle(yaw),
    pitch: normalizeAngle(pitch),
    roll: normalizeAngle(roll),
  };
};

const multiplyMatrices = (A: number[][], B: number[][]): number[][] => {
  return [
    [
      A[0][0]*B[0][0] + A[0][1]*B[1][0] + A[0][2]*B[2][0],
      A[0][0]*B[0][1] + A[0][1]*B[1][1] + A[0][2]*B[2][1],
      A[0][0]*B[0][2] + A[0][1]*B[1][2] + A[0][2]*B[2][2],
    ],
    [
      A[1][0]*B[0][0] + A[1][1]*B[1][0] + A[1][2]*B[2][0],
      A[1][0]*B[0][1] + A[1][1]*B[1][1] + A[1][2]*B[2][1],
      A[1][0]*B[0][2] + A[1][1]*B[1][2] + A[1][2]*B[2][2],
    ],
    [
      A[2][0]*B[0][0] + A[2][1]*B[1][0] + A[2][2]*B[2][0],
      A[2][0]*B[0][1] + A[2][1]*B[1][1] + A[2][2]*B[2][1],
      A[2][0]*B[0][2] + A[2][1]*B[1][2] + A[2][2]*B[2][2],
    ],
  ];
};

const transposeMatrix = (R: number[][]): number[][] => {
  return [
    [R[0][0], R[1][0], R[2][0]],
    [R[0][1], R[1][1], R[2][1]],
    [R[0][2], R[1][2], R[2][2]],
  ];
};

const transformRotationToWorld = (
  rotation: { yaw: number; pitch: number; roll: number },
  egoPose: EgoPose,
  lidarToEgo?: LidarToEgoTransform
): { yaw: number; pitch: number; roll: number } => {
  const R_box = eulerToRotationMatrix(rotation.yaw, rotation.pitch, rotation.roll);

  const R_ego = quaternionToRotationMatrix(egoPose.rotation);

  let R_world: number[][];
  if (lidarToEgo) {
    const R_l2e = lidarToEgo.rotation;
    const R_ego_l2e = multiplyMatrices(R_ego, R_l2e);
    R_world = multiplyMatrices(R_ego_l2e, R_box);
  } else {
    R_world = multiplyMatrices(R_ego, R_box);
  }

  return rotationMatrixToEuler(R_world);
};

const transformRotationFromWorld = (
  rotation: { yaw: number; pitch: number; roll: number },
  egoPose: EgoPose,
  egoToLidar?: EgoToLidarCalibration
): { yaw: number; pitch: number; roll: number } => {
  const R_world = eulerToRotationMatrix(rotation.yaw, rotation.pitch, rotation.roll);

  const R_ego = quaternionToRotationMatrix(egoPose.rotation);
  const R_ego_inv = transposeMatrix(R_ego);

  let R_lidar: number[][];
  if (egoToLidar) {
    const R_e2l = egoToLidar.rotation;
    const R_e2l_ego_inv = multiplyMatrices(R_e2l, R_ego_inv);
    R_lidar = multiplyMatrices(R_e2l_ego_inv, R_world);
  } else {
    R_lidar = multiplyMatrices(R_ego_inv, R_world);
  }

  return rotationMatrixToEuler(R_lidar);
};

const transformCuboidBetweenFrames = (
  cuboid: CuboidData,
  sourceFrame: Frame,
  targetFrame: Frame,
  egoToLidar?: ExtrinsicCalibration
): CuboidData => {
  const sourceEgoPose = getEgoPose(sourceFrame);
  const targetEgoPose = getEgoPose(targetFrame);

  const lidarToEgo = egoToLidar ? getLidarToEgoTransform(egoToLidar) : undefined;

  const worldCenter = transformToWorld(
    cuboid.center,
    sourceEgoPose,
    lidarToEgo
  );

  const targetCenter = transformFromWorld(
    worldCenter,
    targetEgoPose,
    egoToLidar
  );

  const worldRotation = transformRotationToWorld(
    {
      yaw: cuboid.rotation.yaw,
      pitch: cuboid.rotation.pitch || 0,
      roll: cuboid.rotation.roll || 0,
    },
    sourceEgoPose,
    lidarToEgo
  );

  const targetRotation = transformRotationFromWorld(
    worldRotation,
    targetEgoPose,
    egoToLidar
  );

  return {
    center: targetCenter,
    dimensions: { ...cuboid.dimensions },
    rotation: targetRotation,
  };
};

const cuboidToWorld = (
  cuboid: CuboidData,
  frame: Frame,
  egoToLidar?: ExtrinsicCalibration
): { center: Point3D; rotation: { yaw: number; pitch: number; roll: number }; dimensions: CuboidData['dimensions'] } => {
  const egoPose = getEgoPose(frame);
  const lidarToEgo = egoToLidar ? getLidarToEgoTransform(egoToLidar) : undefined;

  const worldCenter = transformToWorld(cuboid.center, egoPose, lidarToEgo);
  const worldRotation = transformRotationToWorld(
    {
      yaw: cuboid.rotation.yaw,
      pitch: cuboid.rotation.pitch || 0,
      roll: cuboid.rotation.roll || 0,
    },
    egoPose,
    lidarToEgo
  );

  return {
    center: worldCenter,
    rotation: worldRotation,
    dimensions: { ...cuboid.dimensions },
  };
};

const cuboidFromWorld = (
  worldCuboid: { center: Point3D; rotation: { yaw: number; pitch: number; roll: number }; dimensions: CuboidData['dimensions'] },
  frame: Frame,
  egoToLidar?: ExtrinsicCalibration
): CuboidData => {
  const egoPose = getEgoPose(frame);

  const lidarCenter = transformFromWorld(worldCuboid.center, egoPose, egoToLidar);
  const lidarRotation = transformRotationFromWorld(worldCuboid.rotation, egoPose, egoToLidar);

  return {
    center: lidarCenter,
    rotation: lidarRotation,
    dimensions: { ...worldCuboid.dimensions },
  };
};


interface TrackState {
  tracks: Map<string, Track>;
  activeTrackId: string | null;

  createTrack: (classId: string, attributes?: Record<string, unknown>) => Track;
  deleteTrack: (trackId: string) => void;
  getTrack: (trackId: string) => Track | undefined;
  setActiveTrack: (trackId: string | null) => void;

  addAnnotationToTrack: (trackId: string, frameId: string, annotationId: string, isKeyframe: boolean) => void;

  isKeyframe: (trackId: string, frameId: string) => boolean;
  markAsKeyframe: (trackId: string, frameId: string) => void;
  addKeyframe: (trackId: string, frameId: string, annotationId: string) => void;
  removeKeyframe: (trackId: string, frameId: string) => void;

  propagateTrack: (trackId: string, numFrames: number, direction?: 'forward' | 'backward' | 'both') => void;
  propagateAndInterpolateTrack: (trackId: string) => void;
  interpolateAroundKeyframe: (trackId: string, keyframeFrameId: string) => void;
  markAsKeyframeAndInterpolate: (trackId: string, frameId: string) => void;
  interpolateTrack: (trackId: string) => void;
  mergeTracks: (sourceTrackId: string, targetTrackId: string) => void;

  setTrackStart: (trackId: string, frameIndex: number | null) => void;
  setTrackEnd: (trackId: string, frameIndex: number | null) => void;
  isFrameInTrackRange: (trackId: string, frameIndex: number) => boolean;
  cleanupOutOfRangeAnnotations: (trackId: string) => void;

  initializeTracksFromAnnotations: (annotations: Map<string, Annotation>) => void;

  updateTrackIsStatic: (trackId: string, isStatic: boolean) => void;
}


export const useTrackStore = create<TrackState>((set, get) => ({
  tracks: new Map(),
  activeTrackId: null,


  createTrack: (classId, attributes = {}) => {
    const trackId = uuidv4();

    const track: Track = {
      id: trackId,
      class_id: classId,
      attributes,
      frame_annotations: new Map(),
      keyframe_ids: new Set(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      start_frame_index: null,
      end_frame_index: null,
      is_static: false,
    };

    const newTracks = new Map(get().tracks);
    newTracks.set(track.id, track);
    set({ tracks: newTracks, activeTrackId: track.id });

    return track;
  },

  deleteTrack: (trackId) => {
    const newTracks = new Map(get().tracks);
    newTracks.delete(trackId);
    set({
      tracks: newTracks,
      activeTrackId: get().activeTrackId === trackId ? null : get().activeTrackId
    });
  },

  getTrack: (trackId) => {
    return get().tracks.get(trackId);
  },

  setActiveTrack: (trackId) => {
    set({ activeTrackId: trackId });
  },


  addAnnotationToTrack: (trackId, frameId, annotationId, isKeyframe) => {

    const track = get().tracks.get(trackId);
    if (!track) {
      console.warn('[TrackStore] Track not found:', trackId);
      return;
    }

    const newFrameAnnotations = new Map(track.frame_annotations);
    newFrameAnnotations.set(frameId, annotationId);

    const newKeyframes = new Set(track.keyframe_ids);
    if (isKeyframe) {
      newKeyframes.add(frameId);
    }

    const editorStoreState = useEditorStore.getState();
    const targetFrame = editorStoreState.frames.find(f => f.id === frameId);
    let startIdx = track.start_frame_index;
    let endIdx = track.end_frame_index;
    if (targetFrame) {
      if (startIdx === null || targetFrame.frame_index < startIdx) {
        startIdx = targetFrame.frame_index;
      }
      if (endIdx === null || targetFrame.frame_index > endIdx) {
        endIdx = targetFrame.frame_index;
      }
    }

    const updatedTrack: Track = {
      ...track,
      frame_annotations: newFrameAnnotations,
      keyframe_ids: newKeyframes,
      start_frame_index: startIdx,
      end_frame_index: endIdx,
      updated_at: new Date().toISOString(),
    };

    const newTracks = new Map(get().tracks);
    newTracks.set(trackId, updatedTrack);
    set({ tracks: newTracks });

    const editorStore = useEditorStore.getState();
    editorStore.updateAnnotation(annotationId, {
      track_id: trackId,
      is_keyframe: isKeyframe,
      class_id: track.class_id,
      attributes: track.attributes
    });

  },


  isKeyframe: (trackId, frameId) => {
    const track = get().tracks.get(trackId);
    return track?.keyframe_ids.has(frameId) ?? false;
  },

  markAsKeyframe: (trackId, frameId) => {
    const track = get().tracks.get(trackId);
    if (!track) return;

    const newKeyframes = new Set(track.keyframe_ids);
    newKeyframes.add(frameId);

    const updatedTrack: Track = {
      ...track,
      keyframe_ids: newKeyframes,
      updated_at: new Date().toISOString(),
    };

    const newTracks = new Map(get().tracks);
    newTracks.set(trackId, updatedTrack);
    set({ tracks: newTracks });

    const annotationId = track.frame_annotations.get(frameId);
    if (annotationId) {
      useEditorStore.getState().updateAnnotation(annotationId, { is_keyframe: true });
    }

    if (newKeyframes.size >= 1) {
      setTimeout(() => {
        get().interpolateAroundKeyframe(trackId, frameId);
      }, 50);
    }
  },

  addKeyframe: (trackId, frameId, annotationId) => {
    const track = get().tracks.get(trackId);
    if (!track) return;

    const newKeyframes = new Set(track.keyframe_ids);
    const wasAlreadyKeyframe = newKeyframes.has(frameId);
    newKeyframes.add(frameId);

    const newFrameAnnotations = new Map(track.frame_annotations);
    newFrameAnnotations.set(frameId, annotationId);

    const updatedTrack: Track = {
      ...track,
      keyframe_ids: newKeyframes,
      frame_annotations: newFrameAnnotations,
      updated_at: new Date().toISOString(),
    };

    const newTracks = new Map(get().tracks);
    newTracks.set(trackId, updatedTrack);
    set({ tracks: newTracks });

    useEditorStore.getState().updateAnnotation(annotationId, {
      track_id: trackId,
      is_keyframe: true
    });

    if (!wasAlreadyKeyframe) {
      setTimeout(() => {
        get().interpolateAroundKeyframe(trackId, frameId);
      }, 100);
    }
  },

  removeKeyframe: (trackId, frameId) => {
    const track = get().tracks.get(trackId);
    if (!track) return;

    const newKeyframes = new Set(track.keyframe_ids);
    newKeyframes.delete(frameId);

    const updatedTrack: Track = {
      ...track,
      keyframe_ids: newKeyframes,
      updated_at: new Date().toISOString(),
    };

    const newTracks = new Map(get().tracks);
    newTracks.set(trackId, updatedTrack);
    set({ tracks: newTracks });

    const annotationId = track.frame_annotations.get(frameId);
    if (annotationId) {
      useEditorStore.getState().updateAnnotation(annotationId, { is_keyframe: false });
    }
  },


  propagateTrack: (trackId, numFrames, direction = 'forward') => {
    const track = get().tracks.get(trackId);
    if (!track) {
      return;
    }

    const editorStore = useEditorStore.getState();
    const { currentFrame, frames, annotations, task, activeClassId, scene, lidarView } = editorStore;
    const detectedGroundPlane = lidarView?.detectedGroundPlane;

    if (!currentFrame || !task) {
      return;
    }

    const egoToLidar = scene?.calibration?.ego_to_lidar;

    let sourceAnnotationId = track.frame_annotations.get(currentFrame.id);

    if (!sourceAnnotationId) {
      annotations.forEach((ann, annId) => {
        if (ann.track_id === trackId && ann.frame_id === currentFrame.id) {
          sourceAnnotationId = annId;
        }
      });
    }

    if (!sourceAnnotationId) {
      return;
    }

    const sourceAnnotation = annotations.get(sourceAnnotationId);
    if (!sourceAnnotation || sourceAnnotation.type !== 'cuboid') {
      return;
    }

    const sortedFrames = [...frames].sort((a, b) => a.frame_index - b.frame_index);
    const currentIdx = sortedFrames.findIndex(f => f.id === currentFrame.id);

    if (currentIdx === -1) {
      return;
    }

    let targetFrames: typeof sortedFrames = [];
    if (direction === 'forward') {
      targetFrames = sortedFrames.slice(currentIdx + 1, currentIdx + 1 + numFrames);
    } else if (direction === 'backward') {
      const startIdx = Math.max(0, currentIdx - numFrames);
      targetFrames = sortedFrames.slice(startIdx, currentIdx);
    } else if (direction === 'both') {
      const backwardStartIdx = Math.max(0, currentIdx - numFrames);
      const backwardFrames = sortedFrames.slice(backwardStartIdx, currentIdx);
      const forwardFrames = sortedFrames.slice(currentIdx + 1, currentIdx + 1 + numFrames);
      targetFrames = [...backwardFrames, ...forwardFrames];
    }

    if (targetFrames.length === 0) {
      return;
    }


    const sourceCuboid = sourceAnnotation.data as CuboidData;

    const newAnnotations: Annotation[] = [];
    const annotationUpdates: Array<{ id: string; data: CuboidData }> = [];
    const updatedFrameAnnotations = new Map(track.frame_annotations);
    const newKeyframes = new Set(track.keyframe_ids);

    if (!newKeyframes.has(currentFrame.id)) {
      newKeyframes.add(currentFrame.id);
    }


    for (const targetFrame of targetFrames) {
      let transformedCuboid = transformCuboidBetweenFrames(
        sourceCuboid,
        currentFrame,
        targetFrame,
        egoToLidar
      );

      transformedCuboid = snapCuboidToGround(
        transformedCuboid,
        targetFrame,
        currentFrame,
        detectedGroundPlane,
        sourceCuboid,
        currentFrame,
        egoToLidar
      );

      const existingAnnotationId = track.frame_annotations.get(targetFrame.id);

      if (existingAnnotationId) {
        const existingAnn = annotations.get(existingAnnotationId);
        if (existingAnn && !existingAnn.is_keyframe) {
          annotationUpdates.push({ id: existingAnnotationId, data: transformedCuboid });
        }
      } else {
        const newAnnotation: Annotation = {
          id: uuidv4(),
          task_id: task.id,
          frame_id: targetFrame.id,
          track_id: trackId,
          type: 'cuboid' as AnnotationType,
          class_id: track.class_id || activeClassId || sourceAnnotation.class_id,
          data: transformedCuboid,
          attributes: track.attributes || {},
          source: 'propagated' as AnnotationSource,
          is_verified: true,
          is_keyframe: false,
          is_static: track.is_static ?? false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        newAnnotations.push(newAnnotation);
        updatedFrameAnnotations.set(targetFrame.id, newAnnotation.id);
      }
    }

    if (newAnnotations.length > 0 || annotationUpdates.length > 0) {
      const latestEditorState = useEditorStore.getState();
      const currentAnnotations = new Map(latestEditorState.annotations);
      const currentDirty = new Map(latestEditorState.dirtyAnnotations);

      for (const ann of newAnnotations) {
        currentAnnotations.set(ann.id, ann);
        currentDirty.set(ann.id, 'new');
      }

      for (const { id, data } of annotationUpdates) {
        const ann = currentAnnotations.get(id);
        if (ann) {
          currentAnnotations.set(id, {
            ...ann,
            data,
            source: 'propagated' as AnnotationSource,
            updated_at: new Date().toISOString()
          });
          if (!currentDirty.has(id) || currentDirty.get(id) !== 'new') {
            currentDirty.set(id, 'modified');
          }
        }
      }

      const sourceAnn = currentAnnotations.get(sourceAnnotationId);
      if (sourceAnn && !sourceAnn.is_keyframe) {
        currentAnnotations.set(sourceAnnotationId, { ...sourceAnn, is_keyframe: true });
        currentDirty.set(sourceAnnotationId, 'modified');
      }

      useEditorStore.setState({
        annotations: currentAnnotations,
        dirtyAnnotations: currentDirty
      });

      let minFrameIdx = Infinity;
      let maxFrameIdx = -Infinity;
      for (const frameId of updatedFrameAnnotations.keys()) {
        const frame = sortedFrames.find(f => f.id === frameId);
        if (frame) {
          minFrameIdx = Math.min(minFrameIdx, frame.frame_index);
          maxFrameIdx = Math.max(maxFrameIdx, frame.frame_index);
        }
      }

      const computedStartIdx = minFrameIdx === Infinity ? null : minFrameIdx;
      const computedEndIdx = maxFrameIdx === -Infinity ? null : maxFrameIdx;

      const updatedTrack: Track = {
        ...track,
        frame_annotations: updatedFrameAnnotations,
        keyframe_ids: newKeyframes,
        start_frame_index: computedStartIdx,
        end_frame_index: computedEndIdx,
        updated_at: new Date().toISOString(),
      };

      const newTracks = new Map(get().tracks);
      newTracks.set(trackId, updatedTrack);
      set({ tracks: newTracks });
    }
  },


  markAsKeyframeAndInterpolate: (trackId, frameId) => {
    const track = get().tracks.get(trackId);
    if (!track) {
      console.error('[TrackStore] Track not found:', trackId);
      return;
    }

    const editorStore = useEditorStore.getState();
    const { frames, annotations, scene } = editorStore;

    const egoToLidar = scene?.calibration?.ego_to_lidar;
    if (!egoToLidar) {
      console.warn('[TrackStore] markAsKeyframeAndInterpolate: No ego_to_lidar calibration, interpolation may be inaccurate');
    }

    const newKeyframes = new Set(track.keyframe_ids);
    newKeyframes.add(frameId);

    const sortedFrames = [...frames].sort((a, b) => a.frame_index - b.frame_index);
    const frameIndexMap = new Map(sortedFrames.map((f, i) => [f.id, i]));
    const currentFrameIdx = frameIndexMap.get(frameId);

    if (currentFrameIdx === undefined) {
      console.error('[TrackStore] Frame not found in sorted frames');
      return;
    }

    const currFrame = sortedFrames[currentFrameIdx];
    const currAnnId = track.frame_annotations.get(currFrame.id);
    const currAnn = currAnnId ? annotations.get(currAnnId) : null;
    const currentDimensions = (currAnn?.type === 'cuboid' && currAnn?.data)
      ? (currAnn.data as CuboidData).dimensions
      : null;

    let maxDimensions = currentDimensions ? { ...currentDimensions } : { length: 0, width: 0, height: 0 };

    track.keyframe_ids.forEach(kfFrameId => {
      const kfAnnId = track.frame_annotations.get(kfFrameId);
      if (kfAnnId) {
        const kfAnn = annotations.get(kfAnnId);
        if (kfAnn && kfAnn.type === 'cuboid') {
          const kfDims = (kfAnn.data as CuboidData).dimensions;
          maxDimensions = {
            length: Math.max(maxDimensions.length, kfDims.length),
            width: Math.max(maxDimensions.width, kfDims.width),
            height: Math.max(maxDimensions.height, kfDims.height),
          };
        }
      }
    });

    console.log(`[TrackStore] markAsKeyframeAndInterpolate: trackId=${trackId.slice(0,8)}, frameId=${frameId.slice(0,8)}, maxDimensions=`, maxDimensions);

    // Find previous and next keyframes
    const keyframeIndices = Array.from(newKeyframes)
      .map(kfId => frameIndexMap.get(kfId))
      .filter((idx): idx is number => idx !== undefined)
      .sort((a, b) => a - b);

    const currentKfIdx = keyframeIndices.indexOf(currentFrameIdx);
    const prevKfFrameIdx = currentKfIdx > 0 ? keyframeIndices[currentKfIdx - 1] : null;
    const nextKfFrameIdx = currentKfIdx < keyframeIndices.length - 1 ? keyframeIndices[currentKfIdx + 1] : null;

    // Find track boundaries (first and last frames with annotations)
    const trackFrameIndices = Array.from(track.frame_annotations.keys())
      .map(fid => frameIndexMap.get(fid))
      .filter((idx): idx is number => idx !== undefined)
      .sort((a, b) => a - b);
    const trackStartIdx = trackFrameIndices.length > 0 ? trackFrameIndices[0] : null;
    const trackEndIdx = trackFrameIndices.length > 0 ? trackFrameIndices[trackFrameIndices.length - 1] : null;

    // Prepare interpolation updates
    const annotationUpdates: Array<{ id: string; data: CuboidData }> = [];

    // CASE 1: Interpolate between previous keyframe and current (in WORLD FRAME)
    if (prevKfFrameIdx !== null) {
      const prevFrame = sortedFrames[prevKfFrameIdx];
      const currFrameCase1 = sortedFrames[currentFrameIdx];

      const prevAnnId = track.frame_annotations.get(prevFrame.id);
      const currAnnIdCase1 = track.frame_annotations.get(currFrameCase1.id);

      if (prevAnnId && currAnnIdCase1) {
        const prevAnn = annotations.get(prevAnnId);
        const currAnnCase1 = annotations.get(currAnnIdCase1);

        if (prevAnn && currAnnCase1 && prevAnn.type === 'cuboid' && currAnnCase1.type === 'cuboid') {
          const prevData = prevAnn.data as CuboidData;
          const currDataCase1 = currAnnCase1.data as CuboidData;

          // Transform keyframe cuboids to world frame
          const prevWorld = cuboidToWorld(prevData, prevFrame, egoToLidar);
          const currWorldCase1 = cuboidToWorld(currDataCase1, currFrameCase1, egoToLidar);

          // Interpolate frames between prev and current in world frame
          for (let i = prevKfFrameIdx + 1; i < currentFrameIdx; i++) {
            const midFrame = sortedFrames[i];
            const midAnnId = track.frame_annotations.get(midFrame.id);

            if (midAnnId) {
              const t = (i - prevKfFrameIdx) / (currentFrameIdx - prevKfFrameIdx);

              // Interpolate in world frame
              const worldInterpolated = {
                center: {
                  x: lerp(prevWorld.center.x, currWorldCase1.center.x, t),
                  y: lerp(prevWorld.center.y, currWorldCase1.center.y, t),
                  z: lerp(prevWorld.center.z, currWorldCase1.center.z, t),
                },
                rotation: {
                  yaw: lerpAngle(prevWorld.rotation.yaw, currWorldCase1.rotation.yaw, t),
                  pitch: lerpAngle(prevWorld.rotation.pitch, currWorldCase1.rotation.pitch, t),
                  roll: lerpAngle(prevWorld.rotation.roll, currWorldCase1.rotation.roll, t),
                },
                // Use the MAX dimensions across all keyframes for consistency
                dimensions: { ...maxDimensions },
              };

              // Transform back to mid frame's LiDAR coordinates
              const lidarInterpolated = cuboidFromWorld(worldInterpolated, midFrame, egoToLidar);
              annotationUpdates.push({ id: midAnnId, data: lidarInterpolated });
            }
          }
        }
      }
    }

    // CASE 2: Interpolate between current and next keyframe (in WORLD FRAME)
    if (nextKfFrameIdx !== null) {
      const currFrameCase2 = sortedFrames[currentFrameIdx];
      const nextFrame = sortedFrames[nextKfFrameIdx];

      const currAnnIdCase2 = track.frame_annotations.get(currFrameCase2.id);
      const nextAnnId = track.frame_annotations.get(nextFrame.id);

      if (currAnnIdCase2 && nextAnnId) {
        const currAnnCase2 = annotations.get(currAnnIdCase2);
        const nextAnn = annotations.get(nextAnnId);

        if (currAnnCase2 && nextAnn && currAnnCase2.type === 'cuboid' && nextAnn.type === 'cuboid') {
          const currDataCase2 = currAnnCase2.data as CuboidData;
          const nextData = nextAnn.data as CuboidData;

          // Transform keyframe cuboids to world frame
          const currWorldCase2 = cuboidToWorld(currDataCase2, currFrameCase2, egoToLidar);
          const nextWorld = cuboidToWorld(nextData, nextFrame, egoToLidar);

          // Interpolate frames between current and next in world frame
          for (let i = currentFrameIdx + 1; i < nextKfFrameIdx; i++) {
            const midFrame = sortedFrames[i];
            const midAnnId = track.frame_annotations.get(midFrame.id);

            if (midAnnId) {
              const t = (i - currentFrameIdx) / (nextKfFrameIdx - currentFrameIdx);

              // Interpolate in world frame
              const worldInterpolated = {
                center: {
                  x: lerp(currWorldCase2.center.x, nextWorld.center.x, t),
                  y: lerp(currWorldCase2.center.y, nextWorld.center.y, t),
                  z: lerp(currWorldCase2.center.z, nextWorld.center.z, t),
                },
                rotation: {
                  yaw: lerpAngle(currWorldCase2.rotation.yaw, nextWorld.rotation.yaw, t),
                  pitch: lerpAngle(currWorldCase2.rotation.pitch, nextWorld.rotation.pitch, t),
                  roll: lerpAngle(currWorldCase2.rotation.roll, nextWorld.rotation.roll, t),
                },
                // Use the MAX dimensions across all keyframes for consistency
                dimensions: { ...maxDimensions },
              };

              // Transform back to mid frame's LiDAR coordinates
              const lidarInterpolated = cuboidFromWorld(worldInterpolated, midFrame, egoToLidar);
              annotationUpdates.push({ id: midAnnId, data: lidarInterpolated });
            }
          }
        }
      }
    }

    // CASE 3: Edge propagation - frames BEFORE the first keyframe
    // These frames have no previous keyframe to interpolate from, so we propagate from the first keyframe
    const firstKeyframeIdx = keyframeIndices.length > 0 ? keyframeIndices[0] : null;
    if (firstKeyframeIdx !== null && trackStartIdx !== null && trackStartIdx < firstKeyframeIdx) {
      const firstKfFrame = sortedFrames[firstKeyframeIdx];
      const firstKfAnnId = track.frame_annotations.get(firstKfFrame.id);
      const firstKfAnn = firstKfAnnId ? annotations.get(firstKfAnnId) : null;

      if (firstKfAnn && firstKfAnn.type === 'cuboid') {
        const firstKfData = firstKfAnn.data as CuboidData;
        // Use max dimensions for consistency
        const firstKfWorld = cuboidToWorld({ ...firstKfData, dimensions: maxDimensions }, firstKfFrame, egoToLidar);

        console.log(`[TrackStore] Edge propagation: Propagating backward from first keyframe ${firstKeyframeIdx} to track start ${trackStartIdx}`);

        // Propagate from first keyframe backward to track start
        for (let i = trackStartIdx; i < firstKeyframeIdx; i++) {
          const targetFrame = sortedFrames[i];
          const targetAnnId = track.frame_annotations.get(targetFrame.id);

          if (targetAnnId) {
            // Transform from world to target frame's LiDAR coordinates (ego motion compensation)
            const lidarTransformed = cuboidFromWorld(firstKfWorld, targetFrame, egoToLidar);
            annotationUpdates.push({ id: targetAnnId, data: lidarTransformed });
          }
        }
      }
    }

    // CASE 4: Edge propagation - frames AFTER the last keyframe
    // These frames have no next keyframe to interpolate to, so we propagate from the last keyframe
    const lastKeyframeIdx = keyframeIndices.length > 0 ? keyframeIndices[keyframeIndices.length - 1] : null;
    if (lastKeyframeIdx !== null && trackEndIdx !== null && trackEndIdx > lastKeyframeIdx) {
      const lastKfFrame = sortedFrames[lastKeyframeIdx];
      const lastKfAnnId = track.frame_annotations.get(lastKfFrame.id);
      const lastKfAnn = lastKfAnnId ? annotations.get(lastKfAnnId) : null;

      if (lastKfAnn && lastKfAnn.type === 'cuboid') {
        const lastKfData = lastKfAnn.data as CuboidData;
        // Use max dimensions for consistency
        const lastKfWorld = cuboidToWorld({ ...lastKfData, dimensions: maxDimensions }, lastKfFrame, egoToLidar);

        console.log(`[TrackStore] Edge propagation: Propagating forward from last keyframe ${lastKeyframeIdx} to track end ${trackEndIdx}`);

        // Propagate from last keyframe forward to track end
        for (let i = lastKeyframeIdx + 1; i <= trackEndIdx; i++) {
          const targetFrame = sortedFrames[i];
          const targetAnnId = track.frame_annotations.get(targetFrame.id);

          if (targetAnnId) {
            // Transform from world to target frame's LiDAR coordinates (ego motion compensation)
            const lidarTransformed = cuboidFromWorld(lastKfWorld, targetFrame, egoToLidar);
            annotationUpdates.push({ id: targetAnnId, data: lidarTransformed });
          }
        }
      }
    }

    // CASE 5: Sync MAX dimensions across ALL keyframes
    // When dimensions change on any keyframe, update all keyframes to use max dimensions
    for (const kfIdx of keyframeIndices) {
      const kfFrame = sortedFrames[kfIdx];
      const kfAnnId = track.frame_annotations.get(kfFrame.id);
      if (!kfAnnId) continue; // Skip if no annotation for this keyframe

      const kfAnn = annotations.get(kfAnnId);

      if (kfAnn && kfAnn.type === 'cuboid') {
        const kfData = kfAnn.data as CuboidData;
        // Only update if dimensions are different from max
        if (kfData.dimensions.length !== maxDimensions.length ||
            kfData.dimensions.width !== maxDimensions.width ||
            kfData.dimensions.height !== maxDimensions.height) {
          const updatedData: CuboidData = {
            ...kfData,
            dimensions: { ...maxDimensions },
          };
          annotationUpdates.push({ id: kfAnnId, data: updatedData });
          console.log(`[TrackStore] Syncing max dimensions to keyframe at idx ${kfIdx}`);
        }
      }
    }

    // CASE 6: Sync MAX dimensions to ALL non-keyframe frames that weren't already updated
    // This ensures dimension changes are propagated to all frames in the track
    const updatedIds = new Set(annotationUpdates.map(u => u.id));

    for (const [fid, annId] of track.frame_annotations.entries()) {
      // Skip already-updated frames
      if (updatedIds.has(annId)) continue;

      const ann = annotations.get(annId);
      if (ann && ann.type === 'cuboid') {
        const annData = ann.data as CuboidData;
        // Only update if dimensions are different from max
        if (annData.dimensions.length !== maxDimensions.length ||
            annData.dimensions.width !== maxDimensions.width ||
            annData.dimensions.height !== maxDimensions.height) {
          const updatedData: CuboidData = {
            ...annData,
            dimensions: { ...maxDimensions },
          };
          annotationUpdates.push({ id: annId, data: updatedData });
          console.log(`[TrackStore] CASE 6: Syncing max dimensions to frame ${fid.slice(0,8)}`);
        }
      }
    }


    // BATCH UPDATE: Apply all interpolation updates + keyframe update
    // Get latest state to avoid race conditions
    const latestEditorState = useEditorStore.getState();
    const currentAnnotationsMap = new Map(latestEditorState.annotations);
    const currentDirtyMap = new Map(latestEditorState.dirtyAnnotations);

    // Apply all interpolation/dimension updates
    for (const { id, data } of annotationUpdates) {
      const ann = currentAnnotationsMap.get(id);
      if (ann) {
        currentAnnotationsMap.set(id, {
          ...ann,
          data,
          source: 'auto_interpolated' as AnnotationSource,
          updated_at: new Date().toISOString()
        });
        if (!currentDirtyMap.has(id) || currentDirtyMap.get(id) !== 'new') {
          currentDirtyMap.set(id, 'modified');
        }
      }
    }

    // Always mark current frame's annotation as keyframe
    const currAnnIdBatch = track.frame_annotations.get(frameId);
    if (currAnnIdBatch) {
      const currAnnBatch = currentAnnotationsMap.get(currAnnIdBatch);
      if (currAnnBatch) {
        currentAnnotationsMap.set(currAnnIdBatch, { ...currAnnBatch, is_keyframe: true });
        if (!currentDirtyMap.has(currAnnIdBatch) || currentDirtyMap.get(currAnnIdBatch) !== 'new') {
          currentDirtyMap.set(currAnnIdBatch, 'modified');
        }
      }
    }

    useEditorStore.setState({
      annotations: currentAnnotationsMap,
      dirtyAnnotations: currentDirtyMap
    });

    console.log(`[TrackStore] markAsKeyframeAndInterpolate complete: ${annotationUpdates.length} updates applied`);

    // Update track keyframes
    const updatedTrack: Track = {
      ...track,
      keyframe_ids: newKeyframes,
      updated_at: new Date().toISOString(),
    };

    const newTracks = new Map(get().tracks);
    newTracks.set(trackId, updatedTrack);
    set({ tracks: newTracks });

  },

  // ---------------------------------------------------------------------------
  // Interpolate all frames between keyframes in a track (in WORLD FRAME)
  // ---------------------------------------------------------------------------

  interpolateTrack: (trackId) => {
    const track = get().tracks.get(trackId);
    if (!track || track.keyframe_ids.size < 1) {
      console.warn('[TrackStore] interpolateTrack: Need at least 1 keyframe. Current keyframes:', track?.keyframe_ids.size ?? 0);
      return;
    }

    // Route manual interpolation to the full-track path so all entry points
    // share the same propagation/interpolation behavior.
    get().propagateAndInterpolateTrack(trackId);
  },

  // ---------------------------------------------------------------------------
  // Merge two tracks
  // ---------------------------------------------------------------------------

  mergeTracks: (sourceTrackId, targetTrackId) => {
    const sourceTrack = get().tracks.get(sourceTrackId);
    const targetTrack = get().tracks.get(targetTrackId);

    if (!sourceTrack || !targetTrack) {
      console.error('[TrackStore] Track not found');
      return;
    }

    const editorStore = useEditorStore.getState();

    // Merge frame annotations - target takes precedence on conflicts
    const mergedFrameAnnotations = new Map(targetTrack.frame_annotations);
    sourceTrack.frame_annotations.forEach((annId, frameId) => {
      if (!mergedFrameAnnotations.has(frameId)) {
        mergedFrameAnnotations.set(frameId, annId);
      }
    });

    // Merge keyframes
    const mergedKeyframes = new Set(targetTrack.keyframe_ids);
    sourceTrack.keyframe_ids.forEach(kf => mergedKeyframes.add(kf));

    // Update target track
    const updatedTarget: Track = {
      ...targetTrack,
      frame_annotations: mergedFrameAnnotations,
      keyframe_ids: mergedKeyframes,
      updated_at: new Date().toISOString(),
    };

    // Update annotations to point to target track
    const currentAnnotations = new Map(editorStore.annotations);
    const currentDirty = new Map(editorStore.dirtyAnnotations);

    sourceTrack.frame_annotations.forEach((annId) => {
      const ann = currentAnnotations.get(annId);
      if (ann) {
        currentAnnotations.set(annId, { ...ann, track_id: targetTrackId });
        if (!currentDirty.has(annId) || currentDirty.get(annId) !== 'new') {
          currentDirty.set(annId, 'modified');
        }
      }
    });

    useEditorStore.setState({
      annotations: currentAnnotations,
      dirtyAnnotations: currentDirty
    });

    // Delete source track, update target
    const newTracks = new Map(get().tracks);
    newTracks.delete(sourceTrackId);
    newTracks.set(targetTrackId, updatedTarget);
    set({ tracks: newTracks });

  },

  // ---------------------------------------------------------------------------
  // Initialize tracks from loaded annotations
  // ---------------------------------------------------------------------------

  initializeTracksFromAnnotations: (annotations) => {
    // Skip if we're being called with empty annotations (prevents re-init during state updates)
    if (annotations.size === 0) {
      return;
    }

    // Start with existing tracks
    const existingTracks = get().tracks;
    const newTracks = new Map<string, Track>(existingTracks);

    // Group annotations by track_id
    const annotationsByTrack = new Map<string, Annotation[]>();

    annotations.forEach((ann) => {
      if (ann.track_id) {
        const existing = annotationsByTrack.get(ann.track_id) || [];
        existing.push(ann);
        annotationsByTrack.set(ann.track_id, existing);
      }
    });

    // Merge annotations into tracks
    annotationsByTrack.forEach((trackAnnotations, trackId) => {
      if (trackAnnotations.length === 0) return;

      const firstAnn = trackAnnotations[0];

      // Check if track already exists
      const existingTrack = newTracks.get(trackId);

      if (existingTrack) {
        // Merge new annotations into existing track
        const frameAnnotations = new Map(existingTrack.frame_annotations);
        const keyframeIds = new Set(existingTrack.keyframe_ids);

        trackAnnotations.forEach((ann) => {
          frameAnnotations.set(ann.frame_id, ann.id);
          if (ann.is_keyframe) {
            keyframeIds.add(ann.frame_id);
          }
        });

        const updatedTrack: Track = {
          ...existingTrack,
          frame_annotations: frameAnnotations,
          keyframe_ids: keyframeIds,
          updated_at: new Date().toISOString(),
          // Ensure new fields exist (for backwards compatibility with old tracks)
          start_frame_index: existingTrack.start_frame_index ?? null,
          end_frame_index: existingTrack.end_frame_index ?? null,
          is_static: existingTrack.is_static ?? false,
        };

        newTracks.set(trackId, updatedTrack);
      } else {
        // Create new track
        const frameAnnotations = new Map<string, string>();
        const keyframeIds = new Set<string>();

        trackAnnotations.forEach((ann) => {
          frameAnnotations.set(ann.frame_id, ann.id);
          if (ann.is_keyframe) {
            keyframeIds.add(ann.frame_id);
          }
        });

        const track: Track = {
          id: trackId,
          class_id: firstAnn.class_id,
          attributes: firstAnn.attributes,
          frame_annotations: frameAnnotations,
          keyframe_ids: keyframeIds,
          created_at: firstAnn.created_at,
          updated_at: new Date().toISOString(),
          // Initialize lifecycle boundaries as unbounded
          start_frame_index: null,
          end_frame_index: null,
          // Read is_static from the annotation (keyframe annotation takes priority)
          is_static: trackAnnotations.find(a => a.is_keyframe)?.is_static
            ?? firstAnn.is_static
            ?? false,
        };

        newTracks.set(trackId, track);
      }
    });

    set({ tracks: newTracks });
  },

  // ---------------------------------------------------------------------------
  // Track Lifecycle Management (NEW)
  // ---------------------------------------------------------------------------

  setTrackStart: (trackId, frameIndex) => {
    const track = get().tracks.get(trackId);
    if (!track) return;

    const updatedTrack: Track = {
      ...track,
      start_frame_index: frameIndex,
      updated_at: new Date().toISOString(),
    };

    const newTracks = new Map(get().tracks);
    newTracks.set(trackId, updatedTrack);
    set({ tracks: newTracks });

    // Cleanup annotations outside new range
    get().cleanupOutOfRangeAnnotations(trackId);
  },

  setTrackEnd: (trackId, frameIndex) => {
    const track = get().tracks.get(trackId);
    if (!track) return;

    const updatedTrack: Track = {
      ...track,
      end_frame_index: frameIndex,
      updated_at: new Date().toISOString(),
    };

    const newTracks = new Map(get().tracks);
    newTracks.set(trackId, updatedTrack);
    set({ tracks: newTracks });

    // Cleanup annotations outside new range
    get().cleanupOutOfRangeAnnotations(trackId);
  },

  isFrameInTrackRange: (trackId, frameIndex) => {
    const track = get().tracks.get(trackId);
    if (!track) return false;

    const startOk = track.start_frame_index === null || frameIndex >= track.start_frame_index;
    const endOk = track.end_frame_index === null || frameIndex <= track.end_frame_index;

    return startOk && endOk;
  },

  cleanupOutOfRangeAnnotations: (trackId) => {
    const track = get().tracks.get(trackId);
    if (!track) return;

    const editorStore = useEditorStore.getState();
    const { frames, annotations, dirtyAnnotations } = editorStore;

    // Build frame index lookup
    const sortedFrames = [...frames].sort((a, b) => a.frame_index - b.frame_index);
    const frameIdToIndex = new Map(sortedFrames.map(f => [f.id, f.frame_index]));

    const isInRange = (frameIdx: number): boolean => {
      const startOk = track.start_frame_index === null || frameIdx >= track.start_frame_index;
      const endOk = track.end_frame_index === null || frameIdx <= track.end_frame_index;
      return startOk && endOk;
    };

    const currentAnnotations = new Map(annotations);
    const currentDirty = new Map(dirtyAnnotations);
    const persistedIds = editorStore.persistedAnnotationIds;

    // Collect annotations for this track that are outside the user-selected range.
    const annotationsToDelete: string[] = [];
    currentAnnotations.forEach((ann, annId) => {
      if (ann.track_id !== trackId) return;
      const frameIdx = frameIdToIndex.get(ann.frame_id);
      if (frameIdx === undefined || !isInRange(frameIdx)) {
        annotationsToDelete.push(annId);
      }
    });

    for (const annId of annotationsToDelete) {
      currentAnnotations.delete(annId);
      if (currentDirty.get(annId) === 'new' || !persistedIds.has(annId)) {
        // Never reached the server — just remove from dirty state, no server delete needed.
        currentDirty.delete(annId);
      } else {
        // Exists on the server — mark for deletion so autosave sends a bulk-delete.
        currentDirty.set(annId, 'deleted');
      }
    }

    // Rebuild frame_annotations map from what remains.
    const newFrameAnnotations = new Map<string, string>();
    currentAnnotations.forEach((ann, annId) => {
      if (ann.track_id !== trackId) return;
      newFrameAnnotations.set(ann.frame_id, annId);
    });

    const newKeyframes = new Set<string>();
    newFrameAnnotations.forEach((annId, frameId) => {
      const ann = currentAnnotations.get(annId);
      if (ann?.is_keyframe) newKeyframes.add(frameId);
    });

    const updatedTrack: Track = {
      ...track,
      frame_annotations: newFrameAnnotations,
      keyframe_ids: newKeyframes,
      updated_at: new Date().toISOString(),
    };

    const newTracks = new Map(get().tracks);
    newTracks.set(trackId, updatedTrack);
    set({ tracks: newTracks });

    useEditorStore.setState({ annotations: currentAnnotations, dirtyAnnotations: currentDirty });

    console.log(
      `[TrackStore] cleanupOutOfRangeAnnotations: removed ${annotationsToDelete.length} out-of-range annotations for track ${trackId.slice(0, 8)}`
    );
  },

  // ---------------------------------------------------------------------------
  // Track property updates
  // ---------------------------------------------------------------------------

  updateTrackIsStatic: (trackId, isStatic) => {
    const track = get().tracks.get(trackId);
    if (!track) return;

    // Update track-level flag
    const newTracks = new Map(get().tracks);
    newTracks.set(trackId, { ...track, is_static: isStatic, updated_at: new Date().toISOString() });
    set({ tracks: newTracks });

    // Sync is_static to every annotation belonging to this track
    const { annotations, dirtyAnnotations } = useEditorStore.getState();
    const newAnnotations = new Map(annotations);
    const newDirty = new Map(dirtyAnnotations);
    let changed = false;

    newAnnotations.forEach((ann, annId) => {
      if (ann.track_id === trackId && ann.is_static !== isStatic) {
        newAnnotations.set(annId, { ...ann, is_static: isStatic });
        if (newDirty.get(annId) !== 'new') newDirty.set(annId, 'modified');
        changed = true;
      }
    });

    if (changed) {
      useEditorStore.setState({ annotations: newAnnotations, dirtyAnnotations: newDirty });
    }

    console.log(`[TrackStore] Set track ${trackId.slice(0, 8)} is_static=${isStatic}`);
  },

  // ---------------------------------------------------------------------------
  // Combined Propagate and Interpolate (NEW)
  // Propagates to all frames in range, then interpolates between keyframes,
  // then velocity-predicts beyond keyframes
  // ---------------------------------------------------------------------------

  propagateAndInterpolateTrack: (trackId) => {
    const track = get().tracks.get(trackId);
    if (!track || track.keyframe_ids.size === 0) {
      console.warn('[TrackStore] propagateAndInterpolateTrack: No keyframes to work with');
      return;
    }

    const editorStore = useEditorStore.getState();
    const { frames, annotations, scene } = editorStore;

    const egoToLidar = scene?.calibration?.ego_to_lidar;
    const sortedFrames = [...frames].sort((a, b) => a.frame_index - b.frame_index);
    if (sortedFrames.length === 0) return;
    const frameIndexMap = new Map(sortedFrames.map((f, i) => [f.id, i]));
    const frameNumberToArrayIndex = new Map(sortedFrames.map((f, i) => [f.frame_index, i]));

    const findTrackAnnotationIdForFrame = (frameId: string, requireKeyframe: boolean = false): string | null => {
      const mappedAnnId = track.frame_annotations.get(frameId);
      const mappedAnn = mappedAnnId ? annotations.get(mappedAnnId) : null;
      if (
        mappedAnn &&
        mappedAnn.track_id === trackId &&
        mappedAnn.frame_id === frameId &&
        mappedAnn.type === 'cuboid' &&
        (!requireKeyframe || mappedAnn.is_keyframe)
      ) {
        return mappedAnnId!;
      }

      for (const [annId, ann] of annotations.entries()) {
        if (
          ann.track_id === trackId &&
          ann.frame_id === frameId &&
          ann.type === 'cuboid' &&
          (!requireKeyframe || ann.is_keyframe)
        ) {
          return annId;
        }
      }
      return null;
    };

    // Get keyframes sorted by frame index
    const keyframeData: Array<{
      frameId: string;
      frameIdx: number;
      frame: Frame;
      cuboid: CuboidData;
    }> = [];

    track.keyframe_ids.forEach(frameId => {
      const frameIdx = frameIndexMap.get(frameId);
      const annId = findTrackAnnotationIdForFrame(frameId, true);
      if (frameIdx !== undefined && annId) {
        const ann = annotations.get(annId);
        if (ann && ann.type === 'cuboid') {
          const frame = sortedFrames[frameIdx];
          const cuboidData = ann.data as CuboidData;
          console.log(`[TrackStore] Keyframe ${frameIdx}: center=(${cuboidData.center.x.toFixed(2)}, ${cuboidData.center.y.toFixed(2)}, ${cuboidData.center.z.toFixed(2)})`);
          keyframeData.push({
            frameId,
            frameIdx,
            frame,
            cuboid: cuboidData,
          });
        }
      }
    });

    keyframeData.sort((a, b) => a.frameIdx - b.frameIdx);

    if (keyframeData.length === 0) return;

    // Determine track range
    // Consider: explicit boundaries, keyframes, AND existing frame_annotations
    const explicitStartIdx = track.start_frame_index !== null
      ? (frameNumberToArrayIndex.get(track.start_frame_index) ?? null)
      : null;
    const explicitEndIdx = track.end_frame_index !== null
      ? (frameNumberToArrayIndex.get(track.end_frame_index) ?? null)
      : null;
    const firstKfIdx = keyframeData[0].frameIdx;
    const lastKfIdx = keyframeData[keyframeData.length - 1].frameIdx;

    // Find the actual range of existing annotations for this track
    const existingFrameIndices = Array.from(annotations.values())
      .filter((ann) => ann.track_id === trackId)
      .map((ann) => frameIndexMap.get(ann.frame_id))
      .filter((idx): idx is number => idx !== undefined);

    const minExistingIdx = existingFrameIndices.length > 0 ? Math.min(...existingFrameIndices) : firstKfIdx;
    const maxExistingIdx = existingFrameIndices.length > 0 ? Math.max(...existingFrameIndices) : lastKfIdx;

    // Use explicit boundaries if set, otherwise use the range of existing annotations.
    // IMPORTANT: explicit boundaries are the user's deliberate choice (set via AutoFrame
    // selector) and must be respected strictly. Do NOT expand them to cover keyframes that
    // fall outside the user-selected range — that was the root cause of applying the track
    // to frames 31-40 when the user chose 36-40.
    const rawTrackStartIdx = explicitStartIdx !== null
      ? explicitStartIdx
      : Math.min(firstKfIdx, minExistingIdx);
    const rawTrackEndIdx = explicitEndIdx !== null
      ? explicitEndIdx
      : Math.max(lastKfIdx, maxExistingIdx);
    const trackStartIdx = Math.max(0, Math.min(rawTrackStartIdx, rawTrackEndIdx));
    const trackEndIdx = Math.min(sortedFrames.length - 1, Math.max(rawTrackStartIdx, rawTrackEndIdx));

    console.log('[TrackStore] propagateAndInterpolateTrack range:', {
      trackStartIdx,
      trackEndIdx,
      keyframes: keyframeData.map(k => k.frameIdx),
      explicitStartIdx,
      explicitEndIdx,
      existingAnnotations: existingFrameIndices.length
    });

    // Keep dimensions consistent across the full track.
    // Requirement: latest box size change should apply to all boxes.
    let maxDimensions = { length: 0, width: 0, height: 0 };
    for (const kf of keyframeData) {
      maxDimensions = {
        length: Math.max(maxDimensions.length, kf.cuboid.dimensions.length),
        width: Math.max(maxDimensions.width, kf.cuboid.dimensions.width),
        height: Math.max(maxDimensions.height, kf.cuboid.dimensions.height),
      };
    }

    const annotationUpdates: Array<{
      frameId: string;
      annId: string | null;
      data: CuboidData;
      isNew: boolean;
    }> = [];

    // 1. Interpolate between keyframes
    for (let k = 0; k < keyframeData.length - 1; k++) {
      const startKf = keyframeData[k];
      const endKf = keyframeData[k + 1];

      // Transform keyframes to world
      const startWorld = cuboidToWorld(startKf.cuboid, startKf.frame, egoToLidar);
      const endWorld = cuboidToWorld(endKf.cuboid, endKf.frame, egoToLidar);

      console.log(`[TrackStore] Interpolating between keyframes ${startKf.frameIdx} -> ${endKf.frameIdx}`);
      console.log(`  Start world: (${startWorld.center.x.toFixed(2)}, ${startWorld.center.y.toFixed(2)})`);
      console.log(`  End world: (${endWorld.center.x.toFixed(2)}, ${endWorld.center.y.toFixed(2)})`);

      // Interpolate frames between
      for (let i = startKf.frameIdx + 1; i < endKf.frameIdx; i++) {
        if (i < trackStartIdx || i > trackEndIdx) {
          console.log(`  Skipping frame ${i} - outside track range [${trackStartIdx}, ${trackEndIdx}]`);
          continue;
        }

        const midFrame = sortedFrames[i];
        const t = (i - startKf.frameIdx) / (endKf.frameIdx - startKf.frameIdx);

        const worldInterpolated = {
          center: {
            x: lerp(startWorld.center.x, endWorld.center.x, t),
            y: lerp(startWorld.center.y, endWorld.center.y, t),
            z: lerp(startWorld.center.z, endWorld.center.z, t),
          },
          rotation: {
            yaw: lerpAngle(startWorld.rotation.yaw, endWorld.rotation.yaw, t),
            pitch: lerpAngle(startWorld.rotation.pitch, endWorld.rotation.pitch, t),
            roll: lerpAngle(startWorld.rotation.roll, endWorld.rotation.roll, t),
          },
          dimensions: { ...maxDimensions },
        };

        const lidarInterpolated = cuboidFromWorld(worldInterpolated, midFrame, egoToLidar);

        const existingAnnId = findTrackAnnotationIdForFrame(midFrame.id);

        // Check if existing annotation is a keyframe (don't overwrite keyframes)
        const existingAnn = existingAnnId ? annotations.get(existingAnnId) : null;
        if (existingAnn?.is_keyframe) {
          console.log(`  Frame ${i}: Skipping - is a keyframe`);
          continue;
        }

        console.log(`  Frame ${i}: t=${t.toFixed(2)}, existingAnn=${existingAnnId ? 'yes' : 'no'}, interp=(${lidarInterpolated.center.x.toFixed(2)}, ${lidarInterpolated.center.y.toFixed(2)})`);

        annotationUpdates.push({
          frameId: midFrame.id,
          annId: existingAnnId || null,
          data: lidarInterpolated,
          isNew: !existingAnnId,
        });
      }
    }

    // 2. Velocity-based prediction beyond keyframes (if not static)
    if (!track.is_static && keyframeData.length >= 2) {
      // Calculate velocity from last two keyframes
      const kf1 = keyframeData[keyframeData.length - 2];
      const kf2 = keyframeData[keyframeData.length - 1];

      const world1 = cuboidToWorld(kf1.cuboid, kf1.frame, egoToLidar);
      const world2 = cuboidToWorld(kf2.cuboid, kf2.frame, egoToLidar);

      const dt = kf2.frameIdx - kf1.frameIdx;
      const velocity = {
        vx: (world2.center.x - world1.center.x) / dt,
        vy: (world2.center.y - world1.center.y) / dt,
        vz: (world2.center.z - world1.center.z) / dt,
        vyaw: normalizeAngle(world2.rotation.yaw - world1.rotation.yaw) / dt,
      };

      // Forward predict beyond last keyframe
      for (let i = kf2.frameIdx + 1; i <= trackEndIdx && i < sortedFrames.length; i++) {
        const targetFrame = sortedFrames[i];
        const frameDt = i - kf2.frameIdx;

        const predictedWorld = {
          center: {
            x: world2.center.x + velocity.vx * frameDt,
            y: world2.center.y + velocity.vy * frameDt,
            z: world2.center.z + velocity.vz * frameDt,
          },
          rotation: {
            yaw: normalizeAngle(world2.rotation.yaw + velocity.vyaw * frameDt),
            pitch: world2.rotation.pitch,
            roll: world2.rotation.roll,
          },
          dimensions: { ...maxDimensions },
        };

        const lidarPredicted = cuboidFromWorld(predictedWorld, targetFrame, egoToLidar);
        const existingAnnId = findTrackAnnotationIdForFrame(targetFrame.id);

        // Only update if not a keyframe
        const existingAnn = existingAnnId ? annotations.get(existingAnnId) : null;
        if (!existingAnn?.is_keyframe) {
          annotationUpdates.push({
            frameId: targetFrame.id,
            annId: existingAnnId || null,
            data: lidarPredicted,
            isNew: !existingAnnId,
          });
        }
      }

      // Backward predict before first keyframe
      const firstKf = keyframeData[0];
      const secondKf = keyframeData.length > 1 ? keyframeData[1] : null;

      if (secondKf) {
        const worldFirst = cuboidToWorld(firstKf.cuboid, firstKf.frame, egoToLidar);
        const worldSecond = cuboidToWorld(secondKf.cuboid, secondKf.frame, egoToLidar);

        const dtBack = secondKf.frameIdx - firstKf.frameIdx;
        const velocityBack = {
          vx: (worldSecond.center.x - worldFirst.center.x) / dtBack,
          vy: (worldSecond.center.y - worldFirst.center.y) / dtBack,
          vz: (worldSecond.center.z - worldFirst.center.z) / dtBack,
          vyaw: normalizeAngle(worldSecond.rotation.yaw - worldFirst.rotation.yaw) / dtBack,
        };

        // Back-predict before first keyframe
        for (let i = firstKf.frameIdx - 1; i >= trackStartIdx && i >= 0; i--) {
          const targetFrame = sortedFrames[i];
          const frameDt = firstKf.frameIdx - i; // Positive, going backwards

          const predictedWorld = {
            center: {
              x: worldFirst.center.x - velocityBack.vx * frameDt,
              y: worldFirst.center.y - velocityBack.vy * frameDt,
              z: worldFirst.center.z - velocityBack.vz * frameDt,
            },
            rotation: {
              yaw: normalizeAngle(worldFirst.rotation.yaw - velocityBack.vyaw * frameDt),
              pitch: worldFirst.rotation.pitch,
              roll: worldFirst.rotation.roll,
            },
            dimensions: { ...maxDimensions },
          };

          const lidarPredicted = cuboidFromWorld(predictedWorld, targetFrame, egoToLidar);
          const existingAnnId = findTrackAnnotationIdForFrame(targetFrame.id);

          const existingAnn = existingAnnId ? annotations.get(existingAnnId) : null;
          if (!existingAnn?.is_keyframe) {
            annotationUpdates.push({
              frameId: targetFrame.id,
              annId: existingAnnId || null,
              data: lidarPredicted,
              isNew: !existingAnnId,
            });
          }
        }
      } else {
        // Only one keyframe - just propagate with ego compensation
        const worldFirst = cuboidToWorld(
          { ...firstKf.cuboid, dimensions: { ...maxDimensions } },
          firstKf.frame,
          egoToLidar
        );

        for (let i = trackStartIdx; i <= trackEndIdx && i < sortedFrames.length; i++) {
          if (i === firstKf.frameIdx) continue;

          const targetFrame = sortedFrames[i];
          const lidarTransformed = cuboidFromWorld(worldFirst, targetFrame, egoToLidar);
          const existingAnnId = findTrackAnnotationIdForFrame(targetFrame.id);

          const existingAnn = existingAnnId ? annotations.get(existingAnnId) : null;
          if (!existingAnn?.is_keyframe) {
            annotationUpdates.push({
              frameId: targetFrame.id,
              annId: existingAnnId || null,
              data: lidarTransformed,
              isNew: !existingAnnId,
            });
          }
        }
      }
    } else if (keyframeData.length === 1) {
      // Single keyframe - only propagate if explicit boundaries are set
      // Otherwise, user must set a second keyframe to enable interpolation
      if (explicitStartIdx === null && explicitEndIdx === null) {
        // No boundaries set and only 1 keyframe - don't propagate anything
        // User needs to either set boundaries or create a 2nd keyframe
        return;
      }

      const kf = keyframeData[0];
      const worldKf = cuboidToWorld(
        { ...kf.cuboid, dimensions: { ...maxDimensions } },
        kf.frame,
        egoToLidar
      );

      for (let i = trackStartIdx; i <= trackEndIdx && i < sortedFrames.length; i++) {
        if (i === kf.frameIdx) continue;

        const targetFrame = sortedFrames[i];
        const lidarTransformed = cuboidFromWorld(worldKf, targetFrame, egoToLidar);
        const existingAnnId = findTrackAnnotationIdForFrame(targetFrame.id);

        const existingAnn = existingAnnId ? annotations.get(existingAnnId) : null;
        if (!existingAnn?.is_keyframe) {
          annotationUpdates.push({
            frameId: targetFrame.id,
            annId: existingAnnId || null,
            data: lidarTransformed,
            isNew: !existingAnnId,
          });
        }
      }
    }

    // 2b. Sync max dimensions to keyframes and untouched non-keyframes
    const updatedAnnIds = new Set(annotationUpdates.filter(u => u.annId).map(u => u.annId!));

    for (const kf of keyframeData) {
      const kfAnnId = findTrackAnnotationIdForFrame(kf.frameId, true);
      if (!kfAnnId || updatedAnnIds.has(kfAnnId)) continue;

      const needsDimensionSync =
        kf.cuboid.dimensions.length !== maxDimensions.length ||
        kf.cuboid.dimensions.width !== maxDimensions.width ||
        kf.cuboid.dimensions.height !== maxDimensions.height;

      if (needsDimensionSync) {
        annotationUpdates.push({
          frameId: kf.frameId,
          annId: kfAnnId,
          data: {
            ...kf.cuboid,
            dimensions: { ...maxDimensions },
          },
          isNew: false,
        });
        updatedAnnIds.add(kfAnnId);
      }
    }

    for (const [annId, ann] of annotations.entries()) {
      if (ann.track_id !== trackId) continue;
      const frameId = ann.frame_id;
      if (updatedAnnIds.has(annId)) continue;
      if (!ann || ann.type !== 'cuboid' || ann.is_keyframe) continue;

      const annData = ann.data as CuboidData;
      const needsDimensionSync =
        annData.dimensions.length !== maxDimensions.length ||
        annData.dimensions.width !== maxDimensions.width ||
        annData.dimensions.height !== maxDimensions.height;

      if (needsDimensionSync) {
        annotationUpdates.push({
          frameId,
          annId,
          data: {
            ...annData,
            dimensions: { ...maxDimensions },
          },
          isNew: false,
        });
        updatedAnnIds.add(annId);
      }
    }

    // 2c. Guarantee coverage across the full active range:
    // every frame between start/end should have a cuboid for this track.
    const scheduledFrameIds = new Set(annotationUpdates.map((u) => u.frameId));
    const keyframeFrameIds = new Set(keyframeData.map((k) => k.frameId));
    for (let i = trackStartIdx; i <= trackEndIdx && i < sortedFrames.length; i++) {
      const frame = sortedFrames[i];
      if (!frame) continue;
      if (keyframeFrameIds.has(frame.id)) continue;
      if (scheduledFrameIds.has(frame.id)) continue;

      const existingAnnId = findTrackAnnotationIdForFrame(frame.id);
      const existingAnn = existingAnnId ? annotations.get(existingAnnId) : null;
      if (existingAnn && existingAnn.type === 'cuboid') continue;

      let nearestKeyframe: typeof keyframeData[number] | null = null;
      for (const candidate of keyframeData) {
        if (!nearestKeyframe || Math.abs(candidate.frameIdx - i) < Math.abs(nearestKeyframe.frameIdx - i)) {
          nearestKeyframe = candidate;
        }
      }
      if (!nearestKeyframe) continue;

      const fallbackData = transformCuboidBetweenFrames(
        { ...nearestKeyframe.cuboid, dimensions: { ...maxDimensions } },
        nearestKeyframe.frame,
        frame,
        egoToLidar
      );

      annotationUpdates.push({
        frameId: frame.id,
        annId: existingAnnId && annotations.has(existingAnnId) ? existingAnnId : null,
        data: fallbackData,
        isNew: !(existingAnnId && annotations.has(existingAnnId)),
      });
      scheduledFrameIds.add(frame.id);
    }

    // 3. Apply all updates
    if (annotationUpdates.length > 0) {
      const task = editorStore.task;
      const dedupedUpdates = Array.from(
        new Map(annotationUpdates.map((update) => [update.frameId, update])).values()
      );
      console.log(`[TrackStore] Applying ${dedupedUpdates.length} updates, task=${task ? task.id.slice(0,8) : 'null'}`);

      const currentAnnotations = new Map(annotations);
      const currentDirty = new Map(editorStore.dirtyAnnotations);

      let createdCount = 0;
      let updatedCount = 0;
      let skippedCount = 0;

      for (const update of dedupedUpdates) {
        if (update.isNew && task) {
          // Create new annotation
          const newAnn: Annotation = {
            id: uuidv4(),
            task_id: task.id,
            frame_id: update.frameId,
            track_id: trackId,
            type: 'cuboid' as AnnotationType,
            class_id: track.class_id,
            data: update.data,
            attributes: track.attributes || {},
            source: 'auto_interpolated' as AnnotationSource,
            is_verified: true,
            is_keyframe: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          currentAnnotations.set(newAnn.id, newAnn);
          currentDirty.set(newAnn.id, 'new');
          createdCount++;
        } else if (update.isNew && !task) {
          console.warn(`[TrackStore] Cannot create new annotation for frame - no task available`);
          skippedCount++;
        } else if (update.annId) {
          // Update existing
          const ann = currentAnnotations.get(update.annId);
          if (ann) {
            currentAnnotations.set(update.annId, {
              ...ann,
              data: update.data,
              source: 'auto_interpolated' as AnnotationSource,
              updated_at: new Date().toISOString(),
            });
            if (!currentDirty.has(update.annId) || currentDirty.get(update.annId) !== 'new') {
              currentDirty.set(update.annId, 'modified');
            }
            updatedCount++;
          } else {
            console.warn(`[TrackStore] Annotation ${update.annId.slice(0,8)} not found in annotations map`);
            skippedCount++;
          }
        }
      }

      console.log(`[TrackStore] Applied: created=${createdCount}, updated=${updatedCount}, skipped=${skippedCount}`);

      useEditorStore.setState({
        annotations: currentAnnotations,
        dirtyAnnotations: currentDirty,
      });

      // Rebuild frame_annotations map from current annotations to avoid stale/missing frame slots.
      const newFrameAnnotations = new Map<string, string>();
      currentAnnotations.forEach((ann, annId) => {
        if (ann.track_id !== trackId) return;
        const frameIdx = frameIndexMap.get(ann.frame_id);
        if (frameIdx === undefined) return;
        if (frameIdx < trackStartIdx || frameIdx > trackEndIdx) return;
        newFrameAnnotations.set(ann.frame_id, annId);
      });

      const newKeyframes = new Set<string>();
      track.keyframe_ids.forEach((frameId) => {
        if (newFrameAnnotations.has(frameId)) {
          newKeyframes.add(frameId);
        }
      });

      // Update track
      const updatedTrack: Track = {
        ...track,
        frame_annotations: newFrameAnnotations,
        keyframe_ids: newKeyframes,
        updated_at: new Date().toISOString(),
      };

      const newTracks = new Map(get().tracks);
      newTracks.set(trackId, updatedTrack);
      set({ tracks: newTracks });

      console.log(`[TrackStore] propagateAndInterpolateTrack: Updated ${dedupedUpdates.length} frames for track ${trackId.slice(0, 8)}`);
    }
  },

  // ---------------------------------------------------------------------------
  // SMART INTERPOLATION: Only update frames adjacent to a specific keyframe
  // Called when a keyframe is edited or a new keyframe is created
  // ---------------------------------------------------------------------------

  interpolateAroundKeyframe: (trackId, keyframeFrameId) => {
    const track = get().tracks.get(trackId);
    if (!track) {
      console.warn('[TrackStore] interpolateAroundKeyframe: Track not found');
      return;
    }

    const editorStore = useEditorStore.getState();
    const { frames, annotations, scene, task, lidarView, currentFrame: editorCurrentFrame } = editorStore;

    // Ground plane detected from the currently-viewed frame's point cloud
    const detectedGroundPlane = lidarView?.detectedGroundPlane;

    const egoToLidar = scene?.calibration?.ego_to_lidar;
    const sortedFrames = [...frames].sort((a, b) => a.frame_index - b.frame_index);
    const frameIndexMap = new Map(sortedFrames.map((f, i) => [f.id, i]));

    const editedFrameIdx = frameIndexMap.get(keyframeFrameId);
    if (editedFrameIdx === undefined) {
      console.warn('[TrackStore] interpolateAroundKeyframe: Frame not found');
      return;
    }

    // Build sorted keyframe data
    const keyframeData: Array<{
      frameId: string;
      frameIdx: number;
      frame: Frame;
      cuboid: CuboidData;
    }> = [];

    track.keyframe_ids.forEach(frameId => {
      const frameIdx = frameIndexMap.get(frameId);
      const annId = track.frame_annotations.get(frameId);
      if (frameIdx !== undefined && annId) {
        const ann = annotations.get(annId);
        if (ann && ann.type === 'cuboid') {
          keyframeData.push({
            frameId,
            frameIdx,
            frame: sortedFrames[frameIdx],
            cuboid: ann.data as CuboidData,
          });
        }
      }
    });

    keyframeData.sort((a, b) => a.frameIdx - b.frameIdx);

    if (keyframeData.length === 0) return;

    // Find where the edited keyframe sits
    const editedKfIndex = keyframeData.findIndex(k => k.frameId === keyframeFrameId);

    console.log(`[TrackStore] interpolateAroundKeyframe: editedFrame=${editedFrameIdx}, keyframes=${keyframeData.map(k => k.frameIdx).join(',')}, editedKfIndex=${editedKfIndex}`);

    const annotationUpdates: Array<{
      frameId: string;
      annId: string | null;
      data: CuboidData;
      isNew: boolean;
    }> = [];

    // Get existing frame annotations range
    const existingFrameIndices = Array.from(track.frame_annotations.keys())
      .map(fid => frameIndexMap.get(fid))
      .filter((idx): idx is number => idx !== undefined);
    const maxExistingIdx = existingFrameIndices.length > 0 ? Math.max(...existingFrameIndices) : editedFrameIdx;
    const minExistingIdx = existingFrameIndices.length > 0 ? Math.min(...existingFrameIndices) : editedFrameIdx;

    // Calculate the LARGEST dimensions across ALL keyframes
    // This ensures all boxes in the track use consistent (largest) dimensions
    let maxDimensions = { length: 0, width: 0, height: 0 };
    for (const kf of keyframeData) {
      const dims = kf.cuboid.dimensions;
      maxDimensions = {
        length: Math.max(maxDimensions.length, dims.length),
        width: Math.max(maxDimensions.width, dims.width),
        height: Math.max(maxDimensions.height, dims.height),
      };
    }
    console.log(`[TrackStore] interpolateAroundKeyframe: Using max dimensions: L=${maxDimensions.length.toFixed(2)}, W=${maxDimensions.width.toFixed(2)}, H=${maxDimensions.height.toFixed(2)}`);

    // Check for large orientation differences between keyframes
    // If any keyframe differs by >90° from the edited keyframe, it's likely a drawing mistake
    // In that case, we'll propagate the edited keyframe's orientation to all frames instead of interpolating
    const editedKf = keyframeData.find(k => k.frameId === keyframeFrameId);
    const editedYaw = editedKf?.cuboid.rotation.yaw ?? 0;
    let forceOrientationSync = false;

    for (const kf of keyframeData) {
      if (kf.frameId === keyframeFrameId) continue;
      const yawDiff = Math.abs(normalizeAngle(kf.cuboid.rotation.yaw - editedYaw));
      // Only sync orientation for near-180° mistakes (> 135°).
      // A 90° turn is legitimate — don't override it.
      if (yawDiff > (3 * Math.PI / 4)) {
        console.log(`[TrackStore] Near-180° orientation mistake detected: ${(yawDiff * 180 / Math.PI).toFixed(1)}° between edited keyframe and frame ${kf.frameIdx}. Will sync orientation.`);
        forceOrientationSync = true;
        break;
      }
    }

    // The "canonical" orientation to use when syncing (from the edited keyframe, in world coords)
    const editedWorld = editedKf ? cuboidToWorld(editedKf.cuboid, editedKf.frame, egoToLidar) : null;
    const canonicalWorldRotation = editedWorld?.rotation ?? { yaw: 0, pitch: 0, roll: 0 };

    // SEGMENT 0: Propagate from FIRST keyframe backward to track start
    // This handles frames BEFORE the first keyframe
    const firstKf = keyframeData[0];
    // Use sorted-array positions (not raw frame_index numbers) so the comparison is correct.
    // track.start_frame_index stores actual frame.frame_index values which are incompatible
    // with the array-position-based frameIdx values used throughout this function.
    const trackStartIdx = minExistingIdx;
    // The frame whose point cloud was used for ground-plane detection
    const groundPlaneSourceFrame = editorCurrentFrame || sortedFrames[editedFrameIdx];
    if (firstKf && trackStartIdx < firstKf.frameIdx) {
      const firstWorld = cuboidToWorld(firstKf.cuboid, firstKf.frame, egoToLidar);
      const secondKf = keyframeData.length > 1 ? keyframeData[1] : null;

      const canBackPredict =
        !!secondKf &&
        !track.is_static &&
        secondKf.frameIdx > firstKf.frameIdx;

      let backwardVelocity:
        | { vx: number; vy: number; vz: number; vyaw: number }
        | null = null;

      if (canBackPredict && secondKf) {
        const secondWorld = cuboidToWorld(secondKf.cuboid, secondKf.frame, egoToLidar);
        const dt = secondKf.frameIdx - firstKf.frameIdx;
        backwardVelocity = {
          vx: (secondWorld.center.x - firstWorld.center.x) / dt,
          vy: (secondWorld.center.y - firstWorld.center.y) / dt,
          vz: (secondWorld.center.z - firstWorld.center.z) / dt,
          vyaw: normalizeAngle(secondWorld.rotation.yaw - firstWorld.rotation.yaw) / dt,
        };
      }

      console.log(
        `  Segment 0: Backward ${backwardVelocity ? 'prediction' : 'propagation'} from first keyframe ${firstKf.frameIdx} to track start ${trackStartIdx}${forceOrientationSync ? ' (with orientation sync)' : ''}`
      );

      for (let i = trackStartIdx; i < firstKf.frameIdx; i++) {
        const targetFrame = sortedFrames[i];
        if (!targetFrame) continue;
        const frameDt = firstKf.frameIdx - i;

        const predictedWorld = backwardVelocity
          ? {
              center: {
                x: firstWorld.center.x - backwardVelocity.vx * frameDt,
                y: firstWorld.center.y - backwardVelocity.vy * frameDt,
                z: firstWorld.center.z - backwardVelocity.vz * frameDt,
              },
              rotation: forceOrientationSync
                ? canonicalWorldRotation
                : {
                    yaw: normalizeAngle(firstWorld.rotation.yaw - backwardVelocity.vyaw * frameDt),
                    pitch: firstWorld.rotation.pitch,
                    roll: firstWorld.rotation.roll,
                  },
              dimensions: { ...maxDimensions },
            }
          : {
              center: firstWorld.center,
              rotation: forceOrientationSync ? canonicalWorldRotation : firstWorld.rotation,
              dimensions: { ...maxDimensions },
            };

        let lidarTransformed = cuboidFromWorld(predictedWorld, targetFrame, egoToLidar);
        lidarTransformed = snapCuboidToGround(
          lidarTransformed,
          targetFrame,
          groundPlaneSourceFrame,
          detectedGroundPlane,
          firstKf.cuboid,
          firstKf.frame,
          egoToLidar
        );

        let existingAnnId = track.frame_annotations.get(targetFrame.id);
        if (!existingAnnId) {
          annotations.forEach((ann, annId) => {
            if (ann.track_id === trackId && ann.frame_id === targetFrame.id) {
              existingAnnId = annId;
            }
          });
        }

        const existingAnn = existingAnnId ? annotations.get(existingAnnId) : null;
        if (!existingAnn?.is_keyframe) {
          annotationUpdates.push({
            frameId: targetFrame.id,
            annId: existingAnnId || null,
            data: lidarTransformed,
            isNew: !existingAnnId,
          });
        }
      }
    }

    // SEGMENT 1: Interpolate from PREVIOUS keyframe to this one
    if (editedKfIndex > 0) {
      const prevKf = keyframeData[editedKfIndex - 1];
      const currKf = keyframeData[editedKfIndex];

      const prevWorld = cuboidToWorld(prevKf.cuboid, prevKf.frame, egoToLidar);
      const currWorld = cuboidToWorld(currKf.cuboid, currKf.frame, egoToLidar);

      // Check if path is curved (turning vehicle)
      const curved = isPathCurved(prevWorld, currWorld);

      // Get additional keyframes for Catmull-Rom if available
      // p0 = keyframe before prevKf (or extrapolated)
      // p1 = prevKf, p2 = currKf
      // p3 = keyframe after currKf (or extrapolated)
      let p0World: Point3DSimple;
      let p3World: Point3DSimple;

      if (editedKfIndex >= 2) {
        const beforePrev = keyframeData[editedKfIndex - 2];
        const beforeWorld = cuboidToWorld(beforePrev.cuboid, beforePrev.frame, egoToLidar);
        p0World = beforeWorld.center;
      } else {
        // Extrapolate: p0 = p1 - (p2 - p1) = 2*p1 - p2
        p0World = {
          x: 2 * prevWorld.center.x - currWorld.center.x,
          y: 2 * prevWorld.center.y - currWorld.center.y,
          z: 2 * prevWorld.center.z - currWorld.center.z,
        };
      }

      if (editedKfIndex < keyframeData.length - 1) {
        const afterCurr = keyframeData[editedKfIndex + 1];
        const afterWorld = cuboidToWorld(afterCurr.cuboid, afterCurr.frame, egoToLidar);
        p3World = afterWorld.center;
      } else {
        // Extrapolate: p3 = p2 + (p2 - p1) = 2*p2 - p1
        p3World = {
          x: 2 * currWorld.center.x - prevWorld.center.x,
          y: 2 * currWorld.center.y - prevWorld.center.y,
          z: 2 * currWorld.center.z - prevWorld.center.z,
        };
      }

      console.log(`  Segment 1: Interpolating ${prevKf.frameIdx} -> ${currKf.frameIdx}${forceOrientationSync ? ' (with orientation sync)' : ''}${curved ? ' (curved path - using spline)' : ''}`);

      for (let i = prevKf.frameIdx + 1; i < currKf.frameIdx; i++) {
        const midFrame = sortedFrames[i];
        const t = (i - prevKf.frameIdx) / (currKf.frameIdx - prevKf.frameIdx);

        // Use Catmull-Rom for curved paths, linear for straight paths
        const interpolatedCenter = curved
          ? catmullRom3D(p0World, prevWorld.center, currWorld.center, p3World, t)
          : {
              x: lerp(prevWorld.center.x, currWorld.center.x, t),
              y: lerp(prevWorld.center.y, currWorld.center.y, t),
              z: lerp(prevWorld.center.z, currWorld.center.z, t),
            };

        // Interpolate yaw smoothly between keyframes.
        // On turns, blend keyframe yaw with spline tangent heading for more realistic orientation.
        let interpolatedYaw: number;
        if (forceOrientationSync) {
          interpolatedYaw = canonicalWorldRotation.yaw;
        } else {
          const tangentYaw = curved
            ? getSplineTangentYaw(p0World, prevWorld.center, currWorld.center, p3World, t)
            : null;
          interpolatedYaw = blendYawWithTangent(prevWorld.rotation.yaw, currWorld.rotation.yaw, t, tangentYaw);
        }

        const worldInterpolated = {
          center: interpolatedCenter,
          rotation: forceOrientationSync ? canonicalWorldRotation : {
            yaw: interpolatedYaw,
            pitch: lerpAngle(prevWorld.rotation.pitch, currWorld.rotation.pitch, t),
            roll: lerpAngle(prevWorld.rotation.roll, currWorld.rotation.roll, t),
          },
          // Use MAX dimensions across all keyframes for consistency
          dimensions: { ...maxDimensions },
        };

        let lidarInterpolated = cuboidFromWorld(worldInterpolated, midFrame, egoToLidar);
        lidarInterpolated = snapCuboidToGround(lidarInterpolated, midFrame, groundPlaneSourceFrame, detectedGroundPlane, prevKf.cuboid, prevKf.frame, egoToLidar);
        let existingAnnId = track.frame_annotations.get(midFrame.id);
        if (!existingAnnId) {
          annotations.forEach((ann, annId) => {
            if (ann.track_id === trackId && ann.frame_id === midFrame.id) {
              existingAnnId = annId;
            }
          });
        }

        const existingAnn = existingAnnId ? annotations.get(existingAnnId) : null;
        if (!existingAnn?.is_keyframe) {
          annotationUpdates.push({
            frameId: midFrame.id,
            annId: existingAnnId || null,
            data: lidarInterpolated,
            isNew: !existingAnnId,
          });
        }
      }
    }

    // SEGMENT 2: Interpolate from this keyframe to NEXT keyframe (if exists)
    if (editedKfIndex >= 0 && editedKfIndex < keyframeData.length - 1) {
      const currKf = keyframeData[editedKfIndex];
      const nextKf = keyframeData[editedKfIndex + 1];

      const currWorld = cuboidToWorld(currKf.cuboid, currKf.frame, egoToLidar);
      const nextWorld = cuboidToWorld(nextKf.cuboid, nextKf.frame, egoToLidar);

      // Check if path is curved (turning vehicle)
      const curved = isPathCurved(currWorld, nextWorld);

      // Get additional keyframes for Catmull-Rom if available
      // p0 = keyframe before currKf (or extrapolated)
      // p1 = currKf, p2 = nextKf
      // p3 = keyframe after nextKf (or extrapolated)
      let p0World: Point3DSimple;
      let p3World: Point3DSimple;

      if (editedKfIndex >= 1) {
        const beforeCurr = keyframeData[editedKfIndex - 1];
        const beforeWorld = cuboidToWorld(beforeCurr.cuboid, beforeCurr.frame, egoToLidar);
        p0World = beforeWorld.center;
      } else {
        // Extrapolate: p0 = p1 - (p2 - p1) = 2*p1 - p2
        p0World = {
          x: 2 * currWorld.center.x - nextWorld.center.x,
          y: 2 * currWorld.center.y - nextWorld.center.y,
          z: 2 * currWorld.center.z - nextWorld.center.z,
        };
      }

      if (editedKfIndex + 2 < keyframeData.length) {
        const afterNext = keyframeData[editedKfIndex + 2];
        const afterWorld = cuboidToWorld(afterNext.cuboid, afterNext.frame, egoToLidar);
        p3World = afterWorld.center;
      } else {
        // Extrapolate: p3 = p2 + (p2 - p1) = 2*p2 - p1
        p3World = {
          x: 2 * nextWorld.center.x - currWorld.center.x,
          y: 2 * nextWorld.center.y - currWorld.center.y,
          z: 2 * nextWorld.center.z - currWorld.center.z,
        };
      }

      console.log(`  Segment 2: Interpolating ${currKf.frameIdx} -> ${nextKf.frameIdx}${forceOrientationSync ? ' (with orientation sync)' : ''}${curved ? ' (curved path - using spline)' : ''}`);

      for (let i = currKf.frameIdx + 1; i < nextKf.frameIdx; i++) {
        const midFrame = sortedFrames[i];
        const t = (i - currKf.frameIdx) / (nextKf.frameIdx - currKf.frameIdx);

        // Use Catmull-Rom for curved paths, linear for straight paths
        const interpolatedCenter = curved
          ? catmullRom3D(p0World, currWorld.center, nextWorld.center, p3World, t)
          : {
              x: lerp(currWorld.center.x, nextWorld.center.x, t),
              y: lerp(currWorld.center.y, nextWorld.center.y, t),
              z: lerp(currWorld.center.z, nextWorld.center.z, t),
            };

        // Interpolate yaw smoothly between keyframes.
        // On turns, blend keyframe yaw with spline tangent heading for more realistic orientation.
        let interpolatedYaw: number;
        if (forceOrientationSync) {
          interpolatedYaw = canonicalWorldRotation.yaw;
        } else {
          const tangentYaw = curved
            ? getSplineTangentYaw(p0World, currWorld.center, nextWorld.center, p3World, t)
            : null;
          interpolatedYaw = blendYawWithTangent(currWorld.rotation.yaw, nextWorld.rotation.yaw, t, tangentYaw);
        }

        const worldInterpolated = {
          center: interpolatedCenter,
          rotation: forceOrientationSync ? canonicalWorldRotation : {
            yaw: interpolatedYaw,
            pitch: lerpAngle(currWorld.rotation.pitch, nextWorld.rotation.pitch, t),
            roll: lerpAngle(currWorld.rotation.roll, nextWorld.rotation.roll, t),
          },
          // Use MAX dimensions across all keyframes for consistency
          dimensions: { ...maxDimensions },
        };

        let lidarInterpolated = cuboidFromWorld(worldInterpolated, midFrame, egoToLidar);
        lidarInterpolated = snapCuboidToGround(lidarInterpolated, midFrame, groundPlaneSourceFrame, detectedGroundPlane, currKf.cuboid, currKf.frame, egoToLidar);
        let existingAnnId = track.frame_annotations.get(midFrame.id);
        if (!existingAnnId) {
          annotations.forEach((ann, annId) => {
            if (ann.track_id === trackId && ann.frame_id === midFrame.id) {
              existingAnnId = annId;
            }
          });
        }

        const existingAnn = existingAnnId ? annotations.get(existingAnnId) : null;
        if (!existingAnn?.is_keyframe) {
          annotationUpdates.push({
            frameId: midFrame.id,
            annId: existingAnnId || null,
            data: lidarInterpolated,
            isNew: !existingAnnId,
          });
        }
      }
    }
    // SEGMENT 3: Handle frames AFTER the LAST keyframe
    // ALWAYS runs when there are frames after the last keyframe, regardless of which keyframe was edited
    const lastKf = keyframeData[keyframeData.length - 1];
    const trackEndIdx = maxExistingIdx; // use array positions, not raw frame_index numbers

    if (lastKf && trackEndIdx > lastKf.frameIdx) {
      // Use velocity prediction if we have 2+ keyframes AND object is not static
      if (keyframeData.length >= 2 && !track.is_static) {
        const prevKf = keyframeData[keyframeData.length - 2];

        const prevWorld = cuboidToWorld(prevKf.cuboid, prevKf.frame, egoToLidar);
        const lastWorld = cuboidToWorld(lastKf.cuboid, lastKf.frame, egoToLidar);

        const dt = lastKf.frameIdx - prevKf.frameIdx;
        const velocity = {
          vx: (lastWorld.center.x - prevWorld.center.x) / dt,
          vy: (lastWorld.center.y - prevWorld.center.y) / dt,
          vz: (lastWorld.center.z - prevWorld.center.z) / dt,
          vyaw: normalizeAngle(lastWorld.rotation.yaw - prevWorld.rotation.yaw) / dt,
        };

        console.log(`  Segment 3: Velocity prediction ${lastKf.frameIdx} -> ${trackEndIdx}${forceOrientationSync ? ' (with orientation sync)' : ''} (velocity: vx=${velocity.vx.toFixed(3)}, vy=${velocity.vy.toFixed(3)})`);

        for (let i = lastKf.frameIdx + 1; i <= trackEndIdx && i < sortedFrames.length; i++) {
          const targetFrame = sortedFrames[i];
          const frameDt = i - lastKf.frameIdx;

          const predictedWorld = {
            center: {
              x: lastWorld.center.x + velocity.vx * frameDt,
              y: lastWorld.center.y + velocity.vy * frameDt,
              z: lastWorld.center.z + velocity.vz * frameDt,
            },
            // Use canonical rotation when syncing, otherwise use velocity-based prediction
            rotation: forceOrientationSync ? canonicalWorldRotation : {
              yaw: normalizeAngle(lastWorld.rotation.yaw + velocity.vyaw * frameDt),
              pitch: lastWorld.rotation.pitch,
              roll: lastWorld.rotation.roll,
            },
            // Use MAX dimensions across all keyframes for consistency
            dimensions: { ...maxDimensions },
          };

          let lidarPredicted = cuboidFromWorld(predictedWorld, targetFrame, egoToLidar);
          lidarPredicted = snapCuboidToGround(lidarPredicted, targetFrame, groundPlaneSourceFrame, detectedGroundPlane, lastKf.cuboid, lastKf.frame, egoToLidar);
          let existingAnnId = track.frame_annotations.get(targetFrame.id);
          if (!existingAnnId) {
            annotations.forEach((ann, annId) => {
              if (ann.track_id === trackId && ann.frame_id === targetFrame.id) {
                existingAnnId = annId;
              }
            });
          }

          const existingAnn = existingAnnId ? annotations.get(existingAnnId) : null;
          if (!existingAnn?.is_keyframe) {
            annotationUpdates.push({
              frameId: targetFrame.id,
              annId: existingAnnId || null,
              data: lidarPredicted,
              isNew: !existingAnnId,
            });
          }
        }
      } else {
        // Simple propagation from last keyframe (only 1 keyframe or static object)
        const lastWorld = cuboidToWorld(lastKf.cuboid, lastKf.frame, egoToLidar);

        console.log(`  Segment 3b: Simple propagation from last keyframe ${lastKf.frameIdx} to track end ${trackEndIdx}${forceOrientationSync ? ' (with orientation sync)' : ''}`);

        for (let i = lastKf.frameIdx + 1; i <= trackEndIdx && i < sortedFrames.length; i++) {
          const targetFrame = sortedFrames[i];
          if (!targetFrame) continue;

          // Transform from world to target frame (ego motion compensation)
          // Use canonical rotation when syncing orientation
          let lidarTransformed = cuboidFromWorld({
            center: lastWorld.center,
            rotation: forceOrientationSync ? canonicalWorldRotation : lastWorld.rotation,
            dimensions: { ...maxDimensions },
          }, targetFrame, egoToLidar);
          lidarTransformed = snapCuboidToGround(lidarTransformed, targetFrame, groundPlaneSourceFrame, detectedGroundPlane, lastKf.cuboid, lastKf.frame, egoToLidar);

          let existingAnnId = track.frame_annotations.get(targetFrame.id);
          if (!existingAnnId) {
            annotations.forEach((ann, annId) => {
              if (ann.track_id === trackId && ann.frame_id === targetFrame.id) {
                existingAnnId = annId;
              }
            });
          }

          const existingAnn = existingAnnId ? annotations.get(existingAnnId) : null;
          if (!existingAnn?.is_keyframe) {
            annotationUpdates.push({
              frameId: targetFrame.id,
              annId: existingAnnId || null,
              data: lidarTransformed,
              isNew: !existingAnnId,
            });
          }
        }
      }
    }

    // SEGMENT 5: Sync MAX dimensions to ALL other keyframes
    // NOTE: Never overwrite another keyframe's rotation — those are user-set values.
    for (const kf of keyframeData) {
      if (kf.frameId === keyframeFrameId) continue; // Skip current frame

      const kfAnnId = track.frame_annotations.get(kf.frameId);
      if (!kfAnnId) continue;

      // Only sync dimensions, NEVER orientation on keyframes
      const needsDimensionSync =
        kf.cuboid.dimensions.length !== maxDimensions.length ||
        kf.cuboid.dimensions.width !== maxDimensions.width ||
        kf.cuboid.dimensions.height !== maxDimensions.height;

      if (needsDimensionSync) {
        const alreadyUpdated = annotationUpdates.some(u => u.annId === kfAnnId);
        if (!alreadyUpdated) {
          annotationUpdates.push({
            frameId: kf.frameId,
            annId: kfAnnId,
            data: {
              ...kf.cuboid,
              dimensions: { ...maxDimensions },
              // rotation is intentionally preserved — keyframe yaw is user-defined
            },
            isNew: false,
          });
          console.log(`  Segment 5: Syncing dimensions to keyframe at idx ${kf.frameIdx}`);
        }
      }
    }

    // SEGMENT 6: Sync MAX dimensions to ALL non-keyframe frames that weren't already updated
    // This ensures dimension and orientation changes propagate to frames that weren't touched by SEGMENT 0-3
    const updatedAnnIds = new Set(annotationUpdates.filter(u => u.annId).map(u => u.annId!));
    for (const [frameId, annId] of track.frame_annotations.entries()) {
      // Skip if already updated, or if it's the current keyframe
      if (frameId === keyframeFrameId || updatedAnnIds.has(annId)) continue;

      const ann = annotations.get(annId);
      if (!ann || ann.type !== 'cuboid' || ann.is_keyframe) continue;

      const annData = ann.data as CuboidData;

      // Check if dimensions need sync
      const needsDimensionSync =
        annData.dimensions.length !== maxDimensions.length ||
        annData.dimensions.width !== maxDimensions.width ||
        annData.dimensions.height !== maxDimensions.height;

      // Check if orientation needs sync
      const needsOrientationSync = forceOrientationSync;

      if (needsDimensionSync || needsOrientationSync) {
        // Get the frame to transform rotation properly
        const frameForAnn = sortedFrames.find(f => f.id === frameId);
        const lidarRotation = (needsOrientationSync && frameForAnn)
          ? transformRotationFromWorld(canonicalWorldRotation, getEgoPose(frameForAnn), egoToLidar)
          : annData.rotation;

        annotationUpdates.push({
          frameId: frameId,
          annId: annId,
          data: {
            ...annData,
            dimensions: { ...maxDimensions },
            rotation: lidarRotation,
          },
          isNew: false,
        });
        console.log(`  Segment 6: Syncing ${needsDimensionSync ? 'dimensions' : ''}${needsDimensionSync && needsOrientationSync ? ' and ' : ''}${needsOrientationSync ? 'orientation' : ''} to non-keyframe at frame ${frameId.slice(0,8)}`);
      }
    }

    // Apply updates
    if (annotationUpdates.length > 0) {
      // IMPORTANT: Get the MOST RECENT state right before updating to avoid race conditions
      const latestEditorState = useEditorStore.getState();
      const currentAnnotations = new Map(latestEditorState.annotations);
      const currentDirty = new Map(latestEditorState.dirtyAnnotations);
      const newFrameAnnotations = new Map(track.frame_annotations);

      let createdCount = 0;
      let updatedCount = 0;

      for (const update of annotationUpdates) {
        if (update.isNew && task) {
          const newAnn: Annotation = {
            id: uuidv4(),
            task_id: task.id,
            frame_id: update.frameId,
            track_id: trackId,
            type: 'cuboid' as AnnotationType,
            class_id: track.class_id,
            data: update.data,
            attributes: track.attributes || {},
            source: 'auto_interpolated' as AnnotationSource,
            is_verified: true,
            is_keyframe: false,
            is_static: track.is_static ?? false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };

          currentAnnotations.set(newAnn.id, newAnn);
          currentDirty.set(newAnn.id, 'new');
          newFrameAnnotations.set(update.frameId, newAnn.id);
          createdCount++;
        } else if (update.annId) {
          const ann = currentAnnotations.get(update.annId);
          if (ann) {
            currentAnnotations.set(update.annId, {
              ...ann,
              data: update.data,
              source: 'auto_interpolated' as AnnotationSource,
              updated_at: new Date().toISOString(),
            });
            if (!currentDirty.has(update.annId) || currentDirty.get(update.annId) !== 'new') {
              currentDirty.set(update.annId, 'modified');
            }
            if (!newFrameAnnotations.has(update.frameId)) {
              newFrameAnnotations.set(update.frameId, update.annId);
            }
            updatedCount++;
          } else if (task) {
            // Annotation was in track.frame_annotations but no longer in editorStore
            // (e.g. lost after a backend re-fetch before the user saved).
            // Re-create it so the backward/forward frames stay in sync.
            const newAnn: Annotation = {
              id: uuidv4(),
              task_id: task.id,
              frame_id: update.frameId,
              track_id: trackId,
              type: 'cuboid' as AnnotationType,
              class_id: track.class_id,
              data: update.data,
              attributes: track.attributes || {},
              source: 'auto_interpolated' as AnnotationSource,
              is_verified: true,
              is_keyframe: false,
              is_static: track.is_static ?? false,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            };
            currentAnnotations.set(newAnn.id, newAnn);
            currentDirty.set(newAnn.id, 'new');
            newFrameAnnotations.set(update.frameId, newAnn.id);
            createdCount++;
          }
        }
      }

      useEditorStore.setState({
        annotations: currentAnnotations,
        dirtyAnnotations: currentDirty,
      });

      const updatedTrack: Track = {
        ...track,
        frame_annotations: newFrameAnnotations,
        updated_at: new Date().toISOString(),
      };

      const newTracks = new Map(get().tracks);
      newTracks.set(trackId, updatedTrack);
      set({ tracks: newTracks });

      console.log(`[TrackStore] interpolateAroundKeyframe: created=${createdCount}, updated=${updatedCount}`);
    }
  },
}));

// =============================================================================
// EXPORTS FOR COMPATIBILITY
// =============================================================================

// Interpolation method is now always hybrid-snap, kept for compatibility
export type InterpolationMethod = 'hybrid-snap';
const currentInterpolationMethod: InterpolationMethod = 'hybrid-snap';
export const setInterpolationMethod = (_method: InterpolationMethod) => { /* No-op, always hybrid-snap */ };
export const getInterpolationMethod = () => currentInterpolationMethod;

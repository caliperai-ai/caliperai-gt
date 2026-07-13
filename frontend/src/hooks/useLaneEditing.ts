import { useCallback, useState } from 'react';
import {
  Point2D,
  smoothLaneCatmullRom,
  simplifyLaneDouglasPeucker,
  snapLaneToVanishingLine,
  cleanupLane,
  convertToEditableBezier,
  bezierToPolyline,
  smoothLaneMovingAverage,
  smoothLaneRegion,
} from '@/utils/laneSmoothing';

export interface LaneEditingOptions {
  autoSnapToVP: boolean;
  autoSmooth: boolean;
  simplifyTolerance: number;
  smoothTension: number;
  defaultBezierMode: boolean;
}

export interface LaneEditingState {
  mode: 'polyline' | 'bezier';
  bezierHandles: [Point2D, Point2D, Point2D] | null;
  isEditing: boolean;
}

export interface UseLaneEditingReturn {
  state: LaneEditingState;
  options: LaneEditingOptions;

  setOptions: (opts: Partial<LaneEditingOptions>) => void;

  processDetectedLane: (points: Point2D[], imageWidth: number) => Point2D[];

  smoothLane: (points: Point2D[]) => Point2D[];

  simplifyLane: (points: Point2D[]) => Point2D[];

  snapToVanishingPoint: (points: Point2D[], imageWidth: number) => Point2D[];

  deJitterLane: (points: Point2D[]) => Point2D[];

  cleanupLane: (points: Point2D[], imageWidth: number) => Point2D[];

  convertToBezier: (points: Point2D[], imageWidth: number) => [Point2D, Point2D, Point2D];

  bezierToPolyline: (handles: [Point2D, Point2D, Point2D]) => Point2D[];

  smoothRegion: (points: Point2D[], yStart: number, yEnd: number) => Point2D[];

  enterBezierMode: (handles: [Point2D, Point2D, Point2D]) => void;

  exitBezierMode: () => Point2D[] | null;

  updateBezierHandles: (handles: [Point2D, Point2D, Point2D]) => void;

  vanishingLineY: number | undefined;
}

export function useLaneEditing(
  initialOptions?: Partial<LaneEditingOptions>
): UseLaneEditingReturn {

  const [options, setOptionsState] = useState<LaneEditingOptions>({
    autoSnapToVP: true,
    autoSmooth: true,
    simplifyTolerance: 2.5,
    smoothTension: 0.5,
    defaultBezierMode: false,
    ...initialOptions,
  });

  const [state, setState] = useState<LaneEditingState>({
    mode: 'polyline',
    bezierHandles: null,
    isEditing: false,
  });

  const vanishingLineY: number | undefined = undefined;


  const setOptions = useCallback((opts: Partial<LaneEditingOptions>) => {
    setOptionsState(prev => ({ ...prev, ...opts }));
  }, []);


  const smoothLane = useCallback((points: Point2D[]): Point2D[] => {
    if (points.length < 3) return points;
    return smoothLaneCatmullRom(points, 4, options.smoothTension);
  }, [options.smoothTension]);

  const simplifyLane = useCallback((points: Point2D[]): Point2D[] => {
    if (points.length < 3) return points;
    return simplifyLaneDouglasPeucker(points, options.simplifyTolerance);
  }, [options.simplifyTolerance]);

  const snapToVanishingPoint = useCallback((points: Point2D[], imageWidth: number): Point2D[] => {
    if (!vanishingLineY || points.length < 2) return points;
    return snapLaneToVanishingLine(points, vanishingLineY, imageWidth);
  }, [vanishingLineY]);

  const deJitterLane = useCallback((points: Point2D[]): Point2D[] => {
    return smoothLaneMovingAverage(points, 3);
  }, []);

  const cleanupLaneFunc = useCallback((points: Point2D[], imageWidth: number): Point2D[] => {
    let result = cleanupLane(points, options.simplifyTolerance, options.smoothTension);
    if (vanishingLineY) {
      result = snapLaneToVanishingLine(result, vanishingLineY, imageWidth);
    }
    return result;
  }, [options.simplifyTolerance, options.smoothTension, vanishingLineY]);

  const convertToBezier = useCallback((points: Point2D[], imageWidth: number): [Point2D, Point2D, Point2D] => {
    const { handles } = convertToEditableBezier(points, vanishingLineY, imageWidth);
    return handles;
  }, [vanishingLineY]);

  const bezierToPolylineFunc = useCallback((handles: [Point2D, Point2D, Point2D]): Point2D[] => {
    const [start, control, end] = handles;
    return bezierToPolyline(start, control, end, 25);
  }, []);

  const smoothRegion = useCallback((points: Point2D[], yStart: number, yEnd: number): Point2D[] => {
    return smoothLaneRegion(points, yStart, yEnd, 5);
  }, []);


  const processDetectedLane = useCallback((points: Point2D[], imageWidth: number): Point2D[] => {
    let result = points;

    if (options.autoSmooth) {
      result = cleanupLane(result, options.simplifyTolerance, options.smoothTension);
    }

    if (options.autoSnapToVP && vanishingLineY) {
      result = snapLaneToVanishingLine(result, vanishingLineY, imageWidth);
    }

    return result;
  }, [options.autoSmooth, options.autoSnapToVP, options.simplifyTolerance, options.smoothTension, vanishingLineY]);


  const enterBezierMode = useCallback((handles: [Point2D, Point2D, Point2D]) => {
    setState({
      mode: 'bezier',
      bezierHandles: handles,
      isEditing: true,
    });
  }, []);

  const exitBezierMode = useCallback((): Point2D[] | null => {
    if (state.mode !== 'bezier' || !state.bezierHandles) {
      return null;
    }

    const polyline = bezierToPolylineFunc(state.bezierHandles);

    setState({
      mode: 'polyline',
      bezierHandles: null,
      isEditing: false,
    });

    return polyline;
  }, [state.mode, state.bezierHandles, bezierToPolylineFunc]);

  const updateBezierHandles = useCallback((handles: [Point2D, Point2D, Point2D]) => {
    setState(prev => ({
      ...prev,
      bezierHandles: handles,
    }));
  }, []);


  return {
    state,
    options,
    setOptions,
    processDetectedLane,
    smoothLane,
    simplifyLane,
    snapToVanishingPoint,
    deJitterLane,
    cleanupLane: cleanupLaneFunc,
    convertToBezier,
    bezierToPolyline: bezierToPolylineFunc,
    smoothRegion,
    enterBezierMode,
    exitBezierMode,
    updateBezierHandles,
    vanishingLineY,
  };
}

export default useLaneEditing;

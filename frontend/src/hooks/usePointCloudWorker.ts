import { useState, useEffect, useRef, useCallback } from 'react';

interface ScanData {
  positions: Float32Array | number[];
  intensities: Float32Array | number[];
  pointCount: number;
  egoPose: {
    position: number[];
    rotation: number[];
  } | null;
}

interface StackedResult {
  positions: Float32Array;
  intensities: Float32Array;
  pointCount: number;
  origin: [number, number, number];
}

interface UsePointCloudWorkerOptions {
  voxelSize: number;
  maxPoints: number;
  enabled?: boolean;
}

interface UsePointCloudWorkerResult {
  stackedData: StackedResult | null;
  isProcessing: boolean;
  error: string | null;
  processScans: (scans: ScanData[], calibration: { rotation: number[][]; translation: number[] } | null) => void;
}

export function usePointCloudWorker(options: UsePointCloudWorkerOptions): UsePointCloudWorkerResult {
  const { voxelSize, maxPoints, enabled = true } = options;

  const [stackedData, setStackedData] = useState<StackedResult | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workerRef = useRef<Worker | null>(null);
  const pendingRequestRef = useRef<{ scans: ScanData[]; calibration: { rotation: number[][]; translation: number[] } | null } | null>(null);

  useEffect(() => {
    if (!enabled) return;

    try {
      workerRef.current = new Worker(
        new URL('../workers/pointCloudWorker.ts', import.meta.url),
        { type: 'module' }
      );

      workerRef.current.onmessage = (event) => {
        const data = event.data;

        if (data.type === 'result') {
          setStackedData({
            positions: data.positions,
            intensities: data.intensities,
            pointCount: data.pointCount,
            origin: data.origin,
          });
          setIsProcessing(false);
          setError(null);

          if (pendingRequestRef.current) {
            const pending = pendingRequestRef.current;
            pendingRequestRef.current = null;
            processScansInternal(pending.scans, pending.calibration);
          }
        } else if (data.type === 'error') {
          setError(data.message);
          setIsProcessing(false);
        }
      };

      workerRef.current.onerror = (err) => {
        console.error('[PointCloudWorker] Worker error:', err);
        setError('Worker error: ' + err.message);
        setIsProcessing(false);
      };
    } catch (err) {
      console.error('[PointCloudWorker] Failed to create worker:', err);
      setError('Failed to create worker');
    }

    return () => {
      if (workerRef.current) {
        workerRef.current.terminate();
        workerRef.current = null;
      }
    };
  }, [enabled]);

  const processScansInternal = useCallback((
    scans: ScanData[],
    calibration: { rotation: number[][]; translation: number[] } | null
  ) => {
    if (!workerRef.current) return;

    setIsProcessing(true);

    const scanData = scans.map(scan => ({
      positions: scan.positions,
      intensities: scan.intensities,
      pointCount: scan.pointCount,
      egoPose: scan.egoPose,
    }));

    workerRef.current.postMessage({
      type: 'stack',
      scans: scanData,
      calibration,
      voxelSize,
      maxPoints,
    });
  }, [voxelSize, maxPoints]);

  const processScans = useCallback((
    scans: ScanData[],
    calibration: { rotation: number[][]; translation: number[] } | null
  ) => {
    if (!enabled || !workerRef.current) {
      return;
    }

    if (isProcessing) {
      pendingRequestRef.current = { scans, calibration };
      return;
    }

    processScansInternal(scans, calibration);
  }, [enabled, isProcessing, processScansInternal]);

  return {
    stackedData,
    isProcessing,
    error,
    processScans,
  };
}

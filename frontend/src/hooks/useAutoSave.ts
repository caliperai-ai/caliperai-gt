import { useEffect, useRef, useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useEditorStore } from '@/store/editorStore';
import { useAnnotation4DStore } from '@/store/annotation4DStore';

export interface AutoSaveOptions {
  interval?: number;
  enabled?: boolean;
  autoRefresh?: boolean;
  taskId?: string;
  onSaveStart?: () => void;
  onSaveSuccess?: () => void;
  onSaveError?: (error: string) => void;
}

export interface AutoSaveState {
  isSaving: boolean;
  lastSavedAt: Date | null;
  lastError: string | null;
  hasUnsavedChanges: boolean;
  triggerSave: () => Promise<void>;
}

export function useAutoSave(options: AutoSaveOptions = {}): AutoSaveState {
  const {
    interval = 2000,
    enabled = true,
    autoRefresh = true,
    taskId,
    onSaveStart,
    onSaveSuccess,
    onSaveError,
  } = options;

  const queryClient = useQueryClient();
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const saveInProgressRef = useRef(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const onSaveStartRef = useRef(onSaveStart);
  const onSaveSuccessRef = useRef(onSaveSuccess);
  const onSaveErrorRef = useRef(onSaveError);

  const autoRefreshRef = useRef(autoRefresh);
  const taskIdRef = useRef(taskId);
  const queryClientRef = useRef(queryClient);

  useEffect(() => {
    onSaveStartRef.current = onSaveStart;
    onSaveSuccessRef.current = onSaveSuccess;
    onSaveErrorRef.current = onSaveError;
    autoRefreshRef.current = autoRefresh;
    taskIdRef.current = taskId;
    queryClientRef.current = queryClient;
  }, [onSaveStart, onSaveSuccess, onSaveError, autoRefresh, taskId, queryClient]);

  const performSave = useCallback(async () => {
    if (saveInProgressRef.current) {
      return;
    }

    const editorState = useEditorStore.getState();
    const annotation4DState = useAnnotation4DStore.getState();

    const has3DChanges = editorState.hasUnsavedChanges();
    const isSaving3D = editorState.isSaving;

    const has4DChanges = Array.from(annotation4DState.annotations4D.values()).some(
      (a) => a.is_new || a.is_dirty || a.is_deleted
    );
    const isSaving4D = annotation4DState.isSaving;

    if (isSaving3D || isSaving4D) {
      return;
    }

    if (!has3DChanges && !has4DChanges) {
      return;
    }


    saveInProgressRef.current = true;
    setIsSaving(true);
    setLastError(null);
    onSaveStartRef.current?.();

    try {
      const errors: string[] = [];

      if (has3DChanges) {
        const result3D = await editorState.saveAnnotations();
        if (!result3D.success) {
          errors.push(`3D: ${result3D.error || 'Unknown error'}`);
          console.error('[AutoSave] 3D save failed:', result3D.error);
        } else {
        }
      }

      // Save 4D annotations
      if (has4DChanges) {
        const result4D = await annotation4DState.saveAnnotations4D();
        if (!result4D.success) {
          errors.push(`4D: ${result4D.error || 'Unknown error'}`);
          console.error('[AutoSave] 4D save failed:', result4D.error);
        } else {
        }
      }

      if (errors.length > 0) {
        const errorMsg = errors.join('; ');
        setLastError(errorMsg);
        onSaveErrorRef.current?.(errorMsg);
        console.error('[AutoSave] Save completed with errors:', errorMsg);
      } else {
        setLastSavedAt(new Date());
        onSaveSuccessRef.current?.();

        // Auto-refresh: invalidate annotation queries to reload from backend
        if (autoRefreshRef.current && taskIdRef.current) {
          // Invalidate all annotation-related queries for this task
          queryClientRef.current.invalidateQueries({ queryKey: ['annotations', taskIdRef.current] });
          queryClientRef.current.invalidateQueries({ queryKey: ['annotations-3d', taskIdRef.current] });
          queryClientRef.current.invalidateQueries({ queryKey: ['annotations-2d', taskIdRef.current] });
          queryClientRef.current.invalidateQueries({ queryKey: ['annotations-4d', taskIdRef.current] });
        }
      }
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      setLastError(errorMsg);
      onSaveErrorRef.current?.(errorMsg);
      console.error('[AutoSave] Save failed with exception:', error);
    } finally {
      saveInProgressRef.current = false;
      setIsSaving(false);
    }
  }, []); // No dependencies - we get fresh state inside

  // Set up the auto-save interval
  useEffect(() => {
    if (!enabled) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }


    // Start the interval
    intervalRef.current = setInterval(() => {
      performSave();
    }, interval);

    // Cleanup on unmount or when dependencies change
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [enabled, interval, performSave]);

  // Save on page unload (beforeunload)
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      // Get fresh state
      const editorState = useEditorStore.getState();
      const annotation4DState = useAnnotation4DStore.getState();

      const has3DChanges = editorState.hasUnsavedChanges();
      const has4DChanges = Array.from(annotation4DState.annotations4D.values()).some(
        (a) => a.is_new || a.is_dirty || a.is_deleted
      );

      if (has3DChanges || has4DChanges) {
        // Trigger a save attempt (may not complete)
        performSave();

        // Show browser's native confirmation dialog
        e.preventDefault();
        e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
        return e.returnValue;
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [performSave]);

  // Calculate current unsaved changes state for the return value
  // This subscribes to store changes so the UI updates
  const dirtyAnnotations = useEditorStore((s) => s.dirtyAnnotations);
  const annotations4D = useAnnotation4DStore((s) => s.annotations4D);

  const hasUnsavedChanges = dirtyAnnotations.size > 0 ||
    Array.from(annotations4D.values()).some((a) => a.is_new || a.is_dirty || a.is_deleted);

  return {
    isSaving,
    lastSavedAt,
    lastError,
    hasUnsavedChanges,
    triggerSave: performSave,
  };
}

export default useAutoSave;

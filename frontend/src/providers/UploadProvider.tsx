import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export interface UploadTask {
  id: string;
  organizationId?: string | null;
  datasetId: string;
  datasetName: string;
  fileName: string;
  progress: number;
  speed: string;
  status: 'uploading' | 'processing' | 'complete' | 'error';
  error?: string;
  startTime: number;
  xhr?: XMLHttpRequest;
}

interface UploadContextValue {
  uploads: UploadTask[];
  addUpload: (task: Omit<UploadTask, 'id' | 'startTime'>) => string;
  updateUpload: (id: string, updates: Partial<UploadTask>) => void;
  removeUpload: (id: string) => void;
  cancelUpload: (id: string) => void;
  clearCompleted: () => void;
  isMinimized: boolean;
  setMinimized: (minimized: boolean) => void;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export const useUpload = () => {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error('useUpload must be used within an UploadProvider');
  }
  return context;
};

export const UploadProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [isMinimized, setMinimized] = useState(false);
  const idCounter = useRef(0);

  const addUpload = useCallback((task: Omit<UploadTask, 'id' | 'startTime'>) => {
    const id = `upload-${++idCounter.current}-${Date.now()}`;
    setUploads(prev => [...prev, { ...task, id, startTime: Date.now() }]);
    return id;
  }, []);

  const updateUpload = useCallback((id: string, updates: Partial<UploadTask>) => {
    setUploads(prev => prev.map(upload => 
      upload.id === id ? { ...upload, ...updates } : upload
    ));
  }, []);

  const removeUpload = useCallback((id: string) => {
    setUploads(prev => prev.filter(upload => upload.id !== id));
  }, []);

  const cancelUpload = useCallback((id: string) => {
    setUploads(prev => {
      const upload = prev.find(u => u.id === id);
      if (upload?.xhr) {
        upload.xhr.abort();
      }
      return prev.filter(u => u.id !== id);
    });
  }, []);

  const clearCompleted = useCallback(() => {
    setUploads(prev => prev.filter(upload => 
      upload.status !== 'complete' && upload.status !== 'error'
    ));
  }, []);

  return (
    <UploadContext.Provider value={{
      uploads,
      addUpload,
      updateUpload,
      removeUpload,
      cancelUpload,
      clearCompleted,
      isMinimized,
      setMinimized,
    }}>
      {children}
    </UploadContext.Provider>
  );
};

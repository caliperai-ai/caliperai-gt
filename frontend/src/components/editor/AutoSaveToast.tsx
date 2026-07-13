import React, { useEffect, useState, useRef } from 'react';

interface AutoSaveToastProps {
  isSaving: boolean;
  lastSavedAt: Date | null;
  error: Error | string | null;
}

export const AutoSaveToast: React.FC<AutoSaveToastProps> = ({ isSaving, lastSavedAt, error }) => {
  const [show, setShow] = useState(false);
  const [message, setMessage] = useState('');
  const [type, setType] = useState<'success' | 'error' | 'saving'>('success');
  const lastSaveTimeRef = useRef<number>(0);

  useEffect(() => {
    if (isSaving) {
      setShow(true);
      setMessage('Saving...');
      setType('saving');
    } else if (error) {
      setShow(true);
      setMessage('Save Failed!');
      setType('error');
    } else if (lastSavedAt) {
      if (lastSavedAt.getTime() !== lastSaveTimeRef.current) {
        lastSaveTimeRef.current = lastSavedAt.getTime();
        setShow(true);
        setMessage(`Saved at ${lastSavedAt.toLocaleTimeString()}`);
        setType('success');
        // Hide after 3 seconds
        const timer = setTimeout(() => setShow(false), 3000);
        return () => clearTimeout(timer);
      }
    }
  }, [isSaving, lastSavedAt, error]);

  if (!show) return null;

  return (
    <div className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg backdrop-blur-md border z-50 transition-all duration-300 transform ${
      type === 'error' ? 'bg-red-500/20 border-red-500/50 text-red-100' :
      type === 'saving' ? 'bg-blue-500/20 border-blue-500/50 text-blue-100' :
      'bg-green-500/20 border-green-500/50 text-green-100'
    }`}>
      <div className="flex items-center gap-2">
        {type === 'saving' && (
           <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
             <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
             <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
           </svg>
        )}
        {type === 'success' && <span className="font-bold">✓</span>}
        {type === 'error' && <span className="font-bold">!</span>}
        <span className="text-sm font-medium">{message}</span>
      </div>
    </div>
  );
};

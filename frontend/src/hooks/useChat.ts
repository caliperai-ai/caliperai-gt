import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useChatStore } from '@/store/chatStore';
import type { ChatContext } from '@/types/chat';


const pageContextMap: Record<string, Partial<ChatContext>> = {
  '/': { current_page: 'dashboard' },
  '/dashboard': { current_page: 'dashboard' },
  '/campaigns': { current_page: 'campaigns' },
  '/datasets': { current_page: 'datasets' },
  '/tasks': { current_page: 'tasks' },
  '/admin': { current_page: 'admin' },
  '/taxonomy': { current_page: 'taxonomy' },
};


export function useChatContext() {
  const location = useLocation();
  const { setContext, currentContext } = useChatStore();

  useEffect(() => {
    const path = location.pathname;

    if (pageContextMap[path]) {
      setContext(pageContextMap[path]);
      return;
    }

    if (path.includes('/editor/')) {
      setContext({ current_page: 'editor' });
      return;
    }

    if (path.includes('/viewer') || path.includes('/scene/')) {
      setContext({ current_page: 'viewer' });
      return;
    }

    if (path.match(/\/datasets\/[^/]+$/)) {
      setContext({ current_page: 'dataset_detail' });
      return;
    }

    if (path.match(/\/campaigns\/[^/]+$/)) {
      setContext({ current_page: 'campaign_detail' });
      return;
    }

    setContext({ current_page: 'unknown' });
  }, [location.pathname, setContext]);

  const updateContext = (updates: Partial<ChatContext>) => {
    setContext(updates);
  };

  const setView = (view: '3d' | '2d' | 'split' | 'camera') => {
    setContext({ current_view: view });
  };

  const setTool = (tool: string) => {
    setContext({ selected_tool: tool });
  };

  const setTaskContext = (taskId: string) => {
    setContext({ task_id: taskId });
  };

  const setDatasetContext = (datasetId: string) => {
    setContext({ dataset_id: datasetId });
  };

  return {
    currentContext,
    updateContext,
    setView,
    setTool,
    setTaskContext,
    setDatasetContext,
  };
}

export default useChatContext;

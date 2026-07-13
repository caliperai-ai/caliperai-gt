import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import { AuthenticatedActivityTracker } from './providers/AuthenticatedActivityTracker';
import { UploadProvider } from './providers/UploadProvider';
import { FloatingUploadProgress } from './components/FloatingUploadProgress';
import { BRAND } from './config/branding';
import './index.css';

document.title = `${BRAND.name}: Sensor Fusion Annotation Platform`;

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      retry: 1,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <UploadProvider>
          <AuthenticatedActivityTracker>
            <App />
          </AuthenticatedActivityTracker>
          <FloatingUploadProgress />
        </UploadProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>
);

import { Routes, Route, Navigate } from 'react-router-dom';
import { FusionEditorV2 } from './pages/FusionEditorV2';
import { SemanticSegmentationEditor } from './pages/SemanticSegmentationEditor';
import { TaskEditorRedirect } from './pages/TaskEditorRedirect';
import { Dashboard } from './pages/Dashboard';
import { MyTasksPage } from './pages/MyTasksPage';
import MyDashboardPage from './pages/MyDashboardPage';
import PMDashboardPage from './pages/PMDashboardPage';
import { CampaignDetail } from './pages/CampaignDetail';
import { DatasetDetail } from './pages/DatasetDetail';
import { TaxonomiesPage } from './pages/TaxonomiesPage';
import { TaxonomyDetail } from './pages/TaxonomyDetail';
import { LoginPage } from './pages/LoginPage';
import { SSOCallbackPage } from './pages/SSOCallbackPage';
import { UnauthorizedPage } from './pages/UnauthorizedPage';
import { AdminSettingsPage } from './pages/AdminSettingsPage';
import { ProfilePage } from './pages/ProfilePage';
import { ProtectedRoute } from './components/auth/ProtectedRoute';
import { OnboardingProvider } from './components/onboarding';
import { useState, useCallback, useEffect } from 'react';
import { KeyboardShortcutsModal } from './components/KeyboardShortcutsModal';
import { checkAuth } from './api/auth';
import { useAuthStore } from './store/authStore';
import { FeatureGate } from './components/FeatureGate';

function App() {
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  useEffect(() => {
    if (isAuthenticated) {
      checkAuth();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleShowKeyboardShortcuts = useCallback(() => {
    setShowKeyboardShortcuts(true);
  }, []);

  return (
    <OnboardingProvider onShowKeyboardShortcuts={handleShowKeyboardShortcuts}>
      <Routes>
      {/* Public Routes */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="/auth/sso/callback" element={<SSOCallbackPage />} />
      <Route path="/unauthorized" element={<UnauthorizedPage />} />

      {/* Protected Routes - Require Authentication */}
      {/* Dashboard - Only for Admin and Project Manager */}
      <Route
        path="/"
        element={
          <ProtectedRoute roles={['admin', 'project_manager']} unauthorizedPath="/my-tasks">
            <Dashboard />
          </ProtectedRoute>
        }
      />

      {/* Admin Settings - Requires admin role */}
      <Route
        path="/admin"
        element={
          <ProtectedRoute roles="admin">
            <AdminSettingsPage />
          </ProtectedRoute>
        }
      />

      {/* Profile - Available to all authenticated users */}
      <Route
        path="/profile"
        element={
          <ProtectedRoute>
            <ProfilePage />
          </ProtectedRoute>
        }
      />

      {/* PM Dashboard - Project Manager Analytics.
          Gated by the pm_dashboard feature; disabled editions redirect home. */}
      <Route
        path="/pm-dashboard"
        element={
          <FeatureGate feature="pm_dashboard" fallback={<Navigate to="/" replace />}>
            <ProtectedRoute permissions="dashboard:view_global">
              <PMDashboardPage />
            </ProtectedRoute>
          </FeatureGate>
        }
      />

      {/* My Tasks - Annotator's primary work queue */}
      <Route
        path="/my-tasks"
        element={
          <ProtectedRoute permissions="tasks:read_assigned">
            <MyTasksPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/my-dashboard"
        element={
          <ProtectedRoute>
            <MyDashboardPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/campaigns/:campaignId"
        element={
          <ProtectedRoute permissions="campaigns:read">
            <CampaignDetail />
          </ProtectedRoute>
        }
      />

      <Route
        path="/datasets/:datasetId"
        element={
          <ProtectedRoute permissions="datasets:read">
            <DatasetDetail />
          </ProtectedRoute>
        }
      />

      <Route
        path="/taxonomies"
        element={
          <ProtectedRoute permissions="taxonomies:read">
            <TaxonomiesPage />
          </ProtectedRoute>
        }
      />

      <Route
        path="/taxonomies/:taxonomyId"
        element={
          <ProtectedRoute permissions="taxonomies:read">
            <TaxonomyDetail />
          </ProtectedRoute>
        }
      />

      {/* Fusion Editor - 3D/4D/Fusion/2D annotations (specific route first) */}
      <Route
        path="/tasks/:taskId/editor"
        element={
          <ProtectedRoute permissions={['annotations:read', 'qa:review']}>
            <FusionEditorV2 />
          </ProtectedRoute>
        }
      />

      {/* Semantic Segmentation Editor - LiDAR point cloud labeling */}
      <Route
        path="/tasks/:taskId/segmentation"
        element={
          <ProtectedRoute permissions={['annotations:read', 'annotations:create']}>
            <SemanticSegmentationEditor />
          </ProtectedRoute>
        }
      />

      {/* Task Editor Redirect - Determines which editor to use based on taxonomy (catch-all) */}
      <Route
        path="/tasks/:taskId"
        element={
          <ProtectedRoute permissions={['annotations:read', 'qa:review']}>
            <TaskEditorRedirect />
          </ProtectedRoute>
        }
      />
    </Routes>

    {/* Global Keyboard Shortcuts Modal */}
    <KeyboardShortcutsModal isOpen={showKeyboardShortcuts} onClose={() => setShowKeyboardShortcuts(false)} />
    </OnboardingProvider>
  );
}

export default App;


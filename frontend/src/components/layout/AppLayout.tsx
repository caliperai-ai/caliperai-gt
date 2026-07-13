import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import { UserMenu } from '@/components/auth/UserMenu';
import { GlobalSessionTimer } from '@/components/efficiency';
import { ChatPanel } from '@/components/chat';
import { BRAND } from '@/config/branding';
import { FeatureGate } from '@/components/FeatureGate';

interface AppLayoutProps {
  children: React.ReactNode;
  hideSidebar?: boolean;
  headerContent?: React.ReactNode;
  headerActions?: React.ReactNode;
}

export const AppLayout: React.FC<AppLayoutProps> = ({
  children,
  hideSidebar = false,
  headerContent,
  headerActions,
}) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(256);

  React.useEffect(() => {
    const savedCollapsed = localStorage.getItem('sidebar-collapsed');
    const savedWidth = localStorage.getItem('sidebar-width');

    if (savedCollapsed !== null) {
      setIsSidebarCollapsed(JSON.parse(savedCollapsed));
    }
    if (savedWidth !== null) {
      setSidebarWidth(parseInt(savedWidth, 10));
    }
  }, []);

  const handleToggleSidebar = () => {
    const newState = !isSidebarCollapsed;
    setIsSidebarCollapsed(newState);
    localStorage.setItem('sidebar-collapsed', JSON.stringify(newState));
  };

  const handleWidthChange = (newWidth: number) => {
    setSidebarWidth(newWidth);
    localStorage.setItem('sidebar-width', newWidth.toString());
  };

  if (hideSidebar) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-dark">
      {/* Sidebar */}
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={handleToggleSidebar}
        width={sidebarWidth}
        onWidthChange={handleWidthChange}
      />

      {/* Main Content Area */}
      <div
        className="transition-all duration-300"
        style={{ marginLeft: `${isSidebarCollapsed ? 64 : sidebarWidth}px` }}
      >
        {/* Top Header Bar */}
        <header className="sticky top-0 z-40 h-14 bg-dark-panel/95 backdrop-blur-sm border-b border-gray-800">
          <div className="h-full flex items-center gap-4 px-6">
            {/* Left side - custom content or breadcrumbs. min-w-0 + overflow-hidden
                lets it truncate instead of sliding under the centered brand. */}
            <div className="flex-1 min-w-0 overflow-hidden">
              {headerContent}
            </div>

            {/* Center - Brand. A normal (non-absolute) flex column so it can no
                longer overlap its neighbours; equal flex-1 on both sides keeps it centered. */}
            <div className="shrink-0 flex flex-col items-center leading-tight">
              <span className="text-xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-500 bg-clip-text text-transparent tracking-tight whitespace-nowrap">
                {BRAND.name}
              </span>
              <span className="text-[10px] text-gray-400 tracking-wide whitespace-nowrap">
                Sensor Fusion Annotation Platform
              </span>
            </div>

            {/* Right side - optional page actions, then Session Timer and User menu */}
            <div className="flex-1 min-w-0 flex items-center justify-end gap-3">
              {headerActions && (
                <div className="flex items-center gap-2 shrink-0">{headerActions}</div>
              )}
              <GlobalSessionTimer />
              <UserMenu />
            </div>
          </div>
        </header>

        {/* Page Content */}
        <main className="min-h-[calc(100vh-3.5rem)]">
          {children}
        </main>
      </div>

      {/* AI Chat Panel */}
      <FeatureGate feature="chat">
        <ChatPanel />
      </FeatureGate>
    </div>
  );
};

export default AppLayout;

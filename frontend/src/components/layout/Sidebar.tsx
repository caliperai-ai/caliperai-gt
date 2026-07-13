import React, { useState, useEffect } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { campaignApi, datasetApi } from '@/api/client';
import { useAuthStore } from '@/store/authStore';
import { useOrganizationStore, useCurrentOrganization, useOrganizations } from '@/store/organizationStore';
import type { Campaign } from '@/types';
import { BRAND } from '@/config/branding';
import { FeatureGate } from '@/components/FeatureGate';


interface SidebarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  width: number;
  onWidthChange: (width: number) => void;
}

interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  to: string;
  isActive?: boolean;
  isCollapsed: boolean;
  badge?: number;
  children?: React.ReactNode;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
  hasChildren?: boolean;
}


const NavItem: React.FC<NavItemProps> = ({
  icon,
  label,
  to,
  isActive,
  isCollapsed,
  badge,
  children,
  isExpanded,
  onToggleExpand,
  hasChildren,
}) => {
  return (
    <div>
      <div className="flex items-center">
        {hasChildren && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onToggleExpand?.();
            }}
            className={`p-1 rounded hover:bg-slate-700/50 transition-colors ${isCollapsed ? 'hidden' : ''}`}
          >
            <svg
              className={`w-3 h-3 text-slate-500 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}
        <Link
          to={to}
          className={`flex-1 flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200 group ${
            isActive
              ? 'bg-gradient-to-r from-cyan-500/30 via-blue-500/25 to-purple-500/20 text-white shadow-lg shadow-cyan-500/20 border border-cyan-400/40 font-semibold'
              : 'text-slate-300 hover:text-white hover:bg-slate-800/70 hover:shadow-md hover:scale-[1.02]'
          } ${!hasChildren ? 'ml-4' : ''}`}
          title={isCollapsed ? label : undefined}
        >
          <span className={`flex-shrink-0 ${isActive ? 'text-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]' : 'text-slate-400 group-hover:text-cyan-400'} transition-all`}>
            {icon}
          </span>
          {!isCollapsed && (
            <>
              <span className="flex-1 text-[15px] font-medium truncate">{label}</span>
              {badge !== undefined && badge > 0 && (
                <span className="px-2 py-0.5 text-xs rounded-full bg-cyan-500/20 text-cyan-400 font-semibold">
                  {badge}
                </span>
              )}
            </>
          )}
        </Link>
      </div>
      {!isCollapsed && isExpanded && children && (
        <div className="ml-4 mt-1 space-y-1 border-l border-slate-700/50 pl-2">
          {children}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// CAMPAIGN TREE ITEM
// =============================================================================

interface CampaignTreeItemProps {
  campaign: Campaign;
  isCollapsed: boolean;
  isActive: boolean;
  activeDatasetId?: string;
}

const CampaignTreeItem: React.FC<CampaignTreeItemProps> = ({
  campaign,
  isCollapsed,
  isActive,
  activeDatasetId,
}) => {
  const [isExpanded, setIsExpanded] = useState(isActive);

  // Auto-expand if this campaign contains the active dataset
  useEffect(() => {
    if (isActive) setIsExpanded(true);
  }, [isActive]);

  // Fetch datasets for this campaign when expanded
  const { data: datasets } = useQuery({
    queryKey: ['datasets', campaign.id],
    queryFn: () => datasetApi.list(campaign.id),
    enabled: isExpanded && !isCollapsed,
  });

  return (
    <NavItem
      icon={
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
        </svg>
      }
      label={campaign.name}
      to={`/campaigns/${campaign.id}`}
      isActive={isActive && !activeDatasetId}
      isCollapsed={isCollapsed}
      badge={campaign.stats?.total_datasets}
      hasChildren={(campaign.stats?.total_datasets ?? 0) > 0}
      isExpanded={isExpanded}
      onToggleExpand={() => setIsExpanded(!isExpanded)}
    >
      {datasets?.map((dataset) => (
        <Link
          key={dataset.id}
          to={`/datasets/${dataset.id}`}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
            activeDatasetId === dataset.id
              ? 'bg-cyan-500/10 text-cyan-400'
              : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/30'
          }`}
        >
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
          </svg>
          <span className="truncate">{dataset.name}</span>
        </Link>
      ))}
    </NavItem>
  );
};

// =============================================================================
// MAIN SIDEBAR COMPONENT
// =============================================================================

export const Sidebar: React.FC<SidebarProps> = ({ isCollapsed, onToggleCollapse, width, onWidthChange }) => {
  const location = useLocation();
  const params = useParams();
  const { user, hasRole, hasAnyRole } = useAuthStore();
  const organizations = useOrganizations();
  const currentOrganization = useCurrentOrganization();
  const { setCurrentOrganization } = useOrganizationStore();

  // Check if user can see campaigns (admin and project_manager only)
  const canSeeCampaigns = hasAnyRole(['admin', 'project_manager']);
  const [isResizing, setIsResizing] = useState(false);

  // Handle resize
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return;
      const newWidth = e.clientX;
      if (newWidth >= 200 && newWidth <= 500) {
        onWidthChange(newWidth);
      }
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [isResizing, onWidthChange]);

  // Fetch campaigns filtered by current organization
  const { data: campaignsData } = useQuery({
    queryKey: ['campaigns', currentOrganization?.id],
    queryFn: () => campaignApi.list({ organization_id: currentOrganization?.id } as any),
    enabled: canSeeCampaigns,
  });

  const campaigns = campaignsData?.items ?? [];

  // Determine active states
  const isHome = location.pathname === '/';
  const isMyTasks = location.pathname === '/my-tasks';
  const isTaxonomies = location.pathname.startsWith('/taxonomies');
  const isAdmin = location.pathname === '/admin';
  const activeCampaignId = params.campaignId;
  const activeDatasetId = params.datasetId;

  // Get the campaign ID from dataset if we're on a dataset page
  const { data: activeDataset } = useQuery({
    queryKey: ['dataset', activeDatasetId],
    queryFn: () => datasetApi.get(activeDatasetId!),
    enabled: !!activeDatasetId,
  });

  const campaignIdFromDataset = activeDataset?.campaign_id;

  return (
    <aside
      data-tour="sidebar"
      style={{ width: isCollapsed ? '64px' : `${width}px` }}
      className="fixed left-0 top-0 h-screen bg-gradient-to-b from-slate-900 via-slate-900 to-slate-950 border-r border-slate-700/50 z-50 transition-all duration-300 flex flex-col shadow-2xl"
    >
      {/* Logo & Collapse Toggle */}
      <div className="h-14 flex items-center justify-between px-4 border-b border-slate-700/50 bg-slate-900/50">
        <Link to="/" className="group">
          {BRAND.showLogo ? (
            <img src="/logo.svg?v=2" alt={BRAND.name} className="h-7 w-auto group-hover:scale-105 transition-transform" />
          ) : (
            <span className="text-sm font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-500 bg-clip-text text-transparent group-hover:scale-105 transition-transform">
              {BRAND.name}
            </span>
          )}
        </Link>
        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800/70 transition-all hover:scale-105"
          title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <svg
            className={`w-4 h-4 transition-transform ${isCollapsed ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>

      {/* Organization Selector */}
      {!isCollapsed && organizations.length > 0 && (
        <div className="px-3 py-2 border-b border-slate-700/50">
          <label className="text-xs text-slate-500 font-medium block mb-1">Organization</label>
          <select
            value={currentOrganization?.id || ''}
            onChange={(e) => {
              const org = organizations.find(o => o.id === e.target.value);
              if (org) setCurrentOrganization(org);
            }}
            className="w-full px-2 py-1.5 bg-slate-800 border border-slate-700 rounded-md text-sm text-white focus:outline-none focus:border-cyan-500"
          >
            {organizations.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      )}
      {isCollapsed && organizations.length > 1 && (
        <div className="px-2 py-2 border-b border-slate-700/50">
          <button
            title={`Current: ${currentOrganization?.name || 'Select organization'}`}
            className="w-full p-2 rounded-md bg-slate-800 border border-slate-700 text-cyan-400 hover:bg-slate-700 transition-colors"
          >
            <svg className="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
            </svg>
          </button>
        </div>
      )}

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-4 px-2.5 space-y-1.5 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
        {/* Home / Dashboard - Only for Admin and Project Manager */}
        {canSeeCampaigns && (
          <NavItem
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
              </svg>
            }
            label="Home"
            to="/"
            isActive={isHome}
            isCollapsed={isCollapsed}
          />
        )}

        {/* My Tasks - Primary work queue for annotators/reviewers */}
        <NavItem
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
          }
          label="My Tasks"
          to="/my-tasks"
          isActive={isMyTasks}
          isCollapsed={isCollapsed}
        />

        {/* My Dashboard - Personal analytics for annotators */}
        <NavItem
          icon={
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M16 8v8m-4-5v5m-4-2v2m-2 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
          label="My Dashboard"
          to="/my-dashboard"
          isActive={location.pathname === '/my-dashboard'}
          isCollapsed={isCollapsed}
        />

        {/* PM Dashboard - Analytics for Project Managers */}
        {canSeeCampaigns && (
          <FeatureGate feature="pm_dashboard">
            <NavItem
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              }
              label="PM Dashboard"
              to="/pm-dashboard"
              isActive={location.pathname === '/pm-dashboard'}
              isCollapsed={isCollapsed}
            />
          </FeatureGate>
        )}

        {/* Campaigns Section - Only for Admin and Project Manager */}
        {canSeeCampaigns && (
          <>
            {/* Divider */}
            <div className="my-3 border-t border-gray-800" />

            {/* Section Label */}
            {!isCollapsed && (
              <div className="px-3 py-2 text-xs font-semibold text-gray-600 uppercase tracking-wider">
                Campaigns
              </div>
            )}

            {/* Campaigns List */}
            <div className="space-y-1">
              {campaigns.map((campaign) => (
                <CampaignTreeItem
                  key={campaign.id}
                  campaign={campaign}
                  isCollapsed={isCollapsed}
                  isActive={activeCampaignId === campaign.id || campaignIdFromDataset === campaign.id}
                  activeDatasetId={activeDatasetId}
                />
              ))}
              {campaigns.length === 0 && !isCollapsed && (
                <p className="px-3 py-2 text-xs text-gray-600 italic">No campaigns yet</p>
              )}
            </div>

            {/* Divider */}
            <div className="my-3 border-t border-gray-800" />

            {/* Taxonomies */}
            <NavItem
              icon={
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z" />
                </svg>
              }
              label="Taxonomies"
              to="/taxonomies"
              isActive={isTaxonomies}
              isCollapsed={isCollapsed}
            />
          </>
        )}

        {/* Admin Settings - Only for admins */}
        {hasRole('admin') && (
          <NavItem
            icon={
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            }
            label="Admin Settings"
            to="/admin"
            isActive={isAdmin}
            isCollapsed={isCollapsed}
          />
        )}
      </nav>

      {/* User Section at Bottom */}
      <div className="border-t border-gray-800 p-3">
        {!isCollapsed ? (
          <div className="flex items-center gap-3 px-2 py-2 rounded-lg bg-gray-800/50">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-sm font-medium">
              {user?.full_name?.charAt(0) || user?.username?.charAt(0) || '?'}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm text-white truncate">{user?.full_name || user?.username}</p>
              <p className="text-xs text-gray-500 truncate">{user?.role || 'User'}</p>
            </div>
          </div>
        ) : (
          <div className="flex justify-center">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center text-white text-sm font-medium">
              {user?.full_name?.charAt(0) || user?.username?.charAt(0) || '?'}
            </div>
          </div>
        )}
      </div>

      {/* Resize Handle */}
      {!isCollapsed && (
        <div
          onMouseDown={handleMouseDown}
          className="absolute right-0 top-0 h-full w-1 hover:w-2 bg-slate-600/30 hover:bg-cyan-500/70 cursor-ew-resize transition-all group"
          title="Drag to resize"
        >
          <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-12 bg-cyan-400/0 group-hover:bg-cyan-400/80 rounded-l-full transition-all shadow-[0_0_10px_rgba(34,211,238,0.5)] opacity-0 group-hover:opacity-100" />
        </div>
      )}
    </aside>
  );
};

export default Sidebar;

import type { Step, Placement } from 'react-joyride';
import type { TourId } from '@/store/onboardingStore';
import { BRAND } from '@/config/branding';


export interface TourDefinition {
  id: TourId;
  name: string;
  description: string;
  steps: Step[];
  validPaths: string[];
  requiredRole?: string | null;
  autoStart: boolean;
}


const KeyBadge = ({ children, glow }: { children: string; glow?: boolean }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: '36px',
    height: '36px',
    padding: '0 12px',
    background: glow ? 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)' : 'linear-gradient(180deg, #475569 0%, #334155 100%)',
    borderRadius: '8px',
    fontSize: '14px',
    fontWeight: 700,
    color: '#fff',
    boxShadow: glow ? '0 0 16px rgba(6, 182, 212, 0.5)' : '0 2px 4px rgba(0,0,0,0.3), inset 0 1px 0 rgba(255,255,255,0.1)',
    border: '1px solid rgba(255,255,255,0.1)',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  }}>{children}</span>
);

const IconCircle = ({ emoji, color, size = 56 }: { emoji: string; color: string; size?: number }) => (
  <div style={{
    width: size,
    height: size,
    borderRadius: '50%',
    background: `linear-gradient(135deg, ${color}40 0%, ${color}20 100%)`,
    border: `2px solid ${color}`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: size * 0.5,
    boxShadow: `0 0 24px ${color}30`,
  }}>{emoji}</div>
);

// Visual card component
const VisualCard = ({ icon, title, description, color }: { icon: string; title: string; description: string; color: string }) => (
  <div style={{
    display: 'flex',
    alignItems: 'center',
    gap: '14px',
    padding: '14px 16px',
    background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
    borderRadius: '12px',
    border: `1px solid ${color}40`,
    marginBottom: '10px',
  }}>
    <div style={{
      width: 44,
      height: 44,
      borderRadius: '10px',
      background: `${color}20`,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '22px',
    }}>{icon}</div>
    <div>
      <div style={{ fontWeight: 600, color: '#f1f5f9', fontSize: '15px' }}>{title}</div>
      <div style={{ color: '#94a3b8', fontSize: '13px' }}>{description}</div>
    </div>
  </div>
);

// Status pill component
const StatusPill = ({ text, color, icon }: { text: string; color: string; icon?: string }) => (
  <span style={{
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    padding: '6px 14px',
    background: `${color}20`,
    border: `1px solid ${color}60`,
    borderRadius: '24px',
    fontSize: '13px',
    fontWeight: 600,
    color: color,
  }}>
    {icon && <span style={{ fontSize: '14px' }}>{icon}</span>}
    {text}
  </span>
);

// =============================================================================
// 2D TOOL ICONS - Matching actual UI
// =============================================================================

const Tool2DIcon = ({ children, size = 20 }: { children: React.ReactNode; size?: number }) => (
  <span style={{ width: size, height: size, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
    {children}
  </span>
);

// Select tool - cursor icon
const SelectToolIcon = () => (
  <Tool2DIcon>
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
    </svg>
  </Tool2DIcon>
);

// Rectangle/Box tool
const BoxToolIcon = () => (
  <Tool2DIcon>
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <rect x="4" y="4" width="16" height="16" rx="2" strokeWidth={2} />
    </svg>
  </Tool2DIcon>
);

// Rotated Box tool - Hidden for now
// const RotatedBoxToolIcon = () => (
//   <Tool2DIcon>
//     <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
//       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4l16 16M4 20L20 4M12 2v4m0 12v4M2 12h4m12 0h4" />
//     </svg>
//   </Tool2DIcon>
// );

// Ellipse tool
const EllipseToolIcon = () => (
  <Tool2DIcon>
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <ellipse cx="12" cy="12" rx="9" ry="6" strokeWidth={2} />
    </svg>
  </Tool2DIcon>
);

// Polygon tool
const PolygonToolIcon = () => (
  <Tool2DIcon>
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 2l8 6-3 10H7L4 8l8-6z" />
    </svg>
  </Tool2DIcon>
);

// Polyline tool
const PolylineToolIcon = () => (
  <Tool2DIcon>
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 17l6-6 4 4 8-8" />
    </svg>
  </Tool2DIcon>
);

// Points/Keypoints tool
const PointsToolIcon = () => (
  <Tool2DIcon>
    <svg width="20" height="20" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <circle cx="6" cy="6" r="2" fill="currentColor" />
      <circle cx="18" cy="6" r="2" fill="currentColor" />
      <circle cx="12" cy="12" r="2" fill="currentColor" />
      <circle cx="6" cy="18" r="2" fill="currentColor" />
      <circle cx="18" cy="18" r="2" fill="currentColor" />
    </svg>
  </Tool2DIcon>
);

// AI Segment tool - sparkle effect
const AISegmentToolIcon = () => (
  <Tool2DIcon>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 2L13.5 7.5L19 9L13.5 10.5L12 16L10.5 10.5L5 9L10.5 7.5L12 2Z" fill="url(#segGrad)" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"/>
      <circle cx="7" cy="17" r="1.5" fill="currentColor" opacity="0.6"/>
      <circle cx="17" cy="17" r="1" fill="currentColor" opacity="0.5"/>
      <circle cx="19" cy="6" r="1" fill="currentColor" opacity="0.5"/>
      <defs>
        <linearGradient id="segGrad" x1="12" y1="2" x2="12" y2="16" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#3b82f6"/>
          <stop offset="100%" stopColor="#8b5cf6"/>
        </linearGradient>
      </defs>
    </svg>
  </Tool2DIcon>
);

// AI Polygon tool - smart polygon with nodes
const AIPolygonToolIcon = () => (
  <Tool2DIcon>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <path d="M12 3L19 7L17 15H7L5 7L12 3Z" stroke="url(#polyGrad)" strokeWidth="2" strokeLinejoin="round" fill="none"/>
      <circle cx="12" cy="3" r="2" fill="#9333ea" stroke="white" strokeWidth="1"/>
      <circle cx="19" cy="7" r="1.5" fill="#9333ea" stroke="white" strokeWidth="0.5"/>
      <circle cx="17" cy="15" r="1.5" fill="#9333ea" stroke="white" strokeWidth="0.5"/>
      <circle cx="7" cy="15" r="1.5" fill="#9333ea" stroke="white" strokeWidth="0.5"/>
      <circle cx="5" cy="7" r="1.5" fill="#9333ea" stroke="white" strokeWidth="0.5"/>
      <defs>
        <linearGradient id="polyGrad" x1="12" y1="3" x2="12" y2="15" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9333ea"/>
          <stop offset="100%" stopColor="#c084fc"/>
        </linearGradient>
      </defs>
    </svg>
  </Tool2DIcon>
);

// AI Track tool - crosshair with motion
const AITrackToolIcon = () => (
  <Tool2DIcon>
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
      <rect x="4" y="6" width="16" height="12" rx="1" stroke="url(#trackGrad)" strokeWidth="2" fill="none"/>
      <circle cx="12" cy="12" r="3" stroke="#10b981" strokeWidth="1.5" fill="none"/>
      <path d="M12 8V10M12 14V16M8 12H10M14 12H16" stroke="#10b981" strokeWidth="1.5" strokeLinecap="round"/>
      <path d="M20 9L22 12L20 15" stroke="#34d399" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.8"/>
      <circle cx="18" cy="5" r="1" fill="#fbbf24"/>
      <defs>
        <linearGradient id="trackGrad" x1="4" y1="6" x2="20" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#10b981"/>
          <stop offset="100%" stopColor="#059669"/>
        </linearGradient>
      </defs>
    </svg>
  </Tool2DIcon>
);

// =============================================================================
// SHARED STYLES
// =============================================================================

const tooltipStyles = {
  options: {
    zIndex: 10000,
    primaryColor: '#06b6d4',
  },
  tooltip: {
    backgroundColor: '#0f172a',
    borderRadius: '20px',
    padding: '32px',
    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(6, 182, 212, 0.15)',
    border: '1px solid rgba(6, 182, 212, 0.25)',
    maxWidth: '580px',
    minWidth: '480px',
  },
  tooltipContainer: {
    textAlign: 'left' as const,
  },
  tooltipTitle: {
    fontSize: '22px',
    fontWeight: 600,
    marginBottom: '14px',
    color: '#f1f5f9',
  },
  tooltipContent: {
    fontSize: '15px',
    lineHeight: '1.7',
    color: '#cbd5e1',
  },
  buttonNext: {
    background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
    borderRadius: '10px',
    padding: '12px 28px',
    fontSize: '15px',
    fontWeight: 600,
    boxShadow: '0 4px 12px rgba(6, 182, 212, 0.3)',
  },
  buttonBack: {
    color: '#94a3b8',
    marginRight: '10px',
    fontSize: '14px',
  },
  buttonSkip: {
    color: '#64748b',
    fontSize: '14px',
  },
};

// =============================================================================
// WELCOME TOUR - Platform Overview (Visual Edition)
// =============================================================================

export const welcomeTour: TourDefinition = {
  id: 'welcome',
  name: `Welcome to ${BRAND.name}`,
  description: 'Get started with the annotation platform',
  validPaths: ['/', '/my-tasks', '/my-dashboard'],
  autoStart: true,
  steps: [
    {
      target: 'body',
      content: (
        <div style={{ textAlign: 'center' }}>
          {/* Animated Logo/Welcome Visual */}
          <div style={{
            width: '100%',
            height: '140px',
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%)',
            borderRadius: '16px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Animated orbit rings */}
            <div style={{
              position: 'absolute',
              width: '200px',
              height: '200px',
              border: '1px solid rgba(6, 182, 212, 0.2)',
              borderRadius: '50%',
              animation: 'spin 20s linear infinite',
            }} />
            <div style={{
              position: 'absolute',
              width: '160px',
              height: '160px',
              border: '1px solid rgba(139, 92, 246, 0.3)',
              borderRadius: '50%',
              animation: 'spin 15s linear infinite reverse',
            }} />
            {/* Center icons */}
            <div style={{ display: 'flex', gap: '12px', zIndex: 1 }}>
              <span style={{ fontSize: '40px' }}>🚗</span>
              <span style={{ fontSize: '52px' }}>🎯</span>
              <span style={{ fontSize: '40px' }}>📊</span>
            </div>
          </div>

          <h3 style={{
            background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: '28px',
            marginBottom: '14px',
            fontWeight: 700,
          }}>
            Welcome to {BRAND.name}!
          </h3>
          <p style={{ color: '#cbd5e1', fontSize: '15px', lineHeight: 1.6, marginBottom: '8px' }}>
            {BRAND.name} is a powerful annotation platform designed for autonomous driving data.
          </p>
          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5 }}>
            Create precise 3D bounding boxes, track objects across frames, and leverage AI assistance to speed up your workflow.
          </p>

          {/* Feature pills */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center', marginTop: '20px' }}>
            <StatusPill text="3D LiDAR Fusion" color="#06b6d4" icon="📡" />
            <StatusPill text="AI-Assisted" color="#8b5cf6" icon="✨" />
            <StatusPill text="Multi-Camera" color="#22c55e" icon="📹" />
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      disableBeacon: true,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
            <IconCircle emoji="🧭" color="#06b6d4" size={48} />
            <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '20px' }}>Navigation Hub</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            Use the sidebar to navigate between different sections of the platform. Each section serves a specific purpose in your annotation workflow.
          </p>

          {/* Visual nav items */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <VisualCard icon="📊" title="Dashboard" description="Track your stats, goals, achievements & leaderboard position" color="#3b82f6" />
            <VisualCard icon="📋" title="My Tasks" description="Access your assigned annotation tasks" color="#22c55e" />
            <VisualCard icon="📁" title="Campaigns" description="Browse projects and datasets" color="#f59e0b" />
            <VisualCard icon="🏷️" title="Taxonomies" description="Manage label classes and attributes" color="#8b5cf6" />
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
            <IconCircle emoji="👤" color="#8b5cf6" size={48} />
            <h3 style={{ color: '#8b5cf6', margin: 0, fontSize: '20px' }}>Your Profile</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            Click your profile icon to access account settings, view your role permissions, or sign out of the platform.
          </p>

          <div style={{
            background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
            borderRadius: '14px',
            padding: '20px',
            border: '1px solid rgba(139, 92, 246, 0.2)',
          }}>
            {/* Example user info */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px', padding: '12px', background: '#0f172a', borderRadius: '10px' }}>
              <div style={{
                width: '44px',
                height: '44px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
              }}>👤</div>
              <div>
                <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '14px' }}>John Doe</div>
                <div style={{ color: '#64748b', fontSize: '12px', fontFamily: 'monospace' }}>john@example.com</div>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>⚙️</span>
                <span style={{ color: '#e2e8f0', fontSize: '14px' }}>Profile Settings</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>🔑</span>
                <span style={{ color: '#e2e8f0', fontSize: '14px' }}>Role: <span style={{ color: '#8b5cf6', fontWeight: 600 }}>Annotator</span></span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>🚪</span>
                <span style={{ color: '#e2e8f0', fontSize: '14px' }}>Sign Out</span>
              </div>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },

  ],
};

// =============================================================================
// DATA MANAGEMENT TOUR - Visual Hierarchy Guide
// =============================================================================

export const dataManagementTour: TourDefinition = {
  id: 'data_management',
  name: 'Data Management',
  description: 'Understand how data is organized',
  validPaths: ['/', '/campaigns', '/datasets'],
  requiredRole: null,
  autoStart: false,
  steps: [
    {
      target: 'body',
      content: (
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '20px' }}>
            <IconCircle emoji="🗂️" color="#06b6d4" size={50} />
          </div>
          <h3 style={{
            background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: '22px',
            marginBottom: '12px',
          }}>
            Data Organization
          </h3>
          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '20px' }}>
            Data in {BRAND.name} is organized in a hierarchy. Campaigns contain Datasets, which contain Scenes, which are split into Tasks for annotation.
          </p>

          {/* Visual Hierarchy Diagram */}
          <div style={{
            background: 'linear-gradient(180deg, #0f172a 0%, #1e293b 100%)',
            borderRadius: '16px',
            padding: '24px',
            border: '1px solid rgba(6, 182, 212, 0.2)',
          }}>
            {/* Campaign */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(251, 191, 36, 0.1)', borderRadius: '10px', border: '1px solid rgba(251, 191, 36, 0.3)' }}>
              <span style={{ fontSize: '26px' }}>📁</span>
              <div>
                <span style={{ color: '#fbbf24', fontWeight: 600, fontSize: '15px' }}>Campaign</span>
                <div style={{ color: '#94a3b8', fontSize: '12px', fontFamily: 'monospace' }}>"Highway_Q1_2026"</div>
              </div>
            </div>
            <div style={{ borderLeft: '2px dashed #334155', height: '20px', marginLeft: '26px' }} />

            {/* Dataset */}
            <div style={{ marginLeft: '24px', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(52, 211, 153, 0.1)', borderRadius: '10px', border: '1px solid rgba(52, 211, 153, 0.3)' }}>
              <span style={{ fontSize: '26px' }}>📂</span>
              <div>
                <span style={{ color: '#34d399', fontWeight: 600, fontSize: '15px' }}>Dataset</span>
                <div style={{ color: '#94a3b8', fontSize: '12px', fontFamily: 'monospace' }}>"SF_Downtown_Batch1"</div>
              </div>
            </div>
            <div style={{ borderLeft: '2px dashed #334155', height: '20px', marginLeft: '50px' }} />

            {/* Scene */}
            <div style={{ marginLeft: '48px', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(96, 165, 250, 0.1)', borderRadius: '10px', border: '1px solid rgba(96, 165, 250, 0.3)' }}>
              <span style={{ fontSize: '26px' }}>🎬</span>
              <div>
                <span style={{ color: '#60a5fa', fontWeight: 600, fontSize: '15px' }}>Scene</span>
                <div style={{ color: '#94a3b8', fontSize: '12px', fontFamily: 'monospace' }}>"scene_0042_market_st"</div>
              </div>
            </div>
            <div style={{ borderLeft: '2px dashed #334155', height: '20px', marginLeft: '74px' }} />

            {/* Task */}
            <div style={{ marginLeft: '72px', display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(244, 114, 182, 0.1)', borderRadius: '10px', border: '1px solid rgba(244, 114, 182, 0.3)' }}>
              <span style={{ fontSize: '26px' }}>📋</span>
              <div>
                <span style={{ color: '#f472b6', fontWeight: 600, fontSize: '15px' }}>Task</span>
                <div style={{ color: '#94a3b8', fontSize: '12px', fontFamily: 'monospace' }}>"Frames 0-50"</div>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      disableBeacon: true,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '20px',
            padding: '20px',
            background: 'linear-gradient(135deg, rgba(251, 191, 36, 0.2) 0%, rgba(251, 191, 36, 0.05) 100%)',
            borderRadius: '14px',
            border: '2px solid #fbbf24',
          }}>
            <span style={{ fontSize: '52px' }}>📁</span>
            <div>
              <h3 style={{ color: '#fbbf24', margin: 0, fontSize: '22px' }}>Campaigns</h3>
              <p style={{ color: '#94a3b8', margin: '6px 0 0', fontSize: '14px' }}>Top-level project containers</p>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '14px' }}>
            <div style={{
              flex: '1 1 45%',
              padding: '14px',
              background: '#0f172a',
              borderRadius: '10px',
              textAlign: 'center',
            }}>
              <span style={{ fontSize: '28px' }}>🛣️</span>
              <div style={{ color: '#e2e8f0', fontSize: '13px', marginTop: '6px', fontWeight: 600 }}>Highway Q1</div>
              <div style={{ color: '#64748b', fontSize: '11px', fontFamily: 'monospace' }}>12 datasets</div>
            </div>
            <div style={{
              flex: '1 1 45%',
              padding: '14px',
              background: '#0f172a',
              borderRadius: '10px',
              textAlign: 'center',
            }}>
              <span style={{ fontSize: '28px' }}>🏙️</span>
              <div style={{ color: '#e2e8f0', fontSize: '13px', marginTop: '6px', fontWeight: 600 }}>Urban Data</div>
              <div style={{ color: '#64748b', fontSize: '11px', fontFamily: 'monospace' }}>8 datasets</div>
            </div>
            <div style={{
              flex: '1 1 45%',
              padding: '14px',
              background: '#0f172a',
              borderRadius: '10px',
              textAlign: 'center',
            }}>
              <span style={{ fontSize: '28px' }}>🅿️</span>
              <div style={{ color: '#e2e8f0', fontSize: '13px', marginTop: '6px', fontWeight: 600 }}>Parking Lots</div>
              <div style={{ color: '#64748b', fontSize: '11px', fontFamily: 'monospace' }}>5 datasets</div>
            </div>
            <div style={{
              flex: '1 1 45%',
              padding: '14px',
              background: '#0f172a',
              borderRadius: '10px',
              textAlign: 'center',
            }}>
              <span style={{ fontSize: '28px' }}>🌙</span>
              <div style={{ color: '#e2e8f0', fontSize: '13px', marginTop: '6px', fontWeight: 600 }}>Night Drive</div>
              <div style={{ color: '#64748b', fontSize: '11px', fontFamily: 'monospace' }}>3 datasets</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px', background: 'rgba(251, 191, 36, 0.1)', borderRadius: '10px' }}>
            <span style={{ fontSize: '18px' }}>💡</span>
            <span style={{ color: '#fbbf24', fontSize: '13px' }}>Each campaign has its own team, taxonomy, & deadlines</span>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '18px',
            marginBottom: '20px',
            padding: '20px',
            background: 'linear-gradient(135deg, rgba(52, 211, 153, 0.2) 0%, rgba(52, 211, 153, 0.05) 100%)',
            borderRadius: '14px',
            border: '2px solid #34d399',
          }}>
            <span style={{ fontSize: '52px' }}>📂</span>
            <div>
              <h3 style={{ color: '#34d399', margin: 0, fontSize: '22px' }}>Datasets</h3>
              <p style={{ color: '#94a3b8', margin: '6px 0 0', fontSize: '14px' }}>Collections within campaigns</p>
            </div>
          </div>

          {/* Visual dataset contents */}
          <div style={{
            background: '#0f172a',
            borderRadius: '14px',
            padding: '20px',
            border: '1px solid rgba(52, 211, 153, 0.3)',
          }}>
            <div style={{ fontSize: '14px', color: '#94a3b8', marginBottom: '14px' }}>A dataset contains:</div>
            <div style={{ display: 'flex', gap: '14px' }}>
              <div style={{ flex: 1, textAlign: 'center', padding: '16px', background: '#1e293b', borderRadius: '10px' }}>
                <span style={{ fontSize: '32px' }}>🎬</span>
                <div style={{ color: '#e2e8f0', fontSize: '13px', marginTop: '6px', fontWeight: 600 }}>Scenes</div>
                <div style={{ color: '#64748b', fontSize: '11px', fontFamily: 'monospace' }}>50 scenes</div>
              </div>
              <div style={{ flex: 1, textAlign: 'center', padding: '16px', background: '#1e293b', borderRadius: '10px' }}>
                <span style={{ fontSize: '32px' }}>🏷️</span>
                <div style={{ color: '#e2e8f0', fontSize: '13px', marginTop: '6px', fontWeight: 600 }}>Taxonomy</div>
                <div style={{ color: '#64748b', fontSize: '11px', fontFamily: 'monospace' }}>15 classes</div>
              </div>
              <div style={{ flex: 1, textAlign: 'center', padding: '16px', background: '#1e293b', borderRadius: '10px' }}>
                <span style={{ fontSize: '32px' }}>📐</span>
                <div style={{ color: '#e2e8f0', fontSize: '13px', marginTop: '6px', fontWeight: 600 }}>Calibration</div>
                <div style={{ color: '#64748b', fontSize: '11px', fontFamily: 'monospace' }}>8 sensors</div>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '18px',
            marginBottom: '20px',
            padding: '20px',
            background: 'linear-gradient(135deg, rgba(96, 165, 250, 0.2) 0%, rgba(96, 165, 250, 0.05) 100%)',
            borderRadius: '14px',
            border: '2px solid #60a5fa',
          }}>
            <span style={{ fontSize: '52px' }}>🎬</span>
            <div>
              <h3 style={{ color: '#60a5fa', margin: 0, fontSize: '22px' }}>Scenes</h3>
              <p style={{ color: '#94a3b8', margin: '6px 0 0', fontSize: '14px' }}>10-60 second sensor recordings</p>
            </div>
          </div>

          {/* Visual sensor illustration */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(96, 165, 250, 0.3)',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '8px',
              marginBottom: '16px',
            }}>
              {/* Car with sensors visualization */}
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '40px' }}>🚙</div>
                <div style={{ fontSize: '10px', color: '#64748b' }}>Ego Vehicle</div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <span style={{ fontSize: '18px' }}>📡</span>
                <span style={{ color: '#e2e8f0', fontSize: '12px' }}>LiDAR Frames</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <span style={{ fontSize: '18px' }}>📹</span>
                <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Camera Images</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <span style={{ fontSize: '18px' }}>📍</span>
                <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Ego Poses</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <span style={{ fontSize: '18px' }}>⏱️</span>
                <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Timestamps</span>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '16px',
            padding: '16px',
            background: 'linear-gradient(135deg, rgba(244, 114, 182, 0.2) 0%, rgba(244, 114, 182, 0.05) 100%)',
            borderRadius: '12px',
            border: '2px solid #f472b6',
          }}>
            <span style={{ fontSize: '48px' }}>📋</span>
            <div>
              <h3 style={{ color: '#f472b6', margin: 0, fontSize: '20px' }}>Tasks</h3>
              <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: '13px' }}>Assigned work units</p>
            </div>
          </div>

          {/* Task properties visual */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(244, 114, 182, 0.3)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px' }}>🎞️</span>
                  <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Frame Range</span>
                </div>
                <span style={{ color: '#64748b', fontSize: '12px', fontFamily: 'monospace' }}>1 → 50</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px' }}>👤</span>
                  <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Assignee</span>
                </div>
                <span style={{ color: '#64748b', fontSize: '12px' }}>You!</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px' }}>🚦</span>
                  <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Status</span>
                </div>
                <StatusPill text="In Progress" color="#eab308" />
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '16px' }}>📊</span>
                  <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Stage</span>
                </div>
                <StatusPill text="Annotation" color="#3b82f6" />
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
  ],
};

// =============================================================================
// MY TASKS TOUR - Visual Task Guide
// =============================================================================

export const myTasksTour: TourDefinition = {
  id: 'my_tasks',
  name: 'My Tasks Overview',
  description: 'Learn how to work with your assigned tasks',
  validPaths: ['/my-tasks'],
  autoStart: true,
  steps: [
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="📋" color="#06b6d4" size={44} />
            <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '20px' }}>Your Task Queue</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            This is where all your assigned work appears. Tasks are sorted by priority and deadline so you always know what to work on next.
          </p>

          {/* Visual task card preview */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(6, 182, 212, 0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 8px #22c55e',
              }} />
              <span style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '13px' }}>Task Card</span>
              <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#64748b' }}>Priority sorted</span>
            </div>
            <div style={{
              display: 'flex',
              gap: '8px',
              marginTop: '12px',
            }}>
              <StatusPill text="Scene-0916" color="#60a5fa" icon="🎬" />
              <StatusPill text="50 frames" color="#8b5cf6" icon="🎞️" />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', padding: '8px', background: 'rgba(6, 182, 212, 0.1)', borderRadius: '6px' }}>
            <span style={{ fontSize: '14px' }}>👆</span>
            <span style={{ color: '#06b6d4', fontSize: '12px' }}>Click any card to start annotating</span>
          </div>
        </div>
      ),
      styles: tooltipStyles,
      disableBeacon: true,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🚦" color="#22c55e" size={40} />
            <h3 style={{ color: '#22c55e', margin: 0, fontSize: '18px' }}>Task Status</h3>
          </div>

          {/* Visual status legend */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(34, 197, 94, 0.3)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#3b82f6', boxShadow: '0 0 8px rgba(59, 130, 246, 0.5)' }} />
                <span style={{ color: '#3b82f6', fontWeight: 600, fontSize: '13px' }}>Assigned</span>
                <span style={{ color: '#64748b', fontSize: '11px', marginLeft: 'auto' }}>Ready to start</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#eab308', boxShadow: '0 0 8px rgba(234, 179, 8, 0.5)' }} />
                <span style={{ color: '#eab308', fontWeight: 600, fontSize: '13px' }}>In Progress</span>
                <span style={{ color: '#64748b', fontSize: '11px', marginLeft: 'auto' }}>Working on it</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 8px rgba(168, 85, 247, 0.5)' }} />
                <span style={{ color: '#a855f7', fontWeight: 600, fontSize: '13px' }}>Submitted</span>
                <span style={{ color: '#64748b', fontSize: '11px', marginLeft: 'auto' }}>Awaiting review</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 8px rgba(239, 68, 68, 0.5)' }} />
                <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '13px' }}>Rejected</span>
                <span style={{ color: '#64748b', fontSize: '11px', marginLeft: 'auto' }}>Needs fixes</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 8px rgba(34, 197, 94, 0.5)' }} />
                <span style={{ color: '#22c55e', fontWeight: 600, fontSize: '13px' }}>Accepted</span>
                <span style={{ color: '#64748b', fontSize: '11px', marginLeft: 'auto' }}>Complete! 🎉</span>
              </div>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📊" color="#8b5cf6" size={40} />
            <h3 style={{ color: '#8b5cf6', margin: 0, fontSize: '18px' }}>Stage Pipeline</h3>
          </div>

          {/* Visual pipeline flow */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(139, 92, 246, 0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', flexWrap: 'wrap' }}>
              <div style={{
                padding: '8px 12px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.3)',
              }}>📝 Annotation</div>

              <div style={{ fontSize: '16px' }}>→</div>

              <div style={{
                padding: '8px 12px',
                background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(168, 85, 247, 0.3)',
              }}>🔍 QA Review</div>

              <div style={{ fontSize: '16px' }}>→</div>

              <div style={{
                padding: '8px 12px',
                background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(249, 115, 22, 0.3)',
              }}>👁️ Customer</div>

              <div style={{ fontSize: '16px' }}>→</div>

              <div style={{
                padding: '8px 12px',
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                borderRadius: '8px',
                color: '#fff',
                fontSize: '11px',
                fontWeight: 600,
                boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
              }}>✅ Complete</div>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🚀" color="#06b6d4" size={40} />
            <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '18px' }}>Launch Editor</h3>
          </div>

          {/* Visual click instruction */}
          <div style={{
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            borderRadius: '12px',
            padding: '20px',
            border: '1px solid rgba(6, 182, 212, 0.3)',
            textAlign: 'center',
          }}>
            <div style={{
              width: '60px',
              height: '60px',
              margin: '0 auto 12px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              boxShadow: '0 8px 24px rgba(6, 182, 212, 0.3)',
            }}>👆</div>
            <div style={{ color: '#e2e8f0', fontSize: '14px', fontWeight: 600, marginBottom: '4px' }}>Click to Open</div>
            <div style={{ color: '#64748b', fontSize: '12px' }}>Loads 3D/2D annotation view</div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
  ],
};

// =============================================================================
// 3D EDITOR TOUR - Visual LiDAR & Fusion Guide
// =============================================================================

export const editor3DTour: TourDefinition = {
  id: 'editor_3d',
  name: '3D Annotation Editor',
  description: 'Learn to annotate in 3D LiDAR view',
  validPaths: ['/editor/', '/tasks/'],
  autoStart: false,  // Controlled by FusionEditorV2 based on actual available modes
  steps: [
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="📡" color="#06b6d4" size={44} />
            <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '20px' }}>3D LiDAR View</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            This is your main 3D workspace showing the LiDAR point cloud. Each colored dot represents a laser return from objects in the scene.
          </p>

          {/* Visual point cloud illustration */}
          <div style={{
            background: 'linear-gradient(180deg, #0a0f1a 0%, #0f172a 100%)',
            borderRadius: '12px',
            padding: '16px',
            marginBottom: '16px',
            border: '1px solid rgba(6, 182, 212, 0.2)',
            position: 'relative',
            overflow: 'hidden',
          }}>
            {/* Simulated point cloud dots */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(8, 1fr)',
              gap: '4px',
              opacity: 0.8,
            }}>
              {Array(24).fill(0).map((_, i) => (
                <div key={i} style={{
                  width: '6px',
                  height: '6px',
                  borderRadius: '50%',
                  background: `hsl(${180 + i * 5}, 80%, ${50 + Math.random() * 20}%)`,
                  filter: 'blur(0.5px)',
                }} />
              ))}
            </div>
            <div style={{ fontSize: '24px', textAlign: 'center', marginTop: '8px' }}>🚙</div>
          </div>

          {/* Navigation controls with visual keys */}
          <div style={{ fontSize: '14px', color: '#e2e8f0', fontWeight: 600, marginBottom: '8px' }}>Navigation Controls:</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
              <span style={{ fontSize: '18px' }}>🖱️</span>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>Scroll Wheel</div>
                <div style={{ color: '#64748b', fontSize: '11px' }}>Zoom in/out</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
              <span style={{ fontSize: '18px' }}>🔄</span>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: 600 }}>Left Drag</div>
                <div style={{ color: '#64748b', fontSize: '10px' }}>Rotate view</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
              <span style={{ fontSize: '16px' }}>✋</span>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: 600 }}>Right Drag</div>
                <div style={{ color: '#64748b', fontSize: '10px' }}>Pan view</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
              <span style={{ fontSize: '16px' }}>🎯</span>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: 600 }}>Double-click</div>
                <div style={{ color: '#64748b', fontSize: '10px' }}>Reset view</div>
              </div>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
      disableBeacon: true,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="🛠️" color="#8b5cf6" size={44} />
            <h3 style={{ color: '#8b5cf6', margin: 0, fontSize: '20px' }}>Annotation Tools</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            Select a tool from the toolbar to start annotating. Use keyboard shortcuts for faster workflow. Each tool is designed for a specific annotation task.
          </p>

          {/* Visual tool cards with keyboard shortcuts */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px',
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              borderRadius: '10px',
              border: '1px solid rgba(59, 130, 246, 0.3)',
            }}>
              <KeyBadge glow>V</KeyBadge>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '14px' }}>Select Tool</div>
                <div style={{ color: '#94a3b8', fontSize: '12px' }}>Click any annotation to select and edit it</div>
              </div>
              <span style={{ fontSize: '22px' }}>👆</span>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px',
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              borderRadius: '10px',
              border: '1px solid rgba(6, 182, 212, 0.3)',
            }}>
              <KeyBadge glow>C</KeyBadge>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '14px' }}>Cuboid Tool</div>
                <div style={{ color: '#94a3b8', fontSize: '12px' }}>Draw 3D bounding boxes around objects</div>
              </div>
              <span style={{ fontSize: '22px' }}>📦</span>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              padding: '14px',
              background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
              borderRadius: '10px',
              border: '1px solid rgba(139, 92, 246, 0.3)',
            }}>
              <KeyBadge glow>T</KeyBadge>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '14px' }}>Track Tool</div>
                <div style={{ color: '#94a3b8', fontSize: '12px' }}>Link objects across multiple frames</div>
              </div>
              <span style={{ fontSize: '22px' }}>🎯</span>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="📦" color="#22c55e" size={44} />
            <h3 style={{ color: '#22c55e', margin: 0, fontSize: '20px' }}>Creating a 3D Cuboid</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            Follow these steps to create a 3D bounding box around an object. The cuboid will automatically snap to the point cloud for precise placement.
          </p>

          {/* Visual step-by-step guide */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '18px',
            border: '1px solid rgba(34, 197, 94, 0.3)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 700,
                }}>1</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ color: '#e2e8f0', fontSize: '14px' }}>Press</span>
                  <KeyBadge>C</KeyBadge>
                  <span style={{ color: '#e2e8f0', fontSize: '14px' }}>to activate Cuboid tool</span>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '13px',
                  fontWeight: 700,
                }}>2</div>
                <span style={{ color: '#e2e8f0', fontSize: '14px' }}>🏷️ Select a class label (e.g., "Car")</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '30px',
                  height: '30px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 700,
                }}>3</div>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>✏️ Click + Drag to draw base</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 700,
                }}>4</div>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>📏 Drag top face for height</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '28px',
                  height: '28px',
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontSize: '12px',
                  fontWeight: 700,
                }}>5</div>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>🎛️ Fine-tune in ortho views</span>
              </div>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📐" color="#f59e0b" size={40} />
            <h3 style={{ color: '#f59e0b', margin: 0, fontSize: '18px' }}>Orthographic Views</h3>
          </div>

          {/* Visual ortho view diagram */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(245, 158, 11, 0.3)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px', marginBottom: '12px' }}>
              <div style={{
                aspectRatio: '1',
                background: '#1e293b',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #334155',
              }}>
                <span style={{ fontSize: '24px' }}>⬆️</span>
                <span style={{ color: '#f59e0b', fontSize: '10px', fontWeight: 600 }}>TOP</span>
              </div>
              <div style={{
                aspectRatio: '1',
                background: '#1e293b',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #334155',
              }}>
                <span style={{ fontSize: '24px' }}>➡️</span>
                <span style={{ color: '#f59e0b', fontSize: '10px', fontWeight: 600 }}>SIDE</span>
              </div>
              <div style={{
                aspectRatio: '1',
                background: '#1e293b',
                borderRadius: '8px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #334155',
              }}>
                <span style={{ fontSize: '24px' }}>👁️</span>
                <span style={{ color: '#f59e0b', fontSize: '10px', fontWeight: 600 }}>FRONT</span>
              </div>
            </div>

            <div style={{ color: '#94a3b8', fontSize: '12px', textAlign: 'center' }}>
              Precisely adjust <strong style={{ color: '#f59e0b' }}>position</strong>, <strong style={{ color: '#22c55e' }}>size</strong>, and <strong style={{ color: '#8b5cf6' }}>rotation</strong>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📹" color="#ec4899" size={40} />
            <h3 style={{ color: '#ec4899', margin: 0, fontSize: '18px' }}>Camera Projections</h3>
          </div>

          {/* Visual camera projection diagram */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(236, 72, 153, 0.3)',
          }}>
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '12px',
            }}>
              <div style={{
                width: '60px',
                height: '40px',
                background: '#1e293b',
                borderRadius: '6px',
                border: '2px solid #ec4899',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <span style={{ fontSize: '20px' }}>📦</span>
              </div>
              <div style={{ fontSize: '20px' }}>➔</div>
              <div style={{
                width: '60px',
                height: '40px',
                background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 100%)',
                borderRadius: '6px',
                border: '2px solid #22c55e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <span style={{ fontSize: '20px' }}>🖼️</span>
              </div>
            </div>

            <div style={{ color: '#e2e8f0', fontSize: '13px', textAlign: 'center', marginBottom: '8px' }}>
              3D boxes auto-project to all cameras
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '8px',
              background: 'rgba(236, 72, 153, 0.1)',
              borderRadius: '6px',
              justifyContent: 'center',
            }}>
              <span style={{ fontSize: '14px' }}>💡</span>
              <span style={{ color: '#ec4899', fontSize: '11px' }}>Mismatch? Adjust in LiDAR view</span>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🎯" color="#8b5cf6" size={40} />
            <h3 style={{ color: '#8b5cf6', margin: 0, fontSize: '18px' }}>4D Tracking</h3>
          </div>

          {/* Visual tracking timeline */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(139, 92, 246, 0.3)',
          }}>
            {/* Animated timeline visualization */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '4px', marginBottom: '16px' }}>
              {[1,2,3,4,5,6,7].map((i) => (
                <div key={i} style={{
                  width: '32px',
                  height: '24px',
                  background: i === 1 || i === 4 || i === 7
                    ? 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)'
                    : '#1e293b',
                  borderRadius: '4px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '10px',
                  color: i === 1 || i === 4 || i === 7 ? '#fff' : '#64748b',
                  fontWeight: i === 1 || i === 4 || i === 7 ? 700 : 400,
                  border: i === 1 || i === 4 || i === 7
                    ? '2px solid #a78bfa'
                    : '1px solid #334155',
                }}>
                  {i === 1 || i === 4 || i === 7 ? '🔑' : i}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
              <div style={{
                width: '16px',
                height: '16px',
                background: 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)',
                borderRadius: '4px',
              }} />
              <span style={{ color: '#a78bfa', fontSize: '12px', fontWeight: 600 }}>= Keyframe</span>
              <span style={{ color: '#64748b', fontSize: '11px' }}>(you edit)</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '16px',
                height: '16px',
                background: '#1e293b',
                borderRadius: '4px',
                border: '1px solid #334155',
              }} />
              <span style={{ color: '#94a3b8', fontSize: '12px' }}>= Interpolated</span>
              <span style={{ color: '#64748b', fontSize: '11px' }}>(auto-generated)</span>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🔄" color="#06b6d4" size={40} />
            <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '18px' }}>Propagation</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(6, 182, 212, 0.3)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>⏩</span>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>Forward Propagation</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>Copy to next N frames</div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>🚗</span>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>Ego Motion Comp</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>Accounts for vehicle movement</div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '20px' }}>〰️</span>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>Spline Interpolation</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>Smooth motion between keyframes</div>
                </div>
              </div>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '10px',
              background: 'rgba(6, 182, 212, 0.1)',
              borderRadius: '6px',
              marginTop: '12px',
            }}>
              <span style={{ fontSize: '14px' }}>🅿️</span>
              <span style={{ color: '#06b6d4', fontSize: '11px' }}>Mark parked cars as "static" for better results</span>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🏷️" color="#22c55e" size={40} />
            <h3 style={{ color: '#22c55e', margin: 0, fontSize: '18px' }}>Class Labels</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(34, 197, 94, 0.3)',
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                background: '#1e293b',
                borderRadius: '6px',
                border: '2px solid #3b82f6',
              }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#3b82f6' }} />
                <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Car</span>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                background: '#1e293b',
                borderRadius: '6px',
                border: '2px solid #ef4444',
              }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#ef4444' }} />
                <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Truck</span>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                background: '#1e293b',
                borderRadius: '6px',
                border: '2px solid #22c55e',
              }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#22c55e' }} />
                <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Pedestrian</span>
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 10px',
                background: '#1e293b',
                borderRadius: '6px',
                border: '2px solid #f59e0b',
              }}>
                <div style={{ width: '12px', height: '12px', borderRadius: '3px', background: '#f59e0b' }} />
                <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Cyclist</span>
              </div>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="🎬" color="#f59e0b" size={44} />
            <h3 style={{ color: '#f59e0b', margin: 0, fontSize: '20px' }}>Timeline Controls</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            Navigate through frames using the timeline. Use keyboard shortcuts for faster navigation through your annotation sequence.
          </p>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(245, 158, 11, 0.3)',
          }}>
            {/* Visual keyboard shortcuts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <KeyBadge>←</KeyBadge>
                <KeyBadge>→</KeyBadge>
                <span style={{ color: '#94a3b8', fontSize: '11px' }}>1 frame</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <KeyBadge>⇧</KeyBadge>
                <span style={{ color: '#64748b', fontSize: '10px' }}>+</span>
                <KeyBadge>←→</KeyBadge>
                <span style={{ color: '#94a3b8', fontSize: '11px' }}>10 frames</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <KeyBadge>Space</KeyBadge>
                <span style={{ color: '#94a3b8', fontSize: '11px' }}>Play/Pause</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <KeyBadge>Home</KeyBadge>
                <KeyBadge>End</KeyBadge>
                <span style={{ color: '#94a3b8', fontSize: '11px' }}>First/Last</span>
              </div>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    // STEP: Timer Gate for Drawing Tools
    {
      target: '[data-tour="timer-control"]',
      placement: 'bottom' as Placement,
      content: (
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '16px',
            padding: '14px',
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(251, 191, 36, 0.12) 100%)',
            borderRadius: '12px',
            border: '1px solid rgba(245, 158, 11, 0.35)',
          }}>
            <IconCircle emoji="⏱️" color="#f59e0b" size={42} />
            <div>
              <h3 style={{ color: '#fbbf24', margin: 0, fontSize: '19px' }}>Start Timer to Unlock Tools</h3>
              <p style={{ color: '#94a3b8', margin: '2px 0 0 0', fontSize: '12px' }}>
                Annotation tools stay locked until your timer is running
              </p>
            </div>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '14px',
            border: '1px solid rgba(245, 158, 11, 0.28)',
            marginBottom: '12px',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>🔒</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                  3D Box and Track tools show a lock icon when timer is off
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>▶️</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                  Click the play button here to start your session timer
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>✅</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                  Once started, tools unlock immediately and you can annotate
                </span>
              </div>
            </div>
          </div>

          <div style={{
            padding: '10px 12px',
            background: 'rgba(34, 197, 94, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(34, 197, 94, 0.28)',
            textAlign: 'center',
          }}>
            <span style={{ color: '#22c55e', fontSize: '12px' }}>
              Tip: Start timer first, then pick your tool for a smooth workflow.
            </span>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
  ],
};

// =============================================================================
// 2D EDITOR TOUR - Visual Annotation Guide (Beginner-Friendly)
// =============================================================================

export const editor2DTour: TourDefinition = {
  id: 'editor_2d',
  name: '2D Annotation Tools',
  description: 'Learn to annotate images like a pro',
  validPaths: ['/editor/', '/tasks/'],
  autoStart: false,
  steps: [
    // STEP 1: Welcome & Overview
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          {/* Header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '20px',
            padding: '16px',
            background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.15) 0%, rgba(59, 130, 246, 0.15) 100%)',
            borderRadius: '16px',
            border: '1px solid rgba(6, 182, 212, 0.3)',
          }}>
            <div style={{
              width: '56px',
              height: '56px',
              borderRadius: '14px',
              background: 'linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '28px',
              boxShadow: '0 8px 24px rgba(6, 182, 212, 0.3)',
            }}>🖼️</div>
            <div>
              <h3 style={{ color: '#f1f5f9', margin: 0, fontSize: '22px', fontWeight: 700 }}>2D Image Annotation</h3>
              <p style={{ color: '#94a3b8', margin: '4px 0 0 0', fontSize: '13px' }}>Draw shapes around objects in camera images</p>
            </div>
          </div>

          {/* What you'll learn */}
          <div style={{ marginBottom: '20px' }}>
            <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '10px' }}>
              What you'll learn
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: '#1e293b', borderRadius: '8px' }}>
                <span style={{ fontSize: '18px' }}>✏️</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Draw boxes, polygons, and other shapes</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: '#1e293b', borderRadius: '8px' }}>
                <span style={{ fontSize: '18px' }}>✨</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Use AI tools that help you annotate faster</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 12px', background: '#1e293b', borderRadius: '8px' }}>
                <span style={{ fontSize: '18px' }}>⌨️</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Keyboard shortcuts for speed</span>
              </div>
            </div>
          </div>

          {/* Canvas navigation tip */}
          <div style={{
            padding: '12px 16px',
            background: 'rgba(59, 130, 246, 0.1)',
            borderRadius: '10px',
            border: '1px solid rgba(59, 130, 246, 0.2)',
          }}>
            <div style={{ color: '#3b82f6', fontSize: '12px', fontWeight: 600, marginBottom: '8px' }}>💡 Quick Navigation Tip</div>
            <div style={{ display: 'flex', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#94a3b8', fontSize: '12px' }}>🖱️ Scroll</span>
                <span style={{ color: '#64748b', fontSize: '11px' }}>= Zoom</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <KeyBadge>Space</KeyBadge>
                <span style={{ color: '#64748b', fontSize: '11px' }}>+ Drag = Pan</span>
              </div>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
      disableBeacon: true,
    },

    // STEP 2: Basic Drawing Tools (Part 1 - Most Common)
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}><BoxToolIcon /></div>
            <div>
              <h3 style={{ color: '#3b82f6', margin: 0, fontSize: '20px' }}>Basic Drawing Tools</h3>
              <p style={{ color: '#94a3b8', margin: 0, fontSize: '12px' }}>The essential shapes you'll use most often</p>
            </div>
          </div>

          {/* Rectangle - Most important */}
          <div style={{
            padding: '16px',
            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.05) 100%)',
            borderRadius: '12px',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            marginBottom: '12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <KeyBadge>R</KeyBadge>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ color: '#3b82f6' }}><BoxToolIcon /></span>
                  <span style={{ color: '#f1f5f9', fontSize: '15px', fontWeight: 600 }}>Rectangle (Bounding Box)</span>
                </div>
                <p style={{ color: '#94a3b8', fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
                  <strong style={{ color: '#e2e8f0' }}>Best for:</strong> Cars, trucks, pedestrians, traffic signs — any object you can fit in a box.
                </p>
                <div style={{ marginTop: '8px', padding: '8px', background: '#0f172a', borderRadius: '6px' }}>
                  <span style={{ color: '#64748b', fontSize: '11px' }}>👆 Click one corner → Drag to opposite corner → Release</span>
                </div>
              </div>
            </div>
          </div>

          {/* Polygon */}
          <div style={{
            padding: '16px',
            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.1) 0%, rgba(139, 92, 246, 0.05) 100%)',
            borderRadius: '12px',
            border: '1px solid rgba(139, 92, 246, 0.3)',
            marginBottom: '12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <KeyBadge>P</KeyBadge>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ color: '#8b5cf6' }}><PolygonToolIcon /></span>
                  <span style={{ color: '#f1f5f9', fontSize: '15px', fontWeight: 600 }}>Polygon</span>
                </div>
                <p style={{ color: '#94a3b8', fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
                  <strong style={{ color: '#e2e8f0' }}>Best for:</strong> Irregular shapes like road surfaces, buildings, or oddly-shaped objects.
                </p>
                <div style={{ marginTop: '8px', padding: '8px', background: '#0f172a', borderRadius: '6px' }}>
                  <span style={{ color: '#64748b', fontSize: '11px' }}>👆 Click points around shape → Press <strong style={{ color: '#8b5cf6' }}>Enter</strong> to close</span>
                </div>
              </div>
            </div>
          </div>

          {/* Polyline */}
          <div style={{
            padding: '16px',
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.1) 0%, rgba(245, 158, 11, 0.05) 100%)',
            borderRadius: '12px',
            border: '1px solid rgba(245, 158, 11, 0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
              <KeyBadge>L</KeyBadge>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                  <span style={{ color: '#f59e0b' }}><PolylineToolIcon /></span>
                  <span style={{ color: '#f1f5f9', fontSize: '15px', fontWeight: 600 }}>Polyline (Line)</span>
                </div>
                <p style={{ color: '#94a3b8', fontSize: '12px', margin: 0, lineHeight: 1.5 }}>
                  <strong style={{ color: '#e2e8f0' }}>Best for:</strong> Lane markings, road edges, curbs, and boundaries.
                </p>
                <div style={{ marginTop: '8px', padding: '8px', background: '#0f172a', borderRadius: '6px' }}>
                  <span style={{ color: '#64748b', fontSize: '11px' }}>👆 Click points along the line → Press <strong style={{ color: '#f59e0b' }}>Enter</strong> to finish</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },

    // STEP 3: More Drawing Tools
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}><EllipseToolIcon /></div>
            <div>
              <h3 style={{ color: '#ec4899', margin: 0, fontSize: '20px' }}>More Shape Tools</h3>
              <p style={{ color: '#94a3b8', margin: 0, fontSize: '12px' }}>Specialized tools for specific use cases</p>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
            {/* Ellipse */}
            <div style={{
              padding: '14px',
              background: '#0f172a',
              borderRadius: '10px',
              border: '1px solid rgba(236, 72, 153, 0.3)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <KeyBadge>E</KeyBadge>
                <span style={{ color: '#ec4899' }}><EllipseToolIcon /></span>
              </div>
              <div style={{ color: '#f1f5f9', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Ellipse</div>
              <div style={{ color: '#64748b', fontSize: '11px', lineHeight: 1.4 }}>
                Round objects like wheels, traffic lights, circular signs
              </div>
            </div>

            {/* Rotated Box - Hidden for now
            <div style={{
              padding: '14px',
              background: '#0f172a',
              borderRadius: '10px',
              border: '1px solid rgba(14, 165, 233, 0.3)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <KeyBadge>O</KeyBadge>
                <span style={{ color: '#0ea5e9' }}><RotatedBoxToolIcon /></span>
              </div>
              <div style={{ color: '#f1f5f9', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Rotated Box</div>
              <div style={{ color: '#64748b', fontSize: '11px', lineHeight: 1.4 }}>
                Tilted objects like parked cars at an angle
              </div>
            </div>
            */}

            {/* Keypoints */}
            <div style={{
              padding: '14px',
              background: '#0f172a',
              borderRadius: '10px',
              border: '1px solid rgba(168, 85, 247, 0.3)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <KeyBadge>K</KeyBadge>
                <span style={{ color: '#a855f7' }}><PointsToolIcon /></span>
              </div>
              <div style={{ color: '#f1f5f9', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Keypoints</div>
              <div style={{ color: '#64748b', fontSize: '11px', lineHeight: 1.4 }}>
                Mark specific spots like joints, corners, or landmarks
              </div>
            </div>

            {/* Selection tools */}
            <div style={{
              padding: '14px',
              background: '#0f172a',
              borderRadius: '10px',
              border: '1px solid rgba(100, 116, 139, 0.3)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <KeyBadge>V</KeyBadge>
                <span style={{ color: '#94a3b8' }}><SelectToolIcon /></span>
              </div>
              <div style={{ color: '#f1f5f9', fontSize: '13px', fontWeight: 600, marginBottom: '4px' }}>Select & Edit</div>
              <div style={{ color: '#64748b', fontSize: '11px', lineHeight: 1.4 }}>
                Click annotations to select, move, or resize them
              </div>
            </div>
          </div>

          {/* Pro tip */}
          <div style={{
            marginTop: '14px',
            padding: '12px',
            background: 'rgba(34, 197, 94, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(34, 197, 94, 0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
          }}>
            <span style={{ fontSize: '16px' }}>💡</span>
            <span style={{ color: '#22c55e', fontSize: '12px' }}>
              <strong>Pro tip:</strong> Press <strong>Delete</strong> to remove selected annotation, <strong>Esc</strong> to cancel drawing
            </span>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },

    // STEP 4: AI-Powered Tools Overview
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          {/* Header with sparkle effect */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '16px',
            marginBottom: '20px',
            padding: '16px',
            background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(6, 182, 212, 0.2) 100%)',
            borderRadius: '16px',
            border: '1px solid rgba(139, 92, 246, 0.4)',
          }}>
            <div style={{
              width: '50px',
              height: '50px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px',
            }}>✨</div>
            <div>
              <h3 style={{ color: '#f1f5f9', margin: 0, fontSize: '20px' }}>AI-Powered Tools</h3>
              <p style={{ color: '#a78bfa', margin: '2px 0 0 0', fontSize: '12px' }}>Let the computer do the hard work for you!</p>
            </div>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.6, marginBottom: '20px' }}>
            These tools use intelligent technology to help you annotate <strong style={{ color: '#e2e8f0' }}>faster and more accurately</strong>.
            You just give a hint, and the system figures out the rest.
          </p>

          {/* Three AI tools */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              padding: '16px',
              background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
              borderRadius: '12px',
              border: '1px solid rgba(6, 182, 212, 0.4)',
            }}>
              <KeyBadge glow>W</KeyBadge>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#06b6d4', fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>AI Segment</div>
                <div style={{ color: '#94a3b8', fontSize: '12px', lineHeight: 1.4 }}>
                  Just click on any object and the system will automatically outline it perfectly. Magic! ✨
                </div>
              </div>
              <span style={{ color: '#06b6d4' }}><AISegmentToolIcon /></span>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              padding: '16px',
              background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
              borderRadius: '12px',
              border: '1px solid rgba(139, 92, 246, 0.4)',
            }}>
              <KeyBadge glow>M</KeyBadge>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#8b5cf6', fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>AI Polygon</div>
                <div style={{ color: '#94a3b8', fontSize: '12px', lineHeight: 1.4 }}>
                  Place just 3-4 points around an object, and the system completes the entire shape for you.
                </div>
              </div>
              <span style={{ color: '#8b5cf6' }}><AIPolygonToolIcon /></span>
            </div>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px',
              padding: '16px',
              background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
              borderRadius: '12px',
              border: '1px solid rgba(16, 185, 129, 0.4)',
            }}>
              <KeyBadge glow>T</KeyBadge>
              <div style={{ flex: 1 }}>
                <div style={{ color: '#10b981', fontWeight: 700, fontSize: '14px', marginBottom: '4px' }}>AI Track</div>
                <div style={{ color: '#94a3b8', fontSize: '12px', lineHeight: 1.4 }}>
                  Draw a box on one frame, and it automatically follows the object through all other frames.
                </div>
              </div>
              <span style={{ color: '#10b981' }}><AITrackToolIcon /></span>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },

    // STEP 5: AI Segment in Detail
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}><AISegmentToolIcon /></div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '20px' }}>AI Segment</h3>
                <KeyBadge>W</KeyBadge>
              </div>
              <p style={{ color: '#94a3b8', margin: 0, fontSize: '12px' }}>One-click object selection</p>
            </div>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '14px',
            padding: '20px',
            border: '1px solid rgba(6, 182, 212, 0.3)',
            marginBottom: '16px',
          }}>
            <div style={{ color: '#64748b', fontSize: '11px', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '14px' }}>
              How it works
            </div>

            {/* Visual step by step */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: '13px', fontWeight: 700,
                }}>1</div>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Press <strong style={{ color: '#06b6d4' }}>W</strong> to activate AI Segment tool</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: '13px', fontWeight: 700,
                }}>2</div>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                  <span style={{ color: '#22c55e' }}>Left-click</span> on the object you want to select
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '28px', height: '28px', borderRadius: '50%',
                  background: 'linear-gradient(135deg, #06b6d4 0%, #0891b2 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: '13px', fontWeight: 700,
                }}>3</div>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Watch as the outline appears automatically! ✨</span>
              </div>
            </div>
          </div>

          {/* Click types explained */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '10px',
            marginBottom: '14px',
          }}>
            <div style={{
              padding: '12px',
              background: 'rgba(34, 197, 94, 0.1)',
              borderRadius: '10px',
              border: '2px solid rgba(34, 197, 94, 0.3)',
              textAlign: 'center',
            }}>
              <span style={{ fontSize: '24px', display: 'block', marginBottom: '6px' }}>👆</span>
              <div style={{ color: '#22c55e', fontSize: '12px', fontWeight: 600 }}>Left Click</div>
              <div style={{ color: '#94a3b8', fontSize: '11px' }}>Include this area</div>
            </div>
            <div style={{
              padding: '12px',
              background: 'rgba(239, 68, 68, 0.1)',
              borderRadius: '10px',
              border: '2px solid rgba(239, 68, 68, 0.3)',
              textAlign: 'center',
            }}>
              <span style={{ fontSize: '24px', display: 'block', marginBottom: '6px' }}>👆</span>
              <div style={{ color: '#ef4444', fontSize: '12px', fontWeight: 600 }}>Right Click</div>
              <div style={{ color: '#94a3b8', fontSize: '11px' }}>Exclude this area</div>
            </div>
          </div>

          {/* Confirm/Cancel */}
          <div style={{
            padding: '10px 14px',
            background: 'rgba(6, 182, 212, 0.1)',
            borderRadius: '8px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '12px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <KeyBadge>Enter</KeyBadge>
              <span style={{ color: '#22c55e', fontSize: '12px' }}>Confirm</span>
            </div>
            <span style={{ color: '#475569' }}>|</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <KeyBadge>Esc</KeyBadge>
              <span style={{ color: '#ef4444', fontSize: '12px' }}>Cancel</span>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },

    // STEP 6: AI Polygon
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}><AIPolygonToolIcon /></div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ color: '#a855f7', margin: 0, fontSize: '20px' }}>AI Polygon</h3>
                <KeyBadge>M</KeyBadge>
              </div>
              <p style={{ color: '#94a3b8', margin: 0, fontSize: '12px' }}>Auto-complete shapes from a few points</p>
            </div>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '13px', lineHeight: 1.6, marginBottom: '16px' }}>
            Don't want to click every single point around an object? Just place <strong style={{ color: '#a855f7' }}>3-4 key points</strong> and the system will intelligently complete the rest of the outline.
          </p>

          {/* Visual before/after */}
          <div style={{
            background: '#0f172a',
            borderRadius: '14px',
            padding: '20px',
            border: '1px solid rgba(168, 85, 247, 0.3)',
            marginBottom: '16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '16px' }}>
              {/* Before: Just points */}
              <div style={{
                width: '50px',
                height: '35px',
                position: 'relative',
                background: '#1e293b',
                borderRadius: '6px',
                border: '1px solid #334155',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <div style={{ position: 'absolute', top: '6px', left: '8px', width: '8px', height: '8px', borderRadius: '50%', background: '#a855f7' }} />
                <div style={{ position: 'absolute', top: '8px', right: '8px', width: '8px', height: '8px', borderRadius: '50%', background: '#a855f7' }} />
                <div style={{ position: 'absolute', bottom: '6px', right: '12px', width: '8px', height: '8px', borderRadius: '50%', background: '#a855f7' }} />
                <div style={{ position: 'absolute', bottom: '6px', left: '8px', width: '8px', height: '8px', borderRadius: '50%', background: '#a855f7' }} />
              </div>

              <span style={{ color: '#a855f7', fontSize: '18px', fontWeight: 700 }}>✨→</span>

              {/* After: Complete polygon */}
              <div style={{
                width: '50px',
                height: '35px',
                background: 'rgba(168, 85, 247, 0.2)',
                border: '2px solid #a855f7',
                borderRadius: '6px',
              }} />
            </div>

            <div style={{
              textAlign: 'center',
              padding: '10px',
              background: 'rgba(168, 85, 247, 0.1)',
              borderRadius: '8px',
            }}>
              <span style={{ color: '#a855f7', fontSize: '13px' }}>
                You click 4 points → <strong>Complete shape!</strong>
              </span>
            </div>
          </div>

          {/* Steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
              <div style={{
                width: '24px', height: '24px', borderRadius: '50%',
                background: '#a855f7', color: '#fff', fontSize: '12px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>1</div>
              <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Press <strong style={{ color: '#a855f7' }}>M</strong> and place 3-4 points around the object</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
              <div style={{
                width: '24px', height: '24px', borderRadius: '50%',
                background: '#a855f7', color: '#fff', fontSize: '12px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>2</div>
              <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Release and let the AI generate the complete outline</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
              <div style={{
                width: '24px', height: '24px', borderRadius: '50%',
                background: '#a855f7', color: '#fff', fontSize: '12px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>3</div>
              <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Press <strong style={{ color: '#22c55e' }}>Enter</strong> to confirm the completed polygon ✨</span>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },

    // STEP 7: AI Track
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#fff',
            }}><AITrackToolIcon /></div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <h3 style={{ color: '#10b981', margin: 0, fontSize: '20px' }}>AI Track</h3>
                <KeyBadge>T</KeyBadge>
              </div>
              <p style={{ color: '#94a3b8', margin: 0, fontSize: '12px' }}>Follow objects across all frames automatically</p>
            </div>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '13px', lineHeight: 1.6, marginBottom: '16px' }}>
            Have a video with 100+ frames? Instead of drawing the same car 100 times, draw it <strong style={{ color: '#10b981' }}>once</strong> and let the system track it through every frame.
          </p>

          {/* Visual tracking animation */}
          <div style={{
            background: '#0f172a',
            borderRadius: '14px',
            padding: '20px',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            marginBottom: '16px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '16px' }}>
              {/* First frame with box */}
              <div style={{
                width: '50px',
                height: '35px',
                border: '3px solid #10b981',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(16, 185, 129, 0.1)',
              }}>
                <span style={{ fontSize: '14px' }}>🚗</span>
              </div>

              <span style={{ color: '#10b981', fontSize: '18px', fontWeight: 700 }}>→→→</span>

              {/* Auto-tracked frames */}
              {[0.9, 0.75, 0.6, 0.45].map((opacity, i) => (
                <div key={i} style={{
                  width: '30px',
                  height: '22px',
                  border: '2px dashed #10b981',
                  borderRadius: '4px',
                  opacity: opacity,
                }} />
              ))}
            </div>

            <div style={{
              textAlign: 'center',
              padding: '10px',
              background: 'rgba(16, 185, 129, 0.1)',
              borderRadius: '8px',
            }}>
              <span style={{ color: '#10b981', fontSize: '13px' }}>
                Frame 1 → <strong>All frames</strong> (automatic!)
              </span>
            </div>
          </div>

          {/* Steps */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
              <div style={{
                width: '24px', height: '24px', borderRadius: '50%',
                background: '#10b981', color: '#fff', fontSize: '12px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>1</div>
              <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Press <strong style={{ color: '#10b981' }}>T</strong> and draw a box around an object</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
              <div style={{
                width: '24px', height: '24px', borderRadius: '50%',
                background: '#10b981', color: '#fff', fontSize: '12px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>2</div>
              <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Click <strong style={{ color: '#10b981' }}>"Run Tracking"</strong> button</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
              <div style={{
                width: '24px', height: '24px', borderRadius: '50%',
                background: '#10b981', color: '#fff', fontSize: '12px', fontWeight: 700,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>3</div>
              <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Wait a moment — done! The box follows the object ✨</span>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },

    // STEP 8: Camera Views
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{
              width: '44px',
              height: '44px',
              borderRadius: '12px',
              background: 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '22px',
            }}>📹</div>
            <div>
              <h3 style={{ color: '#ec4899', margin: 0, fontSize: '20px' }}>Multiple Camera Views</h3>
              <p style={{ color: '#94a3b8', margin: 0, fontSize: '12px' }}>Annotate from different angles</p>
            </div>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '13px', lineHeight: 1.6, marginBottom: '16px' }}>
            Vehicles often have multiple cameras. You can switch between different camera views and annotate objects as you see them from each angle.
          </p>

          {/* Camera grid */}
          <div style={{
            background: '#0f172a',
            borderRadius: '14px',
            padding: '16px',
            border: '1px solid rgba(236, 72, 153, 0.3)',
            marginBottom: '14px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
              {[
                { name: 'Front', active: true },
                { name: 'Front-L', active: false },
                { name: 'Front-R', active: false },
                { name: 'Rear', active: false },
                { name: 'Rear-L', active: false },
                { name: 'Rear-R', active: false },
              ].map((cam) => (
                <div key={cam.name} style={{
                  padding: '10px 14px',
                  background: cam.active ? 'linear-gradient(135deg, #ec4899 0%, #db2777 100%)' : '#1e293b',
                  borderRadius: '8px',
                  color: cam.active ? '#fff' : '#94a3b8',
                  fontSize: '12px',
                  fontWeight: cam.active ? 600 : 400,
                  border: cam.active ? 'none' : '1px solid #334155',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}>
                  📹 {cam.name}
                </div>
              ))}
            </div>
          </div>

          {/* Note */}
          <div style={{
            padding: '12px',
            background: 'rgba(236, 72, 153, 0.1)',
            borderRadius: '10px',
            border: '1px solid rgba(236, 72, 153, 0.2)',
          }}>
            <span style={{ color: '#94a3b8', fontSize: '12px' }}>
              💡 <strong style={{ color: '#ec4899' }}>Note:</strong> Each camera view has its own set of annotations. Click on a camera tab to switch views.
            </span>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },

    // STEP 9: Final Summary / Quick Reference
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{
            textAlign: 'center',
            marginBottom: '20px',
          }}>
            <span style={{ fontSize: '48px', display: 'inline-block', marginBottom: '12px' }}>🎉</span>
            <h3 style={{
              color: '#f1f5f9',
              margin: 0,
              fontSize: '22px',
              fontWeight: 700,
            }}>You're Ready to Annotate!</h3>
            <p style={{ color: '#94a3b8', margin: '8px 0 0 0', fontSize: '13px' }}>Here's your quick reference cheat sheet</p>
          </div>

          {/* Cheat sheet grid */}
          <div style={{
            background: '#0f172a',
            borderRadius: '14px',
            padding: '16px',
            border: '1px solid rgba(6, 182, 212, 0.2)',
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: '8px',
              marginBottom: '12px',
            }}>
              {[
                { key: 'R', name: 'Rectangle', color: '#3b82f6' },
                { key: 'P', name: 'Polygon', color: '#8b5cf6' },
                { key: 'L', name: 'Polyline', color: '#f59e0b' },
                { key: 'W', name: 'AI Segment', color: '#06b6d4' },
                { key: 'M', name: 'AI Polygon', color: '#a855f7' },
                { key: 'T', name: 'AI Track', color: '#10b981' },
              ].map((tool) => (
                <div key={tool.key} style={{
                  padding: '10px',
                  background: '#1e293b',
                  borderRadius: '8px',
                  textAlign: 'center',
                }}>
                  <KeyBadge>{tool.key}</KeyBadge>
                  <div style={{ color: tool.color, fontSize: '10px', fontWeight: 600, marginTop: '6px' }}>{tool.name}</div>
                </div>
              ))}
            </div>

            {/* Extra shortcuts */}
            <div style={{
              display: 'flex',
              justifyContent: 'center',
              gap: '16px',
              padding: '10px',
              background: '#1e293b',
              borderRadius: '8px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <KeyBadge>V</KeyBadge>
                <span style={{ color: '#94a3b8', fontSize: '11px' }}>Select</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <KeyBadge>Del</KeyBadge>
                <span style={{ color: '#94a3b8', fontSize: '11px' }}>Delete</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <KeyBadge>Esc</KeyBadge>
                <span style={{ color: '#94a3b8', fontSize: '11px' }}>Cancel</span>
              </div>
            </div>
          </div>

          {/* Final tip */}
          <div style={{
            marginTop: '14px',
            padding: '12px',
            background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(6, 182, 212, 0.15) 100%)',
            borderRadius: '10px',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            textAlign: 'center',
          }}>
            <span style={{ color: '#22c55e', fontSize: '13px' }}>
              ✨ <strong>Pro tip:</strong> Start with AI Segment (W) for most objects — it's the fastest way to annotate!
            </span>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    // STEP 10: Timer Gate for Drawing Tools
    {
      target: '[data-tour="timer-control"]',
      placement: 'bottom' as Placement,
      content: (
        <div>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '16px',
            padding: '14px',
            background: 'linear-gradient(135deg, rgba(245, 158, 11, 0.15) 0%, rgba(251, 191, 36, 0.12) 100%)',
            borderRadius: '12px',
            border: '1px solid rgba(245, 158, 11, 0.35)',
          }}>
            <IconCircle emoji="⏱️" color="#f59e0b" size={42} />
            <div>
              <h3 style={{ color: '#fbbf24', margin: 0, fontSize: '19px' }}>Start Timer to Unlock Tools</h3>
              <p style={{ color: '#94a3b8', margin: '2px 0 0 0', fontSize: '12px' }}>
                Annotation tools stay locked until your timer is running
              </p>
            </div>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '14px',
            border: '1px solid rgba(245, 158, 11, 0.28)',
            marginBottom: '12px',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>🔒</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                  AI and shape tools show a lock icon when timer is off
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>▶️</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                  Click the play button here to start your session timer
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>✅</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                  Once started, tools unlock immediately and you can annotate
                </span>
              </div>
            </div>
          </div>

          <div style={{
            padding: '10px 12px',
            background: 'rgba(34, 197, 94, 0.1)',
            borderRadius: '8px',
            border: '1px solid rgba(34, 197, 94, 0.28)',
            textAlign: 'center',
          }}>
            <span style={{ color: '#22c55e', fontSize: '12px' }}>
              Tip: Start timer first, then pick your tool for a smooth workflow.
            </span>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
  ],
};

// =============================================================================
// WORKFLOW TOUR - Visual Task Submission & QA Guide
// =============================================================================

export const workflowTour: TourDefinition = {
  id: 'workflow',
  name: 'Task Workflow',
  description: 'Learn the annotation to QA workflow',
  validPaths: ['/editor/', '/tasks/', '/my-tasks'],
  autoStart: false,
  steps: [
    {
      target: 'body',
      content: (
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🔄" color="#06b6d4" size={50} />
          </div>

          <h3 style={{
            background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: '22px',
            marginBottom: '12px',
          }}>
            Quality Assurance Workflow
          </h3>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px', textAlign: 'left' }}>
            Every annotation goes through a multi-stage review process to ensure high quality. Your work moves through these stages automatically.
          </p>

          {/* Visual workflow pipeline */}
          <div style={{
            background: '#0f172a',
            borderRadius: '16px',
            padding: '24px',
            border: '1px solid rgba(6, 182, 212, 0.2)',
          }}>
            {/* Annotation Stage */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                boxShadow: '0 4px 12px rgba(59, 130, 246, 0.4)',
              }}>📝</div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ color: '#3b82f6', fontWeight: 700, fontSize: '14px' }}>Annotation</div>
                <div style={{ color: '#64748b', fontSize: '11px' }}>You create labels</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
              <div style={{
                width: '2px',
                height: '20px',
                background: 'linear-gradient(180deg, #3b82f6 0%, #a855f7 100%)',
              }} />
            </div>

            {/* QA Review Stage */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #a855f7 0%, #9333ea 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                boxShadow: '0 4px 12px rgba(168, 85, 247, 0.4)',
              }}>🔍</div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ color: '#a855f7', fontWeight: 700, fontSize: '14px' }}>QA Review</div>
                <div style={{ color: '#64748b', fontSize: '11px' }}>Internal quality check</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
              <div style={{
                width: '2px',
                height: '20px',
                background: 'linear-gradient(180deg, #a855f7 0%, #f97316 100%)',
              }} />
            </div>

            {/* Customer QA Stage */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '8px' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                boxShadow: '0 4px 12px rgba(249, 115, 22, 0.4)',
              }}>👁️</div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ color: '#f97316', fontWeight: 700, fontSize: '14px' }}>Customer QA</div>
                <div style={{ color: '#64748b', fontSize: '11px' }}>Customer validation</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', padding: '4px 0' }}>
              <div style={{
                width: '2px',
                height: '20px',
                background: 'linear-gradient(180deg, #f97316 0%, #22c55e 100%)',
              }} />
            </div>

            {/* Complete Stage */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '24px',
                boxShadow: '0 4px 12px rgba(34, 197, 94, 0.4)',
              }}>✅</div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ color: '#22c55e', fontWeight: 700, fontSize: '14px' }}>Complete</div>
                <div style={{ color: '#64748b', fontSize: '11px' }}>Ready for export 🎉</div>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      disableBeacon: true,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🚀" color="#22c55e" size={40} />
            <h3 style={{ color: '#22c55e', margin: 0, fontSize: '18px' }}>Submit Your Work</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(34, 197, 94, 0.3)',
          }}>
            {/* Visual checklist */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  border: '2px solid #22c55e',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <span style={{ fontSize: '12px' }}>✓</span>
                </div>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Review all frames</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  border: '2px solid #22c55e',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <span style={{ fontSize: '12px' }}>✓</span>
                </div>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Verify all labels are correct</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{
                  width: '24px',
                  height: '24px',
                  borderRadius: '50%',
                  border: '2px solid #22c55e',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <span style={{ fontSize: '12px' }}>✓</span>
                </div>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Click "Submit for Review"</span>
              </div>
            </div>

            {/* Visual button */}
            <div style={{
              display: 'flex',
              justifyContent: 'center',
            }}>
              <div style={{
                padding: '10px 20px',
                background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
                borderRadius: '8px',
                color: '#fff',
                fontWeight: 600,
                fontSize: '13px',
                boxShadow: '0 4px 12px rgba(34, 197, 94, 0.4)',
              }}>
                🚀 Submit for Review
              </div>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <div style={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '20px',
            }}>⚠️</div>
            <h3 style={{ color: '#ef4444', margin: 0, fontSize: '18px' }}>Handling Rejections</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(239, 68, 68, 0.3)',
          }}>
            {/* Visual revision mode indicator */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '12px',
              background: 'rgba(239, 68, 68, 0.1)',
              borderRadius: '8px',
              marginBottom: '16px',
            }}>
              <span style={{ fontSize: '24px' }}>🔧</span>
              <span style={{
                color: '#fca5a5',
                fontWeight: 600,
                fontSize: '14px',
                textTransform: 'uppercase',
                letterSpacing: '1px',
              }}>Revision Mode</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>🎯</span>
                <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Rejected items are highlighted</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>💬</span>
                <span style={{ color: '#e2e8f0', fontSize: '12px' }}>QA feedback explains issues</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>📋</span>
                <span style={{ color: '#e2e8f0', fontSize: '12px' }}>"Fixes" tab lists all changes</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>🔄</span>
                <span style={{ color: '#e2e8f0', fontSize: '12px' }}>Fix & resubmit for review</span>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📋" color="#f59e0b" size={40} />
            <h3 style={{ color: '#f59e0b', margin: 0, fontSize: '18px' }}>QA Feedback Panel</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(245, 158, 11, 0.3)',
          }}>
            {/* Visual feedback items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px',
                background: 'rgba(239, 68, 68, 0.1)',
                borderRadius: '6px',
                borderLeft: '3px solid #ef4444',
              }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 8px #ef4444' }} />
                <span style={{ color: '#fca5a5', fontSize: '12px' }}>Rejected - needs fix</span>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px',
                background: 'rgba(251, 191, 36, 0.1)',
                borderRadius: '6px',
                borderLeft: '3px solid #fbbf24',
              }}>
                <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#fbbf24', boxShadow: '0 0 8px #fbbf24' }} />
                <span style={{ color: '#fde68a', fontSize: '12px' }}>Flagged - attention needed</span>
              </div>
            </div>

            <div style={{
              marginTop: '12px',
              padding: '8px',
              background: 'rgba(245, 158, 11, 0.1)',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <span style={{ fontSize: '14px' }}>👆</span>
              <span style={{ color: '#f59e0b', fontSize: '11px' }}>Click item to navigate to issue</span>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
  ],
};

// =============================================================================
// TAXONOMY TOUR - Visual Taxonomy Management Guide
// =============================================================================

export const taxonomyTour: TourDefinition = {
  id: 'taxonomy',
  name: 'Taxonomy Management',
  description: 'Complete guide to creating, managing, and configuring label taxonomies',
  validPaths: ['/taxonomies', '/admin', '/datasets'],
  requiredRole: 'admin,project_manager',
  autoStart: false,
  steps: [
    {
      target: 'body',
      content: (
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🏷️" color="#8b5cf6" size={50} />
          </div>

          <h3 style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: '22px',
            marginBottom: '10px',
          }}>
            Taxonomy Management
          </h3>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px', textAlign: 'left' }}>
            Taxonomies define what annotators can label. Create class definitions with colors, attributes, and default dimensions for consistent, high-quality annotations.
          </p>

          {/* Visual taxonomy preview */}
          <div style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
            padding: '2px',
            borderRadius: '12px',
          }}>
            <div style={{
              background: '#0f172a',
              borderRadius: '10px',
              padding: '16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <VisualCard icon="�" title="Use Templates" description="Quick start" color="#fbbf24" />
                <VisualCard icon="🎨" title="Define Classes" description="Object types" color="#ec4899" />
                <VisualCard icon="⚙️" title="Set Attributes" description="Properties" color="#06b6d4" />
                <VisualCard icon="📐" title="Default Dimensions" description="3D sizes" color="#22c55e" />
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      disableBeacon: true,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📚" color="#3b82f6" size={40} />
            <h3 style={{ color: '#3b82f6', margin: 0, fontSize: '18px' }}>Taxonomy Library</h3>
          </div>

          {/* Visual taxonomy types */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(59, 130, 246, 0.3)',
          }}>
            <div style={{ display: 'flex', gap: '12px', marginBottom: '16px' }}>
              <div style={{
                flex: 1,
                padding: '16px',
                background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.1) 0%, rgba(34, 197, 94, 0.05) 100%)',
                borderRadius: '10px',
                border: '2px solid rgba(34, 197, 94, 0.3)',
                textAlign: 'center',
              }}>
                <span style={{ fontSize: '32px', display: 'block', marginBottom: '8px' }}>📡🖼️</span>
                <div style={{ color: '#22c55e', fontWeight: 700, fontSize: '13px' }}>Fusion/3D</div>
                <div style={{ color: '#64748b', fontSize: '10px', marginTop: '4px' }}>LiDAR + Camera</div>
              </div>

              <div style={{
                flex: 1,
                padding: '16px',
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.05) 100%)',
                borderRadius: '10px',
                border: '2px solid rgba(59, 130, 246, 0.3)',
                textAlign: 'center',
              }}>
                <span style={{ fontSize: '32px', display: 'block', marginBottom: '8px' }}>🖼️</span>
                <div style={{ color: '#3b82f6', fontWeight: 700, fontSize: '13px' }}>2D Only</div>
                <div style={{ color: '#64748b', fontSize: '10px', marginTop: '4px' }}>Camera/Image</div>
              </div>
            </div>

            <div style={{
              padding: '10px',
              background: 'rgba(59, 130, 246, 0.1)',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}>
              <span style={{ fontSize: '14px' }}>💡</span>
              <span style={{ color: '#93c5fd', fontSize: '11px' }}>Reuse taxonomies across multiple datasets</span>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📋" color="#fbbf24" size={40} />
            <h3 style={{ color: '#fbbf24', margin: 0, fontSize: '18px' }}>Start from Templates</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(251, 191, 36, 0.3)',
          }}>
            <p style={{ color: '#e2e8f0', fontSize: '12px', marginBottom: '12px', lineHeight: 1.5 }}>
              Skip manual setup! Use pre-built templates with industry-standard classes and attributes.
            </p>

            {/* Template grid - 2 rows */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
              <div style={{
                padding: '10px',
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.15) 0%, rgba(139, 92, 246, 0.05) 100%)',
                borderRadius: '8px',
                border: '1px solid rgba(139, 92, 246, 0.3)',
              }}>
                <div style={{ fontSize: '16px', marginBottom: '4px' }}>🚗</div>
                <div style={{ color: '#a78bfa', fontWeight: 600, fontSize: '10px' }}>3D Objects</div>
                <div style={{ color: '#64748b', fontSize: '9px' }}>10 classes</div>
              </div>

              <div style={{
                padding: '10px',
                background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.05) 100%)',
                borderRadius: '8px',
                border: '1px solid rgba(59, 130, 246, 0.3)',
              }}>
                <div style={{ fontSize: '16px', marginBottom: '4px' }}>🛤️</div>
                <div style={{ color: '#93c5fd', fontWeight: 600, fontSize: '10px' }}>Lanes & Signs</div>
                <div style={{ color: '#64748b', fontSize: '9px' }}>10 classes</div>
              </div>

              <div style={{
                padding: '10px',
                background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15) 0%, rgba(34, 197, 94, 0.05) 100%)',
                borderRadius: '8px',
                border: '1px solid rgba(34, 197, 94, 0.3)',
              }}>
                <div style={{ fontSize: '16px', marginBottom: '4px' }}>📦</div>
                <div style={{ color: '#86efac', fontWeight: 600, fontSize: '10px' }}>2D Detection</div>
                <div style={{ color: '#64748b', fontSize: '9px' }}>7 classes</div>
              </div>

              <div style={{
                padding: '10px',
                background: 'linear-gradient(135deg, rgba(236, 72, 153, 0.15) 0%, rgba(236, 72, 153, 0.05) 100%)',
                borderRadius: '8px',
                border: '1px solid rgba(236, 72, 153, 0.3)',
              }}>
                <div style={{ fontSize: '16px', marginBottom: '4px' }}>🎭</div>
                <div style={{ color: '#f9a8d4', fontWeight: 600, fontSize: '10px' }}>Segmentation</div>
                <div style={{ color: '#64748b', fontSize: '9px' }}>7+ classes</div>
              </div>
            </div>

            <div style={{
              padding: '8px',
              background: 'rgba(34, 197, 94, 0.1)',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <span style={{ fontSize: '12px' }}>✨</span>
              <span style={{ color: '#86efac', fontSize: '10px' }}>All templates include occlusion, truncation, and standard attributes</span>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🎨" color="#ec4899" size={40} />
            <h3 style={{ color: '#ec4899', margin: 0, fontSize: '18px' }}>Object Classes</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(236, 72, 153, 0.3)',
          }}>
            {/* Visual class examples */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px', justifyContent: 'center' }}>
              {[
                { name: 'Car', color: '#3b82f6', key: '1' },
                { name: 'Truck', color: '#ef4444', key: '2' },
                { name: 'Pedestrian', color: '#22c55e', key: '3' },
                { name: 'Cyclist', color: '#f59e0b', key: '4' },
              ].map(cls => (
                <div key={cls.name} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '8px 12px',
                  background: '#1e293b',
                  borderRadius: '8px',
                  border: `2px solid ${cls.color}`,
                }}>
                  <div style={{
                    width: '16px',
                    height: '16px',
                    borderRadius: '4px',
                    background: cls.color,
                  }} />
                  <span style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: 600 }}>{cls.name}</span>
                  <KeyBadge>{cls.key}</KeyBadge>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>📝</span>
                <span style={{ color: '#e2e8f0' }}><strong>Name</strong> - Unique identifier</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>🎨</span>
                <span style={{ color: '#e2e8f0' }}><strong>Color</strong> - Visual distinction</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '14px' }}>⌨️</span>
                <span style={{ color: '#e2e8f0' }}><strong>Shortcut</strong> - Quick selection</span>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="⚙️" color="#f59e0b" size={40} />
            <h3 style={{ color: '#f59e0b', margin: 0, fontSize: '18px' }}>Attributes</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(245, 158, 11, 0.3)',
          }}>
            {/* Visual attribute examples */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px',
                background: '#1e293b',
                borderRadius: '8px',
              }}>
                <span style={{ fontSize: '20px' }}>👁️</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>Occlusion</div>
                  <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                    {['0%', '25%', '50%', '75%', '100%'].map(v => (
                      <span key={v} style={{
                        padding: '2px 6px',
                        background: '#334155',
                        borderRadius: '4px',
                        color: '#94a3b8',
                        fontSize: '9px',
                      }}>{v}</span>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px',
                background: '#1e293b',
                borderRadius: '8px',
              }}>
                <span style={{ fontSize: '20px' }}>✂️</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>Truncation</div>
                  <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                    <span style={{ padding: '2px 6px', background: '#334155', borderRadius: '4px', color: '#94a3b8', fontSize: '9px' }}>Yes</span>
                    <span style={{ padding: '2px 6px', background: '#334155', borderRadius: '4px', color: '#94a3b8', fontSize: '9px' }}>No</span>
                  </div>
                </div>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '10px',
                background: '#1e293b',
                borderRadius: '8px',
              }}>
                <span style={{ fontSize: '20px' }}>🚶</span>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>Activity</div>
                  <div style={{ display: 'flex', gap: '4px', marginTop: '4px', flexWrap: 'wrap' }}>
                    {['Walking', 'Standing', 'Sitting'].map(v => (
                      <span key={v} style={{
                        padding: '2px 6px',
                        background: '#334155',
                        borderRadius: '4px',
                        color: '#94a3b8',
                        fontSize: '9px',
                      }}>{v}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <StatusPill text="Required" color="#ef4444" icon="⚠️" />
              <StatusPill text="Optional" color="#64748b" />
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📐" color="#06b6d4" size={40} />
            <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '18px' }}>Default 3D Dimensions</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(6, 182, 212, 0.3)',
          }}>
            {/* Visual dimension examples */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              {[
                { cls: 'Car', emoji: '🚗', l: '4.5', w: '1.8', h: '1.5' },
                { cls: 'Truck', emoji: '🚚', l: '8.0', w: '2.5', h: '3.0' },
                { cls: 'Pedestrian', emoji: '🚶', l: '0.6', w: '0.6', h: '1.8' },
                { cls: 'Cyclist', emoji: '🚴', l: '1.8', w: '0.6', h: '1.7' },
              ].map(item => (
                <div key={item.cls} style={{
                  padding: '10px',
                  background: '#1e293b',
                  borderRadius: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                }}>
                  <span style={{ fontSize: '24px' }}>{item.emoji}</span>
                  <div>
                    <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '12px' }}>{item.cls}</div>
                    <div style={{ color: '#64748b', fontSize: '10px', fontFamily: 'monospace' }}>
                      {item.l}×{item.w}×{item.h}m
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              marginTop: '12px',
              padding: '8px',
              background: 'rgba(6, 182, 212, 0.1)',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <span style={{ fontSize: '14px' }}>💡</span>
              <span style={{ color: '#06b6d4', fontSize: '11px' }}>Defaults speed up annotation workflow</span>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🔗" color="#22c55e" size={40} />
            <h3 style={{ color: '#22c55e', margin: 0, fontSize: '18px' }}>Linking to Datasets</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(34, 197, 94, 0.3)',
          }}>
            {/* Visual link diagram */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
              <div style={{
                padding: '16px',
                background: '#1e293b',
                borderRadius: '12px',
                textAlign: 'center',
                border: '2px solid #8b5cf6',
              }}>
                <span style={{ fontSize: '32px', display: 'block' }}>🏷️</span>
                <div style={{ color: '#a78bfa', fontSize: '11px', marginTop: '4px' }}>Taxonomy</div>
              </div>

              <div style={{ fontSize: '24px' }}>🔗</div>

              <div style={{
                padding: '16px',
                background: '#1e293b',
                borderRadius: '12px',
                textAlign: 'center',
                border: '2px solid #22c55e',
              }}>
                <span style={{ fontSize: '32px', display: 'block' }}>📂</span>
                <div style={{ color: '#86efac', fontSize: '11px', marginTop: '4px' }}>Dataset</div>
              </div>
            </div>

            <div style={{
              padding: '12px',
              background: 'rgba(251, 191, 36, 0.1)',
              borderRadius: '8px',
              border: '1px solid rgba(251, 191, 36, 0.3)',
            }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>⚠️</span>
                <div>
                  <div style={{ color: '#fbbf24', fontSize: '12px', fontWeight: 600 }}>Important</div>
                  <div style={{ color: '#fde68a', fontSize: '11px', marginTop: '2px' }}>
                    Changes affect ALL linked datasets. Create a copy for different projects.
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '64px',
            height: '64px',
            margin: '0 auto 16px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '32px',
            boxShadow: '0 8px 24px rgba(34, 197, 94, 0.4)',
          }}>✅</div>

          <h3 style={{
            color: '#22c55e',
            fontSize: '20px',
            marginBottom: '16px',
          }}>
            Taxonomy Setup Complete!
          </h3>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(34, 197, 94, 0.3)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <span style={{ fontSize: '14px' }}>�</span>
                <span style={{ color: '#e2e8f0', fontSize: '11px' }}>Use templates</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <span style={{ fontSize: '14px' }}>🎨</span>
                <span style={{ color: '#e2e8f0', fontSize: '11px' }}>Use clear colors</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <span style={{ fontSize: '14px' }}>⚙️</span>
                <span style={{ color: '#e2e8f0', fontSize: '11px' }}>Set attributes</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <span style={{ fontSize: '14px' }}>📐</span>
                <span style={{ color: '#e2e8f0', fontSize: '11px' }}>Define defaults</span>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
  ],
};

// =============================================================================
// DATAOPS TOUR - Visual Version Control Guide
// =============================================================================

export const dataOpsTour: TourDefinition = {
  id: 'dataops',
  name: 'DataOps & Version Control',
  description: 'Track annotation history, compare versions, and manage data quality',
  validPaths: ['/datasets', '/campaigns'],
  requiredRole: 'admin,project_manager,qa_reviewer',
  autoStart: false,
  steps: [
    {
      target: 'body',
      content: (
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📊" color="#8b5cf6" size={50} />
          </div>

          <h3 style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: '22px',
            marginBottom: '10px',
          }}>
            DataOps & Version Control
          </h3>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px', textAlign: 'left' }}>
            Track every change to your annotations with full version history. Create snapshots, compare versions, and monitor data quality metrics.
          </p>

          <div style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #ec4899 100%)',
            padding: '2px',
            borderRadius: '12px',
          }}>
            <div style={{
              background: '#0f172a',
              borderRadius: '10px',
              padding: '16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '28px' }}>📜</span>
                  <div style={{ color: '#e2e8f0', fontSize: '11px', marginTop: '4px' }}>History</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '28px' }}>📸</span>
                  <div style={{ color: '#e2e8f0', fontSize: '11px', marginTop: '4px' }}>Snapshots</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '28px' }}>🔍</span>
                  <div style={{ color: '#e2e8f0', fontSize: '11px', marginTop: '4px' }}>Compare</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '28px' }}>📈</span>
                  <div style={{ color: '#e2e8f0', fontSize: '11px', marginTop: '4px' }}>Metrics</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      disableBeacon: true,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📈" color="#06b6d4" size={40} />
            <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '18px' }}>DataOps Dashboard</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(6, 182, 212, 0.3)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{
                padding: '12px',
                background: '#1e293b',
                borderRadius: '8px',
                textAlign: 'center',
              }}>
                <span style={{ fontSize: '24px', display: 'block' }}>📝</span>
                <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '18px' }}>1,234</div>
                <div style={{ color: '#64748b', fontSize: '10px' }}>Total Changes</div>
              </div>
              <div style={{
                padding: '12px',
                background: '#1e293b',
                borderRadius: '8px',
                textAlign: 'center',
              }}>
                <span style={{ fontSize: '24px', display: 'block' }}>📸</span>
                <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '18px' }}>42</div>
                <div style={{ color: '#64748b', fontSize: '10px' }}>Snapshots</div>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📜" color="#f59e0b" size={40} />
            <h3 style={{ color: '#f59e0b', margin: 0, fontSize: '18px' }}>Annotation History</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(245, 158, 11, 0.3)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { type: 'Created', color: '#22c55e', icon: '➕', time: '2 min ago' },
                { type: 'Modified', color: '#f59e0b', icon: '✏️', time: '5 min ago' },
                { type: 'Deleted', color: '#ef4444', icon: '🗑️', time: '10 min ago' },
              ].map(item => (
                <div key={item.type} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '8px',
                  background: '#1e293b',
                  borderRadius: '6px',
                  borderLeft: `3px solid ${item.color}`,
                }}>
                  <span style={{ fontSize: '14px' }}>{item.icon}</span>
                  <span style={{ color: item.color, fontSize: '12px', fontWeight: 600 }}>{item.type}</span>
                  <span style={{ color: '#64748b', fontSize: '11px', marginLeft: 'auto' }}>{item.time}</span>
                </div>
              ))}
            </div>

            <div style={{
              marginTop: '12px',
              padding: '8px',
              background: 'rgba(245, 158, 11, 0.1)',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <span style={{ fontSize: '14px' }}>👤</span>
              <span style={{ color: '#f59e0b', fontSize: '11px' }}>Every change tracked with user & timestamp</span>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📸" color="#8b5cf6" size={40} />
            <h3 style={{ color: '#8b5cf6', margin: 0, fontSize: '18px' }}>Stage Snapshots</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(139, 92, 246, 0.3)',
          }}>
            {/* Visual snapshot flow */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', marginBottom: '16px' }}>
              <div style={{
                padding: '8px',
                background: '#3b82f6',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#fff',
              }}>📝</div>
              <span style={{ color: '#64748b' }}>→</span>
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                border: '2px solid #8b5cf6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
              }}>📸</div>
              <span style={{ color: '#64748b' }}>→</span>
              <div style={{
                padding: '8px',
                background: '#a855f7',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#fff',
              }}>🔍</div>
              <span style={{ color: '#64748b' }}>→</span>
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                border: '2px solid #8b5cf6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '10px',
              }}>📸</div>
              <span style={{ color: '#64748b' }}>→</span>
              <div style={{
                padding: '8px',
                background: '#22c55e',
                borderRadius: '6px',
                fontSize: '11px',
                color: '#fff',
              }}>✅</div>
            </div>

            <div style={{ color: '#94a3b8', fontSize: '12px', textAlign: 'center' }}>
              Auto-captured at each stage transition
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🔍" color="#ec4899" size={40} />
            <h3 style={{ color: '#ec4899', margin: 0, fontSize: '18px' }}>Version Comparison</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(236, 72, 153, 0.3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{
                padding: '12px',
                background: '#1e293b',
                borderRadius: '8px',
                textAlign: 'center',
                minWidth: '80px',
              }}>
                <span style={{ fontSize: '20px', display: 'block' }}>📸</span>
                <div style={{ color: '#94a3b8', fontSize: '10px' }}>Before QA</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', fontSize: '20px' }}>⇄</div>
              <div style={{
                padding: '12px',
                background: '#1e293b',
                borderRadius: '8px',
                textAlign: 'center',
                minWidth: '80px',
              }}>
                <span style={{ fontSize: '20px', display: 'block' }}>📸</span>
                <div style={{ color: '#94a3b8', fontSize: '10px' }}>After QA</div>
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'center', gap: '12px' }}>
              <StatusPill text="Added" color="#22c55e" icon="➕" />
              <StatusPill text="Removed" color="#ef4444" icon="➖" />
              <StatusPill text="Modified" color="#f59e0b" icon="✏️" />
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: '64px',
            height: '64px',
            margin: '0 auto 16px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '32px',
            boxShadow: '0 8px 24px rgba(34, 197, 94, 0.4)',
          }}>✅</div>

          <h3 style={{ color: '#22c55e', fontSize: '20px', marginBottom: '16px' }}>
            DataOps Ready!
          </h3>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(34, 197, 94, 0.3)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <span style={{ fontSize: '14px' }}>📜</span>
                <span style={{ color: '#e2e8f0', fontSize: '11px' }}>Track changes</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <span style={{ fontSize: '14px' }}>👤</span>
                <span style={{ color: '#e2e8f0', fontSize: '11px' }}>Audit users</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <span style={{ fontSize: '14px' }}>🔍</span>
                <span style={{ color: '#e2e8f0', fontSize: '11px' }}>Compare versions</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <span style={{ fontSize: '14px' }}>📈</span>
                <span style={{ color: '#e2e8f0', fontSize: '11px' }}>Quality metrics</span>
              </div>
            </div>

            <div style={{
              marginTop: '12px',
              padding: '8px',
              background: 'rgba(34, 197, 94, 0.1)',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              justifyContent: 'center',
            }}>
              <span style={{ fontSize: '14px' }}>📊</span>
              <span style={{ color: '#22c55e', fontSize: '11px' }}>Access from Dataset → DataOps tab</span>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
  ],
};

// =============================================================================
// ADMIN TOUR - Visual System Administration
// =============================================================================

export const adminTour: TourDefinition = {
  id: 'admin',
  name: 'Admin Settings',
  description: 'Platform administration overview',
  validPaths: ['/admin'],
  requiredRole: 'admin',
  autoStart: false,
  steps: [
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="👥" color="#06b6d4" size={44} />
            <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '20px' }}>User Management</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            Manage team members and their access levels. Each role has specific permissions to control who can annotate, review, or administer.
          </p>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(6, 182, 212, 0.3)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              <div style={{
                padding: '10px',
                background: '#1e293b',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderLeft: '3px solid #ef4444',
              }}>
                <span style={{ fontSize: '18px' }}>👑</span>
                <div>
                  <div style={{ color: '#ef4444', fontWeight: 600, fontSize: '12px' }}>Admin</div>
                  <div style={{ color: '#64748b', fontSize: '10px' }}>Full access</div>
                </div>
              </div>

              <div style={{
                padding: '10px',
                background: '#1e293b',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderLeft: '3px solid #8b5cf6',
              }}>
                <span style={{ fontSize: '18px' }}>📊</span>
                <div>
                  <div style={{ color: '#8b5cf6', fontWeight: 600, fontSize: '12px' }}>PM</div>
                  <div style={{ color: '#64748b', fontSize: '10px' }}>Campaigns</div>
                </div>
              </div>

              <div style={{
                padding: '10px',
                background: '#1e293b',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderLeft: '3px solid #22c55e',
              }}>
                <span style={{ fontSize: '18px' }}>🔍</span>
                <div>
                  <div style={{ color: '#22c55e', fontWeight: 600, fontSize: '12px' }}>QA</div>
                  <div style={{ color: '#64748b', fontSize: '10px' }}>Review work</div>
                </div>
              </div>

              <div style={{
                padding: '10px',
                background: '#1e293b',
                borderRadius: '8px',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                borderLeft: '3px solid #3b82f6',
              }}>
                <span style={{ fontSize: '18px' }}>✏️</span>
                <div>
                  <div style={{ color: '#3b82f6', fontWeight: 600, fontSize: '12px' }}>Annotator</div>
                  <div style={{ color: '#64748b', fontSize: '10px' }}>Create labels</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
      disableBeacon: true,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🏢" color="#8b5cf6" size={40} />
            <h3 style={{ color: '#8b5cf6', margin: 0, fontSize: '18px' }}>Organizations</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(139, 92, 246, 0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '12px' }}>
              <div style={{
                padding: '10px',
                background: '#1e293b',
                borderRadius: '8px',
                textAlign: 'center',
              }}>
                <span style={{ fontSize: '24px', display: 'block' }}>👤</span>
                <div style={{ color: '#e2e8f0', fontSize: '10px', marginTop: '4px' }}>User</div>
              </div>
              <span style={{ color: '#64748b', fontSize: '16px' }}>→</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{
                  padding: '6px 12px',
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
                  borderRadius: '6px',
                  fontSize: '10px',
                  color: '#fff',
                }}>🏢 Org A (Admin)</div>
                <div style={{
                  padding: '6px 12px',
                  background: 'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)',
                  borderRadius: '6px',
                  fontSize: '10px',
                  color: '#fff',
                }}>🏭 Org B (Annotator)</div>
              </div>
            </div>

            <div style={{
              padding: '8px',
              background: 'rgba(139, 92, 246, 0.1)',
              borderRadius: '6px',
              textAlign: 'center',
            }}>
              <span style={{ color: '#a78bfa', fontSize: '11px' }}>Users can have different roles per org</span>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
  ],
};

// =============================================================================
// DATA UPLOAD & EXPORT TOUR - Visual Guide
// =============================================================================

export const dataUploadTour: TourDefinition = {
  id: 'data_upload' as TourId,
  name: 'Data Upload & Export',
  description: 'Learn how to upload scenes and export annotations',
  validPaths: ['/datasets', '/campaigns'],
  requiredRole: null,
  autoStart: false,
  steps: [
    {
      target: 'body',
      content: (
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📤" color="#06b6d4" size={50} />
            <IconCircle emoji="📥" color="#8b5cf6" size={50} />
          </div>

          <h3 style={{
            background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: '22px',
            marginBottom: '10px',
          }}>
            Data Upload & Export
          </h3>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px', textAlign: 'left' }}>
            Get your data into {BRAND.name} and export finished annotations. Multiple upload methods and export formats are supported.
          </p>

          <div style={{
            background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 100%)',
            padding: '2px',
            borderRadius: '12px',
          }}>
            <div style={{
              background: '#0f172a',
              borderRadius: '10px',
              padding: '16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '24px' }}>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '28px' }}>☁️</span>
                  <div style={{ color: '#e2e8f0', fontSize: '11px', marginTop: '4px' }}>Upload</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '28px' }}>📥</span>
                  <div style={{ color: '#e2e8f0', fontSize: '11px', marginTop: '4px' }}>Import</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '28px' }}>📤</span>
                  <div style={{ color: '#e2e8f0', fontSize: '11px', marginTop: '4px' }}>Export</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      disableBeacon: true,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="☁️" color="#10b981" size={44} />
            <h3 style={{ color: '#10b981', margin: 0, fontSize: '20px' }}>Upload Scene Data</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            Choose the upload method that works best for your data. ZIP uploads are recommended for complete scenes with LiDAR and camera data.
          </p>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(16, 185, 129, 0.3)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { method: 'ZIP Upload', desc: 'Fastest for scenes', icon: '📦', color: '#22c55e' },
                { method: 'Drag & Drop', desc: 'Folder structure', icon: '📂', color: '#3b82f6' },
                { method: 'GCS Import', desc: 'Cloud storage', icon: '☁️', color: '#8b5cf6' },
              ].map(item => (
                <div key={item.method} style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: '10px',
                  background: '#1e293b',
                  borderRadius: '8px',
                }}>
                  <span style={{ fontSize: '20px' }}>{item.icon}</span>
                  <div>
                    <div style={{ color: item.color, fontWeight: 600, fontSize: '13px' }}>{item.method}</div>
                    <div style={{ color: '#64748b', fontSize: '11px' }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{
              marginTop: '12px',
              padding: '8px',
              background: 'rgba(16, 185, 129, 0.1)',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <span style={{ fontSize: '14px' }}>💡</span>
              <span style={{ color: '#10b981', fontSize: '11px' }}>Dataset → "Add Scene" button</span>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📁" color="#f59e0b" size={40} />
            <h3 style={{ color: '#f59e0b', margin: 0, fontSize: '18px' }}>Data Structure</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            fontFamily: 'monospace',
            fontSize: '11px',
          }}>
            <div style={{ color: '#f59e0b' }}>📁 scene_folder/</div>
            <div style={{ paddingLeft: '16px', color: '#fbbf24' }}>├─ 📁 data/</div>
            <div style={{ paddingLeft: '32px', color: '#94a3b8' }}>├─ 📁 lidar/</div>
            <div style={{ paddingLeft: '48px', color: '#64748b' }}>├─ 000000.bin</div>
            <div style={{ paddingLeft: '48px', color: '#64748b' }}>└─ 000001.bin</div>
            <div style={{ paddingLeft: '32px', color: '#94a3b8' }}>└─ 📁 front_camera/</div>
            <div style={{ paddingLeft: '48px', color: '#64748b' }}>└─ 000000.jpg</div>
            <div style={{ paddingLeft: '16px', color: '#22c55e' }}>├─ 📄 metadata.json</div>
            <div style={{ paddingLeft: '16px', color: '#06b6d4' }}>└─ 📄 calibration.json</div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📥" color="#8b5cf6" size={40} />
            <h3 style={{ color: '#8b5cf6', margin: 0, fontSize: '18px' }}>Import Annotations</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(139, 92, 246, 0.3)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginBottom: '16px' }}>
              <div style={{
                padding: '12px 20px',
                background: 'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)',
                borderRadius: '8px',
                textAlign: 'center',
              }}>
                <span style={{ fontSize: '24px', display: 'block' }}>🎯</span>
                <div style={{ color: '#fff', fontWeight: 600, fontSize: '13px' }}>COCO</div>
                <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '10px' }}>Standard</div>
              </div>
              <div style={{
                padding: '12px 20px',
                background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
                borderRadius: '8px',
                textAlign: 'center',
              }}>
                <span style={{ fontSize: '24px', display: 'block' }}>🚗</span>
                <div style={{ color: '#fff', fontWeight: 600, fontSize: '13px' }}>KITTI</div>
                <div style={{ color: 'rgba(255,255,255,0.7)', fontSize: '10px' }}>AV Format</div>
              </div>
            </div>

            <div style={{
              padding: '8px',
              background: 'rgba(139, 92, 246, 0.1)',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              justifyContent: 'center',
            }}>
              <span style={{ fontSize: '14px' }}>💡</span>
              <span style={{ color: '#a78bfa', fontSize: '11px' }}>Scene card → "Import Annotations"</span>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📤" color="#06b6d4" size={40} />
            <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '18px' }}>Export Annotations</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(6, 182, 212, 0.3)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px',
                background: '#1e293b',
                borderRadius: '8px',
              }}>
                <IconCircle emoji="📂" color="#3b82f6" size={32} />
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '13px' }}>Dataset Export</div>
                  <div style={{ color: '#64748b', fontSize: '10px' }}>All scenes in dataset</div>
                </div>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px',
                background: '#1e293b',
                borderRadius: '8px',
              }}>
                <IconCircle emoji="🎬" color="#22c55e" size={32} />
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '13px' }}>Scene Export</div>
                  <div style={{ color: '#64748b', fontSize: '10px' }}>Single scene only</div>
                </div>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                padding: '10px',
                background: '#1e293b',
                borderRadius: '8px',
              }}>
                <IconCircle emoji="📋" color="#f59e0b" size={32} />
                <div>
                  <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '13px' }}>Task Export</div>
                  <div style={{ color: '#64748b', fontSize: '10px' }}>Specific frame range</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🗂️" color="#10b981" size={40} />
            <h3 style={{ color: '#10b981', margin: 0, fontSize: '18px' }}>Export Formats</h3>
          </div>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(16, 185, 129, 0.3)',
          }}>
            <div style={{
              padding: '16px',
              background: 'linear-gradient(135deg, rgba(6, 182, 212, 0.2) 0%, rgba(6, 182, 212, 0.05) 100%)',
              borderRadius: '10px',
              border: '1px solid rgba(6, 182, 212, 0.4)',
              marginBottom: '12px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                <span style={{
                  background: '#06b6d4',
                  color: '#000',
                  padding: '3px 10px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 700
                }}>COCO</span>
                <span style={{
                  background: '#22c55e',
                  color: '#000',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  fontSize: '10px',
                  fontWeight: 600
                }}>✓ Recommended</span>
              </div>
              <div style={{ color: '#94a3b8', fontSize: '12px' }}>
                Industry standard • Per-sensor JSON • ML training ready
              </div>
            </div>

            <div style={{
              padding: '12px',
              background: '#1e293b',
              borderRadius: '8px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                <span style={{
                  background: '#8b5cf6',
                  color: '#fff',
                  padding: '3px 10px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 600
                }}>JSON</span>
              </div>
              <div style={{ color: '#64748b', fontSize: '11px' }}>
                Legacy format • Single file • Quick inspection
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
  ],
};

// =============================================================================
// EFFICIENCY MONITORING TOUR
// =============================================================================

export const efficiencyTour: TourDefinition = {
  id: 'efficiency',
  name: 'Efficiency Monitoring',
  description: 'Track productivity, set goals & compete with gamification',
  validPaths: ['/my-dashboard'],
  autoStart: false,
  steps: [
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="⚡" color="#f59e0b" size={44} />
            <h3 style={{ color: '#f59e0b', margin: 0, fontSize: '20px' }}>Real-Time Productivity Tracking</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            Your productivity is automatically tracked as you work. See your stats, set goals, earn achievements, and compete on the leaderboard!
          </p>

          {/* Visual feature preview */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(245, 158, 11, 0.3)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>⏱️</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Automatic session tracking</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>🎯</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Personal goals & benchmarks</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>🏆</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Achievements & streaks</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>📊</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Team leaderboards</span>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', padding: '8px', background: 'rgba(245, 158, 11, 0.1)', borderRadius: '6px' }}>
            <span style={{ fontSize: '14px' }}>⚡</span>
            <span style={{ color: '#f59e0b', fontSize: '12px' }}>All tracking happens automatically in the background</span>
          </div>
        </div>
      ),
      styles: tooltipStyles,
      disableBeacon: true,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="⏱️" color="#3b82f6" size={40} />
            <h3 style={{ color: '#3b82f6', margin: 0, fontSize: '18px' }}>Session Timer</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '12px' }}>
            The timer in the top-right corner tracks your active work time. It starts automatically when you begin working and pauses after 3 minutes of inactivity.
          </p>

          {/* Visual timer preview */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            textAlign: 'center',
          }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              padding: '8px 16px',
              background: 'rgba(59, 130, 246, 0.1)',
              borderRadius: '8px',
              border: '1px solid rgba(59, 130, 246, 0.3)',
            }}>
              <div style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 8px #22c55e',
              }} />
              <span style={{ color: '#3b82f6', fontSize: '18px', fontWeight: 600, fontFamily: 'monospace' }}>02:34:15</span>
            </div>
            <div style={{ color: '#64748b', fontSize: '11px', marginTop: '8px' }}>Today's active work time</div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', padding: '8px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '6px' }}>
            <span style={{ fontSize: '14px' }}>💡</span>
            <span style={{ color: '#3b82f6', fontSize: '12px' }}>Look for the timer in the top-right corner of the page</span>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🎯" color="#22c55e" size={40} />
            <h3 style={{ color: '#22c55e', margin: 0, fontSize: '18px' }}>Goals & Progress</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '12px' }}>
            Set daily, weekly, or monthly goals to stay motivated. Track your progress in real-time on your dashboard.
          </p>

          {/* Visual goal preview */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(34, 197, 94, 0.3)',
          }}>
            <div style={{ marginBottom: '8px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <span style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>Weekly Annotation Goal</span>
                <span style={{ color: '#22c55e', fontSize: '12px', fontWeight: 600 }}>72%</span>
              </div>
              <div style={{
                width: '100%',
                height: '8px',
                background: '#1e293b',
                borderRadius: '4px',
                overflow: 'hidden',
              }}>
                <div style={{
                  width: '72%',
                  height: '100%',
                  background: 'linear-gradient(90deg, #22c55e 0%, #16a34a 100%)',
                  boxShadow: '0 0 12px rgba(34, 197, 94, 0.5)',
                }} />
              </div>
              <div style={{ color: '#64748b', fontSize: '11px', marginTop: '4px' }}>360 / 500 annotations</div>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
              <StatusPill text="On track" color="#22c55e" icon="✓" />
              <StatusPill text="4 days left" color="#3b82f6" icon="📅" />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', padding: '8px', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '6px' }}>
            <span style={{ fontSize: '14px' }}>👆</span>
            <span style={{ color: '#22c55e', fontSize: '12px' }}>Find goals in the "My Performance" section</span>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🏆" color="#8b5cf6" size={40} />
            <h3 style={{ color: '#8b5cf6', margin: 0, fontSize: '18px' }}>Achievements & Streaks</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '12px' }}>
            Unlock achievements as you hit milestones. Build streaks by consistently meeting your daily goals!
          </p>

          {/* Visual achievement preview */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(139, 92, 246, 0.3)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px',
                background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.2) 0%, rgba(168, 85, 247, 0.1) 100%)',
                borderRadius: '8px',
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #8b5cf6 0%, #a855f7 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  boxShadow: '0 4px 12px rgba(139, 92, 246, 0.4)',
                }}>🚀</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>Speed Demon</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>Complete 100 annotations in a day</div>
                </div>
                <div style={{
                  padding: '4px 8px',
                  background: '#8b5cf6',
                  borderRadius: '4px',
                  color: '#fff',
                  fontSize: '10px',
                  fontWeight: 600,
                }}>UNLOCKED</div>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                padding: '12px',
                background: 'rgba(245, 158, 11, 0.1)',
                borderRadius: '8px',
              }}>
                <div style={{
                  width: '40px',
                  height: '40px',
                  borderRadius: '8px',
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '20px',
                  boxShadow: '0 4px 12px rgba(245, 158, 11, 0.4)',
                }}>🔥</div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>7-Day Streak</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>Keep it going!</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
    {
      target: 'body',
      placement: 'center' as Placement,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📊" color="#06b6d4" size={40} />
            <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '18px' }}>Leaderboard</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '12px' }}>
            See how you rank against your teammates. Compete on annotations completed, time worked, or quality scores!
          </p>

          {/* Visual leaderboard preview */}
          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(6, 182, 212, 0.3)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                { rank: 1, name: 'Sarah Chen', score: 1247, color: '#fbbf24', emoji: '🥇' },
                { rank: 2, name: 'You', score: 1089, color: '#94a3b8', emoji: '🥈' },
                { rank: 3, name: 'Mike Ross', score: 967, color: '#cd7f32', emoji: '🥉' },
              ].map((user, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '8px 12px',
                    background: user.name === 'You' ? 'rgba(6, 182, 212, 0.1)' : '#1e293b',
                    borderRadius: '8px',
                    border: user.name === 'You' ? '1px solid rgba(6, 182, 212, 0.3)' : 'none',
                  }}
                >
                  <span style={{ fontSize: '18px' }}>{user.emoji}</span>
                  <span style={{ color: user.color, fontWeight: 600, fontSize: '12px', width: '20px' }}>#{user.rank}</span>
                  <span style={{ color: '#e2e8f0', fontSize: '12px', flex: 1 }}>{user.name}</span>
                  <span style={{ color: '#06b6d4', fontSize: '12px', fontWeight: 600 }}>{user.score}</span>
                </div>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px', padding: '8px', background: 'rgba(6, 182, 212, 0.1)', borderRadius: '6px' }}>
            <span style={{ fontSize: '14px' }}>🏁</span>
            <span style={{ color: '#06b6d4', fontSize: '12px' }}>Rankings update in real-time as you work</span>
          </div>
        </div>
      ),
      styles: tooltipStyles,
    },
  ],
};

// =============================================================================
// AI QUALITY CHECKS TOUR
// =============================================================================

export const aiQualityTour: TourDefinition = {
  id: 'ai_quality',
  name: 'AI Quality Checks',
  description: '24 automated quality checks for 3D annotations explained',
  validPaths: ['/', '/tasks', '/campaigns', '/datasets', '/editor'],
  requiredRole: null,
  autoStart: false,
  steps: [
    // Step 1: Welcome
    {
      target: 'body',
      content: (
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🤖" color="#8b5cf6" size={50} />
          </div>

          <h3 style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: '22px',
            marginBottom: '10px',
          }}>
            AI Quality Checks
          </h3>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px', textAlign: 'left' }}>
            Our AI performs <strong style={{ color: '#8b5cf6' }}>24 automated quality checks</strong> on your 3D annotations to detect issues before they impact your data quality.
          </p>

          <div style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)',
            padding: '2px',
            borderRadius: '12px',
          }}>
            <div style={{
              background: '#0f172a',
              borderRadius: '10px',
              padding: '16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', flexWrap: 'wrap' }}>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '28px' }}>📐</span>
                  <div style={{ color: '#fbbf24', fontSize: '11px', marginTop: '4px', fontWeight: 600 }}>Geometry</div>
                  <div style={{ color: '#64748b', fontSize: '10px' }}>4 checks</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '28px' }}>🔗</span>
                  <div style={{ color: '#3b82f6', fontSize: '11px', marginTop: '4px', fontWeight: 600 }}>Track</div>
                  <div style={{ color: '#64748b', fontSize: '10px' }}>9 checks</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '28px' }}>☁️</span>
                  <div style={{ color: '#06b6d4', fontSize: '11px', marginTop: '4px', fontWeight: 600 }}>Point Cloud</div>
                  <div style={{ color: '#64748b', fontSize: '10px' }}>3 checks</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '28px' }}>🏙️</span>
                  <div style={{ color: '#22c55e', fontSize: '11px', marginTop: '4px', fontWeight: 600 }}>Scene</div>
                  <div style={{ color: '#64748b', fontSize: '10px' }}>5 checks</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '28px' }}>📷</span>
                  <div style={{ color: '#a855f7', fontSize: '11px', marginTop: '4px', fontWeight: 600 }}>Cross-Modal</div>
                  <div style={{ color: '#64748b', fontSize: '10px' }}>3 checks</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      disableBeacon: true,
      styles: tooltipStyles,
    },
    // Step 2: Geometry Checks
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📐" color="#fbbf24" size={40} />
            <h3 style={{ color: '#fbbf24', margin: 0, fontSize: '18px' }}>Geometry Checks (4)</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '16px' }}>
            Validates 3D box properties and spatial relationships.
          </p>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(251, 191, 36, 0.3)',
          }}>
            <VisualCard icon="📍" title="Ground Plane Alignment" description="Objects touch the estimated ground plane" color="#fbbf24" />
            <VisualCard icon="📏" title="Aspect Ratio" description="Box proportions match object class" color="#fbbf24" />
            <VisualCard icon="📦" title="Overlapping Boxes" description="Detects duplicate annotations (3D IoU)" color="#fbbf24" />
            <VisualCard icon="🚗" title="Ego Collision" description="No boxes inside ego vehicle zone" color="#fbbf24" />
          </div>

          <div style={{ marginTop: '12px', padding: '10px', background: 'rgba(251, 191, 36, 0.1)', borderRadius: '8px' }}>
            <span style={{ color: '#fbbf24', fontSize: '12px' }}>💡 Common issue: Vehicles floating above ground or sunk into it</span>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    // Step 3: Track Checks
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🔗" color="#3b82f6" size={40} />
            <h3 style={{ color: '#3b82f6', margin: 0, fontSize: '18px' }}>Track Checks (9)</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '16px' }}>
            Validates object tracking quality across frames.
          </p>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(59, 130, 246, 0.3)',
            maxHeight: '280px',
            overflowY: 'auto',
          }}>
            <VisualCard icon="⏸️" title="Track Gaps" description="Missing frames in trajectories" color="#3b82f6" />
            <VisualCard icon="🏁" title="Track Boundaries" description="Start/end at scene edges" color="#3b82f6" />
            <VisualCard icon="⚡" title="Velocity Outliers" description="Impossible speeds detected" color="#3b82f6" />
            <VisualCard icon="🧭" title="Heading-Motion" description="Vehicle facing vs movement direction" color="#3b82f6" />
            <VisualCard icon="📏" title="Dimension Consistency" description="Same object = same size across frames" color="#3b82f6" />
            <VisualCard icon="⏱️" title="Short Tracks" description="<3 frame tracks flagged" color="#3b82f6" />
            <VisualCard icon="🧍" title="Stationary Motion" description="Pedestrians that never move" color="#3b82f6" />
            <VisualCard icon="👻" title="Ghost Tracks" description="Duplicate tracks on same object" color="#3b82f6" />
            <VisualCard icon="🔀" title="ID Switches" description="Track ID swap detection" color="#3b82f6" />
          </div>

          <div style={{ marginTop: '12px', padding: '10px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px' }}>
            <span style={{ color: '#3b82f6', fontSize: '12px' }}>💡 Critical: Velocity {'>'} 40m/s for cars = impossible teleportation</span>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    // Step 4: Point Cloud Checks
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="☁️" color="#06b6d4" size={40} />
            <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '18px' }}>Point Cloud Checks (3)</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '16px' }}>
            Deep analysis of LiDAR point data for accuracy validation.
          </p>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(6, 182, 212, 0.3)',
          }}>
            <VisualCard icon="📊" title="Point Density" description="Box contains expected LiDAR points" color="#06b6d4" />
            <VisualCard icon="🎯" title="Point Fit Score" description="Points align with box surfaces" color="#06b6d4" />
            <VisualCard icon="📦" title="Hull Tightness" description="Box volume vs convex hull of points" color="#06b6d4" />
          </div>

          <div style={{ marginTop: '16px', display: 'flex', gap: '12px' }}>
            <div style={{ flex: 1, padding: '12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', textAlign: 'center', border: '1px solid rgba(239, 68, 68, 0.3)' }}>
              <div style={{ fontSize: '24px' }}>🚨</div>
              <div style={{ color: '#ef4444', fontWeight: 600, fontSize: '12px' }}>0 Points</div>
              <div style={{ color: '#94a3b8', fontSize: '10px' }}>Critical - Ghost box</div>
            </div>
            <div style={{ flex: 1, padding: '12px', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '8px', textAlign: 'center', border: '1px solid rgba(34, 197, 94, 0.3)' }}>
              <div style={{ fontSize: '24px' }}>✅</div>
              <div style={{ color: '#22c55e', fontWeight: 600, fontSize: '12px' }}>Good Fit</div>
              <div style={{ color: '#94a3b8', fontSize: '10px' }}>Points on surfaces</div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    // Step 5: Scene Checks
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="🏙️" color="#22c55e" size={40} />
            <h3 style={{ color: '#22c55e', margin: 0, fontSize: '18px' }}>Scene Checks (5)</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '16px' }}>
            Validates annotations in scene-level context.
          </p>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(34, 197, 94, 0.3)',
          }}>
            <VisualCard icon="🗺️" title="Semantic Placement" description="Objects in valid locations (no flying cars)" color="#22c55e" />
            <VisualCard icon="📏" title="Distance Range" description="Within sensor range (1m-80m)" color="#22c55e" />
            <VisualCard icon="🏷️" title="Class Attributes" description="Required attributes set (occluded, truncated)" color="#22c55e" />
            <VisualCard icon="⚙️" title="Annotation Source" description="Auto-generated flagged for review" color="#22c55e" />
            <VisualCard icon="📊" title="Frame Count" description="Unusual annotation counts detected" color="#22c55e" />
          </div>

          <div style={{ marginTop: '12px', padding: '10px', background: 'rgba(34, 197, 94, 0.1)', borderRadius: '8px' }}>
            <span style={{ color: '#22c55e', fontSize: '12px' }}>💡 Example: Car at z=7.2m = floating, needs ground alignment</span>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    // Step 6: Cross-Modal Checks
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="📷" color="#a855f7" size={40} />
            <h3 style={{ color: '#a855f7', margin: 0, fontSize: '18px' }}>Cross-Modal Checks (3)</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '16px' }}>
            Validates consistency between LiDAR and camera data.
          </p>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(168, 85, 247, 0.3)',
          }}>
            <VisualCard icon="🌐" title="Projection Alignment" description="3D boxes project correctly to cameras" color="#a855f7" />
            <VisualCard icon="👁️" title="Camera Visibility" description="Occlusion labels match camera views" color="#a855f7" />
            <VisualCard icon="🤖" title="Class Verification" description="Vision AI cross-checks labels" color="#a855f7" />
          </div>

          <div style={{ marginTop: '16px', padding: '12px', background: '#1e293b', borderRadius: '10px' }}>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <div style={{ fontSize: '36px' }}>📡</div>
              <div>
                <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '13px' }}>LiDAR + Camera Fusion</div>
                <div style={{ color: '#64748b', fontSize: '11px' }}>Cross-checks 3D annotations against all camera views</div>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    // Step 7: Severity Levels
    {
      target: 'body',
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="⚠️" color="#f59e0b" size={40} />
            <h3 style={{ color: '#f59e0b', margin: 0, fontSize: '18px' }}>Severity Levels</h3>
          </div>

          <p style={{ color: '#94a3b8', fontSize: '13px', marginBottom: '16px' }}>
            Issues are ranked by impact on data quality:
          </p>

          <div style={{
            background: '#0f172a',
            borderRadius: '12px',
            padding: '16px',
            border: '1px solid rgba(245, 158, 11, 0.3)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '24px' }}>🔴</span>
              <div>
                <div style={{ color: '#ef4444', fontWeight: 700, fontSize: '14px' }}>Critical</div>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>Must fix - severe errors affecting data usability</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(249, 115, 22, 0.1)', borderRadius: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '24px' }}>🟠</span>
              <div>
                <div style={{ color: '#f97316', fontWeight: 700, fontSize: '14px' }}>High</div>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>Important issues - should be addressed</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(234, 179, 8, 0.1)', borderRadius: '8px', marginBottom: '8px' }}>
              <span style={{ fontSize: '24px' }}>🟡</span>
              <div>
                <div style={{ color: '#eab308', fontWeight: 700, fontSize: '14px' }}>Medium</div>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>Moderate concerns - review recommended</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', background: 'rgba(59, 130, 246, 0.1)', borderRadius: '8px' }}>
              <span style={{ fontSize: '24px' }}>🔵</span>
              <div>
                <div style={{ color: '#3b82f6', fontWeight: 700, fontSize: '14px' }}>Low</div>
                <div style={{ color: '#94a3b8', fontSize: '11px' }}>Minor issues - low priority</div>
              </div>
            </div>
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
    // Step 8: How to Run
    {
      target: 'body',
      content: (
        <div style={{ textAlign: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', marginBottom: '16px' }}>
            <IconCircle emoji="✨" color="#8b5cf6" size={50} />
          </div>

          <h3 style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: '22px',
            marginBottom: '10px',
          }}>
            Running AI Checks
          </h3>

          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            In the 3D Editor, look for the <strong style={{ color: '#8b5cf6' }}>AI Quality Check</strong> panel on the right sidebar.
          </p>

          <div style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)',
            padding: '2px',
            borderRadius: '12px',
            marginBottom: '16px',
          }}>
            <div style={{
              background: '#0f172a',
              borderRadius: '10px',
              padding: '20px',
            }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '32px', height: '32px', background: '#8b5cf6', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700 }}>1</div>
                  <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Open any 3D annotation task</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '32px', height: '32px', background: '#06b6d4', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700 }}>2</div>
                  <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Click <strong>"Run Check"</strong> in the AI Quality panel</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <div style={{ width: '32px', height: '32px', background: '#22c55e', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700 }}>3</div>
                  <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Review issues and click to navigate to each one</span>
                </div>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'center', gap: '8px' }}>
            <StatusPill text="Automatic" color="#22c55e" icon="✓" />
            <StatusPill text="24 Checks" color="#8b5cf6" icon="🤖" />
            <StatusPill text="Real-time" color="#06b6d4" icon="⚡" />
          </div>
        </div>
      ),
      placement: 'center' as Placement,
      styles: tooltipStyles,
    },
  ],
};

// =============================================================================
// SEMANTIC SEGMENTATION EDITOR TOUR
// =============================================================================

export const segmentation3DEditorTour: TourDefinition = {
  id: 'segmentation_3d_editor',
  name: '3D Segmentation Editor',
  description: 'Learn to paint semantic labels on LiDAR point clouds',
  validPaths: ['/tasks/'],
  autoStart: false,
  steps: [
    // ── STEP 1: Welcome ─────────────────────────────────────────────────────
    {
      target: 'body',
      placement: 'center' as Placement,
      disableBeacon: true,
      styles: tooltipStyles,
      content: (
        <div style={{ textAlign: 'center' }}>
          {/* Hero banner */}
          <div style={{
            width: '100%',
            height: '140px',
            background: 'linear-gradient(135deg, #0a0f1a 0%, #1e293b 50%, #0a0f1a 100%)',
            borderRadius: '16px',
            marginBottom: '24px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
            border: '1px solid rgba(139, 92, 246, 0.25)',
          }}>
            <div style={{
              position: 'absolute',
              width: '200px', height: '200px',
              border: '1px solid rgba(139, 92, 246, 0.2)',
              borderRadius: '50%',
            }} />
            <div style={{
              position: 'absolute',
              width: '150px', height: '150px',
              border: '1px solid rgba(6, 182, 212, 0.25)',
              borderRadius: '50%',
            }} />
            <div style={{ display: 'flex', gap: '14px', zIndex: 1, alignItems: 'center' }}>
              <span style={{ fontSize: '44px' }}>🎨</span>
              <span style={{ fontSize: '54px' }}>📡</span>
              <span style={{ fontSize: '44px' }}>🏷️</span>
            </div>
          </div>

          <h3 style={{
            background: 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: '26px',
            fontWeight: 700,
            marginBottom: '12px',
          }}>
            3D Segmentation Editor
          </h3>
          <p style={{ color: '#cbd5e1', fontSize: '14px', lineHeight: 1.6, marginBottom: '8px' }}>
            Paint semantic labels directly onto LiDAR point clouds using brush, lasso, and AI-powered tools.
          </p>
          <p style={{ color: '#94a3b8', fontSize: '13px', lineHeight: 1.5, marginBottom: '20px' }}>
            Every point in the cloud gets a class label — road, vehicle, pedestrian, vegetation, and more.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', justifyContent: 'center' }}>
            <StatusPill text="Point Painting" color="#8b5cf6" icon="🎨" />
            <StatusPill text="AI Assisted" color="#06b6d4" icon="✨" />
            <StatusPill text="Multi-Frame" color="#22c55e" icon="🎬" />
          </div>
        </div>
      ),
    },

    // ── STEP 2: The Point Cloud View ─────────────────────────────────────────
    {
      target: 'body',
      placement: 'center' as Placement,
      styles: tooltipStyles,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="📡" color="#06b6d4" size={44} />
            <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '20px' }}>The 3D Viewport</h3>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            The main canvas shows the LiDAR point cloud. Each dot is coloured by its class label. Navigate freely to find the best painting angle.
          </p>
          <div style={{
            background: 'linear-gradient(180deg, #0a0f1a 0%, #0f172a 100%)',
            borderRadius: '12px', padding: '16px', marginBottom: '16px',
            border: '1px solid rgba(6, 182, 212, 0.2)',
          }}>
            {/* Simulated coloured point cloud */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '3px', marginBottom: '8px' }}>
              {['#ef4444','#3b82f6','#22c55e','#f59e0b','#8b5cf6','#06b6d4','#ec4899','#ef4444','#3b82f6','#22c55e',
                '#22c55e','#22c55e','#3b82f6','#3b82f6','#f59e0b','#f59e0b','#8b5cf6','#06b6d4','#ef4444','#22c55e',
                '#f59e0b','#3b82f6','#ef4444','#22c55e','#3b82f6','#ef4444','#22c55e','#f59e0b','#8b5cf6','#06b6d4'].map((c, i) => (
                <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: c, opacity: 0.85 }} />
              ))}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', flexWrap: 'wrap' }}>
              {[['#ef4444','Road'],['#3b82f6','Vehicle'],['#22c55e','Vegetation'],['#f59e0b','Building']].map(([c,l]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: c }} />
                  <span style={{ color: '#94a3b8', fontSize: '10px' }}>{l}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
            {[['🖱️','Scroll','Zoom in/out'],['🔄','Left Drag','Rotate view'],['✋','Right Drag','Pan view'],['🎯','Double-click','Reset camera']].map(([e,t,d]) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                <span style={{ fontSize: '16px' }}>{e}</span>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: 600 }}>{t}</div>
                  <div style={{ color: '#64748b', fontSize: '10px' }}>{d}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ),
    },

    // ── STEP 3: Brush Tool ───────────────────────────────────────────────────
    {
      target: 'body',
      placement: 'center' as Placement,
      styles: tooltipStyles,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="🖌️" color="#8b5cf6" size={44} />
            <h3 style={{ color: '#8b5cf6', margin: 0, fontSize: '20px' }}>Brush Tool</h3>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            The most common tool. Paint a spherical volume of points with the selected class label in a single stroke.
          </p>
          <div style={{
            background: '#0f172a', borderRadius: '12px', padding: '18px',
            border: '1px solid rgba(139, 92, 246, 0.3)', marginBottom: '14px',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {[
                ['1','Press','B','to activate Brush tool'],
                ['2','Pick a class label from the right panel','',''],
                ['3','Click + Drag','','over the point cloud to paint'],
                ['4','Hold Shift','','while brushing to temporarily erase'],
              ].map(([num, pre, key, post]) => (
                <div key={num} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '26px', height: '26px', borderRadius: '50%', flexShrink: 0,
                    background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#fff', fontSize: '12px', fontWeight: 700,
                  }}>{num}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                    {pre && <span style={{ color: '#e2e8f0', fontSize: '13px' }}>{pre}</span>}
                    {key && <KeyBadge glow>{key}</KeyBadge>}
                    {post && <span style={{ color: '#e2e8f0', fontSize: '13px' }}>{post}</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            padding: '10px', background: 'rgba(139, 92, 246, 0.1)', borderRadius: '8px',
          }}>
            <span style={{ fontSize: '14px' }}>💡</span>
            <span style={{ color: '#a78bfa', fontSize: '12px' }}>Adjust brush radius with <strong>[ ]</strong> keys or the size slider. Press <strong>Esc</strong> to exit Brush.</span>
          </div>
        </div>
      ),
    },

    // ── STEP 4: Lasso Tool ───────────────────────────────────────────────────
    {
      target: 'body',
      placement: 'center' as Placement,
      styles: tooltipStyles,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="🪢" color="#f59e0b" size={44} />
            <h3 style={{ color: '#f59e0b', margin: 0, fontSize: '20px' }}>Lasso Tool</h3>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            Draw a freehand selection polygon on screen. All points inside the 2D lasso projection are labelled — ideal for precise object outlines.
          </p>
          <div style={{
            background: '#0f172a', borderRadius: '12px', padding: '16px',
            border: '1px solid rgba(245, 158, 11, 0.3)', marginBottom: '14px',
          }}>
            {/* Visual lasso illustration */}
            <div style={{ position: 'relative', height: '80px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="180" height="70" viewBox="0 0 180 70">
                <polygon points="30,10 80,5 150,20 160,50 100,65 40,60 10,35" fill="rgba(245,158,11,0.12)" stroke="#f59e0b" strokeWidth="2" strokeDasharray="6,3" />
                {[[35,15],[85,8],[148,22],[158,48],[98,62],[42,58],[12,37]].map(([x,y],i) => (
                  <circle key={i} cx={x} cy={y} r="4" fill="#f59e0b" />
                ))}
                {[[60,35],[90,30],[120,40],[100,52],[70,48]].map(([x,y],i) => (
                  <circle key={i} cx={x} cy={y} r="3" fill="#3b82f6" opacity="0.8" />
                ))}
              </svg>
            </div>
            <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '11px', marginTop: '4px' }}>
              Blue points inside lasso = labelled with selected class
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {[
              ['1', 'Press L to activate Lasso tool'],
              ['2', 'Click + drag to draw a freehand boundary'],
              ['3', 'Release mouse to apply labels inside boundary'],
              ['4', 'Press Esc to cancel the current lasso'],
            ].map(([num, text]) => (
              <div key={num} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
                <div style={{
                  width: '24px', height: '24px', borderRadius: '50%', flexShrink: 0,
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: '12px', fontWeight: 700,
                }}>{num}</div>
                <span style={{ color: '#e2e8f0', fontSize: '12px' }}>{text}</span>
              </div>
            ))}
          </div>
        </div>
      ),
    },

    // ── STEP 5: Region Grow Tool ─────────────────────────────────────────────
    {
      target: 'body',
      placement: 'center' as Placement,
      styles: tooltipStyles,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="🌱" color="#22c55e" size={44} />
            <h3 style={{ color: '#22c55e', margin: 0, fontSize: '20px' }}>Region Grow Tool</h3>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            Click a seed point and the tool automatically expands the selection to spatially connected points of similar density — great for uniform surfaces like roads or walls.
          </p>
          <div style={{
            background: '#0f172a', borderRadius: '12px', padding: '16px',
            border: '1px solid rgba(34, 197, 94, 0.3)', marginBottom: '14px',
          }}>
            {/* Visual grow animation */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '14px', marginBottom: '10px' }}>
              <div style={{
                width: '30px',
                height: '30px',
                borderRadius: '50%',
                background: 'radial-gradient(circle, #4ade80 0%, #16a34a 100%)',
                border: '2px solid #22c55e',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: '0 0 14px rgba(34, 197, 94, 0.5)',
              }}>
                <span style={{ fontSize: '13px' }}>🌱</span>
              </div>
              <span style={{ color: '#4ade80', fontSize: '16px', fontWeight: 700 }}>→</span>
              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                {[10, 14, 18].map((size, idx) => (
                  <div
                    key={idx}
                    style={{
                      width: size,
                      height: size,
                      borderRadius: '50%',
                      background: '#22c55e',
                      opacity: 0.45 + idx * 0.2,
                      boxShadow: '0 0 8px rgba(34, 197, 94, 0.35)',
                    }}
                  />
                ))}
              </div>
            </div>
            <div style={{ textAlign: 'center', color: '#4ade80', fontSize: '12px', fontWeight: 600, marginTop: '4px' }}>
              Click seed → region expands outward automatically
            </div>
          </div>
          <div style={{
            display: 'flex', flexDirection: 'column', gap: '8px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
              <span style={{ fontSize: '18px' }}>🎛️</span>
              <div>
                <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>Tolerance slider</div>
                <div style={{ color: '#64748b', fontSize: '11px' }}>Controls how aggressively the region expands</div>
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
              <span style={{ fontSize: '18px' }}>💡</span>
              <span style={{ color: '#4ade80', fontSize: '12px' }}>Best for flat surfaces: road, ground, parking lots</span>
            </div>
          </div>
        </div>
      ),
    },

    // ── STEP 6: Eraser Tool ──────────────────────────────────────────────────
    {
      target: 'body',
      placement: 'center' as Placement,
      styles: tooltipStyles,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="🧹" color="#ef4444" size={44} />
            <h3 style={{ color: '#ef4444', margin: 0, fontSize: '20px' }}>Eraser Tool</h3>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            Remove labels from points — sets them back to <em>unlabelled</em>. Use it to clean up over-painted areas or correct mistakes without affecting neighbouring classes.
          </p>
          <div style={{
            background: '#0f172a', borderRadius: '12px', padding: '16px',
            border: '1px solid rgba(239, 68, 68, 0.3)', marginBottom: '14px',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
                <KeyBadge>E</KeyBadge>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Activate Eraser tool</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
                <span style={{ fontSize: '18px' }}>🖱️</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Click + Drag to erase points</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
                <span style={{ fontSize: '18px' }}>⚡</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Quick erase while brushing: hold Shift (temporary)</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#1e293b', borderRadius: '8px' }}>
                <span style={{ fontSize: '18px' }}>🔄</span>
                <div>
                  <div style={{ color: '#e2e8f0', fontSize: '13px', fontWeight: 600 }}>Tip for cleanup</div>
                  <div style={{ color: '#64748b', fontSize: '11px' }}>Increase eraser radius to clear large mislabeled regions faster</div>
                </div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: 'rgba(239,68,68,0.08)', borderRadius: '8px' }}>
            <span style={{ fontSize: '14px' }}>⚠️</span>
            <span style={{ color: '#fca5a5', fontSize: '12px' }}>Erased points become unlabelled (grey) — not deleted</span>
          </div>
        </div>
      ),
    },

    // ── STEP 7: Detect Ground ────────────────────────────────────────────────
    {
      target: 'body',
      placement: 'center' as Placement,
      styles: tooltipStyles,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="🌍" color="#06b6d4" size={44} />
            <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '20px' }}>Detect Ground</h3>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            One-click AI that automatically detects and labels the ground plane (road / drivable surface) across the entire frame — saving minutes of manual painting.
          </p>
          <div style={{
            background: '#0f172a', borderRadius: '12px', padding: '16px',
            border: '1px solid rgba(6, 182, 212, 0.3)', marginBottom: '14px',
          }}>
            {/* Visual before/after */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
              <div style={{ background: '#1e293b', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '3px', marginBottom: '4px' }}>
                  {Array(10).fill('#64748b').map((c,i) => <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: c }} />)}
                </div>
                <div style={{ color: '#94a3b8', fontSize: '10px' }}>Before</div>
              </div>
              <span style={{ color: '#06b6d4', fontSize: '20px' }}>→</span>
              <div style={{ background: '#1e293b', borderRadius: '8px', padding: '10px', textAlign: 'center' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: '3px', marginBottom: '4px' }}>
                  {Array(10).fill('#ef4444').map((c,i) => <div key={i} style={{ width: '8px', height: '8px', borderRadius: '50%', background: c }} />)}
                </div>
                <div style={{ color: '#4ade80', fontSize: '10px' }}>After</div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>⚡</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Click <strong style={{ color: '#06b6d4' }}>Detect Ground</strong> button in toolbar</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>🏷️</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Ground points auto-assigned to the <em>Road</em> class</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '18px' }}>✏️</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Refine edges manually with Brush or Eraser</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: 'rgba(6,182,212,0.08)', borderRadius: '8px' }}>
            <span style={{ fontSize: '14px' }}>💡</span>
            <span style={{ color: '#67e8f9', fontSize: '12px' }}>Always run Detect Ground first — it sets the baseline for other classes</span>
          </div>
        </div>
      ),
    },

    // ── STEP 8: Class Labels & Colour Mode ───────────────────────────────────
    {
      target: 'body',
      placement: 'center' as Placement,
      styles: tooltipStyles,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="🏷️" color="#22c55e" size={44} />
            <h3 style={{ color: '#22c55e', margin: 0, fontSize: '20px' }}>Class Labels</h3>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            Select the active class from the right-hand panel before painting. You can also change colour mode in the header to visualise by Class, Instance, or Height.
          </p>
          <div style={{
            background: '#0f172a', borderRadius: '12px', padding: '16px',
            border: '1px solid rgba(34, 197, 94, 0.3)', marginBottom: '14px',
          }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' }}>
              {[['#ef4444','Road'],['#3b82f6','Vehicle'],['#22c55e','Vegetation'],['#f59e0b','Building'],['#8b5cf6','Pedestrian'],['#06b6d4','Sky']].map(([c,l]) => (
                <div key={l} style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '5px 10px', background: '#1e293b', borderRadius: '6px', border: `1px solid ${c}60` }}>
                  <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: c }} />
                  <span style={{ color: '#e2e8f0', fontSize: '12px' }}>{l}</span>
                </div>
              ))}
            </div>
            <div style={{ borderTop: '1px solid #334155', paddingTop: '10px' }}>
              <div style={{ color: '#94a3b8', fontSize: '12px', marginBottom: '6px' }}>Colour modes:</div>
              <div style={{ display: 'flex', gap: '8px' }}>
                {[['Class','Per-label colour'],['Instance','Unique ID colour'],['Height','Z-gradient']].map(([m,d]) => (
                  <div key={m} style={{ flex: 1, padding: '8px', background: '#1e293b', borderRadius: '6px', textAlign: 'center' }}>
                    <div style={{ color: '#e2e8f0', fontSize: '12px', fontWeight: 600 }}>{m}</div>
                    <div style={{ color: '#64748b', fontSize: '10px' }}>{d}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ),
    },

    // ── STEP 9: Undo / Save / Frame Navigation ───────────────────────────────
    {
      target: 'body',
      placement: 'center' as Placement,
      styles: tooltipStyles,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="⏪" color="#f59e0b" size={44} />
            <h3 style={{ color: '#f59e0b', margin: 0, fontSize: '20px' }}>Undo, Autosave & Frames</h3>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '16px' }}>
            Segmentation edits are tracked per-frame. Autosave is enabled, and you can still use Undo/Redo while moving between frames via the frame controls.
          </p>
          <div style={{
            background: '#0f172a', borderRadius: '12px', padding: '16px',
            border: '1px solid rgba(245, 158, 11, 0.3)',
          }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
              {[
                ['Ctrl+Z','Undo last stroke'],
                ['Ctrl+Y','Redo stroke'],
                ['Autosave','Enabled by default'],
                ['Arrow Keys','Left/Right = prev/next frame'],
                ['Home / End','Jump to first / last frame'],
                ['Timeline click','Jump to a frame directly'],
                ['Esc','Exit active tool (back to Select)'],
                ['Submit','Only after reviewing all frames'],
              ].map(([k,d]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px', background: '#1e293b', borderRadius: '6px' }}>
                  <KeyBadge>{k}</KeyBadge>
                  <span style={{ color: '#94a3b8', fontSize: '11px' }}>{d}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px', background: 'rgba(245,158,11,0.08)', borderRadius: '8px', marginTop: '10px' }}>
              <span style={{ fontSize: '14px' }}>💡</span>
              <span style={{ color: '#fcd34d', fontSize: '12px' }}>Use keyboard navigation to review faster, then submit once all frames are checked</span>
            </div>
          </div>
        </div>
      ),
    },

    // ── STEP 10: Timer & Submit ──────────────────────────────────────────────
    {
      target: '[data-tour="timer-control"]',
      placement: 'bottom' as Placement,
      styles: tooltipStyles,
      content: (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <IconCircle emoji="⏱️" color="#06b6d4" size={40} />
            <h3 style={{ color: '#06b6d4', margin: 0, fontSize: '18px' }}>Session Timer</h3>
          </div>
          <p style={{ color: '#94a3b8', fontSize: '14px', lineHeight: 1.5, marginBottom: '14px' }}>
            Track your active annotation time. Start the timer when you begin, and pause it during breaks. Time is logged per task for productivity reporting.
          </p>
          <div style={{
            background: '#0f172a', borderRadius: '10px', padding: '12px',
            border: '1px solid rgba(6, 182, 212, 0.3)',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>▶️</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Click play to start timing your session</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px' }}>⏸️</span>
                <span style={{ color: '#e2e8f0', fontSize: '13px' }}>Pause when taking breaks — don't inflate your time</span>
              </div>
            </div>
          </div>
        </div>
      ),
    },

    // ── STEP 11: Final / Ready ───────────────────────────────────────────────
    {
      target: 'body',
      placement: 'center' as Placement,
      styles: tooltipStyles,
      content: (
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: '20px' }}>
            <IconCircle emoji="🚀" color="#22c55e" size={64} />
          </div>
          <h3 style={{
            background: 'linear-gradient(135deg, #22c55e 0%, #06b6d4 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            fontSize: '24px', fontWeight: 700, marginBottom: '12px',
          }}>
            You're Ready to Segment!
          </h3>
          <p style={{ color: '#cbd5e1', fontSize: '14px', lineHeight: 1.6, marginBottom: '16px' }}>
            Start with <strong style={{ color: '#06b6d4' }}>Detect Ground</strong> to label the road, then paint vehicles, pedestrians, and vegetation with <strong style={{ color: '#8b5cf6' }}>Brush</strong> and <strong style={{ color: '#f59e0b' }}>Lasso</strong>.
          </p>
          <div style={{
            background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)',
            borderRadius: '14px', padding: '16px',
            border: '1px solid rgba(34, 197, 94, 0.3)', marginBottom: '16px',
          }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {[
                ['🌍','Run Detect Ground first'],
                ['🖌️','Use Brush for large areas'],
                ['🪢','Use Lasso for tight shapes'],
                ['🧹','Eraser for edge clean-up'],
                ['💾','Save before switching frames'],
                ['✅','Submit when all frames are done'],
              ].map(([e,t]) => (
                <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>{e}</span>
                  <span style={{ color: '#e2e8f0', fontSize: '13px' }}>{t}</span>
                </div>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
            <StatusPill text="Good luck!" color="#22c55e" icon="🍀" />
            <StatusPill text="Help from ?" color="#8b5cf6" icon="❓" />
          </div>
        </div>
      ),
    },
  ],
};

// =============================================================================
// TOUR REGISTRY
// =============================================================================

export const ALL_TOURS: TourDefinition[] = [
  welcomeTour,
  dataManagementTour,
  myTasksTour,
  editor3DTour,
  editor2DTour,
  segmentation3DEditorTour,
  workflowTour,
  taxonomyTour,
  dataOpsTour,
  adminTour,
  dataUploadTour,
  efficiencyTour,
  aiQualityTour,
];

export const getTourById = (id: TourId): TourDefinition | undefined => {
  return ALL_TOURS.find(tour => tour.id === id);
};

export const getToursForPath = (path: string): TourDefinition[] => {
  return ALL_TOURS.filter(tour =>
    tour.validPaths.some(validPath => path.startsWith(validPath))
  );
};

export const getToursForRole = (role: string): TourDefinition[] => {
  return ALL_TOURS.filter(tour => {
    if (!tour.requiredRole) return true;
    const allowedRoles = tour.requiredRole.split(',');
    return allowedRoles.includes(role);
  });
};

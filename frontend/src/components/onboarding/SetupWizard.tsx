import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';


export type WizardType = 'campaign_created' | 'dataset_created';

interface SetupWizardProps {
  type: WizardType;
  isOpen: boolean;
  onClose: () => void;
  resourceId: string;
  resourceName: string;
  parentId?: string;
  parentName?: string;
  onCreateDataset?: () => void;
  onUploadData?: () => void;
  onLinkTaxonomy?: () => void;
  onCreateTaxonomy?: () => void;
  onViewResource?: () => void;
}


interface StepIndicatorProps {
  steps: Array<{
    id: string;
    label: string;
    icon: string;
    isCompleted?: boolean;
    isActive?: boolean;
  }>;
  currentStep: number;
}

const StepIndicator: React.FC<StepIndicatorProps> = ({ steps, currentStep }) => (
  <div className="flex items-center justify-center gap-2 mb-8">
    {steps.map((step, index) => (
      <React.Fragment key={step.id}>
        <div
          className={`flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-300 ${
            index === currentStep
              ? 'bg-gradient-to-r from-cyan-500/20 to-purple-500/20 border border-cyan-500/50 scale-105'
              : index < currentStep
                ? 'bg-green-500/10 border border-green-500/30'
                : 'bg-slate-800/50 border border-slate-700/30'
          }`}
        >
          <span className="text-lg">
            {index < currentStep ? '✅' : step.icon}
          </span>
          <span className={`text-sm font-medium ${
            index === currentStep ? 'text-cyan-300' : index < currentStep ? 'text-green-400' : 'text-gray-500'
          }`}>
            {step.label}
          </span>
        </div>
        {index < steps.length - 1 && (
          <div className={`w-8 h-0.5 ${index < currentStep ? 'bg-green-500' : 'bg-slate-700'}`} />
        )}
      </React.Fragment>
    ))}
  </div>
);

// =============================================================================
// ACTION CARD
// =============================================================================

interface ActionCardProps {
  icon: string;
  title: string;
  description: string;
  buttonLabel: string;
  isPrimary?: boolean;
  isDisabled?: boolean;
  onClick: () => void;
  badge?: string;
}

const ActionCard: React.FC<ActionCardProps> = ({
  icon,
  title,
  description,
  buttonLabel,
  isPrimary = false,
  isDisabled = false,
  onClick,
  badge,
}) => (
  <div
    className={`relative p-5 rounded-xl border transition-all duration-300 hover:scale-[1.02] ${
      isPrimary
        ? 'bg-gradient-to-br from-cyan-500/10 to-purple-500/10 border-cyan-500/30 hover:border-cyan-400/50'
        : 'bg-slate-800/50 border-slate-700/50 hover:border-slate-600/50'
    }`}
  >
    {badge && (
      <span className="absolute -top-2 -right-2 px-2 py-0.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-[10px] font-bold rounded-full uppercase shadow-lg">
        {badge}
      </span>
    )}

    <div className="flex items-start gap-4">
      <div className={`flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center text-2xl ${
        isPrimary ? 'bg-cyan-500/20' : 'bg-slate-700/50'
      }`}>
        {icon}
      </div>

      <div className="flex-1">
        <h3 className={`font-semibold mb-1 ${isPrimary ? 'text-white' : 'text-gray-300'}`}>
          {title}
        </h3>
        <p className="text-sm text-gray-500 mb-3">
          {description}
        </p>
        <button
          onClick={onClick}
          disabled={isDisabled}
          className={`px-4 py-2 rounded-lg font-medium text-sm transition-all duration-200 ${
            isPrimary
              ? 'bg-gradient-to-r from-cyan-500 to-purple-500 text-white hover:from-cyan-400 hover:to-purple-400 shadow-lg shadow-cyan-500/20'
              : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
          } disabled:opacity-50 disabled:cursor-not-allowed`}
        >
          {buttonLabel}
        </button>
      </div>
    </div>
  </div>
);

// =============================================================================
// SUCCESS ANIMATION
// =============================================================================

const SuccessAnimation: React.FC<{ resourceType: 'campaign' | 'dataset' }> = ({ resourceType }) => {
  const [showCheck, setShowCheck] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowCheck(true), 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="relative w-20 h-20 mx-auto mb-6">
      {/* Animated rings */}
      <div className="absolute inset-0 rounded-full border-2 border-cyan-500/30 animate-ping" />
      <div className="absolute inset-2 rounded-full border-2 border-purple-500/30 animate-ping" style={{ animationDelay: '0.2s' }} />

      {/* Main circle */}
      <div className={`absolute inset-0 rounded-full bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center transition-all duration-500 ${
        showCheck ? 'scale-100 opacity-100' : 'scale-50 opacity-0'
      }`}>
        <span className="text-4xl">
          {resourceType === 'campaign' ? '📁' : '📊'}
        </span>
      </div>

      {/* Checkmark badge */}
      <div className={`absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white text-sm font-bold shadow-lg transition-all duration-500 ${
        showCheck ? 'scale-100 opacity-100' : 'scale-0 opacity-0'
      }`} style={{ transitionDelay: '0.3s' }}>
        ✓
      </div>
    </div>
  );
};

// =============================================================================
// CAMPAIGN CREATED WIZARD
// =============================================================================

const CampaignCreatedWizard: React.FC<Omit<SetupWizardProps, 'type'>> = ({
  onClose,
  resourceId,
  resourceName,
  onCreateDataset,
  onViewResource,
}) => {
  const navigate = useNavigate();

  const steps = [
    { id: 'create', label: 'Create Campaign', icon: '📁', isCompleted: true },
    { id: 'dataset', label: 'Add Dataset', icon: '📊' },
    { id: 'upload', label: 'Upload Data', icon: '📤' },
  ];

  const handleCreateDataset = () => {
    onClose();
    if (onCreateDataset) {
      onCreateDataset();
    } else {
      // Navigate to campaign page and trigger create dataset modal
      navigate(`/campaigns/${resourceId}?action=create-dataset`);
    }
  };

  const handleViewCampaign = () => {
    onClose();
    if (onViewResource) {
      onViewResource();
    } else {
      navigate(`/campaigns/${resourceId}`);
    }
  };

  const handleStartTour = () => {
    onClose();
    // Could trigger onboarding tour here
    navigate(`/campaigns/${resourceId}?tour=data_management`);
  };

  return (
    <>
      <SuccessAnimation resourceType="campaign" />

      <h2 className="text-2xl font-bold text-white text-center mb-2">
        Campaign Created! 🎉
      </h2>
      <p className="text-center text-gray-400 mb-6">
        <span className="text-cyan-400 font-semibold">"{resourceName}"</span> is ready.
        What would you like to do next?
      </p>

      <StepIndicator steps={steps} currentStep={1} />

      <div className="space-y-4">
        <ActionCard
          icon="📊"
          title="Create Your First Dataset"
          description="Datasets organize your annotation data with taxonomy and sensor configurations."
          buttonLabel="Create Dataset"
          isPrimary
          badge="Recommended"
          onClick={handleCreateDataset}
        />

        <ActionCard
          icon="📁"
          title="View Campaign Details"
          description="Explore your campaign settings and configure additional options."
          buttonLabel="View Campaign"
          onClick={handleViewCampaign}
        />

        <ActionCard
          icon="🎓"
          title="Take a Quick Tour"
          description="New to the platform? Learn how to manage data and annotations."
          buttonLabel="Start Tour"
          onClick={handleStartTour}
        />
      </div>

      <div className="mt-6 pt-4 border-t border-slate-700/50 text-center">
        <button
          onClick={onClose}
          className="text-sm text-gray-500 hover:text-gray-400 transition-colors"
        >
          Skip for now — I'll explore on my own
        </button>
      </div>
    </>
  );
};

// =============================================================================
// DATASET CREATED WIZARD
// =============================================================================

const DatasetCreatedWizard: React.FC<Omit<SetupWizardProps, 'type'>> = ({
  onClose,
  resourceId,
  resourceName,
  parentName,
  onUploadData,
  onLinkTaxonomy,
  onCreateTaxonomy,
  onViewResource,
}) => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'upload' | 'taxonomy'>('upload');

  const steps = [
    { id: 'create', label: 'Create Dataset', icon: '📊', isCompleted: true },
    { id: 'upload', label: 'Upload Data', icon: '📤' },
    { id: 'taxonomy', label: 'Configure Labels', icon: '🏷️' },
  ];

  const handleUploadData = () => {
    onClose();
    if (onUploadData) {
      onUploadData();
    } else {
      navigate(`/datasets/${resourceId}?action=upload`);
    }
  };

  const handleLinkTaxonomy = () => {
    onClose();
    if (onLinkTaxonomy) {
      onLinkTaxonomy();
    } else {
      navigate(`/datasets/${resourceId}?action=link-taxonomy`);
    }
  };

  const handleCreateTaxonomy = () => {
    onClose();
    if (onCreateTaxonomy) {
      onCreateTaxonomy();
    } else {
      navigate(`/taxonomies?action=create&dataset=${resourceId}`);
    }
  };

  const handleViewDataset = () => {
    onClose();
    if (onViewResource) {
      onViewResource();
    } else {
      navigate(`/datasets/${resourceId}`);
    }
  };

  return (
    <>
      <SuccessAnimation resourceType="dataset" />

      <h2 className="text-2xl font-bold text-white text-center mb-2">
        Dataset Created! 🎉
      </h2>
      <p className="text-center text-gray-400 mb-2">
        <span className="text-purple-400 font-semibold">"{resourceName}"</span> has been added to{' '}
        <span className="text-cyan-400">{parentName}</span>
      </p>
      <p className="text-center text-sm text-gray-500 mb-6">
        Complete these steps to start annotating
      </p>

      <StepIndicator steps={steps} currentStep={1} />

      {/* Tab Navigation */}
      <div className="flex gap-2 mb-4 p-1 bg-slate-800/50 rounded-lg">
        <button
          onClick={() => setActiveTab('upload')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'upload'
              ? 'bg-gradient-to-r from-cyan-500/20 to-cyan-500/10 text-cyan-400 border border-cyan-500/30'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          <span>📤</span>
          Upload Data
        </button>
        <button
          onClick={() => setActiveTab('taxonomy')}
          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'taxonomy'
              ? 'bg-gradient-to-r from-purple-500/20 to-purple-500/10 text-purple-400 border border-purple-500/30'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          <span>🏷️</span>
          Taxonomy
        </button>
      </div>

      {/* Upload Tab */}
      {activeTab === 'upload' && (
        <div className="space-y-4">
          <ActionCard
            icon="📤"
            title="Upload Scene Data"
            description="Import LiDAR point clouds, camera images, and annotations from your local machine or cloud storage."
            buttonLabel="Upload Data"
            isPrimary
            badge="Step 1"
            onClick={handleUploadData}
          />

          <div className="p-4 bg-slate-800/30 rounded-lg border border-slate-700/30">
            <h4 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
              <span>💡</span> Supported Formats
            </h4>
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-cyan-500 rounded-full"></span>
                LiDAR: .pcd, .bin
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                Images: .jpg, .png
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                Annotations: .json
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 bg-amber-500 rounded-full"></span>
                Calibration: .json
              </div>
            </div>
          </div>

          <p className="text-xs text-gray-500 text-center">
            🎯 Pro tip: Enable "Auto-derive taxonomy" during upload to automatically create label classes from your annotations
          </p>
        </div>
      )}

      {/* Taxonomy Tab */}
      {activeTab === 'taxonomy' && (
        <div className="space-y-4">
          <ActionCard
            icon="🔗"
            title="Link Existing Taxonomy"
            description="Use a pre-configured taxonomy from your organization's library."
            buttonLabel="Browse Taxonomies"
            isPrimary
            badge="Recommended"
            onClick={handleLinkTaxonomy}
          />

          <ActionCard
            icon="✨"
            title="Create New Taxonomy"
            description="Define custom label classes, attributes, and annotation rules."
            buttonLabel="Create Taxonomy"
            onClick={handleCreateTaxonomy}
          />

          <div className="p-4 bg-gradient-to-r from-amber-500/10 to-orange-500/10 rounded-lg border border-amber-500/30">
            <h4 className="text-sm font-medium text-amber-300 mb-2 flex items-center gap-2">
              <span>⚡</span> Quick Start
            </h4>
            <p className="text-xs text-gray-400">
              No taxonomy is created by default. Link an existing taxonomy or create a new one
              to start annotating your data.
            </p>
          </div>
        </div>
      )}

      <div className="mt-6 pt-4 border-t border-slate-700/50 flex items-center justify-between">
        <button
          onClick={handleViewDataset}
          className="text-sm text-cyan-400 hover:text-cyan-300 transition-colors flex items-center gap-1"
        >
          <span>📊</span> View Dataset
        </button>
        <button
          onClick={onClose}
          className="text-sm text-gray-500 hover:text-gray-400 transition-colors"
        >
          Continue Later
        </button>
      </div>
    </>
  );
};

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export const SetupWizard: React.FC<SetupWizardProps> = (props) => {
  const { type, isOpen, onClose } = props;

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4">
      {/* Backdrop with blur */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Animated background gradient */}
      <div
        className="absolute inset-0 opacity-20 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse at 30% 20%, rgba(6, 182, 212, 0.4), transparent 50%), radial-gradient(ellipse at 70% 80%, rgba(139, 92, 246, 0.4), transparent 50%)',
        }}
      />

      {/* Modal */}
      <div
        className="relative w-full max-w-lg bg-gradient-to-b from-slate-800/95 to-slate-900/95 rounded-2xl shadow-2xl overflow-hidden border border-slate-700/50"
        style={{
          animation: 'modalEnterBounce 0.5s cubic-bezier(0.175, 0.885, 0.32, 1.275)',
        }}
      >
        {/* Top gradient bar */}
        <div className="h-1 bg-gradient-to-r from-cyan-500 via-purple-500 to-pink-500" />

        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 w-8 h-8 rounded-full bg-slate-800 hover:bg-slate-700 text-gray-400 hover:text-white flex items-center justify-center transition-colors z-10"
        >
          ✕
        </button>

        {/* Content */}
        <div className="p-6 pt-8">
          {type === 'campaign_created' && (
            <CampaignCreatedWizard {...props} />
          )}
          {type === 'dataset_created' && (
            <DatasetCreatedWizard {...props} />
          )}
        </div>
      </div>

      {/* CSS Animations */}
      <style>{`
        @keyframes modalEnterBounce {
          0% {
            opacity: 0;
            transform: scale(0.9) translateY(20px);
          }
          50% {
            transform: scale(1.02) translateY(-5px);
          }
          100% {
            opacity: 1;
            transform: scale(1) translateY(0);
          }
        }
      `}</style>
    </div>,
    document.body
  );
};

export default SetupWizard;

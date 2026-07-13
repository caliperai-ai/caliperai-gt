import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useOnboardingStore, TipId } from '@/store/onboardingStore';


export interface TipDefinition {
  id: TipId;
  title: string;
  content: React.ReactNode;
  target: string;
  placement: 'top' | 'bottom' | 'left' | 'right';
  triggerCondition?: string;
}

export const TIPS: TipDefinition[] = [
  {
    id: 'ai_track_intro',
    title: '✨ AI-Powered Tracking',
    content: (
      <div>
        <p className="mb-2">Draw a box on any object and press <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-xs">Enter</kbd> to automatically track it across all frames!</p>
        <p className="text-xs text-slate-400">Powered by state-of-the-art object tracking AI</p>
      </div>
    ),
    target: '[data-tour="ai_track-tool-2d"]',
    placement: 'right',
  },
  {
    id: 'ai_segment_intro',
    title: '🎯 One-Click Segmentation',
    content: (
      <div>
        <p className="mb-2">Just click on any object - AI will instantly create a pixel-perfect mask!</p>
        <p className="text-xs text-slate-400">Left-click to include, right-click to exclude regions</p>
      </div>
    ),
    target: '[data-tour="semantic_segment-tool-2d"]',
    placement: 'right',
  },
  {
    id: 'track_propagation',
    title: '🔄 Track Propagation',
    content: (
      <div>
        <p className="mb-2">Your 3D track will automatically propagate as you navigate frames.</p>
        <p className="text-xs text-slate-400">Press <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-xs">K</kbd> to mark keyframes for better interpolation</p>
      </div>
    ),
    target: '[data-tour="track-tool"]',
    placement: 'right',
  },
  {
    id: 'keyboard_shortcuts',
    title: '⚡ Pro Tip: Keyboard Shortcuts',
    content: (
      <div>
        <p className="mb-2">Speed up your workflow with keyboard shortcuts!</p>
        <p className="text-xs text-slate-400">Press <kbd className="px-1.5 py-0.5 bg-slate-700 rounded text-xs">?</kbd> anytime to see all shortcuts</p>
      </div>
    ),
    target: 'body',
    placement: 'bottom',
  },
  {
    id: 'ortho_views',
    title: '📐 Precision Editing',
    content: (
      <div>
        <p className="mb-2">Use orthographic views for pixel-perfect 3D box adjustments.</p>
        <p className="text-xs text-slate-400">Drag corners to resize, handles to rotate</p>
      </div>
    ),
    target: '[data-tour="ortho-views"]',
    placement: 'left',
  },
  {
    id: 'revision_mode',
    title: '📝 Revision Feedback',
    content: (
      <div>
        <p className="mb-2">QA reviewer left feedback! Click each item to jump to the annotation.</p>
        <p className="text-xs text-slate-400">Fix all issues and resubmit for approval</p>
      </div>
    ),
    target: '[data-tour="revision-panel"]',
    placement: 'left',
  },
];


interface SpotlightTipProps {
  tip: TipDefinition;
  onDismiss: () => void;
}

export const SpotlightTip: React.FC<SpotlightTipProps> = ({ tip, onDismiss }) => {
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const tipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const targetEl = document.querySelector(tip.target);
    if (!targetEl) return;

    const rect = targetEl.getBoundingClientRect();
    setTargetRect(rect);
    const tipWidth = 300;
    const tipHeight = 140;
    const gap = 16;

    let top = 0;
    let left = 0;

    switch (tip.placement) {
      case 'top':
        top = rect.top - tipHeight - gap;
        left = rect.left + rect.width / 2 - tipWidth / 2;
        break;
      case 'bottom':
        top = rect.bottom + gap;
        left = rect.left + rect.width / 2 - tipWidth / 2;
        break;
      case 'left':
        top = rect.top + rect.height / 2 - tipHeight / 2;
        left = rect.left - tipWidth - gap;
        break;
      case 'right':
        top = rect.top + rect.height / 2 - tipHeight / 2;
        left = rect.right + gap;
        break;
    }

    top = Math.max(8, Math.min(top, window.innerHeight - tipHeight - 8));
    left = Math.max(8, Math.min(left, window.innerWidth - tipWidth - 8));

    setPosition({ top, left });

    requestAnimationFrame(() => setIsVisible(true));
  }, [tip.target, tip.placement]);

  const arrowStyles: Record<string, React.CSSProperties> = {
    top: {
      bottom: '-6px',
      left: '50%',
      transform: 'translateX(-50%) rotate(45deg)',
    },
    bottom: {
      top: '-6px',
      left: '50%',
      transform: 'translateX(-50%) rotate(45deg)',
    },
    left: {
      right: '-6px',
      top: '50%',
      transform: 'translateY(-50%) rotate(45deg)',
    },
    right: {
      left: '-6px',
      top: '50%',
      transform: 'translateY(-50%) rotate(45deg)',
    },
  };

  return createPortal(
    <>
      {/* Spotlight overlay effect on target element */}
      {targetRect && (
        <div
          className="fixed inset-0 z-[9989] pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 300px 200px at ${targetRect.left + targetRect.width/2}px ${targetRect.top + targetRect.height/2}px, transparent 0%, rgba(0,0,0,0.5) 100%)`,
          }}
        />
      )}

      {/* Pulsing ring around target */}
      {targetRect && (
        <div
          className="fixed z-[9989] pointer-events-none rounded-xl"
          style={{
            top: targetRect.top - 8,
            left: targetRect.left - 8,
            width: targetRect.width + 16,
            height: targetRect.height + 16,
            border: '2px solid transparent',
            background: 'linear-gradient(135deg, rgba(6,182,212,0.5), rgba(139,92,246,0.5), rgba(236,72,153,0.5)) border-box',
            WebkitMask: 'linear-gradient(#fff 0 0) padding-box, linear-gradient(#fff 0 0)',
            WebkitMaskComposite: 'xor',
            maskComposite: 'exclude',
            animation: 'spotlightRing 2s ease-in-out infinite',
          }}
        />
      )}

      <div
        ref={tipRef}
        className={`fixed z-[9990] w-[300px] transition-all duration-500`}
        style={{
          top: position.top,
          left: position.left,
          opacity: isVisible ? 1 : 0,
          transform: isVisible
            ? 'translateY(0) scale(1)'
            : `translateY(${tip.placement === 'bottom' ? '-10px' : '10px'}) scale(0.9)`,
        }}
      >
        {/* Tip card with enhanced styling */}
        <div className="relative bg-gradient-to-br from-slate-800/95 to-slate-900/95 rounded-xl shadow-2xl overflow-hidden backdrop-blur-sm border border-white/10">
          {/* Animated gradient border effect */}
          <div
            className="absolute inset-0 rounded-xl"
            style={{
              padding: '1px',
              background: 'linear-gradient(135deg, rgba(6,182,212,0.5), rgba(139,92,246,0.5), rgba(236,72,153,0.5))',
              backgroundSize: '200% 200%',
              animation: 'gradientBorder 3s ease infinite',
              WebkitMask: 'linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0)',
              WebkitMaskComposite: 'xor',
              maskComposite: 'exclude',
            }}
          />

          {/* Floating particles */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {[...Array(5)].map((_, i) => (
              <div
                key={i}
                className="absolute w-1 h-1 bg-cyan-400/40 rounded-full"
                style={{
                  left: `${20 + Math.random() * 60}%`,
                  bottom: '-4px',
                  animation: `particleFloat ${2 + Math.random() * 2}s ease-in-out ${Math.random() * 2}s infinite`,
                }}
              />
            ))}
          </div>

          {/* Content */}
          <div className="relative p-4">
            <div className="flex items-start justify-between gap-2 mb-2">
              <h4
                className="text-sm font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent"
                style={{ animation: 'titleGlow 2s ease-in-out infinite' }}
              >
                {tip.title}
              </h4>
            <button
              onClick={onDismiss}
              className="p-1 text-slate-400 hover:text-white hover:bg-white/10 rounded-lg transition-all hover:rotate-90 duration-300"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="text-sm text-slate-300 leading-relaxed">{tip.content}</div>
          <button
            onClick={onDismiss}
            className="mt-4 w-full py-2 text-sm font-medium text-white bg-gradient-to-r from-cyan-500 to-purple-500 hover:from-cyan-400 hover:to-purple-400 rounded-lg transition-all hover:scale-[1.02] hover:shadow-lg hover:shadow-cyan-500/20"
          >
            Got it! ✨
          </button>
        </div>

        {/* Arrow with gradient */}
        <div
          className="absolute w-3 h-3 bg-slate-800"
          style={{
            ...arrowStyles[tip.placement],
            borderWidth: tip.placement === 'top' || tip.placement === 'left' ? '0 1px 1px 0' : '1px 0 0 1px',
            borderColor: 'rgba(6,182,212,0.3)',
          }}
        />
      </div>

      {/* Animation styles */}
      <style>{`
        @keyframes spotlightRing {
          0%, 100% {
            opacity: 0.5;
            transform: scale(1);
          }
          50% {
            opacity: 1;
            transform: scale(1.05);
          }
        }
        @keyframes gradientBorder {
          0%, 100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }
        @keyframes particleFloat {
          0%, 100% {
            transform: translateY(0) scale(1);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          90% {
            opacity: 1;
          }
          100% {
            transform: translateY(-60px) scale(0.5);
            opacity: 0;
          }
        }
        @keyframes titleGlow {
          0%, 100% {
            filter: brightness(1);
          }
          50% {
            filter: brightness(1.2);
          }
        }
      `}</style>
    </div>
    </>,
    document.body
  );
};

// =============================================================================
// TIP MANAGER - Handles contextual tip display
// =============================================================================

interface TipManagerProps {
  activeTipId?: TipId | null;
}

export const TipManager: React.FC<TipManagerProps> = ({ activeTipId }) => {
  const { dismissTip, isTipDismissed } = useOnboardingStore();

  if (!activeTipId) return null;

  const tip = TIPS.find(t => t.id === activeTipId);
  if (!tip || isTipDismissed(activeTipId)) return null;

  return <SpotlightTip tip={tip} onDismiss={() => dismissTip(activeTipId)} />;
};

// =============================================================================
// HOOK TO TRIGGER TIPS CONTEXTUALLY
// =============================================================================

export const useContextualTip = (tipId: TipId, trigger: boolean) => {
  const [shouldShow, setShouldShow] = useState(false);
  const { isTipDismissed } = useOnboardingStore();

  useEffect(() => {
    if (trigger && !isTipDismissed(tipId)) {
      // Delay showing tip to let user settle
      const timeout = setTimeout(() => setShouldShow(true), 1500);
      return () => clearTimeout(timeout);
    } else {
      setShouldShow(false);
    }
  }, [trigger, tipId, isTipDismissed]);

  return shouldShow ? tipId : null;
};

export default TipManager;

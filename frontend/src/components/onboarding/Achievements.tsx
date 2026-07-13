import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import { BRAND } from '@/config/branding';
import { persist, createJSONStorage } from 'zustand/middleware';
import { Confetti } from './Confetti';


export type AchievementId =
  | 'first_login'
  | 'tour_complete'
  | 'first_annotation'
  | 'first_track'
  | 'ai_explorer'
  | 'keyboard_ninja'
  | 'speed_demon'
  | 'perfectionist'
  | 'data_architect'
  | 'qa_master'
  | 'taxonomy_wizard'
  | 'power_user';

export interface Achievement {
  id: AchievementId;
  name: string;
  description: string;
  icon: string;
  rarity: 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';
  points: number;
  secret?: boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: 'first_login',
    name: 'Fresh Start',
    description: `Welcome to ${BRAND.name}! You've taken your first step.`,
    icon: '🚀',
    rarity: 'common',
    points: 10,
  },
  {
    id: 'tour_complete',
    name: 'Quick Learner',
    description: 'Completed your first onboarding tour',
    icon: '📚',
    rarity: 'common',
    points: 20,
  },
  {
    id: 'first_annotation',
    name: 'First Stroke',
    description: 'Created your first annotation',
    icon: '✏️',
    rarity: 'common',
    points: 25,
  },
  {
    id: 'first_track',
    name: 'Time Traveler',
    description: 'Created your first object track across frames',
    icon: '🎯',
    rarity: 'uncommon',
    points: 50,
  },
  {
    id: 'ai_explorer',
    name: 'AI Explorer',
    description: 'Used an AI-powered annotation tool (AI Segment or AI Track)',
    icon: '🤖',
    rarity: 'uncommon',
    points: 50,
  },
  {
    id: 'keyboard_ninja',
    name: 'Keyboard Ninja',
    description: 'Used 10 different keyboard shortcuts',
    icon: '⌨️',
    rarity: 'rare',
    points: 75,
  },
  {
    id: 'speed_demon',
    name: 'Speed Demon',
    description: 'Annotated 100+ objects in a single session',
    icon: '⚡',
    rarity: 'rare',
    points: 100,
  },
  {
    id: 'perfectionist',
    name: 'Perfectionist',
    description: 'Had a task accepted on first submission (no revisions)',
    icon: '💎',
    rarity: 'epic',
    points: 150,
  },
  {
    id: 'data_architect',
    name: 'Data Architect',
    description: 'Created a campaign with datasets, scenes, and tasks',
    icon: '🏗️',
    rarity: 'epic',
    points: 150,
  },
  {
    id: 'qa_master',
    name: 'QA Master',
    description: 'Reviewed and approved 50+ tasks',
    icon: '🔍',
    rarity: 'epic',
    points: 200,
  },
  {
    id: 'taxonomy_wizard',
    name: 'Taxonomy Wizard',
    description: 'Created a taxonomy with 10+ classes and attributes',
    icon: '🧙',
    rarity: 'rare',
    points: 100,
  },
  {
    id: 'power_user',
    name: 'Power User',
    description: 'Unlocked 8+ other achievements',
    icon: '👑',
    rarity: 'legendary',
    points: 500,
    secret: true,
  },
];


interface AchievementState {
  unlockedAchievements: AchievementId[];
  achievementQueue: AchievementId[];
  totalPoints: number;

  unlockAchievement: (id: AchievementId) => void;
  hasAchievement: (id: AchievementId) => boolean;
  popAchievementQueue: () => AchievementId | null;
  calculateTotalPoints: () => number;
}

export const useAchievementStore = create<AchievementState>()(
  persist(
    (set, get) => ({
      unlockedAchievements: [],
      achievementQueue: [],
      totalPoints: 0,

      unlockAchievement: (id) => {
        const state = get();
        if (state.unlockedAchievements.includes(id)) return;

        const achievement = ACHIEVEMENTS.find(a => a.id === id);
        if (!achievement) return;

        const newUnlocked = [...state.unlockedAchievements, id];
        const newPoints = state.totalPoints + achievement.points;

        set({
          unlockedAchievements: newUnlocked,
          achievementQueue: [...state.achievementQueue, id],
          totalPoints: newPoints,
        });

        if (newUnlocked.length >= 8 && !newUnlocked.includes('power_user')) {
          setTimeout(() => get().unlockAchievement('power_user'), 2000);
        }
      },

      hasAchievement: (id) => get().unlockedAchievements.includes(id),

      popAchievementQueue: () => {
        const state = get();
        if (state.achievementQueue.length === 0) return null;

        const [next, ...rest] = state.achievementQueue;
        set({ achievementQueue: rest });
        return next;
      },

      calculateTotalPoints: () => {
        const state = get();
        return state.unlockedAchievements.reduce((sum, id) => {
          const achievement = ACHIEVEMENTS.find(a => a.id === id);
          return sum + (achievement?.points || 0);
        }, 0);
      },
    }),
    {
      name: 'calipergt-achievements',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        unlockedAchievements: state.unlockedAchievements,
        totalPoints: state.totalPoints,
      }),
    }
  )
);


const rarityStyles = {
  common: {
    bg: 'from-slate-600 to-slate-700',
    border: 'border-slate-500',
    glow: 'shadow-slate-500/20',
  },
  uncommon: {
    bg: 'from-emerald-600 to-teal-700',
    border: 'border-emerald-400',
    glow: 'shadow-emerald-500/30',
  },
  rare: {
    bg: 'from-blue-600 to-indigo-700',
    border: 'border-blue-400',
    glow: 'shadow-blue-500/40',
  },
  epic: {
    bg: 'from-purple-600 to-pink-700',
    border: 'border-purple-400',
    glow: 'shadow-purple-500/50',
  },
  legendary: {
    bg: 'from-amber-500 via-orange-500 to-red-500',
    border: 'border-amber-300',
    glow: 'shadow-amber-500/60',
  },
};

interface AchievementPopupProps {
  achievement: Achievement;
  onClose: () => void;
}

const AchievementPopup: React.FC<AchievementPopupProps> = ({ achievement, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const styles = rarityStyles[achievement.rarity];

  useEffect(() => {
    requestAnimationFrame(() => {
      setIsVisible(true);
      if (achievement.rarity === 'epic' || achievement.rarity === 'legendary') {
        setShowConfetti(true);
      }
    });

    const timeout = setTimeout(() => {
      setIsVisible(false);
      setTimeout(onClose, 300);
    }, 5000);

    return () => clearTimeout(timeout);
  }, [achievement, onClose]);

  return createPortal(
    <>
      <Confetti
        isActive={showConfetti}
        duration={3000}
        particleCount={achievement.rarity === 'legendary' ? 100 : 50}
        onComplete={() => setShowConfetti(false)}
      />
      <div
        className={`fixed top-20 right-4 z-[9998] transform transition-all duration-500 ${
          isVisible ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'
        }`}
      >
        <div
          className={`relative overflow-hidden rounded-xl bg-gradient-to-r ${styles.bg} border ${styles.border} shadow-2xl ${styles.glow} p-4 min-w-[300px]`}
        >
          {/* Shimmer effect */}
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent -translate-x-full animate-[shimmer_2s_infinite]" />

          {/* Header */}
          <div className="relative flex items-start gap-3">
            <div className="text-4xl">{achievement.icon}</div>
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-bold uppercase tracking-wider text-white/60">
                  Achievement Unlocked!
                </span>
                <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded ${
                  achievement.rarity === 'legendary' ? 'bg-amber-500/30 text-amber-200' :
                  achievement.rarity === 'epic' ? 'bg-purple-500/30 text-purple-200' :
                  achievement.rarity === 'rare' ? 'bg-blue-500/30 text-blue-200' :
                  achievement.rarity === 'uncommon' ? 'bg-emerald-500/30 text-emerald-200' :
                  'bg-slate-500/30 text-slate-200'
                }`}>
                  {achievement.rarity}
                </span>
              </div>
              <h3 className="text-lg font-bold text-white">{achievement.name}</h3>
              <p className="text-sm text-white/70 mt-1">{achievement.description}</p>
              <div className="flex items-center gap-1 mt-2">
                <span className="text-amber-400 font-bold">+{achievement.points}</span>
                <span className="text-xs text-white/50">points</span>
              </div>
            </div>
          </div>

          {/* Close button */}
          <button
            onClick={() => {
              setIsVisible(false);
              setTimeout(onClose, 300);
            }}
            className="absolute top-2 right-2 text-white/40 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </>,
    document.body
  );
};

// =============================================================================
// ACHIEVEMENT MANAGER - Handles Queue and Displays
// =============================================================================

interface AchievementManagerProps {
  onAchievementShown?: (achievementId: AchievementId, rarity: Achievement['rarity']) => void;
}

export const AchievementManager: React.FC<AchievementManagerProps> = ({ onAchievementShown }) => {
  const [currentAchievement, setCurrentAchievement] = useState<Achievement | null>(null);
  const { popAchievementQueue, achievementQueue } = useAchievementStore();

  useEffect(() => {
    if (achievementQueue.length > 0 && !currentAchievement) {
      const nextId = popAchievementQueue();
      if (nextId) {
        const achievement = ACHIEVEMENTS.find(a => a.id === nextId);
        if (achievement) {
          setCurrentAchievement(achievement);
          onAchievementShown?.(achievement.id, achievement.rarity);
        }
      }
    }
  }, [achievementQueue, currentAchievement, popAchievementQueue, onAchievementShown]);

  if (!currentAchievement) return null;

  return (
    <AchievementPopup
      achievement={currentAchievement}
      onClose={() => setCurrentAchievement(null)}
    />
  );
};

// =============================================================================
// ACHIEVEMENTS PANEL COMPONENT - Enhanced with animations
// =============================================================================

// Animated stat counter
const AnimatedCounter: React.FC<{ value: number; duration?: number }> = ({ value, duration = 1000 }) => {
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    let startTime: number;
    let animationFrame: number;

    const animate = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      setDisplayValue(Math.floor(progress * value));

      if (progress < 1) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationFrame);
  }, [value, duration]);

  return <span>{displayValue}</span>;
};

// How to unlock each achievement
const UNLOCK_HINTS: Record<AchievementId, string> = {
  first_login: 'Auto-unlocks on first visit',
  tour_complete: 'Complete any guided tour from the Help menu',
  first_annotation: 'Create any 2D or 3D annotation in the editor',
  first_track: 'Create a track that spans multiple frames',
  ai_explorer: 'Use AI Segment or AI Track tool',
  keyboard_ninja: 'Use 10 different keyboard shortcuts',
  speed_demon: 'Create 100+ annotations in one session',
  perfectionist: 'Submit a task that gets approved without revisions',
  data_architect: 'Create a campaign with datasets, scenes, and tasks',
  qa_master: 'Review and approve 50+ tasks as a reviewer',
  taxonomy_wizard: 'Create a taxonomy with 10+ classes',
  power_user: 'Unlock 8 other achievements first',
};

export const AchievementsPanel: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { unlockedAchievements, totalPoints, unlockAchievement } = useAchievementStore();
  const [selectedRarity, setSelectedRarity] = useState<string | null>(null);
  const [selectedAchievement, setSelectedAchievement] = useState<Achievement | null>(null);
  const [showConfetti, setShowConfetti] = useState(false);

  if (!isOpen) return null;

  const unlockedCount = unlockedAchievements.length;
  const totalCount = ACHIEVEMENTS.filter(a => !a.secret).length;
  const progress = (unlockedCount / totalCount) * 100;

  // Demo unlock function
  const handleDemoUnlock = () => {
    if (!unlockedAchievements.includes('first_login')) {
      unlockAchievement('first_login');
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
    } else if (!unlockedAchievements.includes('tour_complete')) {
      unlockAchievement('tour_complete');
      setShowConfetti(true);
      setTimeout(() => setShowConfetti(false), 3000);
    }
  };

  // Filter achievements by rarity if selected
  const filteredAchievements = ACHIEVEMENTS.filter(a => {
    if (a.secret && !unlockedAchievements.includes(a.id)) return false;
    if (selectedRarity && a.rarity !== selectedRarity) return false;
    return true;
  });

  // Count by rarity
  const rarityCounts = {
    common: ACHIEVEMENTS.filter(a => a.rarity === 'common' && !a.secret).length,
    uncommon: ACHIEVEMENTS.filter(a => a.rarity === 'uncommon' && !a.secret).length,
    rare: ACHIEVEMENTS.filter(a => a.rarity === 'rare' && !a.secret).length,
    epic: ACHIEVEMENTS.filter(a => a.rarity === 'epic' && !a.secret).length,
    legendary: ACHIEVEMENTS.filter(a => a.rarity === 'legendary').length,
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md"
      style={{ animation: 'fadeIn 0.2s ease-out' }}
    >
      {/* Animated background particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(20)].map((_, i) => (
          <div
            key={i}
            className="absolute w-2 h-2 bg-amber-400/30 rounded-full"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animation: `twinkle ${2 + Math.random() * 3}s ease-in-out ${Math.random() * 2}s infinite`,
            }}
          />
        ))}
      </div>

      <div
        className="relative w-full max-w-3xl bg-gradient-to-b from-slate-800/95 to-slate-900/95 rounded-2xl shadow-2xl overflow-hidden max-h-[85vh] flex flex-col border border-slate-700/50"
        style={{ animation: 'modalSlideUp 0.3s ease-out' }}
      >
        {/* Enhanced Header with animated background */}
        <div className="relative px-6 py-5 overflow-hidden">
          {/* Animated gradient background */}
          <div
            className="absolute inset-0"
            style={{
              background: 'linear-gradient(135deg, rgba(139, 92, 246, 0.3) 0%, rgba(236, 72, 153, 0.2) 50%, rgba(245, 158, 11, 0.3) 100%)',
              backgroundSize: '200% 200%',
              animation: 'gradientShift 8s ease infinite',
            }}
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-slate-800/90" />

          <div className="relative flex items-center justify-between">
            <div className="flex items-center gap-4">
              {/* Animated trophy */}
              <div
                className="w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-500/30 to-orange-500/30 flex items-center justify-center border border-amber-500/40"
                style={{ animation: 'trophyFloat 3s ease-in-out infinite' }}
              >
                <span className="text-4xl" style={{ filter: 'drop-shadow(0 0 10px rgba(245, 158, 11, 0.5))' }}>🏆</span>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-white flex items-center gap-2">
                  Achievements
                </h2>
                <p className="text-sm text-white/60 mt-1 flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="text-emerald-400 font-bold"><AnimatedCounter value={unlockedCount} /></span>
                    <span>of {totalCount} unlocked</span>
                  </span>
                  <span className="w-1 h-1 rounded-full bg-white/30" />
                  <span className="flex items-center gap-1 text-amber-400 font-bold">
                    <AnimatedCounter value={totalPoints} />
                    <span className="font-normal text-white/60">points</span>
                  </span>
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-white/40 hover:text-white hover:bg-white/10 rounded-lg transition-all hover:rotate-90 duration-300"
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Animated progress bar */}
          <div className="relative mt-4">
            <div className="h-3 bg-slate-700/50 rounded-full overflow-hidden">
              <div
                className="h-full relative overflow-hidden transition-all duration-1000 ease-out"
                style={{
                  width: `${progress}%`,
                  background: 'linear-gradient(90deg, #06b6d4, #8b5cf6, #ec4899)',
                }}
              >
                {/* Shimmer effect */}
                <div
                  className="absolute inset-0"
                  style={{
                    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent)',
                    animation: 'shimmerProgress 2s ease-in-out infinite',
                  }}
                />
              </div>
            </div>
            <div className="mt-1 text-xs text-white/40 text-right">{Math.round(progress)}% complete</div>
          </div>
        </div>

        {/* Rarity filter tabs */}
        <div className="px-6 py-3 border-b border-slate-700/50 flex items-center gap-2 overflow-x-auto">
          <button
            onClick={() => setSelectedRarity(null)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
              !selectedRarity
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:text-white hover:bg-white/5'
            }`}
          >
            All ({totalCount})
          </button>
          {(['common', 'uncommon', 'rare', 'epic', 'legendary'] as const).map(rarity => (
            <button
              key={rarity}
              onClick={() => setSelectedRarity(rarity === selectedRarity ? null : rarity)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex items-center gap-1.5 ${
                selectedRarity === rarity
                  ? `bg-gradient-to-r ${rarityStyles[rarity].bg} text-white`
                  : 'text-slate-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <span className={selectedRarity !== rarity ? 'opacity-60' : ''}>
                {rarity === 'common' && '⚪'}
                {rarity === 'uncommon' && '🟢'}
                {rarity === 'rare' && '🔵'}
                {rarity === 'epic' && '🟣'}
                {rarity === 'legendary' && '🟡'}
              </span>
              <span className="capitalize">{rarity}</span>
              <span className="opacity-60">({rarityCounts[rarity]})</span>
            </button>
          ))}
        </div>

        {/* Achievement grid with staggered animations */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4">
            {filteredAchievements.map((achievement, index) => {
              const isUnlocked = unlockedAchievements.includes(achievement.id);
              const styles = rarityStyles[achievement.rarity];

              return (
                <div
                  key={achievement.id}
                  onClick={() => setSelectedAchievement(achievement)}
                  className={`group relative rounded-xl p-4 transition-all duration-300 cursor-pointer overflow-hidden ${
                    isUnlocked
                      ? `bg-gradient-to-br ${styles.bg} border ${styles.border} shadow-lg hover:scale-[1.02] hover:shadow-xl`
                      : 'bg-slate-800/30 border border-slate-700/50 hover:border-slate-600 hover:bg-slate-800/50'
                  }`}
                  style={{
                    animation: `cardFadeIn 0.3s ease-out ${index * 0.05}s both`,
                    boxShadow: isUnlocked ? `0 10px 40px ${styles.glow.replace('shadow-', '').replace('/40', '')}40` : 'none',
                  }}
                >
                  {/* Hover shine effect for unlocked */}
                  {isUnlocked && (
                    <div
                      className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                      style={{
                        background: 'linear-gradient(135deg, transparent 30%, rgba(255,255,255,0.1) 50%, transparent 70%)',
                        animation: 'cardShine 2s ease-in-out infinite',
                      }}
                    />
                  )}

                  <div className="relative flex items-start gap-3">
                    {/* Icon with animation */}
                    <div
                      className={`text-4xl transition-transform duration-300 ${isUnlocked ? 'group-hover:scale-110' : 'opacity-30 grayscale'}`}
                      style={{
                        filter: isUnlocked ? 'drop-shadow(0 2px 8px rgba(0,0,0,0.3))' : 'none',
                      }}
                    >
                      {isUnlocked ? achievement.icon : '🔒'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <h3 className={`font-bold ${isUnlocked ? 'text-white' : 'text-slate-500'}`}>
                          {achievement.name}
                        </h3>
                        {/* Rarity badge */}
                        <span className={`px-2 py-0.5 text-[10px] font-bold uppercase rounded-full ${
                          isUnlocked
                            ? 'bg-white/20 text-white/80'
                            : 'bg-slate-700/50 text-slate-500'
                        }`}>
                          {achievement.rarity}
                        </span>
                        {achievement.secret && (
                          <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-amber-500/30 text-amber-300 rounded-full flex items-center gap-1">
                            <span>🔮</span> SECRET
                          </span>
                        )}
                      </div>
                      <p className={`text-xs leading-relaxed ${isUnlocked ? 'text-white/70' : 'text-slate-500'}`}>
                        {achievement.description}
                      </p>
                      {/* Points with icon */}
                      <div className="flex items-center gap-2 mt-2">
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded-full ${
                          isUnlocked ? 'bg-amber-500/20' : 'bg-slate-700/30'
                        }`}>
                          <span className="text-xs">⭐</span>
                          <span className={`text-sm font-bold ${isUnlocked ? 'text-amber-400' : 'text-slate-500'}`}>
                            {achievement.points}
                          </span>
                          <span className="text-[10px] text-slate-400">pts</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Unlocked checkmark with animation */}
                  {isUnlocked && (
                    <div
                      className="absolute top-3 right-3 w-6 h-6 bg-emerald-500 rounded-full flex items-center justify-center shadow-lg"
                      style={{ animation: 'checkPop 0.3s ease-out' }}
                    >
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                      </svg>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Empty state */}
          {filteredAchievements.length === 0 && (
            <div className="text-center py-12">
              <span className="text-5xl mb-4 block">🔍</span>
              <p className="text-slate-400">No achievements in this category</p>
            </div>
          )}
        </div>

        {/* Footer with stats */}
        <div className="px-6 py-4 border-t border-slate-700/50 bg-slate-900/50">
          <div className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-4 text-slate-400">
              {unlockedCount === 0 ? (
                <button
                  onClick={handleDemoUnlock}
                  className="px-3 py-1.5 bg-gradient-to-r from-amber-500/20 to-orange-500/20 border border-amber-500/30 text-amber-300 rounded-lg hover:from-amber-500/30 hover:to-orange-500/30 transition-all flex items-center gap-2"
                >
                  <span>🎮</span>
                  <span>Try Demo</span>
                </button>
              ) : (
                <span>Click any achievement for details</span>
              )}
            </div>
            <button
              onClick={onClose}
              className="px-4 py-2 bg-gradient-to-r from-cyan-500 to-purple-500 text-white font-medium rounded-lg hover:from-cyan-400 hover:to-purple-400 transition-all hover:scale-105"
            >
              Continue Playing
            </button>
          </div>
        </div>
      </div>

      {/* Achievement Detail Modal */}
      {selectedAchievement && (
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-10"
          onClick={() => setSelectedAchievement(null)}
        >
          <div
            className="bg-slate-800 rounded-2xl p-6 max-w-sm mx-4 shadow-2xl border border-slate-700"
            onClick={e => e.stopPropagation()}
            style={{ animation: 'modalSlideUp 0.2s ease-out' }}
          >
            <div className="text-center">
              <div className="text-6xl mb-4" style={{ animation: 'trophyFloat 2s ease-in-out infinite' }}>
                {unlockedAchievements.includes(selectedAchievement.id) ? selectedAchievement.icon : '🔒'}
              </div>
              <h3 className="text-xl font-bold text-white mb-2">{selectedAchievement.name}</h3>
              <span className={`inline-block px-3 py-1 text-xs font-bold uppercase rounded-full mb-3 ${
                rarityStyles[selectedAchievement.rarity].bg
              } ${rarityStyles[selectedAchievement.rarity].border}`}>
                {selectedAchievement.rarity}
              </span>
              <p className="text-slate-300 mb-4">{selectedAchievement.description}</p>

              {/* How to unlock */}
              {!unlockedAchievements.includes(selectedAchievement.id) && (
                <div className="bg-slate-700/50 rounded-lg p-3 mb-4">
                  <p className="text-xs text-slate-400 uppercase font-bold mb-1">How to unlock</p>
                  <p className="text-sm text-cyan-400">{UNLOCK_HINTS[selectedAchievement.id]}</p>
                </div>
              )}

              <div className="flex items-center justify-center gap-2 text-amber-400">
                <span className="text-2xl">⭐</span>
                <span className="text-2xl font-bold">{selectedAchievement.points}</span>
                <span className="text-slate-400">points</span>
              </div>

              <button
                onClick={() => setSelectedAchievement(null)}
                className="mt-4 w-full py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg transition-colors"
              >
                Got it!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confetti for demo */}
      <Confetti isActive={showConfetti} onComplete={() => setShowConfetti(false)} />

      {/* Animation styles */}
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modalSlideUp {
          from {
            opacity: 0;
            transform: translateY(30px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes gradientShift {
          0%, 100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }
        @keyframes trophyFloat {
          0%, 100% {
            transform: translateY(0) rotate(-2deg);
          }
          50% {
            transform: translateY(-5px) rotate(2deg);
          }
        }
        @keyframes shimmerProgress {
          0% {
            transform: translateX(-100%);
          }
          100% {
            transform: translateX(100%);
          }
        }
        @keyframes cardFadeIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
        @keyframes cardShine {
          0%, 100% {
            transform: translateX(-100%) rotate(45deg);
          }
          50% {
            transform: translateX(100%) rotate(45deg);
          }
        }
        @keyframes checkPop {
          0% {
            transform: scale(0);
          }
          50% {
            transform: scale(1.2);
          }
          100% {
            transform: scale(1);
          }
        }
        @keyframes twinkle {
          0%, 100% {
            opacity: 0;
            transform: scale(0);
          }
          50% {
            opacity: 1;
            transform: scale(1);
          }
        }
      `}</style>
    </div>,
    document.body
  );
};

export default AchievementManager;

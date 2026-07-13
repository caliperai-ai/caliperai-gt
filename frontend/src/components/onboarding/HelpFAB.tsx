import React, { useState, useRef, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useOnboardingStore, TourId } from '@/store/onboardingStore';
import { BRAND } from '@/config/branding';
import { getToursForPath, ALL_TOURS } from '@/constants/onboardingTours';
import { useAuthStore } from '@/store/authStore';
import { useAchievementStore, ACHIEVEMENTS } from './Achievements';
import { useChatStore } from '@/store/chatStore';

interface HelpFABProps {
  onShowKeyboardShortcuts?: () => void;
  onShowAchievements?: () => void;
}

export const HelpFAB: React.FC<HelpFABProps> = ({ onShowKeyboardShortcuts, onShowAchievements }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showAllTours, setShowAllTours] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const { startTour, completedTours, isHelpMenuOpen, setHelpMenuOpen } = useOnboardingStore();
  const { unlockedAchievements, totalPoints } = useAchievementStore();
  const { user } = useAuthStore();
  const { openChat, status: chatStatus } = useChatStore();

  const availableTours = getToursForPath(location.pathname).filter(tour => {
    if (!tour.requiredRole) return true;
    if (!user?.role) return false;
    const allowedRoles = tour.requiredRole.split(',');
    return allowedRoles.includes(user.role);
  });

  useEffect(() => {
    setIsOpen(isHelpMenuOpen);
  }, [isHelpMenuOpen]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHelpMenuOpen(false);
        setShowAllTours(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setHelpMenuOpen]);

  const handleToggle = () => {
    const newState = !isOpen;
    setIsOpen(newState);
    setHelpMenuOpen(newState);
    if (!newState) setShowAllTours(false);
  };

  const handleStartTour = (tourId: TourId) => {
    setIsOpen(false);
    setHelpMenuOpen(false);
    setShowAllTours(false);
    startTour(tourId);
  };

  const handleKeyboardShortcuts = () => {
    setIsOpen(false);
    setHelpMenuOpen(false);
    onShowKeyboardShortcuts?.();
  };

  return (
    <div
      ref={menuRef}
      className="fixed bottom-6 right-6 z-50"
      style={{ fontFamily: 'Inter, system-ui, sans-serif' }}
    >
      {/* Menu Panel */}
      {isOpen && (
        <div
          className="absolute bottom-16 right-0 w-80 bg-gradient-to-b from-slate-800/98 to-slate-900/98 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden backdrop-blur-lg"
          style={{ animation: 'slideUpBounce 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)' }}
        >
          {/* Animated Header with gradient */}
          <div className="relative px-4 py-4 overflow-hidden">
            {/* Animated background */}
            <div
              className="absolute inset-0 opacity-40"
              style={{
                background: 'linear-gradient(135deg, #06b6d4 0%, #8b5cf6 50%, #ec4899 100%)',
                backgroundSize: '200% 200%',
                animation: 'gradientFlow 5s ease infinite',
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-b from-transparent to-slate-800/90" />

            <div className="relative flex items-center gap-3">
              {/* Animated help icon */}
              <div
                className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center"
                style={{ animation: 'iconPulse 2s ease-in-out infinite' }}
              >
                <span className="text-xl">✨</span>
              </div>
              <div>
                <h3 className="text-white font-bold text-lg">Help Center</h3>
                <p className="text-white/60 text-xs">Learn, explore & master {BRAND.name}</p>
              </div>
            </div>
          </div>

          {/* Menu Items with hover effects - SCROLLABLE */}
          <div className="py-2 px-2 max-h-[calc(100vh-280px)] overflow-y-auto"
               style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(100,116,139,0.5) transparent' }}>
            {/* AI Assistant - Top option */}
            <button
              onClick={() => {
                setIsOpen(false);
                setHelpMenuOpen(false);
                openChat();
              }}
              className="group w-full px-3 py-3 flex items-center gap-3 text-left text-slate-300 hover:bg-gradient-to-r hover:from-cyan-500/10 hover:to-purple-500/10 rounded-xl transition-all duration-200 mb-1"
            >
              <div
                className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center transition-transform group-hover:scale-110"
              >
                <span className="text-xl">🤖</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold group-hover:text-white transition-colors">AI Assistant</div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>Ask questions, get help</span>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <div className={`w-2 h-2 rounded-full ${chatStatus === 'online' ? 'bg-green-400' : chatStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' : 'bg-slate-500'}`} />
                <span className="text-xs text-slate-500">{chatStatus === 'online' ? 'Online' : chatStatus === 'connecting' ? 'Connecting' : 'Offline'}</span>
              </div>
            </button>

            {/* Achievements */}
            <button
              onClick={() => {
                setIsOpen(false);
                setHelpMenuOpen(false);
                onShowAchievements?.();
              }}
              className="group w-full px-3 py-3 flex items-center gap-3 text-left text-slate-300 hover:bg-gradient-to-r hover:from-amber-500/10 hover:to-transparent rounded-xl transition-all duration-200 mb-1"
            >
              <div
                className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-500/20 to-orange-500/20 flex items-center justify-center transition-transform group-hover:scale-110"
                style={{ animation: 'trophyBounce 2s ease-in-out infinite' }}
              >
                <span className="text-xl">🏆</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold group-hover:text-white transition-colors">Achievements</div>
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <span>{unlockedAchievements.length}/{ACHIEVEMENTS.filter(a => !a.secret).length} unlocked</span>
                  <span className="text-amber-400">•</span>
                  <span className="text-amber-400 font-medium">{totalPoints} pts</span>
                </div>
              </div>
              {unlockedAchievements.length > 0 && (
                <div
                  className="relative px-2.5 py-1 bg-gradient-to-r from-amber-500/30 to-orange-500/30 rounded-full text-xs text-amber-300 font-bold"
                  style={{ animation: 'badgePulse 2s ease-in-out infinite' }}
                >
                  {unlockedAchievements.length}
                  <div className="absolute inset-0 rounded-full bg-amber-400/20 animate-ping" />
                </div>
              )}
            </button>

            {/* Divider with gradient */}
            <div className="my-2 mx-2 h-px bg-gradient-to-r from-transparent via-slate-600 to-transparent" />

            {/* Keyboard Shortcuts - Enhanced */}
            <button
              onClick={handleKeyboardShortcuts}
              className="group w-full px-3 py-3 flex items-center gap-3 text-left text-slate-300 hover:bg-gradient-to-r hover:from-slate-700/50 hover:to-transparent rounded-xl transition-all duration-200"
            >
              <div className="w-10 h-10 rounded-xl bg-slate-700/50 group-hover:bg-amber-500/20 flex items-center justify-center transition-colors duration-200">
                <span className="text-xl group-hover:scale-110 transition-transform">⌨️</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold group-hover:text-white transition-colors">Keyboard Shortcuts</div>
                <div className="text-xs text-slate-500">Master the hotkeys</div>
              </div>
              <kbd className="px-2 py-1 bg-slate-700/50 rounded text-xs text-slate-400 group-hover:bg-cyan-500/20 group-hover:text-cyan-400 transition-colors">?</kbd>
            </button>

            {/* Divider with gradient */}
            <div className="my-2 mx-2 h-px bg-gradient-to-r from-transparent via-slate-600 to-transparent" />

            {/* Page Tours Section - Enhanced */}
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                <span className="text-base">🎯</span>
                Guided Tours
              </div>
            </div>

            {availableTours.length > 0 ? (
              availableTours.map((tour, index) => {
                const isCompleted = completedTours.includes(tour.id);
                return (
                  <button
                    key={tour.id}
                    onClick={() => handleStartTour(tour.id)}
                    className="group w-full px-3 py-2.5 flex items-center gap-3 text-left text-slate-300 hover:bg-gradient-to-r hover:from-slate-700/50 hover:to-transparent rounded-xl transition-all duration-200"
                    style={{ animation: `itemSlideIn 0.2s ease-out ${index * 0.05}s both` }}
                  >
                    <div className={`w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-300 ${
                      isCompleted
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-cyan-500/20 text-cyan-400 group-hover:scale-110'
                    }`}>
                      {isCompleted ? (
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg className="w-4 h-4 group-hover:animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium group-hover:text-white transition-colors truncate">{tour.name}</div>
                      <div className="text-xs text-slate-500 truncate">{tour.description}</div>
                    </div>
                    {isCompleted ? (
                      <span className="px-2 py-0.5 bg-green-500/10 rounded-full text-xs text-green-400 font-medium">✓</span>
                    ) : (
                      <span className="px-2 py-0.5 bg-cyan-500/10 rounded-full text-xs text-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity">Start</span>
                    )}
                  </button>
                );
              })
            ) : (
              <div className="px-4 py-3 text-sm text-slate-500 italic flex items-center gap-2">
                <span>📭</span>
                No tours available for this page
              </div>
            )}

            {/* Show All Tours Toggle - Enhanced */}
            <button
              onClick={() => setShowAllTours(!showAllTours)}
              className="w-full px-3 py-2 flex items-center gap-2 text-xs text-slate-500 hover:text-cyan-400 transition-colors rounded-lg"
            >
              <svg
                className={`w-4 h-4 transition-transform duration-200 ${showAllTours ? 'rotate-90' : ''}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              {showAllTours ? 'Hide all tours' : 'Browse all tours'}
              <span className="ml-auto px-1.5 py-0.5 bg-slate-700/50 rounded text-[10px]">{ALL_TOURS.length}</span>
            </button>

            {/* All Tours List - Enhanced */}
            {showAllTours && (
              <div
                className="mt-1 mb-2 mx-2 p-2 bg-slate-900/70 rounded-xl max-h-48 overflow-y-auto border border-slate-700/50"
                style={{ animation: 'expandIn 0.2s ease-out' }}
              >
                {ALL_TOURS.map((tour, index) => {
                  const isCompleted = completedTours.includes(tour.id);
                  return (
                    <button
                      key={tour.id}
                      onClick={() => handleStartTour(tour.id)}
                      className="group w-full px-2 py-1.5 flex items-center gap-2 text-left text-xs text-slate-400 hover:text-white hover:bg-slate-700/30 rounded-lg transition-all duration-150"
                      style={{ animation: `itemFadeIn 0.15s ease-out ${index * 0.03}s both` }}
                    >
                      {isCompleted ? (
                        <span className="text-green-400">✓</span>
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-600 group-hover:bg-cyan-400 transition-colors" />
                      )}
                      <span className="truncate">{tour.name}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {/* Divider with gradient */}
            <div className="my-2 mx-2 h-px bg-gradient-to-r from-transparent via-slate-600 to-transparent" />

            {/* Quick Documentation Section */}
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-400 uppercase tracking-wider">
                <span className="text-base">📖</span>
                Quick Docs
              </div>
            </div>

            {/* 2D Annotation Tools Guide Button */}
            <button
              onClick={() => handleStartTour('editor_2d' as TourId)}
              className="group w-full px-3 py-2.5 flex items-center gap-3 text-left text-slate-300 hover:bg-gradient-to-r hover:from-cyan-500/10 hover:to-transparent rounded-xl transition-all duration-200"
            >
              <div className="w-8 h-8 rounded-lg bg-cyan-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <svg className="w-5 h-5 text-cyan-400" viewBox="0 0 24 24" fill="none">
                  <rect x="4" y="4" width="16" height="16" rx="2" stroke="currentColor" strokeWidth={2} />
                  <path d="M8 12l2 2 4-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium group-hover:text-white transition-colors">2D Annotation Guide</div>
                <div className="text-xs text-slate-500 truncate">Draw shapes, AI tools, timer unlock & shortcuts</div>
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="px-1.5 py-0.5 bg-cyan-500/20 rounded text-[10px] text-cyan-400 font-medium">10 steps</span>
              </div>
            </button>

            {/* DataOps Documentation Button */}
            <button
              onClick={() => handleStartTour('dataops' as TourId)}
              className="group w-full px-3 py-2.5 flex items-center gap-3 text-left text-slate-300 hover:bg-gradient-to-r hover:from-purple-500/10 hover:to-transparent rounded-xl transition-all duration-200"
            >
              <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <span className="text-lg">📊</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium group-hover:text-white transition-colors">DataOps Guide</div>
                <div className="text-xs text-slate-500 truncate">History, snapshots & version control</div>
              </div>
            </button>

            {/* Taxonomy Documentation Button */}
            <button
              onClick={() => handleStartTour('taxonomy' as TourId)}
              className="group w-full px-3 py-2.5 flex items-center gap-3 text-left text-slate-300 hover:bg-gradient-to-r hover:from-amber-500/10 hover:to-transparent rounded-xl transition-all duration-200"
            >
              <div className="w-8 h-8 rounded-lg bg-amber-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <span className="text-lg">🏷️</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium group-hover:text-white transition-colors">Taxonomy Guide</div>
                <div className="text-xs text-slate-500 truncate">Classes, attributes & configuration</div>
              </div>
            </button>

            {/* AI Quality Checks Tour Button */}
            <button
              onClick={() => handleStartTour('ai_quality' as TourId)}
              className="group w-full px-3 py-2.5 flex items-center gap-3 text-left text-slate-300 hover:bg-gradient-to-r hover:from-indigo-500/10 hover:to-transparent rounded-xl transition-all duration-200"
            >
              <div className="w-8 h-8 rounded-lg bg-indigo-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <span className="text-lg">🤖</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium group-hover:text-white transition-colors">AI Quality Checks</div>
                <div className="text-xs text-slate-500 truncate">24 automated 3D checks explained</div>
              </div>
            </button>

            {/* Divider with gradient */}
            <div className="my-2 mx-2 h-px bg-gradient-to-r from-transparent via-slate-600 to-transparent" />

            {/* Documentation Link - Enhanced */}
            <button
              onClick={() => {
                window.open('/api/docs', '_blank');
                setIsOpen(false);
              }}
              className="group w-full px-3 py-3 flex items-center gap-3 text-left text-slate-300 hover:bg-gradient-to-r hover:from-blue-500/10 hover:to-transparent rounded-xl transition-all duration-200"
            >
              <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                <span className="text-xl">📚</span>
              </div>
              <div className="flex-1">
                <div className="text-sm font-semibold group-hover:text-white transition-colors">API Documentation</div>
                <div className="text-xs text-slate-500">Explore the full API</div>
              </div>
              <svg className="w-4 h-4 text-slate-600 group-hover:text-blue-400 group-hover:translate-x-1 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
            </button>
          </div>

          {/* Enhanced Footer with progress */}
          <div className="px-4 py-3 bg-gradient-to-r from-slate-900/80 to-slate-800/80 border-t border-slate-700/50">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span>Progress</span>
                <div className="w-20 h-1.5 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-cyan-500 to-purple-500 transition-all duration-500"
                    style={{ width: `${(completedTours.length / ALL_TOURS.length) * 100}%` }}
                  />
                </div>
                <span className="text-cyan-400 font-medium">{completedTours.length}/{ALL_TOURS.length}</span>
              </div>
              <div className="text-xs text-slate-500">
                v1.0
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Enhanced FAB Button with animated ring */}
      <div className="relative">
        <button
          onClick={handleToggle}
          className={`
            relative w-14 h-14 rounded-full shadow-lg
            flex items-center justify-center
            transition-all duration-300
            ${isOpen
              ? 'bg-slate-700 text-white scale-90'
              : 'bg-gradient-to-br from-cyan-500 via-cyan-600 to-purple-600 text-white hover:scale-110'
            }
          `}
          style={{
            boxShadow: isOpen
              ? '0 4px 20px rgba(0, 0, 0, 0.4)'
              : '0 4px 30px rgba(6, 182, 212, 0.5), 0 0 0 0 rgba(6, 182, 212, 0.4)'
          }}
        >
          {/* Rotating gradient ring when not open */}
          {!isOpen && (
            <div
              className="absolute -inset-1 rounded-full opacity-50"
              style={{
                background: 'linear-gradient(90deg, #06b6d4, #8b5cf6, #ec4899, #06b6d4)',
                backgroundSize: '300% 100%',
                animation: 'ringRotate 3s linear infinite',
                filter: 'blur(3px)',
              }}
            />
          )}

          <span
            className="relative transition-transform duration-300"
            style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
          >
            {isOpen ? (
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <span className="text-xl">❓</span>
            )}
          </span>
        </button>

        {/* Notification badge for new users */}
        {completedTours.length === 0 && !isOpen && (
          <span className="absolute -top-1 -right-1 flex h-5 w-5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
            <span className="relative inline-flex items-center justify-center rounded-full h-5 w-5 bg-gradient-to-r from-pink-500 to-rose-500 text-[10px] font-bold text-white shadow-lg">
              !
            </span>
          </span>
        )}
      </div>

      {/* Enhanced CSS Animations */}
      <style>{`
        @keyframes slideUpBounce {
          from {
            opacity: 0;
            transform: translateY(20px) scale(0.95);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes gradientFlow {
          0%, 100% {
            background-position: 0% 50%;
          }
          50% {
            background-position: 100% 50%;
          }
        }
        @keyframes iconPulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.1);
          }
        }
        @keyframes itemSlideIn {
          from {
            opacity: 0;
            transform: translateX(-10px);
          }
          to {
            opacity: 1;
            transform: translateX(0);
          }
        }
        @keyframes itemFadeIn {
          from {
            opacity: 0;
          }
          to {
            opacity: 1;
          }
        }
        @keyframes expandIn {
          from {
            opacity: 0;
            max-height: 0;
          }
          to {
            opacity: 1;
            max-height: 200px;
          }
        }
        @keyframes trophyBounce {
          0%, 100% {
            transform: translateY(0) rotate(0deg);
          }
          25% {
            transform: translateY(-2px) rotate(-5deg);
          }
          75% {
            transform: translateY(-2px) rotate(5deg);
          }
        }
        @keyframes badgePulse {
          0%, 100% {
            transform: scale(1);
          }
          50% {
            transform: scale(1.1);
          }
        }
        @keyframes ringRotate {
          0% {
            background-position: 0% 50%;
          }
          100% {
            background-position: 300% 50%;
          }
        }
      `}</style>
    </div>
  );
};

export default HelpFAB;

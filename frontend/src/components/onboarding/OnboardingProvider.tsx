import React, { useEffect, useState, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { useOnboardingStore, TourId } from '@/store/onboardingStore';
import { useAuthStore } from '@/store/authStore';
import { getToursForPath } from '@/constants/onboardingTours';
import { GuidedTour } from './GuidedTour';
import { HelpFAB } from './HelpFAB';
import { WelcomeModal } from './WelcomeModal';
import { AchievementManager, AchievementsPanel, useAchievementStore } from './Achievements';
import { TipManager } from './SpotlightTips';
import { Confetti } from './Confetti';
import { ChatPanel } from '@/components/chat';
import { FeatureGate } from '@/components/FeatureGate';

interface OnboardingProviderProps {
  children: React.ReactNode;
  onShowKeyboardShortcuts?: () => void;
  disableWelcomeModal?: boolean;
  disableAutoStart?: boolean;
  disableHelpFAB?: boolean;
  disableAchievements?: boolean;
  disableTips?: boolean;
}

export const OnboardingProvider: React.FC<OnboardingProviderProps> = ({
  children,
  onShowKeyboardShortcuts,
  disableWelcomeModal = false,
  disableAutoStart = false,
  disableHelpFAB = false,
  disableAchievements = false,
  disableTips = false,
}) => {
  const location = useLocation();
  const { isAuthenticated, user } = useAuthStore();
  const {
    firstLoginAt,
    showWelcomeModal,
    setShowWelcomeModal,
    completedTours,
    activeTourId,
    isTourRunning,
    startTour,
  } = useOnboardingStore();
  const { unlockAchievement } = useAchievementStore();

  const [currentTourId, setCurrentTourId] = useState<TourId | null>(null);
  const [showAchievementsPanel, setShowAchievementsPanel] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);

  const isFirstTimeUser = !firstLoginAt && isAuthenticated;

  useEffect(() => {
    if (isFirstTimeUser && !disableWelcomeModal && !showWelcomeModal) {
      const timer = setTimeout(() => {
        setShowWelcomeModal(true);
      }, 1000);
      return () => clearTimeout(timer);
    }
  }, [isFirstTimeUser, disableWelcomeModal, showWelcomeModal, setShowWelcomeModal]);

  useEffect(() => {
    if (isFirstTimeUser && !disableAchievements) {
      const timer = setTimeout(() => {
        unlockAchievement('first_login');
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isFirstTimeUser, disableAchievements, unlockAchievement]);

  useEffect(() => {
    if (disableAutoStart || !isAuthenticated || isTourRunning || showWelcomeModal) {
      return;
    }

    const availableTours = getToursForPath(location.pathname).filter(tour => {
      if (tour.requiredRole) {
        const allowedRoles = tour.requiredRole.split(',');
        if (!user?.role || !allowedRoles.includes(user.role)) {
          return false;
        }
      }
      return tour.autoStart && !completedTours.includes(tour.id);
    });

    if (availableTours.length > 0) {
      const tourToStart = availableTours[0];
      setCurrentTourId(tourToStart.id);
      const timer = setTimeout(() => {
        startTour(tourToStart.id);
      }, 800);
      return () => clearTimeout(timer);
    }
  }, [location.pathname, isAuthenticated, completedTours, isTourRunning, showWelcomeModal, user?.role, disableAutoStart, startTour]);

  useEffect(() => {
    if (activeTourId) {
      setCurrentTourId(activeTourId);
    }
  }, [activeTourId]);

  const handleWelcomeClose = useCallback(() => {
    setShowWelcomeModal(false);
  }, [setShowWelcomeModal]);

  const handleWelcomeStartTour = useCallback(() => {
    setShowWelcomeModal(false);
    startTour('welcome');
  }, [setShowWelcomeModal, startTour]);

  const handleShowAchievements = useCallback(() => {
    setShowAchievementsPanel(true);
  }, []);

  const handleAchievementUnlocked = useCallback((_achievementId: string, rarity: string) => {
    if (rarity === 'legendary' || rarity === 'epic') {
      setShowConfetti(true);
    }
  }, []);

  if (!isAuthenticated) {
    return <>{children}</>;
  }

  return (
    <>
      {children}

      {/* Confetti celebration effect */}
      <Confetti
        isActive={showConfetti}
        onComplete={() => setShowConfetti(false)}
        particleCount={100}
      />

      {/* Welcome Modal */}
      {showWelcomeModal && !disableWelcomeModal && (
        <WelcomeModal
          onClose={handleWelcomeClose}
          onStartTour={handleWelcomeStartTour}
        />
      )}

      {/* Guided Tour */}
      {currentTourId && (
        <GuidedTour
          tourId={currentTourId}
          autoStart={false}
        />
      )}

      {/* Achievement Manager - handles popup queue */}
      {!disableAchievements && (
        <AchievementManager onAchievementShown={handleAchievementUnlocked} />
      )}

      {/* Achievements Panel - full view of all achievements */}
      {showAchievementsPanel && (
        <AchievementsPanel
          isOpen={showAchievementsPanel}
          onClose={() => setShowAchievementsPanel(false)}
        />
      )}

      {/* Contextual Tips Manager */}
      {!disableTips && (
        <TipManager />
      )}

      {/* Help FAB */}
      {!disableHelpFAB && (
        <HelpFAB
          onShowKeyboardShortcuts={onShowKeyboardShortcuts}
          onShowAchievements={handleShowAchievements}
        />
      )}

      {/* AI Chat Panel */}
      <FeatureGate feature="chat">
        <ChatPanel />
      </FeatureGate>
    </>
  );
};

export default OnboardingProvider;

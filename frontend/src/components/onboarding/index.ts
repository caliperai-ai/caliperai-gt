export { GuidedTour } from './GuidedTour';
export { HelpFAB } from './HelpFAB';
export { WelcomeModal } from './WelcomeModal';
export { OnboardingProvider } from './OnboardingProvider';
export { Confetti } from './Confetti';
export { SetupWizard } from './SetupWizard';
export { GettingStartedCard, SetupProgressBanner } from './GettingStartedCard';
export type { WizardType } from './SetupWizard';
export type { GettingStartedStep } from './GettingStartedCard';
export {
  AchievementManager,
  AchievementsPanel,
  useAchievementStore,
  ACHIEVEMENTS
} from './Achievements';
export { TipManager, SpotlightTip, useContextualTip, TIPS } from './SpotlightTips';

export type { TourId, TipId, FeatureId } from '@/store/onboardingStore';
export type { AchievementId, Achievement } from './Achievements';

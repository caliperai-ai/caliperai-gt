import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';


export type TourId =
  | 'welcome'
  | 'data_management'
  | 'data_upload'
  | 'my_tasks'
  | 'editor_3d'
  | 'editor_2d'
  | 'segmentation_3d_editor'
  | 'workflow'
  | 'taxonomy'
  | 'dataops'
  | 'admin'
  | 'efficiency'
  | 'ai_quality'
  | 'rbac';

export type TipId =
  | 'ai_track_intro'
  | 'ai_segment_intro'
  | 'track_propagation'
  | 'keyboard_shortcuts'
  | 'ortho_views'
  | 'revision_mode';

export type FeatureId =
  | 'ai_segmentation'
  | 'ai_tracking'
  | 'track_3d'
  | 'spline_interpolation'
  | 'qa_review'
  | 'taxonomy_editor';

export interface OnboardingState {
  completedTours: TourId[];
  dismissedTips: TipId[];
  discoveredFeatures: FeatureId[];
  firstLoginAt: string | null;
  lastTourAt: string | null;

  activeTourId: TourId | null;
  tourStepIndex: number;
  isTourRunning: boolean;

  isHelpMenuOpen: boolean;
  showWelcomeModal: boolean;

  startTour: (tourId: TourId) => void;
  completeTour: (tourId: TourId) => void;
  skipTour: (tourId: TourId) => void;
  setTourStep: (index: number) => void;
  stopTour: () => void;

  dismissTip: (tipId: TipId) => void;
  discoverFeature: (featureId: FeatureId) => void;

  setHelpMenuOpen: (open: boolean) => void;
  setShowWelcomeModal: (show: boolean) => void;

  hasTourCompleted: (tourId: TourId) => boolean;
  isTipDismissed: (tipId: TipId) => boolean;
  hasDiscoveredFeature: (featureId: FeatureId) => boolean;
  isFirstLogin: () => boolean;
  shouldShowTour: (tourId: TourId) => boolean;

  resetOnboarding: () => void;
}


export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set, get) => ({
      completedTours: [],
      dismissedTips: [],
      discoveredFeatures: [],
      firstLoginAt: null,
      lastTourAt: null,

      activeTourId: null,
      tourStepIndex: 0,
      isTourRunning: false,

      isHelpMenuOpen: false,
      showWelcomeModal: false,

      startTour: (tourId) => {
        const state = get();
        const updates: Partial<OnboardingState> = {
          activeTourId: tourId,
          tourStepIndex: 0,
          isTourRunning: true,
          isHelpMenuOpen: false,
        };

        if (!state.firstLoginAt) {
          updates.firstLoginAt = new Date().toISOString();
        }

        set(updates as OnboardingState);
      },

      completeTour: (tourId) => {
        const state = get();
        if (!state.completedTours.includes(tourId)) {
          set({
            completedTours: [...state.completedTours, tourId],
            lastTourAt: new Date().toISOString(),
            activeTourId: null,
            tourStepIndex: 0,
            isTourRunning: false,
          });
        } else {
          set({
            activeTourId: null,
            tourStepIndex: 0,
            isTourRunning: false,
          });
        }
      },

      skipTour: (tourId) => {
        const state = get();
        if (!state.completedTours.includes(tourId)) {
          set({
            completedTours: [...state.completedTours, tourId],
            activeTourId: null,
            tourStepIndex: 0,
            isTourRunning: false,
          });
        } else {
          set({
            activeTourId: null,
            tourStepIndex: 0,
            isTourRunning: false,
          });
        }
      },

      setTourStep: (index) => {
        set({ tourStepIndex: index });
      },

      stopTour: () => {
        set({
          activeTourId: null,
          tourStepIndex: 0,
          isTourRunning: false,
        });
      },

      dismissTip: (tipId) => {
        const state = get();
        if (!state.dismissedTips.includes(tipId)) {
          set({ dismissedTips: [...state.dismissedTips, tipId] });
        }
      },

      discoverFeature: (featureId) => {
        const state = get();
        if (!state.discoveredFeatures.includes(featureId)) {
          set({ discoveredFeatures: [...state.discoveredFeatures, featureId] });
        }
      },

      setHelpMenuOpen: (open) => {
        set({ isHelpMenuOpen: open });
      },

      setShowWelcomeModal: (show) => {
        set({ showWelcomeModal: show });
      },

      hasTourCompleted: (tourId) => {
        return get().completedTours.includes(tourId);
      },

      isTipDismissed: (tipId) => {
        return get().dismissedTips.includes(tipId);
      },

      hasDiscoveredFeature: (featureId) => {
        return get().discoveredFeatures.includes(featureId);
      },

      isFirstLogin: () => {
        return get().firstLoginAt === null;
      },

      shouldShowTour: (tourId) => {
        const state = get();
        return !state.completedTours.includes(tourId) && !state.isTourRunning;
      },

      resetOnboarding: () => {
        set({
          completedTours: [],
          dismissedTips: [],
          discoveredFeatures: [],
          firstLoginAt: null,
          lastTourAt: null,
          activeTourId: null,
          tourStepIndex: 0,
          isTourRunning: false,
          isHelpMenuOpen: false,
          showWelcomeModal: false,
        });
      },
    }),
    {
      name: 'calipergt-onboarding',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        completedTours: state.completedTours,
        dismissedTips: state.dismissedTips,
        discoveredFeatures: state.discoveredFeatures,
        firstLoginAt: state.firstLoginAt,
        lastTourAt: state.lastTourAt,
      }),
    }
  )
);


export const useShouldAutoStartTour = (tourId: TourId): boolean => {
  const { completedTours, isTourRunning, firstLoginAt } = useOnboardingStore();

  if (completedTours.includes(tourId) || isTourRunning) {
    return false;
  }

  if (tourId === 'welcome' && !firstLoginAt) {
    return true;
  }

  return completedTours.includes('welcome');
};

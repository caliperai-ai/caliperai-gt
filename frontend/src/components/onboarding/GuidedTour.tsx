import React, { useCallback, useEffect } from 'react';
import Joyride, { CallBackProps, STATUS, EVENTS, ACTIONS, Step, Placement } from 'react-joyride';
import { useOnboardingStore, TourId } from '@/store/onboardingStore';
import { getTourById } from '@/constants/onboardingTours';

interface GuidedTourProps {
  tourId: TourId;
  autoStart?: boolean;
}

export const GuidedTour: React.FC<GuidedTourProps> = ({ tourId, autoStart = false }) => {
  const {
    activeTourId,
    tourStepIndex,
    isTourRunning,
    completedTours,
    startTour,
    completeTour,
    skipTour,
    setTourStep,
    stopTour,
  } = useOnboardingStore();

  const tour = getTourById(tourId);
  const isThisTourRunning = activeTourId === tourId && isTourRunning;
  const [hasTimerControl, setHasTimerControl] = React.useState(false);

  useEffect(() => {
    if ((tourId !== 'editor_2d' && tourId !== 'editor_3d' && tourId !== 'segmentation_3d_editor') || typeof document === 'undefined') {
      return;
    }

    const checkTimerControl = () => {
      setHasTimerControl(!!document.querySelector('[data-tour="timer-control"]'));
    };

    checkTimerControl();

    const observer = new MutationObserver(() => {
      checkTimerControl();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
    });

    return () => {
      observer.disconnect();
    };
  }, [tourId, isThisTourRunning, tourStepIndex]);

  const resolvedSteps = React.useMemo<Step[]>(() => {
    if (!tour) {
      return [];
    }

    if (tourId !== 'editor_2d' && tourId !== 'editor_3d' && tourId !== 'segmentation_3d_editor') {
      return tour.steps;
    }

    if (hasTimerControl) {
      return tour.steps;
    }

    const isSegmentation = tourId === 'segmentation_3d_editor';
    const is3D = tourId === 'editor_3d';
    const lockedToolsText = is3D
      ? 'Inside the task, 3D Box and Track tools stay locked until the timer starts'
      : isSegmentation
        ? 'Inside the task, painting tools stay available once you open an active task'
        : 'Inside the task, AI and shape tools stay locked until the timer starts';

    const timerStepIndex = isSegmentation ? tour.steps.length - 2 : tour.steps.length - 1;
    return tour.steps.map((step, index) => {
      if (index !== timerStepIndex) {
        return step;
      }

      return {
        ...step,
        target: 'body',
        placement: 'center' as Placement,
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
              <div style={{
                width: '42px',
                height: '42px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
              }}>⏱️</div>
              <div>
                <h3 style={{ color: '#fbbf24', margin: 0, fontSize: '19px' }}>Timer Unlocks Annotation Tools</h3>
                <p style={{ color: '#94a3b8', margin: '2px 0 0 0', fontSize: '12px' }}>
                  When you open a task, start the timer before using drawing tools
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
                    {lockedToolsText}
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>▶️</span>
                  <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                    Use the play button in the task header to begin timing your annotation session
                  </span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '18px' }}>✅</span>
                  <span style={{ color: '#e2e8f0', fontSize: '13px' }}>
                    Once the timer is running, the tools unlock immediately
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
                Tip: This guide is showing the general rule here because you are not inside an active task.
              </span>
            </div>
          </div>
        ),
      };
    });
  }, [hasTimerControl, tour, tourId]);

  useEffect(() => {
    if (autoStart && !completedTours.includes(tourId) && !isTourRunning) {
      const timer = setTimeout(() => {
        startTour(tourId);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [autoStart, completedTours, isTourRunning, tourId, startTour]);

  const handleJoyrideCallback = useCallback((data: CallBackProps) => {
    const { status, action, index, type } = data;

    if (type === EVENTS.TARGET_NOT_FOUND) {
      console.warn(`[Tour ${tourId}] Target not found for step ${index}:`, tour?.steps[index]?.target);
    }

    // Update step index - only advance on STEP_AFTER, not TARGET_NOT_FOUND
    // This prevents the tour from rapidly skipping through all steps
    if (type === EVENTS.STEP_AFTER) {
      setTourStep(index + (action === ACTIONS.PREV ? -1 : 1));
    }

    // Handle tour completion
    if (status === STATUS.FINISHED) {
      completeTour(tourId);
    } else if (status === STATUS.SKIPPED) {
      skipTour(tourId);
    }

    // Handle close button
    if (action === ACTIONS.CLOSE) {
      stopTour();
    }
  }, [tourId, tour?.steps, completeTour, skipTour, setTourStep, stopTour]);

  if (!tour) {
    console.warn(`Tour not found: ${tourId}`);
    return null;
  }

  return (
    <Joyride
      steps={resolvedSteps}
      run={isThisTourRunning}
      stepIndex={tourStepIndex}
      callback={handleJoyrideCallback}
      continuous
      showProgress
      showSkipButton
      scrollToFirstStep
      spotlightClicks
      disableOverlayClose
      disableScrollParentFix
      debug={process.env.NODE_ENV === 'development'}
      locale={{
        back: 'Back',
        close: 'Close',
        last: 'Finish',
        next: 'Next',
        skip: 'Skip Tour',
      }}
      styles={{
        options: {
          zIndex: 10000,
          primaryColor: '#06b6d4',
          backgroundColor: '#1e293b',
          textColor: '#e2e8f0',
          arrowColor: '#1e293b',
          overlayColor: 'rgba(0, 0, 0, 0.7)',
        },
        spotlight: {
          borderRadius: '8px',
        },
        tooltip: {
          borderRadius: '12px',
          padding: 0,
        },
        tooltipContainer: {
          textAlign: 'left',
        },
        buttonNext: {
          backgroundColor: '#06b6d4',
          borderRadius: '8px',
          padding: '10px 20px',
          fontSize: '14px',
          fontWeight: 500,
        },
        buttonBack: {
          color: '#94a3b8',
          marginRight: '8px',
        },
        buttonSkip: {
          color: '#64748b',
          fontSize: '13px',
        },
        buttonClose: {
          color: '#94a3b8',
        },
      }}
      floaterProps={{
        styles: {
          floater: {
            filter: 'drop-shadow(0 10px 25px rgba(0, 0, 0, 0.5))',
          },
        },
      }}
    />
  );
};

export default GuidedTour;


export type FeatureKey = 'pm_dashboard' | 'chat';

declare global {
  interface Window {
    __FEATURES__?: Partial<Record<FeatureKey, boolean>>;
  }
}

const DEFAULTS: Record<FeatureKey, boolean> = {
  pm_dashboard: true,
  chat: true,
};

const runtime =
  (typeof window !== 'undefined' && window.__FEATURES__) || {};

export const FEATURES: Record<FeatureKey, boolean> = {
  ...DEFAULTS,
  ...runtime,
};

export function isFeatureEnabled(key: FeatureKey): boolean {
  return FEATURES[key] !== false;
}

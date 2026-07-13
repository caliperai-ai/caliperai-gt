import { isFeatureEnabled, type FeatureKey } from '@/config/features';

export function useFeature(key: FeatureKey): boolean {
  return isFeatureEnabled(key);
}

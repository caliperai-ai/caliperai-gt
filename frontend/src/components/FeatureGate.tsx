import type { ReactNode } from 'react';
import { isFeatureEnabled, type FeatureKey } from '@/config/features';

interface FeatureGateProps {
  feature: FeatureKey;
  children: ReactNode;
  fallback?: ReactNode;
}

export function FeatureGate({ feature, children, fallback = null }: FeatureGateProps) {
  return <>{isFeatureEnabled(feature) ? children : fallback}</>;
}

export default FeatureGate;

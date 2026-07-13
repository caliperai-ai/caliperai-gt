import React from 'react';
import { GlobalActivityProvider } from '@/providers/GlobalActivityProvider';
import { useIsAuthenticated } from '@/store/authStore';

interface AuthenticatedActivityTrackerProps {
  children: React.ReactNode;
}

export const AuthenticatedActivityTracker: React.FC<AuthenticatedActivityTrackerProps> = ({
  children,
}) => {
  const isAuthenticated = useIsAuthenticated();

  return (
    <GlobalActivityProvider enabled={isAuthenticated}>
      {children}
    </GlobalActivityProvider>
  );
};

export default AuthenticatedActivityTracker;

import { useEffect, useState } from 'react';
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import { authApiClient } from '@/api/auth';

const ERROR_MESSAGES: Record<string, string> = {
  code_exchange_failed: 'Failed to complete sign-in. Please try again.',
  account_inactive: 'Your account has been deactivated. Contact your administrator.',
  access_denied: 'Access was denied by the identity provider.',
};

export function SSOCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const setAuth = useAuthStore((s) => s.setAuth);

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ssoError = searchParams.get('sso_error');
    if (ssoError) {
      setError(ERROR_MESSAGES[ssoError] ?? 'SSO sign-in failed. Please try again.');
      return;
    }

    const accessToken = searchParams.get('access_token');

    if (!accessToken) {
      setError('No token received from identity provider.');
      return;
    }

    window.history.replaceState({}, document.title, location.pathname);

    authApiClient
      .me(accessToken)
      .then((user) => {
        setAuth(user, accessToken, '');
        navigate('/', { replace: true });
      })
      .catch(() => {
        setError('Failed to fetch user profile after SSO sign-in.');
      });
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center">
        <div className="bg-gray-800/60 backdrop-blur-xl rounded-2xl p-8 max-w-md w-full mx-4 border border-gray-700/30 text-center">
          <div className="w-14 h-14 rounded-xl bg-red-500/10 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">SSO Sign-in Failed</h2>
          <p className="text-gray-400 text-sm mb-6">{error}</p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="w-full py-3 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 transition-all"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-950 via-gray-900 to-gray-950 flex items-center justify-center">
      <div className="text-center">
        <svg className="animate-spin h-10 w-10 text-cyan-400 mx-auto mb-4" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
        <p className="text-gray-400 text-sm">Completing sign-in…</p>
      </div>
    </div>
  );
}

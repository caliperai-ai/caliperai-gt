import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { USER_ROLE_LABELS } from '@/types/auth';
import { BRAND } from '@/config/branding';

export function UnauthorizedPage() {
  const navigate = useNavigate();
  const { user, logout } = useAuth();

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        {/* Logo */}
        <div className="flex items-center justify-center gap-3 mb-6">
          {BRAND.showLogo && <img src="/logo.svg?v=2" alt={BRAND.name} className="h-12 w-auto" />}
          <span className="text-2xl font-bold bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-500 bg-clip-text text-transparent">
            {BRAND.name}
          </span>
        </div>

        {/* Icon */}
        <div className="mx-auto w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mb-6">
          <svg
            className="w-8 h-8 text-red-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        </div>

        {/* Title */}
        <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
        <p className="text-gray-400 mb-6">
          You don't have permission to access this page.
        </p>

        {/* User Info */}
        {user && (
          <div className="bg-gray-800 rounded-lg p-4 mb-6 text-left">
            <p className="text-sm text-gray-400">Signed in as:</p>
            <p className="text-white font-medium">{user.full_name || user.username}</p>
            <p className="text-sm text-gray-500">{user.email}</p>
            <p className="text-sm text-blue-400 mt-1">
              Role: {USER_ROLE_LABELS[user.role] || user.role} (raw: {user.role})
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col gap-3">
          <button
            onClick={() => navigate(-1)}
            className="w-full px-4 py-2 bg-gray-700 text-white rounded-md hover:bg-gray-600 transition-colors"
          >
            Go Back
          </button>
          <button
            onClick={() => navigate('/')}
            className="w-full px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Go to Dashboard
          </button>
          <button
            onClick={logout}
            className="w-full px-4 py-2 text-gray-400 hover:text-white transition-colors"
          >
            Sign out and use a different account
          </button>
        </div>
      </div>
    </div>
  );
}

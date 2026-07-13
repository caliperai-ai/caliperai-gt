import { Link } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { AppLayout } from '@/components/layout';
import { USER_ROLE_LABELS } from '@/types/auth';

export function ProfilePage() {
  const { user } = useAuth();

  if (!user) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center py-24">
          <div className="text-gray-400">Loading user info...</div>
        </div>
      </AppLayout>
    );
  }

  const headerContent = (
    <nav className="flex items-center gap-2 text-sm">
      <Link to="/" className="text-gray-400 hover:text-white transition-colors">Home</Link>
      <svg className="w-4 h-4 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
      <span className="text-white font-medium">My Profile</span>
    </nav>
  );

  return (
    <AppLayout headerContent={headerContent}>
      <div className="max-w-3xl mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold text-white mb-6">My Profile</h1>

        {/* Profile Card */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6 mb-6">
          <div className="flex items-start gap-6">
            {/* Avatar */}
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-2xl font-bold">
              {(user.full_name || user.username || 'U').charAt(0).toUpperCase()}
            </div>

            {/* Info */}
            <div className="flex-1">
              <h2 className="text-xl font-semibold text-white">
                {user.full_name || user.username}
              </h2>
              <p className="text-gray-400">@{user.username}</p>
              <div className="mt-2">
                <span className={`px-2 py-1 text-xs rounded border ${
                  user.role === 'admin'
                    ? 'bg-red-500/20 text-red-400 border-red-500/50'
                    : user.role === 'project_manager'
                    ? 'bg-blue-500/20 text-blue-400 border-blue-500/50'
                    : 'bg-green-500/20 text-green-400 border-green-500/50'
                }`}>
                  {USER_ROLE_LABELS[user.role] || user.role}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="bg-gray-800 rounded-lg border border-gray-700 p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Account Details</h3>

          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-400">Email</label>
                <p className="text-white">{user.email}</p>
              </div>
              <div>
                <label className="text-sm text-gray-400">Username</label>
                <p className="text-white">@{user.username}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-400">Full Name</label>
                <p className="text-white">{user.full_name || <span className="text-gray-500 italic">Not set</span>}</p>
              </div>
              <div>
                <label className="text-sm text-gray-400">Role</label>
                <p className="text-white">{USER_ROLE_LABELS[user.role] || user.role}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-sm text-gray-400">Account Status</label>
                <p className={user.is_active ? 'text-green-400' : 'text-red-400'}>
                  {user.is_active ? 'Active' : 'Inactive'}
                </p>
              </div>
              <div>
                <label className="text-sm text-gray-400">Superuser</label>
                <p className="text-white">{user.is_superuser ? 'Yes' : 'No'}</p>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-6 border-t border-gray-700">
            <p className="text-sm text-gray-400">
              To change your password, use the "Change Password" option in the user menu (top right corner).
            </p>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}

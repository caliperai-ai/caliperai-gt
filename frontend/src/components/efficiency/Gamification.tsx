import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  efficiencyApi,
  Achievement,
  CreateChallengeRequest,
} from '@/api/client';
import { useCurrentOrganizationId } from '@/store/organizationStore';
import {
  Trophy,
  Medal,
  Flame,
  Star,
  Target,
  TrendingUp,
  Crown,
  Users,
  Clock,
  X,
  Plus,
  Pencil,
  Trash2,
} from 'lucide-react';


interface AchievementBadgeProps {
  achievement: Achievement;
  size?: 'sm' | 'md' | 'lg';
  showTooltip?: boolean;
  onClick?: () => void;
}

export const AchievementBadge: React.FC<AchievementBadgeProps> = ({
  achievement,
  size = 'md',
  showTooltip = true,
  onClick,
}) => {
  const sizeClasses = {
    sm: 'w-8 h-8 text-lg',
    md: 'w-12 h-12 text-2xl',
    lg: 'w-16 h-16 text-3xl',
  };

  return (
    <div className="relative group">
      <button
        className={`
          ${sizeClasses[size]}
          rounded-full bg-gradient-to-br from-yellow-500/20 to-orange-500/20
          border-2 border-yellow-500/50
          flex items-center justify-center
          hover:scale-110 transition-transform cursor-pointer
          ${!achievement.is_seen ? 'animate-pulse ring-2 ring-yellow-500 ring-offset-2 ring-offset-gray-900' : ''}
        `}
        onClick={onClick}
      >
        <span>{achievement.icon}</span>
      </button>

      {/* Tooltip */}
      {showTooltip && (
        <div className="
          absolute bottom-full left-1/2 -translate-x-1/2 mb-2
          px-3 py-2 rounded-lg bg-gray-800 border border-gray-700
          opacity-0 group-hover:opacity-100 transition-opacity
          pointer-events-none whitespace-nowrap z-50
          min-w-max
        ">
          <div className="text-sm font-medium text-white">{achievement.title}</div>
          <div className="text-xs text-gray-400 mt-0.5">{achievement.description}</div>
          <div className="text-xs text-yellow-500 mt-1">
            {new Date(achievement.earned_at).toLocaleDateString()}
          </div>
        </div>
      )}
    </div>
  );
};

interface AchievementsPanelProps {
  className?: string;
}

export const AchievementsPanel: React.FC<AchievementsPanelProps> = ({ className = '' }) => {
  const queryClient = useQueryClient();

  const { data: achievements = [], isLoading } = useQuery({
    queryKey: ['my-achievements'],
    queryFn: () => efficiencyApi.getMyAchievements(),
  });

  const markSeenMutation = useMutation({
    mutationFn: efficiencyApi.markAchievementSeen,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-achievements'] });
    },
  });

  const unseenCount = achievements.filter(a => !a.is_seen).length;

  const handleAchievementClick = (achievement: Achievement) => {
    if (!achievement.is_seen) {
      markSeenMutation.mutate(achievement.id);
    }
  };

  if (isLoading) {
    return (
      <div className={`bg-dark-surface rounded-xl border border-gray-700 p-4 ${className}`}>
        <div className="animate-pulse space-y-3">
          <div className="h-6 bg-gray-700 rounded w-1/3"></div>
          <div className="flex gap-2">
            {[1, 2, 3].map(i => (
              <div key={i} className="w-12 h-12 bg-gray-700 rounded-full"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-dark-surface rounded-xl border border-gray-700 p-4 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Trophy className="w-5 h-5 text-yellow-500" />
          <h3 className="text-lg font-semibold text-white">Achievements</h3>
        </div>
        {unseenCount > 0 && (
          <span className="px-2 py-0.5 rounded-full bg-yellow-500 text-black text-xs font-bold">
            {unseenCount} new
          </span>
        )}
      </div>

      {achievements.length === 0 ? (
        <div className="text-center py-6 text-gray-500">
          <Trophy className="w-10 h-10 mx-auto mb-2 opacity-50" />
          <p className="text-sm">Complete tasks to earn achievements!</p>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          {achievements.map(achievement => (
            <AchievementBadge
              key={achievement.id}
              achievement={achievement}
              onClick={() => handleAchievementClick(achievement)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// ACHIEVEMENT NOTIFICATION TOAST
// =============================================================================

interface AchievementToastProps {
  achievement: Achievement;
  onClose: () => void;
}

export const AchievementToast: React.FC<AchievementToastProps> = ({
  achievement,
  onClose,
}) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 5000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="
      fixed bottom-4 right-4 z-50
      animate-slide-up
      bg-gradient-to-r from-yellow-500/20 to-orange-500/20
      border border-yellow-500/50 rounded-xl p-4
      shadow-lg shadow-yellow-500/20
      max-w-sm
    ">
      <button
        onClick={onClose}
        className="absolute top-2 right-2 text-gray-400 hover:text-white"
      >
        <X className="w-4 h-4" />
      </button>

      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-yellow-500/30 flex items-center justify-center text-3xl">
          {achievement.icon}
        </div>
        <div>
          <div className="text-yellow-500 text-xs font-medium uppercase tracking-wider">
            Achievement Unlocked!
          </div>
          <div className="text-white font-bold text-lg">{achievement.title}</div>
          <div className="text-gray-400 text-sm">{achievement.description}</div>
        </div>
      </div>
    </div>
  );
};

// =============================================================================
// LEADERBOARD
// =============================================================================

interface LeaderboardProps {
  className?: string;
}

export const Leaderboard: React.FC<LeaderboardProps> = ({ className = '' }) => {
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('week');
  const orgId = useCurrentOrganizationId();

  const { data: entries = [], isLoading } = useQuery({
    queryKey: ['leaderboard', period, orgId],
    queryFn: () => efficiencyApi.getLeaderboard({
      organizationId: orgId || undefined,
      period,
      limit: 10,
    }),
    staleTime: 60 * 1000, // refresh at most once per minute
    refetchOnWindowFocus: false,
  });

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Crown className="w-5 h-5 text-yellow-500" />;
      case 2:
        return <Medal className="w-5 h-5 text-gray-300" />;
      case 3:
        return <Medal className="w-5 h-5 text-orange-400" />;
      default:
        return <span className="text-gray-500 font-medium">{rank}</span>;
    }
  };

  const formatTime = (seconds: number): string => {
    if (!seconds || seconds <= 0) return '—';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    return `${Math.round(seconds / 60)}m`;
  };

  return (
    <div className={`bg-dark-surface rounded-xl border border-gray-700 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
        <div className="flex items-center gap-1.5">
          <TrendingUp className="w-4 h-4 text-blue-500" />
          <h3 className="text-sm font-semibold text-white">Leaderboard</h3>
        </div>

        {/* Period Selector */}
        <div className="flex gap-0.5 bg-gray-800/80 rounded-md p-0.5">
          {(['today', 'week', 'month'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`
                px-2 py-0.5 rounded text-xs font-medium transition-colors whitespace-nowrap
                ${period === p
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-400 hover:text-white'}
              `}
            >
              {p.charAt(0).toUpperCase() + p.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Entries */}
      <div className="divide-y divide-gray-700/50">
        {isLoading ? (
          [...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 animate-pulse">
              <div className="w-8 h-8 bg-gray-700 rounded-full"></div>
              <div className="flex-1">
                <div className="h-4 bg-gray-700 rounded w-1/3"></div>
              </div>
              <div className="h-4 bg-gray-700 rounded w-16"></div>
            </div>
          ))
        ) : entries.length === 0 ? (
          <div className="p-8 text-center text-gray-500">
            <Users className="w-10 h-10 mx-auto mb-2 opacity-50" />
            <p>No activity this {period}</p>
          </div>
        ) : (
          entries.map((entry, index) => (
            <div
              key={entry.user_id}
              className={`flex items-center gap-3 px-4 py-3 hover:bg-gray-800/50 transition-colors ${
                index < 3 ? 'bg-gradient-to-r from-transparent via-yellow-500/5 to-transparent' : ''
              }`}
            >
              {/* Rank */}
              <div className="w-6 flex items-center justify-center shrink-0">
                {getRankIcon(entry.rank)}
              </div>

              {/* User Info */}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-white truncate">
                  {entry.display_name}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="flex items-center gap-0.5 text-xs text-gray-500">
                    <Clock className="w-3 h-3" />
                    {formatTime(entry.avg_time_per_label_seconds)}/label
                  </span>
                </div>
              </div>

              {/* Stats */}
              <div className="shrink-0 text-right">
                <span className="font-bold text-white text-base">{entry.labels_count}</span>
                <span className="text-xs text-gray-500 ml-1">labels</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};

// =============================================================================
// TEAM CHALLENGES
// =============================================================================

interface TeamChallengesProps {
  className?: string;
}

export const TeamChallenges: React.FC<TeamChallengesProps> = ({ className = '' }) => {
  const orgId = useCurrentOrganizationId();
  const queryClient = useQueryClient();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingChallenge, setEditingChallenge] = useState<string | null>(null);
  const [newChallenge, setNewChallenge] = useState<Partial<CreateChallengeRequest>>({
    title: '',
    description: '',
    goal_type: 'labels',
    target_value: 1000,
    start_date: new Date().toISOString().split('T')[0],
    end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
  });

  const { data: challenges = [], isLoading } = useQuery({
    queryKey: ['team-challenges', orgId],
    queryFn: () => efficiencyApi.getChallenges({
      organizationId: orgId || undefined,
      includeCompleted: false,
    }),
  });

  const createChallengeMutation = useMutation({
    mutationFn: (request: CreateChallengeRequest) => efficiencyApi.createChallenge(request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-challenges'] });
      setShowCreateModal(false);
      resetForm();
    },
    onError: (error) => {
      console.error('[CreateChallenge] Error:', error);
      alert('Failed to create challenge.');
    },
  });

  const updateChallengeMutation = useMutation({
    mutationFn: ({ id, request }: { id: string; request: CreateChallengeRequest }) =>
      efficiencyApi.updateChallenge(id, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-challenges'] });
      setShowCreateModal(false);
      setEditingChallenge(null);
      resetForm();
    },
    onError: (error) => {
      console.error('[UpdateChallenge] Error:', error);
      alert('Failed to update challenge.');
    },
  });

  const deleteChallengeMutation = useMutation({
    mutationFn: (id: string) => efficiencyApi.deleteChallenge(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['team-challenges'] });
    },
    onError: (error) => {
      console.error('[DeleteChallenge] Error:', error);
      alert('Failed to delete challenge.');
    },
  });

  const resetForm = () => {
    setNewChallenge({
      title: '',
      description: '',
      goal_type: 'labels',
      target_value: 1000,
      start_date: new Date().toISOString().split('T')[0],
      end_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
    });
  };

  const handleEditChallenge = (challenge: typeof challenges[0]) => {
    setEditingChallenge(challenge.id);
    setNewChallenge({
      title: challenge.title,
      description: challenge.description || '',
      goal_type: challenge.goal_type,
      target_value: challenge.target_value,
      start_date: new Date(challenge.start_date).toISOString().split('T')[0],
      end_date: new Date(challenge.end_date).toISOString().split('T')[0],
    });
    setShowCreateModal(true);
  };

  const handleDeleteChallenge = (id: string) => {
    if (confirm('Are you sure you want to delete this challenge?')) {
      deleteChallengeMutation.mutate(id);
    }
  };

  const handleSaveChallenge = () => {
    if (!newChallenge.title || !newChallenge.target_value) return;

    const payload = {
      title: newChallenge.title,
      description: newChallenge.description || undefined,
      goal_type: newChallenge.goal_type || 'labels',
      target_value: newChallenge.target_value,
      start_date: new Date(newChallenge.start_date!).toISOString(),
      end_date: new Date(newChallenge.end_date!).toISOString(),
      organization_id: orgId || undefined,
    };

    if (editingChallenge) {
      updateChallengeMutation.mutate({ id: editingChallenge, request: payload });
    } else {
      createChallengeMutation.mutate(payload);
    }
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setEditingChallenge(null);
    resetForm();
  };

  const formatTimeRemaining = (endDate: string): string => {
    const end = new Date(endDate);
    const now = new Date();
    const diff = end.getTime() - now.getTime();

    if (diff < 0) return 'Ended';

    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

    if (days > 0) return `${days}d ${hours}h left`;
    return `${hours}h left`;
  };

  if (isLoading) {
    return (
      <div className={`bg-dark-surface rounded-xl border border-gray-700 p-4 ${className}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-700 rounded w-1/3"></div>
          <div className="h-24 bg-gray-700 rounded"></div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-dark-surface rounded-xl border border-gray-700 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <h3 className="font-semibold text-white flex items-center gap-2">
          <Target className="w-5 h-5 text-purple-500" />
          My Challenges
        </h3>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors text-sm"
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      </div>

      {/* Content */}
      {challenges.length === 0 ? (
        <div className="p-6 text-center">
          <Target className="w-10 h-10 mx-auto mb-2 text-gray-500 opacity-50" />
          <p className="text-gray-500">No active challenges</p>
        </div>
      ) : (
        <div className="divide-y divide-gray-700">
          {challenges.map(challenge => (
            <div key={challenge.id} className="p-4">
              {/* Challenge Header */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h4 className="font-semibold text-white">{challenge.title}</h4>
                  {challenge.description && (
                    <p className="text-sm text-gray-400 mt-0.5">{challenge.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-gray-500">{formatTimeRemaining(challenge.end_date)}</span>
                  <button
                    onClick={() => handleEditChallenge(challenge)}
                    className="p-1 hover:bg-gray-700 rounded transition-colors"
                    title="Edit"
                  >
                    <Pencil className="w-4 h-4 text-gray-400 hover:text-white" />
                  </button>
                  <button
                    onClick={() => handleDeleteChallenge(challenge.id)}
                    className="p-1 hover:bg-gray-700 rounded transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4 text-gray-400 hover:text-red-500" />
                  </button>
                </div>
              </div>

              {/* Progress */}
              <div className="flex items-center justify-between mb-1 text-sm">
                <span className="text-gray-400">Team Progress</span>
                <span className="text-white">{Math.round(challenge.current_value)} / {challenge.target_value}</span>
              </div>
              <div className="h-3 bg-gray-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-500 to-pink-500 transition-all duration-500"
                  style={{ width: `${Math.min(challenge.progress_percentage, 100)}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1 text-xs text-gray-500">
                <span>{challenge.participant_count} participants</span>
                <span>{Math.round(challenge.progress_percentage)}%</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Challenge Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-gray-900 rounded-xl border border-gray-600 w-full max-w-md p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                <Target className="w-5 h-5 text-purple-500" />
                {editingChallenge ? 'Edit Challenge' : 'Create Team Challenge'}
              </h3>
              <button
                onClick={handleCloseModal}
                className="p-1 hover:bg-gray-700 rounded transition-colors"
              >
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>

            <div className="space-y-4">
              {/* Title */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Title</label>
                <input
                  type="text"
                  value={newChallenge.title}
                  onChange={(e) => setNewChallenge(prev => ({ ...prev, title: e.target.value }))}
                  placeholder="e.g., Spring Labeling Sprint"
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Description (optional)</label>
                <textarea
                  value={newChallenge.description}
                  onChange={(e) => setNewChallenge(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="What's this challenge about?"
                  rows={2}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white placeholder-gray-500 focus:outline-none focus:border-purple-500 resize-none"
                />
              </div>

              {/* Goal Type */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">Goal Type</label>
                <select
                  value={newChallenge.goal_type}
                  onChange={(e) => setNewChallenge(prev => ({ ...prev, goal_type: e.target.value }))}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                >
                  <option value="labels">Total Labels</option>
                  <option value="accuracy">Average Accuracy</option>
                  <option value="time">Total Active Hours</option>
                </select>
              </div>

              {/* Target Value */}
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Target {newChallenge.goal_type === 'labels' ? '(labels)' : newChallenge.goal_type === 'accuracy' ? '(%)' : '(hours)'}
                </label>
                <input
                  type="number"
                  value={newChallenge.target_value}
                  onChange={(e) => setNewChallenge(prev => ({ ...prev, target_value: parseInt(e.target.value) || 0 }))}
                  min={1}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>

              {/* Date Range */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Start Date</label>
                  <input
                    type="date"
                    value={newChallenge.start_date}
                    onChange={(e) => setNewChallenge(prev => ({ ...prev, start_date: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">End Date</label>
                  <input
                    type="date"
                    value={newChallenge.end_date}
                    onChange={(e) => setNewChallenge(prev => ({ ...prev, end_date: e.target.value }))}
                    className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-purple-500"
                  />
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={handleCloseModal}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveChallenge}
                disabled={!newChallenge.title || !newChallenge.target_value || createChallengeMutation.isPending || updateChallengeMutation.isPending}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                {createChallengeMutation.isPending || updateChallengeMutation.isPending
                  ? 'Saving...'
                  : editingChallenge ? 'Save Changes' : 'Create Challenge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// STREAK INDICATOR
// =============================================================================

interface StreakIndicatorProps {
  streakDays: number;
  className?: string;
}

export const StreakIndicator: React.FC<StreakIndicatorProps> = ({
  streakDays,
  className = '',
}) => {
  if (streakDays === 0) return null;

  const getStreakColor = (days: number) => {
    if (days >= 30) return 'from-purple-500 to-pink-500';
    if (days >= 14) return 'from-orange-500 to-red-500';
    if (days >= 7) return 'from-yellow-500 to-orange-500';
    return 'from-yellow-500/80 to-yellow-600';
  };

  return (
    <div className={`
      inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
      bg-gradient-to-r ${getStreakColor(streakDays)}
      text-white font-medium text-sm
      ${className}
    `}>
      <Flame className="w-4 h-4" />
      <span>{streakDays} day streak</span>
      {streakDays >= 7 && <Star className="w-4 h-4" />}
    </div>
  );
};

export default {
  AchievementBadge,
  AchievementsPanel,
  AchievementToast,
  Leaderboard,
  TeamChallenges,
  StreakIndicator,
};

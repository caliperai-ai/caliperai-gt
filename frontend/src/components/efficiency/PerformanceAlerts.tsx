import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { efficiencyApi, PerformanceAlert } from '@/api/client';
import { useCurrentOrganizationId } from '@/store/organizationStore';
import {
  AlertTriangle,
  AlertCircle,
  Info,
  Bell,
  CheckCircle2,
  Clock,
  TrendingDown,
  User,
  ChevronRight,
  X,
  Filter,
} from 'lucide-react';


interface AlertBadgeProps {
  count: number;
  className?: string;
}

export const AlertBadge: React.FC<AlertBadgeProps> = ({ count, className = '' }) => {
  if (count === 0) return null;

  return (
    <span className={`
      inline-flex items-center justify-center
      min-w-5 h-5 px-1.5 rounded-full
      bg-red-500 text-white text-xs font-bold
      ${className}
    `}>
      {count > 99 ? '99+' : count}
    </span>
  );
};

// =============================================================================
// ALERT ITEM
// =============================================================================

interface AlertItemProps {
  alert: PerformanceAlert;
  onAcknowledge?: () => void;
  onClick?: () => void;
}

const getSeverityStyles = (severity: string) => {
  switch (severity) {
    case 'critical':
      return {
        bg: 'bg-red-500/10',
        border: 'border-red-500/30',
        icon: AlertTriangle,
        iconColor: 'text-red-500',
      };
    case 'warning':
      return {
        bg: 'bg-yellow-500/10',
        border: 'border-yellow-500/30',
        icon: AlertCircle,
        iconColor: 'text-yellow-500',
      };
    default:
      return {
        bg: 'bg-blue-500/10',
        border: 'border-blue-500/30',
        icon: Info,
        iconColor: 'text-blue-500',
      };
  }
};

const getAlertTypeIcon = (alertType: string) => {
  switch (alertType) {
    case 'velocity_drop':
      return TrendingDown;
    case 'task_overdue':
    case 'task_stuck':
      return Clock;
    case 'long_idle':
      return User;
    default:
      return AlertCircle;
  }
};

export const AlertItem: React.FC<AlertItemProps> = ({
  alert,
  onAcknowledge,
  onClick,
}) => {
  const styles = getSeverityStyles(alert.severity);
  const AlertTypeIcon = getAlertTypeIcon(alert.alert_type);
  const SeverityIcon = styles.icon;

  const timeAgo = (date: string) => {
    const diff = Date.now() - new Date(date).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  return (
    <div
      className={`
        p-4 rounded-lg border transition-all
        ${styles.bg} ${styles.border}
        ${onClick ? 'cursor-pointer hover:scale-[1.01]' : ''}
        ${alert.is_acknowledged ? 'opacity-60' : ''}
      `}
      onClick={onClick}
    >
      <div className="flex items-start gap-3">
        {/* Severity Icon */}
        <div className={`mt-0.5 ${styles.iconColor}`}>
          <SeverityIcon className="w-5 h-5" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`
              text-xs font-medium px-2 py-0.5 rounded
              ${alert.severity === 'critical' ? 'bg-red-500/20 text-red-400' :
                alert.severity === 'warning' ? 'bg-yellow-500/20 text-yellow-400' :
                'bg-blue-500/20 text-blue-400'}
            `}>
              {alert.severity.toUpperCase()}
            </span>
            <span className="text-xs text-gray-500">{timeAgo(alert.created_at)}</span>
          </div>

          <h4 className="font-medium text-white mt-1">{alert.title}</h4>
          <p className="text-sm text-gray-400 mt-0.5">{alert.message}</p>

          {/* User & Metrics */}
          <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <User className="w-3.5 h-3.5" />
              {alert.display_name}
            </span>
            <span className="flex items-center gap-1">
              <AlertTypeIcon className="w-3.5 h-3.5" />
              {alert.alert_type.replace(/_/g, ' ')}
            </span>
          </div>

          {/* Metrics */}
          {Object.keys(alert.metrics).length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2">
              {Object.entries(alert.metrics).map(([key, value]) => (
                <span
                  key={key}
                  className="text-xs px-2 py-1 rounded bg-gray-800 text-gray-300"
                >
                  {key.replace(/_/g, ' ')}: {String(value)}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        {!alert.is_acknowledged && onAcknowledge && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAcknowledge();
            }}
            className="
              p-2 rounded-lg bg-gray-700 hover:bg-gray-600
              text-gray-300 hover:text-white transition-colors
            "
            title="Acknowledge"
          >
            <CheckCircle2 className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

// =============================================================================
// ALERTS PANEL
// =============================================================================

interface AlertsPanelProps {
  className?: string;
  limit?: number;
}

export const AlertsPanel: React.FC<AlertsPanelProps> = ({
  className = '',
  limit = 10,
}) => {
  const [showAcknowledged, setShowAcknowledged] = useState(false);
  const orgId = useCurrentOrganizationId();
  const queryClient = useQueryClient();

  const { data: alerts = [], isLoading } = useQuery({
    queryKey: ['performance-alerts', orgId, showAcknowledged, limit],
    queryFn: () => efficiencyApi.getAlerts({
      organizationId: orgId || undefined,
      includeAcknowledged: showAcknowledged,
      limit,
    }),
    refetchInterval: 60000, // Refresh every minute
  });

  const acknowledgeMutation = useMutation({
    mutationFn: efficiencyApi.acknowledgeAlert,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['performance-alerts'] });
    },
  });

  const unacknowledgedCount = alerts.filter(a => !a.is_acknowledged).length;

  if (isLoading) {
    return (
      <div className={`bg-dark-surface rounded-xl border border-gray-700 p-4 ${className}`}>
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-700 rounded w-1/3"></div>
          {[1, 2, 3].map(i => (
            <div key={i} className="h-24 bg-gray-700 rounded"></div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-dark-surface rounded-xl border border-gray-700 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-red-500" />
          <h3 className="text-lg font-semibold text-white">Performance Alerts</h3>
          {unacknowledgedCount > 0 && (
            <AlertBadge count={unacknowledgedCount} />
          )}
        </div>

        <button
          onClick={() => setShowAcknowledged(!showAcknowledged)}
          className={`
            flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm
            transition-colors
            ${showAcknowledged
              ? 'bg-blue-500/20 text-blue-400'
              : 'bg-gray-800 text-gray-400 hover:text-white'}
          `}
        >
          <Filter className="w-4 h-4" />
          {showAcknowledged ? 'All' : 'Unacknowledged'}
        </button>
      </div>

      {/* Alerts List */}
      <div className="p-4 space-y-3 max-h-[600px] overflow-y-auto">
        {alerts.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            <CheckCircle2 className="w-10 h-10 mx-auto mb-2 opacity-50 text-green-500" />
            <p>No {showAcknowledged ? '' : 'unacknowledged '}alerts</p>
            <p className="text-sm mt-1">Team is performing well!</p>
          </div>
        ) : (
          alerts.map(alert => (
            <AlertItem
              key={alert.id}
              alert={alert}
              onAcknowledge={() => acknowledgeMutation.mutate(alert.id)}
            />
          ))
        )}
      </div>
    </div>
  );
};

// =============================================================================
// ALERTS NOTIFICATION DROPDOWN
// =============================================================================

interface AlertsDropdownProps {
  className?: string;
}

export const AlertsDropdown: React.FC<AlertsDropdownProps> = ({ className = '' }) => {
  const [isOpen, setIsOpen] = useState(false);
  const orgId = useCurrentOrganizationId();
  const queryClient = useQueryClient();

  const { data: alerts = [] } = useQuery({
    queryKey: ['performance-alerts', orgId, false, 5],
    queryFn: () => efficiencyApi.getAlerts({
      organizationId: orgId || undefined,
      includeAcknowledged: false,
      limit: 5,
    }),
    refetchInterval: 60000,
  });

  const acknowledgeMutation = useMutation({
    mutationFn: efficiencyApi.acknowledgeAlert,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['performance-alerts'] });
    },
  });

  const unacknowledgedCount = alerts.filter(a => !a.is_acknowledged).length;

  return (
    <div className={`relative ${className}`}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="
          relative p-2 rounded-lg hover:bg-gray-800 transition-colors
          text-gray-400 hover:text-white
        "
      >
        <Bell className="w-5 h-5" />
        {unacknowledgedCount > 0 && (
          <span className="
            absolute -top-1 -right-1 w-4 h-4 rounded-full
            bg-red-500 text-white text-xs font-bold
            flex items-center justify-center
          ">
            {unacknowledgedCount > 9 ? '9+' : unacknowledgedCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Panel */}
          <div className="
            absolute right-0 top-full mt-2 z-50
            w-96 max-h-[500px] overflow-hidden
            bg-dark-surface rounded-xl border border-gray-700 shadow-xl
          ">
            <div className="flex items-center justify-between p-3 border-b border-gray-700">
              <span className="font-medium text-white">Alerts</span>
              <button
                onClick={() => setIsOpen(false)}
                className="p-1 hover:bg-gray-800 rounded text-gray-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="overflow-y-auto max-h-[400px] p-3 space-y-2">
              {alerts.length === 0 ? (
                <div className="text-center py-6 text-gray-500">
                  <CheckCircle2 className="w-8 h-8 mx-auto mb-2 text-green-500 opacity-50" />
                  <p className="text-sm">All clear!</p>
                </div>
              ) : (
                alerts.map(alert => (
                  <AlertItem
                    key={alert.id}
                    alert={alert}
                    onAcknowledge={() => acknowledgeMutation.mutate(alert.id)}
                  />
                ))
              )}
            </div>

            {alerts.length > 0 && (
              <div className="p-3 border-t border-gray-700">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    // Navigate to full alerts view
                  }}
                  className="
                    w-full flex items-center justify-center gap-1
                    text-sm text-blue-400 hover:text-blue-300
                  "
                >
                  View all alerts
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default {
  AlertBadge,
  AlertItem,
  AlertsPanel,
  AlertsDropdown,
};

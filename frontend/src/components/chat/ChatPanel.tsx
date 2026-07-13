import React, { useEffect } from 'react';
import { X, Minus, MessageSquarePlus, History, ChevronLeft, Wifi, WifiOff, Loader2 } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';

interface ChatPanelProps {
  className?: string;
}

export const ChatPanel: React.FC<ChatPanelProps> = ({ className = '' }) => {
  const {
    isOpen,
    isMinimized,
    status,
    model,
    messages,
    isStreaming,
    suggestions,
    sessions,
    currentSessionId,
    closeChat,
    minimizeChat,
    restoreChat,
    sendMessage,
    cancelStreaming,
    submitFeedback,
    loadSessions,
    selectSession,
    startNewSession,
    checkStatus,
  } = useChatStore();

  const [showHistory, setShowHistory] = React.useState(false);

  useEffect(() => {
    if (showHistory) {
      loadSessions();
    }
  }, [showHistory, loadSessions]);

  useEffect(() => {
    if (isOpen && status === 'offline') {
      const interval = setInterval(() => {
        checkStatus();
      }, 10000);
      return () => clearInterval(interval);
    }
  }, [isOpen, status, checkStatus]);

  if (!isOpen) return null;

  if (isMinimized) {
    return (
      <button
        onClick={restoreChat}
        className={`fixed bottom-6 right-6 z-50 px-4 py-2
                   bg-gradient-to-r from-cyan-500/20 to-purple-500/20
                   border border-cyan-500/30 rounded-full
                   text-sm text-cyan-300 font-medium
                   hover:from-cyan-500/30 hover:to-purple-500/30
                   shadow-lg shadow-cyan-500/10
                   transition-all duration-200 ${className}`}
      >
        <span className="flex items-center gap-2">
          💬 AI Assistant
          {isStreaming && <Loader2 className="w-4 h-4 animate-spin" />}
        </span>
      </button>
    );
  }

  return (
    <div
      className={`fixed bottom-6 right-6 z-50 w-96 h-[600px] max-h-[80vh]
                 bg-gradient-to-b from-slate-800/98 to-slate-900/98
                 border border-slate-700/80 rounded-2xl
                 shadow-2xl shadow-black/50 backdrop-blur-lg
                 flex flex-col overflow-hidden
                 animate-slideUp ${className}`}
      style={{
        animation: 'slideUpBounce 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)',
      }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700/50 bg-slate-800/50">
        <div className="flex items-center gap-3">
          {showHistory ? (
            <button
              onClick={() => setShowHistory(false)}
              className="p-1 text-slate-400 hover:text-white transition-colors"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
          ) : (
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/30 to-purple-500/30 flex items-center justify-center">
              <span className="text-lg">🤖</span>
            </div>
          )}

          <div>
            <h3 className="text-sm font-semibold text-white">
              {showHistory ? 'Chat History' : 'AI Assistant'}
            </h3>
            <div className="flex items-center gap-1.5">
              <StatusIndicator status={status} />
              <span className="text-xs text-slate-400">
                {status === 'online' ? model : status === 'connecting' ? 'Connecting...' : 'Offline'}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {!showHistory && (
            <>
              <button
                onClick={() => setShowHistory(true)}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors"
                title="Chat history"
              >
                <History className="w-4 h-4" />
              </button>
              <button
                onClick={startNewSession}
                className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors"
                title="New chat"
              >
                <MessageSquarePlus className="w-4 h-4" />
              </button>
            </>
          )}
          <button
            onClick={minimizeChat}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors"
            title="Minimize"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            onClick={closeChat}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-700/50 rounded-lg transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      {showHistory ? (
        <SessionHistory
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelect={(id) => {
            selectSession(id);
            setShowHistory(false);
          }}
          onNewChat={() => {
            startNewSession();
            setShowHistory(false);
          }}
        />
      ) : (
        <>
          {/* Messages */}
          <ChatMessages messages={messages} onFeedback={submitFeedback} />

          {/* Input */}
          <ChatInput
            onSend={sendMessage}
            isStreaming={isStreaming}
            onCancel={cancelStreaming}
            suggestions={suggestions}
          />
        </>
      )}
    </div>
  );
};

// =============================================================================
// STATUS INDICATOR
// =============================================================================

const StatusIndicator: React.FC<{ status: string }> = ({ status }) => {
  const statusConfig = {
    online: { color: 'bg-green-400', icon: Wifi },
    offline: { color: 'bg-red-400', icon: WifiOff },
    connecting: { color: 'bg-yellow-400 animate-pulse', icon: Wifi },
    error: { color: 'bg-red-400', icon: WifiOff },
  };

  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.offline;

  return <div className={`w-2 h-2 rounded-full ${config.color}`} />;
};

// =============================================================================
// SESSION HISTORY
// =============================================================================

interface SessionHistoryProps {
  sessions: { id: string; title: string; updated_at: string; message_count: number }[];
  currentSessionId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
}

const SessionHistory: React.FC<SessionHistoryProps> = ({
  sessions,
  currentSessionId,
  onSelect,
  onNewChat,
}) => {
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    return date.toLocaleDateString();
  };

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      {/* New Chat Button */}
      <button
        onClick={onNewChat}
        className="w-full flex items-center gap-3 px-4 py-3 rounded-xl
                 bg-gradient-to-r from-cyan-500/10 to-purple-500/10
                 border border-cyan-500/20 hover:border-cyan-500/40
                 text-cyan-300 hover:text-cyan-200
                 transition-all duration-200"
      >
        <MessageSquarePlus className="w-5 h-5" />
        <span className="text-sm font-medium">Start New Chat</span>
      </button>

      {/* Session List */}
      {sessions.length === 0 ? (
        <div className="text-center py-8 text-slate-400 text-sm">
          No previous conversations
        </div>
      ) : (
        sessions.map((session) => (
          <button
            key={session.id}
            onClick={() => onSelect(session.id)}
            className={`w-full text-left px-4 py-3 rounded-xl transition-all duration-200
                      ${
                        session.id === currentSessionId
                          ? 'bg-cyan-500/20 border border-cyan-500/30'
                          : 'bg-slate-700/30 hover:bg-slate-700/50 border border-transparent'
                      }`}
          >
            <div className="text-sm text-white font-medium truncate">{session.title}</div>
            <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
              <span>{formatDate(session.updated_at)}</span>
              <span>•</span>
              <span>{session.message_count} messages</span>
            </div>
          </button>
        ))
      )}
    </div>
  );
};

export default ChatPanel;

import React, { useEffect, useRef } from 'react';
import { ThumbsUp, ThumbsDown, Bot, User, Loader2 } from 'lucide-react';
import type { ChatMessage, ChatMessageFeedback } from '@/types/chat';
import { BRAND } from '@/config/branding';

interface ChatMessagesProps {
  messages: ChatMessage[];
  onFeedback: (messageId: string, feedback: 'helpful' | 'not_helpful') => void;
}

export const ChatMessages: React.FC<ChatMessagesProps> = ({ messages, onFeedback }) => {
  const bottomRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-cyan-500/20 to-purple-500/20 flex items-center justify-center">
            <Bot className="w-8 h-8 text-cyan-400" />
          </div>
          <h3 className="text-lg font-semibold text-white mb-2">Hi! I'm your AI assistant</h3>
          <p className="text-sm text-slate-400 max-w-xs">
            Ask me anything about using {BRAND.name} - from annotation tools to keyboard shortcuts.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="flex-1 overflow-y-auto p-4 space-y-4"
      style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(100,116,139,0.5) transparent' }}
    >
      {messages.map((message) => (
        <MessageBubble
          key={message.id}
          message={message}
          onFeedback={onFeedback}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  );
};


interface MessageBubbleProps {
  message: ChatMessage;
  onFeedback: (messageId: string, feedback: 'helpful' | 'not_helpful') => void;
}

const MessageBubble: React.FC<MessageBubbleProps> = ({ message, onFeedback }) => {
  const isUser = message.role === 'user';
  const isStreaming = message.is_streaming;

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : ''}`}>
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center ${
          isUser
            ? 'bg-gradient-to-br from-purple-500/30 to-pink-500/30'
            : 'bg-gradient-to-br from-cyan-500/30 to-blue-500/30'
        }`}
      >
        {isUser ? (
          <User className="w-4 h-4 text-purple-300" />
        ) : (
          <Bot className="w-4 h-4 text-cyan-300" />
        )}
      </div>

      {/* Message Content */}
      <div className={`flex-1 max-w-[85%] ${isUser ? 'flex flex-col items-end' : ''}`}>
        <div
          className={`rounded-2xl px-4 py-2.5 ${
            isUser
              ? 'bg-gradient-to-r from-purple-500/30 to-pink-500/20 border border-purple-500/30'
              : 'bg-slate-700/50 border border-slate-600/30'
          }`}
        >
          {/* Message Text */}
          <div className="text-sm text-white whitespace-pre-wrap break-words">
            {message.content || (isStreaming && <StreamingIndicator />)}
          </div>

          {/* Streaming cursor */}
          {isStreaming && message.content && (
            <span className="inline-block w-2 h-4 ml-0.5 bg-cyan-400 animate-pulse rounded-sm" />
          )}
        </div>

        {/* Feedback buttons for assistant messages */}
        {!isUser && !isStreaming && message.id && !message.id.startsWith('temp-') && (
          <FeedbackButtons
            messageId={message.id}
            currentFeedback={message.feedback}
            onFeedback={onFeedback}
          />
        )}
      </div>
    </div>
  );
};

// =============================================================================
// STREAMING INDICATOR
// =============================================================================

const StreamingIndicator: React.FC = () => (
  <div className="flex items-center gap-1.5">
    <Loader2 className="w-4 h-4 animate-spin text-cyan-400" />
    <span className="text-slate-400">Thinking...</span>
  </div>
);

// =============================================================================
// FEEDBACK BUTTONS
// =============================================================================

interface FeedbackButtonsProps {
  messageId: string;
  currentFeedback?: ChatMessageFeedback;
  onFeedback: (messageId: string, feedback: 'helpful' | 'not_helpful') => void;
}

const FeedbackButtons: React.FC<FeedbackButtonsProps> = ({
  messageId,
  currentFeedback,
  onFeedback,
}) => {
  return (
    <div className="flex items-center gap-1 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
      <span className="text-xs text-slate-500 mr-1">Was this helpful?</span>
      <button
        onClick={() => onFeedback(messageId, 'helpful')}
        className={`p-1 rounded transition-colors ${
          currentFeedback === 'helpful'
            ? 'bg-green-500/20 text-green-400'
            : 'text-slate-500 hover:text-green-400 hover:bg-green-500/10'
        }`}
        title="Helpful"
      >
        <ThumbsUp className="w-3.5 h-3.5" />
      </button>
      <button
        onClick={() => onFeedback(messageId, 'not_helpful')}
        className={`p-1 rounded transition-colors ${
          currentFeedback === 'not_helpful'
            ? 'bg-red-500/20 text-red-400'
            : 'text-slate-500 hover:text-red-400 hover:bg-red-500/10'
        }`}
        title="Not helpful"
      >
        <ThumbsDown className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export default ChatMessages;

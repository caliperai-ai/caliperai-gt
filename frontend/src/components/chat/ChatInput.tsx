import React, { useState, useRef, useEffect } from 'react';
import { Send, Square, Loader2 } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';
import type { ChatSuggestion } from '@/types/chat';

interface ChatInputProps {
  onSend: (message: string) => void;
  isStreaming: boolean;
  onCancel: () => void;
  suggestions: ChatSuggestion[];
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  isStreaming,
  onCancel,
  suggestions,
}) => {
  const [input, setInput] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { messages } = useChatStore();

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleSubmit = (e?: React.FormEvent) => {
    e?.preventDefault();
    if (input.trim() && !isStreaming) {
      onSend(input.trim());
      setInput('');
      setShowSuggestions(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleSuggestionClick = (text: string) => {
    onSend(text);
    setShowSuggestions(false);
  };

  // Show suggestions only when chat is empty
  const shouldShowSuggestions = showSuggestions && messages.length === 0 && suggestions.length > 0;

  return (
    <div className="border-t border-slate-700/50 bg-slate-800/50">
      {/* Suggestions */}
      {shouldShowSuggestions && (
        <div className="p-3 border-b border-slate-700/30">
          <p className="text-xs text-slate-400 mb-2">Suggested questions:</p>
          <div className="flex flex-wrap gap-2">
            {suggestions.slice(0, 4).map((suggestion, index) => (
              <button
                key={index}
                onClick={() => handleSuggestionClick(suggestion.text)}
                className="px-3 py-1.5 text-xs bg-slate-700/50 hover:bg-cyan-500/20
                         text-slate-300 hover:text-cyan-300 rounded-full
                         border border-slate-600/50 hover:border-cyan-500/50
                         transition-all duration-200"
              >
                {suggestion.text}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input Area */}
      <form onSubmit={handleSubmit} className="p-3">
        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question..."
            disabled={isStreaming}
            rows={1}
            className="flex-1 resize-none bg-slate-700/50 border border-slate-600/50
                     rounded-xl px-4 py-2.5 text-sm text-white placeholder-slate-400
                     focus:outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/20
                     disabled:opacity-50 disabled:cursor-not-allowed
                     transition-all duration-200"
            style={{ minHeight: '42px', maxHeight: '120px' }}
          />

          {isStreaming ? (
            <button
              type="button"
              onClick={onCancel}
              className="flex-shrink-0 p-2.5 bg-red-500/20 hover:bg-red-500/30
                       text-red-400 rounded-xl border border-red-500/30
                       transition-all duration-200"
              title="Stop generating"
            >
              <Square className="w-5 h-5" />
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="flex-shrink-0 p-2.5 bg-cyan-500/20 hover:bg-cyan-500/30
                       text-cyan-400 rounded-xl border border-cyan-500/30
                       disabled:opacity-50 disabled:cursor-not-allowed
                       transition-all duration-200"
              title="Send message"
            >
              <Send className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Streaming indicator */}
        {isStreaming && (
          <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>Generating response...</span>
          </div>
        )}
      </form>
    </div>
  );
};

export default ChatInput;

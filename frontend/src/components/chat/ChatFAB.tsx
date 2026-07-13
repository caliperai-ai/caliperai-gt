import React from 'react';
import { MessageCircle } from 'lucide-react';
import { useChatStore } from '@/store/chatStore';

interface ChatFABProps {
  offsetBottom?: number;
  offsetRight?: number;
}

export const ChatFAB: React.FC<ChatFABProps> = ({
  offsetBottom = 24,
  offsetRight = 24,
}) => {
  const { isOpen, toggleChat, status } = useChatStore();

  if (isOpen) return null;

  return (
    <button
      onClick={toggleChat}
      className="fixed z-40 group"
      style={{
        bottom: `${offsetBottom}px`,
        right: `${offsetRight}px`,
      }}
      title="AI Assistant"
    >
      {/* Outer glow ring */}
      <div
        className="absolute inset-0 rounded-full bg-gradient-to-r from-cyan-500 to-purple-500 opacity-20
                  group-hover:opacity-40 blur-lg transition-opacity duration-300"
        style={{ transform: 'scale(1.2)' }}
      />

      {/* Main button */}
      <div
        className="relative w-14 h-14 rounded-full
                  bg-gradient-to-br from-cyan-500/90 to-purple-600/90
                  shadow-lg shadow-cyan-500/30
                  flex items-center justify-center
                  transform group-hover:scale-110 transition-all duration-300
                  border border-white/10"
      >
        <MessageCircle className="w-6 h-6 text-white" />

        {/* Status dot */}
        <div
          className={`absolute top-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-slate-900
                     ${status === 'online' ? 'bg-green-400' :
                       status === 'connecting' ? 'bg-yellow-400 animate-pulse' :
                       'bg-slate-500'}`}
        />
      </div>

      {/* Tooltip */}
      <div
        className="absolute right-full mr-3 top-1/2 -translate-y-1/2
                  px-3 py-1.5 rounded-lg bg-slate-800 border border-slate-700
                  text-sm text-white whitespace-nowrap
                  opacity-0 group-hover:opacity-100 pointer-events-none
                  transition-opacity duration-200"
      >
        AI Assistant
      </div>
    </button>
  );
};

export default ChatFAB;

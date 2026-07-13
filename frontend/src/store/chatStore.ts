import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { chatApi } from '@/api/chat';
import type {
  ChatMessage,
  ChatSession,
  ChatContext,
  ChatSuggestion,
  ChatMessageRole,
} from '@/types/chat';


interface ChatState {
  isOpen: boolean;
  isMinimized: boolean;

  status: 'online' | 'offline' | 'connecting' | 'error';
  provider: string;
  model: string;

  currentSessionId: string | null;
  sessions: ChatSession[];

  messages: ChatMessage[];
  isStreaming: boolean;
  streamingContent: string;

  suggestions: ChatSuggestion[];

  currentContext: ChatContext;

  openChat: () => void;
  closeChat: () => void;
  toggleChat: () => void;
  minimizeChat: () => void;
  restoreChat: () => void;

  checkStatus: () => Promise<void>;

  loadSessions: () => Promise<void>;
  selectSession: (sessionId: string) => Promise<void>;
  startNewSession: () => void;

  sendMessage: (content: string) => Promise<void>;
  loadHistory: (sessionId: string) => Promise<void>;
  submitFeedback: (messageId: string, feedback: 'helpful' | 'not_helpful') => Promise<void>;
  cancelStreaming: () => void;

  loadSuggestions: () => Promise<void>;

  setContext: (context: Partial<ChatContext>) => void;

  clearMessages: () => void;
}


let abortController: AbortController | null = null;

export const useChatStore = create<ChatState>()(
  persist(
    (set, get) => ({
      isOpen: false,
      isMinimized: false,
      status: 'offline',
      provider: '',
      model: '',
      currentSessionId: null,
      sessions: [],
      messages: [],
      isStreaming: false,
      streamingContent: '',
      suggestions: [],
      currentContext: {},

      openChat: () => {
        set({ isOpen: true, isMinimized: false });
        get().checkStatus();
        get().loadSuggestions();
      },

      closeChat: () => set({ isOpen: false }),

      toggleChat: () => {
        const { isOpen, isMinimized } = get();
        if (!isOpen) {
          get().openChat();
        } else if (isMinimized) {
          set({ isMinimized: false });
        } else {
          set({ isOpen: false });
        }
      },

      minimizeChat: () => set({ isMinimized: true }),
      restoreChat: () => set({ isMinimized: false }),

      checkStatus: async () => {
        set({ status: 'connecting' });
        try {
          const statusResponse = await chatApi.getStatus();
          set({
            status: statusResponse.status,
            provider: statusResponse.provider,
            model: statusResponse.model,
          });
        } catch (error) {
          console.error('Failed to check chat status:', error);
          set({ status: 'offline' });
        }
      },

      loadSessions: async () => {
        try {
          const sessions = await chatApi.getSessions();
          set({ sessions });
        } catch (error) {
          console.error('Failed to load sessions:', error);
        }
      },

      selectSession: async (sessionId: string) => {
        set({ currentSessionId: sessionId, messages: [] });
        await get().loadHistory(sessionId);
      },

      startNewSession: () => {
        set({
          currentSessionId: null,
          messages: [],
          streamingContent: '',
        });
      },

      sendMessage: async (content: string) => {
        const { currentSessionId, currentContext, messages } = get();

        const userMessage: ChatMessage = {
          id: `temp-${Date.now()}`,
          role: 'user' as ChatMessageRole,
          content,
          created_at: new Date().toISOString(),
        };

        // Add placeholder for assistant response
        const assistantPlaceholder: ChatMessage = {
          id: `temp-assistant-${Date.now()}`,
          role: 'assistant' as ChatMessageRole,
          content: '',
          created_at: new Date().toISOString(),
          is_streaming: true,
        };

        set({
          messages: [...messages, userMessage, assistantPlaceholder],
          isStreaming: true,
          streamingContent: '',
        });

        // Send message with streaming
        abortController = chatApi.sendMessage(
          content,
          currentSessionId || undefined,
          currentContext,
          // onToken
          (token: string) => {
            const currentContent = get().streamingContent;
            const newContent = currentContent + token;
            set({ streamingContent: newContent });

            // Update the assistant message content
            set((state) => ({
              messages: state.messages.map((msg) =>
                msg.is_streaming ? { ...msg, content: newContent } : msg
              ),
            }));
          },
          // onDone
          (messageId: string, sessionId: string) => {
            const finalContent = get().streamingContent;
            set((state) => ({
              isStreaming: false,
              streamingContent: '',
              currentSessionId: sessionId,
              messages: state.messages.map((msg) =>
                msg.is_streaming
                  ? { ...msg, id: messageId, content: finalContent, is_streaming: false }
                  : msg
              ),
            }));
            abortController = null;
            // Reload sessions to get updated list
            get().loadSessions();
          },
          // onError
          (error: string) => {
            console.error('Chat error:', error);
            set((state) => ({
              isStreaming: false,
              streamingContent: '',
              messages: state.messages.map((msg) =>
                msg.is_streaming
                  ? { ...msg, content: `Error: ${error}`, is_streaming: false }
                  : msg
              ),
            }));
            abortController = null;
          }
        );
      },

      loadHistory: async (sessionId: string) => {
        try {
          const messages = await chatApi.getHistory(sessionId);
          set({ messages });
        } catch (error) {
          console.error('Failed to load history:', error);
        }
      },

      submitFeedback: async (messageId: string, feedback: 'helpful' | 'not_helpful') => {
        try {
          await chatApi.submitFeedback(messageId, feedback);
          set((state) => ({
            messages: state.messages.map((msg) =>
              msg.id === messageId ? { ...msg, feedback } : msg
            ),
          }));
        } catch (error) {
          console.error('Failed to submit feedback:', error);
        }
      },

      cancelStreaming: () => {
        if (abortController) {
          abortController.abort();
          abortController = null;
        }
        set((state) => ({
          isStreaming: false,
          streamingContent: '',
          messages: state.messages.filter((msg) => !msg.is_streaming),
        }));
      },

      // Suggestions actions
      loadSuggestions: async () => {
        try {
          const { currentContext } = get();
          const suggestions = await chatApi.getSuggestions(currentContext);
          set({ suggestions });
        } catch (error) {
          console.error('Failed to load suggestions:', error);
        }
      },

      // Context actions
      setContext: (context: Partial<ChatContext>) => {
        set((state) => ({
          currentContext: { ...state.currentContext, ...context },
        }));
        // Reload suggestions when context changes
        get().loadSuggestions();
      },

      // Cleanup
      clearMessages: () => set({ messages: [], currentSessionId: null }),
    }),
    {
      name: 'chat-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        // Only persist these fields
        currentSessionId: state.currentSessionId,
        sessions: state.sessions,
      }),
    }
  )
);

export default useChatStore;

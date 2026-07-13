import { useAuthStore } from '@/store/authStore';
import type {
  ChatSession,
  ChatMessage,
  ChatContext,
  ChatSuggestion,
  ChatStatusResponse,
  SSEEvent,
} from '@/types/chat';

const API_BASE = '/api/v1/chat';


const getHeaders = () => {
  const token = useAuthStore.getState().accessToken;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
};

const handleResponse = async <T>(response: Response): Promise<T> => {
  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }
  return response.json();
};

// =============================================================================
// CHAT API
// =============================================================================

export const chatApi = {
  /**
   * Get chat service status
   */
  getStatus: async (): Promise<ChatStatusResponse> => {
    const response = await fetch(`${API_BASE}/status`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse<ChatStatusResponse>(response);
  },

  /**
   * Get contextual suggestions
   */
  getSuggestions: async (context?: ChatContext): Promise<ChatSuggestion[]> => {
    const params = new URLSearchParams();
    if (context?.current_page) params.append('page', context.current_page);
    if (context?.current_view) params.append('view', context.current_view);
    if (context?.selected_tool) params.append('tool', context.selected_tool);

    const response = await fetch(`${API_BASE}/suggestions?${params}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse<ChatSuggestion[]>(response);
  },

  /**
   * Get chat sessions
   */
  getSessions: async (limit = 20): Promise<ChatSession[]> => {
    const response = await fetch(`${API_BASE}/sessions?limit=${limit}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse<ChatSession[]>(response);
  },

  /**
   * Get conversation history
   */
  getHistory: async (sessionId: string, limit = 50): Promise<ChatMessage[]> => {
    const response = await fetch(`${API_BASE}/history/${sessionId}?limit=${limit}`, {
      method: 'GET',
      headers: getHeaders(),
    });
    return handleResponse<ChatMessage[]>(response);
  },

  /**
   * Submit feedback on a message
   */
  submitFeedback: async (
    messageId: string,
    feedback: 'helpful' | 'not_helpful'
  ): Promise<void> => {
    const response = await fetch(`${API_BASE}/feedback/${messageId}`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ feedback }),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({ detail: 'Unknown error' }));
      throw new Error(error.detail || `HTTP ${response.status}`);
    }
  },

  /**
   * Send a message and receive streaming response via SSE
   */
  sendMessage: (
    message: string,
    sessionId?: string,
    context?: ChatContext,
    onToken: (token: string) => void = () => {},
    onDone: (messageId: string, newSessionId: string) => void = () => {},
    onError: (error: string) => void = () => {}
  ): AbortController => {
    const controller = new AbortController();
    const token = useAuthStore.getState().accessToken;

    const body = JSON.stringify({
      message,
      session_id: sessionId,
      context,
    });

    fetch(`${API_BASE}/message`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body,
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          const error = await response.json().catch(() => ({ detail: 'Request failed' }));
          onError(error.detail || `HTTP ${response.status}`);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          onError('No response body');
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const event: SSEEvent = JSON.parse(line.slice(6));

                if (event.type === 'token') {
                  onToken(event.content);
                } else if (event.type === 'done' || event.type === 'complete') {
                  // Backend ends the stream with `complete`/`assistant_message_id`;
                  // `done`/`message_id` is the legacy shape. Handle both.
                  onDone(
                    event.assistant_message_id ?? event.message_id ?? '',
                    event.session_id
                  );
                } else if (event.type === 'error') {
                  onError(event.error);
                }
              } catch {
                // Ignore parse errors for incomplete JSON
              }
            }
          }
        }
      })
      .catch((error) => {
        if (error.name !== 'AbortError') {
          onError(error.message || 'Connection failed');
        }
      });

    return controller;
  },
};

export default chatApi;

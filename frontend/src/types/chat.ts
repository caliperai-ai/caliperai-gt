

export type ChatMessageRole = 'user' | 'assistant' | 'system';
export type ChatMessageFeedback = 'helpful' | 'not_helpful' | null;


export interface ChatMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  feedback?: ChatMessageFeedback;
  created_at: string;
  is_streaming?: boolean;
}

export interface ChatSession {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  message_count: number;
}


export interface ChatContext {
  current_page?: string;
  current_view?: string;
  selected_tool?: string;
  task_id?: string;
  dataset_id?: string;
  taxonomy_categories?: string[];
}

export interface SendMessageRequest {
  message: string;
  session_id?: string;
  context?: ChatContext;
}

export interface ChatSuggestion {
  text: string;
  category: string;
}

export interface ChatStatusResponse {
  status: 'online' | 'offline' | 'error';
  provider: string;
  model: string;
  available_models?: string[];
}


export interface SSETokenEvent {
  type: 'token';
  content: string;
}

export interface SSEDoneEvent {
  type: 'done' | 'complete';
  message_id?: string;
  assistant_message_id?: string;
  session_id: string;
}

export interface SSEErrorEvent {
  type: 'error';
  error: string;
}

export type SSEEvent = SSETokenEvent | SSEDoneEvent | SSEErrorEvent;

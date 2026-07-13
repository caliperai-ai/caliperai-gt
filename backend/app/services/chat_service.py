"""
Chat Service - Orchestrates AI chatbot operations.

Handles:
- Session management
- Message persistence
- LLM integration
- Context building
- Streaming responses
- RAG knowledge retrieval
"""
import asyncio
import json
import logging
import time
import uuid
from datetime import datetime
from typing import AsyncGenerator, Optional, List, Dict, Any

from sqlalchemy import select, func, desc
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.models import ChatSession, ChatMessage, User
from app.schemas.chat import (
    ChatContext,
    MessageResponse,
    ChatHistoryResponse,
    ChatSessionResponse,
    ChatSessionListResponse,
)
from app.services.llm_service import (
    LLMService,
    get_llm_service,
    ChatMessage as LLMChatMessage,
)
from app.core.prompts import build_system_prompt, get_suggestions
from app.core.config import settings

logger = logging.getLogger(__name__)


def _get_knowledge_service_class():
    from app.services.knowledge_service import KnowledgeService, get_knowledge_service
    return KnowledgeService, get_knowledge_service


class ChatService:
    """
    Service for managing AI chat interactions.
    
    Provides session management, message persistence, LLM integration,
    and RAG-based knowledge retrieval.
    """
    
    def __init__(
        self,
        db: AsyncSession,
        llm_service: Optional[LLMService] = None,
        redis_client: Optional["Redis"] = None,
    ):
        self.db = db
        self.llm = llm_service or get_llm_service()
        self.redis = redis_client
        self._knowledge_service = None
    
    async def _get_knowledge_service(self):
        """Get or create knowledge service (lazy initialization)."""
        if self._knowledge_service is None and settings.RAG_ENABLED:
            try:
                _, get_knowledge_service = _get_knowledge_service_class()
                self._knowledge_service = await get_knowledge_service(
                    db=self.db,
                    redis_client=self.redis,
                )
            except Exception as e:
                logger.warning(f"Failed to initialize knowledge service: {e}")
                return None
        return self._knowledge_service
    
    
    async def get_or_create_session(
        self,
        user_id: uuid.UUID,
        session_id: Optional[uuid.UUID] = None,
    ) -> ChatSession:
        """
        Get existing session or create a new one.
        
        Args:
            user_id: User ID
            session_id: Optional existing session ID
            
        Returns:
            ChatSession instance
        """
        if session_id:
            result = await self.db.execute(
                select(ChatSession)
                .where(ChatSession.id == session_id)
                .where(ChatSession.user_id == user_id)
            )
            session = result.scalar_one_or_none()
            if session:
                return session
        
        session = ChatSession(
            user_id=user_id,
            is_active=True,
        )
        self.db.add(session)
        await self.db.flush()
        
        logger.info(f"Created new chat session {session.id} for user {user_id}")
        return session
    
    async def get_session(
        self,
        session_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> Optional[ChatSession]:
        """Get a specific session if it belongs to the user."""
        result = await self.db.execute(
            select(ChatSession)
            .where(ChatSession.id == session_id)
            .where(ChatSession.user_id == user_id)
        )
        return result.scalar_one_or_none()
    
    async def list_sessions(
        self,
        user_id: uuid.UUID,
        limit: int = 20,
        offset: int = 0,
    ) -> ChatSessionListResponse:
        """
        List chat sessions for a user.
        
        Args:
            user_id: User ID
            limit: Max sessions to return
            offset: Pagination offset
            
        Returns:
            ChatSessionListResponse with sessions
        """
        query = (
            select(ChatSession)
            .where(ChatSession.user_id == user_id)
            .order_by(desc(ChatSession.updated_at))
            .offset(offset)
            .limit(limit)
        )
        
        result = await self.db.execute(query)
        sessions = result.scalars().all()
        
        count_query = select(func.count(ChatSession.id)).where(
            ChatSession.user_id == user_id
        )
        count_result = await self.db.execute(count_query)
        total = count_result.scalar() or 0
        
        session_responses = []
        for session in sessions:
            msg_count_query = select(func.count(ChatMessage.id)).where(
                ChatMessage.session_id == session.id
            )
            msg_result = await self.db.execute(msg_count_query)
            msg_count = msg_result.scalar() or 0
            
            session_responses.append(ChatSessionResponse(
                session_id=session.id,
                title=session.title,
                created_at=session.created_at,
                updated_at=session.updated_at,
                message_count=msg_count,
            ))
        
        return ChatSessionListResponse(
            sessions=session_responses,
            total=total,
        )
    
    
    async def add_message(
        self,
        session_id: uuid.UUID,
        role: str,
        content: str,
        context: Optional[Dict[str, Any]] = None,
        model_used: Optional[str] = None,
        tokens_used: Optional[int] = None,
        latency_ms: Optional[int] = None,
    ) -> ChatMessage:
        """
        Add a message to a session.
        
        Args:
            session_id: Session ID
            role: Message role (user, assistant, system)
            content: Message content
            context: Optional context data
            model_used: LLM model used (for assistant messages)
            tokens_used: Tokens used (for assistant messages)
            latency_ms: Response latency (for assistant messages)
            
        Returns:
            Created ChatMessage
        """
        message = ChatMessage(
            session_id=session_id,
            role=role,
            content=content,
            context=context or {},
            model_used=model_used,
            tokens_used=tokens_used,
            latency_ms=latency_ms,
        )
        self.db.add(message)
        await self.db.flush()
        
        return message
    
    async def get_history(
        self,
        user_id: uuid.UUID,
        session_id: Optional[uuid.UUID] = None,
        limit: int = 50,
    ) -> Optional[ChatHistoryResponse]:
        """
        Get chat history for a session.
        
        Args:
            user_id: User ID
            session_id: Optional session ID (if None, gets most recent)
            limit: Max messages to return
            
        Returns:
            ChatHistoryResponse or None if no sessions exist
        """
        if session_id:
            session = await self.get_session(session_id, user_id)
        else:
            result = await self.db.execute(
                select(ChatSession)
                .where(ChatSession.user_id == user_id)
                .order_by(desc(ChatSession.updated_at))
                .limit(1)
            )
            session = result.scalar_one_or_none()
        
        if not session:
            return None
        
        result = await self.db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session.id)
            .order_by(ChatMessage.created_at)
            .limit(limit)
        )
        messages = result.scalars().all()
        
        return ChatHistoryResponse(
            session_id=session.id,
            title=session.title,
            messages=[
                MessageResponse(
                    id=msg.id,
                    role=msg.role,
                    content=msg.content,
                    created_at=msg.created_at,
                    context=msg.context,
                    model_used=msg.model_used,
                    feedback=msg.feedback,
                )
                for msg in messages
            ],
            created_at=session.created_at,
        )
    
    async def clear_history(
        self,
        user_id: uuid.UUID,
        session_id: Optional[uuid.UUID] = None,
    ) -> bool:
        """
        Clear chat history.
        
        Args:
            user_id: User ID
            session_id: Optional specific session to clear
            
        Returns:
            True if history was cleared
        """
        if session_id:
            session = await self.get_session(session_id, user_id)
            if session:
                await self.db.delete(session)
                await self.db.flush()
                return True
        else:
            result = await self.db.execute(
                select(ChatSession).where(ChatSession.user_id == user_id)
            )
            sessions = result.scalars().all()
            for session in sessions:
                await self.db.delete(session)
            await self.db.flush()
            return True
        
        return False
    
    async def save_feedback(
        self,
        message_id: uuid.UUID,
        user_id: uuid.UUID,
        feedback: str,
    ) -> bool:
        """
        Save feedback for a message.
        
        Args:
            message_id: Message ID
            user_id: User ID (for verification)
            feedback: Feedback value ('helpful' or 'not_helpful')
            
        Returns:
            True if feedback was saved
        """
        result = await self.db.execute(
            select(ChatMessage)
            .join(ChatSession)
            .where(ChatMessage.id == message_id)
            .where(ChatSession.user_id == user_id)
        )
        message = result.scalar_one_or_none()
        
        if message:
            message.feedback = feedback
            await self.db.flush()
            return True
        
        return False
    
    
    async def get_recent_messages(
        self,
        session_id: uuid.UUID,
        limit: int = None,
    ) -> List[ChatMessage]:
        """Get recent messages from a session for context."""
        limit = limit or settings.CHAT_MAX_HISTORY_MESSAGES
        
        result = await self.db.execute(
            select(ChatMessage)
            .where(ChatMessage.session_id == session_id)
            .order_by(desc(ChatMessage.created_at))
            .limit(limit)
        )
        messages = result.scalars().all()
        
        return list(reversed(messages))
    
    def _build_llm_messages(
        self,
        system_prompt: str,
        history: List[ChatMessage],
        user_message: str,
    ) -> List[LLMChatMessage]:
        """Build message list for LLM."""
        messages = [LLMChatMessage(role="system", content=system_prompt)]
        
        for msg in history:
            if msg.role in ("user", "assistant"):
                messages.append(LLMChatMessage(role=msg.role, content=msg.content))
        
        messages.append(LLMChatMessage(role="user", content=user_message))
        
        return messages
    
    async def generate_title(self, first_message: str) -> str:
        """Generate a session title from the first message."""
        title = first_message[:50]
        if len(first_message) > 50:
            title += "..."
        return title
    
    async def stream_response(
        self,
        user_id: uuid.UUID,
        message: str,
        context: Optional[ChatContext] = None,
        session_id: Optional[uuid.UUID] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Generate a streaming chat response.
        
        Yields SSE-formatted events for real-time streaming.
        
        Args:
            user_id: User ID
            message: User's message
            context: UI context for contextual assistance
            session_id: Optional existing session ID
            
        Yields:
            SSE-formatted event strings
        """
        start_time = time.time()
        
        session = await self.get_or_create_session(user_id, session_id)
        
        if not session.title:
            session.title = await self.generate_title(message)
        
        context_dict = context.model_dump() if context else {}
        
        user_msg = await self.add_message(
            session_id=session.id,
            role="user",
            content=message,
            context=context_dict,
        )
        
        assistant_msg = await self.add_message(
            session_id=session.id,
            role="assistant",
            content="",
        )
        
        await self.db.commit()
        
        rag_context = ""
        rag_sources = []
        if settings.RAG_ENABLED:
            try:
                knowledge_service = await self._get_knowledge_service()
                if knowledge_service:
                    rag_context, rag_sources = await knowledge_service.get_context_for_query(
                        query=message,
                        max_tokens=2000,
                    )
                    if rag_sources:
                        logger.debug(
                            f"RAG retrieved {len(rag_sources)} chunks for query: {message[:50]}..."
                        )
            except Exception as e:
                logger.warning(f"RAG context retrieval failed: {e}")
        
        system_prompt = build_system_prompt(
            context_page=context.page if context else None,
            context_view=context.view if context else None,
            context_tool=context.active_tool if context else None,
            rag_context=rag_context if rag_context else None,
        )
        
        history = await self.get_recent_messages(session.id)
        history = [m for m in history if m.id not in (user_msg.id, assistant_msg.id)]
        
        llm_messages = self._build_llm_messages(system_prompt, history, message)
        
        full_response = []
        try:
            async for token in self.llm.generate_stream(llm_messages):
                full_response.append(token)
                
                event_data = json.dumps({"type": "token", "content": token})
                yield f"data: {event_data}\n\n"
        
        except Exception as e:
            logger.error(f"Error streaming LLM response: {e}")
            error_msg = "Sorry, I encountered an error. Please try again."
            full_response = [error_msg]
            
            event_data = json.dumps({"type": "error", "error": str(e)})
            yield f"data: {event_data}\n\n"
        
        latency_ms = int((time.time() - start_time) * 1000)
        final_content = "".join(full_response)
        
        assistant_msg.content = final_content
        assistant_msg.model_used = self.llm.model
        assistant_msg.latency_ms = latency_ms
        
        session.updated_at = datetime.utcnow()
        
        await self.db.commit()
        
        complete_data = json.dumps({
            "type": "complete",
            "session_id": str(session.id),
            "user_message_id": str(user_msg.id),
            "assistant_message_id": str(assistant_msg.id),
            "model_used": self.llm.model,
            "latency_ms": latency_ms,
        })
        yield f"data: {complete_data}\n\n"
    
    
    async def get_contextual_suggestions(
        self,
        context: Optional[ChatContext] = None,
    ) -> List[str]:
        """
        Get contextual question suggestions.
        
        Args:
            context: UI context
            
        Returns:
            List of suggested questions
        """
        return get_suggestions(
            context_page=context.page if context else None,
            context_view=context.view if context else None,
            context_tool=context.active_tool if context else None,
        )

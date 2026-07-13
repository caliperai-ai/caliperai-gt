"""
Chat endpoints - AI chatbot for onboarding and contextual help.

Provides:
- Streaming chat with AI assistant
- Chat history management
- Contextual suggestions
- Message feedback
"""
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.models.models import User
from app.schemas.chat import (
    SendMessageRequest,
    FeedbackRequest,
    ChatHistoryResponse,
    ChatSessionListResponse,
    SuggestionResponse,
    ChatContext,
)
from app.services.rbac_service import get_current_user
from app.services.chat_service import ChatService
from app.services.llm_service import get_llm_service

router = APIRouter()



async def get_chat_service(
    db: AsyncSession = Depends(get_db),
) -> ChatService:
    """Dependency to get chat service instance."""
    return ChatService(db)



@router.post("/message")
async def send_message(
    request: SendMessageRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    chat_service: ChatService = Depends(get_chat_service),
):
    """
    Send a message to the AI assistant and receive a streaming response.
    
    Returns Server-Sent Events (SSE) for real-time streaming.
    
    Events:
    - `token`: Streamed token from the AI response
    - `complete`: Final event with message IDs and metrics
    - `error`: Error event if something goes wrong
    
    Example usage with EventSource:
    ```javascript
    const eventSource = new EventSource('/api/v1/chat/message', {
        method: 'POST',
        body: JSON.stringify({ message: 'How do I draw a 3D box?' })
    });
    
    eventSource.onmessage = (event) => {
        const data = JSON.parse(event.data);
        if (data.type === 'token') {
            // Append token to response
        } else if (data.type === 'complete') {
            // Handle completion
        }
    };
    ```
    """
    return StreamingResponse(
        chat_service.stream_response(
            user_id=current_user.id,
            message=request.message,
            context=request.context,
            session_id=request.session_id,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/history", response_model=ChatHistoryResponse)
async def get_chat_history(
    session_id: Optional[UUID] = Query(
        None,
        description="Session ID to get history for. If not provided, returns most recent session."
    ),
    limit: int = Query(
        50,
        ge=1,
        le=200,
        description="Maximum number of messages to return"
    ),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    chat_service: ChatService = Depends(get_chat_service),
) -> ChatHistoryResponse:
    """
    Get chat history for current user.
    
    If session_id is not provided, returns the most recent session.
    Returns empty messages list if no sessions exist.
    """
    history = await chat_service.get_history(
        user_id=current_user.id,
        session_id=session_id,
        limit=limit,
    )
    
    if not history:
        from datetime import datetime
        from uuid import uuid4
        return ChatHistoryResponse(
            session_id=uuid4(),
            title=None,
            messages=[],
            created_at=datetime.utcnow(),
        )
    
    return history


@router.get("/sessions", response_model=ChatSessionListResponse)
async def list_sessions(
    limit: int = Query(
        20,
        ge=1,
        le=100,
        description="Maximum number of sessions to return"
    ),
    offset: int = Query(
        0,
        ge=0,
        description="Pagination offset"
    ),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    chat_service: ChatService = Depends(get_chat_service),
) -> ChatSessionListResponse:
    """
    List all chat sessions for current user.
    
    Sessions are returned in reverse chronological order (most recent first).
    """
    return await chat_service.list_sessions(
        user_id=current_user.id,
        limit=limit,
        offset=offset,
    )


@router.delete("/history")
async def clear_history(
    session_id: Optional[UUID] = Query(
        None,
        description="Session ID to clear. If not provided, clears all sessions."
    ),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    chat_service: ChatService = Depends(get_chat_service),
):
    """
    Clear chat history.
    
    If session_id is provided, clears only that session.
    Otherwise, clears all sessions for the current user.
    """
    success = await chat_service.clear_history(
        user_id=current_user.id,
        session_id=session_id,
    )
    
    return {
        "status": "cleared" if success else "no_history",
        "session_id": str(session_id) if session_id else "all",
    }


@router.post("/message/{message_id}/feedback")
async def submit_feedback(
    message_id: UUID,
    request: FeedbackRequest,
    current_user: Annotated[User, Depends(get_current_user)] = None,
    chat_service: ChatService = Depends(get_chat_service),
):
    """
    Submit feedback on an assistant response.
    
    Feedback helps improve the AI assistant's responses.
    
    Values:
    - `helpful`: The response was useful
    - `not_helpful`: The response was not useful
    """
    success = await chat_service.save_feedback(
        message_id=message_id,
        user_id=current_user.id,
        feedback=request.feedback.value,
    )
    
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Message not found or you don't have permission to access it",
        )
    
    return {"status": "saved", "message_id": str(message_id)}


@router.get("/suggestions", response_model=SuggestionResponse)
async def get_suggestions(
    page: Optional[str] = Query(None, description="Current page path"),
    view: Optional[str] = Query(None, description="Current view mode (3d, 2d, bev)"),
    active_tool: Optional[str] = Query(None, description="Currently active tool"),
    current_user: Annotated[User, Depends(get_current_user)] = None,
    chat_service: ChatService = Depends(get_chat_service),
) -> SuggestionResponse:
    """
    Get contextual question suggestions based on current page/tool.
    
    Returns a list of suggested questions relevant to the user's
    current context in the application.
    """
    context = ChatContext(
        page=page,
        view=view,
        active_tool=active_tool,
    )
    
    suggestions = await chat_service.get_contextual_suggestions(context)
    
    return SuggestionResponse(suggestions=suggestions)



@router.get("/status")
async def get_chat_status(
    current_user: Annotated[User, Depends(get_current_user)] = None,
):
    """
    Get AI chat service status.
    
    Returns the health of the LLM service and available models.
    """
    llm_service = get_llm_service()
    
    is_healthy = await llm_service.health_check()
    
    models = []
    if is_healthy:
        try:
            models = await llm_service.list_models()
        except Exception:
            pass
    
    return {
        "status": "online" if is_healthy else "offline",
        "provider": llm_service.provider.value,
        "model": llm_service.model,
        "available_models": models,
    }

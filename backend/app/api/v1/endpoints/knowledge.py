"""
Knowledge Base endpoints - RAG administration and debugging.

Provides:
- Knowledge base statistics
- Manual reindexing
- Search debugging
"""
from typing import Annotated, Optional, List
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.models.models import User, UserRole
from app.services.rbac_service import get_current_user, RequireRole
from app.core.redis_cache import get_redis

router = APIRouter()



class KnowledgeStatsResponse(BaseModel):
    """Knowledge base statistics."""
    total_chunks: int
    total_files: int
    avg_chunk_size: int
    last_indexed: Optional[str] = None
    embedding_model: str
    embedding_dimensions: int
    rag_enabled: bool = Field(default=True)


class SearchResult(BaseModel):
    """Search result item."""
    id: int
    content: str
    source_file: str
    chunk_index: int
    score: float
    match_type: str
    metadata: dict = Field(default_factory=dict)


class SearchRequest(BaseModel):
    """Search request."""
    query: str = Field(..., min_length=1, max_length=500)
    top_k: int = Field(default=5, ge=1, le=20)
    search_type: str = Field(default="hybrid", pattern="^(semantic|keyword|hybrid)$")


class SearchResponse(BaseModel):
    """Search response."""
    query: str
    results: List[SearchResult]
    total: int


class ReindexResponse(BaseModel):
    """Reindex response."""
    success: bool
    chunks_indexed: int
    message: str



async def get_knowledge_service(
    db: AsyncSession = Depends(get_db),
):
    """Dependency to get knowledge service instance."""
    if not settings.RAG_ENABLED:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="RAG is not enabled",
        )
    
    try:
        from app.services.knowledge_service import KnowledgeService
        from app.services.embedding_service import get_embedding_service
        
        redis = await get_redis()
        embedding_service = await get_embedding_service(redis)
        
        service = KnowledgeService(
            db=db,
            embedding_service=embedding_service,
            redis_client=redis,
        )
        await service.initialize()
        return service
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Knowledge service unavailable: {str(e)}",
        )



@router.get("/stats", response_model=KnowledgeStatsResponse)
async def get_knowledge_stats(
    current_user: Annotated[User, Depends(get_current_user)],
    knowledge_service = Depends(get_knowledge_service),
):
    """
    Get knowledge base statistics.
    
    Returns information about indexed documents and configuration.
    """
    stats = await knowledge_service.get_stats()
    return KnowledgeStatsResponse(
        **stats,
        rag_enabled=settings.RAG_ENABLED,
    )


@router.post("/reindex", response_model=ReindexResponse)
async def reindex_knowledge_base(
    current_user: Annotated[User, Depends(RequireRole(UserRole.ADMIN))],
    knowledge_service = Depends(get_knowledge_service),
):
    """
    Manually trigger knowledge base reindexing.
    
    Only indexes files that have changed since last index.
    Requires admin role.
    """
    try:
        chunks_indexed = await knowledge_service.load_knowledge_base()
        return ReindexResponse(
            success=True,
            chunks_indexed=chunks_indexed,
            message=f"Successfully indexed {chunks_indexed} chunks",
        )
    except Exception as e:
        return ReindexResponse(
            success=False,
            chunks_indexed=0,
            message=f"Indexing failed: {str(e)}",
        )


@router.post("/search", response_model=SearchResponse)
async def search_knowledge(
    request: SearchRequest,
    current_user: Annotated[User, Depends(get_current_user)],
    knowledge_service = Depends(get_knowledge_service),
):
    """
    Search the knowledge base.
    
    Supports three search types:
    - `semantic`: Vector similarity search
    - `keyword`: Full-text search
    - `hybrid`: Combined semantic + keyword (default, recommended)
    
    Useful for debugging RAG retrieval.
    """
    if request.search_type == "semantic":
        results = await knowledge_service.search_semantic(
            query=request.query,
            top_k=request.top_k,
        )
    elif request.search_type == "keyword":
        results = await knowledge_service.search_keyword(
            query=request.query,
            top_k=request.top_k,
        )
    else:
        results = await knowledge_service.search_hybrid(
            query=request.query,
            top_k=request.top_k,
        )
    
    return SearchResponse(
        query=request.query,
        results=[SearchResult(**r) for r in results],
        total=len(results),
    )


@router.get("/status")
async def get_rag_status(
    current_user: Annotated[User, Depends(get_current_user)],
    db: AsyncSession = Depends(get_db),
):
    """
    Get RAG system status.
    
    Returns whether RAG is enabled and if the embedding model is available.
    """
    status_info = {
        "rag_enabled": settings.RAG_ENABLED,
        "embedding_model": settings.RAG_EMBEDDING_MODEL,
        "embedding_dimensions": settings.RAG_EMBEDDING_DIMENSIONS,
        "top_k": settings.RAG_TOP_K,
        "similarity_threshold": settings.RAG_SIMILARITY_THRESHOLD,
    }
    
    if settings.RAG_ENABLED:
        try:
            from app.services.embedding_service import get_embedding_service
            redis = await get_redis()
            embedding_service = await get_embedding_service(redis)
            status_info["model_available"] = await embedding_service.is_available()
        except Exception as e:
            status_info["model_available"] = False
            status_info["error"] = str(e)
    
    return status_info

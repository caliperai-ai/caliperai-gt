"""
Knowledge Service - RAG orchestration for CaliperGT domain knowledge

Handles knowledge base indexing, hybrid search, and context retrieval.
Uses pgvector for semantic search and PostgreSQL full-text search for keywords.
"""
import hashlib
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import text, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.dialects.postgresql import insert

from app.core.config import settings
from app.services.embedding_service import EmbeddingService, get_embedding_service
from app.services.semantic_chunker import SemanticChunker, DocumentChunk

logger = logging.getLogger(__name__)


class KnowledgeService:
    """
    Service for managing and querying the CaliperGT knowledge base.
    
    Features:
    - Semantic search using pgvector
    - Keyword search using PostgreSQL full-text search  
    - Hybrid search combining both approaches
    - Redis caching for frequent queries
    - Incremental indexing with hash-based change detection
    """
    
    def __init__(
        self,
        db: AsyncSession,
        embedding_service: EmbeddingService = None,
        redis_client: Optional["Redis"] = None,
        knowledge_base_path: Optional[str] = None,
    ):
        self.db = db
        self.embedding_service = embedding_service
        self.redis = redis_client
        self.knowledge_base_path = Path(
            knowledge_base_path or settings.RAG_KNOWLEDGE_BASE_PATH
        )
        self.chunker: Optional[SemanticChunker] = None
        self._initialized = False
    
    async def initialize(self) -> None:
        """Initialize service with embedding model and chunker."""
        if self._initialized:
            return
        
        if self.embedding_service is None:
            self.embedding_service = await get_embedding_service(self.redis)
        
        if settings.RAG_ENABLED:
            await self.embedding_service.ensure_model_available()
        
        self.chunker = SemanticChunker(
            embedding_service=self.embedding_service,
            chunk_size=settings.RAG_CHUNK_SIZE,
            chunk_overlap=settings.RAG_CHUNK_OVERLAP,
        )
        
        self._initialized = True
    
    def _file_hash(self, file_path: Path) -> str:
        """Generate hash of file content for change detection."""
        content = file_path.read_text(encoding="utf-8")
        return hashlib.sha256(content.encode()).hexdigest()
    
    def _cache_key(self, query: str, search_type: str = "hybrid") -> str:
        """Generate cache key for search query."""
        query_hash = hashlib.md5(query.encode()).hexdigest()
        return f"rag_search:{search_type}:{query_hash}"
    
    async def _get_cached_results(
        self,
        query: str,
        search_type: str = "hybrid",
    ) -> Optional[List[Dict[str, Any]]]:
        """Get cached search results if available."""
        if self.redis is None:
            return None
        try:
            key = self._cache_key(query, search_type)
            cached = await self.redis.get(key)
            if cached:
                return json.loads(cached)
        except Exception as e:
            logger.warning(f"Cache read error: {e}")
        return None
    
    async def _cache_results(
        self,
        query: str,
        results: List[Dict[str, Any]],
        search_type: str = "hybrid",
    ) -> None:
        """Cache search results."""
        if self.redis is None:
            return
        try:
            key = self._cache_key(query, search_type)
            await self.redis.setex(
                key,
                settings.RAG_CACHE_TTL,
                json.dumps(results),
            )
        except Exception as e:
            logger.warning(f"Cache write error: {e}")
    
    async def load_knowledge_base(self) -> int:
        """
        Load all documents from the knowledge base directory.
        
        Processes markdown files, chunks them, and stores embeddings.
        Uses hash-based change detection for incremental updates.
        
        Returns:
            Number of chunks indexed
        """
        await self.initialize()
        
        if not self.knowledge_base_path.exists():
            logger.warning(f"Knowledge base path not found: {self.knowledge_base_path}")
            return 0
        
        md_files = list(self.knowledge_base_path.rglob("*.md"))
        logger.info(f"Found {len(md_files)} markdown files in knowledge base")
        
        existing_hashes = await self._get_existing_file_hashes()
        
        total_chunks = 0
        files_updated = 0
        files_skipped = 0
        
        for file_path in md_files:
            relative_path = str(file_path.relative_to(self.knowledge_base_path))
            file_hash = self._file_hash(file_path)
            
            if existing_hashes.get(relative_path) == file_hash:
                files_skipped += 1
                continue
            
            try:
                content = file_path.read_text(encoding="utf-8")
                chunks = await self.chunker.chunk_markdown(content, source_file=relative_path)
                
                await self._delete_file_chunks(relative_path)
                
                for chunk in chunks:
                    await self._store_chunk(chunk, file_hash)
                    total_chunks += 1
                
                await self.db.commit()
                files_updated += 1
                logger.debug(f"Indexed {len(chunks)} chunks from {relative_path}")
                
            except Exception as e:
                logger.error(f"Failed to index {relative_path}: {e}")
                await self.db.rollback()
        
        logger.info(
            f"Knowledge base indexing complete: "
            f"{files_updated} files updated, {files_skipped} skipped, "
            f"{total_chunks} total chunks indexed"
        )
        
        if files_updated > 0 and self.redis:
            await self._invalidate_cache()
        
        return total_chunks
    
    async def _get_existing_file_hashes(self) -> Dict[str, str]:
        """Get file hashes of all indexed documents."""
        result = await self.db.execute(
            text("""
                SELECT DISTINCT source_file, file_hash 
                FROM knowledge_chunks
            """)
        )
        return {row[0]: row[1] for row in result.fetchall()}
    
    async def _delete_file_chunks(self, source_file: str) -> None:
        """Delete all chunks from a specific file."""
        await self.db.execute(
            text("DELETE FROM knowledge_chunks WHERE source_file = :source_file"),
            {"source_file": source_file},
        )
    
    async def _store_chunk(self, chunk: DocumentChunk, file_hash: str) -> None:
        """Store a document chunk with its embedding."""
        import uuid as uuid_module
        
        embedding = await self.embedding_service.embed(chunk.content)
        
        embedding_str = "[" + ",".join(str(x) for x in embedding) + "]"
        
        await self.db.execute(
            text("""
                INSERT INTO knowledge_chunks 
                (id, content, source_file, chunk_index, content_hash, file_hash, 
                 metadata, embedding, search_vector, created_at)
                VALUES 
                (:id, :content, :source_file, :chunk_index, :content_hash, :file_hash,
                 :metadata, CAST(:embedding AS vector), to_tsvector('english', :content), NOW())
            """),
            {
                "id": str(uuid_module.uuid4()),
                "content": chunk.content,
                "source_file": chunk.source_file,
                "chunk_index": chunk.chunk_index,
                "content_hash": chunk.content_hash,
                "file_hash": file_hash,
                "metadata": json.dumps(chunk.metadata),
                "embedding": embedding_str,
            },
        )
        await self.db.commit()
    
    async def _invalidate_cache(self) -> None:
        """Invalidate all RAG search cache entries."""
        if self.redis is None:
            return
        try:
            async for key in self.redis.scan_iter("rag_search:*"):
                await self.redis.delete(key)
            logger.info("RAG search cache invalidated")
        except Exception as e:
            logger.warning(f"Failed to invalidate cache: {e}")
    
    async def search_semantic(
        self,
        query: str,
        top_k: int = None,
        threshold: float = None,
    ) -> List[Dict[str, Any]]:
        """
        Search using vector similarity only.
        
        Args:
            query: Search query
            top_k: Maximum results to return
            threshold: Minimum similarity score
            
        Returns:
            List of matching chunks with scores
        """
        await self.initialize()
        
        top_k = top_k or settings.RAG_TOP_K
        threshold = threshold or settings.RAG_SIMILARITY_THRESHOLD
        
        query_embedding = await self.embedding_service.embed(query)
        embedding_str = "[" + ",".join(str(x) for x in query_embedding) + "]"
        
        result = await self.db.execute(
            text("""
                SELECT 
                    id,
                    content,
                    source_file,
                    chunk_index,
                    metadata,
                    1 - (embedding <=> CAST(:embedding AS vector)) as similarity
                FROM knowledge_chunks
                WHERE 1 - (embedding <=> CAST(:embedding AS vector)) > :threshold
                ORDER BY embedding <=> CAST(:embedding AS vector)
                LIMIT :limit
            """),
            {
                "embedding": embedding_str,
                "threshold": threshold,
                "limit": top_k,
            },
        )
        
        rows = result.fetchall()
        return [
            {
                "id": row[0],
                "content": row[1],
                "source_file": row[2],
                "chunk_index": row[3],
                "metadata": json.loads(row[4]) if row[4] else {},
                "score": float(row[5]),
                "match_type": "semantic",
            }
            for row in rows
        ]
    
    async def search_keyword(
        self,
        query: str,
        top_k: int = None,
    ) -> List[Dict[str, Any]]:
        """
        Search using PostgreSQL full-text search.
        
        Args:
            query: Search query (will be converted to tsquery)
            top_k: Maximum results to return
            
        Returns:
            List of matching chunks with scores
        """
        top_k = top_k or settings.RAG_TOP_K
        
        words = query.split()
        tsquery = " & ".join(words)
        
        result = await self.db.execute(
            text("""
                SELECT 
                    id,
                    content,
                    source_file,
                    chunk_index,
                    metadata,
                    ts_rank(search_vector, plainto_tsquery('english', :query)) as rank
                FROM knowledge_chunks
                WHERE search_vector @@ plainto_tsquery('english', :query)
                ORDER BY rank DESC
                LIMIT :limit
            """),
            {
                "query": query,
                "limit": top_k,
            },
        )
        
        rows = result.fetchall()
        return [
            {
                "id": row[0],
                "content": row[1],
                "source_file": row[2],
                "chunk_index": row[3],
                "metadata": json.loads(row[4]) if row[4] else {},
                "score": float(row[5]) if row[5] else 0.0,
                "match_type": "keyword",
            }
            for row in rows
        ]
    
    async def search_hybrid(
        self,
        query: str,
        top_k: int = None,
        semantic_weight: float = 0.7,
    ) -> List[Dict[str, Any]]:
        """
        Hybrid search combining semantic and keyword search.
        
        Merges results from both approaches using weighted scoring.
        
        Args:
            query: Search query
            top_k: Maximum results to return
            semantic_weight: Weight for semantic scores (0.0 to 1.0)
            
        Returns:
            List of matching chunks with combined scores
        """
        await self.initialize()
        
        top_k = top_k or settings.RAG_TOP_K
        
        cached = await self._get_cached_results(query, "hybrid")
        if cached is not None:
            return cached[:top_k]
        
        semantic_results = await self.search_semantic(query, top_k=top_k * 2)
        keyword_results = await self.search_keyword(query, top_k=top_k * 2)
        
        seen_ids = set()
        merged = {}
        
        for result in semantic_results:
            chunk_id = result["id"]
            if chunk_id not in seen_ids:
                seen_ids.add(chunk_id)
                merged[chunk_id] = {
                    **result,
                    "semantic_score": result["score"],
                    "keyword_score": 0.0,
                }
        
        if keyword_results:
            max_keyword_score = max(r["score"] for r in keyword_results) or 1.0
        else:
            max_keyword_score = 1.0
        
        for result in keyword_results:
            chunk_id = result["id"]
            normalized_score = result["score"] / max_keyword_score
            
            if chunk_id in merged:
                merged[chunk_id]["keyword_score"] = normalized_score
            else:
                seen_ids.add(chunk_id)
                merged[chunk_id] = {
                    **result,
                    "semantic_score": 0.0,
                    "keyword_score": normalized_score,
                }
        
        keyword_weight = 1.0 - semantic_weight
        for chunk_id, result in merged.items():
            result["score"] = (
                result["semantic_score"] * semantic_weight +
                result["keyword_score"] * keyword_weight
            )
            result["match_type"] = "hybrid"
        
        final_results = sorted(
            merged.values(),
            key=lambda x: x["score"],
            reverse=True,
        )[:top_k]
        
        await self._cache_results(query, final_results, "hybrid")
        
        return final_results
    
    async def get_context_for_query(
        self,
        query: str,
        max_tokens: int = 2000,
    ) -> Tuple[str, List[Dict[str, Any]]]:
        """
        Get formatted context for RAG injection into LLM prompt.
        
        Args:
            query: User's question
            max_tokens: Approximate max context length
            
        Returns:
            Tuple of (formatted context string, source chunks)
        """
        if not settings.RAG_ENABLED:
            return "", []
        
        results = await self.search_hybrid(query)
        
        if not results:
            return "", []
        
        max_chars = max_tokens * 4
        
        context_parts = []
        sources = []
        current_length = 0
        
        for result in results:
            content = result["content"]
            source = result["source_file"]
            
            formatted = f"[From {source}]\n{content}\n"
            
            if current_length + len(formatted) > max_chars:
                break
            
            context_parts.append(formatted)
            sources.append(result)
            current_length += len(formatted)
        
        context = "\n---\n".join(context_parts)
        
        return context, sources
    
    async def get_stats(self) -> Dict[str, Any]:
        """Get knowledge base statistics."""
        result = await self.db.execute(
            text("""
                SELECT 
                    COUNT(*) as total_chunks,
                    COUNT(DISTINCT source_file) as total_files,
                    AVG(LENGTH(content)) as avg_chunk_size,
                    MAX(created_at) as last_indexed
                FROM knowledge_chunks
            """)
        )
        row = result.fetchone()
        
        return {
            "total_chunks": row[0] or 0,
            "total_files": row[1] or 0,
            "avg_chunk_size": int(row[2]) if row[2] else 0,
            "last_indexed": row[3].isoformat() if row[3] else None,
            "embedding_model": settings.RAG_EMBEDDING_MODEL,
            "embedding_dimensions": settings.RAG_EMBEDDING_DIMENSIONS,
        }


async def get_knowledge_service(
    db: AsyncSession,
    redis_client: Optional["Redis"] = None,
) -> KnowledgeService:
    """Create knowledge service instance."""
    embedding_service = await get_embedding_service(redis_client)
    return KnowledgeService(
        db=db,
        embedding_service=embedding_service,
        redis_client=redis_client,
    )

"""
Embedding Service - Vector embedding generation via Ollama

Uses Ollama's nomic-embed-text model for generating embeddings.
Supports batch embedding and caching via Redis.
"""
import hashlib
import json
import logging
from typing import List, Optional

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class EmbeddingService:
    """
    Service for generating text embeddings using Ollama.
    
    Uses nomic-embed-text model (768 dimensions) for high-quality embeddings.
    Includes Redis caching for frequently embedded texts.
    """
    
    def __init__(
        self,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        redis_client: Optional["Redis"] = None,
        cache_ttl: Optional[int] = None,
    ):
        self.base_url = base_url or settings.OLLAMA_BASE_URL
        self.model = model or settings.RAG_EMBEDDING_MODEL
        self.dimensions = settings.RAG_EMBEDDING_DIMENSIONS
        self.redis = redis_client
        self.cache_ttl = cache_ttl or settings.RAG_CACHE_TTL
        self._client: Optional[httpx.AsyncClient] = None
        
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client with connection pooling."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self.base_url,
                timeout=httpx.Timeout(30.0, connect=10.0),
            )
        return self._client
    
    async def close(self) -> None:
        """Close the HTTP client."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None
    
    def _cache_key(self, text: str) -> str:
        """Generate cache key for embedding."""
        text_hash = hashlib.md5(text.encode()).hexdigest()
        return f"embedding:{self.model}:{text_hash}"
    
    async def _get_cached(self, text: str) -> Optional[List[float]]:
        """Get embedding from cache if available."""
        if self.redis is None:
            return None
        try:
            key = self._cache_key(text)
            cached = await self.redis.get(key)
            if cached:
                return json.loads(cached)
        except Exception as e:
            logger.warning(f"Cache read error: {e}")
        return None
    
    async def _set_cached(self, text: str, embedding: List[float]) -> None:
        """Store embedding in cache."""
        if self.redis is None:
            return
        try:
            key = self._cache_key(text)
            await self.redis.setex(key, self.cache_ttl, json.dumps(embedding))
        except Exception as e:
            logger.warning(f"Cache write error: {e}")
    
    async def embed(self, text: str) -> List[float]:
        """
        Generate embedding for a single text.
        
        Args:
            text: Text to embed
            
        Returns:
            List of floats representing the embedding vector
            
        Raises:
            EmbeddingError: If embedding generation fails
        """
        cached = await self._get_cached(text)
        if cached is not None:
            return cached
        
        client = await self._get_client()
        try:
            response = await client.post(
                "/api/embeddings",
                json={
                    "model": self.model,
                    "prompt": text,
                }
            )
            response.raise_for_status()
            data = response.json()
            embedding = data.get("embedding", [])
            
            if not embedding:
                raise EmbeddingError(f"Empty embedding returned for text: {text[:50]}...")
            
            if len(embedding) != self.dimensions:
                logger.warning(
                    f"Embedding dimension mismatch: expected {self.dimensions}, "
                    f"got {len(embedding)}. Updating expected dimensions."
                )
            
            await self._set_cached(text, embedding)
            
            return embedding
            
        except httpx.HTTPStatusError as e:
            raise EmbeddingError(f"Ollama API error: {e.response.status_code}") from e
        except httpx.RequestError as e:
            raise EmbeddingError(f"Connection error to Ollama: {e}") from e
    
    async def embed_batch(
        self,
        texts: List[str],
        batch_size: int = 10,
    ) -> List[List[float]]:
        """
        Generate embeddings for multiple texts.
        
        Processes in batches to avoid overwhelming the API.
        Uses caching to skip already-embedded texts.
        
        Args:
            texts: List of texts to embed
            batch_size: Number of texts to process concurrently
            
        Returns:
            List of embedding vectors, one per input text
        """
        embeddings = []
        
        for i in range(0, len(texts), batch_size):
            batch = texts[i:i + batch_size]
            batch_embeddings = []
            
            for text in batch:
                try:
                    embedding = await self.embed(text)
                    batch_embeddings.append(embedding)
                except EmbeddingError as e:
                    logger.error(f"Failed to embed text: {e}")
                    batch_embeddings.append([0.0] * self.dimensions)
            
            embeddings.extend(batch_embeddings)
            
            if len(texts) > batch_size:
                logger.info(f"Embedded {min(i + batch_size, len(texts))}/{len(texts)} texts")
        
        return embeddings
    
    async def is_available(self) -> bool:
        """Check if embedding service is available."""
        try:
            client = await self._get_client()
            response = await client.get("/api/tags")
            if response.status_code == 200:
                models = response.json().get("models", [])
                model_names = [m.get("name", "") for m in models]
                return any(self.model in name for name in model_names)
            return False
        except Exception as e:
            logger.warning(f"Embedding availability check failed: {e}")
            return False
    
    async def ensure_model_available(self) -> bool:
        """
        Ensure the embedding model is pulled and ready.
        
        Pulls the model if not already available.
        """
        is_ready = await self.is_available()
        if is_ready:
            logger.info(f"Embedding model {self.model} is ready")
            return True
        
        logger.info(f"Pulling embedding model {self.model}...")
        try:
            client = await self._get_client()
            response = await client.post(
                "/api/pull",
                json={"name": self.model},
                timeout=httpx.Timeout(300.0),
            )
            response.raise_for_status()
            logger.info(f"Successfully pulled model {self.model}")
            return True
        except Exception as e:
            logger.error(f"Failed to pull model {self.model}: {e}")
            return False


class EmbeddingError(Exception):
    """Exception raised when embedding generation fails."""
    pass


_embedding_service: Optional[EmbeddingService] = None


async def get_embedding_service(
    redis_client: Optional["Redis"] = None,
) -> EmbeddingService:
    """
    Get or create embedding service singleton.
    
    Args:
        redis_client: Optional Redis client for caching
        
    Returns:
        EmbeddingService instance
    """
    global _embedding_service
    if _embedding_service is None:
        _embedding_service = EmbeddingService(redis_client=redis_client)
    return _embedding_service

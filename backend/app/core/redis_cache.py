"""Redis cache for point cloud data - shared across all workers."""
import hashlib
import time
from typing import Optional, Tuple
from redis import asyncio as aioredis
import logging

from app.core.config import get_settings

logger = logging.getLogger(__name__)
settings = get_settings()

_redis_client: Optional[aioredis.Redis] = None


async def init_redis():
    """Initialize Redis connection pool (plaintext on the internal network)."""
    global _redis_client
    try:
        _redis_client = await aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=False,
            max_connections=50,
            socket_keepalive=True,
            socket_connect_timeout=5,
            retry_on_timeout=True,
        )
        await _redis_client.ping()
        logger.info("Redis cache initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize Redis: {e}")
        _redis_client = None


async def close_redis():
    """Close Redis connection."""
    global _redis_client
    if _redis_client:
        await _redis_client.close()
        _redis_client = None
        logger.info("Redis cache closed")


def get_redis_client() -> Optional[aioredis.Redis]:
    """Get Redis client instance."""
    return _redis_client


async def get_redis() -> Optional[aioredis.Redis]:
    """
    Async function to get Redis client instance.
    
    Use this when you need to get the Redis client in an async context.
    If Redis is not initialized, returns None.
    """
    return _redis_client


class RedisPointCloudCache:
    """
    Redis-based cache for point cloud data — shared across Gunicorn workers.

    Stores the *processed* (possibly subsampled / recentered) binary blob along
    with metadata (offset, original_point_count). Both are deterministic
    functions of (source file, processing logic version), so bumping
    CACHE_VERSION below invalidates the entire cache automatically after a
    deploy — no manual flush required.
    """

    CACHE_VERSION = "v3"

    def __init__(self, prefix: str = "pcd:", ttl_seconds: int = 600):
        self.prefix = f"{prefix}{self.CACHE_VERSION}:"
        self.ttl_seconds = ttl_seconds

    def _make_key(self, file_path: str, mtime: float) -> str:
        """Create cache key from file path and modification time."""
        key_data = f"{file_path}:{mtime}"
        key_hash = hashlib.md5(key_data.encode()).hexdigest()
        return f"{self.prefix}{key_hash}"

    async def get(
        self, file_path: str, mtime: float
    ) -> Optional[Tuple[bytes, bytes, Optional[bytes], int, dict]]:
        """
        Get cached data if available and not expired.
        Returns (positions_bytes, intensities_bytes, colors_bytes_or_None,
        point_count, metadata) or None. metadata always contains 'offset'
        (3-float list or None) and 'original_point_count' (int). Colors are
        omitted (None) for files without per-point RGB.
        """
        if not _redis_client:
            return None

        try:
            key = self._make_key(file_path, mtime)

            pipeline = _redis_client.pipeline()
            pipeline.get(f"{key}:pos")
            pipeline.get(f"{key}:int")
            pipeline.get(f"{key}:cnt")
            pipeline.get(f"{key}:meta")
            pipeline.get(f"{key}:col")

            results = await pipeline.execute()

            if results[0] and results[1] and results[2]:
                positions_bytes = results[0]
                intensities_bytes = results[1]
                point_count = int(results[2])
                meta: dict = {"offset": None, "original_point_count": point_count}
                if results[3]:
                    import json as _json
                    try:
                        meta = _json.loads(results[3])
                    except Exception:
                        pass
                colors_bytes = results[4] if results[4] else None
                return (positions_bytes, intensities_bytes, colors_bytes, point_count, meta)

        except Exception as e:
            logger.warning(f"Redis cache get error: {e}")

        return None

    async def set(
        self,
        file_path: str,
        mtime: float,
        positions: bytes,
        intensities: bytes,
        count: int,
        metadata: Optional[dict] = None,
        colors: Optional[bytes] = None,
    ):
        """Cache parsed point cloud data with TTL.

        metadata: optional dict with 'offset' and 'original_point_count'.
        colors:   optional packed Float32 RGB blob (3*N floats in [0,1]).
        """
        if not _redis_client:
            return

        try:
            key = self._make_key(file_path, mtime)

            pipeline = _redis_client.pipeline()
            pipeline.setex(f"{key}:pos", self.ttl_seconds, positions)
            pipeline.setex(f"{key}:int", self.ttl_seconds, intensities)
            pipeline.setex(f"{key}:cnt", self.ttl_seconds, str(count))
            if metadata is not None:
                import json as _json
                pipeline.setex(f"{key}:meta", self.ttl_seconds, _json.dumps(metadata))
            if colors is not None:
                pipeline.setex(f"{key}:col", self.ttl_seconds, colors)

            await pipeline.execute()

        except Exception as e:
            logger.warning(f"Redis cache set error: {e}")
    
    async def clear(self):
        """Clear all cached data with this prefix."""
        if not _redis_client:
            return
        
        try:
            async for key in _redis_client.scan_iter(match=f"{self.prefix}*"):
                await _redis_client.delete(key)
        except Exception as e:
            logger.warning(f"Redis cache clear error: {e}")


class RedisGzipCache:
    """Redis-based cache for pre-compressed gzip responses."""
    
    def __init__(self, prefix: str = "gzip:", ttl_seconds: int = 600):
        self.prefix = prefix
        self.ttl_seconds = ttl_seconds
    
    def _make_key(self, file_path: str, point_count: int) -> str:
        """Create cache key from file path and point count."""
        key_data = f"{file_path}:{point_count}"
        key_hash = hashlib.md5(key_data.encode()).hexdigest()
        return f"{self.prefix}{key_hash}"
    
    async def get(self, file_path: str, point_count: int) -> Optional[bytes]:
        """Get cached gzip data."""
        if not _redis_client:
            return None
        
        try:
            key = self._make_key(file_path, point_count)
            result = await _redis_client.get(key)
            return result
        except Exception as e:
            logger.warning(f"Redis gzip cache get error: {e}")
            return None
    
    async def set(self, file_path: str, point_count: int, compressed_data: bytes):
        """Cache gzip-compressed data with TTL."""
        if not _redis_client:
            return
        
        try:
            key = self._make_key(file_path, point_count)
            await _redis_client.setex(key, self.ttl_seconds, compressed_data)
        except Exception as e:
            logger.warning(f"Redis gzip cache set error: {e}")


redis_pcd_cache = RedisPointCloudCache(ttl_seconds=3600)
redis_gzip_cache = RedisGzipCache(ttl_seconds=3600)

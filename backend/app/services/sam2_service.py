"""
SAM2 Segmentation Service

Provides both mock and real SAM2 inference for interactive segmentation.
Optimized for low latency with image embedding caching.
"""
import os
import logging
import hashlib
import asyncio
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
import numpy as np
from PIL import Image
import io
import httpx
import base64
from functools import lru_cache
from collections import OrderedDict
import time

logger = logging.getLogger(__name__)

SAM2_MODE = os.getenv("SAM2_MODE", "mock")
SAM2_MODEL_SIZE = os.getenv("SAM2_MODEL_SIZE", "large")
SAM2_DEVICE = os.getenv("SAM2_DEVICE", "cuda")
SAM2_API_URL = os.getenv("SAM2_API_URL", "http://sam2:8001")
SAM2_CACHE_SIZE = int(os.getenv("SAM2_CACHE_SIZE", "100"))


@dataclass
class PointPrompt:
    """A point prompt for SAM2."""
    x: float
    y: float
    label: int


@dataclass
class BoxPrompt:
    """A box prompt for SAM2."""
    x1: float
    y1: float
    x2: float
    y2: float


@dataclass
class SegmentationResult:
    """Result from SAM2 segmentation."""
    polygon: List[Tuple[float, float]]
    score: float
    area: int
    rle: Optional[str] = None


class LRUCache:
    """LRU Cache implementation with size limit and TTL."""
    
    def __init__(self, max_size: int = 100, ttl_seconds: int = 3600):
        self._cache = OrderedDict()
        self._max_size = max_size
        self._ttl = ttl_seconds
        self._timestamps = {}
    
    def get(self, key: str) -> Optional[Any]:
        """Get item from cache."""
        if key not in self._cache:
            return None
        
        if time.time() - self._timestamps[key] > self._ttl:
            del self._cache[key]
            del self._timestamps[key]
            return None
        
        self._cache.move_to_end(key)
        return self._cache[key]
    
    def set(self, key: str, value: Any):
        """Set item in cache."""
        if key in self._cache:
            self._cache.move_to_end(key)
        else:
            if len(self._cache) >= self._max_size:
                oldest_key = next(iter(self._cache))
                del self._cache[oldest_key]
                del self._timestamps[oldest_key]
                logger.debug(f"LRU Cache evicted {oldest_key}")
            self._cache[key] = value
        
        self._timestamps[key] = time.time()
    
    def __contains__(self, key: str) -> bool:
        return self.get(key) is not None
    
    def size(self) -> int:
        return len(self._cache)


class SAM2ServiceBase:
    """Base class for SAM2 services."""
    
    async def segment(
        self,
        image_data: bytes,
        points: List[PointPrompt],
        box: Optional[BoxPrompt] = None,
        multimask_output: bool = False,
        simplify_tolerance: float = 0.01,
    ) -> List[SegmentationResult]:
        """Run segmentation on an image with point/box prompts."""
        raise NotImplementedError
    
    async def get_embedding(self, image_data: bytes) -> str:
        """Get or compute image embedding, returns cache key."""
        raise NotImplementedError
    
    async def segment_with_embedding(
        self,
        embedding_key: str,
        points: List[PointPrompt],
        box: Optional[BoxPrompt] = None,
        simplify_tolerance: float = 0.01,
    ) -> List[SegmentationResult]:
        """Run segmentation using cached embedding (faster for multiple prompts on same image)."""
        raise NotImplementedError


class MockSAM2Service(SAM2ServiceBase):
    """
    Mock SAM2 service for development/testing.
    Returns realistic-looking segmentation masks based on click positions.
    Super low latency (~5-10ms).
    """
    
    def __init__(self):
        self._embedding_cache = LRUCache(max_size=SAM2_CACHE_SIZE, ttl_seconds=3600)
        logger.info(f"MockSAM2Service initialized with cache size {SAM2_CACHE_SIZE}")
    
    def _generate_polygon_from_points(
        self,
        points: List[PointPrompt],
        image_width: int,
        image_height: int,
    ) -> List[Tuple[float, float]]:
        """Generate a realistic-looking polygon around positive points."""
        if not points:
            return []
        
        positive_points = [p for p in points if p.label == 1]
        negative_points = [p for p in points if p.label == 0]
        
        if not positive_points:
            return []
        
        cx = sum(p.x for p in positive_points) / len(positive_points)
        cy = sum(p.y for p in positive_points) / len(positive_points)
        
        if len(positive_points) > 1:
            max_dist = max(
                ((p.x - cx) ** 2 + (p.y - cy) ** 2) ** 0.5
                for p in positive_points
            )
            base_radius = max(max_dist * 1.5, 50)
        else:
            base_radius = min(image_width, image_height) * 0.15
        
        num_points = 24
        polygon = []
        
        for i in range(num_points):
            angle = (2 * np.pi * i) / num_points
            np.random.seed(int(cx + cy + i) % 1000)
            radius_variation = 0.8 + 0.4 * np.random.random()
            radius = base_radius * radius_variation
            
            for neg in negative_points:
                neg_angle = np.arctan2(neg.y - cy, neg.x - cx)
                angle_diff = abs(angle - neg_angle)
                if angle_diff > np.pi:
                    angle_diff = 2 * np.pi - angle_diff
                
                if angle_diff < np.pi / 4:
                    dist_to_neg = ((neg.x - cx) ** 2 + (neg.y - cy) ** 2) ** 0.5
                    radius = min(radius, dist_to_neg * 0.5)
            
            x = cx + radius * np.cos(angle)
            y = cy + radius * np.sin(angle)
            
            x = max(0, min(image_width - 1, x))
            y = max(0, min(image_height - 1, y))
            
            polygon.append((float(x), float(y)))
        
        return polygon
    
    def _compute_image_hash(self, image_data: bytes) -> str:
        """Compute hash for image caching."""
        return hashlib.md5(image_data).hexdigest()[:16]
    
    async def get_embedding(self, image_data: bytes) -> str:
        """Mock embedding - just returns image hash."""
        cache_key = self._compute_image_hash(image_data)
        
        if cache_key not in self._embedding_cache:
            img = Image.open(io.BytesIO(image_data))
            self._embedding_cache.set(cache_key, {
                "width": img.width,
                "height": img.height,
            })
            logger.debug(f"Mock embedding created for {cache_key}")
        
        return cache_key
    
    async def segment(
        self,
        image_data: bytes,
        points: List[PointPrompt],
        box: Optional[BoxPrompt] = None,
        multimask_output: bool = False,
    ) -> List[SegmentationResult]:
        """Run mock segmentation."""
        img = Image.open(io.BytesIO(image_data))
        width, height = img.width, img.height
        
        polygon = self._generate_polygon_from_points(points, width, height)
        
        if not polygon:
            return []
        
        area = self._polygon_area(polygon)
        
        result = SegmentationResult(
            polygon=polygon,
            score=0.95 + 0.05 * np.random.random(),
            area=int(area),
        )
        
        return [result]
    
    async def segment_with_embedding(
        self,
        embedding_key: str,
        points: List[PointPrompt],
        box: Optional[BoxPrompt] = None,
        simplify_tolerance: float = 0.01,
    ) -> List[SegmentationResult]:
        """Run mock segmentation using cached dimensions."""
        cache_data = self._embedding_cache.get(embedding_key)
        if cache_data is None:
            raise ValueError(f"Embedding not found: {embedding_key}")
        
        width = cache_data["width"]
        height = cache_data["height"]
        
        polygon = self._generate_polygon_from_points(points, width, height)
        
        if not polygon:
            return []
        
        area = self._polygon_area(polygon)
        
        return [SegmentationResult(
            polygon=polygon,
            score=0.95 + 0.05 * np.random.random(),
            area=int(area),
        )]
    
    def _polygon_area(self, polygon: List[Tuple[float, float]]) -> float:
        """Calculate polygon area using shoelace formula."""
        n = len(polygon)
        if n < 3:
            return 0
        
        area = 0
        for i in range(n):
            j = (i + 1) % n
            area += polygon[i][0] * polygon[j][1]
            area -= polygon[j][0] * polygon[i][1]
        
        return abs(area) / 2


class EmbeddedSAM2Service(SAM2ServiceBase):
    """
    Embedded SAM2 service using the actual SAM2 model.
    Requires GPU and PyTorch with SAM2 installed.
    Uses LRU embedding caching for low latency on repeated prompts.
    """
    
    def __init__(self):
        self._model = None
        self._predictor = None
        self._embedding_cache = LRUCache(max_size=SAM2_CACHE_SIZE, ttl_seconds=3600)
        self._device = SAM2_DEVICE
        self._initialized = False
        logger.info(f"EmbeddedSAM2Service initializing with device={self._device}, cache size {SAM2_CACHE_SIZE}")
    
    def _lazy_init(self):
        """Lazy initialization of SAM2 model."""
        if self._initialized:
            return
        
        try:
            import torch
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor
            
            model_configs = {
                "tiny": ("sam2_hiera_t.yaml", "sam2_hiera_tiny.pt"),
                "small": ("sam2_hiera_s.yaml", "sam2_hiera_small.pt"),
                "base": ("sam2_hiera_b+.yaml", "sam2_hiera_base_plus.pt"),
                "large": ("sam2_hiera_l.yaml", "sam2_hiera_large.pt"),
            }
            
            config, checkpoint = model_configs.get(SAM2_MODEL_SIZE, model_configs["large"])
            checkpoint_path = os.path.join("/models/sam2", checkpoint)
            
            if not os.path.exists(checkpoint_path):
                logger.warning(f"SAM2 checkpoint not found at {checkpoint_path}, falling back to mock")
                raise FileNotFoundError(f"SAM2 checkpoint not found: {checkpoint_path}")
            
            self._model = build_sam2(config, checkpoint_path, device=self._device)
            self._predictor = SAM2ImagePredictor(self._model)
            self._initialized = True
            logger.info(f"SAM2 model loaded: {SAM2_MODEL_SIZE} on {self._device}")
            
        except Exception as e:
            logger.error(f"Failed to initialize SAM2: {e}")
            raise
    
    def _compute_image_hash(self, image_data: bytes) -> str:
        """Compute hash for image caching."""
        return hashlib.md5(image_data).hexdigest()[:16]
    
    async def get_embedding(self, image_data: bytes) -> str:
        """Compute and cache image embedding."""
        self._lazy_init()
        
        cache_key = self._compute_image_hash(image_data)
        
        cached = self._embedding_cache.get(cache_key)
        if cached is None:
            img = Image.open(io.BytesIO(image_data)).convert("RGB")
            img_array = np.array(img)
            
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self._predictor.set_image, img_array)
            
            self._embedding_cache.set(cache_key, {
                "width": img.width,
                "height": img.height,
                "features": self._predictor.get_image_embedding(),
            })
            logger.debug(f"Computed and cached embedding for {cache_key} (cache size: {self._embedding_cache.size()})")
        else:
            logger.debug(f"Using cached embedding for {cache_key}")
        
        return cache_key
    
    async def segment(
        self,
        image_data: bytes,
        points: List[PointPrompt],
        box: Optional[BoxPrompt] = None,
        multimask_output: bool = False,
        simplify_tolerance: float = 0.01,
    ) -> List[SegmentationResult]:
        """Run SAM2 segmentation."""
        self._lazy_init()
        
        img = Image.open(io.BytesIO(image_data)).convert("RGB")
        img_array = np.array(img)
        
        self._predictor.set_image(img_array)
        
        point_coords = np.array([[p.x, p.y] for p in points]) if points else None
        point_labels = np.array([p.label for p in points]) if points else None
        
        box_prompt = None
        if box:
            box_prompt = np.array([box.x1, box.y1, box.x2, box.y2])
        
        masks, scores, _ = self._predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            box=box_prompt,
            multimask_output=multimask_output,
        )
        
        results = []
        for mask, score in zip(masks, scores):
            polygon = self._mask_to_polygon(mask, simplify_tolerance=simplify_tolerance)
            if polygon:
                results.append(SegmentationResult(
                    polygon=polygon,
                    score=float(score),
                    area=int(mask.sum()),
                ))
        
        return results
    
    async def segment_with_embedding(
        self,
        embedding_key: str,
        points: List[PointPrompt],
        box: Optional[BoxPrompt] = None,
        simplify_tolerance: float = 0.01,
    ) -> List[SegmentationResult]:
        """Run SAM2 segmentation using cached embedding (fast path)."""
        self._lazy_init()
        
        cache_data = self._embedding_cache.get(embedding_key)
        if cache_data is None:
            raise ValueError(f"Embedding not found: {embedding_key}")
        
        self._predictor.features = cache_data["features"]
        self._predictor.orig_hw = (cache_data["height"], cache_data["width"])
        
        point_coords = np.array([[p.x, p.y] for p in points]) if points else None
        point_labels = np.array([p.label for p in points]) if points else None
        
        box_prompt = None
        if box:
            box_prompt = np.array([box.x1, box.y1, box.x2, box.y2])
        
        masks, scores, _ = self._predictor.predict(
            point_coords=point_coords,
            point_labels=point_labels,
            box=box_prompt,
            multimask_output=False,
        )
        
        results = []
        for mask, score in zip(masks, scores):
            polygon = self._mask_to_polygon(mask, simplify_tolerance=simplify_tolerance)
            if polygon:
                results.append(SegmentationResult(
                    polygon=polygon,
                    score=float(score),
                    area=int(mask.sum()),
                ))
        
        return results
    
    def _mask_to_polygon(self, mask: np.ndarray, simplify_tolerance: float = 0.01) -> List[Tuple[float, float]]:
        """Convert binary mask to polygon points."""
        try:
            import cv2
            
            mask_uint8 = (mask * 255).astype(np.uint8)
            contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            
            if not contours:
                return []
            
            largest = max(contours, key=cv2.contourArea)
            
            epsilon = simplify_tolerance * cv2.arcLength(largest, True)
            simplified = cv2.approxPolyDP(largest, epsilon, True)
            
            polygon = [(float(pt[0][0]), float(pt[0][1])) for pt in simplified]
            
            return polygon
            
        except ImportError:
            logger.warning("OpenCV not available for mask-to-polygon conversion")
            return []


class APISAM2Service(SAM2ServiceBase):
    """
    SAM2 service that calls a separate GPU-enabled SAM2 microservice.
    This is the recommended mode for production deployments.
    
    The API service runs SAM2 in a dedicated GPU container, providing:
    - Better resource isolation
    - Easier GPU memory management
    - Independent scaling of API and ML workloads
    """
    
    def __init__(self, api_url: str = None):
        self._api_url = api_url or SAM2_API_URL
        self._client = httpx.AsyncClient(timeout=60.0)
        self._embedding_cache = LRUCache(max_size=SAM2_CACHE_SIZE, ttl_seconds=3600)
        logger.info(f"APISAM2Service initialized, connecting to {self._api_url}, cache size {SAM2_CACHE_SIZE}")
    
    async def health_check(self) -> bool:
        """Check if the SAM2 API service is healthy."""
        try:
            response = await self._client.get(f"{self._api_url}/health")
            return response.status_code == 200
        except Exception as e:
            logger.error(f"SAM2 API health check failed: {e}")
            return False
    
    def _compute_image_hash(self, image_data: bytes) -> str:
        """Compute hash for local caching."""
        return hashlib.md5(image_data).hexdigest()[:16]
    
    async def get_embedding(self, image_data: bytes) -> str:
        """Request embedding from the API service."""
        local_hash = self._compute_image_hash(image_data)
        
        cached = self._embedding_cache.get(local_hash)
        if cached is not None:
            logger.debug(f"Using cached API embedding for {local_hash}")
            return cached
        
        try:
            image_b64 = base64.b64encode(image_data).decode()
            response = await self._client.post(
                f"{self._api_url}/embedding",
                json={"image_base64": image_b64}
            )
            response.raise_for_status()
            
            result = response.json()
            embedding_id = result["embedding_key"]
            self._embedding_cache.set(local_hash, embedding_id)
            logger.debug(f"API embedding created and cached: {local_hash} -> {embedding_id} (cache size: {self._embedding_cache.size()})")
            return embedding_id
            
        except Exception as e:
            logger.error(f"Failed to get embedding from API: {e}")
            raise
    
    async def segment(
        self,
        image_data: bytes,
        points: List[PointPrompt],
        box: Optional[BoxPrompt] = None,
        multimask_output: bool = True,
        simplify_tolerance: float = 0.01,
    ) -> List[SegmentationResult]:
        """Run segmentation via the API service."""
        try:
            image_b64 = base64.b64encode(image_data).decode()
            
            request_data = {
                "image_base64": image_b64,
                "points": [
                    {"x": p.x, "y": p.y, "label": p.label}
                    for p in points
                ],
                "multimask_output": multimask_output,
                "simplify_tolerance": simplify_tolerance,
            }
            
            if box:
                request_data["box"] = {
                    "x1": box.x1, "y1": box.y1,
                    "x2": box.x2, "y2": box.y2
                }
            
            response = await self._client.post(
                f"{self._api_url}/segment",
                json=request_data
            )
            response.raise_for_status()
            
            result = response.json()
            
            results = []
            for mask_data in result.get("masks", []):
                polygon = [(pt["x"], pt["y"]) for pt in mask_data.get("polygon", [])]
                if polygon:
                    results.append(SegmentationResult(
                        polygon=polygon,
                        score=mask_data.get("score", 0.0),
                        area=mask_data.get("area", 0),
                    ))
            
            logger.debug(f"API segmentation returned {len(results)} masks")
            return results
            
        except Exception as e:
            logger.error(f"API segmentation failed: {e}")
            raise
    
    async def segment_with_embedding(
        self,
        embedding_key: str,
        points: List[PointPrompt],
        box: Optional[BoxPrompt] = None,
        simplify_tolerance: float = 0.01,
    ) -> List[SegmentationResult]:
        """Run segmentation using a cached embedding (faster)."""
        try:
            request_data = {
                "embedding_key": embedding_key,
                "points": [
                    {"x": p.x, "y": p.y, "label": p.label}
                    for p in points
                ],
                "multimask_output": True,
                "simplify_tolerance": simplify_tolerance,
            }
            
            if box:
                request_data["box"] = {
                    "x1": box.x1, "y1": box.y1,
                    "x2": box.x2, "y2": box.y2
                }
            
            response = await self._client.post(
                f"{self._api_url}/segment",
                json=request_data
            )
            response.raise_for_status()
            
            result = response.json()
            
            results = []
            for mask_data in result.get("masks", []):
                polygon = [(pt["x"], pt["y"]) for pt in mask_data.get("polygon", [])]
                if polygon:
                    results.append(SegmentationResult(
                        polygon=polygon,
                        score=mask_data.get("score", 0.0),
                        area=mask_data.get("area", 0),
                    ))
            
            return results
            
        except Exception as e:
            logger.error(f"API segmentation with embedding failed: {e}")
            raise
    
    async def close(self):
        """Close the HTTP client."""
        await self._client.aclose()


_sam2_service: Optional[SAM2ServiceBase] = None


def get_sam2_service() -> SAM2ServiceBase:
    """Get the SAM2 service singleton."""
    global _sam2_service
    
    if _sam2_service is None:
        if SAM2_MODE == "api":
            logger.info(f"Initializing SAM2 in API mode, connecting to {SAM2_API_URL}")
            _sam2_service = APISAM2Service()
        elif SAM2_MODE == "embedded":
            try:
                _sam2_service = EmbeddedSAM2Service()
            except Exception as e:
                logger.warning(f"Failed to initialize embedded SAM2, falling back to mock: {e}")
                _sam2_service = MockSAM2Service()
        else:
            logger.info("SAM2 running in mock mode")
            _sam2_service = MockSAM2Service()
    
    return _sam2_service


async def segment_image(
    image_data: bytes,
    points: List[Dict[str, Any]],
    box: Optional[Dict[str, float]] = None,
    multimask_output: bool = True,
) -> List[Dict[str, Any]]:
    """
    High-level API for segmenting an image.
    
    Args:
        image_data: Raw image bytes
        points: List of {"x": float, "y": float, "label": int} dicts
        box: Optional {"x1": float, "y1": float, "x2": float, "y2": float} dict
        multimask_output: If True, returns multiple mask options (recommended)
    
    Returns:
        List of segmentation results with polygon, score, and area.
        When multimask_output=True, returns up to 3 masks sorted by score.
    """
    service = get_sam2_service()
    
    point_prompts = [PointPrompt(x=p["x"], y=p["y"], label=p["label"]) for p in points]
    box_prompt = BoxPrompt(**box) if box else None
    
    results = await service.segment(image_data, point_prompts, box_prompt, multimask_output)
    
    results.sort(key=lambda r: r.score, reverse=True)
    
    return [
        {
            "polygon": [{"x": x, "y": y} for x, y in r.polygon],
            "score": r.score,
            "area": r.area,
        }
        for r in results
    ]

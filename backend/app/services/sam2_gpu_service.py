"""
SAM2 GPU Service - Standalone FastAPI service for SAM2 inference.

This runs as a separate microservice with GPU access.
The main backend calls this service for segmentation.
"""
import os
import io
import time
import base64
import hashlib
import logging
from typing import List, Optional, Dict, Any, Tuple
from dataclasses import dataclass
from contextlib import asynccontextmanager

import numpy as np
from PIL import Image
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

SAM2_MODEL_SIZE = os.getenv("SAM2_MODEL_SIZE", "large")
SAM2_DEVICE = os.getenv("SAM2_DEVICE", "cuda")
MODEL_DIR = os.getenv("SAM2_MODEL_DIR", "/models/sam2")



@dataclass
class SegmentationResult:
    """Result from SAM2 segmentation."""
    polygon: List[Tuple[float, float]]
    score: float
    area: int
    mask_index: int = 0



class SAM2Model:
    """Wrapper for SAM2 model with embedding caching."""
    
    def __init__(self):
        self.model = None
        self.predictor = None
        self.device = SAM2_DEVICE
        self.model_size = SAM2_MODEL_SIZE
        self._embedding_cache: Dict[str, Dict[str, Any]] = {}
        self._max_cache_size = 50
        self._initialized = False
        
    def initialize(self):
        """Load SAM2 model."""
        if self._initialized:
            return
            
        try:
            import torch
            
            if self.device == "cuda" and not torch.cuda.is_available():
                logger.warning("CUDA not available, falling back to CPU")
                self.device = "cpu"
            
            logger.info(f"Loading SAM2 model: {self.model_size} on {self.device}")
            
            from sam2.build_sam import build_sam2
            from sam2.sam2_image_predictor import SAM2ImagePredictor
            
            model_configs = {
                "tiny": ("configs/sam2.1/sam2.1_hiera_t.yaml", "sam2.1_hiera_tiny.pt"),
                "small": ("configs/sam2.1/sam2.1_hiera_s.yaml", "sam2.1_hiera_small.pt"),
                "base": ("configs/sam2.1/sam2.1_hiera_b+.yaml", "sam2.1_hiera_base_plus.pt"),
                "large": ("configs/sam2.1/sam2.1_hiera_l.yaml", "sam2.1_hiera_large.pt"),
            }
            
            config_name, checkpoint_name = model_configs.get(
                self.model_size, 
                model_configs["large"]
            )
            
            checkpoint_path = os.path.join(MODEL_DIR, checkpoint_name)
            
            if not os.path.exists(checkpoint_path):
                raise FileNotFoundError(
                    f"Model checkpoint not found: {checkpoint_path}. "
                    f"Run download_models.py first."
                )
            
            self.model = build_sam2(config_name, checkpoint_path, device=self.device)
            self.predictor = SAM2ImagePredictor(self.model)
            
            self._initialized = True
            logger.info(f"SAM2 model loaded successfully on {self.device}")
            
            if self.device == "cuda":
                memory_allocated = torch.cuda.memory_allocated() / 1024**3
                logger.info(f"GPU memory allocated: {memory_allocated:.2f} GB")
                
        except ImportError as e:
            logger.error(f"Failed to import SAM2: {e}")
            raise RuntimeError("SAM2 not installed. Install with: pip install segment-anything-2")
        except Exception as e:
            logger.error(f"Failed to initialize SAM2: {e}")
            raise
    
    def _compute_hash(self, data: bytes) -> str:
        """Compute hash for caching."""
        return hashlib.md5(data).hexdigest()[:16]
    
    def _manage_cache(self):
        """Evict old embeddings if cache is full."""
        if len(self._embedding_cache) >= self._max_cache_size:
            oldest_key = next(iter(self._embedding_cache))
            del self._embedding_cache[oldest_key]
            logger.debug(f"Evicted embedding: {oldest_key}")
    
    def get_embedding(self, image_data: bytes) -> str:
        """Compute and cache image embedding."""
        import torch
        
        cache_key = self._compute_hash(image_data)
        
        if cache_key not in self._embedding_cache:
            self._manage_cache()
            
            img = Image.open(io.BytesIO(image_data)).convert("RGB")
            img_array = np.array(img)
            
            with torch.inference_mode():
                self.predictor.set_image(img_array)
            
            self._embedding_cache[cache_key] = {
                "width": img.width,
                "height": img.height,
                "features": self.predictor._features,
                "orig_hw": self.predictor._orig_hw,
            }
            
            logger.info(f"Computed embedding for {cache_key} ({img.width}x{img.height})")
        
        return cache_key
    
    def segment(
        self,
        image_data: bytes,
        points: List[Tuple[float, float, int]],
        box: Optional[Tuple[float, float, float, float]] = None,
        multimask_output: bool = True,
    ) -> List[SegmentationResult]:
        """Run segmentation on an image."""
        import torch
        
        cache_key = self.get_embedding(image_data)
        cache_data = self._embedding_cache[cache_key]
        
        self.predictor._features = cache_data["features"]
        self.predictor._orig_hw = cache_data["orig_hw"]
        self.predictor._is_image_set = True
        self.predictor._is_batch = False
        
        point_coords = None
        point_labels = None
        
        if points:
            point_coords = np.array([[p[0], p[1]] for p in points])
            point_labels = np.array([p[2] for p in points])
        
        box_prompt = None
        if box:
            box_prompt = np.array([box[0], box[1], box[2], box[3]])
        
        with torch.inference_mode():
            masks, scores, logits = self.predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                box=box_prompt,
                multimask_output=multimask_output,
            )
        
        results = []
        for idx, (mask, score) in enumerate(zip(masks, scores)):
            polygon = self._mask_to_polygon(mask)
            if polygon and len(polygon) >= 3:
                results.append(SegmentationResult(
                    polygon=polygon,
                    score=float(score),
                    area=int(mask.sum()),
                    mask_index=idx,
                ))
        
        results.sort(key=lambda r: r.score, reverse=True)
        
        return results
    
    def segment_with_embedding(
        self,
        embedding_key: str,
        points: List[Tuple[float, float, int]],
        box: Optional[Tuple[float, float, float, float]] = None,
        multimask_output: bool = True,
        simplify_tolerance: float = 0.01,
    ) -> List[SegmentationResult]:
        """Run segmentation using cached embedding (fast path)."""
        import torch
        
        if embedding_key not in self._embedding_cache:
            raise ValueError(f"Embedding not found: {embedding_key}")
        
        cache_data = self._embedding_cache[embedding_key]
        
        self.predictor._features = cache_data["features"]
        self.predictor._orig_hw = cache_data["orig_hw"]
        self.predictor._is_image_set = True
        self.predictor._is_batch = False
        
        point_coords = None
        point_labels = None
        
        if points:
            point_coords = np.array([[p[0], p[1]] for p in points])
            point_labels = np.array([p[2] for p in points])
        
        box_prompt = None
        if box:
            box_prompt = np.array([box[0], box[1], box[2], box[3]])
        
        with torch.inference_mode():
            masks, scores, logits = self.predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                box=box_prompt,
                multimask_output=multimask_output,
            )
        
        results = []
        for idx, (mask, score) in enumerate(zip(masks, scores)):
            polygon = self._mask_to_polygon(mask, simplify_tolerance=simplify_tolerance)
            if polygon and len(polygon) >= 3:
                results.append(SegmentationResult(
                    polygon=polygon,
                    score=float(score),
                    area=int(mask.sum()),
                    mask_index=idx,
                ))
        
        results.sort(key=lambda r: r.score, reverse=True)
        return results
    
    def _mask_to_polygon(self, mask: np.ndarray, simplify_tolerance: float = 0.001) -> List[Tuple[float, float]]:
        """Convert binary mask to polygon using OpenCV contour detection."""
        try:
            import cv2
            
            mask_uint8 = (mask.astype(np.uint8) * 255)
            
            contours, _ = cv2.findContours(
                mask_uint8, 
                cv2.RETR_EXTERNAL, 
                cv2.CHAIN_APPROX_SIMPLE
            )
            
            if not contours:
                return []
            
            largest_contour = max(contours, key=cv2.contourArea)
            
            perimeter = cv2.arcLength(largest_contour, True)
            epsilon = simplify_tolerance * perimeter
            simplified = cv2.approxPolyDP(largest_contour, epsilon, True)
            
            polygon = [(float(pt[0][0]), float(pt[0][1])) for pt in simplified]
            
            return polygon
            
        except ImportError:
            logger.error("OpenCV not available for polygon conversion")
            return []
        except Exception as e:
            logger.error(f"Error converting mask to polygon: {e}")
            return []



sam2_model: Optional[SAM2Model] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Initialize model on startup."""
    global sam2_model
    sam2_model = SAM2Model()
    
    try:
        sam2_model.initialize()
        logger.info("SAM2 model ready for inference")
    except Exception as e:
        logger.error(f"Failed to initialize SAM2: {e}")
    
    yield
    
    logger.info("Shutting down SAM2 service")


app = FastAPI(
    title="SAM2 GPU Service",
    description="Segment Anything 2 inference service with GPU acceleration",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



class PointPrompt(BaseModel):
    x: float
    y: float
    label: int = Field(..., ge=0, le=1, description="1=foreground, 0=background")


class BoxPrompt(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float


class SegmentRequest(BaseModel):
    image_base64: Optional[str] = None
    image_url: Optional[str] = None
    points: List[PointPrompt] = Field(default_factory=list)
    box: Optional[BoxPrompt] = None
    embedding_key: Optional[str] = None
    multimask_output: bool = True
    simplify_tolerance: float = Field(default=0.01, ge=0.001, le=0.1, description="Polygon simplification (0.001=fine, 0.1=coarse)")


class PolygonPoint(BaseModel):
    x: float
    y: float


class MaskResult(BaseModel):
    polygon: List[PolygonPoint]
    score: float
    area: int
    mask_index: int


class SegmentResponse(BaseModel):
    masks: List[MaskResult]
    embedding_key: str
    inference_time_ms: float


class EmbeddingRequest(BaseModel):
    image_base64: Optional[str] = None
    image_url: Optional[str] = None


class EmbeddingResponse(BaseModel):
    embedding_key: str
    compute_time_ms: float


class HealthResponse(BaseModel):
    status: str
    model_loaded: bool
    model_size: str
    device: str
    cache_size: int



@app.get("/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint."""
    return HealthResponse(
        status="healthy" if sam2_model and sam2_model._initialized else "initializing",
        model_loaded=sam2_model._initialized if sam2_model else False,
        model_size=SAM2_MODEL_SIZE,
        device=SAM2_DEVICE,
        cache_size=len(sam2_model._embedding_cache) if sam2_model else 0,
    )


@app.post("/segment", response_model=SegmentResponse)
async def segment_image(request: SegmentRequest):
    """
    Run SAM2 segmentation with point/box prompts.
    
    Returns up to 3 mask candidates when multimask_output=True.
    """
    if not sam2_model or not sam2_model._initialized:
        raise HTTPException(status_code=503, detail="SAM2 model not ready")
    
    start_time = time.perf_counter()
    
    image_data = None
    
    if request.embedding_key and request.embedding_key in sam2_model._embedding_cache:
        embedding_key = request.embedding_key
    else:
        if request.image_base64:
            try:
                if "," in request.image_base64:
                    request.image_base64 = request.image_base64.split(",")[1]
                image_data = base64.b64decode(request.image_base64)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid base64: {e}")
        elif request.image_url:
            import httpx
            try:
                async with httpx.AsyncClient(timeout=30.0) as client:
                    response = await client.get(request.image_url)
                    response.raise_for_status()
                    image_data = response.content
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Failed to fetch image: {e}")
        else:
            raise HTTPException(
                status_code=400, 
                detail="Either image_base64, image_url, or valid embedding_key required"
            )
        
        embedding_key = sam2_model.get_embedding(image_data)
    
    points = [(p.x, p.y, p.label) for p in request.points]
    box = None
    if request.box:
        box = (request.box.x1, request.box.y1, request.box.x2, request.box.y2)
    
    try:
        results = sam2_model.segment_with_embedding(
            embedding_key,
            points,
            box,
            multimask_output=request.multimask_output,
            simplify_tolerance=request.simplify_tolerance,
        )
    except Exception as e:
        logger.error(f"Segmentation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Segmentation failed: {e}")
    
    inference_time = (time.perf_counter() - start_time) * 1000
    
    return SegmentResponse(
        masks=[
            MaskResult(
                polygon=[PolygonPoint(x=x, y=y) for x, y in r.polygon],
                score=r.score,
                area=r.area,
                mask_index=r.mask_index,
            )
            for r in results
        ],
        embedding_key=embedding_key,
        inference_time_ms=inference_time,
    )


@app.post("/embedding", response_model=EmbeddingResponse)
async def compute_embedding(request: EmbeddingRequest):
    """
    Precompute image embedding for faster follow-up requests.
    
    Call this when user opens an image, then use embedding_key
    for all subsequent segment requests.
    """
    if not sam2_model or not sam2_model._initialized:
        raise HTTPException(status_code=503, detail="SAM2 model not ready")
    
    start_time = time.perf_counter()
    
    if request.image_base64:
        try:
            if "," in request.image_base64:
                request.image_base64 = request.image_base64.split(",")[1]
            image_data = base64.b64decode(request.image_base64)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Invalid base64: {e}")
    elif request.image_url:
        import httpx
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                response = await client.get(request.image_url)
                response.raise_for_status()
                image_data = response.content
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Failed to fetch image: {e}")
    else:
        raise HTTPException(status_code=400, detail="Either image_base64 or image_url required")
    
    embedding_key = sam2_model.get_embedding(image_data)
    
    compute_time = (time.perf_counter() - start_time) * 1000
    
    return EmbeddingResponse(
        embedding_key=embedding_key,
        compute_time_ms=compute_time,
    )


@app.post("/clear-cache")
async def clear_cache():
    """Clear embedding cache."""
    if sam2_model:
        sam2_model._embedding_cache.clear()
        return {"status": "ok", "message": "Cache cleared"}
    return {"status": "error", "message": "Model not initialized"}



class PolygonPointInit(BaseModel):
    """A point in a polygon."""
    x: float
    y: float


class ObjectInit(BaseModel):
    """Initial object annotation for tracking."""
    object_id: int = Field(..., description="Unique object ID for this track")
    box: BoxPrompt = Field(..., description="Initial bounding box [x1, y1, x2, y2]")
    frame_index: int = Field(default=0, description="Frame index where object is initialized")
    polygon: Optional[List[PolygonPointInit]] = Field(default=None, description="Optional polygon points for precise mask initialization (preserves shape details like mirrors)")


class VideoFrame(BaseModel):
    """A single video frame."""
    frame_index: int
    image_base64: str


class VideoPropagateRequest(BaseModel):
    """Request to propagate object annotations across video frames."""
    frames: List[VideoFrame] = Field(..., description="List of video frames in order")
    objects: List[ObjectInit] = Field(..., description="Objects to track with initial boxes")
    min_confidence: float = Field(default=0.5, ge=0.0, le=1.0, description="Stop tracking if confidence drops below this")
    propagate_direction: str = Field(default="forward", description="forward, backward, or both")


class PropagatedBox(BaseModel):
    """Propagated bounding box and polygon for an object in a frame."""
    object_id: int
    frame_index: int
    box: BoxPrompt
    confidence: float
    status: str = Field(default="tracked", description="tracked, lost, or keyframe")
    polygon: Optional[List[PolygonPointInit]] = Field(default=None, description="Propagated polygon (preserves shape details)")


class VideoPropagateResponse(BaseModel):
    """Response with propagated annotations."""
    boxes: List[PropagatedBox]
    total_frames: int
    tracked_frames: int
    lost_at_frame: Optional[int] = None
    processing_time_ms: float



@app.post("/video/propagate", response_model=VideoPropagateResponse)
async def propagate_video(request: VideoPropagateRequest):
    """
    Propagate object annotations across video frames using SAM2.
    
    This uses SAM2's video predictor to track objects across frames.
    Initialize with bounding boxes, and SAM2 will propagate the segmentation
    and return tight bounding boxes for each frame.
    """
    global sam2_model
    
    if not sam2_model or not sam2_model._initialized:
        raise HTTPException(status_code=503, detail="SAM2 model not ready")
    
    start_time = time.perf_counter()
    
    try:
        import torch
        from sam2.build_sam import build_sam2_video_predictor
        import cv2
        import tempfile
        import os as os_module
        
        sorted_frames = sorted(request.frames, key=lambda f: f.frame_index)
        
        if not sorted_frames:
            raise HTTPException(status_code=400, detail="No frames provided")
        
        with tempfile.TemporaryDirectory() as temp_dir:
            frame_paths = []
            frame_sizes = {}
            
            for frame in sorted_frames:
                try:
                    if "," in frame.image_base64:
                        frame.image_base64 = frame.image_base64.split(",")[1]
                    image_data = base64.b64decode(frame.image_base64)
                    img = Image.open(io.BytesIO(image_data)).convert("RGB")
                    
                    frame_path = os_module.path.join(temp_dir, f"{frame.frame_index:06d}.jpg")
                    img.save(frame_path, "JPEG", quality=95)
                    frame_paths.append(frame_path)
                    frame_sizes[frame.frame_index] = (img.width, img.height)
                    
                except Exception as e:
                    logger.error(f"Failed to decode frame {frame.frame_index}: {e}")
                    raise HTTPException(status_code=400, detail=f"Invalid frame {frame.frame_index}: {e}")
            
            if SAM2_DEVICE == "cuda":
                logger.info("Clearing CUDA cache for video propagation...")
                if sam2_model is not None:
                    if sam2_model.predictor is not None:
                        del sam2_model.predictor
                        sam2_model.predictor = None
                    if sam2_model.model is not None:
                        del sam2_model.model
                        sam2_model.model = None
                    sam2_model._embedding_cache.clear()
                    sam2_model._initialized = False
                torch.cuda.empty_cache()
                torch.cuda.synchronize()
                logger.info(f"GPU memory after cleanup: {torch.cuda.memory_allocated() / 1e9:.2f} GB")
            
            model_configs = {
                "tiny": ("configs/sam2.1/sam2.1_hiera_t.yaml", "sam2.1_hiera_tiny.pt"),
                "small": ("configs/sam2.1/sam2.1_hiera_s.yaml", "sam2.1_hiera_small.pt"),
                "base": ("configs/sam2.1/sam2.1_hiera_b+.yaml", "sam2.1_hiera_base_plus.pt"),
                "large": ("configs/sam2.1/sam2.1_hiera_l.yaml", "sam2.1_hiera_large.pt"),
            }
            config_name, checkpoint_name = model_configs.get(SAM2_MODEL_SIZE, model_configs["large"])
            checkpoint_path = os_module.path.join(MODEL_DIR, checkpoint_name)
            
            logger.info(f"Loading video predictor with {SAM2_MODEL_SIZE} model...")
            video_predictor = build_sam2_video_predictor(config_name, checkpoint_path, device=SAM2_DEVICE)
            
            inference_state = video_predictor.init_state(video_path=temp_dir)
            
            for obj in request.objects:
                frame_size = frame_sizes.get(obj.frame_index, (0, 0))
                
                if obj.polygon and len(obj.polygon) >= 3 and frame_size[0] > 0 and frame_size[1] > 0:
                    width, height = frame_size
                    polygon_np = np.array([[p.x, p.y] for p in obj.polygon], dtype=np.int32)
                    
                    mask = np.zeros((height, width), dtype=np.uint8)
                    cv2.fillPoly(mask, [polygon_np], 1)
                    
                    logger.info(f"Initializing object {obj.object_id} at frame {obj.frame_index} with POLYGON MASK ({len(obj.polygon)} points, {mask.sum()} pixels), image_size={frame_size}")
                    
                    _, out_obj_ids, out_mask_logits = video_predictor.add_new_mask(
                        inference_state=inference_state,
                        frame_idx=obj.frame_index,
                        obj_id=obj.object_id,
                        mask=mask,
                    )
                else:
                    box_np = np.array([obj.box.x1, obj.box.y1, obj.box.x2, obj.box.y2], dtype=np.float32)
                    logger.info(f"Initializing object {obj.object_id} at frame {obj.frame_index} with BOX: [{box_np[0]:.1f}, {box_np[1]:.1f}, {box_np[2]:.1f}, {box_np[3]:.1f}], image_size={frame_size}")
                    
                    _, out_obj_ids, out_mask_logits = video_predictor.add_new_points_or_box(
                        inference_state=inference_state,
                        frame_idx=obj.frame_index,
                        obj_id=obj.object_id,
                        box=box_np,
                    )
                
                if out_mask_logits is not None and len(out_mask_logits) > 0:
                    init_mask = (out_mask_logits[0] > 0.0).cpu().numpy().squeeze()
                    init_probs = torch.sigmoid(out_mask_logits[0]).cpu().numpy().squeeze()
                    logger.info(f"Initial mask for object {obj.object_id}: pixels={init_mask.sum()}, max_prob={init_probs.max():.3f}, mean_prob_in_mask={init_probs[init_mask].mean() if init_mask.any() else 0:.3f}")
                
                logger.info(f"Initialized object {obj.object_id} at frame {obj.frame_index}")
            
            results = []
            lost_at_frame = None
            tracked_count = 0
            
            for obj in request.objects:
                results.append(PropagatedBox(
                    object_id=obj.object_id,
                    frame_index=obj.frame_index,
                    box=obj.box,
                    confidence=1.0,
                    status="keyframe"
                ))
                tracked_count += 1
            
            if request.propagate_direction in ["forward", "both"]:
                for frame_idx, object_ids, masks in video_predictor.propagate_in_video(inference_state):
                    keyframe_indices = {obj.frame_index for obj in request.objects}
                    if frame_idx in keyframe_indices:
                        continue
                    
                    for obj_idx, obj_id in enumerate(object_ids):
                        mask_logits = masks[obj_idx]
                        mask = (mask_logits > 0.0).cpu().numpy().squeeze()
                        
                        mask_probs = torch.sigmoid(mask_logits).cpu().numpy().squeeze()
                        if mask.any():
                            confidence = float(mask_probs[mask].mean())
                        else:
                            confidence = float(mask_probs.max())
                        
                        logger.debug(f"Frame {frame_idx}, Object {obj_id}: mask_pixels={mask.sum()}, confidence={confidence:.3f}")
                        
                        if mask.any():
                            mask_uint8 = (mask.astype(np.uint8) * 255)
                            contours, _ = cv2.findContours(mask_uint8, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
                            
                            if contours:
                                largest = max(contours, key=cv2.contourArea)
                                area = cv2.contourArea(largest)
                                x, y, w, h = cv2.boundingRect(largest)
                                
                                if area < 15:
                                    logger.warning(f"Object {obj_id} at frame {frame_idx}: mask too small (area={area})")
                                    if lost_at_frame is None:
                                        lost_at_frame = frame_idx
                                    continue
                                
                                if confidence < request.min_confidence:
                                    if lost_at_frame is None:
                                        lost_at_frame = frame_idx
                                        logger.warning(f"Object {obj_id} lost at frame {frame_idx}, confidence={confidence:.3f}")
                                    continue
                                
                                perimeter = cv2.arcLength(largest, True)
                                epsilon = 0.005 * perimeter
                                simplified = cv2.approxPolyDP(largest, epsilon, True)
                                polygon_points = [
                                    PolygonPointInit(x=float(pt[0][0]), y=float(pt[0][1])) 
                                    for pt in simplified
                                ]
                                
                                results.append(PropagatedBox(
                                    object_id=int(obj_id),
                                    frame_index=frame_idx,
                                    box=BoxPrompt(x1=float(x), y1=float(y), x2=float(x+w), y2=float(y+h)),
                                    confidence=confidence,
                                    status="tracked",
                                    polygon=polygon_points if len(polygon_points) >= 3 else None,
                                ))
                                tracked_count += 1
                                logger.info(f"Tracked object {obj_id} at frame {frame_idx}: box=[{x},{y},{w},{h}], polygon_pts={len(polygon_points)}, conf={confidence:.3f}")
                        else:
                            if lost_at_frame is None:
                                lost_at_frame = frame_idx
                                logger.warning(f"Object {obj_id} has empty mask at frame {frame_idx}")
            
            video_predictor.reset_state(inference_state)
            del video_predictor
            torch.cuda.empty_cache()
            
            logger.info("Video propagation complete, reloading image predictor...")
            if sam2_model is not None:
                sam2_model.initialize()
            
        processing_time = (time.perf_counter() - start_time) * 1000
        
        return VideoPropagateResponse(
            boxes=results,
            total_frames=len(sorted_frames),
            tracked_frames=tracked_count,
            lost_at_frame=lost_at_frame,
            processing_time_ms=processing_time,
        )
        
    except ImportError as e:
        logger.error(f"SAM2 video predictor import failed: {e}")
        raise HTTPException(status_code=500, detail=f"SAM2 video predictor not available: {e}")
    except Exception as e:
        logger.error(f"Video propagation failed: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Video propagation failed: {e}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)

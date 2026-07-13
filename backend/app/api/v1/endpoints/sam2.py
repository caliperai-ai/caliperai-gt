"""
SAM2 Segmentation API Endpoints

Provides interactive segmentation using SAM2 with point/box prompts.
Supports both mock (fast development) and embedded (GPU) modes.
"""
from typing import Annotated, List, Optional, Dict, Any
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field
import httpx
import base64
import logging
import time

from app.models.models import User, Permission
from app.services.rbac_service import RequirePermissions
from app.services.sam2_service import get_sam2_service, PointPrompt, BoxPrompt

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/sam2", tags=["sam2"])


class PointPromptSchema(BaseModel):
    """A point prompt for segmentation."""
    x: float = Field(..., description="X coordinate in image space")
    y: float = Field(..., description="Y coordinate in image space")
    label: int = Field(..., ge=0, le=1, description="1 for foreground (positive), 0 for background (negative)")


class BoxPromptSchema(BaseModel):
    """A box prompt for segmentation."""
    x1: float = Field(..., description="Top-left X")
    y1: float = Field(..., description="Top-left Y")
    x2: float = Field(..., description="Bottom-right X")
    y2: float = Field(..., description="Bottom-right Y")


class SegmentRequest(BaseModel):
    """Request for SAM2 segmentation."""
    image_url: Optional[str] = Field(None, description="URL to fetch image from (e.g., MinIO)")
    image_base64: Optional[str] = Field(None, description="Base64-encoded image data")
    points: List[PointPromptSchema] = Field(default_factory=list, description="Point prompts")
    box: Optional[BoxPromptSchema] = Field(None, description="Optional box prompt")
    embedding_key: Optional[str] = Field(None, description="Cached embedding key for faster inference")
    simplify_tolerance: float = Field(default=0.01, ge=0.001, le=0.1, description="Polygon simplification tolerance (0.001=fine/many points, 0.1=coarse/few points)")


class PolygonPoint(BaseModel):
    """A point in a polygon."""
    x: float
    y: float


class SegmentResult(BaseModel):
    """A segmentation result."""
    polygon: List[PolygonPoint] = Field(..., description="Polygon points defining the mask boundary")
    score: float = Field(..., description="Confidence score (0-1)")
    area: int = Field(..., description="Pixel area of the mask")


class SegmentResponse(BaseModel):
    """Response from SAM2 segmentation."""
    masks: List[SegmentResult] = Field(..., description="Segmentation results")
    embedding_key: Optional[str] = Field(None, description="Embedding cache key for follow-up requests")
    inference_time_ms: float = Field(..., description="Inference time in milliseconds")


class EmbeddingRequest(BaseModel):
    """Request to precompute image embedding."""
    image_url: Optional[str] = Field(None, description="URL to fetch image from")
    image_base64: Optional[str] = Field(None, description="Base64-encoded image data")


class EmbeddingResponse(BaseModel):
    """Response with embedding cache key."""
    embedding_key: str = Field(..., description="Key to use for fast segmentation")
    compute_time_ms: float = Field(..., description="Embedding computation time in milliseconds")


def resolve_image_url(image_url: str) -> str:
    """
    Resolve image URL for internal Docker networking.
    Converts external URLs to internal service URLs.
    """
    import os
    
    logger.info(f"[SAM2] Resolving image URL: {image_url}")
    
    if "/api/v1/data/" in image_url:
        path_start = image_url.find("/api/v1/data/")
        if path_start != -1:
            path = image_url[path_start:]
            internal_url = f"http://localhost:8000{path}"
            logger.info(f"[SAM2] Resolved to internal backend URL: {internal_url}")
            return internal_url
    
    if "localhost:3000" in image_url or "127.0.0.1:3000" in image_url:
        if os.path.exists("/.dockerenv") or os.getenv("DOCKER_CONTAINER"):
            image_url = image_url.replace("localhost:3000", "frontend:80")
            image_url = image_url.replace("127.0.0.1:3000", "frontend:80")
            logger.info(f"[SAM2] Resolved frontend URL: {image_url}")
    
    return image_url


async def fetch_image(image_url: str) -> bytes:
    """Fetch image from URL."""
    try:
        resolved_url = resolve_image_url(image_url)
        logger.info(f"[SAM2] Fetching image from: {resolved_url}")
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.get(resolved_url)
            response.raise_for_status()
            logger.info(f"[SAM2] Successfully fetched image, size: {len(response.content)} bytes")
            return response.content
    except Exception as e:
        logger.error(f"[SAM2] Failed to fetch image from {image_url} (resolved: {resolve_image_url(image_url)}): {e}")
        raise HTTPException(status_code=400, detail=f"Failed to fetch image: {str(e)}")


def decode_base64_image(image_base64: str) -> bytes:
    """Decode base64 image data."""
    try:
        if "," in image_base64:
            image_base64 = image_base64.split(",")[1]
        return base64.b64decode(image_base64)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid base64 image data: {str(e)}")


@router.post("/segment", response_model=SegmentResponse)
async def segment_image(
    request: SegmentRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
):
    """
    Run SAM2 segmentation with point/box prompts. Requires ANNOTATIONS_CREATE permission.
    
    **Usage:**
    1. First request: Send image_url or image_base64 with points
    2. Follow-up requests: Use the returned embedding_key for faster inference
    
    **Point Labels:**
    - `label: 1` = Positive (include this region)
    - `label: 0` = Negative (exclude this region)
    
    **Example:**
    ```json
    {
        "image_url": "http://localhost:9000/bucket/image.jpg",
        "points": [
            {"x": 500, "y": 300, "label": 1},
            {"x": 100, "y": 100, "label": 0}
        ]
    }
    ```
    """
    start_time = time.perf_counter()
    
    service = get_sam2_service()
    
    if request.embedding_key and len(request.points) > 0:
        try:
            point_prompts = [PointPrompt(x=p.x, y=p.y, label=p.label) for p in request.points]
            box_prompt = BoxPrompt(x1=request.box.x1, y1=request.box.y1, x2=request.box.x2, y2=request.box.y2) if request.box else None
            
            results = await service.segment_with_embedding(
                request.embedding_key,
                point_prompts,
                box_prompt,
                simplify_tolerance=request.simplify_tolerance,
            )
            
            inference_time = (time.perf_counter() - start_time) * 1000
            
            return SegmentResponse(
                masks=[
                    SegmentResult(
                        polygon=[PolygonPoint(x=x, y=y) for x, y in r.polygon],
                        score=r.score,
                        area=r.area,
                    )
                    for r in results
                ],
                embedding_key=request.embedding_key,
                inference_time_ms=inference_time,
            )
        except ValueError as e:
            logger.warning(f"Embedding not found, falling back to full inference: {e}")
        except Exception as e:
            logger.warning(f"Embedding segmentation failed, falling back to full inference: {e}")
    
    if request.image_url:
        image_data = await fetch_image(request.image_url)
    elif request.image_base64:
        image_data = decode_base64_image(request.image_base64)
    else:
        raise HTTPException(status_code=400, detail="Either image_url or image_base64 is required")
    
    embedding_key = await service.get_embedding(image_data)
    
    point_prompts = [PointPrompt(x=p.x, y=p.y, label=p.label) for p in request.points]
    box_prompt = BoxPrompt(x1=request.box.x1, y1=request.box.y1, x2=request.box.x2, y2=request.box.y2) if request.box else None
    
    results = await service.segment(image_data, point_prompts, box_prompt, simplify_tolerance=request.simplify_tolerance)
    
    inference_time = (time.perf_counter() - start_time) * 1000
    
    return SegmentResponse(
        masks=[
            SegmentResult(
                polygon=[PolygonPoint(x=x, y=y) for x, y in r.polygon],
                score=r.score,
                area=r.area,
            )
            for r in results
        ],
        embedding_key=embedding_key,
        inference_time_ms=inference_time,
    )


@router.post("/embedding", response_model=EmbeddingResponse)
async def compute_embedding(
    request: EmbeddingRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
):
    """
    Precompute image embedding for faster follow-up segmentation requests.
    Requires ANNOTATIONS_CREATE permission.
    
    Call this when the user opens an image, then use the returned
    embedding_key for all subsequent segment requests on that image.
    
    This reduces latency from ~100-500ms to ~10-50ms per request.
    """
    start_time = time.perf_counter()
    
    service = get_sam2_service()
    
    if request.image_url:
        image_data = await fetch_image(request.image_url)
    elif request.image_base64:
        image_data = decode_base64_image(request.image_base64)
    else:
        raise HTTPException(status_code=400, detail="Either image_url or image_base64 is required")
    
    try:
        embedding_key = await service.get_embedding(image_data)
    except Exception as e:
        raise HTTPException(
            status_code=503,
            detail=f"SAM2 service unavailable: {str(e)}",
        )

    compute_time = (time.perf_counter() - start_time) * 1000

    return EmbeddingResponse(
        embedding_key=embedding_key,
        compute_time_ms=compute_time,
    )


@router.post("/segment/batch", response_model=List[SegmentResponse])
async def batch_segment_images(
    requests: List[SegmentRequest],
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
):
    """
    Batch SAM2 segmentation for multiple images/prompts.
    
    This endpoint allows processing multiple segmentation requests in parallel,
    significantly reducing overhead for operations like video propagation.
    
    **Usage:** Send array of SegmentRequest objects.
    
    **Benefits:**
    - Single HTTP request overhead instead of N requests
    - Parallel processing on backend
    - Reuses service connection and resources
    - 3-5x faster than sequential requests
    
    **Example:**
    ```json
    [
        {
            "image_url": "http://minio:9000/bucket/frame1.jpg",
            "box": {"x1": 100, "y1": 100, "x2": 200, "y2": 200},
            "simplify_tolerance": 0.01
        },
        {
            "image_url": "http://minio:9000/bucket/frame2.jpg",
            "box": {"x1": 105, "y1": 102, "x2": 205, "y2": 202},
            "simplify_tolerance": 0.01
        }
    ]
    ```
    
    Requires ANNOTATIONS_CREATE permission.
    """
    import asyncio
    
    service = get_sam2_service()
    
    async def process_single_request(req: SegmentRequest) -> SegmentResponse:
        """Process a single segmentation request."""
        start_time = time.perf_counter()
        
        try:
            if req.embedding_key and len(req.points) > 0:
                try:
                    point_prompts = [PointPrompt(x=p.x, y=p.y, label=p.label) for p in req.points]
                    box_prompt = BoxPrompt(x1=req.box.x1, y1=req.box.y1, x2=req.box.x2, y2=req.box.y2) if req.box else None
                    
                    results = await service.segment_with_embedding(
                        req.embedding_key,
                        point_prompts,
                        box_prompt,
                        simplify_tolerance=req.simplify_tolerance,
                    )
                    
                    inference_time = (time.perf_counter() - start_time) * 1000
                    
                    return SegmentResponse(
                        masks=[
                            SegmentResult(
                                polygon=[PolygonPoint(x=x, y=y) for x, y in r.polygon],
                                score=r.score,
                                area=r.area,
                            )
                            for r in results
                        ],
                        embedding_key=req.embedding_key,
                        inference_time_ms=inference_time,
                    )
                except ValueError:
                    pass
                except Exception as e:
                    logger.warning(f"Batch: Embedding segmentation failed for request, falling back to full inference: {e}")
            
            if req.image_url:
                image_data = await fetch_image(req.image_url)
            elif req.image_base64:
                image_data = decode_base64_image(req.image_base64)
            else:
                raise HTTPException(status_code=400, detail="Either image_url or image_base64 is required")
            
            embedding_key = await service.get_embedding(image_data)
            
            point_prompts = [PointPrompt(x=p.x, y=p.y, label=p.label) for p in req.points]
            box_prompt = BoxPrompt(x1=req.box.x1, y1=req.box.y1, x2=req.box.x2, y2=req.box.y2) if req.box else None
            
            results = await service.segment(image_data, point_prompts, box_prompt, simplify_tolerance=req.simplify_tolerance)
            
            inference_time = (time.perf_counter() - start_time) * 1000
            
            return SegmentResponse(
                masks=[
                    SegmentResult(
                        polygon=[PolygonPoint(x=x, y=y) for x, y in r.polygon],
                        score=r.score,
                        area=r.area,
                    )
                    for r in results
                ],
                embedding_key=embedding_key,
                inference_time_ms=inference_time,
            )
        except Exception as e:
            logger.error(f"Batch segment failed for request: {e}")
            return SegmentResponse(
                masks=[],
                embedding_key=None,
                inference_time_ms=(time.perf_counter() - start_time) * 1000,
            )
    
    results = await asyncio.gather(*[process_single_request(req) for req in requests])
    
    return results


@router.get("/status")
async def get_status(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_READ))],
):
    """Get SAM2 service status. Requires ANNOTATIONS_READ permission."""
    import os
    service = get_sam2_service()
    
    return {
        "mode": os.getenv("SAM2_MODE", "mock"),
        "service_type": type(service).__name__,
        "model_size": os.getenv("SAM2_MODEL_SIZE", "large"),
        "device": os.getenv("SAM2_DEVICE", "cuda"),
        "ready": True,
    }



class PolygonPointInitSchema(BaseModel):
    """A point in a polygon."""
    x: float
    y: float


class ObjectInitSchema(BaseModel):
    """Initial object annotation for tracking."""
    object_id: int = Field(..., description="Unique object ID for this track")
    box: BoxPromptSchema = Field(..., description="Initial bounding box")
    frame_index: int = Field(default=0, description="Frame index where object is initialized")
    polygon: Optional[List[PolygonPointInitSchema]] = Field(default=None, description="Optional polygon points for precise mask initialization (preserves shape details like mirrors)")


class VideoFrameSchema(BaseModel):
    """A single video frame."""
    frame_index: int
    image_base64: Optional[str] = None
    image_url: Optional[str] = None


class VideoPropagateRequest(BaseModel):
    """Request to propagate object annotations across video frames."""
    frames: List[VideoFrameSchema] = Field(..., description="List of video frames in order")
    objects: List[ObjectInitSchema] = Field(..., description="Objects to track with initial boxes")
    min_confidence: float = Field(default=0.5, ge=0.0, le=1.0, description="Stop tracking if confidence drops below this")


class PropagatedBoxSchema(BaseModel):
    """Propagated bounding box and polygon for an object in a frame."""
    object_id: int
    frame_index: int
    box: BoxPromptSchema
    confidence: float
    status: str = Field(default="tracked", description="tracked, lost, or keyframe")
    polygon: Optional[List[PolygonPointInitSchema]] = Field(default=None, description="Propagated polygon (preserves shape details)")


class VideoPropagateResponse(BaseModel):
    """Response with propagated annotations."""
    boxes: List[PropagatedBoxSchema]
    total_frames: int
    tracked_frames: int
    lost_at_frame: Optional[int] = None
    processing_time_ms: float



@router.post("/video/propagate", response_model=VideoPropagateResponse)
async def propagate_video(
    request: VideoPropagateRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.ANNOTATIONS_CREATE))],
):
    """
    Propagate object annotations across video frames using SAM2.
    
    This uses SAM2's video predictor to track objects across frames.
    Initialize with bounding boxes, and SAM2 will propagate the segmentation
    and return tight bounding boxes for each frame.
    
    Requires ANNOTATIONS_CREATE permission.
    """
    import os
    
    sam2_api_url = os.getenv("SAM2_API_URL", "http://sam2:8001")
    
    processed_frames = []
    
    url_frames = []
    for frame in request.frames:
        if frame.image_base64:
            processed_frames.append({
                "frame_index": frame.frame_index,
                "image_base64": frame.image_base64,
            })
        elif frame.image_url:
            url_frames.append(frame)
        else:
            raise HTTPException(status_code=400, detail=f"Frame {frame.frame_index} must have image_base64 or image_url")
    
    if url_frames:
        import asyncio
        
        async def fetch_frame(client: httpx.AsyncClient, frame: VideoFrameSchema) -> dict:
            resolved_url = resolve_image_url(frame.image_url)
            logger.info(f"[Video Propagate] Fetching frame {frame.frame_index} from: {resolved_url}")
            response = await client.get(resolved_url)
            response.raise_for_status()
            return {
                "frame_index": frame.frame_index,
                "image_base64": base64.b64encode(response.content).decode(),
            }
        
        try:
            async with httpx.AsyncClient(timeout=30.0) as client:
                results = await asyncio.gather(
                    *[fetch_frame(client, frame) for frame in url_frames]
                )
                processed_frames.extend(results)
        except Exception as e:
            logger.error(f"Failed to fetch frames in parallel: {e}")
            raise HTTPException(status_code=400, detail=f"Failed to fetch frames: {e}")
    
    processed_frames.sort(key=lambda f: f["frame_index"])
    
    objects_data = []
    for obj in request.objects:
        obj_data = {
            "object_id": obj.object_id,
            "box": {
                "x1": obj.box.x1,
                "y1": obj.box.y1,
                "x2": obj.box.x2,
                "y2": obj.box.y2,
            },
            "frame_index": obj.frame_index,
        }
        if obj.polygon and len(obj.polygon) >= 3:
            obj_data["polygon"] = [{"x": p.x, "y": p.y} for p in obj.polygon]
        objects_data.append(obj_data)
    
    try:
        async with httpx.AsyncClient(timeout=300.0) as client:
            response = await client.post(
                f"{sam2_api_url}/video/propagate",
                json={
                    "frames": processed_frames,
                    "objects": objects_data,
                    "min_confidence": request.min_confidence,
                    "propagate_direction": "forward",
                },
            )
            response.raise_for_status()
            result = response.json()
            
            boxes = []
            for box in result["boxes"]:
                polygon_schema = None
                if box.get("polygon") and len(box["polygon"]) >= 3:
                    polygon_schema = [
                        PolygonPointInitSchema(x=p["x"], y=p["y"]) 
                        for p in box["polygon"]
                    ]
                
                boxes.append(PropagatedBoxSchema(
                    object_id=box["object_id"],
                    frame_index=box["frame_index"],
                    box=BoxPromptSchema(
                        x1=box["box"]["x1"],
                        y1=box["box"]["y1"],
                        x2=box["box"]["x2"],
                        y2=box["box"]["y2"],
                    ),
                    confidence=box["confidence"],
                    status=box["status"],
                    polygon=polygon_schema,
                ))
            
            return VideoPropagateResponse(
                boxes=boxes,
                total_frames=result["total_frames"],
                tracked_frames=result["tracked_frames"],
                lost_at_frame=result.get("lost_at_frame"),
                processing_time_ms=result["processing_time_ms"],
            )
            
    except httpx.HTTPStatusError as e:
        logger.error(f"SAM2 video propagation failed: {e.response.text}")
        raise HTTPException(status_code=e.response.status_code, detail=f"SAM2 service error: {e.response.text}")
    except httpx.RequestError as e:
        logger.error(f"Failed to connect to SAM2 service: {e}")
        raise HTTPException(status_code=503, detail="SAM2 service unavailable")

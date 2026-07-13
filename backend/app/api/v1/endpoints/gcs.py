"""
Google Cloud Storage API endpoints.

Provides endpoints for:
- Testing GCS connection
- Listing buckets
- Browsing bucket contents
- Discovering scenes
- Importing scenes from GCS
"""
import json
import os
import shutil
import tempfile
import logging
from typing import Annotated, Optional, List, Dict, Any
from uuid import UUID
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status, BackgroundTasks
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.core.redis_cache import get_redis_client
from app.models.models import Dataset, User, Permission
from app.services.rbac_service import RequirePermissions
from app.services.gcs_service import (
    GCSService, 
    GCSConfig, 
    GCSBucket, 
    GCSObject, 
    GCSScene,
    create_gcs_service,
    get_gcs_service
)

router = APIRouter()
logger = logging.getLogger(__name__)



class GCSCredentialsRequest(BaseModel):
    """Request to set GCS credentials."""
    credentials_json: str = Field(..., description="Service account JSON as string")
    project_id: Optional[str] = Field(None, description="GCS project ID (optional if in credentials)")


class GCSConnectionTest(BaseModel):
    """Response from connection test."""
    success: bool
    message: str
    project_id: Optional[str] = None


class GCSBucketResponse(BaseModel):
    """GCS bucket info."""
    name: str
    location: Optional[str] = None
    storage_class: Optional[str] = None
    created: Optional[str] = None


class GCSObjectResponse(BaseModel):
    """GCS object (file or folder)."""
    name: str
    path: str
    is_folder: bool = False
    size: int = 0
    updated: Optional[str] = None
    content_type: Optional[str] = None


class GCSSceneResponse(BaseModel):
    """Discovered scene in GCS."""
    scene_id: str
    path: str
    bucket: str
    prefix: str
    frame_count: int = 0
    sensors: List[str] = []
    has_calibration: bool = False
    has_annotations: bool = False
    has_metadata: bool = False
    metadata: Dict[str, Any] = {}


class GCSListObjectsResponse(BaseModel):
    """Response from listing objects."""
    bucket: str
    prefix: str
    objects: List[GCSObjectResponse]
    folders: List[str]


class GCSDiscoverScenesResponse(BaseModel):
    """Response from scene discovery."""
    bucket: str
    prefix: str
    scenes: List[GCSSceneResponse]


class GCSImportRequest(BaseModel):
    """Request to import a scene from GCS."""
    bucket: str = Field(..., description="GCS bucket name")
    prefix: str = Field(..., description="Scene prefix path in bucket")
    dataset_id: UUID = Field(..., description="Target dataset ID")
    credentials_json: Optional[str] = Field(None, description="Optional credentials override")
    derive_taxonomy: bool = Field(True, description="Derive taxonomy from annotations")
    overwrite_annotations: bool = Field(False, description="Overwrite existing annotations")


class GCSImportResponse(BaseModel):
    """Response from scene import."""
    success: bool
    message: str
    scene_id: Optional[str] = None
    frames_imported: int = 0
    errors: List[str] = []


GCS_CREDENTIALS_KEY_PREFIX = "gcs_credentials:"
GCS_CREDENTIALS_TTL = 3600


async def store_user_gcs_credentials(user_id: str, credentials_json: str, project_id: Optional[str] = None):
    """Store GCS credentials in Redis for a user."""
    redis = get_redis_client()
    if redis:
        data = {
            "credentials_json": credentials_json,
            "project_id": project_id
        }
        await redis.setex(
            f"{GCS_CREDENTIALS_KEY_PREFIX}{user_id}",
            GCS_CREDENTIALS_TTL,
            json.dumps(data)
        )


async def get_user_gcs_credentials(user_id: str) -> Optional[Dict[str, Any]]:
    """Get GCS credentials from Redis for a user."""
    redis = get_redis_client()
    if redis:
        data = await redis.get(f"{GCS_CREDENTIALS_KEY_PREFIX}{user_id}")
        if data:
            return json.loads(data)
    return None


async def clear_user_gcs_credentials(user_id: str):
    """Clear GCS credentials from Redis for a user."""
    redis = get_redis_client()
    if redis:
        await redis.delete(f"{GCS_CREDENTIALS_KEY_PREFIX}{user_id}")


async def get_user_gcs_service_async(user_id: str) -> Optional[GCSService]:
    """Get GCS service for a user (from Redis or default)."""
    creds = await get_user_gcs_credentials(user_id)
    if creds:
        return create_gcs_service(
            credentials_json=creds.get("credentials_json"),
            project_id=creds.get("project_id")
        )
    
    if settings.GCS_ENABLED:
        return get_gcs_service()
    
    return None



@router.get("/status")
async def get_gcs_status(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_READ))]
) -> Dict[str, Any]:
    """Get GCS integration status."""
    creds = await get_user_gcs_credentials(str(current_user.id))
    return {
        "enabled": settings.GCS_ENABLED,
        "project_id": settings.GCS_PROJECT_ID,
        "default_bucket": settings.GCS_DEFAULT_BUCKET,
        "has_credentials": bool(settings.GCS_CREDENTIALS_JSON),
        "user_has_session": creds is not None
    }


@router.post("/connect")
async def connect_gcs(
    request: GCSCredentialsRequest,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_CREATE))]
) -> GCSConnectionTest:
    """
    Connect to GCS with provided credentials.
    
    The credentials are stored for the session and used for subsequent operations.
    """
    try:
        service = create_gcs_service(
            credentials_json=request.credentials_json,
            project_id=request.project_id
        )
        
        success, message = service.test_connection()
        
        if success:
            await store_user_gcs_credentials(
                str(current_user.id),
                request.credentials_json,
                request.project_id
            )
            
            project_id = request.project_id
            if not project_id:
                try:
                    creds_dict = json.loads(request.credentials_json)
                    project_id = creds_dict.get('project_id')
                except:
                    pass
            
            return GCSConnectionTest(
                success=True,
                message=message,
                project_id=project_id
            )
        else:
            return GCSConnectionTest(
                success=False,
                message=message
            )
            
    except json.JSONDecodeError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid JSON in credentials"
        )
    except Exception as e:
        logger.error(f"GCS connection error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to connect to GCS: {str(e)}"
        )


@router.post("/disconnect")
async def disconnect_gcs(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_READ))]
) -> Dict[str, str]:
    """Disconnect from GCS (clear stored credentials)."""
    await clear_user_gcs_credentials(str(current_user.id))
    return {"message": "Disconnected from GCS"}


@router.get("/buckets")
async def list_buckets(
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_READ))]
) -> List[GCSBucketResponse]:
    """List all accessible GCS buckets."""
    service = await get_user_gcs_service_async(str(current_user.id))
    
    if not service:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not connected to GCS. Please connect first."
        )
    
    try:
        buckets = service.list_buckets()
        return [
            GCSBucketResponse(
                name=b.name,
                location=b.location,
                storage_class=b.storage_class,
                created=b.created
            )
            for b in buckets
        ]
    except Exception as e:
        logger.error(f"Error listing buckets: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list buckets: {str(e)}"
        )


@router.get("/buckets/{bucket_name}/browse")
async def browse_bucket(
    bucket_name: str,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_READ))],
    prefix: str = ""
) -> GCSListObjectsResponse:
    """Browse objects in a bucket with optional prefix (folder navigation)."""
    service = await get_user_gcs_service_async(str(current_user.id))
    
    if not service:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not connected to GCS. Please connect first."
        )
    
    try:
        objects, folders = service.list_objects(bucket_name, prefix)
        return GCSListObjectsResponse(
            bucket=bucket_name,
            prefix=prefix,
            objects=[
                GCSObjectResponse(
                    name=obj.name,
                    path=obj.path,
                    is_folder=obj.is_folder,
                    size=obj.size,
                    updated=obj.updated,
                    content_type=obj.content_type
                )
                for obj in objects
            ],
            folders=folders
        )
    except Exception as e:
        logger.error(f"Error browsing bucket: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to browse bucket: {str(e)}"
        )


@router.get("/buckets/{bucket_name}/discover-scenes")
async def discover_scenes(
    bucket_name: str,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_READ))],
    prefix: str = ""
) -> GCSDiscoverScenesResponse:
    """Discover scenes in a bucket/prefix."""
    service = await get_user_gcs_service_async(str(current_user.id))
    
    if not service:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not connected to GCS. Please connect first."
        )
    
    try:
        scenes = service.discover_scenes(bucket_name, prefix)
        return GCSDiscoverScenesResponse(
            bucket=bucket_name,
            prefix=prefix,
            scenes=[
                GCSSceneResponse(
                    scene_id=s.scene_id,
                    path=s.path,
                    bucket=s.bucket,
                    prefix=s.prefix,
                    frame_count=s.frame_count,
                    sensors=s.sensors,
                    has_calibration=s.has_calibration,
                    has_annotations=s.has_annotations,
                    has_metadata=s.has_metadata,
                    metadata=s.metadata
                )
                for s in scenes
            ]
        )
    except Exception as e:
        logger.error(f"Error discovering scenes: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to discover scenes: {str(e)}"
        )


@router.post("/import")
async def import_from_gcs(
    request: GCSImportRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_CREATE))],
    db: AsyncSession = Depends(get_db)
) -> GCSImportResponse:
    """
    Import a scene from GCS into a dataset.
    
    This downloads the scene data to the uploads folder and imports it.
    """
    if request.credentials_json:
        service = create_gcs_service(request.credentials_json)
    else:
        service = await get_user_gcs_service_async(str(current_user.id))
    
    if not service:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Not connected to GCS. Please connect first or provide credentials."
        )
    
    dataset_result = await db.execute(
        select(Dataset).where(Dataset.id == request.dataset_id)
    )
    dataset = dataset_result.scalar_one_or_none()
    
    if not dataset:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dataset not found"
        )
    
    errors = []
    temp_dir = None
    
    try:
        prefix = request.prefix.rstrip('/')
        is_zip_file = prefix.endswith('.zip')
        
        if is_zip_file:
            logger.info(f"Downloading zip file from gs://{request.bucket}/{prefix}")
            zip_path = service.download_file(request.bucket, prefix)
            logger.info(f"Downloaded zip to {zip_path}")
            
            import zipfile
            temp_dir = tempfile.mkdtemp(prefix="gcs_scene_")
            with zipfile.ZipFile(zip_path, 'r') as zip_ref:
                zip_ref.extractall(temp_dir)
            logger.info(f"Extracted zip to {temp_dir}")
            
            os.unlink(zip_path)
        else:
            logger.info(f"Downloading scene from gs://{request.bucket}/{prefix}")
            temp_dir = service.download_scene(request.bucket, prefix)
            logger.info(f"Downloaded scene to {temp_dir}")
        
        temp_path = Path(temp_dir)
        if temp_path.exists():
            all_files = list(temp_path.rglob("*"))
            logger.info(f"Downloaded {len(all_files)} items to temp dir")
            for f in all_files[:20]:
                logger.info(f"  - {f.relative_to(temp_path)}")
        else:
            logger.error(f"Temp dir does not exist: {temp_dir}")
        
        scene_id = request.prefix.rstrip('/').split('/')[-1]
        
        UPLOAD_DIR = Path("/uploads")
        dataset_upload_dir = UPLOAD_DIR / str(request.dataset_id)
        dataset_upload_dir.mkdir(parents=True, exist_ok=True)
        
        import uuid as uuid_module
        new_scene_id = uuid_module.uuid4()
        permanent_scene_dir = dataset_upload_dir / str(new_scene_id)
        
        shutil.copytree(temp_dir, permanent_scene_dir)
        logger.info(f"Copied scene to permanent storage: {permanent_scene_dir}")
        
        from app.api.v1.endpoints.import_data import (
            import_scene_annotations,
            parse_calibration_file,
            discover_frames,
            scan_annotations_for_classes,
            derive_and_merge_taxonomy,
        )
        from app.models.models import Scene, Frame, Task
        from asyncpg import Range as PgRange
        from sqlalchemy.orm import attributes
        
        scene_dir = permanent_scene_dir
        relative_path_base = f"uploads/{request.dataset_id}/{new_scene_id}"
        
        sensor_folders = {'lidar', 'cameras'}
        
        scene_contents = list(scene_dir.iterdir()) if scene_dir.exists() else []
        scene_dir_names = {item.name for item in scene_contents if item.is_dir()}
        has_sensor_folders = bool(scene_dir_names & sensor_folders)
        
        if not has_sensor_folders:
            data_subdir = scene_dir / "data"
            if data_subdir.exists() and data_subdir.is_dir():
                data_contents = {item.name for item in data_subdir.iterdir() if item.is_dir()}
                if data_contents & sensor_folders:
                    logger.info(f"Found sensor data in data/ subfolder, using it as scene root")
                    scene_dir = data_subdir
                    relative_path_base = f"uploads/{request.dataset_id}/{new_scene_id}/data"
            elif len(scene_contents) == 1 and scene_contents[0].is_dir():
                actual_scene_dir = scene_contents[0]
                sub_contents = list(actual_scene_dir.iterdir()) if actual_scene_dir.exists() else []
                sub_dir_names = {item.name for item in sub_contents if item.is_dir()}
                if sub_dir_names & sensor_folders:
                    logger.info(f"Found scene data in subfolder: {actual_scene_dir.name}")
                    scene_dir = actual_scene_dir
                    relative_path_base = f"uploads/{request.dataset_id}/{new_scene_id}/{actual_scene_dir.name}"
                elif (actual_scene_dir / "data").exists():
                    data_sub = actual_scene_dir / "data"
                    data_sub_names = {item.name for item in data_sub.iterdir() if item.is_dir()}
                    if data_sub_names & sensor_folders:
                        logger.info(f"Found sensor data in {actual_scene_dir.name}/data/ subfolder")
                        scene_dir = data_sub
                        relative_path_base = f"uploads/{request.dataset_id}/{new_scene_id}/{actual_scene_dir.name}/data"
        
        scene_meta_path = scene_dir / "scene_metadata.json"
        scene_meta = {}
        if scene_meta_path.exists():
            with open(scene_meta_path) as f:
                scene_meta = json.load(f)
        
        lidar_path = scene_dir / "lidar"
        cameras_path = scene_dir / "cameras"
        
        frame_count = 0
        data_files = []
        lidar_files = []
        camera_files = {}
        cameras_storage_paths = {}
        
        if lidar_path.exists():
            lidar_files = sorted([f for f in lidar_path.iterdir() if f.is_file()], key=lambda x: x.name)
            data_files = lidar_files
            frame_count = len(lidar_files)
        
        if cameras_path.exists():
            for cam_dir in cameras_path.iterdir():
                if cam_dir.is_dir():
                    cam_files = sorted([f for f in cam_dir.iterdir() if f.is_file()], key=lambda x: x.name)
                    if cam_files:
                        camera_files[cam_dir.name] = cam_files
                        cameras_storage_paths[cam_dir.name] = f"{relative_path_base}/cameras/{cam_dir.name}"
            
            if not data_files and camera_files:
                first_cam = next(iter(camera_files.values()))
                data_files = first_cam
                frame_count = len(first_cam)
        
        if frame_count == 0:
            logger.error(f"No frames found in scene_dir: {scene_dir}")
            logger.error(f"Scene dir contents: {list(scene_dir.iterdir()) if scene_dir.exists() else 'dir not found'}")
            if lidar_path.exists():
                logger.error(f"Lidar path contents: {list(lidar_path.iterdir())}")
            if cameras_path.exists():
                logger.error(f"Cameras path contents: {list(cameras_path.iterdir())}")
            errors.append("No frames detected in the scene")
            return GCSImportResponse(
                success=False,
                message="No frames detected in the downloaded scene. Expected 'lidar/' or 'cameras/' folders with data files.",
                errors=errors
            )
        
        calibration_data = None
        calibration_file = scene_dir / "calibration.json"
        calibration_dir = scene_dir / "calibration"
        if calibration_file.exists():
            with open(calibration_file, "r") as f:
                calibration_data = json.load(f)
        elif calibration_dir.exists():
            calibration_data = parse_calibration_file(calibration_dir)
        
        ego_poses_data = {}
        ego_poses_file = scene_dir / "ego_poses" / "poses.json"
        if not ego_poses_file.exists():
            ego_poses_file = scene_dir / "ego_poses" / "ego_poses.json"
        
        ego_poses_path = None
        if ego_poses_file.exists():
            ego_poses_path = f"{relative_path_base}/ego_poses/{ego_poses_file.name}"
            with open(ego_poses_file, "r") as f:
                poses_json = json.load(f)
                if "frames" in poses_json:
                    for pose_entry in poses_json["frames"]:
                        frame_idx = pose_entry.get("frame_index", -1)
                        if frame_idx >= 0:
                            ego_poses_data[frame_idx] = {
                                "position": pose_entry.get("position", [0, 0, 0]),
                                "rotation": pose_entry.get("rotation", [1, 0, 0, 0]),
                                "velocity": pose_entry.get("velocity"),
                                "timestamp": pose_entry.get("timestamp"),
                            }
        
        scene_name = scene_meta.get("name", scene_id)
        existing_scene_query = select(Scene).where(
            Scene.dataset_id == dataset.id,
            Scene.name == scene_name,
            Scene.is_deleted == False,
        )
        existing_result = await db.execute(existing_scene_query)
        if existing_result.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"A scene with the name '{scene_name}' already exists in this dataset",
            )
        
        scene = Scene(
            id=new_scene_id,
            dataset_id=dataset.id,
            name=scene_name,
            description=scene_meta.get("description", f"Imported from GCS: gs://{request.bucket}/{request.prefix}"),
            frame_count=frame_count,
            fps=scene_meta.get("fps", 10.0),
            scene_metadata={
                "location": scene_meta.get("location"),
                "weather": scene_meta.get("weather"),
                "time_of_day": scene_meta.get("time_of_day"),
                "source": "gcs_import",
                "gcs_bucket": request.bucket,
                "gcs_prefix": request.prefix,
            },
            calibration=calibration_data,
            storage_paths={
                "root": str(permanent_scene_dir),
                "lidar_base": f"{relative_path_base}/lidar" if lidar_files else None,
                "cameras": cameras_storage_paths if cameras_storage_paths else None,
                "ego_poses": ego_poses_path,
            },
        )
        db.add(scene)
        await db.flush()
        
        for frame_idx, data_file in enumerate(data_files):
            frame_file_paths = {}
            
            if lidar_files and frame_idx < len(lidar_files):
                frame_file_paths["lidar"] = lidar_files[frame_idx].name
            
            if camera_files:
                cameras_dict = {}
                for cam_name, cam_file_list in camera_files.items():
                    if frame_idx < len(cam_file_list):
                        cameras_dict[cam_name] = cam_file_list[frame_idx].name
                if cameras_dict:
                    frame_file_paths["cameras"] = cameras_dict
            
            ego_pose = ego_poses_data.get(frame_idx)
            timestamp = ego_pose.get("timestamp") if ego_pose else None
            
            frame = Frame(
                scene_id=scene.id,
                frame_index=frame_idx,
                timestamp=timestamp if timestamp is not None else frame_idx * 0.1,
                ego_pose=ego_pose,
                file_paths=frame_file_paths,
            )
            db.add(frame)
        
        await db.flush()
        
        if request.derive_taxonomy:
            try:
                discovered_classes = scan_annotations_for_classes([scene_dir])
                if discovered_classes:
                    taxonomy = await derive_and_merge_taxonomy(
                        db=db,
                        dataset=dataset,
                        discovered_classes=discovered_classes,
                        user_id=current_user.id,
                    )
                    if taxonomy:
                        errors.append(f"Taxonomy: Created/updated '{taxonomy.name}' with {len(taxonomy.classes)} classes")
            except Exception as e:
                errors.append(f"Taxonomy derivation failed: {str(e)}")
        
        task = Task(
            scene_id=scene.id,
            name=f"GCS Import - {scene.name}",
            description="Automatically created task for GCS imported annotations",
            assignee_id=current_user.id,
            frame_range=PgRange(0, frame_count),
        )
        db.add(task)
        await db.flush()
        
        try:
            annotations_3d, annotations_2d = await import_scene_annotations(
                db=db,
                scene=scene,
                scene_dir=scene_dir,
                task=task,
                overwrite=request.overwrite_annotations,
            )
            if annotations_3d > 0 or annotations_2d > 0:
                errors.append(f"Imported {annotations_3d} 3D and {annotations_2d} 2D annotations")
        except Exception as e:
            errors.append(f"Annotation import failed: {str(e)}")
        
        await db.commit()
        
        return GCSImportResponse(
            success=True,
            message=f"Successfully imported scene '{scene.name}' with {frame_count} frames from GCS",
            scene_id=str(new_scene_id),
            frames_imported=frame_count,
            errors=errors
        )
        
    except Exception as e:
        logger.error(f"Error importing from GCS: {e}")
        import traceback
        traceback.print_exc()
        await db.rollback()
        errors.append(str(e))
        
        return GCSImportResponse(
            success=False,
            message=f"Import failed: {str(e)}",
            errors=errors
        )
        
    finally:
        if temp_dir and Path(temp_dir).exists():
            try:
                shutil.rmtree(temp_dir)
            except Exception as e:
                logger.warning(f"Failed to cleanup temp dir: {e}")

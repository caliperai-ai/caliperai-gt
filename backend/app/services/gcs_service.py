"""
Google Cloud Storage service for browsing and importing data from GCS buckets.

This service provides:
- Bucket listing
- Scene discovery in buckets
- File/folder browsing
- Data download for import
"""
import os
import json
import tempfile
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, field

from google.cloud import storage
from google.oauth2 import service_account

from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class GCSConfig:
    """Configuration for GCS connection."""
    project_id: Optional[str] = None
    credentials_path: Optional[str] = None
    credentials_json: Optional[str] = None
    

@dataclass
class GCSBucket:
    """Represents a GCS bucket."""
    name: str
    location: Optional[str] = None
    storage_class: Optional[str] = None
    created: Optional[str] = None


@dataclass
class GCSObject:
    """Represents a GCS object (file or folder)."""
    name: str
    path: str
    is_folder: bool = False
    size: int = 0
    updated: Optional[str] = None
    content_type: Optional[str] = None


@dataclass
class GCSScene:
    """Represents a discovered scene in GCS."""
    scene_id: str
    path: str
    bucket: str
    prefix: str
    frame_count: int = 0
    sensors: List[str] = field(default_factory=list)
    has_calibration: bool = False
    has_annotations: bool = False
    has_metadata: bool = False
    metadata: Dict[str, Any] = field(default_factory=dict)


class GCSService:
    """Service for interacting with Google Cloud Storage."""
    
    def __init__(self, config: Optional[GCSConfig] = None):
        """Initialize GCS client with credentials."""
        self._client: Optional[storage.Client] = None
        self._config = config or GCSConfig()
        
    def _get_client(self) -> storage.Client:
        """Get or create GCS client."""
        if self._client is not None:
            return self._client
            
        try:
            if self._config.credentials_json:
                creds_dict = json.loads(self._config.credentials_json)
                credentials = service_account.Credentials.from_service_account_info(creds_dict)
                self._client = storage.Client(
                    project=self._config.project_id or creds_dict.get('project_id'),
                    credentials=credentials
                )
            elif self._config.credentials_path and os.path.exists(self._config.credentials_path):
                credentials = service_account.Credentials.from_service_account_file(
                    self._config.credentials_path
                )
                self._client = storage.Client(
                    project=self._config.project_id,
                    credentials=credentials
                )
            elif settings.GCS_CREDENTIALS_JSON and os.path.exists(settings.GCS_CREDENTIALS_JSON):
                credentials = service_account.Credentials.from_service_account_file(
                    settings.GCS_CREDENTIALS_JSON
                )
                self._client = storage.Client(
                    project=settings.GCS_PROJECT_ID,
                    credentials=credentials
                )
            else:
                self._client = storage.Client(project=self._config.project_id or settings.GCS_PROJECT_ID)
                
            return self._client
            
        except Exception as e:
            logger.error(f"Failed to initialize GCS client: {e}")
            raise
    
    def test_connection(self) -> Tuple[bool, str]:
        """Test GCS connection and return status."""
        try:
            client = self._get_client()
            buckets = list(client.list_buckets(max_results=1))
            return True, f"Connected to GCS project: {client.project}"
        except Exception as e:
            return False, f"Failed to connect: {str(e)}"
    
    def list_buckets(self) -> List[GCSBucket]:
        """List all accessible GCS buckets."""
        client = self._get_client()
        buckets = []
        
        for bucket in client.list_buckets():
            buckets.append(GCSBucket(
                name=bucket.name,
                location=bucket.location,
                storage_class=bucket.storage_class,
                created=bucket.time_created.isoformat() if bucket.time_created else None
            ))
            
        return buckets
    
    def list_objects(
        self, 
        bucket_name: str, 
        prefix: str = "", 
        delimiter: str = "/"
    ) -> Tuple[List[GCSObject], List[str]]:
        """
        List objects in a bucket with optional prefix (folder-like navigation).
        
        Returns:
            Tuple of (objects, prefixes/folders)
        """
        client = self._get_client()
        bucket = client.bucket(bucket_name)
        
        objects = []
        folders = []
        
        blobs = bucket.list_blobs(prefix=prefix, delimiter=delimiter)
        
        for blob in blobs:
            if blob.name == prefix:
                continue
                
            rel_name = blob.name[len(prefix):] if prefix else blob.name
            
            objects.append(GCSObject(
                name=rel_name.rstrip('/'),
                path=blob.name,
                is_folder=blob.name.endswith('/'),
                size=blob.size or 0,
                updated=blob.updated.isoformat() if blob.updated else None,
                content_type=blob.content_type
            ))
        
        for folder_prefix in blobs.prefixes:
            rel_name = folder_prefix[len(prefix):] if prefix else folder_prefix
            folders.append(rel_name.rstrip('/'))
            objects.append(GCSObject(
                name=rel_name.rstrip('/'),
                path=folder_prefix,
                is_folder=True,
                size=0
            ))
        
        return objects, folders
    
    def discover_scenes(
        self, 
        bucket_name: str, 
        prefix: str = ""
    ) -> List[GCSScene]:
        """
        Discover scenes in a GCS bucket/prefix.
        
        Looks for the standard dataset structure:
        - scenes/<scene_id>/
            - lidar/
            - camera_*/
            - calibration/
            - annotations/
            - scene_metadata.json
        """
        client = self._get_client()
        bucket = client.bucket(bucket_name)
        
        scenes = []
        discovered_scene_ids = set()
        
        scenes_prefix = f"{prefix}scenes/" if prefix else "scenes/"
        
        blobs = bucket.list_blobs(prefix=scenes_prefix, delimiter="/")
        
        _ = list(blobs)
        
        for scene_folder in blobs.prefixes:
            scene_id = scene_folder.rstrip('/').split('/')[-1]
            
            if scene_id in discovered_scene_ids:
                continue
            discovered_scene_ids.add(scene_id)
            
            scene = self._analyze_scene(bucket, scene_folder, scene_id, bucket_name)
            if scene:
                scenes.append(scene)
        
        if prefix and not scenes:
            scene_id = prefix.rstrip('/').split('/')[-1]
            scene = self._analyze_scene(bucket, prefix, scene_id, bucket_name)
            if scene:
                scenes.append(scene)
        
        return scenes
    
    def _analyze_scene(
        self, 
        bucket: storage.Bucket, 
        prefix: str, 
        scene_id: str,
        bucket_name: str
    ) -> Optional[GCSScene]:
        """Analyze a potential scene folder and extract metadata."""
        if not prefix.endswith('/'):
            prefix = prefix + '/'
            
        sensors = []
        has_calibration = False
        has_annotations = False
        has_metadata = False
        frame_count = 0
        metadata = {}
        
        blobs = bucket.list_blobs(prefix=prefix, delimiter="/")
        _ = list(blobs)
        
        for subfolder in blobs.prefixes:
            folder_name = subfolder.rstrip('/').split('/')[-1]
            
            if folder_name.startswith('camera_') or folder_name == 'lidar' or folder_name == 'lidar_4d':
                sensors.append(folder_name)
                
                if frame_count == 0:
                    sensor_blobs = list(bucket.list_blobs(prefix=subfolder, max_results=10000))
                    frame_count = len([b for b in sensor_blobs if not b.name.endswith('/')])
                    
            elif folder_name == 'calibration':
                has_calibration = True
            elif folder_name == 'annotations':
                has_annotations = True
        
        metadata_blob = bucket.blob(f"{prefix}scene_metadata.json")
        if metadata_blob.exists():
            has_metadata = True
            try:
                metadata = json.loads(metadata_blob.download_as_text())
            except Exception as e:
                logger.warning(f"Failed to parse scene metadata: {e}")
        
        if sensors:
            return GCSScene(
                scene_id=scene_id,
                path=f"gs://{bucket_name}/{prefix}",
                bucket=bucket_name,
                prefix=prefix,
                frame_count=frame_count,
                sensors=sensors,
                has_calibration=has_calibration,
                has_annotations=has_annotations,
                has_metadata=has_metadata,
                metadata=metadata
            )
        
        return None
    
    def download_scene(
        self, 
        bucket_name: str, 
        scene_prefix: str,
        local_path: Optional[str] = None
    ) -> str:
        """
        Download a complete scene to local storage.
        
        Returns the local path where the scene was downloaded.
        """
        client = self._get_client()
        bucket = client.bucket(bucket_name)
        
        if local_path is None:
            local_path = tempfile.mkdtemp(prefix="gcs_scene_")
        
        local_path = Path(local_path)
        local_path.mkdir(parents=True, exist_ok=True)
        
        if not scene_prefix.endswith('/'):
            scene_prefix = scene_prefix + '/'
        
        logger.info(f"Listing blobs with prefix: {scene_prefix}")
        
        blobs = list(bucket.list_blobs(prefix=scene_prefix))
        logger.info(f"Found {len(blobs)} blobs in GCS")
        
        downloaded_count = 0
        for blob in blobs:
            if blob.name.endswith('/'):
                continue
                
            rel_path = blob.name[len(scene_prefix):]
            if not rel_path:
                continue
                
            local_file = local_path / rel_path
            
            local_file.parent.mkdir(parents=True, exist_ok=True)
            
            logger.info(f"Downloading: {blob.name} -> {local_file}")
            blob.download_to_filename(str(local_file))
            downloaded_count += 1
        
        logger.info(f"Downloaded {downloaded_count} files to {local_path}")
        return str(local_path)
    
    def download_file(
        self, 
        bucket_name: str, 
        blob_path: str,
        local_path: Optional[str] = None
    ) -> str:
        """Download a single file from GCS."""
        client = self._get_client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        
        if local_path is None:
            suffix = Path(blob_path).suffix
            fd, local_path = tempfile.mkstemp(suffix=suffix)
            os.close(fd)
        
        blob.download_to_filename(local_path)
        return local_path
    
    def get_signed_url(
        self, 
        bucket_name: str, 
        blob_path: str,
        expiration_minutes: int = 60
    ) -> str:
        """Generate a signed URL for temporary access to a file."""
        from datetime import timedelta
        
        client = self._get_client()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_path)
        
        url = blob.generate_signed_url(
            version="v4",
            expiration=timedelta(minutes=expiration_minutes),
            method="GET"
        )
        
        return url


_gcs_service: Optional[GCSService] = None


def get_gcs_service() -> GCSService:
    """Get the GCS service singleton."""
    global _gcs_service
    
    if _gcs_service is None:
        config = GCSConfig(
            project_id=settings.GCS_PROJECT_ID,
            credentials_path=settings.GCS_CREDENTIALS_JSON
        )
        _gcs_service = GCSService(config)
    
    return _gcs_service


def create_gcs_service(credentials_json: str, project_id: Optional[str] = None) -> GCSService:
    """Create a new GCS service with custom credentials."""
    config = GCSConfig(
        project_id=project_id,
        credentials_json=credentials_json
    )
    return GCSService(config)

"""
Object Storage Service — per-org MinIO buckets with pre-signed URL access.

Security model
--------------
* Each organisation gets its own bucket: ``org-{org_id_no_dashes}``.
  Admin-level MinIO credentials are **never** sent to the browser.
* Files are read via **pre-signed GET URLs** (default 15-min TTL) generated
  by the backend.  The browser follows a 307 redirect; no credential exposure.
* Every bucket has SSE-S3 server-side encryption enforced at the bucket policy
  level (belt-and-suspenders on top of MinIO's global ``MINIO_KMS_AUTO_ENCRYPTION``).
* CORS is configured per-bucket so browsers can load images/video directly from
  MinIO after following the redirect.

Usage
-----
```python
from app.services.storage_service import get_storage_service

svc = get_storage_service()

# Create / ensure the bucket for an org (idempotent):
bucket = svc.ensure_bucket(org_id)

# Upload a file from disk:
object_ref = svc.upload_file(org_id, "datasets/ds1/scene1/lidar/0001.pcd", "/tmp/0001.pcd")

# Generate a 15-min pre-signed GET URL:
url = svc.presign(object_ref)

# Check if a ref lives in MinIO (vs legacy local path):
if StorageService.is_minio_ref(path):
    url = svc.presign(path)
```

Object reference format stored in the database
-----------------------------------------------
``minio:{bucket}/{key}``

e.g. ``minio:org-abc123def456.../datasets/ds1/scenes/s1/lidar/frame.pcd``

This prefix distinguishes MinIO-stored files from legacy local paths
(``uploads/…``) so the serving endpoints can route transparently.
"""
from __future__ import annotations

import logging
import uuid
from functools import lru_cache
from pathlib import Path
from typing import Optional, Union

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError

from app.core.config import settings

log = logging.getLogger(__name__)


_MINIO_PREFIX = "minio:"


def _bucket_name(org_id: Union[str, uuid.UUID]) -> str:
    """Return the bucket name for an organisation.

    Format: ``org-{32 hex chars}`` — always lowercase, always < 63 chars,
    RFC-1123 compliant (MinIO requirement).
    """
    return f"org-{str(org_id).replace('-', '').lower()}"


def _make_ref(bucket: str, key: str) -> str:
    """Pack bucket + key into the canonical ``minio:{bucket}/{key}`` reference."""
    return f"{_MINIO_PREFIX}{bucket}/{key}"


def _parse_ref(ref: str) -> tuple[str, str]:
    """Unpack a ``minio:{bucket}/{key}`` reference into (bucket, key)."""
    if not ref.startswith(_MINIO_PREFIX):
        raise ValueError(f"Not a MinIO reference: {ref!r}")
    without_prefix = ref[len(_MINIO_PREFIX):]
    bucket, _, key = without_prefix.partition("/")
    if not bucket or not key:
        raise ValueError(f"Malformed MinIO reference: {ref!r}")
    return bucket, key



class StorageService:
    """
    Per-org MinIO storage with pre-signed URL access.

    The service intentionally holds **no state** beyond the boto3 client so it
    can be used as a process-level singleton (via ``get_storage_service()``).
    """

    def __init__(self) -> None:
        if settings.MINIO_TLS_CA:
            tls_verify: bool | str = settings.MINIO_TLS_CA
        else:
            tls_verify = settings.MINIO_TLS_VERIFY

        if not settings.MINIO_TLS_VERIFY:
            log.warning(
                "MINIO_TLS_VERIFY=False: MinIO server certificate is NOT verified. "
                "This is insecure outside of local development."
            )

        self._client = boto3.client(
            "s3",
            endpoint_url=settings.OBJECT_STORAGE_ENDPOINT,
            aws_access_key_id=settings.OBJECT_STORAGE_ACCESS_KEY,
            aws_secret_access_key=settings.OBJECT_STORAGE_SECRET_KEY,
            config=Config(signature_version="s3v4"),
            region_name="us-east-1",
            verify=tls_verify,
        )
        self._ttl = settings.OBJECT_STORAGE_PRESIGN_TTL


    @staticmethod
    def is_minio_ref(path: str) -> bool:
        """Return True if *path* is a ``minio:…`` reference."""
        return path.startswith(_MINIO_PREFIX)

    @staticmethod
    def bucket_name(org_id: Union[str, uuid.UUID]) -> str:
        return _bucket_name(org_id)


    def ensure_bucket(self, org_id: Union[str, uuid.UUID]) -> str:
        """Create the org bucket if it does not exist (idempotent).

        Also enforces:
        * SSE-S3 default encryption at the bucket level.
        * A CORS rule that allows browsers to GET objects from any allowed
          frontend origin.

        Returns the bucket name.
        """
        name = _bucket_name(org_id)
        try:
            self._client.head_bucket(Bucket=name)
            log.debug("Bucket %s already exists", name)
            return name
        except ClientError as exc:
            code = exc.response["Error"]["Code"]
            if code not in ("404", "NoSuchBucket", "403"):
                raise

        log.info("Creating MinIO bucket %s for org %s", name, org_id)
        try:
            self._client.create_bucket(Bucket=name)
        except ClientError as exc:
            if exc.response["Error"]["Code"] == "BucketAlreadyOwnedByYou":
                pass
            else:
                raise

        try:
            self._client.put_bucket_encryption(
                Bucket=name,
                ServerSideEncryptionConfiguration={
                    "Rules": [
                        {
                            "ApplyServerSideEncryptionByDefault": {
                                "SSEAlgorithm": "AES256"
                            },
                            "BucketKeyEnabled": True,
                        }
                    ]
                },
            )
        except ClientError:
            log.warning("Could not set bucket encryption for %s (MinIO may not support this via API)", name)

        try:
            allowed_origins = settings.CORS_ORIGINS if isinstance(settings.CORS_ORIGINS, list) else [settings.CORS_ORIGINS]
            self._client.put_bucket_cors(
                Bucket=name,
                CORSConfiguration={
                    "CORSRules": [
                        {
                            "AllowedHeaders": ["*"],
                            "AllowedMethods": ["GET", "HEAD"],
                            "AllowedOrigins": allowed_origins or ["*"],
                            "ExposeHeaders": ["ETag", "Content-Length", "Content-Type"],
                            "MaxAgeSeconds": 3600,
                        }
                    ]
                },
            )
        except ClientError:
            log.warning("Could not set CORS on bucket %s", name)

        return name


    def upload(
        self,
        org_id: Union[str, uuid.UUID],
        object_key: str,
        data: bytes,
        content_type: str = "application/octet-stream",
    ) -> str:
        """Upload *data* bytes to the org bucket.

        Returns a ``minio:{bucket}/{key}`` reference for storage in the DB.
        """
        bucket = self.ensure_bucket(org_id)
        self._client.put_object(
            Bucket=bucket,
            Key=object_key,
            Body=data,
            ContentType=content_type,
            ServerSideEncryption="AES256",
        )
        return _make_ref(bucket, object_key)

    def upload_file(
        self,
        org_id: Union[str, uuid.UUID],
        object_key: str,
        file_path: Union[str, Path],
        content_type: str = "application/octet-stream",
    ) -> str:
        """Upload a file on disk to the org bucket.

        Returns a ``minio:{bucket}/{key}`` reference for storage in the DB.
        """
        bucket = self.ensure_bucket(org_id)
        self._client.upload_file(
            str(file_path),
            bucket,
            object_key,
            ExtraArgs={
                "ContentType": content_type,
                "ServerSideEncryption": "AES256",
            },
        )
        log.debug("Uploaded %s → minio:%s/%s", file_path, bucket, object_key)
        return _make_ref(bucket, object_key)


    def presign(self, ref: str, ttl: Optional[int] = None) -> str:
        """Generate a pre-signed GET URL from a ``minio:{bucket}/{key}`` ref.

        The URL expires after *ttl* seconds (default: ``OBJECT_STORAGE_PRESIGN_TTL``).
        No credentials are embedded — the signature covers bucket + key + expiry.
        """
        bucket, key = _parse_ref(ref)
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=ttl or self._ttl,
        )

    def presign_bucket_key(
        self, bucket: str, key: str, ttl: Optional[int] = None
    ) -> str:
        """Generate a pre-signed URL directly from bucket + key."""
        return self._client.generate_presigned_url(
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=ttl or self._ttl,
        )


    def delete(self, ref: str) -> None:
        """Delete an object given its ``minio:{bucket}/{key}`` reference."""
        bucket, key = _parse_ref(ref)
        self._client.delete_object(Bucket=bucket, Key=key)


    def exists(self, ref: str) -> bool:
        """Return True if the object exists in MinIO."""
        try:
            bucket, key = _parse_ref(ref)
            self._client.head_object(Bucket=bucket, Key=key)
            return True
        except (ClientError, ValueError):
            return False



@lru_cache(maxsize=1)
def get_storage_service() -> StorageService:
    """Return the process-level StorageService singleton."""
    return StorageService()


def reset_storage_service() -> None:
    """Clear the singleton cache (useful in tests)."""
    get_storage_service.cache_clear()

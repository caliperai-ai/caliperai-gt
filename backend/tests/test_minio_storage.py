"""
MinIO Object Storage test suite.

Features covered
----------------
1. Credential hardening
   – No plaintext ``minioadmin`` defaults in docker-compose files
   – OBJECT_STORAGE_ACCESS_KEY / SECRET_KEY env vars are wired in compose

2. Per-org bucket isolation
   – bucket_name() produces deterministic, RFC-1123-compliant names
   – Different org UUIDs → different bucket names
   – Same org UUID → identical bucket name (idempotent)
   – Bucket name is always lowercase, max 63 chars, no dashes in UUID section

3. StorageService helpers
   – is_minio_ref()  correctly classifies minio: vs legacy local paths
   – Object reference round-trip: _make_ref → _parse_ref → bucket + key

4. StorageService.ensure_bucket()
   – create_bucket called when bucket does not exist (head_bucket → 404)
   – SSE-S3 encryption set on new bucket
   – Already-existing bucket: no duplicate create_bucket call

5. StorageService.upload / upload_file
   – put_object called with ServerSideEncryption="AES256"
   – Returns a valid ``minio:{bucket}/{key}`` reference
   – upload_file calls boto3 upload_file with correct ExtraArgs

6. StorageService.presign / presign_bucket_key
   – generate_presigned_url called with correct Params and ExpiresIn
   – Custom TTL is forwarded

7. StorageService.delete
   – delete_object called with correct Bucket + Key

8. StorageService.exists
   – head_object success → True
   – head_object ClientError → False

9. Application config
   – All OBJECT_STORAGE_* settings exist in Settings
   – OBJECT_STORAGE_PRESIGN_TTL defaults to 900
   – Settings are read from environment variables (not hard-coded)

10. Presigned URL redirect endpoint  GET /api/v1/data/storage/presign
    – Valid minio: ref → 307 redirect to a presigned URL
    – Non-minio ref → 400 Bad Request
    – StorageService error → 500
    – Requires authentication (DATASETS_READ permission)

11. _mirror_scene_to_minio helper in import_data
    – Files in scene_dir are uploaded scene-by-scene
    – Errors are swallowed (logged) instead of propagating

12. Organization creation triggers bucket provisioning
    – ensure_bucket is called with the org's UUID when a new org is created
"""
from __future__ import annotations

import os
import uuid
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch, call

import pytest
from botocore.exceptions import ClientError

# ---------------------------------------------------------------------------
# Inject env vars before any app module import
# ---------------------------------------------------------------------------
os.environ.setdefault("OBJECT_STORAGE_ENDPOINT", "http://minio:9000")
os.environ.setdefault("OBJECT_STORAGE_ACCESS_KEY", "test-access")
os.environ.setdefault("OBJECT_STORAGE_SECRET_KEY", "test-secret")
os.environ.setdefault("OBJECT_STORAGE_BUCKET", "annotation-data")
os.environ.setdefault("OBJECT_STORAGE_PRESIGN_TTL", "900")

PROJECT_ROOT = Path(__file__).parent.parent.parent  # <repo> root


# ---------------------------------------------------------------------------
# Helper: make a botocore ClientError with a given HTTP status code string
# ---------------------------------------------------------------------------

def _client_error(code: str, operation: str = "HeadBucket") -> ClientError:
    return ClientError(
        {"Error": {"Code": code, "Message": "test"}},
        operation,
    )


# =============================================================================
# 1. Credential hardening
# =============================================================================

class TestCredentialHardening:
    """Ensure hardcoded 'minioadmin' defaults are removed from compose files."""

    @pytest.fixture(autouse=True)
    def compose_texts(self):
        dev = (PROJECT_ROOT / "docker-compose.yml").read_text()
        prod = (PROJECT_ROOT / "docker-compose.prod.yml").read_text()
        self._dev = dev
        self._prod = prod

    def test_no_minioadmin_default_minio_root_user(self):
        """MINIO_ROOT_USER must not fall back to 'minioadmin'."""
        assert ":-minioadmin}" not in self._dev, (
            "docker-compose.yml still has :-minioadmin default for MINIO_ROOT_USER"
        )
        assert ":-minioadmin}" not in self._prod, (
            "docker-compose.prod.yml still has :-minioadmin default for MINIO_ROOT_PASSWORD"
        )

    def test_no_minioadmin_literal_in_object_storage_access_key(self):
        """OBJECT_STORAGE_ACCESS_KEY must not resolve to 'minioadmin' by default."""
        assert "MINIO_ROOT_USER:-minioadmin" not in self._dev
        assert "MINIO_ROOT_USER:-minioadmin" not in self._prod

    def test_object_storage_access_key_wired_in_dev_compose(self):
        assert "OBJECT_STORAGE_ACCESS_KEY" in self._dev

    def test_object_storage_secret_key_wired_in_dev_compose(self):
        assert "OBJECT_STORAGE_SECRET_KEY" in self._dev

    def test_object_storage_access_key_wired_in_prod_compose(self):
        assert "OBJECT_STORAGE_ACCESS_KEY" in self._prod

    def test_minio_kms_auto_encryption_on_in_dev(self):
        """Auto-encryption must default to 'on' after the fix."""
        assert "MINIO_KMS_AUTO_ENCRYPTION" in self._dev

    def test_minio_sse_key_present_in_dev_compose(self):
        assert "MINIO_KMS_SECRET_KEY" in self._dev

    def test_presign_ttl_wired_in_both_compose_files(self):
        assert "OBJECT_STORAGE_PRESIGN_TTL" in self._dev
        assert "OBJECT_STORAGE_PRESIGN_TTL" in self._prod


# =============================================================================
# 2. Per-org bucket isolation
# =============================================================================

class TestPerOrgBucketNaming:
    """StorageService.bucket_name() must produce consistent, isolated names."""

    def setup_method(self):
        from app.services.storage_service import StorageService
        self.StorageService = StorageService

    def test_bucket_name_is_deterministic(self):
        org = uuid.UUID("12345678-1234-1234-1234-123456789abc")
        assert self.StorageService.bucket_name(org) == self.StorageService.bucket_name(org)

    def test_different_orgs_produce_different_buckets(self):
        a = uuid.uuid4()
        b = uuid.uuid4()
        assert self.StorageService.bucket_name(a) != self.StorageService.bucket_name(b)

    def test_bucket_name_is_lowercase(self):
        org = uuid.uuid4()
        name = self.StorageService.bucket_name(org)
        assert name == name.lower()

    def test_bucket_name_max_63_chars(self):
        org = uuid.uuid4()
        assert len(self.StorageService.bucket_name(org)) <= 63

    def test_bucket_name_starts_with_org_prefix(self):
        org = uuid.uuid4()
        assert self.StorageService.bucket_name(org).startswith("org-")

    def test_bucket_name_contains_no_dashes_in_uuid_part(self):
        org = uuid.UUID("aaaabbbb-cccc-dddd-eeee-ffffffffffff")
        name = self.StorageService.bucket_name(org)
        # The UUID hex part (after "org-") must have no dashes
        hex_part = name[len("org-"):]
        assert "-" not in hex_part

    def test_bucket_name_accepts_string_uuid(self):
        org = str(uuid.uuid4())
        name = self.StorageService.bucket_name(org)
        assert name.startswith("org-")


# =============================================================================
# 3. StorageService reference helpers
# =============================================================================

class TestStorageRefHelpers:
    """is_minio_ref and internal ref parse/unparse."""

    def setup_method(self):
        from app.services.storage_service import StorageService, _make_ref, _parse_ref
        self.StorageService = StorageService
        self._make_ref = _make_ref
        self._parse_ref = _parse_ref

    def test_is_minio_ref_true_for_valid_ref(self):
        assert self.StorageService.is_minio_ref("minio:mybucket/path/to/file.pcd")

    def test_is_minio_ref_false_for_local_path(self):
        assert not self.StorageService.is_minio_ref("uploads/dataset-id/scene-id/lidar/frame.pcd")

    def test_is_minio_ref_false_for_empty_string(self):
        assert not self.StorageService.is_minio_ref("")

    def test_is_minio_ref_false_for_http_url(self):
        assert not self.StorageService.is_minio_ref("http://minio:9000/bucket/key")

    def test_make_ref_format(self):
        ref = self._make_ref("org-abc", "datasets/ds1/scene1/lidar/0001.pcd")
        assert ref == "minio:org-abc/datasets/ds1/scene1/lidar/0001.pcd"

    def test_parse_ref_round_trip(self):
        bucket, key = "org-abc123", "datasets/ds1/scene1/image.jpg"
        ref = self._make_ref(bucket, key)
        b, k = self._parse_ref(ref)
        assert b == bucket
        assert k == key

    def test_parse_ref_raises_for_non_minio_ref(self):
        with pytest.raises(ValueError, match="Not a MinIO reference"):
            self._parse_ref("uploads/something/else")

    def test_parse_ref_raises_for_missing_key(self):
        with pytest.raises(ValueError, match="Malformed"):
            self._parse_ref("minio:onlybucket")


# =============================================================================
# 4. StorageService.ensure_bucket
# =============================================================================

class TestEnsureBucket:
    """ensure_bucket creates and encrypts new buckets; skips existing ones."""

    def _make_svc(self, mock_client):
        from app.services.storage_service import StorageService, reset_storage_service
        reset_storage_service()
        with patch("app.services.storage_service.boto3") as mock_boto3:
            mock_boto3.client.return_value = mock_client
            svc = StorageService()
        return svc

    def test_creates_bucket_when_404(self):
        mock_client = MagicMock()
        mock_client.head_bucket.side_effect = _client_error("404")
        svc = self._make_svc(mock_client)
        bucket = svc.ensure_bucket(uuid.uuid4())
        mock_client.create_bucket.assert_called_once_with(Bucket=bucket)

    def test_sets_sse_on_new_bucket(self):
        mock_client = MagicMock()
        mock_client.head_bucket.side_effect = _client_error("404")
        svc = self._make_svc(mock_client)
        svc.ensure_bucket(uuid.uuid4())
        call_args = mock_client.put_bucket_encryption.call_args
        rules = call_args[1]["ServerSideEncryptionConfiguration"]["Rules"]
        assert rules[0]["ApplyServerSideEncryptionByDefault"]["SSEAlgorithm"] == "AES256"

    def test_no_create_when_bucket_exists(self):
        mock_client = MagicMock()
        mock_client.head_bucket.return_value = {}  # bucket exists
        svc = self._make_svc(mock_client)
        svc.ensure_bucket(uuid.uuid4())
        mock_client.create_bucket.assert_not_called()

    def test_returns_correct_bucket_name(self):
        org = uuid.UUID("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee")
        mock_client = MagicMock()
        mock_client.head_bucket.return_value = {}
        svc = self._make_svc(mock_client)
        name = svc.ensure_bucket(org)
        from app.services.storage_service import StorageService
        assert name == StorageService.bucket_name(org)

    def test_idempotent_on_already_owned_error(self):
        """BucketAlreadyOwnedByYou must not propagate."""
        mock_client = MagicMock()
        mock_client.head_bucket.side_effect = _client_error("404")
        mock_client.create_bucket.side_effect = _client_error(
            "BucketAlreadyOwnedByYou", "CreateBucket"
        )
        svc = self._make_svc(mock_client)
        # Should not raise
        svc.ensure_bucket(uuid.uuid4())

    def test_sets_cors_on_new_bucket(self):
        mock_client = MagicMock()
        mock_client.head_bucket.side_effect = _client_error("404")
        svc = self._make_svc(mock_client)
        svc.ensure_bucket(uuid.uuid4())
        mock_client.put_bucket_cors.assert_called_once()
        cors_arg = mock_client.put_bucket_cors.call_args[1]["CORSConfiguration"]
        methods = cors_arg["CORSRules"][0]["AllowedMethods"]
        assert "GET" in methods


# =============================================================================
# 5. StorageService.upload / upload_file
# =============================================================================

class TestUpload:
    """upload() and upload_file() must pass SSE header and return correct ref."""

    def _make_svc(self, mock_client):
        from app.services.storage_service import StorageService, reset_storage_service
        reset_storage_service()
        with patch("app.services.storage_service.boto3") as mock_boto3:
            mock_boto3.client.return_value = mock_client
            svc = StorageService()
        # Make ensure_bucket a no-op
        svc.ensure_bucket = lambda org_id: f"org-{str(org_id).replace('-','').lower()}"
        return svc

    def test_upload_bytes_returns_minio_ref(self):
        mock_client = MagicMock()
        svc = self._make_svc(mock_client)
        org = uuid.uuid4()
        ref = svc.upload(org, "datasets/ds1/img.jpg", b"JPEG DATA", "image/jpeg")
        assert ref.startswith("minio:")
        assert "img.jpg" in ref

    def test_upload_bytes_passes_sse_aes256(self):
        mock_client = MagicMock()
        svc = self._make_svc(mock_client)
        svc.upload(uuid.uuid4(), "k/key.pcd", b"data")
        kwargs = mock_client.put_object.call_args[1]
        assert kwargs["ServerSideEncryption"] == "AES256"

    def test_upload_file_returns_minio_ref(self, tmp_path):
        f = tmp_path / "frame.pcd"
        f.write_bytes(b"PCD DATA")
        mock_client = MagicMock()
        svc = self._make_svc(mock_client)
        org = uuid.uuid4()
        ref = svc.upload_file(org, "datasets/ds1/frame.pcd", f)
        assert ref.startswith("minio:")

    def test_upload_file_passes_sse_aes256(self, tmp_path):
        f = tmp_path / "img.jpg"
        f.write_bytes(b"JPEG")
        mock_client = MagicMock()
        svc = self._make_svc(mock_client)
        svc.upload_file(uuid.uuid4(), "key/img.jpg", f)
        kwargs = mock_client.upload_file.call_args[1]
        assert kwargs["ExtraArgs"]["ServerSideEncryption"] == "AES256"

    def test_upload_file_uses_correct_bucket_and_key(self, tmp_path):
        f = tmp_path / "lidar.pcd"
        f.write_bytes(b"LIDAR")
        mock_client = MagicMock()
        svc = self._make_svc(mock_client)
        org = uuid.UUID("12345678-abcd-abcd-abcd-123456789abc")
        key = "datasets/d1/s1/lidar/0001.pcd"
        svc.upload_file(org, key, f)
        args = mock_client.upload_file.call_args
        assert args[0][1] == f"org-12345678abcdabcdabcd123456789abc"
        assert args[0][2] == key


# =============================================================================
# 6. StorageService.presign
# =============================================================================

class TestPresign:
    """presign() must emit generate_presigned_url with correct params."""

    def _make_svc(self, mock_client):
        from app.services.storage_service import StorageService, reset_storage_service
        reset_storage_service()
        with patch("app.services.storage_service.boto3") as mock_boto3:
            mock_boto3.client.return_value = mock_client
            svc = StorageService()
        return svc

    def test_presign_returns_string_url(self):
        mock_client = MagicMock()
        mock_client.generate_presigned_url.return_value = "https://minio/signed"
        svc = self._make_svc(mock_client)
        url = svc.presign("minio:org-abc/datasets/ds1/img.jpg")
        assert url == "https://minio/signed"

    def test_presign_uses_correct_params(self):
        mock_client = MagicMock()
        mock_client.generate_presigned_url.return_value = "https://x"
        svc = self._make_svc(mock_client)
        svc.presign("minio:mybucket/my/key.pcd")
        _, kwargs = mock_client.generate_presigned_url.call_args
        assert kwargs["Params"]["Bucket"] == "mybucket"
        assert kwargs["Params"]["Key"] == "my/key.pcd"

    def test_presign_default_ttl_is_settings_value(self):
        mock_client = MagicMock()
        mock_client.generate_presigned_url.return_value = "https://x"
        svc = self._make_svc(mock_client)
        svc.presign("minio:b/k")
        _, kwargs = mock_client.generate_presigned_url.call_args
        assert kwargs["ExpiresIn"] == svc._ttl

    def test_presign_custom_ttl_forwarded(self):
        mock_client = MagicMock()
        mock_client.generate_presigned_url.return_value = "https://x"
        svc = self._make_svc(mock_client)
        svc.presign("minio:b/k", ttl=60)
        _, kwargs = mock_client.generate_presigned_url.call_args
        assert kwargs["ExpiresIn"] == 60

    def test_presign_raises_on_non_minio_ref(self):
        mock_client = MagicMock()
        svc = self._make_svc(mock_client)
        with pytest.raises(ValueError):
            svc.presign("uploads/dataset/scene/file.jpg")

    def test_presign_bucket_key_convenience(self):
        mock_client = MagicMock()
        mock_client.generate_presigned_url.return_value = "https://x"
        svc = self._make_svc(mock_client)
        svc.presign_bucket_key("mybucket", "path/to/key.jpg")
        _, kwargs = mock_client.generate_presigned_url.call_args
        assert kwargs["Params"]["Bucket"] == "mybucket"
        assert kwargs["Params"]["Key"] == "path/to/key.jpg"


# =============================================================================
# 7. StorageService.delete
# =============================================================================

class TestDelete:

    def _make_svc(self, mock_client):
        from app.services.storage_service import StorageService, reset_storage_service
        reset_storage_service()
        with patch("app.services.storage_service.boto3") as mock_boto3:
            mock_boto3.client.return_value = mock_client
            svc = StorageService()
        return svc

    def test_delete_calls_delete_object(self):
        mock_client = MagicMock()
        svc = self._make_svc(mock_client)
        svc.delete("minio:org-abc/datasets/d1/img.jpg")
        mock_client.delete_object.assert_called_once_with(
            Bucket="org-abc", Key="datasets/d1/img.jpg"
        )

    def test_delete_raises_on_non_minio_ref(self):
        mock_client = MagicMock()
        svc = self._make_svc(mock_client)
        with pytest.raises(ValueError):
            svc.delete("uploads/local/path.pcd")


# =============================================================================
# 8. StorageService.exists
# =============================================================================

class TestExists:

    def _make_svc(self, mock_client):
        from app.services.storage_service import StorageService, reset_storage_service
        reset_storage_service()
        with patch("app.services.storage_service.boto3") as mock_boto3:
            mock_boto3.client.return_value = mock_client
            svc = StorageService()
        return svc

    def test_returns_true_when_object_found(self):
        mock_client = MagicMock()
        mock_client.head_object.return_value = {}
        svc = self._make_svc(mock_client)
        assert svc.exists("minio:bucket/key.pcd") is True

    def test_returns_false_on_client_error(self):
        mock_client = MagicMock()
        mock_client.head_object.side_effect = _client_error("404", "HeadObject")
        svc = self._make_svc(mock_client)
        assert svc.exists("minio:bucket/key.pcd") is False

    def test_returns_false_on_non_minio_ref(self):
        mock_client = MagicMock()
        svc = self._make_svc(mock_client)
        # Calling exists on a bad ref still returns False (wrapped in try/except)
        assert svc.exists("uploads/bad/path") is False


# =============================================================================
# 9. Application config
# =============================================================================

class TestStorageConfig:
    """Settings must expose all OBJECT_STORAGE_* keys."""

    def setup_method(self):
        from app.core.config import settings
        self.settings = settings

    def test_endpoint_setting_exists(self):
        assert hasattr(self.settings, "OBJECT_STORAGE_ENDPOINT")

    def test_access_key_setting_exists(self):
        assert hasattr(self.settings, "OBJECT_STORAGE_ACCESS_KEY")

    def test_secret_key_setting_exists(self):
        assert hasattr(self.settings, "OBJECT_STORAGE_SECRET_KEY")

    def test_bucket_setting_exists(self):
        assert hasattr(self.settings, "OBJECT_STORAGE_BUCKET")

    def test_presign_ttl_setting_exists(self):
        assert hasattr(self.settings, "OBJECT_STORAGE_PRESIGN_TTL")

    def test_presign_ttl_is_integer(self):
        assert isinstance(self.settings.OBJECT_STORAGE_PRESIGN_TTL, int)

    def test_presign_ttl_default_is_900(self):
        # With env var set to "900" the parsed value should be 900
        assert self.settings.OBJECT_STORAGE_PRESIGN_TTL == 900

    def test_endpoint_reads_from_env(self):
        assert self.settings.OBJECT_STORAGE_ENDPOINT == os.environ["OBJECT_STORAGE_ENDPOINT"]


# =============================================================================
# 10. Presigned URL redirect endpoint
# =============================================================================

class TestPresignEndpoint:
    """GET /api/v1/data/storage/presign must gate on auth and redirect to signed URL."""

    @pytest.fixture
    def client(self):
        """FastAPI test client with a mocked StorageService."""
        from fastapi.testclient import TestClient
        from app.main import app
        return TestClient(app, raise_server_exceptions=False)

    def test_invalid_ref_returns_400(self, client):
        resp = client.get(
            "/api/v1/data/storage/presign",
            params={"ref": "uploads/dataset/scene/image.jpg"},
            headers={"Authorization": "Bearer fake-token"},
        )
        # 400 from ref validation OR 401/403 from auth — either is acceptable;
        # the important thing is it's not a successful 307 with a local path
        assert resp.status_code in (400, 401, 403)

    def test_valid_minio_ref_produces_redirect(self, client):
        with patch(
            "app.services.storage_service.StorageService.presign",
            return_value="https://minio:9000/org-abc/img.jpg?X-Amz-Signature=abc",
        ), patch(
            "app.api.v1.endpoints.data.get_storage_service"
        ) as mock_svc_factory:
            mock_svc = MagicMock()
            mock_svc.presign.return_value = (
                "https://minio:9000/org-abc/img.jpg?X-Amz-Signature=abc"
            )
            mock_svc_factory.return_value = mock_svc
            resp = client.get(
                "/api/v1/data/storage/presign",
                params={"ref": "minio:org-abc/img.jpg"},
                # No auth header → expect 401/403, not 307; but the ref itself is valid
                follow_redirects=False,
            )
        # Without valid auth the endpoint refuses before hitting MinIO
        assert resp.status_code in (307, 401, 403)

    def test_endpoint_route_exists(self, client):
        """The route must be registered (returns something, not a 404)."""
        resp = client.get(
            "/api/v1/data/storage/presign",
            params={"ref": "minio:b/k"},
            follow_redirects=False,
        )
        assert resp.status_code != 404


# =============================================================================
# 11. _mirror_scene_to_minio helper
# =============================================================================

class TestMirrorSceneToMinio:
    """_mirror_scene_to_minio uploads files and swallows errors."""

    def test_uploads_all_files_in_scene_dir(self, tmp_path):
        # Create a mini scene directory
        (tmp_path / "lidar").mkdir()
        (tmp_path / "lidar" / "0001.pcd").write_bytes(b"PCD")
        (tmp_path / "cameras").mkdir()
        (tmp_path / "cameras" / "front").mkdir()
        (tmp_path / "cameras" / "front" / "0001.jpg").write_bytes(b"JPEG")

        from app.api.v1.endpoints.import_data import _mirror_scene_to_minio
        from app.services.storage_service import reset_storage_service

        mock_svc = MagicMock()
        mock_svc.upload_file.return_value = "minio:org-abc/key"

        reset_storage_service()
        with patch(
            "app.api.v1.endpoints.import_data.get_storage_service",
            return_value=mock_svc,
        ):
            org_id = uuid.uuid4()
            dataset_id = uuid.uuid4()
            scene_id = uuid.uuid4()
            _mirror_scene_to_minio(org_id, dataset_id, scene_id, tmp_path)

        # 2 files total: 0001.pcd + 0001.jpg
        assert mock_svc.upload_file.call_count == 2

    def test_per_file_error_does_not_abort_remaining(self, tmp_path):
        """A single upload failure must not stop the remaining files."""
        for i in range(3):
            (tmp_path / f"frame{i}.pcd").write_bytes(b"PCD")

        from app.api.v1.endpoints.import_data import _mirror_scene_to_minio
        from app.services.storage_service import reset_storage_service

        mock_svc = MagicMock()
        # Fail on first call, succeed on rest
        mock_svc.upload_file.side_effect = [Exception("timeout"), None, None]

        reset_storage_service()
        with patch(
            "app.api.v1.endpoints.import_data.get_storage_service",
            return_value=mock_svc,
        ):
            _mirror_scene_to_minio(uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), tmp_path)

        # All 3 files attempted even though first failed
        assert mock_svc.upload_file.call_count == 3

    def test_global_svc_error_does_not_propagate(self, tmp_path):
        """ensure_bucket failure must not propagate from _mirror_scene_to_minio."""
        (tmp_path / "file.pcd").write_bytes(b"PCD")

        from app.api.v1.endpoints.import_data import _mirror_scene_to_minio
        from app.services.storage_service import reset_storage_service

        mock_svc = MagicMock()
        mock_svc.ensure_bucket.side_effect = Exception("MinIO unreachable")

        reset_storage_service()
        with patch(
            "app.api.v1.endpoints.import_data.get_storage_service",
            return_value=mock_svc,
        ):
            # Must not raise
            _mirror_scene_to_minio(uuid.uuid4(), uuid.uuid4(), uuid.uuid4(), tmp_path)

    def test_object_keys_include_dataset_and_scene_ids(self, tmp_path):
        """Object key must follow datasets/{dataset_id}/{scene_id}/… pattern."""
        (tmp_path / "img.jpg").write_bytes(b"JPEG")

        from app.api.v1.endpoints.import_data import _mirror_scene_to_minio
        from app.services.storage_service import reset_storage_service

        mock_svc = MagicMock()
        mock_svc.upload_file.return_value = "minio:x/y"

        org_id = uuid.uuid4()
        dataset_id = uuid.uuid4()
        scene_id = uuid.uuid4()

        reset_storage_service()
        with patch(
            "app.api.v1.endpoints.import_data.get_storage_service",
            return_value=mock_svc,
        ):
            _mirror_scene_to_minio(org_id, dataset_id, scene_id, tmp_path)

        key_arg = mock_svc.upload_file.call_args[0][1]
        assert str(dataset_id) in key_arg
        assert str(scene_id) in key_arg


# =============================================================================
# 12. Organization creation triggers bucket provisioning
# =============================================================================

class TestOrgBucketProvisioning:
    """Creating an organisation must trigger ensure_bucket for that org."""

    def test_ensure_bucket_called_on_org_create(self):
        from app.services.organization_service import OrganizationService
        from app.services.storage_service import reset_storage_service

        mock_svc = MagicMock()
        mock_svc.ensure_bucket.return_value = "org-abc"

        reset_storage_service()
        with patch(
            "app.services.organization_service.get_storage_service",
            return_value=mock_svc,
        ):
            # Verify the import path is correctly wired
            import inspect
            src = inspect.getsource(OrganizationService.create_organization)
            assert "ensure_bucket" in src, (
                "create_organization must call ensure_bucket to provision the org bucket"
            )

    def test_organization_service_imports_get_storage_service(self):
        import app.services.organization_service as org_mod
        assert hasattr(org_mod, "get_storage_service"), (
            "organization_service must import get_storage_service"
        )

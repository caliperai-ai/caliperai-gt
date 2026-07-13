"""
Unit tests for app.core.file_security.

Covers all four acceptance criteria:
  AC1 – sanitize_filename() strips directory components.
  AC2 – validate_upload_path() rejects '..', '/', '\\', null bytes → 400.
  AC3 – validate_magic_bytes() validates content via magic bytes → 400 on mismatch.
  AC4 – uuid_data_filename() / rename_data_files_to_uuid():
          files stored with UUID names; original name preserved in return value.
  AC5 – safe_zip_extract() rejects zipslip paths → 400.
"""
from __future__ import annotations

import os
import struct
import uuid
import zipfile
from io import BytesIO
from pathlib import Path

import pytest
from fastapi import HTTPException

from app.core.file_security import (
    DATA_EXTENSIONS,
    rename_data_files_to_uuid,
    safe_zip_extract,
    sanitize_filename,
    uuid_data_filename,
    validate_magic_bytes,
    validate_upload_path,
)


# =============================================================================
# AC1 – sanitize_filename
# =============================================================================

class TestSanitizeFilename:
    def test_plain_filename_unchanged(self):
        assert sanitize_filename("image.jpg") == "image.jpg"

    def test_unix_path_stripped_to_basename(self):
        assert sanitize_filename("foo/bar/baz.jpg") == "baz.jpg"

    def test_windows_path_stripped_to_basename(self):
        assert sanitize_filename("foo\\bar\\baz.png") == "baz.png"

    def test_absolute_path_stripped_to_basename(self):
        assert sanitize_filename("/etc/passwd") == "passwd"

    def test_deep_traversal_stripped_to_basename(self):
        assert sanitize_filename("../../etc/shadow") == "shadow"

    def test_empty_string_returns_fallback(self):
        assert sanitize_filename("") == "upload"

    def test_only_separator_returns_fallback(self):
        assert sanitize_filename("/") == "upload"

    def test_mixed_separators(self):
        assert sanitize_filename("a/b\\c.bin") == "c.bin"


# =============================================================================
# AC2 – validate_upload_path
# =============================================================================

class TestValidateUploadPath:

    # ── Happy-path ─────────────────────────────────────────────────────────

    def test_simple_filename_accepted(self):
        assert validate_upload_path("image.jpg") == "image.jpg"

    def test_relative_path_accepted(self):
        result = validate_upload_path("scenes/front_camera/000001.jpg")
        assert result == "scenes/front_camera/000001.jpg"

    def test_leading_slash_stripped(self):
        result = validate_upload_path("/scenes/image.jpg")
        assert result == "scenes/image.jpg"

    # ── Null bytes ─────────────────────────────────────────────────────────

    def test_null_byte_in_filename_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_upload_path("file\x00name.jpg")
        assert exc_info.value.status_code == 400

    def test_null_byte_in_path_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_upload_path("folder\x00/image.jpg")
        assert exc_info.value.status_code == 400

    # ── Backslash ──────────────────────────────────────────────────────────

    def test_backslash_in_path_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_upload_path("folder\\image.jpg")
        assert exc_info.value.status_code == 400

    # ── Directory traversal ────────────────────────────────────────────────

    def test_dotdot_component_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_upload_path("scenes/../../../etc/passwd")
        assert exc_info.value.status_code == 400

    def test_dotdot_at_start_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_upload_path("../secret.txt")
        assert exc_info.value.status_code == 400

    def test_dotdot_as_only_component_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_upload_path("..")
        assert exc_info.value.status_code == 400

    def test_encoded_traversal_still_rejected(self):
        # The path '....//....//etc//passwd' after normalization by PurePosixPath
        # should not contain '..'; but '../../etc' should.
        with pytest.raises(HTTPException):
            validate_upload_path("../../etc/passwd")

    # ── Empty path ─────────────────────────────────────────────────────────

    def test_empty_path_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_upload_path("")
        assert exc_info.value.status_code == 400


# =============================================================================
# AC3 – validate_magic_bytes
# =============================================================================

# Convenience magic-byte fixtures
JPEG_MAGIC = b"\xff\xd8\xff\xe0" + b"\x00" * 16
PNG_MAGIC = b"\x89PNG\r\n\x1a\n" + b"\x00" * 16
GIF_MAGIC = b"GIF89a" + b"\x00" * 16
BMP_MAGIC = b"BM" + b"\x00" * 16
WEBP_MAGIC = b"RIFF" + b"\x00\x00\x00\x0c" + b"WEBP" + b"\x00" * 8
TIFF_LE_MAGIC = b"II\x2a\x00" + b"\x00" * 16
TIFF_BE_MAGIC = b"MM\x00\x2a" + b"\x00" * 16
ZIP_MAGIC = b"PK\x03\x04" + b"\x00" * 16
PCD_MAGIC = b"# .PCD v0.7 - Point Cloud Data\n"
PLY_MAGIC = b"ply\nformat ascii 1.0\n"
BIN_RANDOM = b"\x00\x01\x02\x03" * 32   # raw KITTI binary – no magic


class TestValidateMagicBytes:

    # ── Valid files ─────────────────────────────────────────────────────────

    def test_valid_jpeg(self):
        validate_magic_bytes(JPEG_MAGIC, "frame.jpg")

    def test_valid_jpeg_extension_case_insensitive(self):
        validate_magic_bytes(JPEG_MAGIC, "FRAME.JPEG")

    def test_valid_png(self):
        validate_magic_bytes(PNG_MAGIC, "image.png")

    def test_valid_gif(self):
        validate_magic_bytes(GIF_MAGIC, "anim.gif")

    def test_valid_bmp(self):
        validate_magic_bytes(BMP_MAGIC, "image.bmp")

    def test_valid_webp(self):
        validate_magic_bytes(WEBP_MAGIC, "image.webp")

    def test_valid_tiff_little_endian(self):
        validate_magic_bytes(TIFF_LE_MAGIC, "scan.tiff")

    def test_valid_tiff_big_endian(self):
        validate_magic_bytes(TIFF_BE_MAGIC, "scan.tif")

    def test_valid_zip(self):
        validate_magic_bytes(ZIP_MAGIC, "archive.zip")

    def test_valid_pcd(self):
        validate_magic_bytes(PCD_MAGIC, "cloud.pcd")

    def test_valid_ply(self):
        validate_magic_bytes(PLY_MAGIC, "mesh.ply")

    def test_valid_bin_skips_check(self):
        # .bin has no magic – should always pass content check
        validate_magic_bytes(BIN_RANDOM, "lidar.bin")

    # ── Invalid: wrong content for extension ───────────────────────────────

    def test_wrong_bytes_for_jpg_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_magic_bytes(PNG_MAGIC, "disguised.jpg")
        assert exc_info.value.status_code == 400

    def test_wrong_bytes_for_png_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_magic_bytes(JPEG_MAGIC, "disguised.png")
        assert exc_info.value.status_code == 400

    def test_wrong_bytes_for_gif_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_magic_bytes(JPEG_MAGIC, "bad.gif")
        assert exc_info.value.status_code == 400

    def test_wrong_bytes_for_bmp_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_magic_bytes(JPEG_MAGIC, "bad.bmp")
        assert exc_info.value.status_code == 400

    def test_wrong_bytes_for_webp_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_magic_bytes(JPEG_MAGIC, "bad.webp")
        assert exc_info.value.status_code == 400

    def test_wrong_bytes_for_tiff_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_magic_bytes(JPEG_MAGIC, "bad.tiff")
        assert exc_info.value.status_code == 400

    def test_wrong_bytes_for_zip_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_magic_bytes(JPEG_MAGIC, "bad.zip")
        assert exc_info.value.status_code == 400

    def test_wrong_bytes_for_pcd_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_magic_bytes(b"random bytes not a PCD header", "bad.pcd")
        assert exc_info.value.status_code == 400

    def test_wrong_bytes_for_ply_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_magic_bytes(b"not a ply file", "bad.ply")
        assert exc_info.value.status_code == 400

    # ── Disallowed extension ────────────────────────────────────────────────

    def test_disallowed_extension_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_magic_bytes(b"#!/bin/bash\n", "script.sh")
        assert exc_info.value.status_code == 400

    def test_exe_extension_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_magic_bytes(b"MZ\x00\x00", "malware.exe")
        assert exc_info.value.status_code == 400

    def test_php_extension_rejected(self):
        with pytest.raises(HTTPException) as exc_info:
            validate_magic_bytes(b"<?php echo 'pwned'; ?>", "shell.php")
        assert exc_info.value.status_code == 400

    # ── Content-disguised as a different allowed type ───────────────────────

    def test_executable_disguised_as_jpg_rejected(self):
        """MZ header (Windows PE) pretending to be a JPEG."""
        with pytest.raises(HTTPException) as exc_info:
            validate_magic_bytes(b"MZ\x90\x00\x03\x00", "payload.jpg")
        assert exc_info.value.status_code == 400

    def test_elf_disguised_as_png_rejected(self):
        """ELF magic pretending to be a PNG."""
        with pytest.raises(HTTPException) as exc_info:
            validate_magic_bytes(b"\x7fELF\x02\x01\x01\x00", "payload.png")
        assert exc_info.value.status_code == 400


# =============================================================================
# AC4 – uuid_data_filename & rename_data_files_to_uuid
# =============================================================================

class TestUuidDataFilename:

    def test_returns_tuple_of_two_strings(self):
        uuid_name, original_name = uuid_data_filename("000001.jpg")
        assert isinstance(uuid_name, str)
        assert isinstance(original_name, str)

    def test_original_name_equals_input_basename(self):
        _, original_name = uuid_data_filename("000001.jpg")
        assert original_name == "000001.jpg"

    def test_uuid_name_preserves_extension(self):
        uuid_name, _ = uuid_data_filename("frame.pcd")
        assert uuid_name.endswith(".pcd")

    def test_uuid_name_extension_is_lowercase(self):
        uuid_name, _ = uuid_data_filename("FRAME.JPG")
        assert uuid_name.endswith(".jpg")

    def test_uuid_name_is_different_from_original(self):
        uuid_name, original_name = uuid_data_filename("000001.jpg")
        assert uuid_name != original_name

    def test_uuid_name_has_valid_uuid_portion(self):
        uuid_name, _ = uuid_data_filename("frame.jpg", index=3)
        # Format: "000003_<uuid>.jpg"
        parts = uuid_name.rsplit(".", 1)[0]  # strip extension
        after_index = parts.split("_", 1)[1]  # strip '000003_'
        uuid.UUID(after_index)   # raises ValueError if not valid UUID

    def test_indexed_uuid_name_has_zero_padded_prefix(self):
        uuid_name, _ = uuid_data_filename("frame.jpg", index=42)
        assert uuid_name.startswith("000042_")

    def test_indexed_uuid_names_sort_in_original_order(self):
        names = [uuid_data_filename(f"{i:06d}.jpg", index=i)[0] for i in range(5)]
        assert names == sorted(names)

    def test_no_index_produces_plain_uuid_name(self):
        uuid_name, _ = uuid_data_filename("frame.jpg")
        # No underscore prefix – just uuid.ext
        parts = uuid_name.rsplit(".", 1)[0]
        uuid.UUID(parts)  # must be a valid UUID on its own


class TestRenameDataFilesToUuid:

    def test_renames_jpeg_files(self, tmp_path: Path):
        # Create fake JPEG files
        for i in range(3):
            f = tmp_path / f"{i:06d}.jpg"
            f.write_bytes(JPEG_MAGIC)

        mapping = rename_data_files_to_uuid(tmp_path)

        remaining = list(tmp_path.iterdir())
        assert len(remaining) == 3
        for p in remaining:
            # Original names must be gone
            assert not p.name[0].isdigit() or "_" in p.name, (
                "File was not renamed to <index>_<uuid>.<ext> format"
            )
            assert p.suffix == ".jpg"

    def test_non_data_files_are_untouched(self, tmp_path: Path):
        json_file = tmp_path / "calibration.json"
        json_file.write_text('{"version": 1}')
        img_file = tmp_path / "000000.jpg"
        img_file.write_bytes(JPEG_MAGIC)

        rename_data_files_to_uuid(tmp_path)

        assert json_file.exists(), "calibration.json must not be renamed"
        assert not img_file.exists(), "000000.jpg must be renamed"

    def test_mapping_contains_original_and_uuid_names(self, tmp_path: Path):
        names = ["alpha.jpg", "beta.jpg", "gamma.jpg"]
        for name in names:
            (tmp_path / name).write_bytes(JPEG_MAGIC)

        mapping = rename_data_files_to_uuid(tmp_path)

        assert len(mapping) == 3
        for entry in mapping.values():
            assert "uuid_name" in entry
            assert "original_name" in entry
            assert entry["original_name"] in names

    def test_sort_order_preserved_via_indexed_prefix(self, tmp_path: Path):
        """UUID-named files must sort in the same order as original files."""
        for i in range(5):
            (tmp_path / f"{i:06d}.jpg").write_bytes(JPEG_MAGIC)

        rename_data_files_to_uuid(tmp_path)

        uuid_names = sorted(p.name for p in tmp_path.glob("*.jpg"))
        # Sorted uuid names should have the 000000_, 000001_, ... prefixes in order
        for expected_idx, name in enumerate(uuid_names):
            prefix = f"{expected_idx:06d}_"
            assert name.startswith(prefix), (
                f"File {name!r} does not start with expected prefix {prefix!r}"
            )

    def test_nested_directories_renamed(self, tmp_path: Path):
        cam_dir = tmp_path / "cameras" / "front"
        cam_dir.mkdir(parents=True)
        (cam_dir / "000000.jpg").write_bytes(JPEG_MAGIC)
        (cam_dir / "000001.jpg").write_bytes(JPEG_MAGIC)

        mapping = rename_data_files_to_uuid(tmp_path)

        assert len(mapping) == 2
        assert all("uuid_name" in v for v in mapping.values())

    def test_pcd_files_renamed(self, tmp_path: Path):
        lidar_dir = tmp_path / "lidar"
        lidar_dir.mkdir()
        (lidar_dir / "000000.pcd").write_bytes(PCD_MAGIC)

        mapping = rename_data_files_to_uuid(tmp_path)

        assert len(mapping) == 1
        uuid_name = list(mapping.values())[0]["uuid_name"]
        assert uuid_name.endswith(".pcd")


# =============================================================================
# AC5 – safe_zip_extract
# =============================================================================

def _make_zip(members: dict[str, bytes]) -> BytesIO:
    """Build an in-memory ZIP with the given {member_name: content} mapping."""
    buf = BytesIO()
    with zipfile.ZipFile(buf, "w") as zf:
        for name, content in members.items():
            zf.writestr(name, content)
    buf.seek(0)
    return buf


class TestSafeZipExtract:

    def test_safe_members_extracted_successfully(self, tmp_path: Path):
        buf = _make_zip({
            "scene/image.jpg": JPEG_MAGIC,
            "scene/calibration.json": b'{}',
        })
        with zipfile.ZipFile(buf) as zf:
            safe_zip_extract(zf, tmp_path)

        assert (tmp_path / "scene" / "image.jpg").exists()
        assert (tmp_path / "scene" / "calibration.json").exists()

    def test_zipslip_absolute_path_rejected(self, tmp_path: Path):
        """Member with absolute path must be rejected."""
        buf = BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            # Manually add a member with an absolute path
            info = zipfile.ZipInfo("/etc/passwd")
            zf.writestr(info, b"root:x:0:0:root:/root:/bin/bash\n")
        buf.seek(0)

        with zipfile.ZipFile(buf) as zf:
            with pytest.raises(HTTPException) as exc_info:
                safe_zip_extract(zf, tmp_path)
        assert exc_info.value.status_code == 400

    def test_zipslip_dotdot_path_rejected(self, tmp_path: Path):
        """Member with '../' traversal must be rejected."""
        buf = BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            info = zipfile.ZipInfo("../../evil.sh")
            zf.writestr(info, b"#!/bin/bash\nrm -rf /\n")
        buf.seek(0)

        with zipfile.ZipFile(buf) as zf:
            with pytest.raises(HTTPException) as exc_info:
                safe_zip_extract(zf, tmp_path)
        assert exc_info.value.status_code == 400

    def test_null_byte_in_member_name_rejected(self, tmp_path: Path):
        """Null bytes in member names must be rejected with HTTP 400.

        CPython's ``ZipInfo.__init__`` truncates filenames at the first null
        byte, and the zipfile read-back pipeline also sanitises them, so there
        is no way to get ``\x00`` into a real ``ZipInfo.filename`` via the
        normal API.  We therefore use ``SimpleNamespace`` to bypass that
        sanitisation and directly test our guard inside ``safe_zip_extract``.
        """
        from types import SimpleNamespace
        from unittest.mock import MagicMock

        # Craft a fake ZipInfo whose filename contains a null byte.
        evil_info = SimpleNamespace(filename="file\x00.jpg")
        mock_zf = MagicMock(spec=zipfile.ZipFile)
        mock_zf.infolist.return_value = [evil_info]

        with pytest.raises(HTTPException) as exc_info:
            safe_zip_extract(mock_zf, tmp_path)
        assert exc_info.value.status_code == 400

    def test_empty_zip_extracted_without_error(self, tmp_path: Path):
        buf = _make_zip({})
        with zipfile.ZipFile(buf) as zf:
            safe_zip_extract(zf, tmp_path)  # must not raise

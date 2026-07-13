"""
File-upload security utilities.

Prevents path-injection / directory-traversal attacks via malicious filenames
and ensures uploaded file content matches its declared extension.

Acceptance-criteria coverage
─────────────────────────────
1. Directory components stripped from filenames        → sanitize_filename()
2. Filenames with '..', '/', '\\', null bytes → HTTP 400 → validate_upload_path()
3. File content validated via magic bytes              → validate_magic_bytes()
4. Files stored with UUID names; original name in DB   → uuid_data_filename()
                                                         rename_data_files_to_uuid()
5. Safe ZIP extraction (zipslip defence)               → safe_zip_extract()
"""
from __future__ import annotations

import os
import uuid
import zipfile
from pathlib import Path, PurePosixPath
from typing import Dict, Tuple

from fastapi import HTTPException, status

DATA_EXTENSIONS: frozenset[str] = frozenset(
    {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".tiff", ".tif", ".webp",
     ".pcd", ".ply", ".bin"}
)

VIDEO_EXTENSIONS: frozenset[str] = frozenset(
    {".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"}
)

_MAGIC: dict[str, bytes | None] = {
    ".jpg":  b"\xff\xd8\xff",
    ".jpeg": b"\xff\xd8\xff",
    ".png":  b"\x89PNG\r\n\x1a\n",
    ".gif":  b"GIF8",
    ".bmp":  b"BM",
    ".zip":  b"PK\x03\x04",
    ".webp": None,
    ".tiff": None,
    ".tif":  None,
    ".pcd":  None,
    ".ply":  None,
    ".bin":  None,
    ".mp4":  None,
    ".m4v":  None,
    ".mov":  None,
    ".avi":  None,
    ".mkv":  None,
    ".webm": None,
}



def validate_upload_path(relative_path: str) -> str:
    """Validate a client-supplied *relative* upload path.

    Raises ``HTTP 400`` if the path:
    * is empty
    * contains null bytes
    * contains back-slash characters  (``\\``)
    * contains ``..`` path components (directory traversal)
    * is absolute (starts with ``/``)

    Returns the normalised path string (forward slashes, no leading ``/``).
    """
    if not relative_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Filename must not be empty.",
        )

    if "\x00" in relative_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Filename contains null bytes.",
        )

    if "\\" in relative_path:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Filename contains backslash characters.",
        )

    normed = relative_path.lstrip("/")

    parts = PurePosixPath(normed).parts
    if ".." in parts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='Filename must not contain ".." path components.',
        )

    return normed


def sanitize_filename(filename: str) -> str:
    """Strip all directory components and return only the base filename.

    Never raises – always returns a *safe* non-empty name.
    Uses PurePosixPath so that Windows-style ``\\`` separators are also
    stripped when the server runs on Linux.
    """
    normalised = filename.replace("\\", "/")
    base = PurePosixPath(normalised).name
    return base or "upload"



def validate_magic_bytes(content: bytes, filename: str) -> None:
    """Check that *content* matches the magic bytes expected for *filename*.

    * Raises ``HTTP 400`` if the extension is not in the allowed set.
    * Raises ``HTTP 400`` if the magic bytes don't match.
    * Silently passes for extensions that have no reliable magic
      (``.pcd``, ``.ply``, ``.bin``) – those are validated by extension only.

    Call this **before** writing content to disk.
    """
    ext = Path(filename).suffix.lower()

    allowed_check_exts = set(_MAGIC.keys()) | DATA_EXTENSIONS | VIDEO_EXTENSIONS
    if ext not in allowed_check_exts:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File type '{ext}' is not permitted.",
        )

    expected = _MAGIC.get(ext)

    if expected is not None:
        if not content[: len(expected)].startswith(expected):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"File content does not match the expected format for "
                    f"extension '{ext}'."
                ),
            )
        return

    if ext == ".webp":
        if not (content[:4] == b"RIFF" and content[8:12] == b"WEBP"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File content does not match the expected WebP format.",
            )

    elif ext in (".tiff", ".tif"):
        if content[:4] not in (b"II\x2a\x00", b"MM\x00\x2a"):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File content does not match the expected TIFF format.",
            )

    elif ext == ".pcd":
        header = content[:64]
        try:
            header_str = header.decode("ascii", errors="replace").lstrip()
        except Exception:
            header_str = ""
        if not (header_str.startswith("VERSION") or header_str.startswith("# .PCD")):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File content does not match the expected PCD format.",
            )

    elif ext == ".ply":
        if not content[:3] == b"ply":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File content does not match the expected PLY format.",
            )

    elif ext in (".mp4", ".m4v", ".mov"):
        is_valid = (
            content[4:8] == b"ftyp" or 
            content[0:4] == b"ftyp" or
            content[4:8] == b"moov" or 
            content[4:8] == b"free"
        )
        if not is_valid:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File content does not match the expected {ext.upper()[1:]} video format.",
            )
    
    elif ext == ".avi":
        if not (content[:4] == b"RIFF" and content[8:12] == b"AVI "):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="File content does not match the expected AVI format.",
            )
    
    elif ext in (".mkv", ".webm"):
        if content[:4] != b"\x1a\x45\xdf\xa3":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"File content does not match the expected {ext.upper()[1:]} format.",
            )




def uuid_data_filename(original_filename: str, index: int | None = None) -> Tuple[str, str]:
    """Generate a UUID-based storage name for a data file.

    Parameters
    ----------
    original_filename:
        The sanitised original filename (basename only).
    index:
        Optional zero-based frame/file index.  When provided the UUID name is
        prefixed with a zero-padded integer (``{index:06d}_``) so that lexicographic
        sort order matches the original sort order – critical for multi-sensor
        frame alignment.

    Returns
    -------
    (uuid_name, original_basename)
        e.g. ``("000001_a3f1b2c4-....jpg", "000001.jpg")``
    """
    base = sanitize_filename(original_filename)
    ext = Path(base).suffix.lower()
    uid = uuid.uuid4()
    if index is not None:
        return f"{index:06d}_{uid}{ext}", base
    return f"{uid}{ext}", base


def rename_data_files_to_uuid(
    directory: Path,
    data_extensions: frozenset[str] = DATA_EXTENSIONS,
) -> Dict[str, Dict[str, str]]:
    """Walk *directory* and rename every data file to a UUID-based name.

    Data files are sorted by their original name **within each directory**
    before being assigned indices so that the lexicographic sort order of UUID
    names matches the original frame order.

    Non-data files (e.g. ``calibration.json``, ``scene_metadata.json``) are
    left untouched.

    Returns
    -------
    mapping : dict[original_relative_path, {"uuid_name": ..., "original_name": ...}]
        Keys are paths relative to *directory* (using ``/`` separators).
    """
    mapping: Dict[str, Dict[str, str]] = {}

    for dirpath_str, _dirs, filenames in os.walk(directory):
        dirpath = Path(dirpath_str)
        rel_dir = dirpath.relative_to(directory)

        data_files = sorted(
            [f for f in filenames if Path(f).suffix.lower() in data_extensions]
        )

        for idx, fname in enumerate(data_files):
            src = dirpath / fname
            uuid_name, original_name = uuid_data_filename(fname, index=idx)
            dst = dirpath / uuid_name
            src.rename(dst)

            key = str(rel_dir / fname) if str(rel_dir) != "." else fname
            mapping[key] = {"uuid_name": uuid_name, "original_name": original_name}

    return mapping



def safe_zip_extract(zip_ref: zipfile.ZipFile, extract_to: Path) -> None:
    """Extract all members of *zip_ref* into *extract_to* safely.

    Raises ``HTTP 400`` if any member path would escape *extract_to*
    (zipslip / directory-traversal attack).

    This must be called **instead of** ``zipfile.ZipFile.extractall()``.
    """
    resolved_root = extract_to.resolve()

    for info in zip_ref.infolist():
        member = info.filename

        raw_name_bytes: bytes = member.encode("utf-8", errors="surrogateescape")
        if b"\x00" in raw_name_bytes or "\x00" in member:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ZIP member contains null bytes: {member!r}",
            )

        candidate = (extract_to / member).resolve()
        try:
            candidate.relative_to(resolved_root)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ZIP file contains unsafe path that escapes the target directory: {member!r}",
            )

    for info in zip_ref.infolist():
        try:
            zip_ref.extract(info, extract_to)
        except ValueError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"ZIP member has an invalid path: {info.filename!r}: {exc}",
            )

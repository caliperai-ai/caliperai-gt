"""
Unit tests for filesystem browse endpoint path-traversal security.

Tests verify that ALLOWED_BROWSE_ROOTS allowlist enforcement works correctly:
  - Paths inside allowed roots are accessible.
  - Paths outside all allowed roots receive HTTP 403.
  - `..` traversal that resolves outside an allowed root receives HTTP 403.
  - Symlinks escaping an allowed root are silently omitted from the listing.
  - parent_path is clamped to None at the allowed-root boundary.
"""
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

# ---------------------------------------------------------------------------
# We import and call the endpoint function directly, supplying a mock user
# so we don't need a running DB / auth stack.
# ---------------------------------------------------------------------------
from app.api.v1.endpoints.import_data import browse_folders


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_user():
    """Return a minimal mock user object (auth is bypassed in unit tests)."""
    user = MagicMock()
    user.id = "00000000-0000-0000-0000-000000000001"
    return user


def _patch_roots(*roots: str):
    """Context manager: patch ALLOWED_BROWSE_ROOTS to the given list."""
    return patch(
        "app.api.v1.endpoints.import_data.settings.ALLOWED_BROWSE_ROOTS",
        list(roots),
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_path_inside_allowed_root_returns_listing(tmp_path: Path):
    """A valid path inside an allowed root is listed successfully."""
    # Arrange: create some content
    (tmp_path / "subdir").mkdir()
    (tmp_path / "file.txt").write_text("data")

    with _patch_roots(str(tmp_path)):
        response = await browse_folders(
            current_user=_mock_user(),
            path=str(tmp_path),
        )

    assert response.current_path == str(tmp_path)
    names = {item.name for item in response.items}
    assert "subdir" in names
    assert "file.txt" in names


@pytest.mark.asyncio
async def test_path_outside_all_roots_returns_403(tmp_path: Path):
    """/etc (or any path outside allowed roots) must return 403."""
    allowed = tmp_path / "allowed"
    allowed.mkdir()

    with _patch_roots(str(allowed)):
        with pytest.raises(HTTPException) as exc_info:
            await browse_folders(
                current_user=_mock_user(),
                path="/etc",
            )

    assert exc_info.value.status_code == 403
    assert "outside allowed" in exc_info.value.detail


@pytest.mark.asyncio
async def test_dotdot_traversal_outside_root_returns_403(tmp_path: Path):
    """A path using .. that resolves outside the allowed root returns 403."""
    allowed = tmp_path / "uploads"
    allowed.mkdir()

    # Craft a path like /tmp/uploads/../../../etc/passwd — resolved this escapes
    traversal_path = str(allowed / ".." / ".." / "etc")

    with _patch_roots(str(allowed)):
        with pytest.raises(HTTPException) as exc_info:
            await browse_folders(
                current_user=_mock_user(),
                path=traversal_path,
            )

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_root_slash_returns_403(tmp_path: Path):
    """Requesting the filesystem root '/' must return 403 (not in any allowed root)."""
    allowed = tmp_path / "uploads"
    allowed.mkdir()

    with _patch_roots(str(allowed)):
        with pytest.raises(HTTPException) as exc_info:
            await browse_folders(
                current_user=_mock_user(),
                path="/",
            )

    assert exc_info.value.status_code == 403


@pytest.mark.asyncio
async def test_symlink_inside_root_pointing_inside_is_listed(tmp_path: Path):
    """A symlink that points to another path *inside* the allowed root is shown."""
    allowed = tmp_path / "uploads"
    allowed.mkdir()

    real_dir = allowed / "real_data"
    real_dir.mkdir()

    link = allowed / "link_to_real"
    link.symlink_to(real_dir)

    with _patch_roots(str(allowed)):
        response = await browse_folders(
            current_user=_mock_user(),
            path=str(allowed),
        )

    names = {item.name for item in response.items}
    assert "link_to_real" in names


@pytest.mark.asyncio
async def test_symlink_escaping_root_is_silently_omitted(tmp_path: Path):
    """A symlink inside the allowed root pointing outside is silently omitted."""
    allowed = tmp_path / "uploads"
    allowed.mkdir()

    outside = tmp_path / "secret"
    outside.mkdir()
    (outside / "passwords.txt").write_text("top secret")

    # Create a symlink inside allowed/ that points to outside/
    escape_link = allowed / "escape"
    escape_link.symlink_to(outside)

    with _patch_roots(str(allowed)):
        response = await browse_folders(
            current_user=_mock_user(),
            path=str(allowed),
        )

    names = {item.name for item in response.items}
    assert "escape" not in names, "Escaping symlink must not appear in the listing"


@pytest.mark.asyncio
async def test_parent_path_clamped_at_allowed_root(tmp_path: Path):
    """parent_path is None when the current directory IS the allowed root."""
    allowed = tmp_path / "uploads"
    allowed.mkdir()

    with _patch_roots(str(allowed)):
        response = await browse_folders(
            current_user=_mock_user(),
            path=str(allowed),
        )

    # parent would be tmp_path, which is outside the allowed root → must be None
    assert response.parent_path is None


@pytest.mark.asyncio
async def test_parent_path_available_inside_root(tmp_path: Path):
    """parent_path is set when browsing a subdirectory within an allowed root."""
    allowed = tmp_path / "uploads"
    allowed.mkdir()
    subdir = allowed / "dataset1"
    subdir.mkdir()

    with _patch_roots(str(allowed)):
        response = await browse_folders(
            current_user=_mock_user(),
            path=str(subdir),
        )

    assert response.parent_path == str(allowed)

"""
Data endpoints for serving sensor data files (LiDAR, images, etc.).

Performance optimizations:
- Redis cache for parsed point cloud data (shared across workers)
- Binary response format option (3-4x smaller than JSON)
- Gzip compression for binary responses (additional 2-3x reduction)
"""
import os
import struct
import hashlib
import time
import gzip as gzip_module
from pathlib import Path
from typing import Annotated, List, Optional, Dict, Tuple
from collections import OrderedDict
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse, Response
from fastapi.concurrency import run_in_threadpool
import numpy as np

from app.models.models import User, Permission
from app.services.rbac_service import RequirePermissions, RequirePermissionsWithQuery
from app.services.storage_service import get_storage_service, StorageService
from app.core.redis_cache import redis_pcd_cache, redis_gzip_cache

router = APIRouter()

DATA_ROOT = os.environ.get("DATA_ROOT", "/app/sample_data")
UPLOAD_ROOT = "/uploads"



class PointCloudCache:
    """
    Thread-safe LRU cache for parsed point cloud binary data.
    Caches the binary representation (positions + intensities as Float32).
    """
    def __init__(self, max_size: int = 100, ttl_seconds: int = 600):
        self.max_size = max_size
        self.ttl_seconds = ttl_seconds
        self._cache: OrderedDict[str, Tuple[bytes, bytes, int, float]] = OrderedDict()
        self._lock = Lock()
    
    def _make_key(self, file_path: str, mtime: float) -> str:
        """Create cache key from file path and modification time."""
        return f"{file_path}:{mtime}"
    
    def get(self, file_path: str) -> Optional[Tuple[bytes, bytes, int]]:
        """
        Get cached data if available and not expired.
        Returns (positions_bytes, intensities_bytes, point_count) or None.
        """
        try:
            mtime = os.path.getmtime(file_path)
        except OSError:
            return None
        
        key = self._make_key(file_path, mtime)
        
        with self._lock:
            if key in self._cache:
                positions, intensities, count, cached_time = self._cache[key]
                
                if time.time() - cached_time > self.ttl_seconds:
                    del self._cache[key]
                    return None
                
                self._cache.move_to_end(key)
                return (positions, intensities, count)
        
        return None
    
    def set(self, file_path: str, positions: bytes, intensities: bytes, count: int):
        """Cache parsed point cloud data."""
        try:
            mtime = os.path.getmtime(file_path)
        except OSError:
            return
        
        key = self._make_key(file_path, mtime)
        
        with self._lock:
            while len(self._cache) >= self.max_size:
                self._cache.popitem(last=False)
            
            self._cache[key] = (positions, intensities, count, time.time())
    
    def clear(self):
        """Clear all cached data."""
        with self._lock:
            self._cache.clear()
    
    def stats(self) -> Dict:
        """Get cache statistics."""
        with self._lock:
            return {
                "size": len(self._cache),
                "max_size": self.max_size,
                "ttl_seconds": self.ttl_seconds,
            }



async def get_cached_gzip(cache_key: str) -> Optional[bytes]:
    """Get cached gzip-compressed data if available from Redis."""
    try:
        parts = cache_key.rsplit(':', 1)
        if len(parts) == 2:
            file_path = parts[0]
            point_count = int(parts[1])
            return await redis_gzip_cache.get(file_path, point_count)
    except Exception as e:
        print(f"[GZIP CACHE GET ERROR] {e}", flush=True)
    return None


async def set_cached_gzip(cache_key: str, compressed_data: bytes):
    """Cache gzip-compressed data in Redis."""
    try:
        parts = cache_key.rsplit(':', 1)
        if len(parts) == 2:
            file_path = parts[0]
            point_count = int(parts[1])
            await redis_gzip_cache.set(file_path, point_count, compressed_data)
    except Exception as e:
        print(f"[GZIP CACHE SET ERROR] {e}", flush=True)


def parse_pcd_file(file_path: str) -> dict:
    """Parse a PCD file and return points as a dictionary with numpy arrays converted to lists."""
    points = []
    intensities = []
    
    with open(file_path, 'rb') as f:
        header_lines = []
        while True:
            line = f.readline().decode('utf-8', errors='ignore').strip()
            header_lines.append(line)
            if line.startswith('DATA'):
                break
        
        fields = []
        sizes = []
        types = []
        counts = []
        point_count = 0
        is_binary = False
        
        for line in header_lines:
            if line.startswith('FIELDS'):
                fields = line.split()[1:]
            elif line.startswith('SIZE'):
                sizes = [int(x) for x in line.split()[1:]]
            elif line.startswith('TYPE'):
                types = line.split()[1:]
            elif line.startswith('COUNT'):
                counts = [int(x) for x in line.split()[1:]]
            elif line.startswith('POINTS'):
                point_count = int(line.split()[1])
            elif line.startswith('DATA'):
                is_binary = 'binary' in line.lower()
        
        if is_binary:
            point_size = sum(s * c for s, c in zip(sizes, counts))
            data = f.read(point_count * point_size)
            
            offset = 0
            for i in range(point_count):
                point = {}
                for field, size, ftype, count in zip(fields, sizes, types, counts):
                    if ftype == 'F':
                        fmt = 'f' if size == 4 else 'd'
                        values = struct.unpack_from(f'<{count}{fmt}', data, offset)
                        point[field] = values[0] if count == 1 else list(values)
                    elif ftype == 'I' or ftype == 'U':
                        fmt = 'i' if ftype == 'I' else 'I'
                        if size == 1:
                            fmt = 'b' if ftype == 'I' else 'B'
                        elif size == 2:
                            fmt = 'h' if ftype == 'I' else 'H'
                        values = struct.unpack_from(f'<{count}{fmt}', data, offset)
                        point[field] = values[0] if count == 1 else list(values)
                    offset += size * count
                
                x = point.get('x', 0)
                y = point.get('y', 0)
                z = point.get('z', 0)
                intensity = point.get('intensity', point.get('i', 0.5))
                
                points.append([x, y, z])
                intensities.append(intensity if isinstance(intensity, (int, float)) else 0.5)
        else:
            for line in f:
                parts = line.decode('utf-8', errors='ignore').strip().split()
                if len(parts) >= 3:
                    try:
                        x, y, z = float(parts[0]), float(parts[1]), float(parts[2])
                        intensity = float(parts[3]) if len(parts) > 3 else 0.5
                        points.append([x, y, z])
                        intensities.append(intensity)
                    except ValueError:
                        continue
    
    return {
        "pointCount": len(points),
        "positions": points,
        "intensities": intensities,
    }


_CENTER_THRESHOLD = float(os.environ.get("LIDAR_CENTER_THRESHOLD", "10000"))
_MAX_DISPLAY_POINTS = int(os.environ.get("LIDAR_MAX_DISPLAY_POINTS", "800000"))


def _maybe_subsample(
    positions: np.ndarray,
    intensities: np.ndarray,
    point_count: int,
    colors: Optional[np.ndarray] = None,
) -> Tuple[np.ndarray, np.ndarray, Optional[np.ndarray], int, bool]:
    """
    Random-subsample to _MAX_DISPLAY_POINTS when the cloud is bigger than the
    browser GPU can comfortably render. Fixed seed → deterministic across
    worker restarts (so Redis cache + per-point labels stay consistent).

    Returns (positions, intensities, colors, point_count, was_subsampled).
    colors is sliced in parallel when provided, else passed through as None.
    """
    if _MAX_DISPLAY_POINTS <= 0 or point_count <= _MAX_DISPLAY_POINTS:
        return positions, intensities, colors, point_count, False
    rng = np.random.default_rng(42)
    idx = rng.choice(point_count, _MAX_DISPLAY_POINTS, replace=False)
    idx.sort()
    xyz = positions.reshape(point_count, 3)
    new_positions = xyz[idx].reshape(-1)
    new_intensities = intensities[idx]
    new_colors = None
    if colors is not None:
        new_colors = colors.reshape(point_count, 3)[idx].reshape(-1)
    print(
        f"[SUBSAMPLE] {point_count} -> {_MAX_DISPLAY_POINTS} points "
        f"(cap to stay within browser GPU limits)",
        flush=True,
    )
    return new_positions, new_intensities, new_colors, _MAX_DISPLAY_POINTS, True


def _extract_pcd_colors(
    structured_arr: np.ndarray, point_count: int
) -> Optional[np.ndarray]:
    """
    Extract per-point RGB from a parsed PCD structured array.

    Supports two PCD conventions:
      1) Packed: a single ``rgb`` (or ``rgba``) field of 4 bytes that PCL
         stores as ``0x00RRGGBB`` — declared TYPE F or U in the header.
         We reinterpret the bytes as uint32 regardless and unpack channels.
      2) Separate: three ``r``/``g``/``b`` or ``red``/``green``/``blue``
         fields. If their max <= 1.0 we treat them as already-normalized
         floats; otherwise we divide by 255 (handles uint8/uint16 stored
         as integers or floats in 0–255 range).

    Returns a Float32 array of length ``3*point_count`` in [0,1], or None
    if no recognizable color fields are present.
    """
    names = structured_arr.dtype.names or ()

    packed_field = next(
        (n for n in ("rgb", "rgba") if n in names), None
    )
    if packed_field is not None:
        raw = np.ascontiguousarray(structured_arr[packed_field])
        if raw.dtype.itemsize != 4:
            return None
        packed = raw.view(np.uint32).reshape(-1)
        r = ((packed >> 16) & 0xFF).astype(np.float32) / 255.0
        g = ((packed >> 8) & 0xFF).astype(np.float32) / 255.0
        b = (packed & 0xFF).astype(np.float32) / 255.0
        return np.column_stack((r, g, b)).reshape(-1).astype(np.float32)

    triples = [
        ("r", "g", "b"),
        ("red", "green", "blue"),
    ]
    for rn, gn, bn in triples:
        if rn in names and gn in names and bn in names:
            r = structured_arr[rn].astype(np.float32).reshape(-1)
            g = structured_arr[gn].astype(np.float32).reshape(-1)
            b = structured_arr[bn].astype(np.float32).reshape(-1)
            max_val = float(max(r.max(initial=0.0), g.max(initial=0.0), b.max(initial=0.0)))
            scale = 1.0 if max_val <= 1.0 else 1.0 / 255.0
            return np.column_stack((r * scale, g * scale, b * scale)).reshape(-1).astype(np.float32)

    return None


def _maybe_center(
    positions: np.ndarray, point_count: int
) -> Tuple[np.ndarray, Optional[List[float]]]:
    """
    If any axis has |centroid| > _CENTER_THRESHOLD, subtract the integer floor
    of the centroid so the cloud is near origin.

    Precision: positions arrive as Float32. The *mean* must be accumulated in
    Float64 (numpy's default float32 reduction loses precision catastrophically
    for ~6-digit values like UTM coords). We accumulate via dtype=float64 to
    avoid copying the input when no centering is needed; only the recenter path
    allocates a float64 working buffer.

    Returns (positions, offset_xyz_list_or_None).
    """
    if point_count == 0:
        return positions, None
    xyz_f32 = positions.reshape(point_count, 3)
    means = xyz_f32.mean(axis=0, dtype=np.float64)
    if float(np.max(np.abs(means))) < _CENTER_THRESHOLD:
        return positions, None
    offset = np.floor(means)
    centered_f32 = (xyz_f32.astype(np.float64) - offset).astype(np.float32)
    print(
        f"[RECENTER] offset=({offset[0]:.0f}, {offset[1]:.0f}, {offset[2]:.0f}) "
        f"— cloud was in CRS-like coords, re-centered to origin",
        flush=True,
    )
    return centered_f32.reshape(-1), [float(offset[0]), float(offset[1]), float(offset[2])]


def parse_pcd_to_binary(file_path: str) -> Tuple[bytes, bytes, Optional[bytes], int, dict]:
    """
    Parse a PCD file and return binary data ready for caching/transmission.
    Returns (positions_bytes, intensities_bytes, colors_bytes_or_None, point_count, metadata).

    positions_bytes: Float32 array [x1,y1,z1,x2,y2,z2,...] — possibly subsampled
                     and recentered (see metadata).
    intensities_bytes: Float32 array [i1,i2,...]
    colors_bytes: Float32 array [r1,g1,b1,...] in [0,1] when the PCD has an
                  ``rgb``/``rgba`` packed field or ``r,g,b``/``red,green,blue``
                  triples; otherwise None.
    metadata: dict with keys:
        - 'offset': [x, y, z] subtracted from world coords, or None
        - 'original_point_count': N before subsampling (== point_count if not subsampled)

    OPTIMIZED: Uses numpy for fast binary parsing instead of Python loops.
    """
    with open(file_path, 'rb') as f:
        header_lines = []
        while True:
            line = f.readline().decode('utf-8', errors='ignore').strip()
            header_lines.append(line)
            if line.startswith('DATA'):
                break
        
        fields = []
        sizes = []
        types = []
        counts = []
        point_count = 0
        is_binary = False
        
        for line in header_lines:
            if line.startswith('FIELDS'):
                fields = line.split()[1:]
            elif line.startswith('SIZE'):
                sizes = [int(x) for x in line.split()[1:]]
            elif line.startswith('TYPE'):
                types = line.split()[1:]
            elif line.startswith('COUNT'):
                counts = [int(x) for x in line.split()[1:]]
            elif line.startswith('POINTS'):
                point_count = int(line.split()[1])
            elif line.startswith('DATA'):
                is_binary = 'binary' in line.lower()
        
        if is_binary:
            point_size = sum(s * c for s, c in zip(sizes, counts))
            data = f.read(point_count * point_size)
            
            dtype_map = {
                ('F', 4): np.float32,
                ('F', 8): np.float64,
                ('I', 1): np.int8,
                ('I', 2): np.int16,
                ('I', 4): np.int32,
                ('U', 1): np.uint8,
                ('U', 2): np.uint16,
                ('U', 4): np.uint32,
            }
            
            dtype_list = []
            for field, size, ftype, count in zip(fields, sizes, types, counts):
                np_type = dtype_map.get((ftype, size), np.float32)
                if count == 1:
                    dtype_list.append((field, np_type))
                else:
                    dtype_list.append((field, np_type, (count,)))
            
            structured_arr = np.frombuffer(data, dtype=np.dtype(dtype_list), count=point_count)
            
            if 'x' in structured_arr.dtype.names:
                x = structured_arr['x'].astype(np.float32)
                y = structured_arr['y'].astype(np.float32)
                z = structured_arr['z'].astype(np.float32)
                positions = np.column_stack((x, y, z)).flatten()
            else:
                positions = np.zeros(point_count * 3, dtype=np.float32)
            
            if 'intensity' in structured_arr.dtype.names:
                intensities = structured_arr['intensity'].astype(np.float32)
            elif 'i' in structured_arr.dtype.names:
                intensities = structured_arr['i'].astype(np.float32)
            else:
                intensities = np.full(point_count, 0.5, dtype=np.float32)

            colors = _extract_pcd_colors(structured_arr, point_count)

            original_count = point_count
            positions, intensities, colors, point_count, was_subsampled = _maybe_subsample(
                positions, intensities, point_count, colors
            )
            positions, offset = _maybe_center(positions, point_count)
            meta = {
                "offset": offset,
                "original_point_count": original_count,
            }
            colors_bytes = colors.tobytes() if colors is not None else None
            return (positions.tobytes(), intensities.tobytes(), colors_bytes, point_count, meta)
        else:
            points = []
            intensities = []
            for line in f:
                parts = line.decode('utf-8', errors='ignore').strip().split()
                if len(parts) >= 3:
                    try:
                        x, y, z = float(parts[0]), float(parts[1]), float(parts[2])
                        intensity = float(parts[3]) if len(parts) > 3 else 0.5
                        points.append([x, y, z])
                        intensities.append(intensity)
                    except ValueError:
                        continue

            positions_arr = np.array(points, dtype=np.float32).flatten()
            intensities_arr = np.array(intensities, dtype=np.float32)
            pc = len(points)
            original_count = pc

            positions_arr, intensities_arr, _colors, pc, _ = _maybe_subsample(
                positions_arr, intensities_arr, pc, None
            )
            positions_arr, offset = _maybe_center(positions_arr, pc)
            meta = {"offset": offset, "original_point_count": original_count}
            return (positions_arr.tobytes(), intensities_arr.tobytes(), None, pc, meta)


def parse_bin_to_binary(file_path: str) -> Tuple[bytes, bytes, Optional[bytes], int, dict]:
    """
    Parse nuScenes .bin file and return binary data.
    Returns (positions_bytes, intensities_bytes, colors_bytes_or_None, point_count, metadata).
    See parse_pcd_to_binary for metadata schema. .bin format carries no color
    channel, so colors_bytes is always None.
    """
    points_data = np.fromfile(file_path, dtype=np.float32).reshape(-1, 4)
    positions = points_data[:, :3].flatten().astype(np.float32)
    intensities = points_data[:, 3].astype(np.float32)
    pc = len(points_data)
    original_count = pc

    positions, intensities, _colors, pc, _ = _maybe_subsample(positions, intensities, pc, None)
    positions, offset = _maybe_center(positions, pc)
    meta = {"offset": offset, "original_point_count": original_count}
    return (positions.tobytes(), intensities.tobytes(), None, pc, meta)


async def get_cached_pointcloud_async(
    file_path: str,
) -> Tuple[bytes, bytes, Optional[bytes], int, dict]:
    """
    Async version: get point cloud data with Redis caching.
    Awaits Redis properly and offloads sync parsing to a thread pool so the
    event loop is never blocked by file I/O or numpy parsing.

    Returns (positions_bytes, intensities_bytes, colors_bytes_or_None,
    point_count, metadata). See parse_pcd_to_binary for metadata schema.
    """
    start_time = time.time()

    try:
        mtime = os.path.getmtime(file_path)
    except OSError:
        raise ValueError(f"Cannot access file: {file_path}")

    try:
        cached = await redis_pcd_cache.get(file_path, mtime)
        if cached is not None:
            print(
                f"[CACHE HIT] {Path(file_path).name} - "
                f"{len(cached[0])/1024:.1f}KB in {(time.time()-start_time)*1000:.1f}ms",
                flush=True,
            )
            return cached
    except Exception as e:
        print(f"[CACHE ERROR] {e}", flush=True)

    suffix = Path(file_path).suffix.lower()
    parse_start = time.time()
    if suffix == '.pcd':
        result = await run_in_threadpool(parse_pcd_to_binary, file_path)
    elif suffix == '.bin':
        result = await run_in_threadpool(parse_bin_to_binary, file_path)
    else:
        raise ValueError(f"Unsupported file format: {suffix}")
    parse_time = (time.time() - parse_start) * 1000

    try:
        await redis_pcd_cache.set(
            file_path,
            mtime,
            result[0],
            result[1],
            result[3],
            metadata=result[4],
            colors=result[2],
        )
    except Exception as e:
        print(f"[CACHE STORE ERROR] {e}", flush=True)

    total_time = (time.time() - start_time) * 1000
    print(
        f"[CACHE MISS] {Path(file_path).name} - {result[3]} points, "
        f"parse: {parse_time:.1f}ms, total: {total_time:.1f}ms",
        flush=True,
    )

    return result


@router.get("/lidar/{file_path:path}")
async def get_lidar_data(
    file_path: str,
    request: Request,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_READ))],
    format: str = Query("json", description="Response format: json, binary, or raw"),
):
    """
    Get LiDAR point cloud data. Requires DATASETS_READ permission.
    
    The file_path should be relative to the DATA_ROOT, or prefixed with 'uploads/' for uploaded data.
    
    Format options:
    - json: Returns JSON with positions and intensities arrays (backward compatible)
    - binary: Returns optimized binary format (3-4x smaller, faster parsing)
    - raw: Returns the original file as-is
    
    Binary format structure (v3):
    - bytes  0..4 : point count            (uint32, little-endian)
    - bytes  4..8 : has_colors flag        (uint32, 0 or 1) — sized as uint32
                    to keep all following Float32 reads 4-byte aligned
    - bytes  8..  : positions Float32 [x1,y1,z1,...]      (N * 3 * 4 bytes)
    - then        : intensities Float32 [i1,i2,...]       (N * 4 bytes)
    - then (if has_colors): colors Float32 [r1,g1,b1,...] in [0,1] (N * 3 * 4 bytes)

    Supports gzip compression if client sends Accept-Encoding: gzip header.
    """
    accept_encoding = request.headers.get("Accept-Encoding", "")
    supports_gzip = "gzip" in accept_encoding.lower()
    
    if file_path.startswith("uploads/"):
        relative_path = file_path[8:]
        full_path = Path(UPLOAD_ROOT) / relative_path
        root_path = Path(UPLOAD_ROOT).resolve()
    else:
        full_path = Path(DATA_ROOT) / file_path
        root_path = Path(DATA_ROOT).resolve()
    
    try:
        full_path = full_path.resolve()
        if not str(full_path).startswith(str(root_path)):
            raise HTTPException(status_code=403, detail="Access denied")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")
    
    if not full_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    
    if format == "raw":
        return FileResponse(full_path, media_type="application/octet-stream")
    
    try:
        positions_bytes, intensities_bytes, colors_bytes, point_count, meta = (
            await get_cached_pointcloud_async(str(full_path))
        )
        offset = meta.get("offset")
        original_count = meta.get("original_point_count", point_count)
        has_colors = colors_bytes is not None

        try:
            file_mtime = os.path.getmtime(str(full_path))
        except OSError:
            file_mtime = 0
        etag_payload = (
            f"{full_path}|{file_mtime}|{point_count}|{original_count}|"
            f"{offset}|{int(has_colors)}|{redis_pcd_cache.CACHE_VERSION}"
        )
        etag_hash = hashlib.md5(etag_payload.encode()).hexdigest()
        etag = f'W/"{etag_hash}"'

        if_none_match = request.headers.get("If-None-Match")
        if if_none_match and if_none_match.strip() == etag:
            return Response(status_code=304, headers={"ETag": etag})

        meta_headers: Dict[str, str] = {
            "X-Point-Count": str(point_count),
            "X-Original-Point-Count": str(original_count),
            "X-Subsampled": "1" if original_count > point_count else "0",
            "X-Has-Colors": "1" if has_colors else "0",
            "ETag": etag,
            "Cache-Control": "max-age=0, must-revalidate, private",
        }
        if offset is not None:
            meta_headers["X-Pointcloud-Offset"] = (
                f"{offset[0]:.6f},{offset[1]:.6f},{offset[2]:.6f}"
            )
        meta_headers["Access-Control-Expose-Headers"] = (
            "X-Point-Count, X-Original-Point-Count, X-Subsampled, "
            "X-Has-Colors, X-Pointcloud-Offset, ETag"
        )

        if format == "binary":
            header_bytes = struct.pack('<II', point_count, 1 if has_colors else 0)
            binary_data = header_bytes + positions_bytes + intensities_bytes
            if has_colors:
                binary_data += colors_bytes

            if supports_gzip:
                gzip_cache_key = (
                    f"{full_path}:{point_count}:{int(has_colors)}:"
                    f"{redis_pcd_cache.CACHE_VERSION}"
                )
                cached_compressed = await get_cached_gzip(gzip_cache_key)

                if cached_compressed:
                    print(
                        f"[GZIP-HIT] {Path(file_path).name}: "
                        f"{len(cached_compressed)/1024:.0f}KB (cached)",
                        flush=True,
                    )
                    compressed_data = cached_compressed
                else:
                    compressed_data = await run_in_threadpool(
                        gzip_module.compress, binary_data, 1
                    )
                    await set_cached_gzip(gzip_cache_key, compressed_data)
                    print(
                        f"[GZIP-NEW] {Path(file_path).name}: "
                        f"{len(binary_data)/1024:.0f}KB -> "
                        f"{len(compressed_data)/1024:.0f}KB "
                        f"({len(compressed_data)/len(binary_data)*100:.0f}%)",
                        flush=True,
                    )

                headers = {
                    **meta_headers,
                    "Content-Encoding": "gzip",
                    "Content-Length": str(len(compressed_data)),
                }
                return Response(
                    content=compressed_data,
                    media_type="application/octet-stream",
                    headers=headers,
                )
            else:
                headers = {
                    **meta_headers,
                    "Content-Length": str(len(binary_data)),
                }
                return Response(
                    content=binary_data,
                    media_type="application/octet-stream",
                    headers=headers,
                )
        else:
            positions = np.frombuffer(positions_bytes, dtype=np.float32)
            intensities = np.frombuffer(intensities_bytes, dtype=np.float32)

            payload: Dict = {
                "pointCount": point_count,
                "originalPointCount": original_count,
                "subsampled": original_count > point_count,
                "offset": offset,
                "positions": positions.tolist(),
                "intensities": intensities.tolist(),
            }
            if has_colors:
                colors = np.frombuffer(colors_bytes, dtype=np.float32)
                payload["colors"] = colors.tolist()

            return JSONResponse(payload, headers=meta_headers)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error parsing file: {str(e)}")


@router.get("/image/{file_path:path}")
async def get_image(
    file_path: str,
    current_user: Annotated[User, Depends(RequirePermissionsWithQuery(Permission.DATASETS_READ))],
    width: Optional[int] = Query(None, description="Resize width (maintains aspect ratio)", gt=0, le=4096),
    height: Optional[int] = Query(None, description="Resize height (maintains aspect ratio)", gt=0, le=4096),
    quality: int = Query(85, description="JPEG quality (1-100)", ge=1, le=100),
):
    """
    Get camera image file with optional resizing for thumbnails/previews.
    Requires DATASETS_READ permission.
    
    The file_path should be relative to the DATA_ROOT, or prefixed with 'uploads/' for uploaded data.
    
    **Performance Optimization for 4K Images:**
    - Use `width=800` or `width=1920` for preview/annotation views
    - Use `width=400&height=225` for thumbnails in camera lists
    - Original size returned if no width/height specified
    - Maintains aspect ratio when only one dimension specified
    """
    if file_path.startswith("uploads/"):
        relative_path = file_path[8:]
        full_path = Path(UPLOAD_ROOT) / relative_path
        root_path = Path(UPLOAD_ROOT).resolve()
    else:
        full_path = Path(DATA_ROOT) / file_path
        root_path = Path(DATA_ROOT).resolve()
    
    try:
        full_path = full_path.resolve()
        if not str(full_path).startswith(str(root_path)):
            raise HTTPException(status_code=403, detail="Access denied")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")
    
    if not full_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    
    ext = full_path.suffix.lower()
    media_types = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
    }
    media_type = media_types.get(ext, 'application/octet-stream')
    
    if width is None and height is None:
        return FileResponse(full_path, media_type=media_type)
    
    try:
        from PIL import Image
        from io import BytesIO
        
        img = Image.open(full_path)
        
        if img.mode == 'RGBA' and ext in ['.jpg', '.jpeg']:
            background = Image.new('RGB', img.size, (255, 255, 255))
            background.paste(img, mask=img.split()[3])
            img = background
        
        orig_width, orig_height = img.size
        
        if width and height:
            img.thumbnail((width, height), Image.Resampling.LANCZOS)
        elif width:
            new_height = int(orig_height * (width / orig_width))
            img = img.resize((width, new_height), Image.Resampling.LANCZOS)
        elif height:
            new_width = int(orig_width * (height / orig_height))
            img = img.resize((new_width, height), Image.Resampling.LANCZOS)
        
        buffer = BytesIO()
        
        if ext in ['.jpg', '.jpeg']:
            img.save(buffer, format='JPEG', quality=quality, optimize=True)
            media_type = 'image/jpeg'
        elif ext == '.png':
            img.save(buffer, format='PNG', optimize=True)
            media_type = 'image/png'
        elif ext == '.webp':
            img.save(buffer, format='WEBP', quality=quality)
            media_type = 'image/webp'
        else:
            return FileResponse(full_path, media_type=media_type)
        
        buffer.seek(0)
        
        from fastapi.responses import StreamingResponse
        return StreamingResponse(
            buffer,
            media_type=media_type,
            headers={
                "Cache-Control": "public, max-age=3600",
                "X-Image-Resized": f"{img.size[0]}x{img.size[1]}",
                "X-Original-Size": f"{orig_width}x{orig_height}",
            }
        )
    except ImportError:
        print("[WARNING] PIL/Pillow not installed, cannot resize images. Install with: pip install Pillow")
        return FileResponse(full_path, media_type=media_type)
    except Exception as e:
        print(f"[WARNING] Failed to resize image {file_path}: {e}")
        return FileResponse(full_path, media_type=media_type)


@router.get("/uploads/{file_path:path}")
async def get_uploaded_file(
    file_path: str,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_READ))],
):
    """
    Get file from uploaded datasets. Requires DATASETS_READ permission.
    
    The file_path should be relative to /uploads.
    """
    full_path = Path(UPLOAD_ROOT) / file_path
    
    try:
        full_path = full_path.resolve()
        upload_root = Path(UPLOAD_ROOT).resolve()
        if not str(full_path).startswith(str(upload_root)):
            raise HTTPException(status_code=403, detail="Access denied")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")
    
    if not full_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    
    ext = full_path.suffix.lower()
    media_types = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.pcd': 'application/octet-stream',
        '.bin': 'application/octet-stream',
        '.ply': 'application/octet-stream',
    }
    media_type = media_types.get(ext, 'application/octet-stream')
    
    return FileResponse(full_path, media_type=media_type)


@router.get("/uploads/lidar/{file_path:path}")
async def get_uploaded_lidar_data(
    file_path: str,
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_READ))],
    format: str = Query("json", description="Response format: json or raw"),
):
    """
    Get LiDAR point cloud data from uploaded datasets. Requires DATASETS_READ permission.
    
    The file_path should be relative to /uploads.
    Returns point cloud data as JSON with positions and intensities.
    """
    full_path = Path(UPLOAD_ROOT) / file_path
    
    try:
        full_path = full_path.resolve()
        upload_root = Path(UPLOAD_ROOT).resolve()
        if not str(full_path).startswith(str(upload_root)):
            raise HTTPException(status_code=403, detail="Access denied")
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid path")
    
    if not full_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {file_path}")
    
    if format == "raw":
        return FileResponse(full_path, media_type="application/octet-stream")
    
    try:
        if full_path.suffix.lower() == '.pcd':
            data = parse_pcd_file(str(full_path))
            positions_flat = []
            for p in data["positions"]:
                positions_flat.extend(p)
            
            return JSONResponse({
                "pointCount": data["pointCount"],
                "positions": positions_flat,
                "intensities": data["intensities"],
            })
        else:
            return FileResponse(full_path, media_type="application/octet-stream")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse file: {str(e)}")


@router.get("/storage/presign")
async def presign_storage_object(
    ref: str = Query(..., description="minio:{bucket}/{key} reference stored in the DB"),
    current_user: Annotated[User, Depends(RequirePermissions(Permission.DATASETS_READ))] = None,
) -> RedirectResponse:
    """
    Generate a pre-signed GET URL for a MinIO object and redirect the client.

    The URL expires in OBJECT_STORAGE_PRESIGN_TTL seconds (default 15 min).
    No MinIO credentials are exposed to the browser — only an HMAC-signed URL
    that covers bucket + key + expiry.

    Query param:
        ref  — the ``minio:{bucket}/{key}`` value stored in frame.file_paths
    """
    if not StorageService.is_minio_ref(ref):
        raise HTTPException(
            status_code=400,
            detail="ref must be a minio: reference",
        )
    try:
        url = get_storage_service().presign(ref)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not generate presigned URL: {exc}") from exc
    return RedirectResponse(url=url, status_code=307)

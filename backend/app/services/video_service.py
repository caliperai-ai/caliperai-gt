"""
Video Processing Service - Extract frames from video files (MP4, AVI, MOV, etc.)

Provides functionality to:
- Extract frames from video files at specified intervals
- Get video metadata (duration, fps, resolution)
- Save extracted frames as images for annotation
"""
import asyncio
import json
import logging
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

log = logging.getLogger(__name__)

VIDEO_EXTENSIONS = frozenset({".mp4", ".avi", ".mov", ".mkv", ".webm", ".m4v"})


def is_ffmpeg_available() -> bool:
    """Check if ffmpeg is available on the system."""
    try:
        result = subprocess.run(
            ["ffmpeg", "-version"],
            capture_output=True,
            timeout=5,
        )
        return result.returncode == 0
    except (subprocess.SubprocessError, FileNotFoundError):
        return False


def get_video_metadata(video_path: Path) -> Dict[str, Any]:
    """
    Get video metadata using ffprobe.
    
    Returns:
        Dict containing:
        - duration: video duration in seconds
        - fps: frames per second
        - width: video width in pixels
        - height: video height in pixels
        - total_frames: estimated total frames
        - codec: video codec name
    """
    try:
        cmd = [
            "ffprobe",
            "-v", "quiet",
            "-print_format", "json",
            "-show_format",
            "-show_streams",
            str(video_path)
        ]
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=30,
        )
        
        if result.returncode != 0:
            log.error(f"ffprobe failed: {result.stderr}")
            return {}
        
        data = json.loads(result.stdout)
        
        video_stream = None
        for stream in data.get("streams", []):
            if stream.get("codec_type") == "video":
                video_stream = stream
                break
        
        if not video_stream:
            log.error("No video stream found")
            return {}
        
        fps_str = video_stream.get("r_frame_rate", "30/1")
        if "/" in fps_str:
            num, den = fps_str.split("/")
            fps = float(num) / float(den) if float(den) != 0 else 30.0
        else:
            fps = float(fps_str)
        
        duration = float(data.get("format", {}).get("duration", 0))
        if duration == 0:
            nb_frames = video_stream.get("nb_frames")
            if nb_frames:
                duration = int(nb_frames) / fps
        
        return {
            "duration": duration,
            "fps": fps,
            "width": int(video_stream.get("width", 0)),
            "height": int(video_stream.get("height", 0)),
            "total_frames": int(duration * fps) if duration else 0,
            "codec": video_stream.get("codec_name", "unknown"),
        }
        
    except subprocess.TimeoutExpired:
        log.error("ffprobe timeout")
        return {}
    except json.JSONDecodeError as e:
        log.error(f"Failed to parse ffprobe output: {e}")
        return {}
    except Exception as e:
        log.error(f"Error getting video metadata: {e}")
        return {}


def extract_frames(
    video_path: Path,
    output_dir: Path,
    fps: Optional[float] = None,
    start_time: float = 0,
    end_time: Optional[float] = None,
    max_frames: Optional[int] = None,
    image_format: str = "jpg",
    quality: int = 95,
) -> Tuple[List[Path], Dict[str, Any]]:
    """
    Extract frames from a video file.
    
    Args:
        video_path: Path to the input video file
        output_dir: Directory to save extracted frames
        fps: Frames per second to extract (None = use video's native FPS)
        start_time: Start time in seconds
        end_time: End time in seconds (None = until end)
        max_frames: Maximum number of frames to extract
        image_format: Output image format (jpg, png, webp)
        quality: Image quality (1-100, for jpg)
        
    Returns:
        Tuple of (list of frame paths, metadata dict)
    """
    output_dir.mkdir(parents=True, exist_ok=True)
    
    metadata = get_video_metadata(video_path)
    if not metadata:
        raise ValueError(f"Could not read video metadata from {video_path}")
    
    video_fps = metadata.get("fps", 30.0)
    video_duration = metadata.get("duration", 0)
    
    extract_fps = fps if fps is not None else video_fps
    
    cmd = ["ffmpeg", "-y", "-v", "warning"]
    
    if start_time > 0:
        cmd.extend(["-ss", str(start_time)])
    
    cmd.extend(["-i", str(video_path)])
    
    if end_time is not None:
        duration = end_time - start_time
        cmd.extend(["-t", str(duration)])
    
    filter_parts = []
    if fps is not None:
        filter_parts.append(f"fps={fps}")
    
    if filter_parts:
        cmd.extend(["-vf", ",".join(filter_parts)])
    
    if image_format in ("jpg", "jpeg"):
        cmd.extend(["-qscale:v", str(int((100 - quality) / 100 * 31))])
    elif image_format == "png":
        cmd.extend(["-compression_level", "6"])
    
    if max_frames:
        cmd.extend(["-frames:v", str(max_frames)])
    
    output_pattern = output_dir / f"%06d.{image_format}"
    cmd.append(str(output_pattern))
    
    log.info(f"Running ffmpeg: {' '.join(cmd)}")
    
    try:
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=3600,
        )
        
        if result.returncode != 0:
            log.error(f"ffmpeg failed: {result.stderr}")
            raise RuntimeError(f"Failed to extract frames: {result.stderr}")
        
    except subprocess.TimeoutExpired:
        raise RuntimeError("Frame extraction timed out (video too long)")
    
    frame_paths = sorted(output_dir.glob(f"*.{image_format}"))
    
    timestamps = []
    for i, _ in enumerate(frame_paths):
        timestamps.append(start_time + (i / extract_fps))
    
    extraction_metadata = {
        **metadata,
        "extraction_fps": extract_fps,
        "start_time": start_time,
        "end_time": end_time,
        "frames_extracted": len(frame_paths),
        "timestamps": timestamps,
    }
    
    log.info(f"Extracted {len(frame_paths)} frames from {video_path.name}")
    
    return frame_paths, extraction_metadata


async def extract_frames_async(
    video_path: Path,
    output_dir: Path,
    fps: Optional[float] = None,
    start_time: float = 0,
    end_time: Optional[float] = None,
    max_frames: Optional[int] = None,
    image_format: str = "jpg",
    quality: int = 95,
) -> Tuple[List[Path], Dict[str, Any]]:
    """
    Async wrapper for frame extraction.
    Runs ffmpeg in a thread pool to avoid blocking.
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        None,
        lambda: extract_frames(
            video_path=video_path,
            output_dir=output_dir,
            fps=fps,
            start_time=start_time,
            end_time=end_time,
            max_frames=max_frames,
            image_format=image_format,
            quality=quality,
        )
    )


def validate_video_file(file_path: Path) -> bool:
    """
    Validate that a file is a valid video file.
    Uses ffprobe to check if the file can be read.
    """
    try:
        metadata = get_video_metadata(file_path)
        return bool(metadata and metadata.get("duration", 0) > 0)
    except Exception:
        return False


VIDEO_MAGIC_BYTES = {
    ".mp4": [b"\x00\x00\x00", b"ftyp"],
    ".m4v": [b"\x00\x00\x00", b"ftyp"],
    ".avi": [b"RIFF", b"AVI "],
    ".mov": [b"\x00\x00\x00", b"ftyp"],
    ".mkv": [b"\x1a\x45\xdf\xa3"],
    ".webm": [b"\x1a\x45\xdf\xa3"],
}


def validate_video_magic_bytes(content: bytes, extension: str) -> bool:
    """
    Validate video file magic bytes.
    
    Args:
        content: First bytes of the file (at least 12 bytes)
        extension: File extension (lowercase, with dot)
        
    Returns:
        True if magic bytes match expected format
    """
    ext = extension.lower()
    
    if ext not in VIDEO_MAGIC_BYTES:
        return False
    
    expected = VIDEO_MAGIC_BYTES[ext]
    
    if ext in (".mp4", ".mov", ".m4v"):
        if content[4:8] == b"ftyp" or content[0:4] == b"ftyp":
            return True
        if ext == ".mov" and (content[4:8] == b"moov" or content[4:8] == b"free"):
            return True
        return False
    
    if ext == ".avi":
        return content[:4] == b"RIFF" and content[8:12] == b"AVI "
    
    if ext in (".mkv", ".webm"):
        return content[:4] == b"\x1a\x45\xdf\xa3"
    
    return False

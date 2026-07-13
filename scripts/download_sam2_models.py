#!/usr/bin/env python3
"""
Download SAM2 model weights.

Usage:
    python download_sam2_models.py [--size tiny|small|base|large] [--output-dir /models/sam2]
    
Model sizes:
    - tiny:  39M parameters, fastest, lowest accuracy
    - small: 46M parameters
    - base:  80M parameters (base+)
    - large: 224M parameters, slowest, highest accuracy (recommended)
"""
import os
import sys
import argparse
import hashlib
from pathlib import Path

try:
    import requests
    from tqdm import tqdm
except ImportError:
    print("Installing required packages...")
    os.system(f"{sys.executable} -m pip install requests tqdm")
    import requests
    from tqdm import tqdm


# SAM2 model URLs (official Meta releases)
MODEL_URLS = {
    "tiny": {
        "url": "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt",
        "filename": "sam2_hiera_tiny.pt",
        "size_mb": 156,
        "sha256": None,  # Add if verification needed
    },
    "small": {
        "url": "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt", 
        "filename": "sam2_hiera_small.pt",
        "size_mb": 185,
        "sha256": None,
    },
    "base": {
        "url": "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt",
        "filename": "sam2_hiera_base_plus.pt",
        "size_mb": 323,
        "sha256": None,
    },
    "large": {
        "url": "https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt",
        "filename": "sam2_hiera_large.pt",
        "size_mb": 898,
        "sha256": None,
    },
}


def download_file(url: str, dest_path: Path, expected_size_mb: int = None) -> bool:
    """Download a file with progress bar."""
    print(f"\nDownloading: {url}")
    print(f"Destination: {dest_path}")
    
    if dest_path.exists():
        existing_size = dest_path.stat().st_size / (1024 * 1024)
        if expected_size_mb and abs(existing_size - expected_size_mb) < 10:
            print(f"File already exists ({existing_size:.1f} MB), skipping...")
            return True
        else:
            print(f"File exists but size mismatch ({existing_size:.1f} MB), re-downloading...")
    
    try:
        response = requests.get(url, stream=True, timeout=30)
        response.raise_for_status()
        
        total_size = int(response.headers.get('content-length', 0))
        block_size = 8192
        
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        
        with open(dest_path, 'wb') as f:
            with tqdm(total=total_size, unit='iB', unit_scale=True, desc=dest_path.name) as pbar:
                for chunk in response.iter_content(chunk_size=block_size):
                    if chunk:
                        f.write(chunk)
                        pbar.update(len(chunk))
        
        print(f"Download complete: {dest_path.stat().st_size / (1024 * 1024):.1f} MB")
        return True
        
    except Exception as e:
        print(f"Error downloading {url}: {e}")
        if dest_path.exists():
            dest_path.unlink()
        return False


def verify_checksum(file_path: Path, expected_sha256: str) -> bool:
    """Verify file SHA256 checksum."""
    if not expected_sha256:
        return True
        
    print(f"Verifying checksum for {file_path.name}...")
    
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256_hash.update(chunk)
    
    actual = sha256_hash.hexdigest()
    if actual == expected_sha256:
        print("Checksum OK")
        return True
    else:
        print(f"Checksum mismatch! Expected {expected_sha256}, got {actual}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Download SAM2 model weights")
    parser.add_argument(
        "--size", 
        choices=["tiny", "small", "base", "large", "all"],
        default="large",
        help="Model size to download (default: large)"
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("/models/sam2"),
        help="Output directory for model weights (default: /models/sam2)"
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Force re-download even if file exists"
    )
    
    args = parser.parse_args()
    
    print("=" * 60)
    print("SAM2 Model Downloader")
    print("=" * 60)
    print(f"Output directory: {args.output_dir}")
    
    # Create output directory
    args.output_dir.mkdir(parents=True, exist_ok=True)
    
    # Determine which models to download
    if args.size == "all":
        models_to_download = list(MODEL_URLS.keys())
    else:
        models_to_download = [args.size]
    
    print(f"Models to download: {', '.join(models_to_download)}")
    
    success = True
    for model_size in models_to_download:
        model_info = MODEL_URLS[model_size]
        dest_path = args.output_dir / model_info["filename"]
        
        print(f"\n{'=' * 60}")
        print(f"Model: {model_size} ({model_info['size_mb']} MB)")
        print(f"{'=' * 60}")
        
        if args.force and dest_path.exists():
            dest_path.unlink()
        
        if not download_file(model_info["url"], dest_path, model_info["size_mb"]):
            success = False
            continue
        
        if model_info["sha256"] and not verify_checksum(dest_path, model_info["sha256"]):
            success = False
            continue
    
    print("\n" + "=" * 60)
    if success:
        print("All downloads completed successfully!")
        print("\nTo use SAM2, set these environment variables:")
        print(f"  SAM2_MODEL_DIR={args.output_dir}")
        print(f"  SAM2_MODEL_SIZE={args.size if args.size != 'all' else 'large'}")
        print("  SAM2_MODE=embedded")
    else:
        print("Some downloads failed. Please check the errors above.")
        sys.exit(1)
    print("=" * 60)


if __name__ == "__main__":
    main()

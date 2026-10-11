#!/usr/bin/env python3
"""
upload_cats.py
--------------
Upload images from the cats/ directory to Cloudflare R2 bucket using wrangler.
This script uses the wrangler CLI to upload files to your R2 bucket.

Usage:
    python3 upload_cats.py [--source-dir DIR] [--bucket-name BUCKET] [--dry-run] [--batch-size SIZE]
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path
from typing import List, Set
import time
import json
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

def parse_args():
    parser = argparse.ArgumentParser(description="Upload cat images to R2 bucket using wrangler")
    parser.add_argument("--source-dir", type=Path, default="cats", 
                       help="Source directory containing images (default: cats)")
    parser.add_argument("--bucket-name", type=str, default="cats",
                       help="R2 bucket name (default: cats)")
    parser.add_argument("--dry-run", action="store_true",
                       help="Show what would be uploaded without actually uploading")
    parser.add_argument("--batch-size", type=int, default=10,
                       help="Number of files to upload in parallel (default: 10)")
    parser.add_argument("--filter-extensions", type=str, 
                       default=".jpg,.jpeg,.png,.gif,.webp,.avif,.bmp,.tiff",
                       help="Comma-separated list of file extensions to upload")
    parser.add_argument("--overwrite", action="store_true",
                       help="Overwrite existing files in bucket")
    parser.add_argument("--progress", action="store_true",
                       help="Show upload progress")
    parser.add_argument("--check-existing", action="store_true",
                       help="Check each file individually before uploading (slower but safer)")
    parser.add_argument("--resume", action="store_true",
                       help="Resume upload by checking existing files (implies --check-existing)")
    parser.add_argument("--rate-limit-safe", action="store_true",
                       help="Use fewer parallel workers to avoid rate limits (recommended for large uploads)")
    return parser.parse_args()

def check_wrangler():
    """Check if wrangler CLI is available and authenticated."""
    try:
        result = subprocess.run(["wrangler", "--version"], 
                              capture_output=True, text=True, check=True)
        print(f"✓ Wrangler version: {result.stdout.strip()}")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("❌ Error: wrangler CLI not found or not working")
        print("Please install wrangler: npm install -g wrangler")
        print("And authenticate: wrangler auth login")
        return False

def get_existing_files(bucket_name: str) -> Set[str]:
    """Get list of existing files in the R2 bucket."""
    try:
        print(f"📋 Checking existing files in bucket '{bucket_name}'...")
        result = subprocess.run([
            "wrangler", "r2", "object", "list", bucket_name, "--json"
        ], capture_output=True, text=True, check=True)
        
        if result.stdout.strip():
            objects = json.loads(result.stdout)
            if isinstance(objects, list):
                existing_files = {obj.get("key", "") for obj in objects if obj.get("key")}
            else:
                existing_files = set()
        else:
            existing_files = set()
            
        print(f"📋 Found {len(existing_files)} existing files in bucket")
        return existing_files
    except (subprocess.CalledProcessError, json.JSONDecodeError) as e:
        print(f"⚠️  Warning: Could not list existing files: {e}")
        return set()

def check_file_exists(bucket_name: str, filename: str) -> bool:
    """Check if a specific file exists in the R2 bucket."""
    try:
        # Try to get file info - if it fails, file doesn't exist
        result = subprocess.run([
            "wrangler", "r2", "object", "get", f"{bucket_name}/{filename}", 
            "--remote", "--file", "/dev/null"
        ], capture_output=True, text=True, check=False)
        
        return result.returncode == 0
    except Exception:
        return False

def get_image_files(source_dir: Path, extensions: List[str]) -> List[Path]:
    """Get all image files from source directory."""
    if not source_dir.exists():
        print(f"❌ Error: Source directory '{source_dir}' does not exist")
        return []
    
    image_files = []
    ext_set = {ext.lower() for ext in extensions}
    
    for file_path in source_dir.iterdir():
        if file_path.is_file() and file_path.suffix.lower() in ext_set:
            image_files.append(file_path)
    
    return sorted(image_files)

def upload_file(file_path: Path, bucket_name: str, key: str = None, max_retries: int = 3) -> bool:
    """Upload a single file to R2 bucket with retry logic for rate limits."""
    if key is None:
        key = file_path.name
    
    for attempt in range(max_retries):
        try:
            cmd = ["wrangler", "r2", "object", "put", f"{bucket_name}/{key}", "--file", str(file_path), "--remote"]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            return True
        except subprocess.CalledProcessError as e:
            error_msg = e.stderr.lower()
            
            # Check for rate limit errors
            if "429" in error_msg or "too many requests" in error_msg:
                if attempt < max_retries - 1:
                    wait_time = (2 ** attempt) * 5  # Exponential backoff: 5s, 10s, 20s
                    print(f"⏳ Rate limited, waiting {wait_time}s before retry {attempt + 1}/{max_retries} for {file_path.name}")
                    time.sleep(wait_time)
                    continue
                else:
                    print(f"❌ Rate limit exceeded after {max_retries} retries for {file_path.name}")
                    return False
            else:
                print(f"❌ Failed to upload {file_path.name}: {e.stderr}")
                return False
    
    return False

def upload_batch(files: List[Path], bucket_name: str, existing_files: Set[str], 
                overwrite: bool, progress: bool, max_workers: int = 10) -> tuple[int, int]:
    """Upload a batch of files in parallel."""
    uploaded = 0
    failed = 0
    print_lock = Lock()
    
    def upload_single_file(file_path: Path) -> tuple[bool, str]:
        """Upload a single file and return (success, filename)."""
        key = file_path.name
        
        # Check if file already exists
        if key in existing_files and not overwrite:
            return True, f"⏭️  Skipped {key} (already exists)"
        
        if progress:
            with print_lock:
                print(f"📤 Uploading {key}...")
        
        success = upload_file(file_path, bucket_name, key)
        if success:
            return True, f"✅ Uploaded {key}"
        else:
            return False, f"❌ Failed {key}"
    
    # Use ThreadPoolExecutor for parallel uploads
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        # Submit all upload jobs
        future_to_file = {
            executor.submit(upload_single_file, file_path): file_path 
            for file_path in files
        }
        
        # Process completed jobs
        for future in as_completed(future_to_file):
            file_path = future_to_file[future]
            try:
                success, message = future.result()
                if success:
                    uploaded += 1
                else:
                    failed += 1
                
                if progress:
                    with print_lock:
                        print(message)
                        
            except Exception as e:
                failed += 1
                with print_lock:
                    print(f"❌ Error uploading {file_path.name}: {e}")
    
    return uploaded, failed

def main():
    args = parse_args()
    
    # Check wrangler availability
    if not check_wrangler():
        sys.exit(1)
    
    # Parse extensions
    extensions = [ext.strip() for ext in args.filter_extensions.split(",")]
    print(f"🔍 Looking for files with extensions: {extensions}")
    
    # Get image files
    print(f"📁 Scanning directory: {args.source_dir}")
    image_files = get_image_files(args.source_dir, extensions)
    
    if not image_files:
        print("❌ No image files found in source directory")
        sys.exit(1)
    
    print(f"📋 Found {len(image_files)} image files")
    
    # Get existing files in bucket (unless dry run)
    existing_files = set()
    if not args.dry_run:
        existing_files = get_existing_files(args.bucket_name)
    
    # Filter files if not overwriting
    files_to_upload = []
    skipped_count = 0
    
    if args.resume or args.check_existing:
        print("🔍 Checking existing files individually (this may take time)...")
        for i, file_path in enumerate(image_files):
            if i % 100 == 0:  # Show progress every 100 files
                print(f"📋 Checking progress: {i}/{len(image_files)} files checked")
            
            if check_file_exists(args.bucket_name, file_path.name):
                skipped_count += 1
                if args.progress:
                    print(f"⏭️  Skipping {file_path.name} (already exists)")
            else:
                files_to_upload.append(file_path)
    else:
        # Use the existing files list from bucket listing
        for file_path in image_files:
            if file_path.name in existing_files and not args.overwrite:
                skipped_count += 1
            else:
                files_to_upload.append(file_path)
    
    if skipped_count > 0:
        print(f"⏭️  Skipping {skipped_count} files (already exist)")
    
    if not files_to_upload:
        print("✅ All files already uploaded!")
        return
    
    print(f"📤 Will upload {len(files_to_upload)} files to bucket '{args.bucket_name}'")
    
    if args.dry_run:
        print("\n🔍 DRY RUN - Files that would be uploaded:")
        for file_path in files_to_upload[:10]:  # Show first 10
            print(f"  - {file_path.name}")
        if len(files_to_upload) > 10:
            print(f"  ... and {len(files_to_upload) - 10} more files")
        return
    
    # Confirm upload
    if not args.progress:
        response = input(f"\nProceed with uploading {len(files_to_upload)} files? (y/N): ")
        if response.lower() != 'y':
            print("❌ Upload cancelled")
            return
    
    # Adjust batch size for rate limiting
    effective_batch_size = args.batch_size
    if args.rate_limit_safe:
        effective_batch_size = min(5, args.batch_size)  # Max 5 parallel uploads
        print(f"🛡️  Rate-limit-safe mode: Using {effective_batch_size} parallel workers")
    
    # Upload all files in parallel batches
    print(f"\n🚀 Starting parallel upload with {effective_batch_size} workers...")
    start_time = time.time()
    
    # Upload all files in one parallel batch
    uploaded, failed = upload_batch(files_to_upload, args.bucket_name, existing_files, 
                                  args.overwrite, args.progress, effective_batch_size)
    
    total_uploaded = uploaded
    total_failed = failed
    
    # Summary
    elapsed = time.time() - start_time
    print(f"\n📈 Upload Summary:")
    print(f"✅ Successfully uploaded: {total_uploaded} files")
    print(f"❌ Failed uploads: {total_failed} files")
    print(f"⏰ Total time: {elapsed:.2f} seconds")
    
    if total_uploaded > 0:
        print(f"🚀 Average speed: {total_uploaded/elapsed:.1f} files/second")
    
    if total_failed > 0:
        print(f"\n⚠️  Some uploads failed. You can re-run the script to retry failed uploads.")

if __name__ == "__main__":
    main()

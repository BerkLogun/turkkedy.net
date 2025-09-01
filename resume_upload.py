#!/usr/bin/env python3
"""
resume_upload.py
----------------
Resume cat image uploads by checking which files are already in R2 and only uploading missing ones.
This script is optimized for resuming large uploads that hit rate limits.

Usage:
    python3 resume_upload.py [--source-dir DIR] [--batch-size SIZE] [--rate-limit-safe]
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path
from typing import List, Set
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

def parse_args():
    parser = argparse.ArgumentParser(description="Resume cat image uploads to R2 bucket")
    parser.add_argument("--source-dir", type=Path, default="cats", 
                       help="Source directory containing images (default: cats)")
    parser.add_argument("--batch-size", type=int, default=5,
                       help="Number of files to upload in parallel (default: 5 for rate-limit-safe)")
    parser.add_argument("--rate-limit-safe", action="store_true", default=True,
                       help="Use rate-limit-safe settings (default: True)")
    parser.add_argument("--progress", action="store_true",
                       help="Show detailed upload progress")
    parser.add_argument("--dry-run", action="store_true",
                       help="Show what would be uploaded without actually uploading")
    return parser.parse_args()

def check_file_exists(bucket_name: str, filename: str) -> bool:
    """Check if a specific file exists in the R2 bucket."""
    try:
        result = subprocess.run([
            "wrangler", "r2", "object", "get", f"{bucket_name}/{filename}", 
            "--remote", "--file", "/dev/null"
        ], capture_output=True, text=True, check=False)
        
        return result.returncode == 0
    except Exception:
        return False

def get_image_files(source_dir: Path) -> List[Path]:
    """Get all image files from source directory."""
    if not source_dir.exists():
        print(f"❌ Error: Source directory '{source_dir}' does not exist")
        return []
    
    image_extensions = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp', '.tiff'}
    image_files = []
    
    for file_path in source_dir.iterdir():
        if file_path.is_file() and file_path.suffix.lower() in image_extensions:
            image_files.append(file_path)
    
    return sorted(image_files)

def upload_file(file_path: Path, bucket_name: str, max_retries: int = 3) -> bool:
    """Upload a single file to R2 bucket with retry logic for rate limits."""
    filename = file_path.name
    
    for attempt in range(max_retries):
        try:
            cmd = ["wrangler", "r2", "object", "put", f"{bucket_name}/{filename}", "--file", str(file_path), "--remote"]
            result = subprocess.run(cmd, capture_output=True, text=True, check=True)
            return True
        except subprocess.CalledProcessError as e:
            error_msg = e.stderr.lower()
            
            # Check for rate limit errors
            if "429" in error_msg or "too many requests" in error_msg:
                if attempt < max_retries - 1:
                    wait_time = (2 ** attempt) * 10  # Exponential backoff: 10s, 20s, 40s
                    print(f"⏳ Rate limited, waiting {wait_time}s before retry {attempt + 1}/{max_retries} for {filename}")
                    time.sleep(wait_time)
                    continue
                else:
                    print(f"❌ Rate limit exceeded after {max_retries} retries for {filename}")
                    return False
            else:
                print(f"❌ Failed to upload {filename}: {e.stderr}")
                return False
    
    return False

def upload_files_parallel(files: List[Path], bucket_name: str, max_workers: int, progress: bool) -> tuple[int, int]:
    """Upload files in parallel with progress tracking."""
    uploaded = 0
    failed = 0
    print_lock = Lock()
    
    def upload_single_file(file_path: Path) -> tuple[bool, str]:
        """Upload a single file and return (success, filename)."""
        filename = file_path.name
        
        if progress:
            with print_lock:
                print(f"📤 Uploading {filename}...")
        
        success = upload_file(file_path, bucket_name)
        if success:
            return True, f"✅ Uploaded {filename}"
        else:
            return False, f"❌ Failed {filename}"
    
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
    
    # Check if wrangler is available
    try:
        subprocess.run(["wrangler", "--version"], capture_output=True, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("❌ Error: wrangler CLI not found")
        print("Please install: npm install -g wrangler")
        sys.exit(1)
    
    print("🚀 Resume Upload Script for Cat Images")
    print("=" * 50)
    print(f"Source: {args.source_dir}")
    print(f"Parallel workers: {args.batch_size}")
    print(f"Rate-limit-safe: {args.rate_limit_safe}")
    print()
    
    # Get image files
    print("🔍 Scanning for image files...")
    image_files = get_image_files(args.source_dir)
    
    if not image_files:
        print("❌ No image files found")
        sys.exit(1)
    
    print(f"📋 Found {len(image_files)} image files")
    
    # Check which files already exist (in parallel for speed)
    print("\n🔍 Checking existing files in R2 bucket...")
    print("⚠️  This may take time for large buckets...")
    
    files_to_upload = []
    existing_count = 0
    
    def check_file_batch(file_batch):
        """Check a batch of files in parallel."""
        results = []
        with ThreadPoolExecutor(max_workers=10) as executor:
            futures = {
                executor.submit(check_file_exists, "cats", file_path.name): file_path 
                for file_path in file_batch
            }
            for future in as_completed(futures):
                file_path = futures[future]
                try:
                    exists = future.result()
                    results.append((file_path, exists))
                except Exception:
                    results.append((file_path, False))
        return results
    
    # Process files in batches of 100 for better progress reporting
    batch_size = 100
    for i in range(0, len(image_files), batch_size):
        batch = image_files[i:i + batch_size]
        print(f"📋 Checking batch {i//batch_size + 1}/{(len(image_files) + batch_size - 1)//batch_size} ({len(batch)} files)...")
        
        batch_results = check_file_batch(batch)
        
        for file_path, exists in batch_results:
            if exists:
                existing_count += 1
                if args.progress:
                    print(f"⏭️  {file_path.name} already exists")
            else:
                files_to_upload.append(file_path)
    
    print(f"\n📊 File Status:")
    print(f"✅ Already uploaded: {existing_count}")
    print(f"📤 Need to upload: {len(files_to_upload)}")
    
    if not files_to_upload:
        print("\n🎉 All files are already uploaded!")
        return
    
    if args.dry_run:
        print(f"\n🔍 DRY RUN - Files that would be uploaded:")
        for file_path in files_to_upload[:10]:
            print(f"  - {file_path.name}")
        if len(files_to_upload) > 10:
            print(f"  ... and {len(files_to_upload) - 10} more files")
        return
    
    # Confirm upload
    print(f"\n🚀 Ready to upload {len(files_to_upload)} files")
    response = input("Proceed? (y/N): ")
    if response.lower() != 'y':
        print("❌ Upload cancelled")
        return
    
    # Upload files
    print(f"\n🚀 Starting upload with {args.batch_size} parallel workers...")
    start_time = time.time()
    
    uploaded, failed = upload_files_parallel(files_to_upload, "cats", args.batch_size, args.progress)
    
    # Summary
    elapsed = time.time() - start_time
    print(f"\n📈 Upload Summary:")
    print(f"✅ Successfully uploaded: {uploaded} files")
    print(f"❌ Failed uploads: {failed} files")
    print(f"⏰ Total time: {elapsed:.2f} seconds")
    
    if uploaded > 0:
        print(f"🚀 Average speed: {uploaded/elapsed:.1f} files/second")
    
    if failed > 0:
        print(f"\n⚠️  Some uploads failed. You can re-run this script to retry failed uploads.")

if __name__ == "__main__":
    main()

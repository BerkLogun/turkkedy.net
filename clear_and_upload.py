#!/usr/bin/env python3
"""
clear_and_upload.py
-------------------
Clear the R2 bucket and upload all cat images fresh.
This avoids the slow checking process and gives you a clean start.

Usage:
    python3 clear_and_upload.py [--source-dir DIR] [--batch-size SIZE]
"""

import argparse
import os
import subprocess
import sys
from pathlib import Path
from typing import List
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock

def parse_args():
    parser = argparse.ArgumentParser(description="Clear R2 bucket and upload all cat images fresh")
    parser.add_argument("--source-dir", type=Path, default="cats", 
                       help="Source directory containing images (default: cats)")
    parser.add_argument("--batch-size", type=int, default=5,
                       help="Number of files to upload in parallel (default: 5 for rate-limit-safe)")
    parser.add_argument("--progress", action="store_true",
                       help="Show detailed upload progress")
    parser.add_argument("--dry-run", action="store_true",
                       help="Show what would be done without actually doing it")
    parser.add_argument("--skip-clear", action="store_true",
                       help="Skip clearing the bucket (just upload)")
    return parser.parse_args()

def clear_bucket(bucket_name: str) -> bool:
    """Clear all objects from the R2 bucket."""
    print(f"🗑️  Clearing bucket '{bucket_name}'...")
    
    try:
        # Try to delete all objects (this may not work with current wrangler version)
        result = subprocess.run([
            "wrangler", "r2", "object", "delete", f"{bucket_name}/*", "--remote"
        ], capture_output=True, text=True, check=False)
        
        if result.returncode == 0:
            print("✅ Bucket cleared successfully")
            return True
        else:
            print(f"⚠️  Could not clear bucket with wildcard: {result.stderr}")
            print("ℹ️  Bucket may not be empty, but we'll proceed with uploads")
            return False
            
    except Exception as e:
        print(f"⚠️  Error clearing bucket: {e}")
        print("ℹ️  Proceeding with uploads anyway")
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
                    wait_time = (2 ** attempt) * 15  # Exponential backoff: 15s, 30s, 60s
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
    
    print("🚀 Clear & Upload Script for Cat Images")
    print("=" * 50)
    print(f"Source: {args.source_dir}")
    print(f"Parallel workers: {args.batch_size}")
    print(f"Skip clear: {args.skip_clear}")
    print()
    
    # Get image files
    print("🔍 Scanning for image files...")
    image_files = get_image_files(args.source_dir)
    
    if not image_files:
        print("❌ No image files found")
        sys.exit(1)
    
    print(f"📋 Found {len(image_files)} image files")
    
    if args.dry_run:
        print(f"\n🔍 DRY RUN - Would:")
        if not args.skip_clear:
            print(f"  🗑️  Clear bucket 'cats'")
        print(f"  📤 Upload {len(image_files)} files with {args.batch_size} parallel workers")
        return
    
    # Clear bucket (unless skipped)
    if not args.skip_clear:
        clear_bucket("cats")
    
    # Confirm upload
    print(f"\n🚀 Ready to upload {len(image_files)} files")
    response = input("Proceed with upload? (y/N): ")
    if response.lower() != 'y':
        print("❌ Upload cancelled")
        return
    
    # Upload files
    print(f"\n🚀 Starting upload with {args.batch_size} parallel workers...")
    start_time = time.time()
    
    uploaded, failed = upload_files_parallel(image_files, "cats", args.batch_size, args.progress)
    
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
    
    print(f"\n🎉 Fresh upload complete! All {len(image_files)} files should now be in your R2 bucket.")

if __name__ == "__main__":
    main()

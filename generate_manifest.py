#!/usr/bin/env python3
"""
generate_manifest.py
--------------------
Generate a manifest file from processed images in the output/ directory.
Creates both TypeScript and JSON manifest files.

Usage:
    python3 generate_manifest.py [--output-dir DIR] [--manifest-file FILE] [--json-file FILE]
"""

import argparse
import os
import json
from pathlib import Path
from typing import List

def parse_args():
    parser = argparse.ArgumentParser(description="Generate manifest from output directory")
    parser.add_argument("--output-dir", type=Path, default="output", 
                       help="Directory containing processed images (default: output)")
    parser.add_argument("--manifest-file", type=Path, default="functions/api/generated-manifest.ts",
                       help="Output TypeScript manifest file (default: functions/api/generated-manifest.ts)")
    parser.add_argument("--json-file", type=Path, default="manifest.json",
                       help="Output JSON manifest file (default: manifest.json)")
    parser.add_argument("--base-path", type=str, default="",
                       help="Base path to prepend to image paths (e.g., 'cats/' or '')")
    parser.add_argument("--sort", choices=["name", "size", "modified"], default="name",
                       help="Sort images by name, size, or modification time (default: name)")
    parser.add_argument("--reverse", action="store_true",
                       help="Reverse the sort order")
    return parser.parse_args()

def get_image_files(output_dir: Path) -> List[Path]:
    """Get all image files from the output directory."""
    image_extensions = {'.webp', '.jpg', '.jpeg', '.png', '.gif', '.avif'}
    image_files = []
    
    if not output_dir.exists():
        print(f"Warning: Output directory '{output_dir}' does not exist")
        return image_files
    
    for file_path in output_dir.iterdir():
        if file_path.is_file() and file_path.suffix.lower() in image_extensions:
            image_files.append(file_path)
    
    return image_files

def sort_images(image_files: List[Path], sort_by: str, reverse: bool) -> List[Path]:
    """Sort image files by the specified criteria."""
    if sort_by == "name":
        key_func = lambda f: f.name
    elif sort_by == "size":
        key_func = lambda f: f.stat().st_size
    elif sort_by == "modified":
        key_func = lambda f: f.stat().st_mtime
    else:
        key_func = lambda f: f.name
    
    return sorted(image_files, key=key_func, reverse=reverse)

def generate_typescript_manifest(image_paths: List[str], output_file: Path):
    """Generate TypeScript manifest file."""
    ts_content = f"""export const onRequest = async () => {{
  const localImages = [
{chr(10).join(f'    "{path}",' for path in image_paths)}
  ];

  return new Response(JSON.stringify(localImages), {{
    headers: {{
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      "access-control-allow-origin": "*"
    }}
  }});
}};
"""
    
    # Ensure parent directory exists
    output_file.parent.mkdir(parents=True, exist_ok=True)
    
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write(ts_content)
    
    print(f"Generated TypeScript manifest: {output_file}")

def generate_json_manifest(image_paths: List[str], output_file: Path):
    """Generate JSON manifest file."""
    json_content = {
        "images": image_paths,
        "count": len(image_paths),
        "generated_at": __import__('datetime').datetime.now().isoformat()
    }
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(json_content, f, indent=2, ensure_ascii=False)
    
    print(f"Generated JSON manifest: {output_file}")

def main():
    args = parse_args()
    
    print(f"Scanning directory: {args.output_dir}")
    image_files = get_image_files(args.output_dir)
    
    if not image_files:
        print("No image files found in the output directory")
        return
    
    print(f"Found {len(image_files)} image files")
    
    # Sort images
    sorted_images = sort_images(image_files, args.sort, args.reverse)
    
    # Generate image paths (relative to base path if specified)
    if args.base_path:
        image_paths = [f"{args.base_path.rstrip('/')}/{img.name}" for img in sorted_images]
    else:
        image_paths = [img.name for img in sorted_images]
    
    # Generate manifests
    generate_typescript_manifest(image_paths, args.manifest_file)
    generate_json_manifest(image_paths, args.json_file)
    
    print(f"\nManifest generation complete!")
    print(f"- {len(image_paths)} images processed")
    print(f"- Sorted by: {args.sort}")
    print(f"- Reverse order: {args.reverse}")
    if args.base_path:
        print(f"- Base path: {args.base_path}")

if __name__ == "__main__":
    main()

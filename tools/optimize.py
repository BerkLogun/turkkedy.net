#!/usr/bin/env python3
"""
optimize_cats_with_watermark.py
--------------------------------
Batch shrink, compress, and (optionally) overlay a small text tag like "turkkedy.net"
with randomized (noise-driven) position and color from a palette.

Features
- Resize images to a max dimension (default 1600px)
- Convert to WebP (default) or JPEG
- Strip metadata (default), EXIF auto-rotate
- Optional watermark text overlay with:
  * font directory (random font per image or seeded for stability)
  * color palette (comma-separated hex codes)
  * opacity and scale (relative to image min(width,height)) or fixed pixel size
  * noise-driven placement (repeatable per image using a stable seed from the file path)
  * legibility: stroke/outline and soft shadow
- Mirrors folder structure from input to output
"""

import argparse
import os
import sys
import hashlib
from pathlib import Path
from typing import List, Tuple, Optional
from concurrent.futures import ThreadPoolExecutor, as_completed
from threading import Lock
import time
from PIL import Image, ImageOps, ImageDraw, ImageFont, UnidentifiedImageError, ImageFilter

SUPPORTED_INPUT_EXTS = {'.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'}

def parse_args():
    p = argparse.ArgumentParser(description="Resize & compress images for the web (with optional text watermark).")
    p.add_argument("input_dir", type=Path, help="Folder with your original images")
    p.add_argument("output_dir", type=Path, help="Folder to write optimized images")
    p.add_argument("--max-dim", type=int, default=1600, help="Max width or height in pixels (default: 1600)")
    p.add_argument("--quality", type=int, default=80, help="Quality (1-100). WebP/JPEG (default: 80)")
    p.add_argument("--format", choices=["webp", "jpeg"], default="webp", help="Output format (default: webp)")
    p.add_argument("--effort", type=int, default=4, help="WebP encoding effort 0-6 (default: 4)")
    p.add_argument("--keep-metadata", action="store_true", help="Keep EXIF/XMP metadata (default: strip)")
    p.add_argument("--overwrite", action="store_true", help="Overwrite existing outputs (default: skip if exists)")
    p.add_argument("--dry-run", action="store_true", help="Print actions without writing files")

    # Watermark options
    p.add_argument("--wm-text", type=str, default=None, help="Text to overlay (e.g., 'turkkedy.net'). If omitted, no watermark is added.")
    p.add_argument("--fonts", type=Path, default=None, help="Directory containing .ttf/.otf fonts to choose from")
    p.add_argument("--palette", type=str, default=None, help="Comma-separated hex colors, e.g. '#ffffff,#ffd166,#06d6a0'")
    p.add_argument("--wm-scale", type=float, default=0.05, help="Font size as fraction of min(image_w, image_h). Default 0.05")
    p.add_argument("--wm-size-px", type=int, default=None, help="Fixed font size in pixels (overrides --wm-scale if set)")
    p.add_argument("--wm-opacity", type=float, default=0.85, help="Opacity 0..1 (default 0.85)")
    p.add_argument("--wm-margin", type=int, default=24, help="Margin from edges in pixels (default 24)")
    p.add_argument("--wm-stroke", type=int, default=2, help="Text outline width (default 2, 0=disable)")
    p.add_argument("--wm-shadow", action="store_true", help="Add a soft shadow")
    p.add_argument("--wm-seed-per-image", action="store_true", help="Use deterministic seed based on file path (default on)")
    p.add_argument("--no-wm-seed-per-image", dest="wm_seed_per_image", action="store_false")
    p.set_defaults(wm_seed_per_image=True)
    
    # Threading options
    p.add_argument("--threads", type=int, default=None, help="Number of worker threads (default: CPU count)")
    p.add_argument("--progress", action="store_true", help="Show progress counter")
    
    return p.parse_args()

def should_process(src: Path):
    return src.suffix.lower() in SUPPORTED_INPUT_EXTS

def ensure_parent(path: Path):
    path.parent.mkdir(parents=True, exist_ok=True)

def compute_out_path(src: Path, input_root: Path, output_root: Path, fmt: str) -> Path:
    rel = src.relative_to(input_root)
    if fmt == "webp":
        rel = rel.with_suffix(".webp")
    elif fmt == "jpeg":
        rel = rel.with_suffix(".jpg")
    return output_root / rel

def open_image_or_none(path: Path):
    try:
        return Image.open(path)
    except (UnidentifiedImageError, OSError):
        return None

def maybe_resize(img: Image.Image, max_dim: int) -> Image.Image:
    w, h = img.size
    if max(w, h) <= max_dim:
        return img
    scale = max_dim / float(max(w, h))
    new_size = (int(round(w * scale)), int(round(h * scale)))
    return img.resize(new_size, Image.LANCZOS)

def convert_to_display_mode(img: Image.Image) -> Image.Image:
    if img.mode in ("RGBA", "LA"):
        return img.convert("RGBA")
    if img.mode == "P":
        return img.convert("RGBA")
    if img.mode not in ("RGB", "RGBA"):
        return img.convert("RGB")
    return img

def parse_palette(p: Optional[str]) -> Optional[List[Tuple[int,int,int]]]:
    if not p:
        return None
    out = []
    for token in p.split(","):
        token = token.strip().lstrip("#")
        if len(token) == 3:
            token = ''.join([c*2 for c in token])
        if len(token) == 6:
            try:
                out.append((int(token[0:2],16), int(token[2:4],16), int(token[4:6],16)))
            except ValueError:
                pass
    return out or None

def list_fonts(font_dir: Optional[Path]) -> List[Path]:
    fonts = []
    if font_dir and font_dir.exists():
        for ext in (".ttf", ".otf"):
            fonts.extend(sorted(font_dir.rglob(f"*{ext}")))
    return fonts

def choose_from_noise(choices: List, seed_bytes: bytes) -> any:
    if not choices:
        return None
    h = hashlib.sha256(seed_bytes).digest()
    idx = int.from_bytes(h[:4], "big") % len(choices)
    return choices[idx]

def noise_float(seed_bytes: bytes, offset: int = 0) -> float:
    h = hashlib.sha256(seed_bytes + offset.to_bytes(2, 'big')).digest()
    return int.from_bytes(h[:8], "big") / 2**64

def layout_watermark(img_w: int, img_h: int, text_size: Tuple[int,int], margin: int, seed: bytes) -> Tuple[int,int]:
    tw, th = text_size
    max_x = max(0, img_w - tw - margin*2)
    max_y = max(0, img_h - th - margin*2)
    x = int(round(margin + noise_float(seed,1) * max_x))
    y = int(round(margin + noise_float(seed,2) * max_y))
    return (x, y)



def draw_black_shadow(overlay, alpha_img, x, y, blur_radius):
    """alpha_img is a single-channel (L) mask of the text; draw a soft black shadow."""
    from PIL import ImageFilter
    shadow_a = alpha_img.filter(ImageFilter.GaussianBlur(radius=blur_radius))
    shadow = Image.new("RGBA", shadow_a.size, (0, 0, 0, 0))
    # black with the blurred alpha
    shadow.putalpha(shadow_a)
    overlay.alpha_composite(shadow, (x, y))


def draw_watermark(
    base: Image.Image,
    text: str,
    fonts: List[Path],
    palette: Optional[List[Tuple[int,int,int]]],
    scale: float,
    size_px_override: Optional[int],
    opacity: float,
    margin: int,
    stroke: int,
    shadow: bool,
    seed: bytes
) -> Image.Image:
    """
    Draws watermark text using either a real TTF/OTF (preferred) or, if unavailable,
    a scaled alpha mask from Pillow's default bitmap font. Shadow is always pure black.
    Color is applied AFTER shadow via the alpha mask to avoid colored glow.
    """
    # Requested size (px) – fixed size overrides scale
    req_size = int(size_px_override) if (size_px_override and size_px_override > 0) \
               else max(6, int(round(min(base.size) * scale)))

    # Choose color from palette (or white)
    color_rgb = (255, 255, 255) if not palette else choose_from_noise(palette, seed)

    # Try to load a scalable font (random from --fonts, else arial.ttf)
    font = None
    if fonts:
        font_path = choose_from_noise(fonts, seed)
        try:
            font = ImageFont.truetype(str(font_path), req_size)
        except Exception:
            font = None
    if font is None:
        try:
            font = ImageFont.truetype("arial.ttf", req_size)
        except Exception:
            font = None  # will fall back to bitmap path below

    overlay = Image.new("RGBA", base.size, (0,0,0,0))
    d_tmp = ImageDraw.Draw(overlay)

    if font is not None:
        # --- VECTOR FONT PATH ---
        # Get text dimensions and position
        x0, y0, x1, y1 = d_tmp.textbbox((0, 0), text, font=font, stroke_width=stroke)
        tw, th = (x1 - x0, y1 - y0)
        x, y = layout_watermark(base.width, base.height, (tw, th), margin, seed)

        # Shadow first
        if shadow:
            off = max(1, req_size // 18)
            shadow_color = (0, 0, 0, int(255 * opacity * 0.5))
            d = ImageDraw.Draw(overlay)
            d.text((x + off, y + off), text, font=font, fill=shadow_color, stroke_width=stroke, stroke_fill=shadow_color)

        # Draw main text directly
        text_color = (*color_rgb, int(255 * opacity))
        stroke_color = (0, 0, 0, int(255 * opacity)) if stroke > 0 else None
        d = ImageDraw.Draw(overlay)
        d.text((x, y), text, font=font, fill=text_color, stroke_width=stroke, stroke_fill=stroke_color)

    else:
        # --- BITMAP FALLBACK (no TTF available) ---
        # Use default font with simple direct drawing
        base_font = ImageFont.load_default()
        
        # Get text dimensions for positioning
        x0, y0, x1, y1 = d_tmp.textbbox((0, 0), text, font=base_font, stroke_width=stroke)
        tw, th = (x1 - x0, y1 - y0)
        x, y = layout_watermark(base.width, base.height, (tw, th), margin, seed)

        # Shadow first
        if shadow:
            off = max(1, req_size // 18)
            shadow_color = (0, 0, 0, int(255 * opacity * 0.5))
            d = ImageDraw.Draw(overlay)
            d.text((x + off, y + off), text, font=base_font, fill=shadow_color, stroke_width=stroke, stroke_fill=shadow_color)

        # Draw main text directly  
        text_color = (*color_rgb, int(255 * opacity))
        stroke_color = (0, 0, 0, int(255 * opacity)) if stroke > 0 else None
        d = ImageDraw.Draw(overlay)
        d.text((x, y), text, font=base_font, fill=text_color, stroke_width=stroke, stroke_fill=stroke_color)

    return Image.alpha_composite(base, overlay)


def save_image(img, dst, fmt, quality, effort, keep_meta):
    params = {}
    if fmt == "webp":
        params.update(dict(format="WEBP", quality=quality, method=effort))
        if keep_meta:
            exif_bytes = img.info.get("exif")
            if exif_bytes:
                params["exif"] = exif_bytes
        icc = img.info.get("icc_profile")
        if keep_meta and icc:
            params["icc_profile"] = icc
        img.save(dst, **params)

    elif fmt == "jpeg":
        if img.mode == "RGBA":
            bg = Image.new("RGB", img.size, (255, 255, 255))
            bg.paste(img, mask=img.split()[3])
            img = bg
        params.update(dict(format="JPEG", quality=quality, optimize=True, progressive=True))
        if keep_meta:
            exif_bytes = img.info.get("exif")
            if exif_bytes:
                params["exif"] = exif_bytes
        icc = img.info.get("icc_profile")
        if keep_meta and icc:
            params["icc_profile"] = icc
        img.save(dst, **params)

    else:
        raise ValueError("Unsupported output format")

def process_single_image(src: Path, input_root: Path, output_root: Path, args, fonts: List[Path], 
                        palette: Optional[List[Tuple[int,int,int]]], print_lock: Lock) -> Tuple[bool, str]:
    """Process a single image file. Returns (success, message)."""
    try:
        out = compute_out_path(src, input_root, output_root, args.format)
        if out.exists() and not args.overwrite:
            with print_lock:
                print(f"[skip] {out} exists")
            return True, f"Skipped {src.name} (exists)"

        img = open_image_or_none(src)
        if img is None:
            with print_lock:
                print(f"[error] Could not open {src}")
            return False, f"Failed to open {src.name}"

        img = ImageOps.exif_transpose(img)
        img = convert_to_display_mode(img)
        img = maybe_resize(img, args.max_dim)

        if args.wm_text:
            base = img.convert("RGBA")
            seed = hashlib.sha256(str(src.relative_to(input_root)).encode()).digest() if args.wm_seed_per_image else os.urandom(16)
            img = draw_watermark(
                base, args.wm_text, fonts, palette,
                args.wm_scale, args.wm_size_px, args.wm_opacity,
                args.wm_margin, args.wm_stroke, args.wm_shadow, seed
            )

        ensure_parent(out)
        if args.dry_run:
            with print_lock:
                print(f"[dry-run] {src} -> {out}")
            return True, f"Dry-run {src.name}"
        else:
            save_image(img, out, args.format, args.quality, args.effort, args.keep_metadata)
            with print_lock:
                print(f"[ok] {src} -> {out}")
            return True, f"Processed {src.name}"
            
    except Exception as e:
        with print_lock:
            print(f"[error] {src}: {e}")
        return False, f"Error processing {src.name}: {e}"

def main():
    args = parse_args()
    input_root = args.input_dir.resolve()
    output_root = args.output_dir.resolve()
    if not input_root.is_dir():
        print("[ERROR] Input dir not found", file=sys.stderr); sys.exit(1)

    palette = parse_palette(args.palette)
    fonts = list_fonts(args.fonts)
    
    # Determine number of threads
    num_threads = args.threads or os.cpu_count()
    print(f"[info] Using {num_threads} worker threads")
    
    # Collect all image files to process
    image_files = []
    for root, _, files in os.walk(input_root):
        for name in files:
            src = Path(root) / name
            if should_process(src):
                image_files.append(src)
    
    if not image_files:
        print("[info] No images found to process")
        return
    
    print(f"[info] Found {len(image_files)} images to process")
    
    # Setup for multi-threading
    print_lock = Lock()
    start_time = time.time()
    completed = 0
    failed = 0
    
    # Process images in parallel
    with ThreadPoolExecutor(max_workers=num_threads) as executor:
        # Submit all jobs
        future_to_file = {
            executor.submit(process_single_image, src, input_root, output_root, args, fonts, palette, print_lock): src
            for src in image_files
        }
        
        # Process completed jobs
        for future in as_completed(future_to_file):
            src = future_to_file[future]
            try:
                success, message = future.result()
                if success:
                    completed += 1
                else:
                    failed += 1
                
                if args.progress:
                    total_processed = completed + failed
                    percentage = (total_processed / len(image_files)) * 100
                    with print_lock:
                        print(f"[progress] {total_processed}/{len(image_files)} ({percentage:.1f}%) - {message}")
                        
            except Exception as e:
                failed += 1
                with print_lock:
                    print(f"[error] Unexpected error processing {src}: {e}")
    
    # Summary
    elapsed = time.time() - start_time
    total_processed = completed + failed
    print(f"\n[summary] Processed {total_processed} images in {elapsed:.2f}s")
    print(f"[summary] Success: {completed}, Failed: {failed}")
    if elapsed > 0:
        print(f"[summary] Rate: {total_processed/elapsed:.1f} images/second")

if __name__ == "__main__":
    main()

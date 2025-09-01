# Cat Image Upload Scripts

This directory contains scripts to upload cat images to your Cloudflare R2 bucket.

## Prerequisites

1. **Install Wrangler CLI:**
   ```bash
   npm install -g wrangler
   ```

2. **Authenticate with Cloudflare:**
   ```bash
   wrangler auth login
   ```

3. **Verify your bucket configuration in `wrangler.toml`:**
   - Bucket name: `cats`
   - Binding: `CATS`

## Available Scripts

### 1. Python Script (`upload_cats.py`)

**Features:**
- ✅ Batch uploads with progress tracking
- ✅ Dry-run mode to preview uploads
- ✅ Skip existing files (optional overwrite)
- ✅ Customizable file extensions
- ✅ Error handling and retry logic
- ✅ Upload statistics

**Basic Usage:**
```bash
# Dry run to see what would be uploaded
python3 upload_cats.py --dry-run

# Upload all images with progress
python3 upload_cats.py --progress

# Upload with custom settings
python3 upload_cats.py --source-dir cats --bucket-name cats --batch-size 5 --overwrite
```

**Options:**
- `--source-dir DIR`: Source directory (default: `cats`)
- `--bucket-name BUCKET`: R2 bucket name (default: `cats`)
- `--dry-run`: Preview without uploading
- `--batch-size SIZE`: Files per batch (default: 10)
- `--overwrite`: Overwrite existing files
- `--progress`: Show detailed progress
- `--filter-extensions EXT`: File extensions to upload

### 2. Shell Script (`upload_cats.sh`)

**Features:**
- ✅ Simple and lightweight
- ✅ Basic progress tracking
- ✅ Automatic file detection
- ✅ Confirmation prompt

**Usage:**
```bash
# Upload to default bucket
./upload_cats.sh

# Upload to custom bucket
./upload_cats.sh my-bucket-name

# Upload from custom directory
./upload_cats.sh cats custom-source-dir
```

## File Processing Workflow

### Complete Workflow:
```bash
# 1. Optimize images with watermarks
python3 optimize.py cats output --wm-text "turkkedy.net" --wm-opacity 0.8 --wm-stroke 2

# 2. Upload optimized images to R2
python3 upload_cats.py --source-dir output --progress

# 3. Generate manifest for the website
python3 generate_manifest.py --output-dir output
```

### Alternative: Upload Original Images
```bash
# Upload original cats directly (without optimization)
python3 upload_cats.py --source-dir cats --progress
```

## Supported File Types

Both scripts support these image formats:
- `.jpg`, `.jpeg` - JPEG images
- `.png` - PNG images  
- `.gif` - GIF images
- `.webp` - WebP images
- `.avif` - AVIF images
- `.bmp` - Bitmap images
- `.tiff` - TIFF images

## Examples

### Upload Original Images:
```bash
python3 upload_cats.py --source-dir cats --progress
```

### Upload Optimized Images:
```bash
# First optimize
python3 optimize.py cats output --wm-text "turkkedy.net"

# Then upload
python3 upload_cats.py --source-dir output --progress
```

### Check Existing Files:
```bash
wrangler r2 object list cats
```

### Delete All Files (if needed):
```bash
# ⚠️ WARNING: This deletes ALL files in the bucket
wrangler r2 object delete cats --remote --recursive
```

## Troubleshooting

### "wrangler CLI not found"
```bash
npm install -g wrangler
wrangler auth login
```

### "Authentication failed"
```bash
wrangler auth login
# Follow the browser prompts
```

### "Bucket not found"
Check your `wrangler.toml` configuration and ensure:
1. Bucket exists in Cloudflare Dashboard
2. Bucket name matches configuration
3. Account permissions are correct

### Uploads are slow
- Reduce `--batch-size` (try 5 or 3)
- Check internet connection
- Consider uploading smaller batches

## Security Notes

- Scripts only upload, never download or delete existing files
- Use `--dry-run` to preview before actual upload
- Files are uploaded with original names (no path traversal)
- Only image files are processed (filtered by extension)

## Integration with Website

After uploading, your website can access images via:
- Cloudflare Pages: Direct integration via R2 binding
- Public URL: `https://your-bucket.r2.cloudflarestorage.com/filename.webp`
- Custom domain: Configure in Cloudflare dashboard

#!/bin/bash
#
# upload_cats.sh
# --------------
# Fast parallel upload script for cats/ directory to R2 bucket using wrangler
#
# Usage:
#   ./upload_cats.sh [bucket_name] [source_dir] [parallel_jobs]
#

set -e  # Exit on any error

# Default values
BUCKET_NAME="${1:-cats}"
SOURCE_DIR="${2:-cats}"
PARALLEL_JOBS="${3:-10}"

echo "🐱 Cat Image Upload Script"
echo "=========================="
echo "Bucket: $BUCKET_NAME"
echo "Source: $SOURCE_DIR"
echo "Parallel Jobs: $PARALLEL_JOBS"
echo ""

# Check if wrangler is available
if ! command -v wrangler &> /dev/null; then
    echo "❌ Error: wrangler CLI not found"
    echo "Please install: npm install -g wrangler"
    echo "And authenticate: wrangler auth login"
    exit 1
fi

# Check if source directory exists
if [ ! -d "$SOURCE_DIR" ]; then
    echo "❌ Error: Source directory '$SOURCE_DIR' does not exist"
    exit 1
fi

# Count image files
echo "🔍 Scanning for image files..."
IMAGE_COUNT=$(find "$SOURCE_DIR" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.gif" -o -iname "*.webp" -o -iname "*.avif" \) | wc -l | tr -d ' ')

if [ "$IMAGE_COUNT" -eq 0 ]; then
    echo "❌ No image files found in $SOURCE_DIR"
    exit 1
fi

echo "📋 Found $IMAGE_COUNT image files"

# Confirm upload
echo ""
read -p "🚀 Upload $IMAGE_COUNT files to bucket '$BUCKET_NAME'? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "❌ Upload cancelled"
    exit 1
fi

echo ""
echo "📤 Starting upload..."

# Create a temporary script for parallel uploads
TEMP_SCRIPT=$(mktemp)
cat > "$TEMP_SCRIPT" << 'EOF'
#!/bin/bash
BUCKET="$1"
FILE="$2"
filename=$(basename "$FILE")

echo "📤 Uploading: $filename"
if wrangler r2 object put "$BUCKET/$filename" --file "$FILE" --remote > /dev/null 2>&1; then
    echo "✅ Uploaded: $filename"
    exit 0
else
    echo "❌ Failed: $filename"
    exit 1
fi
EOF

chmod +x "$TEMP_SCRIPT"

# Upload files in parallel
echo "🚀 Starting parallel upload with $PARALLEL_JOBS workers..."
start_time=$(date +%s)

# Find all image files and upload them in parallel
find "$SOURCE_DIR" -type f \( -iname "*.jpg" -o -iname "*.jpeg" -o -iname "*.png" -o -iname "*.gif" -o -iname "*.webp" -o -iname "*.avif" \) | \
    xargs -P "$PARALLEL_JOBS" -I {} "$TEMP_SCRIPT" "$BUCKET_NAME" {}

# Clean up temp script
rm "$TEMP_SCRIPT"

end_time=$(date +%s)
elapsed=$((end_time - start_time))

echo ""
echo "📈 Upload Complete!"
echo "⏱️  Total time: ${elapsed} seconds"
echo ""
echo "💡 To verify uploads, run:"
echo "   wrangler r2 object get cats/[filename] --remote --file /tmp/test.jpg"



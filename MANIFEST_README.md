# Manifest System - CPU Limit Fix

This implements **Option A** from the solution: a prebuilt manifest stored in R2 that gets served instantly instead of walking the entire bucket on every request.

## What Changed

- **Before**: `/api/manifest` walked your entire R2 bucket on every request → CPU limit exceeded
- **After**: `/api/manifest` serves a prebuilt `manifest.json` from R2 → instant response

## Setup Steps

### 1. Add Environment Variable in Cloudflare Pages

1. Go to [Cloudflare Dashboard](https://dash.cloudflare.com) → Pages → your project
2. Click **Settings** → **Environment variables & bindings**
3. Add a new **Environment variable**:
   - **Variable name**: `ADMIN_TOKEN`
   - **Value**: Generate a long random string (e.g., use a UUID generator)
   - **Environment**: Production (and Preview if you want)

### 2. Deploy Your Functions

The updated functions will be deployed automatically when you push to your repository.

### 3. Build the Initial Manifest

After deployment, you need to build the manifest once. You have two options:

#### Option A: Use the Python script
```bash
# Install requests if you don't have it
pip install requests

# Set your admin token
export ADMIN_TOKEN="your-secret-token-here"

# Run the rebuild script
python rebuild_manifest.py
```

#### Option B: Use the shell script
```bash
# Set your admin token
export ADMIN_TOKEN="your-secret-token-here"

# Run the rebuild script
./rebuild_manifest.sh
```

#### Option C: Manual HTTP request
```bash
curl "https://turkkedy.net/api/admin/rebuild-manifest?key=YOUR_SECRET_TOKEN"
```

## How It Works

1. **`/api/manifest`** now serves a prebuilt `manifest.json` file from R2
2. **`/api/admin/rebuild-manifest?key=TOKEN`** crawls your bucket once and saves the result
3. The manifest is cached for 5 minutes at the edge for fast responses

## When to Rebuild

Rebuild the manifest whenever you:
- Upload new images to R2
- Delete images from R2
- Want to refresh the image list

## Security

- The rebuild endpoint is protected by your `ADMIN_TOKEN`
- Only you should know this token
- The token is never exposed to users

## Performance Benefits

- **Before**: CPU-intensive bucket walking on every request
- **After**: Simple file read from R2 (O(1) CPU usage)
- **Result**: No more 503 "exceeded CPU" errors

## Troubleshooting

### "manifest.json not found"
- Run the rebuild endpoint first
- Check that your `ADMIN_TOKEN` is set correctly

### "Unauthorized" on rebuild
- Verify your `ADMIN_TOKEN` environment variable is set
- Check that the token matches what you set in Cloudflare Pages

### Still getting CPU errors
- Make sure you've deployed the updated functions
- Check that the manifest was built successfully

## File Structure

```
functions/
├── api/
│   ├── manifest.ts          # Serves prebuilt manifest (fast)
│   └── admin/
│       └── rebuild-manifest.ts  # Rebuilds manifest (admin only)
├── rebuild_manifest.py      # Python script to trigger rebuild
└── rebuild_manifest.sh      # Shell script to trigger rebuild
```

## Example Workflow

1. Upload new cat images to R2
2. Run `./rebuild_manifest.sh` (or the Python version)
3. Your site now shows the new images instantly
4. `/api/manifest` responds in milliseconds instead of timing out

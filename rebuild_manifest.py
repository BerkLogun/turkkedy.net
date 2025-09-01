#!/usr/bin/env python3
"""
Script to rebuild the manifest after uploading new images.
Run this after you've uploaded new images to R2.
"""

import requests
import sys
import os

# Configuration
SITE_URL = "https://turkkedy.net"
ADMIN_TOKEN = os.getenv("ADMIN_TOKEN")

if not ADMIN_TOKEN:
    print("❌ Error: ADMIN_TOKEN environment variable not set")
    print("Please set it to your admin token from Cloudflare Pages")
    print("export ADMIN_TOKEN='your-secret-token-here'")
    sys.exit(1)

def rebuild_manifest():
    """Call the admin endpoint to rebuild the manifest"""
    url = f"{SITE_URL}/api/admin/rebuild-manifest"
    params = {"key": ADMIN_TOKEN}
    
    print(f"🔄 Rebuilding manifest...")
    print(f"URL: {url}")
    
    try:
        response = requests.get(url, params=params)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("ok"):
                count = data.get("count", 0)
                print(f"✅ Manifest rebuilt successfully!")
                print(f"📊 Total images: {count}")
                print(f"🌐 New manifest available at: {SITE_URL}/api/manifest")
            else:
                print(f"❌ Error: {data.get('error', 'Unknown error')}")
                sys.exit(1)
        elif response.status_code == 401:
            print("❌ Unauthorized: Check your ADMIN_TOKEN")
            sys.exit(1)
        else:
            print(f"❌ HTTP {response.status_code}: {response.text}")
            sys.exit(1)
            
    except requests.exceptions.RequestException as e:
        print(f"❌ Network error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    rebuild_manifest()

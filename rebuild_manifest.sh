#!/bin/bash

# Configuration
SITE_URL="https://turkkedy.net"
ADMIN_TOKEN="${ADMIN_TOKEN}"

if [ -z "$ADMIN_TOKEN" ]; then
    echo "❌ Error: ADMIN_TOKEN environment variable not set"
    echo "Please set it to your admin token from Cloudflare Pages"
    echo "export ADMIN_TOKEN='your-secret-token-here'"
    exit 1
fi

echo "🔄 Rebuilding manifest..."
echo "URL: ${SITE_URL}/api/admin/rebuild-manifest"

# Call the admin endpoint
response=$(curl -s -w "%{http_code}" "${SITE_URL}/api/admin/rebuild-manifest?key=${ADMIN_TOKEN}")

# Extract status code and body
http_code="${response: -3}"
body="${response%???}"

if [ "$http_code" = "200" ]; then
    # Check if the response contains "ok": true
    if echo "$body" | grep -q '"ok":\s*true'; then
        count=$(echo "$body" | grep -o '"count":\s*[0-9]*' | grep -o '[0-9]*')
        echo "✅ Manifest rebuilt successfully!"
        echo "📊 Total images: $count"
        echo "🌐 New manifest available at: ${SITE_URL}/api/manifest"
    else
        echo "❌ Error in response: $body"
        exit 1
    fi
elif [ "$http_code" = "401" ]; then
    echo "❌ Unauthorized: Check your ADMIN_TOKEN"
    exit 1
else
    echo "❌ HTTP $http_code: $body"
    exit 1
fi

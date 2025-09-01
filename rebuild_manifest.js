#!/usr/bin/env node

/**
 * Node.js script to rebuild the manifest after uploading new images.
 * Run this after you've uploaded new images to R2.
 */

const https = require('https');
const { URL } = require('url');

// Configuration
const SITE_URL = "https://turkkedy.net";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

if (!ADMIN_TOKEN) {
    console.error("❌ Error: ADMIN_TOKEN environment variable not set");
    console.error("Please set it to your admin token from Cloudflare Pages");
    console.error("export ADMIN_TOKEN='your-secret-token-here'");
    process.exit(1);
}

function makeRequest(url, params) {
    return new Promise((resolve, reject) => {
        const urlObj = new URL(url);
        urlObj.searchParams.set('key', params.key);
        
        const options = {
            hostname: urlObj.hostname,
            port: urlObj.port || 443,
            path: urlObj.pathname + urlObj.search,
            method: 'GET',
            headers: {
                'User-Agent': 'Manifest-Rebuild-Script/1.0'
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            
            res.on('data', (chunk) => {
                data += chunk;
            });
            
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    data: data
                });
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.end();
    });
}

async function rebuildManifest() {
    console.log("🔄 Rebuilding manifest...");
    console.log(`URL: ${SITE_URL}/api/admin/rebuild-manifest`);
    
    try {
        const response = await makeRequest(`${SITE_URL}/api/admin/rebuild-manifest`, { key: ADMIN_TOKEN });
        
        if (response.statusCode === 200) {
            try {
                const data = JSON.parse(response.data);
                if (data.ok) {
                    const count = data.count || 0;
                    console.log("✅ Manifest rebuilt successfully!");
                    console.log(`📊 Total images: ${count}`);
                    console.log(`🌐 New manifest available at: ${SITE_URL}/api/manifest`);
                } else {
                    console.error(`❌ Error: ${data.error || 'Unknown error'}`);
                    process.exit(1);
                }
            } catch (parseError) {
                console.error("❌ Invalid JSON response:", response.data);
                process.exit(1);
            }
        } else if (response.statusCode === 401) {
            console.error("❌ Unauthorized: Check your ADMIN_TOKEN");
            process.exit(1);
        } else {
            console.error(`❌ HTTP ${response.statusCode}: ${response.data}`);
            process.exit(1);
        }
        
    } catch (error) {
        console.error(`❌ Network error: ${error.message}`);
        process.exit(1);
    }
}

if (require.main === module) {
    rebuildManifest();
}

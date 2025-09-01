// functions/p/[key].ts
// Share page that emits OG/Twitter meta for a specific image key and then redirects humans to the viewer.

/// <reference types="@cloudflare/workers-types" />

interface Env {
  cats: R2Bucket;
  CDN_BASE: string;
  SITE_BASE: string;
}

function b64urlDecode(s: string): string {
  // base64url -> base64
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  // fix padding
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  const bytes = Uint8Array.from(atob(s), c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function isSocialMediaCrawler(userAgent: string): boolean {
  const crawlers = [
    'facebookexternalhit',
    'twitterbot',
    'linkedinbot',
    'whatsapp',
    'telegrambot',
    'discordbot',
    'slackbot',
    'skypebot',
    'viberbot',
    'linebot',
    'kakaotalk',
    'wechat',
    'qqbot',
    'baiduspider',
    'googlebot',
    'bingbot',
    'yandexbot',
    'duckduckbot'
  ];
  
  const lowerUA = userAgent.toLowerCase();
  return crawlers.some(crawler => lowerUA.includes(crawler));
}

// Updated function with better title/description and proper HTML formatting
export const onRequest: PagesFunction<Env> = async (ctx) => {
    const { request, env, params } = ctx;
    const keyParam = params.key as string | undefined;
    if (!keyParam) return new Response("Missing key", { status: 400 });
  
    // Decode key from base64url
    let key: string;
    try { key = b64urlDecode(keyParam); }
    catch { return new Response("Bad key", { status: 400 }); }
  
    // Optionally confirm object exists (cheap HEAD via R2)
    const head = await env.cats.head(key);
    if (!head) return new Response("Not found", { status: 404 });
  
    const imgUrl = `${env.CDN_BASE}/${encodeURI(key)}`;
    const originalFilename = key.split('/').pop() || 'cat';
    
    // Create a cleaner title and description
    const cleanTitle = "Cute Cat Photo • turkkedy.net";
    const dynamicDesc = `Check out this adorable cat photo on turkkedy.net! 🐱`;
    const canonical = `${env.SITE_BASE}/p/${encodeURIComponent(keyParam)}`;
  
    // Check if this is a social media crawler
    const userAgent = request.headers.get('user-agent') || '';
    const isCrawler = isSocialMediaCrawler(userAgent);
    const viewerUrl = `${env.SITE_BASE}/?k=${encodeURIComponent(keyParam)}`;
  
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${cleanTitle}</title>
<link rel="canonical" href="${canonical}">
<meta name="description" content="${dynamicDesc}">

<!-- Essential OG Tags -->
<meta property="og:type" content="website">
<meta property="og:title" content="${cleanTitle}">
<meta property="og:description" content="${dynamicDesc}">
<meta property="og:image" content="${imgUrl}">
<meta property="og:image:alt" content="Adorable cat photo">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="turkkedy.net">
<meta property="og:locale" content="en_US">

<!-- Enhanced Image Meta -->
<meta property="og:image:type" content="image/webp">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:secure_url" content="${imgUrl}">

<!-- Twitter Card Tags -->
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@xx">
<meta name="twitter:creator" content="@xx">
<meta name="twitter:title" content="${cleanTitle}">
<meta name="twitter:description" content="${dynamicDesc}">
<meta name="twitter:image" content="${imgUrl}">
<meta name="twitter:image:alt" content="Adorable cat photo">

<!-- Additional Meta for Better Crawling -->
<meta name="robots" content="index, follow">
<meta name="viewport" content="width=device-width, initial-scale=1">

${isCrawler ? '' : '<meta http-equiv="refresh" content="0;url=' + viewerUrl + '">'}
<style>
  body {
    font-family: system-ui, -apple-system, sans-serif;
    margin: 40px;
    color: #333;
    text-align: center;
    padding-top: 100px;
    background: #f9f9f9;
  }
  img {
    max-width: 100%;
    height: auto;
    border-radius: 10px;
    box-shadow: 0 10px 30px rgba(0,0,0,0.1);
  }
</style>
</head>
<body>
  ${isCrawler ? 
    `<h1>${cleanTitle}</h1>
     <p>${dynamicDesc}</p>
     <img src="${imgUrl}" alt="Adorable cat photo" />
     <p><small>Original: ${originalFilename}</small></p>` : 
    `<p>Loading your cat photo... If you are not redirected, <a href="${viewerUrl}">click here</a>.</p>`
  }
</body>
</html>`;
  
    return new Response(html, {
      headers: {
        "content-type": "text/html; charset=utf-8",
        // Cache OG pages at the edge; shorter cache for testing
        "cache-control": "public, max-age=3600, stale-while-revalidate=86400"
      }
    });
  };
  
/// <reference types="@cloudflare/workers-types" />

interface Env {
  cats: R2Bucket;
  ADMIN_TOKEN: string;
}

interface PendingImage {
  key: string;
  filename: string;
  originalName: string;
  uploadTime: number;
  confidence: number;
  hasCat: boolean;
  detectionMessage: string;
  size: number;
  contentType: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  
  if (!token || token !== env.ADMIN_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const pendingImages: PendingImage[] = [];
    let cursor: string | undefined;

    // List all pending images
    do {
      const list = await env.cats.list({ 
        cursor, 
        limit: 1000, 
        prefix: 'pending/' 
      });
      
      for (const obj of list.objects ?? []) {
        const head = await env.cats.head(obj.key);
        if (head) {
          const metadata = head.customMetadata || {};
          pendingImages.push({
            key: obj.key,
            filename: obj.key.split('/').pop() || '',
            originalName: metadata.originalName || 'Unknown',
            uploadTime: parseInt(metadata.uploadTime || '0'),
            confidence: parseFloat(metadata.confidence || '0'),
            hasCat: metadata.hasCat === 'true',
            detectionMessage: metadata.detectionResult ? 
              JSON.parse(metadata.detectionResult).message : 'Unknown',
            size: obj.size,
            contentType: head.httpMetadata?.contentType || 'image/jpeg'
          });
        }
      }
      
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    // Sort by upload time (newest first)
    pendingImages.sort((a, b) => b.uploadTime - a.uploadTime);

    return new Response(JSON.stringify({
      success: true,
      images: pendingImages,
      count: pendingImages.length
    }), {
      headers: { 
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*'
      }
    });

  } catch (error) {
    console.error('Error fetching pending images:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: (error as Error).message 
    }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
};

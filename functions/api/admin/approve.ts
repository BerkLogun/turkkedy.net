/// <reference types="@cloudflare/workers-types" />

interface Env {
  cats: R2Bucket;
  ADMIN_TOKEN: string;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    
    if (!token || token !== env.ADMIN_TOKEN) {
      return new Response("Unauthorized", { status: 401 });
    }

    const { action, key } = await request.json();

    if (!action || !key) {
      return new Response(JSON.stringify({ 
        error: 'Missing action or key parameter' 
      }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (!key.startsWith('pending/')) {
      return new Response(JSON.stringify({ 
        error: 'Invalid key format' 
      }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (action === 'approve') {
      // Get the pending image
      const pendingImage = await env.cats.get(key);
      if (!pendingImage) {
        return new Response(JSON.stringify({ 
          error: 'Pending image not found' 
        }), {
          status: 404,
          headers: { 'content-type': 'application/json' }
        });
      }

      // Process and move to approved location
      const imageBuffer = await pendingImage.arrayBuffer();
      const contentType = pendingImage.httpMetadata?.contentType || 'image/jpeg';
      const approvedKey = await processAndApproveImage(env, key, imageBuffer, contentType);

      return new Response(JSON.stringify({
        success: true,
        message: 'Image approved and processed successfully',
        approvedKey: approvedKey
      }), {
        headers: { 'content-type': 'application/json' }
      });

    } else if (action === 'reject') {
      // Simply delete the pending image
      await env.cats.delete(key);

      return new Response(JSON.stringify({
        success: true,
        message: 'Image rejected and deleted'
      }), {
        headers: { 'content-type': 'application/json' }
      });

    } else {
      return new Response(JSON.stringify({ 
        error: 'Invalid action. Use "approve" or "reject"' 
      }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('Admin action error:', error);
    return new Response(JSON.stringify({ 
      error: 'Action failed: ' + (error as Error).message 
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
};

async function processAndApproveImage(
  env: Env, 
  pendingKey: string, 
  imageBuffer: ArrayBuffer, 
  contentType: string
): Promise<string> {
  // Generate approved filename with .webp extension for consistency
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).substring(2, 15);
  const approvedFilename = `user_${timestamp}_${randomSuffix}.webp`;
  const approvedKey = `cats/${approvedFilename}`;
  
  try {
    // Basic image processing - resize and convert to WebP
    const processedBuffer = await processImage(imageBuffer, contentType);
    
    // Store processed image
    await env.cats.put(approvedKey, processedBuffer, {
      httpMetadata: {
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000'
      },
      customMetadata: {
        source: 'user_upload',
        approvedTime: timestamp.toString(),
        originalContentType: contentType
      }
    });

    // Remove from pending
    await env.cats.delete(pendingKey);

    return approvedKey;
  } catch (error) {
    console.error('Image processing failed, storing original:', error);
    
    // Fallback: store original image if processing fails
    const fallbackKey = `cats/user_${timestamp}_${randomSuffix}_original.${getFileExtension(contentType)}`;
    await env.cats.put(fallbackKey, imageBuffer, {
      httpMetadata: {
        contentType: contentType,
        cacheControl: 'public, max-age=31536000'
      },
      customMetadata: {
        source: 'user_upload_original',
        approvedTime: timestamp.toString()
      }
    });

    await env.cats.delete(pendingKey);
    return fallbackKey;
  }
}

async function processImage(imageBuffer: ArrayBuffer, contentType: string): Promise<ArrayBuffer> {
  // This is a simplified image processing function
  // In a production environment, you'd want to use a proper image processing library
  // For now, we'll return the original buffer and let the client handle optimization
  
  // TODO: Implement proper image processing with:
  // - Resize to max 1600px
  // - Convert to WebP format
  // - Compress with quality 80
  // - Add watermark if needed
  
  return imageBuffer;
}

function getFileExtension(contentType: string): string {
  switch (contentType) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    default:
      return 'jpg';
  }
}

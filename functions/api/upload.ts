/// <reference types="@cloudflare/workers-types" />

interface Env {
  cats: R2Bucket;
  ADMIN_TOKEN: string;
}

interface DetectionResult {
  hasCat: boolean;
  confidence: number;
  message: string;
  status: string;
  prediction?: any;
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image') as File;
    const detectionResultStr = formData.get('detectionResult') as string;

    if (!imageFile) {
      return new Response(JSON.stringify({ error: 'No image file provided' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (!detectionResultStr) {
      return new Response(JSON.stringify({ error: 'No detection result provided' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    let detectionResult: DetectionResult;
    try {
      detectionResult = JSON.parse(detectionResultStr);
    } catch {
      return new Response(JSON.stringify({ error: 'Invalid detection result format' }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(imageFile.type)) {
      return new Response(JSON.stringify({ 
        error: 'Invalid file type. Only JPG, PNG, and WebP are allowed.' 
      }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    // Validate file size (max 10MB)
    const maxSize = 10 * 1024 * 1024; // 10MB
    if (imageFile.size > maxSize) {
      return new Response(JSON.stringify({ 
        error: 'File too large. Maximum size is 10MB.' 
      }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    // Generate unique filename
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(2, 15);
    const fileExtension = imageFile.name.split('.').pop() || 'jpg';
    const filename = `user_${timestamp}_${randomSuffix}.${fileExtension}`;
    const key = `pending/${filename}`;

    // Store the image in R2
    const imageBuffer = await imageFile.arrayBuffer();
    await env.cats.put(key, imageBuffer, {
      httpMetadata: {
        contentType: imageFile.type,
        cacheControl: 'public, max-age=31536000'
      },
      customMetadata: {
        originalName: imageFile.name,
        uploadTime: timestamp.toString(),
        detectionResult: detectionResultStr,
        confidence: detectionResult.confidence.toString(),
        hasCat: detectionResult.hasCat.toString()
      }
    });

    // Determine if auto-approval should happen
    const CAT_CONFIDENCE_THRESHOLD = 0.7;
    const autoApproved = detectionResult.hasCat && detectionResult.confidence >= CAT_CONFIDENCE_THRESHOLD;

    if (autoApproved) {
      // Process and move to approved location
      const processedKey = await processAndApproveImage(env, key, imageBuffer, imageFile.type);
      
      return new Response(JSON.stringify({
        success: true,
        message: 'Fotoğraf başarıyla yüklendi ve otomatik onaylandı!',
        autoApproved: true,
        key: processedKey
      }), {
        headers: { 'content-type': 'application/json' }
      });
    } else {
      // Store in pending for admin review
      return new Response(JSON.stringify({
        success: true,
        message: 'Fotoğraf yüklendi ve admin onayı için bekliyor.',
        autoApproved: false,
        pendingKey: key
      }), {
        headers: { 'content-type': 'application/json' }
      });
    }

  } catch (error) {
    console.error('Upload error:', error);
    return new Response(JSON.stringify({ 
      error: 'Upload failed: ' + (error as Error).message 
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

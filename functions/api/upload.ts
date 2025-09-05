/// <reference types="@cloudflare/workers-types" />

interface Env {
  cats: R2Bucket;            // MUST be bound in Pages settings as "cats"
  ADMIN_TOKEN?: string;
}

interface DetectionResult {
  hasCat: boolean;
  confidence: number;
  message?: string;
  status?: string;
  prediction?: unknown;
}

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, authorization",
  "access-control-max-age": "86400",
};

export const onRequestOptions: PagesFunction<Env> = async () => {
  return new Response(null, { headers: CORS_HEADERS });
};

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  try {
    // --- Safety: ensure R2 binding exists
    if (!env.cats || typeof env.cats.put !== "function") {
      return json(
        { error: "R2 binding 'cats' is not configured for this Pages project." },
        500
      );
    }

    // Parse multipart form-data
    const formData = await request.formData();
    const imageFile = formData.get("image");
    const detectionResultStr = formData.get("detectionResult");

    if (!(imageFile instanceof File)) {
      return json({ error: "No image file provided" }, 400);
    }
    if (typeof detectionResultStr !== "string" || detectionResultStr.length === 0) {
      return json({ error: "No detection result provided" }, 400);
    }

    // Parse detection result
    let detectionResult: DetectionResult;
    try {
      detectionResult = JSON.parse(detectionResultStr) as DetectionResult;
    } catch {
      return json({ error: "Invalid detection result format" }, 400);
    }

    // Validate file type
    const allowedTypes = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
    const mime = imageFile.type || "application/octet-stream";
    if (!allowedTypes.has(mime)) {
      return json({ error: "Invalid file type. Only JPG, PNG, and WebP are allowed." }, 400);
    }

    // Validate file size (10MB limit; matches Workers limit)
    const maxSize = 10 * 1024 * 1024;
    const size = imageFile.size;
    if (size > maxSize) {
      return json({ error: "File too large. Maximum size is 10MB." }, 400);
    }

    // Auto-approve decision (match your frontend threshold)
    const AUTO_THRESHOLD = 0.80; // adjust if you changed the frontend value
    const hasCat = !!detectionResult.hasCat;
    const confidence = Number(detectionResult.confidence) || 0;
    const autoApproved = hasCat && confidence >= AUTO_THRESHOLD;

    // Use the original filename from the processed image (already contains timestamp and ID)
    // The frontend has already generated a proper filename with original name + unique ID
    const originalName = imageFile.name;
    let key = autoApproved ? originalName : `pending/${originalName}`;

    // Prepare metadata
    const httpMetadata: R2HTTPMetadata = {
      contentType: 'image/webp', // Frontend converts everything to WebP
      cacheControl: "public, max-age=31536000",
    };
    const customMetadata: Record<string, string> = {
      source: "user_upload",
      originalName: imageFile.name,
      uploadTime: String(Date.now()),
      detectionResult: detectionResultStr,     // keep the raw JSON string
      confidence: confidence.toString(),
      hasCat: hasCat.toString(),
      status: autoApproved ? "approved" : "pending",
    };

    // Process and optimize the image
    const originalBuffer = await imageFile.arrayBuffer();
    const processedBuffer = await optimizeImage(originalBuffer, imageFile.type);

    // Image is already processed on frontend, just upload as-is
    const finalSize = processedBuffer.byteLength;

    // Upload the processed image
    await env.cats.put(key, processedBuffer, { httpMetadata, customMetadata });

    // Respond
    return new Response(
      JSON.stringify({
        success: true,
        message: autoApproved
          ? "Fotoğraf başarıyla yüklendi ve otomatik onaylandı!"
          : "Fotoğraf yüklendi ve admin onayı için bekliyor.",
        autoApproved,
        key,
        size: finalSize,
        contentType: 'image/webp',
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-upload-key": key,
          "x-upload-size": String(finalSize),
          "x-upload-mime": 'image/webp',
          ...CORS_HEADERS,
        },
      }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("Upload error:", error);
    return new Response(JSON.stringify({ error: "Upload failed: " + msg }), {
      status: 500,
      headers: { "content-type": "application/json", ...CORS_HEADERS },
    });
  }
};

// --- helpers ---

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...CORS_HEADERS },
  });
}

function pickExtensionFromMime(mime: string, fallbackName?: string): string {
  switch (mime) {
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      // last resort: use the original name's extension if present
      if (fallbackName && fallbackName.includes(".")) {
        return fallbackName.split(".").pop()!.toLowerCase();
      }
      return "bin";
  }
}


// Image processing moved to frontend - server just receives processed images
async function optimizeImage(buffer: ArrayBuffer, mimeType: string): Promise<ArrayBuffer> {
  // Since image processing is now done on the frontend,
  // we just return the buffer as-is (it's already optimized)
  console.log('Received optimized image from frontend:', mimeType, 'size:', buffer.byteLength);
  return buffer;
}


/// <reference types="@cloudflare/workers-types" />

interface Env {
  cats: R2Bucket;
  ADMIN_TOKEN: string;
}

interface ImageData {
  key: string;
  filename: string;
  inManifest: boolean;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');

  if (!token || token !== env.ADMIN_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    // Get pagination parameters
    const page = parseInt(url.searchParams.get('page') || '1');
    const limit = parseInt(url.searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    // Get current manifest to check which images are live
    let manifestKeys = new Set<string>();
    try {
      const manifestObj = await env.cats.get('manifest.json');
      if (manifestObj) {
        const manifestData = await manifestObj.json() as string[];
        manifestKeys = new Set(manifestData);
      } else {
        console.log('Manifest object not found');
      }
    } catch (error) {
      console.log('Manifest not found or invalid, proceeding without manifest data:', error);
    }

    // List all image files in the bucket
    const exts = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
    const allImages: ImageData[] = [];
    let cursor: string | undefined;
    let totalCount = 0;

    do {
      const list = await env.cats.list({
        cursor,
        limit: 1000
      });

      for (const obj of list.objects ?? []) {
        if (obj.key === 'manifest.json') continue; // Skip manifest file

        // Check if it's an image file
        const dot = obj.key.lastIndexOf(".");
        if (dot === -1 || !exts.has(obj.key.slice(dot).toLowerCase())) continue;

        totalCount++;
        const filename = obj.key.split('/').pop() || obj.key;
        const inManifest = manifestKeys.has(filename);

        allImages.push({
          key: obj.key,
          filename: obj.key,
          inManifest: inManifest
        });
      }

      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    // Sort images (newest first - by key name which typically includes timestamp)
    allImages.sort((a, b) => b.key.localeCompare(a.key));

    // Apply pagination
    const paginatedImages = allImages.slice(offset, offset + limit);
    const totalPages = Math.ceil(totalCount / limit);

    const inManifestCount = allImages.filter(img => img.inManifest).length;
    const notInManifestCount = allImages.filter(img => !img.inManifest).length;

    return new Response(JSON.stringify({
      success: true,
      images: paginatedImages,
      pagination: {
        page: page,
        limit: limit,
        total: totalCount,
        totalPages: totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      },
      stats: {
        inManifest: inManifestCount,
        notInManifest: notInManifestCount
      }
    }), {
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*'
      }
    });

  } catch (error) {
    console.error('Error fetching all images:', error);
    return new Response(JSON.stringify({
      success: false,
      error: (error as Error).message
    }), {
      status: 500,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
};

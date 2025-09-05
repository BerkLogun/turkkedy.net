/// <reference types="@cloudflare/workers-types" />

interface Env {
  cats: R2Bucket;
  ADMIN_TOKEN: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env, params }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  
  if (!token || token !== env.ADMIN_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  const key = decodeURIComponent(params.key as string);
  if (!key) {
    return new Response("Missing key", { status: 400 });
  }

  try {
    console.log('Looking for image with key:', key);
    const obj = await env.cats.get(key);
    if (!obj) {
      console.log('Image not found for key:', key);
      return new Response("Image not found", { status: 404 });
    }
    console.log('Image found, size:', obj.size);

    const headers = new Headers();
    if (obj.httpMetadata?.contentType) {
      headers.set("content-type", obj.httpMetadata.contentType);
    }
    if (obj.httpMetadata?.cacheControl) {
      headers.set("cache-control", obj.httpMetadata.cacheControl);
    }
    headers.set("cache-control", "no-cache, no-store, must-revalidate");
    headers.set("access-control-allow-origin", "*");

    return new Response(obj.body, { headers });
  } catch (error) {
    console.error('Error serving image:', error);
    return new Response("Internal server error", { status: 500 });
  }
};

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

  const key = params.key as string;
  if (!key) {
    return new Response("Missing key", { status: 400 });
  }

  try {
    const obj = await env.cats.get(key);
    if (!obj) {
      return new Response("Image not found", { status: 404 });
    }

    const headers = new Headers(obj.httpMetadata ?? {});
    headers.set("cache-control", "no-cache, no-store, must-revalidate");
    headers.set("access-control-allow-origin", "*");

    return new Response(obj.body, { headers });
  } catch (error) {
    console.error('Error serving image:', error);
    return new Response("Internal server error", { status: 500 });
  }
};

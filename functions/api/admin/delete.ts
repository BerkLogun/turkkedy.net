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

    const body = await request.json() as { key?: string };
    const { key } = body;

    if (!key) {
      return new Response(JSON.stringify({
        error: 'Missing key parameter'
      }), {
        status: 400,
        headers: { 'content-type': 'application/json' }
      });
    }

    // Verify the image exists before deleting
    const image = await env.cats.get(key);
    if (!image) {
      return new Response(JSON.stringify({
        error: 'Image not found'
      }), {
        status: 404,
        headers: { 'content-type': 'application/json' }
      });
    }

    // Delete the image
    await env.cats.delete(key);

    return new Response(JSON.stringify({
      success: true,
      message: 'Image deleted successfully'
    }), {
      headers: { 'content-type': 'application/json' }
    });

  } catch (error) {
    console.error('Delete image error:', error);
    return new Response(JSON.stringify({
      error: 'Delete failed: ' + (error as Error).message
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
};

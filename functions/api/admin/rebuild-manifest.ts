interface Env {
  cats: R2Bucket;
  ADMIN_TOKEN: string;
}

export const onRequest: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token || token !== env.ADMIN_TOKEN) {
    return new Response("Unauthorized", { status: 401 });
  }

  const exts = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif"]);
  const out: string[] = [];
  const prefix = url.searchParams.get('prefix') || undefined;

  let cursor: string | undefined;
  try {
    do {
      const list = await env.cats.list({ cursor, limit: 1000, prefix });
      for (const o of list.objects ?? []) {
        const k = o.key;
        const dot = k.lastIndexOf(".");
        if (dot > -1 && exts.has(k.slice(dot).toLowerCase())) out.push(k);
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    // Save to R2 as manifest.json
    const body = JSON.stringify(out);
    await env.cats.put('manifest.json', body, {
      httpMetadata: {
        contentType: "application/json; charset=utf-8",
        cacheControl: "public, max-age=300"
      }
    });

    return new Response(JSON.stringify({ ok: true, count: out.length }), {
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }), {
      status: 500, headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
};

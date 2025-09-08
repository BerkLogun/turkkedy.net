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
  const out: { key: string; uploaded: Date }[] = [];
  const prefix = url.searchParams.get('prefix') || undefined;

  let cursor: string | undefined;
  try {
    do {
      const list = await env.cats.list({ cursor, limit: 1000, prefix });
      for (const o of list.objects ?? []) {
        const k = o.key;
        // Skip files in folders (containing "/")
        if (/(^|\/)pending(\/|$)/i.test(k)) continue;
        const dot = k.lastIndexOf(".");
        if (dot > -1 && exts.has(k.slice(dot).toLowerCase())) {
          out.push({ key: k, uploaded: o.uploaded });
        }
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    // Sort by upload date: oldest to newest (so last item is newest)
    out.sort((a, b) => a.uploaded.getTime() - b.uploaded.getTime());

    // Extract just the keys for the manifest
    const manifestKeys = out.map(item => item.key);

    // Save to R2 as manifest.json
    const body = JSON.stringify(manifestKeys);
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

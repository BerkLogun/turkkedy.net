import type { Env } from "../../lib/env";
import { cdnBase } from "../../lib/env";
import { range } from "../../lib/cats";
import { SITEMAP_CHUNK } from "../../lib/sitemap";
import { esc } from "../../lib/seo";

/** GET /sitemaps/cats-N.xml — up to 1000 cat pages with image extensions. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  const url = new URL(request.url);
  if (params.name === "static.xml") {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${url.origin}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>${url.origin}/gizlilik/</loc><changefreq>yearly</changefreq><priority>0.2</priority></url>
</urlset>`;
    return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=86400" } });
  }
  const m = /^cats-(\d+)\.xml$/.exec(String(params.name ?? ""));
  if (!m) return new Response("Not found", { status: 404 });
  const cache = caches.default;
  const cacheKey = new Request(url.toString(), { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const n = Number(m[1]);
  const rows = await range(env.DB, n * SITEMAP_CHUNK, (n + 1) * SITEMAP_CHUNK);
  if (!rows.length) return new Response("Not found", { status: 404 });
  const cdn = cdnBase(env, url.origin);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${rows
  .map(
    (r) => `  <url><loc>${url.origin}/kedi/${r.id}</loc>${r.approved_at ? `<lastmod>${new Date(r.approved_at).toISOString().slice(0, 10)}</lastmod>` : ""}<image:image><image:loc>${cdn}/${r.key}</image:loc>${r.caption ? `<image:title>${esc(r.caption)}</image:title>` : ""}</image:image></url>`,
  )
  .join("\n")}
</urlset>`;
  const res = new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
};

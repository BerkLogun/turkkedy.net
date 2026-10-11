import type { Env } from "../../lib/env";
import { cdnBase } from "../../lib/env";
import { getById, getByPos, liveCount, range } from "../../lib/cats";
import { renderCatPage } from "../../lib/seo";
import { SECURITY_HEADERS } from "../../lib/http";

/**
 * GET /kedi/:id       — server-rendered page for one cat (canonical URL, indexable).
 * GET /kedi/rastgele  — redirect to a random cat (noindex).
 * Pages are edge-cached for 10 minutes; the admin's delete/caption actions show up after that.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  const ref = String(params.id ?? "");
  const url = new URL(request.url);

  if (ref === "rastgele") {
    const total = await liveCount(env.DB);
    const row = total ? await getByPos(env.DB, Math.floor(Math.random() * total)) : null;
    return new Response(null, {
      status: 302,
      headers: { location: row ? `${url.origin}/kedi/${row.id}` : `${url.origin}/`, "cache-control": "no-store", "x-robots-tag": "noindex" },
    });
  }

  const id = Number(ref);
  if (!Number.isInteger(id) || id <= 0) return new Response("Not found", { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/kedi/${id}`, { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const cat = await getById(env.DB, id);
  if (!cat || cat.status !== "live" || cat.pos === null) {
    return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=300" } });
  }
  const [total, strip] = await Promise.all([liveCount(env.DB), range(env.DB, cat.pos - 6, cat.pos + 6)]);
  const prev = strip.find((s) => s.pos === cat.pos! - 1) ?? null;
  const next = strip.find((s) => s.pos === cat.pos! + 1) ?? null;

  const html = renderCatPage({ origin: url.origin, cdn: cdnBase(env, url.origin), cat, total, prev, next, strip });
  const res = new Response(html, {
    headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=600" },
  });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
};

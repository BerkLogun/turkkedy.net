import type { Env } from "../../lib/env";
import { cdnBase } from "../../lib/env";
import { getById, getByPos, liveCount, range } from "../../lib/cats";
import { renderCatPage } from "../../lib/seo";
import { SECURITY_HEADERS } from "../../lib/http";
import { isD1Outage, readSnapshot } from "../../lib/snapshot";
import type { CatRow } from "../../lib/cats";

/**
 * GET /kedi/:id       — server-rendered page for one cat (canonical URL, indexable).
 * GET /kedi/rastgele  — redirect to a random cat (noindex).
 * Pages are edge-cached for 10 minutes; the admin's delete/caption actions show up after that.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params, waitUntil }) => {
  const ref = String(params.id ?? "");
  const url = new URL(request.url);

  if (ref === "rastgele") {
    let targetId: number | null = null;
    try {
      const total = await liveCount(env.DB);
      const row = total ? await getByPos(env.DB, Math.floor(Math.random() * total)) : null;
      targetId = row?.id ?? null;
    } catch (e) {
      if (!isD1Outage(e)) throw e;
      const all = await readSnapshot(env);
      targetId = all.length ? all[Math.floor(Math.random() * all.length)][0] : null;
    }
    return new Response(null, {
      status: 302,
      headers: { location: targetId ? `${url.origin}/kedi/${targetId}` : `${url.origin}/`, "cache-control": "no-store", "x-robots-tag": "noindex" },
    });
  }

  const id = Number(ref);
  if (!Number.isInteger(id) || id <= 0) return new Response("Not found", { status: 404 });

  const cache = caches.default;
  const cacheKey = new Request(`${url.origin}/kedi/${id}`, { method: "GET" });
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  let cat: CatRow | null, total: number, strip: Awaited<ReturnType<typeof range>>;
  try {
    cat = await getById(env.DB, id);
    if (!cat || cat.status !== "live" || cat.pos === null) {
      return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=300" } });
    }
    [total, strip] = await Promise.all([liveCount(env.DB), range(env.DB, cat.pos - 6, cat.pos + 6)]);
  } catch (e) {
    if (!isD1Outage(e)) throw e;
    // D1 quota/outage: render a caption-less page from the R2 snapshot.
    const all = await readSnapshot(env);
    const pos = all.findIndex((it) => it[0] === id);
    if (pos < 0) return new Response("Not found", { status: 404, headers: { "cache-control": "public, max-age=60" } });
    cat = { id, key: all[pos][1], status: "live", pos, legacy_hash: null, source: "snapshot", original_name: null, size: null, width: null, height: null, confidence: null, detection: null, uploaded_at: 0, approved_at: null, caption: null, captioned_at: null };
    total = all.length;
    strip = all.slice(Math.max(0, pos - 6), pos + 6).map((it, i) => ({ id: it[0], key: it[1], pos: Math.max(0, pos - 6) + i, caption: null, approved_at: null }));
  }
  const prev = strip.find((s) => s.pos === cat.pos! - 1) ?? null;
  const next = strip.find((s) => s.pos === cat.pos! + 1) ?? null;

  const html = renderCatPage({ origin: url.origin, cdn: cdnBase(env, url.origin), cat, total, prev, next, strip });
  const res = new Response(html, {
    headers: { ...SECURITY_HEADERS, "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300, s-maxage=600" },
  });
  waitUntil(cache.put(cacheKey, res.clone()));
  return res;
};

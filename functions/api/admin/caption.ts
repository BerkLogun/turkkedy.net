import type { Env } from "../../../lib/env";
import { handle, intParam, json } from "../../../lib/http";
import { captionCat } from "../../../lib/classify";

/**
 * POST /api/admin/caption?limit=5 — write a Turkish caption for live cats that have none (oldest first).
 * Uses a Workers AI vision model, so run it in small batches to stay inside the free daily quota.
 * Response: { captioned, remaining, sample, errors }
 */
export const onRequestPost = handle<Env>(async ({ request, env }) => {
  const url = new URL(request.url);
  const limit = intParam(url, "limit", 5, 1, 20);
  // Optional shard "i/n": only rows with id % n == i, so several workers can run in parallel without overlap.
  const m = /^(\d+)\/(\d+)$/.exec(url.searchParams.get("shard") ?? "");
  const [shardI, shardN] = m && Number(m[2]) > 0 && Number(m[1]) < Number(m[2]) ? [Number(m[1]), Number(m[2])] : [0, 1];
  const { results } = await env.DB.prepare(
    "SELECT id,key FROM cats WHERE status='live' AND caption IS NULL AND (id % ?2) = ?3 ORDER BY pos LIMIT ?1",
  ).bind(limit, shardN, shardI).all<{ id: number; key: string }>();

  let captioned = 0, sample = "";
  const errors: string[] = [];
  for (const row of results) {
    try {
      const obj = await env.cats.get(row.key);
      if (!obj) { errors.push(`${row.id}: object missing`); continue; }
      const caption = await captionCat(env, await obj.arrayBuffer());
      if (!caption) { errors.push(`${row.id}: empty caption`); continue; }
      await env.DB.prepare("UPDATE cats SET caption=?2, captioned_at=?3 WHERE id=?1").bind(row.id, caption, Date.now()).run();
      captioned++;
      sample = caption;
    } catch (e) {
      errors.push(`${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      break; // quota or model errors: stop the batch instead of burning requests
    }
  }
  const remaining = await env.DB.prepare("SELECT COUNT(*) AS n FROM cats WHERE status='live' AND caption IS NULL").first<{ n: number }>();
  const remainingShard = shardN > 1
    ? (await env.DB.prepare("SELECT COUNT(*) AS n FROM cats WHERE status='live' AND caption IS NULL AND (id % ?1) = ?2").bind(shardN, shardI).first<{ n: number }>())?.n ?? 0
    : remaining?.n ?? 0;
  return json({ captioned, remaining: remaining?.n ?? 0, remainingShard, sample, errors });
});

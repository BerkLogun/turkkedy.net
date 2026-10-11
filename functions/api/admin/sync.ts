import type { Env } from "../../../lib/env";
import { handle, json } from "../../../lib/http";
import { batchAll, CatRow, insertStmt } from "../../../lib/cats";
import { isImageKey, legacyHash, PENDING_PREFIX } from "../../../lib/keys";

/**
 * POST /api/admin/sync — reconcile the D1 index with what is actually in the R2 bucket.
 * Repair tool, not part of the normal flow: uploads/approvals keep the index current on their own.
 *  - objects in R2 but not indexed → inserted (live for public-bucket root objects, pending for the private bucket or legacy pending/*)
 *  - rows whose object disappeared → removed
 *  - rows whose status disagrees with the object location → fixed
 *  - seed rows with uploaded_at=0 → given the real upload time
 *  - live positions re-packed to 0..N-1 in (uploaded_at, id) order
 */
export const onRequestPost = handle<Env>(async ({ env }) => {
  const inR2 = new Map<string, { pending: boolean; uploaded: number }>();
  let cursor: string | undefined;
  do {
    const list = await env.cats.list({ cursor, limit: 1000 });
    for (const o of list.objects) {
      const pending = o.key.startsWith(PENDING_PREFIX);
      const key = pending ? o.key.slice(PENDING_PREFIX.length) : o.key;
      if (key.includes("/") || !isImageKey(key)) continue;
      const prev = inR2.get(key);
      // a root object wins over a stray pending copy of the same key
      if (!prev || (prev.pending && !pending)) inR2.set(key, { pending, uploaded: o.uploaded.getTime() });
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);
  // Private bucket: everything there is pending.
  cursor = undefined;
  do {
    const list = await env.pending.list({ cursor, limit: 1000 });
    for (const o of list.objects) {
      if (o.key.includes("/") || !isImageKey(o.key)) continue;
      if (!inR2.has(o.key)) inR2.set(o.key, { pending: true, uploaded: o.uploaded.getTime() });
    }
    cursor = list.truncated ? list.cursor : undefined;
  } while (cursor);

  const { results: rows } = await env.DB.prepare(
    "SELECT id,key,status,pos,uploaded_at FROM cats ORDER BY id",
  ).all<Pick<CatRow, "id" | "key" | "status" | "pos" | "uploaded_at">>();
  const inDb = new Map(rows.map((r) => [r.key, r]));

  const stmts: D1PreparedStatement[] = [];
  const report = { inserted: 0, removed: 0, statusFixed: 0, datesFilled: 0, repacked: 0, live: 0, pending: 0 };

  // Rows without an object → remove.
  for (const r of rows) {
    if (!inR2.has(r.key)) {
      stmts.push(env.DB.prepare("DELETE FROM cats WHERE id = ?1").bind(r.id));
      report.removed++;
    }
  }
  // Objects without a row → insert, oldest first so positions follow upload order.
  const missing = [...inR2.entries()].filter(([k]) => !inDb.has(k)).sort((a, b) => a[1].uploaded - b[1].uploaded);
  for (const [key, o] of missing) {
    stmts.push(
      insertStmt(env.DB, {
        key,
        status: o.pending ? "pending" : "live",
        legacy_hash: await legacyHash(key),
        source: "sync",
        original_name: null,
        size: null,
        width: null,
        height: null,
        confidence: null,
        detection: null,
        uploaded_at: o.uploaded,
        approved_at: o.pending ? null : o.uploaded,
      }),
    );
    report.inserted++;
  }
  // Status / date fixes for existing rows.
  for (const r of rows) {
    const o = inR2.get(r.key);
    if (!o) continue;
    const shouldBe = o.pending ? "pending" : "live";
    if (r.status !== shouldBe) {
      stmts.push(
        env.DB.prepare("UPDATE cats SET status=?2, pos=NULL, approved_at=?3 WHERE id=?1").bind(r.id, shouldBe, shouldBe === "live" ? o.uploaded : null),
      );
      report.statusFixed++;
    }
    if (!r.uploaded_at) {
      stmts.push(env.DB.prepare("UPDATE cats SET uploaded_at=?2 WHERE id=?1").bind(r.id, o.uploaded));
      report.datesFilled++;
    }
  }
  await batchAll(env.DB, stmts);

  // Re-pack live positions densely in upload order.
  const { results: live } = await env.DB.prepare(
    "SELECT id,pos FROM cats WHERE status='live' ORDER BY uploaded_at, id",
  ).all<{ id: number; pos: number | null }>();
  const fixes: D1PreparedStatement[] = [];
  live.forEach((r, i) => {
    if (r.pos !== i) fixes.push(env.DB.prepare("UPDATE cats SET pos=?2 WHERE id=?1").bind(r.id, i));
  });
  // Two passes (negative then final) so the intermediate state never has duplicate positions.
  if (fixes.length) {
    await batchAll(env.DB, [env.DB.prepare("UPDATE cats SET pos = -pos - 1 WHERE pos IS NOT NULL"), ...fixes]);
    await env.DB.prepare("UPDATE cats SET pos = -pos - 1 WHERE pos < 0").run();
  }
  await env.DB.prepare("DELETE FROM upload_rate WHERE win < ?1").bind(Math.floor(Date.now() / (24 * 60 * 60 * 1000)) - 2).run().catch(() => {});
  report.repacked = fixes.length;
  report.live = live.length;
  report.pending = inR2.size - live.length;
  return json({ ok: true, ...report });
});

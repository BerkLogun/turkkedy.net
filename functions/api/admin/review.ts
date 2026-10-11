import type { Env } from "../../../lib/env";
import { error, handle, HttpError, json, readJson } from "../../../lib/http";
import { approveStmt, deleteStmts, getById } from "../../../lib/cats";
import { pendingKey } from "../../../lib/keys";
import { mimeForKey } from "../../../lib/image";
import { writeSnapshot } from "../../../lib/snapshot";

/** POST /api/admin/review { id, action: "approve" | "reject" } — moves a pending cat live, or deletes it. */
export const onRequestPost = handle<Env>(async ({ request, env, waitUntil }) => {
  const body = await readJson<{ id?: number; action?: string }>(request);
  const id = Number(body.id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Missing id");
  const row = await getById(env.DB, id);
  if (!row) return error(404, "Not found");
  if (row.status !== "pending") return error(409, "Not pending");

  if (body.action === "approve") {
    // New uploads sit in the private bucket; older ones may still be under pending/ in the public bucket.
    const obj = (await env.pending.get(row.key)) ?? (await env.cats.get(pendingKey(row.key)));
    if (!obj) {
      await env.DB.batch(deleteStmts(env.DB, row));
      return error(410, "Pending file is gone; row removed");
    }
    await env.cats.put(row.key, await obj.arrayBuffer(), {
      httpMetadata: { contentType: mimeForKey(row.key), cacheControl: "public, max-age=31536000, immutable" },
      customMetadata: obj.customMetadata,
    });
    await approveStmt(env.DB, id, Date.now()).run();
    await Promise.all([env.pending.delete(row.key), env.cats.delete(pendingKey(row.key))]);
    const updated = await getById(env.DB, id);
    waitUntil(writeSnapshot(env).catch(() => {}));
    return json({ ok: true, id, status: "live", pos: updated?.pos ?? null });
  }
  if (body.action === "reject") {
    await Promise.all([env.pending.delete(row.key), env.cats.delete(pendingKey(row.key))]);
    await env.DB.batch(deleteStmts(env.DB, row));
    return json({ ok: true, id, status: "deleted" });
  }
  throw new HttpError(400, "action must be approve or reject");
});

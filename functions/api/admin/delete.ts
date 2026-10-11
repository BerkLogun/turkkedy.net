import type { Env } from "../../../lib/env";
import { error, handle, HttpError, json, readJson } from "../../../lib/http";
import { deleteStmts, getById } from "../../../lib/cats";
import { pendingKey } from "../../../lib/keys";
import { writeSnapshot } from "../../../lib/snapshot";

/** POST /api/admin/delete { id } — permanently removes a cat (live or pending) from R2 and the index. */
export const onRequestPost = handle<Env>(async ({ request, env, waitUntil }) => {
  const body = await readJson<{ id?: number }>(request);
  const id = Number(body.id);
  if (!Number.isInteger(id)) throw new HttpError(400, "Missing id");
  const row = await getById(env.DB, id);
  if (!row) return error(404, "Not found");
  if (row.status === "pending") await Promise.all([env.pending.delete(row.key), env.cats.delete(pendingKey(row.key))]);
  else await env.cats.delete(row.key);
  await env.DB.batch(deleteStmts(env.DB, row));
  if (row.status === "live") waitUntil(writeSnapshot(env).catch(() => {}));
  return json({ ok: true, id });
});

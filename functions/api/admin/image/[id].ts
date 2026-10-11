import type { Env } from "../../../../lib/env";
import { getById } from "../../../../lib/cats";
import { pendingKey } from "../../../../lib/keys";
import { mimeForKey } from "../../../../lib/image";

/** GET /api/admin/image/:id — streams a pending (not yet public) image for the moderation UI. Bearer-protected by the admin middleware. */
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return new Response("Bad id", { status: 400 });
  const row = await getById(env.DB, id);
  if (!row) return new Response("Not found", { status: 404 });
  const obj = row.status === "pending"
    ? (await env.pending.get(row.key)) ?? (await env.cats.get(pendingKey(row.key)))
    : await env.cats.get(row.key);
  if (!obj) return new Response("Not found", { status: 404 });
  return new Response(obj.body, {
    headers: { "content-type": obj.httpMetadata?.contentType || mimeForKey(row.key), "cache-control": "private, no-store", "x-robots-tag": "noindex" },
  });
};

import type { Env } from "../../lib/env";
import { CatRow, getById, getByKey, getByLegacyHash } from "../../lib/cats";
import { b64urlDecode } from "../../lib/keys";

/**
 * GET /p/:ref — old share-link format. Resolves the cat and redirects permanently to /kedi/:id.
 * :ref is a numeric id, or a base64url of either the full object key or the legacy short hash.
 */
export const onRequestGet: PagesFunction<Env> = async ({ request, env, params }) => {
  const row = await resolve(env.DB, String(params.key ?? ""));
  if (!row || row.status !== "live") return new Response("Not found", { status: 404 });
  return new Response(null, {
    status: 301,
    headers: { location: `${new URL(request.url).origin}/kedi/${row.id}`, "cache-control": "public, max-age=86400" },
  });
};

async function resolve(db: D1Database, ref: string): Promise<CatRow | null> {
  if (/^\d+$/.test(ref)) return getById(db, Number(ref));
  let decoded: string;
  try {
    decoded = b64urlDecode(ref);
  } catch {
    return null;
  }
  if (!decoded) return null;
  if (decoded.includes(".")) return getByKey(db, decoded.replace(/^cats\//, ""));
  return getByLegacyHash(db, decoded);
}

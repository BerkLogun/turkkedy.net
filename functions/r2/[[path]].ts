import type { Env } from "../../lib/env";
import { isImageKey } from "../../lib/keys";

/**
 * GET /r2/<key> — streams an object straight from the bucket.
 * Only used when CDN_BASE is empty (local dev). Production serves images from the R2 custom domain.
 */
export const onRequestGet: PagesFunction<Env> = async ({ env, params }) => {
  const parts = Array.isArray(params.path) ? params.path : [params.path];
  const key = parts.map((p) => decodeURIComponent(String(p))).join("/");
  if (!isImageKey(key)) return new Response("Not found", { status: 404 });
  const obj = await env.cats.get(key);
  if (!obj) return new Response("Not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  if (!headers.has("cache-control")) headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
};

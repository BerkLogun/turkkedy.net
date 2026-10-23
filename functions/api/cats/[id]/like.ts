import type { Env } from "../../../../lib/env";
import { error, handle, json } from "../../../../lib/http";
import { toggleLike, deviceHashFromRequest, getLikeCount, hasLiked } from "../../../../lib/like";
import { getById } from "../../../../lib/cats";

/** POST /api/cats/:id/like → beğeniyi açar/kapar (toggle).
 * Yanıt: { cat_id, liked, count } (+ set-cookie cookie'si ilk seferde).
 */
export const onRequestPost = handle<Env>(async ({ request, env, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return error(400, "Bad id");

  const row = await getById(env.DB, id);
  if (!row) return error(404, "Not found");

  const { hash, setCookie } = deviceHashFromRequest(request);
  const result = await toggleLike(env.DB, id, hash);

  const headers: Record<string, string> = {};
  if (setCookie) headers["set-cookie"] = setCookie;

  return json({ cat_id: id, ...result }, { headers });
});

/** GET /api/cats/:id/like → mevcut beğeni durumu.
 * Yanıt: { cat_id, liked, count } (+ set-cookie cookie'si ilk seferde).
 */
export const onRequestGet = handle<Env>(async ({ request, env, params }) => {
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return error(400, "Bad id");

  const row = await getById(env.DB, id);
  if (!row) return error(404, "Not found");

  const { hash, setCookie } = deviceHashFromRequest(request);
  const [liked, count] = await Promise.all([hasLiked(env.DB, id, hash), getLikeCount(env.DB, id)]);

  const headers: Record<string, string> = {};
  if (setCookie) headers["set-cookie"] = setCookie;

  return json({ cat_id: id, liked, count }, { headers });
});

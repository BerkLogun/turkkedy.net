import type { Env } from "../../../../lib/env";
import { handle, json } from "../../../../lib/http";
import { getLikeStatuses, deviceHashFromRequest } from "../../../../lib/like";

/** GET /api/cats/like/batch?ids=1,2,3
 * Birden çok kedinin like durumunu ve toplam sayısını tek istekle döner.
 * Yanıt: { "1": { liked: true, count: 5 }, "2": { liked: false, count: 0 }, ... }
 */
export const onRequestGet = handle<Env>(async ({ request, env }) => {
  const url = new URL(request.url);
  const idsParam = url.searchParams.get("ids");
  if (!idsParam) return json({});

  const ids = idsParam
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) return json({});

  const { hash, setCookie } = deviceHashFromRequest(request);
  const statuses = await getLikeStatuses(env.DB, ids, hash);

  const headers: Record<string, string> = {};
  if (setCookie) headers["set-cookie"] = setCookie;

  const out: Record<string, LikeStatusOut> = {};
  for (const [id, st] of statuses) out[String(id)] = st;

  return json(out, { headers });
});

interface LikeStatusOut {
  liked: boolean;
  count: number;
}

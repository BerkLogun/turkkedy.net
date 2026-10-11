import type { Env } from "../../../lib/env";
import { cdnBase } from "../../../lib/env";
import { handle, intParam, json } from "../../../lib/http";
import { listByStatus, liveCount } from "../../../lib/cats";


/** GET /api/admin/images?status=pending|live&page=0&size=50 */
export const onRequestGet = handle<Env>(async ({ request, env }) => {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") === "live" ? "live" : "pending";
  const page = intParam(url, "page", 0, 0, 100_000);
  const size = intParam(url, "size", 48, 1, 100);
  const cdn = cdnBase(env, url.origin);
  const [{ items, total }, live, pending] = await Promise.all([
    listByStatus(env.DB, status, page, size),
    liveCount(env.DB),
    env.DB.prepare("SELECT COUNT(*) AS n FROM cats WHERE status='pending'").first<{ n: number }>().then((r) => r?.n ?? 0),
  ]);
  return json({
    status,
    page,
    size,
    total,
    stats: { live, pending },
    items: items.map((r) => ({
      ...r,
      detection: r.detection ? safeParse(r.detection) : null,
      // pending images are not public: the admin UI fetches them with the bearer token
      url: r.status === "live" ? `${cdn}/${r.key}` : `/api/admin/image/${r.id}`,
    })),
  });
});

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

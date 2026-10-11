import type { Env } from "./env";

/**
 * Static copy of the live cat list, stored in R2 as index.json ([[id, key], ...] in position order).
 * The public read paths fall back to it when D1 is unavailable (for example the free tier's daily read
 * limit), so the viewer and cat pages keep working. Rewritten after every change to the live set.
 */
export const SNAPSHOT_KEY = "index.json";
export type SnapshotItem = [number, string];

let memo: { at: number; items: SnapshotItem[] } | null = null;

export async function writeSnapshot(env: Env): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id,key FROM cats WHERE pos IS NOT NULL ORDER BY pos").all<{ id: number; key: string }>();
  const items: SnapshotItem[] = results.map((r) => [r.id, r.key]);
  await env.cats.put(SNAPSHOT_KEY, JSON.stringify(items), {
    httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "no-cache" },
  });
  memo = { at: Date.now(), items };
  return items.length;
}

export async function readSnapshot(env: Env): Promise<SnapshotItem[]> {
  if (memo && Date.now() - memo.at < 60_000) return memo.items;
  const obj = await env.cats.get(SNAPSHOT_KEY);
  if (!obj) return [];
  const items = (await obj.json()) as SnapshotItem[];
  memo = { at: Date.now(), items };
  return items;
}

/** True for errors worth falling back on (quota, outage), as opposed to bugs in our SQL. */
export function isD1Outage(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /D1_ERROR|exceeded|limit|unavailable|timeout|internal error|too many/i.test(msg);
}

import { HttpError } from "./http";

/**
 * Fixed-window counters in D1 (two cheap writes per upload attempt). Good enough to stop a script from
 * burning the daily Workers AI / Images quotas; not meant to be precise under heavy concurrency.
 */
export const IP_LIMIT = 6;                      // attempts per IP per window
export const IP_WINDOW_MS = 10 * 60 * 1000;     // 10 minutes
export const GLOBAL_LIMIT = 200;                // attempts per day, all users
export const GLOBAL_WINDOW_MS = 24 * 60 * 60 * 1000;

async function bump(db: D1Database, key: string, windowMs: number): Promise<number> {
  const win = Math.floor(Date.now() / windowMs);
  const row = await db
    .prepare(
      `INSERT INTO upload_rate (k, win, n) VALUES (?1, ?2, 1)
       ON CONFLICT(k) DO UPDATE SET n = CASE WHEN win = ?2 THEN n + 1 ELSE 1 END, win = ?2
       RETURNING n`,
    )
    .bind(key, win)
    .first<{ n: number }>();
  return row?.n ?? 1;
}

/** Irreversible, salted digest of the client IP so no raw addresses are stored. */
export async function ipKey(ip: string | null): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`turkkedy-rate:${ip ?? "unknown"}`));
  return "ip:" + Array.from(new Uint8Array(buf).slice(0, 12)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Throws 429 when the caller or the whole site is over its upload budget. */
export async function enforceUploadLimit(db: D1Database, ip: string | null): Promise<void> {
  const perIp = await bump(db, await ipKey(ip), IP_WINDOW_MS);
  if (perIp > IP_LIMIT) throw new HttpError(429, "Çok hızlı gidiyorsun; birkaç dakika sonra tekrar dene");
  const global = await bump(db, "global", GLOBAL_WINDOW_MS);
  if (global > GLOBAL_LIMIT) throw new HttpError(429, "Bugünlük yükleme kotası doldu; yarın tekrar dene");
  if (global === 1) await db.prepare("DELETE FROM upload_rate WHERE k != 'global' AND win < ?1").bind(Math.floor(Date.now() / IP_WINDOW_MS) - 2).run();
}

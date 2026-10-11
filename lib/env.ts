export interface Env {
  DB: D1Database;
  cats: R2Bucket;      // public bucket
  pending: R2Bucket;   // private bucket for uploads awaiting moderation
  AI: Ai;
  ADMIN_TOKEN?: string;
  CDN_BASE?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_SECRET?: string;
}

/** Base URL that serves bucket objects publicly. Empty CDN_BASE falls back to the /r2 passthrough route. */
export function cdnBase(env: Env, origin: string): string {
  const base = (env.CDN_BASE || "").replace(/\/+$/, "");
  return base || `${origin}/r2`;
}

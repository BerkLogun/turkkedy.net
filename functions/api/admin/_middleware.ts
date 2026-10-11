import type { Env } from "../../../lib/env";
import { error } from "../../../lib/http";

/** Every /api/admin/* route requires `Authorization: Bearer <ADMIN_TOKEN>`. */
export const onRequest: PagesFunction<Env> = async ({ request, env, next }) => {
  const expected = env.ADMIN_TOKEN;
  if (!expected) return error(503, "ADMIN_TOKEN secret is not configured");
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || !safeEqual(token, expected)) return error(401, "Unauthorized");
  return next();
};

function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a), y = enc.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  return crypto.subtle.timingSafeEqual(x, y);
}

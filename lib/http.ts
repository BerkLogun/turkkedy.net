export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function json(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function error(status: number, message: string, extra: Record<string, unknown> = {}): Response {
  return json({ error: message, ...extra }, { status });
}

/** Wrap a handler so thrown HttpErrors become JSON responses and anything else a 500. */
export function handle<E>(fn: PagesFunction<E>): PagesFunction<E> {
  return async (ctx) => {
    try {
      return await fn(ctx);
    } catch (e) {
      if (e instanceof HttpError) return error(e.status, e.message);
      console.error(e);
      return error(500, e instanceof Error ? e.message : "Internal error");
    }
  };
}

/** Headers for HTML rendered by functions (static files get the same ones from public/_headers). */
export const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "SAMEORIGIN",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "content-security-policy":
    "default-src 'self'; script-src 'self' https://challenges.cloudflare.com https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; " +
    "img-src 'self' https://medias.turkkedy.net blob: data:; connect-src 'self' https://medias.turkkedy.net https://cloudflareinsights.com; " +
    "frame-src https://challenges.cloudflare.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'",
};

/** Verify a Cloudflare Turnstile token. Passes when no secret is configured (feature off). */
export async function verifyTurnstile(secret: string | undefined, token: string | null, ip: string | null): Promise<boolean> {
  if (!secret) return true;
  if (!token) return false;
  try {
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret, response: token, remoteip: ip ?? undefined }),
    });
    const d = (await r.json()) as { success?: boolean };
    return !!d.success;
  } catch {
    return false;
  }
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, "Body must be JSON");
  }
}

export function intParam(url: URL, name: string, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const raw = url.searchParams.get(name);
  const n = raw === null ? fallback : parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

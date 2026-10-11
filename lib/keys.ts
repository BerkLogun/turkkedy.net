const IMAGE_EXT = /\.(webp|jpe?g|png|gif|avif)$/i;

export function isImageKey(key: string): boolean {
  return IMAGE_EXT.test(key) && !key.includes("..");
}

export const PENDING_PREFIX = "pending/";

export function pendingKey(key: string): string {
  return PENDING_PREFIX + key;
}

/** Where the object for a row currently lives in the bucket. */
export function objectKey(row: { key: string; status: string }): string {
  return row.status === "live" ? row.key : pendingKey(row.key);
}

/** Short hash the previous site used in share links (first 6 SHA-256 bytes, each base36). Kept for old links. */
export async function legacyHash(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return Array.from(new Uint8Array(buf))
    .slice(0, 6)
    .map((b) => b.toString(36))
    .join("");
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function b64urlDecode(s: string): string {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  if (pad) s += "=".repeat(4 - pad);
  const bytes = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

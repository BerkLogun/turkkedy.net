import type { Env } from "../../lib/env";
import { cdnBase } from "../../lib/env";
import { error, handle, HttpError, json, verifyTurnstile } from "../../lib/http";
import { getByKey, insertStmt, liveCount } from "../../lib/cats";
import { legacyHash, sha256Hex } from "../../lib/keys";
import { extensionFor, ImageInfo, mimeFor, sniffImage } from "../../lib/image";
import { AUTO_LIVE_CONFIDENCE, classifyCat, MIN_PENDING_CONFIDENCE } from "../../lib/classify";
import { enforceUploadLimit } from "../../lib/ratelimit";

const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // pre-conversion; stored WebP is far smaller
const FALLBACK_MAX_BYTES = 5 * 1024 * 1024; // when conversion is unavailable and we store the browser output as-is
const MAX_THUMB_BYTES = 300 * 1024;
const MAX_DIM = 1600;

/**
 * Resize to ≤MAX_DIM and re-encode as WebP using Cloudflare Image Transformations on the zone
 * (https://developers.cloudflare.com/images/transform-images/transform-via-url/). The original is parked
 * under tmp/ in the bucket so the resizer can fetch it through the public CDN host, then removed.
 * Needs "Transformations" enabled for the zone in the dashboard; returns null when that is off or CDN_BASE is empty.
 */
async function toWebp(env: Env, input: ArrayBuffer, info: ImageInfo): Promise<{ imageBuf: ArrayBuffer; dims: ImageInfo } | null> {
  const cdn = (env.CDN_BASE || "").replace(/\/+$/, "");
  if (!cdn) return null;
  const tmpKey = `tmp/${crypto.randomUUID()}${extensionFor(info.format)}`;
  await env.cats.put(tmpKey, input, { httpMetadata: { contentType: mimeFor(info.format), cacheControl: "no-store" } });
  try {
    const url = `${cdn}/cdn-cgi/image/format=webp,quality=82,width=${MAX_DIM},height=${MAX_DIM},fit=scale-down,metadata=none/${tmpKey}`;
    const res = await fetch(url, { headers: { accept: "image/webp" } });
    if (!res.ok) {
      console.warn("image transform failed", res.status, await res.text().catch(() => ""));
      return null;
    }
    const out = await res.arrayBuffer();
    const dims = sniffImage(new Uint8Array(out));
    if (!dims || dims.format !== "webp") {
      console.warn("image transform returned", res.headers.get("content-type"), "cf-resized:", res.headers.get("cf-resized"));
      return null;
    }
    return { imageBuf: out, dims };
  } finally {
    await env.cats.delete(tmpKey).catch(() => {});
  }
}

/**
 * POST /api/upload  (multipart: image=<webp/jpeg/png>, thumb=<small jpeg for classification>, name=<original filename>)
 * The browser resizes and watermarks; anything that is not already a ≤1600px WebP is converted here with the
 * Cloudflare Images binding (runs on Cloudflare's image service, not in this worker's CPU budget).
 * Result: { status: "live" | "pending" | "rejected" | "duplicate", id?, key?, pos?, confidence, labels }
 */
export const onRequestPost = handle<Env>(async ({ request, env }) => {
  await enforceUploadLimit(env.DB, request.headers.get("cf-connecting-ip"));
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new HttpError(400, "Expected multipart form data");
  }
  const image = form.get("image");
  const thumb = form.get("thumb");
  const name = String(form.get("name") ?? "").slice(0, 200) || null;
  const human = await verifyTurnstile(env.TURNSTILE_SECRET, String(form.get("turnstile") ?? "") || null, request.headers.get("cf-connecting-ip"));
  if (!human) throw new HttpError(403, "Doğrulama başarısız; sayfayı yenileyip tekrar dene");
  if (!(image instanceof File)) throw new HttpError(400, "Fotoğraf eksik");
  if (!(thumb instanceof File)) throw new HttpError(400, "Önizleme eksik");
  if (image.size > MAX_IMAGE_BYTES) throw new HttpError(413, "Fotoğraf çok büyük (en fazla 12 MB)");
  if (thumb.size > MAX_THUMB_BYTES) throw new HttpError(413, "Önizleme çok büyük");

  let imageBuf = await image.arrayBuffer();
  let dims = sniffImage(new Uint8Array(imageBuf));
  if (!dims) throw new HttpError(415, "Fotoğraf JPEG, PNG ya da WebP olmalı");
  let converted = false;
  if (dims.format !== "webp" || dims.width > MAX_DIM || dims.height > MAX_DIM) {
    const r = await toWebp(env, imageBuf, dims);
    if (r) ({ imageBuf, dims } = r), (converted = true);
    else if (dims.width > MAX_DIM || dims.height > MAX_DIM) throw new HttpError(422, `Fotoğraf en fazla ${MAX_DIM}px olabilir`);
    else if (imageBuf.byteLength > FALLBACK_MAX_BYTES) throw new HttpError(413, "Fotoğraf çok büyük; JPEG olarak dene");
  }

  const key = `${await sha256Hex(imageBuf)}${extensionFor(dims.format)}`;
  const existing = await getByKey(env.DB, key);
  if (existing) {
    return json({ status: "duplicate", id: existing.id, key, pos: existing.pos, confidence: existing.confidence });
  }

  const verdict = await classifyCat(env, await thumb.arrayBuffer());
  if (verdict.confidence < MIN_PENDING_CONFIDENCE) {
    return json({ status: "rejected", converted, confidence: verdict.confidence, labels: verdict.labels });
  }

  const status = verdict.confidence >= AUTO_LIVE_CONFIDENCE ? "live" : "pending";
  const now = Date.now();
  // Live images go to the public bucket; pending ones to the private bucket until an admin approves them.
  await (status === "live" ? env.cats : env.pending).put(key, imageBuf, {
    httpMetadata: { contentType: mimeFor(dims.format), cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { source: "upload", originalName: name ?? "", confidence: verdict.confidence.toFixed(3) },
  });

  await insertStmt(env.DB, {
    key,
    status,
    legacy_hash: await legacyHash(key),
    source: "upload",
    original_name: name,
    size: imageBuf.byteLength,
    width: dims.width,
    height: dims.height,
    confidence: verdict.confidence,
    detection: JSON.stringify(verdict),
    uploaded_at: now,
    approved_at: status === "live" ? now : null,
  }).run();
  const row = await getByKey(env.DB, key);
  if (!row) return error(500, "Insert failed");

  return json({
    status,
    converted,
    id: row.id,
    key: status === "live" ? key : undefined,
    pos: row.pos,
    total: status === "live" ? await liveCount(env.DB) : undefined,
    url: status === "live" ? `${cdnBase(env, new URL(request.url).origin)}/${key}` : undefined,
    confidence: verdict.confidence,
    labels: verdict.labels,
  });
});

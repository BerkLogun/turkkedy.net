/** Beğeni sistemi. Kimlik için cookie üzerinden device hash kullanılır (anonim, hesapsız). */

export interface LikeResult {
  liked: boolean;      // şu an beğeniliyor mu (toggle sonrası)
  count: number;       // toplam beğeni sayısı
}

/** Cookie adında saklanan anonim cihaz kimliği. */
export const DEVICE_COOKIE = "tk_device";

/** İstekten device hash'i çıkarır; yoksa rastgele üretir ve set-cookie dönmek için null döner. */
export function deviceHashFromRequest(request: Request): { hash: string; setCookie?: string } {
  const cookie = request.headers.get("cookie") ?? "";
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${DEVICE_COOKIE}=([^;]+)`));
  if (match) {
    return { hash: match[1] };
  }
  const hash = crypto.randomUUID();
  return { hash, setCookie: `${DEVICE_COOKIE}=${hash}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` };
}

/** Cihaz bir kediyi daha önce beğenmiş mi? */
export async function hasLiked(db: D1Database, catId: number, deviceHash: string): Promise<boolean> {
  const r = await db
    .prepare("SELECT 1 FROM likes WHERE cat_id = ?1 AND device_hash = ?2 LIMIT 1")
    .bind(catId, deviceHash)
    .first<{ id: number }>();
  return !!r;
}

/** Toplam beğeni sayısı. */
export async function getLikeCount(db: D1Database, catId: number): Promise<number> {
  const r = await db
    .prepare("SELECT COUNT(*) AS n FROM likes WHERE cat_id = ?1")
    .bind(catId)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

/** Beğeniyi açar/kapar (toggle). */
export async function toggleLike(db: D1Database, catId: number, deviceHash: string): Promise<LikeResult> {
  const already = await hasLiked(db, catId, deviceHash);
  const now = Date.now();

  if (already) {
    await db
      .prepare("DELETE FROM likes WHERE cat_id = ?1 AND device_hash = ?2")
      .bind(catId, deviceHash)
      .run();
  } else {
    await db
      .prepare(
        "INSERT INTO likes (cat_id, device_hash, created_at) VALUES (?1, ?2, ?3)",
      )
      .bind(catId, deviceHash, now)
      .run();
  }

  const liked = !already;
  const count = await getLikeCount(db, catId);
  return { liked, count };
}

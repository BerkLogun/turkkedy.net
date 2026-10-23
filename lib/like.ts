/** Beğeni sistemi. Kimlik için cookie üzerinden device hash kullanılır (anonim, hesapsız). */

export interface LikeResult {
  liked: boolean;      // şu an beğeniliyor mu (toggle sonrası)
  count: number;       // toplam beğeni sayısı
}

export interface LikeStatus {
  liked: boolean;
  count: number;
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

/** Birden çok kedi için like durumu ve toplam sayıyı tek sorguda çeker.
 * D1 okuma kotasını korumak için sayfa başına tek istek yeterlidir.
 */
export async function getLikeStatuses(
  db: D1Database,
  catIds: number[],
  deviceHash: string,
): Promise<Map<number, LikeStatus>> {
  const result = new Map<number, LikeStatus>();
  if (catIds.length === 0) return result;

  // Her ID için ayrı binding (D1 prepared statement sınırı içinde olur, sayfa = 100)
  const placeholders = catIds.map((_, i) => `?${i + 1}`).join(",");
  const deviceParam = `?${catIds.length + 1}`;

  // Toplam beğeni sayıları
  const countSql = `SELECT cat_id, COUNT(*) AS cnt FROM likes WHERE cat_id IN (${placeholders}) GROUP BY cat_id`;
  const countRows = await db
    .prepare(countSql)
    .bind(...catIds)
    .all<{ cat_id: number; cnt: number }>();
  const counts = new Map<number, number>();
  for (const r of countRows.results ?? []) counts.set(r.cat_id, r.cnt);

  // Bu cihazın zaten beğendiği kediler
  const mySql = `SELECT cat_id FROM likes WHERE cat_id IN (${placeholders}) AND device_hash = ${deviceParam}`;
  const myRows = await db
    .prepare(mySql)
    .bind(...catIds, deviceHash)
    .all<{ cat_id: number }>();
  const myLiked = new Set<number>();
  for (const r of myRows.results ?? []) myLiked.add(r.cat_id);

  for (const id of catIds) {
    result.set(id, { liked: myLiked.has(id), count: counts.get(id) ?? 0 });
  }
  return result;
}

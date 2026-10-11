export const PAGE_SIZE = 100;

export interface CatRow {
  id: number;
  key: string;
  status: "live" | "pending";
  pos: number | null;
  legacy_hash: string | null;
  source: string;
  original_name: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  confidence: number | null;
  detection: string | null;
  uploaded_at: number;
  approved_at: number | null;
  caption: string | null;
  captioned_at: number | null;
}

export type NewCat = Omit<CatRow, "id" | "pos" | "approved_at" | "caption" | "captioned_at"> & { approved_at?: number | null };

const COLS =
  "id,key,status,pos,legacy_hash,source,original_name,size,width,height,confidence,detection,uploaded_at,approved_at,caption,captioned_at";

/** Number of live cats. O(1) thanks to the dense pos column + index. */
export async function liveCount(db: D1Database): Promise<number> {
  const r = await db.prepare("SELECT COALESCE(MAX(pos)+1,0) AS n FROM cats").first<{ n: number }>();
  return r?.n ?? 0;
}

export async function livePage(db: D1Database, page: number): Promise<[number, string][]> {
  const from = page * PAGE_SIZE;
  const { results } = await db
    .prepare("SELECT id,key FROM cats WHERE pos >= ?1 AND pos < ?2 ORDER BY pos")
    .bind(from, from + PAGE_SIZE)
    .all<{ id: number; key: string }>();
  return results.map((r) => [r.id, r.key]);
}

export function getById(db: D1Database, id: number) {
  return db.prepare(`SELECT ${COLS} FROM cats WHERE id = ?1`).bind(id).first<CatRow>();
}
export function getByKey(db: D1Database, key: string) {
  return db.prepare(`SELECT ${COLS} FROM cats WHERE key = ?1`).bind(key).first<CatRow>();
}
export function getByPos(db: D1Database, pos: number) {
  return db.prepare(`SELECT ${COLS} FROM cats WHERE pos = ?1`).bind(pos).first<CatRow>();
}
/** Live cats with positions in [from, to) — used for prev/next links and sitemaps. */
export async function range(db: D1Database, from: number, to: number) {
  const { results } = await db
    .prepare("SELECT id,key,pos,caption,approved_at FROM cats WHERE pos >= ?1 AND pos < ?2 ORDER BY pos")
    .bind(Math.max(0, from), to)
    .all<{ id: number; key: string; pos: number; caption: string | null; approved_at: number | null }>();
  return results;
}
export function getByLegacyHash(db: D1Database, hash: string) {
  return db.prepare(`SELECT ${COLS} FROM cats WHERE legacy_hash = ?1 ORDER BY id LIMIT 1`).bind(hash).first<CatRow>();
}

/** Prepared INSERT. Live rows get the next dense position atomically. */
export function insertStmt(db: D1Database, c: NewCat): D1PreparedStatement {
  const live = c.status === "live";
  return db
    .prepare(
      `INSERT INTO cats (key,status,pos,legacy_hash,source,original_name,size,width,height,confidence,detection,uploaded_at,approved_at)
       VALUES (?1,?2,${live ? "(SELECT COALESCE(MAX(pos)+1,0) FROM cats)" : "NULL"},?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)`,
    )
    .bind(
      c.key, c.status, c.legacy_hash, c.source, c.original_name, c.size, c.width, c.height,
      c.confidence, c.detection, c.uploaded_at, live ? (c.approved_at ?? c.uploaded_at) : null,
    );
}

export function approveStmt(db: D1Database, id: number, now: number): D1PreparedStatement {
  return db
    .prepare(
      "UPDATE cats SET status='live', pos=(SELECT COALESCE(MAX(pos)+1,0) FROM cats), approved_at=?2 WHERE id=?1 AND status='pending'",
    )
    .bind(id, now);
}

/** Delete a row and close the gap in the live ordering. */
export function deleteStmts(db: D1Database, row: CatRow): D1PreparedStatement[] {
  const stmts = [db.prepare("DELETE FROM cats WHERE id = ?1").bind(row.id)];
  if (row.pos !== null) stmts.push(db.prepare("UPDATE cats SET pos = pos - 1 WHERE pos > ?1").bind(row.pos));
  return stmts;
}

export async function listByStatus(
  db: D1Database,
  status: "live" | "pending",
  page: number,
  size: number,
): Promise<{ items: CatRow[]; total: number }> {
  const [{ results }, count] = await Promise.all([
    db
      .prepare(`SELECT ${COLS} FROM cats WHERE status = ?1 ORDER BY id DESC LIMIT ?2 OFFSET ?3`)
      .bind(status, size, page * size)
      .all<CatRow>(),
    status === "live"
      ? liveCount(db)
      : db.prepare("SELECT COUNT(*) AS n FROM cats WHERE status='pending'").first<{ n: number }>().then((r) => r?.n ?? 0),
  ]);
  return { items: results, total: count };
}

/** Run many statements in transactional chunks (D1 batches are atomic). */
export async function batchAll(db: D1Database, stmts: D1PreparedStatement[], chunk = 100): Promise<void> {
  for (let i = 0; i < stmts.length; i += chunk) {
    await db.batch(stmts.slice(i, i + chunk));
  }
}

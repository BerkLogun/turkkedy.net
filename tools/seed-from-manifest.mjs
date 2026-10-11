#!/usr/bin/env node
// One-time seed: turn the old manifest.json (ordered list of R2 keys) into SQL for the D1 `cats` table.
// Usage: node tools/seed-from-manifest.mjs manifest.json > .seed.sql
//        npx wrangler d1 execute turkkedy --remote --file .seed.sql
// Positions follow manifest order. uploaded_at is left at 0; POST /api/admin/sync fills in real dates.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

const file = process.argv[2];
if (!file) {
  console.error("usage: seed-from-manifest.mjs <manifest.json>");
  process.exit(1);
}
const keys = JSON.parse(readFileSync(file, "utf8"));
if (!Array.isArray(keys)) throw new Error("manifest must be a JSON array of keys");

const legacyHash = (key) =>
  [...createHash("sha256").update(key).digest().subarray(0, 6)].map((b) => b.toString(36)).join("");
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

const CHUNK = 500;
for (let i = 0; i < keys.length; i += CHUNK) {
  const rows = keys
    .slice(i, i + CHUNK)
    .map((key, j) => `(${q(key)},'live',${i + j},${q(legacyHash(key))},'seed',0,0)`)
    .join(",\n");
  console.log(`INSERT OR IGNORE INTO cats (key,status,pos,legacy_hash,source,uploaded_at,approved_at) VALUES\n${rows};`);
}
console.error(`${keys.length} rows`);

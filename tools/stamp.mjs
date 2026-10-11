#!/usr/bin/env node
// Cache-busting: rewrite references to /styles.css, /app.js, /upload.js and /admin/admin.js
// as /<file>?v=<content hash>. Runs automatically before `npm run deploy` (predeploy hook).
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const hashOf = (f) => createHash("sha256").update(readFileSync(`public/${f}`)).digest("hex").slice(0, 8);
const RE = /\/(styles\.css|app\.js|upload\.js|admin\/admin\.js)(\?v=[0-9a-f]+)?(?=["'\s)>])/g;

function stamp(file, versions) {
  const before = readFileSync(file, "utf8");
  const after = before.replace(RE, (_, name) => `/${name}?v=${versions[name]}`);
  if (after !== before) writeFileSync(file, after);
  return after !== before;
}

// upload.js is referenced from app.js, so stamp app.js first and hash it afterwards.
const v = { "upload.js": hashOf("upload.js") };
stamp("public/app.js", v);
Object.assign(v, { "app.js": hashOf("app.js"), "styles.css": hashOf("styles.css"), "admin/admin.js": hashOf("admin/admin.js") });
const changed = ["public/index.html", "public/admin/index.html", "lib/seo.ts"].filter((f) => stamp(f, v));
console.log(`stamped ${JSON.stringify(v)}${changed.length ? ` → ${changed.join(", ")}` : " (no changes)"}`);

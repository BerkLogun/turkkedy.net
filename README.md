# turkkedy.net

Endless cats. A single-page viewer on Cloudflare Pages, images in R2, index in D1, cat detection by Workers AI. Runs entirely on Cloudflare's free tiers.

## How it works

```
public/            static site (viewer, upload dialog, admin panel)
functions/         Pages Functions (the API)
  api/cats         GET  /api/cats?page=N      100 live cats per page, edge-cached 2 min
  api/cats/[id]    GET  /api/cats/:id         one cat (used by share links)
  api/upload       POST /api/upload           validate → classify (Workers AI) → R2 → D1
  api/admin/*      Bearer-token protected: images, review, delete, sync
  p/[key]          GET  /p/:id                share page with Open Graph tags (old link formats still resolve)
  r2/[[path]]      GET  /r2/:key              bucket passthrough, only used in local dev
lib/               code shared by the functions
migrations/        D1 schema
tools/             bulk tooling (optimize.py, upload_cats.py, seed-from-manifest.mjs)
```

**Data flow.** The D1 table `cats` is the index: one row per object, with a dense `pos` column (0..N-1) for live cats. The viewer asks for `page = floor(pos / 100)` and reads only that page. Uploads and approvals insert/update rows directly, so nothing needs to be rebuilt. `POST /api/admin/sync` reconciles D1 with the bucket if they ever drift.

**Uploads.** The browser resizes to ≤1600px, stamps the watermark, encodes WebP (JPEG on Safari, which cannot encode WebP) and also sends a 320px JPEG thumbnail. The function sniffs the header; anything that is not already a ≤1600px WebP is converted server-side through Cloudflare Image Transformations (`/cdn-cgi/image/...` on the CDN host, free up to 5,000 unique transformations a month). It then hashes the bytes (the hash is the object key, so duplicates are free), classifies the thumbnail with `@cf/microsoft/resnet-50`, and stores it as live (confidence ≥ 0.5), pending (≥ 0.08) or rejects it. Thresholds live in `lib/classify.ts`.

Server-side conversion requires **Images → Transformations → enabled for the turkkedy.net zone** in the dashboard. While it is off, uploads are stored in whatever format the browser produced (the response carries `converted: false`).

## Development

```bash
npm install
npm run db:migrate:local          # create the local D1 schema
npm run dev                       # http://localhost:8788 (uses .dev.vars: ADMIN_TOKEN=local-dev-token, images via /r2)
npm run typecheck
```

Locally the bucket is empty, so upload a few cats through the UI to have something to look at. The admin panel is at `/admin/`.

## Deploy

```bash
npm run db:migrate                # apply migrations to the production D1
npm run deploy:preview            # https://revamp.cats-daa.pages.dev
npm run deploy                    # production → turkkedy.net
```

Both deploy scripts first run `npm run stamp`, which rewrites asset references as `/app.js?v=<hash>` so browsers pick up new CSS/JS immediately (assets are cached for a year). If you deploy with `wrangler pages deploy` directly, run `npm run stamp` first.

Bindings (R2 `cats`, D1 `turkkedy`, Workers AI) come from `wrangler.toml`. The only secret is set once:

```bash
npx wrangler pages secret put ADMIN_TOKEN --project-name cats
```

### One-time migration from the old manifest

```bash
curl -s https://turkkedy.net/api/manifest > manifest.json   # from the old deployment
npm run db:seed                                             # positions follow manifest order
```

Then open `/admin/` and press **Eşitle** once to pull real upload dates and any pending objects from the bucket.

## SEO

Every live cat has its own server-rendered page at `/kedi/<id>` (unique title, description, Open Graph/Twitter tags, JSON-LD `ImageObject`, prev/next links and a strip of neighbours). `/sitemap.xml` is a sitemap index over `/sitemaps/cats-N.xml` chunks of 1000 URLs with image extensions. Old `/p/...` share links 301 to the new pages. Submit `https://turkkedy.net/sitemap.xml` in Google Search Console once.

Pages read much better with a caption, so the admin panel has **Açıklama üret**: it writes a one-line Turkish description for cats that have none, five at a time, using Workers AI (LLaVA describes, Llama 3.1 translates; thresholds and prompts in `lib/classify.ts`). The free Workers AI quota is daily, so expect to run it over a few days for the whole archive. Llama 3.2 Vision would do it in one call with better Turkish, but Cloudflare requires accepting Meta's license on the account first; flip `USE_LLAMA_VISION` after doing that in the dashboard playground.

### Image caching

Objects uploaded through the site carry `cache-control: public, max-age=31536000, immutable`. For everything uploaded earlier, add a Cache Rule in the Cloudflare dashboard for the zone: *hostname equals `medias.turkkedy.net` → Eligible for cache, Edge TTL 1 month, Browser TTL 1 year*. Without it every image view goes to R2.

## Security notes

- Admin routes need `Authorization: Bearer <ADMIN_TOKEN>` (constant-time compare, no query-string tokens). Use a long random token.
- Uploads awaiting moderation live in the private bucket `cats-pending`; only approved images reach the public bucket. The admin panel previews them through `/api/admin/image/:id` with the token.
- Every HTML response carries CSP, HSTS, nosniff, frame and referrer headers (`public/_headers` for static files, `SECURITY_HEADERS` for functions). `404.html` keeps unknown paths from returning the homepage.
- Upload validation is server-side: size caps, header sniffing, server-side re-encoding, duplicate hashing, AI classification. Rejected files are never stored.
- Upload rate limiting is built in (`lib/ratelimit.ts`, D1 table `upload_rate`): 6 attempts per hashed IP per 10 minutes and 200 per day site-wide, so a script cannot burn the daily Workers AI / Images quotas. Limits are constants at the top of that file.
- **Turnstile** (free): create a widget for turkkedy.net, put the site key in `wrangler.toml` as `TURNSTILE_SITE_KEY`, and set the secret with `npx wrangler pages secret put TURNSTILE_SECRET --project-name cats`. The upload dialog then shows the check and the server verifies it. With no secret set, the check is skipped.

## Bulk upload from a folder

```bash
pip install pillow
python3 tools/optimize.py input output --wm-text turkkedy.net --wm-shadow
python3 tools/upload_cats.py --source-dir output --progress
```

then **Eşitle** in the admin panel to index them.

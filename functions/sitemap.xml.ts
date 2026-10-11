import type { Env } from "../lib/env";
import { liveCount } from "../lib/cats";
import { SITEMAP_CHUNK } from "../lib/sitemap";

/** GET /sitemap.xml — index pointing at /sitemaps/cats-N.xml chunks. */
export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const origin = new URL(request.url).origin;
  const total = await liveCount(env.DB);
  const chunks = Math.max(1, Math.ceil(total / SITEMAP_CHUNK));
  const now = new Date().toISOString();
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${origin}/sitemaps/static.xml</loc><lastmod>${now}</lastmod></sitemap>
${Array.from({ length: chunks }, (_, i) => `  <sitemap><loc>${origin}/sitemaps/cats-${i}.xml</loc><lastmod>${now}</lastmod></sitemap>`).join("\n")}
</sitemapindex>`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
};

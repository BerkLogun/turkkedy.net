import type { CatRow } from "./cats";
import { mimeForKey } from "./image";

export const SITE_NAME = "turkkedy.net";
export const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export const CREDITS = [
  "sevgiyle yapıldı",
  "bir kedinin gözetiminde kodlandı",
  "kahve ve mırıltıyla yapıldı",
  "gece üçte, kucakta kediyle yazıldı",
  "%100 kedi, %0 reklam",
  "patili dostlara adanmıştır",
  "tüy dökümü dahil, sevgiyle",
  "klavyeye yatan kediye rağmen bitti",
  "miyavlayarak derlendi",
  "dokuz canla test edildi",
];

export interface Neighbor { id: number; key: string; pos: number; caption: string | null }

export function catTitle(cat: CatRow): string {
  return cat.caption ? cat.caption.replace(/[.!]+$/, "") : `Kedi #${(cat.pos ?? 0) + 1}`;
}

export function catDescription(cat: CatRow, total: number): string {
  const n = (cat.pos ?? 0) + 1;
  return cat.caption
    ? `${cat.caption} ${SITE_NAME} üzerindeki ${total} kedi fotoğrafından ${n}. kedi. Topluluktan gelen, sadece kedi.`
    : `${SITE_NAME} üzerindeki ${total} kedi fotoğrafından ${n}. kedi. Rastgele kediler; hepsi topluluktan, hepsi kedi.`;
}

/** Full HTML for /kedi/:id — a real page for people and crawlers alike. */
export function renderCatPage(opts: {
  origin: string;
  cdn: string;
  cat: CatRow;
  total: number;
  prev: Neighbor | null;
  next: Neighbor | null;
  strip: Neighbor[];
}): string {
  const { origin, cdn, cat, total, prev, next, strip } = opts;
  const n = (cat.pos ?? 0) + 1;
  const title = catTitle(cat);
  const desc = catDescription(cat, total);
  const img = `${cdn}/${cat.key}`;
  const canonical = `${origin}/kedi/${cat.id}`;
  const alt = cat.caption || `Kedi fotoğrafı #${n}`;
  const date = cat.approved_at || cat.uploaded_at || null;
  const iso = date ? new Date(date).toISOString() : null;
  const jsonld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "ImageObject",
        "@id": `${canonical}#image`,
        contentUrl: img,
        url: canonical,
        name: title,
        description: desc,
        caption: alt,
        encodingFormat: mimeForKey(cat.key),
        ...(cat.width && cat.height ? { width: cat.width, height: cat.height } : {}),
        ...(iso ? { uploadDate: iso, datePublished: iso } : {}),
        isPartOf: { "@type": "WebSite", name: SITE_NAME, url: `${origin}/` },
        acquireLicensePage: `${origin}/`,
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Kediler", item: `${origin}/` },
          { "@type": "ListItem", position: 2, name: title, item: canonical },
        ],
      },
    ],
  };
  const link = (c: Neighbor | null, label: string) =>
    c ? `<a class="btn" href="/kedi/${c.id}" rel="${label === "Önceki" ? "prev" : "next"}">${label === "Önceki" ? "← " : ""}${label}${label === "Sonraki" ? " →" : ""}</a>` : "";

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)} · ${SITE_NAME}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
${prev ? `<link rel="prev" href="${origin}/kedi/${prev.id}">` : ""}
${next ? `<link rel="next" href="${origin}/kedi/${next.id}">` : ""}
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="${new URL(img).origin}" crossorigin>
<link rel="stylesheet" href="/styles.css?v=2603dd5f">
<meta name="theme-color" content="#0b0b0d">
<meta name="color-scheme" content="dark">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${SITE_NAME}">
<meta property="og:locale" content="tr_TR">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:image" content="${img}">
<meta property="og:image:secure_url" content="${img}">
<meta property="og:image:type" content="${mimeForKey(cat.key)}">
<meta property="og:image:alt" content="${esc(alt)}">
${cat.width && cat.height ? `<meta property="og:image:width" content="${cat.width}"><meta property="og:image:height" content="${cat.height}">` : ""}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${img}">
<meta name="twitter:image:alt" content="${esc(alt)}">
<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, "\\u003c")}</script>
</head>
<body class="page">
<header class="top">
  <a class="brand" href="/" aria-label="${SITE_NAME} ana sayfa">
    <svg class="brand-mark" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20V9.5c0-.7.8-1.1 1.4-.7L8 10.6c1.2-.9 2.6-1.3 4-1.3s2.8.4 4 1.3l2.6-1.8c.6-.4 1.4 0 1.4.7V20"/><path d="M4 20c0-4 3.6-6 8-6s8 2 8 6"/><circle cx="9.5" cy="15" r=".9" fill="currentColor" stroke="none"/><circle cx="14.5" cy="15" r=".9" fill="currentColor" stroke="none"/></svg>
    <span>turkkedy<em>.net</em></span>
  </a>
  <div class="counter"><span style="color:var(--fg)">${n}</span><span class="counter-sep">/</span>${total}</div>
</header>
<main class="page-wrap">
  <article>
    <figure class="page-figure">
      <a href="/?c=${cat.id}" title="Galeride aç"><img src="${img}" alt="${esc(alt)}" ${cat.width && cat.height ? `width="${cat.width}" height="${cat.height}"` : ""} decoding="async" fetchpriority="high"></a>
    </figure>
    <h1 class="page-title">${esc(title)}</h1>
    <p class="page-meta">${total} kediden ${n}.${iso ? ` · <time datetime="${iso}">${new Date(date!).toLocaleDateString("tr-TR", { year: "numeric", month: "long", day: "numeric" })}</time>` : ""}${cat.width ? ` · ${cat.width}×${cat.height}` : ""}</p>
    <nav class="page-nav" aria-label="Kediler arasında gezin">
      ${link(prev, "Önceki")}
      <a class="btn" href="/kedi/rastgele" rel="nofollow">Rastgele</a>
      ${link(next, "Sonraki")}
      <a class="btn btn--accent" href="/?c=${cat.id}">Galeride aç</a>
    </nav>
  </article>
  ${strip.length ? `<section aria-label="Yakındaki kediler"><div class="strip">
    ${strip.map((s) => `<a href="/kedi/${s.id}" class="${s.id === cat.id ? "current" : ""}" title="${esc(s.caption || `Kedi #${s.pos + 1}`)}"><img src="${cdn}/${s.key}" alt="${esc(s.caption || `Kedi #${s.pos + 1}`)}" loading="lazy" decoding="async"></a>`).join("")}
  </div></section>` : ""}
  <p class="page-foot"><a href="/">${SITE_NAME}</a> — biz burada kedi paylaşıyoruz. Senin de kedin varsa <a href="/?c=${cat.id}#yukle">yükle</a>.<br><a href="/gizlilik/">Gizlilik ve KVKK</a> · ${esc(CREDITS[cat.id % CREDITS.length])} · <a href="https://berk.kim" rel="me noopener" target="_blank">Berk</a></p>
</main>
</body>
</html>`;
}

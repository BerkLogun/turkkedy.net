// Upload dialog: resize + watermark in the browser, send a WebP plus a small thumbnail for server-side cat detection.
const MAX_DIM = 1600;
const THUMB_DIM = 320;
const QUALITY = 0.82;
const WATERMARK = "turkkedy.net";
const PALETTE = ["#f3b64a", "#5fd39a", "#7cc4ff", "#ff8fa3", "#e6d7ff", "#ffffff"];

// Safari cannot encode WebP from a canvas (it silently returns PNG), so fall back to JPEG there.
const WEBP_OK = (() => {
  try { const c = document.createElement("canvas"); c.width = c.height = 1; return c.toDataURL("image/webp").startsWith("data:image/webp"); }
  catch { return false; }
})();
const OUT_TYPE = WEBP_OK ? "image/webp" : "image/jpeg";

let root, cbs = {};
let turnstileWidget = null;
let picked = null; // { image: Blob, thumb: Blob, name, previewUrl }

export function open(callbacks = {}) {
  cbs = callbacks;
  if (root) root.remove();
  root = document.createElement("div");
  root.className = "modal";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "upTitle");
  root.innerHTML = `
    <div class="modal-card">
      <div class="modal-head">
        <h2 id="upTitle">Kedi yükle</h2>
        <button class="icon-btn" data-close aria-label="Kapat"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
      </div>
      <label class="drop" data-drop tabindex="0">
        <strong>Fotoğrafı buraya bırak ya da seç</strong>
        <small>JPG, PNG, WebP, HEIC · sadece kedi 🐈</small>
        <input type="file" accept="image/*" data-file>
      </label>
      <div class="preview" data-preview hidden><img alt="Önizleme" data-preview-img></div>
      <div class="status" data-status hidden></div>
      <div class="result" data-result hidden></div>
      <div data-turnstile style="margin-top:12px" hidden></div>
      <p class="consent">Yükleyerek fotoğrafın sana ait olduğunu, içinde tanınabilir kişi olmadığını ve <a href="/gizlilik/" target="_blank" rel="noopener">gizlilik politikasını</a> kabul ettiğini onaylarsın.</p>
      <div class="modal-actions">
        <button class="btn" data-close>Kapat</button>
        <button class="btn btn--accent" data-send hidden>Yükle</button>
      </div>
    </div>`;
  document.body.appendChild(root);

  const q = (s) => root.querySelector(s);
  root.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", close));
  root.addEventListener("click", (e) => { if (e.target === root) close(); });
  const drop = q("[data-drop]");
  const file = q("[data-file]");
  file.addEventListener("change", () => file.files[0] && handle(file.files[0]));
  drop.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); file.click(); } });
  ["dragenter", "dragover"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => { const f = e.dataTransfer?.files?.[0]; if (f) handle(f); });
  q("[data-send]").addEventListener("click", send);
  document.addEventListener("keydown", onKey);
  if (cbs.turnstile) mountTurnstile(cbs.turnstile);
  q("[data-drop]").focus();
}

function onKey(e) { if (e.key === "Escape") close(); }

// Cloudflare Turnstile (only when the site is configured with a site key): a visible checkbox-style widget in the dialog.
function mountTurnstile(siteKey) {
  const host = root.querySelector("[data-turnstile]");
  host.hidden = false;
  const render = () => { turnstileWidget = window.turnstile.render(host, { sitekey: siteKey, theme: "dark", language: "tr" }); };
  if (window.turnstile) return render();
  const s = document.createElement("script");
  s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  s.async = true;
  s.onload = render;
  document.head.appendChild(s);
}

function close() {
  document.removeEventListener("keydown", onKey);
  if (picked?.previewUrl) URL.revokeObjectURL(picked.previewUrl);
  picked = null;
  root?.remove();
  root = null;
}

function setStatus(html) {
  const el = root.querySelector("[data-status]");
  el.hidden = !html;
  el.innerHTML = html || "";
}
function setResult(cls, html) {
  const el = root.querySelector("[data-result]");
  el.hidden = !html;
  el.className = `result ${cls}`;
  el.innerHTML = html || "";
}

async function handle(file) {
  setResult("", "");
  if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
    setResult("err", "Bu bir resim dosyası değil.");
    return;
  }
  setStatus(`<span class="spinner"></span> Fotoğraf hazırlanıyor…`);
  root.querySelector("[data-send]").hidden = true;
  try {
    const bitmap = await loadBitmap(file);
    let image = await encode(bitmap, MAX_DIM, OUT_TYPE, QUALITY, true);
    if (image.type !== OUT_TYPE) image = await encode(bitmap, MAX_DIM, "image/jpeg", QUALITY, true); // belt and braces
    const thumb = await encode(bitmap, THUMB_DIM, "image/jpeg", 0.8, false);
    bitmap.close?.();
    if (picked?.previewUrl) URL.revokeObjectURL(picked.previewUrl);
    picked = { image, thumb, name: file.name, previewUrl: URL.createObjectURL(image) };
    const pv = root.querySelector("[data-preview]");
    pv.hidden = false;
    root.querySelector("[data-preview-img]").src = picked.previewUrl;
    root.querySelector("[data-drop]").hidden = true;
    setStatus("");
    root.querySelector("[data-send]").hidden = false;
    root.querySelector("[data-send]").focus();
  } catch (e) {
    console.error(e);
    setStatus("");
    setResult("err", "Fotoğraf açılamadı. Tarayıcın bu formatı desteklemiyor olabilir; JPG veya PNG dene.");
  }
}

async function loadBitmap(file) {
  if ("createImageBitmap" in window) {
    try { return await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { /* fallback below */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

function encode(src, maxDim, type, quality, watermark) {
  const sw = src.width || src.naturalWidth, sh = src.height || src.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(src, 0, 0, w, h);
  if (watermark) drawWatermark(ctx, w, h);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), type, quality),
  );
}

function drawWatermark(ctx, w, h) {
  const size = Math.max(14, Math.round(Math.min(w, h) * 0.028));
  ctx.font = `600 ${size}px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  ctx.textBaseline = "alphabetic";
  const tw = ctx.measureText(WATERMARK).width;
  const m = Math.round(size * 1.2);
  const x = m + Math.random() * Math.max(0, w - tw - 2 * m);
  const y = m + size + Math.random() * Math.max(0, h - size - 2 * m);
  ctx.globalAlpha = 0.6 + Math.random() * 0.3;
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, size / 7);
  ctx.strokeStyle = "rgba(0,0,0,.75)";
  ctx.strokeText(WATERMARK, x, y);
  ctx.fillStyle = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  ctx.fillText(WATERMARK, x, y);
  ctx.globalAlpha = 1;
}

async function send() {
  if (!picked) return;
  const btn = root.querySelector("[data-send]");
  btn.disabled = true;
  setResult("", "");
  setStatus(`<span class="spinner"></span> Yükleniyor ve kedi aranıyor…`);
  const fd = new FormData();
  fd.append("image", picked.image, picked.image.type === "image/webp" ? "cat.webp" : "cat.jpg");
  fd.append("thumb", picked.thumb, "thumb.jpg");
  fd.append("name", picked.name);
  if (cbs.turnstile) {
    const token = window.turnstile?.getResponse(turnstileWidget) || "";
    if (!token) { setStatus(""); setResult("err", "Önce doğrulamayı tamamla."); btn.disabled = false; return; }
    fd.append("turnstile", token);
  }
  try {
    const r = await fetch("/api/upload", { method: "POST", body: fd });
    const d = await r.json().catch(() => ({}));
    setStatus("");
    if (!r.ok) throw new Error(d.error || `Sunucu hatası (${r.status})`);
    const pct = Math.round((d.confidence ?? 0) * 100);
    const labels = (d.labels || []).slice(0, 3).map((l) => `${l.label.toLowerCase()} ${Math.round(l.score * 100)}%`).join(" · ");
    if (d.status === "live") {
      setResult("ok", `<b>Kedin canlıda!</b> Kedilik oranı %${pct}.<span class="labels">${labels}</span>`);
      btn.hidden = true;
      setTimeout(() => { close(); cbs.onLive?.(d); }, 900);
    } else if (d.status === "pending") {
      setResult("warn", `<b>Teşekkürler!</b> Kedi olduğundan tam emin olamadık (%${pct}); onaylanınca yayınlanacak.<span class="labels">${labels}</span>`);
      btn.hidden = true;
    } else if (d.status === "duplicate") {
      setResult("warn", `<b>Bu kedi zaten burada.</b> ${d.pos != null ? `<a href="/?i=${d.pos + 1}" style="color:inherit">Görmek için tıkla.</a>` : "Onay bekliyor."}`);
      btn.hidden = true;
    } else {
      setResult("err", `<b>Burada kedi göremedik.</b> Başka bir fotoğraf dene.<span class="labels">${labels}</span>`);
      btn.disabled = false;
    }
  } catch (e) {
    setStatus("");
    setResult("err", `Yükleme başarısız: ${e.message}`);
    btn.disabled = false;
    if (cbs.turnstile && window.turnstile) window.turnstile.reset(turnstileWidget);
  }
}

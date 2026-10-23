// turkkedy.net viewer. Cats are read in pages of 100 from /api/cats; only the pages you look at are fetched.
const PAGE = 100;
const $ = (id) => document.getElementById(id);

const state = {
  total: 0,
  cdn: "",
  index: -1,
  turnstile: null,    // Turnstile site key when uploads require a human check
  pages: new Map(),   // page number -> Promise<[id, key][]>
  extra: new Map(),   // pos -> [id, key] for cats added in this session (edge cache may lag)
  loadToken: 0,
  activeImg: null,
  likeBtn: null,
  likeCount: null,
  likeCache: new Map(), // id -> { liked, count } — client-side cache, D1 okumasını korur
};

const imgs = [$("imgA"), $("imgB")];
const progress = $("progress");
const toastEl = $("toast");
let toastTimer;

/* ---------- data ---------- */
async function fetchPage(p) {
  if (state.pages.has(p)) return state.pages.get(p);
  const pr = fetch(`/api/cats?page=${p}`)
    .then((r) => { if (!r.ok) throw new Error(`cats ${r.status}`); return r.json(); })
    .then((d) => { state.total = d.total; state.cdn = d.cdn; state.turnstile = d.turnstile || null; return d.items; });
  state.pages.set(p, pr);
  try { return await pr; } catch (e) { state.pages.delete(p); throw e; }
}
async function itemAt(i) {
  if (state.extra.has(i)) return state.extra.get(i);
  const items = await fetchPage(Math.floor(i / PAGE));
  return items[i % PAGE] || null;
}

/* ---------- like ---------- */

/** Bir sayfadaki tüm kedilerin like durumunu tek batch istekte çeker ve cache'e yazar.
 * D1 okuma kotasını korur: sayfa başına en fazla 1 istek (100 kedi için tek IN sorgusu).
 */
async function loadLikesForPage(pageNo: number) {
  try {
    const items = await fetchPage(pageNo);
    const ids = items.map(([id]) => id);
    const missing = ids.filter((id) => !state.likeCache.has(id));
    if (missing.length === 0) return;
    const r = await fetch(`/api/cats/like/batch?ids=${missing.join(",")}`);
    if (!r.ok) return;
    const d = await r.json();
    for (const [idStr, st] of Object.entries(d)) {
      state.likeCache.set(Number(idStr), st);
    }
  } catch { /* silently fail: like is optional */ }
}

/** Aktif kedi için like butonunu client-side cache'den günceller. */
function updateLikeButton(id: number) {
  if (!state.likeBtn) return;
  const st = state.likeCache.get(id);
  if (!st) return;
  state.likeBtn.classList.toggle("liked", !!st.liked);
  state.likeCount.textContent = st.count > 0 ? st.count : "";
}

/** Beğeniyi açar/kapar ve butonu + cache'i günceller. */
async function toggleLikeUI(id) {
  if (!state.likeBtn) return;
  try {
    const r = await fetch(`/api/cats/${encodeURIComponent(id)}/like`, { method: "POST" });
    if (!r.ok) { toast("Beğenilemedi"); return; }
    const d = await r.json();
    state.likeCache.set(id, { liked: d.liked, count: d.count });
    state.likeBtn.classList.toggle("liked", !!d.liked);
    state.likeCount.textContent = d.count > 0 ? d.count : "";
    toast(d.liked ? "Beğendi 🐾" : "Beğenimi kaldırdın");
  } catch { toast("Beğenilemedi"); }
}
const urlFor = (key) => `${state.cdn}/${encodeURI(key)}`;

/* ---------- rendering ---------- */
function setProgress(on) {
  progress.classList.remove("on", "done");
  void progress.offsetWidth;
  progress.classList.add(on ? "on" : "done");
}
function updateCounter() {
  $("cur").textContent = state.index >= 0 ? state.index + 1 : "–";
  $("total").textContent = state.total || "–";
}
function preload(i) {
  if (i < 0 || i >= state.total) return;
  itemAt(i).then((it) => { if (it) { const im = new Image(); im.decoding = "async"; im.src = urlFor(it[1]); } }).catch(() => {});
}

async function show(i, { push = true } = {}) {
  if (!state.total) return;
  i = ((i % state.total) + state.total) % state.total;
  const token = ++state.loadToken;
  state.index = i;
  updateCounter();
  if (push) {
    const u = new URL(location.href);
    u.searchParams.set("i", i + 1); // 1-based in the URL, same as the counter
    u.searchParams.delete("c");
    history.replaceState(null, "", u);
  }
  const item = await itemAt(i).catch(() => null);
  if (token !== state.loadToken) return;
  if (!item) { toast("Bu kedi bulunamadı"); return; }

  const [id, key] = item;
  await loadLikesForPage(Math.floor(i / PAGE));
  updateLikeButton(id);
  const next = imgs.find((im) => im !== state.activeImg) || imgs[0];
  setProgress(true);
  next.alt = `kedi #${id}`;
  next.dataset.id = id;
  next.src = urlFor(key);
  try { await next.decode(); } catch { /* fall through: show anyway */ }
  if (token !== state.loadToken) return;
  next.classList.add("show");
  if (state.activeImg && state.activeImg !== next) state.activeImg.classList.remove("show");
  state.activeImg = next;
  setProgress(false);
  preload(i + 1); preload(i - 1);
  const ahead = i + 2; if (ahead < state.total) preload(ahead);
}

const nextCat = () => show(state.index + 1);
const prevCat = () => show(state.index - 1);
function randomCat() {
  if (state.total < 2) return;
  let r = Math.floor(Math.random() * state.total);
  if (r === state.index) r = (r + 1) % state.total;
  show(r);
}

/* ---------- share ---------- */
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1800);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = text; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch { return false; }
}
const isTouchDevice = matchMedia("(hover: none) and (pointer: coarse)").matches;
async function share() {
  const id = state.activeImg?.dataset.id;
  if (!id) return;
  const url = `${location.origin}/kedi/${id}`;
  // Native share sheet on phones; plain copy on desktop (desktop share sheets are confusing).
  if (isTouchDevice && navigator.share) {
    try { await navigator.share({ title: "turkkedy.net", url }); return; } catch (e) { if (e?.name === "AbortError") return; }
  }
  toast((await copy(url)) ? `Kopyalandı: ${url.replace(/^https?:\/\//, "")}` : url);
}

/* ---------- upload (lazy) ---------- */
let uploadMod;
async function openUpload() {
  $("uploadBtn").disabled = true;
  try {
    uploadMod ??= await import("/upload.js?v=7654f58c");
    uploadMod.open({
      turnstile: state.turnstile,
      onLive: ({ pos, id, key, total }) => {
        state.total = total || state.total;
        state.extra.set(pos, [id, key]);
        state.pages.delete(Math.floor(pos / PAGE));
        show(pos);
        toast("Kedin canlıda 🎉");
      },
    });
  } catch (e) {
    console.error(e);
    toast("Yükleme ekranı açılamadı");
  } finally {
    $("uploadBtn").disabled = false;
  }
}

/* ---------- input ---------- */
state.likeBtn = $("likeBtn");
state.likeCount = $("likeCount");
state.likeBtn.addEventListener("click", () => {
  const id = state.activeImg?.dataset.id;
  if (id) toggleLikeUI(Number(id));
});
$("prevBtn").addEventListener("click", prevCat);
$("nextBtn").addEventListener("click", nextCat);
$("randBtn").addEventListener("click", randomCat);
$("shareBtn").addEventListener("click", share);
$("uploadBtn").addEventListener("click", openUpload);
$("frame").addEventListener("click", (e) => { if (e.target.classList.contains("photo")) nextCat(); });

window.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (document.querySelector(".modal")) return; // upload dialog handles its own keys
  const k = e.key.toLowerCase();
  if (e.key === "ArrowRight" || k === "l") nextCat();
  else if (e.key === "ArrowLeft" || k === "h") prevCat();
  else if (k === "r") randomCat();
  else if (k === "s") share();
  else if (k === "u") openUpload();
  else if (k === "b") { const id = state.activeImg?.dataset.id; if (id) toggleLikeUI(Number(id)); }
  else return;
  e.preventDefault();
});

// Horizontal swipe on the stage.
let sx = 0, sy = 0, swiping = false;
const stage = $("stage");
stage.addEventListener("pointerdown", (e) => { sx = e.clientX; sy = e.clientY; swiping = e.pointerType !== "mouse"; }, { passive: true });
stage.addEventListener("pointerup", (e) => {
  if (!swiping) return;
  const dx = e.clientX - sx, dy = e.clientY - sy;
  if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.3) { dx < 0 ? nextCat() : prevCat(); }
  swiping = false;
}, { passive: true });

/* ---------- footer credit (a different line every visit) ---------- */
const CREDITS = [
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
$("credit").textContent = CREDITS[Math.floor(Math.random() * CREDITS.length)];

/* ---------- easter egg: type "miyav", or tap the counter five times ---------- */
let typed = "", taps = [], rainBusy = false;
function catRain() {
  if (rainBusy) return;
  rainBusy = true;
  const layer = document.createElement("div");
  layer.className = "rain";
  layer.setAttribute("aria-hidden", "true");
  const glyphs = ["🐈", "🐈‍⬛", "🐾", "🐱", "😺", "🧶"];
  for (let i = 0; i < 48; i++) {
    const s = document.createElement("span");
    s.textContent = glyphs[Math.floor(Math.random() * glyphs.length)];
    s.style.left = `${Math.random() * 100}%`;
    s.style.fontSize = `${18 + Math.random() * 30}px`;
    s.style.animationDuration = `${2.4 + Math.random() * 2.4}s`;
    s.style.animationDelay = `${Math.random() * 1.8}s`;
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  document.querySelector(".brand-mark")?.classList.add("wiggle");
  const oldTitle = document.title;
  document.title = "miyav miyav miyav";
  try { navigator.vibrate?.([70, 40, 70, 40, 140]); } catch {}
  toast(["miyav!", "mrrr…", "kedi yağmuru ☔", "dokuz can, bir site"][Math.floor(Math.random() * 4)]);
  setTimeout(() => {
    layer.remove();
    document.querySelector(".brand-mark")?.classList.remove("wiggle");
    document.title = oldTitle;
    rainBusy = false;
  }, 6500);
}
window.addEventListener("keydown", (e) => {
  if (e.key.length !== 1) return;
  typed = (typed + e.key.toLowerCase()).slice(-5);
  if (typed === "miyav") { typed = ""; catRain(); }
});
document.querySelector(".counter").addEventListener("click", () => {
  const now = Date.now();
  taps = taps.filter((t) => now - t < 2000).concat(now);
  if (taps.length >= 5) { taps = []; catRain(); }
});

/* ---------- boot ---------- */
(async function init() {
  const params = new URLSearchParams(location.search);
  try {
    await fetchPage(0); // also gives us total + cdn (preloaded by <link rel=preload>)
    if (!state.total) throw new Error("empty");
    const c = params.get("c");
    const i = params.get("i");
    if (c) {
      const r = await fetch(`/api/cats/${encodeURIComponent(c)}`);
      if (r.ok) { const d = await r.json(); await show(d.pos); }
      else { toast("Bu kedi artık yok"); randomCat(); }
    } else if (i !== null && Number.isFinite(+i)) {
      await show(Math.max(0, Math.min(state.total - 1, Math.trunc(+i) - 1)), { push: false });
    } else {
      show(Math.floor(Math.random() * state.total));
    }
    setTimeout(() => $("hint").classList.add("show"), 1200);
    setTimeout(() => $("hint").classList.remove("show"), 7000);
  } catch (e) {
    console.error(e);
    $("empty").hidden = false;
  }
})();

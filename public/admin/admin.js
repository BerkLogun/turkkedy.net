// Admin panel: review pending uploads, browse/delete live cats, run a bucket sync.
const TOKEN_KEY = "turkkedy.admin.token";
const app = document.getElementById("app");
const state = { token: sessionStorage.getItem(TOKEN_KEY) || "", tab: "pending", page: 0, data: null, busy: false, notice: null };

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" }) : "–");
const fmtSize = (b) => (b ? `${(b / 1024).toFixed(0)} KB` : "–");
const pct = (c) => (c == null ? null : Math.round(c * 100));
const badge = (c) => c == null ? `<span class="badge">–</span>` : `<span class="badge ${c >= 0.5 ? "hi" : c >= 0.2 ? "mid" : "lo"}">%${pct(c)}</span>`;

async function api(path, opts = {}) {
  const r = await fetch(path, { ...opts, headers: { authorization: `Bearer ${state.token}`, ...(opts.body ? { "content-type": "application/json" } : {}), ...(opts.headers || {}) } });
  const d = await r.json().catch(() => ({}));
  if (r.status === 401) { state.token = ""; sessionStorage.removeItem(TOKEN_KEY); render(); throw new Error("Token geçersiz"); }
  if (!r.ok) throw new Error(d.error || `Hata ${r.status}`);
  return d;
}

function notice(kind, text) { state.notice = { kind, text }; render(); if (kind !== "err") setTimeout(() => { if (state.notice?.text === text) { state.notice = null; render(); } }, 3000); }

async function load() {
  state.busy = true; render();
  try {
    state.data = await api(`/api/admin/images?status=${state.tab}&page=${state.page}&size=48`);
  } catch (e) { notice("err", e.message); }
  state.busy = false; render();
}

async function act(label, fn) {
  if (state.busy) return;
  state.busy = true; render();
  try { await fn(); notice("ok", label); await load(); }
  catch (e) { notice("err", e.message); state.busy = false; render(); }
}

const review = (id, action) => act(action === "approve" ? "Onaylandı" : "Reddedildi", () => api("/api/admin/review", { method: "POST", body: JSON.stringify({ id, action }) }));
const del = (id) => confirm("Bu kedi kalıcı olarak silinecek. Emin misin?") && act("Silindi", () => api("/api/admin/delete", { method: "POST", body: JSON.stringify({ id }) }));
const sync = () => confirm("R2 ile D1 eşitlenecek (sadece eksik/fazla kayıtları düzeltir). Devam?") && act("Eşitlendi", async () => { const r = await api("/api/admin/sync", { method: "POST" }); notice("ok", `Eklendi ${r.inserted} · silindi ${r.removed} · durum ${r.statusFixed} · tarih ${r.datesFilled} · sıra ${r.repacked} · canlı ${r.live}`); });
let captionStop = false;
async function captionLoop() {
  if (state.busy) { captionStop = true; return; }
  if (!confirm("Açıklaması olmayan kediler için 5'erli gruplar halinde açıklama üretilecek (Workers AI, günlük ücretsiz kota). Durdurmak için butona tekrar bas. Devam?")) return;
  captionStop = false; state.busy = true; render();
  let done = 0;
  try {
    for (;;) {
      const r = await api("/api/admin/caption?limit=5", { method: "POST" });
      done += r.captioned;
      notice("ok", `${done} açıklama yazıldı · kalan ${r.remaining}${r.sample ? ` · "${r.sample}"` : ""}${r.errors?.length ? ` · hata: ${r.errors[0]}` : ""}`);
      if (captionStop || !r.remaining || !r.captioned) break;
    }
  } catch (e) { notice("err", `${done} yazıldı, sonra hata: ${e.message}`); }
  state.busy = false; await load();
}
async function approveAllHigh() {
  const items = (state.data?.items || []).filter((c) => (c.confidence ?? 0) >= 0.3);
  if (!items.length) return notice("err", "%30 üstü bekleyen yok");
  if (!confirm(`${items.length} kedi onaylanacak. Devam?`)) return;
  await act(`${items.length} kedi onaylandı`, async () => { for (const c of items) await api("/api/admin/review", { method: "POST", body: JSON.stringify({ id: c.id, action: "approve" }) }); });
}

function render() {
  if (!state.token) {
    app.innerHTML = `
      <form class="login" id="login">
        <h1 style="margin:0;font-size:20px">Yönetim girişi</h1>
        <input type="password" placeholder="Admin token" autocomplete="current-password" id="tok" autofocus>
        <button class="btn btn--accent" type="submit">Giriş</button>
        ${state.notice ? `<div class="notice ${state.notice.kind}">${esc(state.notice.text)}</div>` : ""}
      </form>`;
    document.getElementById("login").onsubmit = (e) => { e.preventDefault(); state.token = document.getElementById("tok").value.trim(); if (!state.token) return; sessionStorage.setItem(TOKEN_KEY, state.token); state.notice = null; load(); };
    return;
  }
  const d = state.data;
  const stats = d?.stats || {};
  const items = d?.items || [];
  const pages = d ? Math.max(1, Math.ceil(d.total / d.size)) : 1;
  app.innerHTML = `
    <div class="admin-head">
      <h1><a href="/" style="color:inherit;text-decoration:none">turkkedy<span style="color:var(--muted)">.net</span></a> <span style="color:var(--muted);font-weight:500">/ yönetim</span></h1>
      <div class="stats">
        <span class="stat"><b>${stats.live ?? "–"}</b>canlı</span>
        <span class="stat"><b>${stats.pending ?? "–"}</b>bekleyen</span>
        <button class="btn" id="logout" style="height:34px">Çıkış</button>
      </div>
    </div>
    <div class="toolbar">
      <div class="tabs">
        <button class="tab ${state.tab === "pending" ? "active" : ""}" data-tab="pending">Bekleyen</button>
        <button class="tab ${state.tab === "live" ? "active" : ""}" data-tab="live">Canlı</button>
      </div>
      <span class="grow"></span>
      ${state.tab === "pending" ? `<button class="btn btn--ok" id="approveAll" ${state.busy ? "disabled" : ""}>%30 üstünü onayla</button>` : ""}
      <button class="btn" id="caption" title="Açıklaması olmayan canlı kediler için Workers AI ile Türkçe açıklama üretir (SEO)">${state.busy ? "Durdur" : "Açıklama üret"}</button>
      <button class="btn" id="sync" ${state.busy ? "disabled" : ""} title="R2 ↔ D1 eşitle">Eşitle</button>
      <button class="btn" id="reload" ${state.busy ? "disabled" : ""}>Yenile</button>
    </div>
    ${state.notice ? `<div class="notice ${state.notice.kind}" style="margin-bottom:12px">${esc(state.notice.text)}</div>` : ""}
    ${!d && state.busy ? `<div class="notice"><span class="spinner"></span> Yükleniyor…</div>` : ""}
    ${d && !items.length ? `<div class="notice">${state.tab === "pending" ? "Bekleyen kedi yok 🎉" : "Kayıt yok"}</div>` : ""}
    <div class="grid">
      ${items.map((c) => `
        <div class="card">
          <img ${c.status === "pending" ? `data-auth-src="${esc(c.url)}"` : `src="${esc(c.url)}" data-zoom="${esc(c.url)}"`} loading="lazy" decoding="async" alt="">
          <div class="card-body">
            <div class="name" title="${esc(c.key)}">${esc(c.original_name || c.key)}</div>
            <div>${badge(c.confidence)} ${c.width ? `${c.width}×${c.height}` : ""} ${fmtSize(c.size)}</div>
            <div>${fmtDate(c.uploaded_at)} · ${esc(c.source)}${c.pos != null ? ` · #${c.pos + 1}` : ""}</div>
            ${c.caption ? `<div style="color:var(--fg)">${esc(c.caption)}</div>` : ""}
            ${c.detection?.labels ? `<div style="font-family:var(--mono);font-size:11px">${c.detection.labels.slice(0, 2).map((l) => `${esc(l.label.toLowerCase())} ${Math.round(l.score * 100)}%`).join(" · ")}</div>` : ""}
          </div>
          <div class="card-actions">
            ${c.status === "pending"
              ? `<button class="btn btn--ok" data-approve="${c.id}">Onayla</button><button class="btn btn--danger" data-reject="${c.id}">Reddet</button>`
              : `<a class="btn" href="/?i=${c.pos + 1}" target="_blank" rel="noopener" style="text-decoration:none">Aç</a><button class="btn btn--danger" data-del="${c.id}">Sil</button>`}
          </div>
        </div>`).join("")}
    </div>
    ${d && pages > 1 ? `<div class="pager">
      <button class="btn" id="prev" ${state.page === 0 ? "disabled" : ""}>←</button>
      <span>Sayfa ${state.page + 1} / ${pages} · ${d.total} kayıt</span>
      <button class="btn" id="next" ${state.page + 1 >= pages ? "disabled" : ""}>→</button>
    </div>` : ""}
    <p class="page-foot"><a href="/gizlilik/">Gizlilik ve KVKK</a> · dokuz canla test edildi · <a href="https://berk.kim" rel="me noopener" target="_blank">Berk</a></p>`;

  app.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; state.page = 0; load(); }));
  app.querySelector("#logout").onclick = () => { sessionStorage.removeItem(TOKEN_KEY); state.token = ""; state.data = null; render(); };
  app.querySelector("#reload").onclick = load;
  app.querySelector("#sync").onclick = sync;
  app.querySelector("#caption").onclick = captionLoop;
  app.querySelector("#approveAll") && (app.querySelector("#approveAll").onclick = approveAllHigh);
  app.querySelector("#prev") && (app.querySelector("#prev").onclick = () => { state.page--; load(); });
  app.querySelector("#next") && (app.querySelector("#next").onclick = () => { state.page++; load(); });
  app.querySelectorAll("[data-approve]").forEach((b) => (b.onclick = () => review(+b.dataset.approve, "approve")));
  app.querySelectorAll("[data-reject]").forEach((b) => (b.onclick = () => review(+b.dataset.reject, "reject")));
  app.querySelectorAll("[data-del]").forEach((b) => (b.onclick = () => del(+b.dataset.del)));
  // Pending images live in a private bucket: fetch them with the token and show them as blob URLs.
  app.querySelectorAll("[data-auth-src]").forEach(async (im) => {
    try {
      const r = await fetch(im.dataset.authSrc, { headers: { authorization: `Bearer ${state.token}` } });
      if (!r.ok) throw new Error(String(r.status));
      const url = URL.createObjectURL(await r.blob());
      im.src = url; im.dataset.zoom = url;
      im.onclick = () => { const lb = document.createElement("div"); lb.className = "lightbox"; lb.innerHTML = `<img src="${url}" alt="">`; lb.onclick = () => lb.remove(); document.body.appendChild(lb); };
    } catch { im.alt = "yüklenemedi"; }
  });
  app.querySelectorAll("[data-zoom]").forEach((im) => (im.onclick = () => {
    const lb = document.createElement("div"); lb.className = "lightbox"; lb.innerHTML = `<img src="${esc(im.dataset.zoom)}" alt="">`;
    lb.onclick = () => lb.remove(); document.body.appendChild(lb);
  }));
}

if (state.token) load(); else render();

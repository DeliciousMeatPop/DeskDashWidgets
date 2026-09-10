/* Aurora Dock panes. One document, routed by ctx.popout.data.pane:
 *   nowplaying · network · system · launcher
 * Panes are pointer-only and rebuildable — they hold no state the dock can't. */
const root = document.getElementById("root");

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pct = (f) => (f == null ? null : Math.round(clamp(f, 0, 1) * 100));
function fmtBytes(b) { if (b == null) return "–"; const u = ["B","K","M","G"]; let n = b, i = 0; while (n >= 1024 && i < 3) { n /= 1024; i++; } return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + u[i] + "/s"; }
function subscribe(cands, cb) { for (const m of cands) { try { const u = m(cb); if (typeof u === "function") return u; if (u && u.unsubscribe) return () => u.unsubscribe(); if (u !== undefined) return () => {}; } catch {} } return () => {}; }
function tok(name, fb) { try { if (dd.ui && dd.ui.token) return dd.ui.token(name, fb); } catch {} const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb; }

let stop = () => {};
window.addEventListener("pagehide", () => { try { stop(); } catch {} });

(async () => {
  const ctx = await dd.ready;
  const pane = (ctx && ctx.popout && ctx.popout.data && ctx.popout.data.pane) || "system";
  ({ nowplaying: nowPlaying, network: networkPane, system: systemPane, launcher: launcherPane }[pane] || systemPane)();
})();

/* ------------------------------------------------------------ NOW PLAYING */
function nowPlaying() {
  const card = el("div", "card np");
  card.innerHTML = `
    <div class="np-head" data-drag>
      <div class="art" id="np-art"></div>
      <div class="meta">
        <div class="title" id="np-title">Nothing playing</div>
        <div class="sub" id="np-artist"></div>
      </div>
    </div>
    <div class="np-progress"><span id="np-elapsed">0:00</span>
      <div class="bar"><i id="np-fill"></i></div><span id="np-total">0:00</span></div>
    <div class="np-controls">
      <button class="ctl" id="np-prev" title="Previous">⏮</button>
      <button class="ctl big" id="np-play" title="Play/Pause">▶</button>
      <button class="ctl" id="np-next" title="Next">⏭</button>
    </div>
    <div class="resize" data-resize></div>`;
  root.appendChild(card);
  restoreGeom(card, "np", { w: 320, h: 220, x: 12, y: 12 });
  makeMovable(card, "np");

  const g = (id) => $("#" + id, card);
  const mmss = (ms) => { if (ms == null) return "0:00"; const s = Math.floor(ms / 1000); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };

  function render(raw) {
    const t = raw || {};
    const title = t.title || t.name || "Nothing playing";
    const artist = Array.isArray(t.artists) ? t.artists.join(", ") : (t.artist || "");
    const art = t.artUrl || t.art || t.thumbnail || t.image || t.cover || "";
    const playing = t.playing != null ? t.playing : t.isPlaying;
    const pos = t.positionMs != null ? t.positionMs : t.position;
    const dur = t.durationMs != null ? t.durationMs : t.duration;
    g("np-title").textContent = title;
    g("np-artist").textContent = artist;
    g("np-art").style.backgroundImage = art ? `url("${art}")` : "";
    g("np-play").textContent = playing ? "⏸" : "▶";
    g("np-elapsed").textContent = mmss(pos);
    g("np-total").textContent = mmss(dur);
    g("np-fill").style.width = (dur ? clamp((pos || 0) / dur, 0, 1) * 100 : 0) + "%";
  }
  const tryCall = (...names) => { for (const n of names) { try { if (dd.media && typeof dd.media[n] === "function") return void dd.media[n](); } catch {} } };
  g("np-prev").onclick = () => tryCall("previous", "prev");
  g("np-next").onclick = () => tryCall("next", "skip");
  g("np-play").onclick = () => tryCall("playPause", "toggle", "pause", "play");

  stop = subscribe([
    (cb) => dd.media.onNowPlaying(cb),
    (cb) => (typeof dd.media.nowPlaying === "function" ? dd.media.nowPlaying(cb) : undefined),
    (cb) => dd.media.nowPlaying.subscribe(cb),
    (cb) => dd.media.onChange(cb),
  ], render);
}

/* ---------------------------------------------------------------- NETWORK */
function networkPane() {
  const card = el("div", "card net");
  card.innerHTML = `
    <div class="card-head">Network</div>
    <canvas id="net-cv" class="graph"></canvas>
    <div class="net-legend">
      <span class="lg down"><b id="net-down">–</b> down</span>
      <span class="lg up"><b id="net-up">–</b> up</span>
      <span class="lg tot">Σ <b id="net-total">0</b></span>
    </div>`;
  root.appendChild(card);
  const cv = $("#net-cv", card), g = cv.getContext("2d");
  const rx = [], tx = []; const CAP = 90; let totalRx = 0, totalTx = 0;

  function draw() {
    const w = cv.width = cv.clientWidth, h = cv.height = cv.clientHeight;
    g.clearRect(0, 0, w, h);
    const max = Math.max(1024, ...rx, ...tx);
    const grid = tok("--dd-border", "rgba(148,163,184,.16)");
    g.strokeStyle = grid; g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = (h / 4) * i; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const line = (arr, color, fill) => {
      if (arr.length < 2) return;
      g.beginPath();
      arr.forEach((v, i) => { const x = (i / (CAP - 1)) * w, y = h - (v / max) * (h - 6) - 3; i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = "round"; g.stroke();
      g.lineTo(w, h); g.lineTo(0, h); g.closePath();
      g.globalAlpha = .14; g.fillStyle = fill; g.fill(); g.globalAlpha = 1;
    };
    line(rx, tok("--dd-accent", "#7dd3fc"), tok("--dd-accent", "#7dd3fc"));
    line(tx, tok("--dd-success", "#4ade80"), tok("--dd-success", "#4ade80"));
  }
  function push(v) {
    const n = v && v.net ? v.net : { rxBps: 0, txBps: 0 };
    rx.push(n.rxBps || 0); tx.push(n.txBps || 0);
    if (rx.length > CAP) rx.shift(); if (tx.length > CAP) tx.shift();
    totalRx += (n.rxBps || 0); totalTx += (n.txBps || 0);
    $("#net-down", card).textContent = fmtBytes(n.rxBps);
    $("#net-up", card).textContent = fmtBytes(n.txBps);
    $("#net-total", card).textContent = fmtBytes(totalRx + totalTx).replace("/s", "");
    draw();
  }
  try { const s = dd.system.status && dd.system.status(); if (s) push(s); } catch {}
  stop = subscribe([(cb) => dd.system.onVitals(cb), (cb) => dd.system.vitals.subscribe(cb)], push);
  addEventListener("resize", draw); setTimeout(draw, 0);
}

/* ----------------------------------------------------------------- SYSTEM */
function systemPane() {
  const card = el("div", "card sys");
  card.innerHTML = `<div class="card-head">System</div>
    <div class="rows" id="sys-rows"></div>
    <div class="chips" id="sys-chips"></div>`;
  root.appendChild(card);
  const rows = $("#sys-rows", card), chips = $("#sys-chips", card);
  const bar = (label, p, cls) => `
    <div class="row ${cls || ""}"><span class="rl">${label}</span>
      <div class="rbar"><i style="width:${p == null ? 0 : p}%"></i></div>
      <b class="rv">${p == null ? "–" : p + "%"}</b></div>`;

  function render(v) {
    if (!v) return;
    const ramP = v.ram ? (v.ram.percent != null ? Math.round(v.ram.percent) : pct(v.ram.usedMb / v.ram.totalMb)) : null;
    const heat = (p) => p == null ? "" : p >= 90 ? "hot" : p >= 70 ? "warm" : "";
    rows.innerHTML =
      bar("CPU", pct(v.cpu), heat(pct(v.cpu))) +
      bar("RAM", ramP, heat(ramP)) +
      bar("GPU", pct(v.gpu), heat(pct(v.gpu))) +
      bar("Disk", pct(v.disk), heat(pct(v.disk)));
    const c = [];
    if (v.battery) c.push(`<span class="chip">${v.battery.charging ? "⚡" : "🔋"} ${Math.round(v.battery.percent)}%</span>`);
    if (v.wifi) c.push(`<span class="chip">📶 ${v.wifi.ssid || "Wi-Fi"}</span>`);
    if (v.net) c.push(`<span class="chip">↓ ${fmtBytes(v.net.rxBps)}</span><span class="chip">↑ ${fmtBytes(v.net.txBps)}</span>`);
    if (v.ram) c.push(`<span class="chip">${Math.round(v.ram.usedMb / 1024)}/${Math.round(v.ram.totalMb / 1024)} GB</span>`);
    chips.innerHTML = c.join("");
  }
  try { const s = dd.system.status && dd.system.status(); if (s) render(s); } catch {}
  stop = subscribe([(cb) => dd.system.onVitals(cb), (cb) => dd.system.vitals.subscribe(cb)], render);
}

/* --------------------------------------------------------------- LAUNCHER */
function launcherPane() {
  const card = el("div", "card launch");
  card.innerHTML = `<div class="card-head">Launcher</div><div class="grid" id="lg"></div>`;
  root.appendChild(card);
  const grid = $("#lg", card);
  const raw = (ctx().launcherItems) || "";
  const items = raw.split(",").map((s) => s.trim()).filter(Boolean).map((s) => {
    const [name, target] = s.split("|").map((x) => (x || "").trim());
    return { name: name || target, target: target || name };
  });
  if (!items.length) grid.innerHTML = `<p class="empty">Add shortcuts in Taskbar settings → Launcher shortcuts.</p>`;
  for (const it of items) {
    const tile = el("button", "tile", `<span class="tico">${(it.name[0] || "?").toUpperCase()}</span><span class="tname">${it.name}</span>`);
    tile.onclick = () => {
      const t = it.target;
      if (/^https?:\/\//i.test(t)) { try { dd.links.open(t); } catch {} }
      else { try { dd.request && dd.request("shell.run", { target: t }); } catch {} }
    };
    grid.appendChild(tile);
  }
  function ctx() { try { return dd.settings.get() || {}; } catch { return {}; } }
}

/* --------------------------------------------------- movable + resizable */
function makeMovable(card, key) {
  const handle = card.querySelector("[data-drag]");
  const grip = card.querySelector("[data-resize]");
  let mode = null, sx = 0, sy = 0, ox = 0, oy = 0, ow = 0, oh = 0;
  const geo = () => ({ x: parseFloat(card.style.left) || 0, y: parseFloat(card.style.top) || 0, w: card.offsetWidth, h: card.offsetHeight });

  function down(e, m) {
    mode = m; sx = e.clientX; sy = e.clientY;
    const g = geo(); ox = g.x; oy = g.y; ow = g.w; oh = g.h;
    card.setPointerCapture(e.pointerId); e.preventDefault();
  }
  function move(e) {
    if (!mode) return;
    const dx = e.clientX - sx, dy = e.clientY - sy;
    const maxX = innerWidth - card.offsetWidth, maxY = innerHeight - card.offsetHeight;
    if (mode === "drag") { card.style.left = clamp(ox + dx, 0, Math.max(0, maxX)) + "px"; card.style.top = clamp(oy + dy, 0, Math.max(0, maxY)) + "px"; }
    else { card.style.width = clamp(ow + dx, 220, innerWidth - ox) + "px"; card.style.height = clamp(oh + dy, 160, innerHeight - oy) + "px"; }
  }
  function up() { if (!mode) return; mode = null; saveGeom(card, key); }
  handle.addEventListener("pointerdown", (e) => down(e, "drag"));
  grip.addEventListener("pointerdown", (e) => down(e, "resize"));
  card.addEventListener("pointermove", move);
  card.addEventListener("pointerup", up);
  card.addEventListener("pointercancel", up);
}
function restoreGeom(card, key, def) {
  let g = def;
  try { const s = JSON.parse(localStorage.getItem("aurora-dock:" + key) || "null"); if (s) g = s; } catch {}
  card.style.left = (g.x ?? def.x) + "px"; card.style.top = (g.y ?? def.y) + "px";
  card.style.width = (g.w ?? def.w) + "px"; card.style.height = (g.h ?? def.h) + "px";
}
function saveGeom(card, key) {
  try {
    localStorage.setItem("aurora-dock:" + key, JSON.stringify({
      x: parseFloat(card.style.left) || 0, y: parseFloat(card.style.top) || 0,
      w: card.offsetWidth, h: card.offsetHeight,
    }));
  } catch {}
}

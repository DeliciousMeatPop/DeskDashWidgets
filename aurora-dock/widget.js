/* Aurora Dock — a glass dock taskbar for DeskDash.
 *
 * Everything the host guarantees is used through the `dd` SDK. Where the SDK
 * surface is not nailed down in the public docs (media/now-playing, window
 * lists, systray), we probe a few plausible shapes and degrade gracefully so
 * the dock never hard-crashes on a host that names a verb differently.
 */
(() => {
  "use strict";

  /* ------------------------------------------------------------------ utils */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const pct = (frac) => (frac == null ? null : Math.round(clamp(frac, 0, 1) * 100));

  function fmtBytes(bps) {
    if (bps == null) return "–";
    const u = ["B", "K", "M", "G"];
    let n = bps, i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + u[i];
  }

  // Try a list of stream shapes; return an unsubscribe fn (or a no-op).
  function subscribe(candidates, cb) {
    for (const make of candidates) {
      try {
        const un = make(cb);
        if (typeof un === "function") return un;
        if (un && typeof un.unsubscribe === "function") return () => un.unsubscribe();
        if (un !== undefined) return () => {};
      } catch (_) { /* try next shape */ }
    }
    return () => {};
  }

  const SVG = {
    logo: '<svg viewBox="0 0 24 24" fill="none"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m12 6-5 3 5 3 5-3-5-3Z" fill="currentColor"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    rocket: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M5 15c-1 1-1 4-1 4s3 0 4-1M14.5 5.5c3 3 3 7 1 9l-5 .5L9 10c2-2 6-2 5.5-4.5Z"/><circle cx="14.5" cy="9.5" r="1.2" fill="currentColor"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.8 5.7L19.5 9l-5.7 1.8L12 16l-1.8-5.2L4.5 9l5.7-1.3L12 2Z"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7L8 5Z"/></svg>',
    note: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 18V6l10-2v12" stroke="currentColor" stroke-width="1.6" fill="none"/><circle cx="7" cy="18" r="2.4"/><circle cx="17" cy="16" r="2.4"/></svg>',
  };

  /* ------------------------------------------------------------------ state */
  let ctx = null;
  let S = {}; // live settings
  let edge = "bottom";
  const els = {
    dock: $("#dock"), start: $("#start"), startIco: $("#start-ico"), startLabel: $("#start-label"),
    hostStart: $("#host-start"),
    media: $("#media"), mediaSep: $("#media-sep"), mediaArt: $("#media-art"),
    mediaTitle: $("#media-title"), mediaArtist: $("#media-artist"), mediaEq: $("#media-eq"),
    stats: $("#stats"), statNet: $("#stat-net"),
    cpuV: $("#cpu-v"), ramV: $("#ram-v"), gpuV: $("#gpu-v"), netV: $("#net-v"),
    clock: $("#clock"), clockMain: $("#clock-main"), clockSub: $("#clock-sub"),
    clockCanvas: $("#clock-canvas"), rail: $("#badge-rail"),
    caret: $(".caret"), trayBadge: $("#tray-badge"),
  };

  /* ============================================================== CLOCK ==== */
  const FACES = ["stacked", "digital", "analog", "worded", "dual"];
  let faceOverride = null; // set by clicking the clock; null = follow setting
  const WORDS = ["twelve","one","two","three","four","five","six","seven","eight","nine","ten","eleven"];
  const MINS = {0:"o'clock",15:"quarter past",30:"half past",45:"quarter to"};

  function currentFace() { return faceOverride || S.clockFace || "stacked"; }

  function pad(n) { return String(n).padStart(2, "0"); }

  function hhmm(d, withSecs) {
    const h24 = d.getHours(), m = d.getMinutes(), s = d.getSeconds();
    if (S.clock24h) return pad(h24) + ":" + pad(m) + (withSecs ? ":" + pad(s) : "");
    const ap = h24 < 12 ? "AM" : "PM";
    const h = ((h24 + 11) % 12) + 1;
    return h + ":" + pad(m) + (withSecs ? ":" + pad(s) : "") + " " + ap;
  }

  function fmtDate(d) {
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const mon = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const D = d.getDate(), M = d.getMonth(), Y = d.getFullYear();
    switch (S.dateFormat) {
      case "d mmm yyyy": return `${D} ${mon[M]} ${Y}`;
      case "dd/mm": return `${pad(D)}/${pad(M + 1)}`;
      case "mm/dd": return `${pad(M + 1)}/${pad(D)}`;
      case "iso": return `${Y}-${pad(M + 1)}-${pad(D)}`;
      default: return `${days[d.getDay()]} ${D} ${mon[M]}`;
    }
  }

  function worded(d) {
    const m = d.getMinutes(), h = d.getHours();
    const near = [0, 15, 30, 45].reduce((a, b) => Math.abs(b - m) < Math.abs(a - m) ? b : a, 0);
    // "quarter to" / "quarter past" reference the coming / current hour.
    if (near === 45) return `${MINS[45]} ${WORDS[(h + 1) % 12]}`;
    if (near === 0) return `${WORDS[h % 12]} ${MINS[0]}`;
    return `${MINS[near]} ${WORDS[h % 12]}`;
  }

  function tzTime(d, tz) {
    try {
      return new Intl.DateTimeFormat([], {
        hour: "2-digit", minute: "2-digit", hour12: !S.clock24h, timeZone: tz,
      }).format(d);
    } catch { return "—"; }
  }

  function drawAnalog(d) {
    const cv = els.clockCanvas, x = cv.width / 2, y = cv.height / 2, r = x - 6;
    const g = cv.getContext("2d");
    const accent = tok("--dd-accent", "#7dd3fc");
    const faint = tok("--dd-text-muted", "#94a3b8");
    g.clearRect(0, 0, cv.width, cv.height);
    g.strokeStyle = faint; g.globalAlpha = 0.5; g.lineWidth = 3;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
    g.globalAlpha = 1;
    const hand = (frac, len, w, col) => {
      const a = frac * Math.PI * 2 - Math.PI / 2;
      g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round";
      g.beginPath(); g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
    };
    const s = d.getSeconds(), m = d.getMinutes(), h = d.getHours() % 12;
    hand((h + m / 60) / 12, r * 0.5, 5, tok("--dd-text", "#e7edf5"));
    hand((m + s / 60) / 60, r * 0.78, 3.5, tok("--dd-text", "#e7edf5"));
    hand(s / 60, r * 0.85, 1.6, accent);
  }

  function tickClock() {
    const d = new Date();
    const face = currentFace();
    const analog = face === "analog";
    els.clockCanvas.hidden = !analog;
    els.clock.querySelector(".clock-text").hidden = analog;
    els.clock.dataset.face = face;

    if (analog) { drawAnalog(d); return; }
    if (face === "worded") {
      els.clockMain.textContent = worded(d);
      els.clockSub.textContent = S.clockDate ? fmtDate(d) : "";
      return;
    }
    const main = hhmm(d, S.clockSeconds);
    els.clockMain.textContent = main;
    if (face === "dual") {
      const tz = (S.secondaryTz || "").trim();
      els.clockSub.textContent = tz ? "· " + tzTime(d, tz) : "set a time zone";
    } else if (face === "digital") {
      els.clockSub.textContent = S.clockDate ? fmtDate(d) : "";
    } else { // stacked
      els.clockSub.textContent = S.clockDate ? fmtDate(d) : "";
    }
  }

  els.clock.addEventListener("click", () => {
    // Cycle faces live (ephemeral; the saved default still wins on reload).
    const list = FACES;
    const cur = currentFace();
    faceOverride = list[(list.indexOf(cur) + 1) % list.length];
    tickClock();
  });

  /* ============================================================= VITALS ==== */
  let netHist = []; // rolling for the tooltip; the pane keeps its own history
  function loadClass(p) { return p == null ? "" : p >= 90 ? "hot" : p >= 70 ? "warm" : ""; }

  function applyStat(node, valNode, p, text) {
    valNode.textContent = text != null ? text : (p == null ? "–" : p + "%");
    node.classList.remove("hot", "warm");
    const c = loadClass(p); if (c) node.classList.add(c);
    node.style.setProperty("--fill", (p == null ? 0 : p) + "%");
  }

  function onVitals(v) {
    if (!v) return;
    applyStat($("#stat-cpu"), els.cpuV, pct(v.cpu));
    const ramP = v.ram ? (v.ram.percent != null ? Math.round(v.ram.percent) : pct(v.ram.usedMb / v.ram.totalMb)) : null;
    applyStat($("#stat-ram"), els.ramV, ramP);
    applyStat($("#stat-gpu"), els.gpuV, pct(v.gpu));
    const down = v.net ? v.net.rxBps : null;
    applyStat(els.statNet, els.netV, null, fmtBytes(down));
    els.statNet.title = v.net ? `↓ ${fmtBytes(v.net.rxBps)}  ↑ ${fmtBytes(v.net.txBps)}` : "Network";
    netHist.push(v.net || { rxBps: 0, txBps: 0 }); if (netHist.length > 120) netHist.shift();
  }

  /* ============================================================== MEDIA ==== */
  function normTrack(t) {
    if (!t) return null;
    const title = t.title || t.name || t.track || "";
    const artist = Array.isArray(t.artists) ? t.artists.join(", ") : (t.artist || t.artists || t.subtitle || "");
    const art = t.artUrl || t.art || t.thumbnail || t.image || t.cover || "";
    const playing = t.playing != null ? t.playing : (t.isPlaying != null ? t.isPlaying : t.state === "playing");
    if (!title && !artist && !art) return null;
    return { title, artist, art, playing: !!playing };
  }

  function onMedia(raw) {
    const t = normTrack(raw);
    const show = !!t;
    els.media.hidden = !show;
    els.mediaSep.hidden = !show;
    if (!show) return;
    els.mediaTitle.textContent = t.title || "Now playing";
    els.mediaArtist.textContent = t.artist || "";
    els.mediaArt.style.backgroundImage = t.art ? `url("${t.art}")` : "";
    els.mediaArt.classList.toggle("noart", !t.art);
    if (!t.art) els.mediaArt.innerHTML = SVG.note;
    els.media.classList.toggle("paused", !t.playing);
    layoutDock();
  }

  /* ========================================================= BADGES/RAIL === */
  const UNREAD = /(?:^|\s)\((\d+)\+?\)|\b(\d+)\s+(?:new|unread|message)/i;
  function appKey(w) { return (w.appId || w.appUserModelId || w.app || w.processName || w.owner || w.title || "").toString(); }
  function appName(w) { return (w.appName || w.app || w.processName || "").toString() || (w.title || "").split(/[-–|]/)[0].trim(); }

  function onWindows(list) {
    if (!S.badges) { els.rail.innerHTML = ""; return; }
    const wins = Array.isArray(list) ? list : (list && list.windows) || [];
    const byApp = new Map();
    for (const w of wins) {
      const title = (w.title || w.name || "").toString();
      const mm = title.match(UNREAD);
      if (!mm) continue;
      const count = parseInt(mm[1] || mm[2], 10);
      if (!count) continue;
      const key = appKey(w);
      const prev = byApp.get(key);
      if (!prev || count > prev.count) byApp.set(key, { key, count, name: appName(w), icon: w.iconUrl || w.icon || "" });
    }
    renderRail([...byApp.values()].sort((a, b) => b.count - a.count).slice(0, 6));
  }

  function renderRail(items) {
    els.rail.innerHTML = "";
    for (const it of items) {
      const chip = document.createElement("button");
      chip.className = "badge-chip dock-item";
      chip.type = "button";
      chip.title = `${it.name} — ${it.count} unread`;
      chip.innerHTML = it.icon
        ? `<span class="badge-ico" style="background-image:url('${it.icon}')"></span>`
        : `<span class="badge-ico letter">${(it.name[0] || "?").toUpperCase()}</span>`;
      const n = document.createElement("span");
      n.className = "badge-count pop";
      n.textContent = it.count > 99 ? "99+" : it.count;
      chip.appendChild(n);
      chip.addEventListener("animationend", () => n.classList.remove("pop"), { once: true });
      chip.addEventListener("click", () => focusApp(it.key));
      els.rail.appendChild(chip);
    }
  }

  function focusApp(key) {
    // Best-effort focus/preview across possible host verbs.
    try { if (dd.bar && dd.bar.flyout) return void dd.bar.flyout(key); } catch {}
    try { if (dd.windows && dd.windows.focus) return void dd.windows.focus(key); } catch {}
    try { dd.request && dd.request("windows.focus", { app: key }); } catch {}
  }

  function onSystray(state) {
    const count = state && (state.count != null ? state.count : state.badge) || 0;
    els.caret.hidden = !(state && (state.count || state.items || state.hasItems));
    els.trayBadge.hidden = !count;
    if (count) els.trayBadge.textContent = count > 99 ? "99+" : count;
  }

  /* =========================================================== START BTN === */
  function applyStart() {
    els.startLabel.textContent = S.startLabel || "Start";
    els.startLabel.hidden = !(S.startLabel && S.startLabel.trim());
    els.startIco.innerHTML = SVG[S.startIcon] || SVG.logo;
    els.start.dataset.mode = S.startMode || "windows";
  }

  els.start.addEventListener("click", () => {
    const mode = S.startMode || "windows";
    if (mode === "link") {
      const url = (S.startUrl || "").trim();
      if (url) openTarget(url);
      return;
    }
    if (mode === "launcher") { openPane("launcher", els.start); return; }
    // windows: delegate to the host's real Start menu button.
    try { els.hostStart.click(); return; } catch {}
    try { dd.request && dd.request("shell.start"); } catch {}
  });

  function openTarget(target) {
    // A URL goes through dd.links; anything else is handed to the host to run.
    if (/^https?:\/\//i.test(target)) {
      try { return void dd.links.open(target); } catch {}
    }
    try { dd.request && dd.request("shell.run", { target }); } catch {}
  }

  /* =============================================================== PANES ==== */
  function openPane(pane, anchor) {
    const sizes = {
      nowplaying: { w: 460, h: 340 },
      network: { w: 460, h: 300 },
      system: { w: 380, h: 300 },
      launcher: { w: 520, h: 360 },
    };
    const size = sizes[pane] || { w: 400, h: 300 };
    try {
      dd.popout.open({ size, anchor, prefer: edge === "top" ? "down" : "up", data: { pane } });
    } catch (e) { dd.log && dd.log("warn", "popout.open failed", e); }
  }

  els.media.addEventListener("click", () => openPane("nowplaying", els.media));
  els.statNet.addEventListener("click", () => openPane("network", els.statNet));
  ["cpu", "ram", "gpu"].forEach((k) =>
    $("#stat-" + k).addEventListener("click", () => openPane("system", $("#stat-" + k))));

  /* ==================================================== DOCK MAGNIFICATION == */
  const horizontal = () => edge === "bottom" || edge === "top";
  let items = [];
  function refreshItems() {
    // Our own controls, plus any host app-strip buttons we can actually reach
    // (light DOM only; shadow-DOM strips simply keep their native hover).
    items = $$(".dock-item", els.dock)
      .concat($$(".apps button, .apps [role='button'], .apps .dd-app-tile", els.dock));
  }
  // Keep the app-strip buttons in the magnify set as the host adds/removes them.
  try { new MutationObserver(refreshItems).observe($(".apps"), { childList: true, subtree: true }); } catch {}

  function magnify(px, py) {
    if (!S.magnify) return reset();
    const strength = clamp((S.magnifyStrength ?? 55) / 100, 0, 1);
    const reach = clamp(S.magnifyReach ?? 3, 1, 6);
    for (const it of items) {
      const r = it.getBoundingClientRect();
      const c = horizontal() ? r.left + r.width / 2 : r.top + r.height / 2;
      const p = horizontal() ? px : py;
      const sigma = (horizontal() ? r.width : r.height) * reach || 60;
      const d = p - c;
      const g = Math.exp(-(d * d) / (2 * sigma * sigma)); // 1 at cursor → 0 far away
      const s = 1 + strength * g;
      const lift = strength * g * 16;
      it.style.setProperty("--s", s.toFixed(3));
      it.style.setProperty("--lift", lift.toFixed(1) + "px");
    }
  }
  function reset() {
    for (const it of items) { it.style.setProperty("--s", "1"); it.style.setProperty("--lift", "0px"); }
  }
  els.dock.addEventListener("pointermove", (e) => magnify(e.clientX, e.clientY));
  els.dock.addEventListener("pointerleave", reset);

  /* ======================================================== BREATHE PULSE == */
  let breatheTimer = null;
  function scheduleBreathe() {
    if (breatheTimer) { clearInterval(breatheTimer); breatheTimer = null; }
    const secs = S.breathingInterval ?? 45;
    if (!S.breathing || !secs) return;
    breatheTimer = setInterval(runBreathe, secs * 1000);
  }
  function runBreathe() {
    if (document.hidden) return;
    refreshItems();
    items.forEach((it, i) => it.style.setProperty("--bd", (i * 70) + "ms"));
    els.dock.classList.remove("breathe");
    void els.dock.offsetWidth; // restart the animation
    els.dock.classList.add("breathe");
    setTimeout(() => els.dock.classList.remove("breathe"), 2600);
  }

  /* ============================================================= LAYOUT ==== */
  function layoutDock() {
    document.body.dataset.edge = edge;
    // The stats separator only makes sense if a stat / media element is visible.
    const anyStat = S.showCpu || S.showRam || S.showGpu || S.showNet;
    $("#stats-sep").hidden = !anyStat && els.media.hidden;
    refreshItems();
  }

  function applySettings(next) {
    S = Object.assign({}, S, next || {});
    applyStart();
    $("#stat-cpu").hidden = !S.showCpu;
    $("#stat-ram").hidden = !S.showRam;
    $("#stat-gpu").hidden = !S.showGpu;
    els.statNet.hidden = !S.showNet;
    if (!S.badges) els.rail.innerHTML = "";
    scheduleBreathe();
    tickClock();
    layoutDock();
  }

  /* ============================================================== TOKENS === */
  function tok(name, fallback) {
    try { if (dd.ui && dd.ui.token) return dd.ui.token(name, fallback); } catch {}
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  }

  /* =============================================================== BOOT ==== */
  async function boot() {
    ctx = await dd.ready;
    edge = (ctx && ctx.bar && ctx.bar.edge) || "bottom";
    document.body.dataset.edge = edge;

    // Follow live edge changes if the store exposes them.
    try {
      const store = dd.bar.store();
      if (store && typeof store.subscribe === "function") {
        store.subscribe((s) => { if (s && s.edge && s.edge !== edge) { edge = s.edge; layoutDock(); } });
      }
    } catch {}

    // Settings: bind fires immediately then on every change (and live-preview).
    subscribe([
      (cb) => dd.settings.bind(cb),
      (cb) => { cb(dd.settings.get()); return dd.settings.onChange(cb); },
    ], applySettings);

    // Vitals — 1 Hz.
    try { const snap = dd.system.status && dd.system.status(); if (snap) onVitals(snap); } catch {}
    subscribe([
      (cb) => dd.system.onVitals(cb),
      (cb) => dd.system.vitals.subscribe(cb),
    ], onVitals);

    // Now playing.
    subscribe([
      (cb) => dd.media.onNowPlaying(cb),
      (cb) => (typeof dd.media.nowPlaying === "function" ? dd.media.nowPlaying(cb) : undefined),
      (cb) => dd.media.nowPlaying.subscribe(cb),
      (cb) => dd.media.onChange(cb),
    ], onMedia);

    // Open windows → notification badges.
    subscribe([
      (cb) => dd.windows.onChanged(cb),
      (cb) => dd.windows.subscribe(cb),
    ], onWindows);

    // System tray count.
    subscribe([
      (cb) => dd.systray.subscribe(cb),
      (cb) => dd.systray.onChange(cb),
      (cb) => (typeof dd.systray === "function" ? dd.systray(cb) : undefined),
    ], onSystray);

    // Repaint the analog clock / re-read tokens on theme change.
    try { dd.theme.onChange(() => tickClock()); } catch {}

    refreshItems();
    tickClock();
    setInterval(tickClock, 1000);
    // Test hook: window.__auroraBadge("Telegram", 5) to preview the rail.
    window.__auroraBadge = (name, n) => renderRail([{ key: name, name, count: n, icon: "" }]);
  }

  if (window.dd && dd.ready) boot();
  else window.addEventListener("DOMContentLoaded", () => window.dd && dd.ready && boot());
})();

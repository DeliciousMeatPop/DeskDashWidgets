// Pulseglass Dock deck — the bar's one popout, as a small control centre with
// tabs: Now playing (transport + seek + volume), System (meters), Network
// (live graph) and Apps (launcher). Media and vitals logic follows Pulseglass's
// deck; the graph and launcher are the additions.

const { create, bindParts, signal, effect } = dd.ui;

const artEl = document.querySelector('[data-bind="art"]');
const mediaEl = document.getElementById("page-np");
const systemEl = document.getElementById("page-sys");
const soundEl = document.getElementById("sound");
const seekEl = document.getElementById("seek");
const prevBtn = document.getElementById("prevBtn");
const playBtn = document.getElementById("playBtn");
const nextBtn = document.getElementById("nextBtn");
const chipsEl = document.getElementById("chips");
const titleEl = document.querySelector(".deck__title");
const marqueeEl = document.querySelector(".deck__marquee");

const np = signal(null);
const vitals = signal(null);
const shownSeconds = signal(0);
let dragging = false;

const warn = (what) => (err) => dd.log("warn", `pulseglass dock deck ${what} failed`, err && err.code ? err.code : String(err));

function fmt(seconds) {
  const s = Math.max(0, Math.round(seconds));
  const mm = Math.floor(s / 60), ss = String(s % 60).padStart(2, "0");
  return mm >= 60 ? `${Math.floor(mm / 60)}:${String(mm % 60).padStart(2, "0")}:${ss}` : `${mm}:${ss}`;
}
function displayedSeconds() {
  const snap = np.peek(), pos = snap && snap.position;
  if (!pos) return 0;
  let s = pos.seconds;
  if (snap.status === "playing" && pos.asOfEpochMs != null) s += (Date.now() - pos.asOfEpochMs) / 1000;
  return Math.min(Math.max(0, s), pos.durationSeconds);
}
function syncSeek() {
  const snap = np.peek();
  if (!snap || !snap.position) return;
  const shown = dragging ? Number(seekEl.value) : displayedSeconds();
  if (!dragging) seekEl.value = String(Math.round(shown));
  shownSeconds.value = shown;
}
function onPlayPause() {
  const snap = np.peek();
  if (!snap || !snap.hasSession) return;
  np.value = { ...snap, status: snap.status === "playing" ? "paused" : "playing" };
  dd.media.playPause().catch(warn("playPause"));
}
function onSeekCommit() {
  const snap = np.peek();
  if (!snap || !snap.position || !snap.canSeek) return;
  const seconds = Number(seekEl.value);
  np.value = { ...snap, position: { ...snap.position, seconds, asOfEpochMs: Date.now() } };
  dd.media.seek(seconds).catch(warn("seek"));
}

// cpu/gpu/ram.percent/disk are 0..1 fractions; battery.percent is 0..100.
function pct(key) {
  const v = vitals.value;
  if (!v) return null;
  if (key === "ram") return v.ram ? v.ram.percent * 100 : null;
  if (key === "battery") return v.battery && typeof v.battery.percent === "number" ? v.battery.percent : null;
  return typeof v[key] === "number" ? v[key] * 100 : null;
}
let warnAt = 50, dangerAt = 90;
try { const st = dd.settings.get() || {}; warnAt = st.vitalsWarnAt ?? 50; dangerAt = st.vitalsDangerAt ?? 90; } catch {}
function severity(key) {
  const p = pct(key);
  if (p === null) return null;
  if (key === "battery") return p <= 15 ? "danger" : p <= 30 ? "warning" : null;
  return p >= dangerAt ? "danger" : p >= warnAt ? "warning" : null;
}
function meterRow(key) {
  return {
    [`row-${key}`]: { hidden: () => pct(key) === null },
    [`meter-${key}`]: { value: () => Math.round(pct(key) || 0), severity: () => severity(key) },
    [`value-${key}`]: { textContent: () => (pct(key) === null ? "" : `${Math.round(pct(key))}%`) },
  };
}
function bps(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB/s`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB/s`;
  return `${Math.round(n)} B/s`;
}
function renderChips() {
  const v = vitals.value; if (!v) return;
  const c = [];
  if (v.ram) c.push(`RAM ${Math.round(v.ram.usedMb / 1024)} / ${Math.round(v.ram.totalMb / 1024)} GB`);
  if (v.net) c.push(`↓ ${bps(v.net.rxBps)}`, `↑ ${bps(v.net.txBps)}`);
  if (v.wifi) c.push(`📶 ${v.wifi.ssid || "Wi-Fi"}${v.wifi.signal != null ? " · " + v.wifi.signal + "%" : ""}`);
  if (v.battery) c.push(`${v.battery.charging ? "⚡ Charging" : "🔋 Battery"} ${Math.round(v.battery.percent)}%`);
  if (v.uptimeSec != null) { const hrs = Math.floor(v.uptimeSec / 3600); c.push(`Up ${hrs >= 24 ? Math.floor(hrs / 24) + "d " + (hrs % 24) + "h" : hrs + "h"}`); }
  chipsEl.replaceChildren(...c.map((t) => { const s = document.createElement("span"); s.className = "chip"; s.textContent = t; return s; }));
}

function updateMarquee() {
  if (!titleEl || !marqueeEl) return;
  const over = titleEl.scrollWidth - marqueeEl.clientWidth;
  if (over > 4) { titleEl.classList.add("scroll"); titleEl.style.setProperty("--marq", -over - 8 + "px"); titleEl.style.setProperty("--marq-dur", Math.max(6, (over + 8) / 26) + "s"); }
  else { titleEl.classList.remove("scroll"); titleEl.style.removeProperty("--marq"); }
}

// ---- network graph --------------------------------------------------------
function setupNetGraph() {
  const cv = document.getElementById("net-graph"), g = cv.getContext("2d");
  const rx = [], tx = [], CAP = 90; let totalRx = 0, totalTx = 0;
  const cssVar = (n, fb) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fb;
  function draw() {
    const w = (cv.width = cv.clientWidth || 480), h = (cv.height = cv.clientHeight || 180);
    g.clearRect(0, 0, w, h);
    const max = Math.max(1024, ...rx, ...tx);
    g.strokeStyle = cssVar("--dd-border", "rgba(148,163,184,.2)"); g.lineWidth = 1;
    for (let i = 1; i < 4; i++) { const y = (h / 4) * i; g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    const line = (arr, color) => {
      if (arr.length < 2) return;
      g.beginPath();
      arr.forEach((v, i) => { const x = (i / (CAP - 1)) * w, y = h - (v / max) * (h - 8) - 4; i ? g.lineTo(x, y) : g.moveTo(x, y); });
      g.strokeStyle = color; g.lineWidth = 2; g.lineJoin = "round"; g.stroke();
      g.lineTo(w, h); g.lineTo(0, h); g.closePath(); g.globalAlpha = 0.14; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
    };
    line(rx, cssVar("--dd-accent", "#7dd3fc"));
    line(tx, cssVar("--dd-success", "#4ade80"));
  }
  effect(() => {
    const v = vitals.value, n = v && v.net ? v.net : null;
    rx.push(n ? n.rxBps : 0); tx.push(n ? n.txBps : 0);
    if (rx.length > CAP) rx.shift(); if (tx.length > CAP) tx.shift();
    if (n) { totalRx += n.rxBps; totalTx += n.txBps; }
    document.getElementById("net-down").textContent = n ? bps(n.rxBps) : "–";
    document.getElementById("net-up").textContent = n ? bps(n.txBps) : "–";
    document.getElementById("net-total").textContent = bps(totalRx + totalTx).replace("/s", "");
    draw();
  });
  addEventListener("resize", draw);
}

// ---- drives ---------------------------------------------------------------
function driveLetter(d) { const s = (d.mount || d.label || "").toString(); const m = s.match(/([A-Za-z]):/); return m ? m[1].toUpperCase() + ":" : (d.mount || d.label || "Drive"); }
function gb(mb) { const g = mb / 1024; return (g >= 100 ? Math.round(g) : g.toFixed(1)); }
function renderDrives() {
  const box = document.getElementById("drives"); if (!box) return;
  const v = vitals.value;
  const list = Array.isArray(v && v.drives) && v.drives.length ? v.drives : (v && v.disk != null ? [{ mount: "Disk", percent: v.disk * 100 }] : []);
  const rows = list.map((d) => {
    const pct = d.percent != null ? d.percent : (d.usedMb && d.totalMb ? (d.usedMb / d.totalMb) * 100 : null);
    const el = document.createElement("div"); el.className = "drive";
    el.innerHTML = `<div class="drive__head"><b class="drive__letter"></b><span class="drive__pct"></span></div><div class="drive__bar"><i></i></div><div class="drive__sub"></div>`;
    el.querySelector(".drive__letter").textContent = driveLetter(d);
    el.querySelector(".drive__pct").textContent = pct != null ? Math.round(pct) + "% used" : "";
    el.querySelector(".drive__bar i").style.width = (pct != null ? pct : 0) + "%";
    el.querySelector(".drive__sub").textContent = d.usedMb != null && d.totalMb != null ? `${gb(d.usedMb)} / ${gb(d.totalMb)} GB used` : "";
    return el;
  });
  if (!rows.length) { const p = document.createElement("p"); p.className = "dd-empty"; p.textContent = "No drive data."; rows.push(p); }
  box.replaceChildren(...rows);
}

// ---- weather (open-meteo via dd.http.fetch) -------------------------------
function wxEmoji(code, isDay) {
  if (code === 0) return isDay ? "☀️" : "🌙";
  if (code === 1 || code === 2) return isDay ? "🌤️" : "☁️";
  if (code === 3) return "☁️";
  if (code === 45 || code === 48) return "🌫️";
  if (code >= 51 && code <= 57) return "🌦️";
  if (code >= 61 && code <= 67) return "🌧️";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "🌨️";
  if (code >= 80 && code <= 82) return "🌧️";
  if (code >= 95) return "⛈️";
  return "🌡️";
}
function wxLabel(code) {
  const m = { 0: "Clear", 1: "Mainly clear", 2: "Partly cloudy", 3: "Overcast", 45: "Fog", 48: "Rime fog", 51: "Light drizzle", 53: "Drizzle", 55: "Heavy drizzle", 61: "Light rain", 63: "Rain", 65: "Heavy rain", 71: "Light snow", 73: "Snow", 75: "Heavy snow", 77: "Snow grains", 80: "Showers", 81: "Showers", 82: "Violent showers", 85: "Snow showers", 86: "Snow showers", 95: "Thunderstorm", 96: "Thunderstorm", 99: "Thunderstorm" };
  return m[code] || "—";
}
async function httpJson(url, query) {
  const res = await dd.http.fetch({ url, query });
  if (res && res.json) return res.json;
  try { return JSON.parse((res && res.bodyText) || "{}"); } catch { return null; }
}
async function setupWeather(st) {
  const place = String((st && st.weatherPlace) || "").trim();
  const units = String((st && st.weatherUnits) || "fahrenheit");
  const nowEl = document.getElementById("wx-now"), fcEl = document.getElementById("wx-forecast"), emptyEl = document.getElementById("wx-empty");
  if (!place) { nowEl.hidden = true; fcEl.replaceChildren(); emptyEl.textContent = "Set a Weather location in the taskbar settings."; emptyEl.hidden = false; return; }
  emptyEl.hidden = true;
  try {
    const g = await httpJson("https://geocoding-api.open-meteo.com/v1/search", { name: place, count: "1" });
    const r = g && g.results && g.results[0];
    if (!r) throw new Error("no match");
    const label = [r.name, r.admin1, r.country_code].filter(Boolean).join(", ");
    const f = await httpJson("https://api.open-meteo.com/v1/forecast", {
      latitude: String(r.latitude), longitude: String(r.longitude),
      current: "temperature_2m,weather_code,is_day", daily: "weather_code,temperature_2m_max,temperature_2m_min",
      temperature_unit: units, timezone: "auto", forecast_days: "5",
    });
    const c = f && f.current;
    if (!c) throw new Error("no current");
    document.getElementById("wx-glyph").textContent = wxEmoji(c.weather_code, !!c.is_day);
    document.getElementById("wx-temp").textContent = Math.round(c.temperature_2m) + "°";
    document.getElementById("wx-desc").textContent = wxLabel(c.weather_code);
    document.getElementById("wx-place").textContent = label;
    nowEl.hidden = false;
    const d = f.daily || {};
    fcEl.replaceChildren(...((d.time) || []).map((t, i) => {
      const el = document.createElement("div"); el.className = "wx-day";
      el.innerHTML = `<span class="wx-day__d"></span><span class="wx-day__g"></span><span class="wx-day__t"><b></b><i></i></span>`;
      el.querySelector(".wx-day__d").textContent = new Date(t).toLocaleDateString([], { weekday: "short" });
      el.querySelector(".wx-day__g").textContent = wxEmoji(d.weather_code[i], true);
      el.querySelector(".wx-day__t b").textContent = Math.round(d.temperature_2m_max[i]) + "°";
      el.querySelector(".wx-day__t i").textContent = Math.round(d.temperature_2m_min[i]) + "°";
      return el;
    }));
  } catch (e) { dd.log("warn", "weather failed", (e && e.code) || String(e)); nowEl.hidden = true; emptyEl.textContent = "Weather unavailable — check the location name."; emptyEl.hidden = false; }
}

// ---- tabs -----------------------------------------------------------------
function setupTabs(st, initialTab) {
  const tabs = Array.from(document.querySelectorAll(".tab"));
  const pages = { np: "page-np", sys: "page-sys", drives: "page-drives", net: "page-net", weather: "page-weather" };
  const enabled = { np: true, sys: st.tabSystem !== false, drives: st.tabDrives !== false, net: st.tabNetwork !== false, weather: st.tabWeather !== false };
  for (const t of tabs) t.hidden = !enabled[t.dataset.tab];
  let active = initialTab || null;
  if (!active) { try { active = localStorage.getItem("pulseglass-dock:tab") || "np"; } catch { active = "np"; } }
  if (!enabled[active]) active = "np";
  function show(name) {
    if (!pages[name] || !enabled[name]) name = "np";
    try { localStorage.setItem("pulseglass-dock:tab", name); } catch {}
    for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.tab === name));
    for (const [k, id] of Object.entries(pages)) document.getElementById(id).hidden = k !== name;
  }
  for (const t of tabs) t.addEventListener("click", () => show(t.dataset.tab));
  show(active);
}

async function main() {
  const ctx = await dd.ready;
  const deckSettings = (ctx && ctx.settings) || (() => { try { return dd.settings.get() || {}; } catch { return {}; } })();
  warnAt = deckSettings.vitalsWarnAt ?? 50;
  dangerAt = deckSettings.vitalsDangerAt ?? 90;
  // Which tab to open on: the popout data (set by the taskbar click), else a
  // one-shot storage hint, else the last tab.
  let initialTab = (ctx && ctx.popout && ctx.popout.data && ctx.popout.data.tab) || null;
  if (!initialTab) { try { const t = await dd.storage.get("openTab"); if (t) { initialTab = t; dd.storage.set("openTab", null); } } catch {} }

  bindParts(mediaEl, {
    fallback: { hidden: () => Boolean(np.value && np.value.art) },
    title: { textContent: () => (np.value && np.value.title) || "Unknown title" },
    artist: { textContent: () => (np.value && np.value.artist) || "" },
    album: { textContent: () => (np.value && np.value.album) || "" },
    seekRow: { hidden: () => !(np.value && np.value.position) },
    elapsed: { textContent: () => fmt(shownSeconds.value) },
    total: { textContent: () => fmt((np.value && np.value.position && np.value.position.durationSeconds) || 0) },
  });
  effect(() => {
    const art = np.value && np.value.art;
    if (art) { if (artEl.getAttribute("src") !== art) artEl.src = art; artEl.hidden = false; }
    else { artEl.removeAttribute("src"); artEl.hidden = true; }
    requestAnimationFrame(updateMarquee);
  });
  effect(() => {
    const snap = np.value;
    document.body.classList.toggle("np-active", Boolean(snap && snap.hasSession));
    document.body.classList.toggle("np-playing", Boolean(snap && snap.status === "playing"));
    const playing = Boolean(snap && snap.status === "playing");
    playBtn.setAttribute("name", playing ? "pause" : "play");
    playBtn.title = playing ? "Pause" : "Play";
    playBtn.toggleAttribute("disabled", !(snap && snap.canPlayPause));
    prevBtn.toggleAttribute("disabled", !(snap && snap.canSkipPrevious));
    nextBtn.toggleAttribute("disabled", !(snap && snap.canSkipNext));
    if (snap && snap.position) { seekEl.max = String(Math.max(1, Math.round(snap.position.durationSeconds))); seekEl.disabled = !snap.canSeek; syncSeek(); }
  });
  prevBtn.addEventListener("click", () => dd.media.previous().catch(warn("previous")));
  nextBtn.addEventListener("click", () => dd.media.next().catch(warn("next")));
  playBtn.addEventListener("click", onPlayPause);
  seekEl.addEventListener("pointerdown", () => { dragging = true; });
  seekEl.addEventListener("input", syncSeek);
  seekEl.addEventListener("change", onSeekCommit);
  const endDrag = () => { dragging = false; };
  seekEl.addEventListener("pointerup", endDrag);
  seekEl.addEventListener("pointercancel", endDrag);

  dd.media.onNowPlaying((snap) => { np.value = snap; });
  const seed = await dd.media.status().catch(warn("status"));
  if (np.peek() === null && seed) np.value = seed;
  setInterval(() => { const s = np.peek(); if (s && s.status === "playing" && s.position && !dragging) syncSeek(); }, 500);

  soundEl.append(create("dd-volume-pill"));

  bindParts(systemEl, { ...meterRow("cpu"), ...meterRow("ram"), ...meterRow("gpu"), ...meterRow("battery") });
  effect(renderChips);
  dd.system.onVitals((v) => { vitals.value = v; });
  const status = await dd.system.status().catch(warn("system status"));
  if (status) vitals.value = status;

  effect(renderDrives);
  setupNetGraph();
  setupTabs(deckSettings, initialTab);
  void setupWeather(deckSettings);
  addEventListener("resize", updateMarquee);
}

main().catch((err) => dd.log("error", "pulseglass dock deck boot failed", String(err)));

// Pulseglass Dock — a living glass taskbar for DeskDash.
//
// Three glass segments (left / centre / right) each capture only their own box,
// so the gaps between them click through. Each carries a slice of the light
// field (reacts to audio, breathes with the CPU), painted from one shared rAF
// loop. On top ride the dock behaviours: magnification, a breathing pulse, a
// five-face clock, number vitals, a split network readout and a now-playing
// deck. Inspired by Aurora, rebuilt as a full dock.

const { create, bindParts, signal, effect, token } = dd.ui;

const apps = document.getElementById("apps");
const segs = Array.from(document.querySelectorAll(".seg"));
const clockEl = document.getElementById("clock");
const clockFaceCv = document.getElementById("clock-face");
const npEl = document.getElementById("np");
const vitalsEl = document.getElementById("vitals");
const netEl = document.getElementById("net");
const startEl = document.getElementById("start");
const startImg = document.getElementById("start-img");
const startLogo = document.getElementById("start-logo");
const startLabel = document.getElementById("start-label");
const hostStart = document.getElementById("host-start");
const badgesEl = document.getElementById("badges");
const centerCanvas = document.querySelector("#bar-center .field");
const leftGlass = startEl.parentElement;
const barLeft = document.getElementById("bar-left");
const slotStartRight = document.getElementById("slot-start-right");
const slotDockStart = document.getElementById("slot-dock-start");
const recycleEl = document.getElementById("recycle");
const toolsEl = document.getElementById("tools");
const sepDockStart = document.getElementById("sep-dock-start");
const sepDockEnd = document.getElementById("sep-dock-end");
const sepLeftStart = document.getElementById("sep-left-start");
const sepStartRight = document.getElementById("sep-start-right");
const sepInfoLeft = document.getElementById("sep-info-left");
const sepFar = document.getElementById("sep-far");
const weatherEl = document.getElementById("weather");
const weatherGlyph = document.getElementById("weather-glyph");
const weatherTemp = document.getElementById("weather-temp");
const sepWeather = document.getElementById("sep-weather");
let recycleId = null;

const BANDS = 500, AUDIO_HOLD_MS = 400;
const LAYERS = [
  { token: "--dd-chart-1", scale: 1, shift: 0 },
  { token: "--dd-chart-2", scale: 0.72, shift: 3 },
  { token: "--dd-accent", scale: 0.5, shift: 7 },
];

let store = null, lowMotion = false;
let reactivity = "audio and vitals";
let format24 = false, clockFaceName = "standard", clockSeconds = false, clockDate = true, secondaryTz = "", faceOverride = null;
let magnifyOn = true, magStrength = 0.6, magReach = 2;
let magApps = true, magStart = true, magMedia = true, magRecycle = true, magTools = true;
let breatheOn = true, breatheSecs = 5;
let bApps = true, bStart = true, bMedia = true, bRecycle = true, bVitals = true, bNet = true, bWeather = true, bClock = true, bTray = true, bTools = true;
let badgesOn = false;
let warnAt = 50, dangerAt = 90;
let netMode = "dyn-bytes"; // "mbs" | "mbps" | "dyn-bytes" | "dyn-bits"
let lastStartImage = undefined;
let customField = false, fieldColors = ["#4ade80", "#38bdf8", "#a78bfa"], glowMul = 1;

function hexRgb(hex) {
  const h = String(hex).replace("#", "");
  const s = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const n = parseInt(s.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const shared = { bands: new Float32Array(BANDS), lastAudioAt: 0, cpu: 0, colors: [], accent: [255, 255, 255] };
let raf = 0, lastDrawAt = 0;

// ---- light field (one instance per segment canvas) -----------------------
function rgbOf(g, name) {
  g.fillStyle = token(name, "#888888");
  const norm = String(g.fillStyle);
  if (norm.startsWith("#")) { const n = parseInt(norm.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const m = norm.match(/[\d.]+/g) || []; return [Number(m[0]) || 0, Number(m[1]) || 0, Number(m[2]) || 0];
}
function readPalette() {
  if (customField) { shared.colors = fieldColors.map(hexRgb); shared.accent = hexRgb(fieldColors[0]); return; }
  const g = (fields[0] ? fields[0].g : centerCanvas.getContext("2d"));
  shared.colors = LAYERS.map((l) => rgbOf(g, l.token));
  shared.accent = rgbOf(g, "--dd-accent");
}
const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
const still = () => lowMotion || reactivity === "calm";
const audioLive = (now) => !still() && now - shared.lastAudioAt < AUDIO_HOLD_MS;
function columnBand(i, cols) { const half = (cols - 1) / 2; return Math.min(BANDS - 1, Math.round((Math.abs(i - half) / half) * (BANDS - 1))); }
function idleTarget(i, cols, t) {
  const base = reactivity === "audio and vitals" && !still() ? 0.12 + 0.32 * shared.cpu : 0.2;
  const x = i / cols, a = 0.5 + 0.5 * Math.sin(x * 9.5 + t * 0.00045), b = 0.5 + 0.5 * Math.sin(x * 3.1 - t * 0.00028);
  return base + 0.22 * a * (0.5 + 0.5 * b);
}
function makeField(canvas) {
  const g = canvas.getContext("2d");
  const f = { canvas, g, w: 0, h: 0, cols: 0, target: new Float32Array(0), shown: new Float32Array(0),
    torch: { x: 0, a: 0, on: false }, halo: { x: -1, a: 0 }, isCenter: canvas === centerCanvas };
  f.resize = () => {
    const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    f.w = rect.width; f.h = rect.height;
    canvas.width = Math.max(1, Math.round(rect.width * dpr)); canvas.height = Math.max(1, Math.round(rect.height * dpr));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cols = Math.max(24, Math.min(160, Math.round(rect.width / 22)));
    if (cols !== f.cols) { f.cols = cols; f.target = new Float32Array(cols); f.shown = new Float32Array(cols); }
  };
  f.step = (now, live) => {
    const { cols, target, shown } = f;
    for (let i = 0; i < cols; i++) {
      if (live) {
        const b0 = columnBand(i, cols), b1 = columnBand(Math.min(i + 1, cols - 1), cols);
        const lo = Math.min(b0, b1), hi = Math.max(b0, b1);
        let sum = 0; for (let k = lo; k <= hi; k++) sum += shared.bands[k];
        target[i] = 0.06 + 0.9 * (sum / (hi - lo + 1));
      } else target[i] = idleTarget(i, cols, now);
      const cur = shown[i], rate = live ? (target[i] > cur ? 0.5 : 0.14) : 0.06;
      shown[i] = cur + (target[i] - cur) * rate;
    }
    f.torch.a += ((f.torch.on ? 1 : 0) - f.torch.a) * 0.12;
    if (f.isCenter) f.halo.a = f.halo.x < 0 ? 0 : 0.14 + 0.06 * Math.sin(now * 0.0018);
  };
  f.glow = (x, radius, alpha) => {
    const grad = g.createRadialGradient(x, f.h, 0, x, f.h, radius);
    grad.addColorStop(0, rgba(shared.accent, alpha)); grad.addColorStop(0.5, rgba(shared.accent, alpha * 0.35)); grad.addColorStop(1, rgba(shared.accent, 0));
    g.fillStyle = grad; g.fillRect(x - radius, 0, radius * 2, f.h);
  };
  f.draw = (now, live) => {
    const { w, h, cols, shown } = f; if (!w) return;
    const pulse = live ? 1 : 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(now * 0.0016));
    const lg = Math.min(1.8, 0.55 + 0.45 * glowMul);
    g.clearRect(0, 0, w, h); g.globalCompositeOperation = "lighter";
    const dx = w / (cols - 1);
    for (let k = 0; k < LAYERS.length; k++) {
      const layer = LAYERS[k], color = shared.colors[k] || shared.accent;
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, rgba(color, 0.44 * pulse * lg)); grad.addColorStop(0.55, rgba(color, 0.17 * pulse * lg)); grad.addColorStop(1, rgba(color, 0.02));
      g.fillStyle = grad; g.beginPath(); g.moveTo(0, h);
      const idx = (i) => (i + layer.shift) % cols;
      let prevX = 0, prevY = h - shown[idx(0)] * layer.scale * h * 0.96; g.lineTo(prevX, prevY);
      for (let i = 1; i < cols; i++) { const x = i * dx, y = h - shown[idx(i)] * layer.scale * h * 0.96; g.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2); prevX = x; prevY = y; }
      g.lineTo(w, prevY); g.lineTo(w, h); g.closePath(); g.fill();
    }
    if (f.torch.a > 0.01) f.glow(f.torch.x, h * 2.2, Math.min(0.7, 0.34 * f.torch.a * glowMul));
    if (f.isCenter && f.halo.a > 0.01) f.glow(f.halo.x, h * 1.6, Math.min(0.5, f.halo.a * glowMul));
    g.globalCompositeOperation = "source-over";
  };
  f.stillFrame = () => { for (let i = 0; i < f.cols; i++) f.shown[i] = idleTarget(i, f.cols, 0); f.torch.a = 0; f.halo.a = 0; f.draw(0, false); };
  f.resize(); return f;
}
let fields = [];
function frame(now) {
  raf = 0;
  if (still()) { fields.forEach((f) => f.stillFrame()); return; }
  const live = audioLive(now), interval = live ? 33 : 50;
  if (now - lastDrawAt >= interval - 1) { lastDrawAt = now; fields.forEach((f) => { f.step(now, live); f.draw(now, live); }); }
  raf = requestAnimationFrame(frame);
}
function wake() { if (!raf) raf = requestAnimationFrame(frame); }
function onSpectrum({ bins }) {
  if (still()) return;
  let any = false; const n = Math.min(BANDS, bins.length);
  for (let i = 0; i < n; i++) { const v = bins[i]; shared.bands[i] = v; if (v > 0.004) any = true; }
  if (any) shared.lastAudioAt = performance.now();
}
function updateHalo() {
  const center = fields.find((f) => f.isCenter); if (!center) return;
  const focused = store.entries.peek().find((e) => e.wins.some((w) => w.focused));
  const el = focused ? apps.appFor(focused.key) : null;
  if (!el || el.hasAttribute("leaving")) { center.halo.x = -1; return; }
  const r = el.getBoundingClientRect(), left = center.canvas.getBoundingClientRect().left;
  center.halo.x = r.left + r.width / 2 - left; wake();
}

// ---- pointer: torch + magnification --------------------------------------
let hoverActive = false;
function onMove(e) {
  hoverActive = true;
  if (breatheRAF) { cancelAnimationFrame(breatheRAF); endBreathe(); }
  document.body.classList.remove("breathing");
  if (!still()) {
    for (const f of fields) {
      const r = f.canvas.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right) { f.torch.x = e.clientX - r.left; f.torch.on = true; } else f.torch.on = false;
    }
    wake();
  }
  magnify(e.clientX);
}
function onLeave() { hoverActive = false; for (const f of fields) f.torch.on = false; resetMag(); wake(); }

let magHosts = [];
// Every dock item (start/recycle/now-playing + app icons), for magnify hover.
function allDockItems() {
  return [startEl, recycleEl, toolsEl, document.getElementById("deck")].filter((el) => el && !el.hidden)
    .concat(Array.from(apps.querySelectorAll("dd-app")));
}
// Every element breathing can touch (readouts included), for reset.
function allBreathable() {
  return [startEl, recycleEl, toolsEl, document.getElementById("deck"), vitalsEl, netEl, weatherEl, clockEl, document.querySelector(".tray")]
    .filter(Boolean).concat(Array.from(apps.querySelectorAll("dd-app")));
}
// The subset breathing animates, per the per-item breathe toggles.
function breatheHosts() {
  const out = [];
  const deckEl = document.getElementById("deck"), trayEl = document.querySelector(".tray");
  if (bApps) out.push(...Array.from(apps.querySelectorAll("dd-app")));
  if (bStart) out.push(startEl);
  if (bMedia && deckEl) out.push(deckEl);
  if (bRecycle && !recycleEl.hidden) out.push(recycleEl);
  if (bTools && !toolsEl.hidden) out.push(toolsEl);
  if (bVitals) out.push(vitalsEl);
  if (bNet) out.push(netEl);
  if (bWeather && !weatherEl.hidden) out.push(weatherEl);
  if (bClock && !clockEl.hidden) out.push(clockEl);
  if (bTray && trayEl) out.push(trayEl);
  return out.filter(Boolean);
}
// Only the items whose per-item magnify toggle is on (and the master is on).
function refreshMagHosts() {
  const list = [];
  if (!magnifyOn) { magHosts = []; return; }
  const deckEl = document.getElementById("deck");
  if (magApps) list.push(...Array.from(apps.querySelectorAll("dd-app")));
  if (magStart && !startEl.hidden) list.push(startEl);
  if (magMedia && deckEl && !deckEl.hidden) list.push(deckEl);
  if (magRecycle && !recycleEl.hidden) list.push(recycleEl);
  if (magTools && !toolsEl.hidden) list.push(toolsEl);
  magHosts = list;
}
function setVars(el, s, lift) { el.style.setProperty("--mag-scale", s.toFixed(3)); el.style.setProperty("--mag-lift", lift.toFixed(1) + "px"); }
function magnify(px) {
  if (!magnifyOn) return resetMag();
  const reach = Math.max(1, magReach);
  for (const el of magHosts) {
    const r = el.getBoundingClientRect(); if (!r.width) continue;
    const c = r.left + r.width / 2, sigma = r.width * reach, d = px - c;
    const gg = Math.exp(-(d * d) / (2 * sigma * sigma));
    setVars(el, 1 + magStrength * gg, magStrength * gg * 14);
  }
}
function resetMag() { for (const el of magHosts) { el.style.removeProperty("--mag-scale"); el.style.removeProperty("--mag-lift"); } }

// ---- breathing pulse (JS-driven, shares the magnify channel) --------------
let breatheTimer = null, breatheRAF = 0;
const BREATHE_AMP = 0.12, BREATHE_DUR = 2200, WAVE = 0.5, STAGGER = 0.06;
function scheduleBreathe() {
  if (breatheTimer) { clearInterval(breatheTimer); breatheTimer = null; }
  if (!breatheOn || !breatheSecs || lowMotion) return;
  breatheTimer = setInterval(runBreathe, breatheSecs * 1000);
}
// Breathing resets every dock item (it runs on all of them, not just the
// magnify set), so nothing is left with a stuck transform.
function endBreathe() { allBreathable().forEach((el) => setVars(el, 1, 0)); document.body.classList.remove("breathing"); breatheRAF = 0; }
function runBreathe() {
  if (document.hidden || hoverActive) return;
  const items = breatheHosts(), start = performance.now();
  cancelAnimationFrame(breatheRAF);
  document.body.classList.add("breathing"); // pulses the start words (CSS)
  const tick = (now) => {
    if (hoverActive) return endBreathe(); // hover takes the channel
    const t = (now - start) / BREATHE_DUR;
    if (t >= 1) return endBreathe();
    items.forEach((el, i) => {
      const phase = t - i * STAGGER;
      const a = phase > 0 && phase < WAVE ? Math.sin((phase / WAVE) * Math.PI) : 0;
      setVars(el, 1 + BREATHE_AMP * a, BREATHE_AMP * a * 14);
    });
    breatheRAF = requestAnimationFrame(tick);
  };
  breatheRAF = requestAnimationFrame(tick);
}

// ---- open the deck on a specific tab --------------------------------------
// The popout is a separate document, so localStorage doesn't cross into it —
// pass the tab through the popout's own data channel; fall back to storage +
// the chip's own pane trigger if programmatic open isn't available.
function openDeck(tab, anchor) {
  try { dd.popout.open({ size: { w: 560, h: 360 }, anchor, prefer: "up", data: { tab } }); return; }
  catch (e) { dd.log("warn", "popout.open failed", (e && e.code) || String(e)); }
  try { dd.storage.set("openTab", tab); } catch {}
  document.getElementById("deck").click();
}

// ---- clock ----------------------------------------------------------------
const FACES = ["standard", "large", "analog", "worded", "dual"];
const SLOTS = { "left edge (right)": "slot-start-right", "left edge (left)": "slot-start-left", "by info (left)": "slot-info-left", "far right": "slot-far-right" };
const WORDS = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
const MINWORDS = { 5: "five past", 10: "ten past", 15: "quarter past", 20: "twenty past", 25: "twenty-five past", 30: "half past", 35: "twenty-five to", 40: "twenty to", 45: "quarter to", 50: "ten to", 55: "five to" };
const time = signal(""), date = signal("");
const face = () => faceOverride || clockFaceName;
function hhmm(d, secs) { const o = { hour: format24 ? "2-digit" : "numeric", minute: "2-digit", hour12: !format24 }; if (secs) o.second = "2-digit"; return d.toLocaleTimeString([], o); }
const dateStr = (d) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
function worded(d) {
  const h = d.getHours();
  let r = Math.round(d.getMinutes() / 5) * 5;
  if (r === 0) return `${WORDS[h % 12]} o'clock`;
  if (r === 60) return `${WORDS[(h + 1) % 12]} o'clock`;
  const hour = r >= 35 ? (h + 1) % 12 : h % 12; // "…to" points at the coming hour
  return `${MINWORDS[r]} ${WORDS[hour]}`;
}
function tzTime(d, tz) { try { return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", hour12: !format24, timeZone: tz }).format(d); } catch { return "—"; } }
function drawAnalog(d) {
  const cv = clockFaceCv, x = cv.width / 2, y = cv.height / 2, r = x - 8, g = cv.getContext("2d");
  g.clearRect(0, 0, cv.width, cv.height);
  g.strokeStyle = token("--dd-text-muted", "#94a3b8"); g.globalAlpha = 0.5; g.lineWidth = 3; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
  const hand = (frac, len, w, col) => { const a = frac * Math.PI * 2 - Math.PI / 2; g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round"; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke(); };
  const s = d.getSeconds(), m = d.getMinutes(), h = d.getHours() % 12;
  hand((h + m / 60) / 12, r * 0.5, 5, token("--dd-text", "#e7edf5"));
  hand((m + s / 60) / 60, r * 0.78, 3.5, token("--dd-text", "#e7edf5"));
  hand(s / 60, r * 0.85, 1.6, token("--dd-accent", "#7dd3fc"));
}
function renderClock() {
  const d = new Date(), f = face();
  clockEl.dataset.face = f;
  const analog = f === "analog";
  clockFaceCv.hidden = !analog; clockEl.querySelector(".clock__text").hidden = analog;
  if (analog) return drawAnalog(d);
  if (f === "worded") { time.value = worded(d); date.value = clockDate ? dateStr(d) : ""; return; }
  time.value = hhmm(d, clockSeconds);
  if (f === "dual") { const tz = secondaryTz.trim(); date.value = tz ? "· " + tzTime(d, tz) : "set a time zone"; }
  else date.value = clockDate ? dateStr(d) : "";
}
function onTick() { renderClock(); }
clockEl.addEventListener("click", () => { faceOverride = FACES[(FACES.indexOf(face()) + 1) % FACES.length]; renderClock(); });
function placeClock(posKey) {
  const slot = document.getElementById(SLOTS[posKey] || "slot-start-right");
  if (slot && clockEl.parentElement !== slot) slot.appendChild(clockEl);
  const on = !clockEl.hidden;
  sepLeftStart.hidden = !(on && posKey === "left edge (left)");
  sepStartRight.hidden = !(on && posKey === "left edge (right)");
  sepInfoLeft.hidden = !(on && posKey === "by info (left)");
  sepFar.hidden = !(on && posKey === "far right");
  updateEmptySegments();
}

// ---- now playing (+ marquee) ---------------------------------------------
const np = signal(null);
function updateMarquee() {
  const wrap = npEl.querySelector(".np__marquee"), title = npEl.querySelector(".np__title");
  if (!wrap || !title) return;
  const over = title.scrollWidth - wrap.clientWidth;
  if (over > 4 && !lowMotion) { title.classList.add("scroll"); title.style.setProperty("--marq", -over - 8 + "px"); title.style.setProperty("--marq-dur", Math.max(6, (over + 8) / 22) + "s"); }
  else { title.classList.remove("scroll"); title.style.removeProperty("--marq"); }
}

// ---- vitals + network -----------------------------------------------------
const vitals = signal(null);
function pctOf(key) { const v = vitals.value; if (!v) return null; if (key === "ram") return v.ram ? v.ram.percent * 100 : null; return typeof v[key] === "number" ? v[key] * 100 : null; }
const level = (p) => (p == null ? null : p >= dangerAt ? "danger" : p >= warnAt ? "warning" : null);
const numText = (key) => { const p = pctOf(key); return p == null ? "–" : Math.round(p) + "%"; };
function bps(n) { if (n == null) return "–"; if (n >= 1e6) { const m = n / 1e6; return (m >= 100 ? Math.round(m) : m.toFixed(1)) + "M"; } if (n >= 1e3) return Math.round(n / 1e3) + "K"; return Math.round(n) + "B"; }
// Taskbar network reading in the chosen unit. Fixed modes (MB/s, Mbps) always
// use that unit; the dynamic modes pick KB/MB/GB (bytes) or Kbps/Mbps/Gbps
// (bits) by magnitude, so low speeds don't read as "0.0". Returns { val, unit }.
function netNum(x) { return x >= 100 ? String(Math.round(x)) : x >= 10 ? x.toFixed(1) : x.toFixed(2); }
function netFmt(bytesPerSec) {
  if (bytesPerSec == null) return { val: "–", unit: netUnitStatic() };
  const bits = netMode === "mbps" || netMode === "dyn-bits";
  const v = bits ? bytesPerSec * 8 : bytesPerSec; // bits/s or bytes/s
  if (netMode === "mbs") return { val: netNum(v / 1e6), unit: "MB/s" };
  if (netMode === "mbps") return { val: netNum(v / 1e6), unit: "Mbps" };
  // dynamic: scale by magnitude
  const K = bits ? "Kbps" : "KB/s", M = bits ? "Mbps" : "MB/s", G = bits ? "Gbps" : "GB/s", B = bits ? "bps" : "B/s";
  if (v >= 1e9) return { val: netNum(v / 1e9), unit: G };
  if (v >= 1e6) return { val: netNum(v / 1e6), unit: M };
  if (v >= 1e3) return { val: netNum(v / 1e3), unit: K };
  return { val: String(Math.round(v)), unit: B };
}
// A representative unit label when there's no reading yet (for the caption).
function netUnitStatic() {
  if (netMode === "mbs") return "MB/s";
  if (netMode === "mbps") return "Mbps";
  return netMode === "dyn-bits" ? "Mbps" : "MB/s";
}
let loggedNet = false;
function onVitals(v) {
  vitals.value = v;
  shared.cpu = typeof v.cpu === "number" ? Math.max(0, Math.min(1, v.cpu)) : 0;
  // One-shot: record the raw net shape so a suspicious up/down reading can be
  // traced to the host's own rxBps/txBps rather than our display.
  if (!loggedNet && v && v.net) { loggedNet = true; dd.log("info", "net sample", JSON.stringify(v.net)); }
}

// ---- notification badges (opt-in) ----------------------------------------
const UNREAD = /(?:^|\s)\((\d+)\+?\)|\b(\d+)\s+(?:new|unread|message)/i;
function unreadOf(win) { const t = (win.title || win.name || win.caption || "").toString(); const m = t.match(UNREAD); return m ? parseInt(m[1] || m[2], 10) || 0 : 0; }
function refreshBadges() {
  if (!badgesEl) return;
  if (!badgesOn || !store) { if (badgesEl.childElementCount) badgesEl.replaceChildren(); return; }
  const center = fields.find((f) => f.isCenter); if (!center) return;
  const box = center.canvas.getBoundingClientRect();
  const wanted = new Map();
  for (const e of store.entries.peek()) {
    let count = 0; for (const w of e.wins || []) count = Math.max(count, unreadOf(w));
    if (!count) continue;
    const el = apps.appFor && apps.appFor(e.key); if (!el) continue;
    const r = el.getBoundingClientRect();
    wanted.set(e.key, { count, x: r.left + r.width - box.left, y: r.top - box.top });
  }
  const keep = new Set();
  for (const [key, b] of wanted) {
    keep.add(key);
    let node = badgesEl.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!node) { node = document.createElement("span"); node.className = "badge"; node.dataset.key = key; badgesEl.appendChild(node); }
    const txt = b.count > 99 ? "99+" : String(b.count);
    if (node.textContent !== txt) { node.textContent = txt; node.classList.remove("pop"); void node.offsetWidth; node.classList.add("pop"); }
    node.style.transform = `translate(${b.x - 8}px, ${b.y - 2}px)`;
  }
  for (const node of [...badgesEl.children]) if (!keep.has(node.dataset.key)) node.remove();
}

// ---- weather (taskbar chip, via dd.http + open-meteo) ---------------------
let weatherPlace = "", weatherUnits = "fahrenheit", showWeatherChip = false, weatherSecs = 900;
let weatherGeo = null, weatherTimer = null;
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
async function httpJson(url, query) {
  const res = await dd.http.fetch({ url, query });
  if (res && res.json) return res.json;
  try { return JSON.parse((res && res.bodyText) || "{}"); } catch { return null; }
}
async function geocode(place) {
  const q = place.trim();
  if (weatherGeo && weatherGeo.query === q) return weatherGeo;
  const g = await httpJson("https://geocoding-api.open-meteo.com/v1/search", { name: q, count: "1" });
  const r = g && g.results && g.results[0];
  if (!r) throw new Error("no match for " + q);
  weatherGeo = { query: q, lat: r.latitude, lon: r.longitude, label: [r.name, r.admin1, r.country_code].filter(Boolean).join(", ") };
  return weatherGeo;
}
async function refreshWeather() {
  const show = showWeatherChip && !!weatherPlace.trim();
  if (!show) { weatherEl.hidden = true; sepWeather.hidden = true; refreshMagHosts(); return; }
  try {
    const geo = await geocode(weatherPlace);
    const f = await httpJson("https://api.open-meteo.com/v1/forecast", {
      latitude: String(geo.lat), longitude: String(geo.lon),
      current: "temperature_2m,weather_code,is_day", temperature_unit: weatherUnits, timezone: "auto",
    });
    const c = f && f.current;
    if (!c) throw new Error("no current");
    weatherGlyph.textContent = wxEmoji(c.weather_code, !!c.is_day);
    weatherTemp.textContent = Math.round(c.temperature_2m) + "°";
    weatherEl.title = geo.label || weatherPlace;
    weatherEl.hidden = false; sepWeather.hidden = false;
  } catch (e) {
    dd.log("warn", "weather failed", (e && e.code) || String(e));
    weatherGlyph.textContent = "⚠️"; weatherTemp.textContent = ""; weatherEl.title = "Weather unavailable";
    weatherEl.hidden = false; sepWeather.hidden = false; // keep it visible so the failure is obvious
  }
  refreshMagHosts();
}
function scheduleWeather() {
  if (weatherTimer) { clearInterval(weatherTimer); weatherTimer = null; }
  if (showWeatherChip && weatherPlace.trim()) weatherTimer = setInterval(refreshWeather, Math.max(1, weatherSecs) * 1000);
}
weatherEl.addEventListener("click", () => openDeck("weather", weatherEl));

// ---- running-app colour ---------------------------------------------------
function updateRunning() {
  for (const e of store.entries.peek()) { const el = apps.appFor && apps.appFor(e.key); if (el) el.classList.toggle("running", !!(e.wins && e.wins.length)); }
}

// ---- start button ---------------------------------------------------------
startEl.addEventListener("click", () => {
  try { if (dd.bar && dd.bar.openStartMenu) return void dd.bar.openStartMenu(); } catch {}
  try { hostStart.click(); } catch {}
});
function placeStart(placement) {
  if (placement === "in the dock") slotDockStart.after(startEl);
  else leftGlass.insertBefore(startEl, hostStart);
  sepDockStart.hidden = placement !== "in the dock";
  updateEmptySegments();
  updateDockSeps();
}
function updateEmptySegments() {
  const hasStart = leftGlass.contains(startEl);
  const hasClock = !clockEl.hidden && leftGlass.contains(clockEl);
  const hasRecycle = !recycleEl.hidden && leftGlass.contains(recycleEl);
  const hasTools = !toolsEl.hidden && leftGlass.contains(toolsEl);
  barLeft.hidden = !(hasStart || hasClock || hasRecycle || hasTools);
}

// ---- movable-button separators --------------------------------------------
// Recycle / Tools each carry a leading separator, shown whenever something
// visible sits before them in the same glass panel — so they're fenced off
// from Start, the app strip, and each other.
const mkSep = () => { const s = document.createElement("span"); s.className = "sep sep--dock"; s.hidden = true; return s; };
const DOCK_CONTENT = "#start, #apps, .dockbtn, #deck, #vitals, #net, #weather, #clock, .tray";
function hasContentBefore(btn) {
  const panel = btn.closest(".glass"); if (!panel) return false;
  for (const el of panel.querySelectorAll(DOCK_CONTENT)) {
    if (el === btn) return false;
    if (btn.contains(el)) continue;
    if (el.offsetParent !== null && el.getBoundingClientRect().width > 0) return true;
  }
  return false;
}
function updateDockSeps() {
  const pairs = [[recycleEl, sepRecycleLead, () => !recycleEl.hidden],
                 [toolsEl, sepToolsLead, () => !toolsEl.hidden]];
  for (const [el, sep, shown] of pairs) sep.hidden = !(shown() && hasContentBefore(el));
}

// ---- recycle bin -----------------------------------------------------------
const RECYCLE_SLOTS = { "in the dock": "slot-dock-end", "left edge": "slot-start-right", "left of info": "slot-info-left", "far right": "slot-info-right" };
const sepRecycleLead = mkSep(), sepToolsLead = mkSep();
let wantRecycle = false, recyclePos = "in the dock", desktopSrcKey = "desktopSrc", recycleItem = null;
function placeRecycle() {
  const slot = document.getElementById(RECYCLE_SLOTS[recyclePos] || "slot-dock-end");
  if (slot) { slot.appendChild(recycleEl); slot.insertBefore(sepRecycleLead, recycleEl); }
  recycleEl.hidden = !wantRecycle;
  sepDockEnd.hidden = true; // the recycle bin now carries its own leading separator
  refreshMagHosts();
  updateEmptySegments();
  updateDockSeps();
}
async function findRecycle() {
  // The desktop's Recycle Bin virtual item, so "default handler" mode can
  // double-click it (respecting Directory Opus if it's set to replace Explorer);
  // the system-apps catalog is the Explorer path.
  try {
    const res = await dd.folders.list(desktopSrcKey);
    const items = (res && res.items) || [];
    dd.log("info", "desktop items: " + items.map((i) => i.name).join(", "));
    const it = items.find((i) => /recycle|trash/i.test(i.name || ""));
    if (it) recycleItem = { src: desktopSrcKey, id: it.id };
  } catch (e) { dd.log("warn", "desktop list failed", (e && e.code) || String(e)); }
  try {
    const r = await dd.apps.list();
    const bin = ((r && r.apps) || []).find((a) => /recycle/i.test(a.name || a.id || ""));
    recycleId = bin ? bin.id : null;
  } catch (e) { dd.log("warn", "apps.list failed", (e && e.code) || String(e)); }
  dd.log("info", "recycle: desktop item " + (recycleItem ? "found" : "NOT found") + ", apps id " + (recycleId ? "found" : "NOT found"));
}
function recycleViaExplorer() {
  if (recycleId) dd.apps.launch(recycleId).catch((e) => dd.log("warn", "recycle launch", (e && e.code) || String(e)));
  else if (recycleItem) dd.folders.open(recycleItem.src, recycleItem.id).catch(() => {});
}
recycleEl.addEventListener("click", () => {
  // Open the Recycle Bin the most reliable way available: the desktop's bin
  // item, else the shell folder, else the system-apps entry.
  if (recycleItem) {
    dd.folders.open(recycleItem.src, recycleItem.id).catch((e) => {
      dd.log("warn", "recycle folders.open failed, trying shell:", (e && e.code) || String(e));
      dd.links.open("shell:RecycleBinFolder").catch(recycleViaExplorer);
    });
    return;
  }
  dd.links.open("shell:RecycleBinFolder").catch((e) => { dd.log("warn", "recycle links.open failed", (e && e.code) || String(e)); recycleViaExplorer(); });
});
// ---- tools button ----------------------------------------------------------
// Shares the recycle bin's slot map (the same four dock anchors).
let wantTools = true, toolsPos = "left edge";
function placeTools() {
  const slot = document.getElementById(RECYCLE_SLOTS[toolsPos] || "slot-start-right");
  if (slot) { slot.appendChild(toolsEl); slot.insertBefore(sepToolsLead, toolsEl); }
  toolsEl.hidden = !wantTools;
  refreshMagHosts();
  updateEmptySegments();
  updateDockSeps();
}
// Tools opens a popout (app launches are allowed there). Slightly taller with
// bottom padding so the last item (Control Panel) isn't clipped.
toolsEl.addEventListener("click", () => {
  try { dd.popout.open({ size: { w: 232, h: 250 }, anchor: toolsEl, prefer: "up", data: { view: "tools" } }); }
  catch (err) { dd.log("warn", "tools popout failed", (err && err.code) || String(err)); }
});

async function applyStartImage(pathVal) {
  if (pathVal === lastStartImage) return;
  lastStartImage = pathVal;
  if (!pathVal) { startImg.hidden = true; startImg.style.backgroundImage = ""; startLogo.hidden = false; return; }
  try {
    const img = await dd.image.load("startImage");
    startImg.style.backgroundImage = `url(${img.dataUrl})`;
    startImg.hidden = false; startLogo.hidden = true;
  } catch (e) { dd.log("warn", "start image load failed", (e && e.code) || String(e)); startImg.hidden = true; startLogo.hidden = false; }
}

// ---- tokens / boot --------------------------------------------------------
async function main() {
  store = dd.bar.store();
  await store.ready;
  lowMotion = store.lowMotion.peek();
  if (lowMotion) document.body.classList.add("low-motion");

  fields = Array.from(document.querySelectorAll(".field")).map(makeField);
  readPalette();

  await findRecycle(); // locate the Recycle Bin (desktop item preferred, apps fallback)

  bindParts(clockEl, { time: { textContent: time }, date: { textContent: date } });
  dd.time.onTick(onTick); onTick();
  setInterval(renderClock, 1000); // drive from real time so it never lags a tick

  const artEl = npEl.querySelector('[data-bind="art"]');
  bindParts(npEl, {
    fallback: { hidden: () => Boolean(np.value && np.value.art) },
    title: { textContent: () => (np.value && np.value.title) || "" },
    artist: { textContent: () => (np.value && (np.value.artist || np.value.album)) || "" },
  });
  effect(() => { const art = np.value && np.value.art; if (art) { if (artEl.getAttribute("src") !== art) artEl.src = art; artEl.hidden = false; } else { artEl.removeAttribute("src"); artEl.hidden = true; } });
  effect(() => {
    const s = np.value;
    document.body.classList.toggle("np-active", Boolean(s && s.hasSession));
    document.body.classList.toggle("np-playing", Boolean(s && s.status === "playing"));
    requestAnimationFrame(updateMarquee);
  });
  dd.media.onNowPlaying((s) => { np.value = s; });
  dd.media.status().then((seed) => { if (np.peek() === null && seed) np.value = seed; }).catch((e) => dd.log("warn", "media seed", String(e)));

  bindParts(vitalsEl, {
    cpu: { textContent: () => numText("cpu") }, ram: { textContent: () => numText("ram") }, gpu: { textContent: () => numText("gpu") },
    "v-cpu": { "data-level": () => level(pctOf("cpu")) },
    "v-ram": { "data-level": () => level(pctOf("ram")) },
    "v-gpu": { "data-level": () => level(pctOf("gpu")), hidden: () => pctOf("gpu") == null },
  });
  const netInline = () => document.body.classList.contains("net-inline");
  const netVal = (key) => {
    const n = vitals.value && vitals.value.net; if (!n) return "–";
    const f = netFmt(n[key]);
    // Side-by-side puts the unit in the caption; stacked has no caption row, so
    // the unit rides with the value there.
    return netInline() ? f.val : `${f.val} ${f.unit}`;
  };
  const netCap = (key, arrow) => {
    const n = vitals.value && vitals.value.net;
    return `${arrow} ${n ? netFmt(n[key]).unit : netUnitStatic()}`;
  };
  bindParts(netEl, {
    "net-rx": { textContent: () => netVal("rxBps") },
    "net-tx": { textContent: () => netVal("txBps") },
    "cap-rx": { textContent: () => netCap("rxBps", "↓") },
    "cap-tx": { textContent: () => netCap("txBps", "↑") },
  });
  vitalsEl.addEventListener("click", () => openDeck("sys", vitalsEl));
  netEl.addEventListener("click", () => openDeck("net", netEl));
  dd.system.onVitals(onVitals);
  dd.system.status().then((seed) => { if (seed) onVitals(seed); }).catch((e) => dd.log("warn", "vitals seed", String(e)));

  dd.theme.onChange(() => { readPalette(); renderClock(); wake(); });
  const ro = new ResizeObserver(() => { fields.forEach((f) => f.resize()); wake(); });
  segs.forEach((s) => ro.observe(s));
  dd.audio.onSpectrum(onSpectrum);
  for (const s of segs) { s.addEventListener("pointermove", onMove); s.addEventListener("pointerleave", onLeave); }
  // Right-click is left to DeskDash's own dock menu — the Tools sheet is the
  // #tools button instead, so nothing shadows the host options.
  apps.addEventListener("dd-change", () => { updateHalo(); refreshBadges(); updateRunning(); });
  effect(() => { store.entries.value; requestAnimationFrame(() => { refreshMagHosts(); updateHalo(); refreshBadges(); updateRunning(); updateDockSeps(); }); });

  dd.settings.bind((s) => {
    reactivity = String(s.reactivity || "audio and vitals");
    customField = s.customField === true;
    fieldColors = [s.fieldColorA || "#4ade80", s.fieldColorB || "#38bdf8", s.fieldColorC || "#a78bfa"];
    glowMul = Math.max(0, (s.fieldGlow ?? 100) / 100);
    readPalette();
    format24 = s.format24h === true;
    clockFaceName = String(s.clockFace || "standard");
    clockSeconds = s.clockSeconds === true; clockDate = s.clockDate !== false; secondaryTz = String(s.secondaryTz || "");
    magnifyOn = s.magnify !== false;
    magApps = s.magnifyApps !== false; magStart = s.magnifyStart !== false;
    magMedia = s.magnifyMedia !== false; magRecycle = s.magnifyRecycle !== false; magTools = s.magnifyTools !== false;
    magStrength = Math.max(0, Math.min(1, (s.magnifyStrength ?? 60) / 100));
    magReach = Math.max(1, Math.min(6, s.magnifyReach ?? 2));
    breatheOn = s.breathing !== false; breatheSecs = s.breathingInterval ?? 5;
    bApps = s.breatheApps !== false; bStart = s.breatheStart !== false; bMedia = s.breatheMedia !== false;
    bRecycle = s.breatheRecycle !== false; bTools = s.breatheTools !== false; bVitals = s.breatheVitals !== false; bNet = s.breatheNet !== false;
    bWeather = s.breatheWeather !== false; bClock = s.breatheClock !== false; bTray = s.breatheTray !== false;
    badgesOn = s.badges === true;
    weatherPlace = String(s.weatherPlace || "");
    weatherUnits = String(s.weatherUnits || "fahrenheit");
    weatherSecs = Math.max(1, Math.min(3600, s.weatherInterval ?? 900));
    showWeatherChip = s.showWeatherChip === true;
    scheduleWeather();
    void refreshWeather();
    warnAt = s.vitalsWarnAt ?? 50; dangerAt = s.vitalsDangerAt ?? 90;
    const rs = document.documentElement.style;
    rs.setProperty("--v-normal", s.vitalsNormalColor || "#e7edf5");
    rs.setProperty("--v-warn", s.vitalsWarnColor || "#f59e0b");
    rs.setProperty("--v-danger", s.vitalsDangerColor || "#f87171");
    rs.setProperty("--start-scale", ((s.startSize ?? 100) / 100).toFixed(2));
    rs.setProperty("--edge-pad", (s.edgePadding ?? 25) + "px");
    rs.setProperty("--spacer", (s.spacing ?? 8) + "px");
    wantRecycle = s.showRecycleBin === true;
    recyclePos = String(s.recyclePosition || "in the dock");
    placeRecycle();
    wantTools = s.showTools !== false;
    toolsPos = String(s.toolsPosition || "left edge");
    placeTools();

    // Start button
    startLabel.textContent = s.startLabel || "Start";
    startLabel.hidden = !(s.startLabel && String(s.startLabel).trim());
    void applyStartImage((s.startImage || "").trim());
    placeStart(String(s.startPlacement || "left edge"));

    // Running-app colour
    const run = String(s.runningStyle || "dots");
    document.body.classList.toggle("running-colour", run === "colour" || run === "colour + dots");
    document.body.classList.toggle("hide-dots", run === "colour");
    rs.setProperty("--idle-dim", (100 - (s.dimIdle ?? 45)) / 100);

    document.body.classList.toggle("no-magnify", !magnifyOn);
    document.body.classList.toggle("net-inline", String(s.netLayout || "stacked") === "side by side");
    netMode = { "MB/s": "mbs", "Mbps": "mbps", "Dynamic (KB/MB/GB)": "dyn-bytes", "Dynamic (Kbps/Mbps/Gbps)": "dyn-bits" }[String(s.netUnit || "")] || "dyn-bytes";

    clockEl.hidden = s.showClock === false;
    placeClock(String(s.clockPosition || "far right"));
    document.body.classList.toggle("show-media", s.showMedia !== false);
    document.body.classList.toggle("show-vitals", s.showVitals !== false);
    document.body.classList.toggle("show-net", s.showNet !== false);

    if (!magnifyOn) resetMag();
    refreshMagHosts();
    scheduleBreathe();
    renderClock();
    refreshBadges();
    requestAnimationFrame(updateMarquee);
    wake();
  });

  refreshMagHosts();
}
main().catch((err) => dd.log("error", "pulseglass dock boot failed", String(err)));

// Aurora Dock — a dock-style evolution of the Aurora bar.
//
// It keeps Aurora's living light field (canvas that dances to audio and
// breathes with the CPU) and its host-driven app strip, and adds the things
// that make it feel like a dock:
//   • true magnification — the icon under the pointer rises most and its
//     neighbours rise proportionally less (Gaussian falloff), driven through
//     custom properties the component's ::part(lift) reads;
//   • a breathing pulse on a timer;
//   • a clock with five faces;
//   • vitals as number percents;
//   • notification badges floated over the app strip from window titles.
//
// The field code is adapted from Aurora (deskdash.aurora) — same perf
// contract: the spectrum handler only stashes the frame, the loop paces
// itself and parks in the calm / low-motion states.

const { create, bindParts, signal, effect, token } = dd.ui;

const apps = document.getElementById("apps");
const strip = document.getElementById("bar");
const canvas = document.getElementById("field");
const ctx2d = canvas.getContext("2d");
const clockEl = document.getElementById("clock");
const clockFace = document.getElementById("clock-face");
const npEl = document.getElementById("np");
const vitalsEl = document.getElementById("vitals");
const startEl = document.getElementById("start");
const launcherEl = document.getElementById("launcher");
const badgesEl = document.getElementById("badges");

const BANDS = 500;
const AUDIO_HOLD_MS = 400;
const LAYERS = [
  { token: "--dd-chart-1", scale: 1, shift: 0 },
  { token: "--dd-chart-2", scale: 0.72, shift: 3 },
  { token: "--dd-accent", scale: 0.5, shift: 7 },
];

let store = null;
let lowMotion = false;

// live settings
let reactivity = "audio and vitals";
let format24 = false;
let clockFaceName = "stacked";
let clockSeconds = false;
let clockDate = true;
let secondaryTz = "";
let faceOverride = null; // clicking the clock cycles faces locally
let magnifyOn = true, magStrength = 0.6, magReach = 3;
let breatheOn = true, breatheSecs = 45;
let badgesOn = true;

// ---- the light field (adapted from Aurora) --------------------------------

const field = {
  w: 0, h: 0, cols: 0,
  target: new Float32Array(0), shown: new Float32Array(0), bands: new Float32Array(BANDS),
  lastAudioAt: 0, cpu: 0, raf: 0, lastDrawAt: 0,
  colors: [], accent: [255, 255, 255],
  torch: { x: 0, a: 0, on: false }, halo: { x: -1, a: 0 },
};

function rgbOf(name) {
  ctx2d.fillStyle = token(name, "#888888");
  const norm = String(ctx2d.fillStyle);
  if (norm.startsWith("#")) {
    const n = parseInt(norm.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const m = norm.match(/[\d.]+/g) || [];
  return [Number(m[0]) || 0, Number(m[1]) || 0, Number(m[2]) || 0];
}
function readPalette() { field.colors = LAYERS.map((l) => rgbOf(l.token)); field.accent = rgbOf("--dd-accent"); }
function rgba([r, g, b], a) { return `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`; }

function resize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  field.w = rect.width; field.h = rect.height;
  canvas.width = Math.max(1, Math.round(rect.width * dpr));
  canvas.height = Math.max(1, Math.round(rect.height * dpr));
  ctx2d.setTransform(dpr, 0, 0, dpr, 0, 0);
  const cols = Math.max(64, Math.min(160, Math.round(rect.width / 24)));
  if (cols !== field.cols) { field.cols = cols; field.target = new Float32Array(cols); field.shown = new Float32Array(cols); }
  wake();
}
function still() { return lowMotion || reactivity === "calm"; }
function audioLive(now) { return !still() && now - field.lastAudioAt < AUDIO_HOLD_MS; }
function columnBand(i, cols) { const half = (cols - 1) / 2; return Math.min(BANDS - 1, Math.round((Math.abs(i - half) / half) * (BANDS - 1))); }
function idleTarget(i, cols, t) {
  const base = reactivity === "audio and vitals" && !still() ? 0.1 + 0.3 * field.cpu : 0.16;
  const x = i / cols;
  const a = 0.5 + 0.5 * Math.sin(x * 9.5 + t * 0.00045);
  const b = 0.5 + 0.5 * Math.sin(x * 3.1 - t * 0.00028);
  return base + 0.14 * a * (0.5 + 0.5 * b);
}
function step(now) {
  const { cols, target, shown, bands } = field;
  const live = audioLive(now);
  for (let i = 0; i < cols; i++) {
    if (live) {
      const b0 = columnBand(i, cols), b1 = columnBand(Math.min(i + 1, cols - 1), cols);
      const lo = Math.min(b0, b1), hi = Math.max(b0, b1);
      let sum = 0; for (let k = lo; k <= hi; k++) sum += bands[k];
      target[i] = 0.06 + 0.9 * (sum / (hi - lo + 1));
    } else target[i] = idleTarget(i, cols, now);
    const cur = shown[i];
    const rate = live ? (target[i] > cur ? 0.5 : 0.14) : 0.06;
    shown[i] = cur + (target[i] - cur) * rate;
  }
  field.torch.a += ((field.torch.on ? 1 : 0) - field.torch.a) * 0.12;
  field.halo.a = field.halo.x < 0 ? 0 : 0.14 + 0.06 * Math.sin(now * 0.0018);
}
function columnIndex(i, cols, layer) { return (i + layer.shift) % cols; }
function glow(x, radius, alpha) {
  const { h, accent } = field;
  const grad = ctx2d.createRadialGradient(x, h, 0, x, h, radius);
  grad.addColorStop(0, rgba(accent, alpha)); grad.addColorStop(0.5, rgba(accent, alpha * 0.35)); grad.addColorStop(1, rgba(accent, 0));
  ctx2d.fillStyle = grad; ctx2d.fillRect(x - radius, 0, radius * 2, h);
}
function draw() {
  const { w, h, cols, shown, colors } = field;
  ctx2d.clearRect(0, 0, w, h);
  ctx2d.globalCompositeOperation = "lighter";
  const dx = w / (cols - 1);
  for (let k = 0; k < LAYERS.length; k++) {
    const layer = LAYERS[k], color = colors[k] || field.accent;
    const grad = ctx2d.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, rgba(color, 0.42)); grad.addColorStop(0.55, rgba(color, 0.16)); grad.addColorStop(1, rgba(color, 0.02));
    ctx2d.fillStyle = grad; ctx2d.beginPath(); ctx2d.moveTo(0, h);
    let prevX = 0, prevY = h - shown[columnIndex(0, cols, layer)] * layer.scale * h * 0.96;
    ctx2d.lineTo(prevX, prevY);
    for (let i = 1; i < cols; i++) {
      const x = i * dx, y = h - shown[columnIndex(i, cols, layer)] * layer.scale * h * 0.96;
      ctx2d.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
      prevX = x; prevY = y;
    }
    ctx2d.lineTo(w, prevY); ctx2d.lineTo(w, h); ctx2d.closePath(); ctx2d.fill();
  }
  if (field.torch.a > 0.01) glow(field.torch.x, h * 2.2, 0.34 * field.torch.a);
  if (field.halo.a > 0.01) glow(field.halo.x, h * 1.6, field.halo.a);
  ctx2d.globalCompositeOperation = "source-over";
}
function frame(now) {
  field.raf = 0;
  if (field.w === 0) return;
  if (still()) { stillFrame(); return; }
  const live = audioLive(now), interval = live ? 33 : 50;
  if (now - field.lastDrawAt >= interval - 1) { field.lastDrawAt = now; step(now); draw(); }
  field.raf = requestAnimationFrame(frame);
}
function stillFrame() {
  const { cols, shown } = field;
  for (let i = 0; i < cols; i++) shown[i] = idleTarget(i, cols, 0);
  field.torch.a = 0; field.halo.a = 0; draw();
}
function wake() { if (field.raf) return; field.raf = requestAnimationFrame(frame); }
function onSpectrum({ bins }) {
  if (still()) return;
  let any = false; const n = Math.min(BANDS, bins.length);
  for (let i = 0; i < n; i++) { const v = bins[i]; field.bands[i] = v; if (v > 0.004) any = true; }
  if (any) field.lastAudioAt = performance.now();
}
function onStripMove(e) { if (!still()) { field.torch.x = e.clientX; field.torch.on = true; wake(); } }
function onStripLeave() { field.torch.on = false; wake(); }
function updateHalo() {
  const focused = store.entries.peek().find((e) => e.wins.some((w) => w.focused));
  const el = focused ? apps.appFor(focused.key) : null;
  if (!el || el.hasAttribute("leaving")) { field.halo.x = -1; return; }
  const r = el.getBoundingClientRect(), left = canvas.getBoundingClientRect().left;
  field.halo.x = r.left + r.width / 2 - left; wake();
}

// ---- clock (five faces) ---------------------------------------------------

const FACES = ["stacked", "digital", "analog", "worded", "dual"];
const WORDS = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
const NEAR = { 0: "o'clock", 15: "quarter past", 30: "half past", 45: "quarter to" };
const time = signal("");
const date = signal("");
let lastEpoch = Date.now();

const pad = (n) => String(n).padStart(2, "0");
function face() { return faceOverride || clockFaceName; }
function hhmm(d, secs) {
  const opts = { hour: format24 ? "2-digit" : "numeric", minute: "2-digit", hour12: !format24 };
  if (secs) opts.second = "2-digit";
  return d.toLocaleTimeString([], opts);
}
function dateStr(d) { return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }); }
function worded(d) {
  const m = d.getMinutes(), h = d.getHours();
  const near = [0, 15, 30, 45].reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a), 0);
  if (near === 45) return `${NEAR[45]} ${WORDS[(h + 1) % 12]}`;
  if (near === 0) return `${WORDS[h % 12]} ${NEAR[0]}`;
  return `${NEAR[near]} ${WORDS[h % 12]}`;
}
function tzTime(d, tz) {
  try { return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", hour12: !format24, timeZone: tz }).format(d); }
  catch { return "—"; }
}
function drawAnalog(d) {
  const cv = clockFace, x = cv.width / 2, y = cv.height / 2, r = x - 8, g = cv.getContext("2d");
  g.clearRect(0, 0, cv.width, cv.height);
  g.strokeStyle = token("--dd-text-muted", "#94a3b8"); g.globalAlpha = 0.5; g.lineWidth = 3;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
  const hand = (frac, len, w, col) => {
    const a = frac * Math.PI * 2 - Math.PI / 2;
    g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round";
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
  };
  const s = d.getSeconds(), m = d.getMinutes(), h = d.getHours() % 12;
  hand((h + m / 60) / 12, r * 0.5, 5, token("--dd-text", "#e7edf5"));
  hand((m + s / 60) / 60, r * 0.78, 3.5, token("--dd-text", "#e7edf5"));
  hand(s / 60, r * 0.85, 1.6, token("--dd-accent", "#7dd3fc"));
}
function renderClock() {
  const d = new Date(lastEpoch), f = face();
  clockEl.dataset.face = f;
  const analog = f === "analog";
  clockFace.hidden = !analog;
  clockEl.querySelector(".clock__text").hidden = analog;
  if (analog) { drawAnalog(d); return; }
  if (f === "worded") { time.value = worded(d); date.value = clockDate ? dateStr(d) : ""; return; }
  time.value = hhmm(d, clockSeconds);
  if (f === "dual") { const tz = secondaryTz.trim(); date.value = tz ? "· " + tzTime(d, tz) : "set a time zone"; }
  else date.value = clockDate ? dateStr(d) : "";
}
function onTick({ epochMs }) { lastEpoch = epochMs; renderClock(); }
clockEl.addEventListener("click", () => {
  const cur = face();
  faceOverride = FACES[(FACES.indexOf(cur) + 1) % FACES.length];
  renderClock();
});

// ---- now playing ----------------------------------------------------------

const np = signal(null);

// ---- vitals as numbers ----------------------------------------------------

const vitals = signal(null);
function pctOf(key) {
  const v = vitals.value; if (!v) return null;
  if (key === "ram") return v.ram ? v.ram.percent * 100 : null;      // ram.percent is 0..1
  return typeof v[key] === "number" ? v[key] * 100 : null;            // cpu/gpu are 0..1
}
function level(p) { return p == null ? null : p >= 85 ? "danger" : p >= 60 ? "warning" : null; }
function numText(key) { const p = pctOf(key); return p == null ? "–" : Math.round(p) + "%"; }
function bps(n) {
  if (n == null) return "–";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return Math.round(n / 1e3) + "K";
  return Math.round(n) + "B";
}
function onVitals(v) {
  vitals.value = v;
  field.cpu = typeof v.cpu === "number" ? Math.max(0, Math.min(1, v.cpu)) : 0;
}

// ---- notification badges (floated over the app strip) ---------------------

const UNREAD = /(?:^|\s)\((\d+)\+?\)|\b(\d+)\s+(?:new|unread|message)/i;
function unreadOf(win) {
  const title = (win.title || win.name || win.caption || "").toString();
  const m = title.match(UNREAD);
  if (!m) return 0;
  return parseInt(m[1] || m[2], 10) || 0;
}
function refreshBadges() {
  if (!badgesEl) return;
  if (!badgesOn || !store) { badgesEl.replaceChildren(); return; }
  const entries = store.entries.peek();
  const glassLeft = canvas.getBoundingClientRect().left;
  const glassTop = canvas.getBoundingClientRect().top;
  const wanted = new Map();
  for (const e of entries) {
    let count = 0;
    for (const w of e.wins || []) count = Math.max(count, unreadOf(w));
    if (!count) continue;
    const el = apps.appFor && apps.appFor(e.key);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    wanted.set(e.key, { count, x: r.left + r.width - glassLeft, y: r.top - glassTop });
  }
  // Reconcile: reuse nodes by key so counts animate rather than flash.
  const keep = new Set();
  for (const [key, b] of wanted) {
    keep.add(key);
    let node = badgesEl.querySelector(`[data-key="${CSS.escape(key)}"]`);
    if (!node) {
      node = document.createElement("span");
      node.className = "badge"; node.dataset.key = key;
      badgesEl.appendChild(node);
    }
    if (node.textContent !== String(b.count)) {
      node.textContent = b.count > 99 ? "99+" : b.count;
      node.classList.remove("pop"); void node.offsetWidth; node.classList.add("pop");
    }
    node.style.transform = `translate(${b.x - 8}px, ${b.y - 2}px)`;
  }
  for (const node of [...badgesEl.children]) if (!keep.has(node.dataset.key)) node.remove();
}

// ---- dock magnification ---------------------------------------------------

let magHosts = [];
function refreshMagHosts() {
  magHosts = [startEl, launcherEl, document.getElementById("deck")]
    .filter((el) => el && !el.hidden)
    .concat(Array.from(apps.querySelectorAll("dd-app")));
}
function magnify(px) {
  if (!magnifyOn) return resetMag();
  const reach = Math.max(1, magReach);
  for (const el of magHosts) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const c = r.left + r.width / 2;
    const sigma = r.width * reach;
    const d = px - c;
    const g = Math.exp(-(d * d) / (2 * sigma * sigma));
    el.style.setProperty("--mag-scale", (1 + magStrength * g).toFixed(3));
    el.style.setProperty("--mag-lift", (magStrength * g * 14).toFixed(1) + "px");
  }
}
function resetMag() {
  for (const el of magHosts) { el.style.removeProperty("--mag-scale"); el.style.removeProperty("--mag-lift"); }
}

// ---- breathing pulse ------------------------------------------------------

let breatheTimer = null;
function scheduleBreathe() {
  if (breatheTimer) { clearInterval(breatheTimer); breatheTimer = null; }
  if (!breatheOn || !breatheSecs || lowMotion) return;
  breatheTimer = setInterval(runBreathe, breatheSecs * 1000);
}
function runBreathe() {
  if (document.hidden) return;
  refreshMagHosts();
  magHosts.forEach((el, i) => el.style.setProperty("--breathe-delay", i * 70 + "ms"));
  document.body.classList.remove("breathe"); void strip.offsetWidth;
  document.body.classList.add("breathe");
  setTimeout(() => document.body.classList.remove("breathe"), 2600);
}

// ---- boot -----------------------------------------------------------------

async function main() {
  store = dd.bar.store();
  await store.ready;
  lowMotion = store.lowMotion.peek();
  if (lowMotion) document.body.classList.add("low-motion");

  // Clock readouts.
  bindParts(clockEl, { time: { textContent: time }, date: { textContent: date } });
  dd.time.onTick(onTick);
  onTick({ epochMs: Date.now() });

  // Now playing.
  const artEl = npEl.querySelector('[data-bind="art"]');
  bindParts(npEl, {
    fallback: { hidden: () => Boolean(np.value && np.value.art) },
    title: { textContent: () => (np.value && np.value.title) || "" },
    artist: { textContent: () => (np.value && (np.value.artist || np.value.album)) || "" },
  });
  effect(() => {
    const art = np.value && np.value.art;
    if (art) { if (artEl.getAttribute("src") !== art) artEl.src = art; artEl.hidden = false; }
    else { artEl.removeAttribute("src"); artEl.hidden = true; }
  });
  effect(() => {
    const s = np.value;
    document.body.classList.toggle("np-active", Boolean(s && s.hasSession));
    document.body.classList.toggle("np-playing", Boolean(s && s.status === "playing"));
  });
  dd.media.onNowPlaying((s) => { np.value = s; });
  dd.media.status().then((seed) => { if (np.peek() === null && seed) np.value = seed; })
    .catch((err) => dd.log("warn", "media seed failed", String(err)));

  // Vitals numbers.
  bindParts(vitalsEl, {
    cpu: { textContent: () => numText("cpu") },
    ram: { textContent: () => numText("ram") },
    gpu: { textContent: () => numText("gpu") },
    net: { textContent: () => (vitals.value && vitals.value.net ? bps(vitals.value.net.rxBps) : "–") },
    "v-cpu": { "data-level": () => level(pctOf("cpu")) },
    "v-ram": { "data-level": () => level(pctOf("ram")) },
    "v-gpu": { "data-level": () => level(pctOf("gpu")), hidden: () => pctOf("gpu") == null },
  });
  vitalsEl.addEventListener("click", () => document.getElementById("deck").click());
  dd.system.onVitals(onVitals);
  dd.system.status().then((seed) => { if (seed) onVitals(seed); })
    .catch((err) => dd.log("warn", "vitals seed failed", String(err)));

  // The field.
  readPalette();
  dd.theme.onChange(() => { readPalette(); renderClock(); wake(); });
  new ResizeObserver(resize).observe(canvas);
  resize();
  dd.audio.onSpectrum(onSpectrum);
  if (!lowMotion) {
    strip.addEventListener("pointermove", onStripMove);
    strip.addEventListener("pointerleave", onStripLeave);
  }

  // Magnification + halo + badges all key off the pointer and the entries.
  strip.addEventListener("pointermove", (e) => magnify(e.clientX));
  strip.addEventListener("pointerleave", resetMag);
  apps.addEventListener("dd-change", () => { updateHalo(); refreshBadges(); });
  effect(() => {
    store.entries.value; // tracked
    requestAnimationFrame(() => { refreshMagHosts(); updateHalo(); refreshBadges(); });
  });

  dd.settings.bind((s) => {
    reactivity = String(s.reactivity || "audio and vitals");
    format24 = s.format24h === true;
    clockFaceName = String(s.clockFace || "stacked");
    clockSeconds = s.clockSeconds === true;
    clockDate = s.clockDate !== false;
    secondaryTz = String(s.secondaryTz || "");
    magnifyOn = s.magnify !== false;
    magStrength = Math.max(0, Math.min(1, (s.magnifyStrength ?? 60) / 100));
    magReach = Math.max(1, Math.min(6, s.magnifyReach ?? 3));
    breatheOn = s.breathing !== false;
    breatheSecs = s.breathingInterval ?? 45;
    badgesOn = s.badges !== false;
    if (s.startLabel != null) startEl.setAttribute("label", s.startLabel || "Start");
    launcherEl.hidden = s.showLauncher === false;

    document.body.classList.toggle("show-clock", s.showClock !== false);
    document.body.classList.toggle("show-media", s.showMedia !== false);
    document.body.classList.toggle("show-vitals", s.showVitals !== false);
    document.body.classList.toggle("show-net", s.showNet !== false);

    document.body.classList.toggle("no-magnify", !magnifyOn);
    if (!magnifyOn) resetMag();
    refreshMagHosts();
    scheduleBreathe();
    renderClock();
    refreshBadges();
    wake();
  });

  refreshMagHosts();
}

main().catch((err) => dd.log("error", "aurora dock boot failed", String(err)));

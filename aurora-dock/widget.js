// Aurora Dock — a segmented, dock-style evolution of the Aurora bar.
//
// Three glass segments (left / centre / right) each capture only their own
// box, so the gaps between them click through — the "cut out where there's
// nothing" shape. Each segment carries a slice of Aurora's living light
// field, painted from one shared rAF loop. On top ride the dock behaviours:
// magnification, a breathing pulse, a five-face clock, number-or-ring vitals,
// a split network readout and notification badges.

const { create, bindParts, signal, effect, token } = dd.ui;

const apps = document.getElementById("apps");
const segs = Array.from(document.querySelectorAll(".seg"));
const clockEl = document.getElementById("clock");
const clockFaceCv = document.getElementById("clock-face");
const npEl = document.getElementById("np");
const vitalsEl = document.getElementById("vitals");
const netEl = document.getElementById("net");
const startEl = document.getElementById("start");
const startLauncherEl = document.getElementById("start-launcher");
const badgesEl = document.getElementById("badges");
const centerCanvas = document.querySelector("#bar-center .field");

const BANDS = 500;
const AUDIO_HOLD_MS = 400;
const RING_CIRC = 94.25; // 2πr, r=15
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
let clockFaceName = "standard";
let clockSeconds = false;
let clockDate = true;
let secondaryTz = "";
let faceOverride = null;
let magnifyOn = true, magStrength = 0.6, magReach = 2;
let breatheOn = true, breatheSecs = 5;
let badgesOn = false;
let startMode = "windows";
let warnAt = 50, dangerAt = 90;

// shared field state
const shared = { bands: new Float32Array(BANDS), lastAudioAt: 0, cpu: 0, colors: [], accent: [255, 255, 255] };
let raf = 0, lastDrawAt = 0;

// ---- the light field: one instance per segment canvas --------------------

function rgbOf(g, name) {
  g.fillStyle = token(name, "#888888");
  const norm = String(g.fillStyle);
  if (norm.startsWith("#")) { const n = parseInt(norm.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  const m = norm.match(/[\d.]+/g) || [];
  return [Number(m[0]) || 0, Number(m[1]) || 0, Number(m[2]) || 0];
}
function readPalette() {
  const g = fields[0] ? fields[0].g : centerCanvas.getContext("2d");
  shared.colors = LAYERS.map((l) => rgbOf(g, l.token));
  shared.accent = rgbOf(g, "--dd-accent");
}
const rgba = ([r, g, b], a) => `rgba(${r}, ${g}, ${b}, ${a.toFixed(3)})`;
function still() { return lowMotion || reactivity === "calm"; }
function audioLive(now) { return !still() && now - shared.lastAudioAt < AUDIO_HOLD_MS; }
function columnBand(i, cols) { const half = (cols - 1) / 2; return Math.min(BANDS - 1, Math.round((Math.abs(i - half) / half) * (BANDS - 1))); }
function idleTarget(i, cols, t) {
  // A little taller and livelier than Aurora's so the idle "breathing" of the
  // bar reads clearly when nothing is playing.
  const base = reactivity === "audio and vitals" && !still() ? 0.12 + 0.32 * shared.cpu : 0.2;
  const x = i / cols;
  const a = 0.5 + 0.5 * Math.sin(x * 9.5 + t * 0.00045);
  const b = 0.5 + 0.5 * Math.sin(x * 3.1 - t * 0.00028);
  return base + 0.22 * a * (0.5 + 0.5 * b);
}

function makeField(canvas) {
  const g = canvas.getContext("2d");
  const f = {
    canvas, g, w: 0, h: 0, cols: 0,
    target: new Float32Array(0), shown: new Float32Array(0),
    torch: { x: 0, a: 0, on: false }, halo: { x: -1, a: 0 }, isCenter: canvas === centerCanvas,
  };
  f.resize = () => {
    const rect = canvas.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
    f.w = rect.width; f.h = rect.height;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
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
    const { w, h, cols, shown } = f;
    if (!w) return;
    // Idle brightness pulse — the bar visibly breathes when nothing plays.
    const pulse = live ? 1 : 0.7 + 0.3 * (0.5 + 0.5 * Math.sin(now * 0.0016));
    g.clearRect(0, 0, w, h);
    g.globalCompositeOperation = "lighter";
    const dx = w / (cols - 1);
    for (let k = 0; k < LAYERS.length; k++) {
      const layer = LAYERS[k], color = shared.colors[k] || shared.accent;
      const grad = g.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, rgba(color, 0.44 * pulse)); grad.addColorStop(0.55, rgba(color, 0.17 * pulse)); grad.addColorStop(1, rgba(color, 0.02));
      g.fillStyle = grad; g.beginPath(); g.moveTo(0, h);
      const idx = (i) => (i + layer.shift) % cols;
      let prevX = 0, prevY = h - shown[idx(0)] * layer.scale * h * 0.96;
      g.lineTo(prevX, prevY);
      for (let i = 1; i < cols; i++) {
        const x = i * dx, y = h - shown[idx(i)] * layer.scale * h * 0.96;
        g.quadraticCurveTo(prevX, prevY, (prevX + x) / 2, (prevY + y) / 2);
        prevX = x; prevY = y;
      }
      g.lineTo(w, prevY); g.lineTo(w, h); g.closePath(); g.fill();
    }
    if (f.torch.a > 0.01) f.glow(f.torch.x, h * 2.2, 0.34 * f.torch.a);
    if (f.isCenter && f.halo.a > 0.01) f.glow(f.halo.x, h * 1.6, f.halo.a);
    g.globalCompositeOperation = "source-over";
  };
  f.stillFrame = () => {
    for (let i = 0; i < f.cols; i++) f.shown[i] = idleTarget(i, f.cols, 0);
    f.torch.a = 0; f.halo.a = 0; f.draw(0, false);
  };
  f.resize();
  return f;
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
// Colour running apps, grey out pinned/idle ones (an alternative to dots).
function updateRunning() {
  for (const e of store.entries.peek()) {
    const el = apps.appFor && apps.appFor(e.key);
    if (el) el.classList.toggle("running", !!(e.wins && e.wins.length));
  }
}
function updateHalo() {
  const center = fields.find((f) => f.isCenter);
  if (!center) return;
  const focused = store.entries.peek().find((e) => e.wins.some((w) => w.focused));
  const el = focused ? apps.appFor(focused.key) : null;
  if (!el || el.hasAttribute("leaving")) { center.halo.x = -1; return; }
  const r = el.getBoundingClientRect(), left = center.canvas.getBoundingClientRect().left;
  center.halo.x = r.left + r.width / 2 - left; wake();
}

// ---- pointer: torch + magnification --------------------------------------

function onMove(e) {
  if (!still()) {
    for (const f of fields) {
      const r = f.canvas.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right) { f.torch.x = e.clientX - r.left; f.torch.on = true; }
      else f.torch.on = false;
    }
    wake();
  }
  magnify(e.clientX);
}
function onLeave() { for (const f of fields) f.torch.on = false; resetMag(); wake(); }

let magHosts = [];
function refreshMagHosts() {
  magHosts = [startMode === "launcher" ? startLauncherEl : startEl, document.getElementById("deck")]
    .filter((el) => el && !el.hidden)
    .concat(Array.from(apps.querySelectorAll("dd-app")));
}
function magnify(px) {
  if (!magnifyOn) return resetMag();
  const reach = Math.max(1, magReach);
  for (const el of magHosts) {
    const r = el.getBoundingClientRect();
    if (!r.width) continue;
    const c = r.left + r.width / 2, sigma = r.width * reach, d = px - c;
    const gg = Math.exp(-(d * d) / (2 * sigma * sigma));
    el.style.setProperty("--mag-scale", (1 + magStrength * gg).toFixed(3));
    el.style.setProperty("--mag-lift", (magStrength * gg * 14).toFixed(1) + "px");
  }
}
function resetMag() { for (const el of magHosts) { el.style.removeProperty("--mag-scale"); el.style.removeProperty("--mag-lift"); } }

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
  magHosts.forEach((el, i) => el.style.setProperty("--breathe-delay", i * 60 + "ms"));
  document.body.classList.remove("breathe"); void document.body.offsetWidth;
  document.body.classList.add("breathe");
  setTimeout(() => document.body.classList.remove("breathe"), 2600);
}

// ---- clock ----------------------------------------------------------------

const FACES = ["standard", "large", "analog", "worded", "dual"];
const SLOTS = {
  "by start (right)": "slot-start-right", "by start (left)": "slot-start-left",
  "by info (left)": "slot-info-left", "far right": "slot-info-right",
};
const WORDS = ["twelve", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven"];
const NEAR = { 0: "o'clock", 15: "quarter past", 30: "half past", 45: "quarter to" };
const time = signal(""), date = signal("");
let lastEpoch = Date.now();
const face = () => faceOverride || clockFaceName;
function hhmm(d, secs) {
  const o = { hour: format24 ? "2-digit" : "numeric", minute: "2-digit", hour12: !format24 };
  if (secs) o.second = "2-digit";
  return d.toLocaleTimeString([], o);
}
const dateStr = (d) => d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" });
function worded(d) {
  const m = d.getMinutes(), h = d.getHours();
  const near = [0, 15, 30, 45].reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a), 0);
  if (near === 45) return `${NEAR[45]} ${WORDS[(h + 1) % 12]}`;
  if (near === 0) return `${WORDS[h % 12]} ${NEAR[0]}`;
  return `${NEAR[near]} ${WORDS[h % 12]}`;
}
function tzTime(d, tz) { try { return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit", hour12: !format24, timeZone: tz }).format(d); } catch { return "—"; } }
function drawAnalog(d) {
  const cv = clockFaceCv, x = cv.width / 2, y = cv.height / 2, r = x - 8, g = cv.getContext("2d");
  g.clearRect(0, 0, cv.width, cv.height);
  g.strokeStyle = token("--dd-text-muted", "#94a3b8"); g.globalAlpha = 0.5; g.lineWidth = 3;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke(); g.globalAlpha = 1;
  const hand = (frac, len, w, col) => { const a = frac * Math.PI * 2 - Math.PI / 2; g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round"; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke(); };
  const s = d.getSeconds(), m = d.getMinutes(), h = d.getHours() % 12;
  hand((h + m / 60) / 12, r * 0.5, 5, token("--dd-text", "#e7edf5"));
  hand((m + s / 60) / 60, r * 0.78, 3.5, token("--dd-text", "#e7edf5"));
  hand(s / 60, r * 0.85, 1.6, token("--dd-accent", "#7dd3fc"));
}
function renderClock() {
  const d = new Date(lastEpoch), f = face();
  clockEl.dataset.face = f;
  const analog = f === "analog";
  clockFaceCv.hidden = !analog;
  clockEl.querySelector(".clock__text").hidden = analog;
  if (analog) return drawAnalog(d);
  if (f === "worded") { time.value = worded(d); date.value = clockDate ? dateStr(d) : ""; return; }
  time.value = hhmm(d, clockSeconds);
  if (f === "dual") { const tz = secondaryTz.trim(); date.value = tz ? "· " + tzTime(d, tz) : "set a time zone"; }
  else date.value = clockDate ? dateStr(d) : "";
}
function onTick({ epochMs }) { lastEpoch = epochMs; renderClock(); }
clockEl.addEventListener("click", () => { faceOverride = FACES[(FACES.indexOf(face()) + 1) % FACES.length]; renderClock(); });
function placeClock(posKey) {
  const slot = document.getElementById(SLOTS[posKey] || "slot-start-right");
  if (slot && clockEl.parentElement !== slot) slot.appendChild(clockEl);
}

// ---- now playing (+ marquee) ---------------------------------------------

const np = signal(null);
function updateMarquee() {
  const wrap = npEl.querySelector(".np__marquee"), title = npEl.querySelector(".np__title");
  if (!wrap || !title) return;
  const over = title.scrollWidth - wrap.clientWidth;
  if (over > 4 && !lowMotion) {
    title.classList.add("scroll");
    title.style.setProperty("--marq", -over - 8 + "px");
    title.style.setProperty("--marq-dur", Math.max(6, (over + 8) / 22) + "s");
  } else { title.classList.remove("scroll"); title.style.removeProperty("--marq"); }
}

// ---- vitals ---------------------------------------------------------------

const vitals = signal(null);
function pctOf(key) {
  const v = vitals.value; if (!v) return null;
  if (key === "ram") return v.ram ? v.ram.percent * 100 : null;
  return typeof v[key] === "number" ? v[key] * 100 : null;
}
const level = (p) => (p == null ? null : p >= dangerAt ? "danger" : p >= warnAt ? "warning" : null);
const numText = (key) => { const p = pctOf(key); return p == null ? "–" : Math.round(p) + "%"; };
const arcOff = (key) => { const p = pctOf(key); return (RING_CIRC * (1 - (p == null ? 0 : p) / 100)).toFixed(2); };
function bps(n) { if (n == null) return "–"; if (n >= 1e6) return (n / 1e6).toFixed(1) + "M"; if (n >= 1e3) return Math.round(n / 1e3) + "K"; return Math.round(n) + "B"; }
function onVitals(v) { vitals.value = v; shared.cpu = typeof v.cpu === "number" ? Math.max(0, Math.min(1, v.cpu)) : 0; }

// ---- notification badges (opt-in, unstable) -------------------------------

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

// ---- start button ---------------------------------------------------------

function applyStart() {
  const launcher = startMode === "launcher";
  startEl.hidden = launcher;
  startLauncherEl.hidden = !launcher;
  (launcher ? startLauncherEl : startEl).setAttribute("label", (window.__startLabel || "Start"));
}
startLauncherEl.addEventListener("click", () => { try { localStorage.setItem("aurora-dock:tab", "apps"); } catch {} });

// ---- boot -----------------------------------------------------------------

async function main() {
  store = dd.bar.store();
  await store.ready;
  lowMotion = store.lowMotion.peek();
  if (lowMotion) document.body.classList.add("low-motion");

  fields = Array.from(document.querySelectorAll(".field")).map(makeField);
  readPalette();

  // Clock.
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
    requestAnimationFrame(updateMarquee);
  });
  dd.media.onNowPlaying((s) => { np.value = s; });
  dd.media.status().then((seed) => { if (np.peek() === null && seed) np.value = seed; }).catch((e) => dd.log("warn", "media seed", String(e)));

  // Vitals — numbers and rings both bound; CSS shows one.
  bindParts(vitalsEl, {
    cpu: { textContent: () => numText("cpu") }, ram: { textContent: () => numText("ram") }, gpu: { textContent: () => numText("gpu") },
    "v-cpu": { "data-level": () => level(pctOf("cpu")) },
    "v-ram": { "data-level": () => level(pctOf("ram")) },
    "v-gpu": { "data-level": () => level(pctOf("gpu")), hidden: () => pctOf("gpu") == null },
    "ring-cpu": { "data-level": () => level(pctOf("cpu")) },
    "ring-ram": { "data-level": () => level(pctOf("ram")) },
    "ring-gpu": { "data-level": () => level(pctOf("gpu")), hidden: () => pctOf("gpu") == null },
    "arc-cpu": { "stroke-dashoffset": () => arcOff("cpu") },
    "arc-ram": { "stroke-dashoffset": () => arcOff("ram") },
    "arc-gpu": { "stroke-dashoffset": () => arcOff("gpu") },
  });
  bindParts(netEl, {
    "net-rx": { textContent: () => (vitals.value && vitals.value.net ? bps(vitals.value.net.rxBps) : "–") },
    "net-tx": { textContent: () => (vitals.value && vitals.value.net ? bps(vitals.value.net.txBps) : "–") },
  });
  vitalsEl.addEventListener("click", () => document.getElementById("deck").click());
  netEl.addEventListener("click", () => { try { localStorage.setItem("aurora-dock:tab", "net"); } catch {} document.getElementById("deck").click(); });
  dd.system.onVitals(onVitals);
  dd.system.status().then((seed) => { if (seed) onVitals(seed); }).catch((e) => dd.log("warn", "vitals seed", String(e)));

  // Field wiring.
  dd.theme.onChange(() => { readPalette(); renderClock(); wake(); });
  const ro = new ResizeObserver(() => { fields.forEach((f) => f.resize()); wake(); });
  segs.forEach((s) => ro.observe(s));
  dd.audio.onSpectrum(onSpectrum);
  for (const s of segs) {
    if (!lowMotion) { s.addEventListener("pointermove", onMove); s.addEventListener("pointerleave", onLeave); }
    else s.addEventListener("pointermove", (e) => magnify(e.clientX)), s.addEventListener("pointerleave", resetMag);
  }
  apps.addEventListener("dd-change", () => { updateHalo(); refreshBadges(); updateRunning(); });
  effect(() => { store.entries.value; requestAnimationFrame(() => { refreshMagHosts(); updateHalo(); refreshBadges(); updateRunning(); }); });

  dd.settings.bind((s) => {
    reactivity = String(s.reactivity || "audio and vitals");
    format24 = s.format24h === true;
    clockFaceName = String(s.clockFace || "standard");
    clockSeconds = s.clockSeconds === true;
    clockDate = s.clockDate !== false;
    secondaryTz = String(s.secondaryTz || "");
    magnifyOn = s.magnify !== false;
    magStrength = Math.max(0, Math.min(1, (s.magnifyStrength ?? 60) / 100));
    magReach = Math.max(1, Math.min(6, s.magnifyReach ?? 2));
    breatheOn = s.breathing !== false;
    breatheSecs = s.breathingInterval ?? 5;
    badgesOn = s.badges === true;
    startMode = String(s.startMode || "windows");
    window.__startLabel = s.startLabel || "Start";
    warnAt = s.vitalsWarnAt ?? 50;
    dangerAt = s.vitalsDangerAt ?? 90;
    const rootStyle = document.documentElement.style;
    rootStyle.setProperty("--v-normal", s.vitalsNormalColor || "#e7edf5");
    rootStyle.setProperty("--v-warn", s.vitalsWarnColor || "#f59e0b");
    rootStyle.setProperty("--v-danger", s.vitalsDangerColor || "#f87171");

    const rs = String(s.runningStyle || "dots");
    document.body.classList.toggle("running-colour", rs === "colour" || rs === "colour + dots");
    document.body.classList.toggle("hide-dots", rs === "colour");
    document.documentElement.style.setProperty("--idle-dim", (100 - (s.dimIdle ?? 45)) / 100);

    applyStart();
    placeClock(String(s.clockPosition || "by start (right)"));
    clockEl.hidden = s.showClock === false;
    document.body.classList.toggle("show-media", s.showMedia !== false);
    document.body.classList.toggle("show-vitals", s.showVitals !== false);
    document.body.classList.toggle("vitals-rings", String(s.vitalsStyle || "numbers") === "rings");
    document.body.classList.toggle("show-net", s.showNet !== false);
    document.body.classList.toggle("no-magnify", !magnifyOn);

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

main().catch((err) => dd.log("error", "aurora dock boot failed", String(err)));

// Launch Drawer — a hand-picked launcher you build from several catalogs.
//
// The platform has no "open an arbitrary path" verb, so a shortcut has to come
// from something the host can enumerate and launch:
//   • Games  — dd.games.list / art / launch   (your installed games, with art)
//   • Apps   — dd.apps.list / launch           (Explorer, Terminal, Notepad…)
//   • Desktop + picked folders — dd.folders.list / open  (exes, scripts,
//     shortcuts, folders — curate the exact items you want with the + tile)
//
// Everything is pooled and grouped by TYPE (Games, Apps, Programs & Scripts,
// Folders, Files) with an optional Most-used section, instead of A-Z. Each
// item launches through its own verb.

const { create } = dd.ui;

const panelEl = document.getElementById("panel");
const headerTitleEl = document.getElementById("header-title");
const boardTitleEl = document.getElementById("board-title");
const headerEl = document.getElementById("header");
const contentEl = document.getElementById("content");
const chevronEl = document.getElementById("chevron");
const gridEl = document.getElementById("grid");

let settings = {};
let collapsed = false;
let booted = false;
let members = {}; // { sourceKey: [ids] } curated folder/desktop membership
let usage = {}; // { "type:src:id": count }

let itemsBySource = new Map(); // folder sourceKey -> [items]
let games = []; // [{id,name}]
let apps = []; // [{id,name,icon?}]
const folderIcons = new Map(); // "src:id" -> uri|null
const gameArt = new Map(); // gameId -> uri|null

const CHEVRON = {
  top: { open: "▴", closed: "▾" }, bottom: { open: "▾", closed: "▴" },
  left: { open: "◂", closed: "▸" }, right: { open: "▸", closed: "◂" },
};
const KIND_GLYPH = { file: "📄", folder: "📁", shortcut: "🔗", virtual: "🖥️", game: "🎮", app: "⚙️" };
const APP_EXT = new Set(["exe", "lnk", "bat", "cmd", "ps1", "vbs", "msi", "url", "com", "scr", "appref-ms"]);
const SECTION_LABEL = { frequent: "Most used", games: "Games", sysapps: "Apps", programs: "Programs & Scripts", folders: "Folders", files: "Files" };

const isCurated = () => settings.mode !== "all";
const isCollapsible = () => settings.collapsible !== false;
const keyOf = (it) => `${it.__type}:${it.__src || ""}:${it.id}`;

function folderSources() {
  const out = [];
  if (settings.includeDesktop !== false) out.push({ key: "deskPath", label: "Desktop" });
  for (let i = 1; i <= 3; i++) {
    const p = (settings["folder" + i] || "").trim();
    if (!p) continue;
    out.push({ key: "folder" + i, label: (settings["label" + i] || "").trim() || ("Folder " + i) });
  }
  return out;
}

function extOf(it) { const s = (it.path || it.name || "").toLowerCase(), d = s.lastIndexOf("."); return d > 0 ? s.slice(d + 1) : ""; }
function section(it) {
  if (it.__type === "game") return "games";
  if (it.__type === "app") return "sysapps";
  if (it.kind === "folder") return "folders";
  if (it.kind === "shortcut" || it.kind === "virtual") return "programs";
  return APP_EXT.has(extOf(it)) ? "programs" : "files";
}

// ---- persistence ----------------------------------------------------------
function persistMembers() { dd.storage.set("members", members).catch((e) => dd.log("error", "members persist", (e && e.code) || String(e))); }
function persistUsage() { dd.storage.set("usage", usage).catch((e) => dd.log("warn", "usage persist", (e && e.code) || String(e))); }

// ---- collapse chrome ------------------------------------------------------
function updateChrome() {
  const dir = CHEVRON[settings.collapseTo] ? settings.collapseTo : "top";
  if (!isCollapsible()) collapsed = false;
  panelEl.classList.toggle("pinned", !isCollapsible());
  panelEl.dataset.collapse = dir;
  panelEl.classList.toggle("collapsed", collapsed);
  chevronEl.textContent = collapsed ? CHEVRON[dir].closed : CHEVRON[dir].open;
  headerEl.title = isCollapsible() ? (collapsed ? "Expand" : "Collapse") : "";
  const vertical = dir === "top" || dir === "bottom";
  panelEl.style.setProperty("--handle-size", `${(vertical ? headerEl.offsetHeight : headerEl.offsetWidth) + 2}px`);
}
function markRegions() { headerEl.setAttribute("data-dd-interactive", ""); contentEl.toggleAttribute("data-dd-interactive", !collapsed); }
function setCollapsed(next) { collapsed = next; updateChrome(); markRegions(); void dd.storage.set("collapsed", collapsed); }

// ---- gather the visible set ----------------------------------------------
function visibleItems() {
  const out = [];
  // Folder/desktop items (curated or mirrored).
  for (const [key, list] of itemsBySource) {
    const memberSet = isCurated() ? new Set(members[key] || []) : null;
    for (const it of list) { if (memberSet && !memberSet.has(it.id)) continue; out.push(it); }
  }
  // Catalog items always show when their toggle is on.
  if (settings.showGames !== false) for (const g of games) out.push({ __type: "game", id: g.id, name: g.name || g.title || g.id });
  if (settings.showApps === true) for (const a of apps) out.push({ __type: "app", id: a.id, name: a.name || a.id, icon: a.icon });
  return out;
}

const byName = (a, b) => (a.name || "").localeCompare(b.name || "");
const byUse = (a, b) => (usage[keyOf(b)] || 0) - (usage[keyOf(a)] || 0) || byName(a, b);
const sectionHeader = (text) => create("div", { class: "section" }, create("dd-text", { variant: "label" }, text));

function render() {
  const title = settings.title || "Launch";
  headerTitleEl.textContent = title;
  boardTitleEl.textContent = title;
  panelEl.classList.toggle("no-labels", settings.showLabels === false);
  panelEl.classList.toggle("panel--transparent", settings.panel === "transparent");
  panelEl.dataset.iconSize = settings.iconSize || "medium";
  updateChrome();

  const visible = visibleItems();
  if (visible.length === 0) { gridEl.replaceChildren(emptyState()); return; }

  const groups = { games: [], sysapps: [], programs: [], folders: [], files: [] };
  for (const it of visible) groups[section(it)].push(it);

  const folderGroups = settings.groupOrder === "folders first" ? ["folders", "programs", "files"] : ["programs", "folders", "files"];
  const order = ["games", "sysapps", ...folderGroups];
  const headers = settings.showHeaders !== false;
  const children = [];

  if (settings.showFrequent !== false || settings.groupOrder === "most used first") {
    const freq = visible.filter((it) => usage[keyOf(it)]).sort(byUse).slice(0, 8);
    if (freq.length) { if (headers) children.push(sectionHeader(SECTION_LABEL.frequent)); freq.forEach((it) => children.push(tile(it))); }
  }
  for (const g of order) {
    const list = groups[g];
    if (!list.length) continue;
    if (headers) children.push(sectionHeader(SECTION_LABEL[g]));
    list.sort(g === "games" || g === "sysapps" ? byName : byName).forEach((it) => children.push(tile(it)));
  }
  if (isCurated()) {
    const srcs = folderSources();
    if (srcs.length) { if (headers) children.push(sectionHeader("Add shortcuts")); srcs.forEach((s) => children.push(addTile(s))); }
  }

  gridEl.replaceChildren(...children);
  void fillIcons(visible);
}

async function fillIcons(visible) {
  // Folder icons, per source, in host-capped chunks.
  const bySrc = new Map();
  for (const it of visible) {
    if (it.__type !== "folder" || it.icon || folderIcons.has(keyOf(it))) continue;
    if (!bySrc.has(it.__src)) bySrc.set(it.__src, []);
    bySrc.get(it.__src).push(it.id);
  }
  for (const [src, ids] of bySrc) {
    for (let at = 0; at < ids.length; at += 128) {
      const chunk = ids.slice(at, at + 128);
      try {
        const res = await dd.folders.icons(src, chunk);
        for (const id of chunk) folderIcons.set(src + ":" + id, null);
        for (const [id, uri] of Object.entries((res && res.icons) || {})) folderIcons.set(src + ":" + id, uri);
        render();
      } catch (e) { dd.log("warn", "icons failed", (e && e.code) || String(e)); break; }
    }
  }
  // Game cover art.
  const gids = visible.filter((it) => it.__type === "game" && !gameArt.has(it.id)).map((it) => it.id);
  if (gids.length) {
    try {
      const res = await dd.games.art(gids, "portrait");
      for (const id of gids) gameArt.set(id, null);
      for (const [id, uri] of Object.entries((res && res.art) || {})) gameArt.set(id, uri);
      render();
    } catch (e) { dd.log("warn", "game art failed", (e && e.code) || String(e)); }
  }
}

function tile(item) {
  const props = { title: item.path || item.name };
  if (settings.showLabels !== false) props.label = item.name;
  const icon = item.icon || (item.__type === "folder" ? folderIcons.get(keyOf(item)) : item.__type === "game" ? gameArt.get(item.id) : null);
  if (icon) props.src = icon; else props.glyph = KIND_GLYPH[item.__type === "folder" ? item.kind : item.__type] || "📄";
  const el = create("dd-app-tile", props);
  if (item.__type === "game") el.classList.add("tile--game");
  el.addEventListener("click", () => launch(item, el));
  return el;
}

function addTile(source) {
  const props = { add: true, title: "Add shortcuts from " + source.label };
  if (settings.showLabels !== false) props.label = source.label;
  const btn = create("dd-app-tile", props);
  btn.addEventListener("click", async () => {
    if (dd.ui.pressGuard && !dd.ui.pressGuard(btn)) return;
    try {
      const res = await dd.dialogs.pickFolderItems(source.key, { checked: members[source.key] || [] });
      if (res && !res.cancelled) {
        members[source.key] = [...new Set((res.ids || []).filter((id) => typeof id === "string"))];
        persistMembers();
        render();
      }
    } catch (e) { dd.log("warn", "picker failed", (e && e.code) || String(e)); }
  });
  return btn;
}

function emptyState() {
  const btn = create("dd-button", { variant: "outline" }, "Open settings");
  btn.addEventListener("click", async () => { try { await dd.settings.open({}); } catch (e) { dd.log("warn", "settings open", (e && e.code) || String(e)); } });
  return create("div", { class: "dd-empty empty" },
    create("div", "Nothing added yet — turn on Games/Apps or add items from Desktop and folders."), btn);
}

async function launch(item, el) {
  if (dd.ui.pressGuard && !dd.ui.pressGuard(el)) return;
  try {
    if (item.__type === "game") await dd.games.launch(item.id);
    else if (item.__type === "app") await dd.apps.launch(item.id);
    else await dd.folders.open(item.__src, item.id);
    usage[keyOf(item)] = (usage[keyOf(item)] || 0) + 1;
    persistUsage();
    if (isCollapsible() && settings.autoCollapse === true && !collapsed) setCollapsed(true);
  } catch (e) {
    const code = (e && e.code) || String(e);
    dd.log("warn", "launch failed", item.name, code);
    if (code === "NOT_FOUND") void refresh();
  }
}

async function refresh() {
  const srcs = folderSources();
  itemsBySource = new Map();
  await Promise.all(srcs.map(async (s) => {
    try {
      const res = await dd.folders.list(s.key);
      const list = (res && res.items) || [];
      for (const it of list) { it.__type = "folder"; it.__src = s.key; }
      itemsBySource.set(s.key, list);
    } catch (e) { dd.log("warn", "list failed", s.key, (e && e.code) || String(e)); itemsBySource.set(s.key, []); }
  }));
  try { games = settings.showGames !== false ? ((await dd.games.list()).games || []) : []; }
  catch (e) { games = []; dd.log("warn", "games.list failed", (e && e.code) || String(e)); }
  try { apps = settings.showApps === true ? ((await dd.apps.list()).apps || []) : []; }
  catch (e) { apps = []; dd.log("warn", "apps.list failed", (e && e.code) || String(e)); }
  render();
}

async function main() {
  await dd.ready;
  collapsed = (await dd.storage.get("collapsed")) === true;
  const m = await dd.storage.get("members");
  members = m && typeof m === "object" ? m : {};
  const u = await dd.storage.get("usage");
  usage = u && typeof u === "object" ? u : {};

  await dd.settings.bind((next) => { settings = next; if (booted) void refresh(); else render(); });
  dd.folders.onChange(() => void refresh());
  headerEl.addEventListener("click", () => { if (isCollapsible()) setCollapsed(!collapsed); });

  booted = true;
  await refresh();
  markRegions();
}

main().catch((err) => dd.log("error", "launch drawer boot failed", String(err)));

// Launch Drawer — an aggregated, type-grouped launcher.
//
// Unlike the Desktop Drawer (one folder, A-Z), this pools several folder
// SOURCES (each a filePath setting: folder1..folder5) into one drawer and
// groups the result by TYPE — Apps & Games, Folders, Files — with an optional
// "Most used" section, instead of alphabetically. Launch is the host's
// double-click (dd.folders.open), which runs exes and .bat/.cmd and opens
// folders; .ps1 follows the user's Windows association.
//
// Sources resolve by key, so each folderN setting is its own dd.folders
// source. Ids are membership/handles only — names, icons and existence stay
// live, so renamed or deleted items just drop out.

const { create, signal, effect } = dd.ui;

const panelEl = document.getElementById("panel");
const headerTitleEl = document.getElementById("header-title");
const boardTitleEl = document.getElementById("board-title");
const headerEl = document.getElementById("header");
const contentEl = document.getElementById("content");
const chevronEl = document.getElementById("chevron");
const gridEl = document.getElementById("grid");

let settings = {};
let itemsBySource = new Map(); // key -> [items]
let collapsed = false;
let booted = false;
let members = {}; // { sourceKey: [ids] } curated membership
let usage = {}; // { "src:id": count }
const icons = new Map(); // "src:id" -> uri | null

const CHEVRON = {
  top: { open: "▴", closed: "▾" }, bottom: { open: "▾", closed: "▴" },
  left: { open: "◂", closed: "▸" }, right: { open: "▸", closed: "◂" },
};
const KIND_GLYPH = { file: "📄", folder: "📁", shortcut: "🔗", virtual: "🖥️" };
const APP_EXT = new Set(["exe", "lnk", "bat", "cmd", "ps1", "vbs", "msi", "url", "com", "scr", "appref-ms"]);
const SECTION_LABEL = { frequent: "Most used", apps: "Apps & Games", folders: "Folders", files: "Files" };

const isCurated = () => settings.mode === "curated";
const isCollapsible = () => settings.collapsible !== false;
const ukey = (it) => it.__src + ":" + it.id;

function sources() {
  const out = [];
  for (let i = 1; i <= 5; i++) {
    const path = (settings["folder" + i] || "").trim();
    if (!path) continue;
    const label = (settings["label" + i] || "").trim() || ("Source " + i);
    out.push({ key: "folder" + i, label });
  }
  return out;
}

function extOf(it) {
  const s = (it.path || it.name || "").toLowerCase();
  const dot = s.lastIndexOf(".");
  return dot > 0 ? s.slice(dot + 1) : "";
}
function classify(it) {
  if (it.kind === "folder") return "folders";
  if (it.kind === "shortcut" || it.kind === "virtual") return "apps";
  return APP_EXT.has(extOf(it)) ? "apps" : "files";
}

// ---- persistence ----------------------------------------------------------
function persistMembers() { dd.storage.set("members", members).catch((e) => dd.log("error", "members persist", (e && e.code) || String(e))); }
function persistUsage() { dd.storage.set("usage", usage).catch((e) => dd.log("warn", "usage persist", (e && e.code) || String(e))); }

// ---- collapse chrome (from Desktop Drawer) --------------------------------
function updateChrome() {
  const dir = CHEVRON[settings.collapseTo] ? settings.collapseTo : "top";
  if (!isCollapsible()) collapsed = false;
  panelEl.classList.toggle("pinned", !isCollapsible());
  panelEl.dataset.collapse = dir;
  panelEl.classList.toggle("collapsed", collapsed);
  chevronEl.textContent = collapsed ? CHEVRON[dir].closed : CHEVRON[dir].open;
  headerEl.title = isCollapsible() ? (collapsed ? "Expand" : "Collapse") : "";
  const vertical = dir === "top" || dir === "bottom";
  const handle = (vertical ? headerEl.offsetHeight : headerEl.offsetWidth) + 2;
  panelEl.style.setProperty("--handle-size", `${handle}px`);
}
function markRegions() {
  headerEl.setAttribute("data-dd-interactive", "");
  contentEl.toggleAttribute("data-dd-interactive", !collapsed);
}
function setCollapsed(next) { collapsed = next; updateChrome(); markRegions(); void dd.storage.set("collapsed", collapsed); }

// ---- rendering ------------------------------------------------------------
function allVisible() {
  const out = [];
  for (const [key, list] of itemsBySource) {
    const memberSet = isCurated() ? new Set(members[key] || []) : null;
    for (const it of list) {
      if (memberSet && !memberSet.has(it.id)) continue;
      out.push(it);
    }
  }
  return out;
}
function byName(a, b) { return a.name.localeCompare(b.name); }
function byUse(a, b) { return (usage[ukey(b)] || 0) - (usage[ukey(a)] || 0) || byName(a, b); }

function sectionHeader(text) {
  return create("div", { class: "section" }, create("dd-text", { variant: "label" }, text));
}

function render() {
  const title = settings.title || "Launch";
  headerTitleEl.textContent = title;
  boardTitleEl.textContent = title;
  panelEl.classList.toggle("no-labels", settings.showLabels === false);
  panelEl.classList.toggle("panel--transparent", settings.panel === "transparent");
  panelEl.dataset.iconSize = settings.iconSize || "medium";
  updateChrome();

  const visible = allVisible();
  const children = [];

  if (visible.length === 0) {
    gridEl.replaceChildren(emptyState());
    return;
  }

  const groups = { apps: [], folders: [], files: [] };
  for (const it of visible) groups[classify(it)].push(it);

  const order = settings.groupOrder === "folders first" ? ["folders", "apps", "files"] : ["apps", "folders", "files"];
  const wantFrequent = settings.showFrequent !== false || settings.groupOrder === "most used first";
  const headers = settings.showHeaders !== false;

  if (wantFrequent) {
    const freq = [...visible].filter((it) => usage[ukey(it)]).sort(byUse).slice(0, 8);
    if (freq.length) { if (headers) children.push(sectionHeader(SECTION_LABEL.frequent)); freq.forEach((it) => children.push(tile(it))); }
  }
  for (const g of order) {
    const list = groups[g];
    if (!list.length) continue;
    if (headers) children.push(sectionHeader(SECTION_LABEL[g]));
    list.sort(byName).forEach((it) => children.push(tile(it)));
  }
  if (isCurated()) {
    const srcs = sources();
    if (srcs.length) { if (headers) children.push(sectionHeader("Add")); srcs.forEach((s) => children.push(addTile(s))); }
  }

  gridEl.replaceChildren(...children);
  void fillIcons(visible);
}

async function fillIcons(visible) {
  const bySrc = new Map();
  for (const it of visible) {
    if (it.icon || icons.has(ukey(it))) continue;
    if (!bySrc.has(it.__src)) bySrc.set(it.__src, []);
    bySrc.get(it.__src).push(it.id);
  }
  for (const [src, ids] of bySrc) {
    for (let at = 0; at < ids.length; at += 128) {
      const chunk = ids.slice(at, at + 128);
      try {
        const result = await dd.folders.icons(src, chunk);
        const got = Object.entries((result && result.icons) || {});
        for (const id of chunk) icons.set(src + ":" + id, null);
        for (const [id, uri] of got) icons.set(src + ":" + id, uri);
        if (got.length) render();
      } catch (e) { dd.log("warn", "icons failed", (e && e.code) || String(e)); return; }
    }
  }
}

function tile(item) {
  const props = { title: item.path || item.name };
  if (settings.showLabels !== false) props.label = item.name;
  const icon = item.icon || icons.get(ukey(item));
  if (icon) props.src = icon; else props.glyph = KIND_GLYPH[item.kind] || "📄";
  const el = create("dd-app-tile", props);
  el.addEventListener("click", () => open(item, el));
  return el;
}

function addTile(source) {
  const props = { add: true, title: "Choose items from " + source.label };
  if (settings.showLabels !== false) props.label = source.label;
  const btn = create("dd-app-tile", props);
  btn.addEventListener("click", async () => {
    if (dd.ui.pressGuard && !dd.ui.pressGuard(btn)) return;
    try {
      const result = await dd.dialogs.pickFolderItems(source.key, { checked: members[source.key] || [] });
      if (result && !result.cancelled) {
        members[source.key] = [...new Set((result.ids || []).filter((id) => typeof id === "string"))];
        persistMembers();
        render();
      }
    } catch (e) { dd.log("warn", "picker failed", (e && e.code) || String(e)); }
  });
  return btn;
}

function emptyState() {
  const btn = create("dd-button", { variant: "outline" }, "Pick folders");
  btn.addEventListener("click", async () => {
    try { await dd.settings.open({ highlight: "folder1" }); }
    catch (e) { dd.log("warn", "settings open failed", (e && e.code) || String(e)); }
  });
  return create("div", { class: "dd-empty empty" },
    create("div", "No sources yet — point the drawer at one or more folders."), btn);
}

async function open(item, el) {
  if (dd.ui.pressGuard && !dd.ui.pressGuard(el)) return;
  try {
    await dd.folders.open(item.__src, item.id);
    usage[ukey(item)] = (usage[ukey(item)] || 0) + 1;
    persistUsage();
    if (isCollapsible() && settings.autoCollapse === true && !collapsed) setCollapsed(true);
  } catch (e) {
    const code = (e && e.code) || String(e);
    dd.log("warn", "open failed", item.name, code);
    if (code === "NOT_FOUND") void refresh();
  }
}

async function refresh() {
  const srcs = sources();
  itemsBySource = new Map();
  await Promise.all(srcs.map(async (s) => {
    try {
      const result = await dd.folders.list(s.key);
      const list = (result && result.items) || [];
      for (const it of list) { it.__src = s.key; it.__srcLabel = s.label; }
      itemsBySource.set(s.key, list);
      if (result && result.error) dd.log("warn", "source unavailable", s.key);
    } catch (e) { dd.log("warn", "list failed", s.key, (e && e.code) || String(e)); itemsBySource.set(s.key, []); }
  }));
  render();
}

async function main() {
  await dd.ready;
  collapsed = (await dd.storage.get("collapsed")) === true;
  const m = await dd.storage.get("members");
  members = m && typeof m === "object" ? m : {};
  const u = await dd.storage.get("usage");
  usage = u && typeof u === "object" ? u : {};

  await dd.settings.bind((next) => {
    settings = next;
    if (booted) void refresh(); else render();
  });
  dd.folders.onChange(() => void refresh());

  headerEl.addEventListener("click", () => { if (isCollapsible()) setCollapsed(!collapsed); });

  booted = true;
  await refresh();
  markRegions();
}

main().catch((err) => dd.log("error", "launch drawer boot failed", String(err)));

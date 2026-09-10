# Launch Drawer

An aggregated, type-grouped launcher drawer for [DeskDash](https://www.desktop-dashboard.com) —
an evolution of the Desktop Drawer. Instead of mirroring **one** folder A–Z, it pools **several**
folder sources into one drawer and groups everything by **type**: Apps & Games, Folders, Files —
with an optional **Most used** section.

> Built on the same host API as the Desktop Drawer (`dd.folders.list/open/icons`,
> `dd.dialogs.pickFolderItems`, `dd.storage`, the collapse-to-handle behaviour).

## Install

Copy `launch-drawer/` into `Documents\DeskDash\widgets\`, add it from the widget picker, then open
its settings.

## How it works

- **Up to 5 sources.** Point *Source 1–5* at any folders (Apps, Games, a Scripts folder, your
  Desktop…) and give each a name. Every source's items are pooled into one drawer.
- **Grouped, not A–Z.** Items are bucketed by type and shown under headers:
  - **Apps & Games** — `.exe`, `.lnk`, `.msi`, `.url`, and scripts (`.bat`, `.cmd`, `.ps1`, `.vbs`)
  - **Folders**
  - **Files**
  - **Most used** — top items by launch count (toggle *Most-used section*)
  - Order via *Group order*: apps-first, folders-first, or most-used-first.
- **Launching.** A click is the host's double-click (`dd.folders.open`): `.exe` launches, folders
  open, `.bat`/`.cmd` run. See the limitation on `.ps1` below.
- **Two content modes.** *all* mirrors each source; *curated* starts empty and each source gets a
  **＋** tile (in the *Add* group) that opens the host item picker so you cherry-pick what shows.
- **Collapsible handle.** Same as the Desktop Drawer — collapses to a slim handle on any edge, with
  optional collapse-after-launch.

## Limitations (platform)

- **`.ps1` scripts.** `dd.folders.open` is a double-click, so PowerShell scripts open in your default
  `.ps1` handler (usually the editor) rather than executing — that's the Windows default, not the
  drawer. A `.bat`/`.cmd` wrapper (`powershell -File script.ps1`) runs directly, and I can add a
  "run scripts through PowerShell" path if the host exposes a shell-run verb.
- **Sources are settings**, so there are five fixed slots rather than an unlimited "+ add a folder
  from anywhere" button. Point each at a broad folder (e.g. a Games directory) and its subfolders/
  exes all appear. If a per-item "add from anywhere" picker turns out to be exposed by the API, I can
  switch to that.
- **Folders as shortcuts.** A source shows a folder's *contents*; to have a folder itself appear as a
  tile you open, point a source at its parent — the subfolders then show as folder tiles.

## Ideas to iterate on

- Per-item rename / custom icon.
- A dedicated "Recent" section from launch timestamps.
- Drag between drawers (the Desktop Drawer's `dd.peers` flow) if you run several.

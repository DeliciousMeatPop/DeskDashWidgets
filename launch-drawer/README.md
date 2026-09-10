# Launch Drawer

A hand-picked launcher drawer for [DeskDash](https://www.desktop-dashboard.com) — an evolution of the
Desktop Drawer. Instead of mirroring **one** folder A–Z, you **add the individual items you want**
from several catalogs, and it groups them by **type** (Games, Apps, Programs & Scripts, Folders,
Files) with an optional **Most used** section.

> Built on the host catalogs: `dd.games.*` (installed games + cover art), `dd.apps.*` (system apps),
> and `dd.folders.*` / `dd.dialogs.pickFolderItems` (Desktop + picked folders). Collapse-to-handle
> behaviour is shared with the Desktop Drawer.

## Why it works this way

DeskDash has **no "open an arbitrary path" verb** — a shortcut has to come from something the host can
list and launch. So the drawer builds its set from what *is* launchable:

- **Games** — every installed game, with cover art (`dd.games.launch`). Toggle: *Installed games*.
- **Apps** — system apps like Explorer, Terminal, Task Manager, Notepad (`dd.apps.launch`). Toggle:
  *System apps*.
- **Desktop + folders** — tick the exact exes, scripts, shortcuts and folder items you want with the
  **＋** tile (`dd.dialogs.pickFolderItems`). Desktop is on by default (blank source); add up to three
  more folders for anything not on the desktop.

To add a loose exe/script/folder that lives somewhere odd, point one of the Extra folders at its
containing folder, then tick it in — that's the closest the API allows to "add anything from
anywhere."

## Install

Copy `launch-drawer/` into `Documents\DeskDash\widgets\`, add it from the widget picker, then open
its settings.

## How it works

- **Grouped, not A–Z.** Everything is bucketed by type under headers: **Most used**, **Games**,
  **Apps**, **Programs & Scripts** (`.exe/.lnk/.msi/.url/.bat/.cmd/.ps1/.vbs`), **Folders**, **Files**.
  Order via *Group order* (apps-first / folders-first / most-used-first); toggle headers off for a
  plain grid.
- **Curated is the default.** Use the **＋ Add shortcuts** tiles at the bottom (one per source:
  Desktop and each extra folder) to tick exactly the items you want. Switch *Folder/desktop items* to
  *all* to mirror instead.
- **Launching** uses the right verb per item: `dd.games.launch`, `dd.apps.launch`, or
  `dd.folders.open` (double-click). `.exe` launches, folders open, `.bat`/`.cmd` run.
- **Most used** tracks launch counts and floats your top items to the top.
- **Collapsible handle** — collapses to a slim handle on any edge, optional collapse-after-launch.

## Limitations (platform)

- **No "add anything from anywhere" file picker.** DeskDash exposes launchable things through
  *catalogs* (games, apps) and *folder listings* (Desktop + folders you point at) — there's no verb
  to open an arbitrary path. So a loose exe/script/folder is added by pointing an **Extra folder** at
  its container and ticking it in. Games and apps need no setup — they come from their catalogs.
- **`.ps1` scripts** open in your default `.ps1` handler (usually the editor) rather than executing —
  that's the Windows association, not the drawer. A `.bat`/`.cmd` wrapper (`powershell -File x.ps1`)
  runs directly. If the host ever exposes a shell-run verb I'll add a proper "run via PowerShell".
- **A folder shows its *contents*.** To have a folder itself appear as an openable tile, point an
  Extra folder at its parent — the subfolders then show as folder tiles.

## Ideas to iterate on

- Curate individual games/apps (hide ones you don't want), not just all-or-nothing toggles.
- Per-item rename / custom icon; a "Recent" section from launch timestamps.
- Portrait game covers in a taller tile shape.

# Aurora Dock

A glass **dock-style taskbar** for [DeskDash](https://www.desktop-dashboard.com), inspired by
the Aurora bar but rebuilt to behave like a macOS-style dock with a lot more control. It replaces
the Windows taskbar with a floating glass bar: pinned/running apps, an editable Start button, live
system vitals as plain numbers, a movable Now-Playing panel, a network graph, notification badges,
the system tray, and a clock with five faces.

> Built to the public DeskDash taskbar docs (`kind: "bar"`). Aurora's own source isn't published, so
> this is a clean, from-scratch implementation in its spirit — not a fork.

## Install (drop-in)

1. Copy the whole `aurora-dock/` folder into `Documents\DeskDash\taskbars\`.
2. In DeskDash, open **Marketplace → Taskbars** (or the taskbar picker) and choose **Aurora Dock**.
3. Right-click the bar → **Taskbar settings…** to set side, size (50–200 %), auto-hide, and all the
   options below.

```
aurora-dock/
├─ manifest.json     # kind:"bar", permissions, all user settings
├─ index.html        # bar layout (two <dd-bar> segments)
├─ widget.js         # dock logic: vitals, clock, magnify, breathe, badges, tray
├─ style.css         # glass dock + magnification + breathing + edge handling
├─ pane.html/.css/.js# popouts: now-playing · network · system · launcher
└─ README.md
```

## Features & where they live

| Feature | Setting(s) | Notes |
|---|---|---|
| **Dock magnification** | `magnify`, `magnifyStrength`, `magnifyReach` | Gaussian falloff — hovered item rises most, neighbours less. Applies to Aurora Dock's own controls (and host app buttons when they're reachable). |
| **Breathing pulse** | `breathing`, `breathingInterval` | Staggered ripple on a timer; `0` = off. Respects reduced-motion. |
| **Clock, 5 faces** | `clockFace`, `clock24h`, `clockSeconds`, `clockDate`, `dateFormat`, `secondaryTz` | `stacked · digital · analog · worded · dual`. **Click the clock to cycle faces live.** |
| **Editable Start** | `startMode`, `startLabel`, `startIcon`, `startUrl`, `launcherItems` | `windows` (real Start menu) · `launcher` (your shortcut grid, ships with defaults) · `link` (open a URL/app). |
| **CPU / RAM / GPU %** | `showCpu`, `showRam`, `showGpu` | Plain number percents, colour-graded (amber ≥70 %, red ≥90 %). Click any → **System** panel. |
| **Network graph** | `showNet` | Live rx/tx sparkline, up/down + session totals. Click the `NET` pill. |
| **Now Playing** | — | Compact chip → click opens a **draggable + resizable** panel with art, progress and transport. Size/position persist. |
| **System tray** | `systray` preset | Standard `<dd-tray-caret>` with an unread-count badge. |
| **Notification badges** | `badges` | Reads unread counts out of window titles (e.g. `(5) Telegram`, `(3) Discord`) into a badge rail. |

## Notes on the platform edges

- **Magnification & the app strip.** The pinned/running apps are drawn by DeskDash (`<dd-apps>`), so
  Aurora Dock magnifies its own controls and *opportunistically* the app buttons when the host exposes
  them in light DOM. Where it doesn't, those buttons keep their native hover — no breakage either way.
- **Notification badges.** There's no public per-app "unread count" SDK verb, so badges are derived
  from window titles, which is how Telegram/Discord/Slack/WhatsApp already advertise unread counts.
  Apps that don't put a count in their title simply won't show a badge. To preview the rail:
  `window.__auroraBadge("Telegram", 5)` in the widget's devtools.
- **Now-Playing controls** call `dd.media` transport verbs defensively (`playPause`/`pause`/`play`,
  `next`, `previous`); on a host that names them differently the panel still shows metadata and just
  no-ops the missing control.
- **Panes are pointer-only** and close on outside-press (a host rule for bars). The Now-Playing panel
  remembers its geometry so it reopens exactly where you left it.

## Publishing

Manifest already declares `kind:"bar"`, the `bar` block, and `minAppVersion 0.3.5`. To submit: zip the
folder → **Marketplace → Submit → Taskbar**.

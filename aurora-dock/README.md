# Aurora Dock

A dock-style evolution of the **Aurora** taskbar for [DeskDash](https://www.desktop-dashboard.com).
It keeps Aurora's living light field (the glass that dances to audio and breathes with the CPU) and
its host-driven app strip, and rebuilds the rest to feel like a macOS-style dock.

> Built on the real Aurora source (`deskdash.aurora`): the light field, the media/vitals streams and
> the `dd.bar.store()` app model are adapted from it, so this uses the same SDK verbs Aurora does.

## Install

1. Copy the `aurora-dock/` folder into `Documents\DeskDash\taskbars\`.
2. In DeskDash open **Marketplace → Taskbars** and choose **Aurora Dock**.
3. Right-click the bar → **Taskbar settings…** for everything below.

```
aurora-dock/
├─ manifest.json   kind:"bar", permissions, settings
├─ index.html      bar layout (real dd-* components)
├─ widget.js       light field + clock + magnification + breathing + vitals + badges
├─ style.css       glass + magnification (via ::part(lift)) + breathing + badges
├─ deck.html/.css/.js   the popout: tabbed Now-playing · System · Network · Apps
├─ grid.svg / note.svg  icons
└─ README.md
```

## What it adds over Aurora

| Feature | Setting(s) | How it works |
|---|---|---|
| **Dock magnification** | `magnify`, `magnifyStrength`, `magnifyReach` | Gaussian falloff written to `--mag-scale`/`--mag-lift`, which the components' `::part(lift)` reads — the hovered icon rises most, neighbours proportionally less. |
| **Breathing pulse** | `breathing`, `breathingInterval` | Staggered ripple across the entries on a timer (0 = off); reduced-motion / low-spec safe. |
| **Clock, 5 faces** | `clockFace`, `format24h`, `clockSeconds`, `clockDate`, `secondaryTz` | `stacked · digital · analog · worded · dual`. **Click the clock to cycle faces live.** Driven by `dd.time.onTick`. |
| **Number vitals** | `showVitals`, `showNet` | CPU/RAM/GPU/NET as plain percents (not rings), amber ≥60 % / red ≥85 %. Click → deck **System/Network**. |
| **Editable start + launcher** | `startLabel`, `showLauncher`, `launcherItems` | Real Windows Start (editable label) plus an **Apps** launcher button → deck **Apps** tab, a grid of your shortcuts (ships with defaults). |
| **Network graph** | — | Deck **Network** tab: live rx/tx graph + up/down + session totals, self-subscribed to `dd.system.onVitals`. |
| **Now playing** | `showMedia` | Bar chip → deck **Now playing** with art, seek and transport (`dd.media` playPause/seek/next/previous) and the system volume pill. |
| **System tray** | `systray` preset | Standard `<dd-tray-caret>`. |
| **Notification badges** | `badges` | Reads unread counts from window titles (e.g. `(5) Telegram`) via `dd.bar.store().entries` and floats a badge over that app's button (`apps.appFor(key)`). |

## Honest platform limits

- **Now-playing "movable/resizable window."** DeskDash draws bar popouts itself — host-anchored above the
  strip, at the size the trigger asks for (`pane-w`/`pane-h`), and they close on outside-press. A free
  floating, user-resized window isn't something a bar widget can create, so the now-playing lives in the
  deck popout instead (larger, with full transport). If you want a true detachable window, that's a
  feature request for the DeskDash dev, not something the widget API exposes today.
- **One popout per bar.** `manifest.popout.entry` is singular, so the chip, the vitals and the launcher
  all open the *same* deck; it remembers the last tab you used (`localStorage`).
- **Badges** need the app to advertise its unread count in the window title (Telegram/Discord/Slack/WhatsApp
  do). Apps that don't simply won't badge — there's no per-app unread SDK verb.

## If this gives you trouble

Because it's a separate widget id, it won't clash with Aurora — you can keep both installed and switch.
The alternative, if you'd rather, is to fold these features straight into Aurora's own folder (it already
loads and runs); the code here is written against the same SDK so it ports over cleanly.

# Pulseglass Dock

Pulseglass Dock is a living glass taskbar for DeskDash that reacts to music and system activity.
Inspired by Aurora, rebuilt as a full desktop dock.

Three rounded glass segments (left / centre / right) that cut out the empty space between them, an
audio-reactive light field, true dock magnification, number vitals, a movable clock, a split network
readout, and a now-playing deck.

## Install

Copy `pulseglass-dock/` into `Documents\DeskDash\taskbars\`, pick it in **Marketplace → Taskbars**,
then right-click the bar → **Taskbar settings…**.

## Features

- **Segmented glass dock** — empty gaps click through; adjustable **click margin** so there's bar to
  right-click for settings.
- **Light field** — reacts to audio and CPU; **custom gradient colours** and a **glow** slider.
- **Magnification** — Gaussian falloff (hovered rises most, neighbours less); strength + reach.
- **Breathing pulse** — a gentle staggered wave on a timer; shares the magnify channel so hovering no
  longer cancels it.
- **Start button** — your own element: editable **label**, a custom **image** (`dd.image.load`),
  **size**, and position **on the left edge** or **in the dock**.
- **Clock, 5 faces** — standard / large / analog / worded (5-minute) / dual timezone; driven from real
  time each second; movable to four slots (including past the tray chevron); click to cycle.
- **Vitals** — CPU / RAM / GPU number percents with **custom warn/danger thresholds and colours**.
- **Network** — ↓ download / ↑ upload, **stacked or side-by-side**, fixed width.
- **Now-playing deck** — art, marquee title, seek + transport, the system volume pill, a **System**
  tab (meters + chips) and a **Network** tab (live graph, fixed centred totals).
- **Colour-coded open apps** — running apps in colour, pinned/idle greyed (optional, replaces dots).
- **Notification badges** — from window titles (optional, off by default, unstable).

## Known platform limits

- **Occluded popups.** If an always-on-top or elevated window (e.g. Directory Opus, sometimes Chrome)
  sits above the DeskDash layer, the host can't raise the Start menu or the now-playing deck over it.
  Start and panes are host-drawn, so this is a DeskDash z-order limitation, not the widget.
- **Inline tray icons** aren't exposed to bar widgets — only the overflow caret + a count. The caret
  stays; the real icons open from it.
- **Notification badges** rely on the app putting its unread count in the window title
  (Telegram/Discord/Slack do).

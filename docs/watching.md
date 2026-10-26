# Watching

Your channels are live the moment they have a number: in your players (see
[Connecting Players](clients.md)) and right here in the browser. This page
covers the **Guide** — the home page — and **TV mode**, plus the bits that
follow you round the app: search, notifications, and using it on a phone.

## The Guide

The home page is what's on: the date, how many channels are **on air** and how
many people are **watching**, one channel live and large, and every channel
underneath.

<img src="screenshots/guide.webp" alt="The Guide: Cartoon Network live up top with what's up next on it beside, and every channel's listings underneath" width="100%" />

**Up top** is one channel: the picture of what it's playing, its number and
logo, and a frosted card with what's on — the show's or movie's logo (or its
name), the episode, the time it started and ends, and how far in. A program
that airs in parts (a [broadcast episode](channels.md#broadcast-episodes-multi-segment-shows))
shows its parts to scale along that bar, with its breaks in amber. Click the
picture to watch it in TV mode.

Beside it, **Up next on** the channel: the next few programs and their times,
with **Watch**, **Open channel**, and a button that copies the channel's stream
URL for a player.

Which channel is up top? The one you picked last (this browser remembers it),
else whichever has the most people watching, else the first by number.

**All channels** is the guide: every channel on one time axis, a pinned time
ruler, a red now-line, a few hours of what already aired (dimmed) and as far
ahead as each schedule is built. Each row starts with the channel's tile —
pick it to bring that channel up top — and each program opens its details:
its picture, what it is, its summary and cast, and a link on to its page.

<img src="screenshots/guide-grid.webp" alt="All channels: every channel's listings on one time axis, with a red now-line, a broadcast episode drawn in parts and breaks in amber" width="100%" />

Above the grid: **12h / 24h / 48h** for how far it reaches, **Compact /
Standard / Wide** for how much room each half hour gets, and **Now** to jump
back to the present. Under it, what the marks mean — a bar in parts is one
airing in parts, an amber one a break.

On a fresh install the Guide opens on the **Welcome to MosaicTV** checklist
instead, until your first channel is on air (see
[Getting Started](getting-started.md)).

## TV mode

**Watch** — on the Guide, a channel's card or page, or **Tune in** on a show
or movie that's on — turns the browser into a TV: the channel full screen, and
nothing else. `/watch/64` opens channel 64; `/watch` opens the last channel you
watched.

<img src="screenshots/tv-mode.webp" alt="TV mode on Cartoon Network: the picture full screen, and the glass strip along the bottom with the channel, the show's logo, how far in it is and what's next" width="100%" />

As you tune in, a slim **glass strip** along the bottom says what's on: the
channel's tile, the title's logo over its episode, how far in it is (a
broadcast episode's parts and breaks to scale, and which part is on) and
what's next. It takes about a seventh of the screen and fades after a few
seconds; **I** brings it back. On a phone held upright it stacks into a
compact card.

Move the mouse (or tap) and the controls appear along the top: **exit**,
channel **down** and **up**, the **channel guide**, **Cast**, **mute** and a
**volume** slider, **instant flipping**, **Looks**, **picture in picture**,
**full screen**, and **Keys**.

### The keys

| Key | What it does |
| --- | ------------ |
| **↑ ↓** (or swipe) | Channel up / down (also Page Up / Page Down) |
| **0–9** | Tune straight to a number — type it, it tunes |
| **⌫** | Back to the last channel |
| **G** (or Enter) | The channel guide |
| **I** | What's on (the glass strip) |
| **M** | Mute |
| **− +** | Volume |
| **R** | Looks: CRT, TV set, classic guide |
| **C** | CRT on or off |
| **F** | Full screen |
| **P** | Picture in picture |
| **?** | These keys |
| **Esc** | Leave TV mode |

### The channel guide

**G** opens the channel guide over the picture: every channel with what's on
now, how far in, and what's next. **↑ ↓** choose, **Enter** watches, **Esc**
closes. The channel you're watching is marked.

<img src="screenshots/tv-guide.webp" alt="TV mode with the channel guide open over Cartoon Network: every channel's now and next" width="100%" />

### Looks

**Looks** (the TV button, or **R**) dresses the picture up for the shows it's
showing — in this browser only; the channels and every other player are
untouched:

- **CRT** (or **C**) — scanlines, a gentle curve and a glow, as on a tube TV,
  drawn on the graphics card.
- **TV set** — a 4:3 program framed by an old set, its channel number in the
  dial's little window, instead of black bars down the sides. It appears only
  while the picture has the bars, and goes when a widescreen program comes on.
- **Classic guide** — the channel guide in the blue, boxy look of a cable
  guide.

<img src="screenshots/tv-looks.webp" alt="Nickelodeon in TV mode with the CRT look, a 90s show framed by the old TV set" width="100%" />

<img src="screenshots/tv-classic-guide.webp" alt="The channel guide in the classic blue cable-guide look, over Nickelodeon" width="100%" />

Each is remembered in this browser for next time.

### Instant flipping

Turn on **instant flipping** (the ⚡ button) and the channels either side of
the one you're on keep running, so a flip lands on a live picture instead of a
second or two of tuning — at the cost of an encoder each on the server. It's
remembered in this browser.

### Picture in picture

The button beside Full screen (or **P**) pops the channel into a small window
that stays on top of other tabs and apps while the TV-mode tab stays open. Its
skip buttons flip channels, and so do media keys and the system's media
controls, which show what's on and the channel's logo. Firefox has its own
picture-in-picture toggle on the video, so the button isn't shown there.

### Casting

The **Cast** button sends the channel to a TV. Once a TV is playing, TV mode
is its remote: flip channels and the TV follows.

- **Chrome / Edge → Chromecast or Google TV.** Chrome only allows casting from
  a page opened over **HTTPS** (or `localhost`), so it works once MosaicTV is
  served over HTTPS — Tailscale's `tailscale serve` or a reverse proxy with a
  real certificate both do it. The TV plays the channel's stream itself, so it
  must be able to reach that same address. On plain `http://` the button
  explains this instead; Chrome's own menu (⋮ → Cast…) can still mirror the tab.
- **Safari → AirPlay.** No HTTPS needed; TV mode plays Safari's native
  stream so it can be handed to an Apple TV.

With [sign-in](security.md) on, a cast hands the TV a link of its own, so it
plays wherever the TV is.

## On a phone or tablet

Everything works on a phone. The side rail becomes a tab bar along the bottom
— **Guide**, **Channels**, **Library**, and **More** for Studio, Settings,
Live TV setup and the rest — and search moves to the top. No page scrolls
sideways at phone width.

<table>
  <tr>
    <td width="33%"><img src="screenshots/mobile-guide.webp" alt="The Guide on a phone" /></td>
    <td width="33%"><img src="screenshots/mobile-channels.webp" alt="Channels on a phone" /></td>
    <td width="33%"><img src="screenshots/mobile-show.webp" alt="Dexter's Laboratory's page on a phone" /></td>
  </tr>
</table>

What a mouse finds on hover is simply shown — each item's **⋯**, a channel
card's Watch button — and things you'd drag or right-click are a **long press**
away: adding a title to a channel, moving a collection's posters. In TV mode,
swipe up and down to flip, and tap for the controls.

A big monitor goes the other way: at 1440p and 4K the pages get wider and the
grids get more columns, rather than leaving empty margins.

## Search

**Ctrl K** (⌘K on a Mac), or the search button at the top of the rail, opens
search from anywhere — even while you're typing in a field. It finds pages,
channels, settings sections, and every show, movie and artist in your
library; on a library's page it can also narrow that library's grid to what
you've typed. **↑ ↓** and **Enter**, as you'd expect.

<img src="screenshots/command-palette.webp" alt="Search finding Dexter's Laboratory as you type" width="70%" />

## Notifications

The **bell** at the foot of the rail (top right on a phone) follows the work
MosaicTV does in the background — library scans, metadata fetches, ident
builds — with live progress, wherever you are in the app, and keeps what
each one found once it's done (**Scan all** sums up every library in one).
A finished job also shows once as a toast.

## Live TV setup

**Live TV setup** (the link button at the foot of the rail, or **More** on a
phone) has the addresses your players tune — the M3U playlist, the XMLTV guide
and the HDHomeRun tuner — with copy buttons and the steps for Jellyfin, Plex,
Emby and VLC & apps. All of it is in [Connecting Players](clients.md).

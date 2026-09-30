<p align="center">
  <img src="web/public/logo-full.png" alt="MosaicTV" width="420" />
</p>

<p align="center">
  <b>Turn your media library into scheduled 24/7 live TV channels.</b><br/>
  Your shows and movies, playing on a real schedule — with station logos, station breaks,
  "up next" cards, and a TV guide — in Plex, Jellyfin, Emby, or any IPTV player.
</p>

<p align="center">
  <img src="docs/screenshots/dashboard.webp" alt="The MosaicTV dashboard: every live channel over the artwork of what it's airing, and the guide for the next few hours" width="100%" />
</p>

---

Remember channel surfing? MosaicTV brings it back, but every channel is built
from *your* library. Set up a Saturday-morning cartoons block, a 24/7 sitcom
rotation, a late-night movie channel — then flip to it like real TV: it's
already playing, mid-episode, right on schedule.

Inspired by [ErsatzTV](https://ersatztv.org/), rebuilt from scratch to be
simple to run and pleasant to configure.

## At a glance

- 📺 **Real live-TV channels** — tune in mid-program like broadcast TV; every channel resumes where it left off, forever.
- 🛋 **TV mode** — your channels full screen in the browser: flip with the arrow keys or a swipe, punch in a number, pull up the channel guide.
- 🗓 **Scheduling that thinks like a station** — a 24/7 rotation plus day/time blocks with soft or exact-time starts, five playback orders, and a broadcast clock that starts shows on the :00 and :30. Edit it any time: the guide follows from the next program on, and the Schedule tab warns you about what will go wrong before it airs.
- 🧩 **Multi-segment episodes, aired as broadcast** — cartoons split into 7-minute shorts play as the half-hour episodes they aired as, even with a short borrowed from another show.
- 📺 **Real commercial breaks** — breaks at each episode's act breaks (found from chapters or fades to black), filled from a folder of your old bumpers, promos and commercials.
- 🎬 **Broadcast polish** — station logos and watermarks, station breaks with generated idents and music, and a frosted-glass "up next" card with the next show's poster.
- 🔍 **A library built in** — scanner, TMDB and TheTVDB artwork and metadata, show pages and a searchable poster wall.
- 📡 **Works with what you watch on** — M3U + XMLTV for Jellyfin, Emby, VLC, TiviMate and any IPTV app, and a built-in HDHomeRun tuner for Plex (no Threadfin needed).
- ⚡ **GPU encoding** — NVIDIA, Intel QuickSync, VAAPI, AMD AMF or Apple VideoToolbox, verified on your host, with a clean CPU fallback.
- 📦 **One container** — web UI, database and ffmpeg included. Runs on Unraid, any Docker host, or a NAS.

## Features

### A control room, not a config file

The dashboard shows every channel live over the artwork of what it's airing,
with a progress bar, time left and what's next — click a picture to watch it in
the browser. The **Channels** page puts your channels four to a row with the
full **TV guide** underneath: a pinned time ruler, a red now-line, 12/24/48-hour
spans and three zoom levels. Click any program for its details.

<img src="docs/screenshots/channels.webp" alt="Channels and the TV guide on one page" width="100%" />

### Channels built from collections

A channel plays **collections** — the programming units you build from whole
shows, single seasons, individual episodes and movies, plus an optional smart
filter (by library, type, title or genre). Members show as a poster grid you
drag into order, with each show's seasons and episode count at a glance.

<img src="docs/screenshots/collections.webp" alt="A channel's collections as a poster grid" width="100%" />

### Multi-segment episodes, aired the way they were broadcast

A lot of classic cartoons were made as shorts. A half-hour of *Dexter's
Laboratory* is three seven-minute segments, and *2 Stupid Dogs* ran a *Super
Secret Secret Squirrel* short between its two dog cartoons. Your files store
each segment as its own episode, so most tools air them as separate programs,
shuffle them apart and fill the guide with seven-minute slivers.

MosaicTV puts them back together. On any season, **Group broadcast episodes**
folds the segments that aired together into one **broadcast episode**. The
segments play back-to-back as a single program and show as one entry in the
guide. Every playback order and every "play N" turn treats the episode as one
program, and a block's end or a hard start never splits it. A grouped episode
never re-airs as loose parts.

- **Suggest groupings** packs consecutive segments into 11-, 22- or 30-minute
  slots (or a length you choose) as a starting point. Tick, group, reorder or
  ungroup from there.
- **Borrow a segment from another show.** Search the whole library and slot a
  short from a different series into the running order, right where it aired.
  That show's own page then marks which of its episodes air inside another.
- **Nothing on disk changes.** Grouping is metadata only: your files keep their
  names and their real season and episode numbers.

The full walkthrough is in
[Channels & Scheduling](docs/channels.md#broadcast-episodes-multi-segment-shows).

<img src="docs/screenshots/broadcast-episodes.webp" alt="Dexter's Laboratory season 1, each segment tagged with the broadcast episode it belongs to" width="100%" />

<img src="docs/screenshots/broadcast-episodes-editor.webp" alt="Grouping 2 Stupid Dogs: each broadcast episode is two dog cartoons with a Secret Squirrel short between them" width="100%" />

### Five playback orders, explained as you pick

Every collection plays in one of five orders, each described in plain words
with a live preview of its first airings:

| Order | What it airs |
| ----- | ------------ |
| **Your order** | Exactly as arranged — each show's full run before the next one. |
| **Release order** | Oldest first: movies by year, each show's episodes in order. |
| **Rotate shows** | One episode from each show in turn, in your order. |
| **Rotate shows, mixed** | Every show gets one episode per round, each round in a new random order. |
| **Shuffle** | Everything at random, nothing repeating until all of it has played. |

In a rotation **each show keeps its own place**: add a show and it starts at
episode 1 while the rest carry on; reorder them and only whose turn is next
changes.

<img src="docs/screenshots/playback-orders.webp" alt="The playback order picker with a live preview of the first airings" width="100%" />

### A schedule that runs like a station

The **rotation** is the channel's 24/7 backbone — collections that loop
forever, 1 or N programs a turn. **Time blocks** override it for specific days
and times (*Weekdays 6–9pm → Cartoons*), shown on a weekly grid. A **soft**
start waits for the current program to finish; a **hard** start begins on the
dot, with a station break covering the gap. Each block can carry its own
playback order, logo, breaks and up-next card. Guides are built ahead to your chosen horizon and
topped up automatically, so listings never run dry — and there's nothing to rebuild after an
edit: the guide changes from the next program on, and every show carries on from the episode it
was up to.

Turn on the **broadcast clock** and every program starts on the :00 and :30,
the time between filled with a break — and with **breaks inside programs**,
that break time is split across each episode's act breaks, the way it aired
with commercials. The **Schedule** tab warns you about the traps before they
air (a block that will run into an exact-time start, season 0 specials airing
first), and the Guide tab shows **what aired** and lays the schedule out
**weeks ahead** — what's on any day next month, and how late each block really
starts.

<img src="docs/screenshots/schedule.webp" alt="A channel's rotation and weekly time-block grid" width="100%" />

### Your library, with artwork

A Plex-style scanner indexes TV, movies and music videos (incremental,
ffprobe-backed), files each movie's and show's extras under it, and reads
metadata the way Plex's agents do — .nfo files, the files' own tags, TMDB and
TheTVDB, in the order you set: posters, backdrops, summaries, ratings, cast, and every
episode's name, air date and still, in the episode order the show follows. Browse each library as a
poster wall with search and sort, open a show on its backdrop, and fetch or
re-match metadata per library from Settings. Thumbnails are sized to the tile
and cached, so big libraries stay quick to browse.

<img src="docs/screenshots/library.webp" alt="The library: each source as a mosaic of its posters, with top-rated and recently-added shelves" width="100%" />

<img src="docs/screenshots/show.webp" alt="A show page over its backdrop, with every season" width="100%" />

### Studio: logos, watermarks, music and clips

**Studio** is the branding kit. Upload logos and give each its own
**watermark** — permanent or intermittent with fades, any corner, size and
opacity — previewed live over a frame from your library in 16:9 or 4:3. Music
and video clips for your station breaks live here too.

<img src="docs/screenshots/studio-logos.webp" alt="Studio: logos with a live watermark preview" width="100%" />

### Station breaks

**Breaks** cover the gaps so blocks end on time, and each channel's **Breaks**
tab is the one place they're set up. A channel's **idents** are what plays:
**Frosted glass** (rows of logos behind frosted glass, out-of-focus lights
drifting at different depths, your logo floating in front), **Spotlight** (a
lit glass card with a sweeping gleam), or a clip of your own, each with an
optional music bed. An ident plays **everywhere else** or **only during
certain blocks** (pick them by logo — a Nick at Nite ident for the Nick at
Nite blocks), and where several can play, breaks take turns. Play a
six-second preview with the real logo and music before you save.

The tab shows when the next break is and what it'll play, which blocks have
breaks (set per block on the Schedule tab), a week map coloured by the ident
each block plays, and a warning when an ident — or a whole channel's breaks —
would never air. Every new channel starts with a frosted-glass ident made from
its logo, so nothing plays that the tab doesn't show.

<img src="docs/screenshots/frosted-filler.webp" alt="A frame of the generated Frosted glass station ident" width="100%" />

### "Up next" cards

Near the end of a program, a frosted-glass card slides in naming what's on
next: the poster, the title, the episode and its title, the year, genres and
rating, and the time it starts. A broadcast episode gets one card, listing
every segment, and long titles are cut neatly instead of running across the
screen. On a pillarboxed 4:3 show the card stays on the picture. Music videos
get a matching **Now playing** card as they start.

Pick **Glass** or a cable-style **Broadcast** bar, put it in any corner or
along any edge (clear of your logo), in three sizes. A live preview shows your
channel's actual next program, with its logo where the watermark sits.

<img src="docs/screenshots/up-next-card.webp" alt="An up-next card for a Dexter's Laboratory broadcast episode, over Aaahh!!! Real Monsters" width="100%" />

### The default watermark

The default watermark (for logos without settings of their own) has the same
live preview over a frame from your library.

<img src="docs/screenshots/settings-watermark.webp" alt="Settings: the default watermark with a live preview" width="100%" />

### TV mode

**Watch** turns the browser into a TV: the channels full screen, a banner with
what's on and what's next as you tune in, and a channel guide over the picture.
Flip with **↑ / ↓** or a swipe, type a number to jump straight to a channel,
**⌫** for the last one. With **instant flipping** on, the channels either side
keep running, so a flip lands on a live picture in a fraction of a second.

### Search, notifications and casting

- **Search from anywhere** (Ctrl/⌘ K) — pages, channels, settings, and every
  show and movie in your library.
- **Notifications** — a bell in the top bar follows ident builds, library
  scans and metadata fetches with live progress, and tells you when each
  finishes, wherever you are in the app.
- **Watch and cast** — any channel's live preview plays in the browser and can
  be sent to a Chromecast or Google TV (Chrome/Edge, over HTTPS) or an Apple TV
  (Safari, AirPlay).

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/command-palette.webp" alt="Search across pages, channels and the library" /></td>
    <td width="50%"><img src="docs/screenshots/notifications.webp" alt="The notification bell following background work" /></td>
  </tr>
</table>

### Works on a phone, and on a 4K monitor

The whole interface is responsive — from a phone (the sidebar becomes a
drawer) to a laptop to a 1440p or 4K monitor, which gets wider pages and more
columns rather than a narrow strip.

<p align="center">
  <img src="docs/screenshots/mobile-dashboard.webp" alt="The dashboard on a phone" width="300" />
  &nbsp;&nbsp;
  <img src="docs/screenshots/mobile-channels.webp" alt="Channels on a phone" width="300" />
</p>

### Output and encoding

- **Standard M3U + XMLTV**, plus a built-in **HDHomeRun tuner** that Plex's
  Live TV adds directly. **Live TV setup** at the bottom of the sidebar has
  every address with copy buttons and step-by-step instructions per player.
- **Shared HLS** (one transcode per channel, however many viewers) or
  per-client **MPEG-TS**.
- **Per-channel encoding profiles** — resolution, fps, bitrate, deinterlacing,
  subtitle burn-in and loudness normalization — and a preferred audio
  language per channel.
- **GPU encoding** on NVIDIA, Intel QuickSync, VAAPI, AMD AMF or Apple
  VideoToolbox, each verified by a real test encode on your host.
- **One-click backup** from Settings (restoring is a file copy — see
  [Troubleshooting](docs/troubleshooting.md)), and an in-app log viewer with a
  download for bug reports.

## Quick start

```bash
docker run -d \
  --name mosaictv \
  --restart unless-stopped \
  -p 8688:8688 \
  -e TZ=America/Chicago \
  -v /path/to/appdata/mosaictv:/app/data \
  -v /path/to/your/media:/media:ro \
  ghcr.io/tronvondoom/mosaictv:latest
```

Open `http://YOUR-SERVER:8688`, add a library, scan, build a channel — the
[Getting Started guide](docs/getting-started.md) walks you through all of it
in about ten minutes.

> ⚠️ MosaicTV has no login — keep it on your LAN (or behind a VPN like
> Tailscale). See [Security](docs/security.md).

## Documentation

| | |
| - | - |
| 🚀 [Installation](docs/install.md) | Docker run · Portainer · **Unraid template** · Compose |
| 🏁 [Getting Started](docs/getting-started.md) | First library → first channel → first stream |
| 🗓 [Channels & Scheduling](docs/channels.md) | Collections, multi-segment broadcast episodes, rotations, time blocks, playback orders, the guide |
| 🎨 [Branding](docs/branding.md) | Logos, watermarks, station breaks, up-next cards |
| 📡 [Connecting Players](docs/clients.md) | Jellyfin · Emby · Plex · VLC · IPTV apps · casting |
| ⚡ [Hardware Acceleration](docs/hardware-acceleration.md) | CPU vs NVIDIA, setup per platform, profiles |
| 🔒 [Security](docs/security.md) | LAN-only stance, VPN access, reverse proxies |
| 🛠 [Troubleshooting & Backup](docs/troubleshooting.md) | Common fixes, logs, backup/restore |

## Tech stack

Express + TypeScript backend, React + Vite + Tailwind frontend, Prisma +
SQLite, ffmpeg for everything video. See [CHANGELOG.md](CHANGELOG.md) for
release history.

For local development:

```bash
npm run install:all   # root + server + web dependencies
npm run dev           # backend :8688, frontend :5173
```

## Contributing

Issues and PRs welcome — bug reports with the in-app log download attached are
extra welcome. If you're missing a feature (another ident look? another
metadata source?), open an issue and let's talk.

## License

[GPL-3.0](LICENSE) — free to use, modify, and share; derivatives stay open.

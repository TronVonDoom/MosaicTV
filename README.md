<p align="center">
  <img src="web/public/logo-full.png" alt="MosaicTV" width="420" />
</p>

<p align="center">
  <b>Turn your media library into scheduled 24/7 live TV channels.</b><br/>
  Your shows, movies and music, playing on a real schedule — with station logos, station breaks,
  "up next" cards and a TV guide — in Plex, Jellyfin, Emby, any IPTV player, or your browser.
</p>

<p align="center">
  <a href="docs/install.md"><b>Install</b></a> ·
  <a href="docs/getting-started.md"><b>Getting started</b></a> ·
  <a href="docs/tour.md"><b>Tour</b></a> ·
  <a href="docs/how-to.md"><b>How-tos</b></a> ·
  <a href="docs/README.md"><b>Docs</b></a> ·
  <a href="https://www.reddit.com/r/MosaicTV/"><b>r/MosaicTV</b></a> ·
  <a href="CHANGELOG.md"><b>Changelog</b></a>
</p>

<p align="center">
  <img src="docs/screenshots/guide.webp" alt="The MosaicTV Guide: one channel large at the top with its live picture and what's up next, and every channel in the guide grid below" width="100%" />
</p>

---

Remember channel surfing? MosaicTV brings it back, but every channel is built
from *your* library. Rebuild Cartoon Network as it was in 2001, Nickelodeon's
1996 lineup with SNICK on Saturday night, a Halloween movie channel for
October, a station that plays your music — then flip to one like real TV: it's
already playing, mid-episode, right on schedule.

Every picture on this page comes from a real MosaicTV running those very
channels.

## At a glance

- 📺 **Real live-TV channels** — tune in mid-program like broadcast TV; every channel resumes where it left off, forever.
- 🧩 **Cartoons in the half-hours they aired as** — shorts grouped into broadcast episodes, even with a short borrowed from another show.
- 🗓 **Scheduling that thinks like a station** — a 24/7 rotation, dayparts on a weekly grid, soft or exact-time starts, a broadcast clock on the :00 and :30, blocks that only run in October, and Christmas episodes kept for Christmas. Edit any time: the guide follows from the next program on.
- 🎬 **Broadcast polish** — station logos and watermarks, idents made from your logo, commercial breaks at each episode's act breaks, promos for what's on later, and up-next cards with the next show's logo.
- 🎵 **Music channels** — songs from your own files over a now-playing screen: the album art, a spectrum drawn from the song, or its lyrics as they're sung.
- 🔍 **A library built in** — a Plex-style scanner that reads .nfo files, tags, TMDB and TheTVDB (or your Plex, Jellyfin or Emby server), with show and movie pages that know where everything's on.
- 📡 **Works with what you watch on** — M3U + XMLTV for Jellyfin, Emby, VLC, TiviMate and any IPTV app, a built-in HDHomeRun tuner for Plex, a guide channel for players with no guide, and TV mode in the browser.
- ⚡ **One container, GPU or not** — web UI, database and ffmpeg included; NVIDIA, Intel, AMD or Apple encoding verified on your host, with a clean CPU fallback.

## Cartoons, the way they aired

This is why MosaicTV exists. A half-hour of *Dexter's Laboratory* was three
seven-minute cartoons. *2 Stupid Dogs* ran a *Super Secret Secret Squirrel*
short between its two dog cartoons. Your files list each short as its own
episode — and the squirrel as a different show altogether — so most tools air
them as seven-minute slivers, shuffled apart, with the squirrel nowhere near
the dogs.

MosaicTV puts them back together. On any season, **Group broadcast episodes**
folds the segments that aired together into one **broadcast episode**: they
play back to back as a single program, show as one entry in the guide and get
one up-next card naming every part. Every playback order treats it as one
program, and a block's end or an exact-time start never splits it.

<img src="docs/screenshots/broadcast-episodes-editor.webp" alt="Grouping 2 Stupid Dogs: each broadcast episode is two dog cartoons with a Super Secret Secret Squirrel short between them — Door Jam, Goldflipper, Where's the Bone" width="100%" />

- **Suggest groupings** packs consecutive segments into 11-, 22- or 30-minute
  slots (or a length you choose) as a starting point. Tick, group, reorder or
  ungroup from there.
- **Borrow a segment from another show.** Search the whole library and slot a
  short from a different series into the running order, right where it aired.
  That show's own page then marks which of its episodes air inside another.
- **Nothing on disk changes.** Grouping is metadata only: your files keep their
  names and their real season and episode numbers.

<img src="docs/screenshots/show-episodes.webp" alt="Dexter's Laboratory season 1: each segment tagged with its place in a broadcast episode, and when it last aired" width="100%" />

## A channel in three steps

**New channel**: name it, tap the posters of what it plays, and choose all
day or blocks. That's a channel, on the air, with its guide built.

<img src="docs/screenshots/new-channel.webp" alt="New channel, step 2: posters from the TV library, five cartoon shows picked, and the preview adding up 491 episodes, about 110 hours" width="100%" />

## A schedule that runs like a station

The **rotation** is a channel's 24/7 backbone — collections that loop
forever, one or more programs a turn. **Time blocks** take over for set days
and times, on a weekly grid. A **soft** start waits for the current program to
finish; a **hard** start begins on the dot, with a station break covering the
gap. Each block can have its own playback order, logo, breaks and up-next
card.

Here's Nickelodeon in 1996: Nickelodeon by day, Nick at Nite every night, and
SNICK on Saturdays from 8 — a hard start on a half-hour **broadcast clock**,
so *Clarissa*, *Kenan & Kel*, *Ren & Stimpy* and *Are You Afraid of the Dark?*
each start on the :00 or the :30, with a break filling the time between.

<img src="docs/screenshots/schedule.webp" alt="Nickelodeon's week of time blocks: Nickelodeon by day, Nick at Nite every night, SNICK on Saturday at 8" width="100%" />

And a Halloween movie channel in seven dayparts — Little Monsters in the
morning, a family matinee, the monster hits, Fright Night after 8 (Freddy on
Fridays, in order), then Midnight Madness and the Graveyard Shift:

<img src="docs/screenshots/schedule-dayparts.webp" alt="The Halloween channel's seven movie dayparts across the week" width="100%" />

- **Blocks for part of the year.** Give a block a **season** — October,
  Christmas, the holidays, summer, or any dates — and it takes its hours from
  the all-year schedule only then.
- **Holiday episodes in their season.** Christmas episodes at Christmas,
  Halloween ones in October, wherever they fall in a show's run.
- **Breaks inside programs.** On a broadcast clock, the break time is shared
  out across each episode's act breaks — found from its chapter marks, or its
  fades to black — the way it aired with commercials.
- **Nothing to rebuild.** Guides are built ahead and topped up on their own.
  Edit anything and the guide changes from the next program on, with every
  show carrying on from the episode it was up to.
- **Trouble spotted before it airs.** The Schedule tab warns about the traps
  (a block that will run into an exact-time start, specials airing first), and
  **Weeks ahead** lays the schedule out two months out: how late each block
  really starts, break time a day, and when each show starts over.

<img src="docs/screenshots/weeks-ahead.webp" alt="Weeks ahead on Nickelodeon: break time a day, never off air, how late each block starts, and when each show goes back to an earlier episode" width="100%" />

### Channels built from collections

A channel plays **collections**: whole shows, single seasons, episodes, movies,
artists or albums, plus an optional smart filter (by library, type, title or
genre). Members show as a poster grid you drag into order.

<img src="docs/screenshots/collections.webp" alt="Cartoon Network's collections: the daytime shows as a poster grid in the order they take turns, with Toonami and Adult Swim beside them" width="100%" />

Every collection plays in one of five orders, each described in plain words
with a preview of its first airings:

| Order | What it airs |
| ----- | ------------ |
| **Your order** | Exactly as arranged — each show's full run, or each artist's music, before the next one. |
| **Release order** | Oldest first: movies and music by year, each show's episodes in order. |
| **Take turns** | One episode from each show, or one song from each artist, in turn, in your order. |
| **Take turns, mixed** | Every show or artist gets one turn per round, each round in a new random order. |
| **Shuffle** | Everything at random, nothing repeating until all of it has played — and never the same artist twice running. |

Taking turns, **each show and artist keeps its own place**: add one and it
starts at its first episode while the rest carry on; reorder them and only
whose turn is next changes.

## The Guide

The **Guide** is home: one channel large at the top with its live picture,
the show's logo and what's up next, and every channel in the grid below — a
red now-line, broadcast episodes with their parts and breaks marked, music in
hour blocks. It's the same guide your players get as XMLTV.

<img src="docs/screenshots/guide-grid.webp" alt="The guide grid across every channel with a red now-line" width="100%" />

## Station breaks

**Breaks** cover the gaps so blocks end on time, and each channel's **Breaks**
tab is the one place they're set up. A channel's **idents** are what plays,
each made from the logo on the air with an optional music bed:

- **Mosaic** (the default) — your logo on a wall of glass tiles, with rings of
  light spreading out from behind it.
- **Frosted glass** — rows of logos gliding behind frosted glass, out-of-focus
  lights drifting at different depths, your logo floating in front.
- **Your own clip**, or **Clips from a folder** — a break reel of your old
  bumpers, promos and commercials, a fresh mix every break.

<img src="docs/screenshots/idents.webp" alt="Two idents made from channel logos: Mosaic for Nickelodeon and frosted glass for Cartoon Network" width="100%" />

An ident plays **everywhere else** or **only during certain blocks** — a Nick
at Nite ident for the Nick at Nite blocks — and where several can play, breaks
take turns. The tab shows when the next break is and what it'll play, a week
map coloured by the ident each block plays, and a warning when an ident would
never air.

<img src="docs/screenshots/breaks.webp" alt="Nickelodeon's Breaks tab: when breaks happen, a Mosaic ident for Nickelodeon and SNICK, and another for Nick at Nite" width="100%" />

**Promos.** A break can end on twelve seconds promoting something later on the
channel — *Tonight at 5:30*, *Saturday at 9 AM* — with its backdrop and poster,
picked from the guide as the break airs: movies, blocks starting, broadcast
episodes, premieres and prime time first.

<img src="docs/screenshots/promo.webp" alt="A promo for Johnny Bravo tonight at 5:30, its three cartoons named, over its backdrop" width="100%" />

## "Up next" cards

Near the end of a program, a card slides in naming what's on next: the time
it starts, the show's or movie's logo (its name when it has none), the
episode, and every part of a broadcast episode. Five looks:

- **Art banner** — a bar filled with the next program's artwork, a violet
  time block at its end and the title's logo on it.
- **Logo bar** — a slim frosted bar with the title's logo standing up out of it.
- **Snipe** — a ribbon that slides out from behind your channel's own logo.
- **Preview** — a little screen of what's next.
- **Coming up** — the next program and up to four after it.

<img src="docs/screenshots/up-next-card.webp" alt="The art banner over Dexter's Laboratory, naming Duck Dodgers at 4:00 and its two cartoons" width="100%" />

Any corner or edge, three sizes, and a card never covers your logo: it steps
clear of it. A live preview in the channel's settings shows its actual next
program.

<img src="docs/screenshots/up-next-styles.webp" alt="The logo bar naming Ghostbusters: Frozen Empire, the snipe sliding out of the Nickelodeon logo, the preview of Venom, and Coming up listing five Marvel movies" width="100%" />

## A guide channel

Like the old cable guide channel: a channel whose picture is every other
channel's now and next, ninety minutes of the grid scrolling up the screen
with a clock and a window on something that's on — so a player that can only
tune channels can still see what's on. In the classic blue, or the app's own
look.

<img src="docs/screenshots/guide-channel.webp" alt="The guide channel in its Classic look: Are You Afraid of the Dark? in the window, the clock, and every channel's next ninety minutes" width="100%" />

## Music channels

Songs from your own files air over a **now-playing screen**: the album art, a
spectrum drawn from the song, or its lyrics, lit line by line as they're sung —
with what played before and what's next along the bottom. Music is filed by
album artist the way music apps file it, **Take turns** works by artist, and
MusicBrainz, the Cover Art Archive and LRCLIB fill in albums, covers and synced
lyrics, free. In the guide, a run of songs reads as one block an hour named
after its collection, with the set list a click away.

<img src="docs/screenshots/now-playing.webp" alt="The music channel's now-playing screen: Cloudtop Cruise from Mario Kart 8, on the Super Smash Bros. anthology" width="100%" />

## Your library, with artwork

A Plex-style scanner indexes TV, movies, music videos and music, files each
title's extras under it, and reads metadata the way Plex's agents do — .nfo
files, the files' own tags, TMDB and TheTVDB, in the order you set — or reads
a library straight from your **Plex, Jellyfin or Emby** server. You get
posters, backdrops, **title logos**, summaries, ratings, cast, and every
episode's name, air date and still.

<img src="docs/screenshots/library.webp" alt="The library: TV Shows, Movies and Music, each a wall of its posters, with how much is on now and off air, and a top-rated shelf" width="100%" />

Every title's page shows where it's on the air — the channels carrying it,
its next airing and the evening around it — with **Tune in** and **Add to a
channel** a click away.

<img src="docs/screenshots/show.webp" alt="Dexter's Laboratory's page: its logo over the backdrop, live on Cartoon Network, and the evening it airs in" width="100%" />

<img src="docs/screenshots/tv-home.webp" alt="The TV Shows library's Home: what's on air now from it, with each show's logo, and the next hours of the channels that air it" width="100%" />

## Studio: logos and watermarks

**Studio** is the branding kit. Upload logos and give each its own
**watermark** — permanent or intermittent with fades, any corner, size and
opacity — previewed live over a frame from your library. Music and clips for
your breaks live here too.

<img src="docs/screenshots/studio-logos.webp" alt="Studio: the channels' logos — Cartoon Network, Toonami, adult swim, Nickelodeon, Nick at Nite, SNICK — one open with its watermark" width="100%" />

## TV mode

**Watch** turns the browser into a TV: the channels full screen, a slim glass
strip with the show's logo, its parts and what's next as you tune in, and the
channel guide over the picture. Flip with **↑ / ↓** or a swipe, type a number
to jump straight to a channel, **⌫** for the last one. Picture in picture,
media keys, and casting to a Chromecast, Google TV or Apple TV. **Looks** put
the shows back on the set they aired on: a CRT's scanlines and curve, an old TV
set round a 4:3 program, and the guide in the blue cable-guide look.

<img src="docs/screenshots/tv-mode.webp" alt="TV mode on Cartoon Network: the glass strip with the channel, the show's logo, its parts and what's next" width="100%" />

<img src="docs/screenshots/tv-guide.webp" alt="TV mode with the channel guide open over the picture" width="100%" />

## And the rest

- **Search from anywhere** (Ctrl/⌘ K) — channels, settings, and every show,
  movie and artist in your library.
- **Notifications** — a bell follows ident builds, library scans and metadata
  fetches with live progress, wherever you are in the app.
- **Works on a phone, and on a 4K monitor** — a tab bar on a phone, long-press
  menus, and wider pages with more columns on a big screen.

<table>
  <tr>
    <td width="40%"><img src="docs/screenshots/command-palette.webp" alt="The search palette finding Dexter's Laboratory" /></td>
    <td width="20%"><img src="docs/screenshots/mobile-guide.webp" alt="The Guide on a phone" /></td>
    <td width="20%"><img src="docs/screenshots/mobile-channels.webp" alt="Channels on a phone" /></td>
    <td width="20%"><img src="docs/screenshots/mobile-show.webp" alt="A show's page on a phone" /></td>
  </tr>
</table>

### Output and encoding

- **Standard M3U + XMLTV**, plus a built-in **HDHomeRun tuner** that Plex's
  Live TV adds directly. **Live TV setup** (the link icon in the rail) has
  every address with copy buttons and step-by-step instructions per player.
- **One encode per channel**, however many people watch — as MPEG-TS or
  shared HLS — and only channels someone is watching are encoded.
- **Ready-made encoding profiles** — 720p, 1080p (the default), 1440p and
  4K — or your own: resolution, fps, bitrate, deinterlacing, subtitle burn-in
  and loudness normalization, per channel, with a preferred audio language.
- **GPU encoding** on NVIDIA, Intel (QuickSync or VAAPI) or AMD (VAAPI) —
  and AMF or Apple VideoToolbox outside Docker — each verified by a real test
  encode on your host.
- **Sign-in for away from home** — a password or a code you approve, home
  still gets straight in, and players get links of their own.
- **Backup and restore** from Settings, a copy taken before any upgrade
  changes the database, and an in-app log with a download for bug reports.

## Hardware requirements

Only channels someone is watching are encoded, and viewers of the same channel
share one encode — so size the server by how many **different channels are
watched at once**.

| | Light | Recommended | Heavy |
| - | ----- | ----------- | ----- |
| **Channels watched at once** | 1–2 | 3–5 | 6 or more |
| **CPU** | 4 cores, from about 2015 on | 4–6 cores | 6–8 cores |
| **GPU** | None (CPU, 720p) | Intel, AMD or NVIDIA; NVIDIA GTX 1050+ for HEVC files | NVIDIA RTX |
| **RAM** | 4 GB | 8 GB | 16 GB |

Any tier needs a 64-bit Docker host — Intel/AMD, or ARM such as a Raspberry
Pi 5 (CPU encoding only: one or two 720p channels) — an SSD with about 10 GB
free for app data, and a wired connection. See
[Hardware requirements](docs/hardware-acceleration.md#hardware-requirements)
for what drives the cost, measured numbers and bandwidth per viewer.

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

Open `http://YOUR-SERVER:8688`, add a library, scan, make a channel — the
[Getting Started guide](docs/getting-started.md) walks you through all of it
in about ten minutes. `:latest` is the newest release; `:edge` follows every
change.

> 🔒 Out of the box MosaicTV has no login, which is right for a home network.
> To watch away from home, use a VPN like Tailscale, or turn on **sign-in**
> (Settings → Sign-in): a password or a code you approve, and links of their
> own for players. See [Security](docs/security.md).

## Documentation

| | |
| - | - |
| 🚀 [Installation](docs/install.md) | Docker run · Portainer · **Unraid template** · Compose |
| 🏁 [Getting Started](docs/getting-started.md) | First library → first channel → first stream |
| 👀 [A tour of MosaicTV](docs/tour.md) | Every screen, one after another |
| 🧑‍🍳 [How-tos](docs/how-to.md) | Recipes: a Saturday-morning block, cartoons as they aired, a Halloween month, a music channel… |
| 📚 [Your Library](docs/library.md) | Libraries, naming, scanning, metadata and logos, fixing matches, Plex/Jellyfin/Emby |
| 🗓 [Channels & Scheduling](docs/channels.md) | Collections, broadcast episodes, rotations, time blocks, seasons, the clock, the guide |
| 🎨 [Branding](docs/branding.md) | Logos, watermarks, station breaks, promos, up-next cards |
| 📺 [Watching](docs/watching.md) | The Guide, TV mode, looks, picture in picture, casting |
| 📡 [Connecting Players](docs/clients.md) | Jellyfin · Emby · Plex · VLC · IPTV apps |
| ⚡ [Hardware Acceleration](docs/hardware-acceleration.md) | Hardware requirements, CPU vs GPU, setup per platform, profiles |
| 🔒 [Security](docs/security.md) | Sign-in, player links, VPN access, reverse proxies |
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

## Community

Questions, ideas, and the lineups people have built: come say hi on
[r/MosaicTV](https://www.reddit.com/r/MosaicTV/).

## Contributing

Issues and PRs welcome — bug reports with the in-app log download attached are
extra welcome. If you're missing a feature (another ident look? another
metadata source?), open an issue and let's talk.

## Support

MosaicTV is free and stays free — every feature, for everyone. If it's earned a
spot on your server and you'd like to chip in, you can
[sponsor it on GitHub](https://github.com/sponsors/TronVonDoom) or
[buy it a coffee on Ko-fi](https://ko-fi.com/tronvondoom). The heart and the
cup at the bottom of the app's rail go to the same places.

### Sponsors

With thanks to the people keeping MosaicTV on the air.

<!-- Who goes here, by tier:
     Station owner ($25/month): avatar + link to their GitHub profile, first.
     Premium channels ($10/month) and Box set ($50 one-time): by name.
     Monthly sponsors stay while they sponsor; one-time Box sets stay for good. -->

## License

[GPL-3.0](LICENSE) — free to use, modify, and share; derivatives stay open.

# Getting Started

From a fresh install to your first live TV channel. Each step builds on the
last; the whole thing takes about ten minutes plus scan time.

**The flow:** add a **library** → **scan** it → (add a metadata key) → make a
**channel** → **watch** it → point your **players** at it.

On a fresh install the **Guide** — the home page — opens on a six-step
checklist, **Welcome to MosaicTV**, that follows these same steps: each one
ticks itself off as you do it, and **Next** takes you to the one after. It
goes away once your first channel is on air.

---

## 1. Add a library

**Library → Sources → Add a library.**

<img src="screenshots/library-sources.webp" alt="Library › Sources: the Add a library card, and a TV library with its metadata sources in order" width="100%" />

- **Read from** — **Folders here** (the usual), or a **Plex**, **Jellyfin** or
  **Emby** server that already knows your shows: see
  [From Plex, Jellyfin or Emby](library.md#from-plex-jellyfin-or-emby).
- **Name** — whatever you like ("TV Shows", "Movies", "Cartoons").
- **Type** — **TV Shows**, **Movies**, **Music Videos**, **Music (songs)** or
  **Other / Bumpers**. It decides how file names are read.
- **Folders** — one or more folders *inside the container*, i.e. under
  `/media`. If your host mount is `/mnt/user/media` → `/media`, then the host
  folder `/mnt/user/media/tv` is `/media/tv` here. **Browse…** only looks
  under `/media`; **+ Add another folder** adds a second.

**Add library**. MosaicTV expects Plex-style naming, which you likely
already have:

```
TV/Show Name (2005)/Season 01/Show Name - S01E01 - Episode Title.mkv
Movies/Movie Name (1999)/Movie Name (1999).mkv
Music/Artist/Album/03 - Title.flac
```

Everything in the folders is indexed, as in Plex — specials (season 0) and
extras too. The details, music naming, `.plexignore` and the rest are in
[Your Library](library.md#folders-and-naming).

## 2. Scan it

Hit **Scan** on the library — or **Scan all**, top right of the Library page,
to scan every library one after another. A progress bar tracks files as
they're probed (duration, resolution, codecs) and parsed into shows, seasons,
episodes, movies, artists and albums, and the notification bell follows it
from anywhere in the app.

The library fills in as the scan runs: new titles turn up where they sort, no
refresh needed. Re-scans are quick — unchanged files are skipped, and files
gone from disk are removed (but not while their folder can't be read, so an
unmounted share doesn't empty your library).

## 3. Add a metadata key (optional, but you'll want it)

Without a key everything still scans and airs — just plainer, with no artwork
in the guide. With one you get posters, backdrops, **logos**, summaries,
ratings, cast, and every episode's name, air date and still.

**Settings → Metadata**: paste a free
[TMDB API key](https://www.themoviedb.org/settings/api) and **Save**; add a
[TheTVDB key](https://thetvdb.com/api-information) too if you have one (it
fills in what TMDB doesn't, and knows the DVD and absolute orders older shows
are often numbered by).

<img src="screenshots/settings-metadata.webp" alt="Settings › Metadata: TMDB and TheTVDB keys, and each library's Match unmatched" width="100%" />

Every library that reads TMDB looks its titles up straight away, and from then
on whatever a scan adds is read right after it. `.nfo` files beside your media
are read first, before either. More — and how to fix a title that matched the
wrong show — in [Your Library](library.md#metadata-posters-summaries-and-logos).

## 4. Make a channel

**Channels → New channel.** Three steps:

1. **Name it.** A **name** for the guide, a **number** — its spot on the dial —
   when you like, a **group** ("Kids", "Movies") that players sort by, and a
   **logo** (it starts on the MosaicTV one). Leave the number blank and the
   channel is a **draft**: out of the guide and the playlist until you give it
   one. It's saved as soon as you go on, so you can leave and finish later.
2. **Pick what it plays.** Your shows, movies, music videos and artists as
   posters — tap to put one in, type to narrow the list. Beside them, how
   much you've picked and how long it all runs before anything repeats.
3. **Choose when.** **All day** plays the picks around the clock, one after
   another. **In blocks** takes you to the channel's Schedule tab to draw
   blocks on the week — Saturday mornings 7 to noon, say.

<img src="screenshots/new-channel.webp" alt="New channel, step two: Cartoon Network's shows picked as posters, with the running total beside them" width="100%" />

Your picks become one collection of the channel's own, in the order you
picked them. Seasons, single episodes and albums can be added to it later.

## 5. See what it'll play

**Make the channel** opens it on its **On air** tab: the channel's header —
its live picture, number, logo and what's on, with **Watch** — and its guide,
as a **Timeline** or a **List**. The guide builds itself as soon as there's
something to play, tops itself up as time passes, and follows every change
you make from the next program on.

<img src="screenshots/channel-on-air.webp" alt="Cartoon Network's page: its live picture, number and logo, what's on now, and the On air tab's timeline" width="100%" />

A channel has four tabs:

| Tab | What's there |
| --- | ------------ |
| **On air** | The guide: timeline, list, **What aired**, **Weeks ahead** |
| **Schedule** | The broadcast clock, the rotation, time blocks on a weekly grid, and the channel's collections at the foot |
| **Breaks** | What plays between programs: idents, promos, and where each plays |
| **Settings** | Number, name, group, encoding profile, audio language, logo, the picture (or a guide channel), the up-next card, music |

All of it is in [Channels & Scheduling](channels.md).

## 6. Shape the schedule (when you're ready)

The channel's **Schedule** tab is where it grows up:

- **Rotation** — the 24/7 default: collections that loop forever, each one or
  several programs a turn, in the collection's order — **Your order**,
  **Release order**, **Take turns** (one episode of each show in turn),
  **Take turns, mixed**, or **Shuffle**.
- **Time blocks** — click the weekly grid to add one: *Weekdays 16:00–18:00 →
  Toonami*. A **soft** start waits for the current program to finish; a
  **hard** start begins exactly on time, with a station break in the gap. At
  the other end, **Run over** lets the last program finish past the block's
  end; **Break at the end** plays only what fits and fills the rest with a
  break, so the next block starts on time.
- **Broadcast clock** — start every program on the :00 and :30, like
  broadcast TV, with a break filling each slot.

A channel can be rotation-only, blocks-only, or both. Every show remembers
its place — across days, edits and restarts. The [Recipes](recipes.md) build
real channels this way, step by step.

## 7. Watch!

**Watch** on any channel (or click a picture in the Guide) is **TV mode**: your
channels full screen in the browser. Flip with **↑ / ↓** (or swipe), type a
channel number, **⌫** for the last channel, **G** for the channel guide, **?**
for every key.

<img src="screenshots/tv-mode.webp" alt="TV mode on Cartoon Network: the show full screen, with the glass strip naming what's on, how far in, and what's next" width="100%" />

Everything about TV mode — the looks, picture in picture, casting — is in
[Watching](watching.md).

## 8. Connect your players

**Live TV setup**, at the foot of the side rail (under **More** on a phone),
has your addresses with copy buttons and the steps for each player:

<img src="screenshots/live-tv-setup.webp" alt="Live TV setup: the M3U playlist, XMLTV guide and HDHomeRun tuner addresses with copy buttons, and the steps for Jellyfin" width="70%" />

- **M3U**: `http://YOUR-SERVER:8688/iptv/channels.m3u`
- **XMLTV**: `http://YOUR-SERVER:8688/iptv/xmltv.xml`
- **HDHomeRun tuner** (Plex, Emby): `YOUR-SERVER:8688`

Add them to Jellyfin or Emby, add MosaicTV to Plex's Live TV as a tuner, or
open the M3U straight in VLC or TiviMate. Player-by-player instructions:
[Connecting Players](clients.md).

---

## Polish (when you're ready)

- **Logos & watermark** — upload channel logos in **Studio → Logos**, assign
  them per channel or block, and tune each one's on-screen watermark with a
  live preview. → [Branding](branding.md#logos)
- **Station breaks** — fill the gaps between programs with idents made from
  your logo, or your own bumpers and old commercials, on each channel's
  **Breaks** tab. Every channel starts with one. → [Branding](branding.md#station-breaks)
- **"Up next" cards** — a card naming the next program, with its logo, slides
  in near the end of each one. Channel **Settings** tab → **Coming up next**.
  → [Branding](branding.md#up-next-cards)
- **Picture size** — every channel starts on the ready-made **1080p** profile;
  720p, 1440p and 4K are there too, and your GPU is used when there is one.
  **Settings → Encoding**. → [Hardware Acceleration](hardware-acceleration.md)
- **Away from home** — **Settings → Sign-in**. → [Security](security.md)
- **Backups** — **Settings → Maintenance → Download a backup**.
  → [Troubleshooting & Backup](troubleshooting.md#backup--restore)

# Getting Started

From a fresh install to your first live TV channel. Each step builds on the
last; the whole thing takes about ten minutes plus scan time.

**The flow:** add a **library** → **scan** it → build a **channel** with
**collections** → check its **guide** → point your **player** at the M3U.

---

## 1. Add a library

**Library → Sources** → **Add library**.

- **Name** — whatever you like ("TV Shows", "Movies", "Cartoons").
- **Path** — a folder *inside the container*, i.e. under `/media`. If your
  host mount is `/mnt/user/media` → `/media`, then the host folder
  `/mnt/user/media/tv` is `/media/tv` here. The folder picker only browses
  under `/media`.
- **Type** — TV Shows, Movies, or Music Videos. This controls how filenames
  are parsed.

MosaicTV expects Plex-style naming, which you likely already have:

```
TV/Show Name (2005)/Season 01/Show Name - S01E01 - Episode Title.mkv
Movies/Movie Name (1999)/Movie Name (1999).mkv
```

**Music Videos** parse artist and track out of the folder layout — any of
these work:

```
Music/Artist/Album/Title.mkv
Music/Artist/Title.mkv
Music/Artist - Title.mkv
```

A music-video channel shows a lower-third naming the track as each one starts,
and its guide entries read "Artist – Title" with the album as the sub-title.

## 2. Scan it

Hit **Scan** on the library. A progress bar tracks files as they're probed
(duration, resolution, codecs via ffprobe) and parsed into shows / seasons /
episodes. Re-scans are incremental — unchanged files are skipped, deleted files
are flagged missing.

## 3. (Optional but recommended) TMDB metadata

**Settings** → paste a free [TMDB API key](https://www.themoviedb.org/settings/api)
→ **Save**. Then **Fetch missing** for each library, on the same page. You get
posters, overviews, genres, and ratings — used in the Library and in your
players' guide data.
Local artwork (`poster.jpg`, `folder.jpg`, Plex/Kodi/Jellyfin naming) is used
first when present.

Check your results under **Library → Browse** — drill into shows, seasons, episodes.

## 4. Create a channel

**Channels** → **Add channel**. Give it a **number** (its spot on the dial) and
a **name**. Leave the number blank to keep it a **draft** — hidden from the
guide and stream until you're ready.

Open the channel. It has five tabs: **General · Collections · Schedule ·
Breaks · Guide**.

## 5. Add collections

Collections are the pools of media the channel draws from — created on the
channel's **Collections** tab.

- **Hand-pick** shows/movies with the search box (mix multiple shows in one
  collection), and/or
- add a **smart filter** (by library, type, exact show, title search, or
  genre).

The result is the union of both, deduplicated. Examples: "90s Sitcoms" holding
three hand-picked shows; "Sci-Fi Movies" as a genre filter on your movie
library.

## 6. Schedule it

On the **Schedule** tab:

- **Rotation** — the 24/7 default. An ordered list of collections that loops
  forever. Each entry plays **1 or N** items per turn, in the collection's
  order: **Your order**, **Release order**, **Rotate shows** (one episode of
  each show in turn, in your arrangement), **Rotate shows, mixed**, or
  **Shuffle**.
- **Time blocks** (optional) — day/time slots that override the rotation, e.g.
  *Weekdays 18:00–21:00 → Cartoons*. Click the weekly grid to add one. Blocks
  can have their own playback order, logo, breaks, and "coming up next"
  settings. **Soft start** waits for the current program to finish; **hard
  start** begins exactly on time, with a station break in the gap before it.

A channel can be rotation-only, blocks-only, or both. Episode positions are
remembered — shows resume where they left off, across days and rebuilds.

## 7. Check the guide

The **Guide** tab shows the playout timeline — what airs when, as a timeline or
a list. It builds itself as soon as the channel has a rotation or a block,
extends itself as time passes, and follows every schedule change from the next
program on, with each show carrying on where it was. **Restart from S1E1**
starts every show over.

## 8. Watch!

**Watch** in the sidebar is TV mode: your channels full screen in the browser.
Flip with **↑ / ↓** (or swipe), type a channel number, **⌫** for the last
channel, **G** for the channel guide. Turn on **instant flipping** (the ⚡
button) and the channels either side keep running, so a flip lands on a live
picture — at the cost of an encoder each.

For your TV and apps, **Live TV setup** (in the top bar, and on **Channels**)
has your two URLs, with copy buttons:

- **M3U**: `http://YOUR-SERVER:8688/iptv/channels.m3u`
- **XMLTV**: `http://YOUR-SERVER:8688/iptv/xmltv.xml`

Add them to Jellyfin, Emby, Threadfin (for Plex), or open the M3U straight in
VLC. Full player-by-player instructions: [Connecting Players](clients.md).

---

## Polish (when you're ready)

- **Logos & watermark** — upload channel logos in **Studio → Logos**, assign
  them per channel/block, and tune the on-screen watermark per logo or under
  **Settings → Watermark**, with a live preview.
  → [Branding](branding.md)
- **Station breaks** — fill the gaps between programs with generated
  station idents or your own bumpers, set up on each channel's **Breaks** tab.
  Every channel starts with one made from its logo.
  → [Branding](branding.md#station-breaks)
- **"Up next" cards** — a card naming the next program, with its poster, slides
  in near the end of each one, per channel or per block. Channel **General**
  tab. → [Branding](branding.md#up-next-cards)
- **Encoding profiles** — resolution/fps/bitrate/GPU per channel under
  **Settings**. → [Hardware Acceleration](hardware-acceleration.md)
- **Backups** — **Settings → Maintenance → Download backup**.
  → [Troubleshooting & Backup](troubleshooting.md)

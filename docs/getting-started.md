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

Everything in the folders is indexed, as in Plex — season 0 (shown as
**Specials**) and **extras** too: featurettes, trailers, interviews and deleted
scenes filed with a movie or show (an `Extras`, `Featurettes`, `Trailers`,
`Behind The Scenes`… folder inside its folder, or a name ending in
`-featurette`, `-trailer` and so on). A movie's extras are listed with the
movie, a show's on its page; the library's filter → **Unattached extras** finds
any with no movie of their own. Whether they air is up to each channel (see
[Channels](channels.md)).

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
episodes. Re-scans are incremental — unchanged files are skipped, and files gone from
disk are removed, as in Plex. Not while their folder can't be read, though: a
share that isn't mounted looks like every file in it gone, so those wait,
hidden, for a scan that can read it.

## 3. (Optional but recommended) Metadata

Like Plex's agents, each library reads its metadata from a list of sources,
first to last — the first to give a detail wins, the rest fill in what it
doesn't. Set them on the library's row under **Sources** → **Metadata**:

- **.nfo files** (on by default) — Kodi and Jellyfin metadata kept beside the
  media: `movie.nfo` or `<movie>.nfo`, `tvshow.nfo`, an episode's own
  `<episode>.nfo`. An .nfo that names a TMDB, IMDb or TheTVDB id matches the
  title by that id.
- **The files' own tags** (off by default) — titles and descriptions written
  into the files. Often left over from a release; worth it if you tag your own.
- **TMDB** (on by default) — **Settings** → paste a free
  [TMDB API key](https://www.themoviedb.org/settings/api) → **Save & verify**.
  Every library that reads TMDB looks its titles up there straight away, and
  from then on whatever a scan adds is read straight after it, as in Plex.
- **TheTVDB** (on by default, after TMDB) — **Settings** → paste a
  [TheTVDB API key](https://thetvdb.com/api-information) (and, for a
  user-supported key, your subscriber PIN) → **Save & verify**. After TMDB it
  fills in what TMDB doesn't have — titles TMDB has never heard of, a missing
  summary or episode name; move it above TMDB and it goes first. A title
  matched on one is found on the other by the ids the first lists for it, not
  guessed again by title.

You get posters, summaries, genres, ratings (TV-Y7, PG-13), taglines,
studios and networks, directors and creators, cast, and for every episode its
name, first air date and a still — shown in the Library and sent in your
players' guide data. An episode whose file names it keeps that name; one whose
file doesn't ("Show - S01E02.mkv") takes the name its metadata gives. If a file
names its episode something quite different from a source's episode at that
number — a cartoon split into its segments — that source's details are left off
it rather than showing another episode's; likewise when TheTVDB names the
episode at a number otherwise than TMDB does (the first source in the list wins).
Local artwork (`poster.jpg`, `folder.jpg`, Plex/Kodi/Jellyfin naming) is used
first when present.

A movie or show is found by its title and year — or, like Plex and Jellyfin, by
an id in its folder name: `The Matrix (1999) {tmdb-603}`, `{imdb-tt0133093}`,
`The Office {tvdb-73244}`, `[tmdbid-603]`. The id is left out of the title.

**Episode order.** As Plex lets a show pick TheTVDB's DVD or absolute order, a
show's **⋯** menu → **Episode order…** picks one for it: as aired, one of TMDB's
episode groups (DVD, absolute, production — whatever TMDB has for that show) or
one of TheTVDB's orders. An order of one source's is read from that source
alone. Only the episodes' names, dates and pictures follow it; the files keep
their numbers, and so do the schedule and your broadcast episodes.

Check your results under **Library**: each library opens on its **Home** — what
from it is on air now, the next hours of the channels airing it, and how much
of it no channel airs yet (**Off air**) — with **All** a tab away. Open a movie
or show for its page: where and when it airs, its story and cast, its seasons
and episodes. A title no channel airs has **Add to a channel**.

### Fixing a wrong match

As in Plex: open a movie (or a show's page) and choose **Fix match**. Pick the
source — TMDB or TheTVDB, numbered in the order the library reads them — then
search it by title and year, or paste a TMDB, TheTVDB or IMDb link, and pick the
right one. A match you pick is kept: refreshing metadata never searches that
source for the title again, and the other source follows your pick where it
lists the title. **Not there** leaves the title unmatched on that source (and
moves on to the other, if it has nothing either); **Unmatch** in the menu takes
every match away for good (home videos neither source has).

A library's **filter** finds what wants a look: **Unmatched** (no source has
it), and **Check matches** — automatic matches whose year is off from the
file's by more than a year, or whose title doesn't look like it. (Matches made
before this check existed are checked after a **Refresh all metadata**.)
**Fix them one by one**, beside the filter's note, opens Fix match on each in
turn: pick one, or **Skip**, and it goes on to the next.

A library's **⋯** menu, on its page and under **Sources**, has the rest:
**Force rescan** (read every file again, from scratch), **Match unmatched**,
and **Refresh all metadata** (read everything again from the library's sources,
keeping the matches you fixed by hand).

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

For your TV and apps, **Live TV setup** (at the bottom of the sidebar)
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

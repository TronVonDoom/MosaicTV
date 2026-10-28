# Getting Started

From a fresh install to your first live channel, in about ten minutes plus
scan time. (Haven't installed yet? [Installation](install.md) first.)

**The flow:** add a **library** → **scan** it → make a **channel** → watch it
in **TV mode** → point your **players** at it.

Until you've done all of it, the Guide shows a checklist with your progress,
each step a click away.

---

## 1. Add a library

Open `http://YOUR-SERVER:8688` and go to **Library → Sources → Add a
library**.

- **Name** — whatever you like ("TV Shows", "Movies", "Cartoons").
- **Type** — **TV Shows**, **Movies**, **Music Videos** or **Music (songs)**.
- **Folders** — a folder *inside the container*, under `/media`. If your
  host's `/mnt/user/media` is mounted as `/media`, the host folder
  `/mnt/user/media/tv` is `/media/tv` here. **Browse…** shows what's there.

**Add library.**

<img src="screenshots/library-sources.webp" alt="Library → Sources: the Add a library card with its name, type and folders, and the TV Shows library with its metadata sources in order" width="100%" />

MosaicTV reads Plex-style names, which you most likely have already:

```
TV/Show Name (2005)/Season 01/Show Name - S01E01 - Episode Title.mkv
Movies/Movie Name (1999)/Movie Name (1999).mkv
```

Already have Plex, Jellyfin or Emby? **Read from → Plex / Jellyfin / Emby**
takes the names and artwork from it — see
[From Plex, Jellyfin or Emby](library.md#from-plex-jellyfin-or-emby).

## 2. Scan it

Adding a library scans it straight away. A progress bar follows the files as
they're read, and the library fills in as it goes — no refresh needed. Later,
press **Scan** on the library (or **Scan all**) to pick up what's changed;
re-scans are quick: unchanged files are skipped, deleted ones go.

## 3. Turn on artwork (recommended)

**Settings → Metadata**: paste a free
[TMDB API key](https://www.themoviedb.org/settings/api) and **Save & verify**
— and a [TheTVDB key](https://thetvdb.com/api-information) too, if you have
one. Every library then gets its posters, backdrops, logos, summaries, cast
and episode names, straight away and after every scan. `.nfo` files beside
your media are read first.

Check the results under **Library**: each title has a page with its artwork,
its episodes, and where it's on the air. Something matched wrong? **⋯ → Fix
match**. All of it is in [Your Library](library.md).

## 4. Make a channel

**Channels → New channel**, three steps:

1. **Name it.** A name, and a **number** — its spot on the dial, used by your
   players. Leave the number blank to keep it a **draft**, out of the guide
   until you're ready. **Next** saves it, so you can finish it later.
2. **Pick what it plays.** Tap posters — whole shows, movies, or artists. The
   preview adds up how long it runs before anything repeats.
3. **Choose when.** **All day** plays your picks around the clock. **In
   blocks** opens the Schedule tab to draw them on the week — Saturday
   mornings 7 to noon, say.

<img src="screenshots/new-channel.webp" alt="New channel, step 2: posters to pick from, five cartoon shows picked, and the preview adding up 491 episodes, about 110 hours" width="100%" />

**Make the channel**, and its guide is built straight away.

## 5. Get to know the channel's page

Every channel has a page with its live picture at the top, **Watch**, and
four tabs:

| Tab | What's there |
| --- | ------------ |
| **On air** | Its guide: a **Timeline** or **List** of what airs when, **What aired**, and **Weeks ahead** |
| **Schedule** | The **Rotation** (the 24/7 default), **Time blocks** on a weekly grid, the broadcast clock, and at the foot, **Collections on this channel** — what it all plays from |
| **Breaks** | What plays between programs: its idents, where each plays, promos |
| **Settings** | Number, name, group, encoding profile, logo, the up-next card, music and the guide-channel picture |

<img src="screenshots/channel-on-air.webp" alt="Nickelodeon's page: the live picture, number and logo, what's on now with its progress, and the On air tab's timeline" width="100%" />

There's nothing to build or press: the guide extends itself as time passes,
and any edit — a block, a collection, a show's order — takes effect from the
next program on, with every show carrying on where it was. Each show and
collection remembers its place forever.

## 6. Watch!

Press **Watch** — on the Guide, on a channel's card or its page. That's
**TV mode**: the channel full screen in your browser. Flip with **↑ / ↓** (or
swipe), type a channel number, **⌫** for the last channel, **G** for the
guide, **?** for every key. More in [Watching](watching.md).

<img src="screenshots/tv-mode.webp" alt="TV mode on Cartoon Network with the glass strip along the bottom" width="100%" />

## 7. Put it on your TV

**Live TV setup** — the link icon at the bottom of the rail — has your
addresses, with copy buttons and steps for each player:

- **M3U**: `http://YOUR-SERVER:8688/iptv/channels.m3u`
- **XMLTV**: `http://YOUR-SERVER:8688/iptv/xmltv.xml`
- **Tuner** (for Plex): `YOUR-SERVER:8688`

Add them to Jellyfin or Emby, add MosaicTV to Plex as an HDHomeRun tuner, or
open the M3U in VLC or any IPTV app. Player-by-player steps:
[Connecting Players](clients.md).

---

## Where to next

- **Blocks, dayparts and a broadcast clock** — [Channels & Scheduling](channels.md),
  or the recipes in [How-tos](how-to.md).
- **Cartoons as the half-hours they aired as** —
  [Broadcast episodes](channels.md#broadcast-episodes-multi-segment-shows).
- **Logos, station breaks and up-next cards** — [Branding](branding.md).
- **A GPU, and encoding profiles** — [Hardware Acceleration](hardware-acceleration.md).
- **Backups** — **Settings → Maintenance → Download a backup**, and
  [Troubleshooting & Backup](troubleshooting.md).
- **The whole app, screen by screen** — [A tour of MosaicTV](tour.md).

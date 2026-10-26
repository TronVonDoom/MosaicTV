# The MosaicTV guide

Turn your media library into scheduled 24/7 live TV channels — with station
breaks, logos, "up next" cards, a TV guide, and standard M3U + XMLTV output
that plugs into Plex, Jellyfin, Emby, or any IPTV player.

Every picture in this guide comes from a real MosaicTV and the channels it
runs: **Cartoon Network** on 64 (2001's lineup, with Toonami and Adult Swim),
**Nickelodeon** on 31 (1996, with Nick at Nite and SNICK), a **Halloween**
movie channel on 13, **J&B TV** on 42 and **Music** on 99.

<img src="screenshots/guide.webp" alt="The Guide, MosaicTV's home page: Cartoon Network live up top with what's on next beside it, and every channel's listings underneath" width="100%" />

## Start here

| Guide | What's in it |
| ----- | ------------ |
| [Installation](install.md) | Docker run, Docker Compose, Portainer, Unraid — plus updating and every setting |
| [Getting Started](getting-started.md) | Zero to your first live channel, step by step, in about ten minutes |
| [Recipes](recipes.md) | Real channels built start to finish: Cartoon Network 2001, Nickelodeon 1996 with SNICK, a Halloween movie channel, a music channel, a guide channel |

## Using MosaicTV

| Guide | What's in it |
| ----- | ------------ |
| [Your Library](library.md) | Folders and naming, libraries read from Plex, Jellyfin or Emby, metadata and logos, fixing a match, extras, music, browsing |
| [Channels & Scheduling](channels.md) | A channel's page, collections, broadcast episodes, the rotation, time blocks, seasons, holiday episodes, the broadcast clock, the guide |
| [Branding](branding.md) | Logos and watermarks, station breaks, idents, promos, "up next" cards |
| [Watching](watching.md) | The Guide, TV mode and its keys, looks, picture in picture, casting, phones and tablets, search, notifications |
| [Connecting Players](clients.md) | Jellyfin, Emby, Plex, VLC, and friends — plus shared HLS vs MPEG-TS |

## Running the server

| Guide | What's in it |
| ----- | ------------ |
| [Hardware Acceleration](hardware-acceleration.md) | What to run it on, CPU vs GPU encoding, setup per platform, encoding profiles |
| [Security](security.md) | Sign-in, player links, and watching away from home the safe way |
| [Troubleshooting & Backup](troubleshooting.md) | Common issues, Activity and the log, backing up and restoring |

## How do I…

**Get going**

- [Add my media folder](getting-started.md#1-add-a-library) · [read a library from Plex, Jellyfin or Emby](library.md#from-plex-jellyfin-or-emby) · [scan everything at once](library.md#scanning)
- [Get posters, backdrops and logos](library.md#metadata-posters-summaries-and-logos) · [fix a wrong match](library.md#fixing-a-wrong-match) · [pick DVD or absolute episode order](library.md#episode-order)
- [Make a channel](getting-started.md#4-make-a-channel) · [put a show on a channel from its page](library.md#putting-anything-on-a-channel)
- [Watch in the browser](watching.md#tv-mode) · [connect Jellyfin, Plex, Emby or an IPTV app](clients.md)

**Build a schedule**

- [Play something all day](channels.md#rotation) · [air a block at set times](channels.md#time-blocks) · [start a block exactly on time](channels.md#breaks-starting-and-ending-on-time)
- [Start shows on the :00 and :30](channels.md#the-broadcast-clock) · [cut to breaks where the commercials were](channels.md#breaks-inside-programs)
- [Air a block only in October](channels.md#seasons-blocks-for-part-of-the-year) · [keep Christmas episodes to December](channels.md#holiday-episodes-in-their-season)
- [Choose an order: in sequence, taking turns, shuffled](channels.md#playback-orders) · [group cartoon segments into half-hours](channels.md#broadcast-episodes-multi-segment-shows)
- [Include specials and extras](channels.md#specials-and-extras) · [check what will air before it does](channels.md#checking-a-schedule) · [see what aired](channels.md#the-on-air-tab)

**Make it look like a network**

- [Add channel logos and a watermark](branding.md#logos) · [set up station breaks](branding.md#station-breaks) · [use my own bumpers and old commercials](branding.md#looks)
- [Show an "up next" card](branding.md#up-next-cards) · [end breaks on promos](branding.md#promos) · [make a guide channel](channels.md#the-guide-channel) · [make a music channel](channels.md#music)

**Run the server**

- [Use my GPU](hardware-acceleration.md) · [pick a picture size](hardware-acceleration.md#encoding-profiles) · [watch away from home](security.md#watching-away-from-home)
- [Back up and restore](troubleshooting.md#backup--restore) · [find out why something went wrong](troubleshooting.md#first-stop-settings--activity) · [update](install.md#updating-with-docker-run-or-compose)

## Quick links

- Questions and show-and-tell: [r/MosaicTV](https://www.reddit.com/r/MosaicTV/)
- Web UI: `http://YOUR-SERVER:8688`
- M3U playlist: `http://YOUR-SERVER:8688/iptv/channels.m3u`
- XMLTV guide: `http://YOUR-SERVER:8688/iptv/xmltv.xml`
- HDHomeRun tuner (Plex, Emby): `YOUR-SERVER:8688`
- Per-channel stream (MPEG-TS): `http://YOUR-SERVER:8688/iptv/channel/<number>.ts`
- Per-channel stream (shared HLS): `http://YOUR-SERVER:8688/iptv/channel/<number>/index.m3u8`

## Where things are

The app has five places, down the side rail on a computer and along the bottom
on a phone (Guide, Channels, Library, and **More** for the other two):

| Place | What's there |
| ----- | ------------ |
| **Guide** | The home page: what's on now, large, and every channel's listings |
| **Channels** | Every channel as a card; **New channel**; each channel's page with its **On air**, **Schedule**, **Breaks** and **Settings** tabs |
| **Library** | **Browse** your libraries, and **Sources** — the folders, scans and metadata |
| **Studio** | **Logos** and their watermarks, **Music** for breaks, **Clips** for idents |
| **Settings** | **Metadata**, **Channels**, **Streaming**, **Encoding**, **Sign-in**, **Maintenance**, **Activity** |

At the top of the rail is **search** (Ctrl K, or ⌘K on a Mac). At its foot:
how many channels are on air, the **notification bell**, **Live TV setup**
(the addresses your players tune), and the ways to say thanks.

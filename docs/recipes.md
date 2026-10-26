# Recipes: real channels, step by step

The channels in this guide's pictures are real ones, running on a real
MosaicTV. Here's how to build channels like them yourself — each recipe uses
a different part of MosaicTV, so between them they cover most of what it can
do. Swap in your own shows; the moves are the same.

| Recipe | What it shows off |
| ------ | ----------------- |
| [Cartoon Network, 2001](#cartoon-network-2001) | Broadcast episodes, a borrowed short, Toonami and Adult Swim blocks with their own logos, act breaks, a break reel of old bumpers |
| [Nickelodeon, 1996, with SNICK](#nickelodeon-1996-with-snick) | A blocks-only channel, a hard start on the half-hour clock, an ident for one block, promos, holiday episodes in season |
| [A Halloween movie channel](#a-halloween-movie-channel) | Dayparts, a movie series in release order, the hourly clock, the Coming up card — and a Halloween takeover of another channel |
| [A music channel](#a-music-channel) | Songs over the now-playing screen, synced lyrics, hour blocks in the guide |
| [A sitcom channel of your own](#a-sitcom-channel-of-your-own) | The quickest channel there is: all day, taking turns |
| [A guide channel](#a-guide-channel) | The old cable guide channel, for players that can only tune channels |

Each starts from a library that's scanned, with a TMDB key in **Settings →
Metadata** for the artwork and logos (see [Getting Started](getting-started.md)).

---

## Cartoon Network, 2001

Channel 64: the daytime cartoons taking turns all day, **Toonami** on
weekday afternoons, **Adult Swim** late at night — every show starting on the
:00 or the :30, with commercial breaks where the commercials were.

### 1. Put the cartoons back into half-hours

Before anything airs, group the shows that were made as shorts. **Library →**
*Dexter's Laboratory* **→ Season 1 → Group broadcast episodes**:

1. **Suggest groupings** with a **22 min** target packs the seven-minute
   segments three to a half-hour.
2. Check them against an episode guide; fix any with **↑ ↓**, **×** and
   **Group selected**.
3. **Save**.

Then *2 Stupid Dogs*, which ran a *Super Secret Secret Squirrel* short
between its two dog cartoons: group the dog cartoons in pairs, then on each
group **+ Add segment**, search for the squirrel short that aired with it
(*Goldflipper* between *Door Jam* and *Where's the Bone*), and move it into the
middle with the arrows.

<img src="screenshots/broadcast-episodes-editor.webp" alt="Grouping 2 Stupid Dogs: each broadcast episode is two dog cartoons with a Super Secret Secret Squirrel short between them" width="100%" />

Do this before the channel goes on the air: a channel counts its place in a
show in programs, so grouping later moves where it's up to.
([Broadcast episodes](channels.md#broadcast-episodes-multi-segment-shows))

### 2. Make the channel

**Studio → Logos → Upload logo** for Cartoon Network, Toonami and adult swim.
Then **Channels → New channel**:

1. Number **64**, name **Cartoon Network**, group **Kids**, logo **Cartoon
   Network**.
2. Pick the daytime shows: *Dexter's Laboratory*, *2 Stupid Dogs*, *Johnny
   Bravo*, *Cow and Chicken*, *Ed, Edd n Eddy*, *Courage the Cowardly Dog*,
   *The Powerpuff Girls*…
3. **All day** → **Make the channel**.

That's a working channel already. The picks became a collection called
*Cartoon Network* in the rotation. At the foot of the **Schedule** tab, open
it → **Settings → Plays in this order → Take turns**: one episode of each
show, in turn, each show carrying on from its own place.

### 3. Toonami and Adult Swim

Still at the foot of the Schedule tab, **+ New** collection **Toonami**, and
add *Dragon Ball Z*, *Sailor Moon*, *Gundam Wing*… with **Release order** so
each runs in sequence. Then **Adult Swim**: *Space Ghost Coast to Coast*,
*Aqua Teen Hunger Force*, *Harvey Birdman*, *Sealab 2021*, **Take turns,
mixed**.

<img src="screenshots/collections.webp" alt="Cartoon Network's collections: the daytime shows as a poster grid, with Toonami and Adult Swim beside them" width="100%" />

Up in **Time blocks**, click the weekly grid at Monday 4 PM:

- **Toonami** — Mon–Fri, 16:00–18:00, **Start: Hard**, on-screen logo
  **Toonami**.
- **Adult Swim** — every night, 23:00–02:00, **Start: Hard**, logo **adult
  swim**.

The rotation fills every other hour. ([Time blocks](channels.md#time-blocks))

### 4. Keep it on the clock

At the top of the Schedule tab: **Broadcast clock → :00 and :30**, and tick
**Breaks inside programs**. Now every show starts on the half hour, and the
minutes it leaves are shared out across its act breaks — found from chapter
marks, or from its fades to black — the way it aired with commercials. A
broadcast episode breaks between its parts.
([The broadcast clock](channels.md#the-broadcast-clock))

### 5. Breaks that look like Cartoon Network

On the **Breaks** tab:

- Edit the starter ident: **Frosted glass**, logo **Follow the block**, so
  it's branded Toonami during Toonami and adult swim after 11.
- Got a folder of old Cartoon Network bumpers and commercials? **New ident →
  Clips from a folder**, point it at the folder, and every break plays a fresh
  mix of them, with the frosted glass covering whatever they don't fill.
- **New ident → Mosaic**, **Only during certain blocks → Toonami**, with your
  own music — Toonami gets idents of its own.

([Station breaks](branding.md#station-breaks))

### 6. Up next

**Settings** tab → **Coming up next** → **Show an "up next" card over
programs**, **Art banner**, **Bottom left**, **90** seconds before the end. A
broadcast episode gets one card naming every part.

<img src="screenshots/up-next-card.webp" alt="The art banner on Cartoon Network, naming the next broadcast episode and its parts" width="100%" />

---

## Nickelodeon, 1996, with SNICK

Channel 31: **Nickelodeon** by day, **Nick at Nite** every night, and **SNICK**
on Saturdays from 8 — *Clarissa*, *Kenan & Kel*, *Ren & Stimpy* and *Are You
Afraid of the Dark?*, each starting on the :00 or the :30.

### 1. Three collections

**Channels → New channel**: number **31**, **Nickelodeon**, group **Kids**,
the Nickelodeon logo. Pick the daytime shows — *Doug*, *Rugrats*, *The Ren &
Stimpy Show*, *Rocko's Modern Life*, *Hey Arnold!*… — and choose **In
blocks**. You land on the Schedule tab with a collection called
*Nickelodeon*.

At the foot of the tab, **+ New** two more:

- **Nick at Nite** — *I Love Lucy*, *The Dick Van Dyke Show*, *Bewitched*,
  *The Mary Tyler Moore Show*… **Take turns**.
- **SNICK** — *Clarissa Explains It All*, *Kenan & Kel*, *The Ren & Stimpy
  Show*, *Are You Afraid of the Dark?*, in that order, **Your order**.

### 2. The week

This one has no rotation: it's blocks all the way round. On the weekly grid:

| Block | Days | Time | Start | Logo |
| ----- | ---- | ---- | ----- | ---- |
| Nickelodeon | Every day | 6:00 AM – 8:00 PM | Soft | (the channel's) |
| Nick at Nite | Sun – Fri | 8:00 PM – 6:00 AM | Soft | Nick at Nite |
| SNICK | Sat | 8:00 PM – 10:00 PM | **Hard** | SNICK |
| Nick at Nite | Sat | 10:00 PM – 6:00 AM | Soft | Nick at Nite |

<img src="screenshots/schedule.webp" alt="Nickelodeon's week of time blocks: Nickelodeon by day, Nick at Nite every night, SNICK on Saturday at 8" width="100%" />

Then **Broadcast clock → :00 and :30**. SNICK's **hard** start means it begins
at 8:00 sharp whatever ran before: a program that wouldn't finish by then is
saved for later, and a break fills the minutes up to 8.

<img src="screenshots/block-editor.webp" alt="Editing the SNICK block: Saturday, its season, its own logo, a hard start, and the ident its breaks play" width="100%" />

### 3. Holiday episodes, and the notes

Turn on **Holiday episodes in their season**: *A Rugrats Christmas* waits for
December, the Halloween episodes for October. The schedule notes at the top of
the tab count the holiday episodes for you, and say when a collection is too
short for its blocks (so it repeats within the week) or when specials would
air before season 1 — each with a button to fix it.
([Checking a schedule](channels.md#checking-a-schedule))

### 4. Breaks, and an ident for Nick at Nite

On the **Breaks** tab, the starter Mosaic ident follows the block's logo, so
it's Nickelodeon by day and SNICK on Saturday night. Add **New ident →
Frosted glass**, **Only during certain blocks → Nick at Nite**: the nights get
their own look. **Where each ident plays** colours the week by which ident
each block's breaks play.

<img src="screenshots/breaks.webp" alt="Nickelodeon's Breaks tab: the next break, when breaks happen, a Mosaic ident and a frosted-glass one for Nick at Nite, and the week coloured by ident" width="100%" />

### 5. Promos

**Promos → 1 in 3**: every third break ends on twelve seconds for something
later — *Tonight at 9: Bewitched*, *Saturday at 8: SNICK* — drawn from the
show's own artwork. And **Coming up next** → **Snipe**, a ribbon that slides
out from behind the Nickelodeon logo.

<img src="screenshots/promo.webp" alt="A promo at the end of a Nickelodeon break, for a show later tonight" width="100%" />

---

## A Halloween movie channel

Channel 13: seven dayparts of Halloween movies — Little Monsters in the
morning, a family matinee, the monster hits, Fright Night after 8 (Freddy on
Fridays, in order), then Midnight Madness and the Graveyard Shift — each
movie starting on the hour.

### 1. A collection per daypart

**Channels → New channel**: **13**, **Halloween**, group **Holiday**. Pick the
morning's movies and choose **In blocks**; rename the collection **Little
Monsters**. Then a collection for each daypart:

| Collection | Movies | Order |
| ---------- | ------ | ----- |
| Little Monsters | *Casper*, *Halloweentown*, *Little Monsters*… | Shuffle |
| Family Matinee | *Hocus Pocus*, *The Addams Family*… | Shuffle |
| Monster Hits | *Ghostbusters*, *Gremlins*, *The Monster Squad*, *Beetlejuice*… | Shuffle |
| Fright Night | *The Exorcist*, *Hellboy II*… | Shuffle |
| Freddy Fridays | every *A Nightmare on Elm Street* | **Release order** |
| Midnight Madness · Graveyard Shift | the late-night ones | Shuffle |

**Release order** plays a series oldest first, however you added it — 1984,
1985, 1987…

### 2. The dayparts

Draw them on the week, every day, each with a **hard** start so each daypart
begins on time; give **Fright Night** Sunday to Thursday and Saturday, and
**Freddy Fridays** Friday 8–11 PM.

<img src="screenshots/schedule-dayparts.webp" alt="The Halloween channel's seven movie dayparts across the week" width="100%" />

**Broadcast clock → On the hour**: a 95-minute movie at 8:00 runs to 9:35, and
a break carries it to 10:00.

### 3. Coming up

**Coming up next → Coming up**, **Programs to list: 5**: near the end of each
movie, a panel lists the next five, each with its time.

<img src="screenshots/up-next-styles.webp" alt="The four other card looks; bottom right, Coming up listing the Halloween channel's next five movies" width="100%" />

### Or: a Halloween takeover

Rather than a channel of its own, Halloween can take over another channel for
October. On that channel, add a block — say 7–11 PM every day — with **Season
→ Every year → October**. In October it takes those hours from the all-year
block under it, which plays up to 7, ends on time and picks up again at 11
from the episode it had reached; the rest of the year it isn't there. A
shorter season inside it wins its days, so a **Halloween night** block (Oct 31
only) can sit inside the October one.
([Seasons](channels.md#seasons-blocks-for-part-of-the-year))

---

## A music channel

Channel 99: songs from your own files, around the clock, over a now-playing
screen — with the lyrics when there are some.

1. **Library → Sources → Add a library**, type **Music (songs)**. On its row,
   switch on **MusicBrainz** (albums, years and covers the files don't have)
   and **LRCLIB** (synced lyrics). **Scan**.
2. **Channels → New channel**: **99**, **Music**. On **Music**, pick artists;
   **All day**.
3. The collection's order: **Shuffle** never plays the same artist twice
   running; **Take turns** goes artist by artist.
4. **Settings** tab → **Music**: **Now playing screen: Album**, **If lyrics
   exist, show lyrics first**, **Show what played before and what's next**,
   and **In the guide: Hour blocks** — so the guide lists *Music, 8:00–9:00*
   with its set list rather than a sliver per song.

<img src="screenshots/now-playing.webp" alt="The Music channel's now-playing screen: the album art, the song and how far in it is, and what played before and what's next" width="100%" />

A channel can mix songs with shows and movies however its schedule has them —
a block of music videos at night on an entertainment channel, say.
([Music](channels.md#music))

---

## A sitcom channel of your own

Channel 42, J&B TV: the shows you put on in the background, back to back. The
quickest channel there is.

1. **Channels → New channel**: **42**, **J&B TV**, group **Entertainment**.
2. Pick the shows: *The IT Crowd*, *King of the Hill*, *Black Books*…
3. **All day** → **Make the channel**.
4. The collection → **Settings → Take turns, mixed**: every show once a round,
   in a new order each round.
5. **Coming up next → Logo bar**.

Every show carries on from its own episode, forever — add one later and it
starts at its pilot while the rest keep going.

---

## A guide channel

The cable guide channel, back: every other channel's now and next scrolling up
the screen, with a clock — so Plex's Live TV, an IPTV box or a TV with no
guide of its own can see what's on.

1. **Channels → New channel**: a low number like **1**, name **Guide** — then
   **Finish later**. A guide channel needs nothing to play.
2. On its **Settings** tab → **Picture → The guide**, **Look: Classic** (the
   blue cable guide) or **Mosaic** (the app's own). The tab shows the guide as
   it would air now. **Save**.
3. For the full effect, give it some background music: a collection of smooth
   songs in its rotation on the **Schedule** tab.

<img src="screenshots/guide-channel.webp" alt="The guide channel in its two looks: the classic blue cable guide and MosaicTV's own" width="100%" />

Songs on its schedule play underneath; with none, it's silent, and the guide
lists it as one program a half hour. It shows every channel with a number
except other guide channels.
([The guide channel](channels.md#the-guide-channel))

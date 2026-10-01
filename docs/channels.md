# Channels & Scheduling

How MosaicTV decides what airs when — in depth. For the quick version, see
[Getting Started](getting-started.md).

## The model

```
Channel
├── Collections   (pools of media this channel draws from)
├── Rotation      (ordered list of collections — the 24/7 default)
├── Time blocks   (day/time slots that override the rotation)
└── Playout       (the generated timeline = what actually airs)
```

## Channels

**Channels** page → **Add channel**.

- **Number** — the channel's position on the dial, used in the M3U/XMLTV and
  the stream URL (`/iptv/channel/7.ts`). Leave blank for a **draft**: hidden
  from the guide and stream while you build it out.
- **Name / Group** — shown in players. Group becomes the M3U `group-title`,
  which many players use to categorize channels.
- **Encoding profile** — which output settings this channel streams with
  (default: built-in 720p30). See [Hardware Acceleration](hardware-acceleration.md).
- **Logo** — shown in players' guides, and doubles as the default on-screen
  watermark. See [Branding](branding.md).
- **Coming up next** — an optional card naming the next program, with its poster.
- **Music** — what a song airs over, and whether lyrics come first (see
  [Music](#music)).

## Collections

Each channel manages its own collections (**Collections** tab). A collection
resolves to a set of playable items from two sources, combined and deduped:

1. **Members** — hand-picked entries added via the search box: a whole **show**,
   a single **season** of one, an individual **episode**, a **movie**, an
   **artist** (every music video or song of theirs in one library, as they came
   out — year, album, then track — and any added later), or one **music video**
   or **song**. A collection can hold any mix. **Drag members to reorder them**: *Your order*,
   *Release order* and *Rotate shows* all follow that arrangement.
2. **Smart filter** — optional: by library, media type (music videos and songs
   included), exact show, title search (which matches an artist too, so music
   videos + "Madonna" is a Madonna block from every library), or genre. Filter results have no hand-picked position, so they come
   after the members, show by show, A–Z.

Only playable items count (files that exist and have a known duration).

**Specials and extras.** A library keeps everything it finds, as Plex does —
season 0, and the featurettes, trailers and deleted scenes filed with a movie
or show (which you'll find under that movie or show, not in the grid). Each
**channel** decides whether they air, on its **Collections** tab:

- **Specials** — pilots, holiday specials, shorts and promos filed as season 0.
  They sort before season 1, so a whole show starts with them.
- **Extras** — a show's air after its episodes; a movie's air right after the
  movie, in every order (shuffles too), so a trailer never runs a week before
  its film.

Both are off for a channel until you turn them on. Each show's tile in a
collection has its own **Specials** and **Extras** switch (a movie's, **Extras**)
when it has any: it goes by the channel until you flip it, and a flipped one
stays put when the channel changes — so Nickelodeon can take specials while Ren
& Stimpy's season 0 stays off. A season 0 or an extra you pick on its own airs
either way.

**Plays in this order** (in the collection's **Settings**) sets its own playback
order (below), with each choice explained and the collection's first airings
previewed as you pick. Every rotation item and time block defaults to
*collection default*, so a collection airing in five places only needs its
order set once — override it per slot when you actually want them to differ.

**What airs** lists what the collection resolves to, in its order — the
quickest way to check an arrangement came out the way you meant.

## Music

A music video airs like any program. A **song** has no picture, so it airs over
a **now playing** screen drawn for it, set on the channel's **General** tab
under **Music**:

- **Album** (the default) — the cover large over a blur of itself, the title,
  artist, album and year, and a progress bar with the time.
- **Visualizer** — a spectrum drawn from the song as it plays, with the song
  along the bottom.
- **If lyrics exist, show lyrics first** — a song with timed lyrics (a `.lrc`
  beside it, lyrics in its tags, or LRCLIB's) shows them instead: the cover and
  song down the side, the line being sung lit, the rest scrolling past.

The last 20 seconds of a song bring in the **Up next** card. A change to these
re-draws the song on air in the new look. A channel can mix songs, music
videos, shows and movies however its collections and schedule have them.

## Broadcast episodes (multi-segment shows)

A lot of classic cartoons were made as shorts and aired several to a
half-hour. An episode of *Dexter's Laboratory* is three seven-minute segments,
and *2 Stupid Dogs* ran a *Super Secret Secret Squirrel* short between its two
dog cartoons. Your files usually store each segment as its own episode, so on
their own they air as separate seven-minute programs. A **broadcast episode**
puts them back together.

Grouping belongs to the show, not to a channel: **Library** → the show → a
season → **Group broadcast episodes**. Every channel that airs the show uses
it.

### Grouping a season

The editor shows the season as a running order, one row per program:

- **Suggest groupings** packs consecutive episodes, in episode order, into
  blocks near the **target length**: 11, 22 or 30 minutes, or a custom number.
  A block keeps growing while it stays within about 10% of the target. The
  suggestion replaces the whole running order on screen, borrowed shorts
  included, so run it first and fine-tune after.
- **Group selected** makes the episodes you've ticked (two or more) into one
  broadcast episode.
- Inside a group, **↑ ↓** reorder the segments, **×** takes one out, and
  **Ungroup** splits it back into single episodes. **Clear all** ungroups the
  whole season.
- **Save** stores the season. Nothing is kept until you do, and **Done
  grouping** asks before discarding unsaved changes.

Grouping is metadata only. Your files keep their names and their real season
and episode numbers, and nothing on disk changes.

### Borrowing a segment from another show

Some blocks wove in a short from a different series. **+ Add segment** (on a
group, or on a single episode to start a new group) searches episodes across
the whole library by title or show name. The chosen episode is added to the
end of the group; move it into place with the arrows.

A borrowed short plays inside the host show wherever the host airs. The same
short can be borrowed into more than one show and airs inside each.

### What you'll see

- In the season's episode list, each grouped file is tagged with its place,
  e.g. *Broadcast ep 3 · 1/3*, and a borrowed short is listed indented
  beneath the episode it follows (*Woven into broadcast ep 3*).
- The borrowed show's own page has a banner and a per-episode badge (*Airs in
  2 Stupid Dogs*) for the episodes that air inside another show.
- In the guide, a broadcast episode is one program. The XMLTV listing has one
  entry spanning all its segments, with each segment named in the subtitle
  and description.

### How it airs

A broadcast episode is scheduled as one program:

- Its segments always play back-to-back, in the order you set.
- Every playback order moves it as one program, including the shuffles and
  rotations, and a rotation's "play N" counts it as one of the N.
- A block that packs programs to its end fits the whole episode or leaves it
  for later, and a hard start never cuts one in half.
- A segment that belongs to a group never also airs on its own.

Changes apply straight away: every channel airing the show rebuilds its guide
from the next program on (what's on air finishes first), and each show carries
on from its place.

A channel counts its place in a show in programs, so grouping a show partway
through its run moves that place. With three segments to an episode, a
channel that had aired 30 loose segments picks up at broadcast episode 31
rather than episode 11. Where you can, group a show before it goes on air.

## Rotation

The rotation is the channel's 24/7 backbone: an ordered list of collections
that loops forever. Per entry:

- **1 at a time / multiple (N)** — how many items play before moving to the
  next entry. `Sitcoms ×2 → Movies ×1` gives you two episodes then a movie,
  repeating.
- **Playback order** (defaults to **collection default** — the order set on the
  collection itself):
  - **Your order** — the collection's members in the exact order you arranged
    them, each show expanded into its own episodes in sequence: one show's
    full run, then the next member.
  - **Release order** — oldest first: movies by year, each show's episodes in
    order (S01E01 → S01E02 → …), the shows one after another in your
    arrangement. A movie series added in any order still airs 1978 → 1981 → 1988.
  - **Rotate shows** — round-robin across the shows, in your arrangement: one
    episode from each show in turn. Everything without a show (movies,
    one-offs) shares a single turn, so one show plus fifty movies still splits
    the airtime evenly rather than 1:50.
  - **Rotate shows, mixed** — every show still gets one episode per round, but
    each round is dealt in a new random order (and never opens with the show
    that closed the last one). Episodes stay in sequence. With two shows there's
    nothing to mix, so they alternate.
  - **Shuffle** — every item in random order, re-dealt every time the
    collection is played through, so a second pass isn't the same running order
    as the first.

  In both rotations **each show keeps its own place**: add a show and it starts
  at its first episode while the rest carry on; drop one and it resumes where it
  was if you add it back; reorder them and only whose turn is next changes.

  The random orders derive their deal from the playback position rather than
  storing it, so a guide rebuild reproduces the timeline exactly. (With only two
  or three groups, consecutive passes can land on the same arrangement by
  chance — that's the shuffle being honest, not a stuck seed.)

Every show/collection keeps its **position** — a channel resumes exactly where
it left off, even across guide rebuilds and container restarts.

## Time blocks

Blocks override the rotation during specific day/time windows (*Sat–Sun
08:00–11:00 → Cartoons*). Add them from the weekly grid or the form.

Per block:

- **Days + start/end time** (channel timezone = the container's `TZ`).
- **Collection + playback order** — same options as rotation.
- **Start mode**:
  - **soft** — the block takes over at the next program boundary; nothing gets
    cut off.
  - **hard** — the block starts exactly on time; the gap before it is a
    station break, so the previous program doesn't overrun.
- **Logo override** — a different on-screen watermark while the block airs.
- **"Coming up next" override** — per-block card settings, including
  turning it off for just this block.

- **Leftover time** — how time the block's programs don't fill is handled so
  it ends on schedule: **off** (programs run back to back and may overrun),
  **at the end** (one break before the block ends), or **between programs**
  (short breaks spread between them).

Start and leftover time sit together under **Breaks** in the block editor —
they decide *when* a block has breaks. *What* the breaks play is set on the
channel's **Breaks** tab (see [Station breaks](branding.md#station-breaks)),
and the editor says which ident will play.

A block can also keep its own **clock** (or turn the channel's off) and its
own **breaks inside programs** setting — see below.

Blocks-only channels (no rotation) are fine. The time *between* their blocks
has nothing scheduled, so the channel airs its breaks until the next block
(see [Station breaks](branding.md#station-breaks)); the guide shows the gap as
empty.

## The broadcast clock

On the **Schedule** tab, **Broadcast clock** starts every program on a line of
the clock — **:00 and :30**, **quarter hours** or **on the hour** — like
broadcast TV. The time between the end of a program and the next line is a
break: a 22-minute episode at 7:00 is followed by an 8-minute break, and the
next show starts at 7:30. A 95-minute movie at 8:00 runs to 9:35 and hands over
at 10:00.

- A program that runs **a minute or less** past a line hands straight over
  (the next one starts that little bit late) rather than waiting a whole slot
  — files often carry a few seconds of black past their half hour.
- In a block with leftover-time breaks, as many programs as finish inside it
  play, each on the clock; the rest of the block is one break. With leftover
  time off, the last one may run past the block's end.
- A break never runs into an exact-time block's start, and the channel gets
  back on its clock after a block that has its own turned off.
- The XMLTV guide lists a short break as part of the program before it, the
  way a paper guide does.

### Breaks inside programs

With the clock on, **Breaks inside programs** shares each slot's break time out
across the program's **act breaks** — the points it cut to commercial when it
aired — as equal breaks, with the last of it after the program. A multi-part
broadcast episode breaks between its parts. Each break is at least 45 seconds;
with too little time to go round, fewer act breaks are used. In the guide it's
still one program.

Act breaks are found in the background for the channels (and blocks) that use
them, the programs about to air first: **chapter markers** when a file has
them, otherwise a **fade to black with silence** (the audio is scanned end to
end, the video only around those moments). About one break per ten minutes,
none in the first or last minute and a half. A program with none found breaks
after, as before. The Schedule tab says how far the search has got, and a
changed file is looked at again.

## Checking a schedule

The **Schedule** tab warns about what will go wrong before it airs, and says
what to change:

- a block with **no breaks** running into an **exact-time start** (its own
  next one included) — its last program overruns, and everything after it runs
  late;
- a collection with **nothing it can play**;
- a block's collection **shorter than the time its blocks get a week**, so it
  repeats within the week;
- **season 0** (specials, shorts) airing before season 1 — with a button to
  leave those shows' specials out;
- an exact-time start **between the lines of the clock**.

The Guide tab's **Weeks ahead** lays the schedule out 2, 4 or 8 weeks past the
guide, exactly as the next builds will, without saving anything: any day's
programs, a search for a show, how late each block really starts (usually, and
at worst), break time per day, time off air, and when each show goes back to
an earlier episode.

## The playout (guide)

The **Guide** tab shows the channel's timeline — exactly what airs when, as a
timeline or a list. There's nothing to build: the engine walks forward,
applying blocks when they're active and the rotation otherwise, packing
programs and inserting breaks to land on block boundaries, as far ahead as the
**Build ahead** setting (Settings → Channels).

- **It follows your edits.** Change the rotation, a block, a collection's
  shows or order, or a show's broadcast episodes, and the guide is rebuilt from
  the next program on: what's on now finishes first (and so does one about to
  start), and every show carries on from the episode it was up to. The tab
  says where the change took effect ("Updated from 8:30 PM").
- **It extends itself** as time passes, whether anyone is watching or not.
- **Restart from S1E1** starts every show over at episode 1, from the next
  program — the only manual control, and rarely what you want.
- **What aired** lists what the channel played, a day, a week or a month back,
  flagging any program that had a stream problem while someone was watching
  (a program held with a break, or one that carried on on the CPU after the GPU
  gave out). History is kept for 90 days; a show's page says when each episode
  last aired.

Each program in the guide remembers where every show stood when it was
scheduled, which is what lets an edit pick up exactly there — nothing is
skipped and nothing repeats. (A guide built by 0.12 or earlier has no such
bookmarks, so right after upgrading an edit takes effect from where the new
version started building: at most a horizon away, usually a day.)

## Streams

Each channel is a continuous MPEG-TS stream at
`/iptv/channel/<number>.ts`. Tuning in mid-program starts at the right offset
— just like real TV. Multiple clients can watch the same channel; each gets
its own stream. All items are normalized to the channel's encoding profile so
transitions are seamless.

A channel encodes a few seconds ahead of its schedule. That's what makes
tuning in quick (the first seconds are encoded in a burst), and it means the
next program is ready before the current one ends. Every program starts at the
second the guide says.

If a file can't be played, the channel doesn't retry it endlessly: a program
that fails on the GPU gets one more try on the CPU, and otherwise the channel
airs its breaks for the rest of that slot. The next program still
starts on time. The same goes for a file that ends before its slot does.

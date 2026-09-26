# Branding: Logos, Watermarks & Breaks

The touches that make a channel feel like a real station: an on-screen bug in
the corner, station breaks between programs, and "up next" cards.

## Logos

Upload logos under **Studio → Logos** (PNG with transparency looks best).
Uploaded logos are stored in your data volume and can be assigned to:

- a **channel** (General tab) — used in players' guides (M3U `tvg-logo` +
  XMLTV icon) *and* as the default on-screen watermark;
- a **time block** (Schedule tab) — overrides the on-screen logo while that
  block airs.

Priority on screen: **block logo → channel logo**.

Click a logo to open it in the inspector: rename it, replace its image, or give
it its own watermark settings. The preview shows the bug over a frame from your
library, in 16:9 or 4:3, as you change them.

## Watermark behavior

**Settings → Watermark** sets how the on-screen logo is drawn, for any logo
without watermark settings of its own (with the same live preview):

- **Mode** — `permanent` (always on), `intermittent` (appears every N minutes
  for a set duration, with fade in/out), or `none`.
- **Position** — any corner; margins in percent.
- **Size** — width as a percent of the frame.
- **Opacity** — see-through like a real station bug.
- **Intermittent timing** — frequency (minutes), on-screen duration (seconds),
  fade time (seconds).

The watermark hides during breaks by default, fading out as a break starts and
back in after. A channel can keep it on screen instead: **Corner logo during
breaks** on its Breaks tab.

## Station breaks

A break is what plays in the gaps the schedule opens:

- Inside a time block, its leftover time — at the end, or spread between its
  programs — so the block ends exactly on schedule.
- Before a **hard-start** block, so it begins exactly on time.

Nothing else creates a break, and a rotation-only channel never has one. Both
are set per block on the **Schedule** tab (edit a block → **Breaks**: *Start*
soft or hard, and *Leftover time* off, at the end, or between programs).

The stream also shows the channel's breaks whenever it has nothing else to
show, instead of going to black:

- the time between blocks on a blocks-only channel;
- the rest of a slot whose file turned out shorter than its listing;
- a program that can't be played at all (see
  [Troubleshooting](troubleshooting.md#a-program-shows-the-station-ident-instead)).

### The Breaks tab

Each channel's **Breaks** tab is the one place its breaks are set up:

- **Next break** — when it is, what it leads into, which ident it'll play, and
  whether that ident is built yet.
- **When breaks happen** — which blocks have breaks, in words, with a button to
  the Schedule tab to change it. It warns you when a channel's breaks can never
  air.
- **Idents** — what plays during a break (below), in the order breaks take
  turns.
- **Where each ident plays** — the week as a map, each block in the colour of
  the ident its breaks would play, striped where its breaks are off, with a
  white mark at each break. Select a block to see what it does and plays, and
  jump to it on the Schedule tab.
- **Corner logo during breaks** — keep the watermark on during this channel's
  breaks.

### Idents

An ident belongs to one channel. Each has:

- a **look** — **Frosted glass**, **Spotlight**, or **Your own clip** (a
  video uploaded to **Studio → Clips**);
- a **logo** — **Follow the block** (the logo of whichever block is on, so one
  ident is branded correctly in every block) or **Always the same** logo;
- optional **music** from **Studio → Music**;
- where it **plays**: **Everywhere else** (every block without idents of its
  own, time outside blocks, and the gaps before hard starts), or **Only during
  certain blocks**, which takes over from the "everywhere else" idents while
  those blocks are on. Pick blocks one by one or by the logo they air with.

Every channel keeps at least one "everywhere else" ident — a new channel starts
with a frosted-glass one made from its logo — so every break has something the
tab lists. Where several idents can play, breaks take turns in the list's
order (move them up and down to change it). The order carries on across a
restart, and a break that's rebuilt (a retry, a restart mid-break) keeps the
ident it had.

An ident whose blocks all have breaks off is marked **Never airs**, with a link
to the Schedule tab.

To reuse an ident elsewhere, **Copy from another channel** (or **Copy to other
channels…** from an ident's ⋯ menu). Each channel gets its own copy, shown with
its own logos and playing everywhere else there — editing one never changes
another. **Duplicate** makes a second copy on the same channel.

### Looks

| Look | What it is |
| ---- | ---------- |
| **Frosted glass** | Rows of logos glide behind frosted glass, still recognisable through the frost, with out-of-focus lights drifting up at different depths. A more heavily frosted band sits behind your logo, which floats in front on a soft shadow, and light plays across the glass as it runs. Under **Advanced**, **Divider between the halves** adds a lit glass seam between your logo and the MosaicTV mark |
| **Spotlight** | A lit glass card with a sweeping gleam, your logo above the wordmark |
| **Your own clip** | A bumper or ident reel you upload, looped for the length of the break |

**Advanced** also has the logo's size. The picture is always built at the
channel's own size.

Earlier builds also offered `logowall`, `pulse`, `animated`, `retro` and
`vintage`. Idents on a retired look keep playing and stay editable; new ones
can't pick it. (`animated` is also the internal fallback whenever a branded
clip can't be built.)

The **music** isn't part of the clip: it's laid over the break as it airs,
starting at the top of every break and playing straight through, looping if
the break outlasts the song. Every break's sound fades in over half a second
and out over the last second and a half. Without music, the look's own soft
tone plays. Changing the music never rebuilds a clip.

A generated clip is a **seamless loop** — every moving part comes back to where
it started by the end, so a long break shows no jump where the clip repeats.
Spotlight loops every 30 seconds; frosted glass every two minutes or so, the
time its slowest lights take to rise back round.

### Preview

**Play preview** in the editor renders the first six seconds of the ident as it
airs — the real look, logo and music — in a few seconds, without saving. When
an ident shows different logos in different blocks, **Show with** picks which.

### Built ahead

A generated look composites *the logo on air where the break falls*, so one
ident becomes a separate clip for every logo it airs with. MosaicTV builds all
of them ahead, in the background and at low priority so live channels come
first: at startup, and whenever an ident is edited, a channel's or block's
logo or profile changes, or a logo image is replaced. The Breaks tab marks an
ident **Building** until it's done, and the notification bell follows each
build. A break never waits on one — if its clip isn't ready yet (say, moments
after an edit), another of the channel's built idents stands in under its
music until it is. Clips nothing airs any more (an old look, a replaced logo)
are deleted automatically.

A break is looped and trimmed to exactly fill each gap, so blocks always land
on their boundaries. "Up next" cards never show over a break.

### Upgrading from the filler library

Before 0.12, fillers were a shared library in the Studio, assigned to channels
and blocks, with a default station ident for channels that had none. On
upgrade, each becomes an ident on the channel it aired on — one copy per
channel if it was shared — and a channel that relied on the default station
ident gets its own copy of it (or, with none set, a starter ident: the same
frosted glass it aired before). A filler that wasn't on any channel goes to the
channel whose logo it was branded with, playing during the blocks that use that
logo; one with no match is kept on your first channel, playing nowhere until
you choose. The Studio's stored preview clips are removed — previews render on
demand now — and **Show on filler** moves from the watermark settings to each
channel's Breaks tab.

## "Up next" cards

Near the end of a program, a card slides in naming what's on next: the next
program's poster, its title, the episode (`S1 · E4`) and episode title, and
its year, genres and rating, under an **UP NEXT** label with the time it
starts. A movie shows its runtime instead of an episode.

There are two styles:

- **Glass** — a frosted panel: the picture behind it is blurred, so it reads on
  a bright cartoon as well as a dark film.
- **Broadcast** — a cable-network bar: the poster stands up out of a dark bar,
  an angled **UP NEXT** tab and the time sit on its top edge, and the bar fades
  out toward the middle of the picture. On the right-hand side it's mirrored.

- **Channel-wide**: General tab → Coming up next.
- **Per block**: Schedule tab → edit a block → override (including turning it
  off for that block only).

The settings show a preview: the card your channel's next program would get,
drawn exactly as it airs, over a still from what's on now, with your channel's
logo where its watermark sits — so you can see at a glance if the card would
cover it. It follows your changes before you save.

Cards appear over programs from both rotation and blocks, never over a break.
A station break between two programs doesn't hide the card: it names the
program after the break.

**Broadcast episodes.** A multi-segment episode (Dexter's three shorts, say)
gets one card, timed against the whole episode, not one per segment. The card
announcing it lists every segment, e.g. `S1 · E4–6` and "Dexter Dodgeball /
Dial M for Monkey - Rasslor / Dexter's Assistant", and the card at its end
names the program after it.

**Long titles** are cut at a word with an ellipsis rather than running across
the screen, and a leading episode code the filename left on an episode title
("E03 - …") is dropped, since the card shows the code on its own.

**Timing.** *Before it ends* shows it once, the lead time before the program
ends (default 5 minutes, 12 seconds on screen); *Middle* once at the halfway
point; *Both* does both. On a movie channel the 5-minute mark usually lands in
the end credits, which is where broadcasters put theirs too. **Slide in** is
how long the entrance (and exit) takes; 0 pops it on and off.

**Position.** Eight spots around the picture: the four corners, the middle of
the top and bottom edges, and the middle of the left and right sides. Pick one
clear of your logo — if the watermark sits bottom-left, put the card
bottom-right. It slides in from its nearest edge (from the side, or up from
the bottom / down from the top for the middle positions). The card sits on the
picture itself, so on a 4:3 show pillarboxed into a 16:9 channel it stays on
the image, not out on the black bars. Three sizes.

**Saving applies it to what's on air.** The card and the logo are burned in
when a program starts, so on save the channel re-encodes the current program
from where it is — a viewer skips a couple of seconds, the same as at any
program change. Other edits (name, group, schedule) never interrupt the stream.

### "Now playing" on music videos

A music video gets the same card for its first dozen seconds, headed **NOW
PLAYING**: the song, the artist and album, the year, and the album art when
the library has some. It uses the channel's card style, position and size.

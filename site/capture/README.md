# Capturing the website's pictures

Every screenshot and frame on the website and in the README comes from a
real MosaicTV and the channels running on it. These scripts take them. They
only look: the screenshots go through a guard that refuses every request but
a GET (and the few POSTs that just draw a preview), and the frames are read
from the streams the way any player reads them — so they're safe to point at
the instance you watch.

Everything lands in one scratch folder, `CAPTURE_DIR`; only the finished
images go into the repo.

| Step | Script | What it does |
| ---- | ------ | ------------ |
| 1 | `shots.mjs` | Screenshots of the app at 2x (desktop and phone) |
| 2 | `frames.mjs` | Records the channels at the moments worth showing — up-next cards, breaks, songs starting — a frame every two seconds |
| 3 | idents | Each look's clip, built by a MosaicTV from the channels' logos (below) |
| 4 | `publish.mjs` | Turns the picks into `site/assets/img` and `docs/screenshots` |

```bash
export CAPTURE_DIR=/some/scratch/folder MOSAIC=http://your-server:8688
node site/capture/shots.mjs
node site/capture/frames.mjs 60
node site/capture/publish.mjs
```

The shot list in `shots.mjs` and the picks in `publish.mjs` name one
instance's channels, shows and ids; edit them for another. `frames.mjs` keeps
a frame every two seconds, and `publish.mjs` names the ones it uses, so check
them after a fresh recording. `sheet.mjs` makes a contact sheet of any set of
images for looking them over.

## Options for the screenshots

- `HIDE_CHANNELS=10` / `HIDE_LOGOS=16` — leave channels and logos out of
  every screen, as if they weren't there (a channel that's personal, say).
- `WEB=<dir>` — the pages from this checkout instead of the instance's own
  build: `vite build --outDir <dir>` in `web/`, and the screenshots show this
  version's interface over the instance's data.
- `IDENTS=<dir>` and `LOOKS=25:mosaic` — when this version draws idents
  differently from the instance's, swap the Breaks tab's pictures for
  `<dir>/<ident id>.jpg` (a still from `POST /api/fillers/still` on a newer
  build) and list an ident under the look it will have.
- `DPR=1` — a quicker pass at 1x, for picking what to shoot.

## Ident clips

`publish.mjs` cuts each look's loop from `CAPTURE_DIR/idents/<name>.mp4`: the
clips a MosaicTV builds for a channel's idents (in its data folder, named
`filler-<look>-f<id>-….mp4`). A test instance with the channels' logos
uploaded, a 1080p encoding profile and one ident per look builds them in a
minute or two.

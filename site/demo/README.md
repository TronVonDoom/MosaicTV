# The demo library

Every screenshot on the website and in the README comes from a MosaicTV
instance running on a made-up library: nine shows, ten movies, eight bands and
eight commercials, with artwork, video and music generated here. Nothing in it
is anyone's real collection, so the screens can be shared freely.

Re-run it whenever the UI changes. Everything goes in one scratch folder,
`DEMO_DIR` (about 4 GB of media); only the finished images land in the repo.

| Step | Script | What it does |
| ---- | ------ | ------------ |
| 1 | `art.mjs` | Draws posters, backdrops, episode stills, cast portraits, album covers, ads and channel logos (headless Edge or Chrome, through `cdp.mjs`) |
| 2 | `media.mjs` | Makes every episode, movie, extra, ad and music video from those pictures, with chapter marks at the act breaks, and every song as a tagged MP3 (some with `.lrc` lyrics) |
| 3 | `tmdb.mjs` | A stand-in for TMDB serving the demo titles' details, cast, episodes and images (port 8840) |
| 4 | `seed.mjs` | Builds the instance through MosaicTV's API: libraries, logos, eight channels, collections, blocks, broadcast episodes, idents, up-next cards |
| 5 | `shots.mjs` | Screenshots of the app at 2x (desktop and phone) |
| 6 | `frames.mjs` | Records the live streams at the moments worth showing — up-next cards, breaks, songs starting |
| 7 | `publish.mjs` | Turns the picks into `site/assets/img` and `docs/screenshots` |

```bash
export DEMO_DIR=/some/scratch/folder
node site/demo/art.mjs
node site/demo/media.mjs
PORT=8840 node site/demo/tmdb.mjs &
# Run MosaicTV against it: an empty DATABASE_URL in $DEMO_DIR/data,
# MEDIA_ROOT=$DEMO_DIR/media, TMDB_BASE_URL=http://127.0.0.1:8840,
# TMDB_IMAGE_BASE_URL=http://127.0.0.1:8840/t/p, PORT=8830
node site/demo/seed.mjs
node site/demo/shots.mjs
node site/demo/frames.mjs 60
node site/demo/publish.mjs
```

`frames.mjs` keeps a frame every two seconds; `publish.mjs` names the ones it
uses, so check them after a fresh recording. `sheet.mjs` makes a contact sheet
of any set of images for looking them over.

// Turns the picks from shots.mjs, frames.mjs and art.mjs into the website's
// images and clips under site/assets/img: WebP stills sized for the page and
// short silent MP4 loops for the idents.
//
//   DEMO_DIR=… node site/demo/publish.mjs

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const DEMO = process.env.DEMO_DIR
if (!DEMO) throw new Error('Set DEMO_DIR')
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const IMG = path.join(SITE, 'assets', 'img')
const WEB = path.resolve(SITE, '..', 'web', 'public')
const S = (f) => path.join(DEMO, 'shots', f)
const C = (f) => path.join(DEMO, 'caps', f)

function ff(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
  if (r.status !== 0) throw new Error(`ffmpeg ${args.at(-1)}: ${r.stderr}`)
}
function webp(src, out, { w, crop, q = 82 } = {}) {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const vf = [crop ? `crop=${crop}` : null, w ? `scale=${w}:-2:flags=lanczos` : null].filter(Boolean).join(',') || 'null'
  ff(['-i', src, '-vf', vf, '-c:v', 'libwebp', '-quality', String(q), '-compression_level', '6', out])
}
function clip(src, out, { from = 0, dur = 6, w = 960 } = {}) {
  fs.mkdirSync(path.dirname(out), { recursive: true })
  ff(['-ss', String(from), '-t', String(dur), '-i', src, '-an', '-vf', `scale=${w}:-2:flags=lanczos,fps=30,format=yuv420p`, '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-movflags', '+faststart', out])
  ff(['-ss', '1', '-i', out, '-frames:v', '1', '-c:v', 'libwebp', '-quality', '80', out.replace(/\.mp4$/, '.webp')])
}

// Screenshots: 3200px captures down to 2400 (2x for a 1200px column).
const SHOTS = ['dashboard', 'show-dino-group', 'toons-schedule', 'toons-blocks', 'toons-weeks', 'toons-collections', 'channels-guide', 'toons-breaks', 'watch-guide', 'show-comet', 'movie-arcade', 'tv-home', 'movies-all', 'music-album']
for (const s of SHOTS) webp(S(`${s}.png`), path.join(IMG, 'shots', `${s}.webp`), { w: 2400 })
for (const s of ['phone-dashboard', 'phone-show', 'phone-watch']) webp(S(`${s}.png`), path.join(IMG, 'shots', `${s}.webp`), { w: 780 })
// The search palette, cropped to the dialog and what's around it.
webp(S('palette.png'), path.join(IMG, 'shots', 'palette-crop.webp'), { crop: '1440:840:880:180', w: 1440 })

// The hero TV: one frame per channel, as it went out.
const TV = { 2: 'ch2-card-1921-13.jpg', 4: 'ch4-late-15.jpg', 7: 'ch7-now-06.jpg', 13: 't903-03.jpg', 22: 'ch22-card-1853-14.jpg', 31: 'ch31-now-06.jpg', 44: 'ch44-now-06.jpg', 99: 't901-04.jpg' }
for (const [n, f] of Object.entries(TV)) webp(C(f), path.join(IMG, 'tv', `ch-${n}.webp`), { w: 1920, q: 84 })

// Feature frames.
const FRAMES = {
  'card-glass': 'ch2-card-1921-13.jpg',
  'card-broadcast': 'ch4-late-15.jpg',
  'card-4x3': 't903-03.jpg',
  'card-music': 'ch22-card-1853-14.jpg',
  'np-lyrics': 't901-04.jpg',
  'np-album': 'ch99-start-1902-06.jpg',
  'np-visualizer': 't902-03.jpg',
}
for (const [name, f] of Object.entries(FRAMES)) webp(C(f), path.join(IMG, 'frames', `${name}.webp`), { w: 1920, q: 84 })
// The broadcast episode's card, close up: the lower-left of the frame, 1.5x.
webp(C('ch2-card-1921-13.jpg'), path.join(IMG, 'frames', 'card-broadcast-episode.webp'), { crop: '1280:720:0:360', w: 1920, q: 86 })

// Idents: six-second silent loops with a poster frame.
const I = (f) => path.join(DEMO, 'idents', f)
clip(I('frosted.mp4'), path.join(IMG, 'idents', 'frosted.mp4'))
clip(I('spotlight.mp4'), path.join(IMG, 'idents', 'spotlight.mp4'))
clip(C('ch2-break-1849.ts'), path.join(IMG, 'idents', 'reel.mp4'), { from: 13, dur: 6 })
clip(path.join(DEMO, 'fright-bumper.mp4'), path.join(IMG, 'idents', 'custom.mp4'), { from: 1.6, dur: 6 })

// Posters for the closing wall.
for (const f of fs.readdirSync(path.join(DEMO, 'art', 'posters'))) webp(path.join(DEMO, 'art', 'posters', f), path.join(IMG, 'posters', f.replace(/\.jpg$/, '.webp')), { w: 300, q: 78 })

// The app's own icon.
ff(['-i', path.join(WEB, 'mosaictv-icon.png'), '-vf', 'scale=128:-1:flags=lanczos', path.join(IMG, 'icon.png')])
fs.copyFileSync(path.join(WEB, 'favicon-32x32.png'), path.join(IMG, 'favicon-32.png'))
fs.copyFileSync(path.join(WEB, 'apple-touch-icon.png'), path.join(IMG, 'apple-touch-icon.png'))

// The README's screenshots (docs/screenshots), from the same demo library.
const DOCS = path.resolve(SITE, '..', 'docs', 'screenshots')
const README = {
  dashboard: [S('dashboard.png')],
  channels: [S('channels.png')],
  collections: [S('toons-collections.png')],
  'broadcast-episodes': [S('show-comet-episodes.png')],
  'broadcast-episodes-editor': [S('show-dino-group.png')],
  'playback-orders': [S('playback-orders.png')],
  schedule: [S('toons-blocks.png')],
  library: [S('library.png')],
  show: [S('show-comet.png')],
  'studio-logos': [S('studio-logo.png')],
  'settings-watermark': [S('settings-watermark.png')],
  'frosted-filler': [C('ch2-break-1905-06.jpg')],
  'up-next-card': [C('ch2-card-1921-13.jpg')],
  'command-palette': [S('palette.png'), '1440:840:880:180'],
  notifications: [S('bell.png'), '1440:1400:1760:0'],
}
for (const [name, [src, crop]] of Object.entries(README)) webp(src, path.join(DOCS, `${name}.webp`), { w: crop ? 900 : 1600, crop })
for (const [name, src] of [['mobile-dashboard', 'phone-dashboard.png'], ['mobile-channels', 'phone-channels.png']]) webp(S(src), path.join(DOCS, `${name}.webp`), { w: 600 })

const total = (dir) => fs.readdirSync(dir, { recursive: true }).reduce((n, f) => n + (fs.statSync(path.join(dir, f)).isFile() ? fs.statSync(path.join(dir, f)).size : 0), 0)
console.log(`Published to ${IMG}: ${(total(IMG) / 1e6).toFixed(1)} MB`)

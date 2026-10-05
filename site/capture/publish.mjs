// Turns the picks from shots.mjs and frames.mjs, and the ident clips, into the
// website's images and clips under site/assets/img and the README's under
// docs/screenshots: WebP stills sized for the page, short silent MP4 loops for
// the idents, and the link-preview image.
//
//   CAPTURE_DIR=… node site/capture/publish.mjs
//
// The picks name files from one recording; check them after a fresh one.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { launch, sleep } from './cdp.mjs'

const DIR = process.env.CAPTURE_DIR
if (!DIR) throw new Error('Set CAPTURE_DIR')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const SITE = path.resolve(HERE, '..')
const IMG = path.join(SITE, 'assets', 'img')
const DOCS = path.resolve(SITE, '..', 'docs', 'screenshots')
const WEB = path.resolve(SITE, '..', 'web', 'public')
const S = (f) => path.join(DIR, 'shots', `${f}.png`)
const C = (f) => path.join(DIR, 'caps', `${f}.jpg`)
const I = (f) => path.join(DIR, 'idents', `${f}.mp4`)

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
// Pictures from an earlier recording go, so nothing stale is left behind.
for (const d of ['shots', 'tv', 'frames', 'idents']) fs.rmSync(path.join(IMG, d), { recursive: true, force: true })
for (const f of fs.existsSync(DOCS) ? fs.readdirSync(DOCS) : []) if (f.endsWith('.webp')) fs.rmSync(path.join(DOCS, f))

// ── The website ─────────────────────────────────────────────────────────────
// Screenshots: 3200px captures down to 2400 (2x for a 1200px column).
const SHOTS = {
  dashboard: 'dashboard',
  'dogs-group': 'show-dogs-group',
  'dogs-episodes': 'show-dogs-episodes',
  'nick-blocks': 'nick-blocks',
  'halloween-blocks': 'halloween-blocks',
  'nick-weeks': 'nick-weeks',
  'cn-collections': 'cn-collections',
  'channels-guide': 'channels-guide',
  'nick-breaks': 'nick-breaks',
  'watch-guide': 'watch-guide',
  'show-dexter': 'show-dexter',
  'movie-hocus': 'movie-hocus',
  'tv-home': 'tv-home',
  'movies-all': 'movies-all',
  'music-artist': 'music-artist',
}
for (const [name, src] of Object.entries(SHOTS)) webp(S(src), path.join(IMG, 'shots', `${name}.webp`), { w: 2400 })
for (const s of ['phone-dashboard', 'phone-show', 'phone-watch']) webp(S(s), path.join(IMG, 'shots', `${s}.webp`), { w: 780 })
// The search palette, cropped to the dialog and what's around it.
webp(S('palette'), path.join(IMG, 'shots', 'palette-crop.webp'), { crop: '1440:840:880:180', w: 1440 })

// The hero TV: one frame per channel, as it went out.
const TV = {
  64: 'ch64-now-08',
  31: 'ch31-card-0007-12',
  13: 'ch13-now-04',
  42: 'ch42-card-0004-12',
  99: 'ch99-start-2352-08',
}
for (const [n, f] of Object.entries(TV)) webp(C(f), path.join(IMG, 'tv', `ch-${n}.webp`), { w: 1920, q: 84 })

// Up-next cards and now-playing screens.
const FRAMES = {
  'card-glass': TV[31],
  'card-broadcast': TV[42],
  'np-1': TV[99],
  'np-2': 'ch99-now-06',
}
for (const [name, f] of Object.entries(FRAMES)) webp(C(f), path.join(IMG, 'frames', `${name}.webp`), { w: 1920, q: 84 })

// Idents: silent loops with a poster frame. A cut of whole cycles loops
// cleanly: Mosaic sends a ring every 5 seconds, and at 1080p frosted glass's
// rows come back round every 7.5.
clip(I('frosted-cn'), path.join(IMG, 'idents', 'frosted-cn.mp4'), { dur: 7.5 })
clip(I('mosaic-nick'), path.join(IMG, 'idents', 'mosaic-nick.mp4'), { dur: 10 })
clip(I('mosaic-halloween'), path.join(IMG, 'idents', 'mosaic-halloween.mp4'), { dur: 10 })
clip(I('frosted-toonami'), path.join(IMG, 'idents', 'frosted-toonami.mp4'), { dur: 7.5 })

// The app's own icon.
ff(['-i', path.join(WEB, 'mosaictv-icon.png'), '-vf', 'scale=128:-1:flags=lanczos', path.join(IMG, 'icon.png')])
fs.copyFileSync(path.join(WEB, 'favicon-32x32.png'), path.join(IMG, 'favicon-32.png'))
fs.copyFileSync(path.join(WEB, 'apple-touch-icon.png'), path.join(IMG, 'apple-touch-icon.png'))

// The link preview (og:image), drawn from og.html over two of the TV frames.
{
  const browser = await launch({ port: 9337 })
  const page = await browser.newPage({ width: 1200, height: 630 })
  await page.goto(pathToFileURL(path.join(HERE, 'og.html')).href)
  await page.eval('document.fonts.ready.then(() => true)')
  await page.until('[...document.images].every((i) => i.complete)').catch(() => {})
  await sleep(500)
  await page.shot(path.join(IMG, 'og.jpg'), { quality: 88 })
  await browser.close()
}

// ── The README ──────────────────────────────────────────────────────────────
const README = {
  dashboard: [S('dashboard')],
  channels: [S('channels-guide')],
  collections: [S('cn-collections')],
  'broadcast-episodes': [S('show-dogs-episodes')],
  'broadcast-episodes-editor': [S('show-dogs-group')],
  'playback-orders': [S('playback-orders')],
  schedule: [S('nick-blocks')],
  'schedule-dayparts': [S('halloween-blocks')],
  library: [S('library')],
  show: [S('show-dexter')],
  'studio-logos': [S('studio-logo')],
  breaks: [S('nick-breaks')],
  'up-next-card': [C(TV[31])],
  'up-next-broadcast': [C(TV[42])],
  'now-playing': [C(TV[99])],
  'tv-mode': [S('watch-guide')],
  'command-palette': [S('palette'), '1440:840:880:180'],
}
for (const [name, [src, crop]] of Object.entries(README)) webp(src, path.join(DOCS, `${name}.webp`), { w: crop ? 900 : 1600, crop })
for (const [name, src] of [['mobile-dashboard', 'phone-dashboard'], ['mobile-channels', 'phone-channels']]) webp(S(src), path.join(DOCS, `${name}.webp`), { w: 600 })
// The two looks side by side, the default first, each a frame from its loop.
{
  const a = path.join(DIR, 'idents', 'mosaic-nick.png')
  const b = path.join(DIR, 'idents', 'frosted-cn.png')
  ff(['-ss', '2.2', '-i', I('mosaic-nick'), '-frames:v', '1', a])
  ff(['-ss', '4', '-i', I('frosted-cn'), '-frames:v', '1', b])
  ff(['-i', a, '-i', b, '-filter_complex', '[0]scale=800:-2[l];[1]scale=800:-2[r];[l]pad=812:ih:0:0:color=#0d1117[lp];[lp][r]hstack', '-c:v', 'libwebp', '-quality', '84', path.join(DOCS, 'idents.webp')])
}

const total = (dir) => fs.readdirSync(dir, { recursive: true }).reduce((n, f) => n + (fs.statSync(path.join(dir, f)).isFile() ? fs.statSync(path.join(dir, f)).size : 0), 0)
console.log(`Published: ${(total(IMG) / 1e6).toFixed(1)} MB in ${IMG}, ${(total(DOCS) / 1e6).toFixed(1)} MB in ${DOCS}`)

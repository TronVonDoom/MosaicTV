// Makes the demo library's files from art.mjs's frames: every episode, movie,
// extra, music video and ad as a video of its show's pictures with a soft
// synthesized score (and chapter marks at the act breaks), every song as a
// tagged MP3 that's actually music — chords, bass, drums — with its cover,
// the artist's picture and, for some, synced lyrics. Plus .nfo files that tie
// each title to its entry on the TMDB stand-in.
//
//   DEMO_DIR=… node site/demo/media.mjs

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { ADS, ALBUMS, ARTISTS, LYRICS, MOVIES, SHOWS } from './catalog.mjs'
import { hash, rng } from './draw.mjs'

const DEMO = process.env.DEMO_DIR
if (!DEMO) throw new Error('Set DEMO_DIR')
const ART = path.join(DEMO, 'art')
const MEDIA = path.join(DEMO, 'media')
const WORK = path.join(DEMO, 'work')
fs.mkdirSync(WORK, { recursive: true })

const safe = (s) => s.replace(/[’]/g, "'").replace(/[\\/:*?"<>|]/g, '')
const pad = (n) => String(n).padStart(2, '0')
const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-')

function ffmpeg(args) {
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${args.slice(-1)[0]}: ${err.slice(-600)}`))))
  })
}
async function pool(tasks, n = 6) {
  let i = 0
  let done = 0
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < tasks.length) {
        const t = tasks[i++]
        await t()
        if (++done % 20 === 0) console.log(`  ${done}/${tasks.length}`)
      }
    }),
  )
}

// ── Music ───────────────────────────────────────────────────────────────────
// A song as one ffmpeg expression: I–V–vi–IV (or another of a few) in `root`
// Hz at `bpm`, with a pad, bass, an arpeggio and a kick/snare/hat kit. `parts`
// leaves pieces out — a show's score is the pad alone, quiet.
const PROGRESSIONS = [
  [[1, 1.2599], [0.7492, 1.2599], [0.8409, 1.1892], [0.6674, 1.2599]],
  [[0.8409, 1.1892], [0.6674, 1.2599], [1, 1.2599], [0.7492, 1.2599]],
  [[1, 1.2599], [0.6674, 1.2599], [0.8409, 1.1892], [0.7492, 1.2599]],
  [[1, 1.1892], [0.8909, 1.2599], [0.7937, 1.2599], [0.7492, 1.2599]],
]
function song({ root = 220, bpm = 112, prog = 0, parts = 'pad,bass,arp,kick,snare,hat', gain = 1 }) {
  const beat = 60 / bpm
  const bar = beat * 4
  const P = PROGRESSIONS[prog % PROGRESSIONS.length]
  const pick = (k) => `if(eq(ld(0),0),${P[0][k]},if(eq(ld(0),1),${P[1][k]},if(eq(ld(0),2),${P[2][k]},${P[3][k]})))`
  const has = (x) => parts.includes(x)
  const terms = []
  if (has('pad')) terms.push(`0.07*(sin(2*PI*ld(1)*t)+0.8*sin(2*PI*ld(1)*ld(2)*t)+0.7*sin(2*PI*ld(1)*1.4983*t))*(1-exp(-ld(3)*6))*(0.55+0.45*exp(-ld(3)*0.6))`)
  if (has('bass')) terms.push(`0.2*sin(2*PI*ld(1)*0.5*t)*exp(-ld(4)*3)`)
  if (has('arp')) terms.push(`0.075*sin(2*PI*ld(1)*2*if(eq(ld(5),0),1,if(eq(ld(5),1),ld(2),if(eq(ld(5),2),1.4983,2)))*t)*exp(-ld(6)*7)`)
  if (has('kick')) terms.push(`0.55*sin(2*PI*(45+130*exp(-ld(4)*28))*ld(4))*exp(-ld(4)*8)`)
  if (has('snare')) terms.push(`if(gte(mod(t,${2 * beat}),${beat}),0.22*(random(0)*2-1)*exp(-(mod(t,${2 * beat})-${beat})*16),0)`)
  if (has('hat')) terms.push(`0.05*(random(1)*2-1)*exp(-ld(6)*55)`)
  const expr = [
    `st(0,mod(floor(t/${bar}),4))`,
    `st(1,${root}*${pick(0)})`,
    `st(2,${pick(1)})`,
    `st(3,mod(t,${bar}))`,
    `st(4,mod(t,${beat}))`,
    `st(5,mod(floor(t/${beat / 2}),4))`,
    `st(6,mod(t,${beat / 2}))`,
    `${gain}*(${terms.join('+')})`,
  ].join(';')
  return `aevalsrc=exprs='${expr}':s=44100`
}
const songFor = (seedStr, extra = {}) => {
  const r = rng(hash(seedStr))
  return song({ root: r.pick([196, 207.65, 220, 233.08, 246.94, 261.63]), bpm: r.int(92, 128), prog: r.int(0, 3), ...extra })
}

// ── Video ───────────────────────────────────────────────────────────────────
// A 60s loop of three pictures cross-fading, which episodes and movies repeat.
async function loop(out, frames, audio, { w = 1280, h = 720 } = {}) {
  if (fs.existsSync(out)) return
  const inputs = frames.flatMap((f) => ['-loop', '1', '-t', '21', '-i', f])
  const sc = frames.map((_, i) => `[${i}]scale=${w}:${h},setsar=1,fps=24,format=yuv420p[v${i}]`).join(';')
  const fade = frames.length === 3 ? `;[v0][v1]xfade=transition=fade:duration=1:offset=20[x];[x][v2]xfade=transition=fade:duration=1:offset=40[v]` : `;[v0]null[v]`
  await ffmpeg([...inputs, '-f', 'lavfi', '-t', '61', '-i', audio, '-filter_complex', sc + fade, '-map', '[v]', '-map', `${frames.length}:a`, '-ac', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '27', '-g', '48', '-c:a', 'aac', '-b:a', '96k', '-t', '60', out])
}
/** `dur` seconds of `loopFile`, with chapters at `acts` (seconds). */
async function cut(loopFile, out, dur, acts = []) {
  if (fs.existsSync(out)) return
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const list = path.join(WORK, `${hash(out)}.txt`)
  fs.writeFileSync(list, Array.from({ length: Math.ceil(dur / 60) + 1 }, () => `file '${loopFile.replace(/\\/g, '/')}'`).join('\n'))
  const args = ['-f', 'concat', '-safe', '0', '-i', list]
  if (acts.length) {
    const meta = path.join(WORK, `${hash(out)}.meta`)
    const marks = [0, ...acts, dur]
    fs.writeFileSync(meta, ';FFMETADATA1\n' + marks.slice(0, -1).map((s, i) => `[CHAPTER]\nTIMEBASE=1/1000\nSTART=${Math.round(s * 1000)}\nEND=${Math.round(marks[i + 1] * 1000)}\ntitle=Act ${i + 1}\n`).join(''))
    args.push('-i', meta, '-map', '0', '-map_metadata', '1', '-map_chapters', '1')
  }
  await ffmpeg([...args, '-c', 'copy', '-t', String(dur), out])
}

const nfo = (kind, body) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<${kind}>\n${body}\n</${kind}>\n`
const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const tasks = []
const loops = []

// TV
for (const s of SHOWS) {
  const r = rng(hash(s.slug + 'durations'))
  const dir = path.join(MEDIA, 'TV', `${safe(s.title)} (${s.year})`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'tvshow.nfo'), nfo('tvshow', `  <title>${x(s.title)}</title>\n  <year>${s.year}</year>\n  <uniqueid type="tmdb" default="true">${s.id}</uniqueid>`))
  const frames = [0, 1, 2].map((v) => path.join(ART, 'frames', `${s.slug}-${v}.jpg`))
  const dims = s.aspect === '4:3' ? { w: 960, h: 720 } : {}
  const lf = [0, 1, 2].map((k) => path.join(WORK, `loop-${s.slug}-${k}.mkv`))
  lf.forEach((f, k) => loops.push(() => loop(f, [frames[k % 3], frames[(k + 1) % 3], frames[(k + 2) % 3]], songFor(s.slug, { parts: 'pad', gain: 0.6 }), dims)))
  for (const season of s.seasons) {
    const sdir = path.join(dir, season.n === 0 ? 'Specials' : `Season ${pad(season.n)}`)
    season.eps.forEach((title, i) => {
      const min = s.seg + r.range(-0.35, 0.35)
      const dur = Math.round(min * 60)
      const acts = min > 20 ? (min > 40 ? [dur * 0.24, dur * 0.49, dur * 0.74] : [dur * 0.34, dur * 0.68]) : []
      const file = path.join(sdir, `${safe(s.title)} - S${pad(season.n)}E${pad(i + 1)} - ${safe(title)}.mkv`)
      tasks.push(() => cut(lf[i % 3], file, dur, acts.map(Math.round)))
    })
  }
}

// Movies
for (const m of MOVIES) {
  const dir = path.join(MEDIA, 'Movies', `${safe(m.title)} (${m.year})`)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'movie.nfo'), nfo('movie', `  <title>${x(m.title)}</title>\n  <year>${m.year}</year>\n  <uniqueid type="tmdb" default="true">${m.id}</uniqueid>`))
  const frames = [0, 1, 2].map((v) => path.join(ART, 'frames', `${m.slug}-${v}.jpg`))
  const lf = path.join(WORK, `loop-${m.slug}.mkv`)
  loops.push(() => loop(lf, frames, songFor(m.slug, { parts: 'pad,bass', gain: 0.6 })))
  const dur = m.min * 60 + 17
  tasks.push(() => cut(lf, path.join(dir, `${safe(m.title)} (${m.year}).mkv`), dur, [0.22, 0.45, 0.68].map((t) => Math.round(dur * t))))
  for (const [kind, min] of m.extras ?? []) {
    const folder = kind === 'Trailer' ? 'Trailers' : 'Behind The Scenes'
    tasks.push(() => cut(lf, path.join(dir, folder, `${safe(m.title)} - ${kind}.mkv`), Math.round(min * 60)))
  }
}

// Ads (the break reel's folder)
for (const ad of ADS) {
  const lf = path.join(WORK, `loop-ad-${ad.slug}.mkv`)
  const frames = [0, 1, 0].map((v) => path.join(ART, 'frames', `ad-${ad.slug}-${v}.jpg`))
  loops.push(() => loop(lf, frames, songFor(ad.slug, { bpm: 132, gain: 0.8 })))
  tasks.push(() => cut(lf, path.join(MEDIA, 'Commercials', `${safe(ad.brand)} - ${safe(ad.line)}.mkv`), ad.sec))
}

// Music videos: Artist/Artist - Title.mp4, with a Kodi .nfo for the year.
for (const a of ARTISTS) {
  const aslug = slug(a.name)
  if (!a.videos.length) continue
  const dir = path.join(MEDIA, 'Music Videos', safe(a.name))
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(path.join(ART, 'artists', `${aslug}.jpg`), path.join(dir, 'artist.jpg'))
  a.videos.forEach(([title, year], i) => {
    const file = path.join(dir, `${safe(a.name)} - ${safe(title)}.mp4`)
    const lf = path.join(WORK, `loop-mv-${aslug}-${i}.mp4`)
    const dur = 200 + rng(hash(title))() * 50
    tasks.push(async () => {
      if (fs.existsSync(file)) return
      await ffmpeg(['-loop', '1', '-t', String(dur), '-i', path.join(ART, 'frames', `mv-${aslug}-${i}.jpg`), '-f', 'lavfi', '-t', String(dur), '-i', songFor(`${a.name}|${title}`), '-vf', 'scale=1280:720,setsar=1,fps=24,format=yuv420p', '-ac', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '27', '-g', '48', '-c:a', 'aac', '-b:a', '128k', '-af', `afade=t=in:d=1,afade=t=out:st=${dur - 3}:d=3`, '-shortest', file])
    })
    fs.writeFileSync(file.replace(/\.mp4$/, '.nfo'), nfo('musicvideo', `  <title>${x(title)}</title>\n  <artist>${x(a.name)}</artist>\n  <year>${year}</year>`))
    void lf
  })
}

// Songs: Artist/Album/NN - Title.mp3, tagged, with cover.jpg, artist.jpg and .lrc
for (const al of ALBUMS) {
  const adir = path.join(MEDIA, 'Music', safe(al.artist))
  const dir = path.join(adir, safe(al.title))
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(path.join(ART, 'albums', `${slug(al.title)}.jpg`), path.join(dir, 'cover.jpg'))
  const artistPic = path.join(ART, 'artists', `${slug(al.artist)}.jpg`)
  if (fs.existsSync(artistPic)) fs.copyFileSync(artistPic, path.join(adir, 'artist.jpg'))
  al.tracks.forEach((t, i) => {
    const [title, trackArtist] = Array.isArray(t) ? t : [t, al.artist]
    const file = path.join(dir, `${pad(i + 1)} - ${safe(title)}.mp3`)
    const r = rng(hash(`${trackArtist}|${title}`))
    const dur = Math.round(r.range(178, 236))
    const lyric = LYRICS[`${trackArtist}|${title}`]
    if (lyric) {
      const lines = []
      for (let k = 0, at = 11.5; at < dur - 12; k++, at += r.range(5.5, 7.5)) lines.push(`[${pad(Math.floor(at / 60))}:${(at % 60).toFixed(2).padStart(5, '0')}]${lyric[k % lyric.length]}`)
      fs.writeFileSync(file.replace(/\.mp3$/, '.lrc'), `[ar:${trackArtist}]\n[ti:${title}]\n[al:${al.title}]\n` + lines.join('\n') + '\n')
    }
    tasks.push(async () => {
      if (fs.existsSync(file)) return
      const meta = { title, artist: trackArtist, album_artist: al.artist, album: al.title, track: `${i + 1}/${al.tracks.length}`, date: String(al.year), genre: al.genre, publisher: al.label, ...(al.compilation ? { compilation: '1' } : {}) }
      await ffmpeg(['-f', 'lavfi', '-t', String(dur), '-i', songFor(`${trackArtist}|${title}`), '-af', `afade=t=in:d=0.5,afade=t=out:st=${dur - 4}:d=4`, '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '160k', '-id3v2_version', '3', ...Object.entries(meta).flatMap(([k, v]) => ['-metadata', `${k}=${v}`]), file])
    })
  })
}

// A music bed for the idents, uploaded to the Studio by seed.mjs.
tasks.push(() => (fs.existsSync(path.join(DEMO, 'ident-bed.mp3')) ? null : ffmpeg(['-f', 'lavfi', '-t', '40', '-i', song({ root: 233.08, bpm: 100, prog: 2, parts: 'pad,bass,arp,hat', gain: 0.9 }), '-af', 'afade=t=in:d=1,afade=t=out:st=36:d=4', '-ac', '2', '-c:a', 'libmp3lame', '-b:a', '160k', path.join(DEMO, 'ident-bed.mp3')])))

// A bumper for Fright Night's "Your own clip" ident: its logo over the pumpkin field.
tasks.push(() =>
  fs.existsSync(path.join(DEMO, 'fright-bumper.mp4'))
    ? null
    : ffmpeg(['-loop', '1', '-t', '10', '-i', path.join(ART, 'frames', 'the-pumpkin-patch-1.jpg'), '-loop', '1', '-t', '10', '-i', path.join(ART, 'logos', 'fright-night.png'), '-f', 'lavfi', '-t', '10', '-i', song({ root: 110, bpm: 70, prog: 3, parts: 'pad,bass,kick', gain: 0.9 }), '-filter_complex', "[0]scale=1920:1080,zoompan=z='1+0.0008*on':d=1:s=1920x1080:fps=30,eq=brightness=-0.12[bg];[1]format=rgba,scale=900:-1,fade=t=in:st=0.6:d=1.2:alpha=1[lg];[bg][lg]overlay=(W-w)/2:(H-h)/2-30:format=auto,fade=t=in:d=0.6,fade=t=out:st=9.2:d=0.8,format=yuv420p[v]", '-map', '[v]', '-map', '2:a', '-ac', '2', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-c:a', 'aac', '-b:a', '128k', '-t', '10', '-movflags', '+faststart', path.join(DEMO, 'fright-bumper.mp4')]),
)

console.log(`${loops.length} loops, then ${tasks.length} files`)
await pool(loops, 6)
await pool(tasks, 6)
console.log(`Media in ${MEDIA}`)

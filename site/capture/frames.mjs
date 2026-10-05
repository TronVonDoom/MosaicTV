// Records a MosaicTV's channels at the moments worth showing — a program, its
// up-next card, a break, a song starting — and keeps a frame every two seconds
// from each, to pick the best from. It only watches: the streams are read the
// way any player reads them.
//
//   CAPTURE_DIR=… MOSAIC=http://your-server:8688 node site/capture/frames.mjs [window-minutes] [channel numbers]
//
// Runs until every moment inside the window (default 40 minutes) has passed;
// `13,31,64` keeps it to those channels.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const DIR = process.env.CAPTURE_DIR
const BASE = process.env.MOSAIC
if (!DIR || !BASE) throw new Error('Set CAPTURE_DIR and MOSAIC')
const OUT = path.join(DIR, 'caps')
const WINDOW = Number(process.argv[2] ?? 40) * 60_000
const only = process.argv[3] ? process.argv[3].split(',').map(Number) : null
fs.mkdirSync(OUT, { recursive: true })
const sleep = (ms) => new Promise((r) => setTimeout(r, Math.max(0, ms)))
const get = async (u) => (await fetch(BASE + u)).json()

function run(args) {
  return new Promise((resolve) => {
    const p = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'ignore' })
    p.on('close', resolve)
  })
}

/** Record `sec` seconds of channel `num` starting now, then split it into frames. */
async function record(name, num, sec) {
  const clip = path.join(OUT, `${name}.ts`)
  await run(['-i', `${BASE}/iptv/channel/${num}/index.m3u8`, '-t', String(sec), '-c', 'copy', clip])
  await run(['-i', clip, '-vf', 'fps=1/2', '-q:v', '2', path.join(OUT, `${name}-%02d.jpg`)])
  console.log(`${new Date().toISOString().slice(11, 19)} ${name}`)
}

const list = (await get('/api/channels')).filter((c) => c.number != null && (!only || only.includes(c.number)))
const channels = await Promise.all(list.map((c) => get(`/api/channels/${c.id}`)))
const now = Date.now()
const tasks = []
const onNow = await get('/api/channels/now')
channels.forEach((c, k) => tasks.push({ name: `ch${c.number}-now`, num: c.number, at: now + k * 15_000, sec: 14 }))
const stamp = (t) => new Date(t).toISOString().slice(11, 16).replace(':', '')
for (const c of channels) {
  const card = JSON.parse(c.comingUp ?? 'null')
  const lead = (card?.leadSeconds ?? 75) * 1000
  const row = onNow.find((x) => x.channelId === c.id)
  // Programs as the guide groups them (a broadcast episode is one), so the
  // card is timed on the whole half-hour, as the channel times it.
  for (const p of [row?.now, ...(row?.next ?? [])].filter(Boolean)) {
    const start = Date.parse(p.startTime)
    const stop = Date.parse(p.stopTime)
    if (p.kind === 'program' && card?.enabled && stop - lead > now + 30_000 && stop - lead < now + WINDOW)
      tasks.push({ name: `ch${c.number}-card-${stamp(stop)}`, num: c.number, at: stop - lead - 8_000, sec: 30 })
    if (p.kind === 'program' && (p.type === 'music' || p.type === 'song') && start > now + 30_000 && start < now + WINDOW)
      tasks.push({ name: `ch${c.number}-start-${stamp(start)}`, num: c.number, at: start - 4_000, sec: 24 })
  }
  const { items } = await get(`/api/channels/${c.id}/playout`)
  for (const it of items) {
    const start = Date.parse(it.startTime)
    const stop = Date.parse(it.stopTime)
    if (start > now + WINDOW) break
    if (it.kind === 'filler' && start > now + 30_000 && stop - start > 20_000)
      tasks.push({ name: `ch${c.number}-break-${stamp(start)}`, num: c.number, at: start + 2_000, sec: 16 })
  }
}
// Keep it to a few of each kind per channel.
const seen = new Map()
const picked = tasks
  .sort((a, b) => a.at - b.at)
  .filter((t) => {
    const k = t.name.replace(/-\d{4}$/, '')
    const n = (seen.get(k) ?? 0) + 1
    seen.set(k, n)
    return n <= 2
  })
console.log(`${picked.length} recordings over the next ${Math.round((Math.max(...picked.map((t) => t.at)) - now) / 60000)} minutes`)
await Promise.all(
  picked.map(async (t) => {
    // Ask for the stream a little early so it's running when the moment comes.
    await sleep(t.at - Date.now() - 10_000)
    await record(t.name, t.num, t.sec + 10)
  }),
)
console.log('Done')

// Builds the demo instance through MosaicTV's own API, as someone setting it
// up by hand would: libraries, scans and metadata, logos with watermarks, a
// station theme, eight channels with collections, rotations, time blocks,
// broadcast clocks and act breaks, cartoons grouped into broadcast episodes,
// idents in every look, and up-next cards.
//
//   DEMO_DIR=… MOSAIC=http://localhost:8830 node site/demo/seed.mjs

import fs from 'node:fs'
import path from 'node:path'
import { CHANNELS } from './catalog.mjs'

const DEMO = process.env.DEMO_DIR
const BASE = process.env.MOSAIC ?? 'http://localhost:8830'
if (!DEMO) throw new Error('Set DEMO_DIR')
const MEDIA = path.join(DEMO, 'media')
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function api(method, url, body, headers = {}) {
  const raw = Buffer.isBuffer(body)
  const res = await fetch(BASE + url, {
    method,
    headers: raw ? headers : { 'Content-Type': 'application/json', ...headers },
    body: body == null ? undefined : raw ? body : JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : null
}
const get = (u) => api('GET', u)
const post = (u, b) => api('POST', u, b ?? {})
const patch = (u, b) => api('PATCH', u, b)
const put = (u, b) => api('PUT', u, b)
async function idle(statusUrl, label) {
  await sleep(800)
  for (let i = 0; i < 600; i++) {
    const s = await get(statusUrl)
    if (!s.running) return s
    await sleep(1000)
  }
  throw new Error(`${label} never finished`)
}

// ── Settings ───────────────────────────────────────────────────────────────
console.log('Settings')
await post('/api/settings/tmdb', { apiKey: 'demo-placeholder' })
await post('/api/settings/stream-mode', { mode: 'hls' })
await post('/api/settings/tuner-name', { friendlyName: 'MosaicTV' })

// ── Libraries ──────────────────────────────────────────────────────────────
console.log('Libraries')
const existing = await get('/api/libraries')
const libs = {}
for (const [key, name, kind, folder] of [
  ['tv', 'TV Shows', 'tv', 'TV'],
  ['movies', 'Movies', 'movie', 'Movies'],
  ['mv', 'Music Videos', 'music', 'Music Videos'],
  ['music', 'Music', 'audio', 'Music'],
]) {
  libs[key] = existing.find?.((l) => l.name === name) ?? (existing.libraries ?? []).find((l) => l.name === name) ?? (await post('/api/libraries', { name, kind, folders: [path.join(MEDIA, folder)] }))
}
for (const l of Object.values(libs)) {
  console.log(`  scanning ${l.name}`)
  await post(`/api/scan/${l.id}`)
  await idle('/api/scan/status', 'scan')
}
for (const l of [libs.tv, libs.movies]) {
  console.log(`  metadata for ${l.name}`)
  await idle('/api/metadata/status', 'metadata')
  await post(`/api/metadata/${l.id}?force=1`).catch((e) => console.log('   ', e.message))
  await idle('/api/metadata/status', 'metadata')
}

// ── Branding ───────────────────────────────────────────────────────────────
console.log('Logos, theme, profile')
const WATERMARKS = {
  'mosaic-toons': { position: 'bottom-right', widthPercent: 13 },
  hometown: { position: 'top-right', widthPercent: 14 },
  'midnight-movies': { position: 'bottom-right', widthPercent: 13 },
  'nite-owl': { position: 'bottom-right', widthPercent: 13, mode: 'intermittent', frequencyMinutes: 4, durationSeconds: 40 },
  'retro-rewind': { position: 'top-right', widthPercent: 12 },
  'fright-night': { position: 'bottom-right', widthPercent: 12 },
  'harbor-44': { position: 'top-right', widthPercent: 14 },
  'mosaic-fm': { position: 'top-right', widthPercent: 14 },
}
const logos = {}
const haveLogos = await get('/api/logos')
for (const c of CHANNELS) {
  const old = (haveLogos.logos ?? haveLogos).find?.((l) => l.name === c.name)
  const logo = old ?? (await post('/api/logos', { name: c.name, dataUrl: `data:image/png;base64,${fs.readFileSync(path.join(DEMO, 'art', 'logos', `${c.slug}.png`)).toString('base64')}` }))
  await patch(`/api/logos/${logo.id}`, { watermark: { mode: 'permanent', horizontalMarginPercent: 3.5, verticalMarginPercent: 4, opacityPercent: 90, fadeSeconds: 1, constrainToMedia: true, ...WATERMARKS[c.slug] } })
  logos[c.slug] = logo
}
const theme = await api('POST', `/api/assets?kind=audio&name=${encodeURIComponent('Station theme')}`, fs.readFileSync(path.join(DEMO, 'ident-bed.mp3')), { 'Content-Type': 'audio/mpeg' })
const bumper = await api('POST', `/api/assets?kind=filler&name=${encodeURIComponent('Fright Night bumper')}`, fs.readFileSync(path.join(DEMO, 'fright-bumper.mp4')), { 'Content-Type': 'video/mp4' })
const profile = await post('/api/profiles', { name: 'Full HD', width: 1920, height: 1080, fps: 30, quality: 'high', hwaccel: 'auto', normalizeLoudness: true })

// ── Helpers for schedules ──────────────────────────────────────────────────
const items = async (libraryId, type, q = '') => (await get(`/api/media?libraryId=${libraryId}&type=${type}&pageSize=100&q=${encodeURIComponent(q)}`)).items
const movieId = async (title) => (await items(libs.movies.id, 'movie', title)).find((m) => m.title === title).id
async function collection(channelId, name, defaultOrder, members, filter = {}) {
  const col = await post('/api/collections', { name, channelId, defaultOrder, ...filter })
  for (const m of members) await post(`/api/collections/${col.id}/items`, m)
  return col
}
const show = (showTitle) => ({ kind: 'show', showTitle, libraryId: libs.tv.id })
const season = (showTitle, n) => ({ kind: 'season', showTitle, season: n, libraryId: libs.tv.id })
const movie = async (title) => ({ kind: 'movie', mediaItemId: await movieId(title) })
const artist = (name, libraryId) => ({ kind: 'artist', artist: name, libraryId })
const album = (name, title) => ({ kind: 'album', artist: name, album: title, libraryId: libs.music.id })
const card = (o = {}) => ({ enabled: true, timing: 'beforeEnd', leadSeconds: 75, holdSeconds: 14, fadeSeconds: 0.6, style: 'glass', position: 'bottom-left', size: 'medium', ...o })
const DAILY = '0,1,2,3,4,5,6'
const hm = (h, m = 0) => h * 60 + m

// ── Broadcast episodes ─────────────────────────────────────────────────────
console.log('Broadcast episodes')
const eps = async (showTitle) => (await items(libs.tv.id, 'episode', showTitle)).filter((e) => e.showTitle === showTitle)
const cc = await eps('Captain Comet')
const at = (list, s, e) => list.find((x) => x.season === s && x.episode === e).id
for (const [s, n] of [[1, 12], [2, 9]]) {
  const groups = []
  for (let e = 1; e <= n; e += 3) groups.push([at(cc, s, e), at(cc, s, e + 1), at(cc, s, e + 2)])
  await put('/api/airings', { libraryId: libs.tv.id, showTitle: 'Captain Comet', season: s, groups })
}
const dd = await eps('Dino Dudes')
const pp = await eps('Professor Penguin')
await put('/api/airings', {
  libraryId: libs.tv.id,
  showTitle: 'Dino Dudes',
  season: 1,
  groups: [1, 2, 3, 4].map((k) => [at(dd, 1, k * 2 - 1), at(pp, 1, k), at(dd, 1, k * 2)]),
})

// ── Channels ───────────────────────────────────────────────────────────────
console.log('Channels')
const have = await get('/api/channels')
const ch = {}
for (const c of CHANNELS) {
  const row = (have.channels ?? have).find?.((x) => x.number === c.number) ?? (await post('/api/channels', { number: c.number, name: c.name, group: c.group, logoId: logos[c.slug].id }))
  ch[c.slug] = row
  await patch(`/api/channels/${row.id}`, { profileId: profile.id, logoOnBreaks: false })
}
const set = (slug, body) => patch(`/api/channels/${ch[slug].id}`, body)
const rotate = (slug, collectionId, extra = {}) => post(`/api/channels/${ch[slug].id}/rotation`, { collectionId, playbackOrder: 'inherit', mode: 'one', count: 1, ...extra })
const block = (slug, b) => post(`/api/channels/${ch[slug].id}/blocks`, { playbackOrder: 'inherit', startMode: 'soft', fillerMode: 'end', ...b })
async function idents(slug, list) {
  const [starter] = await get(`/api/fillers?channelId=${ch[slug].id}`)
  const [first, ...rest] = list
  await patch(`/api/fillers/${starter.id}`, { logoScale: 1, divider: false, plays: 'any', blockIds: [], ...first })
  for (const i of rest) await post('/api/fillers', { channelId: ch[slug].id, logoScale: 1, divider: false, plays: 'any', blockIds: [], ...i })
}

// 2 · Mosaic Toons — broadcast episodes on a half-hour clock, act breaks filled with old ads.
{
  const id = ch['mosaic-toons'].id
  const faves = await collection(id, 'Cartoon Favorites', 'rotate', [show('Captain Comet'), show('Dino Dudes')])
  const action = await collection(id, 'Robo Rangers', 'chronological', [show('Robo Rangers')])
  await rotate('mosaic-toons', faves.id)
  const sat = await block('mosaic-toons', { collectionId: faves.id, days: '6', startMinute: hm(7), endMinute: hm(12), startMode: 'hard' })
  const late = await block('mosaic-toons', { collectionId: action.id, days: DAILY, startMinute: hm(22), endMinute: hm(2), startMode: 'hard', comingUp: card({ style: 'broadcast' }) })
  await set('mosaic-toons', { grid: 30, actBreaks: true, comingUp: card() })
  await idents('mosaic-toons', [
    { name: 'Commercials', style: 'reel', reelFolder: path.join(MEDIA, 'Commercials') },
    { name: 'Mosaic Toons', style: 'frosted', audioAssetId: theme.id },
    { name: 'Late Night', style: 'spotlight', audioAssetId: theme.id, plays: 'blocks', blockIds: [late.id] },
  ])
  void sat
}

// 4 · Hometown — sitcoms taking turns, a Sunday marathon, the broadcast-style card.
{
  const id = ch.hometown.id
  const sitcoms = await collection(id, 'Sitcom Rotation', 'rotate', [show('Maple Street'), show('Second Helpings'), show('Pemberton Place')])
  const maple = await collection(id, 'Maple Street Marathon', 'chronological', [show('Maple Street')])
  const diner = await collection(id, 'Second Helpings', 'chronological', [show('Second Helpings')])
  await rotate('hometown', sitcoms.id)
  const marathon = await block('hometown', { collectionId: maple.id, days: '0', startMinute: hm(12), endMinute: hm(18) })
  await block('hometown', { collectionId: diner.id, days: '1,2,3,4,5', startMinute: hm(20), endMinute: hm(21), startMode: 'hard' })
  await set('hometown', { grid: 30, actBreaks: true, comingUp: card({ style: 'broadcast' }) })
  await idents('hometown', [
    { name: 'Hometown', style: 'frosted', audioAssetId: theme.id },
    { name: 'Marathon', style: 'spotlight', audioAssetId: theme.id, plays: 'blocks', blockIds: [marathon.id] },
  ])
}

// 7 · Midnight Movies — an hourly clock and a Friday double feature.
{
  const id = ch['midnight-movies'].id
  const night = await collection(id, 'Movie Night', 'shuffle', await Promise.all(['The Last Arcade', 'Neon Harbor', 'Orbit Kids', 'The Great Mall Heist', 'Cove Lights', 'Velvet Skyline'].map(movie)))
  await rotate('midnight-movies', night.id)
  await block('midnight-movies', { collectionId: night.id, days: '5', startMinute: hm(20), endMinute: hm(24), startMode: 'hard', playbackOrder: 'chronological' })
  await set('midnight-movies', { grid: 60, actBreaks: true, comingUp: card({ position: 'bottom-left', size: 'large' }) })
  await idents('midnight-movies', [{ name: 'Midnight Movies', style: 'spotlight', audioAssetId: theme.id }])
}

// 13 · Nite Owl — classics, and Nightfall Theater in 4:3 at eleven with its own ident.
{
  const id = ch['nite-owl'].id
  const classics = await collection(id, 'Nite Owl Classics', 'shuffleShows', [show('Pemberton Place'), season('Maple Street', 1), show('Second Helpings')])
  const nightfall = await collection(id, 'Nightfall Theater', 'chronological', [show('Nightfall Theater')])
  await rotate('nite-owl', classics.id)
  const nf = await block('nite-owl', { collectionId: nightfall.id, days: DAILY, startMinute: hm(23), endMinute: hm(1), startMode: 'hard' })
  await set('nite-owl', { grid: 30, comingUp: card({ size: 'small' }) })
  await idents('nite-owl', [
    { name: 'Nite Owl', style: 'frosted' },
    { name: 'Nightfall', style: 'spotlight', plays: 'blocks', blockIds: [nf.id] },
  ])
}

// 22 · Retro Rewind — music videos, taking turns by artist, with Now playing cards.
{
  const id = ch['retro-rewind'].id
  const mvArtists = ['Neon Avenue', 'The Static Lines', 'Cassette Club', 'Luna Park Radio', 'Paper Satellites', 'Velvet Signal']
  const col = await collection(id, 'Retro Rewind', 'rotate', mvArtists.map((a) => artist(a, libs.mv.id)))
  await rotate('retro-rewind', col.id)
  await set('retro-rewind', { comingUp: card({ position: 'bottom-left' }) })
  await idents('retro-rewind', [{ name: 'Retro Rewind', style: 'frosted', audioAssetId: theme.id }])
}

// 31 · Fright Night — a smart filter (every horror movie), with their extras.
{
  const id = ch['fright-night'].id
  const horror = await collection(id, 'Horror Movies', 'shuffle', [], { libraryId: libs.movies.id, filterType: 'movie', filterGenre: 'Horror' })
  const nightfall = await collection(id, 'Creature Feature', 'chronological', [show('Nightfall Theater')])
  await rotate('fright-night', horror.id)
  await block('fright-night', { collectionId: nightfall.id, days: '5,6', startMinute: hm(21), endMinute: hm(23), startMode: 'hard' })
  await set('fright-night', { includeExtras: true, comingUp: card() })
  await idents('fright-night', [
    { name: 'Fright Night bumper', style: 'custom', assetId: bumper.id },
    { name: 'Fright Night', style: 'frosted', audioAssetId: theme.id },
  ])
}

// 44 · Harbor 44 — two episodes of the drama, then a movie, on an hourly clock.
{
  const id = ch['harbor-44'].id
  const patrol = await collection(id, 'Harbor Patrol', 'chronological', [show('Harbor Patrol')])
  const after = await collection(id, 'After Dark', 'shuffle', await Promise.all(['Neon Harbor', 'Cove Lights', 'Velvet Skyline'].map(movie)))
  await rotate('harbor-44', patrol.id, { mode: 'multiple', count: 2 })
  await rotate('harbor-44', after.id)
  await set('harbor-44', { grid: 60, actBreaks: true, comingUp: card({ style: 'broadcast' }) })
  await idents('harbor-44', [{ name: 'Harbor 44', style: 'frosted' }])
}

// 99 · Mosaic FM — songs over the now-playing screen, lyrics first.
{
  const id = ch['mosaic-fm'].id
  const col = await collection(id, 'Mosaic FM', 'shuffle', [
    artist('Velvet Signal', libs.music.id),
    artist('Paper Satellites', libs.music.id),
    artist('Marina Bay', libs.music.id),
    artist('The Night Bus', libs.music.id),
    album('Various Artists', 'Mosaic Mixtape Vol. 1'),
  ])
  await rotate('mosaic-fm', col.id)
  await set('mosaic-fm', { musicScreen: 'album', lyricsFirst: true, songsAround: true })
  await idents('mosaic-fm', [{ name: 'Mosaic FM', style: 'frosted', audioAssetId: theme.id }])
}

// A draft (no number yet): the holiday special, with specials switched on.
{
  const draft = await post('/api/channels', { number: null, name: 'Holiday Classics', group: 'Seasonal', logoId: logos.hometown.id })
  const col = await collection(draft.id, 'Holiday Specials', 'chronological', [season('Maple Street', 0), show('Pemberton Place')])
  await post(`/api/channels/${draft.id}/rotation`, { collectionId: col.id, playbackOrder: 'inherit', mode: 'one', count: 1 })
  await patch(`/api/channels/${draft.id}`, { includeSpecials: true, profileId: profile.id })
}

console.log('Seeded. Guides build on their own; act breaks are found in the background.')

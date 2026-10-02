// Music videos' metadata: titles freed of YouTube's noise, Kodi's
// <musicvideo> .nfo, the files' own tags (artist, album, a cover picture), and
// a scan that reads them all — the folders' artist and album standing, the
// sources filling in only what those don't say.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { tempDb } from '../testDb.js'
import { parseMedia } from '../scanner/parse.js'
import { parseNfo } from './nfo.js'
import { embeddedTags } from '../ffprobe.js'

const { prisma, dir } = await tempDb('mosaictv-musicmeta-')
const { scanLibrary } = await import('../scanner/scanner.js')
const { enrichLibrary } = await import('./metadata.js')

// A library on disk for the tests that read real files, made before any test
// runs (node:test closes the database once the tests it knows of are done).
const root = path.join(dir, 'mv')
const lib = await prisma.library.create({ data: { name: 'Music Videos', kind: 'music', metadataSources: 'nfo,embedded', folders: { create: [{ path: root }] } } })
const put = (rel: string, body = '') => {
  const p = path.join(root, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, body)
  return p
}
const row = (rel: string) => prisma.mediaItem.findUniqueOrThrow({ where: { path: path.join(root, rel) } })

const song = (rel: string) => parseMedia(path.join('/mv', rel), '/mv', 'music')

test('a music video’s title loses what YouTube added, and keeps what the song has', () => {
  assert.equal(song('Madonna - Vogue (Official Music Video) [4K].mp4').title, 'Vogue')
  assert.equal(song('a-ha - Take On Me (Official 4K Music Video).webm').title, 'Take On Me')
  assert.equal(song('Madonna/Vogue (Official Video) [GuJQSAiODqI].mkv').title, 'Vogue')
  assert.equal(song('Nirvana/Lithium (Lyric Video) [HD].mp4').title, 'Lithium')
  // The artist's name off the front when it repeats the folder's.
  assert.deepEqual([song('Madonna/Madonna - Vogue.mp4').title, song('Madonna/Madonna - Vogue.mp4').artist], ['Vogue', 'Madonna'])
  // What's the song's stays.
  assert.equal(song('Nirvana/About a Girl (Live).mp4').title, 'About a Girl (Live)')
  assert.equal(song('Run-DMC - Walk This Way (feat. Aerosmith).mp4').title, 'Walk This Way (feat. Aerosmith)')
  // A name with spaces keeps its dots; a scene-style one's dots are its spaces.
  assert.equal(song('The Killers - Mr. Brightside (Official Music Video).mp4').title, 'Mr. Brightside')
  assert.equal(song('Blur/Song.2.mkv').title, 'Song 2')
  assert.equal(song('Daft Punk/Discovery/One More Time (Remix).mkv').title, 'One More Time (Remix)')
  // A name that's nothing but noise keeps itself rather than coming out empty.
  assert.equal(song('Artist/(Official Video).mp4').title, '(Official Video)')
})

test('Kodi’s <musicvideo> .nfo gives its artists, album and the rest', () => {
  const n = parseNfo(`<?xml version="1.0"?>
<musicvideo>
  <title>Walk This Way</title>
  <artist>Run-DMC</artist>
  <artist>Aerosmith</artist>
  <album>Raising Hell</album>
  <year>1986</year>
  <premiered>1986-07-04</premiered>
  <genre>Hip Hop / Rock</genre>
  <director>Jon Small</director>
  <studio>Profile</studio>
  <plot>Two bands, one wall.</plot>
</musicvideo>`)
  assert.ok(n)
  assert.deepEqual(
    [n.title, n.artists, n.album, n.year, n.date, n.genres, n.directors, n.studios, n.plot],
    ['Walk This Way', ['Run-DMC', 'Aerosmith'], 'Raising Hell', 1986, '1986-07-04', ['Hip Hop', 'Rock'], ['Jon Small'], ['Profile'], 'Two bands, one wall.'],
  )
})

test('a file’s tags give its artist (or album artist) and album, and say where its cover picture is', () => {
  assert.deepEqual(embeddedTags({ ARTIST: 'Madonna', ALBUM: 'I’m Breathless', title: 'Vogue' }), { title: 'Vogue', artist: 'Madonna', album: 'I’m Breathless' })
  assert.equal(embeddedTags({ album_artist: 'Various' }).artist, 'Various')
  // An MP4's attached picture, and a Matroska attachment.
  assert.deepEqual(embeddedTags({}, [{ index: 0, codec_type: 'video' }, { index: 2, codec_type: 'video', disposition: { attached_pic: 1 } }]).cover, { stream: 2 })
  assert.deepEqual(embeddedTags({}, [{ index: 3, codec_type: 'attachment', tags: { mimetype: 'image/jpeg' } }]).cover, { stream: 3, attachment: true })
  assert.equal(embeddedTags({}, [{ index: 3, codec_type: 'attachment', tags: { mimetype: 'application/x-truetype-font' } }]).cover, undefined)
})


test('the .nfo and tags fill in what the folders and name don’t — the folders’ artist and album stand', async () => {
  // Rows as a scan left them, their tags already read.
  const vogue = put('Madonna/I’m Breathless/Vogue.mp4')
  put(
    'Madonna/I’m Breathless/Vogue.nfo',
    '<musicvideo><title>Vogue</title><artist>Madonna</artist><director>David Fincher</director><studio>Sire</studio><plot>Strike a pose.</plot><genre>Dance</genre></musicvideo>',
  )
  const loose = put('Untitled.mkv')
  const tags = (t: object) => JSON.stringify(t)
  await prisma.mediaItem.create({
    data: {
      libraryId: lib.id, path: vogue, type: 'music', title: 'Vogue', artist: 'Madonna', album: 'I’m Breathless', durationSec: 300, mtimeMs: 1,
      // Tags that would rename her: the folder wins.
      embedded: tags({ artist: 'Madonna Louise Ciccone', album: 'Vogue (single)', genre: 'Pop', date: '1990-03-27' }),
    },
  })
  await prisma.mediaItem.create({
    data: { libraryId: lib.id, path: loose, type: 'music', title: 'Untitled', durationSec: 240, mtimeMs: 1, embedded: tags({ title: 'Take On Me', artist: 'a-ha', album: 'Hunting High and Low', date: '1985' }) },
  })
  await enrichLibrary(lib.id, 'all')

  const v = await row('Madonna/I’m Breathless/Vogue.mp4')
  assert.deepEqual(
    [v.artist, v.album, v.year, v.genres, v.directors, v.studio, v.overview, v.metaSources],
    ['Madonna', 'I’m Breathless', 1990, 'Dance', 'David Fincher', 'Sire', 'Strike a pose.', 'nfo,embedded'],
  )
  // A flat file with no "Artist - " in its name takes its tags' artist, album and year; its title is the file's, the tags' kept beside it.
  const l = await row('Untitled.mkv')
  assert.deepEqual([l.title, l.metaTitle, l.artist, l.album, l.year], ['Untitled', 'Take On Me', 'a-ha', 'Hunting High and Low', 1985])
})

test('a library reads only the sources it has on', async () => {
  await prisma.library.update({ where: { id: lib.id }, data: { metadataSources: 'nfo' } })
  await enrichLibrary(lib.id, 'all')
  const v = await row('Madonna/I’m Breathless/Vogue.mp4')
  assert.deepEqual([v.genres, v.year, v.metaSources], ['Dance', null, 'nfo'])
  await prisma.library.update({ where: { id: lib.id }, data: { metadataSources: 'nfo,embedded' } })
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const ff = (...args: string[]) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
  assert.equal(r.status, 0, String(r.stderr))
}

test('a scan reads a video’s tags, its own cover inside it, the artist’s picture and its .nfo', { skip: !hasFfmpeg && 'no ffmpeg here' }, async () => {
  const scratch = path.join(dir, 'make')
  fs.mkdirSync(scratch, { recursive: true })
  const cover = path.join(scratch, 'cover.png')
  ff('-f', 'lavfi', '-i', 'color=c=0xd14fa0:s=64x64:d=1', '-frames:v', '1', cover)
  const clip = path.join(scratch, 'clip.mp4')
  ff('-f', 'lavfi', '-i', 'testsrc2=s=160x90:r=10:d=2', '-f', 'lavfi', '-i', 'sine=d=2', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac', '-shortest', clip)

  // An MP4 with its cover attached, as yt-dlp embeds a thumbnail.
  const holiday = put('Madonna/Madonna/Holiday (Official Video) [hT3tpVkP6Zk].mp4')
  ff('-i', clip, '-i', cover, '-map', '0', '-map', '1', '-c', 'copy', '-c:v:1', 'png', '-disposition:v:1', 'attached_pic', '-metadata', 'genre=Dance', '-metadata', 'date=1983', holiday)
  put('Madonna/artist.jpg', 'not really a jpeg')
  // A Matroska file named by nothing but its tags, its cover an attachment.
  const flat = put('Clip 0042.mkv')
  ff('-i', clip, '-attach', cover, '-metadata:s:t', 'mimetype=image/png', '-c', 'copy', '-metadata', 'ARTIST=Kilometer', '-metadata', 'DATE=1989', flat)

  await scanLibrary(lib.id)
  const h = await row('Madonna/Madonna/Holiday (Official Video) [hT3tpVkP6Zk].mp4')
  assert.deepEqual([h.title, h.artist, h.album, h.year, h.genres], ['Holiday', 'Madonna', 'Madonna', 1983, 'Dance'])
  assert.ok(h.posterPath && fs.existsSync(h.posterPath) && h.posterPath.endsWith('.jpg'), 'its own cover, copied out')
  assert.equal(h.showPosterPath, path.join(root, 'Madonna', 'artist.jpg'))
  const k = await row('Clip 0042.mkv')
  assert.deepEqual([k.artist, k.year], ['Kilometer', 1989])
  assert.ok(k.posterPath && fs.existsSync(k.posterPath), 'the attachment, copied out')

  // A forced rescan rewrites every row from its name — what the tags filled in stays.
  await scanLibrary(lib.id, true)
  const again = await row('Clip 0042.mkv')
  assert.deepEqual([again.artist, again.year, again.posterPath], ['Kilometer', 1989, k.posterPath])
})

// Songs: a Music library's audio files. Their names and folders, their own
// tags (which come first), their covers and timed lyrics, and an artist pick
// that airs an artist's songs in album order.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { tempDb } from './testDb.js'
import { parseMedia, withTags } from './scanner/parse.js'
import { embeddedTags } from './ffprobe.js'

const { prisma, dir } = await tempDb('mosaictv-songs-')
const { scanLibrary } = await import('./scanner/scanner.js')
const { resolveUnits } = await import('./collections.js')

// Made before any test runs: node:test closes the database once the tests it
// knows of are done.
const root = path.join(dir, 'music')
fs.mkdirSync(root, { recursive: true })
const lib = await prisma.library.create({ data: { name: 'Music', kind: 'audio', metadataSources: 'embedded', folders: { create: [{ path: root }] } } })
const row = (rel: string) => prisma.mediaItem.findUniqueOrThrow({ where: { path: path.join(root, rel) } })

const song = (rel: string) => parseMedia(path.join('/music', rel), '/music', 'audio')

test('a song’s name and folders give its artist, album, track and title', () => {
  const s = song('Nirvana/Nevermind (1991)/04 - Breed.flac')
  assert.deepEqual([s.type, s.artist, s.album, s.year, s.track, s.disc, s.title], ['song', 'Nirvana', 'Nevermind', 1991, 4, null, 'Breed'])
  assert.deepEqual([song('Prince/Sign o’ the Times/2-03. The Cross.mp3').disc, song('Prince/Sign o’ the Times/2-03. The Cross.mp3').track], [2, 3])
  assert.equal(song('Artist/Album/07 Song.mp3').track, 7)
  // A number that's part of the title stays in it.
  assert.deepEqual([song('Nena/99 Luftballons/99 Luftballons.mp3').track, song('Nena/99 Luftballons/99 Luftballons.mp3').title], [null, '99 Luftballons'])
  assert.equal(song('Rush/2112/2112.flac').title, '2112')
  // Flat: "Artist - Title".
  assert.deepEqual([song('Daft Punk - One More Time.mp3').artist, song('Daft Punk - One More Time.mp3').title], ['Daft Punk', 'One More Time'])
})

test('a song’s own tags come first, the name filling in what they don’t say', () => {
  const named = song('Various Artists/Now 90s/03 - track03.mp3')
  const s = withTags(named, embeddedTags({ TITLE: 'Wannabe', ARTIST: 'Spice Girls', ALBUM: 'Now 90s', DATE: '1996-07-08', track: '3/20', disc: '1/2' }))
  assert.deepEqual([s.title, s.artist, s.album, s.year, s.track, s.disc], ['Wannabe', 'Spice Girls', 'Now 90s', 1996, 3, 1])
  // An Ogg's tags sit on its audio stream; an MP3's lyrics name their language.
  const ogg = embeddedTags({}, [{ codec_type: 'audio', tags: { TITLE: 'Song', ARTIST: 'Band' } }])
  assert.deepEqual([ogg.title, ogg.artist], ['Song', 'Band'])
  assert.equal(embeddedTags({ 'lyrics-eng': '[00:01.00]Hello' }).lyrics, '[00:01.00]Hello')
  // Not a song: tags change nothing here.
  assert.equal(withTags(parseMedia('/mv/A/B.mkv', '/mv', 'music'), { title: 'X' }).title, 'B')
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const ff = (...args: string[]) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
  assert.equal(r.status, 0, String(r.stderr))
}

test('a scan reads songs — tags, covers and timed lyrics — and an artist pick airs them in album order', { skip: !hasFfmpeg && 'no ffmpeg here' }, async () => {
  const put = (rel: string) => {
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    return p
  }
  const cover = path.join(dir, 'cover.png')
  ff('-f', 'lavfi', '-i', 'color=c=0x2a7fd6:s=64x64:d=1', '-frames:v', '1', cover)
  const tone = (out: string, ...tags: string[]) => ff('-f', 'lavfi', '-i', 'sine=d=2', ...tags.flatMap((t) => ['-metadata', t]), out)
  // Tagged songs, named badly: the tags put them in order.
  tone(put('Nirvana/Nevermind/b.mp3'), 'title=Come as You Are', 'artist=Nirvana', 'album=Nevermind', 'date=1991', 'track=3')
  tone(put('Nirvana/Nevermind/a.mp3'), 'title=Smells Like Teen Spirit', 'artist=Nirvana', 'album=Nevermind', 'date=1991', 'track=1')
  tone(put('Nirvana/Bleach/01 - About a Girl.mp3'), 'date=1989')
  fs.copyFileSync(cover, path.join(root, 'Nirvana', 'Nevermind', 'folder.png'))
  // A song carrying its own cover (an MP3's attached picture) and lyrics beside it.
  const raw = path.join(dir, 'raw.mp3')
  tone(raw, 'title=Holiday', 'artist=Madonna', 'album=Madonna', 'date=1983')
  ff('-i', raw, '-i', cover, '-map', '0', '-map', '1', '-c', 'copy', '-c:v', 'png', '-disposition:v', 'attached_pic', '-id3v2_version', '3', put('Madonna/Holiday.mp3'))
  fs.writeFileSync(path.join(root, 'Madonna', 'Holiday.lrc'), '[00:00.50]Holiday\n[00:01.20]Celebrate\n')
  // Not a song: a video in a Music library is passed over.
  fs.writeFileSync(path.join(root, 'clip.mkv'), '')

  await scanLibrary(lib.id)
  const teen = await row('Nirvana/Nevermind/a.mp3')
  assert.deepEqual([teen.type, teen.title, teen.artist, teen.album, teen.year, teen.track], ['song', 'Smells Like Teen Spirit', 'Nirvana', 'Nevermind', 1991, 1])
  assert.equal(teen.posterPath, path.join(root, 'Nirvana', 'Nevermind', 'folder.png'))
  assert.equal(teen.width, null, 'a song has no picture of its own')
  const holiday = await row('Madonna/Holiday.mp3')
  assert.ok(holiday.posterPath && fs.existsSync(holiday.posterPath), 'its own cover, copied out')
  assert.equal(holiday.lyricsPath, path.join(root, 'Madonna', 'Holiday.lrc'))
  assert.equal(holiday.width, null, 'its cover isn’t taken for a picture')
  assert.equal(await prisma.mediaItem.count({ where: { path: path.join(root, 'clip.mkv') } }), 0)

  const ch = await prisma.channel.create({ data: { name: 'Radio', number: 90 } })
  const c = await prisma.collection.create({
    data: { name: 'Nirvana', channelId: ch.id, items: { create: [{ kind: 'artist', artist: 'Nirvana', libraryId: lib.id }] } },
    include: { items: true },
  })
  const titles = (await resolveUnits(c)).map((u) => u[0].title)
  assert.deepEqual(titles, ['About a Girl', 'Smells Like Teen Spirit', 'Come as You Are'])

  // A rescan of unchanged files keeps them as they were.
  await scanLibrary(lib.id)
  assert.equal((await row('Nirvana/Nevermind/b.mp3')).title, 'Come as You Are')
})

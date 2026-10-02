// Songs filed as a music app files them: under their album's artist, whoever
// sings or wrote each one — a soundtrack under Various Artists, a game-music
// set under its series — with each song's own credit kept beside it. Albums
// tagged with no album artist still come out as one album. An artist pick
// made by a song's own artist finds what it always did. A .plexignore leaves
// out what Plex leaves out.
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { tempDb } from '../testDb.js'
import { parseMedia, withTags } from './parse.js'
import { embeddedTags, TAGS_VERSION } from '../ffprobe.js'
import { extensionsFor, ignorePatterns, walk } from './walk.js'

const { prisma, dir } = await tempDb('mosaictv-albumartist-')
const { scanLibrary, getScanStatus, reparseAfterUpgrade } = await import('./scanner.js')
const { resolveUnits } = await import('../schedule/collections.js')
const { artistCards, albumCards } = await import('../music.js')

// Made before any test runs: node:test closes the database once the tests it
// knows of are done.
const root = path.join(dir, 'music')
fs.mkdirSync(root, { recursive: true })
const lib = await prisma.library.create({ data: { name: 'Music', kind: 'audio', metadataSources: 'embedded', folders: { create: [{ path: root }] } } })
const ch = await prisma.channel.create({ data: { name: 'Radio', number: 91 } })
const row = (rel: string) => prisma.mediaItem.findUniqueOrThrow({ where: { path: path.join(root, rel) } })
const song = (tags: Record<string, string>) => withTags(parseMedia('/music/Folder/Album/01 - x.mp3', '/music', 'audio'), embeddedTags(tags))

test('a song is filed under its album artist, its own credit kept beside it', () => {
  const smash = song({ artist: 'Koji Kondo', album_artist: 'Bandai Namco Studios, Sora Ltd.', album: 'Vol. 02: Super Mario' })
  assert.deepEqual([smash.artist, smash.trackArtist], ['Bandai Namco Studios, Sora Ltd.', 'Koji Kondo'])
  // Tagged as part of a compilation, with no album artist: Various Artists.
  const va = song({ artist: 'Elan Rivera', compilation: '1', album: 'Totally Pokémon' })
  assert.deepEqual([va.artist, va.trackArtist], ['Various Artists', 'Elan Rivera'])
  assert.equal(song({ artist: 'Elan Rivera', compilation: '0' }).artist, 'Elan Rivera')
  // The same person on both: no separate credit.
  const own = song({ artist: 'Nirvana', album_artist: 'Nirvana' })
  assert.deepEqual([own.artist, own.trackArtist], ['Nirvana', null])
  // Only an album artist: it's who's credited too.
  const only = song({ ALBUMARTIST: 'Various' })
  assert.deepEqual([only.artist, only.trackArtist], ['Various', null])
  assert.equal(embeddedTags({}).version, TAGS_VERSION)
})

test('a .plexignore leaves out what it names, relative to its folder, and a matched folder whole', async () => {
  const tree = path.join(dir, 'walk')
  const put = (rel: string, text = '') => {
    const p = path.join(tree, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, text)
  }
  put('Album/song.mp3')
  // "*" leaves out everything in its folder, however deep.
  put('Podcast/.plexignore', '*\n*/*\n')
  put('Podcast/take.wav')
  put('Podcast/EP01/RAW/New folder/MIC1.WAV')
  // A pattern without a "/" names this folder's own files, not its subfolders'.
  put('Other/.plexignore', '# leave out the stems\n*.wav\nSkip/*\n')
  put('Other/stem.wav')
  put('Other/keep.mp3')
  put('Other/Skip/gone.mp3')
  put('Other/Keep/also.wav')
  const found = (await walk(tree, [], extensionsFor('audio'))).map((f) => path.relative(tree, f).split(path.sep).join('/')).sort()
  assert.deepEqual(found, ['Album/song.mp3', 'Other/Keep/also.wav', 'Other/keep.mp3'])
  assert.deepEqual(ignorePatterns('# only a comment\n\n'), [])
  assert.ok(ignorePatterns('Extras/*')[0].test('extras/trailer.mkv'), 'as on a case-blind share')
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
const ff = (...args: string[]) => {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
  assert.equal(r.status, 0, String(r.stderr))
}

test('a scan files albums whole, old picks still find their songs, and old tags are read again', { skip: !hasFfmpeg && 'no ffmpeg here' }, async () => {
  const put = (rel: string) => {
    const p = path.join(root, rel)
    fs.mkdirSync(path.dirname(p), { recursive: true })
    return p
  }
  const tone = (rel: string, ...tags: string[]) => ff('-f', 'lavfi', '-i', 'sine=d=2', ...tags.flatMap((t) => ['-metadata', t]), put(rel))
  // A game-music set: each track credits its composer.
  tone('Smash Anthology/Vol. 02/001.mp3', 'title=Ground Theme', 'artist=Koji Kondo', 'album_artist=Bandai Namco Studios, Sora Ltd.', 'album=Vol. 02: Super Mario', 'track=1')
  tone('Smash Anthology/Vol. 02/002.mp3', 'title=Gourmet Race', 'artist=Hirokazu Ando', 'album_artist=Bandai Namco Studios, Sora Ltd.', 'album=Vol. 02: Super Mario', 'track=2')
  // A soundtrack tagged properly.
  tone('Various Artists/Totally Pokémon/01.mp3', 'title=Pokémon Johto', 'artist=PJ Lequerica', 'album_artist=Various Artists', 'album=Totally Pokémon', 'track=1')
  tone('Various Artists/Totally Pokémon/02.mp3', 'title=Pikachu (I Choose You)', 'artist=Elan Rivera', 'album_artist=Various Artists', 'album=Totally Pokémon', 'track=2')
  // Albums tagged with no album artist: one of many singers, one of one
  // singer and his guests.
  tone('Mixes/Summer/a.mp3', 'title=Sometimes', 'artist=Britney Spears', 'album=Summer Mix', 'track=1')
  tone('Mixes/Summer/b.mp3', 'title=Bye Bye Bye', 'artist=*NSYNC', 'album=Summer Mix', 'track=2')
  tone('Eminem/Recovery/a.mp3', 'title=Not Afraid', 'artist=Eminem', 'album=Recovery', 'track=1')
  tone('Eminem/Recovery/b.mp3', 'title=Love the Way You Lie', 'artist=Eminem feat. Rihanna', 'album=Recovery', 'track=2')
  // Raw recordings Plex is told to skip.
  fs.writeFileSync(put('Podcast/.plexignore'), '*\n')
  tone('Podcast/EP01/take.mp3', 'title=Take 1')

  await scanLibrary(lib.id)
  const ground = await row('Smash Anthology/Vol. 02/001.mp3')
  assert.deepEqual([ground.artist, ground.trackArtist], ['Bandai Namco Studios, Sora Ltd.', 'Koji Kondo'])
  assert.deepEqual([(await row('Mixes/Summer/b.mp3')).artist, (await row('Mixes/Summer/b.mp3')).trackArtist], ['Various Artists', '*NSYNC'])
  assert.deepEqual([(await row('Eminem/Recovery/a.mp3')).artist, (await row('Eminem/Recovery/a.mp3')).trackArtist], ['Eminem', null])
  assert.deepEqual([(await row('Eminem/Recovery/b.mp3')).artist, (await row('Eminem/Recovery/b.mp3')).trackArtist], ['Eminem', 'Eminem feat. Rihanna'])
  assert.equal(await prisma.mediaItem.count({ where: { path: { contains: 'Podcast' } } }), 0)

  // Three artists, four albums — not one per composer or singer.
  assert.deepEqual((await artistCards(lib.id)).map((a) => [a.artist, a.albums, a.items]), [
    ['Bandai Namco Studios, Sora Ltd.', 1, 2],
    ['Eminem', 1, 2],
    ['Various Artists', 2, 4],
  ])
  assert.equal((await albumCards(lib.id, 'title')).length, 4)

  // A pick by a song's own artist (made before songs were filed this way)
  // finds their songs; one by the album artist, the whole set.
  const pick = async (items: { kind: string; artist: string; album?: string }[]) => {
    const c = await prisma.collection.create({
      data: { name: 'Pick', channelId: ch.id, items: { create: items.map((i) => ({ ...i, libraryId: lib.id })) } },
      include: { items: true },
    })
    return (await resolveUnits(c)).map((u) => u[0].title)
  }
  assert.deepEqual(await pick([{ kind: 'artist', artist: 'Koji Kondo' }]), ['Ground Theme'])
  assert.deepEqual(await pick([{ kind: 'artist', artist: 'Bandai Namco Studios, Sora Ltd.' }]), ['Ground Theme', 'Gourmet Race'])
  assert.deepEqual(await pick([{ kind: 'album', artist: 'Various Artists', album: 'Totally Pokémon' }]), ['Pokémon Johto', 'Pikachu (I Choose You)'])

  // Tags read before the album artist was kept: filed by the song's own
  // artist, as they were. The next scan reads them again.
  const old = await row('Various Artists/Totally Pokémon/02.mp3')
  const { albumArtist: _drop, version: _old, ...before } = JSON.parse(old.embedded ?? '{}')
  await prisma.mediaItem.update({ where: { id: old.id }, data: { artist: 'Elan Rivera', trackArtist: null, embedded: JSON.stringify(before) } })
  await scanLibrary(lib.id)
  const again = await row('Various Artists/Totally Pokémon/02.mp3')
  assert.deepEqual([again.artist, again.trackArtist], ['Various Artists', 'Elan Rivera'])
  assert.equal(JSON.parse(again.embedded ?? '{}').version, TAGS_VERSION)

  // And a scan of nothing new changes nothing — the untagged albums included.
  await scanLibrary(lib.id)
  assert.equal(getScanStatus().updated, 0)
  assert.equal((await row('Mixes/Summer/a.mp3')).artist, 'Various Artists')

  // Indexed, then left out by a .plexignore: it goes for good, though it's
  // still on disk — not kept, marked missing, as a file a share lost would be.
  tone('Later/take.mp3', 'title=Take 2', 'artist=Nobody', 'album=Raw')
  await scanLibrary(lib.id)
  assert.equal(await prisma.mediaItem.count({ where: { path: { contains: 'Later' } } }), 1)
  fs.writeFileSync(put('Later/.plexignore'), '*\n')
  await scanLibrary(lib.id)
  assert.equal(await prisma.mediaItem.count({ where: { path: { contains: 'Later' } } }), 0)
  assert.equal(getScanStatus().removed, 1)
})

test('an upgrade queues each Music library to be scanned once', async () => {
  await prisma.setting.deleteMany({ where: { key: { in: ['musicRules', 'rescanLibraries'] } } })
  await reparseAfterUpgrade()
  assert.equal((await prisma.setting.findUnique({ where: { key: 'rescanLibraries' } }))?.value, String(lib.id))
  await prisma.setting.delete({ where: { key: 'rescanLibraries' } })
  await reparseAfterUpgrade()
  assert.equal(await prisma.setting.findUnique({ where: { key: 'rescanLibraries' } }), null, 'only once')
})

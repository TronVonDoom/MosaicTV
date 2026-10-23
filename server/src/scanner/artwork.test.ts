// Logo files beside the media: Kodi's clearlogo.png and Jellyfin's logo.png,
// a movie's own named for it first; only formats that can be see-through.
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectArtwork } from './artwork.js'
import { logoToken } from '../metadata/logo.js'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaictv-art-'))
test.after(() => fs.rmSync(root, { recursive: true, force: true }))
const put = (rel: string) => {
  const f = path.join(root, rel)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, '')
  return f
}

test('a movie’s logo: its own named one, ahead of the folder’s', async () => {
  const film = put('movies/Heat (1995)/Heat (1995).mkv')
  put('movies/Heat (1995)/logo.png')
  put('movies/Heat (1995)/Heat (1995)-clearlogo.png')
  const art = await detectArtwork(film, path.join(root, 'movies'), 'movie', null, new Map())
  assert.equal(art.logoPath, path.join(root, 'movies/Heat (1995)/Heat (1995)-clearlogo.png'))
})

test('a show’s logo is its folder’s clearlogo or logo — never a JPEG', async () => {
  const ep = put('tv/Rugrats/Season 01/Rugrats - S01E01.mkv')
  put('tv/Rugrats/logo.jpg')
  const lib = path.join(root, 'tv')
  assert.equal((await detectArtwork(ep, lib, 'tv', 1, new Map())).logoPath, null, 'a JPEG can’t be see-through')
  put('tv/Rugrats/Logo.PNG')
  assert.equal((await detectArtwork(ep, lib, 'tv', 1, new Map())).logoPath, path.join(root, 'tv/Rugrats/Logo.PNG'), 'any case')
  put('tv/Rugrats/clearlogo.webp')
  assert.equal((await detectArtwork(ep, lib, 'tv', 1, new Map())).logoPath, path.join(root, 'tv/Rugrats/clearlogo.webp'), 'Kodi’s name first')
})

test('a logo’s token: the file’s first, then the online one’s; none without either', () => {
  assert.equal(logoToken(null, null), null)
  assert.equal(logoToken('/media/x/logo.jpg', null), null, 'a JPEG file is not a logo')
  const online = logoToken(null, '/abc.png')
  assert.match(online!, /^[0-9a-f]{10}$/)
  assert.notEqual(logoToken('/media/x/logo.png', '/abc.png'), online, 'the file wins')
  assert.equal(logoToken('/media/x/logo.jpg', '/abc.png'), online)
})

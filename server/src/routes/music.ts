import { Router, type Request, type Response } from 'express'
import type { Stored, TitleOnAir } from '../contract/index.js'
import { albumCards, artistCards, artistDetail, asAlbumSort } from '../music.js'
import { titleOnAir } from '../schedule/onAir.js'

// A Music or Music Videos library by artist and album (see music.ts).
export const musicRouter = Router()

const libraryOf = (req: Request, res: Response): number | null => {
  const id = Number(req.query.libraryId)
  if (!req.query.libraryId || Number.isNaN(id)) {
    res.status(400).json({ error: 'libraryId query param is required' })
    return null
  }
  return id
}
// '' is music that names no artist.
const artistOf = (req: Request) => (typeof req.query.artist === 'string' ? req.query.artist : '')

// GET /api/music/artists?libraryId=  -> every artist, A–Z
musicRouter.get('/artists', async (req, res) => {
  const libraryId = libraryOf(req, res)
  if (libraryId == null) return
  res.json({ artists: await artistCards(libraryId) })
})

// GET /api/music/albums?libraryId=&sort=title|artist|year|added  -> every album
musicRouter.get('/albums', async (req, res) => {
  const libraryId = libraryOf(req, res)
  if (libraryId == null) return
  res.json({ albums: await albumCards(libraryId, asAlbumSort(req.query.sort)) })
})

// GET /api/music/artist?libraryId=&artist=  -> their albums, each with its songs or videos
musicRouter.get('/artist', async (req, res) => {
  const libraryId = libraryOf(req, res)
  if (libraryId == null) return
  const detail = await artistDetail(libraryId, artistOf(req))
  if (!detail) return res.status(404).json({ error: 'No music by that artist in this library' })
  res.json(detail)
})

// GET /api/music/artist/on-air?libraryId=&artist=  -> the channels that bring
// their music in, its airings now and next, and when it was last on.
musicRouter.get('/artist/on-air', async (req, res) => {
  const libraryId = libraryOf(req, res)
  if (libraryId == null) return
  res.json((await titleOnAir({ kind: 'artist', libraryId, artist: artistOf(req) })) satisfies Stored<TitleOnAir>)
})

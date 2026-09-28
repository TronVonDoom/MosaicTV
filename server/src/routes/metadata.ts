import { Router, type Response } from 'express'
import { prisma } from '../db.js'
import { enrichLibrary, getMetadataStatus, isEnriching, MatchError } from '../metadata.js'
import { getMovie, getTmdbKey, getTv, movieCandidate, resolveRef, searchMovies, searchShows, tvCandidate } from '../tmdb.js'
import { parseExternalRef, type MatchCandidate } from '../contract/index.js'

export const metadataRouter = Router()

metadataRouter.get('/status', (_req, res) => {
  res.json(getMetadataStatus())
})

// GET /api/metadata/search?kind=movie|tv&q=&year=  -> what Fix match offers:
// TMDB's titles for a title (and year), or the one title a TMDB, IMDb or
// TheTVDB id or link names.
metadataRouter.get('/search', async (req, res) => {
  const key = await getTmdbKey()
  if (!key) return res.status(400).json({ error: 'No TMDB API key configured. Add one under Settings.' })
  const kind = req.query.kind === 'tv' ? 'tv' : 'movie'
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!q) return res.status(400).json({ error: 'Type a title to search for.' })
  const y = Number(req.query.year)
  const year = Number.isInteger(y) && y > 1800 && y < 3000 ? y : null

  const ref = parseExternalRef(q)
  let results: MatchCandidate[] = []
  if (ref) {
    const id = await resolveRef(key, ref, kind)
    const found =
      id == null
        ? null
        : kind === 'movie'
          ? await getMovie(key, id).then((m) => m && movieCandidate(m))
          : await getTv(key, id).then((t) => t && tvCandidate(t))
    if (found) results = [found]
  } else {
    results = (kind === 'movie' ? await searchMovies(key, q, year) : await searchShows(key, q, year)).slice(0, 20)
  }
  res.json({ results })
})

// POST /api/metadata/:libraryId[?force=1] — look up what has no match, or
// (forced) everything: automatic matches again by title, hand-picked ones
// refreshed from their id. Neither touches what was unmatched by hand.
metadataRouter.post('/:libraryId', async (req, res) => {
  if (isEnriching()) {
    return res.status(409).json({ error: 'A metadata fetch is already running.' })
  }
  const libraryId = Number(req.params.libraryId)
  const lib = await prisma.library.findUnique({ where: { id: libraryId } })
  if (!lib) return res.status(404).json({ error: 'Library not found.' })
  if (!(await getTmdbKey())) return res.status(400).json({ error: 'No TMDB API key configured. Add one under Settings.' })
  const force = req.query.force === '1' || req.query.force === 'true'

  // Fire-and-forget; client polls GET /api/metadata/status.
  enrichLibrary(libraryId, force ? 'all' : 'missing').catch(() => {})
  res.status(202).json({ started: true, libraryId })
})

/** Answer Fix match, Unmatch or Refresh on one title: done, or why not. */
export async function answerMatch(res: Response, action: () => Promise<void>): Promise<void> {
  try {
    await action()
    res.json({ ok: true })
  } catch (e) {
    if (!(e instanceof MatchError)) throw e
    res.status(e.status).json({ error: e.message })
  }
}

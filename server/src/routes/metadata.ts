import { Router, type Response } from 'express'
import { prisma } from '../db.js'
import { enrichLibrary, getMetadataStatus, isEnriching, MatchError, nothingToRead } from '../metadata.js'
import { getMovie, getTmdbKey, getTv, movieCandidate, resolveRef, searchMovies, searchShows, tvCandidate } from '../tmdb.js'
import { getTvdbCreds, getTvdbMovie, getTvdbSeries, resolveTvdbRef, searchTvdb, tvdbCandidate } from '../tvdb.js'
import { asMatchSource, MATCH_SOURCE_NAMES, parseExternalRef, type MatchCandidate } from '../contract/index.js'

export const metadataRouter = Router()

metadataRouter.get('/status', (_req, res) => {
  res.json(getMetadataStatus())
})

// GET /api/metadata/search?source=tmdb|tvdb&kind=movie|tv&q=&year=  -> what
// Fix match offers: one source's titles for a title (and year), or the one
// title a TMDB, TheTVDB or IMDb id or link names there.
metadataRouter.get('/search', async (req, res) => {
  const source = asMatchSource(req.query.source)
  const kind = req.query.kind === 'tv' ? 'tv' : 'movie'
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!q) return res.status(400).json({ error: 'Type a title to search for.' })
  const y = Number(req.query.year)
  const year = Number.isInteger(y) && y > 1800 && y < 3000 ? y : null
  const ref = parseExternalRef(q)
  const noKey = () => res.status(400).json({ error: `No ${MATCH_SOURCE_NAMES[source]} key configured. Add one under Settings.` })

  if (source === 'tvdb') {
    const creds = await getTvdbCreds()
    if (!creds) return noKey()
    if (ref) {
      const id = await resolveTvdbRef(creds, ref, kind)
      const found = id == null ? null : kind === 'movie' ? await getTvdbMovie(creds, id) : await getTvdbSeries(creds, id)
      return res.json({ results: found ? [tvdbCandidate(found, kind)] : [] })
    }
    const results = await searchTvdb(creds, kind, q, year)
    if (!results) return res.status(502).json({ error: 'TheTVDB didn’t answer — try again in a moment.' })
    return res.json({ results: results.slice(0, 20) })
  }

  const key = await getTmdbKey()
  if (!key) return noKey()
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

// POST /api/metadata/:libraryId[?force=1] — read what no source has a match
// for, or (forced) everything, from the library's sources: automatic matches
// looked up again, hand-picked ones refreshed from their id. What was
// unmatched by hand reads only the library's other sources.
metadataRouter.post('/:libraryId', async (req, res) => {
  if (isEnriching()) {
    return res.status(409).json({ error: 'A metadata fetch is already running.' })
  }
  const libraryId = Number(req.params.libraryId)
  const lib = await prisma.library.findUnique({ where: { id: libraryId } })
  if (!lib) return res.status(404).json({ error: 'Library not found.' })
  const why = await nothingToRead(libraryId)
  if (why) return res.status(400).json({ error: why })
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

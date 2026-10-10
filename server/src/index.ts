import express from 'express'
import compression from 'compression'
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { prisma, initDb } from './db.js'
import { hlsDir, inMemory } from './paths.js'
import { log } from './logs.js'
import { warmFiller } from './streaming/filler.js'
import { warmCapabilities } from './streaming/capabilities.js'
import { startMetrics } from './metrics.js'
import { startGuideKeeper } from './schedule/guideKeeper.js'
import { startActBreakFinder } from './schedule/actBreakFinder.js'
import { allSegmenterViewers, resetSegments } from './streaming/segmenter.js'
import { serving, shutdown } from './lifecycle.js'
import { applyPendingRestore } from './restore.js'
import { eventStream, watch } from './events.js'
import { migrateDatabase } from './dbMigrate.js'
import { replanIfTimezoneChanged } from './schedule/scheduleChanges.js'
import { seedDefaultAudio, seedDefaultLogo } from './seedDefaults.js'
import { reparseAfterUpgrade, rescanAfterUpgrade, tagExtras } from './scanner/scanner.js'
import { librariesRouter } from './routes/libraries.js'
import { sourcesRouter } from './routes/sources.js'
import { mediaRouter } from './routes/media.js'
import { scanRouter } from './routes/scan.js'
import { showsRouter } from './routes/shows.js'
import { musicRouter } from './routes/music.js'
import { airingsRouter } from './routes/airings.js'
import { fsRouter } from './routes/fs.js'
import { artworkRouter } from './routes/artwork.js'
import { settingsRouter } from './routes/settings.js'
import { metadataRouter } from './routes/metadata.js'
import { collectionsRouter } from './routes/collections.js'
import { channelsRouter } from './routes/channels.js'
import { iptvRouter } from './routes/iptv.js'
import { activityItems, activityRouter } from './routes/activity.js'
import { hdhrRouter } from './routes/hdhr.js'
import { logosRouter } from './routes/logos.js'
import { logsRouter } from './routes/logs.js'
import { metricsRouter } from './routes/metrics.js'
import { adminRouter } from './routes/admin.js'
import { assetsRouter } from './routes/assets.js'
import { profilesRouter } from './routes/profiles.js'
import { fillersRouter } from './routes/fillers.js'
import { apiErrorHandler, catchAsyncErrors } from './asyncRoutes.js'
import { VERSION } from './version.js'

const app = express()
const PORT = Number(process.env.PORT ?? 8688)
const startedAt = Date.now()

app.use(express.json({ limit: '10mb' })) // logo uploads arrive as base64 data URLs

// Gzip what the web app reads — a big library's lists and a show's page are
// hundreds of KB of JSON that shrink about tenfold — and the app's own files.
// Never the live updates (a held-open stream that must reach the page as each
// event is written), anything under /iptv, or the tuner's discovery files:
// what players and Plex read is left exactly as it was. Pictures, video and
// the backup are already compressed, and the default filter passes them by.
const TUNER_FILES = new Set(['/discover.json', '/lineup.json', '/lineup_status.json'])
app.use(
  compression({
    filter: (req, res) =>
      req.path !== '/api/events' && !req.path.startsWith('/iptv') && !TUNER_FILES.has(req.path) && compression.filter(req, res),
  }),
)

// --- ffmpeg detection -------------------------------------------------------
let ffmpegAvailable = false
function checkFfmpeg(): Promise<void> {
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version'])
    proc.on('error', () => {
      ffmpegAvailable = false
      resolve()
    })
    proc.on('close', (code) => {
      ffmpegAvailable = code === 0
      resolve()
    })
  })
}

// --- API --------------------------------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: VERSION,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    node: process.version,
    ffmpeg: ffmpegAvailable,
    segments: { dir: hlsDir(), inMemory: inMemory(hlsDir()) },
  })
})

app.get('/api/stats', async (_req, res) => {
  const [libraries, items, missing, grouped, durationAgg] = await Promise.all([
    prisma.library.count(),
    prisma.mediaItem.count({ where: { missing: false } }),
    prisma.mediaItem.count({ where: { missing: true } }),
    prisma.mediaItem.groupBy({
      by: ['type'],
      where: { missing: false },
      _count: { _all: true },
    }),
    prisma.mediaItem.aggregate({
      where: { missing: false },
      _sum: { durationSec: true },
    }),
  ])
  const byType: Record<string, number> = {}
  for (const g of grouped) byType[g.type] = g._count._all
  res.json({
    libraries,
    items,
    missing,
    byType,
    totalDurationSec: durationAgg._sum.durationSec ?? 0,
  })
})

// Live updates for the web app (see events.ts).
app.get('/api/events', eventStream)

app.use('/api/libraries', librariesRouter)
app.use('/api/sources', sourcesRouter)
app.use('/api/media', mediaRouter)
app.use('/api/scan', scanRouter)
app.use('/api/shows', showsRouter)
app.use('/api/music', musicRouter)
app.use('/api/airings', airingsRouter)
app.use('/api/fs', fsRouter)
app.use('/api/artwork', artworkRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/metadata', metadataRouter)
app.use('/api/collections', collectionsRouter)
app.use('/api/channels', channelsRouter)
app.use('/api/logos', logosRouter)
app.use('/api/logs', logsRouter)
app.use('/api/metrics', metricsRouter)
app.use('/api/admin', adminRouter)
app.use('/api/assets', assetsRouter)
app.use('/api/profiles', profilesRouter)
app.use('/api/fillers', fillersRouter)
app.use('/api/activity', activityRouter)
app.use('/iptv', iptvRouter)
// HDHomeRun emulation lives at root — Plex/Emby's tuner discovery expects
// /discover.json etc. there, not namespaced under /iptv.
app.use('/', hdhrRouter)

// --- Static frontend (production only) --------------------------------------
const publicDir = path.join(process.cwd(), 'public')
const assetsDir = path.join(publicDir, 'assets')
if (fs.existsSync(publicDir)) {
  app.use(
    express.static(publicDir, {
      // The build names its scripts, styles and fonts by their content
      // (assets/index-3f9a1c.js), so a name never changes what it holds: the
      // browser keeps them for good rather than asking again on every load.
      // index.html, which names them, is asked about each time.
      setHeaders: (res, file) => {
        if (path.dirname(file) === assetsDir) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      },
    }),
  )
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(publicDir, 'index.html'))
  })
}

// An async handler that throws must answer 500, not take the process down —
// see asyncRoutes.ts. Wrapped after every route above is registered.
catchAsyncErrors((app as unknown as { _router?: { stack: Parameters<typeof catchAsyncErrors>[0] } })._router?.stack)
app.use(apiErrorHandler)

// Background work (builds, sweeps, probes) that rejects without a catch is a
// bug to log, not a reason to drop every viewer's stream.
process.on('unhandledRejection', (reason) => {
  log('error', 'system', 'Unhandled promise rejection', String((reason as Error)?.stack || reason))
})

// --- Shutdown ---------------------------------------------------------------
// Docker's stop, and Ctrl+C in a terminal: see lifecycle.ts.
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

// --- Boot -------------------------------------------------------------------
async function boot(): Promise<void> {
  // A backup waiting to be restored goes in before anything opens the database
  // (see restore.ts); then schema first: nothing may query a database its code
  // doesn't match yet — a backup from an older version included.
  await applyPendingRestore()
  await migrateDatabase()
  await initDb()
  await replanIfTimezoneChanged().catch((e) => log('error', 'playout', 'Timezone check failed', String(e?.stack || e)))
  await seedDefaultAudio().catch((e) => log('error', 'system', 'Default audio seed failed', String(e?.stack || e)))
  await seedDefaultLogo().catch((e) => log('error', 'system', 'Adding the MosaicTV logo failed', String(e?.stack || e)))
  await tagExtras().catch((e) => log('error', 'system', 'Telling extras apart failed', String(e?.stack || e)))
  await reparseAfterUpgrade().catch((e) => log('error', 'system', 'Queueing the upgrade’s rescan failed', String(e?.stack || e)))
  // In the background: a library's scan can take a while.
  rescanAfterUpgrade().catch((e) => log('error', 'system', 'Scanning libraries after the upgrade failed', String(e?.stack || e)))
  resetSegments() // clear any stale segmenter output from a previous run
  const ram = inMemory(hlsDir())
  log('info', 'system', `Live segments are written to ${hlsDir()}${ram ? ', in memory' : ram === false ? ', on disk' : ''}`)
  // What open pages hear about without asking (only checked while one is open).
  watch(1000, activityItems, { type: 'activity' })
  watch(3000, allSegmenterViewers, { type: 'viewers' })
  watch(
    5000,
    async () => {
      const now = new Date()
      const onAir = await prisma.playoutItem.findMany({
        where: { startTime: { lte: now }, stopTime: { gt: now } },
        select: { id: true },
        orderBy: { id: 'asc' },
      })
      return onAir.map((it) => it.id)
    },
    { type: 'onAir' },
  )
  const metricSource = startMetrics()
  startGuideKeeper() // keep every channel's guide built out, watched or not
  startActBreakFinder() // find act breaks for the channels that break inside programs
  await checkFfmpeg()
  const server = app.listen(PORT, () => {
    console.log(`MosaicTV v${VERSION} listening on http://0.0.0.0:${PORT}`)
    console.log(`ffmpeg available: ${ffmpegAvailable}`)
    log('info', 'system', `MosaicTV v${VERSION} started — ffmpeg ${ffmpegAvailable ? 'available' : 'NOT available'}`)
    // Say which scope the resource graph is measuring: 'process' means we
    // couldn't find a cgroup and the numbers exclude ffmpeg entirely.
    log(
      metricSource === 'cgroup2' || metricSource === 'cgroup1' ? 'info' : 'warn',
      'system',
      `Resource sampling via ${metricSource}${metricSource === 'process' ? ' — container totals unavailable, ffmpeg load NOT counted' : ''}`,
    )
  })
  serving(server)
  // Build every channel's idents in the background so no break waits on a
  // render, and run the ffmpeg capability probes now so no
  // viewer ever pays for one mid-stream at a program boundary.
  if (ffmpegAvailable) {
    warmFiller().catch(() => {})
    warmCapabilities().catch((e) => log('warn', 'ffmpeg', 'Capability warm-up failed', String(e)))
  }
}

boot().catch((e) => {
  const msg = String((e as Error)?.stack || e)
  log('error', 'system', 'MosaicTV could not start', msg)
  console.error(`MosaicTV could not start:
${msg}`)
  process.exit(1)
})

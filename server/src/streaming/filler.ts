// Idents — what a channel airs during a break (a Filler row): the on-disk
// cache that keeps a break from ever waiting on generation, resolution of an
// ident to a playable clip, which ident a break airs, and the editor's
// previews. The generated looks themselves (frosted glass, mosaic, and the
// retired ones) are drawn in identStyles.ts.

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { prisma } from '../db.js'
import { assetsDir, dataDir, logosDir, previewsDir } from '../paths.js'
import { log } from '../logs.js'
import { runFfmpeg, type ProgressCb } from './run.js'
import { localLogo, logoFileById, logoFor } from './logo.js'
import { reelClips } from './reel.js'
import { resolveProfile } from './profile.js'
import {
  BRANDED,
  FPS,
  LOOP_SEC,
  animatedBuild,
  assembleStill,
  assembleVideo,
  buildStyle,
  loopSecFor,
  toneInput,
  videoInputCount,
  type Dims,
  type StyleBuild,
} from './identStyles.js'

export type { ProgressCb, Dims }

// Nominal 16:9 canvas. The stream reports these as the filler's source dims for
// its aspect-relative watermark math (see channel.ts) regardless of the actual
// render resolution — every option below is 16:9, so the aspect is unchanged.
export const FILLER_W = 1280
export const FILLER_H = 720

// Pixel dimensions per resolution choice. Playback scales the clip to the
// channel profile, so a higher source is only about staying crisp — 1080p keeps
// a filler sharp on a Full-HD channel where a 720p clip would upscale and soften.
const RESOLUTIONS: Record<string, Dims> = {
  '720p': { w: 1280, h: 720 },
  '1080p': { w: 1920, h: 1080 },
  '1440p': { w: 2560, h: 1440 },
}

/**
 * A filler's render size. "auto" matches the channel it airs on: the smallest
 * size at least as tall as the channel's picture (1440p at most), so a 720p
 * channel doesn't pay for a 1080p render it scales straight back down.
 * `channelHeight` is unknown only for a preview with no channel to go by.
 */
export function dimsFor(resolution: string | null | undefined, channelHeight?: number): Dims {
  if (resolution !== 'auto') return RESOLUTIONS[resolution ?? ''] ?? RESOLUTIONS['1080p']
  if (!channelHeight) return RESOLUTIONS['1080p']
  return Object.values(RESOLUTIONS).find((d) => d.h >= channelHeight) ?? RESOLUTIONS['1440p']
}

const clampScale = (s: number) => Math.max(0.4, Math.min(2, Number.isFinite(s) ? s : 1))

// ---- Bundled brand mark -----------------------------------------------------

// MosaicTV brand mark used in frosted/mosaic. Only present when
// process.cwd()/public exists (production, or local dev after copying the built
// frontend there) — undefined in plain local dev, in which case callers skip
// those styles instead of handing ffmpeg a missing file.
function mosaictvLogoFile(): string | undefined {
  const wide = path.join(process.cwd(), 'public', 'logo-wide.png')
  if (fs.existsSync(wide)) return wide
  const icon = path.join(process.cwd(), 'public', 'mosaictv-icon.png')
  return fs.existsSync(icon) ? icon : undefined
}


// ---- On-disk cache ----------------------------------------------------------

// Bump a style's version when its generator changes, so clips already on disk
// are rebuilt (and the old ones swept away, see sweepUnused).
const STYLE_VERSION: Record<string, number> = { animated: 6, frosted: 10 }
const THEME_VERSION = 3 // every other style

// Resolve an Asset id to its on-disk file (or undefined).
async function assetFilePath(id: number | null | undefined): Promise<string | undefined> {
  if (id == null) return undefined
  const a = await prisma.asset.findUnique({ where: { id } })
  if (!a) return undefined
  const f = path.join(assetsDir(), a.filename)
  return fs.existsSync(f) ? f : undefined
}

// Cache-busting fingerprint for a file (path + mtime).
function fileKey(f?: string): string {
  if (!f) return ''
  try {
    return `${f}:${Math.round(fs.statSync(f).mtimeMs)}`
  } catch {
    return f
  }
}

const dimKey = (d: Dims) => `${d.w}x${d.h}`

// Cache filename for a generated clip. The filler id is baked into the name so
// every version a filler produces (one per branding logo, resolution…) can be
// swept in one go when the filler is edited or deleted. A station ident with no
// filler row behind it (a channel's fallback, see ensureStationIdent) uses id 0.
function cacheName(style: string, fillerId: number, keyParts: string): string {
  const hash = createHash('md5').update(keyParts).digest('hex')
  return path.join(dataDir(), `filler-${style}-f${fillerId}-${hash}.mp4`)
}

// A generated clip in the data dir — never a render in progress, whose temp
// file ends .tmp.mp4.
const CLIP_FILE = /^filler-[a-z]+-f\d+-[0-9a-f]{32}\.mp4$/

/**
 * One generated clip: where it lives, and how to build it. `key` is everything
 * that decides the picture (the file name is its hash); `title` and
 * `channelId` name it for Activity.
 */
type ClipPlan = { out: string; key: string; loop: number; build: StyleBuild; label: string; title?: string; channelId?: number | null }

/**
 * Plan the clip for a generated style, or null when the style can't be drawn
 * here (a logo style with no logo, or frosted/mosaic without the bundled
 * MosaicTV mark). Everything that changes the picture is in the file name, so
 * a clip on disk is always the right one for its inputs.
 */
function planClip(style: string, fillerId: number, logoFile: string | undefined, dims: Dims, scale = 1, divider = false): ClipPlan | null {
  const s = clampScale(scale)
  const loop = loopSecFor(style, dims)
  const build = buildStyle(style, dims, loop, s, logoFile, mosaictvLogoFile(), divider)
  if (!build) return null
  const brand = BRANDED.has(style) ? `${fileKey(logoFile)}:${s}` : ''
  const key = `${brand}:${style === 'frosted' && divider ? 'div' : ''}:${dimKey(dims)}:v${STYLE_VERSION[style] ?? THEME_VERSION}`
  const label = `${style} filler (${dimKey(dims)}${BRANDED.has(style) && logoFile ? `, ${path.basename(logoFile)}` : ''})`
  return { out: cacheName(style, fillerId, key), key: `${style}:${key}`, loop, build, label }
}

// ---- Rendering --------------------------------------------------------------
// One render at a time, at low priority: a render is a batch job, and the
// channels encoding live come first. Asking for a clip that's already being
// built joins that render instead of starting a second copy of it.

type Render = {
  promise: Promise<string | undefined>
  listeners: Set<ProgressCb>
  title: string
  channelId: number | null
  percent: number
  startedAt: number
}
const renders = new Map<string, Render>()

// Builds that finished lately, so Activity can say how they went.
type Built = { title: string; channelId: number | null; startedAt: number; finishedAt: number; error?: string }
const finished: Built[] = []
const FINISHED_KEEP_MS = 10 * 60_000

/** Background builds, running and recently finished — for Activity. */
export function identBuilds(): { running: { title: string; channelId: number | null; percent: number; startedAt: number }[]; finished: Built[] } {
  const now = Date.now()
  while (finished.length && now - finished[0].finishedAt > FINISHED_KEEP_MS) finished.shift()
  return {
    running: [...renders.values()].filter((r) => r.startedAt > 0).map((r) => ({ title: r.title, channelId: r.channelId, percent: r.percent, startedAt: r.startedAt })),
    finished: [...finished],
  }
}
let renderQueue: Promise<unknown> = Promise.resolve()

// A render that just failed isn't retried on every break that asks for it.
const failedAt = new Map<string, number>()
const RETRY_FAILED_MS = 10 * 60_000

function render(plan: ClipPlan, onProgress?: ProgressCb): Promise<string | undefined> {
  let r = renders.get(plan.out)
  if (!r) {
    const listeners = new Set<ProgressCb>()
    const title = plan.title ?? `the ${plan.label}`
    const channelId = plan.channelId ?? null
    const run = async (): Promise<string | undefined> => {
      if (fs.existsSync(plan.out)) return plan.out // built while this waited its turn
      log('info', 'system', `Generating the ${plan.label}…`)
      // Written under a temp name and renamed once complete, so the clip never
      // exists half-written for a break to pick up.
      const tmp = `${plan.out}.${process.pid}.${Date.now()}.tmp.mp4`
      const self = renders.get(plan.out)
      if (self) self.startedAt = Date.now()
      try {
        const progress = (pct: number) => {
          if (self) self.percent = pct
          listeners.forEach((l) => l(pct))
        }
        await runFfmpeg(assembleVideo(plan.build, plan.loop, tmp), progress, plan.loop, { background: true })
        fs.renameSync(tmp, plan.out)
        failedAt.delete(plan.out)
        finished.push({ title, channelId, startedAt: self?.startedAt ?? Date.now(), finishedAt: Date.now() })
        return plan.out
      } catch (e) {
        failedAt.set(plan.out, Date.now())
        log('warn', 'system', `Couldn't generate the ${plan.label}`, String(e))
        finished.push({ title, channelId, startedAt: self?.startedAt ?? Date.now(), finishedAt: Date.now(), error: 'The build failed — see Logs' })
        return undefined
      } finally {
        fs.rmSync(tmp, { force: true }) // no-op once renamed
      }
    }
    // Registered before the queue can run it, so the run finds itself.
    r = { promise: Promise.resolve(undefined), listeners, title, channelId, percent: 0, startedAt: 0 }
    renders.set(plan.out, r)
    const promise = renderQueue.then(run, run).finally(() => renders.delete(plan.out))
    renderQueue = promise.catch(() => {})
    r.promise = promise
  }
  if (onProgress) r.listeners.add(onProgress)
  return r.promise
}

type GetOpts = {
  /** false: don't wait for a render — start it and come back empty-handed. */
  wait?: boolean
  /** false: only a clip that's already built; never start a render. */
  build?: boolean
  onProgress?: ProgressCb
}

/**
 * A planned clip's file. Built already → its path. Otherwise the render starts
 * (or joins the one in progress) and this waits for it — or, with
 * `wait: false`, returns undefined straight away so the clip is ready for a
 * later break. That's also the case that doesn't retry a render which just
 * failed: it's asked on every break.
 */
async function obtain(plan: ClipPlan, opts: GetOpts = {}): Promise<string | undefined> {
  if (fs.existsSync(plan.out)) return plan.out
  if (opts.build === false) return undefined
  if (opts.wait === false) {
    const failed = failedAt.get(plan.out)
    if (!failed || Date.now() - failed > RETRY_FAILED_MS) render(plan).catch(() => {})
    return undefined
  }
  return render(plan, opts.onProgress)
}

/** The plain animated clip: the last resort when nothing else is built. */
export function ensureAnimatedFiller(opts: GetOpts = {}): Promise<string | undefined> {
  const plan = planClip('animated', 0, undefined, RESOLUTIONS['1080p'])!
  plan.title = 'the built-in ident'
  return obtain(plan, opts)
}

/**
 * Mosaic from a logo, at the channel's size — the safety net a break
 * falls back to when its idents can't be played (a channel always has some;
 * this is for a render that failed or a channel caught mid-edit). Undefined
 * without the bundled MosaicTV mark (plain local dev only).
 */
export async function ensureStationIdent(logoFile: string, channelHeight?: number, opts: GetOpts = {}): Promise<string | undefined> {
  const plan = planClip('mosaic', 0, logoFile, dimsFor('auto', channelHeight))
  if (plan) plan.title = `the built-in ident for the ${path.parse(logoFile).name} logo`
  return plan ? obtain(plan, opts) : undefined
}

// Remove every cached clip a filler produced (all its logo and resolution
// versions), keyed by the id baked into the file names. Called when a filler
// is deleted or restyled, so its old look is gone at once.
export function removeFillerCache(fillerId: number): void {
  if (!fillerId) return
  try {
    const dir = dataDir()
    for (const f of fs.readdirSync(dir)) {
      if (!CLIP_FILE.test(f) || !f.includes(`-f${fillerId}-`)) continue
      fs.rmSync(path.join(dir, f), { force: true })
      failedAt.delete(path.join(dir, f))
    }
  } catch {
    /* best-effort */
  }
}

// ---- Resolution -------------------------------------------------------------

type FillerRow = {
  id: number
  channelId?: number | null
  name?: string | null
  style: string
  assetId: number | null
  audioAssetId: number | null
  logoId: number | null
  logoScale: number
  divider: boolean
}

export type FillerClip = { clip?: string; music?: string }

const identName = (f: FillerRow) => f.name?.trim() || `${f.style} ident`

/**
 * The generated look an ident is drawn in. A break reel airs its clips, and the
 * part of a break they don't fill (and any stand-in or thumbnail it needs) is
 * the default look, Mosaic. Spotlight was replaced by Mosaic (an upgrade moves
 * its idents over; this covers one made since on an older version).
 */
const lookOf = (style: string): string => (style === 'reel' || style === 'spotlight' ? 'mosaic' : style)

/** A clip to show for a reel on its own: its first. */
async function reelCover(f: FillerRow): Promise<string | undefined> {
  if (f.style !== 'reel' || !f.id) return undefined
  const first = (await reelClips(f.id))[0]
  return first && fs.existsSync(first.path) ? first.path : undefined
}

/**
 * What an ident airs as for a given logo and channel size: its upload (a custom
 * clip), or the generated clip it's built into. A pinned logo (`logoId`) wins
 * over `logoFile`, the logo on air where the break falls. `plan` is null when
 * the style can't be drawn here (see planClip).
 */
async function planFor(f: FillerRow, logoFile: string | undefined, channelHeight?: number): Promise<{ upload?: string; plan: ClipPlan | null; dims: Dims }> {
  const dims = dimsFor('auto', channelHeight)
  if (f.style === 'custom') {
    const upload = await assetFilePath(f.assetId)
    if (upload) return { upload, plan: null, dims }
    return { plan: null, dims }
  }
  if (f.logoId != null) logoFile = (await logoFileById(f.logoId, null)) ?? logoFile
  const plan = planClip(lookOf(f.style), f.id, logoFile, dims, f.logoScale, f.divider)
  if (plan) {
    plan.title = `“${identName(f)}”`
    plan.channelId = f.channelId ?? null
  }
  return { plan, dims }
}

/**
 * Resolve an ident to its clip and music. The music (if any) isn't in the clip:
 * it's laid over the break as it airs, from the top, so a song plays straight
 * through however many times the clip loops (and changing it rebuilds nothing).
 * A custom ident's clip is its upload; a generated one is built for this logo
 * and size, falling back to the animated look if its style can't be built.
 *
 * `logoFile` is the logo on air where the break falls; an ident that pins its
 * own logo (`logoId`) uses that everywhere instead. `channelHeight` sizes it.
 * With `wait: false` a clip that isn't built yet comes back missing (and starts
 * building) rather than holding the caller up; with `build: false` it just
 * comes back missing.
 */
export async function resolveFillerClip(
  f: FillerRow,
  logoFile: string | undefined,
  opts: GetOpts & { channelHeight?: number } = {},
): Promise<FillerClip> {
  const music = await assetFilePath(f.audioAssetId)
  const { upload, plan, dims } = await planFor(f, logoFile, opts.channelHeight)
  if (upload) return { clip: upload, music }
  const clip = plan ? await obtain(plan, opts) : undefined
  if (clip || (plan && (opts.wait === false || opts.build === false))) return { clip, music }
  // The style can't be drawn here or its render failed — or it's a custom
  // ident whose upload is gone: the animated look instead.
  return { clip: await obtain(planClip('animated', f.id, undefined, dims)!, opts), music }
}

/** An ident's generated look, falling back to the animated one it airs as when its style can't be drawn. */
function buildFor(f: FillerRow, logoFile: string | undefined, dims: Dims): { build: StyleBuild; loop: number } {
  const style = f.style === 'custom' ? 'animated' : lookOf(f.style)
  const loop = loopSecFor(style, dims)
  const build = buildStyle(style, dims, loop, clampScale(f.logoScale), logoFile, mosaictvLogoFile(), f.divider)
  return build ? { build, loop } : { build: animatedBuild(dims, LOOP_SEC), loop: LOOP_SEC }
}

/** Where an ident is being previewed: its channel, and optionally the logo to show (a block's). */
export type IdentContext = { channelId: number; logoId?: number | null }

// The logo and channel size for a preview: the ident's pinned logo, else the
// one asked for (the logo of a block it plays in), else the channel's own.
async function previewSetting(ctx: IdentContext): Promise<{ logoFile?: string; channelHeight?: number }> {
  const ch = await prisma.channel.findUnique({ where: { id: ctx.channelId }, include: { profile: true } })
  if (!ch) return { logoFile: await localLogo(null) }
  const logoFile =
    ctx.logoId != null ? await logoFileById(ctx.logoId, null) : await localLogo(logoFor(ch, null, await logoPaths()).raw)
  return { logoFile, channelHeight: resolveProfile(ch.profile).height }
}

const previewFile = (ext: string) =>
  path.join(previewsDir(), `preview-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`)

// Stills already drawn, by what's in the picture — the ident list and the
// editor's Look cards ask for the same few over and over.
const stills = new Map<string, Promise<string>>()

/**
 * A still of an ident as it airs (a 720p JPEG in the previews dir, kept: the
 * caller sends it, and the next ask for the same picture gets the same file) —
 * the thumbnails on the Breaks tab and the editor's Look cards. Uses the exact
 * graph the full clip would; a custom clip gives a frame of its upload.
 */
export async function renderIdentStill(f: FillerRow, ctx: IdentContext): Promise<string> {
  let { logoFile } = await previewSetting(ctx)
  if (f.logoId != null) logoFile = (await logoFileById(f.logoId, null)) ?? logoFile
  const upload = f.style === 'custom' ? await assetFilePath(f.assetId) : await reelCover(f)
  // A thumbnail needn't be sharper than 720p, however big the channel.
  const dims = dimsFor('720p')
  const plan = upload ? null : planClip(f.style === 'custom' ? 'animated' : lookOf(f.style), 0, logoFile, dims, f.logoScale, f.divider)
  const key = upload ? `upload:${fileKey(upload)}` : (plan?.key ?? `animated:${dimKey(dims)}`)
  const out = path.join(previewsDir(), `still-${createHash('md5').update(key).digest('hex')}.jpg`)
  let job = stills.get(out)
  if (!job || !fs.existsSync(out)) {
    job = (async () => {
      const tmp = `${out}.${Date.now()}.tmp.jpg`
      try {
        if (upload) await runFfmpeg(['-y', '-ss', '1', '-i', upload, '-frames:v', '1', '-update', '1', '-q:v', '3', tmp])
        else await runFfmpeg(assembleStill(buildFor(f, logoFile, dims).build, tmp))
        fs.renameSync(tmp, out)
        return out
      } finally {
        fs.rmSync(tmp, { force: true })
      }
    })()
    stills.set(out, job)
    job.catch(() => stills.delete(out))
  }
  return job
}

// How long the editor's preview runs, and how its sound comes and goes.
const PREVIEW_SEC = 6

/** A newer preview request replaced this one before it started. */
export class PreviewSuperseded extends Error {}
let previewSeq = 0
let previewChain: Promise<unknown> = Promise.resolve()

/**
 * The editor's preview: the first few seconds of an ident as it airs — its
 * real look (the same graph and loop as the full clip, so the motion matches),
 * the logo, and its music faded in and out — as an MP4 in the previews dir
 * (the caller sends and deletes it). Small and fast on purpose: 720p at the
 * fastest preset, a few seconds to render.
 *
 * It doesn't wait behind the background builds (a person is waiting on it),
 * but previews run one at a time, and one that's still waiting when a newer
 * request comes in is dropped (PreviewSuperseded).
 */
export function renderIdentPreview(f: FillerRow, ctx: IdentContext): Promise<string> {
  const mine = ++previewSeq
  const run = async (): Promise<string> => {
    if (mine !== previewSeq) throw new PreviewSuperseded()
    let { logoFile } = await previewSetting(ctx)
    if (f.logoId != null) logoFile = (await logoFileById(f.logoId, null)) ?? logoFile
    const music = f.style === 'reel' ? undefined : await assetFilePath(f.audioAssetId)
    const upload = f.style === 'custom' ? await assetFilePath(f.assetId) : await reelCover(f)
    const dims = dimsFor('720p')
    const out = previewFile('mp4')
    const fadeOut = `afade=t=out:st=${PREVIEW_SEC - 1.2}:d=1.2`
    const encode = ['-t', String(PREVIEW_SEC), '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-r', String(FPS), '-c:a', 'aac', '-ac', '2', '-ar', '48000', '-movflags', '+faststart', out]
    let args: string[]
    if (upload) {
      // The upload itself, scaled to fit; its own sound unless there's music.
      const scale = `scale=${dims.w}:${dims.h}:force_original_aspect_ratio=decrease,pad=${dims.w}:${dims.h}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p[v]`
      args = music
        ? ['-y', '-stream_loop', '-1', '-i', upload, '-stream_loop', '-1', '-i', music, '-filter_complex', `[0:v]${scale};[1:a]afade=t=in:d=0.5,${fadeOut}[a]`, '-map', '[v]', '-map', '[a]', ...encode]
        : ['-y', '-stream_loop', '-1', '-i', upload, '-filter_complex', `[0:v]${scale}`, '-map', '[v]', '-map', '0:a?', ...encode]
    } else {
      const { build, loop } = buildFor(f, logoFile, dims)
      const n = videoInputCount(build.inputs)
      const sound = music ? ['-stream_loop', '-1', '-i', music] : toneInput(loop, build.tone, build.vol)
      args = ['-y', ...build.inputs, ...sound, '-filter_complex', `${build.filter};[${n}:a]afade=t=in:d=0.5,${fadeOut}[a]`, '-map', '[v]', '-map', '[a]', ...encode]
    }
    try {
      await runFfmpeg(args)
    } catch (e) {
      fs.rmSync(out, { force: true })
      throw e
    }
    return out
  }
  const p = previewChain.then(run, run)
  previewChain = p.catch(() => {})
  return p
}

// ---- Which idents a break picks from ----------------------------------------

type Pooled<F> = { fillerAssignments: { filler: F }[] }

/**
 * The idents a break picks from, in the order they take turns: the active
 * block's own (idents playing "only during" it), else the channel's "everywhere
 * else" ones. `key` names the pool for taking turns (see fillerTurn). The one
 * rule the stream, the pre-build and the Breaks tab's status all use.
 */
export function poolFor<F extends { id: number; order: number }>(
  channel: { id: number } & Pooled<F>,
  block: ({ id: number } & Pooled<F>) | null,
): { pool: F[]; key: string; from: 'block' | 'channel' } {
  const sorted = (rows: { filler: F }[]) => rows.map((a) => a.filler).sort((a, b) => a.order - b.order || a.id - b.id)
  const own = block ? sorted(block.fillerAssignments) : []
  if (own.length > 0) return { pool: own, key: `${channel.id}:b${block!.id}`, from: 'block' }
  return { pool: sorted(channel.fillerAssignments), key: `${channel.id}:ch`, from: 'channel' }
}

// A channel with every relation poolFor and logoFor need, for the pre-build
// and the Breaks tab.
const CHANNEL_POOLS = {
  profile: true,
  fillerAssignments: { include: { filler: true } },
  timeBlocks: { include: { fillerAssignments: { include: { filler: true } }, collection: true } },
} as const

/** Whether an ident's clips are ready for everywhere it plays. */
export type IdentReadiness = { ready: boolean; building: boolean }

/**
 * Per ident on a channel: is every clip it airs as (one per logo on air where
 * it plays) already built, and is one building now? An ident that plays
 * nowhere is ready — there's nothing to build.
 */
export async function identReadiness(channelId: number): Promise<Map<number, IdentReadiness>> {
  const out = new Map<number, IdentReadiness>()
  const ch = await prisma.channel.findUnique({ where: { id: channelId }, include: CHANNEL_POOLS })
  if (!ch) return out
  const idents = await prisma.filler.findMany({ where: { channelId } })
  for (const f of idents) out.set(f.id, { ready: true, building: false })
  const channelHeight = resolveProfile(ch.profile).height
  const logos = await logoPaths()
  for (const block of [null, ...ch.timeBlocks]) {
    const logo = await localLogo(logoFor(ch, block, logos).raw)
    for (const f of poolFor(ch, block).pool) {
      const s = out.get(f.id) ?? { ready: true, building: false }
      const { upload, plan } = await planFor(f, logo, channelHeight)
      if (!upload && plan && !fs.existsSync(plan.out)) {
        s.ready = false
        if (renders.has(plan.out)) s.building = true
      }
      out.set(f.id, s)
    }
  }
  return out
}

/** Is this ident's clip for this logo already built? (A custom one always is.) */
export async function identBuilt(f: FillerRow, logoFile: string | undefined, channelHeight?: number): Promise<boolean> {
  const { upload, plan } = await planFor(f, logoFile, channelHeight)
  return !!upload || !plan || fs.existsSync(plan.out)
}

// Every logo's file, by id — what the stream resolves a logo id against.
async function logoPaths(): Promise<Map<number, string>> {
  const logos = await prisma.logo.findMany({ select: { id: true, filename: true } })
  return new Map(logos.map((l) => [l.id, path.join(logosDir(), l.filename)]))
}

// ---- Taking turns -----------------------------------------------------------
// Breaks take turns through a pool of fillers in its order (a block's, or a
// channel's), so two fillers alternate instead of landing on the same one half
// the time. The last pick per pool is kept in the database: a restart carries
// on the order, and the same break built again (a retry, a restart mid-break)
// keeps the filler it had.

const TURNS_KEY = 'fillerTurns'
const TURN_TTL_MS = 7 * 24 * 3600_000 // forget a pool not heard from in a week (a deleted block)
type Turn = { at: number; idx: number }
let turns: Promise<Map<string, Turn>> | null = null
let savingTurns: Promise<unknown> = Promise.resolve()

function loadTurns(): Promise<Map<string, Turn>> {
  turns ??= prisma.setting
    .findUnique({ where: { key: TURNS_KEY } })
    .then((row) => new Map(Object.entries(JSON.parse(row?.value ?? '{}') as Record<string, Turn>)))
    .catch(() => new Map<string, Turn>())
  return turns
}

/**
 * Which of a pool's `size` fillers airs in the break starting at `at` (epoch
 * ms). `pool` names the pool (channel + block); the first break a pool ever
 * has gets its first filler.
 */
/**
 * Which of a pool's `size` idents the NEXT break will air, without taking the
 * turn — for the Breaks tab's "next break". A break already under way (`at` is
 * its start) keeps the one it has.
 */
export async function peekTurn(pool: string, at: number, size: number): Promise<number> {
  if (size <= 1) return 0
  const last = (await loadTurns()).get(pool)
  if (!last) return 0
  return last.at === at ? last.idx % size : (last.idx + 1) % size
}

export async function fillerTurn(pool: string, at: number, size: number): Promise<number> {
  if (size <= 1) return 0
  const m = await loadTurns()
  const last = m.get(pool)
  if (last?.at === at) return last.idx % size
  const idx = last ? (last.idx + 1) % size : 0
  m.set(pool, { at, idx })
  for (const [k, t] of m) if (at - t.at > TURN_TTL_MS) m.delete(k)
  const value = JSON.stringify(Object.fromEntries(m))
  // One write at a time, so an older pick can never land after a newer one.
  savingTurns = savingTurns
    .then(() => prisma.setting.upsert({ where: { key: TURNS_KEY }, create: { key: TURNS_KEY, value }, update: { value } }))
    .catch(() => {})
  return idx
}

// ---- Building ahead ---------------------------------------------------------

// Clear what a hard crash left behind: caption and info-card images (a clean
// exit removes each after its segment), still previews, and half-written
// renders and Studio preview copies. Only at boot — later, any of them could
// belong to something running.
function sweepScratch(): void {
  try {
    for (const f of fs.readdirSync(dataDir())) {
      if (/^caption-.*\.txt$|^card-.*\.png$|^filler-.*\.tmp\.mp4$/.test(f)) fs.rmSync(path.join(dataDir(), f), { force: true })
    }
    // A render's scratch, and an upload a restart cut off (routes/assets.ts).
    for (const f of fs.readdirSync(assetsDir())) if (f.endsWith('.tmp.mp4') || f.endsWith('.part')) fs.rmSync(path.join(assetsDir(), f), { force: true })
    for (const f of fs.readdirSync(previewsDir())) fs.rmSync(path.join(previewsDir(), f), { force: true })
  } catch {
    /* best-effort */
  }
}

// A clip written in the last few minutes is left alone even if nothing seems
// to want it: a render the stream started for a break, or one the Studio is
// still copying into its preview.
const SWEEP_GRACE_MS = 15 * 60_000

// Delete generated clips no break would use any more — an edited filler's old
// look, a replaced logo's, a clip from before a style's generator changed. The
// Studio's previews are Media assets, not these, and stay.
function sweepUnused(wanted: Set<string>): void {
  let n = 0
  let bytes = 0
  let dir: string
  let files: string[]
  try {
    dir = dataDir()
    files = fs.readdirSync(dir)
  } catch {
    return
  }
  for (const f of files) {
    if (!CLIP_FILE.test(f) || wanted.has(f)) continue
    const file = path.join(dir, f)
    if (renders.has(file)) continue
    try {
      const st = fs.statSync(file)
      if (Date.now() - st.mtimeMs < SWEEP_GRACE_MS) continue
      fs.rmSync(file)
      n++
      bytes += st.size
    } catch {
      /* in use (Windows) or already gone — try again next pass */
    }
  }
  if (n) log('info', 'system', `Removed ${n} filler clip${n === 1 ? '' : 's'} nothing airs any more (${(bytes / 1e6).toFixed(0)} MB)`)
}

// A pass in progress, whether another was asked for meanwhile, and whether
// the boot-time scratch sweep has run.
let warming: Promise<void> | null = null
let warmAgain = false
let booted = false

/**
 * Build every clip a break could need, so no break waits on a render. For each
 * channel that's every place a break can fall — outside its blocks, and in
 * each block — with the idents that break would pick from (poolFor), the logo
 * on screen there, and the channel's size. Then sweep away clips nothing uses.
 */
async function warmPass(): Promise<void> {
  const wanted = new Set<string>()
  const keep = (clip: string | undefined) => {
    if (clip) wanted.add(path.basename(clip))
  }

  const animated = await ensureAnimatedFiller()
  if (animated) keep(animated)
  else log('warn', 'system', 'No filler clip available — gaps will play black')

  const channels = await prisma.channel.findMany({ include: CHANNEL_POOLS })
  const logos = await logoPaths()
  for (const ch of channels) {
    const channelHeight = resolveProfile(ch.profile).height
    for (const block of [null, ...ch.timeBlocks]) {
      // Something changed since this pass read the settings (an edit asked
      // for another pass): stop here rather than spend minutes building clips
      // for the old ones. The next pass starts over — and does the sweep.
      if (warmAgain) return
      const { pool } = poolFor(ch, block)
      const logo = await localLogo(logoFor(ch, block, logos).raw)
      // Only a channel caught mid-edit has no idents: its safety net, then.
      if (pool.length === 0 && logo) keep(await ensureStationIdent(logo, channelHeight))
      for (const f of pool) keep((await resolveFillerClip(f, logo, { channelHeight })).clip)
    }
  }
  sweepUnused(wanted)
}

/**
 * Build ahead (warmPass) — at boot, and after any change that could change a
 * clip: a filler edited or assigned, a channel's or block's logo or profile, a
 * replaced logo. Calls while a pass is running fold into one more pass after
 * it, so a burst of edits costs one extra pass, not one each.
 */
export function warmFiller(): Promise<void> {
  if (warming) {
    warmAgain = true
    return warming
  }
  warming = (async () => {
    try {
      if (!booted) {
        booted = true
        sweepScratch()
      }
      do {
        warmAgain = false
        await warmPass().catch((e) => log('warn', 'system', 'Building fillers ahead failed', String(e)))
      } while (warmAgain)
    } finally {
      warming = null
    }
  })()
  return warming
}

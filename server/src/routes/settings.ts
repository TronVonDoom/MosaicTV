import { Router } from 'express'
import { getTmdbKey, setTmdbKey, validateKey } from '../tmdb.js'
import { loadWatermark } from '../streaming/overlays.js'
import {
  AudioLanguageSave,
  StreamModeSave,
  TmdbKeySave,
  WatermarkSave,
  horizonSave,
  tunerCountSave,
  tunerNameSave,
  type SettingsInfo,
} from '../contract/index.js'
import { readBody } from '../validate.js'
import { prisma } from '../db.js'
import { MAX_HORIZON_HOURS, MIN_HORIZON_HOURS, horizonHours } from '../playout.js'
import { globalAudioLanguage } from '../audio.js'
import {
  MAX_FRIENDLY_NAME,
  MAX_TUNER_COUNT,
  MIN_TUNER_COUNT,
  deviceId,
  friendlyName,
  tunerCount,
} from '../tuner.js'

export const settingsRouter = Router()

async function setSetting(k: string, v: string | null) {
  if (v == null) await prisma.setting.deleteMany({ where: { key: k } })
  else await prisma.setting.upsert({ where: { key: k }, create: { key: k, value: v }, update: { value: v } })
}

// Breaks are configured per channel (see /api/fillers); watermark defaults
// live here with per-logo overrides in the Studio.
settingsRouter.get('/', async (_req, res) => {
  const key = await getTmdbKey()
  const modeRow = await prisma.setting.findUnique({ where: { key: 'streamMode' } })
  res.json({
    tmdbConfigured: !!key,
    watermark: await loadWatermark(),
    streamMode: modeRow?.value === 'hls' ? ('hls' as const) : ('mpegts' as const),
    tunerCount: await tunerCount(),
    // Read-only in the UI, but surfaced so you can tell which device Plex is
    // talking to. Reading it mints the ID if this instance has never served a
    // tuner request, so it's visible before Plex ever connects.
    hdhrDeviceId: await deviceId(),
    hdhrFriendlyName: await friendlyName(),
    playoutHorizonHours: await horizonHours(),
    audioLanguage: await globalAudioLanguage(),
  } satisfies SettingsInfo)
})

settingsRouter.post('/watermark', async (req, res) => {
  const wm = readBody(WatermarkSave, req, res)
  if (!wm) return
  await setSetting('watermark', JSON.stringify(wm))
  res.json({ ok: true, watermark: wm })
})

// Global streaming output mode. 'hls' = shared (one transcode per channel,
// many viewers); 'mpegts' = per-client. Only affects which URL the M3U hands
// out; both endpoints stay live regardless.
settingsRouter.post('/stream-mode', async (req, res) => {
  const body = readBody(StreamModeSave, req, res)
  if (!body) return
  const { mode } = body
  await setSetting('streamMode', mode)
  res.json({ ok: true, streamMode: mode })
})

// How many concurrent streams the emulated HDHomeRun tuner advertises to
// Plex/Emby — one tuner slot = one concurrent Live TV stream from their side.
const TunerCountSave = tunerCountSave(MIN_TUNER_COUNT, MAX_TUNER_COUNT)
settingsRouter.post('/tuner-count', async (req, res) => {
  const body = readBody(TunerCountSave, req, res)
  if (!body) return
  const count = body.tunerCount
  await setSetting('tunerCount', String(count))
  res.json({ ok: true, tunerCount: count })
})

// The name Plex lists the tuner under. Safe to change at any time — Plex keys
// the device on its ID, not this — though it may keep showing the old name
// until the DVR entry is re-added.
const TunerNameSave = tunerNameSave(MAX_FRIENDLY_NAME)
settingsRouter.post('/tuner-name', async (req, res) => {
  const body = readBody(TunerNameSave, req, res)
  if (!body) return
  const name = body.friendlyName
  await setSetting('hdhrFriendlyName', name)
  res.json({ ok: true, hdhrFriendlyName: name })
})

// How far ahead every channel builds its timeline. This is also the depth of
// the published XMLTV guide, since the guide only shows what has been built.
const HorizonSave = horizonSave(MIN_HORIZON_HOURS, MAX_HORIZON_HOURS)
settingsRouter.post('/playout-horizon', async (req, res) => {
  const body = readBody(HorizonSave, req, res)
  if (!body) return
  const hours = body.playoutHorizonHours
  await setSetting('playoutHorizonHours', String(hours))
  res.json({ ok: true, playoutHorizonHours: hours })
})

// Which audio track channels air when a file carries more than one: an ISO 639
// language tag, or 'first' to keep whatever order the file lists.
settingsRouter.post('/audio-language', async (req, res) => {
  const body = readBody(AudioLanguageSave, req, res)
  if (!body) return
  const raw = body.audioLanguage
  await setSetting('audioLanguage', raw)
  res.json({ ok: true, audioLanguage: raw })
})

// Validate and save the TMDB API key in one step.
settingsRouter.post('/tmdb', async (req, res) => {
  const body = readBody(TmdbKeySave, req, res)
  if (!body) return
  const { apiKey } = body
  const valid = await validateKey(apiKey)
  if (!valid) {
    return res.status(400).json({ error: 'TMDB rejected that key. Double-check it and try again.' })
  }
  await setTmdbKey(apiKey)
  res.json({ ok: true, tmdbConfigured: true })
})

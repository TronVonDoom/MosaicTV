// Configuration for the two burned-in overlays lives in the contract (shared
// with the web app); this adds what needs the database. The filter graphs that
// render them live in filters.ts.

import { prisma } from '../db.js'
import { parseWatermark, type WatermarkConfig } from '../contract/overlays.js'

export * from '../contract/overlays.js'

export async function loadWatermark(): Promise<WatermarkConfig> {
  const s = await prisma.setting.findUnique({ where: { key: 'watermark' } })
  return parseWatermark(s?.value)
}

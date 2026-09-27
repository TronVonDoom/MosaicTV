// The one-time data migrations from before versioned migrations (0.8-0.12).
//
// Each used to run on every boot behind a Setting flag, straight after `db
// push`. They now run once, only while a database is at the 0_init baseline —
// the moment an install from before migrations is adopted — and before the
// migrations after 0_init apply, because some of what they read (Filler's old
// owner columns, FillerAssignment.order, Library.path) is dropped by those.
//
// That is also why they use the frozen baseline client (BaselineDb, generated
// from prisma/baseline.prisma) rather than the app's: its models are the
// database exactly as it stands at that moment, retired columns included, and
// nothing a later release adds to the live schema can break them.
import fs from 'node:fs'
import path from 'node:path'
import { log } from '../logs.js'
import { assetsDir } from '../paths.js'
import { planIdentMigration } from './identPlan.js'
import { DEFAULT_WATERMARK, parseWatermark } from '../streaming/overlays.js'
import type { BaselineDb } from './baselineClient.js'

/** Run every legacy migration that hasn't run yet, oldest first. */
export async function runLegacyDataMigrations(db: BaselineDb): Promise<void> {
  await backfillLibraryFolders(db)
  await migrateCollectionOwnership(db)
  await migrateFillersToLibrary(db)
  await migrateIdentsToChannels(db)
}

/** Turn any single-path library (before libraries had folders) into a folder row. */
async function backfillLibraryFolders(db: BaselineDb): Promise<void> {
  const libs = await db.library.findMany({
    where: { path: { not: null } },
    include: { _count: { select: { folders: true } } },
  })
  for (const lib of libs) {
    if (lib._count.folders === 0 && lib.path) {
      await db.libraryFolder.create({ data: { libraryId: lib.id, path: path.resolve(lib.path) } }).catch(() => {})
    }
  }
}

const FLAG = 'migrated_collection_ownership'

/**
 * One-time migration to the "collection owned by a channel" model. Each existing
 * collection is assigned to the channel that references it (via a rotation item
 * or time block). A collection used by more than one channel is DUPLICATED per
 * channel (members + smart filter copied) and those channels' references are
 * repointed to their own copy. Collections referenced by no channel are left
 * unassigned. Idempotent — guarded by a Setting flag.
 */
async function migrateCollectionOwnership(db: BaselineDb): Promise<void> {
  if (await db.setting.findUnique({ where: { key: FLAG } })) return

  const collections = await db.collection.findMany({ include: { items: true } })
  let duplicated = 0

  for (const col of collections) {
    const [rots, blks] = await Promise.all([
      db.rotationItem.findMany({ where: { collectionId: col.id }, select: { channelId: true } }),
      db.timeBlock.findMany({ where: { collectionId: col.id }, select: { channelId: true } }),
    ])
    const channelIds = [...new Set([...rots.map((r) => r.channelId), ...blks.map((b) => b.channelId)])]
    if (channelIds.length === 0) continue // orphan — leave unassigned

    // The first referencing channel keeps the original.
    await db.collection.update({ where: { id: col.id }, data: { channelId: channelIds[0] } })

    // Each additional channel gets its own duplicate.
    for (const chId of channelIds.slice(1)) {
      const dup = await db.collection.create({
        data: {
          name: col.name,
          channelId: chId,
          libraryId: col.libraryId,
          filterType: col.filterType,
          filterShow: col.filterShow,
          filterSearch: col.filterSearch,
          filterGenre: col.filterGenre,
        },
      })
      if (col.items.length) {
        await db.collectionItem.createMany({
          data: col.items.map((it) => ({
            collectionId: dup.id,
            kind: it.kind,
            showTitle: it.showTitle,
            libraryId: it.libraryId,
            mediaItemId: it.mediaItemId,
            label: it.label,
            order: it.order,
          })),
        })
      }
      await db.rotationItem.updateMany({ where: { channelId: chId, collectionId: col.id }, data: { collectionId: dup.id } })
      await db.timeBlock.updateMany({ where: { channelId: chId, collectionId: col.id }, data: { collectionId: dup.id } })
      duplicated++
    }
  }

  await db.setting.create({ data: { key: FLAG, value: new Date().toISOString() } })
  log('info', 'system', `Collection ownership migration complete — ${collections.length} collection(s), ${duplicated} duplicated for shared use`)
}

const FILLER_FLAG = 'migrated_fillers_to_library'

/**
 * One-time migration to the "global filler library" model. Fillers used to be
 * owned by a single channel or time block (Filler.channelId/timeBlockId); they
 * are now a shared library assigned via FillerAssignment. Each still-owned
 * filler gets an assignment mirroring its old owner, then its legacy owner
 * columns are cleared. Idempotent — guarded by a Setting flag.
 */
async function migrateFillersToLibrary(db: BaselineDb): Promise<void> {
  if (await db.setting.findUnique({ where: { key: FILLER_FLAG } })) return

  const owned = await db.filler.findMany({
    where: { OR: [{ channelId: { not: null } }, { timeBlockId: { not: null } }] },
  })
  for (const f of owned) {
    // Upsert on the compound unique guards against a partial prior run
    // (SQLite has no createMany skipDuplicates).
    const where =
      f.channelId != null
        ? { fillerId_channelId: { fillerId: f.id, channelId: f.channelId } }
        : { fillerId_timeBlockId: { fillerId: f.id, timeBlockId: f.timeBlockId! } }
    await db.fillerAssignment.upsert({
      where,
      create: { fillerId: f.id, channelId: f.channelId, timeBlockId: f.timeBlockId, order: f.order },
      update: {},
    })
    await db.filler.update({ where: { id: f.id }, data: { channelId: null, timeBlockId: null } })
  }

  await db.setting.create({ data: { key: FILLER_FLAG, value: new Date().toISOString() } })
  if (owned.length > 0) log('info', 'system', `Filler library migration complete — ${owned.length} filler(s) assigned`)
}

const IDENTS_FLAG = 'migrated_idents_to_channels'

/**
 * One-time migration from the shared filler library to idents owned by a
 * channel — the Breaks tab. What goes where is decided by planIdentMigration
 * (identPlan.ts); this applies it. Along the way: every ident matches its
 * channel's size (the resolution setting is gone), the default station ident
 * setting is removed (the channels that relied on it now have their own copy),
 * the Studio's stored preview copies are deleted (previews render on demand),
 * and "show the logo on filler" moves from the watermark to each channel.
 * Idempotent — guarded by a Setting flag.
 */
async function migrateIdentsToChannels(db: BaselineDb): Promise<void> {
  if (await db.setting.findUnique({ where: { key: IDENTS_FLAG } })) return

  const fillers = await db.filler.findMany({
    include: { assignments: { include: { timeBlock: { select: { channelId: true } } } } },
  })
  const channels = await db.channel.findMany({
    include: { logo: true, timeBlocks: { include: { collection: { select: { logoId: true } } } } },
  })
  const defaultRow = await db.setting.findUnique({ where: { key: 'defaultFillerId' } })
  const defaultId = Number(defaultRow?.value)

  const plan = planIdentMigration({
    fillers: fillers.map((f) => ({
      id: f.id,
      name: f.name,
      logoId: f.logoId,
      assignments: f.assignments.map((a) => ({
        channelId: a.channelId,
        timeBlockId: a.timeBlockId,
        blockChannelId: a.timeBlock?.channelId ?? null,
        order: a.order,
      })),
    })),
    channels: channels.map((c) => ({
      id: c.id,
      name: c.name,
      number: c.number,
      logoId: c.logoId,
      blocks: c.timeBlocks.map((b) => ({ id: b.id, logoId: b.logoId ?? b.collection.logoId })),
    })),
    defaultFillerId: Number.isInteger(defaultId) ? defaultId : null,
  })

  // The corner logo during breaks: what the channel's own logo was set to.
  const globalWm = parseWatermark((await db.setting.findUnique({ where: { key: 'watermark' } }))?.value, DEFAULT_WATERMARK)
  const previews = fillers.map((f) => f.generatedAssetId).filter((id): id is number => id != null)
  const previewFiles = await db.asset.findMany({ where: { id: { in: previews } }, select: { filename: true } })

  await db.$transaction(
    async (tx) => {
      // Where every ident plays is rewritten from the plan, so start clean.
      await tx.fillerAssignment.deleteMany({})
      const byId = new Map(fillers.map((f) => [f.id, f]))
      for (const p of plan.idents) {
        const own = { channelId: p.channelId, timeBlockId: null, collectionId: null, name: p.name, order: p.order, resolution: 'auto' }
        let id: number
        if (p.source != null && p.keep) {
          id = (await tx.filler.update({ where: { id: p.source }, data: own })).id
        } else if (p.source != null) {
          const src = byId.get(p.source)!
          id = (
            await tx.filler.create({
              data: { ...own, style: src.style, assetId: src.assetId, audioAssetId: src.audioAssetId, logoId: src.logoId, logoScale: src.logoScale, divider: src.divider },
            })
          ).id
        } else {
          id = (await tx.filler.create({ data: { ...own, style: 'frosted' } })).id
        }
        if (p.plays === 'any') await tx.fillerAssignment.create({ data: { fillerId: id, channelId: p.channelId, order: p.order } })
        for (const timeBlockId of p.blockIds) await tx.fillerAssignment.create({ data: { fillerId: id, timeBlockId, order: p.order } })
      }
      await tx.filler.updateMany({ data: { resolution: 'auto', generatedAssetId: null } })
      await tx.asset.deleteMany({ where: { id: { in: previews } } })
      await tx.setting.deleteMany({ where: { key: { in: ['defaultFillerId', 'fillerTurns'] } } })
      for (const c of channels) {
        // Retired from the watermark settings, but still in the saved JSON.
        const wm = (c.logo?.watermark ? parseWatermark(c.logo.watermark, globalWm) : globalWm) as { showOnFiller?: boolean }
        if (wm.showOnFiller) await tx.channel.update({ where: { id: c.id }, data: { logoOnBreaks: true } })
      }
      await tx.setting.create({ data: { key: IDENTS_FLAG, value: new Date().toISOString() } })
    },
    { timeout: 60_000 },
  )

  for (const a of previewFiles) fs.rmSync(path.join(assetsDir(), a.filename), { force: true })
  const copies = plan.idents.filter((p) => p.source != null && !p.keep).length
  const starters = plan.idents.filter((p) => p.source == null).length
  log(
    'info',
    'system',
    `Idents now belong to their channels — ${plan.idents.length} ident(s) on ${new Set(plan.idents.map((p) => p.channelId)).size} channel(s)` +
      `${copies ? `, ${copies} copied for a second channel or block set` : ''}${starters ? `, ${starters} starter ident(s) made from channel logos` : ''}` +
      `${previewFiles.length ? `; ${previewFiles.length} stored preview clip(s) removed` : ''}`,
  )
}

// The decisions behind the move from a shared filler library to idents owned by
// a channel (see migrateIdentsToChannels in dataMigrations.ts), as a pure function so
// every case can be tested without a database.
//
// The old model: a filler is a library item, assigned to channels (their
// default) and to time blocks, with a global default station ident for
// channels that have none. The new one: every ident belongs to one channel and
// plays either "everywhere else" (a channel-level assignment) or "only during
// these blocks" (block assignments) — and every channel has at least one
// "everywhere else" ident, so nothing airs that its Breaks tab doesn't list.

export type MigAssignment = {
  channelId: number | null
  timeBlockId: number | null
  /** The channel of `timeBlockId`'s block. */
  blockChannelId: number | null
  order: number
}

export type MigFiller = {
  id: number
  name: string | null
  /** Its pinned logo (null = follows the block). */
  logoId: number | null
  assignments: MigAssignment[]
}

export type MigChannel = {
  id: number
  name: string
  number: number | null
  logoId: number | null
  /** Each block with the logo it airs with (its own, else its collection's). */
  blocks: { id: number; logoId: number | null }[]
}

export type Plays = 'any' | 'blocks' | 'none'

export type PlannedIdent = {
  /** The filler whose look it takes; null for a new starter ident. */
  source: number | null
  /** True for the one ident that keeps the source's row; the rest are copies. */
  keep: boolean
  channelId: number
  name: string
  plays: Plays
  blockIds: number[]
  order: number
}

export type IdentMigrationPlan = {
  idents: PlannedIdent[]
  /** Fillers left as they are: there's no channel to give them to. */
  untouched: number[]
}

type Draft = Omit<PlannedIdent, 'order' | 'name'> & { baseName: string | null; suffix: string; rank: number }

const PLAYS_RANK: Record<Plays, number> = { any: 0, blocks: 1, none: 2 }

export function planIdentMigration(input: {
  fillers: MigFiller[]
  channels: MigChannel[]
  defaultFillerId: number | null
}): IdentMigrationPlan {
  const channels = [...input.channels].sort((a, b) => a.id - b.id)
  const fillers = [...input.fillers].sort((a, b) => a.id - b.id)
  const drafts: Draft[] = []
  const kept = new Set<number>()
  const unassigned: MigFiller[] = []

  // One ident per filler keeps its row; every further use is a copy.
  const add = (f: MigFiller | null, d: Omit<Draft, 'source' | 'keep' | 'baseName'>) => {
    const keep = f != null && !kept.has(f.id)
    if (f && keep) kept.add(f.id)
    drafts.push({ ...d, source: f?.id ?? null, keep, baseName: f?.name?.trim() || null })
  }

  // 1. Each assigned filler, per channel it airs on.
  for (const f of fillers) {
    const byChannel = new Map<number, { any: MigAssignment | null; blocks: MigAssignment[] }>()
    for (const a of f.assignments) {
      const ch = a.channelId ?? a.blockChannelId
      if (ch == null) continue
      const g = byChannel.get(ch) ?? { any: null, blocks: [] }
      if (a.channelId != null) g.any ??= a
      else if (a.timeBlockId != null) g.blocks.push(a)
      byChannel.set(ch, g)
    }
    if (byChannel.size === 0) {
      unassigned.push(f)
      continue
    }
    for (const [channelId, g] of byChannel) {
      const blockIds = g.blocks.map((a) => a.timeBlockId as number)
      const blockRank = Math.min(...g.blocks.map((a) => a.order))
      if (g.any) {
        add(f, { channelId, plays: 'any', blockIds: [], suffix: '', rank: g.any.order })
        // It was the channel's default AND in some of its blocks. An ident does
        // one or the other now, so the blocks get their own copy — which keeps
        // exactly what each break picks from.
        if (blockIds.length) add(f, { channelId, plays: 'blocks', blockIds, suffix: ' (blocks)', rank: blockRank })
      } else {
        add(f, { channelId, plays: 'blocks', blockIds, suffix: '', rank: blockRank })
      }
    }
  }

  const hasAny = (channelId: number) => drafts.some((d) => d.channelId === channelId && d.plays === 'any')

  // 2. The default station ident, into every channel that was relying on it.
  const def = input.defaultFillerId != null ? fillers.find((f) => f.id === input.defaultFillerId) : undefined
  if (def) {
    for (const ch of channels) {
      if (!hasAny(ch.id)) add(def, { channelId: ch.id, plays: 'any', blockIds: [], suffix: '', rank: -1 })
    }
  }

  // 3. Fillers on no channel: to the channel their pinned logo belongs to — its
  //    own logo (everywhere else), else the blocks that air it — else parked,
  //    playing nowhere, on the first channel. Nothing is thrown away.
  const firstChannel = [...channels].sort(
    (a, b) => (a.number ?? Infinity) - (b.number ?? Infinity) || a.id - b.id,
  )[0]
  for (const f of unassigned) {
    if (kept.has(f.id)) continue // the default ident, already given out above
    let placed = false
    if (f.logoId != null) {
      for (const ch of channels) {
        if (ch.logoId === f.logoId) {
          add(f, { channelId: ch.id, plays: 'any', blockIds: [], suffix: '', rank: 0 })
          placed = true
          continue
        }
        const blockIds = ch.blocks.filter((b) => b.logoId === f.logoId).map((b) => b.id)
        if (blockIds.length) {
          add(f, { channelId: ch.id, plays: 'blocks', blockIds, suffix: '', rank: 0 })
          placed = true
        }
      }
    }
    if (!placed && firstChannel) {
      add(f, { channelId: firstChannel.id, plays: 'none', blockIds: [], suffix: '', rank: 0 })
      placed = true
    }
  }

  // 4. A channel with no "everywhere else" ident gets a starter: frosted glass
  //    from its logo — the look it aired before, with nothing set.
  for (const ch of channels) {
    if (!hasAny(ch.id)) add(null, { channelId: ch.id, plays: 'any', blockIds: [], suffix: '', rank: 0 })
  }

  // 5. Names and order, per channel: "everywhere else" idents first, in their
  //    old turn order. A nameless ident takes the channel's name, and a name
  //    used twice on one channel is numbered.
  const idents: PlannedIdent[] = []
  for (const ch of channels) {
    const mine = drafts
      .filter((d) => d.channelId === ch.id)
      .sort((a, b) => PLAYS_RANK[a.plays] - PLAYS_RANK[b.plays] || a.rank - b.rank || (a.source ?? 0) - (b.source ?? 0))
    const used = new Map<string, number>()
    mine.forEach((d, order) => {
      let name = (d.baseName ?? ch.name) + d.suffix
      const n = (used.get(name) ?? 0) + 1
      used.set(name, n)
      if (n > 1) name = `${name} ${n}`
      idents.push({ source: d.source, keep: d.keep, channelId: d.channelId, name, plays: d.plays, blockIds: d.blockIds, order })
    })
  }

  const placedIds = new Set(drafts.map((d) => d.source).filter((s): s is number => s != null))
  return { idents, untouched: fillers.filter((f) => !placedIds.has(f.id)).map((f) => f.id) }
}

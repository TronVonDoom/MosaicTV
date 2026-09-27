import test from 'node:test'
import assert from 'node:assert/strict'
import { planIdentMigration, type MigChannel, type MigFiller } from './identPlan.js'

const ch = (id: number, name: string, logoId: number | null = null, blocks: MigChannel['blocks'] = [], number: number | null = id): MigChannel => ({
  id,
  name,
  number,
  logoId,
  blocks,
})
const onChannel = (channelId: number, order = 0) => ({ channelId, timeBlockId: null, blockChannelId: null, order })
const onBlock = (timeBlockId: number, blockChannelId: number, order = 0) => ({ channelId: null, timeBlockId, blockChannelId, order })
const filler = (id: number, name: string | null, assignments: MigFiller['assignments'] = [], logoId: number | null = null): MigFiller => ({
  id,
  name,
  logoId,
  assignments,
})

const summary = (plan: ReturnType<typeof planIdentMigration>) =>
  plan.idents.map((i) => `${i.channelId}:${i.order} ${i.name} [${i.source == null ? 'starter' : i.source + (i.keep ? '' : ' copy')}] ${i.plays}${i.blockIds.length ? ' ' + i.blockIds.join(',') : ''}`)

test('the live box: channel default, pinned-logo matches and a starter', () => {
  const plan = planIdentMigration({
    channels: [
      ch(6, 'Nickelodeon', 7, [
        { id: 27, logoId: 7 },
        { id: 36, logoId: 9 },
        { id: 40, logoId: 8 },
        { id: 41, logoId: 8 },
      ]),
      ch(7, 'Cartoon Network', 10, [{ id: 44, logoId: 11 }]),
      ch(8, 'J&B TV', 14),
      ch(9, 'Halloween', 15),
    ],
    fillers: [
      filler(20, 'Nick @ Nite', [], 8),
      filler(22, null, [], 10),
      filler(24, 'Halloween Channel', [], 15),
      filler(25, 'Nickelodeon', [onChannel(6)]),
    ],
    defaultFillerId: null,
  })
  assert.deepEqual(summary(plan), [
    '6:0 Nickelodeon [25] any',
    '6:1 Nick @ Nite [20] blocks 40,41',
    '7:0 Cartoon Network [22] any',
    '8:0 J&B TV [starter] any',
    '9:0 Halloween Channel [24] any',
  ])
  assert.deepEqual(plan.untouched, [])
})

test('a filler shared by two channels becomes one ident each', () => {
  const plan = planIdentMigration({
    channels: [ch(1, 'A'), ch(2, 'B', null, [{ id: 20, logoId: null }])],
    fillers: [filler(5, 'Bumper', [onChannel(1), onBlock(20, 2)])],
    defaultFillerId: null,
  })
  assert.deepEqual(summary(plan), [
    '1:0 Bumper [5] any',
    // B's block keeps the bumper; B still needs something everywhere else.
    '2:0 B [starter] any',
    '2:1 Bumper [5 copy] blocks 20',
  ])
})

test('a channel default that was also in some blocks is split in two', () => {
  const plan = planIdentMigration({
    channels: [ch(1, 'A', null, [{ id: 10, logoId: null }, { id: 11, logoId: null }])],
    fillers: [filler(5, 'Main', [onChannel(1), onBlock(10, 1), onBlock(11, 1)]), filler(6, 'Late', [onBlock(11, 1, 1)])],
    defaultFillerId: null,
  })
  assert.deepEqual(summary(plan), ['1:0 Main [5] any', '1:1 Main (blocks) [5 copy] blocks 10,11', '1:2 Late [6] blocks 11'])
})

test('the default station ident goes to every channel that relied on it', () => {
  const plan = planIdentMigration({
    channels: [ch(1, 'A'), ch(2, 'B'), ch(3, 'C')],
    fillers: [filler(5, 'Station ID'), filler(6, 'Own', [onChannel(2)])],
    defaultFillerId: 5,
  })
  assert.deepEqual(summary(plan), ['1:0 Station ID [5] any', '2:0 Own [6] any', '3:0 Station ID [5 copy] any'])
})

test('channel defaults keep their turn order, ahead of block idents', () => {
  const plan = planIdentMigration({
    channels: [ch(1, 'A', null, [{ id: 10, logoId: null }])],
    fillers: [filler(5, 'Second', [onChannel(1, 1)]), filler(6, 'Block', [onBlock(10, 1)]), filler(7, 'First', [onChannel(1, 0)])],
    defaultFillerId: null,
  })
  assert.deepEqual(summary(plan), ['1:0 First [7] any', '1:1 Second [5] any', '1:2 Block [6] blocks 10'])
})

test('an unassigned filler with no logo match is kept, playing nowhere, on the first channel', () => {
  const plan = planIdentMigration({
    channels: [ch(2, 'Second', null, [], 20), ch(1, 'Draft', null, [], null), ch(3, 'First', null, [], 5)],
    fillers: [filler(9, 'Old', [], 99), filler(10, null)],
    defaultFillerId: null,
  })
  assert.deepEqual(summary(plan), [
    '1:0 Draft [starter] any',
    '2:0 Second [starter] any',
    '3:0 First [starter] any',
    '3:1 Old [9] none',
    '3:2 First 2 [10] none',
  ])
})

test('with no channels at all, fillers are left alone', () => {
  const plan = planIdentMigration({ channels: [], fillers: [filler(1, 'X'), filler(2, 'Y', [], 4)], defaultFillerId: 1 })
  assert.deepEqual(plan.idents, [])
  assert.deepEqual(plan.untouched, [1, 2])
})

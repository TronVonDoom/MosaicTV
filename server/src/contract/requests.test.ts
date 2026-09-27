import test from 'node:test'
import assert from 'node:assert/strict'
import {
  AiringsReplace,
  BlockCreate,
  BlockUpdate,
  ChannelCreate,
  ChannelUpdate,
  CollectionCreate,
  IdentLook,
  IdentPlacement,
  MemberCreate,
  RotationCreate,
  horizonSave,
} from './requests.js'
import { DEFAULT_COMINGUP } from './overlays.js'

const message = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message

test('bodies are read as loosely as the routes always read them', () => {
  // Scripts send strings; the UI sends numbers. Both land the same.
  assert.deepEqual(RotationCreate.parse({ collectionId: '7', count: '3', mode: 'multiple', playbackOrder: 'inherit' }), {
    collectionId: 7,
    count: 3,
    mode: 'multiple',
    playbackOrder: 'inherit',
  })
  assert.deepEqual(RotationCreate.parse({ collectionId: 7 }), { collectionId: 7, count: 1, mode: 'one', playbackOrder: 'chronological' })
  assert.equal(RotationCreate.parse({ collectionId: 7, count: '0' }).count, 1)
  assert.equal(RotationCreate.parse({ collectionId: 7, playbackOrder: 'sideways' }).playbackOrder, 'chronological')

  const block = BlockCreate.parse({ collectionId: '3', days: '1,2,3', startMinute: '1080', endMinute: 1200 })
  assert.deepEqual(block, {
    collectionId: 3,
    days: '1,2,3',
    startMinute: 1080,
    endMinute: 1200,
    playbackOrder: 'chronological',
    logoUrl: null,
    logoId: null,
    fillerMode: 'none',
    startMode: 'soft',
    comingUp: null,
    grid: null, // the channel's clock
    actBreaks: null, // the channel's setting
  })
  // Midnight is a real start time.
  assert.equal(BlockCreate.parse({ collectionId: 3, days: '0', startMinute: 0, endMinute: 60 }).startMinute, 0)
})

test('a field left out of an update stays out, so it is left as it was', () => {
  assert.deepEqual(ChannelUpdate.parse({ name: '  Nick  ' }), { name: 'Nick' })
  assert.deepEqual(BlockUpdate.parse({ fillerMode: 'end' }), { fillerMode: 'end' })
  // ...while an empty value clears it.
  assert.deepEqual(ChannelUpdate.parse({ group: '', logoId: '', audioLanguage: '', comingUp: null }), {
    group: null,
    logoId: null,
    audioLanguage: null,
    comingUp: null,
  })
})

test('the old error messages come through unchanged', () => {
  assert.equal(message(ChannelCreate.safeParse({ name: '   ' })), 'name is required')
  assert.equal(message(ChannelCreate.safeParse({ name: 'X', number: '4.5' })), 'number must be a whole number')
  assert.equal(message(RotationCreate.safeParse({})), 'collectionId is required')
  assert.equal(message(BlockCreate.safeParse({ collectionId: 1, days: '1' })), 'collectionId, days, startMinute, endMinute are required')
  assert.equal(message(BlockCreate.safeParse({ collectionId: 1, days: '1', startMinute: 60, endMinute: 60 })), 'Start and end time cannot be the same.')
  assert.equal(message(BlockUpdate.safeParse({ startMinute: 60, endMinute: '60' })), 'Start and end time cannot be the same.')
  assert.equal(message(CollectionCreate.safeParse({})), 'name is required')
  assert.equal(message(MemberCreate.safeParse({ kind: 'album' })), 'kind must be one of show, season, episode, movie')
  assert.equal(message(MemberCreate.safeParse({ kind: 'season', showTitle: 'Doug' })), 'season is required')
  assert.equal(message(MemberCreate.safeParse({ kind: 'movie' })), 'mediaItemId is required')
  assert.equal(message(AiringsReplace.safeParse({ libraryId: 1, showTitle: 'Doug', season: 1, groups: 'x' })), 'groups must be an array of id arrays')
  assert.equal(message(AiringsReplace.safeParse({ libraryId: 1, season: 1, groups: [] })), 'libraryId, showTitle and season are required')
  assert.equal(message(horizonSave(24, 168).safeParse({ playoutHorizonHours: 12 })), 'playoutHorizonHours must be a number between 24 and 168')
})

test('members and broadcast episodes come out in the shape they are stored in', () => {
  assert.deepEqual(MemberCreate.parse({ kind: 'season', showTitle: 'Doug', libraryId: '3', season: '2' }), {
    kind: 'season',
    showTitle: 'Doug',
    libraryId: 3,
    season: 2,
    mediaItemId: null,
    label: 'Doug',
  })
  assert.deepEqual(MemberCreate.parse({ kind: 'movie', mediaItemId: '44', label: 'Hocus Pocus' }), {
    kind: 'movie',
    showTitle: null,
    libraryId: null,
    season: null,
    mediaItemId: 44,
    label: 'Hocus Pocus',
  })
  // -1 is "no season"; a group that isn't a list is dropped.
  assert.deepEqual(AiringsReplace.parse({ libraryId: '3', showTitle: 'Dexter', season: -1, groups: [[1, '2'], 'x', [3]] }), {
    libraryId: 3,
    showTitle: 'Dexter',
    season: null,
    groups: [[1, 2], [3]],
  })
})

test('an ident look is clamped, never refused', () => {
  const look = IdentLook.parse({ name: ' Nick ', style: 'glitter', assetId: 9, logoScale: 9, divider: 'true' })
  assert.deepEqual(look, { name: 'Nick', style: 'frosted', assetId: null, audioAssetId: null, logoId: null, logoScale: 2, divider: true, reelFolder: null })
  assert.equal(IdentLook.parse({ style: 'custom', assetId: '9' }).assetId, 9)
  // A reel keeps its folder; any other look drops one.
  assert.equal(IdentLook.parse({ style: 'reel', reelFolder: ' /media/bumpers ' }).reelFolder, '/media/bumpers')
  assert.equal(IdentLook.parse({ style: 'frosted', reelFolder: '/media/bumpers' }).reelFolder, null)
  assert.deepEqual(IdentPlacement.parse({ plays: 'blocks', blockIds: ['4', 'x', 5] }), { plays: 'blocks', blockIds: [4, 5] })
  assert.equal(IdentPlacement.parse({}).plays, 'any')
})

test('an up-next config is clamped on the way in', () => {
  const { comingUp } = ChannelUpdate.parse({ comingUp: { enabled: true, leadSeconds: 99999, position: 'top' } })
  assert.equal(comingUp?.leadSeconds, 3600)
  assert.equal(comingUp?.position, 'top-left')
  assert.equal(comingUp?.style, DEFAULT_COMINGUP.style)
})

test('a broadcast clock is one of the clock settings, or none', () => {
  assert.equal(ChannelUpdate.parse({ grid: '30' }).grid, 30)
  assert.equal(ChannelUpdate.parse({ grid: 45 }).grid, 0)
  assert.equal(BlockCreate.parse({ collectionId: 3, days: '0', startMinute: 0, endMinute: 60, grid: 0 }).grid, 0)
  assert.equal(BlockCreate.parse({ collectionId: 3, days: '0', startMinute: 0, endMinute: 60, grid: '' }).grid, null)
})

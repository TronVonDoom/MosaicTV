// Whether the live segments' folder is a RAM disk, read off the container's
// mounts: the deepest mount that holds the folder decides.
import test from 'node:test'
import assert from 'node:assert/strict'
import { inMemory } from './paths.js'

const MOUNTS = [
  '1093 812 0:120 / / rw,relatime master:301 - overlay overlay rw,lowerdir=/var/lib/docker/overlay2/l/A',
  '1102 1093 0:125 / /dev/shm rw,nosuid,nodev,noexec,relatime - tmpfs shm rw,size=65536k',
  '1110 1093 0:52 /appdata/mosaictv /app/data rw,noatime - xfs /dev/nvme0n1p1 rw',
  '1111 1093 0:130 / /transcode rw,nosuid,nodev - tmpfs tmpfs rw,size=1048576k',
  '1112 1093 0:131 / /media/My\\040Shows ro,relatime - cifs //nas/shows ro',
  '1113 1093 0:132 / /ram\\040disk rw - tmpfs tmpfs rw',
  // Unraid's /tmp mapped in: its root filesystem lives in memory.
  '742 732 0:2 /tmp /unraid-tmp rw - rootfs rootfs rw,size=8010528k',
].join('\n')

test('a folder on a tmpfs mount is in memory', () => {
  assert.equal(inMemory('/transcode', MOUNTS), true)
  assert.equal(inMemory('/transcode/64', MOUNTS), true)
  assert.equal(inMemory('/ram disk/hls', MOUNTS), true) // a space in a mount point is written \040
  assert.equal(inMemory('/unraid-tmp/mosaictv', MOUNTS), true)
})

test('a folder on disk is not, even one whose name starts like a RAM disk’s', () => {
  assert.equal(inMemory('/app/data/hls', MOUNTS), false)
  assert.equal(inMemory('/transcoded', MOUNTS), false)
  assert.equal(inMemory('/media/My Shows/hls', MOUNTS), false)
})

test('with no mounts to read, it can’t say', () => {
  assert.equal(inMemory('/app/data/hls', ''), null)
})

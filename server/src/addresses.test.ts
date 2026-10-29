// The server learns its Tailscale address from requests that reach it that
// way — and only from those: straight from a Tailscale address, or handed over
// by the gateway as Tailscale on a Linux host does, naming one.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { Request } from 'express'
import { tempDb } from './testDb.js'

await tempDb('mosaictv-addresses-')
const { tailnetAddress, noteAddress, tailscaleAddresses, forgetAddresses } = await import('./addresses.js')
const { setHiding } = await import('./auth.js')
const { prisma } = await import('./db.js')

// A bridge network whose gateway is 172.17.0.1.
setHiding({ vm: false, gateways: ['172.17.0.1'] })

const req = (from: string, host: string, headers: Record<string, string> = {}) =>
  ({ socket: { remoteAddress: from }, headers: { host, ...headers } }) as unknown as Request

test('a request from Tailscale, to a Tailscale address, names it', () => {
  assert.equal(tailnetAddress(req('100.76.61.50', '100.108.21.80:8689')), 'http://100.108.21.80:8689')
  assert.equal(tailnetAddress(req('::ffff:100.76.61.50', '100.108.21.80:8689')), 'http://100.108.21.80:8689')
  assert.equal(tailnetAddress(req('100.76.61.50', 'Tower.tail1234.ts.net.:8689')), 'http://tower.tail1234.ts.net:8689')
  assert.equal(tailnetAddress(req('100.76.61.50', 'tower.tail1234.ts.net')), 'http://tower.tail1234.ts.net')
  assert.equal(tailnetAddress(req('fd7a:115c:a1e0::5', '[fd7a:115c:a1e0::9]:8689')), 'http://[fd7a:115c:a1e0::9]:8689')
})

test('handed over by the gateway, as Tailscale on the host does, a Tailscale IP counts — a name doesn’t', () => {
  assert.equal(tailnetAddress(req('172.17.0.1', '100.108.21.80:8689')), 'http://100.108.21.80:8689')
  assert.equal(tailnetAddress(req('::ffff:172.17.0.1', '100.108.21.80:8689')), 'http://100.108.21.80:8689')
  // Anyone handed over that way could name another tailnet's machine.
  assert.equal(tailnetAddress(req('172.17.0.1', 'tower.tail1234.ts.net:8689')), null)
  assert.equal(tailnetAddress(req('172.17.0.1', '192.168.1.100:8689')), null)
  // Another container on the bridge isn't the gateway.
  assert.equal(tailnetAddress(req('172.17.0.5', '100.108.21.80:8689')), null)
})

test('anything else names nothing', () => {
  // From home Wi-Fi, or the internet.
  assert.equal(tailnetAddress(req('192.168.0.42', '100.108.21.80:8689')), null)
  assert.equal(tailnetAddress(req('203.0.113.7', '100.108.21.80:8689')), null)
  // From Tailscale, but to an address outside it.
  assert.equal(tailnetAddress(req('100.76.61.50', '192.168.0.10:8689')), null)
  assert.equal(tailnetAddress(req('100.76.61.50', 'evil.example.com:8689')), null)
  assert.equal(tailnetAddress(req('100.76.61.50', 'ts.net.example.com')), null)
  // Through a proxy, which could say anything.
  assert.equal(tailnetAddress(req('100.76.61.50', '100.108.21.80:8689', { 'x-forwarded-for': '203.0.113.7' })), null)
  // Nonsense.
  assert.equal(tailnetAddress(req('100.76.61.50', '100.108.21.80:99999')), null)
  assert.equal(tailnetAddress(req('100.76.61.50', 'a b')), null)
  assert.equal(tailnetAddress(req('100.76.61.50', '')), null)
})

test('noted addresses are kept, plain addresses first, and survive a restart', async () => {
  await noteAddress(req('100.76.61.50', 'tower.tail1234.ts.net:8689'))
  await noteAddress(req('100.76.61.50', '100.108.21.80:8689'))
  await noteAddress(req('192.168.0.42', '192.168.0.10:8689')) // not Tailscale
  await noteAddress(req('100.76.61.50', '100.108.21.80:8689')) // again: still once
  assert.deepEqual(await tailscaleAddresses(), ['http://100.108.21.80:8689', 'http://tower.tail1234.ts.net:8689'])
  forgetAddresses()
  assert.deepEqual(await tailscaleAddresses(), ['http://100.108.21.80:8689', 'http://tower.tail1234.ts.net:8689'])
})

test('an address unseen for two months is forgotten', async () => {
  const old = Date.now() - 61 * 86_400_000
  await prisma.setting.upsert({
    where: { key: 'tailscaleAddresses' },
    update: { value: JSON.stringify([{ url: 'http://100.100.1.1:8688', at: old }]) },
    create: { key: 'tailscaleAddresses', value: JSON.stringify([{ url: 'http://100.100.1.1:8688', at: old }]) },
  })
  forgetAddresses()
  assert.deepEqual(await tailscaleAddresses(), [])
})

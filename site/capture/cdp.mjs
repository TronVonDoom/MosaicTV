// A small Chrome DevTools Protocol driver over the Edge (or Chrome) that's
// already installed — enough to render HTML to images and screenshot a running
// MosaicTV, with nothing to install. Node 22's global WebSocket does the talking.

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const CANDIDATES = [
  process.env.BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function launch({ port = 9333, headless = true } = {}) {
  const exe = CANDIDATES.find((p) => fs.existsSync(p))
  if (!exe) throw new Error('No Edge or Chrome found; set BROWSER to one')
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'mosaic-cdp-'))
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    // The private-network checks too: a page shots.mjs serves itself (WEB=)
    // counts as public, and would be refused the instance's streams.
    '--disable-features=Translate,MediaRouter,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights,LocalNetworkAccessChecks',
    ...(headless ? ['--headless=new'] : []),
    'about:blank',
  ]
  const proc = spawn(exe, args, { stdio: 'ignore' })
  let info
  for (let i = 0; i < 100 && !info; i++) {
    await sleep(150)
    info = await fetch(`http://127.0.0.1:${port}/json/version`).then((r) => r.json()).catch(() => null)
  }
  if (!info) throw new Error('Browser did not open its debugging port')
  const ws = new WebSocket(info.webSocketDebuggerUrl)
  await new Promise((res, rej) => {
    ws.onopen = res
    ws.onerror = rej
  })
  let next = 1
  const pending = new Map()
  const listeners = new Set()
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      msg.error ? reject(new Error(`${msg.error.message} ${msg.error.data ?? ''}`)) : resolve(msg.result)
    } else if (msg.method) {
      for (const l of listeners) l(msg)
    }
  }
  const send = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = next++
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  const browser = {
    send,
    on: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    async close() {
      // The reply can be lost as the socket goes down with the browser.
      await Promise.race([send('Browser.close').catch(() => {}), sleep(2000)])
      ws.close()
      await sleep(300)
      try {
        proc.kill()
      } catch {}
      // The browser's helpers can still hold the profile for a moment.
      for (let i = 0; i < 10; i++) {
        try {
          fs.rmSync(profile, { recursive: true, force: true })
          break
        } catch {
          await sleep(300)
        }
      }
    },
    newPage: (opts) => newPage(browser, opts),
  }
  return browser
}

async function newPage(browser, { width = 1440, height = 900, dpr = 1, transparent = false, mobile = false, touch = false } = {}) {
  const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' })
  const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true })
  const s = (m, p) => browser.send(m, p, sessionId)
  await s('Page.enable')
  await s('Runtime.enable')
  const console = []
  browser.on((msg) => {
    if (msg.sessionId !== sessionId) return
    if (msg.method === 'Runtime.consoleAPICalled') console.push(msg.params.args.map((a) => a.value ?? a.description).join(' '))
    if (msg.method === 'Runtime.exceptionThrown') console.push('EXCEPTION ' + (msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text))
  })
  const page = {
    sessionId,
    targetId,
    console,
    send: s,
    async size(w, h, scale = dpr, isMobile = mobile) {
      width = w
      height = h
      await s('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: scale, mobile: isMobile })
      if (touch || isMobile) await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    },
    async goto(url, { wait = 'load', timeout = 30000 } = {}) {
      const loaded = new Promise((resolve) => {
        const off = browser.on((msg) => {
          if (msg.sessionId === sessionId && msg.method === (wait === 'dom' ? 'Page.domContentEventFired' : 'Page.loadEventFired')) {
            off()
            resolve()
          }
        })
        setTimeout(() => (off(), resolve()), timeout)
      })
      await s('Page.navigate', { url })
      await loaded
    },
    /** Render an HTML string (written to a temp file so fonts and relative URLs work). */
    async html(markup, dir = os.tmpdir()) {
      const file = path.join(dir, `render-${process.pid}-${sessionId.slice(0, 8)}.html`)
      fs.writeFileSync(file, markup)
      await page.goto(pathToFileURL(file).href)
      await page.eval('document.fonts.ready.then(() => true)')
    },
    async eval(expression) {
      const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
      return r.result.value
    },
    /** Wait until `expression` is truthy. */
    async until(expression, { timeout = 20000, every = 200 } = {}) {
      const end = Date.now() + timeout
      while (Date.now() < end) {
        if (await page.eval(expression).catch(() => false)) return true
        await sleep(every)
      }
      throw new Error(`Timed out waiting for: ${expression}`)
    },
    async shot(file, { format = file.endsWith('.png') ? 'png' : 'jpeg', quality = 92, clip, full = false } = {}) {
      const params = { format, ...(format === 'png' ? {} : { quality }), captureBeyondViewport: full }
      if (clip) params.clip = { ...clip, scale: 1 }
      else if (full) {
        const h = await page.eval('Math.ceil(document.documentElement.scrollHeight)')
        params.clip = { x: 0, y: 0, width, height: h, scale: 1 }
      }
      const { data } = await s('Page.captureScreenshot', params)
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, Buffer.from(data, 'base64'))
      return file
    },
    close: () => browser.send('Target.closeTarget', { targetId }),
  }
  await page.size(width, height, dpr, mobile)
  if (transparent) await s('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
  return page
}

export { sleep }

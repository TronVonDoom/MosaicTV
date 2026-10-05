// Screenshots of a running MosaicTV for the website and the README, at 2x
// (desktop and phone): each page as it opens, scrolled to what it's showing
// off, with any menu or dialog opened.
//
// It only looks. Every request a page makes other than a GET is refused
// before it leaves the browser, so pointing this at the instance you watch
// can't change anything on it. The list below is written for one real
// instance (its channels, shows and ids); edit it for another.
//
//   CAPTURE_DIR=… MOSAIC=http://your-server:8688 node site/capture/shots.mjs [name-filter]
//
// IDENTS=<dir> swaps the Breaks tab's ident pictures for <dir>/<ident id>.jpg,
// and LOOKS=<id>:<look>,… the look an ident is listed with — for showing the
// idents as a newer build than the instance's draws them (see README).
// HIDE_CHANNELS=<id>,… and HIDE_LOGOS=<id>,… leave channels and logos out of
// every screen, as if they weren't there. WEB=<dir> serves the web app from a
// build of this checkout (`vite build --outDir <dir>`) instead of the
// instance's own, so the pages are this version's, showing the instance's data.

import fs from 'node:fs'
import path from 'node:path'
import { launch, sleep } from './cdp.mjs'

const DIR = process.env.CAPTURE_DIR
const BASE = process.env.MOSAIC
if (!DIR || !BASE) throw new Error('Set CAPTURE_DIR and MOSAIC')
const OUT = path.join(DIR, 'shots')
const only = process.argv[2] ?? ''
const DPR = Number(process.env.DPR ?? 2)
const IDENTS = process.env.IDENTS
const LOOKS = Object.fromEntries((process.env.LOOKS ?? '').split(',').filter(Boolean).map((p) => p.split(':')))
const ids = (v) => new Set((v ?? '').split(',').filter(Boolean).map(Number))
const HIDE_CHANNELS = ids(process.env.HIDE_CHANNELS)
const HIDE_LOGOS = ids(process.env.HIDE_LOGOS)
const WEB = process.env.WEB
const VERSION = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url))).version
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2', '.json': 'application/json' }

const DESK = { w: 1600, h: 1000, dpr: DPR }
const PHONE = { w: 390, h: 844, dpr: Math.max(1, DPR + 1), mobile: true }

// Helpers run in the page.
const settle = `new Promise((r) => setTimeout(r, 300)).then(() => document.fonts.ready).then(() => !document.querySelector('.animate-pulse'))`
const imagesLoaded = `[...document.images].filter((i) => i.getBoundingClientRect().top < innerHeight).every((i) => i.complete)`
const scrollToText = (text, offset = 90) =>
  `(() => { const el = [...document.querySelectorAll('h1,h2,h3,h4,div,span,p,button,label')].find((e) => e.childElementCount < 3 && e.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; const y = el.getBoundingClientRect().top + scrollY - ${offset}; window.scrollTo({ top: y, behavior: 'instant' }); document.querySelectorAll('*').forEach((n) => { if (n.scrollHeight > n.clientHeight + 40 && getComputedStyle(n).overflowY.match(/auto|scroll/) && n.contains(el)) n.scrollTop += el.getBoundingClientRect().top - n.getBoundingClientRect().top - ${offset} }); return true })()`
const click = (text, sel = 'button,a,[role=button],[role=tab],[role=menuitem]') =>
  `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}) || e.getAttribute('aria-label') === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true })()`
const show = (title) => `/library/3/show/${encodeURIComponent(title)}`

// Channels on the instance these were written for: 64 Cartoon Network (id 7),
// 31 Nickelodeon (6), 13 Halloween (9), 42 J&B TV (8), 99 Music (11).
const SHOTS = [
  { name: 'dashboard', url: '/' },
  { name: 'dashboard-guide', url: '/', run: [scrollToText('Coming up', 120)] },
  { name: 'channels', url: '/channels' },
  { name: 'channels-guide', url: '/channels#guide', wait: 1500 },
  { name: 'nick-schedule', url: '/channels/6#schedule' },
  { name: 'nick-blocks', url: '/channels/6#schedule', run: [scrollToText('Time blocks', 100)] },
  { name: 'nick-breaks', url: '/channels/6#breaks' },
  { name: 'nick-breaks-map', url: '/channels/6#breaks', run: [scrollToText('Idents', 100)] },
  { name: 'nick-guide', url: '/channels/6#guide' },
  { name: 'nick-weeks', url: '/channels/6#guide', run: [click('Weeks ahead')], wait: 3000 },
  { name: 'nick-collections', url: '/channels/6#collections' },
  { name: 'nick-general', url: '/channels/6#general' },
  { name: 'nick-card', url: '/channels/6#general', run: [scrollToText('Show an', 160)], wait: 4000 },
  { name: 'cn-schedule', url: '/channels/7#schedule' },
  { name: 'cn-blocks', url: '/channels/7#schedule', run: [scrollToText('Time blocks', 100)] },
  { name: 'cn-guide', url: '/channels/7#guide' },
  { name: 'cn-collections', url: '/channels/7#collections' },
  { name: 'halloween-schedule', url: '/channels/9#schedule' },
  { name: 'halloween-blocks', url: '/channels/9#schedule', run: [scrollToText('Time blocks', 100)] },
  { name: 'halloween-collections', url: '/channels/9#collections' },
  { name: 'jb-card', url: '/channels/8#general', run: [scrollToText('Show an', 160)], wait: 4000 },
  { name: 'music-general', url: '/channels/11#general', run: [scrollToText('Music', 100)] },
  { name: 'playback-orders', url: '/channels/6#collections', run: [`[...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Settings').click()`], wait: 2500 },
  { name: 'studio-logo', url: '/studio#images', run: [click('Cartoon Network', 'button,[role=button],li,div[tabindex]')], wait: 3500 },
  { name: 'settings-watermark', url: '/settings#channels', run: [scrollToText('Default watermark', 90)], wait: 3500 },
  // A big library takes a while to come in.
  { name: 'library', url: '/library', wait: 6000 },
  { name: 'tv-home', url: '/library/3', wait: 15000 },
  { name: 'tv-all', url: '/library/3?view=all', wait: 15000 },
  { name: 'movies-home', url: '/library/4', wait: 15000 },
  { name: 'movies-all', url: '/library/4?view=all', wait: 15000 },
  { name: 'music-home', url: '/library/6', wait: 12000 },
  { name: 'music-artist', url: `/library/6/artist/${encodeURIComponent('Bandai Namco Studios & Sora Ltd.')}`, wait: 8000 },
  { name: 'show-dexter', url: show("Dexter's Laboratory") },
  { name: 'show-dexter-episodes', url: show("Dexter's Laboratory"), run: [scrollToText('Season 1', 80)] },
  { name: 'show-dexter-group', url: show("Dexter's Laboratory"), run: [scrollToText('Season 1', 80), click('Group broadcast episodes')], wait: 1800 },
  { name: 'show-dogs', url: show('2 Stupid Dogs') },
  { name: 'show-dogs-episodes', url: show('2 Stupid Dogs'), run: [scrollToText('Season 1', 80)] },
  { name: 'show-dogs-group', url: show('2 Stupid Dogs'), run: [scrollToText('Season 1', 80), click('Group broadcast episodes')], wait: 1800 },
  { name: 'show-squirrel', url: show('Super Secret Secret Squirrel'), run: [scrollToText('Season 1', 100)] },
  { name: 'show-ren', url: show('The Ren & Stimpy Show'), wait: 6000 },
  { name: 'movie-hocus', url: '/library/4/movie/44273' },
  { name: 'palette', url: '/', run: [`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`], type: 'dexter', wait: 1800 },
  { name: 'bell', url: '/', run: [`[...document.querySelectorAll('button')].find((b) => /notification|activity/i.test(b.getAttribute('aria-label') ?? '')).click()`], wait: 3000 },
  { name: 'watch', url: '/watch/64', wait: 25000 },
  { name: 'watch-guide', url: '/watch/64', wait: 3000, pre: 22000, keys: ['g'] },
  { name: 'phone-dashboard', url: '/', size: PHONE },
  { name: 'phone-channels', url: '/channels', size: PHONE },
  { name: 'phone-show', url: show("Dexter's Laboratory"), size: PHONE },
  { name: 'phone-watch', url: '/watch/31', size: PHONE, wait: 20000 },
  { name: 'phone-breaks', url: '/channels/6#breaks', size: PHONE },
]

// ── The read-only guard (and the ident swap) ────────────────────────────────
const host = new URL(BASE).host
// The POSTs that only draw a picture from what they're sent and save nothing:
// a card's live preview, an ident's still and its preview clip.
const RENDER_ONLY = [/^\/api\/channels\/\d+\/coming-up\/preview$/, /^\/api\/fillers\/(still|preview)$/]

// Take hidden channels (and anything of theirs) and hidden logos out of a
// response: wherever they turn up in a list, the entry goes.
const isHidden = (o, logos) =>
  o != null &&
  typeof o === 'object' &&
  (HIDE_CHANNELS.has(o.channelId) || HIDE_CHANNELS.has(o.channel?.id) || (HIDE_CHANNELS.has(o.id) && 'number' in o && 'name' in o) || (logos && HIDE_LOGOS.has(o.id)))
function prune(v, logos) {
  if (Array.isArray(v)) return v.filter((x) => !isHidden(x, logos)).map((x) => prune(x, logos))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, prune(x, logos)]))
  return v
}
const hiding = () => HIDE_CHANNELS.size > 0 || HIDE_LOGOS.size > 0
async function guard(browser, page) {
  await page.send('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] })
  browser.on(async (msg) => {
    if (msg.sessionId !== page.sessionId || msg.method !== 'Fetch.requestPaused') return
    const { requestId, request } = msg.params
    const url = new URL(request.url)
    const fail = () => page.send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }).catch(() => {})
    const go = () => page.send('Fetch.continueRequest', { requestId }).catch(() => {})
    if (url.host !== host) return go()
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !(request.method === 'POST' && RENDER_ONLY.some((r) => r.test(url.pathname)))) {
      console.log(`    blocked ${request.method} ${url.pathname}`)
      return fail()
    }
    try {
      if (WEB && !url.pathname.startsWith('/api/') && !url.pathname.startsWith('/iptv/')) {
        let file = path.join(WEB, decodeURIComponent(url.pathname))
        if (!file.startsWith(path.resolve(WEB)) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB, 'index.html')
        const type = TYPES[path.extname(file)] ?? 'application/octet-stream'
        return page.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: type }], body: fs.readFileSync(file).toString('base64') })
      }
      const thumb = IDENTS && url.pathname.match(/^\/api\/fillers\/(\d+)\/thumb$/)
      const swap = thumb && path.join(IDENTS, `${thumb[1]}.jpg`)
      if (swap && fs.existsSync(swap)) {
        return page.send('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [{ name: 'Content-Type', value: 'image/jpeg' }], body: fs.readFileSync(swap).toString('base64') })
      }
      if ((hiding() || Object.keys(LOOKS).length || WEB) && url.pathname.startsWith('/api/') && url.pathname !== '/api/events') {
        const res = await fetch(url)
        const type = res.headers.get('content-type') ?? ''
        let body = Buffer.from(await res.arrayBuffer())
        if (type.includes('json')) {
          let data = prune(JSON.parse(body.toString()), url.pathname === '/api/logos')
          if (url.pathname === '/api/fillers') for (const r of data) if (LOOKS[r.id]) r.style = LOOKS[r.id]
          // The version the pages are from, when they're this checkout's.
          if (WEB && url.pathname === '/api/health') data.version = VERSION
          body = Buffer.from(JSON.stringify(data))
        }
        return page.send('Fetch.fulfillRequest', { requestId, responseCode: res.status, responseHeaders: type ? [{ name: 'Content-Type', value: type }] : [], body: body.toString('base64') })
      }
    } catch (e) {
      console.log(`    ${url.pathname}: ${e.message}`)
    }
    return go()
  })
}

const list = SHOTS.filter((s) => s.name.includes(only))
const browser = await launch({ port: 9336 })
const page = await browser.newPage({ width: DESK.w, height: DESK.h, dpr: DESK.dpr })
await guard(browser, page)
await page.goto(BASE + '/')
await sleep(2500)
for (const s of list) {
  const size = s.size ?? DESK
  await page.size(size.w, size.h, size.dpr, !!size.mobile)
  await page.goto('about:blank')
  await page.goto(BASE + s.url)
  await page.until(settle, { timeout: 45000 }).catch(() => {})
  await sleep(1200)
  for (const js of s.run ?? []) {
    await page.eval(js).catch((e) => console.log(`  ${s.name}: ${e.message}`))
    await sleep(700)
  }
  if (s.type) {
    for (const ch of s.type) {
      await page.send('Input.dispatchKeyEvent', { type: 'keyDown', text: ch, key: ch })
      await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ch })
      await sleep(60)
    }
  }
  await sleep(s.pre ?? 0)
  for (const k of s.keys ?? []) {
    await page.send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: k })
    await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key: k })
  }
  await sleep(s.wait ?? 900)
  await page.until(imagesLoaded, { timeout: 8000 }).catch(() => {})
  await page.shot(path.join(OUT, `${s.name}.png`))
  console.log(`  ${s.name}`)
}
await browser.close()

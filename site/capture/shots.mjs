// Screenshots of the demo instance for the website, at 2x: each page as it
// opens, scrolled to what it's showing off, with any menu or dialog opened.
//
//   DEMO_DIR=… MOSAIC=http://localhost:8830 node site/demo/shots.mjs [name-filter]

import path from 'node:path'
import { launch, sleep } from './cdp.mjs'

const DEMO = process.env.DEMO_DIR
const BASE = process.env.MOSAIC ?? 'http://localhost:8830'
const OUT = path.join(DEMO, 'shots')
const only = process.argv[2] ?? ''

const DESK = { w: 1600, h: 1000, dpr: 2 }
const PHONE = { w: 390, h: 844, dpr: 3, mobile: true }

// Helpers run in the page.
const settle = `new Promise((r) => setTimeout(r, 300)).then(() => document.fonts.ready).then(() => !document.querySelector('.animate-pulse'))`
const imagesLoaded = `[...document.images].filter((i) => i.getBoundingClientRect().top < innerHeight).every((i) => i.complete)`
const scrollToText = (text, offset = 90) =>
  `(() => { const el = [...document.querySelectorAll('h1,h2,h3,h4,div,span,p,button,label')].find((e) => e.childElementCount < 3 && e.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; const y = el.getBoundingClientRect().top + scrollY - ${offset}; window.scrollTo({ top: y, behavior: 'instant' }); document.querySelectorAll('*').forEach((n) => { if (n.scrollHeight > n.clientHeight + 40 && getComputedStyle(n).overflowY.match(/auto|scroll/) && n.contains(el)) n.scrollTop += el.getBoundingClientRect().top - n.getBoundingClientRect().top - ${offset} }); return true })()`
const click = (text, sel = 'button,a,[role=button],[role=tab],[role=menuitem]') =>
  `(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}) || e.getAttribute('aria-label') === ${JSON.stringify(text)}); if (!el) return false; el.click(); return true })()`

const SHOTS = [
  { name: 'dashboard', url: '/' },
  { name: 'dashboard-guide', url: '/', run: [scrollToText('Coming up', 120)] },
  { name: 'channels', url: '/channels' },
  { name: 'channels-guide', url: '/channels#guide', wait: 1500 },
  { name: 'toons-schedule', url: '/channels/1#schedule' },
  { name: 'toons-blocks', url: '/channels/1#schedule', run: [scrollToText('Time blocks', 100)] },
  { name: 'toons-breaks', url: '/channels/1#breaks' },
  { name: 'toons-breaks-map', url: '/channels/1#breaks', run: [scrollToText('Idents', 100)] },
  { name: 'toons-guide', url: '/channels/1#guide' },
  { name: 'toons-weeks', url: '/channels/1#guide', run: [click('Weeks ahead')], wait: 3000 },
  { name: 'toons-collections', url: '/channels/1#collections' },
  { name: 'toons-general', url: '/channels/1#general' },
  { name: 'toons-card', url: '/channels/1#general', run: [scrollToText('Show an', 160)], wait: 4000 },
  { name: 'hometown-card', url: '/channels/2#general', run: [scrollToText('Show an', 160)], wait: 4000 },
  { name: 'hometown-schedule', url: '/channels/2#schedule' },
  { name: 'fm-general', url: '/channels/8#general', run: [scrollToText('Music', 100)] },
  { name: 'retro-collections', url: '/channels/5#collections' },
  { name: 'fright-collections', url: '/channels/6#collections' },
  { name: 'playback-orders', url: '/channels/1#collections', run: [`[...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Settings').click()`], wait: 2500 },
  { name: 'studio-logo', url: '/studio#images', run: [click('Mosaic Toons', 'button,[role=button],li,div[tabindex]')], wait: 3500 },
  { name: 'settings-watermark', url: '/settings#channels', run: [scrollToText('Default watermark', 90)], wait: 3500 },
  { name: 'library', url: '/library' },
  { name: 'tv-home', url: '/library/1' },
  { name: 'tv-all', url: '/library/1?view=all' },
  { name: 'movies-all', url: '/library/2?view=all' },
  { name: 'movies-home', url: '/library/2' },
  { name: 'show-comet', url: '/library/1/show/Captain%20Comet' },
  { name: 'show-comet-episodes', url: '/library/1/show/Captain%20Comet', run: [scrollToText('Season 1', 80)] },
  { name: 'show-comet-group', url: '/library/1/show/Captain%20Comet', run: [scrollToText('Season 1', 80), click('Group broadcast episodes')], wait: 1800 },
  { name: 'show-dino', url: '/library/1/show/Dino%20Dudes', run: [scrollToText('Season 1', 80)] },
  { name: 'show-dino-group', url: '/library/1/show/Dino%20Dudes', run: [scrollToText('Season 1', 80), click('Group broadcast episodes')], wait: 1800 },
  { name: 'show-penguin', url: '/library/1/show/Professor%20Penguin', run: [scrollToText('Season 1', 100)] },
  { name: 'show-maple', url: '/library/1/show/Maple%20Street' },
  { name: 'movie-drivein', url: '/library/2/movie/91' },
  { name: 'movie-arcade', url: '/library/2/movie/96' },
  { name: 'movie-arcade-cast', url: '/library/2/movie/96', run: [scrollToText('Cast', 100)] },
  { name: 'music-home', url: '/library/4' },
  { name: 'music-artist', url: '/library/4/artist/Velvet%20Signal' },
  { name: 'music-album', url: '/library/4/artist/Velvet%20Signal?album=Afterglow' },
  { name: 'mv-home', url: '/library/3' },
  { name: 'studio', url: '/studio#images' },
  { name: 'studio-audio', url: '/studio#audio' },
  { name: 'settings-streaming', url: '/settings#streaming' },
  { name: 'settings-encoding', url: '/settings#encoding' },
  { name: 'settings-metadata', url: '/settings#metadata' },
  { name: 'settings-channels', url: '/settings#channels' },
  { name: 'logs', url: '/logs' },
  { name: 'palette', url: '/', run: [`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))`], type: 'harbor', wait: 1800 },
  { name: 'live-tv-setup', url: '/', run: [click('Live TV setup')], wait: 1200 },
  { name: 'bell', url: '/', run: [`[...document.querySelectorAll('button')].find((b) => /notification|activity/i.test(b.getAttribute('aria-label') ?? '')).click()`], wait: 3000 },
  { name: 'watch', url: '/watch/7', wait: 11000 },
  { name: 'watch-guide', url: '/watch/7', wait: 3000, pre: 9000, keys: ['g'] },
  { name: 'phone-dashboard', url: '/', size: PHONE },
  { name: 'phone-channels', url: '/channels', size: PHONE },
  { name: 'phone-show', url: '/library/1/show/Captain%20Comet', size: PHONE },
  { name: 'phone-watch', url: '/watch/7', size: PHONE, wait: 5500 },
  { name: 'phone-breaks', url: '/channels/1#breaks', size: PHONE },
]

const list = SHOTS.filter((s) => s.name.includes(only))
const browser = await launch({ port: 9336 })
const page = await browser.newPage({ width: DESK.w, height: DESK.h, dpr: DESK.dpr })
await page.goto(BASE + '/')
await sleep(2500)
await page.shot(path.join(OUT, '_warmup.png'))
for (const s of list) {
  const size = s.size ?? DESK
  await page.size(size.w, size.h, size.dpr, !!size.mobile)
  await page.goto('about:blank')
  await page.goto(BASE + s.url)
  await page.until(settle, { timeout: 20000 }).catch(() => {})
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

// Draws every picture the demo library needs and writes them under
// $DEMO_DIR/art: posters, backdrops and episode stills for the TMDB stand-in,
// frames for media.mjs to turn into video, cast portraits, album covers,
// artist pictures, ad frames and the channels' logos.
//
//   DEMO_DIR=… node site/demo/art.mjs [filter]

import fs from 'node:fs'
import path from 'node:path'
import { launch } from './cdp.mjs'
import { ADS, ALBUMS, ARTISTS, CHANNELS, MOVIES, PEOPLE, SHOWS } from './catalog.mjs'
import * as D from './draw.mjs'
import { SCENES } from './scenes.mjs'

const DEMO = process.env.DEMO_DIR
if (!DEMO) throw new Error('Set DEMO_DIR')
const ART = path.join(DEMO, 'art')
const only = process.argv[2] ?? ''

const FONTS = [
  'Luckiest Guy', 'Bungee', 'Bungee Shade', 'Fredoka:wght@600;700', 'Russo One', 'Yellowtail', 'Lobster', 'Alfa Slab One',
  'Oswald:wght@500;700', 'Limelight', 'Audiowide', 'Tilt Neon', 'Creepster', 'Nosifer', 'Special Elite', 'IM Fell English SC',
  'Chewy', 'Shrikhand', 'Playfair Display:ital,wght@1,800', 'Bodoni Moda:ital,wght@1,700', 'Monoton', 'Rubik Mono One',
  'Righteous', 'Syne:wght@800', 'Abril Fatface', 'Pacifico', 'Bebas Neue', 'Barlow Condensed:wght@500;600;700', 'Inter:wght@400;600;800',
]
const fontLink = `https://fonts.googleapis.com/css2?${FONTS.map((f) => `family=${f.replace(/ /g, '+')}`).join('&')}&display=block`
const page = (body, css = '') => `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="${fontLink}"><style>
*{box-sizing:border-box;margin:0;padding:0}html,body{background:transparent;overflow:hidden}
.full{position:absolute;inset:0}.full>svg{width:100%;height:100%;display:block}${css}</style></head><body>${body}</body></html>`

// ── Posters ─────────────────────────────────────────────────────────────────
// How each look sets its title.
const TITLE = {
  space: { font: 'Luckiest Guy', size: 150, color: '#ffe066', stroke: '#2a0f5a', shadow: '0 12px 0 #2a0f5a', tilt: -4, at: 'top' },
  dino: { font: 'Bungee', size: 140, color: '#7dff6a', stroke: '#3b1f45', shadow: '0 10px 0 #3b1f45', tilt: -3, at: 'top' },
  arctic: { font: 'Fredoka', weight: 700, size: 120, color: '#ffffff', stroke: '#1d2433', shadow: '0 8px 0 #2fa7ff', at: 'top' },
  mecha: { font: 'Russo One', size: 130, color: '#e8f7ff', stroke: '#ff3b5c', shadow: '0 0 30px #5ad1ff', at: 'top', upper: true, spacing: 4 },
  suburb: { font: 'Yellowtail', size: 170, color: '#fff8ee', stroke: '#b8321a', shadow: '0 8px 24px rgba(0,0,0,.35)', at: 'top' },
  diner: { font: 'Lobster', size: 140, color: '#ffd1ec', stroke: '#7a1a4a', shadow: '0 0 30px #ff4fa3', at: 'top' },
  culdesac: { font: 'Alfa Slab One', size: 118, color: '#ffffff', stroke: '#2f6fd6', shadow: '0 8px 0 #1d3b6e', at: 'top' },
  harbor: { font: 'Oswald', weight: 700, size: 150, color: '#fff4e6', shadow: '0 6px 30px rgba(0,0,0,.5)', at: 'bottom', upper: true, spacing: 10 },
  noir: { font: 'Limelight', size: 120, color: '#f2f2f2', shadow: '0 0 40px rgba(255,255,255,.35)', at: 'bottom', upper: true, spacing: 6 },
  synth: { font: 'Audiowide', size: 120, color: 'chrome', shadow: '0 0 30px #ff3fd0', at: 'top', upper: true, spacing: 6 },
  neon: { font: 'Tilt Neon', size: 140, color: '#ffd1f4', shadow: '0 0 18px #ff4fd8, 0 0 40px #ff4fd8', at: 'top', upper: true, spacing: 8 },
  drivein: { font: 'Creepster', size: 128, color: '#b8ff5a', stroke: '#1a0a2a', shadow: '0 0 30px #7aff3a', at: 'bottom' },
  pumpkin: { font: 'Nosifer', size: 92, color: '#ff8a1d', shadow: '0 0 30px #ff4a00', at: 'top', upper: true },
  lake: { font: 'Special Elite', size: 150, color: '#e8f4ff', shadow: '0 0 30px rgba(160,200,230,.6)', at: 'bottom', upper: true, spacing: 14 },
  creek: { font: 'IM Fell English SC', size: 150, color: '#ffd8c8', shadow: '0 0 30px #ff3a1a', at: 'top' },
  backyard: { font: 'Chewy', size: 160, color: '#ffe066', stroke: '#1d3b6e', shadow: '0 10px 0 #1d3b6e', tilt: -5, at: 'top' },
  mall: { font: 'Shrikhand', size: 120, color: '#ffe39a', stroke: '#3a1a5e', shadow: '0 8px 0 #3a1a5e', at: 'top' },
  lighthouse: { font: 'Playfair Display', style: 'italic', weight: 800, size: 140, color: '#fff4dc', shadow: '0 0 30px rgba(255,240,190,.5)', at: 'bottom' },
  rooftop: { font: 'Bodoni Moda', style: 'italic', weight: 700, size: 136, color: '#fff0e0', shadow: '0 6px 30px rgba(60,0,60,.6)', at: 'top' },
}

function titleCss(t) {
  const fill =
    t.color === 'chrome'
      ? 'background:linear-gradient(180deg,#fff 0%,#a8e8ff 45%,#3a2a8a 50%,#ff8ad8 75%,#fff 100%);-webkit-background-clip:text;background-clip:text;color:transparent;'
      : `color:${t.color};`
  return `font-family:'${t.font}';font-size:${t.size}px;${t.weight ? `font-weight:${t.weight};` : ''}${t.style ? `font-style:${t.style};` : ''}${fill}${t.stroke ? `-webkit-text-stroke:${Math.round(t.size / 16)}px ${t.stroke};paint-order:stroke fill;` : ''}text-shadow:${t.shadow ?? 'none'};${t.upper ? 'text-transform:uppercase;' : ''}${t.spacing ? `letter-spacing:${t.spacing}px;` : ''}${t.tilt ? `transform:rotate(${t.tilt}deg);` : ''}`
}

function poster(item, kind) {
  const t = TITLE[item.look]
  const scene = SCENES[item.look](1000, 1500, D.hash(item.slug + 'poster')).svg({ mono: item.look === 'noir' })
  const names = kind === 'movie' ? item.cast : item.cast.map((c) => c[0])
  const credit =
    kind === 'movie'
      ? `${item.studio.toUpperCase()} PRESENTS · A ${item.director.toUpperCase()} FILM · STARRING ${names.join(' · ').toUpperCase()} · RATED ${item.cert}`
      : `${item.network.toUpperCase()} · CREATED BY ${item.creator.toUpperCase()} · STARRING ${names.join(' · ').toUpperCase()}`
  const top = t.at === 'top'
  return page(
    `<div class="full">${scene}</div><div class="shade ${top ? 'top' : 'bottom'}"></div>
<div class="tag">${D.esc(item.tagline)}</div>
<div class="title ${top ? 'at-top' : 'at-bottom'}"><span style="${titleCss(t)}">${D.esc(item.title)}</span></div>
<div class="billing">${D.esc(credit)}</div>
<div class="date">${kind === 'movie' ? `IN THEATERS ${item.year}` : `${item.network.toUpperCase()} · SINCE ${item.year}`}</div>`,
    `.shade{position:absolute;left:0;right:0;height:52%}.shade.top{top:0;background:linear-gradient(180deg,rgba(0,0,0,.55),transparent)}.shade.bottom{bottom:0;background:linear-gradient(0deg,rgba(0,0,0,.85),transparent)}
.tag{position:absolute;top:44px;left:0;right:0;text-align:center;font:600 26px 'Barlow Condensed';letter-spacing:6px;text-transform:uppercase;color:rgba(255,255,255,.88);text-shadow:0 2px 8px rgba(0,0,0,.6);padding:0 60px}
.title{position:absolute;left:40px;right:40px;text-align:center;line-height:.95}.title span{display:inline-block}.at-top{top:110px}.at-bottom{bottom:210px}
.billing{position:absolute;bottom:92px;left:70px;right:70px;text-align:center;font:500 21px/1.25 'Barlow Condensed';letter-spacing:1.5px;color:rgba(255,255,255,.72);transform:scaleY(1.35)}
.date{position:absolute;bottom:40px;left:0;right:0;text-align:center;font:700 26px 'Barlow Condensed';letter-spacing:8px;color:#fff;text-shadow:0 2px 8px rgba(0,0,0,.6)}`,
  )
}

const scenePage = (look, w, h, seed, opts = {}) =>
  page(`<div class="full">${(look === 'stage' ? SCENES.stage(w, h, seed, opts.hue) : SCENES[look](w, h, seed)).svg({ mono: look === 'noir' })}</div>`)

// ── Cast portraits ──────────────────────────────────────────────────────────
function portrait(name) {
  const r = D.rng(D.hash(name))
  const skin = r.pick(['#f6d3b3', '#e9b48f', '#c98d63', '#a8693f', '#7a4a2a', '#5a3620', '#f1c6a0'])
  const hair = r.pick(['#1b1410', '#3a2618', '#6b3f1f', '#b5782f', '#e0c27a', '#8a8a8a', '#2a1a40', '#a33a2a'])
  const bg = r.range(0, 360)
  const shirt = D.hsl(r.range(0, 360), 45, 42)
  const style = r.int(0, 4)
  const hairBack = style === 1 ? `<path d="M118 150Q100 330 130 400L370 400Q400 330 382 150Z" fill="${hair}"/>` : style === 3 ? `<circle cx="250" cy="148" r="132" fill="${hair}"/>` : ''
  const hairTop =
    style === 0 ? `<path d="M140 190Q150 70 250 72Q350 70 360 190Q330 120 250 124Q170 120 140 190Z" fill="${hair}"/>`
    : style === 1 ? `<path d="M132 220Q130 70 250 70Q370 70 368 220Q340 120 250 110Q160 120 132 220Z" fill="${hair}"/>`
    : style === 2 ? `<path d="M150 170Q170 90 250 92Q330 90 350 170Q300 130 250 140Q200 130 150 170Z" fill="${hair}"/><circle cx="250" cy="66" r="40" fill="${hair}"/>`
    : style === 3 ? `<path d="M140 200Q140 80 250 80Q360 80 360 200Q320 140 250 140Q180 140 140 200Z" fill="${hair}"/>`
    : `<path d="M160 150Q250 110 340 150Q330 120 250 116Q170 120 160 150Z" fill="${hair}" opacity=".6"/>`
  const glasses = r() < 0.25 ? `<g fill="none" stroke="#1b1b1b" stroke-width="7"><circle cx="208" cy="236" r="30"/><circle cx="292" cy="236" r="30"/><path d="M238 236h24"/></g>` : ''
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 750" width="500" height="750">
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${D.hsl(bg, 55, 72)}"/><stop offset="1" stop-color="${D.hsl(bg + 30, 50, 52)}"/></linearGradient></defs>
<rect width="500" height="750" fill="url(#bg)"/><circle cx="250" cy="300" r="230" fill="#fff" opacity=".12"/>
${hairBack}
<path d="M40 750Q50 520 250 500Q450 520 460 750Z" fill="${shirt}"/><path d="M200 470L300 470L292 540Q250 570 208 540Z" fill="${skin}"/>
<path d="M190 520Q250 600 310 520" fill="none" stroke="${D.hsl(r.range(0, 360), 40, 85)}" stroke-width="16"/>
<ellipse cx="250" cy="250" rx="112" ry="136" fill="${skin}"/>
<ellipse cx="138" cy="262" rx="18" ry="28" fill="${skin}"/><ellipse cx="362" cy="262" rx="18" ry="28" fill="${skin}"/>
${hairTop}
<circle cx="208" cy="238" r="9" fill="#1b1b1b"/><circle cx="292" cy="238" r="9" fill="#1b1b1b"/>
<path d="M188 206Q208 196 226 204M274 204Q292 196 312 206" stroke="${hair}" stroke-width="8" fill="none" stroke-linecap="round"/>
<path d="M250 252Q244 284 254 290" stroke="#000" stroke-opacity=".18" stroke-width="6" fill="none" stroke-linecap="round"/>
<path d="M212 318Q250 346 288 318" stroke="#7a2a2a" stroke-width="8" fill="none" stroke-linecap="round"/>
<circle cx="190" cy="296" r="18" fill="#ff7a7a" opacity=".18"/><circle cx="310" cy="296" r="18" fill="#ff7a7a" opacity=".18"/>
${glasses}
</svg>`
  return page(`<div class="full">${svg}</div>`)
}

// ── Album covers ────────────────────────────────────────────────────────────
function albumCover(a) {
  const artist = ARTISTS.find((x) => x.name === a.artist)
  const hue = artist?.hue ?? 200
  const font = artist?.font ?? 'Bebas Neue'
  const r = D.rng(D.hash(a.title))
  const S = new D.Scene(1000, 1000)
  let art = ''
  if (a.title === 'Afterglow') {
    S.add(D.sky(S, [[0, '#1a0630'], [0.6, '#b0306a'], [1, '#ffb36b']]), D.bandedSun(S, 500, 560, 300, '#ffe9a0', '#ff3f8e', 9))
    S.add(D.ridge(S, r, 760, 80, '#2a0a3a', { peaks: 5 }))
  } else if (a.title === 'Low Orbit') {
    S.add(D.sky(S, [[0, '#04060f'], [1, '#14233f']]), D.stars(S, r, 260, 1))
    S.add(D.planet(S, 500, 620, 240, '#9fd8ff', '#1d3b8a', { ring: true, ringColor: '#ffffff', tilt: -14 }))
    S.add(`<circle cx="760" cy="300" r="10" fill="#fff"/><ellipse cx="500" cy="620" rx="420" ry="120" fill="none" stroke="#fff" stroke-dasharray="4 14" opacity=".5" transform="rotate(-14 500 620)"/>`)
  } else if (a.title === 'Coastal Drive') {
    S.add(D.sky(S, [[0, '#ff8fb1'], [0.5, '#ffc48a'], [1, '#7fd6e8']]), D.orb(S, 500, 470, 180, '#fff4d0', '#ff9a6b', '#ffcf9a', 1.7))
    S.add(D.water(S, r, 600, '#4fb6d6', '#1a6a9a', '#fff4d0', 500, { streaks: 40 }))
    S.add(`<rect x="0" y="880" width="1000" height="120" fill="#3a2a4a"/><path d="M0 940H1000" stroke="#ffd27a" stroke-width="6" stroke-dasharray="50 40"/>`, D.palm(150, 1000, 1.7, '#2a1a3a', 0.15), D.palm(880, 1000, 1.5, '#2a1a3a', -0.1), D.car(330, 935, 1.3, '#f4f1ea'))
  } else if (a.title === 'Last Stop') {
    S.add(D.sky(S, [[0, '#0a0a14'], [1, '#1a1a2a']]))
    const b = D.blur(18)
    S.use(b)
    for (let i = 0; i < 40; i++) S.add(`<circle cx="${r() * 1000}" cy="${r() * 1000}" r="${r.range(20, 70)}" fill="${r.pick(['#ff3f3f', '#ffd36b', '#4ff0ff', '#ff9a3a'])}" opacity="${r.range(0.2, 0.6)}" filter="${b.url}"/>`)
    S.add(D.rain(S, r, 300, '#cfe8ff', 0.4, 0.05), `<rect x="60" y="60" width="880" height="880" rx="60" fill="none" stroke="#000" stroke-width="80" opacity=".85"/>`)
  } else {
    S.add(D.sky(S, [[0, '#f2e6d0'], [1, '#e2c9a0']]))
    art = `<g transform="translate(500 520)"><rect x="-360" y="-220" width="720" height="440" rx="40" fill="#1b1b24"/><rect x="-300" y="-170" width="600" height="170" rx="16" fill="#f4f1ea"/><rect x="-300" y="-170" width="600" height="50" fill="#ff5a3a"/><rect x="-300" y="-120" width="600" height="20" fill="#ffb03a"/><circle cx="-150" cy="70" r="70" fill="#f4f1ea"/><circle cx="150" cy="70" r="70" fill="#f4f1ea"/><circle cx="-150" cy="70" r="26" fill="#1b1b24"/><circle cx="150" cy="70" r="26" fill="#1b1b24"/><rect x="-80" y="40" width="160" height="60" fill="#3a3a48"/></g>`
  }
  const dark = a.title !== 'Mosaic Mixtape Vol. 1'
  return page(
    `<div class="full">${S.svg({ grain: 0.12, vignette: 0.3 })}</div><div class="full">${art ? `<svg viewBox="0 0 1000 1000" width="1000" height="1000">${art}</svg>` : ''}</div>
<div class="a" style="font-family:'${font}';color:${dark ? '#fff' : '#1b1b24'}">${D.esc(a.artist)}</div>
<div class="t" style="color:${dark ? D.hsl(hue, 90, 85) : '#ff5a3a'}">${D.esc(a.title)}</div>`,
    `.a{position:absolute;top:56px;left:60px;right:60px;font-size:74px;line-height:1;text-shadow:0 4px 18px rgba(0,0,0,.35)}.t{position:absolute;bottom:56px;left:60px;right:60px;font:700 46px 'Barlow Condensed';letter-spacing:10px;text-transform:uppercase;text-align:right}`,
  )
}

// ── Ads ─────────────────────────────────────────────────────────────────────
const PROPS = {
  can: (c) => `<g transform="translate(0 30)"><rect x="-110" y="-200" width="220" height="400" rx="40" fill="${c}"/><rect x="-110" y="-200" width="220" height="40" rx="20" fill="#d9dde3"/><rect x="-110" y="160" width="220" height="40" rx="20" fill="#d9dde3"/><text x="0" y="40" text-anchor="middle" font-family="Lobster" font-size="74" fill="#fff" transform="rotate(-8)">Fizz</text><path d="M-110 -80Q0 -20 110 -80" stroke="#fff" stroke-width="10" fill="none"/></g>`,
  cereal: (c) => `<g><rect x="-150" y="-230" width="300" height="430" rx="10" fill="${c}"/><circle cx="0" cy="-30" r="90" fill="#ffe066"/><circle cx="-30" cy="-50" r="16" fill="#fff"/><text x="0" y="-150" text-anchor="middle" font-family="Bungee" font-size="44" fill="#fff">GALAXY</text><text x="0" y="140" text-anchor="middle" font-family="Bungee" font-size="44" fill="#ffe066">CRUNCH</text>${Array.from({ length: 12 }, (_, i) => `<circle cx="${-120 + (i % 4) * 80}" cy="${200 + Math.floor(i / 4) * 30}" r="0"/>`).join('')}</g>`,
  kart: (c) => `<g transform="scale(1.6)"><path d="M-140 0L-120 -50L40 -60L80 -100L120 -100L130 -40L150 0Z" fill="${c}"/><circle cx="-90" cy="10" r="34" fill="#1b1b24"/><circle cx="100" cy="10" r="34" fill="#1b1b24"/><circle cx="20" cy="-90" r="26" fill="#ffe066"/><path d="M-170 -30L-200 -30M-170 -10L-220 -10" stroke="#fff" stroke-width="8"/></g>`,
  sneaker: (c) => `<g transform="scale(1.7)"><path d="M-150 20L-140 -60Q-80 -70 -40 -110L20 -90Q40 -40 120 -30Q160 -20 160 20Z" fill="${c}"/><rect x="-160" y="14" width="330" height="22" rx="10" fill="#fff"/><path d="M-40 -100L-10 -60M-20 -106L10 -66M0 -98L30 -58" stroke="#fff" stroke-width="7"/><circle cx="-110" cy="26" r="8" fill="#ffe066"/><circle cx="-60" cy="26" r="8" fill="#4ff0ff"/><circle cx="-10" cy="26" r="8" fill="#ff4fd8"/></g>`,
  carton: (c) => `<g><path d="M-120 -160L0 -240L120 -160L120 220L-120 220Z" fill="#fff"/><path d="M-120 -160L0 -240L120 -160Z" fill="#ffe8b0"/><circle cx="0" cy="20" r="90" fill="${c}"/><path d="M-30 -80Q0 -110 30 -80" stroke="#3d6b2a" stroke-width="10" fill="none"/></g>`,
  handheld: (c) => `<g><rect x="-140" y="-230" width="280" height="460" rx="36" fill="${c}"/><rect x="-100" y="-190" width="200" height="170" rx="10" fill="#9bbc0f"/><rect x="-70" y="-160" width="40" height="40" fill="#306230"/><rect x="10" y="-110" width="50" height="50" fill="#306230"/><path d="M-70 60h60M-40 30v60" stroke="#1b1b24" stroke-width="22"/><circle cx="50" cy="70" r="20" fill="#a3324a"/><circle cx="95" cy="40" r="20" fill="#a3324a"/></g>`,
  mall: (c) => `<g><rect x="-300" y="-120" width="600" height="240" fill="#f4f1ea"/><rect x="-300" y="-150" width="600" height="40" fill="${c}"/>${Array.from({ length: 6 }, (_, i) => `<rect x="${-270 + i * 92}" y="-80" width="70" height="200" fill="#ffe7a8"/>`).join('')}<path d="M-340 -150L0 -260L340 -150Z" fill="${c}"/></g>`,
  skate: (c) => `<g transform="scale(1.5)"><path d="M-100 -150L-40 -150L-30 -40Q60 -40 100 -10L100 20L-110 20Z" fill="${c}"/><rect x="-120" y="20" width="240" height="14" fill="#1b1b24"/><circle cx="-80" cy="50" r="22" fill="#ffe066"/><circle cx="80" cy="50" r="22" fill="#ffe066"/></g>`,
}
function adFrame(ad, frame) {
  const c = D.hsl(ad.hue, 80, 55)
  const r = D.rng(D.hash(ad.slug + frame))
  let burst = ''
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2
    burst += `<path d="M960 540L${960 + Math.cos(a) * 1400} ${540 + Math.sin(a) * 1400}L${960 + Math.cos(a + 0.13) * 1400} ${540 + Math.sin(a + 0.13) * 1400}Z" fill="#fff" opacity=".08"/>`
  }
  const bg = `<svg viewBox="0 0 1920 1080" width="1920" height="1080"><defs><radialGradient id="g"><stop offset="0" stop-color="${D.hsl(ad.hue, 85, 62)}"/><stop offset="1" stop-color="${D.hsl(ad.hue + 30, 70, 28)}"/></radialGradient></defs><rect width="1920" height="1080" fill="url(#g)"/>${burst}${Array.from({ length: 30 }, () => `<circle cx="${r() * 1920}" cy="${r() * 1080}" r="${r.range(4, 14)}" fill="#fff" opacity="${r.range(0.15, 0.5)}"/>`).join('')}
<g transform="translate(${frame ? 1360 : 620} 560)">${PROPS[ad.prop](frame ? D.hsl(ad.hue + 180, 70, 55) : c)}</g></svg>`
  const text = frame
    ? `<div class="b" style="left:120px;top:300px;text-align:left">${D.esc(ad.brand)}</div><div class="l" style="left:120px;top:560px">${D.esc(ad.line)}</div>`
    : `<div class="b" style="right:120px;top:360px;text-align:right">${D.esc(ad.brand)}</div><div class="l" style="right:120px;top:620px;text-align:right">${D.esc(ad.line)}</div>`
  return page(
    `<div class="full">${bg}</div>${text}`,
    `.b{position:absolute;font:400 150px/1 'Luckiest Guy';color:#fff;-webkit-text-stroke:8px rgba(0,0,0,.35);paint-order:stroke fill;text-shadow:0 10px 0 rgba(0,0,0,.25);max-width:1000px}.l{position:absolute;font:700 62px 'Barlow Condensed';color:#fff;letter-spacing:3px;text-transform:uppercase;text-shadow:0 4px 12px rgba(0,0,0,.4);max-width:900px}`,
  )
}

// ── Channel logos ───────────────────────────────────────────────────────────
// Each logo sits in #logo; the render crops to it, with a transparent background.
const LOGOS = {
  'mosaic-toons': `<div id="logo" style="text-align:center;padding:20px"><div style="display:inline-block;background:#ff5a1f;color:#fff;font:400 44px 'Luckiest Guy';letter-spacing:6px;padding:8px 26px 2px;border-radius:40px;border:6px solid #2a0f5a;transform:rotate(-3deg)">MOSAIC</div><div style="font:400 150px/0.95 'Luckiest Guy';color:#ffd23f;-webkit-text-stroke:12px #2a0f5a;paint-order:stroke fill;text-shadow:0 10px 0 #2a0f5a;letter-spacing:4px">TOONS</div></div>`,
  hometown: `<div id="logo" style="display:flex;align-items:center;gap:18px;padding:20px"><svg width="120" height="120" viewBox="0 0 120 120"><path d="M14 58L60 18L106 58V106H14Z" fill="#2fbf71" stroke="#fff" stroke-width="8" stroke-linejoin="round"/><rect x="48" y="66" width="24" height="40" fill="#fff"/></svg><div style="font:400 120px/1 'Yellowtail';color:#fff;text-shadow:0 4px 0 #1b7a4a,0 0 24px rgba(0,0,0,.35)">Hometown</div></div>`,
  'midnight-movies': `<div id="logo" style="display:flex;align-items:center;gap:22px;padding:20px"><svg width="130" height="130" viewBox="0 0 130 130"><circle cx="65" cy="65" r="58" fill="#1d2a5a" stroke="#cfe0ff" stroke-width="6"/><path d="M84 30A40 40 0 1 0 98 92A32 32 0 1 1 84 30Z" fill="#ffe9a0"/></svg><div style="font:700 70px/0.92 'Oswald';color:#eef4ff;letter-spacing:10px;text-shadow:0 0 20px rgba(120,160,255,.6)">MIDNIGHT<br><span style="color:#9fc0ff">MOVIES</span></div></div>`,
  'nite-owl': `<div id="logo" style="display:flex;align-items:center;gap:18px;padding:20px"><svg width="140" height="120" viewBox="0 0 140 120"><path d="M10 20L40 40H100L130 20L120 70Q120 112 70 112Q20 112 20 70Z" fill="#5a3fa0" stroke="#ffd36b" stroke-width="5"/><circle cx="48" cy="66" r="22" fill="#ffd36b"/><circle cx="92" cy="66" r="22" fill="#ffd36b"/><circle cx="48" cy="66" r="9" fill="#1a1030"/><circle cx="92" cy="66" r="9" fill="#1a1030"/><path d="M64 84L70 96L76 84Z" fill="#ff9a3a"/></svg><div style="font:400 96px/1 'Limelight';color:#ffd36b;text-shadow:0 0 18px rgba(255,211,107,.5)">Nite Owl</div></div>`,
  'retro-rewind': `<div id="logo" style="text-align:left;padding:20px;line-height:.9"><div style="font:400 110px 'Monoton';background:linear-gradient(180deg,#fff,#7ff3ff 48%,#2a1a6a 52%,#ff6fd8);-webkit-background-clip:text;color:transparent">RETRO</div><div style="font:400 64px 'Rubik Mono One';color:#ff4fd8;letter-spacing:4px;text-shadow:0 0 18px #ff4fd8">◀◀ REWIND</div></div>`,
  'fright-night': `<div id="logo" style="text-align:center;padding:20px;line-height:.85"><div style="font:400 120px 'Creepster';color:#ff7a1a;text-shadow:0 0 22px #ff3a00,0 6px 0 #2a0a00;letter-spacing:6px">FRIGHT</div><div style="font:400 120px 'Creepster';color:#b8ff5a;text-shadow:0 0 22px #5aff2a,0 6px 0 #0a2a00;letter-spacing:6px">NIGHT</div></div>`,
  'harbor-44': `<div id="logo" style="display:flex;align-items:center;gap:18px;padding:20px"><svg width="150" height="150" viewBox="0 0 150 150"><circle cx="75" cy="75" r="68" fill="#0f3a5a" stroke="#7fe0ff" stroke-width="7"/><path d="M75 30V112M50 50H100M40 90Q75 128 110 90" stroke="#fff" stroke-width="9" fill="none" stroke-linecap="round"/><circle cx="75" cy="30" r="10" fill="none" stroke="#fff" stroke-width="7"/></svg><div style="font:700 92px/1 'Oswald';color:#fff;letter-spacing:6px">HARBOR <span style="color:#7fe0ff">44</span></div></div>`,
  'mosaic-fm': `<div id="logo" style="display:flex;align-items:center;gap:16px;padding:20px"><div style="font:800 96px/1 'Inter';color:#fff;letter-spacing:-2px">mosaic</div><div style="font:800 64px/1 'Inter';color:#0b2a33;background:#4ff0e0;padding:10px 18px;border-radius:18px">FM 99</div><svg width="90" height="80" viewBox="0 0 90 80"><path d="M5 40H15L25 10L40 70L52 25L62 50L70 40H85" stroke="#4ff0e0" stroke-width="7" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg></div>`,
}

// ── Jobs ────────────────────────────────────────────────────────────────────
function jobs() {
  const out = []
  const add = (file, w, h, html, opts = {}) => out.push({ file: path.join(ART, file), w, h, html, ...opts })
  for (const s of SHOWS) {
    add(`posters/${s.slug}.jpg`, 1000, 1500, poster(s, 'show'))
    add(`backdrops/${s.slug}.jpg`, 1920, 1080, scenePage(s.look, 1920, 1080, D.hash(s.slug + 'bg')))
    const vw = s.aspect === '4:3' ? 1440 : 1920
    for (let v = 0; v < 3; v++) add(`frames/${s.slug}-${v}.jpg`, vw, 1080, scenePage(s.look, vw, 1080, D.hash(`${s.slug}frame${v}`)))
    for (const season of s.seasons)
      season.eps.forEach((_, i) => add(`stills/${s.slug}-s${season.n}e${i + 1}.jpg`, 960, 540, scenePage(s.look, 960, 540, D.hash(`${s.slug}${season.n}-${i}`))))
  }
  for (const m of MOVIES) {
    add(`posters/${m.slug}.jpg`, 1000, 1500, poster(m, 'movie'))
    add(`backdrops/${m.slug}.jpg`, 1920, 1080, scenePage(m.look, 1920, 1080, D.hash(m.slug + 'bg')))
    for (let v = 0; v < 3; v++) add(`frames/${m.slug}-${v}.jpg`, 1920, 1080, scenePage(m.look, 1920, 1080, D.hash(`${m.slug}frame${v}`)))
  }
  for (const p of PEOPLE) add(`people/${p.toLowerCase().replace(/[^a-z]+/g, '-')}.jpg`, 500, 750, portrait(p))
  for (const a of ALBUMS) add(`albums/${a.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.jpg`, 1000, 1000, albumCover(a))
  for (const a of ARTISTS) {
    const slug = a.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')
    add(`artists/${slug}.jpg`, 1000, 1000, scenePage('stage', 1000, 1000, D.hash(a.name), { hue: a.hue }))
    a.videos.forEach(([t], i) => add(`frames/mv-${slug}-${i}.jpg`, 1920, 1080, scenePage('stage', 1920, 1080, D.hash(a.name + t), { hue: a.hue + i * 25 })))
  }
  for (const ad of ADS) for (let fr = 0; fr < 2; fr++) add(`frames/ad-${ad.slug}-${fr}.jpg`, 1920, 1080, adFrame(ad, fr))
  for (const c of CHANNELS) add(`logos/${c.slug}.png`, 1200, 600, page(`<div style="display:flex;align-items:center;justify-content:center;height:600px">${LOGOS[c.slug]}</div>`), { logo: true })
  return out.filter((j) => j.file.replace(/\\/g, '/').includes(only))
}

const list = jobs()
console.log(`${list.length} pictures to draw`)
const browser = await launch({ port: 9334 })
const pages = await Promise.all([0, 1, 2, 3].map(() => browser.newPage({ width: 1000, height: 1000 })))
let done = 0
await Promise.all(
  pages.map(async (p, k) => {
    for (let i = k; i < list.length; i += pages.length) {
      const j = list[i]
      await p.size(j.w, j.h, 1)
      if (j.logo) await p.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } })
      fs.mkdirSync(path.dirname(j.file), { recursive: true })
      await p.html(j.html, path.dirname(j.file))
      let clip
      if (j.logo) {
        const b = await p.eval(`(() => { const r = document.getElementById('logo').getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } })()`)
        clip = { x: Math.floor(b.x), y: Math.floor(b.y), width: Math.ceil(b.width), height: Math.ceil(b.height) }
      }
      await p.shot(j.file, { clip, quality: 90 })
      if (j.logo) await p.send('Emulation.setDefaultBackgroundColorOverride', {})
      if (++done % 25 === 0) console.log(`  ${done}/${list.length}`)
    }
  }),
)
for (const f of fs.readdirSync(ART, { recursive: true })) if (String(f).includes('render-')) fs.rmSync(path.join(ART, f))
await browser.close()
console.log(`Drew ${done} pictures into ${ART}`)

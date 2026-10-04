// One painted scene per title "look". A scene takes its size and a seed, so
// the same look gives a poster (portrait), a backdrop (16:9) and a different
// still for every episode.

import * as D from './draw.mjs'

const { Scene, rng } = D

export const SCENES = {
  space(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    const hue = r.range(250, 290)
    s.add(D.sky(s, [[0, D.hsl(hue, 70, 8)], [0.6, D.hsl(hue - 20, 65, 16)], [1, D.hsl(hue - 40, 70, 26)]]))
    const neb = D.blur(Math.min(w, h) * 0.08)
    s.use(neb)
    for (let i = 0; i < 4; i++)
      s.add(`<ellipse cx="${r() * w}" cy="${r() * h * 0.8}" rx="${r.range(0.15, 0.4) * w}" ry="${r.range(0.08, 0.2) * h}" fill="${D.hsl(r.pick([310, 190, 270]), 80, 55)}" opacity="${r.range(0.12, 0.28)}" filter="${neb.url}"/>`)
    s.add(D.stars(s, r, Math.round((w * h) / 4500), 1, { big: 0.05 }))
    const pr = Math.min(w, h) * r.range(0.26, 0.34)
    s.add(D.planet(s, w * r.range(0.68, 0.82), h * r.range(0.62, 0.78), pr, D.hsl(r.range(15, 40), 90, 64), D.hsl(r.range(340, 360), 75, 34), { tilt: r.range(-24, -10) }))
    s.add(D.orb(s, w * r.range(0.12, 0.3), h * r.range(0.14, 0.26), Math.min(w, h) * 0.05, '#f4f1ff', '#9aa4c8', '#cfd7ff', 2.6))
    s.add(D.comet(s, w * r.range(0.5, 0.75), h * r.range(0.1, 0.22), Math.min(w, h) * 0.5, r.range(150, 170)))
    s.add(D.rocket(w * r.range(0.28, 0.42), h * r.range(0.48, 0.6), (Math.min(w, h) / 1080) * r.range(1.1, 1.4), r.range(25, 45)))
    return s
  },

  dino(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#5b2a86'], [0.45, '#f0577a'], [0.75, '#ffa45c'], [1, '#ffd37a']]))
    s.add(D.orb(s, w * r.range(0.2, 0.75), h * 0.55, Math.min(w, h) * 0.16, '#fff3c4', '#ffb347', '#ffd27a', 2.4))
    s.add(D.ridge(s, r, h * 0.62, h * 0.16, '#a24a7a', { peaks: 5, smooth: true }))
    const vx = w * r.range(0.62, 0.82)
    const vb = h * 0.66
    const vw = w * 0.22
    const vh = h * 0.36
    const smoke = D.blur(18)
    s.use(smoke)
    for (let i = 0; i < 7; i++) s.add(`<circle cx="${vx + r.range(-40, 80) + i * 18}" cy="${vb - vh - i * h * 0.05}" r="${30 + i * 14}" fill="#5a4a5a" opacity="${0.55 - i * 0.05}" filter="${smoke.url}"/>`)
    s.add(`<path d="M${vx - vw} ${vb}L${vx - vw * 0.18} ${vb - vh}L${vx + vw * 0.18} ${vb - vh}L${vx + vw} ${vb}Z" fill="#6b2f4e"/><path d="M${vx - vw * 0.18} ${vb - vh}L${vx - vw * 0.05} ${vb - vh * 0.7}L${vx + vw * 0.06} ${vb - vh * 0.82}L${vx + vw * 0.18} ${vb - vh}Z" fill="#ff7a2e"/>`)
    s.add(D.ridge(s, r, h * 0.74, h * 0.07, '#3f7a3a', { peaks: 4, smooth: true }))
    s.add(D.palm(w * 0.06, h * 0.86, (h / 1080) * 1.1, '#24452a', 0.12), D.palm(w * 0.94, h * 0.9, (h / 1080) * 1.3, '#24452a', -0.1))
    s.add(D.ground(s, h * 0.84, '#2f5d2d'))
    const k = Math.min(w, h) / 1080
    s.add(D.dino(w * r.range(0.32, 0.42), h * 0.88, k * 1.15, {}))
    s.add(D.dino(w * r.range(0.6, 0.7), h * 0.9, k * 0.95, { body: '#ff9f43', belly: '#ffe1a8', spike: '#5fd068', shades: r() < 0.5, flip: true }))
    s.add(`<path transform="translate(${w * r.range(0.15, 0.4)} ${h * 0.2}) scale(${k * 1.4})" d="M0 0L40 -14L60 -40L70 -10L120 -18L72 4L60 16Z" fill="#3b1f45"/>`)
    return s
  },

  arctic(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    const night = r() < 0.5
    s.add(D.sky(s, night ? [[0, '#06142b'], [0.6, '#123a63'], [1, '#2c6e8f']] : [[0, '#3f8fd6'], [0.6, '#8fd0f2'], [1, '#e2f6ff']]))
    if (night) {
      s.add(D.stars(s, r, 160, 0.6))
      const a = D.blur(26)
      s.use(a)
      for (let i = 0; i < 3; i++) {
        const y = h * (0.14 + i * 0.07)
        s.add(`<path d="M0 ${y}C${w * 0.25} ${y - 90} ${w * 0.5} ${y + 90} ${w} ${y - 40}" stroke="${D.hsl(150 + i * 25, 85, 60)}" stroke-width="${60 - i * 10}" fill="none" opacity="0.45" filter="${a.url}"/>`)
      }
    } else s.add(D.clouds(s, r, 4, { y0: 0.08, y1: 0.3, opacity: 0.85 }))
    s.add(D.ridge(s, r, h * 0.56, h * 0.14, night ? '#a9c6dc' : '#f4fbff', { peaks: 4, jag: 0.2 }))
    s.add(D.water(s, r, h * 0.6, night ? '#123a63' : '#2a7fb8', night ? '#05172e' : '#0c3a66', night ? null : '#ffffff', w * 0.5, { streaks: 20 }))
    for (let i = 0; i < 3; i++) {
      const x = w * (0.15 + i * 0.35) + r.range(-60, 60)
      const bw = r.range(160, 300) * (h / 1080)
      const bh = r.range(100, 200) * (h / 1080)
      s.add(`<path d="M${x - bw} ${h * 0.64}L${x - bw * 0.3} ${h * 0.64 - bh}L${x + bw * 0.2} ${h * 0.64 - bh * 0.7}L${x + bw} ${h * 0.64}Z" fill="#e9f6ff"/><path d="M${x + bw * 0.2} ${h * 0.64 - bh * 0.7}L${x + bw} ${h * 0.64}L${x} ${h * 0.64}Z" fill="#a7d0ea"/>`)
    }
    s.add(`<path d="M0 ${h * 0.8}Q${w * 0.5} ${h * 0.72} ${w} ${h * 0.8}L${w} ${h}L0 ${h}Z" fill="#f2fbff"/>`)
    const k = Math.min(w, h) / 1080
    s.add(D.penguin(w * r.range(0.4, 0.55), h * 0.93, k * 1.15))
    s.add(D.penguin(w * r.range(0.7, 0.8), h * 0.95, k * 0.55, { glasses: false, coat: false, scarf: '#2fa7ff' }))
    let snow = ''
    for (let i = 0; i < 120; i++) snow += `<circle cx="${r() * w}" cy="${r() * h}" r="${r.range(1.5, 4)}"/>`
    s.add(`<g fill="#fff" opacity="0.7">${snow}</g>`)
    return s
  },

  mecha(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#050816'], [0.55, '#1a1046'], [1, '#3a1a5e']]))
    s.add(D.stars(s, r, 120, 0.5))
    s.add(D.orb(s, w * r.range(0.65, 0.85), h * 0.18, Math.min(w, h) * 0.06, '#ffe9f0', '#ff8fb1', '#ff5c8a', 3))
    for (let i = 0; i < 4; i++) s.add(D.beam(s, w * (0.1 + i * 0.27), h, -90 + r.range(-30, 30), h * 1.1, w * 0.07, i % 2 ? '#5ad1ff' : '#ff4fd8', 0.28))
    s.add(D.skyline(s, r, h * 0.78, '#160f33', { minH: h * 0.12, maxH: h * 0.38, windows: ['#5ad1ff', '#ff4fd8', '#ffd36b'], density: 0.25 }))
    const k = Math.min(w, h) / 1080
    s.add(D.robot(s, w * r.range(0.42, 0.58), h * 1.02, k * r.range(0.95, 1.1)))
    s.add(D.skyline(s, r, h * 1.0, '#0a0718', { minH: h * 0.06, maxH: h * 0.2, windows: ['#5ad1ff', '#ffd36b'], density: 0.2 }))
    s.add(D.rain(s, r, 220, '#9ad7ff', 0.18))
    return s
  },

  suburb(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#7fbfff'], [0.55, '#ffd0a1'], [1, '#ffb27a']]))
    s.add(D.clouds(s, r, 5, { y0: 0.05, y1: 0.3, opacity: 0.8, color: '#fff4e8' }))
    s.add(D.ridge(s, r, h * 0.6, h * 0.06, '#c9a98a', { peaks: 5, smooth: true }))
    const k = h / 1080
    const palettes = [
      ['#9cc3d5', '#4a5a7a'], ['#f2d48a', '#8a4b3a'], ['#b8d4a8', '#5a4a3a'], ['#e8a48a', '#4a3a4a'], ['#f4efe2', '#3f5a6a'],
    ]
    let x = -r.range(40, 120) * k
    const gy = h * 0.74
    while (x < w) {
      const [wall, roof] = r.pick(palettes)
      s.add(D.house(x, gy, k * r.range(1.05, 1.3), { wall, roof }))
      x += r.range(300, 380) * k
      if (r() < 0.8) s.add(D.roundTree(r, x - 30 * k, gy + 6, k * r.range(0.9, 1.25), ['#d9481e', '#f28a1d', '#f2c14e', '#b8321a']))
    }
    s.add(D.ground(s, gy, '#7aa35a'))
    s.add(`<rect x="0" y="${gy + h * 0.06}" width="${w}" height="${h * 0.045}" fill="#d8d2c4"/><rect x="0" y="${gy + h * 0.105}" width="${w}" height="${h}" fill="#4a4a52"/>`)
    s.add(`<path d="M0 ${gy + h * 0.17}H${w}" stroke="#f2d48a" stroke-width="${6 * k}" stroke-dasharray="${60 * k} ${50 * k}"/>`)
    let leaves = ''
    for (let i = 0; i < 80; i++) leaves += `<ellipse cx="${r() * w}" cy="${gy + r() * h * 0.26}" rx="${6 * k}" ry="${3.5 * k}" fill="${r.pick(['#d9481e', '#f28a1d', '#f2c14e'])}" transform="rotate(${r() * 180} 0 0)"/>`
    s.add(leaves)
    return s
  },

  diner(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#1d3b6e'], [0.5, '#e56b9f'], [0.85, '#ffb36b'], [1, '#ffd9a0']]))
    s.add(D.stars(s, r, 50, 0.3))
    s.add(D.ridge(s, r, h * 0.62, h * 0.08, '#6b3a6e', { peaks: 6, smooth: true }))
    const k = Math.min(w, h) / 1080
    const dx = w * 0.5 - 520 * k
    const dy = h * 0.72
    const dw = 1040 * k
    const dh = 250 * k
    const chrome = D.linear([[0, '#f4f7fb'], [0.5, '#9fb0c2'], [1, '#e8eef5']])
    s.add(`<rect x="${dx}" y="${dy - dh}" width="${dw}" height="${dh}" rx="${40 * k}" fill="${s.use(chrome)}"/>`)
    s.add(`<rect x="${dx}" y="${dy - dh * 0.32}" width="${dw}" height="${dh * 0.12}" fill="#1fb5a8"/>`)
    for (let i = 0; i < 7; i++) s.add(`<rect x="${dx + 50 * k + i * 136 * k}" y="${dy - dh * 0.84}" width="${110 * k}" height="${dh * 0.44}" rx="${8 * k}" fill="#ffe08a" opacity="0.95"/>`)
    const neon = D.glow(7, '#ff4fa3')
    s.add(`<rect x="${w * 0.5 - 260 * k}" y="${dy - dh - 150 * k}" width="${520 * k}" height="${120 * k}" rx="${22 * k}" fill="#1a1630" stroke="#ff4fa3" stroke-width="${6 * k}" filter="${s.use(neon)}"/>`)
    s.add(`<text x="${w * 0.5}" y="${dy - dh - 70 * k}" font-family="Lobster" font-size="${78 * k}" text-anchor="middle" fill="#ffd1ec" filter="url(#${neon.id})">Second Helpings</text>`)
    const eat = D.glow(6, '#4ff0ff')
    s.add(`<text x="${dx + dw - 40 * k}" y="${dy - dh - 30 * k}" font-family="Bungee" font-size="${70 * k}" text-anchor="end" fill="#c8fbff" filter="${s.use(eat)}">EAT</text>`)
    s.add(D.ground(s, dy, '#2a2238'))
    let checks = ''
    for (let i = 0; i < 40; i++) checks += `<rect x="${i * 60 * k}" y="${dy}" width="${30 * k}" height="${12 * k}" fill="#fff" opacity="0.6"/>`
    s.add(checks)
    s.add(D.car(w * r.range(0.16, 0.26), h * 0.94, k * 1.6, '#e8443a'))
    s.add(D.palm(w * 0.92, h * 0.96, k * 1.5, '#1a1428', -0.06))
    return s
  },

  culdesac(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#3f9be8'], [1, '#bfe6ff']]))
    s.add(D.clouds(s, r, 6, { y0: 0.06, y1: 0.32, opacity: 0.95 }))
    const k = h / 1080
    const gy = h * 0.68
    s.add(D.roundTree(r, w * 0.08, gy, k * 1.3, ['#3f8f4a', '#57a85a', '#2f7a3e'], '#5a3a2a'))
    const cols = [['#ffd3e0', '#6a4a6a'], ['#fff1c4', '#5a6a8a'], ['#cfeedd', '#6a4a3a'], ['#d8e4ff', '#8a4a3a']]
    let x = w * 0.14
    for (let i = 0; i < 3; i++) {
      const [wall, roof] = cols[(i + seed) % cols.length]
      s.add(D.house(x, gy, k * 1.35, { wall, roof, lit: '#9fd6ff', chimney: i !== 1 }))
      x += w * 0.29
    }
    s.add(D.roundTree(r, w * 0.95, gy, k * 1.2, ['#3f8f4a', '#57a85a'], '#5a3a2a'))
    s.add(D.ground(s, gy, '#69b85a'))
    s.add(`<path d="M${w * 0.2} ${h}Q${w * 0.5} ${gy + h * 0.05} ${w * 0.8} ${h}Z" fill="#cfc7b8"/>`)
    s.add(D.fence(s, h * 0.97, '#fbfbf7', { post: 34 * k, h: 90 * k }))
    s.add(`<g transform="translate(${w * 0.72} ${h * 0.9}) scale(${k * 1.4})"><path d="M0 0V-60" stroke="#333" stroke-width="3"/><path d="M0 -60Q-20 -90 -6 -110Q14 -116 18 -100Q4 -100 6 -80Q30 -84 34 -64Q20 -50 0 -60Z" fill="#ff6fae"/></g>`)
    return s
  },

  harbor(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#1b2140'], [0.5, '#6b4a7a'], [0.8, '#f08a5d'], [1, '#ffc48a']]))
    s.add(D.orb(s, w * r.range(0.3, 0.6), h * 0.58, Math.min(w, h) * 0.09, '#fff1c8', '#ff9a5c', '#ffb36b', 3))
    s.add(D.skyline(s, r, h * 0.6, '#2a2440', { minH: 20, maxH: h * 0.16, windows: '#ffd27a', density: 0.15 }))
    for (let i = 0; i < 3; i++) {
      const cx = w * (0.12 + i * 0.13)
      s.add(`<path d="M${cx} ${h * 0.6}V${h * 0.32}H${cx + 160}M${cx + 120} ${h * 0.32}V${h * 0.42}M${cx} ${h * 0.32}L${cx - 40} ${h * 0.36}" stroke="#2a2440" stroke-width="7" fill="none"/>`)
    }
    s.add(D.water(s, r, h * 0.6, '#3a2e52', '#0d1426', '#ffcf8a', w * 0.45, { streaks: 60 }))
    s.add(`<path d="M${w * 0.78} ${h * 0.66}Q${w * 0.88} ${h * 0.52} ${w} ${h * 0.56}L${w} ${h * 0.7}Z" fill="#141022"/>`)
    s.add(D.lighthouse(s, w * 0.9, h * 0.58, (h / 1080) * 0.85))
    s.add(D.beam(s, w * 0.9, h * 0.58 - 400 * (h / 1080) * 0.85, 190 + r.range(-15, 15), w * 0.7, h * 0.16, '#fff4c0', 0.35))
    const k = h / 1080
    const bx = w * r.range(0.32, 0.5)
    const by = h * 0.8
    s.add(`<g transform="translate(${bx} ${by}) scale(${k * 1.5})"><path d="M-160 0L170 0L140 34L-150 34Z" fill="#f4f1ea"/><rect x="-60" y="-40" width="110" height="42" fill="#f4f1ea"/><rect x="-46" y="-32" width="80" height="18" fill="#2a3550"/><rect x="-30" y="-52" width="22" height="10" fill="#ff3040"/><rect x="-6" y="-52" width="22" height="10" fill="#3060ff"/><rect x="-160" y="10" width="330" height="6" fill="#2a6fd6"/></g>`)
    s.add(D.fog(s, h * 0.5, h * 0.25, '#c9b8d8', 0.25))
    return s
  },

  noir(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#050505'], [0.7, '#2a2a2a'], [1, '#4a4a4a']]))
    s.add(D.orb(s, w * r.range(0.25, 0.75), h * 0.24, Math.min(w, h) * 0.08, '#ffffff', '#bdbdbd', '#ffffff', 3.4))
    s.add(D.clouds(s, r, 4, { y0: 0.1, y1: 0.35, color: '#777', opacity: 0.4 }))
    s.add(D.ridge(s, r, h * 0.6, h * 0.05, '#151515', { peaks: 8, smooth: true }))
    const vx = w * r.range(0.4, 0.6)
    const vy = h * 0.6
    s.add(`<path d="M${vx - 6} ${vy}L${w * 0.15} ${h}L${w * 0.85} ${h}L${vx + 6} ${vy}Z" fill="#2b2b2b"/>`)
    s.add(`<path d="M${vx} ${vy}L${w * 0.5} ${h}" stroke="#ddd" stroke-width="10" stroke-dasharray="40 50" opacity="0.7"/>`)
    for (let i = 0; i < 6; i++) {
      const t = Math.pow(i / 6, 1.6)
      const px = vx + (w * 0.92 - vx) * t
      const py = vy + (h - vy) * t
      const ph = 40 + t * 520
      s.add(`<path d="M${px} ${py}V${py - ph}M${px - ph * 0.12} ${py - ph * 0.9}H${px + ph * 0.12}" stroke="#0a0a0a" stroke-width="${2 + t * 10}"/>`)
    }
    s.add(`<path d="M${vx} ${vy - h * 0.12}" />`)
    const sl = w * 0.22
    s.add(`<path d="M${sl} ${h}V${h * 0.45}H${sl + 70}" stroke="#0a0a0a" stroke-width="12" fill="none"/>`, D.beam(s, sl + 70, h * 0.46, 75, h * 0.6, w * 0.18, '#ffffff', 0.35))
    s.add(D.figure(vx + w * 0.05, h * 0.74, (h / 1080) * 0.7, '#050505', { hair: 'short' }))
    s.add(D.fog(s, h * 0.55, h * 0.2, '#bbbbbb', 0.25))
    return s
  },

  synth(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    const hz = h * 0.62
    s.add(D.sky(s, [[0, '#0b0322'], [0.55, '#4b0f6e'], [1, '#ff3fa4']]))
    s.add(D.stars(s, r, 140, 0.5))
    s.add(D.bandedSun(s, w * 0.5, hz - Math.min(w, h) * 0.02, Math.min(w, h) * 0.26, '#ffe66b', '#ff2f8e'))
    s.add(D.ridge(s, r, hz, h * 0.12, '#24063d', { peaks: 7 }))
    s.add(`<rect x="0" y="${hz}" width="${w}" height="${h - hz}" fill="#0e0220"/>`)
    let grid = ''
    for (let i = -24; i <= 24; i++) grid += `M${w / 2 + i * 12} ${hz}L${w / 2 + i * w * 0.16} ${h}`
    for (let i = 1; i < 14; i++) {
      const y = hz + (h - hz) * Math.pow(i / 14, 2.2)
      grid += `M0 ${y}H${w}`
    }
    const gl = D.glow(3, '#ff3fd0')
    s.add(`<path d="${grid}" stroke="#ff3fd0" stroke-width="2" opacity="0.85" filter="${s.use(gl)}"/>`)
    const k = Math.min(w, h) / 1080
    const cx = w * 0.5
    const cy = h * 0.98
    const scr = D.glow(10, '#4ff0ff')
    s.add(`<g transform="translate(${cx} ${cy}) scale(${k * 1.25})"><path d="M-120 0L-120 -300L-100 -420L100 -420L120 -300L120 0Z" fill="#120a26" stroke="#4ff0ff" stroke-width="3"/><rect x="-86" y="-390" width="172" height="130" fill="#4ff0ff" opacity="0.9" filter="${s.use(scr)}"/><path d="M-110 -250L110 -250L120 -200L-120 -200Z" fill="#2a1450"/><circle cx="-40" cy="-226" r="10" fill="#ff3f6e"/><circle cx="0" cy="-226" r="10" fill="#ffe66b"/><rect x="50" y="-244" width="8" height="24" fill="#ddd"/></g>`)
    return s
  },

  neon(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#06050f'], [0.6, '#1c0f33'], [1, '#3a1450']]))
    s.add(D.skyline(s, r, h * 0.66, '#120c22', { minH: h * 0.2, maxH: h * 0.55, windows: ['#ff4fd8', '#4ff0ff', '#ffd36b'], density: 0.18, antenna: 0.4 }))
    for (let i = 0; i < 5; i++) {
      const c = r.pick(['#ff4fd8', '#4ff0ff', '#ff3f6e', '#ffd36b'])
      const g = D.glow(8, c)
      const x = r() * w
      const y = h * r.range(0.25, 0.55)
      s.add(`<rect x="${x}" y="${y}" width="${r.range(60, 180)}" height="${r.range(16, 40)}" rx="6" fill="none" stroke="${c}" stroke-width="5" filter="${s.use(g)}"/>`)
    }
    s.add(`<rect x="0" y="${h * 0.66}" width="${w}" height="${h * 0.34}" fill="#0b0816"/>`)
    const b = D.blur(10)
    s.use(b)
    for (let i = 0; i < 30; i++) s.add(`<rect x="${r() * w}" y="${h * 0.67}" width="${r.range(6, 26)}" height="${r.range(80, 260)}" fill="${r.pick(['#ff4fd8', '#4ff0ff', '#ffd36b', '#ff3f6e'])}" opacity="${r.range(0.15, 0.4)}" filter="${b.url}"/>`)
    const k = Math.min(w, h) / 1080
    s.add(D.car(w * r.range(0.25, 0.4), h * 0.9, k * 1.9, '#f2c230', { head: '#fff7d0' }))
    s.add(`<g transform="translate(${w * r.range(0.62, 0.75)} ${h * 0.9})">${D.figure(0, 0, k * 1.6, '#06050f', { hair: 'long' })}<path transform="scale(${k * 1.6})" d="M-90 -200Q0 -280 90 -200Z" fill="#ff3f6e"/><path transform="scale(${k * 1.6})" d="M0 -230V-150" stroke="#06050f" stroke-width="4"/></g>`)
    s.add(D.rain(s, r, 420, '#c9e9ff', 0.3))
    return s
  },

  drivein(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#04061a'], [0.7, '#141a4a'], [1, '#2a2160']]))
    s.add(D.stars(s, r, 200, 0.6))
    s.add(D.orb(s, w * r.range(0.72, 0.88), h * 0.16, Math.min(w, h) * 0.07, '#fffbe6', '#ffe9a0', '#fff1b0', 3))
    for (let i = 0; i < 6; i++) s.add(D.bat(w * r.range(0.55, 0.95), h * r.range(0.08, 0.3), (h / 1080) * r.range(0.9, 1.6)))
    const k = Math.min(w, h) / 1080
    const sx = w * 0.5
    const sw = Math.min(w * 0.62, 1100 * k)
    const sh = sw * 0.46
    const sy = h * 0.2
    const lightC = D.glow(30, '#bfe0ff')
    s.add(`<rect x="${sx - sw / 2 - 20}" y="${sy - 20}" width="${sw + 40}" height="${sh + 40}" fill="#0c0c14"/><rect x="${sx - sw / 2}" y="${sy}" width="${sw}" height="${sh}" fill="#dfeeff" filter="${s.use(lightC)}"/>`)
    s.add(`<g transform="translate(${sx} ${sy + sh}) scale(${sw / 1100})" fill="#1a2030"><path d="M-160 0Q-170 -260 -60 -300Q0 -330 60 -300Q170 -260 160 0Z"/><circle cx="-50" cy="-210" r="22" fill="#ff3f3f"/><circle cx="50" cy="-210" r="22" fill="#ff3f3f"/><path d="M-80 -120L-60 -150L-40 -120L-20 -150L0 -120L20 -150L40 -120L60 -150L80 -120Z" fill="#fff"/></g>`)
    s.add(`<rect x="${sx - 14}" y="${sy + sh + 20}" width="28" height="${h}" fill="#0c0c14"/>`)
    s.add(D.ground(s, h * 0.76, '#0a0c18'))
    for (let row = 0; row < 2; row++)
      for (let i = 0; i < 6; i++) {
        const x = w * (0.08 + i * 0.17) + (row ? w * 0.08 : 0)
        s.add(D.car(x, h * (0.86 + row * 0.1), k * (1.1 + row * 0.4), '#05060c', { tail: '#ff2a3a', head: '#0000' }))
        s.add(`<path d="M${x + 170 * k} ${h * (0.86 + row * 0.1)}v${-80 * k}" stroke="#05060c" stroke-width="${5 * k}"/>`)
      }
    const sign = D.glow(6, '#ff4f6e')
    s.add(`<text x="${w * 0.08}" y="${h * 0.66}" font-family="Monoton" font-size="${70 * k}" fill="#ffb3c2" filter="${s.use(sign)}">STARLITE</text>`)
    return s
  },

  pumpkin(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#0d0618'], [0.6, '#3a0f2e'], [1, '#7a2a1a']]))
    s.add(D.orb(s, w * r.range(0.35, 0.65), h * 0.36, Math.min(w, h) * 0.22, '#ffd27a', '#ff7a1a', '#ff8a2a', 1.8))
    for (let i = 0; i < 7; i++) s.add(D.bird(w * r.range(0.1, 0.9), h * r.range(0.1, 0.3), (h / 1080) * 1.6, '#0d0618'))
    s.add(D.ridge(s, r, h * 0.62, h * 0.06, '#1a0a1e', { peaks: 6, smooth: true }))
    s.add(D.deadTree(r, w * 0.12, h * 0.7, h / 1080 * 1.4, '#0d0618'))
    const k = h / 1080
    s.add(`<g transform="translate(${w * 0.8} ${h * 0.72}) scale(${k * 1.4})" fill="#0d0618"><rect x="-6" y="-240" width="12" height="240"/><rect x="-90" y="-200" width="180" height="10"/><circle cx="0" cy="-262" r="28"/><path d="M-40 -290L40 -290L0 -330Z"/><path d="M-50 -200L50 -200L40 -110L-40 -110Z"/></g>`)
    s.add(D.ground(s, h * 0.68, '#140a12'))
    for (let row = 0; row < 4; row++)
      for (let i = 0; i < 9; i++) {
        const t = row / 3
        s.add(D.pumpkin(w * (i / 8) + r.range(-40, 40) + (row % 2) * 50, h * (0.72 + t * 0.24), k * (0.45 + t * 0.7), { face: r() < 0.3 + t * 0.3, color: row === 3 ? '#f28a1d' : D.hsl(28, 85, 30 + t * 22) }))
      }
    s.add(D.fog(s, h * 0.6, h * 0.25, '#8a6a9a', 0.35))
    return s
  },

  lake(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#020812'], [0.6, '#0e2233'], [1, '#2a4a5a']]))
    s.add(D.stars(s, r, 150, 0.45))
    const mx = w * r.range(0.3, 0.7)
    s.add(D.orb(s, mx, h * 0.2, Math.min(w, h) * 0.05, '#f6fbff', '#c9dbe6', '#d8ecff', 3.2))
    s.add(D.forest(s, r, h * 0.5, '#0c2230', { n: 70, s0: 0.5, s1: 0.8 }))
    s.add(D.forest(s, r, h * 0.56, '#06141c', { n: 50, s0: 0.7, s1: 1.1 }))
    s.add(D.water(s, r, h * 0.58, '#0b1f2c', '#02080d', '#dfefff', mx, { streaks: 70, spread: 0.06 }))
    const k = h / 1080
    const cx = w * 0.18
    s.add(`<g transform="translate(${cx} ${h * 0.58}) scale(${k * 1.2})" fill="#05101a"><rect x="-80" y="-90" width="160" height="90"/><path d="M-100 -88L0 -160L100 -88Z"/><rect x="-50" y="-66" width="34" height="30" fill="#ffcf6b"/></g>`)
    s.add(`<rect x="${cx - 60 * k}" y="${h * 0.585}" width="${44 * k}" height="${60 * k}" fill="#ffcf6b" opacity="0.25"/>`)
    s.add(`<path transform="translate(${w * r.range(0.5, 0.7)} ${h * 0.72}) scale(${k * 1.5})" d="M-120 0Q0 26 120 0Q0 10 -120 0Z" fill="#05101a"/>`)
    s.add(D.fog(s, h * 0.48, h * 0.2, '#9fbfd0', 0.35), D.fog(s, h * 0.66, h * 0.2, '#9fbfd0', 0.2))
    s.add(`<circle cx="${w * 0.86}" cy="${h * 0.555}" r="${5 * k}" fill="#ff3030"/>`)
    return s
  },

  creek(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#14040a'], [0.55, '#5a0c14'], [1, '#c2401f']]))
    s.add(D.orb(s, w * r.range(0.4, 0.6), h * 0.52, Math.min(w, h) * 0.1, '#ffd0a0', '#e0502a', '#ff6a3a', 2.6))
    s.add(D.ridge(s, r, h * 0.58, h * 0.06, '#2a0610', { peaks: 7, smooth: true }))
    s.add(`<path d="M${w * 0.7} ${h * 0.58}V${h * 0.38}L${w * 0.712} ${h * 0.3}L${w * 0.724} ${h * 0.38}V${h * 0.58}Z" fill="#2a0610"/>`)
    for (let i = 0; i < 6; i++) s.add(D.deadTree(r, w * (0.05 + i * 0.19) + r.range(-30, 30), h * 0.74, (h / 1080) * r.range(0.9, 1.5), '#0a0206'))
    s.add(D.ground(s, h * 0.72, '#12040a'))
    const k = h / 1080
    s.add(`<g transform="translate(${w * 0.5} ${h * 0.8}) scale(${k * 1.6})" stroke="#3a1a10" stroke-width="10" fill="none"><path d="M-260 0Q0 -90 260 0"/><path d="M-260 30Q0 -60 260 30"/>${Array.from({ length: 9 }, (_, i) => `<path d="M${-220 + i * 55} ${-12 - Math.sin((i / 8) * Math.PI) * 60}v70"/>`).join('')}</g>`)
    s.add(D.fog(s, h * 0.64, h * 0.26, '#d07a6a', 0.3))
    for (let i = 0; i < 5; i++) s.add(D.bird(w * r.range(0.1, 0.9), h * r.range(0.12, 0.3), k * 1.5, '#14040a'))
    return s
  },

  backyard(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#2f86e0'], [1, '#bfe8ff']]))
    s.add(D.orb(s, w * 0.85, h * 0.12, Math.min(w, h) * 0.06, '#fffbe0', '#ffe27a', '#fff2a0', 3))
    s.add(D.clouds(s, r, 6, { y0: 0.05, y1: 0.35 }))
    const k = h / 1080
    const gy = h * 0.72
    s.add(D.skyline(s, r, gy - 60 * k, '#9fb7cf', { minH: 30 * k, maxH: 80 * k, wMin: 180 * k, wMax: 260 * k, antenna: 0 }))
    s.add(D.fence(s, gy, '#b8865a', { post: 30 * k, h: 120 * k }))
    s.add(D.ground(s, gy, '#5fb04a'))
    const smoke = D.blur(20)
    s.use(smoke)
    for (let i = 0; i < 10; i++) s.add(`<circle cx="${w * 0.5 + r.range(-200, 200) * k}" cy="${h * 0.84 + r.range(-40, 30) * k}" r="${r.range(60, 120) * k}" fill="#f2f2f2" opacity="0.8" filter="${smoke.url}"/>`)
    s.add(D.rocket(w * 0.5, h * 0.52, k * 1.35, r.range(-6, 6), { body: '#c9d2da', accent: '#2f6fd6', window: '#ffe27a' }))
    for (let i = 0; i < 4; i++) {
      const x = w * (0.18 + i * 0.07) + (i > 1 ? w * 0.42 : 0)
      s.add(D.figure(x, h * 0.98, k * r.range(0.9, 1.15), r.pick(['#e8443a', '#2f6fd6', '#f2a33a', '#3a8a4a']), { hair: r.pick(['short', 'long', 'bun']) }))
    }
    return s
  },

  mall(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#060b1e'], [0.6, '#1b2a5a'], [1, '#3b3a7a']]))
    s.add(D.stars(s, r, 80, 0.4))
    for (let i = 0; i < 2; i++) s.add(D.beam(s, w * (0.3 + i * 0.4), h * 0.62, -90 + (i ? 18 : -18), h * 0.8, w * 0.06, '#fff7d0', 0.3))
    const k = Math.min(w, h) / 1080
    const my = h * 0.68
    const gold = D.linear([[0, '#ffe39a'], [1, '#c9902a']])
    s.add(`<rect x="${w * 0.1}" y="${my - 260 * k}" width="${w * 0.8}" height="${260 * k}" fill="#d9d2e6"/><rect x="${w * 0.1}" y="${my - 280 * k}" width="${w * 0.8}" height="${30 * k}" fill="#8a7aa8"/>`)
    for (let i = 0; i < 10; i++) s.add(`<rect x="${w * 0.12 + i * w * 0.078}" y="${my - 200 * k}" width="${w * 0.06}" height="${200 * k}" fill="#ffe7a8" opacity="0.9"/>`)
    const sign = D.glow(8, '#ffd36b')
    s.add(`<text x="${w * 0.5}" y="${my - 300 * k}" font-family="Shrikhand" font-size="${110 * k}" text-anchor="middle" fill="${s.use(gold)}" filter="${s.use(sign)}">Mega Mall</text>`)
    s.add(D.ground(s, my, '#2a2a3a'))
    for (let i = 0; i < 12; i++) s.add(`<path d="M${i * w * 0.09} ${my + 40 * k}l${60 * k} ${h * 0.3}" stroke="#f4f1e6" stroke-width="${5 * k}" opacity="0.5"/>`)
    s.add(D.car(w * 0.32, h * 0.95, k * 2.2, '#2a6a8a', { head: '#fff7d0' }))
    s.add(`<g transform="translate(${w * 0.68} ${h * 0.95}) scale(${k * 1.4})"><path d="M-50 0Q-70 -90 0 -110Q70 -90 50 0Z" fill="#c9a24a"/><text x="0" y="-36" font-family="Bungee" font-size="54" text-anchor="middle" fill="#3a2a10">$</text></g>`)
    return s
  },

  lighthouse(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#04121a'], [0.6, '#0f3340'], [1, '#2a5a66']]))
    s.add(D.clouds(s, r, 6, { y0: 0.05, y1: 0.4, color: '#1e4250', opacity: 0.8, size: 1.6 }))
    const k = h / 1080
    const lx = w * r.range(0.62, 0.74)
    const ly = h * 0.6
    s.add(D.beam(s, lx, ly - 400 * k * 0.95, 180 + r.range(-10, 10), w, h * 0.22, '#fff4c0', 0.45), D.beam(s, lx, ly - 400 * k * 0.95, r.range(-10, 10), w * 0.6, h * 0.12, '#fff4c0', 0.25))
    s.add(`<path d="M${lx - w * 0.3} ${h}L${lx - w * 0.14} ${ly + 10}L${lx + w * 0.18} ${ly}L${w} ${ly + h * 0.05}L${w} ${h}Z" fill="#06141a"/>`)
    s.add(D.lighthouse(s, lx, ly + 6, k * 0.95))
    s.add(D.water(s, r, h * 0.74, '#0d2e3a', '#020a0e', '#fff4c0', lx - w * 0.3, { streaks: 40 }))
    let waves = ''
    for (let i = 0; i < 40; i++) {
      const x = r() * w
      const y = h * r.range(0.74, 1)
      waves += `M${x} ${y}q${20 * k} ${-14 * k} ${40 * k} 0`
    }
    s.add(`<path d="${waves}" stroke="#cfe8f0" stroke-width="${3 * k}" fill="none" opacity="0.5"/>`)
    s.add(D.rain(s, r, 300, '#cfe8f0', 0.25, 0.3))
    s.add(D.figure(lx - w * 0.16, ly + 30 * k, k * 0.6, '#020a0e'), `<circle cx="${lx - w * 0.16 + 24 * k}" cy="${ly - 50 * k}" r="${8 * k}" fill="#ffcf6b"/>`)
    return s
  },

  rooftop(w, h, seed) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, '#2a1b5a'], [0.5, '#a24a8a'], [0.8, '#ff9a6b'], [1, '#ffd2a0']]))
    s.add(D.stars(s, r, 50, 0.25))
    s.add(D.skyline(s, r, h * 0.78, '#4a2a5e', { minH: h * 0.15, maxH: h * 0.42, windows: '#ffd9a0', density: 0.12, antenna: 0.3 }))
    s.add(D.skyline(s, r, h * 0.84, '#2a163a', { minH: h * 0.12, maxH: h * 0.3, windows: ['#ffd9a0', '#ffecc4'], density: 0.3 }))
    const k = h / 1080
    s.add(`<rect x="0" y="${h * 0.82}" width="${w}" height="${h * 0.18}" fill="#140a1e"/>`)
    let bulbs = ''
    for (let i = 0; i < 22; i++) {
      const t = i / 21
      const x = w * 0.05 + t * w * 0.9
      const y = h * 0.42 + Math.sin(t * Math.PI) * h * 0.08
      bulbs += `<circle cx="${x}" cy="${y}" r="${6 * k}" fill="#ffe7a8"/>`
    }
    const bg = D.glow(6, '#ffd27a')
    s.add(`<path d="M${w * 0.05} ${h * 0.42}Q${w * 0.5} ${h * 0.58} ${w * 0.95} ${h * 0.42}" stroke="#140a1e" stroke-width="2" fill="none"/><g filter="${s.use(bg)}">${bulbs}</g>`)
    s.add(`<g transform="translate(${w * 0.86} ${h * 0.82}) scale(${k * 1.2})" fill="#140a1e"><rect x="-70" y="-220" width="140" height="160" rx="14"/><path d="M-80 -220L0 -280L80 -220Z"/><rect x="-60" y="-60" width="10" height="60"/><rect x="50" y="-60" width="10" height="60"/></g>`)
    s.add(D.figure(w * 0.44, h * 0.84, k * 1.1, '#140a1e', { pose: 'sit', hair: 'long' }), D.figure(w * 0.52, h * 0.84, k * 1.15, '#140a1e', { pose: 'sit' }))
    return s
  },

  /** A stage for music videos and artist pictures, lit in the artist's colour. */
  stage(w, h, seed, hue = 300) {
    const r = rng(seed)
    const s = new Scene(w, h)
    s.add(D.sky(s, [[0, D.hsl(hue, 60, 6)], [1, D.hsl(hue, 70, 18)]]))
    for (let i = 0; i < 6; i++) s.add(D.beam(s, w * (0.08 + i * 0.17), -20, 90 + r.range(-25, 25), h * 1.15, w * 0.12, D.hsl(hue + r.range(-40, 40), 90, 65), 0.35))
    s.add(D.fog(s, h * 0.45, h * 0.45, D.hsl(hue, 60, 70), 0.25))
    const k = h / 1080
    s.add(`<rect x="0" y="${h * 0.84}" width="${w}" height="${h * 0.16}" fill="${D.hsl(hue, 40, 5)}"/>`)
    const cx = w * 0.5
    const u = Math.min(w / 1920, h / 1080) * 1.0
    const fl = h * 0.9
    // drums at the back, guitarist and bassist either side, the singer up front
    s.add(`<g fill="#05030a"><circle cx="${cx + 20 * u}" cy="${fl - 120 * u}" r="${120 * u}"/><rect x="${cx - 130 * u}" y="${fl - 190 * u}" width="${300 * u}" height="${18 * u}"/><circle cx="${cx + 210 * u}" cy="${fl - 330 * u}" r="${60 * u}" fill="none" stroke="#05030a" stroke-width="${10 * u}"/><circle cx="${cx - 170 * u}" cy="${fl - 300 * u}" r="${50 * u}" fill="none" stroke="#05030a" stroke-width="${10 * u}"/></g>`)
    s.add(D.figure(cx + 20 * u, fl - 160 * u, u * 1.9, '#05030a'))
    s.add(D.figure(cx - 520 * u, fl, u * 3.0, '#05030a'), `<path transform="translate(${cx - 520 * u} ${fl - 280 * u}) scale(${u * 3})" d="M-10 -20L90 -70L100 -60L10 0Z" fill="#05030a"/>`)
    s.add(D.figure(cx + 540 * u, fl, u * 2.9, '#05030a', { hair: 'long' }), `<path transform="translate(${cx + 540 * u} ${fl - 270 * u}) scale(${-u * 2.9} ${u * 2.9})" d="M-10 -20L100 -80L110 -70L10 0Z" fill="#05030a"/>`)
    s.add(D.figure(cx, fl + 40 * u, u * 3.6, '#05030a', { hair: r.pick(['long', 'short', 'bun']) }), `<path d="M${cx + 130 * u} ${fl + 40 * u}V${fl - 560 * u}" stroke="#05030a" stroke-width="${10 * u}"/><circle cx="${cx + 130 * u}" cy="${fl - 570 * u}" r="${16 * u}" fill="#05030a"/>`)
    let dust = ''
    for (let i = 0; i < 90; i++) dust += `<circle cx="${r() * w}" cy="${r() * h * 0.8}" r="${r.range(1, 3)}" fill="#fff" opacity="${r.range(0.1, 0.5)}"/>`
    s.add(dust)
    return s
  },
}

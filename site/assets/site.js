// MosaicTV website: the channel-flipping TV, tabs, reveals, copy buttons and
// the broadcast-episode fold. No framework, no build.

const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches

// ── Nav goes solid once you scroll ─────────────────────────────────────────
const nav = $('.nav')
const onScroll = () => nav.classList.toggle('scrolled', scrollY > 20)
addEventListener('scroll', onScroll, { passive: true })
onScroll()

// ── The TV ──────────────────────────────────────────────────────────────────
// Each channel is a frame captured from a real channel's stream (logo,
// up-next card and all). Flip with the buttons, ↑/↓, a number, or a swipe.
{
  const tv = $('#tv')
  const screen = $('.screen', tv)
  const img = $('img', screen)
  const canvas = $('canvas', screen)
  const osd = $('.osd', tv)
  const buttons = $$('.remote button[data-ch]')
  const channels = buttons.map((b) => ({ num: b.dataset.ch, src: b.dataset.src, alt: b.dataset.alt }))
  let at = 0
  let osdTimer
  let auto
  const ctx = canvas.getContext('2d')

  // Preload so a flip never waits.
  channels.forEach((c) => (new Image().src = c.src))

  function snow(ms) {
    if (reduced) return Promise.resolve()
    const w = (canvas.width = 320)
    const h = (canvas.height = 180)
    const data = ctx.createImageData(w, h)
    let running = true
    const draw = () => {
      const d = data.data
      for (let i = 0; i < d.length; i += 4) {
        const v = (Math.random() * 255) | 0
        d[i] = d[i + 1] = d[i + 2] = v
        d[i + 3] = 255
      }
      ctx.putImageData(data, 0, 0)
      if (running) requestAnimationFrame(draw)
    }
    draw()
    // Timed, not counted in frames: a hidden tab doesn't run animation frames.
    return new Promise((done) => setTimeout(() => ((running = false), done()), ms))
  }

  async function tune(i, user = true) {
    at = (i + channels.length) % channels.length
    const c = channels[at]
    buttons.forEach((b, k) => b.setAttribute('aria-pressed', String(k === at)))
    osd.textContent = c.num
    osd.classList.add('show')
    clearTimeout(osdTimer)
    osdTimer = setTimeout(() => osd.classList.remove('show'), 1800)
    screen.classList.add('flipping')
    await snow(user ? 220 : 160)
    img.src = c.src
    img.alt = c.alt
    screen.classList.remove('flipping')
    if (user) stopAuto()
  }
  const stopAuto = () => clearInterval(auto)
  buttons.forEach((b, k) => b.addEventListener('click', () => tune(k)))

  // Keys work once the TV is in view, like TV mode itself.
  let typed = ''
  let typedTimer
  addEventListener('keydown', (e) => {
    const r = tv.getBoundingClientRect()
    if (r.bottom < 0 || r.top > innerHeight || e.target.closest?.('input,textarea')) return
    if (e.key === 'ArrowUp') (e.preventDefault(), tune(at + 1))
    else if (e.key === 'ArrowDown') (e.preventDefault(), tune(at - 1))
    else if (/^\d$/.test(e.key)) {
      typed += e.key
      clearTimeout(typedTimer)
      osd.textContent = typed
      osd.classList.add('show')
      typedTimer = setTimeout(() => {
        const k = channels.findIndex((c) => c.num === typed)
        typed = ''
        if (k >= 0) tune(k)
        else osd.classList.remove('show')
      }, 900)
    }
  })
  let x0 = null
  screen.addEventListener('touchstart', (e) => (x0 = e.touches[0].clientY), { passive: true })
  screen.addEventListener('touchend', (e) => {
    if (x0 == null) return
    const dy = e.changedTouches[0].clientY - x0
    if (Math.abs(dy) > 40) tune(at + (dy < 0 ? 1 : -1))
    x0 = null
  })
  screen.addEventListener('click', () => tune(at + 1))

  // Flip on its own until someone takes the remote.
  if (!reduced) auto = setInterval(() => tune(at + 1, false), 4200)
}

// ── Reveal on scroll ───────────────────────────────────────────────────────
{
  const io = new IntersectionObserver(
    (entries) => entries.forEach((e) => e.isIntersecting && (e.target.classList.add('in'), io.unobserve(e.target))),
    { rootMargin: '0px 0px -10% 0px' },
  )
  $$('.reveal').forEach((el) => io.observe(el))
}

// ── Tabs ───────────────────────────────────────────────────────────────────
$$('[data-tabs]').forEach((group) => {
  const tabs = $$('.tab', group)
  const panes = $$('.pane', $(group.dataset.tabs))
  tabs.forEach((t, i) =>
    t.addEventListener('click', () => {
      tabs.forEach((x, k) => x.setAttribute('aria-selected', String(k === i)))
      panes.forEach((p, k) => p.classList.toggle('on', k === i))
      panes[i].querySelectorAll('video').forEach((v) => v.play?.().catch(() => {}))
    }),
  )
})

// ── Toggles that swap an image (up-next styles, now-playing looks) ─────────
$$('[data-swap]').forEach((group) => {
  const target = $(group.dataset.swap)
  const buttons = $$('button', group)
  buttons.forEach((b) =>
    b.addEventListener('click', () => {
      buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b)))
      target.src = b.dataset.src
      target.alt = b.dataset.alt ?? target.alt
    }),
  )
})

// ── Broadcast episodes: the shorts fold into the half-hour they aired as ───
{
  const fold = $('#fold')
  if (fold) {
    const buttons = $$('.toggle button', fold)
    const set = (on) => {
      fold.classList.toggle('folded', on)
      buttons.forEach((b) => b.setAttribute('aria-pressed', String((b.dataset.fold === '1') === on)))
      $$('[data-before]', fold).forEach((el) => {
        const [l, w] = (on ? el.dataset.after : el.dataset.before).split(',')
        el.style.left = l + '%'
        el.style.width = w + '%'
        el.style.opacity = Number(w) > 0 && Number(l) < 100 ? '1' : '0'
      })
      $('#fold-verdict', fold).innerHTML = on
        ? '<span><b>One program in the guide</b>, 8:00–8:23 — its three parts play back to back</span><span>The squirrel back between the dogs, where it aired in 1993</span>'
        : '<span><b>Three separate programs</b>, each on its own in the guide</span><span>Goldflipper is another show, and Where’s the Bone airs another day</span>'
    }
    buttons.forEach((b) => b.addEventListener('click', () => set(b.dataset.fold === '1')))
    set(false)
    const io = new IntersectionObserver((es) => {
      if (es[0].isIntersecting) {
        setTimeout(() => set(true), reduced ? 0 : 900)
        io.disconnect()
      }
    }, { threshold: 0.6 })
    io.observe(fold)
  }
}

// ── Copy buttons ───────────────────────────────────────────────────────────
$$('.copy').forEach((b) =>
  b.addEventListener('click', async () => {
    const text = $(b.dataset.copy).innerText.replace(/^\s*#.*$/gm, '').trim()
    try {
      await navigator.clipboard.writeText(text)
      b.textContent = 'Copied'
      b.classList.add('done')
    } catch {
      b.textContent = 'Select and copy'
    }
    setTimeout(() => ((b.textContent = 'Copy'), b.classList.remove('done')), 1800)
  }),
)

// ── Videos play only while on screen ───────────────────────────────────────
{
  const io = new IntersectionObserver((es) => es.forEach((e) => (e.isIntersecting ? e.target.play?.().catch(() => {}) : e.target.pause?.())), { threshold: 0.25 })
  $$('video[data-auto]').forEach((v) => io.observe(v))
}

// ── The closing wall: glass tiles lit by rings of light, like the Mosaic ident ──
{
  const canvas = $('#mosaic-bg')
  if (canvas) {
    const ctx = canvas.getContext('2d')
    const STOPS = [[139, 92, 246], [59, 110, 246], [34, 200, 238], [236, 72, 153]]
    const hash = (x, y, s) => {
      const v = Math.sin(x * 12.9898 + y * 78.233 + s) * 43758.5453
      return v - Math.floor(v)
    }
    // A hue round the four stops, as a colour.
    const colour = (h) => {
      const f = ((h % 1) + 1) % 1 * 4
      const i = Math.floor(f)
      const a = STOPS[i]
      const b = STOPS[(i + 1) % 4]
      const t = f - i
      return a.map((v, k) => v + (b[k] - v) * t)
    }
    let w, h, cols, rows, tile, dpr
    const size = () => {
      dpr = Math.min(devicePixelRatio || 1, 1.5)
      const r = canvas.getBoundingClientRect()
      w = canvas.width = Math.round(r.width * dpr)
      h = canvas.height = Math.round(r.height * dpr)
      tile = 30 * dpr
      cols = Math.ceil(w / tile)
      rows = Math.ceil(h / tile)
    }
    const draw = (t) => {
      ctx.fillStyle = '#06070b'
      ctx.fillRect(0, 0, w, h)
      const cx = cols / 2
      const cy = rows / 2
      const gap = Math.max(2, tile * 0.1)
      for (let y = 0; y < rows; y++)
        for (let x = 0; x < cols; x++) {
          const d = Math.hypot(x - cx, (y - cy) * 1.15)
          let p = t / 5 - d / 17
          p -= Math.floor(p)
          const ring = Math.exp(-9 * p) * (0.3 + 0.7 * Math.exp(-d / 26))
          const spark = hash(x, y, 3.1) > 0.9 ? Math.max(0, Math.sin(2 * Math.PI * (t / 7.5 + hash(x, y, 7.7)))) ** 24 : 0
          const light = 0.1 + 0.14 * hash(x, y, 1.3) + 0.95 * ring + 0.7 * spark
          const [r, g, b] = colour(x / cols * 0.55 + y / rows * 0.3 + t / 30)
          const hot = Math.max(0, light - 0.7) * 280
          ctx.fillStyle = `rgb(${Math.min(255, r * light * 1.25 + hot)},${Math.min(255, g * light * 1.25 + hot)},${Math.min(255, b * light * 1.25 + hot)})`
          ctx.beginPath()
          ctx.roundRect(x * tile + gap / 2, y * tile + gap / 2, tile - gap, tile - gap, tile * 0.16)
          ctx.fill()
        }
    }
    size()
    addEventListener('resize', () => (size(), draw(performance.now() / 1000)))
    let on = false
    const loop = (ms) => {
      if (!on) return
      draw(ms / 1000)
      requestAnimationFrame(loop)
    }
    if (reduced) draw(1.4)
    else
      new IntersectionObserver((es) => {
        on = es[0].isIntersecting
        if (on) requestAnimationFrame(loop)
      }).observe(canvas)
  }
}

// ── Click a picture to see it full size ────────────────────────────────────
// Screenshots are shown small; each is published big enough to read.
{
  const pictures = $$('.shot img, .frame img, .thumb img, .phone img, .ident video')
  let box = null
  const close = () => {
    if (!box) return
    const b = box
    box = null
    b.classList.remove('open')
    document.body.style.overflow = ''
    setTimeout(() => b.remove(), 200)
  }
  const open = (el) => {
    close()
    box = document.createElement('div')
    box.className = 'lightbox'
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')
    const fig = document.createElement('figure')
    let media
    if (el.tagName === 'VIDEO') {
      media = document.createElement('video')
      Object.assign(media, { src: el.currentSrc || el.src, muted: true, loop: true, autoplay: true, playsInline: true })
    } else {
      media = document.createElement('img')
      media.src = el.currentSrc || el.src
      media.alt = el.alt
    }
    fig.appendChild(media)
    const text = el.alt || el.closest('figure')?.querySelector('figcaption')?.textContent
    if (text) {
      const cap = document.createElement('figcaption')
      cap.textContent = text
      fig.appendChild(cap)
    }
    const x = document.createElement('button')
    x.className = 'close'
    x.setAttribute('aria-label', 'Close')
    x.textContent = '×'
    box.append(fig, x)
    box.addEventListener('click', close)
    document.body.appendChild(box)
    document.body.style.overflow = 'hidden'
    requestAnimationFrame(() => box?.classList.add('open'))
    x.focus()
  }
  pictures.forEach((el) => {
    el.classList.add('zoomable')
    el.setAttribute('tabindex', '0')
    el.addEventListener('click', () => open(el))
    el.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), open(el)))
  })
  addEventListener('keydown', (e) => e.key === 'Escape' && close())
}

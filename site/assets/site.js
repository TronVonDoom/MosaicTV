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
// Each channel is a frame captured from the demo instance's own stream (logo,
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

// ── Broadcast episodes: three shorts fold into the half-hour they aired as ──
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
        ? '<span><b>One program</b> in the guide, 2:00–2:30</span><span>Breaks between the parts, as it aired</span>'
        : '<span><b>Three seven-minute programs</b>, shuffled in with everything else</span><span>Part two airs on Tuesday</span>'
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

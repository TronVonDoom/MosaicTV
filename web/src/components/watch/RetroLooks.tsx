import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { cx } from '../ui'

// TV mode's retro looks — all drawn here in the browser, so the stream, the
// guide and every other player are untouched:
//   CRT       the picture through a tube: scanlines, a curve, a glow (a WebGL
//             shader over the video; plain scanlines where WebGL won't run).
//   TV set    a 4:3 program framed by an old set instead of black bars — shown
//             only while the picture has bars down its sides.
//   Classic   the channel guide in the blue, boxy look of a cable guide.
// Each is remembered in this browser.

export type Looks = { crt: boolean; tvSet: boolean; classicGuide: boolean }
const KEY = 'mosaictv.watch.looks'
const NONE: Looks = { crt: false, tvSet: false, classicGuide: false }

export function useLooks(): [Looks, (patch: Partial<Looks>) => void] {
  const [looks, setLooks] = useState<Looks>(() => {
    try {
      return { ...NONE, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Looks>) }
    } catch {
      return NONE
    }
  })
  const set = useCallback((patch: Partial<Looks>) => {
    setLooks((l) => {
      const next = { ...l, ...patch }
      try {
        localStorage.setItem(KEY, JSON.stringify(next))
      } catch {
        /* storage blocked: the look just won't stick */
      }
      return next
    })
  }, [])
  return [looks, set]
}

export type Rect = { x: number; y: number; w: number; h: number }

/**
 * Where the picture is on screen: the video's frame fitted into its box (as
 * object-contain draws it), and — when it's a 4:3 program between black bars
 * — the 4:3 part of it. The bars are found by looking at the picture itself
 * once a second (a dark scene isn't bars: it takes a few looks in a row).
 */
export function usePicture(
  videoRef: RefObject<HTMLVideoElement | null>,
  watchBars: boolean,
): { box: { w: number; h: number }; frame: Rect | null; fourThree: Rect | null } {
  const [frame, setFrame] = useState<Rect | null>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  const [barred, setBarred] = useState(false)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const measure = () => {
      const bw = video.clientWidth
      const bh = video.clientHeight
      const vw = video.videoWidth || 16
      const vh = video.videoHeight || 9
      const s = Math.min(bw / vw, bh / vh)
      const w = vw * s
      const h = vh * s
      setBox({ w: bw, h: bh })
      setFrame({ x: (bw - w) / 2, y: (bh - h) / 2, w, h })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(video)
    video.addEventListener('resize', measure)
    video.addEventListener('loadedmetadata', measure)
    return () => {
      ro.disconnect()
      video.removeEventListener('resize', measure)
      video.removeEventListener('loadedmetadata', measure)
    }
  }, [videoRef])

  useEffect(() => {
    if (!watchBars) return setBarred(false)
    const video = videoRef.current
    if (!video) return
    const c = document.createElement('canvas')
    c.width = 64
    c.height = 36
    const g = c.getContext('2d', { willReadFrequently: true })
    if (!g) return
    let yes = 0
    let no = 0
    const look = () => {
      if (video.readyState < 2 || video.paused) return
      try {
        g.drawImage(video, 0, 0, 64, 36)
        const px = g.getImageData(0, 0, 64, 36).data
        const lum = (x0: number, x1: number) => {
          let sum = 0
          let n = 0
          for (let y = 3; y < 33; y++)
            for (let x = x0; x < x1; x++) {
              const i = (y * 64 + x) * 4
              sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]
              n++
            }
          return sum / n
        }
        // A 4:3 picture in 16:9 leaves an eighth either side: 8 of 64 columns.
        const sides = Math.max(lum(1, 7), lum(57, 63))
        const middle = lum(12, 52)
        if (sides < 6 && middle > 14) {
          yes++
          no = 0
        } else {
          no++
          yes = 0
        }
        if (yes >= 3) setBarred(true)
        if (no >= 2) setBarred(false)
      } catch {
        /* a picture we can't read (cross-origin): leave it be */
      }
    }
    const t = setInterval(look, 1000)
    return () => clearInterval(t)
  }, [videoRef, watchBars])

  const fourThree = frame && barred ? { x: frame.x + frame.w / 8, y: frame.y, w: (frame.w * 3) / 4, h: frame.h } : null
  return { box, frame, fourThree }
}

// ── CRT ─────────────────────────────────────────────────────────────────────

const VERT = `
attribute vec2 pos;
varying vec2 uv;
void main() { uv = pos * 0.5 + 0.5; gl_Position = vec4(pos, 0.0, 1.0); }`

// The tube: the picture bent round the corners, a little colour fringe and
// glow, scanlines at about broadcast count, a shadow-mask stripe per screen
// pixel, and the edges falling off into the dark.
const FRAG = `
precision mediump float;
uniform sampler2D tex;
uniform vec4 crop;
uniform float lines;
varying vec2 uv;
vec2 bend(vec2 p) {
  vec2 c = p * 2.0 - 1.0;
  vec2 off = abs(c.yx) / vec2(5.5, 4.2);
  c = c + c * off * off;
  return c * 0.5 + 0.5;
}
vec3 at(vec2 p) { return texture2D(tex, vec2(mix(crop.x, crop.z, p.x), mix(crop.y, crop.w, p.y))).rgb; }
void main() {
  vec2 p = bend(uv);
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }
  float f = 0.0011;
  vec3 col = vec3(at(p + vec2(f, 0.0)).r, at(p).g, at(p - vec2(f, 0.0)).b);
  vec3 glow = (at(p + vec2(0.003, 0.0)) + at(p - vec2(0.003, 0.0)) + at(p + vec2(0.0, 0.004)) + at(p - vec2(0.0, 0.004))) * 0.25;
  col = max(col, mix(col, glow, 0.45));
  float s = sin(p.y * lines * 3.14159265);
  col *= 0.72 + 0.28 * s * s;
  float m = mod(gl_FragCoord.x, 3.0);
  col *= vec3(m < 1.0 ? 1.0 : 0.86, m >= 1.0 && m < 2.0 ? 1.0 : 0.86, m >= 2.0 ? 1.0 : 0.86);
  col *= 1.22;
  vec2 v = p * (1.0 - p.yx);
  col *= clamp(pow(v.x * v.y * 18.0, 0.22), 0.0, 1.0);
  gl_FragColor = vec4(col, 1.0);
}`

function setUp(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl', { alpha: false, antialias: false, preserveDrawingBuffer: false })
  if (!gl) return null
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type)!
    gl.shaderSource(s, src)
    gl.compileShader(s)
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null
  }
  const vs = shader(gl.VERTEX_SHADER, VERT)
  const fs = shader(gl.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs) return null
  const prog = gl.createProgram()!
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null
  gl.useProgram(prog)
  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
  const loc = gl.getAttribLocation(prog, 'pos')
  gl.enableVertexAttribArray(loc)
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0)
  const tex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, tex)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  return { gl, crop: gl.getUniformLocation(prog, 'crop'), lines: gl.getUniformLocation(prog, 'lines') }
}

/**
 * The picture through a CRT, drawn over `rect` of the video's box. `crop` is
 * the part of the video's frame to show there (0–1 across, 0–1 up): all of it,
 * or a 4:3 program's middle three quarters inside a TV set. Falls back to plain
 * scanlines over the video where WebGL won't run.
 */
export function Crt({ videoRef, rect, crop }: { videoRef: RefObject<HTMLVideoElement | null>; rect: Rect; crop: [number, number, number, number] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [failed, setFailed] = useState(false)
  const cropKey = crop.join(',')

  useEffect(() => {
    const canvas = canvasRef.current
    const video = videoRef.current
    if (!canvas || !video) return
    const ctx = setUp(canvas)
    if (!ctx) return setFailed(true)
    const { gl } = ctx
    let stop = false
    let handle = 0
    const [x0, y0, x1, y1] = cropKey.split(',').map(Number)
    const draw = () => {
      if (stop) return
      if (video.readyState >= 2) {
        // Drawn at the screen's pixels, up to 1080 tall: past that the lines
        // are what matters, not the detail.
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const h = Math.min(1080, Math.round(canvas.clientHeight * dpr))
        const w = Math.round((canvas.clientWidth / Math.max(1, canvas.clientHeight)) * h)
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w
          canvas.height = h
        }
        gl.viewport(0, 0, w, h)
        try {
          gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, video)
          gl.uniform4f(ctx.crop, x0, y0, x1, y1)
          gl.uniform1f(ctx.lines, 486)
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        } catch {
          stop = true
          setFailed(true)
          return
        }
      }
      next()
    }
    // A frame each time the video has a new one, where the browser says so.
    const perFrame = 'requestVideoFrameCallback' in video
    const next = () => {
      handle = perFrame ? video.requestVideoFrameCallback(draw) : requestAnimationFrame(draw)
    }
    draw()
    return () => {
      stop = true
      if (perFrame) video.cancelVideoFrameCallback(handle)
      else cancelAnimationFrame(handle)
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }, [videoRef, cropKey])

  const style = { left: rect.x, top: rect.y, width: rect.w, height: rect.h }
  if (failed) return <div className="crt-lines absolute pointer-events-none" style={style} />
  return <canvas ref={canvasRef} className="absolute pointer-events-none" style={style} />
}

// ── The TV set ──────────────────────────────────────────────────────────────

/**
 * An old TV set around a 4:3 picture at `screen` (in a box `w`×`h`): charcoal
 * cabinet, a speaker grille on the left, the dials on the right with the
 * channel in its little window, and the tube's dark surround.
 */
export function TvSet({ w, h, screen, channel }: { w: number; h: number; screen: Rect; channel: number | null }) {
  const r = Math.max(8, screen.h * 0.04)
  const pad = Math.max(6, screen.h * 0.025)
  const hole = { x: screen.x - pad, y: screen.y - pad, w: screen.w + 2 * pad, h: screen.h + 2 * pad }
  const side = Math.max(0, screen.x - pad)
  const right = hole.x + hole.w
  const knobR = Math.min(side * 0.22, h * 0.07)
  const kx = right + side / 2
  const u = Math.max(1, h / 1080)
  const roundRect = (x: number, y: number, ww: number, hh: number, rr: number) =>
    `M${x + rr},${y}h${ww - 2 * rr}a${rr},${rr} 0 0 1 ${rr},${rr}v${hh - 2 * rr}a${rr},${rr} 0 0 1 -${rr},${rr}h-${ww - 2 * rr}a${rr},${rr} 0 0 1 -${rr},-${rr}v-${hh - 2 * rr}a${rr},${rr} 0 0 1 ${rr},-${rr}z`
  return (
    <svg className="absolute inset-0 pointer-events-none" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <defs>
        <linearGradient id="tv-body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2a2a2e" />
          <stop offset="0.5" stopColor="#1b1b1f" />
          <stop offset="1" stopColor="#111114" />
        </linearGradient>
        <linearGradient id="tv-trim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c9c9cf" />
          <stop offset="0.5" stopColor="#77777f" />
          <stop offset="1" stopColor="#a9a9b1" />
        </linearGradient>
        <radialGradient id="tv-knob" cx="0.35" cy="0.3" r="0.8">
          <stop offset="0" stopColor="#d7d7dc" />
          <stop offset="0.45" stopColor="#8c8c94" />
          <stop offset="1" stopColor="#3a3a40" />
        </radialGradient>
        <linearGradient id="tv-tube" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.9" />
          <stop offset="1" stopColor="#000" stopOpacity="0.6" />
        </linearGradient>
        <pattern id="tv-grille" width={6 * u} height={6 * u} patternUnits="userSpaceOnUse">
          <circle cx={3 * u} cy={3 * u} r={1.3 * u} fill="#050506" />
        </pattern>
      </defs>
      {/* The cabinet, with the screen cut out of it. */}
      <path d={`M0,0H${w}V${h}H0Z ${roundRect(hole.x, hole.y, hole.w, hole.h, r * 1.4)}`} fill="url(#tv-body)" fillRule="evenodd" />
      {/* The chrome trim round the screen, and the tube's dark surround inside it. */}
      <path d={roundRect(hole.x, hole.y, hole.w, hole.h, r * 1.4)} fill="none" stroke="url(#tv-trim)" strokeWidth={Math.max(2, 3 * u)} />
      <path
        d={`${roundRect(hole.x + 1, hole.y + 1, hole.w - 2, hole.h - 2, r * 1.35)} ${roundRect(screen.x, screen.y, screen.w, screen.h, r)}`}
        fill="url(#tv-tube)"
        fillRule="evenodd"
      />
      <path d={roundRect(screen.x, screen.y, screen.w, screen.h, r)} fill="none" stroke="#000" strokeOpacity="0.85" strokeWidth={Math.max(3, 10 * u)} style={{ filter: `blur(${4 * u}px)` }} />
      {side > 40 && (
        <>
          {/* The speaker, left. */}
          <rect x={side * 0.18} y={h * 0.22} width={side * 0.64} height={h * 0.56} rx={8 * u} fill="url(#tv-grille)" stroke="#2f2f35" strokeWidth={2 * u} />
          {/* The dials, right: the channel in its window, then two knobs. */}
          <rect x={kx - side * 0.3} y={h * 0.2} width={side * 0.6} height={h * 0.08} rx={4 * u} fill="#08130a" stroke="#3a3a40" strokeWidth={2 * u} />
          <text
            x={kx}
            y={h * 0.2 + h * 0.058}
            textAnchor="middle"
            fontFamily="ui-monospace, monospace"
            fontWeight={700}
            fontSize={h * 0.045}
            fill="#6dff8a"
            style={{ filter: `drop-shadow(0 0 ${4 * u}px #39ff6a)` }}
          >
            {channel != null ? String(channel).padStart(2, '0') : '--'}
          </text>
          {[0.43, 0.62].map((f, i) => (
            <g key={i}>
              <circle cx={kx} cy={h * f} r={knobR} fill="url(#tv-knob)" stroke="#1a1a1e" strokeWidth={2 * u} />
              <rect x={kx - 1.5 * u} y={h * f - knobR * 0.9} width={3 * u} height={knobR * 0.6} fill="#1a1a1e" transform={`rotate(${i ? -40 : 25} ${kx} ${h * f})`} />
            </g>
          ))}
          <text x={kx} y={h * 0.82} textAnchor="middle" fontFamily="Inter, sans-serif" fontWeight={800} fontSize={h * 0.022} letterSpacing={3 * u} fill="url(#tv-trim)">
            MOSAICTV
          </text>
        </>
      )}
    </svg>
  )
}

// ── The menu ────────────────────────────────────────────────────────────────

const ROWS: { key: keyof Looks; label: string; hint: string }[] = [
  { key: 'crt', label: 'CRT', hint: 'Scanlines, a curve and a glow, like a tube TV (C).' },
  { key: 'tvSet', label: 'TV set', hint: 'A 4:3 program framed by an old set instead of black bars.' },
  { key: 'classicGuide', label: 'Classic guide', hint: 'The channel guide in the blue cable-guide look.' },
]

/** The looks, switched on and off: under TV mode's controls. */
export function LooksMenu({ looks, onChange, onClose }: { looks: Looks; onChange: (patch: Partial<Looks>) => void; onClose: () => void }) {
  return (
    <div className="absolute inset-0" onClick={onClose}>
      <div
        className="absolute top-20 right-4 sm:right-6 w-[min(320px,calc(100vw-2rem))] rounded-2xl bg-[#0b0d13]/95 ring-1 ring-white/10 p-2 shadow-2xl backdrop-blur-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white/45">Looks</div>
        {ROWS.map((r) => (
          <button
            key={r.key}
            role="switch"
            aria-checked={looks[r.key]}
            onClick={() => onChange({ [r.key]: !looks[r.key] })}
            className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/[0.05]"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-medium">{r.label}</span>
              <span className="block text-[12px] text-white/50 leading-snug">{r.hint}</span>
            </span>
            <span className={cx('relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors', looks[r.key] ? 'bg-indigo-500' : 'bg-white/20')}>
              <span className={cx('absolute top-[3px] h-4 w-4 rounded-full bg-white transition-[left] duration-200', looks[r.key] ? 'left-[19px]' : 'left-[3px]')} />
            </span>
          </button>
        ))}
        <p className="px-3 pt-1 pb-2 text-[11.5px] text-white/40 leading-snug">Only here, in this browser: the channels themselves are untouched.</p>
      </div>
    </div>
  )
}

// Sub-pixel motion for layers ffmpeg moves.
//
// ffmpeg's overlay and crop only take whole pixels, so a layer drifting slower
// than a pixel a frame — every ball in Bubbles, most of the time — doesn't
// glide: it sits still, then jumps a pixel. On a crisp edge that reads as a
// tick, several times a second.
//
// The cure is to draw the layer ahead of time at every fraction of a pixel it
// might sit at, side by side in one sheet. Each frame the graph crops out the
// copy for the fraction it needs and places it on the whole pixel below, so
// the layer moves in steps of 1/q of a pixel instead of one.

/** A layer drawn at every 1/q of a pixel, q×q copies on one sheet. */
export type Sheet = {
  /** Straight (not premultiplied) RGBA, row by row — ffmpeg's rgba. */
  data: Buffer
  /** The sheet's size. */
  w: number
  h: number
  /** One copy's cell: the layer plus a pixel of room to shift into (none when q is 1). */
  cellW: number
  cellH: number
  /** Copies along each axis: the copy in column i, row j is moved right i/q and down j/q. */
  q: number
}

/**
 * How finely a layer is placed at a given frame height. A quarter of a pixel
 * up to 1080p; past that the pixels themselves are small enough that a third
 * or a half looks the same, and the sheets stay a sensible size.
 */
export function phasesFor(height: number): number {
  return height <= 1080 ? 4 : height <= 1440 ? 3 : 2
}

const PAD = 2 // the resampler reads two pixels either side

/**
 * Catmull–Rom weights for the four pixels around a sample: in(x−2), in(x−1),
 * in(x), in(x+1) for an output pixel x moved right by `s` of a pixel. At s = 0
 * they're exactly (0, 0, 1, 0), so the unmoved copy is the layer as drawn; the
 * moved ones keep nearly all of its sharpness (bilinear would soften the half
 * pixel copy visibly, and the ball would seem to pulse as it moves).
 */
export function shiftWeights(s: number): [number, number, number, number] {
  if (s <= 0) return [0, 0, 1, 0]
  const t = 1 - s
  const t2 = t * t
  const t3 = t2 * t
  return [(-t3 + 2 * t2 - t) / 2, (3 * t3 - 5 * t2 + 2) / 2, (-3 * t3 + 4 * t2 + t) / 2, (t3 - t2) / 2]
}

/** Each row of a padded image moved right by s, into rows outW wide. */
function shiftRows(p: Float32Array, pw: number, ph: number, outW: number, s: number): Float32Array {
  const out = new Float32Array(outW * ph * 4)
  const [a, b, c, d] = shiftWeights(s)
  for (let y = 0; y < ph; y++) {
    let i = y * pw * 4 // in(x−2) for x = 0, in padded coordinates
    let o = y * outW * 4
    for (let x = 0; x < outW; x++, i += 4, o += 4) {
      out[o] = a * p[i] + b * p[i + 4] + c * p[i + 8] + d * p[i + 12]
      out[o + 1] = a * p[i + 1] + b * p[i + 5] + c * p[i + 9] + d * p[i + 13]
      out[o + 2] = a * p[i + 2] + b * p[i + 6] + c * p[i + 10] + d * p[i + 14]
      out[o + 3] = a * p[i + 3] + b * p[i + 7] + c * p[i + 11] + d * p[i + 15]
    }
  }
  return out
}

/**
 * Rows y0..y1 of the columns of `p` (w wide, still padded top and bottom)
 * moved down by s, written straight into the sheet's cell at (cx, cy) —
 * clamped, and turned from premultiplied into straight alpha on the way.
 */
function shiftColsInto(p: Float32Array, w: number, y0: number, y1: number, s: number, sheet: Sheet, cx: number, cy: number): void {
  const [a, b, c, d] = shiftWeights(s)
  const row = w * 4
  const dst = sheet.data
  for (let y = y0; y < y1; y++) {
    let i = y * row // in(y−2), padded
    let o = ((cy + y) * sheet.w + cx) * 4
    for (let x = 0; x < w; x++, i += 4, o += 4) {
      const A = a * p[i + 3] + b * p[i + 3 + row] + c * p[i + 3 + 2 * row] + d * p[i + 3 + 3 * row]
      if (A < 0.5) continue // transparent: the sheet starts zeroed
      const al = A > 255 ? 255 : A
      const k = 255 / al
      for (let ch = 0; ch < 3; ch++) {
        let v = a * p[i + ch] + b * p[i + ch + row] + c * p[i + ch + 2 * row] + d * p[i + ch + 3 * row]
        v = v < 0 ? 0 : v > al ? al : v // a premultiplied colour can't outshine its alpha
        dst[o + ch] = Math.round(v * k)
      }
      dst[o + 3] = Math.round(al)
    }
  }
}

// The work is done a band of rows at a time, handing the event loop back in
// between: a 1080p scene is a second or two of arithmetic, and the server is
// streaming meanwhile. A band is a few milliseconds.
const BAND = 96
const breathe = () => new Promise<void>((resolve) => setImmediate(resolve))

/**
 * Build a layer's sheet from what resvg drew: `pixels` is premultiplied RGBA,
 * w×h. With q = 1 it's just the layer, converted to straight alpha.
 */
export async function subpixelSheet(pixels: Uint8Array, w: number, h: number, q: number): Promise<Sheet> {
  q = Math.max(1, Math.floor(q))
  const cellW = q === 1 ? w : w + 1
  const cellH = q === 1 ? h : h + 1
  const sheet: Sheet = { data: Buffer.alloc(cellW * q * cellH * q * 4), w: cellW * q, h: cellH * q, cellW, cellH, q }

  // The layer with two pixels of nothing on every side, so the resampler
  // never has to check where it is.
  const pw = w + PAD * 2
  const ph = h + PAD * 2
  const padded = new Float32Array(pw * ph * 4)
  for (let y = 0; y < h; y++) padded.set(pixels.subarray(y * w * 4, (y + 1) * w * 4), ((y + PAD) * pw + PAD) * 4)

  for (let i = 0; i < q; i++) {
    // Moved right by i/q; still padded top and bottom for the vertical pass.
    // The first output column reads in(−2), which sits at padded column 0.
    const rows = shiftRows(padded, pw, ph, cellW, i / q)
    await breathe()
    for (let j = 0; j < q; j++) {
      for (let y = 0; y < cellH; y += BAND) {
        shiftColsInto(rows, cellW, y, Math.min(cellH, y + BAND), j / q, sheet, i * cellW, j * cellH)
        await breathe()
      }
    }
  }
  return sheet
}

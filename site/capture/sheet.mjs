// A contact sheet of images, for looking over generated art at a glance.
//   node site/capture/sheet.mjs <out.jpg> <columns> <tileWidth> <image>…

import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { launch } from './cdp.mjs'

const [out, cols, tw, ...files] = process.argv.slice(2)
const html = `<!doctype html><body style="margin:0;background:#111;display:grid;grid-template-columns:repeat(${cols},${tw}px);gap:6px;padding:6px">${files
  .map((f) => `<img src="${pathToFileURL(path.resolve(f)).href}" style="width:${tw}px;display:block">`)
  .join('')}</body>`
const b = await launch({ port: 9335 })
const p = await b.newPage({ width: Number(cols) * (Number(tw) + 6) + 6, height: 400 })
await p.html(html, path.dirname(path.resolve(out)))
await p.until('[...document.images].every((i) => i.complete)')
await p.shot(out, { full: true, quality: 85 })
await b.close()

// Render one Bubbles clip end to end, without a database: draw the scene,
// build the graph the stream would, and encode it. Proves the SVG renders and
// the ffmpeg graph is valid — the two things a unit test can't check.
//
//   npx tsx scripts/bubblesSmoke.ts <logos-dir> <channel-logo.png> <out.mp4>
//
// HEIGHT=720 draws it at the editor preview's size.

import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { renderBubbleScene, bubblesInputs, MAX_BUBBLES } from '../src/streaming/bubbleScreen.js'
import { assembleVideo, bubblesGraph } from '../src/streaming/identStyles.js'

const [logosDir, chLogo, out] = process.argv.slice(2)
if (!logosDir || !chLogo || !out) {
  console.error('usage: bubblesSmoke.ts <logos-dir> <channel-logo.png> <out.mp4>')
  process.exit(2)
}

const height = Number(process.env.HEIGHT ?? 1080)
const dims = { w: Math.round((height * 16) / 9 / 2) * 2, h: height }
const loop = 30
const titles = fs
  .readdirSync(logosDir)
  .filter((f) => f.endsWith('.png'))
  .slice(0, MAX_BUBBLES)
  .map((f) => ({ title: f.replace(/\.png$/, ''), logoFile: path.join(logosDir, f) }))

const dir = path.join(path.dirname(out), 'bubbles-smoke')
const started = Date.now()
const scene = await renderBubbleScene(dims, chLogo, titles, 311, loop, dir)
console.log(`drew ${scene.balls.length} balls + background in ${((Date.now() - started) / 1000).toFixed(1)}s`)

const build = {
  inputs: bubblesInputs(scene),
  filter: bubblesGraph(scene, dims, loop),
  tone: 86,
  vol: 0.04,
}

const args = assembleVideo(build, loop, out)
const enc = Date.now()
const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] })
let err = ''
proc.stderr.on('data', (d) => (err += String(d)))
const code: number = await new Promise((res) => proc.on('close', res))
if (code !== 0) {
  console.error(err.split('\n').slice(-25).join('\n'))
  scene.dispose()
  process.exit(1)
}
console.log(`encoded in ${((Date.now() - enc) / 1000).toFixed(1)}s -> ${out} (${(fs.statSync(out).size / 1e6).toFixed(1)} MB)`)
scene.dispose()

import fs from 'node:fs'
import path from 'node:path'

// Single source of truth for the version. The image is built with APP_VERSION
// set — the release itself for a tag ("0.14.0"), the version plus the commit
// for anything else ("0.14.0+cb8eee7") — so a bug report names the exact
// build. Without it (dev, or an image built by hand) it's the server's own
// package.json, which sits beside the compiled dist/ in the image and beside
// src/ in dev.
function appVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf8'))
    return String(pkg.version ?? 'unknown')
  } catch {
    return 'unknown'
  }
}

export const VERSION = appVersion()

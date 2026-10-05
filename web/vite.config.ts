import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, searchForWorkspaceRoot } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

const here = path.dirname(fileURLToPath(import.meta.url))
// The server/web contract (see server/src/contract/index.ts): shared source,
// built into the app like any of its own files.
const contract = path.resolve(here, '../server/src/contract')
// The same folder as Rollup spells module ids (forward slashes, even on Windows).
const contractId = contract.split(path.sep).join('/')

// During `npm run dev` the React app runs on :5173 and proxies API calls to the
// Express backend on :8688. In production the backend serves the built app.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // Tells one build from the next, so what the last one kept in the browser
    // (lib/cache.ts) — shaped as that build read it — isn't shown by this one.
    __BUILD_ID__: JSON.stringify(Date.now().toString(36)),
  },
  resolve: {
    alias: { '@contract': path.join(contract, 'index.ts') },
    // The contract imports zod from outside this package; use ours (the Docker
    // build and CI have no server/node_modules when the web app builds).
    dedupe: ['zod'],
  },
  server: {
    port: 5173,
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), contract] },
    proxy: {
      '/api': 'http://localhost:8688',
      // The live streams, so the preview and TV mode play in dev too.
      '/iptv': 'http://localhost:8688',
    },
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      // The contract's modules only declare things, so what the app doesn't
      // use (the request schemas, and with them zod) is left out of the bundle.
      treeshake: { moduleSideEffects: (id) => !id.startsWith(contractId) },
    },
  },
})

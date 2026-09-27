// The contract between the server and the web app: the API's vocabulary, what
// each write accepts (zod schemas the server validates with), what each read
// answers (types the server checks its answers against), and the overlay
// settings both sides edit. The server compiles it as part of itself; the web
// app imports it as `@contract` (see web/vite.config.ts and web/tsconfig.json).
//
// Everything here runs in both places, so nothing here may touch Node, the
// database or the DOM.
export * from './domain.js'
export * from './overlays.js'
export * from './requests.js'
export type * from './responses.js'
export type * from './wire.js'

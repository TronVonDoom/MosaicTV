/**
 * A server-side shape as the browser receives it: JSON turns every Date into
 * an ISO string. The contract's response types are written as the server
 * builds them (so a route can check its answer with `satisfies`); the web app
 * reads them through this.
 */
export type Wire<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Wire<U>[]
    : T extends object
      ? { [K in keyof T]: Wire<T[K]> }
      : T

/**
 * A response type as the database holds it, for a route to check its answer
 * against: a closed set of strings (a playback order, an ident style) is a
 * plain string column there. The routes only ever store valid values, which
 * is what lets the web app read the narrower type.
 */
export type Stored<T> = T extends string
  ? string
  : T extends Date
    ? Date
    : T extends (infer U)[]
      ? Stored<U>[]
      : T extends object
        ? { [K in keyof T]: Stored<T[K]> }
        : T

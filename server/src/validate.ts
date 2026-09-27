import type { Request, Response } from 'express'
import type { z } from 'zod'

/**
 * Read a request body with its contract schema (contract/requests.ts). A bad
 * body gets a 400 with the schema's message — written to be shown as-is, the
 * way the routes' own messages always were — and `undefined` back, so a route
 * reads `const body = readBody(Schema, req, res); if (!body) return`.
 */
export function readBody<S extends z.ZodType>(schema: S, req: Request, res: Response): z.output<S> | undefined {
  const parsed = schema.safeParse(req.body ?? {})
  if (parsed.success) return parsed.data
  res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'That request is missing something.' })
  return undefined
}

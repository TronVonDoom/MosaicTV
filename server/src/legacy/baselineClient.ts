// The frozen Prisma client for the 0.12.0 baseline (prisma/baseline.prisma),
// generated beside the app's own client by `npm run prisma:generate`. Only the
// legacy data migrations use it — see dataMigrations.ts for why.
import baseline from '../../node_modules/.prisma-baseline/client/index.js'

export type BaselineDb = InstanceType<typeof baseline.PrismaClient>

/** A connection for the length of the legacy migrations; disconnect it after. */
export function openBaselineDb(): BaselineDb {
  return new baseline.PrismaClient()
}

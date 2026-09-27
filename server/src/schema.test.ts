import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const schemaPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'prisma',
  'schema.prisma',
)

/** Every field in the schema, as "Model.field" with its attributes. */
function fields(): { key: string; line: string }[] {
  const out: { key: string; line: string }[] = []
  let model = ''
  for (const raw of fs.readFileSync(schemaPath, 'utf8').split('\n')) {
    const line = raw.trim()
    const start = line.match(/^model\s+(\w+)\s*\{/)
    if (start) {
      model = start[1]
      continue
    }
    if (line === '}') {
      model = ''
      continue
    }
    if (!model || line.startsWith('//') || line.startsWith('@@')) continue
    const field = line.match(/^(\w+)\s+\S+/)
    if (field) out.push({ key: `${model}.${field[1]}`, line })
  }
  return out
}

// These two predate the rule: their tables have carried the column since they
// were created, so no existing install ever has to add it to populated rows.
// Nothing new belongs here — add a default instead.
const LEGACY_NO_DEFAULT = new Set(['Show.updatedAt', 'MediaItem.updatedAt'])

test('every @updatedAt column has a default', () => {
  // Migrations run at startup against databases that already have rows. A NOT
  // NULL column with no default cannot be added to a populated table, so the
  // migration fails and the server doesn't start (the database is restored,
  // but the upgrade is stuck). This shipped once (0.8.3, Logo.updatedAt, back
  // when startup ran `db push`) and stopped every existing instance. The
  // migration rehearsal (npm run db:rehearse) catches the general case; this
  // is the cheap early warning for the shape that bit.
  for (const { key, line } of fields()) {
    if (!line.includes('@updatedAt') || LEGACY_NO_DEFAULT.has(key)) continue
    assert.ok(
      line.includes('@default('),
      `${key} is @updatedAt with no @default — a migration cannot add it to a table that already has rows`,
    )
  }
})

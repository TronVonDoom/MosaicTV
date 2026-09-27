#!/usr/bin/env sh
# Container startup: ensure the data dir exists, then run. The server brings
# the database schema up to date itself before it serves anything (versioned
# migrations, with a copy of the database taken first — see dbMigrate.ts).
set -e

mkdir -p /app/data

echo "==> Starting MosaicTV..."
exec node dist/index.js

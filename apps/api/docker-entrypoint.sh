#!/bin/sh
# Migrate, seed (skipped when data exists unless SEED_RESET=true), then start the API with the in-process worker.
set -e
npx prisma migrate deploy
node dist/seed/run.js
exec node dist/main.js

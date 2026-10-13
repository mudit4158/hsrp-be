#!/bin/sh
# Migrate (a Prisma-built database is stamped, not recreated), seed (skipped when data exists unless SEED_RESET=true),
# then start the API with the in-process worker.
set -e
python -m app.platform.db.migrate_on_start
python -m app.seed.run
exec python -m uvicorn app.main:app --host "${API_HOST:-0.0.0.0}" --port "${API_PORT:-3000}"

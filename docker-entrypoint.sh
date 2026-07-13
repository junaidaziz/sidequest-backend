#!/bin/sh
set -e

# Applies any migrations not yet present in the target database — safe to run
# on every container start (a no-op when the schema is already up to date),
# so a rolling deploy never boots against a stale schema.
npx prisma migrate deploy

exec "$@"

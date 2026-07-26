# Release Guide

## Where this deploys

Railway (Dockerized), connected to the `junaidaziz/sidequest-backend` GitHub repo. Every push to `main` (or `feature/admin-platform`, per `.github/workflows/ci.yml`'s trigger branches) runs CI; a push to `main` that passes CI triggers Railway's auto-deploy via its GitHub listener. Postgres and Redis are Railway-managed add-ons in the same project, referenced via Railway's internal variable syntax (`${{Postgres.DATABASE_URL}}`, `${{Redis.REDIS_URL}}`) rather than hardcoded connection strings.

**Railway's "Wait for CI" setting and `main` branch protection requiring the `Backend CI / test` check are external configuration** — not enforceable from code in this repo. Before treating production as protected, verify both are actually enabled in Railway/GitHub; this can't be confirmed by reading this repo alone.

## Pre-release checklist

Everything in `docs/QA_PROCESS.md`'s gate, plus:

- [ ] `prisma/migrations/` includes every schema change in this release, and `npx prisma migrate deploy` has been dry-run-verified against a copy of production shape (not just the dev DB).
- [ ] New/changed env vars are set in Railway's `production` environment variables **before** the deploy that needs them — a missing required var fails the container at boot (`getOrThrow` calls), not gracefully.
- [ ] `../references/api-contract.md` reflects any endpoint added/changed/removed in this release.
- [ ] If the change affects `mobileApp` or `web`'s expected response shape, the corresponding repo's CLAUDE.md/type contract has been checked for drift — backend is the source of truth, but a breaking shape change still needs the consumer repos updated in the same rollout window.

## The Dockerfile, briefly

Multi-stage (`node:22-alpine`): `builder` installs the native-module toolchain (`python3 make g++ openssl` — bcrypt needs it, Prisma's engine-detection needs `openssl`), runs `npm ci` + `prisma generate` + `nest build`. `runner` reinstalls `--omit=dev` (still needs the toolchain for bcrypt's binding), regenerates the Prisma client fresh (not copied across stages — avoids cross-stage binary-compatibility doubt), copies `dist/` + `docker-entrypoint.sh`, runs as the non-root `node` user. `docker-entrypoint.sh` runs `prisma migrate deploy` (`set -e` — a failed migration fails the container start, never boots against a stale schema) then `exec "$@"` so Node becomes PID 1 and receives Railway's SIGTERM directly.

**Do not remove `tsconfig.build.json`'s `"include": ["src/**/*.ts"]`.** Without it, the build output nests one level deeper (`dist/src/main.js`) and `start:prod`'s `node dist/main` silently fails to find the entrypoint — this was a real, previously-shipped bug.

## Graceful shutdown

`main.ts` calls `app.enableShutdownHooks()` before `app.listen()`. Without it, Railway's SIGTERM on redeploy/scale-down kills in-flight requests, closes Prisma's pool without draining transactions, and abandons in-progress BullMQ jobs. Don't remove this call.

## Post-deploy verification

Don't assume a green CI run + successful Railway build means the deploy actually works — verify:

```bash
curl https://<railway-domain>/health                  # expect 200 {"status":"ok",...}
curl https://<railway-domain>/docs                    # expect 404 in production (Swagger is dev/test-only)
```

A `POST /auth/guest` against the live domain returning a real `AuthResponse` confirms the full stack (JWT signing, Prisma, real Postgres) end-to-end, not just that the process booted.

## If the payment module 502s in production

Check `STRIPE_SECRET_KEY` is set to a real key in Railway's environment variables before debugging the code — a placeholder/unset key produces exactly this symptom by design (`StripeService.wrap()` maps auth/connection failures to 502).

## Rollback

Railway keeps prior deploys — use its dashboard/CLI to roll back to the last known-good deploy if a release fails post-deploy verification. A migration applied by `docker-entrypoint.sh` is not automatically reverted by a Railway rollback — if the failed release included a schema migration, confirm whether the previous code version is still compatible with the new schema before rolling back, or prepare a down-migration.

## Related documents

- `docs/QA_PROCESS.md` — the gate this checklist assumes already passed
- `../../CLAUDE.md`'s "Deployment" section
- `infra/media-cdn/README.md` — Terraform for the media CDN (never-applied status as of writing; read before assuming it's live infrastructure)

# Architecture Guide

This is the orientation map. `../../CLAUDE.md` is the deep, continuously-verified reference (database schema, security model, background jobs, row-locking pattern, product-scope conflicts) — read it before touching any module. This file exists to answer "where does X live and why" without re-deriving the whole system from scratch.

## Shape of the system

One deployable NestJS 11 modular monolith (`src/`), not microservices. Each top-level directory under `src/` is a Nest module scoped to one bounded concern — auth, missions, proof, tasks, notifications, payment, media, referrals, users on the consumer side; admin-auth, rbac, admin (users), admin-challenges (missions), moderation, analytics, notification-campaigns, app-config, audit-log, cms on the admin platform side. See `../references/api-contract.md` for the full route inventory of both surfaces.

```
src/
  <feature>/
    <feature>.module.ts
    <feature>.controller.ts     # thin — validates via DTO, delegates to service, shapes the response
    <feature>.service.ts        # business logic, Prisma calls, all of it here
    dto/                        # class-validator-decorated request/response shapes
    <feature>.service.spec.ts   # co-located unit tests
```

Controllers never call Prisma directly and never contain business logic — see `docs/CODING_STANDARDS.md`. This is enforced by convention and by `backend-eval`'s Layer A review, not by a lint rule, so it's easy to violate accidentally in a rush; don't.

## Two authentication/identity systems, not one

- **Consumer identity** (`src/auth`): guest-or-account `User` rows, `JwtAuthGuard`, the guest-first upgrade-in-place model. This is what `mobileApp` and `web`'s public marketing site (indirectly, for account-deletion requests) talk to.
- **Admin identity** (`src/admin-auth`, `src/rbac`): a completely separate `AdminUser` model, session system, and MFA-gated login, checked with `AdminJwtAuthGuard` + `PermissionGuard`/`@RequirePermissions()`. This is what `web`'s admin portal talks to.

These do not share tokens, guards, or user tables. A bug where an admin route accidentally uses `JwtAuthGuard` (consumer) instead of `AdminJwtAuthGuard` is a real security regression, not a style nit — `backend-eval`'s Layer C treats it as a FAIL, not a WARN.

## Cross-cutting infrastructure

- **Idempotency** (`src/idempotency`) — reserve-then-execute, threaded through proof submission and most Tasks/Referrals mutations. See `../../CLAUDE.md`.
- **Background jobs** (`src/verification`, notification push-send, `src/media` variant generation) — all BullMQ, no cron. Three queues: `verification`, `notifications`, `media-processing`.
- **Storage** (`src/storage`, `src/media`) — S3-compatible, endpoint-configurable so LocalStack (dev/CI) and real AWS S3 (prod) run the same code path.
- **Redis** (`src/redis`) — backs BullMQ and the global rate limiter (`@nest-lab/throttler-storage-redis`), so rate limiting is correct across a future multi-instance deployment even though only one instance runs today.

## Data model

`prisma/schema.prisma` is the single source of truth for shape; do not hand-describe it elsewhere and let the description drift. `../../CLAUDE.md`'s "Database" section is the maintained model-by-model walkthrough — read it before adding a model or field, in particular the `@@map` inconsistency note (only the four oldest models have table-name overrides) since raw SQL row-locking calls have to match that per-model.

## Consumer vs. admin API split

Consumer routes (`/auth`, `/missions`, `/tasks`, `/notifications`, `/payment`, `/media`, `/referrals`, `/users`, `/home`) are what `mobileApp` builds against. Admin routes (`/admin/*`, plus public `/cms/*` and `/config/public`) are what `web` builds against. A change to a shared piece of infrastructure (e.g. the media pipeline, notification types) usually touches both — check `../references/api-contract.md` for which controllers reference the model you're changing before assuming a schema change is consumer-only or admin-only.

## Related documents

- `../../CLAUDE.md` — deep reference, updated whenever the code changes underneath it
- `../references/api-contract.md` — full route inventory, both surfaces
- `docs/CODING_STANDARDS.md` — the rules `backend-implementer`/`backend-eval` enforce
- `docs/QA_PROCESS.md` — what "done" requires

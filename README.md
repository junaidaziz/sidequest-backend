# sidequest-backend

NestJS + Prisma + PostgreSQL backend for SideQuest, a real-world mission generator app. Provides auth (guest + email/password + Google, plus account deletion), curated mission generation, proof submission with S3-backed photo storage, XP/streak tracking, a peer-to-peer Tasks/Challenges system, in-app + push notifications, Stripe payment-methods-on-file, a referral program, and a Home aggregation endpoint. See `../mobileApp` for the Expo client that consumes this API, and `CLAUDE.md` / `../.claude/contracts/api-contract.md` for the full module-by-module and endpoint-by-endpoint reference.

## Stack

NestJS 11 · Prisma 5 · PostgreSQL 16 · Redis 7 (caching + BullMQ queues) · S3-compatible object storage (LocalStack in dev, real AWS in production) · Stripe (SetupIntent/PaymentMethods only — no charges) · Expo push service (`expo-server-sdk`) · JWT auth · Swagger (dev/test only) · Jest

## Setup

```bash
npm install
docker compose up -d                # postgres, redis, localstack
cp .env.example .env                # defaults already point at the compose services above
npx prisma migrate deploy           # apply migrations
npx prisma db seed                  # load the curated mission pool
docker exec backend-localstack-1 awslocal s3 mb s3://sidequest-proofs-dev  # container name may vary by docker compose project name
npm run start:dev
```

API listens on `http://localhost:3000`. Swagger docs at `http://localhost:3000/docs` (dev/test only — disabled in production, see [Security](#security) below).

## Common commands

```bash
npm run start:dev        # dev server with hot reload
npm run build             # production build
npm run start:prod        # run the built output

npm test                  # unit tests
npm test -- --coverage    # unit tests with coverage (must stay ≥ 80% on all four dimensions)
npm run test:e2e          # e2e tests — needs docker compose services running

npm run lint               # eslint with --fix (local dev)
npm run lint:check         # eslint --max-warnings 0, no mutation (what CI runs)

npx prisma migrate dev     # create + apply a new migration (local dev only)
npx prisma migrate deploy  # apply pending migrations non-interactively (CI/prod)
npx prisma studio          # browse the database
```

## Architecture

Clean Architecture: thin controllers, business logic in services, Prisma as the only data-access layer. Every endpoint has a DTO with `class-validator` decorators, validated by a global `ValidationPipe` (whitelist, forbid unknown fields, auto-transform).

- **Auth** (`src/auth`) — a single `User` table represents both guests and full accounts. A guest session is just an anonymous JWT (`isGuest: true`); signing up upgrades the same row in place rather than creating a new user, so mission history and XP carry over. Access + refresh tokens share a secret, disambiguated by a `type` claim; refresh tokens are stored server-side only as `bcrypt(sha256(rawToken))`, never raw.
- **Missions** (`src/missions`) — a curated, seeded mission pool filtered in-memory by crew/time/setting/budget context. `MissionPoolService` caches the active pool in Redis (60s default TTL, `MISSION_POOL_CACHE_TTL_SECONDS` to override) with a strictly best-effort read/write path — any Redis error falls straight through to Postgres.
- **Proof** (`src/proof`) — photo (uploaded to S3) or text proof submission, flat XP award, UTC-calendar-day streak calculation, and a one-free-completion guest gate enforced via a row-locked (`SELECT ... FOR UPDATE`) transaction to close a TOCTOU race under concurrent requests.
- **Home** (`src/home`) — a single aggregation endpoint (level, streak, a deterministic "today's mission" pick, saved-mission packs grouped by shared tags, and task stats) so the mobile Home screen needs one request instead of several.
- **Storage** (`src/storage`) — a thin wrapper over the AWS SDK S3 client, driven entirely by env vars so the same code runs against LocalStack in dev/test and real S3 in production.
- **Admin/Verification** (`src/admin`, `src/verification`) — a single shared-secret-gated (`x-admin-key`) route to manually approve/reject a Pending proof completion, racing a BullMQ delayed auto-approve job (default 24h timeout) via row-level locking so exactly one of the two ever resolves a given completion.
- **Tasks** (`src/tasks`) — the peer-to-peer feature the mobile app calls "Challenges": create a task, generate a shareable invite link, accept/decline, submit evidence (photo/notes), and creator-approval review — full lifecycle, all JWT-guarded, idempotency-key-aware throughout.
- **Notifications** (`src/notifications`) — in-app notification inbox plus best-effort push delivery via a BullMQ queue and the Expo push service, behind a swappable `PushProviderClient` interface.
- **Payment** (`src/payment`) — Stripe SetupIntent + saved-card management only; there is no charge/checkout endpoint anywhere in this module or the codebase.
- **Referrals** (`src/referrals`) — lazily-minted referral codes, invite-channel analytics, and a DB-configurable reward rule (currently: 50 XP to the referrer on the referee's first approved completion).
- **Idempotency** (`src/idempotency`) — a cross-cutting reserve-then-execute mechanism (an `Idempotency-Key` header, checked before a mutation runs, not just after) reused by proof submission and nearly every Tasks/Referrals mutation.

## API surface

The table below is a quick-reference summary only — see `../.claude/contracts/api-contract.md` for the full request/response shape of every endpoint, or Swagger (`/docs`, dev/test only).

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/auth/guest` | — | Bootstrap an anonymous guest session |
| POST | `/auth/signup` | — | Register (upgrades a guest bearer token in place if present) |
| POST | `/auth/login` | — | Email + password |
| POST | `/auth/google` | — | Verifies a Google ID token server-side |
| POST | `/auth/refresh` | — | Rotate a refresh token |
| POST | `/auth/logout` | Bearer | Revokes refresh token, best-effort deregisters push token |
| GET | `/auth/me` | Bearer | Current user's profile |
| PATCH | `/auth/me` | Bearer | Update display name |
| PATCH | `/auth/password` | Bearer | Change password |
| DELETE | `/auth/me` | Bearer | Soft-delete + anonymize account |
| GET | `/home` | Bearer | Aggregated Home screen payload |
| POST | `/missions/generate` | — | Up to 3 missions matching an onboarding context |
| GET | `/missions/saved` | Bearer | Paginated saved-missions list |
| POST | `/missions/:missionId/save` | Bearer | Bookmark a mission (idempotent) |
| DELETE | `/missions/:missionId/save` | Bearer | Un-bookmark (idempotent) |
| POST | `/missions/:missionId/proof` | Bearer | Submit photo/text proof, awards XP |
| PATCH | `/admin/completions/:id/verification` | `x-admin-key` | Manual approve/reject override |
| POST/GET/PATCH/DELETE | `/tasks*` | Bearer | Full Challenges lifecycle — see contract doc |
| GET/PATCH/POST | `/notifications*` | Bearer | Inbox, unread count, preferences, push tokens |
| POST/GET/DELETE/PATCH | `/payment*` | Bearer | SetupIntent + saved-card management |
| POST/DELETE | `/users/me/avatar` | Bearer | Avatar upload/remove |
| GET/POST | `/referrals*` | Bearer | Referral code, history, invite analytics |
| GET | `/health` | — | Liveness check |

## Testing

Every endpoint ships with unit tests (service + controller) and e2e tests (`test/*.e2e-spec.ts`, run against the real dockerized Postgres/Redis/LocalStack). Coverage is enforced at 80% minimum across statements/branches/functions/lines via Jest's `coverageThreshold`; the project currently sits at 100% on every file. e2e tests run with `maxWorkers: 1` (see `test/jest-e2e.json`) — several spec files create/delete fixture rows against the same shared dev database and Redis cache, and rely on running sequentially.

## Security

- Rate limiting via `@nestjs/throttler`: a global default plus tighter per-endpoint tiers on unauthenticated/high-value routes (`/auth/guest`, `/auth/signup`, `/auth/login`, `/auth/refresh`, `/missions/generate`).
- `helmet` for standard security headers (CSP disabled specifically, since this is a JSON API whose only HTML surface is the dev-only Swagger UI).
- CORS via `CORS_ALLOWED_ORIGINS` (comma-separated origin allow-list) — fails closed (no cross-origin access) in production when unset; native mobile clients are unaffected by CORS either way.
- Swagger docs (`/docs`) are gated to `NODE_ENV=development`/`test` only — an allow-list, so a deployment that forgets to set `NODE_ENV` fails closed rather than accidentally exposing the full API shape.
- Structured request logging with a per-request correlation id (`X-Request-Id`), validated against a UUID shape to close a log-injection vector from an attacker-supplied header.

## CI

`.github/workflows/ci.yml` runs on every push/PR to `main`: spins up postgres/redis/localstack service containers, then `prisma generate` → `prisma migrate deploy` → typecheck → lint → unit tests (coverage-gated) → e2e tests.

## Environment variables

See `.env.example` for the full list with inline documentation. Never commit `.env` — it's gitignored, and any real credentials (S3, database) belong only in the local, untracked file or your deployment platform's secret store.

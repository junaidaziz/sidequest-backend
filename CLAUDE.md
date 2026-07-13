# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SideQuest backend — NestJS API serving the mobile app's mission generator, guest/account auth, and proof submission.

This document is written from the actual codebase as of 2026-07-13, not from earlier planning material. If you find a discrepancy between this file and the code, the code wins — update this file.

## Stack (as actually installed, not aspirational)

- Runtime: Node.js, TypeScript, NestJS 11 (modular monolith — one deployable, feature modules under `src/`)
- Database: PostgreSQL via Prisma 5, hosted on **Railway** (not Supabase)
- Cache / rate-limit backing store: Redis via `ioredis`, hosted on **Railway** (not Upstash). `@nest-lab/throttler-storage-redis` backs the global throttler.
- Queues: `bullmq` + `@nestjs/bullmq` are installed dependencies but **no queue, processor, or job currently exists in `src/`** — this is unused infrastructure, provisioned ahead of the planned verification-timeout job, not a working feature yet.
- Object storage: AWS S3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) — **not Cloudflare R2**. `src/storage/storage.service.ts` is endpoint-configurable so the same code runs against a local LocalStack container in dev (`S3_ENDPOINT` set, path-style addressing) and real AWS S3 in production (`S3_ENDPOINT` unset).
- Auth: custom JWT (`@nestjs/jwt` + `passport-jwt`), **not Firebase Auth**. Google Sign-In is verified server-side against Google's own token endpoint via `google-auth-library`'s `OAuth2Client.verifyIdToken` — this was a deliberate divergence from an earlier plan that assumed Firebase; there is no `GoogleService-Info.plist`/Firebase project in this system.
- API docs: `@nestjs/swagger`, mounted at `/docs`, only when `NODE_ENV` is `development` or `test` (disabled in production — DTOs shouldn't be enumerable unauthenticated).

## Architecture

### Auth model — guest-first, not "no guest mode"

Every `User` row can be a guest or a full account — there is no separate guest table. A fresh mobile install auto-bootstraps an anonymous guest session (`POST /auth/guest`) with no email or password. Signing up or signing in with Google **upgrades that same row in place** (`isGuest: true → false`, guest's mission/XP history carries over) rather than creating a second account. This upgrade-in-place path is reused by both `signup` and `google` in `auth.service.ts` and is a load-bearing part of the onboarding flow, not an incidental detail.

### JWT strategy

- Access + refresh token pair, `type` claim (`access`/`refresh`) checked on every validation so a refresh token can never be used where an access token is expected (`src/auth/strategies/jwt.strategy.ts`).
- Refresh tokens are rotated server-side: the current refresh token's hash (bcrypt over a SHA-256 digest, never the raw token) is stored on `User.refreshTokenHash`. `POST /auth/logout` clears it, invalidating all outstanding refresh tokens for that user immediately — not just locally on the calling device.
- `JwtStrategy.validate()` rejects tokens for users that no longer exist or are soft-deleted (`deletedAt` set).

### Database (`prisma/schema.prisma`)

- `User` — unifies guests and accounts (see above). Also carries `totalXp`, `currentStreak`/`longestStreak` (UTC-calendar-day based, not user-local-timezone), `lastCompletionDate`. Soft-deletable via `deletedAt`.
- `Mission` — curated content pool for the rules-based filter generator (not an LLM). Matched against a request's `crew`/`time`/`setting`/`budget` via `crewTags`/`settingTags`/`estimatedMinutes`/`costTier`.
- `SavedMission` — a user bookmarking a mission. No separate "Pack" entity; the home screen derives display packs by grouping a user's saved missions by shared tags at read time.
- `Completion` — one row per completed mission, proof type (`photo`/`text`), `proofKey` (an S3 object key, not a full URL — resolved to a presigned GET URL at read time), `xpAwarded`.
- No `Challenge`, `Report`, `Payment`, or `PushToken`/notification model exists yet — see **Product-scope conflicts** below.

### Endpoints (actual, as of this file's writing)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | none | |
| POST | `/auth/guest` | none | bootstraps anonymous session |
| POST | `/auth/signup` | optional (guest bearer upgrades in place) | |
| POST | `/auth/login` | none | |
| POST | `/auth/google` | optional (guest bearer upgrades in place) | verifies Google ID token server-side |
| POST | `/auth/refresh` | refresh token in body | rotates the token pair |
| POST | `/auth/logout` | JWT | revokes server-side refresh token |
| GET | `/auth/me` | JWT | |
| GET | `/home` | JWT | level/streak/daily mission/saved packs; `pendingChallenges` always `[]` — no challenge backend exists |
| POST | `/missions/generate` | none (public, pre-account) | rules-filter mission generator |
| POST | `/missions/:missionId/save` | JWT | idempotent bookmark |
| DELETE | `/missions/:missionId/save` | JWT | idempotent unbookmark |
| POST | `/missions/:missionId/proof` | JWT | multipart photo or JSON text proof; awards XP immediately, no review queue |

There is no admin/verification/moderation endpoint, no payment endpoint, and no push-notification endpoint yet — the verification-workflow, dashboard-stats, profile/avatar, and Stripe payment-methods work is planned (see `.claude/workflows/CONTINUE_DEVELOPMENT.md`) but **not started** in this codebase as of this writing.

### Security

- `helmet` (CSP deliberately disabled — this is a JSON API whose only HTML surface is dev-only Swagger, which needs inline scripts the default CSP blocks; every other helmet protection stays on).
- CORS is an allow-list from `CORS_ALLOWED_ORIGINS`; unset fails closed (no cross-origin access) in production, permissive only in dev/test. Irrelevant to native mobile clients (no `Origin` header), relevant to the Expo web target.
- Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` — any request field outside a DTO's declared shape is a 400, not silently dropped.
- `@nestjs/throttler` with Redis-backed storage; global default from `THROTTLE_TTL`/`THROTTLE_LIMIT`, tighter per-route overrides on sensitive endpoints (e.g. 5/60s on login/signup/google, 10/60s on guest creation).
- `app.enableShutdownHooks()` is required in `main.ts` — without it, a Railway SIGTERM on redeploy cuts in-flight requests and abandons BullMQ jobs instead of draining cleanly.

### Environment variables (real names, from `.env.example`)

```
NODE_ENV, PORT, CORS_ALLOWED_ORIGINS
DATABASE_URL                              # Postgres, Railway-managed
REDIS_URL                                 # Redis, Railway-managed
MISSION_POOL_CACHE_TTL_SECONDS            # optional, default 60
JWT_SECRET, JWT_ACCESS_TOKEN_TTL, JWT_REFRESH_TOKEN_TTL, GUEST_TOKEN_TTL
GOOGLE_OAUTH_WEB_CLIENT_ID, GOOGLE_OAUTH_IOS_CLIENT_ID   # OAuth client IDs, not secrets — verified against the ID token's `aud` claim
THROTTLE_TTL, THROTTLE_LIMIT
S3_ENDPOINT, S3_FORCE_PATH_STYLE, S3_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
```

Never paste real values for any of these into chat, including to an AI assistant — set them directly via `railway variables set` (production) or a local `.env` (gitignored). This applies to every secret above, and will apply to `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` once the payment-methods work starts.

## Product-scope conflicts (flagged, not silently resolved)

An earlier planning document (not present in this repository — described to me secondhand) stated the following Phase 1 rules. Checked against the actual code:

1. **"No guest mode"** — directly contradicted. Guest-first with upgrade-in-place is the foundational auth architecture, not an add-on. Removing it would be a large rearchitecture, not a config flag.
2. **"Three modes only: Friends Night, Couple Mode, Solo Adventure"** — partially contradicted. The mobile `ModeSelectScreen` offers more than three taps (solo/couple/friends/family/kids/city/confidence/travel), none named exactly as above; they map onto the backend's generic `crew`/`time`/`setting`/`budget` filter primitives rather than being distinct backend-modeled modes.
3. **"One-to-one challenges"** — not implemented. `HomeResponse.pendingChallenges` is hardcoded to `[]`, with a comment in the mobile types file stating "no challenge-sending backend exists yet."
4. **"One paid pack" + server-verified receipt validation gating unlock** — not implemented. No pack/purchase/receipt model exists. Note the Stripe work now planned (`.claude/workflows/CONTINUE_DEVELOPMENT.md`) is a **payment-methods-on-file** feature (SetupIntent + attach/detach card), not a pack-purchase-and-unlock feature — these are different shapes of work; confirm before assuming the Stripe milestone satisfies this rule.
5. **"Account deletion anonymizes proof media / other participants see a placeholder"** — not implemented. There is no account-deletion endpoint at all yet (no `DELETE /auth/me` or equivalent).
6. **"Single report hides for reporter only; global hide needs admin or a second report"** — not implemented. No report/moderation model or endpoint exists.
7. **"No blind push notification to an unresolved-identity challenge recipient"** — moot for now: there is no push-notification infrastructure and no challenge system to notify about.

Do not build any of the above as if it already exists. If asked to build one, treat it as new work against the real schema, not a fix to something broken.

## Testing Requirements

- Runner: Jest (`jest.config` embedded in `package.json`), `ts-jest`, `testEnvironment: node`.
- Coverage threshold enforced globally: 80% branches/functions/lines/statements. A change that drops any dimension below 80% should not be considered done.
- `npm test` (unit, co-located `*.spec.ts` next to source), `npm run test:cov` (with coverage), `npm run test:e2e` (separate Jest config under `test/`, real HTTP + Prisma against a test database).
- Every new endpoint needs: DTO with `class-validator` decorators, an auth guard if it isn't intentionally public, a unit test for the service method, and — for anything touching a new flow — an e2e test.

## Common Commands

```bash
npm run start:dev        # NestJS with watch mode
npm run build             # nest build (requires tsconfig.build.json's include — see below)
npm run start:prod        # node dist/main — only works after a correct build
npm run lint               # eslint --fix
npm run lint:check         # eslint, zero warnings allowed (CI mode)
npm test                   # unit tests
npm run test:cov           # unit tests + coverage report
npm run test:e2e           # e2e tests
npm run prisma:generate    # regenerate Prisma client after a schema change
npm run prisma:migrate     # create + apply a dev migration
npm run prisma:studio      # Prisma's DB browser GUI
```

`tsconfig.build.json` must keep an explicit `"include": ["src/**/*.ts"]` — without it, `prisma/seed.ts` gets swept into the build output and `dist/main.js` ends up nested one level deeper than expected (`dist/src/main.js`), silently breaking `npm run start:prod`. This was a real, previously-unnoticed bug in this project's history — do not remove that `include`.

## Deployment

Railway (Dockerized). Postgres and Redis are Railway-managed add-ons, not external SaaS. GitHub push triggers an auto-deploy. See `docs/backend/Deployment.md` and `docs/deployment/Infrastructure.md` for the full setup — those docs are kept in sync with the real deployment, unlike the planning-stage stack assumptions this file corrects above.

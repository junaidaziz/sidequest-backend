# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

SideQuest backend — NestJS API serving the mobile app's mission generator, guest/account auth, proof submission, peer-to-peer tasks/challenges, notifications (in-app + push), payment-methods-on-file, admin verification, and referrals.

This document is written from the actual codebase as of 2026-07-16, not from earlier planning material. If you find a discrepancy between this file and the code, the code wins — update this file. (The previous version of this file, dated 2026-07-13, was found to be wrong on nearly every "not implemented" claim — the Tasks, Notifications, Admin/Verification, Payment, and Referrals modules below were all already fully built at that time and simply undocumented. Don't assume a "not implemented" note here is still accurate without checking.)

## Stack (as actually installed, not aspirational)

- Runtime: Node.js, TypeScript, NestJS 11 (modular monolith — one deployable, feature modules under `src/`)
- Database: PostgreSQL via Prisma 5, hosted on **Railway** (not Supabase)
- Cache / rate-limit backing store: Redis via `ioredis`, hosted on **Railway** (not Upstash). `@nest-lab/throttler-storage-redis` backs the global throttler.
- Queues: `bullmq` + `@nestjs/bullmq`, one connection (`BullModule.forRootAsync`, parsed from `REDIS_URL`), **two queues actively in use** — not unused infrastructure:
  - `verification` — delayed auto-approve job for a Pending proof completion.
  - `notifications` — push-send + push-receipt-check jobs.
  - See "Background jobs" below for the full producer/consumer wiring.
- Object storage: AWS S3 (`@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`) — **not Cloudflare R2**. `src/storage/storage.service.ts` is endpoint-configurable so the same code runs against a local LocalStack container in dev (`S3_ENDPOINT` set, path-style addressing) and real AWS S3 in production (`S3_ENDPOINT` unset).
- Payments: Stripe (`stripe` Node SDK), wrapped by `src/payment/stripe.service.ts`. **SetupIntent + saved-card management only — there is no charge/checkout flow anywhere in this codebase.**
- Push delivery: Expo push service (`expo-server-sdk`), wrapped by `src/notifications/*` behind a `PushProviderClient` interface (DI token `PUSH_PROVIDER_CLIENT`) — not FCM/APNs directly.
- Auth: custom JWT (`@nestjs/jwt` + `passport-jwt`), **not Firebase Auth**. Google Sign-In is verified server-side against Google's own token endpoint via `google-auth-library`'s `OAuth2Client.verifyIdToken` — this was a deliberate divergence from an earlier plan that assumed Firebase; there is no `GoogleService-Info.plist`/Firebase project on the backend (the mobile app does now have Firebase, added 2026-07-16, for Analytics/Crashlytics/push token acquisition only — see `mobileApp/CLAUDE.md`).
- API docs: `@nestjs/swagger`, mounted at `/docs`, only when `NODE_ENV` is `development` or `test` (disabled in production — DTOs shouldn't be enumerable unauthenticated).

## Architecture

### Auth model — guest-first, not "no guest mode"

Every `User` row can be a guest or a full account — there is no separate guest table. A fresh mobile install auto-bootstraps an anonymous guest session (`POST /auth/guest`) with no email or password. Signing up or signing in with Google **upgrades that same row in place** (`isGuest: true → false`, guest's mission/XP history carries over) rather than creating a second account. This upgrade-in-place path is reused by both `signup` and `google` in `auth.service.ts` and is a load-bearing part of the onboarding flow, not an incidental detail. Both `signup` and `google` also accept an optional `referralCode` that attributes a `Referral` row when valid and non-self.

### JWT strategy

- Access + refresh token pair, `type` claim (`access`/`refresh`) checked on every validation so a refresh token can never be used where an access token is expected (`src/auth/strategies/jwt.strategy.ts`).
- Refresh tokens are rotated server-side: the current refresh token's hash (bcrypt over a SHA-256 digest, never the raw token) is stored on `User.refreshTokenHash`. `POST /auth/logout` clears it, invalidating all outstanding refresh tokens for that user immediately — not just locally on the calling device.
- `JwtStrategy.validate()` rejects tokens for users that no longer exist or are soft-deleted (`deletedAt` set) — this is also how a `DELETE /auth/me` deletion immediately invalidates that user's outstanding access tokens, with zero extra revocation bookkeeping.
- Timing-safe login: `AuthService.login` compares against a dummy bcrypt hash when the account/email doesn't exist, so response time doesn't leak account existence.

### Idempotency (`src/idempotency`)

Cross-cutting **reserve-then-execute** pattern, not the more common execute-then-record: `IdempotencyService.run({ userId, key, endpoint, execute })` inserts a `PENDING_MARKER` row uniquely constrained on `(userId, key, endpoint)` *before* running `execute()`, so a concurrent duplicate request is blocked by the DB unique constraint before it can start — not merely deduped after both copies already ran. A failed `execute()` deletes the reservation so a legitimate retry isn't permanently stuck. Threaded through proof submission and nearly every Tasks/Referrals mutation via an `Idempotency-Key` request header (`@IdempotencyKeyHeader()` decorator). The endpoint string passed to `run()` must be specific enough to disambiguate — e.g. proof submission interpolates `missionId` into the endpoint key (`POST /missions/${missionId}/proof`) specifically so reusing one idempotency key across two different missions can't silently short-circuit the second mission's submission to the first's stored response.

### Database (`prisma/schema.prisma`)

`@@map` table-name overrides exist **only** on the four oldest models (`User`→`users`, `Mission`→`missions`, `SavedMission`→`saved_missions`, `Completion`→`completions`); every model added from the Tasks milestone onward uses Prisma's default PascalCase table name with no `@@map`. Raw SQL (`$queryRaw`/`$executeRaw`, used for row-locking — see below) has to match this per-model: lowercase for the four old tables, PascalCase (`"UserTask"`, `"Referral"`, etc.) for everything newer.

- **`User`** — unifies guests and accounts (see above). Carries `totalXp` (level derived at read time, never stored), `currentStreak`/`longestStreak` (UTC-calendar-day based, not user-local-timezone), `lastCompletionDate`, `stripeCustomerId` (nullable, unique, set on first SetupIntent), `avatarUrl` (S3 key). Soft-deletable via `deletedAt`.
- **`Mission`** / `MissionCategory` (`explore`\|`create`\|`discover`) / `MissionDifficulty` (`Easy`\|`Medium`\|`Hard`) — curated content pool for the rules-based filter generator (not an LLM, not user-authored). Matched against a request's `crew`/`time`/`setting`/`budget` via `crewTags`/`settingTags`/`estimatedMinutes`/`costTier`. New missions are added by editing `prisma/seed.ts` and re-running the seed — there is no admin UI or endpoint for authoring them.
- **`SavedMission`** — a user bookmarking a mission. No separate "Pack" entity; the home screen derives display packs by grouping a user's saved missions by shared tags at read time. Listable via `GET /missions/saved`.
- **`Completion`** / `ProofType` (`photo`\|`text`) / `VerificationStatus` (`Pending`\|`Approved`\|`Rejected`) — one row per completed mission. `proofKey`/`proofText`, `xpAwarded` (awarded immediately at submission, **optimistically**, regardless of verification status — reversed only if later Rejected), `verifiedBy` (free text `"auto"` or `"admin"`, not an FK — there is no in-app admin-user model).
- **`UserTask`** / `TaskVerificationMethod` (`NONE`\|`SELF`\|`CREATOR_APPROVAL`\|`AUTOMATIC` — `AUTOMATIC` is reserved/excluded from what a client can request) / `UserTaskStatus` (`Open`→`Invited`→`Accepted`→`Submitted`→`Approved`/`Rejected`, plus `Declined`/`Cancelled`) — the peer-to-peer "Challenges" feature (mobile calls it Challenges; the backend/schema calls it Tasks — same feature, different name per layer). `creatorId`/`assigneeId?` (null assignee = personal task), `rewardXp?` (feeds `User.totalXp` on approval), `inviteToken?` (unique, powers the `sidequest://tasks/invite/<token>` deep link).
- **`UserTaskSubmission`** / `TaskSubmissionStatus` (`Submitted`\|`Approved`\|`Rejected`) — evidence submitted against a task; `UserTaskAttachment` (S3 `objectKey`, nullable — nulled on account deletion) holds any photo attached to a submission; `UserTaskEvent` is an append-only audit trail (`created`/`invited`/`accepted`/`declined`/`submitted`/`approved`/`rejected`/`resubmitted`/`cancelled`) that also drives notification creation.
- **`IdempotencyKey`** — see "Idempotency" above. `@@unique([userId, key, endpoint])`.
- **`ReferralCode`** (one per user, lazily minted on first `GET /referrals/me`) / **`Referral`** (dual-purpose: a conversion row with `refereeId` set, or an invite-sent analytics row with `refereeId` null and `invitedVia` set) / **`ReferralReward`** (`referralId` unique — grant-at-most-once safety net) / **`ReferralRewardRule`** (`ReferralStatus`: `Pending`\|`Completed`\|`Expired`) — DB-configurable reward rules (ops-editable via Prisma Studio, no admin UI), seeded with exactly one active rule: 50 XP on the referee's first approved completion.
- **`Notification`** / `NotificationType` (`task_assigned`\|`task_accepted`\|`task_declined`\|`task_submitted`\|`task_approved`\|`task_rejected`\|`referral_registered`\|`referral_reward_earned`\|`account_event`) — one row per recipient per event, written synchronously; push delivery is a best-effort side effect enqueued separately (see "Background jobs").
- **`PushToken`** — one row per device per user (`@@unique([userId, token])`), `platform` (`ios`\|`android`), `disabledAt` set when the push provider reports the token invalid (`DeviceNotRegistered`) rather than deleting the row (keeps audit history).
- **`NotificationPreference`** — one row per user; **absence of a row means all-enabled**, not all-disabled — don't invert this default when reading it.

### Endpoints (actual, as of this file's writing — full request/response detail lives in `.claude/contracts/api-contract.md`)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | none | liveness |
| POST | `/auth/guest` | none | bootstraps anonymous session |
| POST | `/auth/signup` | optional (guest bearer upgrades in place) | accepts optional `referralCode` |
| POST | `/auth/login` | none | |
| POST | `/auth/google` | optional (guest bearer upgrades in place) | verifies Google ID token server-side; accepts optional `referralCode` |
| POST | `/auth/refresh` | refresh token in body | rotates the token pair |
| POST | `/auth/logout` | JWT | revokes server-side refresh token; best-effort deregisters the caller's push token |
| GET | `/auth/me` | JWT | |
| PATCH | `/auth/me` | JWT | update `displayName` |
| PATCH | `/auth/password` | JWT | change password; revokes refresh token on success |
| DELETE | `/auth/me` | JWT | soft-delete + anonymize account — see "Account deletion" below |
| GET | `/home` | JWT | level/streak/daily mission/saved packs/task stats; `pendingChallenges` always `[]` (see Product-scope conflicts — a *different*, simpler concept than the Tasks module) |
| POST | `/missions/generate` | none (public, pre-account) | rules-filter mission generator |
| GET | `/missions/saved` | JWT | paginated list of the caller's saved missions |
| POST | `/missions/:missionId/save` | JWT | idempotent bookmark |
| DELETE | `/missions/:missionId/save` | JWT | idempotent unbookmark |
| POST | `/missions/:missionId/proof` | JWT, multipart | photo or text proof; awards XP immediately; auto-approved after `PROOF_AUTO_APPROVE_TIMEOUT_HOURS` unless an admin resolves it first |
| PATCH | `/admin/completions/:id/verification` | `x-admin-key` header | manual Approve/Reject override on a Pending completion |
| POST | `/tasks` | JWT | create a task/challenge |
| GET | `/tasks` | JWT | list, filterable by `status`/`role` |
| GET | `/tasks/summary` | JWT | dashboard counts |
| GET | `/tasks/:id` | JWT | detail + submissions |
| PATCH | `/tasks/:id` | JWT | creator-only, Open/Invited only |
| DELETE | `/tasks/:id` | JWT | cancel; creator-only, any time before Approved |
| POST | `/tasks/:id/invite` | JWT | creator-only; generates a shareable `sidequest://tasks/invite/<token>` deep link |
| POST | `/tasks/invites/:token/accept` | JWT | binds the caller as assignee |
| POST | `/tasks/invites/:token/decline` | JWT | clears the token |
| POST | `/tasks/:id/submissions` | JWT, multipart | submit evidence (photo and/or notes) |
| GET | `/tasks/:id/submissions` | JWT | participants only |
| PATCH | `/tasks/:id/submissions/:submissionId/review` | JWT | creator-only Approve/Reject; fires `task_approved`/`task_rejected` notification to the doer |
| GET | `/notifications` | JWT | paginated, newest-first |
| GET | `/notifications/unread-count` | JWT | badge count |
| GET | `/notifications/preferences` | JWT | absence of a row = all-enabled |
| PATCH | `/notifications/preferences` | JWT | partial update |
| POST | `/notifications/read-all` | JWT | |
| PATCH | `/notifications/:id/read` | JWT | own-only |
| POST | `/notifications/push-tokens` | JWT | register/upsert a device token |
| DELETE | `/notifications/push-tokens/:token` | JWT | idempotent |
| POST | `/payment/setup-intent` | JWT | provisions a Stripe customer if needed; returns a SetupIntent client secret for the mobile PaymentSheet |
| GET | `/payment/methods` | JWT | empty array if no Stripe customer yet |
| DELETE | `/payment/methods/:id` | JWT | ownership-checked (404, not 403, if not the caller's card) |
| PATCH | `/payment/methods/:id/default` | JWT | |
| POST | `/users/me/avatar` | JWT, multipart | replaces the current avatar |
| DELETE | `/users/me/avatar` | JWT | idempotent |
| GET | `/referrals/me` | JWT | lazily mints a referral code on first call |
| POST | `/referrals/invites` | JWT | records best-effort share-channel analytics |
| GET | `/referrals/history` | JWT | paginated conversion history |

### Account deletion (`DELETE /auth/me`)

Requires re-authentication (current password, or `confirm: true` for a password-less account). In one transaction: sets `deletedAt`, revokes the refresh token, scrubs `displayName` → `"Deleted User"`, nulls `avatarUrl`, and **de-references** (nulls the pointer, doesn't delete the row) every proof/evidence media key the user owns (`Completion.proofKey`, their `UserTaskAttachment.objectKey`). `email`/`googleId`/`passwordHash` are **retained**, not released for re-registration, in v1. Actual S3 object deletion and push-token deregistration happen after commit, best-effort, isolated per-key so a storage/push failure never undoes the already-committed deletion. Rewards already granted to counterparties (e.g. a referral reward the deleted user triggered for someone else) are never clawed back.

### Background jobs (BullMQ — actively used, not provisioned-but-idle)

**`verification` queue** — `VerificationQueueService.enqueueAutoApprove(completionId)` is called right after `ProofService` commits a new completion (best-effort try/catch; a queue outage never fails the already-recorded completion). Delayed job (`PROOF_AUTO_APPROVE_TIMEOUT_HOURS`, default 24h), job id `auto-approve-${completionId}`. `VerificationProcessor` re-reads the completion under `SELECT ... FOR UPDATE` and no-ops if it's gone or no longer `Pending` — this is what makes a firing auto-approve timer and a manual admin decision mutually exclusive regardless of which happens first.

**`notifications` queue** — `NotificationsQueueService` enqueues `send-push` (immediate, right after `NotificationsService.notify()` writes the in-app `Notification` row) and `check-receipts` (delayed by `PUSH_RECEIPT_CHECK_DELAY_MINUTES`, default 15min, scheduled by the processor after a successful send). `NotificationsProcessor` loads the recipient's `NotificationPreference` (absence = enabled), filters to non-disabled tokens, sends via `PushProviderClient` (Expo), and immediately disables any token the provider reports as `DeviceNotRegistered`.

Both queues share a convention worth preserving in new background work: try/catch-and-log around every enqueue call (a queue failure must never fail the primary write it's a side effect of), and dash-separated deterministic job ids — **not colons**, which `Job.validateOptions` rejects (hit as a real bug during development).

There is no `@nestjs/schedule`/cron usage anywhere — all "scheduled" behavior is a BullMQ delayed job.

### Row-locking pattern (`SELECT ... FOR UPDATE`)

Reused consistently wherever two concurrent requests could otherwise race a state transition: the guest-one-completion check and streak update in `ProofService`, the Pending→Approved/Rejected race between a firing auto-approve timer and a manual admin call (`VerificationProcessor` / `AdminService`), invite accept/decline and evidence review races in `TasksService`, the referral "first completion" grant-once check in `ReferralsService`, and first-Stripe-customer provisioning in `PaymentService`. If you're adding a new state transition that two requests could hit concurrently, this is the established pattern — not a mutex, not a unique-constraint-and-catch (though that pattern is *also* used, for referral code minting specifically).

### Security

- `helmet` (CSP deliberately disabled — this is a JSON API whose only HTML surface is dev-only Swagger, which needs inline scripts the default CSP blocks; every other helmet protection stays on).
- CORS is an allow-list from `CORS_ALLOWED_ORIGINS`; unset fails closed (no cross-origin access) in production, permissive only in dev/test. Irrelevant to native mobile clients (no `Origin` header), relevant to the Expo web target.
- Global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` — any request field outside a DTO's declared shape is a 400, not silently dropped.
- `@nestjs/throttler` with Redis-backed storage; global default from `THROTTLE_TTL`/`THROTTLE_LIMIT`, tighter per-route overrides on sensitive endpoints (e.g. 5/60s on login/signup/google/password-change, 10/60s on guest creation, 20-30/60s on other side-effecting writes).
- `AdminGuard` gates every `/admin/*` route behind a single shared `x-admin-key` header value (`ADMIN_API_KEY`) — **fail-closed**: an unset key denies every request with 403 rather than the app crashing at boot. There is no per-admin identity or RBAC in v1.
- `app.enableShutdownHooks()` is required in `main.ts` — without it, a Railway SIGTERM on redeploy cuts in-flight requests and abandons BullMQ jobs instead of draining cleanly.
- `requestLoggingMiddleware` only accepts an inbound `x-request-id` if it matches a UUID-ish shape (`/^[0-9a-f-]{1,64}$/i`); anything else (e.g. a CRLF log-injection attempt) is discarded in favor of a freshly generated id.
- Stripe errors are mapped by `StripeService.wrap()` to specific HTTP statuses (resource_missing→404, card errors→400 with Stripe's own safe message, rate-limit→503, auth/connection failures→502) so raw Stripe SDK internals never leak to the client.

### Environment variables (real names, from `.env.example` — verified no drift between code and this file)

```
NODE_ENV, PORT, CORS_ALLOWED_ORIGINS
DATABASE_URL                              # Postgres, Railway-managed
REDIS_URL                                 # Redis, Railway-managed (also backs BullMQ)
MISSION_POOL_CACHE_TTL_SECONDS            # optional, default 60
JWT_SECRET, JWT_ACCESS_TOKEN_TTL, JWT_REFRESH_TOKEN_TTL, GUEST_TOKEN_TTL
GOOGLE_OAUTH_WEB_CLIENT_ID, GOOGLE_OAUTH_IOS_CLIENT_ID   # OAuth client IDs, not secrets — verified against the ID token's `aud` claim
THROTTLE_TTL, THROTTLE_LIMIT
S3_ENDPOINT, S3_FORCE_PATH_STYLE, S3_REGION, S3_BUCKET, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY
STRIPE_SECRET_KEY                         # required (getOrThrow) — a placeholder/invalid value doesn't crash boot, but every real Stripe call 502s until it's a real key
STRIPE_WEBHOOK_SECRET                     # RESERVED — not read anywhere in code; no webhook endpoint exists yet
EXPO_ACCESS_TOKEN                         # optional — Expo push service auth
PUSH_RECEIPT_CHECK_DELAY_MINUTES          # optional, default 15
PROOF_AUTO_APPROVE_TIMEOUT_HOURS          # optional, default 24
ADMIN_API_KEY                             # shared secret for the x-admin-key header — unset = every /admin/* request 403s
```

Never paste real values for any of these into chat, including to an AI assistant — set them directly via `railway variables set` (production) or a local `.env` (gitignored). `STRIPE_SECRET_KEY` in particular: if `POST /payment/setup-intent` (or any payment endpoint) returns `502 Payment provider is currently unavailable`, that's this key being unset/placeholder in the target environment, not a code bug — check Railway before debugging the payment module's code. The publishable-key counterpart (`EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY`) lives on the mobile side and is *not* secret (see `mobileApp/CLAUDE.md`).

## Product-scope conflicts (flagged, not silently resolved)

An earlier planning document (not present in this repository — described secondhand) stated a set of Phase 1 rules. Checked against the actual code as of 2026-07-16 — most have since been resolved by real feature work; what's below is what's genuinely still true:

1. **"No guest mode"** — directly contradicted, still. Guest-first with upgrade-in-place is the foundational auth architecture, not an add-on.
2. **"Three modes only: Friends Night, Couple Mode, Solo Adventure"** — still partially contradicted. The mobile Explore screen's mode tiles map onto the backend's generic `crew`/`time`/`setting`/`budget` filter primitives, not three distinct backend-modeled modes named as above.
3. **"One-to-one challenges"** — **resolved differently than planned, not simply absent.** `HomeResponse.pendingChallenges` is still hardcoded to `[]` (that specific, simpler "challenge" concept was never built), but a fuller peer-to-peer feature *was* built under a different name: the Tasks module (`src/tasks`, mobile UI calls it "Challenges") — creation, invite-by-link, accept/decline, evidence submission, creator-approval review, all live. Don't assume the old planning doc's "challenges" and the current Tasks module are the same thing when reconciling scope — they overlap in spirit but the Tasks module is invite-token-based, not identity-targeted the way the original plan implied.
4. **"One paid pack" + server-verified receipt validation gating unlock** — still not implemented. No pack/purchase/receipt model exists anywhere in the schema. The Stripe work that *was* built (`src/payment`) is payment-methods-on-file only (SetupIntent + save/list/remove/set-default a card) — there is no charge, checkout, or receipt-validation flow at all. Don't assume the payment module satisfies this rule.
5. **"Account deletion anonymizes proof media / other participants see a placeholder"** — **resolved.** `DELETE /auth/me` exists and does anonymize + de-reference media as described (see "Account deletion" above). The "other participants see a placeholder" half isn't separately implemented, since a deleted user's `displayName` is overwritten to `"Deleted User"` in place — any UI reading that field already shows something reasonable without special-casing.
6. **"Single report hides for reporter only; global hide needs admin or a second report"** — still not implemented. No `Report`/moderation model, endpoint, hide, or block mechanism exists anywhere (verified by search, not assumption).
7. **"No blind push notification to an unresolved-identity challenge recipient"** — still moot, but for a different reason than before: push notifications now exist, but the Tasks invite flow is token-based (a deep link the creator shares), never identity-targeted, so there's no "unresolved identity" case to guard against in the current design.

Additional gaps found directly in code, not from the old planning doc:
- `TaskVerificationMethod.AUTOMATIC` exists in the Prisma enum but is explicitly excluded from what a client can request when creating a task (`CREATABLE_VERIFICATION_METHODS`) — reserved, not implemented.
- Admin actions have no per-admin identity — a single shared API key, not RBAC, not an admin user model.
- A referral reward granted at proof-submission time (optimistic, mirroring XP) is **not** reversed if that completion is later rejected — flagged in the code itself as `KNOWN GAP (backend-eval WARN-4, 2026-07-14)`, deliberately left unresolved pending a product decision. The equivalent Tasks-module hook only fires on actual approval, so this asymmetry is isolated to the Missions/Completion path.

Do not build any of the above as if it already exists. If asked to build one, treat it as new work against the real schema, not a fix to something broken.

## Testing Requirements

- Runner: Jest (`jest.config` embedded in `package.json`), `ts-jest`, `testEnvironment: node`.
- Coverage threshold enforced globally: 80% branches/functions/lines/statements. A change that drops any dimension below 80% should not be considered done.
- `npm test` (unit, co-located `*.spec.ts` next to source), `npm run test:cov` (with coverage), `npm run test:e2e` (separate Jest config under `test/`, real HTTP + Prisma against a local dev database via docker-compose — not a dedicated throwaway test DB yet; e2e specs seed and clean up their own fixtures by a per-run timestamp suffix).
- Every new endpoint needs: DTO with `class-validator` decorators, an auth guard if it isn't intentionally public, a unit test for the service method, and — for anything touching a new flow — an e2e test.
- If a route can be hit concurrently in a way that matters (a state transition, a limited resource), follow the `SELECT ... FOR UPDATE` row-locking pattern already established elsewhere rather than inventing a new concurrency-safety mechanism.

## Common Commands

```bash
npm run start:dev        # NestJS with watch mode
npm run build             # nest build (requires tsconfig.build.json's include — see below)
npm run start:prod        # node dist/main — only works after a correct build
npm run lint               # eslint --fix
npm run lint:check         # eslint, zero warnings allowed (CI mode)
npm test                   # unit tests
npm run test:cov           # unit tests + coverage report
npm run test:e2e           # e2e tests (needs the local dev database up — see docker-compose)
npm run prisma:generate    # regenerate Prisma client after a schema change
npm run prisma:migrate     # create + apply a dev migration
npm run prisma:seed        # (re)run prisma/seed.ts — the only way new curated missions/referral reward rules get added
npm run prisma:studio      # Prisma's DB browser GUI
```

`tsconfig.build.json` must keep an explicit `"include": ["src/**/*.ts"]` — without it, `prisma/seed.ts` gets swept into the build output and `dist/main.js` ends up nested one level deeper than expected (`dist/src/main.js`), silently breaking `npm run start:prod`. This was a real, previously-unnoticed bug in this project's history — do not remove that `include`.

## Deployment

Railway (Dockerized). Postgres and Redis are Railway-managed add-ons, not external SaaS. GitHub push triggers an auto-deploy. See `docs/backend/Deployment.md` and `docs/deployment/Infrastructure.md` for the full setup — those docs are kept in sync with the real deployment, unlike the planning-stage stack assumptions this file corrects above.

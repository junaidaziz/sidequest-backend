# Coding Standards

These are the rules `backend-implementer` writes to and `backend-eval` reviews against (see `../agents/`). They're binding for human contributors too — the eval agent doesn't apply a different bar than code review should.

## Architecture

- **Thin controllers.** A controller validates (via DTO), calls exactly one service method, and shapes the HTTP response. No Prisma calls, no business logic, no branching on domain state in a controller.
- **Business logic lives in services.** Constructor-injected dependencies (Nest DI), never manually instantiated.
- **No `any`**, ever, even temporarily. If a type is genuinely unknown at a boundary (e.g. a third-party webhook payload), model it as `unknown` and narrow it.
- **Small, focused files.** A service file that's grown past a few hundred lines covering multiple unrelated concerns should be split along the same seams the module boundaries already use.

## API conventions

- Every DTO field has a `class-validator` decorator — no unvalidated field reaches a service method. `whitelist: true` + `forbidNonWhitelisted: true` is the global default; don't add a controller-level override that weakens it.
- Full Swagger decoration (`@ApiProperty`, `@ApiOperation`, `@ApiResponse`) on every new endpoint — `/docs` is the dev-mode contract other agents and developers read.
- REST verbs/status codes match the codebase's existing conventions (idempotent DELETE/save-toggle endpoints return 200 with a boolean state, not 204; creates return 201; see `../references/api-contract.md` for the established pattern per resource).
- Never let an internal-only field (password hash, refresh token hash, raw Stripe customer object) leak into a response DTO. If a DTO is hand-shaped instead of using `class-transformer`'s `@Exclude`, double-check every field explicitly.

## Security

- Auth guards are mandatory on every non-guest-accessible route. Admin routes use `AdminJwtAuthGuard` + `@RequirePermissions()` — **never** reuse the consumer `JwtAuthGuard` for an admin route, and never do an inline `if (user.role === 'admin')` check instead of the RBAC guard/permission system.
- Ownership checks return 404, not 403, when the resource exists but belongs to someone else — this codebase's established convention for not confirming resource-id existence to a non-owner (see payment methods, media assets).
- Rate-limit sensitive/side-effecting endpoints explicitly (tighter than the global default) — auth endpoints, anything that sends a notification/email, anything that mutates money-adjacent state.
- Never log secrets, tokens, or PII. Never accept an inbound header value (e.g. `x-request-id`) without validating its shape first — see the CRLF-injection guard in `requestLoggingMiddleware` as the established pattern.
- New concurrent-mutation risk (a state transition, a limited resource) uses `SELECT ... FOR UPDATE` row-locking, matching every existing instance of this pattern (see `../../CLAUDE.md`'s "Row-locking pattern" section) — don't invent a new concurrency mechanism (an in-process mutex, an optimistic-lock retry loop) for a problem this codebase already has one answer to.

## Data & persistence

- New models: UUID primary key, audit fields (`createdAt`/`updatedAt` at minimum), soft-delete (`deletedAt`) if the entity can meaningfully be "removed" without losing history.
- No N+1 queries — use Prisma's `include`/`select` to fetch related data in one round trip, not a loop of individual queries.
- Multi-step writes that must be atomic use a Prisma transaction (`$transaction`), not sequential awaited calls that could partially fail.
- Never run a schema migration automatically from generated/agent code — state the Prisma schema diff and the exact `prisma migrate` command; a human runs it.

## Testing

- Every new endpoint: DTO with validators, a guard if not intentionally public, a service-method unit test, and — for a new flow, not just a new field on an existing one — an e2e test under `test/`.
- Coverage gate is global and real: 80% branches/functions/lines/statements, enforced in CI (`npm test -- --coverage`). A PR that drops any dimension below 80% is not done, not "close enough."
- Test the thrown-exception and RBAC-denied paths explicitly, not just the happy path — these are exactly what `backend-eval`'s coverage check looks for first.

## Formatting

- ESLint (`npm run lint:check` is the CI-mode, zero-warnings check) + Prettier (`.prettierrc`). Run `npm run lint` (auto-fix) before considering a change ready.
- TypeScript strict mode is on — don't add `// @ts-ignore` or a permissive `tsconfig` override to route around a real type error.

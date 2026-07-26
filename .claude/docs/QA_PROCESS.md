# QA Process

## The gate

A backend change is done only when all of the following hold — this is the same bar for a human PR and for `backend-implementer`/`backend-eval` output:

1. **Type check passes** — `npx tsc --noEmit`.
2. **Lint passes** — `npm run lint:check` (zero warnings, CI mode).
3. **Unit tests pass with coverage ≥80%** on branches/functions/lines/statements — `npm test -- --coverage`.
4. **e2e tests pass** — `npm run test:e2e`, against the docker-compose services (Postgres, Redis, LocalStack).
5. **Production dependency audit passes** — `npm run audit:prod`.
6. **Independent review passes** — for agent-generated code, `backend-eval`'s four-layer report has no unresolved FAIL. For human PRs, standard code review covering the same four layers (see `docs/CODING_STANDARDS.md`).
7. **Docs updated** if the change touches anything documented in `../../CLAUDE.md`, `../references/api-contract.md`, or this `.claude/docs/` set — a change that makes a doc wrong and doesn't fix it isn't done.

This mirrors exactly what CI (`.github/workflows/ci.yml`) checks on every push/PR to `main` — if it fails locally, it will fail in CI.

## The four-layer review (Swiss Cheese model)

Applied by `backend-eval`, and the same structure human reviewers should use:

- **A · Architecture** — thin controllers, business logic in services, constructor DI, no `any`.
- **B · API conventions** — `class-validator` on every DTO field, full Swagger decoration, correct REST verbs/status codes, no leaked internal fields.
- **C · Security** — correct guard on every route (consumer vs. admin — see `docs/ARCHITECTURE.md`), `@Roles()`/`RolesGuard`/`@RequirePermissions()` never replaced by an inline role check, rate limiting where it matters, no secrets/PII in logs, no IDOR, hashed credentials.
- **D · Data & persistence** — UUID PK + audit fields on new models, no N+1 queries, transactions for multi-step writes, no migration command executed by the reviewer/generator itself.

Each layer independently catches what the others might miss — a FAIL in any layer blocks a PASS verdict overall. Don't soften a FAIL to a WARN to unblock a merge.

## Concurrency-sensitive changes

If the change touches a state transition or a limited resource that two requests could race (approve/reject, invite accept/decline, first-of-something checks), it needs the `SELECT ... FOR UPDATE` row-locking pattern already established throughout the codebase (`../../CLAUDE.md`'s "Row-locking pattern" section) — verify this explicitly in review; it's easy for a fast implementation to miss.

## What "known gap, not a regression" looks like

Some incompleteness is intentional and already flagged in the code/docs (e.g. the referral-reward-not-reversed-on-rejection gap noted in `../../CLAUDE.md`'s "Product-scope conflicts" section, marked `KNOWN GAP` with a date). Don't treat every flagged gap as something to silently fix in an unrelated change — if you think it should be fixed, raise it explicitly rather than bundling a scope-expanding fix into an unrelated PR.

## Security review

Every feature gets a security pass before merge — Layer C above, plus a specific check for whether the change affects `/admin/*` (RBAC correctness matters more there — a mistake grants an admin capability, not just a data leak) or handles payment/PII data.

## Milestone reporting

After a completed feature, report: summary, files changed, APIs added/changed (cross-reference `../references/api-contract.md` and update it), database changes (Prisma migration files), QA results (coverage numbers, e2e pass/fail), security findings, remaining work, and next milestone — matching the reporting shape in the platform-wide engineering standards this repo follows.

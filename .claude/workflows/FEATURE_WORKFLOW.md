# Feature Workflow

The standard path for a new backend feature, from brief to merge. Same shape as `mobileApp` and `web`'s feature workflow, adapted for a module with no UI layer.

## 1. Spec

Confirm the feature brief covers: the endpoint(s) and their auth surface (consumer `JwtAuthGuard` vs. admin `AdminJwtAuthGuard` + permission — see `../docs/ARCHITECTURE.md`), request/response shape, and any new Prisma model/field. If auth/roles are ambiguous, default to the most restrictive option and flag the assumption — don't silently guess permissive.

If this feature has a mobile or web-facing counterpart, check `mobileApp/CLAUDE.md`'s "Type contract with backend" section or `web`'s equivalent for what the client already assumes about the response shape before finalizing it here — backend is the source of truth going forward, but an existing client expectation is real context, not something to break silently.

## 2. Implement

Use the `backend-implementer` agent (`.claude/agents/backend-implementer.md`) for net-new module/endpoint work, or implement directly following `../docs/CODING_STANDARDS.md` for a smaller change. Either way: thin controller, logic in service, DTOs with full validation, co-located unit tests, e2e test for a new flow.

State the Prisma schema diff and migration command before running it — a human runs `prisma migrate dev`, not the agent.

## 3. QA

Full gate in `../docs/QA_PROCESS.md`: type check, lint, unit tests ≥80% coverage (all four dimensions), e2e tests, production dependency audit.

## 4. Independent review

`backend-eval` (`.claude/agents/backend-eval.md`) reviews agent-generated code across the four Swiss Cheese layers (Architecture, API conventions, Security, Data & persistence). `backend-implementer` cannot review its own output — this step is mandatory, not optional, and a FAIL routes back to step 2, not around it.

## 5. Security review

Explicit pass on Layer C (auth guards, RBAC correctness, rate limiting, no secret/PII leakage) — weighted higher for anything touching `/admin/*` or payment/PII data.

## 6. Documentation

Update whichever of these the change actually touches — don't update all of them reflexively:
- `../references/api-contract.md` — any endpoint added/changed/removed
- `../../CLAUDE.md` — any architectural decision, new env var, new background job, new product-scope divergence
- `../docs/ARCHITECTURE.md` / `CODING_STANDARDS.md` — only if the change introduces a new pattern worth generalizing

## 7. Merge

Definition of done: requirements implemented, QA gate passed, `backend-eval` PASS with no unresolved FAIL, security review passed, docs updated, no critical issues remaining.

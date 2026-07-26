# Onboarding

For a new developer or a fresh Claude Code session picking up this repo for the first time.

## Read in this order

1. **This file** — orientation.
2. **`../../CLAUDE.md`** — the deep reference. Long, dense, and written from the actual code, not planning docs. Skim it once fully before writing anything; you'll come back to specific sections constantly.
3. **`docs/ARCHITECTURE.md`** — where things live and why.
4. **`../references/api-contract.md`** — the full route inventory (consumer + admin).
5. **`docs/CODING_STANDARDS.md`** — the rules your code will be reviewed against.

Then set up locally per `docs/DEVELOPMENT_GUIDE.md`.

## What this service is

NestJS/Prisma backend for SideQuest — a real-world mission generator mobile app, plus the RBAC-gated admin platform behind `web`'s admin portal. Two consumers (`mobileApp`, `web`), one backend, backend is the source of truth for data shape (see `../references/PRODUCT_CONTEXT.md`).

## Things that will surprise you if you don't read them first

- **Guest-first auth.** There's no separate "guest" table — every `User` row can be a guest, and signup/Google-signin upgrade that same row in place. See `../../CLAUDE.md`'s "Auth model" section before touching anything in `src/auth`.
- **Two completely separate auth systems.** Consumer JWT (`JwtAuthGuard`) and admin JWT (`AdminJwtAuthGuard` + RBAC) do not share tokens or guards. See `docs/ARCHITECTURE.md`.
- **XP is awarded optimistically**, before verification completes, and reversed only on a later rejection. This is deliberate, not a bug to "fix" toward a stricter model without a product conversation first.
- **The Tasks module is what the mobile UI calls "Challenges."** Same feature, different name at different layers — don't assume they're separate.
- **Some product-plan claims are stale.** `../../CLAUDE.md`'s "Product-scope conflicts" section is the maintained list of where an early planning document and the real code disagree. Check it before assuming a feature doesn't exist.
- **The admin platform is bigger than the consumer-facing endpoint table in `../../CLAUDE.md` shows.** RBAC, CMS, moderation, analytics, notification campaigns, audit log, app config all exist under `/admin/*` — see `../references/api-contract.md`'s "Admin Platform API" section for the full inventory.

## Agents available in this repo

- **`backend-implementer`** (`.claude/agents/backend-implementer.md`) — turns a feature brief into production NestJS/Prisma modules + tests. Never self-reviews.
- **`backend-eval`** (`.claude/agents/backend-eval.md`) — independent QA reviewer, four-layer (Swiss Cheese) review. Always invoked after `backend-implementer`, never in place of it.

Both agents call skills under `~/.claude/skills/` (`analyze-api-spec`, `inspect-backend-stack`, `generate-nest-module`, `write-backend-tests`, `backend-code-eval`) — these are user-level, not committed to this repo. If you're setting up this repo fresh on a machine that doesn't have them, ask the environment owner for the skill files before relying on these agents; the agent definitions themselves are self-contained without the skills, but their referenced workflow steps assume the skills exist.

## Definition of done

See `docs/QA_PROCESS.md`. Short version: requirements implemented, tests pass at ≥80% coverage on all four dimensions, lint/type-check clean, `backend-eval` PASS (no unresolved FAIL items), docs updated if the change touches something documented here.

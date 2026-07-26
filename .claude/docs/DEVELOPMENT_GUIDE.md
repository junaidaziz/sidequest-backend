# Development Guide

## Local setup

```bash
npm install
cp .env.example .env        # fill in real values — never commit .env
docker-compose up -d        # Postgres (5432), Redis (6379), LocalStack S3 (4566)
npx prisma migrate deploy   # apply migrations against the local DB
npm run prisma:seed         # curated missions + referral reward rules — the only way this content gets added
npm run start:dev           # NestJS with watch mode
```

`GET http://localhost:<PORT>/docs` gives you live Swagger — only mounted when `NODE_ENV` is `development` or `test`.

Required env vars are listed (with meaning) in `../../CLAUDE.md`'s "Environment variables" section — that list is kept in sync with `.env.example` and is the canonical reference; don't hand-maintain a second copy here.

## Common commands

```bash
npm run start:dev        # watch mode
npm run build             # nest build — keep tsconfig.build.json's explicit "include": ["src/**/*.ts"], see below
npm run start:prod        # node dist/main — only after a correct build
npm run lint               # eslint --fix
npm run lint:check         # eslint, zero warnings — CI mode
npm test                   # unit tests
npm run test:cov           # unit tests + coverage report
npm run test:e2e           # e2e tests — needs docker-compose services up
npm run prisma:generate    # regenerate Prisma client after a schema change
npm run prisma:migrate     # create + apply a dev migration
npm run prisma:seed        # (re)run prisma/seed.ts
npm run prisma:studio      # Prisma's DB browser GUI
npm run audit:prod         # production dependency audit — also runs in CI
```

**Don't touch `tsconfig.build.json`'s `"include": ["src/**/*.ts"]`.** Removing it was a real, previously-shipped bug: without it, `prisma/seed.ts` gets swept into the build and `dist/main.js` ends up nested one level deeper (`dist/src/main.js`), silently breaking `npm run start:prod`.

## Working against two identity systems

Before writing a new endpoint, decide which surface it belongs to:
- **Consumer** (mobile-facing): `JwtAuthGuard`, lives under a plain resource path (`/tasks`, `/missions`, ...).
- **Admin** (web-admin-facing): `AdminJwtAuthGuard` + `@RequirePermissions()`, lives under `/admin/*`.

Mixing these up is the single most common way to accidentally ship a real security hole in this codebase — see `docs/CODING_STANDARDS.md`'s Security section.

## Working with the Prisma schema

1. Edit `prisma/schema.prisma`.
2. `npm run prisma:generate` to regenerate the client (needed for TypeScript to see the new shape).
3. `npm run prisma:migrate` locally to create + apply the migration file.
4. Commit both the schema change and the generated migration under `prisma/migrations/`.
5. Never run `prisma migrate deploy`/`reset` against a shared environment from an agent session — state the command, let a human run it.

If the model needs a `@@map` table-name override: it doesn't, unless you're deliberately matching the four legacy tables (`User`, `Mission`, `SavedMission`, `Completion`) — every model since has used Prisma's default PascalCase name. Getting this wrong breaks any raw SQL (`$queryRaw`/`$executeRaw`) written against the table.

## Debugging the payment module

If any `/payment/*` call 502s with "Payment provider is currently unavailable," check that `STRIPE_SECRET_KEY` is a real key (not the placeholder) in the target environment before assuming a code bug — this is a documented, expected failure mode, not a regression to chase in the code.

## Related documents

- `docs/ARCHITECTURE.md` — system shape
- `docs/CODING_STANDARDS.md` — what gets enforced in review
- `docs/QA_PROCESS.md` — the gate before something is "done"
- `docs/RELEASE_GUIDE.md` — deploying to Railway
- `../../CLAUDE.md` — the deep reference for all of the above

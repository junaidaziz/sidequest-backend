# SideQuest — Project Reference

The product framing every backend feature should be checked against. This is the same core-loop description used in `mobileApp/.claude/references/sidequest.md` and `web/.claude/references/sidequest.md` — kept in sync across all three repos (same filename/path in each) so an agent working in any one of them shares the same mental model of what SideQuest is, and so the `backend-implementer`/`rn-implementer`/`web-implementer` agent family — which reads `.claude/references/sidequest.md` relative to whichever repo it's invoked from — finds it in the same place everywhere.

## Product

Real-world mission generator, Android-first mobile app with a companion web marketing site + admin portal. Backend is the source of truth for all of it (`../../CLAUDE.md`).

**Tagline**: "Something to actually do, right now, wherever you are."

## Core loop

User selects context (who they're with, time available, setting, budget) → app returns 2–3 completable real-world missions (`POST /missions/generate`, rules-filter, not an LLM) → user submits photo or text proof (`POST /missions/:missionId/proof`) → earns XP, streaks, can challenge friends via the Tasks module.

## v1 constraints that shape backend design

- **Guest-first, not "no guest mode."** Every `User` row can be a guest or a full account — see `../../CLAUDE.md`'s "Auth model" section. A fresh client bootstraps an anonymous session with zero friction; account gates only trigger contextually (save progress / earn XP / send a challenge), never upfront. Any new endpoint that assumes a "real" account by default is working against this model.
- **No public feed.** Every mission/response shape is designed to work for a solo user with zero friends added — there's no follow graph, no global timeline.
- **Backend is the source of truth.** `mobileApp` and `web` both consume this API; a shape change here is a breaking change for at least one client. Check `mobileApp/CLAUDE.md`'s "Type contract with backend" section and `web/CLAUDE.md`'s API-consumption notes before changing a response DTO.

## Where product-scope reality has diverged from early planning

`../../CLAUDE.md`'s "Product-scope conflicts" section is the authoritative, continuously-maintained record of where an early planning document and the actual shipped backend disagree (guest mode, challenge naming, payment scope, moderation, etc.). Read it before assuming a feature is unbuilt just because an old plan implied it would work differently — and update it, don't silently work around it, if you find a new divergence.

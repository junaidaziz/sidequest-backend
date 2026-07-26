# SideQuest API Contract

Generated from the actual backend controllers and DTOs. This is not a theoretical/planned contract — every endpoint below exists and is deployed. If the code and this file disagree, the code wins — regenerate the affected section rather than trusting it blindly.

**Consumer-facing surface** (below the divider marked "Admin Platform API") verified against `backend@2026-07-16`. **Admin platform route inventory** verified 2026-07-26 by grepping every controller's route decorators directly (`grep -rE '@(Get|Post|Patch|Put|Delete)\(' src/**/*.controller.ts`) — this is a route-existence-and-path inventory, not full request/response DTO detail. Full per-endpoint bodies/responses for the admin platform are TODO; add them incrementally as each admin area is touched, following this file's own convention of never describing an unverified shape as if it were confirmed.

Base URL: `EXPO_PUBLIC_API_BASE_URL` on the mobile client, `BACKEND_API_URL` on `web`; production is the Railway deployment (see `docs/RELEASE_GUIDE.md`).

All authenticated consumer routes take `Authorization: Bearer <accessToken>` and use the `JwtAuthGuard` (Passport `jwt` strategy) unless noted otherwise. All admin routes use a **separate** guard stack — `AdminJwtAuthGuard` + `PermissionGuard`/`@RequirePermissions()` — a distinct admin-identity/session system from the consumer JWT, not the same tokens with an elevated role. All request bodies are validated with a global `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` — unknown fields are rejected with 400, not silently dropped. Many mutating endpoints accept an optional `Idempotency-Key` header — when present, a duplicate retry with the same key against the same endpoint returns the original stored response rather than re-executing (see `../../CLAUDE.md`'s "Idempotency" section for the reserve-then-execute mechanism).

---

## Health

### `GET /health`
No auth. Liveness check.

---

## Auth (`/auth`)

### `POST /auth/guest`
No auth. Throttle: 10/60s. Bootstraps an anonymous guest session — this is the app's default first-launch flow, not an edge case.

**201** → `AuthResponse`

### `POST /auth/signup`
Optional auth (a guest bearer token upgrades that guest row in place instead of creating a new user). Throttle: 5/60s.

**Body** (`SignupDto`):
```ts
{ email: string; password: string; displayName?: string; referralCode?: string }
```
- `email`: trimmed + lowercased server-side before validation, `@IsEmail`, max 255.
- `password`: 8–72 chars, hashed with bcrypt.
- `displayName`: optional, max 50.
- `referralCode`: optional, max 32, uppercased server-side — attributes a `Referral` row if valid and not self-referral.

**201** → `AuthResponse` · **400** validation · **409** email already registered · **429** throttled

### `POST /auth/login`
No auth. Throttle: 5/60s.

**Body** (`LoginDto`): `{ email: string; password: string }` (same email normalization as signup)

**200** → `AuthResponse` · **400** validation · **401** invalid credentials (timing-safe) · **429** throttled

### `POST /auth/google`
Optional auth (guest bearer upgrades in place, same as signup). Throttle: 5/60s.

**Body** (`GoogleAuthDto`): `{ idToken: string; referralCode?: string }` — verified server-side via `google-auth-library` against `GOOGLE_OAUTH_WEB_CLIENT_ID`/`GOOGLE_OAUTH_IOS_CLIENT_ID`. Always 200, never 201.

**200** → `AuthResponse` · **400** validation · **401** Google auth failed · **429** throttled

### `POST /auth/refresh`
No auth (refresh token is the credential). Throttle: 30/60s.

**Body** (`RefreshTokenDto`): `{ refreshToken: string }`

**200** → `AuthResponse` (rotated token pair) · **400** validation · **401** invalid refresh token · **429** throttled

### `POST /auth/logout`
JWT required.

**Body**: `{ pushToken?: string }` — optional; best-effort deregisters that device's push token.

**200** → `{ success: true }` · **401** · **429**

### `GET /auth/me`
JWT required.

**200** → `UserProfile`:
```ts
{ id: string; email: string | null; displayName: string | null; isGuest: boolean; avatarUrl: string | null }
```

**401** · **429**

### `PATCH /auth/me`
JWT required. Default throttle (100/60s).

**Body**: `{ displayName: string }` — required, 1–50 chars.

**200** → `UserProfile` · **400** validation · **401**

### `PATCH /auth/password`
JWT required. Throttle: 5/60s.

**Body**: `{ currentPassword?: string; newPassword: string }` — `newPassword` 8–72 chars.

**200** → `{ success: true }` (revokes refresh token) · **400** validation/unchanged password · **401** wrong current password

### `DELETE /auth/me`
JWT required. Throttle: 5/60s.

**Body** (`DeleteAccountDto`): `{ currentPassword?: string; confirm?: true }`

See `../../CLAUDE.md`'s "Account deletion" section for the full transaction detail.

**200** → `{ success: true }` · **400** validation · **401** wrong password

### Shared auth response shape

```ts
interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: UserProfile;
}
```

---

## Home (`/home`)

### `GET /home`
JWT required. Works identically for guests and full accounts.

**200** → `HomeResponse`:
```ts
{
  level: { level: number; xpIntoLevel: number; xpToNextLevel: number; totalXp: number };
  streak: { currentStreak: number; longestStreak: number };
  dailyMission: Mission | null;
  pendingChallenges: unknown[];   // ALWAYS [] — separate, still-unbuilt concept; see Tasks module below
  savedPacks: { name: string; missionCount: number }[];
  taskStats: { total: number; approved: number; pending: number; rejected: number; completionRate: number };
}
```

**401**

---

## Missions (`/missions`)

### `POST /missions/generate`
No auth. Throttle: 30/60s.

**Body** (`GenerateMissionsDto`) — every field a closed literal set:
```ts
{
  crew: 'Solo' | 'Partner' | 'Friends' | 'Family' | 'Kids Mode';
  time: '15 min' | '30 min' | '1 hour' | '2+ hours';
  setting: 'Indoors' | 'Outdoors' | 'City' | 'Nature' | 'Anywhere';
  budget: 'Free' | 'Under $10' | 'Under $30' | 'No limit';
}
```

**200** → `{ missions: Mission[] }`, up to 3, rules-based (not LLM-generated):
```ts
interface Mission {
  id: string;
  category: 'explore' | 'create' | 'discover';
  title: string; desc: string; full: string; proof: string;
  time: string; xp: string; diff: 'Easy' | 'Medium' | 'Hard'; dots: number;
}
```

**400** validation · **429** throttled

### `GET /missions/saved`
JWT required. **Query**: `limit?` (1–100, default 20), `offset?` (≥0, default 0).

**200** → `{ items: SavedMission[]; total: number; limit: number; offset: number }` (`SavedMission` = `Mission` + `savedAt`). **401**

### `POST /missions/:missionId/save`
JWT required. Idempotent. **200** → `{ saved: boolean }` · **400** invalid UUID · **401** · **404** · **429**

### `DELETE /missions/:missionId/save`
JWT required. Idempotent. **200** → `{ saved: boolean }` · **400** · **401** · **429**

---

## Proof (`/missions/:missionId/proof`)

### `POST /missions/:missionId/proof`
JWT required. `multipart/form-data`. Throttle: 20/60s. Accepts `Idempotency-Key`.

Exactly one of `photo` (file, `image/jpeg`\|`image/png`\|`image/webp`, max 10MB) or `caption` (1–500 chars) required — both or neither is 400.

XP awarded immediately, optimistically; auto-approved after `PROOF_AUTO_APPROVE_TIMEOUT_HOURS` unless resolved first via `PATCH /admin/proofs/:id/verification`.

**201** → `ProofResponse`:
```ts
{ completionId: string; missionTitle: string; xpAwarded: number; totalXp: number; currentStreak: number; longestStreak: number; proofUrl: string | null }
```

**400** · **401** · **403** `GUEST_COMPLETION_LIMIT_REACHED` · **404** · **409** duplicate idempotency key in flight · **413** photo too large

---

## Tasks / Challenges (`/tasks`)

JWT required on every route (mobile UI calls this "Challenges"; backend module/schema call it "Tasks" — same feature).

| Method | Path | Notes |
|---|---|---|
| POST | `/tasks` | create; `CreateTaskDto` — `title`, `description?`, `verificationMethod?` (`NONE`\|`SELF`\|`CREATOR_APPROVAL`, `AUTOMATIC` reserved/rejected), `evidenceRequired?`, `rewardXp?` (0–100000), `dueAt?` |
| GET | `/tasks` | list; `status?`, `role?` (`creator`\|`assignee`\|`all`) |
| GET | `/tasks/summary` | dashboard counts (declared before `:id` so it isn't shadowed) |
| GET | `/tasks/:id` | detail + submissions; 403 if not a participant |
| PATCH | `/tasks/:id` | creator-only, `Open`/`Invited` only |
| DELETE | `/tasks/:id` | creator-only, any time before `Approved` |
| POST | `/tasks/:id/invite` | creator-only, no active assignee → returns `{ inviteToken, inviteUrl }` (`sidequest://tasks/invite/<token>`) |
| POST | `/tasks/invites/:token/accept` | binds caller as assignee; 400 if caller is the creator |
| POST | `/tasks/invites/:token/decline` | clears the token |
| POST | `/tasks/:id/submissions` | multipart; `notes?` (≤2000) + optional `photo`; auto-resolves for `NONE`/`SELF`, else `Submitted` |
| GET | `/tasks/:id/submissions` | participants only |
| PATCH | `/tasks/:id/submissions/:submissionId/review` | creator-only; `{ decision: 'Approve'|'Reject', rejectionReason? }`; Approve fires XP + `task_approved`, may trigger referral reward |

---

## Notifications (`/notifications`)

JWT required on every route.

| Method | Path | Notes |
|---|---|---|
| GET | `/notifications` | `limit?`, `offset?`, `unreadOnly?`; newest-first |
| GET | `/notifications/unread-count` | `{ unreadCount }` |
| GET | `/notifications/preferences` | absence of a row = all-`true` |
| PATCH | `/notifications/preferences` | partial update of the 4 boolean flags |
| POST | `/notifications/read-all` | `{ updated: number }` |
| PATCH | `/notifications/:id/read` | own-only |
| POST | `/notifications/push-tokens` | throttle 30/60s; upsert on `(userId, token)` |
| DELETE | `/notifications/push-tokens/:token` | idempotent |

`NotificationType`: `task_assigned`\|`task_accepted`\|`task_declined`\|`task_submitted`\|`task_approved`\|`task_rejected`\|`referral_registered`\|`referral_reward_earned`\|`account_event`.

---

## Payment (`/payment`)

JWT required. **Cards-on-file only — no charge/checkout/billing endpoint anywhere.**

| Method | Path | Notes |
|---|---|---|
| POST | `/payment/setup-intent` | provisions Stripe customer if needed; `{ clientSecret }` for mobile PaymentSheet; 502 if `STRIPE_SECRET_KEY` isn't real |
| GET | `/payment/methods` | `PaymentMethod[]`, empty if no Stripe customer yet |
| DELETE | `/payment/methods/:id` | ownership-checked, 404 (not 403) if not caller's card |
| PATCH | `/payment/methods/:id/default` | same ownership check |

---

## Users (`/users/me/avatar`) and Media (`/media`)

JWT required.

| Method | Path | Notes |
|---|---|---|
| POST | `/users/me/avatar` | legacy multipart path, 5MB cap, always clears `avatarMediaId` |
| POST | `/users/me/avatar/media` | current path — points avatar at an already-`READY` `AVATAR` media asset |
| DELETE | `/users/me/avatar` | idempotent |
| POST | `/media/uploads` | authorize a direct-to-S3 upload → presigned PUT URL |
| POST | `/media/uploads/:uploadId/complete` | confirm upload landed (real `HeadObject` re-verification); queues variant generation |
| GET | `/media/:mediaId` | owner-scoped |
| DELETE | `/media/:mediaId` | owner-scoped |

---

## Referrals (`/referrals`)

JWT required.

| Method | Path | Notes |
|---|---|---|
| GET | `/referrals/me` | lazily mints a referral code on first call |
| POST | `/referrals/invites` | `{ channel }`; best-effort analytics only |
| GET | `/referrals/history` | paginated conversion history |

---

## Not yet implemented (do not assume these exist)

- **Content moderation for end-user-visible reports outside the admin queue**: the consumer app has no report/hide/block endpoint — moderation is entirely admin-side (see below).
- **Stripe charge/checkout/billing**: no `charges`/`paymentIntents` usage; `STRIPE_WEBHOOK_SECRET` is reserved in `.env.example` but read nowhere in code.
- **Pack purchase / receipt validation / unlock gating**: no `Pack`/`Purchase`/`Receipt` model.
- **`TaskVerificationMethod.AUTOMATIC`**: present in the Prisma enum, explicitly excluded from what `POST /tasks` will accept.
- **A single-verification `GET`** (e.g. `GET /verification/:completionId`): does not exist.
- **`HomeResponse.pendingChallenges`**: always `[]`.

---
---

# Admin Platform API (RBAC-gated)

All routes below require `AdminJwtAuthGuard` — a separate admin-identity/session system from the consumer JWT above, built for the `web` admin portal (`web/src/app/(admin)/admin`). Most routes are additionally gated by `@RequirePermissions()` (a specific permission key from `GET /admin/permissions`), not just "is an admin." This section is a **route inventory** — path + method, verified directly against each controller's decorators — not full request/response schemas. Treat any body/response shape not shown here as unverified; read the controller + its DTOs before building against it.

## Admin auth (`/admin/auth`) — `admin-auth.controller.ts`

| Method | Path |
|---|---|
| POST | `/admin/auth/login` |
| POST | `/admin/auth/mfa/challenge` |
| POST | `/admin/auth/mfa/setup` |
| POST | `/admin/auth/mfa/verify` |
| POST | `/admin/auth/refresh` |
| POST | `/admin/auth/logout` |
| POST | `/admin/auth/logout-all` |
| GET | `/admin/auth/sessions` |
| POST | `/admin/auth/password/forgot` |
| POST | `/admin/auth/password/reset` |
| POST | `/admin/auth/invitations/accept` |

MFA is part of the login flow, not optional per-admin — see `role.controller.ts`/`admin-management.controller.ts` for how an admin's MFA gets reset by another admin.

## Admin identity & RBAC (`/admin/admins`, `/admin`) — `rbac/admin-management.controller.ts`, `rbac/role.controller.ts`

| Method | Path |
|---|---|
| GET | `/admin/admins` |
| POST | `/admin/admins` |
| GET | `/admin/admins/me` |
| GET | `/admin/admins/:id` |
| PATCH | `/admin/admins/:id` |
| DELETE | `/admin/admins/:id` |
| POST | `/admin/admins/:id/resend-invite` |
| GET | `/admin/admins/:id/overrides` |
| PUT | `/admin/admins/:id/overrides/:permissionKey` |
| DELETE | `/admin/admins/:id/overrides/:permissionKey` |
| POST | `/admin/admins/:id/reset-mfa` |
| POST | `/admin/admins/:id/revoke-sessions` |
| GET | `/admin/roles` |
| GET | `/admin/permissions` |
| PATCH | `/admin/roles/:id/permissions` |

Role → base permission set, plus per-admin `overrides` (grant/revoke a specific permission key beyond the role default) — this override layer is why `PermissionGuard` checks per-admin, not just per-role.

## Consumer user management (`/admin/users`) — `admin/admin-users.controller.ts`

| Method | Path |
|---|---|
| GET | `/admin/users` |
| GET | `/admin/users/:id` |
| PATCH | `/admin/users/:id/suspend` |
| PATCH | `/admin/users/:id/reactivate` |
| PATCH | `/admin/users/:id/restrict` |
| POST | `/admin/users/:id/reset-verification` |
| GET | `/admin/users/:id/export` |
| DELETE | `/admin/users/:id` |

This is admin management of end-user (`User`) accounts — distinct from `/admin/admins` above, which manages admin identities themselves.

## Mission content management (`/admin/missions`) — `admin-challenges/admin-challenges.controller.ts`

| Method | Path |
|---|---|
| GET | `/admin/missions` |
| GET | `/admin/missions/:id` |
| POST | `/admin/missions` |
| PATCH | `/admin/missions/:id` |
| POST | `/admin/missions/:id/publish` |
| POST | `/admin/missions/:id/unpublish` |
| POST | `/admin/missions/:id/archive` |
| POST | `/admin/missions/:id/feature` |
| POST | `/admin/missions/:id/unfeature` |
| POST | `/admin/missions/:id/duplicate` |
| DELETE | `/admin/missions/:id` |

Note the controller path is `admin/missions` even though the module directory is `admin-challenges` — don't assume the directory name is the route prefix.

## Moderation (`/admin/moderation/*`, `/admin/reports`, `/admin/appeals`, `/admin/proofs`) — `moderation/moderation.controller.ts`

| Method | Path |
|---|---|
| GET | `/admin/moderation/queue` |
| GET | `/admin/moderation-actions` |
| GET | `/admin/reports` |
| GET | `/admin/reports/:id` |
| PATCH | `/admin/reports/:id` |
| POST | `/admin/reports/:id/actions` |
| GET | `/admin/appeals` |
| PATCH | `/admin/appeals/:id` |
| PATCH | `/admin/proofs/:id/verification` |

`PATCH /admin/proofs/:id/verification` is the RBAC-gated successor to what an older draft of this contract called `/admin/completions/:id/verification` gated by a shared `x-admin-key` — that key-based gate has been fully replaced by the RBAC system above; do not build against `x-admin-key` for anything.

## Analytics (`/admin/analytics`) — `analytics/analytics.controller.ts`

| Method | Path |
|---|---|
| GET | `/admin/analytics/overview` |
| GET | `/admin/analytics/export` |

## Notification campaigns (`/admin/campaigns`) — `notification-campaigns/notification-campaigns.controller.ts`

| Method | Path |
|---|---|
| GET | `/admin/campaigns` |
| GET | `/admin/campaigns/:id` |
| POST | `/admin/campaigns` |
| PATCH | `/admin/campaigns/:id` |
| DELETE | `/admin/campaigns/:id` |
| POST | `/admin/campaigns/:id/preview-audience` |
| POST | `/admin/campaigns/:id/send` |
| POST | `/admin/campaigns/:id/cancel` |

Bulk-push authoring, separate from the per-user `notifications` module above — a campaign fans out to a computed audience rather than targeting one user.

## App config (`/admin/config`, public `/config/public`) — `app-config/app-config.controller.ts`, `app-config/app-config-public.controller.ts`

| Method | Path |
|---|---|
| GET | `/admin/config` |
| GET | `/admin/config/:key` |
| PUT | `/admin/config/:key` |
| DELETE | `/admin/config/:key` |
| GET | `/config/public` (no admin auth — public runtime config for clients) |

## Audit log (`/admin/audit-logs`) — `audit-log/audit-log.controller.ts`

| Method | Path |
|---|---|
| GET | `/admin/audit-logs` |

Read-only surface over an append-only audit trail — every admin-management/RBAC/moderation mutation above is expected to write here; verify against `audit-log.service.ts` before assuming full coverage.

## CMS (`/admin/cms/*` write side, `/cms/*` public read side) — `cms/controllers/*.ts`

Content types: `pages`, `sections`, `faqs`, `links`, `testimonials`, `screenshots`, `announcements`. Each admin resource under `/admin/cms/<type>` follows the same CRUD + publish/unpublish shape:

| Method | Path pattern | Notes |
|---|---|---|
| GET | `/admin/cms/<type>` | list |
| GET | `/admin/cms/<type>/:id` | detail |
| POST | `/admin/cms/<type>` | create |
| PATCH | `/admin/cms/<type>/reorder` | `sections`, `faqs`, `links`, `screenshots`, `testimonials` only — not `pages`/`announcements` |
| PATCH | `/admin/cms/<type>/:id` | update |
| DELETE | `/admin/cms/<type>/:id` | delete |
| POST | `/admin/cms/<type>/:id/publish` | |
| POST | `/admin/cms/<type>/:id/unpublish` | |
| POST | `/admin/cms/screenshots/:id/image` | screenshots only — image upload |
| POST | `/admin/cms/testimonials/:id/avatar` | testimonials only — avatar upload |

Public read side (no admin auth, consumed by `web`'s marketing site), `cms-public.controller.ts`:

| Method | Path |
|---|---|
| GET | `/cms/pages/:slug` |
| GET | `/cms/sections` |
| GET | `/cms/faqs` |
| GET | `/cms/testimonials` |
| GET | `/cms/screenshots` |
| GET | `/cms/announcements` |
| GET | `/cms/announcements/:slug` |
| GET | `/cms/links` |

Only published content is expected to be visible on this side — verify against `cms-public.controller.ts`'s query filters before assuming a draft record is ever reachable here.

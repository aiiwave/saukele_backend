# Saukele Backend — Pre-Defense Checklist

A live walkthrough script for the oral defense. Open the tabs in this order
in Postman and run them top-to-bottom.

> Base URL for all calls: `http://localhost:3000`
> All API routes are prefixed with `/v1` (webhooks and `/health` are not).

---

## 0. Pre-flight — services up

| Check | Command | Expected |
|---|---|---|
| Health | `GET /health` | `{ status: "ok", ... }` |
| Swagger UI | open `http://localhost:3000/docs` | renders OpenAPI |
| Postgres | `docker compose ps postgres` | `healthy` |
| Redis | `docker compose ps redis` | `healthy` |
| Worker | `docker compose logs -f worker` | "📬 Email worker started" |

---

## 1. Auth flow

Open these as Postman tabs in order. Each one feeds the next via collection variables.

| # | Tab | Method | URL | Body |
|---|---|---|---|---|
| 1 | **Register** | `POST` | `/v1/auth/register` | `{ "email": "couple@test.kz", "password": "Strong#Pass1", "role": "COUPLE" }` |
| 2 | **Verify Email** | `POST` | `/v1/auth/verify-email` | `{ "token": "<from worker logs>" }` |
| 3 | **Login** | `POST` | `/v1/auth/login` | `{ "email": "couple@test.kz", "password": "Strong#Pass1" }` |
| 4 | **Get Profile** | `GET` | `/v1/auth/me` | — (Bearer access token) |
| 5 | **Refresh Token** | `POST` | `/v1/auth/refresh` | `{ "refreshToken": "<from login>" }` |
| 6 | **Logout** | `POST` | `/v1/auth/logout` | `{ "refreshToken": "<...>" }` |
| 7 | **Forgot Password** | `POST` | `/v1/auth/forgot-password` | `{ "email": "couple@test.kz" }` |
| 8 | **Reset Password** | `POST` | `/v1/auth/reset-password` | `{ "token": "<from worker logs>", "password": "NewStrong#Pass2" }` |

Tip: in `EMAIL_DEV_MODE=true`, the verification token is printed to the email
worker's stdout. Grab it from there.

---

## 2. Business endpoints (registry + gifts + contributions)

Run these only after step 1 (the user must be **verified**).

| # | Tab | Method | URL | Body / Notes |
|---|---|---|---|---|
| 9 | **Create Registry** | `POST` | `/v1/registries` | `{ "title": "Aigerim & Daulet", "weddingDate": "2027-06-15", "venue": "Almaty" }` |
| 10 | **List My Registries** | `GET` | `/v1/registries/mine` | — |
| 11 | **List Public Registries** | `GET` | `/v1/registries?limit=10` | cursor-paginated |
| 12 | **Add Gift Item** | `POST` | `/v1/registries/{registryId}/gifts` | `{ "title": "Honeymoon fund", "priceKzt": 50000000, "isPool": true, "poolTargetKzt": 50000000 }` |
| 13 | **Update Gift Item** | `PATCH` | `/v1/registries/{registryId}/gifts/{giftId}` | `{ "title": "Honeymoon to Bali" }` |
| 14 | **Pool Contribution** | `POST` | `/v1/contributions/pool` | `{ "giftItemId": "<id>", "amountKzt": 10000000, "idempotencyKey": "demo-1" }` |
| 15 | **Pool Contribution (idempotent replay)** | `POST` | `/v1/contributions/pool` | same body — should return `alreadyExisted: true` |
| 16 | **Advance Pool** | `POST` | `/v1/contributions/pool/{giftId}/advance` | — |
| 17 | **My Contributions** | `GET` | `/v1/contributions/mine` | — |

---

## 3. Kinship (recursive CTE demo)

| # | Tab | Method | URL |
|---|---|---|---|
| 18 | **Add Family Member** | `POST` | `/v1/registries/{registryId}/kinship` |
| 19 | **Get Kinship Tree** | `GET` | `/v1/registries/{registryId}/kinship` |
| 20 | **My Kinship Tier** | `GET` | `/v1/registries/{registryId}/kinship/my-tier` |

---

## 4. Admin

Log in as a user whose role is `ADMIN` first (set the role manually via
Prisma Studio: `npm run studio`).

| # | Tab | Method | URL |
|---|---|---|---|
| 21 | **List Users** | `GET` | `/v1/admin/users` |
| 22 | **Suspend User** | `PATCH` | `/v1/admin/users/{userId}/suspend` |
| 23 | **Activate User** | `PATCH` | `/v1/admin/users/{userId}/activate` |
| 24 | **Set Exchange Rate** | `POST` | `/v1/admin/exchange-rates` |
| 25 | **Audit Log** | `GET` | `/v1/admin/audit?entityType=Registry&entityId={id}` |

---

## 5. Background jobs (worker proof)

| # | Tab | Method | URL | Notes |
|---|---|---|---|---|
| 26 | **Trigger Test Email** | `POST` | `/v1/admin/test-email` | `{ "to": "demo@test.kz" }` — watch worker stdout |
| 27 | **Worker logs** | terminal | `docker compose logs -f worker` | "Processing email job" appears |

---

## 6. Failure paths to demonstrate

These show the error envelope is consistent.

| Demo | Expected status | Expected `error.code` |
|---|---|---|
| Register weak password | 422 | `VALIDATION_ERROR` |
| Register duplicate email | 409 | `CONFLICT` |
| Login wrong password | 401 | `UNAUTHORIZED` |
| GET `/v1/auth/me` without Bearer | 401 | `UNAUTHORIZED` |
| POST `/v1/registries` as GUEST | 403 | `FORBIDDEN` |
| POST `/v1/registries` as unverified COUPLE | 403 | `FORBIDDEN` |
| GET `/v1/registries/non-existent-id` | 404 | `NOT_FOUND` |
| Pool contribution exceeding remaining target | 422 | `VALIDATION_ERROR` |
| 6th login attempt in 1 minute | 429 | `RATE_LIMIT_EXCEEDED` |

---

## 7. What to mention out loud during defense

- **Architecture**: Express + Prisma + Postgres + Redis + Bull + Nodemailer.
- **Auth**: JWT access (15m) + DB-backed refresh (7d), rotated on each refresh.
- **RBAC**: 401 vs 403 are distinct; show the GUEST→registry-create demo.
- **Email verification**: blocks business endpoints via `requireVerified`.
- **Background work**: email worker is a separate process consuming Bull jobs.
- **Pool funding**: SELECT FOR UPDATE inside a Prisma `$transaction` — show it
  in `src/services/poolService.ts` and explain why two concurrent contributions
  cannot oversell.
- **Audit log immutability**: enforced at app layer (`auditRepository` exposes
  only `create`) AND at DB layer (Postgres trigger in migration `20260410`).
- **Pagination**: cursor-based (keyset), explain why O(log n) beats OFFSET.
- **Webhooks**: HMAC verified with `crypto.timingSafeEqual` to prevent timing
  attacks; raw body retained via custom `express.raw()` middleware.
- **Email events** (≥ 3 business events as required):
  1. registration verification email
  2. password-reset email
  3. registry-created email
  4. contribution-received email
  5. payment-confirmation email

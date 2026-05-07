# Changelog

All notable deviations from the blueprint (`openapi.yaml`) are documented here.

## Sprint 2 — Pre-Defense Hardening

### Email Verification
- Added `User.isVerified` column (defaults to `false`).
- New `EmailVerificationToken` table — single-use tokens with TTL (24h).
- Endpoints: `POST /v1/auth/verify-email` (also `GET` for link clicks) and
  `POST /v1/auth/resend-verification`. Resend always returns 200 to prevent
  email enumeration.
- New `requireVerified` middleware blocks unverified users from creating
  registries or contributing.

### Password Reset
- New `PasswordResetToken` table. Tokens are SHA-256 hashed before storage —
  the raw value never touches the DB.
- Endpoints: `POST /v1/auth/forgot-password` (always 200, no enumeration) and
  `POST /v1/auth/reset-password`. Successful reset revokes ALL refresh tokens
  for the user.
- Token TTL: 30 minutes.

### Background Email Worker
- Added Bull-based `email` queue (`src/jobs/emailQueue.ts`) backed by Redis.
- New worker process at `src/jobs/emailWorker.ts`, started via `npm run worker`
  (or `npm run worker:prod`). Runs as a separate container in docker-compose.
- Email templates rendered in `src/services/emailService.ts`. `EMAIL_DEV_MODE=true`
  logs emails to stdout instead of sending — keeps local dev / defense
  zero-config.

### Business Email Events (≥ 3 as required)
1. Email verification on registration
2. Password reset
3. Registry created (notifies owner)
4. Pool contribution received (notifies registry owner)
5. Payment confirmation (after Kaspi/Stripe webhook success)

All five enqueue Bull jobs — never blocking the request/response cycle.

### Swagger / OpenAPI
- `docs/openapi.yaml` regenerated from scratch to match the actual route
  surface. Previous spec had drifted (missing `/auth/me`, `/auth/logout-all`,
  `/contributions/pool/*`, `/registries/:id/kinship/my-tier`, several admin
  routes).
- Swagger UI now mounted at `/docs`, `/api-docs`, AND `/api/docs` for
  Postman-import compatibility. Raw spec served at `/openapi.yaml`.

### Admin
- Added `POST /v1/admin/test-email` — defense demo helper that enqueues a
  test job through the worker pipeline.

### Infrastructure
- `docker-compose.yml` now boots a `worker` service alongside `api`.
- `.env.example` rewritten to match the actual env schema and to include
  `APP_BASE_URL` and `EMAIL_DEV_MODE`.
- `package.json` gained `worker`, `worker:prod`, `prisma:migrate`,
  `prisma:migrate:dev`, `prisma:generate` scripts.

### Documentation
- `README.md` rewritten with full setup, architecture overview, env-var
  matrix, Docker run instructions, and script cheat sheet.
- New `DEFENSE_CHECKLIST.md` with Postman tab order and failure-path
  matrix for the oral defense.

---

## Sprint 1 — Backend Foundation & Core Engine

### Auth Subsystem
- Implemented exactly per spec: register, login, refresh, logout, logout-all, me.
- Token rotation on refresh (old token revoked, new pair issued) — not in blueprint but is a security best practice.
- `logoutAll` endpoint added (not in blueprint) — allows revoking all sessions, useful for password change flows.

### Monetary Values
- Blueprint uses KZT as float. Implementation stores values as **tiyn (integer)** internally to avoid floating-point precision issues. API responses convert back to KZT for display. This is a documented architectural decision (see `ARCHITECTURE.md`).

### Kinship Recursive CTE
- Blueprint describes a recursive family tree query. Implementation uses `prisma.$queryRaw` — the only raw SQL in the codebase. Documented in `ARCHITECTURE.md`.

### Pool Status Machine
- Added `PoolStatus` enum (`PENDING → FUNDED → PURCHASED → DELIVERED`) on `GiftItem`. Blueprint described the escrow state machine but did not specify the enum values. Chosen values match the spec description semantically.

### Audit Log Trigger
- Added migration `20260410_add_audit_trigger` which installs PostgreSQL `BEFORE UPDATE / BEFORE DELETE` triggers on `AuditLog`. This is not in the original blueprint but provides the second layer of immutability enforcement required by the spec's append-only audit requirement.

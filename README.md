# Saukele — Wedding Registry Backend API

A production-grade backend for a Kazakh wedding gift registry platform.
Built with **Express.js + TypeScript + Prisma ORM + PostgreSQL 15 + Redis + Bull**.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Runtime | Node.js 20 |
| Language | TypeScript 5 |
| Framework | Express 4 |
| ORM | Prisma 5 |
| Database | PostgreSQL 15 |
| Cache / queue backend | Redis 7 |
| Background jobs | Bull (Redis-backed) |
| Validation | Zod |
| Auth | JWT (access + DB-backed refresh) |
| Email | Nodemailer (with dev-mode console fallback) |
| Rate limiting | rate-limiter-flexible (Redis token-bucket) |
| API docs | Swagger UI + OpenAPI 3.0 |
| Tests | Jest + Supertest |
| Container | Docker + docker-compose |

---

## Project Description

Saukele is a backend API for a wedding-gift registry platform. Couples create
registries; guests reserve solo gifts or contribute to pooled gifts (e.g. a
honeymoon fund). The backend handles authentication, RBAC, payment webhooks
(Kaspi Pay + Stripe), pool funding with race-condition protection,
multi-currency exchange rate snapshots, an immutable audit log, and async
email notifications for the major business events.

---

## Quick Start (Docker)

```bash
git clone <this-repo>
cd saukele-backend
cp .env.example .env
# Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET (≥ 32 chars each)

docker compose up --build
```

What that boots:
- `api` on `http://localhost:3000`
- `worker` (email worker, processes the `email` queue)
- `postgres` on `:5432`
- `redis` on `:6379`

Useful URLs:
- Swagger UI: `http://localhost:3000/docs` (also `/api-docs`, `/api/docs`)
- Raw OpenAPI: `http://localhost:3000/openapi.yaml`
- Health probe: `http://localhost:3000/health`

---

## Local Development Setup

### Prerequisites
- Node.js 20+
- PostgreSQL 15+
- Redis 7+

### Install & Run

```bash
npm install
cp .env.example .env
# Fill required values (see below)

# Generate Prisma client
npm run prisma:generate

# Run migrations against your local DB
npm run prisma:migrate:dev

# Two processes — run in separate terminals:
npm run dev      # API server (hot-reload)
npm run worker   # Email worker (hot-reload)
```

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `JWT_ACCESS_SECRET` | ✅ | Min 32 chars |
| `JWT_REFRESH_SECRET` | ✅ | Min 32 chars; must differ from access |
| `JWT_ACCESS_EXPIRES_IN` |  | Default `15m` |
| `JWT_REFRESH_EXPIRES_IN` |  | Default `7d` |
| `APP_BASE_URL` |  | Used inside email links (default `http://localhost:3000`) |
| `CORS_ORIGIN` |  | Comma-separated allowlist (no `*` in production) |
| `EMAIL_DEV_MODE` |  | `true` → emails go to worker stdout; `false` → real SMTP |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` |  | Required only when `EMAIL_DEV_MODE=false` |
| `KASPI_WEBHOOK_SECRET` |  | HMAC secret for Kaspi Pay webhooks |
| `STRIPE_WEBHOOK_SECRET` |  | HMAC secret for Stripe webhooks |

The app **refuses to boot** if any required variable is missing or invalid
(Zod-validated in `src/config/env.ts`).

---

## Database Setup

```bash
# Apply all migrations to dev DB
npm run prisma:migrate:dev

# Apply existing migrations to prod (no schema changes)
npm run prisma:migrate

# Regenerate the Prisma client after schema edits
npm run prisma:generate

# Inspect data interactively
npm run studio
```

All database access goes through Prisma. The only documented `$queryRaw`
exception is the recursive CTE for the kinship tree
(see `ARCHITECTURE.md`).

Migrations:
- `20260401_init` — initial schema
- `20260405_add_pool_status` — pool state machine column
- `20260410_add_audit_trigger` — Postgres trigger making `AuditLog` rows
  truly immutable at the DB layer
- `20260507_add_verification_and_reset` — `User.isVerified` + verification
  + password-reset token tables

---

## Running the Backend

```bash
# Dev (hot reload via ts-node-dev)
npm run dev

# Production
npm run build
npm start

# Email worker (separate process — required for email delivery)
npm run worker         # dev
npm run worker:prod    # prod (after build)
```

---

## Running Tests

```bash
# Unit tests only (no DB required)
npm run test:unit

# Integration tests (requires running Postgres on DATABASE_URL)
npm run test:integration

# Everything
npm test
```

The integration suite uses Supertest against the actual Express app and a
real Postgres database. CI uses `docker-compose` services.

---

## Docker Run Instructions

```bash
# Build + start API, worker, Postgres, Redis
docker compose up --build

# Background mode
docker compose up -d

# Tail worker logs (great for showing email jobs during defense)
docker compose logs -f worker

# Tear down (volumes preserved)
docker compose down

# Tear down + delete volumes (full reset)
docker compose down -v
```

The Docker entrypoint runs `prisma migrate deploy` automatically before
starting the API.

---

## API Documentation

| Surface | URL |
|---|---|
| Swagger UI (preferred) | `http://localhost:3000/docs` |
| Swagger UI (alias)     | `http://localhost:3000/api-docs` |
| Swagger UI (alias)     | `http://localhost:3000/api/docs` |
| Raw OpenAPI YAML       | `http://localhost:3000/openapi.yaml` |
| Source spec file       | `docs/openapi.yaml` |

Import the OpenAPI YAML into Postman to get every endpoint pre-loaded.

---

## Postman Defense Flow

The complete defense walk-through (with Postman tab order, sample bodies,
and the failure-path matrix) lives in **[`DEFENSE_CHECKLIST.md`](./DEFENSE_CHECKLIST.md)**.

Quick version:
1. `POST /v1/auth/register` (COUPLE, returns tokens)
2. `POST /v1/auth/verify-email` (token from worker stdout)
3. `POST /v1/auth/login` → set Bearer
4. `POST /v1/registries` → registry id
5. `POST /v1/registries/:id/gifts` (pool gift) → gift id
6. `POST /v1/contributions/pool` (with `idempotencyKey`)
7. Replay step 6 → returns `alreadyExisted: true`
8. `POST /v1/contributions/pool/:giftId/advance`
9. `POST /v1/admin/test-email` → confirm worker logs

---

## Architecture Overview

```
src/
├── config/         Prisma singleton, Redis singleton, Zod env validation
├── controllers/    HTTP layer — parse req, call service, return res
├── services/       Business logic — auth, registries, pool funding, kinship, email
├── repositories/   Prisma queries — single point of DB contact, mockable
├── middleware/     JWT auth, RBAC, requireVerified, rate limiting,
│                   error handler, webhook HMAC
├── routes/         Express Router definitions
├── jobs/           node-cron jobs (registry expiry); Bull email queue + worker
└── utils/          asyncHandler, cursor pagination, currency math, logger
prisma/             schema + SQL migrations
docs/openapi.yaml   OpenAPI 3.0 spec served by Swagger UI
tests/              Jest unit + Supertest integration tests
```

### Key Design Decisions

**Auth.** JWT access tokens (15m) + DB-backed refresh tokens (7d).
Refresh tokens are revocable and rotated on each use. Auth endpoints are
rate-limited to 5 req/min/IP via Redis.

**Email verification.** New users are created with `isVerified=false`. A
one-time token is enqueued and (in production) emailed via the worker. The
`requireVerified` middleware blocks unverified users from creating
registries or contributing.

**Password reset.** Tokens are SHA-256 hashed before storage; the raw
token only ever lives in the email link. Successful reset revokes ALL
refresh tokens for the user.

**Background jobs.** Bull (Redis-backed) handles all email delivery. The
worker is a separate process (`npm run worker`) so an email outage cannot
take the API down. In `EMAIL_DEV_MODE`, emails are logged to the worker's
stdout instead of being sent — perfect for local dev and the defense demo.

**Business email events** (≥ 3 as required):
1. Email verification on registration
2. Password reset
3. Registry created
4. Pool contribution received (notifies registry owner)
5. Payment confirmation (after Kaspi/Stripe webhook success)

**RBAC.** `GUEST` / `COUPLE` / `ADMIN` / `DELIVERY_PARTNER`. Returns **403**
(not 401) when an authenticated user lacks the required role.

**Pool funding.** `SELECT FOR UPDATE` inside a Prisma `$transaction`
prevents race conditions. Overselling is impossible at the DB level.

**Kinship tree.** Self-referential `FamilyMember` table with recursive CTE
query (Prisma `$queryRaw` — the one documented exception to the no-raw-SQL
rule).

**Exchange rates.** Immutable `ExchangeRateSnapshot` records — historical
rows are never updated. Repository exposes only `create`.

**Audit log.** Append-only at app layer (`auditRepository` exposes only
`create()`). Enforced at DB layer by Postgres trigger
(migration `20260410`).

**Pagination.** Cursor-based (keyset) on all list endpoints.
Cursor = `base64({ id, createdAt })`. O(log n) regardless of page depth.

**Error format.** Single shape across the entire API:
```json
{ "error": { "code": "ERROR_CODE", "message": "human readable", "details": {} } }
```
Status codes covered: 400, 401, 403, 404, 409, 422, 429, 500.

**Webhooks.** HMAC verified with `crypto.timingSafeEqual` to prevent timing
attacks. Stripe webhooks include a 5-minute timestamp window for replay
prevention. Raw body preserved via dedicated `express.raw()` middleware.

**CORS.** Comma-separated allowlist in production. Wildcard only in dev.

---

## NPM Scripts (cheat sheet)

| Script | Purpose |
|---|---|
| `npm run dev` | Start API with hot reload |
| `npm run worker` | Start email worker with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled API |
| `npm run worker:prod` | Run compiled email worker |
| `npm test` | Full test suite |
| `npm run test:unit` | Unit tests only |
| `npm run test:integration` | Integration tests (needs DB) |
| `npm run prisma:generate` | Regenerate Prisma client |
| `npm run prisma:migrate` | Apply migrations (prod) |
| `npm run prisma:migrate:dev` | Create + apply migrations (dev) |
| `npm run studio` | Open Prisma Studio |
| `npm run lint` | ESLint |

---

## Further Reading

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — architectural decision record
- [`CHANGELOG.md`](./CHANGELOG.md) — deviations from the original blueprint
- [`DEFENSE_CHECKLIST.md`](./DEFENSE_CHECKLIST.md) — Postman walkthrough script

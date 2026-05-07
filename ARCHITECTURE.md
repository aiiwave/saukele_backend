# Architecture Decision Record — Saukele Backend

## Framework Choice: Express.js + TypeScript
Chosen per Week 1 blueprint. TypeScript provides type safety across the Prisma-generated models, reducing runtime bugs.

## ORM: Prisma
Prisma provides a type-safe query builder with zero raw SQL (with one documented exception below). All database interaction goes through `prisma.*` calls in the `repositories/` layer.

**Documented exception to no-raw-SQL rule:**  
`src/services/kinshipService.ts` uses `prisma.$queryRaw` for two recursive CTE queries (`getTree`, `getKinshipTier`). Prisma's query builder cannot express `WITH RECURSIVE` clauses. This is the only place raw SQL appears in the codebase, and it is tagged with comments explaining the reason.

## Pool Funding: SELECT FOR UPDATE
`src/services/poolService.ts` uses `prisma.$transaction` with an explicit `SELECT … FOR UPDATE` to obtain an exclusive row-level lock on the `GiftItem` row during a contribution. This prevents race conditions where two concurrent requests could both read `poolCollectedKzt = 80,000` and both write `100,000 + 60,000 = 140,000`, exceeding the target.

Transaction timeout is set to 10 seconds to prevent indefinite lock holding.

## Exchange Rate Immutability
`ExchangeRateSnapshot` records are INSERT-only. The repository and service layers never call `update()` or `delete()` on this table. Historical exchange rates must never change — this is a financial audit requirement.

Columns map to spec:
- `rate` → `exchange_rate_at_time`
- `amountKzt` → locked KZT tiyn value
- `amountForeign` → `amount_original` in foreign currency tiyn
- `lockedAt` → `locked_at_timestamp` (DB default `now()`, never updated)

## Audit Log: Double-Layer Immutability
1. **Application layer**: `auditRepository` exposes only `create()`. No `update()`, `delete()`, or `upsert()` methods exist.
2. **Database layer**: Migration `20260410` installs PostgreSQL triggers (`BEFORE UPDATE`, `BEFORE DELETE`) that raise exceptions, preventing any tool or direct DB access from modifying audit rows.

## Price Storage: Tiyn (Integer)
All monetary values are stored as integers in tiyn (1 KZT = 100 tiyn). This avoids IEEE 754 floating-point precision errors in financial calculations. The `src/utils/currency.ts` module handles conversion and formatting.

## Cursor-Based Pagination
All list endpoints use keyset (cursor-based) pagination instead of OFFSET. Cursor = `base64(JSON.stringify({ id, createdAt }))`. This is O(log n) regardless of page depth, unlike OFFSET which degrades to O(n).

## Rate Limiting: Redis Token Bucket
`src/middleware/rateLimiter.ts` uses `rate-limiter-flexible` with Redis as the backing store. This works correctly across multiple API instances (horizontal scaling). Auth endpoints are capped at 5 requests/minute per IP as required by the spec.

## CORS: No Wildcard in Production
`src/app.ts` uses `env.CORS_ORIGIN` (comma-separated allowlist) in production and `*` only in development. This is enforced via the `NODE_ENV` check.

## Webhook Security: HMAC Timing-Safe Comparison
Webhook signature verification in `src/middleware/webhookAuth.ts` uses `crypto.timingSafeEqual()` to prevent timing-based attacks. Stripe webhooks also include replay-attack prevention (5-minute timestamp window).

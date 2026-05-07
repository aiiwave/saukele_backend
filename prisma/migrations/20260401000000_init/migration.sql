-- Migration: 20260401000000_init
-- Initial schema for Saukele Wedding Registry Platform

CREATE TYPE "Role" AS ENUM ('GUEST', 'COUPLE', 'ADMIN', 'DELIVERY_PARTNER');
CREATE TYPE "RegistryVisibility" AS ENUM ('PUBLIC', 'INVITE_ONLY', 'PRIVATE');
CREATE TYPE "GiftStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'PURCHASED', 'DELIVERED', 'SUBSTITUTED');
CREATE TYPE "ContributionType" AS ENUM ('SOLO', 'POOL');
CREATE TYPE "ContributionStatus" AS ENUM ('PENDING', 'PAID', 'REFUNDED', 'FAILED');
CREATE TYPE "PoolStatus" AS ENUM ('PENDING', 'FUNDED', 'PURCHASED', 'DELIVERED');
CREATE TYPE "KinshipTier" AS ENUM ('ATA_ANA', 'ZHIEN_ZHARAN', 'DOS', 'BASKA');
CREATE TYPE "Currency" AS ENUM ('KZT', 'EUR', 'USD');
CREATE TYPE "AuditAction" AS ENUM (
  'CONTRIBUTION_CREATED', 'PAYMENT_COMPLETED', 'REFUND_ISSUED',
  'REGISTRY_CREATED', 'REGISTRY_EXPIRED', 'ADMIN_OVERRIDE',
  'USER_SUSPENDED', 'EXCHANGE_RATE_SET'
);

-- Users
CREATE TABLE "User" (
  "id"           TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "email"        TEXT UNIQUE,
  "phone"        TEXT UNIQUE,
  "passwordHash" TEXT,
  "role"         "Role" NOT NULL DEFAULT 'GUEST',
  "isActive"     BOOLEAN NOT NULL DEFAULT true,
  "createdAt"    TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "User_email_idx" ON "User"("email");
CREATE INDEX "User_phone_idx" ON "User"("phone");
CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");

-- Refresh tokens
CREATE TABLE "RefreshToken" (
  "id"        TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "token"     TEXT NOT NULL UNIQUE,
  "userId"    TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "revoked"   BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "RefreshToken_userId_idx" ON "RefreshToken"("userId");
CREATE INDEX "RefreshToken_token_idx" ON "RefreshToken"("token");

-- Registries
CREATE TABLE "Registry" (
  "id"            TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "ownerId"       TEXT NOT NULL REFERENCES "User"("id"),
  "title"         TEXT NOT NULL,
  "weddingDate"   TIMESTAMPTZ NOT NULL,
  "venue"         TEXT,
  "coverImageUrl" TEXT,
  "visibility"    "RegistryVisibility" NOT NULL DEFAULT 'INVITE_ONLY',
  "inviteCode"    TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "isExpired"     BOOLEAN NOT NULL DEFAULT false,
  "createdAt"     TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "Registry_ownerId_idx" ON "Registry"("ownerId");
CREATE INDEX "Registry_visibility_isExpired_idx" ON "Registry"("visibility", "isExpired");
CREATE INDEX "Registry_inviteCode_idx" ON "Registry"("inviteCode");
CREATE INDEX "Registry_weddingDate_idx" ON "Registry"("weddingDate");

-- Gift Items
CREATE TABLE "GiftItem" (
  "id"               TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "registryId"       TEXT NOT NULL REFERENCES "Registry"("id"),
  "title"            TEXT NOT NULL,
  "description"      TEXT,
  "imageUrl"         TEXT,
  "priceKzt"         INTEGER NOT NULL,
  "status"           "GiftStatus" NOT NULL DEFAULT 'AVAILABLE',
  "isPool"           BOOLEAN NOT NULL DEFAULT false,
  "poolTargetKzt"    INTEGER,
  "poolCollectedKzt" INTEGER DEFAULT 0,
  "poolStatus"       "PoolStatus" NOT NULL DEFAULT 'PENDING',
  "externalUrl"      TEXT,
  "quantity"         INTEGER NOT NULL DEFAULT 1,
  "reservedBy"       TEXT,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "GiftItem_registryId_status_idx" ON "GiftItem"("registryId", "status");
CREATE INDEX "GiftItem_registryId_isPool_idx" ON "GiftItem"("registryId", "isPool");
CREATE INDEX "GiftItem_reservedBy_idx" ON "GiftItem"("reservedBy");

-- Exchange rate snapshots (immutable)
CREATE TABLE "ExchangeRateSnapshot" (
  "id"            TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "fromCurrency"  "Currency" NOT NULL,
  "toCurrency"    "Currency" NOT NULL,
  "rate"          DOUBLE PRECISION NOT NULL,
  "amountKzt"     INTEGER NOT NULL,
  "amountForeign" INTEGER NOT NULL,
  "lockedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "ExchangeRateSnapshot_from_to_locked_idx"
  ON "ExchangeRateSnapshot"("fromCurrency", "toCurrency", "lockedAt");

-- Contributions
CREATE TABLE "Contribution" (
  "id"               TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "giftItemId"       TEXT NOT NULL REFERENCES "GiftItem"("id"),
  "userId"           TEXT NOT NULL REFERENCES "User"("id"),
  "type"             "ContributionType" NOT NULL,
  "status"           "ContributionStatus" NOT NULL DEFAULT 'PENDING',
  "amountKzt"        INTEGER NOT NULL,
  "amountOriginal"   INTEGER,
  "currency"         "Currency" NOT NULL DEFAULT 'KZT',
  "exchangeRateId"   TEXT REFERENCES "ExchangeRateSnapshot"("id"),
  "idempotencyKey"   TEXT NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  "paymentSessionId" TEXT,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "Contribution_giftItemId_status_idx" ON "Contribution"("giftItemId", "status");
CREATE INDEX "Contribution_userId_createdAt_idx" ON "Contribution"("userId", "createdAt");
CREATE INDEX "Contribution_idempotencyKey_idx" ON "Contribution"("idempotencyKey");

-- Payment transactions
CREATE TABLE "PaymentTransaction" (
  "id"             TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "contributionId" TEXT NOT NULL UNIQUE REFERENCES "Contribution"("id"),
  "provider"       TEXT NOT NULL,
  "providerTxId"   TEXT NOT NULL UNIQUE,
  "amountKzt"      INTEGER NOT NULL,
  "status"         TEXT NOT NULL,
  "rawPayload"     JSONB,
  "createdAt"      TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updatedAt"      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "PaymentTransaction_providerTxId_idx" ON "PaymentTransaction"("providerTxId");
CREATE INDEX "PaymentTransaction_status_createdAt_idx" ON "PaymentTransaction"("status", "createdAt");

-- Family members (self-referential kinship tree)
CREATE TABLE "FamilyMember" (
  "id"               TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "registryId"       TEXT NOT NULL REFERENCES "Registry"("id"),
  "userId"           TEXT NOT NULL REFERENCES "User"("id"),
  "parentId"         TEXT REFERENCES "FamilyMember"("id"),
  "kinshipTier"      "KinshipTier" NOT NULL,
  "kinshipLabel"     TEXT,
  "giftTierOverride" INTEGER,
  "createdAt"        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "FamilyMember_registryId_userId_unique" UNIQUE("registryId", "userId")
);
CREATE INDEX "FamilyMember_registryId_kinshipTier_idx" ON "FamilyMember"("registryId", "kinshipTier");
CREATE INDEX "FamilyMember_parentId_idx" ON "FamilyMember"("parentId");

-- Audit logs (append-only enforced at application layer)
CREATE TABLE "AuditLog" (
  "id"         TEXT NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),
  "actorId"    TEXT NOT NULL REFERENCES "User"("id"),
  "action"     "AuditAction" NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId"   TEXT NOT NULL,
  "before"     JSONB,
  "after"      JSONB,
  "ipAddress"  TEXT,
  "userAgent"  TEXT,
  "createdAt"  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX "AuditLog_actorId_createdAt_idx" ON "AuditLog"("actorId", "createdAt");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

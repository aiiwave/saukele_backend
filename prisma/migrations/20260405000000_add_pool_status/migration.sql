-- Migration: 20260405000000_add_pool_status
-- Adds PoolStatus enum and poolStatus/poolCollectedKzt fields to GiftItem
-- (Already included in base schema above; this migration is a no-op if applied after init)

-- No changes needed — poolStatus was included in the initial migration.
-- This migration file exists to document the schema evolution history.
SELECT 1;

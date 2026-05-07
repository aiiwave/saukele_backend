import { z } from 'zod';
import { ContributionStatus, ContributionType, Currency, GiftStatus, PoolStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { giftRepository } from '../repositories/giftRepository';
import { auditRepository } from '../repositories/auditRepository';
import { AppError, NotFoundError, ValidationError } from '../middleware/errorHandler';
import { validateContributionAmount } from '../utils/currency';
import { enqueueEmail } from '../jobs/emailQueue';
import { logger } from '../utils/logger';

export const PoolContributionSchema = z.object({
  giftItemId: z.string().cuid(),
  amountKzt: z.number().int().positive(),
  currency: z.nativeEnum(Currency).default(Currency.KZT),
  idempotencyKey: z.string().min(1).optional(),
});

export const poolService = {
  /**
   * Pool funding contribution with SELECT FOR UPDATE to prevent race conditions.
   *
   * Flow:
   * 1. BEGIN transaction
   * 2. SELECT gift_item FOR UPDATE (exclusive row lock)
   * 3. Validate: collected + new_amount <= target
   * 4. INSERT contribution (PENDING)
   * 5. UPDATE poolCollectedKzt
   * 6. If fully funded: transition poolStatus PENDING → FUNDED
   * 7. COMMIT
   *
   * Idempotency: if idempotencyKey already exists → return existing contribution.
   */
  async contribute(userId: string, input: z.infer<typeof PoolContributionSchema>) {
    const { giftItemId, amountKzt, currency, idempotencyKey } = input;

    validateContributionAmount(amountKzt);

    // Idempotency check — return existing if key already used
    if (idempotencyKey) {
      const existing = await prisma.contribution.findUnique({
        where: { idempotencyKey },
      });
      if (existing) return { contribution: existing, alreadyExisted: true };
    }

    const result = await prisma.$transaction(
      async (tx) => {
        // SELECT FOR UPDATE: lock the gift item row for duration of transaction
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            pool_collected_kzt: number;
            pool_target_kzt: number;
            pool_status: PoolStatus;
            is_pool: boolean;
            status: GiftStatus;
          }>
        >`
          SELECT id, "poolCollectedKzt" as pool_collected_kzt,
                 "poolTargetKzt" as pool_target_kzt,
                 "poolStatus" as pool_status,
                 "isPool" as is_pool,
                 status
          FROM "GiftItem"
          WHERE id = ${giftItemId}
          FOR UPDATE
        `;

        if (!rows.length) throw new NotFoundError('Gift item');

        const gift = rows[0];

        if (!gift.is_pool) {
          throw new ValidationError('This gift item does not support pool contributions');
        }
        if (gift.status === GiftStatus.PURCHASED || gift.status === GiftStatus.DELIVERED) {
          throw new AppError(409, 'GIFT_ALREADY_PURCHASED', 'This item has already been purchased');
        }
        if (gift.pool_status === PoolStatus.FUNDED || gift.pool_status === PoolStatus.PURCHASED) {
          throw new AppError(409, 'POOL_ALREADY_FUNDED', 'This pool is already fully funded');
        }

        const target = gift.pool_target_kzt ?? 0;
        const collected = gift.pool_collected_kzt ?? 0;
        const remaining = target - collected;

        if (amountKzt > remaining) {
          throw new ValidationError(
            `Contribution exceeds pool remaining amount. Maximum allowed: ${remaining} tiyn`,
          );
        }

        const newCollected = collected + amountKzt;
        const nowFunded = newCollected >= target;

        // Create contribution
        const contribution = await tx.contribution.create({
          data: {
            giftItem: { connect: { id: giftItemId } },
            user: { connect: { id: userId } },
            type: ContributionType.POOL,
            status: ContributionStatus.PENDING,
            amountKzt,
            currency,
            ...(idempotencyKey ? { idempotencyKey } : {}),
          },
        });

        // Update collected amount and pool status
        await tx.giftItem.update({
          where: { id: giftItemId },
          data: {
            poolCollectedKzt: newCollected,
            ...(nowFunded
              ? { poolStatus: PoolStatus.FUNDED, status: GiftStatus.RESERVED }
              : {}),
          },
        });

        return { contribution, alreadyExisted: false, nowFunded };
      },
      { timeout: 10000 }, // 10s transaction timeout
    );

    // Best-effort notification to the registry owner. Outside the transaction
    // because email I/O must not extend lock duration.
    if (!result.alreadyExisted) {
      try {
        const gift = await prisma.giftItem.findUnique({
          where: { id: giftItemId },
          include: { registry: { include: { owner: true } } },
        });
        if (gift?.registry?.owner?.email) {
          await enqueueEmail({
            type: 'CONTRIBUTION_RECEIVED',
            to: gift.registry.owner.email,
            payload: {
              giftTitle: gift.title,
              amountKzt,
            },
          });
        }
      } catch (err) {
        logger.warn('Failed to enqueue contribution-received email', { err, giftItemId });
      }
    }

    return result;
  },

  /**
   * Transition pool from FUNDED → PURCHASED → DELIVERED.
   * Only COUPLE or ADMIN can advance state.
   */
  async advancePoolStatus(giftItemId: string, actorId: string) {
    const gift = await giftRepository.findById(giftItemId);
    if (!gift) throw new NotFoundError('Gift item');
    if (!gift.isPool) throw new ValidationError('Not a pool gift');

    const transitions: Record<string, PoolStatus> = {
      [PoolStatus.FUNDED]: PoolStatus.PURCHASED,
      [PoolStatus.PURCHASED]: PoolStatus.DELIVERED,
    };

    const nextStatus = transitions[gift.poolStatus];
    if (!nextStatus) {
      throw new AppError(
        409,
        'INVALID_TRANSITION',
        `Cannot advance pool from status: ${gift.poolStatus}`,
      );
    }

    const giftStatusMap: Partial<Record<PoolStatus, GiftStatus>> = {
      [PoolStatus.PURCHASED]: GiftStatus.PURCHASED,
      [PoolStatus.DELIVERED]: GiftStatus.DELIVERED,
    };

    const updated = await giftRepository.update(giftItemId, {
      poolStatus: nextStatus,
      ...(giftStatusMap[nextStatus] ? { status: giftStatusMap[nextStatus] } : {}),
    });

    await auditRepository.create({
      actorId,
      action: 'PAYMENT_COMPLETED',
      entityType: 'GiftItem',
      entityId: giftItemId,
      before: { poolStatus: gift.poolStatus },
      after: { poolStatus: nextStatus },
    });

    return updated;
  },
};

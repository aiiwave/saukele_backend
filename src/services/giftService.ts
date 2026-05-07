import { z } from 'zod';
import { ContributionStatus, ContributionType, GiftStatus } from '@prisma/client';
import { prisma } from '../config/database';
import { giftRepository } from '../repositories/giftRepository';
import { registryRepository } from '../repositories/registryRepository';
import { AppError, ForbiddenError, NotFoundError, ValidationError } from '../middleware/errorHandler';
import { parsePaginationParams, buildPageResult, decodeCursor } from '../utils/pagination';
import { validateContributionAmount } from '../utils/currency';

export const AddGiftSchema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(1000).optional(),
  imageUrl: z.string().url().optional(),
  priceKzt: z.number().int().positive(),
  isPool: z.boolean().default(false),
  poolTargetKzt: z.number().int().positive().optional(),
  externalUrl: z.string().url().optional(),
  quantity: z.number().int().min(1).default(1),
}).refine((d) => !d.isPool || d.poolTargetKzt, {
  message: 'Pool gift requires poolTargetKzt',
});

export const UpdateGiftSchema = AddGiftSchema.partial();

export const giftService = {
  async addToRegistry(
    registryId: string,
    actorId: string,
    input: z.infer<typeof AddGiftSchema>,
  ) {
    const registry = await registryRepository.findById(registryId);
    if (!registry) throw new NotFoundError('Registry');
    if (registry.ownerId !== actorId) throw new ForbiddenError('Not your registry');
    if (registry.isExpired) throw new AppError(409, 'REGISTRY_EXPIRED', 'Registry is expired');

    validateContributionAmount(input.priceKzt);
    if (input.poolTargetKzt) validateContributionAmount(input.poolTargetKzt);

    return giftRepository.create({
      registry: { connect: { id: registryId } },
      title: input.title,
      description: input.description,
      imageUrl: input.imageUrl,
      priceKzt: input.priceKzt,
      isPool: input.isPool,
      poolTargetKzt: input.poolTargetKzt,
      externalUrl: input.externalUrl,
      quantity: input.quantity,
    });
  },

  async listByRegistry(
    registryId: string,
    query: { cursor?: string; limit?: string; sort?: string; status?: string },
  ) {
    const { cursor, limit } = parsePaginationParams(query);
    const cursorObj = cursor ? { id: decodeCursor(cursor).id } : undefined;
    const status = query.status as GiftStatus | undefined;

    const items = await giftRepository.findByRegistry(registryId, {
      limit,
      cursor: cursorObj,
      status,
    });

    return buildPageResult(items as (typeof items[0] & { createdAt: Date })[], limit);
  },

  async reserveSolo(giftItemId: string, userId: string) {
    return prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string; status: GiftStatus; is_pool: boolean; quantity: number; reserved_by: string | null;
      }>>`
        SELECT id, status, "isPool" as is_pool, quantity, "reservedBy" as reserved_by
        FROM "GiftItem" WHERE id = ${giftItemId} FOR UPDATE
      `;

      if (!rows.length) throw new NotFoundError('Gift item');
      const gift = rows[0];

      if (gift.is_pool) throw new ValidationError('Use pool contribution endpoint for pool gifts');
      if (gift.status !== GiftStatus.AVAILABLE) {
        throw new AppError(409, 'GIFT_UNAVAILABLE', 'Gift is no longer available');
      }

      await tx.giftItem.update({
        where: { id: giftItemId },
        data: { status: GiftStatus.RESERVED, reservedBy: userId },
      });

      return tx.contribution.create({
        data: {
          giftItem: { connect: { id: giftItemId } },
          user: { connect: { id: userId } },
          type: ContributionType.SOLO,
          status: ContributionStatus.PENDING,
          amountKzt: gift.quantity, // placeholder until payment
        },
      });
    });
  },

  async update(giftItemId: string, actorId: string, input: z.infer<typeof UpdateGiftSchema>) {
    const gift = await giftRepository.findById(giftItemId);
    if (!gift) throw new NotFoundError('Gift item');

    const registry = await registryRepository.findById(gift.registryId);
    if (!registry || registry.ownerId !== actorId) {
      throw new ForbiddenError('Not your registry');
    }

    return giftRepository.update(giftItemId, input);
  },

  async delete(giftItemId: string, actorId: string) {
    const gift = await giftRepository.findById(giftItemId);
    if (!gift) throw new NotFoundError('Gift item');

    const registry = await registryRepository.findById(gift.registryId);
    if (!registry || registry.ownerId !== actorId) {
      throw new ForbiddenError('Not your registry');
    }

    if (gift.status !== GiftStatus.AVAILABLE) {
      throw new AppError(409, 'GIFT_NOT_DELETABLE', 'Cannot delete a reserved or purchased gift');
    }

    await giftRepository.delete(giftItemId);
    return { message: 'Gift item deleted' };
  },
};

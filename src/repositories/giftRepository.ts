import { GiftItem, GiftStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database';

export const giftRepository = {
  async findById(id: string): Promise<GiftItem | null> {
    return prisma.giftItem.findUnique({ where: { id } });
  },

  async findByRegistry(
    registryId: string,
    params: { limit: number; cursor?: object; status?: GiftStatus },
  ) {
    return prisma.giftItem.findMany({
      where: {
        registryId,
        ...(params.status ? { status: params.status } : {}),
      },
      take: params.limit + 1,
      ...(params.cursor ? { cursor: params.cursor, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });
  },

  async create(data: Prisma.GiftItemCreateInput): Promise<GiftItem> {
    return prisma.giftItem.create({ data });
  },

  async update(id: string, data: Prisma.GiftItemUpdateInput): Promise<GiftItem> {
    return prisma.giftItem.update({ where: { id }, data });
  },

  async delete(id: string): Promise<void> {
    await prisma.giftItem.delete({ where: { id } });
  },
};

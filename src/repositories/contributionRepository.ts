import { Contribution, ContributionStatus, Prisma } from '@prisma/client';
import { prisma } from '../config/database';

export const contributionRepository = {
  async findById(id: string): Promise<Contribution | null> {
    return prisma.contribution.findUnique({ where: { id } });
  },

  async findByIdempotencyKey(key: string): Promise<Contribution | null> {
    return prisma.contribution.findUnique({ where: { idempotencyKey: key } });
  },

  async findByUser(
    userId: string,
    params: { limit: number; cursor?: object },
  ) {
    return prisma.contribution.findMany({
      where: { userId },
      take: params.limit + 1,
      ...(params.cursor ? { cursor: params.cursor, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: { giftItem: { select: { id: true, title: true, registryId: true } } },
    });
  },

  async findByGiftItem(giftItemId: string, status?: ContributionStatus) {
    return prisma.contribution.findMany({
      where: { giftItemId, ...(status ? { status } : {}) },
    });
  },

  async create(data: Prisma.ContributionCreateInput): Promise<Contribution> {
    return prisma.contribution.create({ data });
  },

  async updateStatus(id: string, status: ContributionStatus): Promise<Contribution> {
    return prisma.contribution.update({ where: { id }, data: { status } });
  },
};

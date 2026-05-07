import { Prisma, Registry } from '@prisma/client';
import { prisma } from '../config/database';

export const registryRepository = {
  async findById(id: string) {
    return prisma.registry.findUnique({
      where: { id },
      include: { owner: { select: { id: true, email: true, phone: true } } },
    });
  },

  async findByInviteCode(inviteCode: string) {
    return prisma.registry.findUnique({ where: { inviteCode } });
  },

  async findAllPublic(params: { limit: number; cursor?: object }) {
    return prisma.registry.findMany({
      where: { visibility: 'PUBLIC', isExpired: false },
      take: params.limit + 1,
      ...(params.cursor ? { cursor: params.cursor, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
      include: { owner: { select: { id: true, email: true } } },
    });
  },

  async findByOwner(ownerId: string, params: { limit: number; cursor?: object }) {
    return prisma.registry.findMany({
      where: { ownerId },
      take: params.limit + 1,
      ...(params.cursor ? { cursor: params.cursor, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });
  },

  async create(data: Prisma.RegistryCreateInput): Promise<Registry> {
    return prisma.registry.create({ data });
  },

  async update(id: string, data: Prisma.RegistryUpdateInput): Promise<Registry> {
    return prisma.registry.update({ where: { id }, data });
  },

  async findExpiring(): Promise<Registry[]> {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    return prisma.registry.findMany({
      where: {
        isExpired: false,
        weddingDate: { lte: ninetyDaysAgo },
      },
    });
  },
};

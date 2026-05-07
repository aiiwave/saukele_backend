import { Prisma, User } from '@prisma/client';
import { prisma } from '../config/database';

export const userRepository = {
  async findById(id: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { id } });
  },

  async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { email } });
  },

  async findByPhone(phone: string): Promise<User | null> {
    return prisma.user.findUnique({ where: { phone } });
  },

  async findByEmailOrPhone(email?: string, phone?: string): Promise<User | null> {
    if (!email && !phone) return null;
    return prisma.user.findFirst({
      where: { OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])] },
    });
  },

  async create(data: Prisma.UserCreateInput): Promise<User> {
    return prisma.user.create({ data });
  },

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    return prisma.user.update({ where: { id }, data });
  },

  async findAll(params: {
    cursor?: string;
    limit: number;
    isActive?: boolean;
  }): Promise<User[]> {
    return prisma.user.findMany({
      where: { ...(params.isActive !== undefined ? { isActive: params.isActive } : {}) },
      take: params.limit + 1,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
      orderBy: { createdAt: 'desc' },
    });
  },
};

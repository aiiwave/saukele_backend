import { AuditAction, AuditLog } from '@prisma/client';
import { prisma } from '../config/database';

/**
 * APPEND-ONLY audit repository.
 * Intentionally exposes ONLY create() — no update(), delete(), or upsert().
 * Combined with the PostgreSQL trigger (migration 20260410), this ensures
 * audit records are tamper-proof at both application and database layers.
 */
export const auditRepository = {
  async create(data: {
    actorId: string;
    action: AuditAction;
    entityType: string;
    entityId: string;
    before?: object;
    after?: object;
    ipAddress?: string;
    userAgent?: string;
  }): Promise<AuditLog> {
    return prisma.auditLog.create({ data });
  },

  async findByEntity(
    entityType: string,
    entityId: string,
    limit = 50,
  ): Promise<AuditLog[]> {
    return prisma.auditLog.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },

  async findByActor(actorId: string, limit = 50): Promise<AuditLog[]> {
    return prisma.auditLog.findMany({
      where: { actorId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  },
};

import { z } from 'zod';
import { RegistryVisibility } from '@prisma/client';
import { registryRepository } from '../repositories/registryRepository';
import { userRepository } from '../repositories/userRepository';
import { auditRepository } from '../repositories/auditRepository';
import { NotFoundError, ForbiddenError } from '../middleware/errorHandler';
import { parsePaginationParams, buildPageResult, decodeCursor } from '../utils/pagination';
import { enqueueEmail } from '../jobs/emailQueue';
import { env } from '../config/env';
import { logger } from '../utils/logger';

export const CreateRegistrySchema = z.object({
  title: z.string().min(3).max(120),
  weddingDate: z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  venue: z.string().max(200).optional(),
  coverImageUrl: z.string().url().optional(),
  visibility: z.nativeEnum(RegistryVisibility).default(RegistryVisibility.INVITE_ONLY),
});

export const UpdateRegistrySchema = CreateRegistrySchema.partial();

export const registryService = {
  async create(ownerId: string, input: z.infer<typeof CreateRegistrySchema>, actorIp?: string) {
    const registry = await registryRepository.create({
      owner: { connect: { id: ownerId } },
      title: input.title,
      weddingDate: new Date(input.weddingDate),
      venue: input.venue,
      coverImageUrl: input.coverImageUrl,
      visibility: input.visibility,
    });

    await auditRepository.create({
      actorId: ownerId,
      action: 'REGISTRY_CREATED',
      entityType: 'Registry',
      entityId: registry.id,
      after: registry,
      ipAddress: actorIp,
    });

    // Notify the owner via email (best-effort; failure to enqueue must not block creation).
    try {
      const owner = await userRepository.findById(ownerId);
      if (owner?.email) {
        await enqueueEmail({
          type: 'REGISTRY_CREATED',
          to: owner.email,
          payload: {
            registryTitle: registry.title,
            registryUrl: `${env.APP_BASE_URL}/registries/${registry.id}`,
          },
        });
      }
    } catch (err) {
      logger.warn('Failed to enqueue registry-created email', { err, registryId: registry.id });
    }

    return registry;
  },

  async getById(id: string, requesterId?: string) {
    const registry = await registryRepository.findById(id);
    if (!registry) throw new NotFoundError('Registry');

    // Enforce visibility rules
    if (registry.visibility === 'PRIVATE' && registry.ownerId !== requesterId) {
      throw new ForbiddenError('This registry is private');
    }

    return registry;
  },

  async getByInviteCode(inviteCode: string) {
    const registry = await registryRepository.findByInviteCode(inviteCode);
    if (!registry) throw new NotFoundError('Registry');
    if (registry.isExpired) throw new ForbiddenError('This registry has expired');
    return registry;
  },

  async listPublic(query: { cursor?: string; limit?: string; sort?: string }) {
    const { cursor, limit } = parsePaginationParams(query);
    const cursorObj = cursor ? { id: decodeCursor(cursor).id } : undefined;

    const items = await registryRepository.findAllPublic({ limit, cursor: cursorObj });
    return buildPageResult(items as (typeof items[0] & { createdAt: Date })[],  limit);
  },

  async listByOwner(ownerId: string, query: { cursor?: string; limit?: string; sort?: string }) {
    const { cursor, limit } = parsePaginationParams(query);
    const cursorObj = cursor ? { id: decodeCursor(cursor).id } : undefined;

    const items = await registryRepository.findByOwner(ownerId, { limit, cursor: cursorObj });
    return buildPageResult(items as (typeof items[0] & { createdAt: Date })[], limit);
  },

  async update(
    id: string,
    requesterId: string,
    input: z.infer<typeof UpdateRegistrySchema>,
  ) {
    const registry = await registryRepository.findById(id);
    if (!registry) throw new NotFoundError('Registry');
    if (registry.ownerId !== requesterId) throw new ForbiddenError('Not your registry');

    const updated = await registryRepository.update(id, {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.weddingDate !== undefined && { weddingDate: new Date(input.weddingDate) }),
      ...(input.venue !== undefined && { venue: input.venue }),
      ...(input.coverImageUrl !== undefined && { coverImageUrl: input.coverImageUrl }),
      ...(input.visibility !== undefined && { visibility: input.visibility }),
    });

    return updated;
  },

  async expire(id: string, actorId: string) {
    const registry = await registryRepository.findById(id);
    if (!registry) throw new NotFoundError('Registry');

    const updated = await registryRepository.update(id, { isExpired: true });

    await auditRepository.create({
      actorId,
      action: 'REGISTRY_EXPIRED',
      entityType: 'Registry',
      entityId: id,
      before: registry,
      after: updated,
    });

    return updated;
  },
};

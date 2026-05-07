import { z } from 'zod';
import { KinshipTier } from '@prisma/client';
import { prisma } from '../config/database';
import { AppError, ForbiddenError, NotFoundError, ValidationError } from '../middleware/errorHandler';
import { registryRepository } from '../repositories/registryRepository';

export const AddFamilyMemberSchema = z.object({
  userId: z.string().cuid(),
  parentId: z.string().cuid().optional(),
  kinshipTier: z.nativeEnum(KinshipTier),
  kinshipLabel: z.string().max(50).optional(),
  giftTierOverride: z.number().int().min(1).max(4).optional(),
});

export const kinshipService = {
  async addMember(
    registryId: string,
    actorId: string,
    input: z.infer<typeof AddFamilyMemberSchema>,
  ) {
    const registry = await registryRepository.findById(registryId);
    if (!registry) throw new NotFoundError('Registry');
    if (registry.ownerId !== actorId) throw new ForbiddenError('Only the registry owner can manage kinship');

    // Validate parent exists in same registry if provided
    if (input.parentId) {
      const parent = await prisma.familyMember.findFirst({
        where: { id: input.parentId, registryId },
      });
      if (!parent) throw new ValidationError('Parent family member not found in this registry');
    }

    return prisma.familyMember.create({
      data: {
        registry: { connect: { id: registryId } },
        user: { connect: { id: input.userId } },
        ...(input.parentId ? { parent: { connect: { id: input.parentId } } } : {}),
        kinshipTier: input.kinshipTier,
        kinshipLabel: input.kinshipLabel,
        giftTierOverride: input.giftTierOverride,
      },
    });
  },

  /**
   * Recursive CTE query: traverse the self-referential FamilyMember tree
   * to find kinship tier for a specific guest in a registry.
   * Depth capped at 4 to prevent infinite loops.
   *
   * Uses Prisma $queryRaw (documented exception — recursive CTEs are not
   * expressible in Prisma's query builder).
   */
  async getKinshipTier(
    registryId: string,
    userId: string,
  ): Promise<{ kinshipTier: KinshipTier; giftTierOverride: number | null; depth: number } | null> {
    const rows = await prisma.$queryRaw<
      Array<{
        kinship_tier: KinshipTier;
        gift_tier_override: number | null;
        depth: number;
      }>
    >`
      WITH RECURSIVE member_tree AS (
        -- Base case: root members (no parent)
        SELECT
          fm.id, fm.user_id, fm.parent_id,
          fm.kinship_tier, fm.registry_id,
          fm.gift_tier_override,
          1 AS depth
        FROM "FamilyMember" fm
        WHERE fm."registryId" = ${registryId}
          AND fm."parentId" IS NULL

        UNION ALL

        -- Recursive case: walk down the tree
        SELECT
          fm.id, fm.user_id, fm.parent_id,
          fm.kinship_tier, fm.registry_id,
          fm.gift_tier_override,
          mt.depth + 1
        FROM "FamilyMember" fm
        INNER JOIN member_tree mt ON fm."parentId" = mt.id
        WHERE mt.depth < 4  -- depth cap prevents infinite loops on corrupt data
      )
      SELECT
        kinship_tier,
        gift_tier_override,
        depth
      FROM member_tree
      WHERE user_id = ${userId}
      LIMIT 1
    `;

    if (!rows.length) return null;

    return {
      kinshipTier: rows[0].kinship_tier,
      giftTierOverride: rows[0].gift_tier_override,
      depth: rows[0].depth,
    };
  },

  /**
   * Get the full family tree for a registry, structured as a nested object.
   * Uses recursive CTE to fetch all members in one query.
   */
  async getTree(registryId: string) {
    const rows = await prisma.$queryRaw<
      Array<{
        id: string;
        user_id: string;
        parent_id: string | null;
        kinship_tier: KinshipTier;
        kinship_label: string | null;
        gift_tier_override: number | null;
        depth: number;
      }>
    >`
      WITH RECURSIVE member_tree AS (
        SELECT
          fm.id, fm.user_id, fm.parent_id,
          fm.kinship_tier, fm.kinship_label,
          fm.gift_tier_override,
          1 AS depth
        FROM "FamilyMember" fm
        WHERE fm."registryId" = ${registryId}
          AND fm."parentId" IS NULL

        UNION ALL

        SELECT
          fm.id, fm.user_id, fm.parent_id,
          fm.kinship_tier, fm.kinship_label,
          fm.gift_tier_override,
          mt.depth + 1
        FROM "FamilyMember" fm
        INNER JOIN member_tree mt ON fm."parentId" = mt.id
        WHERE mt.depth < 4
      )
      SELECT * FROM member_tree
      ORDER BY depth, id
    `;

    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      parentId: r.parent_id,
      kinshipTier: r.kinship_tier,
      kinshipLabel: r.kinship_label,
      giftTierOverride: r.gift_tier_override,
      depth: r.depth,
    }));
  },

  async updateMember(
    registryId: string,
    memberId: string,
    actorId: string,
    data: Partial<z.infer<typeof AddFamilyMemberSchema>>,
  ) {
    const registry = await registryRepository.findById(registryId);
    if (!registry) throw new NotFoundError('Registry');
    if (registry.ownerId !== actorId) throw new ForbiddenError('Only the registry owner can manage kinship');

    const member = await prisma.familyMember.findFirst({
      where: { id: memberId, registryId },
    });
    if (!member) throw new NotFoundError('Family member');

    return prisma.familyMember.update({
      where: { id: memberId },
      data: {
        ...(data.kinshipTier !== undefined && { kinshipTier: data.kinshipTier }),
        ...(data.kinshipLabel !== undefined && { kinshipLabel: data.kinshipLabel }),
        ...(data.giftTierOverride !== undefined && { giftTierOverride: data.giftTierOverride }),
      },
    });
  },
};

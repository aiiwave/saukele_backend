import { Request, Response } from 'express';
import { poolService, PoolContributionSchema } from '../services/poolService';
import { contributionRepository } from '../repositories/contributionRepository';
import { parsePaginationParams, buildPageResult, decodeCursor } from '../utils/pagination';
import { asyncHandler } from '../utils/asyncHandler';

export const contributionController = {
  poolContribute: asyncHandler(async (req: Request, res: Response) => {
    const input = PoolContributionSchema.parse(req.body);
    const result = await poolService.contribute(req.user!.sub, input);
    res.status(result.alreadyExisted ? 200 : 201).json(result);
  }),

  advancePool: asyncHandler(async (req: Request, res: Response) => {
    const gift = await poolService.advancePoolStatus(req.params.giftId, req.user!.sub);
    res.json({ gift });
  }),

  myContributions: asyncHandler(async (req: Request, res: Response) => {
    const { cursor, limit } = parsePaginationParams(req.query as Record<string, string>);
    const cursorObj = cursor ? { id: decodeCursor(cursor).id } : undefined;

    const items = await contributionRepository.findByUser(req.user!.sub, { limit, cursor: cursorObj });
    const result = buildPageResult(items as (typeof items[0] & { createdAt: Date })[], limit);
    res.json(result);
  }),
};

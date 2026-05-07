import { Request, Response } from 'express';
import { giftService, AddGiftSchema, UpdateGiftSchema } from '../services/giftService';
import { asyncHandler } from '../utils/asyncHandler';

export const giftController = {
  add: asyncHandler(async (req: Request, res: Response) => {
    const input = AddGiftSchema.parse(req.body);
    const gift = await giftService.addToRegistry(req.params.registryId, req.user!.sub, input);
    res.status(201).json({ gift });
  }),

  list: asyncHandler(async (req: Request, res: Response) => {
    const result = await giftService.listByRegistry(
      req.params.registryId,
      req.query as Record<string, string>,
    );
    res.json(result);
  }),

  reserve: asyncHandler(async (req: Request, res: Response) => {
    const contribution = await giftService.reserveSolo(req.params.giftId, req.user!.sub);
    res.status(201).json({ contribution });
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const input = UpdateGiftSchema.parse(req.body);
    const gift = await giftService.update(req.params.giftId, req.user!.sub, input);
    res.json({ gift });
  }),

  delete: asyncHandler(async (req: Request, res: Response) => {
    const result = await giftService.delete(req.params.giftId, req.user!.sub);
    res.json(result);
  }),
};

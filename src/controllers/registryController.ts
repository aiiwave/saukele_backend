import { Request, Response } from 'express';
import { registryService, CreateRegistrySchema, UpdateRegistrySchema } from '../services/registryService';
import { asyncHandler } from '../utils/asyncHandler';

export const registryController = {
  create: asyncHandler(async (req: Request, res: Response) => {
    const input = CreateRegistrySchema.parse(req.body);
    const registry = await registryService.create(req.user!.sub, input, req.ip);
    res.status(201).json({ registry });
  }),

  getById: asyncHandler(async (req: Request, res: Response) => {
    const registry = await registryService.getById(req.params.id, req.user?.sub);
    res.json({ registry });
  }),

  getByInviteCode: asyncHandler(async (req: Request, res: Response) => {
    const registry = await registryService.getByInviteCode(req.params.code);
    res.json({ registry });
  }),

  listPublic: asyncHandler(async (req: Request, res: Response) => {
    const result = await registryService.listPublic(req.query as Record<string, string>);
    res.json(result);
  }),

  listMine: asyncHandler(async (req: Request, res: Response) => {
    const result = await registryService.listByOwner(req.user!.sub, req.query as Record<string, string>);
    res.json(result);
  }),

  update: asyncHandler(async (req: Request, res: Response) => {
    const input = UpdateRegistrySchema.parse(req.body);
    const registry = await registryService.update(req.params.id, req.user!.sub, input);
    res.json({ registry });
  }),
};

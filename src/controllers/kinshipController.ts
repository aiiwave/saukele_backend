import { Request, Response } from 'express';
import { kinshipService, AddFamilyMemberSchema } from '../services/kinshipService';
import { asyncHandler } from '../utils/asyncHandler';

export const kinshipController = {
  addMember: asyncHandler(async (req: Request, res: Response) => {
    const input = AddFamilyMemberSchema.parse(req.body);
    const member = await kinshipService.addMember(req.params.registryId, req.user!.sub, input);
    res.status(201).json({ member });
  }),

  getTree: asyncHandler(async (req: Request, res: Response) => {
    const tree = await kinshipService.getTree(req.params.registryId);
    res.json({ tree });
  }),

  getMyTier: asyncHandler(async (req: Request, res: Response) => {
    const tier = await kinshipService.getKinshipTier(req.params.registryId, req.user!.sub);
    if (!tier) {
      res.status(404).json({ error: { code: 'NOT_FOUND', message: 'You are not in this registry kinship tree' } });
      return;
    }
    res.json({ tier });
  }),

  updateMember: asyncHandler(async (req: Request, res: Response) => {
    const input = AddFamilyMemberSchema.partial().parse(req.body);
    const member = await kinshipService.updateMember(
      req.params.registryId,
      req.params.memberId,
      req.user!.sub,
      input,
    );
    res.json({ member });
  }),
};

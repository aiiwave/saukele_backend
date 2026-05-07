import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/database';
import { userRepository } from '../repositories/userRepository';
import { auditRepository } from '../repositories/auditRepository';
import { registryService } from '../services/registryService';
import { currencyService, CreateExchangeRateSchema } from '../services/currencyService';
import { asyncHandler } from '../utils/asyncHandler';
import { NotFoundError, ValidationError } from '../middleware/errorHandler';
import { enqueueEmail } from '../jobs/emailQueue';
import { env } from '../config/env';

export const adminController = {
  suspendUser: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const user = await userRepository.findById(userId);
    if (!user) throw new NotFoundError('User');

    const updated = await userRepository.update(userId, { isActive: false });

    await auditRepository.create({
      actorId: req.user!.sub,
      action: 'USER_SUSPENDED',
      entityType: 'User',
      entityId: userId,
      before: { isActive: user.isActive },
      after: { isActive: false },
      ipAddress: req.ip,
    });

    res.json({ user: updated });
  }),

  activateUser: asyncHandler(async (req: Request, res: Response) => {
    const { userId } = req.params;
    const updated = await userRepository.update(userId, { isActive: true });
    res.json({ user: updated });
  }),

  expireRegistry: asyncHandler(async (req: Request, res: Response) => {
    const updated = await registryService.expire(req.params.registryId, req.user!.sub);
    res.json({ registry: updated });
  }),

  setExchangeRate: asyncHandler(async (req: Request, res: Response) => {
    const input = CreateExchangeRateSchema.parse(req.body);
    const snapshot = await currencyService.lockRate(req.user!.sub, input);
    res.status(201).json({ snapshot });
  }),

  getAuditLog: asyncHandler(async (req: Request, res: Response) => {
    const { entityType, entityId } = req.query as { entityType?: string; entityId?: string };
    const logs = entityType && entityId
      ? await auditRepository.findByEntity(entityType, entityId)
      : await auditRepository.findByActor(req.user!.sub);
    res.json({ logs });
  }),

  listUsers: asyncHandler(async (req: Request, res: Response) => {
    const { cursor, isActive } = req.query as { cursor?: string; isActive?: string };
    const users = await userRepository.findAll({
      cursor,
      limit: 50,
      isActive: isActive !== undefined ? isActive === 'true' : undefined,
    });
    res.json({ users });
  }),

  /**
   * Trigger a test email job. Useful for verifying the email worker is alive
   * during the live defense demo.
   */
  testEmail: asyncHandler(async (req: Request, res: Response) => {
    const schema = z.object({ to: z.string().email() });
    const { to } = schema.parse(req.body);

    await enqueueEmail({
      type: 'EMAIL_VERIFICATION',
      to,
      payload: {
        verifyUrl: `${env.APP_BASE_URL}/verify-email?token=test-${Date.now()}`,
        expiresInHours: 24,
      },
    });

    res.json({
      message: 'Test email enqueued. Check the worker logs (or your inbox in non-dev mode).',
      to,
    });
  }),
};

import { Router, Request, Response } from 'express';
import { verifyKaspiWebhook, verifyStripeWebhook } from '../middleware/webhookAuth';
import { prisma } from '../config/database';
import { asyncHandler } from '../utils/asyncHandler';
import { auditRepository } from '../repositories/auditRepository';
import { logger } from '../utils/logger';
import { enqueueEmail } from '../jobs/emailQueue';

const router = Router();

/**
 * Kaspi Pay webhook handler.
 * Raw body required for HMAC verification — mounted with express.raw() in app.ts.
 */
router.post(
  '/kaspi',
  verifyKaspiWebhook,
  asyncHandler(async (req: Request, res: Response) => {
    const payload = req.body as {
      transactionId: string;
      contributionId: string;
      status: string;
      amount: number;
    };

    logger.info('Kaspi webhook received', { transactionId: payload.transactionId });

    await prisma.$transaction(async (tx) => {
      const contribution = await tx.contribution.findUnique({
        where: { id: payload.contributionId },
      });

      if (!contribution) {
        logger.warn('Kaspi webhook: contribution not found', { contributionId: payload.contributionId });
        return;
      }

      const status = payload.status === 'SUCCESS' ? 'PAID' : 'FAILED';

      await tx.contribution.update({
        where: { id: payload.contributionId },
        data: { status },
      });

      await tx.paymentTransaction.upsert({
        where: { providerTxId: payload.transactionId },
        update: { status: payload.status, rawPayload: payload },
        create: {
          contributionId: payload.contributionId,
          provider: 'kaspi',
          providerTxId: payload.transactionId,
          amountKzt: payload.amount,
          status: payload.status,
          rawPayload: payload,
        },
      });
    });

    // Best-effort payment confirmation email (outside the transaction)
    if (payload.status === 'SUCCESS') {
      try {
        const contribution = await prisma.contribution.findUnique({
          where: { id: payload.contributionId },
          include: { user: true, giftItem: true },
        });
        if (contribution?.user?.email) {
          await enqueueEmail({
            type: 'PAYMENT_CONFIRMATION',
            to: contribution.user.email,
            payload: {
              giftTitle: contribution.giftItem.title,
              amountKzt: contribution.amountKzt,
              transactionId: payload.transactionId,
            },
          });
        }
      } catch (err) {
        logger.warn('Failed to enqueue payment confirmation email', { err });
      }
    }

    // Always return 200 immediately to prevent Kaspi retry storms
    res.status(200).json({ received: true });
  }),
);

/**
 * Stripe webhook handler.
 */
router.post(
  '/stripe',
  verifyStripeWebhook,
  asyncHandler(async (req: Request, res: Response) => {
    const event = req.body as {
      type: string;
      data: { object: { id: string; metadata: { contributionId: string }; amount: number } };
    };

    logger.info('Stripe webhook received', { type: event.type });

    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object;
      const { contributionId } = pi.metadata;

      await prisma.$transaction(async (tx) => {
        await tx.contribution.update({
          where: { id: contributionId },
          data: { status: 'PAID' },
        });

        await tx.paymentTransaction.upsert({
          where: { providerTxId: pi.id },
          update: { status: 'completed', rawPayload: event },
          create: {
            contributionId,
            provider: 'stripe',
            providerTxId: pi.id,
            amountKzt: pi.amount,
            status: 'completed',
            rawPayload: event,
          },
        });
      });
    }

    res.status(200).json({ received: true });
  }),
);

export default router;
